import { createHash, randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { buildLeadCard, consultationGate } from "@/lib/lead-profile";
import { clientAlreadyAgreedToConsultation } from "@/server/booking/consent";
import type { DbClient } from "@/server/commands/outbox";

/** Tools Hermes may call on an intake run. */
export const MCP_V1_TOOLS = [
  "get_conversation_context",
  "get_contact_profile",
  "update_lead_qualification",
  "send_client_message",
  "send_booking_link",
  "escalate_to_human",
  "propose_reply",
] as const;

export const LEAD_FACT_FIELDS = [
  "educationLevel",
  "studyLevel",
  "targetField",
  "desiredIntake",
  "citizenship",
  "passport",
  "diploma",
  "apostilleTranslation",
  "budget",
] as const;

export type McpV1Tool = (typeof MCP_V1_TOOLS)[number];

export const CAPABILITY_GRANT_TTL_MS = 15 * 60 * 1000;

export function isMcpV1Tool(name: string): name is McpV1Tool {
  return (MCP_V1_TOOLS as readonly string[]).includes(name);
}

export function newCapabilityGrantId(): string {
  return randomBytes(32).toString("base64url");
}

/** Log prefix only. Never log the raw grant id. */
export function capabilityGrantLogHash(grantId: string): string {
  return createHash("sha256").update(grantId).digest("hex").slice(0, 12);
}

export type ChatTurn = {
  direction: string;
  body: string | null;
};

const MAX_TURN_CHARS = 500;

/** Oldest first. Sent messages only, so a previous unsent draft is not in the thread. */
export function formatChatTranscript(turns: ChatTurn[]): string {
  const lines: string[] = [];
  for (const turn of turns) {
    const body = turn.body?.trim();
    if (!body) continue;
    const who = turn.direction === "INBOUND" ? "Client" : "Us";
    const clipped = body.length > MAX_TURN_CHARS ? `${body.slice(0, MAX_TURN_CHARS)}…` : body;
    lines.push(`${who}: ${clipped}`);
  }
  return lines.length > 0 ? lines.join("\n") : "(no earlier messages)";
}

export type LeadCardSource = {
  firstName?: string | null;
  lastName?: string | null;
  locale?: string | null;
  qualificationJson?: unknown;
} | null;

/** Known facts and the one next step. Known includes what the client already said in the chat. */
export function formatLeadCard(lead: LeadCardSource | undefined, messages: ChatTurn[] = []): string {
  const name = [lead?.firstName, lead?.lastName].filter(Boolean).join(" ").trim() || "unknown";
  const locale = lead?.locale?.trim() || "unknown";
  const rows = buildLeadCard({ qualificationJson: lead?.qualificationJson, messages });
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const known = rows.map((row) => `${row.key}: ${row.value.slice(0, 120)}`);
  const missing = LEAD_FACT_FIELDS.filter((field) => !byKey.get(field)?.trim());
  const gate = consultationGate(rows);
  let next: string;
  if (gate.ready && clientAlreadyAgreedToConsultation(messages)) {
    next =
      "Send the booking link now. The client already agreed to a consultation. Do not ask another question.";
  } else if (gate.ready) {
    next = "Offer a consultation now, in one short question. Do not ask any other fact first.";
  } else if (gate.missing[0] === "apostilleTranslation" && /перевод не назван/iu.test(byKey.get("apostilleTranslation") ?? "")) {
    next = "Ask only whether the translation exists. The apostille is already known. Do not ask any other fact.";
  } else if (gate.missing[0] === "apostilleTranslation" && /апостиль не назван/iu.test(byKey.get("apostilleTranslation") ?? "")) {
    next = "Ask only whether the apostille exists. The translation is already known. Do not ask any other fact.";
  } else {
    next = `Ask only this one missing fact: ${gate.missing[0]}. Do not ask anything listed in Known.`;
  }
  return [
    `Name: ${name}`,
    `Locale: ${locale}`,
    `Known: ${known.length > 0 ? known.join("; ") : "none"}`,
    `Missing: ${missing.length > 0 ? missing.join(", ") : "none"}`,
    `Next: ${next}`,
  ].join("\n");
}

export function hermesRunInstructions(
  grantId: string,
  clientMessage: string,
  transcript: string,
  leadCard: string,
): string {
  return [
    "You are a girl chatting with this new lead in Telegram. Continue the conversation and send the reply yourself.",
    "Refer to yourself in the feminine: поняла, передала, уточнила, написала. Never понял, передал, уточнил, написал. The Name on the lead card is the client, not you.",
    "Call tools only through the admission_os MCP server.",
    `Pass grant_id exactly as ${grantId} on every tool call.`,
    "Allowed tools: get_conversation_context, get_contact_profile, update_lead_qualification, send_client_message, send_booking_link, escalate_to_human, propose_reply.",
    "Lead card:",
    leadCard,
    "Recent chat, oldest first. These messages were already sent:",
    transcript,
    "Read the whole chat and the lead card, then make one next turn.",
    "The lead card is the source of truth. Known facts were already said in this chat. Never ask a Known fact again, and never say that a Known fact is missing from the card.",
    "Obey the Next line on the lead card. It is the only question or offer for this turn.",
    "Answer what the person just said and any unfinished thread: a question already asked, or a fact they already gave.",
    "If the chat already started, do not greet again and do not restart the questionnaire from the beginning.",
    "One turn only: a short human reply and at most one fitting question.",
    "The study destination is always Italy. Never ask which country they are considering, and never offer another country.",
    "When the person states a new fact, save it with update_lead_qualification. If it is already in Known, do not ask them to repeat it.",
    "When Next says to send the booking link, call send_booking_link once and do not ask another question. The server sends that link if you only call propose_reply.",
    "When Next says to offer a consultation, ask that once. Do not collect another fact first.",
    "Answer a simple question about the process yourself.",
    "For a specific programme, a price, a timeline, a decision, or anything that is not on the lead card, do not invent it. Say briefly that the curator will check, and call escalate_to_human.",
    "The escalate_to_human reason must name the problem and the one action the curator should take, in the client's language. Example: Клиент спрашивает стоимость конкретной программы. Напишите цену в этот чат.",
    "Call propose_reply once with the full reply. The server sends that text when the turn ends. Do not also call send_client_message for the same text.",
    "Do not offer days or times in the chat, and do not invent a website link. send_booking_link sends the link and its text.",
    "If send_booking_link returns already_booked or already_sent, do not send another message.",
    "If send_booking_link returns no_curator or booking_unavailable, call escalate_to_human and do not invent a link.",
    "Do not put prices, tariffs, or timelines in the text you send.",
    "Write in the client's language, usually Russian.",
    "Sound like a person in a Telegram chat: short, warm, plain words.",
    "Put a blank line between thoughts. One short paragraph for the answer, then a blank line, then the question if you ask one. Do not send one dense block.",
    "An emoji is optional and rare: at most one in a message, and not in every message. Skip it when the topic is a problem, a refusal, or anything serious.",
    "When you list items, use a list. Steps in order are lines starting with 1. 2. 3. Equal items, such as documents or options, are lines starting with •. One list per message, at most five items. A blank line before the list and a blank line after it. The question stays after the list, as a plain sentence.",
    "Bold only the word that matters, as Telegram HTML <b>word</b>: a document name, a date, a time, or a status. Two to four bold words in a message is enough. Do not bold a whole sentence, and do not bold the question. Dates look like <b>15 марта 2026</b>. Times look like <b>14:30</b>. Repeat a date or time the client already said. Do not invent dates or times.",
    "If you include a link, put the plain URL on its own line. No headings, no tables, no italics, no asterisks. The only markup is <b> and </b>.",
    "No corporate greeting, no \"уважаемый клиент\", no essay.",
    "Do not promise admission, a visa, or a payment.",
    "Latest client message:",
    clientMessage,
  ].join("\n");
}

function isUniqueConstraint(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002",
  );
}

export type CapabilityGrantRow = {
  id: string;
  agentRunId: string;
  conversationId: string;
  allowedToolsJson: Prisma.JsonValue;
  expiresAt: Date;
  revokedAt: Date | null;
};

/**
 * One grant per AgentRun. Retries keep the same id so the Hermes idempotency
 * body stays identical, and only push expiresAt forward.
 */
export async function ensureCapabilityGrant(
  db: DbClient,
  input: { agentRunId: string; conversationId: string; now?: Date },
): Promise<CapabilityGrantRow> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + CAPABILITY_GRANT_TTL_MS);
  const existing = await db.agentCapabilityGrant.findUnique({
    where: { agentRunId: input.agentRunId },
  });
  if (existing) {
    if (existing.revokedAt) return existing;
    if (existing.expiresAt.getTime() >= expiresAt.getTime()) return existing;
    return db.agentCapabilityGrant.update({
      where: { agentRunId: input.agentRunId },
      data: { expiresAt },
    });
  }

  try {
    return await db.agentCapabilityGrant.create({
      data: {
        id: newCapabilityGrantId(),
        agentRunId: input.agentRunId,
        conversationId: input.conversationId,
        allowedToolsJson: [...MCP_V1_TOOLS],
        expiresAt,
      },
    });
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    const raced = await db.agentCapabilityGrant.findUnique({
      where: { agentRunId: input.agentRunId },
    });
    if (!raced) throw error;
    return raced;
  }
}

export async function revokeCapabilityGrant(
  db: DbClient,
  agentRunId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.agentCapabilityGrant.updateMany({
    where: { agentRunId, revokedAt: null },
    data: { revokedAt: now },
  });
}
