import { prisma } from "@/lib/db";

/** Latest call-form email wins. Lead email is only a fallback. */
export function consultationContactEmail(input: {
  appointmentEmails: Array<string | null | undefined>;
  leadEmail?: string | null;
}): string | null {
  for (const value of input.appointmentEmails) {
    const email = value?.trim().toLowerCase();
    if (email) return email;
  }
  const leadEmail = input.leadEmail?.trim().toLowerCase();
  return leadEmail || null;
}

export function isDeliverableStudentEmail(email: string): boolean {
  return !email.endsWith("@leads.immigrome.invalid");
}

export async function resolveConsultationEmail(leadId: string): Promise<string | null> {
  const [appointments, lead] = await Promise.all([
    prisma.appointment.findMany({
      where: { leadId },
      orderBy: { createdAt: "desc" },
      select: { guestEmail: true },
    }),
    prisma.lead.findUnique({
      where: { id: leadId },
      select: { email: true },
    }),
  ]);
  const email = consultationContactEmail({
    appointmentEmails: appointments.map((row) => row.guestEmail),
    leadEmail: lead?.email,
  });
  if (!email || !isDeliverableStudentEmail(email)) return null;
  return email;
}
