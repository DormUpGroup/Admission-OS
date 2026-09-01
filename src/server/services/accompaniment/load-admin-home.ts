import { prisma } from "@/lib/db";
import type { UserRole } from "@/lib/enums";
import { AccompanimentStatus } from "@/lib/enums";
import { labelOf } from "@/lib/labels";
import { parseProgramsAnswers } from "@/lib/questionnaire-programs";
import { hasQuestionnaire } from "@/server/services/program-match-legacy-helpers";
import { loadWorkQueue } from "@/server/services/work-queue";
import type { WorkQueueView } from "@/server/services/work-queue";
import {
  accompanimentLabel,
  belongsToNewAnketaQueue,
  canAcceptAccompaniment,
  canAcceptToCohort,
  canChangeIntakeLimit,
  canRejectAccompaniment,
  compareNewAnketas,
  formatIntakeLabel,
  normalizeIntakeKey,
  occupiedSeatsForIntake,
  remainingSeats,
} from "./rules";

export type CohortView = {
  intake: string;
  label: string;
  occupied: number;
  limit: number | null;
  remaining: number | null;
  limitUnset: boolean;
  canAccept: boolean;
  fullReason: string | null;
  isActive: boolean;
};

export type NewAnketaRow = {
  studentId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  questionnaireAt: Date | null;
  intake: string;
  studyLevel: string;
  directions: string[];
  preferredLanguage: string | null;
  curatorName: string | null;
  accompanimentStatus: string;
  statusLabel: string;
  canAccept: boolean;
  acceptBlockedReason: string | null;
};

export type AdminHomeFilters = {
  intakes: Array<{ intake: string; label: string; isActive: boolean }>;
  curators: Array<{ id: string; name: string }>;
  studyLevels: Array<{ id: string; label: string }>;
};

export type AdminHomeView = {
  cohort: CohortView;
  allCohorts: Array<{ intake: string; label: string; isActive: boolean }>;
  newAnketas: NewAnketaRow[];
  newAnketasEmpty: boolean;
  workQueue: WorkQueueView;
  todayActionCount: number;
  canEditLimit: boolean;
  canReject: boolean;
  canAccept: boolean;
  filters: AdminHomeFilters;
};

function directionsFromStudent(student: {
  targetField: string | null;
  questionnaireProgramsJson: string | null;
}): string[] {
  const answers = parseProgramsAnswers(student.questionnaireProgramsJson);
  const fromForm = Array.isArray(answers.preferredDirections)
    ? answers.preferredDirections.map(String).filter(Boolean)
    : [];
  if (fromForm.length > 0) return fromForm.slice(0, 3);
  if (student.targetField) return [student.targetField];
  return [];
}

function matchesStatusFilter(status: string, filter?: string) {
  if (!filter) return true;
  if (filter === "PENDING") {
    return status === AccompanimentStatus.NONE || status === AccompanimentStatus.PENDING;
  }
  return status === filter;
}

export async function loadAdminHome(input: {
  userId: string;
  role: UserRole;
  intake?: string;
  status?: string;
  curatorId?: string;
  studyLevel?: string;
}): Promise<AdminHomeView> {
  const canAccept = canAcceptAccompaniment(input.role);
  const canReject = canRejectAccompaniment(input.role);
  const canEditLimit = canChangeIntakeLimit(input.role);

  const [cohorts, distinctIntakes, students, curators] = await Promise.all([
    prisma.intakeCohort.findMany({ orderBy: { intake: "desc" } }),
    prisma.student.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: { intake: true },
      distinct: ["intake"],
    }),
    prisma.student.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        intake: true,
        studyLevel: true,
        targetField: true,
        preferredLanguage: true,
        questionnaireAt: true,
        questionnairePersonalJson: true,
        questionnaireProgramsJson: true,
        questionnaireProgramsAt: true,
        accompanimentStatus: true,
        curatorId: true,
        curator: { select: { name: true } },
      },
    }),
    prisma.user.findMany({
      where: { role: { in: ["ADMIN", "CURATOR"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const intakeKeys = [
    ...new Set(
      [
        ...cohorts.map((c) => normalizeIntakeKey(c.intake)),
        ...distinctIntakes.map((s) => normalizeIntakeKey(s.intake)),
      ].filter(Boolean)
    ),
  ].sort((a, b) => b.localeCompare(a));

  const activeCohort = cohorts.find((c) => c.isActive) ?? null;
  const selectedKey =
    normalizeIntakeKey(input.intake) ||
    (activeCohort ? normalizeIntakeKey(activeCohort.intake) : "") ||
    intakeKeys[0] ||
    "2027/28";

  const selectedCohort =
    cohorts.find((c) => normalizeIntakeKey(c.intake) === selectedKey) ?? null;
  const occupied = occupiedSeatsForIntake(students, selectedKey);
  const limit = selectedCohort?.seatLimit ?? null;
  const acceptDecision = canAcceptToCohort(occupied, limit);

  const cohort: CohortView = {
    intake: selectedKey,
    label: formatIntakeLabel(selectedKey),
    occupied,
    limit,
    remaining: remainingSeats(occupied, limit),
    limitUnset: limit == null,
    canAccept: acceptDecision.ok,
    fullReason: acceptDecision.reason,
    isActive: selectedCohort?.isActive ?? false,
  };

  const newAnketas = students
    .filter((s) => {
      if (!belongsToNewAnketaQueue(s.accompanimentStatus, hasQuestionnaire(s))) {
        return false;
      }
      if (!matchesStatusFilter(s.accompanimentStatus, input.status)) return false;
      if (input.curatorId && s.curatorId !== input.curatorId) return false;
      if (input.studyLevel && s.studyLevel !== input.studyLevel) return false;
      if (
        input.intake &&
        normalizeIntakeKey(s.intake) !== normalizeIntakeKey(input.intake)
      ) {
        return false;
      }
      return true;
    })
    .sort(compareNewAnketas)
    .map((s) => {
      const studentOccupied = occupiedSeatsForIntake(students, s.intake);
      const studentLimit =
        cohorts.find(
          (c) => normalizeIntakeKey(c.intake) === normalizeIntakeKey(s.intake)
        )?.seatLimit ?? null;
      const studentDecision = canAcceptToCohort(studentOccupied, studentLimit);
      return {
        studentId: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        fullName: `${s.firstName} ${s.lastName}`,
        questionnaireAt: s.questionnaireAt ?? s.questionnaireProgramsAt,
        intake: formatIntakeLabel(s.intake),
        studyLevel: labelOf(s.studyLevel),
        directions: directionsFromStudent(s),
        preferredLanguage: s.preferredLanguage,
        curatorName: s.curator?.name ?? null,
        accompanimentStatus: s.accompanimentStatus,
        statusLabel: accompanimentLabel(s.accompanimentStatus),
        canAccept: canAccept && studentDecision.ok,
        acceptBlockedReason: canAccept && !studentDecision.ok ? studentDecision.reason : null,
      };
    });

  const workQueue = await loadWorkQueue({
    userId: input.userId,
    role: input.role,
  });

  const studyLevels = [
    ...new Set(students.map((s) => s.studyLevel).filter(Boolean)),
  ].sort();

  return {
    cohort,
    allCohorts: intakeKeys.map((intake) => ({
      intake,
      label: formatIntakeLabel(intake),
      isActive: cohorts.some(
        (c) => c.isActive && normalizeIntakeKey(c.intake) === intake
      ),
    })),
    newAnketas,
    newAnketasEmpty: newAnketas.length === 0,
    workQueue,
    todayActionCount: workQueue.items.length,
    canEditLimit,
    canReject,
    canAccept,
    filters: {
      intakes: intakeKeys.map((intake) => ({
        intake,
        label: formatIntakeLabel(intake),
        isActive: cohorts.some(
          (c) => c.isActive && normalizeIntakeKey(c.intake) === intake
        ),
      })),
      curators,
      studyLevels: studyLevels.map((id) => ({ id, label: labelOf(id) })),
    },
  };
}
