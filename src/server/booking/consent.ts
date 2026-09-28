import { prisma } from "@/lib/db";
import { buildLeadCard, consultationGate } from "@/lib/lead-profile";

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

/** A consultation offer, including a handoff to the curator. */
export function offersHandoff(text: string | null | undefined): boolean {
  if (!text) return false;
  return mentionsConsultation(text) || /передам\s+(вас\s+)?куратор/iu.test(text);
}

function isRefusal(text: string): boolean {
  const normalized = normalize(text);
  // Cyrillic is not a JS word character, so \b does not see these words.
  return /^(нет|не надо|не хочу|не интересно|не готов|не готова|не готовы|позже|не сейчас)(?:\s|$)/.test(
    normalized,
  ) || /(^|\s)(не надо|не хочу|не интересно)(?:\s|$)/.test(normalized);
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
  return /(^|\s)(да|хочу|можно|давайте|интересно|готов|готова|готовы|согласен|согласна|запишите|записывайте)(?:\s|$)/i.test(
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
  const topic = offersHandoff(turn.previousBody) || mentionsConsultation(client);
  if (!topic) return false;
  return isShortAgreement(client) || clientAskedForConsultation(client);
}

export type ConsentMessage = { direction: string; body: string | null };

/** True when the client agreed to a consultation and has not refused a later offer. */
export function clientAlreadyAgreedToConsultation(messages: ConsentMessage[]): boolean {
  let agreed = false;
  let previous = "";
  for (const message of messages) {
    const body = message.body?.trim() ?? "";
    if (!body) continue;
    if (message.direction === "INBOUND") {
      const aboutHandoff =
        offersHandoff(previous) || mentionsConsultation(previous) || mentionsConsultation(body);
      if (aboutHandoff && isRefusal(body)) agreed = false;
      else if (shouldSendBookingLink({ previousBody: previous || null, clientBody: body })) agreed = true;
    }
    previous = body;
  }
  return agreed;
}

export async function loadConsultationDecision(conversationId: string): Promise<{
  agreedNow: boolean;
  sendBecauseAlreadyAgreed: boolean;
}> {
  const rows = await prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: { direction: true, body: true },
  });
  const messages = [...rows].reverse();
  const turn = await loadBookingConsentTurn(conversationId);
  const agreedNow = shouldSendBookingLink(turn);
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { lead: { select: { qualificationJson: true } } },
  });
  const ready = consultationGate(
    buildLeadCard({
      qualificationJson: conversation?.lead?.qualificationJson,
      messages,
    }),
  ).ready;
  return {
    agreedNow,
    sendBecauseAlreadyAgreed: !agreedNow && ready && clientAlreadyAgreedToConsultation(messages),
  };
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
