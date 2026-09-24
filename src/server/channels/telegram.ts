import { createHash } from "crypto";

export type TelegramAttachment = {
  kind: "document" | "photo";
  providerFileId?: string;
  filename?: string;
  mimeType?: string;
};

export type NormalizedTelegramMessage = {
  providerEventId: string;
  providerMessageId: string;
  externalUserId: string;
  externalChatId: string;
  username: string | null;
  displayName: string | null;
  text: string;
  attachments: TelegramAttachment[];
};

/**
 * Normalize a Telegram Bot API Update into a channel-agnostic inbound message.
 * Returns null for updates we ignore (no message, missing ids, etc.).
 */
export function normalizeTelegramUpdate(
  payload: unknown,
): NormalizedTelegramMessage | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const update = payload as Record<string, unknown>;
  const updateId = update.update_id;
  const message =
    (update.message as Record<string, unknown> | undefined) ??
    (update.edited_message as Record<string, unknown> | undefined);
  if (updateId == null || !message || typeof message !== "object") {
    return null;
  }

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
