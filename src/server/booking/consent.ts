import { prisma } from "@/lib/db";

export type BookingConsentTurn = {
  /** The message just before the client's latest one. Any sender. */
  previousBody: string | null;
  clientBody: string | null;
};

const AFFIRMATIVE = new Set([
  "да",
  "даа",
  "давай",
  "давайте",
  "более чем",
  "конечно",
  "хочу",
  "интересно",
  "можно",
  "ок",
  "окей",
  "хорошо",
  "согласен",
  "согласна",
  "согласны",
  "готов",
  "готова",
  "готовы",
  "ага",
  "угу",
  "yes",
  "ok",
  "yeah",
  "запишите",
  "записывайте",
  "с удовольствием",
  "очень",
  "очень хочу",
  "да хочу",
  "да конечно",
  "да давайте",
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'“”.,!?…:;()[\]\-—–]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mentionsConsultation(text: string | null | undefined): boolean {
  if (!text) return false;
  return /консультац|видео\s*консультац|созвон|видеозвон|видео-звон/i.test(text);
}

function isRefusal(text: string): boolean {
  const normalized = normalize(text);
  return /^(нет|не надо|не хочу|не интересно|не готов|не готова|не готовы|позже|не сейчас)\b/.test(
    normalized,
  ) || /\b(не надо|не хочу|не интересно)\b/.test(normalized);
}

function isShortAgreement(text: string): boolean {
  const normalized = normalize(text);
  if (!normalized || normalized.length > 48) return false;
  if (AFFIRMATIVE.has(normalized)) return true;
  const first = normalized.split(" ")[0] ?? "";
  return AFFIRMATIVE.has(first) && !isRefusal(text);
}

function clientAskedForConsultation(text: string): boolean {
  if (!mentionsConsultation(text) || isRefusal(text)) return false;
  return /\b(да|хочу|можно|давайте|интересно|готов|готова|готовы|согласен|согласна|запишите|записывайте)\b/i.test(
    normalize(text),
  );
}

/**
 * Send the booking page when this turn is about a consultation and the client
 * agreed. The consultation line can be from the client, the bot, or a person.
 */
export function shouldSendBookingLink(turn: BookingConsentTurn): boolean {
  const client = turn.clientBody?.trim() ?? "";
  if (!client || isRefusal(client)) return false;
  const topic = mentionsConsultation(turn.previousBody) || mentionsConsultation(client);
  if (!topic) return false;
  return isShortAgreement(client) || clientAskedForConsultation(client);
}

export async function loadBookingConsentTurn(conversationId: string): Promise<BookingConsentTurn> {
  const rows = await prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { direction: true, body: true },
  });
  const ordered = [...rows].reverse();
  let clientIndex = -1;
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (ordered[i]?.direction === "INBOUND" && ordered[i]?.body?.trim()) {
      clientIndex = i;
      break;
    }
  }
  if (clientIndex < 0) return { previousBody: null, clientBody: null };
  let previousBody: string | null = null;
  for (let i = clientIndex - 1; i >= 0; i--) {
    const body = ordered[i]?.body?.trim();
    if (body) {
      previousBody = body;
      break;
    }
  }
  return { previousBody, clientBody: ordered[clientIndex]?.body ?? null };
}

export function bookingLinkReplacesReply(result: string): boolean {
  return result === "sent" || result === "already_sent" || result.startsWith("already_booked");
}
