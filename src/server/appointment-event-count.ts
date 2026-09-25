import { prisma } from "@/lib/db";

/** Consultations the client changed and staff has not opened yet. */
export async function countUnseenAppointmentEvents(): Promise<number> {
  return prisma.appointment.count({
    where: {
      clientChangeUnseen: true,
      status: { not: "CANCELLED" },
    },
  });
}
