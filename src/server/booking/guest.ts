const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function splitGuestName(raw: string): {
  guestName: string;
  firstName: string;
  lastName: string;
} {
  const guestName = raw.trim().replace(/\s+/g, " ");
  const parts = guestName.split(" ").filter(Boolean);
  return {
    guestName,
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

export function normalizeGuestEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) return null;
  return email;
}
