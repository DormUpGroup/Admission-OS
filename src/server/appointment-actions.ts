"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/server/auth/guards";
import {
  appointmentCancel,
  appointmentCreate,
  appointmentReschedule,
} from "@/server/commands/appointments";

export type CreateAppointmentState = { error: string } | null;

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest: unknown }).digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

function appointmentFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "Exactly one of leadId or studentId is required") {
    return "Укажите ровно одного: клиента (лида) или студента.";
  }
  if (message === "The selected slot is no longer available") {
    return "Это время уже занято.";
  }
  if (
    message === "Invalid startsAt" ||
    message === "Invalid endsAt" ||
    message === "endsAt must be after startsAt"
  ) {
    return "Укажите интервал: конец должен быть позже начала.";
  }
  return "Не удалось создать консультацию.";
}

export async function createAppointmentAction(
  _prev: CreateAppointmentState,
  formData: FormData,
): Promise<CreateAppointmentState> {
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

  if ((leadId == null) === (studentId == null)) {
    return {
      error: "Укажите ровно одного: клиента (лида) или студента.",
    };
  }

  const startsAt = new Date(startsAtRaw);
  const endsAt = new Date(endsAtRaw);
  if (
    !startsAtRaw ||
    !endsAtRaw ||
    Number.isNaN(startsAt.getTime()) ||
    Number.isNaN(endsAt.getTime()) ||
    endsAt <= startsAt
  ) {
    return { error: "Укажите интервал: конец должен быть позже начала." };
  }

  try {
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
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const errorMessage = appointmentFailureMessage(error);
    if (errorMessage === "Не удалось создать консультацию.") {
      console.error(error);
    }
    return { error: errorMessage };
  }

  revalidatePath("/admin/appointments");
  return null;
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
