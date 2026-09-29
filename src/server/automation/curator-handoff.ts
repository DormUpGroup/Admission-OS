/** How many separate client messages must explicitly ask before the chat is handed over. */
export const CURATOR_HANDOFF_REQUESTS = 3;

export const CURATOR_HANDOFF_ACK =
  "Передала чат куратору. Он ответит здесь.";

/**
 * The client is asking to be handed to a person. A consultation, a price, or
 * a mention of the curator without that request does not count.
 */
export function isExplicitCuratorRequest(text: string | null | undefined): boolean {
  const raw = (text ?? "").replace(/ё/g, "е").toLowerCase();
  if (!raw.trim()) return false;
  return (
    /(?:хочу|можно|надо|нужно).{0,48}(?:куратор|оператор|менеджер|жив(?:ого|ой)\s+человек)/u.test(raw) ||
    /(?:передайте|передай|переключите|переключи|соедините|соедини|позовите|позови|свяжите|свяжи).{0,40}(?:куратор|оператор|менеджер|человек)/u.test(raw) ||
    /пусть\s+(?:куратор|оператор|менеджер|человек)/u.test(raw) ||
    /(?:нужен|нужна)\s+(?:живой\s+)?(?:куратор|человек|оператор|менеджер)/u.test(raw) ||
    /(?:с\s+)?(?:куратором|оператором|менеджером).{0,24}(?:поговорить|пообщаться|связаться)/u.test(raw)
  );
}

export function explicitCuratorRequestCount(
  messages: Array<{ body: string | null }>,
): number {
  return messages.filter((message) => isExplicitCuratorRequest(message.body)).length;
}

/** The latest client message is the request that reaches the third ask. */
export function shouldHandChatToCurator(messages: Array<{ body: string | null }>): boolean {
  if (explicitCuratorRequestCount(messages) < CURATOR_HANDOFF_REQUESTS) return false;
  const latest = messages[messages.length - 1];
  return isExplicitCuratorRequest(latest?.body);
}

/** The model asked to hand the chat over because the client wants a person. */
export function escalationIsCuratorHandoff(reason: string): boolean {
  return isExplicitCuratorRequest(reason) || /куратор|оператор|менеджер/iu.test(reason);
}
