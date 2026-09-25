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

export { parseTelegramBotCommand } from "@/lib/telegram-conversation-kind";
