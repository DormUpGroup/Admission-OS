/** Immigrome Telegram bot copy (RU). No emoji spam, no "AI assistant". */

import { parseTelegramBotCommand } from "@/lib/telegram-conversation-kind";

const GENERIC_DISPLAY_NAMES = new Set([
  "user",
  "username",
  "telegram",
  "admin",
  "test",
  "unknown",
  "anon",
  "anonymous",
  "client",
  "name",
  "noname",
  "nick",
  "nickname",
  "пользователь",
  "клиент",
  "ник",
  "аноним",
]);

/** A Telegram first name we can say aloud. Handles, digits, and placeholders are not names. */
export function isExplicitPersonalName(value: string): boolean {
  const name = value.trim();
  if (name.length < 2 || name.length > 40) return false;
  if (!/^[\p{L}][\p{L}'’\-]*$/u.test(name)) return false;
  return !GENERIC_DISPLAY_NAMES.has(name.toLowerCase());
}

/** First token of the Telegram display name, or null when it is not a personal name. */
export function explicitTelegramFirstName(
  displayName: string | null | undefined,
): string | null {
  const first = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  return isExplicitPersonalName(first) ? first : null;
}

/** Names safe to store on the lead and use in chat. A nick-only profile stays unnamed. */
export function explicitTelegramLeadName(displayName: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const parts = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] && isExplicitPersonalName(parts[0]) ? parts[0] : null;
  if (!firstName) return { firstName: null, lastName: null };
  const rest = parts.slice(1).filter(isExplicitPersonalName);
  return { firstName, lastName: rest.length > 0 ? rest.join(" ") : null };
}

const WELCOME_BODY = [
  "Я помощник кураторов Immigrome.",
  "",
  "Готовы начать?",
].join("\n");

export function telegramWelcomeText(displayName: string | null | undefined): string {
  const name = explicitTelegramFirstName(displayName);
  const hello = name ? `Здравствуйте, ${name}.` : "Здравствуйте.";
  return [hello, "", WELCOME_BODY].join("\n");
}

export const TELEGRAM_HELP_TEXT =
  "Сейчас бот принимает сообщения и передаёт их куратору Immigrome. Напишите вопрос — ответ придёт сюда. /start — краткое приветствие. /prices — услуги и цены.";

export const TELEGRAM_MEDIA_REFUSAL_TEXT =
  "Фото, видео, кружки и голосовые лучше не присылать. Напишите, пожалуйста, текстом.";

/** Same command sent again, with no other client message between them. */
export function isSameConsecutiveCommand(
  command: string | null,
  previousBody: string | null | undefined,
): boolean {
  const current = telegramCommandFamily(command);
  if (!current) return false;
  const previous = telegramCommandFamily(parseTelegramBotCommand(previousBody ?? ""));
  return previous === current;
}

function telegramCommandFamily(command: string | null): string | null {
  if (!command) return null;
  if (isTelegramPriceCommand(command)) return "prices";
  return command;
}

/**
 * Public prices from https://immigrome.ru/ (tariff and service cards).
 * The link sits on the tariffs block, which is the site's «Тарифы» section.
 */
export const TELEGRAM_PRICES_TEXT = [
  "<b>Тарифы</b>",
  "Комплексное сопровождение поступления.",
  "https://immigrome.ru/",
  "",
  "• <b>Магистратура</b> — <b>1599 €</b>. Можно разделить на 4 платежа. Подача на стипендию DSU — <b>599 €</b>.",
  "• <b>Бакалавриат</b> — <b>1799 €</b>. Можно разделить на 4 платежа. Подача на стипендию DSU — <b>599 €</b>.",
  "• <b>Мастер</b> — <b>1499 €</b>. Можно разделить на 2 платежа.",
  "• <b>Foundation</b> — <b>1399 €</b>. Можно разделить на 3 платежа.",
  "• <b>Медицинский</b> — <b>1599 €</b>. Можно разделить на 4 платежа. Подача на стипендию DSU — <b>599 €</b>.",
  "• <b>Лайт</b> — <b>999 €</b>. Можно разделить на 2 платежа. Подача на стипендию DSU — <b>599 €</b>.",
  "",
  "<b>Услуги</b>",
  "",
  "• <b>Консультация по поступлению</b> — <b>130 €</b> / 1 час.",
  "• <b>Мне только спросить</b> — <b>50 €</b> / 20 минут.",
  "• <b>Консультация по стипендии</b> — <b>135 €</b> / 1 час.",
  "• <b>Консультация «языковые курсы»</b> — <b>70 €</b> / 40 минут.",
  "• <b>Консультация «После переезда»</b> — <b>100 €</b> / 1 час.",
  "• <b>Мотивационное письмо</b> — <b>160 €</b>.",
  "• <b>Резюме</b> — <b>130 €</b>.",
  "• <b>Подача заявки в университет</b> — <b>150 €</b>.",
  "• <b>Помощь с оплатой</b> — зависит от суммы.",
  "",
  "Напишите, какой вариант вам ближе — куратор подскажет в этом чате.",
].join("\n");

export function isTelegramPriceCommand(command: string | null): boolean {
  return command === "prices" || command === "price" || command === "pricelist";
}

export { parseTelegramBotCommand };
