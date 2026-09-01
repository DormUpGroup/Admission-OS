import { AccompanimentStatus } from "@/lib/enums";

export function normalizeIntakeKey(intake: string | null | undefined): string {
  const raw = (intake ?? "").trim();
  if (!raw) return "";
  const years = raw.match(/20\d{2}/g) ?? [];
  if (years.length >= 2) return `${years[0]}/${years[1].slice(-2)}`;
  if (years.length === 1) {
    const start = Number(years[0]);
    return `${start}/${String(start + 1).slice(-2)}`;
  }
  return raw.replace(/\s+/g, "");
}

export function intakeAliases(intake: string | null | undefined): string[] {
  const key = normalizeIntakeKey(intake);
  if (!key) return [];
  const start = key.slice(0, 4);
  const end2 = key.slice(-2);
  const endFull = `${start.slice(0, 2)}${end2}`;
  return [...new Set([key, `${start}/${endFull}`, intake?.trim() ?? ""])].filter(
    Boolean
  );
}

export function formatIntakeLabel(intake: string | null | undefined): string {
  const key = normalizeIntakeKey(intake);
  return key || "—";
}

export function occupiesSeat(status: string | null | undefined): boolean {
  return status === AccompanimentStatus.ACCEPTED;
}

export function occupiedSeatsForIntake(
  students: Array<{ accompanimentStatus: string; intake: string }>,
  intake: string
): number {
  const aliases = new Set(intakeAliases(intake));
  return students.filter(
    (student) =>
      occupiesSeat(student.accompanimentStatus) &&
      aliases.has(normalizeIntakeKey(student.intake))
  ).length;
}

export function remainingSeats(
  occupied: number,
  limit: number | null | undefined
): number | null {
  if (limit == null) return null;
  return Math.max(0, limit - occupied);
}

export function canAcceptToCohort(
  occupied: number,
  limit: number | null | undefined
): { ok: boolean; reason: string | null } {
  if (limit == null) return { ok: true, reason: null };
  if (occupied >= limit) {
    return { ok: false, reason: "Мест в наборе нет" };
  }
  return { ok: true, reason: null };
}

export function canChangeIntakeLimit(role: string): boolean {
  return role === "ADMIN";
}

export function canRejectAccompaniment(role: string): boolean {
  return role === "ADMIN";
}

export function canAcceptAccompaniment(role: string): boolean {
  return role === "ADMIN" || role === "CURATOR";
}

export const ACCOMPANIMENT_LABELS: Record<string, string> = {
  NONE: "Новая анкета",
  PENDING: "Новая анкета",
  UNDER_REVIEW: "На рассмотрении",
  ACCEPTED: "Принят",
  REJECTED: "Не принят",
};

export function accompanimentLabel(status: string | null | undefined): string {
  return ACCOMPANIMENT_LABELS[status ?? ""] ?? "Новая анкета";
}

export function isOpenAccompanimentDecision(status: string | null | undefined) {
  return (
    status !== AccompanimentStatus.ACCEPTED &&
    status !== AccompanimentStatus.REJECTED
  );
}

export function belongsToNewAnketaQueue(
  status: string | null | undefined,
  hasQuestionnaire: boolean
) {
  return hasQuestionnaire && status !== AccompanimentStatus.ACCEPTED;
}

export function newAnketaSortRank(status: string | null | undefined): number {
  if (status === AccompanimentStatus.REJECTED) return 2;
  if (status === AccompanimentStatus.UNDER_REVIEW) return 1;
  return 0;
}

export type NewAnketaSortInput = {
  accompanimentStatus: string;
  questionnaireAt: Date | null;
  curatorId: string | null;
};

export function compareNewAnketas(a: NewAnketaSortInput, b: NewAnketaSortInput) {
  const rank = newAnketaSortRank(a.accompanimentStatus) - newAnketaSortRank(b.accompanimentStatus);
  if (rank !== 0) return rank;
  const aTime = a.questionnaireAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bTime = b.questionnaireAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) return aTime - bTime;
  if (Boolean(a.curatorId) !== Boolean(b.curatorId)) {
    return a.curatorId ? 1 : -1;
  }
  return 0;
}
