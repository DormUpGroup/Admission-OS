import type { Prisma } from "@prisma/client";
import { enqueueOutbox, type DbClient } from "@/server/commands/outbox";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export type CommitConsultationResult =
  | { status: "committed" }
  | { status: "missing" }
  | { status: "cancelled" };

/**
 * Enqueue the existing calendar write for a slot the client already chose.
 * The time is the Appointment row. Google Calendar creates Meet and emails attendees.
 */
export async function commitBookedConsultation(
  db: DbClient,
  input: { appointmentId: string; agentRunId?: string | null },
): Promise<CommitConsultationResult> {
  const appointmentId = input.appointmentId.trim();
  if (!appointmentId) return { status: "missing" };

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, status: true, version: true },
  });
  if (!appointment) return { status: "missing" };
  if (appointment.status === "CANCELLED") return { status: "cancelled" };

  await enqueueOutbox(db, {
    aggregateType: "Appointment",
    aggregateId: appointment.id,
    eventType: "calendar.upsert",
    payload: { appointmentId: appointment.id },
    idempotencyKey: `calendar.upsert:${appointment.id}:v${appointment.version}`,
  });

  if (input.agentRunId) {
    const run = await db.agentRun.findUnique({
      where: { id: input.agentRunId },
      select: { outputJson: true },
    });
    const existing = asRecord(run?.outputJson) ?? {};
    await db.agentRun.update({
      where: { id: input.agentRunId },
      data: {
        outputJson: {
          ...existing,
          consultationCommitted: true,
          appointmentId: appointment.id,
        } as Prisma.InputJsonValue,
      },
    });
  }

  return { status: "committed" };
}

/**
 * A scheduling run that ended without the tool still owes the calendar write.
 * Retryable Hermes errors must not call this. Missing and cancelled appointments enqueue nothing.
 */
export async function commitSchedulingRunCalendar(
  db: DbClient,
  run: {
    id: string;
    agentKey: string;
    inputJson: unknown;
    outputJson: Prisma.JsonValue | null;
  },
): Promise<Prisma.JsonValue | null> {
  if (run.agentKey !== "scheduling") return run.outputJson;
  const current = asRecord(run.outputJson);
  if (current?.consultationCommitted === true) return run.outputJson;

  const appointmentId = asRecord(run.inputJson)?.appointmentId;
  if (typeof appointmentId !== "string" || !appointmentId.trim()) return run.outputJson;

  const committed = await commitBookedConsultation(db, {
    appointmentId,
    agentRunId: run.id,
  });
  if (committed.status !== "committed") return run.outputJson;

  return {
    ...(current ?? {}),
    consultationCommitted: true,
    appointmentId: appointmentId.trim(),
  } as Prisma.JsonValue;
}
