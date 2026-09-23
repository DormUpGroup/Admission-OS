"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { backendFetch, isBackendCapabilityEnabled } from "@/lib/backend-api";
import { requireRole, requireStaff } from "@/server/auth/guards";

function requireBackend() {
  if (!isBackendCapabilityEnabled("automation")) {
    throw new Error("Python automation API is not configured");
  }
}

async function expectOk(response: Response, message: string) {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { detail?: string }
      | null;
    throw new Error(payload?.detail ?? message);
  }
}

function commandHeaders(extra?: HeadersInit): HeadersInit {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": randomUUID(),
    ...extra,
  };
}

export async function setAutomationEnabledAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);
  requireBackend();
  const enabled = String(formData.get("enabled") || "") === "true";
  const response = await backendFetch(session.user, "/v1/automation/settings/global", {
    method: "PUT",
    headers: commandHeaders(),
    body: JSON.stringify({
      enabled,
      reason: String(formData.get("reason") || "") || null,
    }),
  });
  await expectOk(response, "Не удалось изменить режим автоматизации");
  revalidatePath("/admin/automation");
}

export async function decideAutomationApprovalAction(formData: FormData) {
  const session = await requireStaff();
  requireBackend();
  const approvalId = String(formData.get("approvalId") || "");
  const decision = String(formData.get("decision") || "");
  if (!approvalId || !["APPROVED", "REJECTED"].includes(decision)) return;
  const response = await backendFetch(
    session.user,
    `/v1/automation/approvals/${encodeURIComponent(approvalId)}/decision`,
    {
      method: "POST",
      headers: commandHeaders(),
      body: JSON.stringify({
        decision,
        note: String(formData.get("note") || "") || null,
      }),
    }
  );
  await expectOk(response, "Не удалось обработать согласование");
  revalidatePath("/admin/automation");
}

export async function pauseAutomationConversationAction(formData: FormData) {
  const session = await requireStaff();
  requireBackend();
  const conversationId = String(formData.get("conversationId") || "");
  if (!conversationId) return;
  const paused = String(formData.get("paused") || "") === "true";
  const response = await backendFetch(
    session.user,
    `/v1/automation/conversations/${encodeURIComponent(conversationId)}/pause`,
    {
      method: "PUT",
      headers: commandHeaders(),
      body: JSON.stringify({
        paused,
        reason: String(formData.get("reason") || "") || null,
      }),
    }
  );
  await expectOk(response, "Не удалось изменить режим разговора");
  revalidatePath("/admin/automation");
}

export async function updateAgentDefinitionAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);
  requireBackend();
  const agentKey = String(formData.get("agentKey") || "");
  if (!agentKey) return;
  const response = await backendFetch(
    session.user,
    `/v1/automation/agents/${encodeURIComponent(agentKey)}`,
    {
      method: "PUT",
      headers: commandHeaders(),
      body: JSON.stringify({
        enabled: String(formData.get("enabled") || "") === "true",
      }),
    }
  );
  await expectOk(response, "Не удалось изменить агента");
  revalidatePath("/admin/automation");
}

export async function requestLeadConversionAction(formData: FormData) {
  const session = await requireStaff();
  requireBackend();
  const leadId = String(formData.get("leadId") || "");
  if (!leadId) return;
  const response = await backendFetch(
    session.user,
    `/v1/automation/leads/${encodeURIComponent(leadId)}/request-conversion`,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
    }
  );
  await expectOk(response, "Не удалось создать согласование конверсии");
  revalidatePath("/admin/automation");
  revalidatePath(`/admin/automation/leads/${leadId}`);
}

export async function changeAgentRunAction(formData: FormData) {
  const session = await requireStaff();
  requireBackend();
  const runId = String(formData.get("runId") || "");
  const operation = String(formData.get("operation") || "");
  if (!runId || !["retry", "cancel"].includes(operation)) return;
  const response = await backendFetch(
    session.user,
    `/v1/automation/runs/${encodeURIComponent(runId)}/${operation}`,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
    }
  );
  await expectOk(response, "Не удалось изменить agent run");
  revalidatePath("/admin/automation");
}

export async function replayDeadLetterAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);
  requireBackend();
  const eventId = String(formData.get("eventId") || "");
  if (!eventId) return;
  const response = await backendFetch(
    session.user,
    `/v1/automation/outbox/${encodeURIComponent(eventId)}/replay`,
    {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
    }
  );
  await expectOk(response, "Не удалось повторить событие");
  revalidatePath("/admin/automation");
}
