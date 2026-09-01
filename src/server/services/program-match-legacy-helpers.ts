import { prisma } from "@/lib/db";

export type MatchCriteria = {
  studyLevel?: string | null;
  preferredLanguage?: string | null;
  targetField?: string | null;
  preferredCities?: string[];
};

export type ProgramMatch = {
  programId: string;
  programName: string;
  degreeLevel: string;
  language: string | null;
  field: string | null;
  universityId: string;
  universityName: string;
  city: string | null;
  score: number;
  reasons: string[];
  alreadyApplied: boolean;
  applicationId?: string;
};

const LANG_ALIASES: Record<string, string[]> = {
  english: ["english", "en", "eng", "английский", "inglese"],
  italian: ["italian", "it", "ita", "итальянский", "italiano"],
  french: ["french", "fr", "французский", "francais", "français"],
  german: ["german", "de", "немецкий", "deutsch"],
};

function normalize(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function languageBucket(value: string | null | undefined): string | null {
  const n = normalize(value);
  if (!n) return null;
  for (const [bucket, aliases] of Object.entries(LANG_ALIASES)) {
    if (aliases.some((a) => n === a || n.includes(a))) return bucket;
  }
  return n;
}

function languagesMatch(
  preferred: string | null | undefined,
  programLang: string | null | undefined
): boolean {
  const a = languageBucket(preferred);
  const b = languageBucket(programLang);
  if (!a || !b) return false;
  return a === b;
}

function fieldsMatch(
  target: string | null | undefined,
  field: string | null | undefined,
  programName: string
): boolean {
  const t = normalize(target);
  if (!t) return false;
  const f = normalize(field);
  const n = normalize(programName);
  if (f === t) return true;
  if (f && t.length >= 3 && f.length >= 3) {
    if (f.includes(t) || t.includes(f)) return true;
  }
  if (t.length >= 3 && n.includes(t)) return true;
  return false;
}

export function parsePreferredCities(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return parsed.map((c) => String(c)).filter(Boolean);
    }
  } catch {
    /* ignore */
  }
  return [];
}

export function hasQuestionnaire(student: {
  questionnaireAt?: Date | null;
  questionnairePersonalJson?: string | null;
  preferredLanguage?: string | null;
  targetField?: string | null;
}): boolean {
  return !!(student.questionnairePersonalJson || student.questionnaireAt);
}

export function hasMatchingProfile(student: {
  preferredLanguage?: string | null;
  targetField?: string | null;
  questionnaireProgramsJson?: string | null;
  questionnaireProgramsAt?: Date | null;
}): boolean {
  return !!(
    student.questionnaireProgramsJson ||
    student.questionnaireProgramsAt ||
    (student.preferredLanguage && student.targetField)
  );
}

export function scoreProgram(
  criteria: MatchCriteria,
  program: {
    id: string;
    name: string;
    degreeLevel: string;
    language: string | null;
    field: string | null;
    university: { id: string; name: string; city: string | null };
  }
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (criteria.studyLevel && program.degreeLevel === criteria.studyLevel) {
    score += 40;
    reasons.push("совпал уровень обучения");
  }

  if (languagesMatch(criteria.preferredLanguage, program.language)) {
    score += 25;
    reasons.push(`совпал язык (${program.language})`);
  }

  if (fieldsMatch(criteria.targetField, program.field, program.name)) {
    score += 25;
    reasons.push(
      program.field
        ? `направление: ${program.field}`
        : `название программы близко к «${criteria.targetField}»`
    );
  }

  const cities = criteria.preferredCities ?? [];
  const city = program.university.city;
  if (city && cities.some((c) => normalize(c) === normalize(city))) {
    score += 10;
    reasons.push(`город ${city}`);
  }

  return { score, reasons };
}

export async function legacyMatchProgramsForStudent(
  studentId: string,
  criteria?: MatchCriteria,
  options?: { minScore?: number; limit?: number }
): Promise<ProgramMatch[]> {
  const minScore = options?.minScore ?? 40;
  const limit = options?.limit ?? 12;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      applications: { select: { id: true, programId: true } },
    },
  });
  if (!student) return [];

  const effective: MatchCriteria = criteria ?? {
    studyLevel: student.studyLevel,
    preferredLanguage: student.preferredLanguage,
    targetField: student.targetField,
    preferredCities: parsePreferredCities(student.preferredCities),
  };

  const programs = await prisma.program.findMany({
    include: { university: true },
    orderBy: [{ university: { name: "asc" } }, { name: "asc" }],
  });

  const appliedByProgram = new Map(
    student.applications.map((a) => [a.programId, a.id])
  );

  const matches: ProgramMatch[] = [];

  for (const p of programs) {
    const { score, reasons } = scoreProgram(effective, p);
    if (score < minScore) continue;
    const applicationId = appliedByProgram.get(p.id);
    matches.push({
      programId: p.id,
      programName: p.name,
      degreeLevel: p.degreeLevel,
      language: p.language,
      field: p.field,
      universityId: p.university.id,
      universityName: p.university.name,
      city: p.university.city,
      score,
      reasons,
      alreadyApplied: !!applicationId,
      applicationId,
    });
  }

  matches.sort(
    (a, b) =>
      b.score - a.score || a.universityName.localeCompare(b.universityName)
  );
  return matches.slice(0, limit);
}

export async function listUniversityCities(): Promise<string[]> {
  const rows = await prisma.university.findMany({
    where: { city: { not: null } },
    select: { city: true },
    distinct: ["city"],
    orderBy: { city: "asc" },
  });
  return rows.map((r) => r.city!).filter(Boolean);
}
