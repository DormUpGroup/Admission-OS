export const BOOKING_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function bookingPageUrl(
  token: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const origin = (env.AUTH_URL ?? env.NEXTAUTH_URL ?? "").trim().replace(/\/$/, "");
  if (!origin) {
    throw new Error("AUTH_URL is not set");
  }
  return `${origin}/book/${encodeURIComponent(token)}`;
}

export function bookingInviteMessage(url: string): string {
  return [
    "Вот ссылка, чтобы выбрать время консультации:",
    url,
    "",
    "Ссылку на звонок пришлём в этот чат и на почту, которую укажете в форме.",
  ].join("\n");
}

/** Assigned curator wins. Otherwise the only CURATOR account in the system. */
export function pickBookingCuratorId(
  assigned: Array<string | null | undefined>,
  curatorUserIds: string[],
): string | null {
  for (const id of assigned) {
    if (id) return id;
  }
  if (curatorUserIds.length === 1) return curatorUserIds[0];
  return null;
}
