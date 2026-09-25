"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/server/auth/guards";
import {
  appointmentCancel,
  appointmentConfirmManual,
  appointmentCreate,
  appointmentProposeReschedule,
} from "@/server/commands/appointments";
import { endsAtFromStart } from "@/server/services/appointments/slots";

export type AppointmentActionState = { error: string } | { ok: true } | null;

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
    return "Укажите корректный слот.";
  }
  if (message.startsWith("Cannot confirm")) {
    return "Не удалось подтвердить запись.";
  }
  return "Не удалось сохранить консультацию.";
}

export async function createAppointmentAction(
  _prev: AppointmentActionState,
  formData: FormData,
): Promise<AppointmentActionState> {
  const session = await requireStaff();
  const leadId = String(formData.get("leadId") ?? "").trim() || null;
  const studentId = String(formData.get("studentId") ?? "").trim() || null;
  const conversationId =
    String(formData.get("conversationId") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim() || "Консультация";
  const timezone =
    String(formData.get("timezone") ?? "").trim() || "Europe/Rome";
  const startsAtRaw = String(formData.get("startsAt") ?? "").trim();
  const clientRequestId =
    String(formData.get("clientRequestId") ?? "").trim() ||
    `admin-appt:${session.user.id}:${Date.now()}`;

  if ((leadId == null) === (studentId == null)) {
    return {
      error: "Укажите ровно одного: клиента (лида) или студента.",
    };
  }

  const startsAt = new Date(startsAtRaw);
  if (!startsAtRaw || Number.isNaN(startsAt.getTime())) {
    return { error: "Выберите день и время." };
  }
  const endsAt = endsAtFromStart(startsAt);

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
    if (errorMessage === "Не удалось сохранить консультацию.") {
      console.error(error);
    }
    return { error: errorMessage };
  }

  revalidatePath("/admin/appointments");
  return { ok: true };
}

export async function proposeRescheduleAppointmentAction(
  _prev: AppointmentActionState,
  formData: FormData,
): Promise<AppointmentActionState> {
  await requireStaff();
  const appointmentId = String(formData.get("appointmentId") ?? "").trim();
  const startsAtRaw = String(formData.get("startsAt") ?? "").trim();
  const startsAt = new Date(startsAtRaw);
  if (!appointmentId || !startsAtRaw || Number.isNaN(startsAt.getTime())) {
    return { error: "Выберите новое время." };
  }

  try {
    await appointmentProposeReschedule({
      appointmentId,
      startsAt,
      endsAt: endsAtFromStart(startsAt),
    });
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return { error: appointmentFailureMessage(error) };
  }

  revalidatePath("/admin/appointments");
  return { ok: true };
}

export async function confirmAppointmentManualAction(formData: FormData) {
  await requireStaff();
  const appointmentId = String(formData.get("appointmentId") ?? "").trim();
  await appointmentConfirmManual(appointmentId);
  revalidatePath("/admin/appointments");
}

export async function cancelAppointmentAction(formData: FormData) {
  await requireStaff();
  const appointmentId = String(formData.get("appointmentId") ?? "").trim();
  await appointmentCancel(appointmentId);
  revalidatePath("/admin/appointments");
}
