import { hasMatchingProfile, hasQuestionnaire } from "@/server/services/program-match";

export function cabinetPageUrl(
  path: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const origin = (env.AUTH_URL ?? env.NEXTAUTH_URL ?? "").trim().replace(/\/$/, "");
  if (!origin) throw new Error("AUTH_URL is not set");
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${clean}`;
}

export type MissingQuestionnaire = "personal" | "programs";

export function missingQuestionnaire(
  student: Parameters<typeof hasQuestionnaire>[0] & Parameters<typeof hasMatchingProfile>[0],
): MissingQuestionnaire | null {
  if (!hasQuestionnaire(student)) return "personal";
  if (!hasMatchingProfile(student)) return "programs";
  return null;
}

export function questionnairePath(kind: MissingQuestionnaire): string {
  return kind === "personal" ? "/portal/questionnaire" : "/portal/questionnaire-2";
}

export function questionnaireCabinetRequestMessage(kind: MissingQuestionnaire, url: string): string {
  const which =
    kind === "personal"
      ? "анкету №1 (личная информация)"
      : "анкету №2 (подбор программ)";
  return [
    `Пожалуйста, заполните ${which} в личном кабинете:`,
    url,
    "",
    "Без этой анкеты мы не сможем запустить подбор программ.",
  ].join("\n");
}

export function questionnaireJoinRequestMessage(joinUrl: string): string {
  return [
    "Чтобы продолжить, создайте кабинет ученика и заполните анкеты:",
    joinUrl,
    "",
    "После входа откройте раздел «Анкеты». Без анкет №1 и №2 мы не подберём программы.",
  ].join("\n");
}
