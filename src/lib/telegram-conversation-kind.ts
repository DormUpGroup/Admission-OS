export type ConversationFolder = "chats" | "technical" | "trash";

/** `chats` is the students tab, `technical` is the leads tab. */
export const DEFAULT_CONVERSATION_FOLDER: ConversationFolder = "technical";

export type ConversationAudience = "lead" | "student";

/** Telegram first_name / lead titles from integration fixtures. */
export const FIXTURE_DISPLAY_NAMES = new Set([
  "test",
  "unk",
  "off",
  "start",
  "help",
  "inline test",
]);

/** Known test usernames from telegram unit fixtures. */
export const FIXTURE_USERNAMES = new Set([
  "tgtest",
  "tgunk",
  "tgstart",
  "tghelp",
  "tgoff",
  "inlinetest",
]);

/**
 * Parse a bot command from message text.
 * Supports `/start`, `/start@BotName`, `/help payload`, `/prices`.
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

/** Diagnostic probes (Diag / @diag_probe_user) stay out of the curator inbox. */
export function isTrashContact(contact: {
  title?: string | null;
  username?: string | null;
}): boolean {
  const title = (contact.title ?? "").trim().toLowerCase();
  if (title === "diag") return true;
  const username = (contact.username ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  if (!username) return false;
  return username === "diag_probe_user" || username.startsWith("diag_probe");
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
 *
 * `hasHumanInbound` is the full-history answer. The message list is only a
 * recent window and must not hide an older client reply.
 */
export function isTechnicalConversation(
  messages: Array<{ direction: string; body: string | null }>,
  contact?: { title?: string | null; username?: string | null },
  options?: { hasHumanInbound?: boolean },
): boolean {
  if (contact && isFixtureContact(contact)) return true;
  if (options?.hasHumanInbound != null) return !options.hasHumanInbound;
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

export function parseInboxFolderOverride(
  value: string | null | undefined,
): ConversationFolder | null {
  if (value === "chats" || value === "technical" || value === "trash") {
    return value;
  }
  return null;
}

/**
 * Leads and students come from the person, not from a hide button.
 * Trash is only probes, fixtures, and threads that never had a human reply.
 */
export function resolveConversationFolder(input: {
  messages: Array<{ direction: string; body: string | null }>;
  contact?: { title?: string | null; username?: string | null };
  hasHumanInbound?: boolean;
  inboxFolder?: string | null;
  audience?: ConversationAudience;
}): ConversationFolder {
  if (input.contact && isTrashContact(input.contact)) return "trash";
  if (parseInboxFolderOverride(input.inboxFolder) === "trash") return "trash";
  if (
    isTechnicalConversation(input.messages, input.contact, {
      hasHumanInbound: input.hasHumanInbound,
    })
  ) {
    return "trash";
  }
  if (input.audience === "student") return "chats";
  return "technical";
}

/** Trash returns to leads. Student status is not a folder move. */
export function folderMoveTarget(folder: ConversationFolder): {
  folder: ConversationFolder;
  label: string;
} {
  if (folder === "trash") {
    return { folder: "technical", label: "В лиды" };
  }
  return { folder: "technical", label: "В лиды" };
}

export function parseConversationFolder(
  value: string | undefined | null,
): ConversationFolder {
  if (value === "chats" || value === "technical" || value === "trash") return value;
  return DEFAULT_CONVERSATION_FOLDER;
}
