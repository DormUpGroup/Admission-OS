import { prisma } from "@/lib/db";
import {
  hasMatchingProfile as hasProgramsQuestionnaire,
} from "@/server/services/program-match-legacy-helpers";
import {
  generateProgramMatches,
  listPersistedMatches,
} from "@/server/services/program-matching/program-matching";
import { listStudentShortlist } from "@/server/services/program-matching/shortlist";

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
  eligibilityStatus?: string;
  dataConfidence?: string;
  matchId?: string;
  programAcademicYearId?: string;
};

export {
  hasQuestionnaire,
  hasMatchingProfile,
  parsePreferredCities,
} from "@/server/services/program-match-legacy-helpers";

export type MatchCriteria = {
  studyLevel?: string | null;
  preferredLanguage?: string | null;
  targetField?: string | null;
  preferredCities?: string[];
};

/** Live scoring against ProgramAcademicYear when available; falls back to legacy catalog score. */
export async function matchProgramsForStudent(
  studentId: string,
  criteria?: MatchCriteria,
  options?: { minScore?: number; limit?: number }
): Promise<ProgramMatch[]> {
  const yearCount = await prisma.programAcademicYear.count();
  if (yearCount > 0 && !criteria) {
    const generated = await generateProgramMatches(studentId, {
      limit: options?.limit ?? 12,
    });
    return generated
      .filter((m) => m.fitScore >= (options?.minScore ?? 0))
      .map((m) => ({
        programId: m.programId,
        programName: m.programName,
        degreeLevel: m.degreeLevel,
        language: m.language,
        field: m.field,
        universityId: m.universityId,
        universityName: m.universityName,
        city: m.city,
        score: m.fitScore,
        reasons: m.reasons,
        alreadyApplied: m.alreadyApplied,
        applicationId: m.applicationId,
        eligibilityStatus: m.eligibilityStatus,
        dataConfidence: m.dataConfidence,
        programAcademicYearId: m.programAcademicYearId,
      }));
  }

  const { legacyMatchProgramsForStudent } = await import(
    "@/server/services/program-match-legacy-helpers"
  );
  return legacyMatchProgramsForStudent(studentId, criteria, options);
}

export async function matchProgramsFromShortlist(
  studentId: string
): Promise<ProgramMatch[]> {
  const items = await listStudentShortlist(studentId);
  const apps = await prisma.application.findMany({
    where: { studentId },
    select: { id: true, programId: true },
  });
  const applied = new Map(apps.map((a) => [a.programId, a.id]));

  return items.map((item) => {
    const p = item.programAcademicYear.program;
    return {
      programId: p.id,
      programName: p.name,
      degreeLevel: p.degreeLevel,
      language: p.language,
      field: p.field,
      universityId: p.universityId,
      universityName: p.university.name,
      city: p.campusCity || p.university.city,
      score: 100,
      reasons: item.curatorNote
        ? [item.curatorNote]
        : ["Curator-verified shortlist"],
      alreadyApplied: applied.has(p.id),
      applicationId: applied.get(p.id),
      programAcademicYearId: item.programAcademicYearId,
    };
  });
}

export async function getPersistedMatchCards(studentId: string) {
  return listPersistedMatches(studentId);
}

export { hasProgramsQuestionnaire };
