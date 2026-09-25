"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/server/auth/guards";
import {
  replayDeadOutboxEvent,
  setGlobalAutomationEnabled,
} from "@/server/commands/outbox";

export async function setAutomationEnabledAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);
  const enabledRaw = String(formData.get("enabled") ?? "").trim().toLowerCase();
  const enabled = enabledRaw === "true" || enabledRaw === "1" || enabledRaw === "on";
  const reason = String(formData.get("reason") ?? "").trim() || null;

  await setGlobalAutomationEnabled(prisma, {
    enabled,
    actorId: session.user.id,
    reason,
  });

  revalidatePath("/admin/automation");
}

export async function replayDeadLetterAction(formData: FormData) {
  await requireRole(["ADMIN"]);
  const eventId = String(formData.get("eventId") ?? "").trim();
  if (!eventId) {
    throw new Error("eventId is required");
  }

  const ok = await replayDeadOutboxEvent(prisma, eventId);
  if (!ok) {
    throw new Error("Dead-letter event not found or already replayed");
  }

  revalidatePath("/admin/automation");
}
