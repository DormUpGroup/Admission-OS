export function isEmailDeliveryConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
}

export async function sendTransactionalEmail(
  input: {
    to: string;
    subject: string;
    text: string;
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
  },
): Promise<void> {
  const env = input.env ?? process.env;
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    throw new Error("Почта не настроена: укажите RESEND_API_KEY и EMAIL_FROM на сервисе Admission-OS.");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
    }),
  });
  if (!response.ok) {
    throw new Error(`Не удалось отправить письмо (${response.status}).`);
  }
}
