import { createHash, randomBytes } from "crypto";
import type { Prisma } from "@prisma/client";
import { buildLeadCard, consultationGate, factIsKnown } from "@/lib/lead-profile";
import { TELEGRAM_PRICES_TEXT } from "@/server/channels/telegram-copy";
import {
  clientAlreadyAgreedToConsultation,
  clientAlreadyAgreedToQuestionnaire,
  consultationDeclineCount,
  declinedConsultation,
  declinedQuestionnaire,
  latestConsentTurn,
  questionnaireDeclineCount,
  questionnaireOfferMessage,
  shouldSendBookingLink,
} from "@/server/booking/consent";
import type { DbClient } from "@/server/commands/outbox";
import { AGENT_DEFINITIONS_BY_KEY, type AgentKey } from "./registry";

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

/** After the person agrees, study level is the first question. Then the fact list. */
const QUESTION_ORDER = [
  "studyLevel",
  ...LEAD_FACT_FIELDS.filter((field) => field !== "studyLevel"),
] as const;

export const SCHEDULING_MCP_TOOLS = ["commit_booked_consultation"] as const;
export const ONBOARDING_MCP_TOOLS = [
  "get_onboarding_context",
  "submit_onboarding_result",
  "create_curator_task",
] as const;

export type McpV1Tool = (typeof MCP_V1_TOOLS)[number];

export function toolsForProfile(profile: string | null | undefined): readonly string[] {
  if (profile === "scheduling") return SCHEDULING_MCP_TOOLS;
  if (profile === "onboarding") return ONBOARDING_MCP_TOOLS;
  return MCP_V1_TOOLS;
}

export function isKnownMcpTool(name: string): boolean {
  return (
    (MCP_V1_TOOLS as readonly string[]).includes(name) ||
    (SCHEDULING_MCP_TOOLS as readonly string[]).includes(name) ||
    (ONBOARDING_MCP_TOOLS as readonly string[]).includes(name)
  );
}

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
  const turn = latestConsentTurn(messages);
  const agreed = shouldSendBookingLink(turn) || clientAlreadyAgreedToConsultation(messages);
  const declined = declinedConsultation(turn);
  const questionnaireStarted =
    QUESTION_ORDER.some((field) => factIsKnown(field, byKey.get(field))) ||
    clientAlreadyAgreedToQuestionnaire(messages);
  const questionDeclines = questionnaireDeclineCount(messages);
  const nextField = QUESTION_ORDER.find((field) => !factIsKnown(field, byKey.get(field)));
  const offer = questionnaireOfferMessage();
  let next: string;
  if (gate.ready && agreed) {
    next =
      "Send the booking link now. The client agreed to a consultation. Do not ask another question.";
  } else if (gate.ready && declined && consultationDeclineCount(messages) >= 2) {
    next =
      "The client declined a consultation again. Accept it in one short sentence and do not ask a third time. Do not send the link.";
  } else if (gate.ready && declined) {
    next =
      "The client declined a consultation. Explain that a consultation is how they can understand their case better, then ask once more: Хотите консультацию? Do not send the link.";
  } else if (gate.ready) {
    next =
      "Ask whether they want a consultation, in one short question: Хотите консультацию? Do not send the booking link until they say yes. Do not ask another fact.";
  } else if (!questionnaireStarted && questionDeclines >= 2) {
    next =
      "The client declined the questions again. Accept it in one short sentence and do not offer the questionnaire again. Do not ask a fact.";
  } else if (!questionnaireStarted && declinedQuestionnaire(turn)) {
    next = `The client declined the questions. Explain that the questions show their case so you do not offer extra steps, then ask once more: Вопросы нужны, чтобы понять ваш случай и не предлагать лишние шаги. Без этого легко ошибиться в порядке действий.\n\n${offer} Do not ask a fact yet.`;
  } else if (!questionnaireStarted) {
    next = `Do not ask a fact. Offer to start and ask a few questions, in this sentence: ${offer}`;
  } else if (nextField === "studyLevel") {
    next =
      "Ask only which level they want: бакалавриат, магистратура, or foundation. Do not ask any other fact.";
  } else if (
    nextField === "apostilleTranslation" &&
    /перевод не назван/iu.test(byKey.get("apostilleTranslation") ?? "")
  ) {
    next = "Ask only whether the translation exists. The apostille is already known. Do not ask any other fact.";
  } else if (
    nextField === "apostilleTranslation" &&
    /апостиль не назван/iu.test(byKey.get("apostilleTranslation") ?? "")
  ) {
    next = "Ask only whether the apostille exists. The translation is already known. Do not ask any other fact.";
  } else if (nextField) {
    next = `Ask only this one missing fact: ${nextField}. Do not ask anything listed in Known.`;
  } else {
    next = "Do not ask another fact. Answer what they just said.";
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
  curatorRequests = 0,
): string {
  return [
    "Call tools only through the admission_os MCP server.",
    `Pass grant_id exactly as ${grantId} on every tool call.`,
    "Allowed tools: get_conversation_context, get_contact_profile, update_lead_qualification, send_client_message, send_booking_link, escalate_to_human, propose_reply.",
    "Lead card:",
    leadCard,
    "Recent chat, oldest first. These messages were already sent:",
    transcript,
    "Read the whole chat and the lead card, then make one next turn.",
    "The lead card is the source of truth. Known facts were already said in this chat. Never ask a Known fact again, and never say that a Known fact is missing from the card.",
    "Obey the Next line on the lead card. It is the only question or offer for this turn, unless the person just asked about the price list or a service price. Answer that price question in this turn before Next.",
    "Answer what the person just said and any unfinished thread: a question already asked, or a fact they already gave.",
    "The opening message already introduced you. If the chat already started, do not greet again and do not repeat that introduction. Obey the Next line. When Next offers to start questions, or explains a refusal, send that and do not ask a fact. When Next names one fact, ask only that fact.",
    "When Next says the client declined the questions, explain why they are needed and ask once more. Do not ask a fact yet.",
    "When Next says the client declined the questions again, accept it and do not offer the questionnaire again.",
    "If the latest client message repeats the previous client message in meaning, do not send another reply and do not ask the same question again.",
    "One turn only: a short human reply and at most one fitting question.",
    "The study destination is always Italy. Never ask which country they are considering, and never offer another country.",
    "When the person states a new fact, save it with update_lead_qualification. If it is already in Known, do not ask them to repeat it.",
    "When Next says to ask whether they want a consultation, ask only that. Do not send the booking link until they say yes.",
    "When Next says the client declined a consultation, explain that a consultation is how they can understand their case better, then ask once more. Do not send the link.",
    "When Next says to send the booking link, call send_booking_link once and do not ask another question. The link opens a page to pick a consultation time. No account is required. The server sends that link if you only call propose_reply.",
    "Answer a simple question about the process yourself.",
    "Price catalog. These are the only prices you may quote. Copy the amount exactly. Do not round, discount, or invent a price.",
    TELEGRAM_PRICES_TEXT,
    "If the person asks for the price list, the tariffs, all services, or what Immigrome costs in general, answer immediately. Send the price catalog text above as the reply. Do not wait, do not say the curator will check, and do not call escalate_to_human.",
    "If they ask the price of one service that is in the price catalog, answer immediately with only that service and its price. Do not send the whole catalog. Keep the amount bold, as in the catalog: <b>1599 €</b>.",
    "If they ask the price of something that is not in the price catalog, including a university programme fee, do not invent a number. Say the curator will answer this price in the chat. Do not call escalate_to_human.",
    "Mentioning or quoting a price never turns automation off. Do not call escalate_to_human because of a price, a tariff, or a service cost. After the price, continue the conversation.",
    `The client has explicitly asked to be handed to a curator ${curatorRequests} time(s). Hand the chat over only after the third explicit request. Before that, do not call escalate_to_human for this request. Keep answering in the chat. The server hands the chat over on the third request.`,
    "If the person confirms a consultation time already proposed in this chat, the server confirms it. Do not say there is a problem, do not say the curator will check, and do not call escalate_to_human.",
    "For a specific programme, a timeline, a decision, or anything that is not on the lead card and not in the price catalog, do not invent it. Say briefly that the curator will check, and call escalate_to_human. Confirming a time that was already proposed is not such a decision.",
    "The escalate_to_human reason must name the problem and the one action the curator should take, in the client's language. Example: Клиент просит выбрать конкретный вуз. Проверьте программу и ответьте в этот чат.",
    "Call propose_reply once with the full reply. The server sends that text when the turn ends. Do not also call send_client_message for the same text.",
    "Do not offer days or times in the chat, and do not invent a website link. The price catalog may include https://immigrome.ru/. send_booking_link sends the booking link and its text.",
    "If send_booking_link returns already_booked or already_sent, do not send another message.",
    "If send_booking_link returns no_curator or booking_unavailable, call escalate_to_human and do not invent a link.",
    "Do not put timelines in the text you send. A price is allowed only when it is copied from the price catalog.",
    "Write in the client's language, usually Russian.",
    "Do not promise admission, a visa, or a payment. Do not mention visas or guaranteed admission unless the person asks. If they ask, say: Мы не оформляем визу и не гарантируем зачисление.",
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

  const run = await db.agentRun.findUnique({
    where: { id: input.agentRunId },
    select: { agentKey: true },
  });
  const spec = run ? AGENT_DEFINITIONS_BY_KEY.get(run.agentKey as AgentKey) : undefined;
  const allowedTools = spec ? [...spec.allowedTools] : [...MCP_V1_TOOLS];

  try {
    return await db.agentCapabilityGrant.create({
      data: {
        id: newCapabilityGrantId(),
        agentRunId: input.agentRunId,
        conversationId: input.conversationId,
        allowedToolsJson: allowedTools,
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
