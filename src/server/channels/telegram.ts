import { createHash } from "crypto";

export type TelegramAttachment = {
  kind: "document" | "photo";
  providerFileId?: string;
  filename?: string;
  mimeType?: string;
};

export type NormalizedTelegramMessage = {
  kind: "message";
  providerEventId: string;
  providerMessageId: string;
  externalUserId: string;
  externalChatId: string;
  username: string | null;
  displayName: string | null;
  text: string;
  attachments: TelegramAttachment[];
};

export type NormalizedTelegramCallback = {
  kind: "callback";
  providerEventId: string;
  callbackQueryId: string;
  providerMessageId: string | null;
  externalUserId: string;
  externalChatId: string;
  username: string | null;
  displayName: string | null;
  data: string;
};

export type NormalizedTelegramUpdate =
  | NormalizedTelegramMessage
  | NormalizedTelegramCallback;

/**
 * Normalize a Telegram Bot API Update into a channel-agnostic inbound message
 * or appointment callback. Returns null for updates we ignore.
 */
export function normalizeTelegramUpdate(
  payload: unknown,
): NormalizedTelegramUpdate | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const update = payload as Record<string, unknown>;
  const updateId = update.update_id;
  if (updateId == null) return null;

  const callback = update.callback_query as Record<string, unknown> | undefined;
  if (callback && typeof callback === "object") {
    return normalizeCallback(updateId, callback);
  }

  const message =
    (update.message as Record<string, unknown> | undefined) ??
    (update.edited_message as Record<string, unknown> | undefined);
  if (!message || typeof message !== "object") return null;

  const sender = message.from;
  const chat = message.chat;
  if (!sender || typeof sender !== "object" || Array.isArray(sender)) return null;
  if (!chat || typeof chat !== "object" || Array.isArray(chat)) return null;

  const senderObj = sender as Record<string, unknown>;
  const chatObj = chat as Record<string, unknown>;
  const senderId = senderObj.id;
  const chatId = chatObj.id;
  const messageId = message.message_id;
  if (senderId == null || chatId == null || messageId == null) return null;

  const firstName = String(senderObj.first_name ?? "").trim();
  const lastName = String(senderObj.last_name ?? "").trim();
  const displayName =
    [firstName, lastName].filter(Boolean).join(" ").trim() || null;

  const attachments: TelegramAttachment[] = [];
  const document = message.document;
  if (document && typeof document === "object" && !Array.isArray(document)) {
    const doc = document as Record<string, unknown>;
    attachments.push({
      kind: "document",
      providerFileId: doc.file_id != null ? String(doc.file_id) : undefined,
      filename: doc.file_name != null ? String(doc.file_name) : undefined,
      mimeType: doc.mime_type != null ? String(doc.mime_type) : undefined,
    });
  }
  const photo = message.photo;
  if (Array.isArray(photo) && photo.length > 0) {
    const last = photo[photo.length - 1] as Record<string, unknown>;
    attachments.push({
      kind: "photo",
      providerFileId: last.file_id != null ? String(last.file_id) : undefined,
    });
  }

  return {
    kind: "message",
    providerEventId: String(updateId),
    providerMessageId: String(messageId),
    externalUserId: String(senderId),
    externalChatId: String(chatId),
    username: senderObj.username != null ? String(senderObj.username) : null,
    displayName,
    text: String(message.text ?? message.caption ?? "").trim(),
    attachments,
  };
}

function normalizeCallback(
  updateId: unknown,
  callback: Record<string, unknown>,
): NormalizedTelegramCallback | null {
  const callbackId = callback.id;
  const data = String(callback.data ?? "").trim();
  if (callbackId == null || !data) return null;

  const sender = callback.from;
  if (!sender || typeof sender !== "object" || Array.isArray(sender)) return null;
  const senderObj = sender as Record<string, unknown>;
  const senderId = senderObj.id;
  if (senderId == null) return null;

  const message = callback.message as Record<string, unknown> | undefined;
  const chat = message?.chat as Record<string, unknown> | undefined;
  const chatId = chat?.id ?? null;
  if (chatId == null) return null;

  const firstName = String(senderObj.first_name ?? "").trim();
  const lastName = String(senderObj.last_name ?? "").trim();
  const displayName =
    [firstName, lastName].filter(Boolean).join(" ").trim() || null;

  return {
    kind: "callback",
    providerEventId: String(updateId),
    callbackQueryId: String(callbackId),
    providerMessageId:
      message?.message_id != null ? String(message.message_id) : null,
    externalUserId: String(senderId),
    externalChatId: String(chatId),
    username: senderObj.username != null ? String(senderObj.username) : null,
    displayName,
    data,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`;
}

/** Canonical hash with sorted keys for InboxEvent.payloadHash. */
export function hashJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

/** Parse appointment callback_data: a:{id}:{token}:{action}[:slotKey] */
export function parseAppointmentCallbackData(data: string): {
  appointmentId: string;
  token: string;
  action: "ok" | "alt" | "x" | "s";
  slotKey?: string;
} | null {
  const parts = data.split(":");
  if (parts[0] !== "a" || parts.length < 4) return null;
  const appointmentId = parts[1];
  const token = parts[2];
  const action = parts[3];
  if (!appointmentId || !token) return null;
  if (action === "ok" || action === "alt" || action === "x") {
    return { appointmentId, token, action };
  }
  if (action === "s" && parts[4]) {
    return { appointmentId, token, action: "s", slotKey: parts.slice(4).join(":") };
  }
  return null;
}
