export const MIN_STAFF_PASSWORD_LENGTH = 8;

export function normalizeStaffEmail(value: string) {
  return value.trim().toLowerCase();
}

export function staffPasswordIssue(password: string): string | null {
  if (password.length < MIN_STAFF_PASSWORD_LENGTH) {
    return "Пароль должен быть не короче 8 символов.";
  }
  return null;
}

export function staffEmailIssue(email: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Укажите почту.";
  }
  return null;
}
