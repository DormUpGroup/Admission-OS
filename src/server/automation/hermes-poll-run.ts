import type { Prisma } from "@prisma/client";
import { enqueueOutbox, type DbClient } from "@/server/commands/outbox";
import { revokeCapabilityGrant } from "./capability-grant";
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
  },
): Promise<DispatchHermesPollRunResult> {
  const env = options?.env ?? process.env;
  const now = options?.now ?? new Date();
  const run = await db.agentRun.findUnique({
    where: { id: agentRunId },
    select: {
      id: true,
      status: true,
      hermesRunId: true,
      outputJson: true,
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

  const snapshot = await getHermesRun({
    env,
    runId: run.hermesRunId,
    fetchImpl: options?.fetchImpl,
  });

  if (snapshot.kind === "pending") {
    throw new HermesRunPendingError();
  }

  if (snapshot.kind === "terminal_http") {
    await finishRun(db, run.id, run.outputJson, {
      status: "FAILED",
      errorCode: `http_${snapshot.status}`,
      errorMessage: snapshot.message,
      now,
    });
    return { status: "failed", errorCode: `http_${snapshot.status}` };
  }

  if (snapshot.kind === "failed") {
    const errorCode = `hermes_${snapshot.status}`;
    await finishRun(db, run.id, run.outputJson, {
      status: "FAILED",
      errorCode,
      errorMessage: snapshot.message,
      now,
    });
    return { status: "failed", errorCode };
  }

  await finishRun(db, run.id, run.outputJson, {
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
