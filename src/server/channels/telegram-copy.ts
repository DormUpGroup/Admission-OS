/** Immigrome Telegram bot copy (RU). No emoji spam, no "AI assistant". */

export const TELEGRAM_WELCOME_TEXT = [
  "Здравствуйте. Вы на связи с Immigrome — мы сопровождаем поступление в вузы Италии.",
  "",
  "Напишите куратору ваш вопрос: программа, документы или следующий шаг. Ответ придёт в этот чат.",
  "",
  "Мы не оформляем визу и не гарантируем зачисление.",
].join("\n");

export const TELEGRAM_HELP_TEXT =
  "Сейчас бот принимает сообщения и передаёт их куратору Immigrome. Напишите вопрос — ответ придёт сюда. /start — краткое приветствие.";

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
