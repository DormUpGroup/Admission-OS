export type ConversationFolder = "chats" | "technical";

/** Telegram first_name / lead titles from integration fixtures. */
const FIXTURE_DISPLAY_NAMES = new Set([
  "test",
  "unk",
  "off",
  "start",
  "help",
]);

/** Known test usernames from telegram unit fixtures. */
const FIXTURE_USERNAMES = new Set([
  "tgtest",
  "tgunk",
  "tgstart",
  "tghelp",
  "tgoff",
]);

/**
 * Parse a bot command from message text.
 * Supports `/start`, `/start@BotName`, `/help payload`.
 */
export function parseTelegramBotCommand(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const token = trimmed.split(/\s+/, 1)[0] ?? "";
  const withoutAt = token.slice(1).split("@", 1)[0] ?? "";
  const command = withoutAt.toLowerCase();
  return command.length > 0 ? command : null;
}

export function isBotCommandBody(body: string | null | undefined): boolean {
  if (!body?.trim()) return false;
  return parseTelegramBotCommand(body) !== null;
}

export function isFixtureContact(contact: {
  title?: string | null;
  username?: string | null;
}): boolean {
  const title = (contact.title ?? "").trim().toLowerCase();
  if (title && FIXTURE_DISPLAY_NAMES.has(title)) return true;
  const username = (contact.username ?? "").trim().toLowerCase();
  if (username && FIXTURE_USERNAMES.has(username)) return true;
  return false;
}

/**
 * Technical = fixture contact, or no human inbound yet
 * (empty inbound, or every inbound is a bot command).
 */
export function isTechnicalConversation(
  messages: Array<{ direction: string; body: string | null }>,
  contact?: { title?: string | null; username?: string | null },
): boolean {
  if (contact && isFixtureContact(contact)) return true;
  const inbound = messages.filter((m) => m.direction === "INBOUND");
  if (inbound.length === 0) return true;
  return inbound.every((m) => isBotCommandBody(m.body));
}

/** Prefer last non-command message for sidebar preview; fall back to last message. */
export function pickPreviewMessage<
  T extends { direction: string; body: string | null; createdAt: Date },
>(messages: T[]): T | null {
  if (messages.length === 0) return null;
  const sorted = [...messages].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  return sorted.find((m) => !isBotCommandBody(m.body)) ?? sorted[0] ?? null;
}

export function parseConversationFolder(
  value: string | undefined | null,
): ConversationFolder {
  return value === "technical" ? "technical" : "chats";
}
