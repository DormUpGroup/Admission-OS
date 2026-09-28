/** True when this person created a cabinet from the booking link in their chat. */
export function hasPlatformAccount(userId: string | null | undefined): boolean {
  return typeof userId === "string" && userId.length > 0;
}

export function platformPresenceLabel(hasAccount: boolean): "На платформе" | "Гость" {
  return hasAccount ? "На платформе" : "Гость";
}
