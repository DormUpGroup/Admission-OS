import type { Prisma } from "@prisma/client";
import { enqueueOutbox, type DbClient } from "@/server/commands/outbox";
import { revokeCapabilityGrant } from "./capability-grant";
import { hasLaterInboundMessage, messageIdFromRunInput } from "./client-burst";
import { commitBookedConsultation, commitSchedulingRunCalendar } from "./commit-consultation";
import { sendUnsentRunDraft } from "./deliver-draft";
import {
  getHermesRun,
  HermesRetryableError,
  HermesRunPendingError,
} from "./hermes-client";

export const HERMES_POLL_RUN_EVENT = "hermes.poll_run";

export function hermesPollRunIdempotencyKey(agentRunId: string): string {
  return `hermes.poll_run:${agentRunId}`;
}

export async function enqueueHermesPollRun(db: DbClient, agentRunId: string): Promise<void> {
  await enqueueOutbox(db, {
    aggregateType: "AgentRun",
    aggregateId: agentRunId,
    eventType: HERMES_POLL_RUN_EVENT,
    payload: { agentRunId },
    idempotencyKey: hermesPollRunIdempotencyKey(agentRunId),
  });
}

export type DispatchHermesPollRunResult =
  | { status: "completed" }
  | { status: "failed"; errorCode: string }
  | { status: "skipped" };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function dispatchHermesPollRun(
  db: DbClient,
  agentRunId: string,
  options?: {
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    now?: Date;
    deliverDraft?: typeof sendUnsentRunDraft;
  },
): Promise<DispatchHermesPollRunResult> {
  const env = options?.env ?? process.env;
  const now = options?.now ?? new Date();
  const deliverDraft = options?.deliverDraft ?? sendUnsentRunDraft;
  const run = await db.agentRun.findUnique({
    where: { id: agentRunId },
    select: {
      id: true,
      agentKey: true,
      status: true,
      hermesRunId: true,
      conversationId: true,
      startedAt: true,
      outputJson: true,
      inputJson: true,
    },
  });
  if (!run) throw new HermesRetryableError(`AgentRun ${agentRunId} not found`);
  if (run.status === "COMPLETED" || run.status === "FAILED") {
    await revokeCapabilityGrant(db, run.id, now);
    return { status: "skipped" };
  }
  if (!run.hermesRunId) {
    throw new HermesRetryableError(`AgentRun ${agentRunId} has no hermesRunId`);
  }

  const triggerMessageId = messageIdFromRunInput(run.inputJson);
  if (
    run.agentKey === "intake" &&
    run.conversationId &&
    triggerMessageId &&
    (await hasLaterInboundMessage(db, {
      conversationId: run.conversationId,
      messageId: triggerMessageId,
    }))
  ) {
    await finishRun(db, run.id, run.outputJson, {
      status: "COMPLETED",
      errorCode: "later_client_message",
      errorMessage: "A newer client message is answered instead",
      now,
    });
    return { status: "skipped" };
  }

  const snapshot = await getHermesRun({
    env,
    agentKey: run.agentKey,
    runId: run.hermesRunId,
    fetchImpl: options?.fetchImpl,
  });

  if (snapshot.kind === "pending") {
    throw new HermesRunPendingError();
  }

  if (snapshot.kind === "terminal_http" || snapshot.kind === "failed") {
    const outputJson = await commitSchedulingRunCalendar(db, run);
    const errorCode =
      snapshot.kind === "terminal_http" ? `http_${snapshot.status}` : `hermes_${snapshot.status}`;
    await finishRun(db, run.id, outputJson, {
      status: "FAILED",
      errorCode,
      errorMessage: snapshot.message,
      now,
    });
    return { status: "failed", errorCode };
  }

  let outputJson = run.outputJson;
  if (run.agentKey === "scheduling" && asRecord(outputJson)?.consultationCommitted !== true) {
    const appointmentId = asRecord(run.inputJson)?.appointmentId;
    if (typeof appointmentId !== "string" || !appointmentId.trim()) {
      await finishRun(db, run.id, outputJson, {
        status: "FAILED",
        errorCode: "missing_appointment",
        errorMessage: "Scheduling run finished without an appointment",
        hermesOutput: snapshot.output,
        inputTokens: snapshot.inputTokens,
        outputTokens: snapshot.outputTokens,
        now,
      });
      return { status: "failed", errorCode: "missing_appointment" };
    }
    const committed = await commitBookedConsultation(db, {
      appointmentId,
      agentRunId: run.id,
    });
    if (committed.status !== "committed") {
      await finishRun(db, run.id, outputJson, {
        status: "FAILED",
        errorCode: committed.status,
        errorMessage: "Booked consultation could not be written to the calendar",
        hermesOutput: snapshot.output,
        inputTokens: snapshot.inputTokens,
        outputTokens: snapshot.outputTokens,
        now,
      });
      return { status: "failed", errorCode: committed.status };
    }
    outputJson = {
      ...(asRecord(outputJson) ?? {}),
      consultationCommitted: true,
      appointmentId,
    };
  }

  if (run.agentKey === "intake" && run.conversationId) {
    await deliverDraft(db, {
      agentRunId: run.id,
      conversationId: run.conversationId,
      outputJson,
      startedAt: run.startedAt,
      messageId: messageIdFromRunInput(run.inputJson),
    });
  }

  await finishRun(db, run.id, outputJson, {
    status: "COMPLETED",
    errorCode: null,
    errorMessage: null,
    hermesOutput: snapshot.output,
    inputTokens: snapshot.inputTokens,
    outputTokens: snapshot.outputTokens,
    now,
  });
  return { status: "completed" };
}

async function finishRun(
  db: DbClient,
  agentRunId: string,
  outputJson: Prisma.JsonValue | null,
  input: {
    status: "COMPLETED" | "FAILED";
    errorCode: string | null;
    errorMessage: string | null;
    hermesOutput?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    now: Date;
  },
): Promise<void> {
  const existing = asRecord(outputJson) ?? {};
  const nextOutput: Record<string, unknown> = { ...existing };
  if (input.hermesOutput !== undefined) nextOutput.hermesOutput = input.hermesOutput;

  await db.agentRun.updateMany({
    where: { id: agentRunId, status: "RUNNING" },
    data: {
      status: input.status,
      completedAt: input.now,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage?.slice(0, 4000) ?? null,
      outputJson: nextOutput as Prisma.InputJsonValue,
      ...(input.inputTokens != null ? { inputTokens: input.inputTokens } : {}),
      ...(input.outputTokens != null ? { outputTokens: input.outputTokens } : {}),
    },
  });
  await revokeCapabilityGrant(db, agentRunId, input.now);
}
