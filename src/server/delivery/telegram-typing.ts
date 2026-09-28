import type { Prisma } from "@prisma/client";
import type { DbClient } from "@/server/commands/outbox";
import { getGlobalAutomationSetting } from "@/server/commands/outbox";
import { isTelegramBotCommand } from "@/server/automation/runs";

/** Telegram clears the typing indicator after about 5 seconds. */
export const TELEGRAM_TYPING_REFRESH_MS = 4_000;

export function typingRefreshDue(lastSentAt: number | null, now: number): boolean {
  return lastSentAt == null || now - lastSentAt >= TELEGRAM_TYPING_REFRESH_MS;
}

/** True when this inbound message will wait on Hermes instead of an immediate reply. */
export function shouldShowIntakeTyping(input: {
  text: string;
  automationEnabled: boolean;
  automationPaused: boolean;
  isLeadConversation: boolean;
}): boolean {
  if (!input.automationEnabled) return false;
  if (input.automationPaused) return false;
  if (!input.isLeadConversation) return false;
  if (isTelegramBotCommand(input.text)) return false;
  return true;
}

function metaChatId(metadata: Prisma.JsonValue | null | undefined): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const chatId = (metadata as { chat_id?: unknown }).chat_id;
  return chatId != null && String(chatId).trim() ? String(chatId) : null;
}

export async function telegramChatIdForConversation(
  db: DbClient,
  conversationId: string,
): Promise<string | null> {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { leadId: true, studentId: true },
  });
  if (!conversation || (!conversation.leadId && !conversation.studentId)) return null;
  const identity = await db.channelIdentity.findFirst({
    where: {
      channel: "TELEGRAM",
      OR: [
        ...(conversation.leadId ? [{ leadId: conversation.leadId }] : []),
        ...(conversation.studentId ? [{ studentId: conversation.studentId }] : []),
      ],
    },
    orderBy: { updatedAt: "desc" },
    select: { metadataJson: true },
  });
  return metaChatId(identity?.metadataJson);
}

export async function sendTelegramTyping(
  chatId: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const id = chatId.trim();
  if (!token || !id) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: id, action: "typing" }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Webhook path. Uses the shared DB kill-switch. The worker process owns
 * AUTOMATION_ENABLED, so the web process does not require that env var.
 */
export async function maybeSendIntakeTyping(input: {
  db: DbClient;
  conversationId: string;
  chatId: string;
  text: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): Promise<void> {
  const [automation, conversation] = await Promise.all([
    getGlobalAutomationSetting(input.db),
    input.db.conversation.findUnique({
      where: { id: input.conversationId },
      select: { automationPausedAt: true, leadId: true, studentId: true },
    }),
  ]);
  if (!conversation) return;
  if (
    !shouldShowIntakeTyping({
      text: input.text,
      automationEnabled: automation.enabled,
      automationPaused: Boolean(conversation.automationPausedAt),
      isLeadConversation: Boolean(conversation.leadId) && !conversation.studentId,
    })
  ) {
    return;
  }
  await sendTelegramTyping(input.chatId, input.env);
}

/** Worker path. Refreshes typing while a Hermes poll is still pending. */
export async function refreshHermesTyping(
  db: DbClient,
  agentRunId: string,
  lastSentAt: Map<string, number>,
  now = Date.now(),
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const run = await db.agentRun.findUnique({
    where: { id: agentRunId },
    select: { conversationId: true },
  });
  const conversationId = run?.conversationId;
  if (!conversationId) return;
  if (!typingRefreshDue(lastSentAt.get(conversationId) ?? null, now)) return;
  const chatId = await telegramChatIdForConversation(db, conversationId);
  if (!chatId) return;
  lastSentAt.set(conversationId, now);
  await sendTelegramTyping(chatId, env, fetchImpl);
}
