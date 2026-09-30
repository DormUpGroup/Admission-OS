import type { Prisma } from "@prisma/client";
import { chatFactsToSave } from "@/lib/lead-profile";
import { enqueueOutbox, type DbClient } from "@/server/commands/outbox";
import {
  ensureCapabilityGrant,
  formatChatTranscript,
  formatLeadCard,
  hermesRunInstructions,
  LEAD_FACT_FIELDS,
  revokeCapabilityGrant,
} from "./capability-grant";
import {
  HermesRetryableError,
  isHermesProfileKey,
  postHermesCreateRun,
  readHermesProfileConfig,
  type HermesCreateRunBody,
} from "./hermes-client";
import { commitSchedulingRunCalendar } from "./commit-consultation";
import { enqueueHermesPollRun } from "./hermes-poll-run";
import { explicitCuratorRequestCount } from "./curator-handoff";
import { loadOnboardingContext, onboardingRunInstructions } from "./onboarding";

export const HERMES_CREATE_RUN_EVENT = "hermes.create_run";

export function hermesCreateRunIdempotencyKey(agentRunId: string): string {
  return `hermes.create_run:${agentRunId}`;
}

export async function enqueueHermesCreateRun(
  db: DbClient,
  agentRunId: string,
): Promise<void> {
  await enqueueOutbox(db, {
    aggregateType: "AgentRun",
    aggregateId: agentRunId,
    eventType: HERMES_CREATE_RUN_EVENT,
    payload: { agentRunId },
    idempotencyKey: hermesCreateRunIdempotencyKey(agentRunId),
  });
}

/** Backfill QUEUED profile runs that never received a hermes.create_run event. */
export async function enqueueQueuedHermesCreateRuns(
  db: DbClient,
  limit: number,
): Promise<number> {
  const runs = await db.agentRun.findMany({
    where: {
      agentKey: { in: ["intake", "scheduling", "onboarding"] },
      status: "QUEUED",
      hermesRunId: null,
    },
    select: { id: true },
    orderBy: { queuedAt: "asc" },
    take: limit,
  });
  for (const run of runs) {
    await enqueueHermesCreateRun(db, run.id);
  }
  return runs.length;
}

export type DispatchHermesCreateRunResult =
  | { status: "running"; hermesRunId: string }
  | { status: "failed"; errorCode: string }
  | { status: "skipped"; hermesRunId: string | null };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isUniqueConstraint(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002",
  );
}

async function markFailed(
  db: DbClient,
  agentRunId: string,
  errorCode: string,
  errorMessage: string,
  now: Date,
): Promise<boolean> {
  const result = await db.agentRun.updateMany({
    where: { id: agentRunId, status: "QUEUED", hermesRunId: null },
    data: {
      status: "FAILED",
      errorCode,
      errorMessage: errorMessage.slice(0, 4000),
      completedAt: now,
    },
  });
  return result.count > 0;
}

type QueuedProfileRun = {
  id: string;
  agentKey: string;
  idempotencyKey: string;
  conversationId: string | null;
  inputJson: Prisma.JsonValue | null;
};

function schedulingRunInstructions(grantId: string, facts: string): string {
  return [
    "Call tools only through the admission_os MCP server.",
    `Pass grant_id exactly as ${grantId} on every tool call.`,
    "Allowed tools: commit_booked_consultation.",
    "The client already chose this slot on the booking page. Do not change the date or time.",
    "Call commit_booked_consultation once. It writes the curator's calendar, creates Google Meet, and emails the client and the curator.",
    "Do not message Telegram. Do not invent a Meet link.",
    facts,
  ].join("\n");
}

async function publishHermesRun(
  db: DbClient,
  run: QueuedProfileRun,
  body: HermesCreateRunBody,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  fetchImpl: typeof fetch | undefined,
  now: Date,
): Promise<DispatchHermesCreateRunResult> {
  const outcome = await postHermesCreateRun({
    env,
    agentKey: run.agentKey,
    body,
    idempotencyKey: run.idempotencyKey,
    fetchImpl,
  });

  if (outcome.kind === "terminal") {
    await commitSchedulingRunCalendar(db, {
      id: run.id,
      agentKey: run.agentKey,
      inputJson: run.inputJson,
      outputJson: null,
    });
    await revokeCapabilityGrant(db, run.id, now);
    await markFailed(db, run.id, `http_${outcome.status}`, outcome.message, now);
    return { status: "failed", errorCode: `http_${outcome.status}` };
  }

  const hermesSessionId = outcome.sessionId ?? body.session_id;
  try {
    const updated = await db.agentRun.updateMany({
      where: { id: run.id, status: "QUEUED", hermesRunId: null },
      data: {
        status: "RUNNING",
        hermesRunId: outcome.runId,
        hermesSessionId,
        startedAt: now,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (updated.count === 0) {
      const current = await db.agentRun.findUnique({
        where: { id: run.id },
        select: { hermesRunId: true },
      });
      if (current?.hermesRunId) {
        await enqueueHermesPollRun(db, run.id);
        return { status: "running", hermesRunId: current.hermesRunId };
      }
      return { status: "skipped", hermesRunId: null };
    }
  } catch (error) {
    if (isUniqueConstraint(error)) {
      await commitSchedulingRunCalendar(db, {
        id: run.id,
        agentKey: run.agentKey,
        inputJson: run.inputJson,
        outputJson: null,
      });
      await revokeCapabilityGrant(db, run.id, now);
      await markFailed(
        db,
        run.id,
        "duplicate_hermes_run",
        "hermesRunId is already stored on another AgentRun",
        now,
      );
      return { status: "failed", errorCode: "duplicate_hermes_run" };
    }
    throw error;
  }

  await enqueueHermesPollRun(db, run.id);
  return { status: "running", hermesRunId: outcome.runId };
}

async function startSchedulingRun(
  db: DbClient,
  run: QueuedProfileRun,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  fetchImpl: typeof fetch | undefined,
  now: Date,
): Promise<DispatchHermesCreateRunResult> {
  const appointmentId = asRecord(run.inputJson)?.appointmentId;
  if (typeof appointmentId !== "string" || !appointmentId.trim()) {
    await markFailed(db, run.id, "missing_appointment", "Scheduling run has no appointmentId", now);
    return { status: "failed", errorCode: "missing_appointment" };
  }
  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      timezone: true,
      guestName: true,
      guestEmail: true,
      assignedCuratorId: true,
      status: true,
    },
  });
  if (!appointment || appointment.status === "CANCELLED") {
    await markFailed(db, run.id, "missing_appointment", "Booked appointment was not found", now);
    return { status: "failed", errorCode: "missing_appointment" };
  }
  const curator = appointment.assignedCuratorId
    ? await db.user.findUnique({
        where: { id: appointment.assignedCuratorId },
        select: { name: true, email: true },
      })
    : null;
  const grant = await ensureCapabilityGrant(db, {
    agentRunId: run.id,
    conversationId: run.conversationId!,
    now,
  });
  const facts = [
    `appointment_id: ${appointment.id}`,
    `title: ${appointment.title}`,
    `startsAt: ${appointment.startsAt.toISOString()}`,
    `endsAt: ${appointment.endsAt.toISOString()}`,
    `timezone: ${appointment.timezone}`,
    `guest: ${appointment.guestName ?? ""} ${appointment.guestEmail ?? ""}`.trim(),
    `curator: ${curator ? `${curator.name} ${curator.email}` : "unknown"}`,
  ].join("\n");
  return publishHermesRun(
    db,
    run,
    {
      input: `Booked consultation ${appointment.id}`,
      session_id: run.id,
      instructions: schedulingRunInstructions(grant.id, facts),
    },
    env,
    fetchImpl,
    now,
  );
}

async function startOnboardingRun(
  db: DbClient,
  run: QueuedProfileRun,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  fetchImpl: typeof fetch | undefined,
  now: Date,
): Promise<DispatchHermesCreateRunResult> {
  const studentId = asRecord(run.inputJson)?.studentId;
  if (typeof studentId !== "string" || !studentId.trim()) {
    await markFailed(db, run.id, "missing_student", "Onboarding run has no studentId", now);
    return { status: "failed", errorCode: "missing_student" };
  }
  const context = await loadOnboardingContext(db, studentId, now);
  if (!context) {
    await markFailed(db, run.id, "missing_student", "Activated client was not found", now);
    return { status: "failed", errorCode: "missing_student" };
  }
  const grant = await ensureCapabilityGrant(db, {
    agentRunId: run.id,
    conversationId: run.conversationId!,
    now,
  });
  return publishHermesRun(
    db,
    run,
    {
      input: `Client activated ${context.studentId}`,
      session_id: run.id,
      instructions: onboardingRunInstructions(grant.id, context),
    },
    env,
    fetchImpl,
    now,
  );
}

export async function dispatchHermesCreateRun(
  db: DbClient,
  agentRunId: string,
  options?: {
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    now?: Date;
  },
): Promise<DispatchHermesCreateRunResult> {
  const env = options?.env ?? process.env;
  const now = options?.now ?? new Date();

  const run = await db.agentRun.findUnique({
    where: { id: agentRunId },
    select: {
      id: true,
      agentKey: true,
      status: true,
      hermesRunId: true,
      idempotencyKey: true,
      conversationId: true,
      inputJson: true,
    },
  });
  if (!run) throw new HermesRetryableError(`AgentRun ${agentRunId} not found`);
  if (run.hermesRunId) {
    if (run.status === "RUNNING") await enqueueHermesPollRun(db, run.id);
    return { status: "skipped", hermesRunId: run.hermesRunId };
  }
  if (run.status !== "QUEUED") return { status: "skipped", hermesRunId: null };
  if (!run.conversationId) {
    await markFailed(db, run.id, "missing_conversation", "AgentRun has no conversationId", now);
    return { status: "failed", errorCode: "missing_conversation" };
  }
  if (!isHermesProfileKey(run.agentKey)) {
    await markFailed(db, run.id, "unknown_profile", `No Hermes profile for ${run.agentKey}`, now);
    return { status: "failed", errorCode: "unknown_profile" };
  }

  readHermesProfileConfig(env, run.agentKey);

  if (run.agentKey === "scheduling") {
    return startSchedulingRun(db, run, env, options?.fetchImpl, now);
  }
  if (run.agentKey === "onboarding") {
    return startOnboardingRun(db, run, env, options?.fetchImpl, now);
  }

  const input = asRecord(run.inputJson);
  const messageId = typeof input?.messageId === "string" ? input.messageId : null;
  const conversation = await db.conversation.findUnique({
    where: { id: run.conversationId },
    select: {
      id: true,
      lead: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          locale: true,
          qualificationJson: true,
        },
      },
    },
  });
  if (!conversation) {
    throw new HermesRetryableError(`Conversation ${run.conversationId} not found`);
  }

  const message = messageId
    ? await db.conversationMessage.findFirst({
        where: { id: messageId, conversationId: conversation.id },
        select: { body: true },
      })
    : await db.conversationMessage.findFirst({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "desc" },
        select: { body: true },
      });

  const text = message?.body?.trim() ?? "";
  if (!text) {
    await markFailed(db, run.id, "empty_text", "Inbound message body is empty", now);
    return { status: "failed", errorCode: "empty_text" };
  }

  const history = await db.conversationMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: { direction: true, body: true },
  });
  const chronological = [...history].reverse();
  const transcript = formatChatTranscript(chronological.slice(-12));
  const remembered = chatFactsToSave(
    conversation.lead?.qualificationJson,
    chronological,
    LEAD_FACT_FIELDS,
  );
  let qualificationJson = conversation.lead?.qualificationJson;
  const leadId = conversation.lead?.id;
  const updateLead = (db as { lead?: { update?: DbClient["lead"]["update"] } }).lead?.update;
  if (leadId && updateLead && Object.keys(remembered).length > 0) {
    const current =
      qualificationJson && typeof qualificationJson === "object" && !Array.isArray(qualificationJson)
        ? qualificationJson
        : {};
    qualificationJson = { ...current, ...remembered };
    await updateLead({
      where: { id: leadId },
      data: { qualificationJson: qualificationJson as Prisma.InputJsonValue },
    });
  }

  // Fresh Hermes memory per message, so it does not copy its previous draft.
  // The transcript above is the conversation it should continue.
  const sessionId = run.id;

  const grant = await ensureCapabilityGrant(db, {
    agentRunId: run.id,
    conversationId: conversation.id,
    now,
  });
  const body: HermesCreateRunBody = {
    input: text,
    session_id: sessionId,
    instructions: hermesRunInstructions(
      grant.id,
      text,
      transcript,
      formatLeadCard(
        conversation.lead ? { ...conversation.lead, qualificationJson } : conversation.lead,
        chronological,
      ),
      explicitCuratorRequestCount(
        chronological.filter((message) => message.direction === "INBOUND"),
      ),
    ),
  };

  return publishHermesRun(db, run, body, env, options?.fetchImpl, now);
}

export function agentRunIdFromHermesEvent(payload: Prisma.JsonValue, aggregateId: string): string {
  const record = asRecord(payload);
  const fromPayload = record?.agentRunId;
  if (typeof fromPayload === "string" && fromPayload.trim()) return fromPayload;
  if (aggregateId.trim()) return aggregateId;
  throw new HermesRetryableError("hermes.create_run is missing agentRunId");
}
