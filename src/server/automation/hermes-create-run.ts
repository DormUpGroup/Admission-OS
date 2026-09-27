import type { Prisma } from "@prisma/client";
import { enqueueOutbox, type DbClient } from "@/server/commands/outbox";
import {
  HermesRetryableError,
  postHermesCreateRun,
  readHermesConfig,
  resolveMcpUrl,
  signCapabilityJwt,
  CAPABILITY_JWT_TTL_SECONDS,
  type HermesCreateRunBody,
} from "./hermes-client";
import { AGENT_DEFINITIONS_BY_KEY, type AgentKey } from "./registry";

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

/** Backfill QUEUED intake runs that never received a hermes.create_run event. */
export async function enqueueQueuedHermesCreateRuns(
  db: DbClient,
  limit: number,
): Promise<number> {
  const runs = await db.agentRun.findMany({
    where: {
      agentKey: "intake",
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
  if (run.hermesRunId) return { status: "skipped", hermesRunId: run.hermesRunId };
  if (run.status !== "QUEUED") return { status: "skipped", hermesRunId: null };
  if (!run.conversationId) {
    await markFailed(db, run.id, "missing_conversation", "AgentRun has no conversationId", now);
    return { status: "failed", errorCode: "missing_conversation" };
  }

  readHermesConfig(env);

  const input = asRecord(run.inputJson);
  const messageId = typeof input?.messageId === "string" ? input.messageId : null;
  const conversation = await db.conversation.findUnique({
    where: { id: run.conversationId },
    select: { id: true, hermesSessionId: true },
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

  const sessionId = conversation.hermesSessionId?.trim() || conversation.id;
  if (!conversation.hermesSessionId?.trim()) {
    await db.conversation.update({
      where: { id: conversation.id },
      data: { hermesSessionId: sessionId },
    });
  }

  const text = message?.body?.trim() ?? "";
  if (!text) {
    await markFailed(db, run.id, "empty_text", "Inbound message body is empty", now);
    return { status: "failed", errorCode: "empty_text" };
  }

  const spec = AGENT_DEFINITIONS_BY_KEY.get(run.agentKey as AgentKey);
  const { mcpKey } = readHermesConfig(env);
  const body: HermesCreateRunBody = {
    agent_run_id: run.id,
    agent_key: run.agentKey,
    conversation_id: conversation.id,
    session_id: sessionId,
    text,
    mcp_url: resolveMcpUrl(env),
    capability_jwt: signCapabilityJwt(
      {
        agent_run_id: run.id,
        conversation_id: conversation.id,
        allowed_tools: [...(spec?.allowedTools ?? [])],
        exp: Math.floor(now.getTime() / 1000) + CAPABILITY_JWT_TTL_SECONDS,
      },
      mcpKey,
    ),
  };

  const outcome = await postHermesCreateRun({
    env,
    body,
    idempotencyKey: run.idempotencyKey,
    fetchImpl: options?.fetchImpl,
  });

  if (outcome.kind === "terminal") {
    await markFailed(db, run.id, `http_${outcome.status}`, outcome.message, now);
    return { status: "failed", errorCode: `http_${outcome.status}` };
  }

  const hermesSessionId = outcome.sessionId ?? sessionId;
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
      if (current?.hermesRunId) return { status: "running", hermesRunId: current.hermesRunId };
      return { status: "skipped", hermesRunId: null };
    }
  } catch (error) {
    if (isUniqueConstraint(error)) {
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

  if (outcome.sessionId && outcome.sessionId !== sessionId) {
    await db.conversation.update({
      where: { id: conversation.id },
      data: { hermesSessionId: outcome.sessionId },
    });
  }

  return { status: "running", hermesRunId: outcome.runId };
}

export function agentRunIdFromHermesEvent(payload: Prisma.JsonValue, aggregateId: string): string {
  const record = asRecord(payload);
  const fromPayload = record?.agentRunId;
  if (typeof fromPayload === "string" && fromPayload.trim()) return fromPayload;
  if (aggregateId.trim()) return aggregateId;
  throw new HermesRetryableError("hermes.create_run is missing agentRunId");
}
