import { prisma } from "@/lib/db";

const APPOINTMENT_COUNT_CACHE_MS = 15_000;
let appointmentCountCache: { at: number; value: number } | null = null;

/** Consultations the client changed and staff has not opened yet. */
export async function countUnseenAppointmentEvents(): Promise<number> {
  const now = Date.now();
  if (
    appointmentCountCache &&
    now - appointmentCountCache.at < APPOINTMENT_COUNT_CACHE_MS
  ) {
    return appointmentCountCache.value;
  }
  const value = await prisma.appointment.count({
    where: {
      clientChangeUnseen: true,
      status: { not: "CANCELLED" },
    },
  });
  appointmentCountCache = { at: now, value };
  return value;
}
