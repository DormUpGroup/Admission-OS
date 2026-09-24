"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/server/auth/guards";
import {
  appointmentCancel,
  appointmentCreate,
  appointmentReschedule,
} from "@/server/commands/appointments";

export async function createAppointmentAction(formData: FormData) {
  const session = await requireStaff();
  const leadId = String(formData.get("leadId") ?? "").trim() || null;
  const studentId = String(formData.get("studentId") ?? "").trim() || null;
  const conversationId =
    String(formData.get("conversationId") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim() || "Консультация";
  const timezone =
    String(formData.get("timezone") ?? "").trim() || "Europe/Rome";
  const startsAtRaw = String(formData.get("startsAt") ?? "").trim();
  const endsAtRaw = String(formData.get("endsAt") ?? "").trim();
  const clientRequestId =
    String(formData.get("clientRequestId") ?? "").trim() ||
    `admin-appt:${session.user.id}:${Date.now()}`;

  const startsAt = new Date(startsAtRaw);
  const endsAt = new Date(endsAtRaw);

  await appointmentCreate({
    clientRequestId,
    leadId,
    studentId,
    conversationId,
    assignedCuratorId: session.user.id,
    title,
    startsAt,
    endsAt,
    timezone,
  });

  revalidatePath("/admin/appointments");
}

export async function rescheduleAppointmentAction(formData: FormData) {
  await requireStaff();
  const appointmentId = String(formData.get("appointmentId") ?? "").trim();
  const startsAt = new Date(String(formData.get("startsAt") ?? "").trim());
  const endsAt = new Date(String(formData.get("endsAt") ?? "").trim());
  const timezone =
    String(formData.get("timezone") ?? "").trim() || undefined;
  const title = String(formData.get("title") ?? "").trim() || undefined;

  await appointmentReschedule({
    appointmentId,
    startsAt,
    endsAt,
    timezone,
    title,
  });
  revalidatePath("/admin/appointments");
}

export async function cancelAppointmentAction(formData: FormData) {
  await requireStaff();
  const appointmentId = String(formData.get("appointmentId") ?? "").trim();
  await appointmentCancel(appointmentId);
  revalidatePath("/admin/appointments");
}
