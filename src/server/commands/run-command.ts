import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueOutbox, type EnqueueOutboxInput } from "./outbox";

export type CommandContext = {
  actorType: "USER" | "SYSTEM" | "AGENT" | "WEBHOOK";
  actorId?: string | null;
  correlationId: string;
  idempotencyKey?: string;
};

export type CommandResult<T = unknown> = {
  result: T;
  correlationId: string;
};

/**
 * Run a domain mutation inside a Prisma transaction and optionally enqueue
 * outbox events in the same transaction (transactional outbox).
 */
export async function runCommand<T>(
  context: CommandContext,
  handler: (tx: Prisma.TransactionClient, context: CommandContext) => Promise<{
    result: T;
    outbox?: EnqueueOutboxInput | EnqueueOutboxInput[];
  }>,
): Promise<CommandResult<T>> {
  const outcome = await prisma.$transaction(async (tx) => {
    const { result, outbox } = await handler(tx, context);
    const events = outbox ? (Array.isArray(outbox) ? outbox : [outbox]) : [];
    for (const event of events) {
      await enqueueOutbox(tx, event);
    }
    return result;
  });

  return { result: outcome, correlationId: context.correlationId };
}
