/** Shared MIUR classe code normalize (spaces, case, trailing dots). */
export function normalizeMiurCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/\.+$/g, "");
}
