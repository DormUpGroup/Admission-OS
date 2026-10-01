import { prisma } from "@/lib/db";
import { buildLeadCard, consultationGate } from "@/lib/lead-profile";
import { ADMISSION_CONSULTATION_PRICE } from "@/server/channels/telegram-copy";

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

/** The one question that must be answered before the booking link goes out. */
export function consultationOfferMessage(): string {
  return [
    "Общая картина ясна.",
    "",
    `Есть возможность провести консультацию с куратором: познакомиться и закрыть последние вопросы. Консультация по поступлению — ${ADMISSION_CONSULTATION_PRICE}.`,
    "",
    "Хотите консультацию?",
  ].join("\n");
}

/** After a no: why it helps, then the same question once more. */
export function consultationDeclineMessage(): string {
  return "Так вы сможете лучше разобраться: куратор посмотрит ваши документы и скажет, что подходит.\n\nХотите консультацию?";
}

/** After a second no, stop asking. */
export function consultationCloseMessage(): string {
  return "Хорошо. Если захотите разобраться подробнее, просто напишите.";
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
  const topic = mentionsConsultation(turn.previousBody) || mentionsConsultation(client);
  if (!topic) return false;
  return isShortAgreement(client) || clientAskedForConsultation(client);
}

export type ConsentMessage = { direction: string; body: string | null };

export function latestConsentTurn(messages: ConsentMessage[]): BookingConsentTurn {
  let clientIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.direction === "INBOUND" && messages[i]?.body?.trim()) {
      clientIndex = i;
      break;
    }
  }
  if (clientIndex < 0) return { previousBody: null, clientBody: null };
  let previousBody: string | null = null;
  for (let i = clientIndex - 1; i >= 0; i--) {
    const body = messages[i]?.body?.trim();
    if (body) {
      previousBody = body;
      break;
    }
  }
  return { previousBody, clientBody: messages[clientIndex]?.body ?? null };
}

export function questionnaireOfferMessage(): string {
  return "Если хотите, начнём: я задам несколько вопросов, чтобы понять, как лучше выстроить работу. Начнём?";
}

function mentionsQuestionnaire(text: string | null | undefined): boolean {
  const body = text ?? "";
  // Welcome also ends with «Начнем?» — only the questionnaire offer counts.
  if (!/начн[её]м\?/iu.test(body)) return false;
  return /несколько вопросов|вопросы нужны/iu.test(body);
}

export function agreedToQuestionnaire(turn: BookingConsentTurn): boolean {
  const client = turn.clientBody?.trim() ?? "";
  if (!client || isRefusal(client) || !mentionsQuestionnaire(turn.previousBody)) return false;
  return isShortAgreement(client);
}

export function declinedQuestionnaire(turn: BookingConsentTurn): boolean {
  const client = turn.clientBody?.trim() ?? "";
  if (!client || !mentionsQuestionnaire(turn.previousBody)) return false;
  return isRefusal(client);
}

export function questionnaireDeclineCount(messages: ConsentMessage[]): number {
  let count = 0;
  let previous = "";
  for (const message of messages) {
    const body = message.body?.trim() ?? "";
    if (!body) continue;
    if (
      message.direction === "INBOUND" &&
      declinedQuestionnaire({ previousBody: previous || null, clientBody: body })
    ) {
      count += 1;
    }
    previous = body;
  }
  return count;
}

export function clientAlreadyAgreedToQuestionnaire(messages: ConsentMessage[]): boolean {
  let agreed = false;
  let previous = "";
  for (const message of messages) {
    const body = message.body?.trim() ?? "";
    if (!body) continue;
    if (message.direction === "INBOUND" && mentionsQuestionnaire(previous)) {
      if (isRefusal(body)) agreed = false;
      else if (isShortAgreement(body)) agreed = true;
    }
    previous = body;
  }
  return agreed;
}

/** The client said no to a consultation question. */
export function declinedConsultation(turn: BookingConsentTurn): boolean {
  const client = turn.clientBody?.trim() ?? "";
  if (!client || !mentionsConsultation(turn.previousBody)) return false;
  return isRefusal(client);
}

export function consultationDeclineCount(messages: ConsentMessage[]): number {
  let count = 0;
  let previous = "";
  for (const message of messages) {
    const body = message.body?.trim() ?? "";
    if (!body) continue;
    if (
      message.direction === "INBOUND" &&
      declinedConsultation({ previousBody: previous || null, clientBody: body })
    ) {
      count += 1;
    }
    previous = body;
  }
  return count;
}

/** True when the client agreed to a consultation and has not refused a later offer. */
export function clientAlreadyAgreedToConsultation(messages: ConsentMessage[]): boolean {
  let agreed = false;
  let previous = "";
  for (const message of messages) {
    const body = message.body?.trim() ?? "";
    if (!body) continue;
    if (message.direction === "INBOUND") {
      const aboutConsultation = mentionsConsultation(previous) || mentionsConsultation(body);
      if (aboutConsultation && isRefusal(body)) agreed = false;
      else if (shouldSendBookingLink({ previousBody: previous || null, clientBody: body })) agreed = true;
    }
    previous = body;
  }
  return agreed;
}

export type ConsultationDecision = {
  agreedNow: boolean;
  sendBecauseAlreadyAgreed: boolean;
  /** Facts are ready and the consultation question has not been answered yet. */
  offerNow: boolean;
  /** First no: explain and ask once more. */
  declinedNow: boolean;
  /** Second no: stop asking. */
  closeNow: boolean;
};

export async function loadConsultationDecision(conversationId: string): Promise<ConsultationDecision> {
  const rows = await prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: { direction: true, body: true },
  });
  const messages = [...rows].reverse();
  const turn = latestConsentTurn(messages);
  const agreedNow = shouldSendBookingLink(turn);
  const declined = declinedConsultation(turn);
  const declines = consultationDeclineCount(messages);
  const alreadyAgreed = clientAlreadyAgreedToConsultation(messages);
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
    sendBecauseAlreadyAgreed: !agreedNow && !declined && ready && alreadyAgreed,
    offerNow: ready && !agreedNow && !alreadyAgreed && !declined,
    declinedNow: declined && declines < 2,
    closeNow: declined && declines >= 2,
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
  return (
    result === "sent" ||
    result === "already_sent" ||
    result === "offer_sent" ||
    result === "declined_sent" ||
    result.startsWith("already_booked")
  );
}
