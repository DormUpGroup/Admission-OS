import { prisma } from "@/lib/db";
import { AccompanimentStatus } from "@/lib/enums";
import { labelOf } from "@/lib/labels";
import { parsePersonalAnswers } from "@/lib/questionnaire-personal";
import { parseProgramsAnswers } from "@/lib/questionnaire-programs";
import { parsePreferredCities } from "@/server/services/program-match";
import {
  accompanimentLabel,
  canAcceptAccompaniment,
  canAcceptToCohort,
  canRejectAccompaniment,
  formatIntakeLabel,
  normalizeIntakeKey,
  occupiedSeatsForIntake,
} from "./rules";

function asText(value: string | string[] | undefined): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const items = value.map(String).map((item) => item.trim()).filter(Boolean);
    return items.length ? items.join(", ") : null;
  }
  const text = String(value).trim();
  return text || null;
}

export type AnketaDecisionView = {
  studentId: string;
  fullName: string;
  email: string;
  intake: string;
  studyLevel: string;
  accompanimentStatus: string;
  statusLabel: string;
  curatorName: string | null;
  acceptedAt: Date | null;
  acceptedByName: string | null;
  personal: Array<{ label: string; value: string }>;
  plan: Array<{ label: string; value: string }>;
  directions: string[];
  language: string | null;
  cities: string[];
  avoidCities: string[];
  finance: Array<{ label: string; value: string }>;
  comments: string[];
  canAccept: boolean;
  canReject: boolean;
  canClarify: boolean;
  acceptBlockedReason: string | null;
  primaryAction: "accept" | "clarify" | "none";
  insufficientReason: string | null;
};

const PERSONAL_FIELDS: Array<{ id: string; label: string }> = [
  { id: "firstNameLatin", label: "Имя" },
  { id: "lastNameLatin", label: "Фамилия" },
  { id: "dateOfBirth", label: "Дата рождения" },
  { id: "citizenship", label: "Гражданство" },
  { id: "countryOfBirth", label: "Страна рождения" },
  { id: "cityOfBirth", label: "Город рождения" },
  { id: "phone", label: "Телефон" },
  { id: "telegram", label: "Telegram" },
  { id: "maritalStatus", label: "Семейное положение" },
  { id: "schoolDiploma", label: "Школьный аттестат" },
  { id: "spoDiploma", label: "Диплом СПО" },
  { id: "bachelorDiploma", label: "Диплом бакалавра" },
  { id: "masterDiploma", label: "Диплом магистра" },
];

export async function loadAnketaDecision(input: {
  studentId: string;
  role: string;
}): Promise<AnketaDecisionView | null> {
  const student = await prisma.student.findUnique({
    where: { id: input.studentId },
    include: {
      curator: { select: { name: true } },
      acceptedBy: { select: { name: true } },
    },
  });
  if (!student) return null;

  const personalAnswers = parsePersonalAnswers(student.questionnairePersonalJson);
  const programsAnswers = parseProgramsAnswers(student.questionnaireProgramsJson);
  const personal = PERSONAL_FIELDS.flatMap((field) => {
    const value = asText(personalAnswers[field.id]);
    return value ? [{ label: field.label, value }] : [];
  });

  const studyLevelLabel =
    asText(programsAnswers.studyLevelPlan) ||
    labelOf(student.studyLevel) ||
    student.studyLevel;
  const language =
    asText(programsAnswers.studyLanguage) || student.preferredLanguage;
  const directions = Array.isArray(programsAnswers.preferredDirections)
    ? programsAnswers.preferredDirections.map(String).filter(Boolean).slice(0, 6)
    : student.targetField
      ? [student.targetField]
      : [];
  const otherDirections = asText(programsAnswers.otherDirections);
  if (otherDirections) directions.push(otherDirections);

  const citiesFromForm = Array.isArray(programsAnswers.preferredCities)
    ? programsAnswers.preferredCities.map(String).filter(Boolean)
    : parsePreferredCities(student.preferredCities);
  const avoidCities = Array.isArray(programsAnswers.avoidCities)
    ? programsAnswers.avoidCities.map(String).filter(Boolean)
    : [];

  const plan = [
    { label: "Набор", value: formatIntakeLabel(student.intake) },
    { label: "Уровень обучения", value: studyLevelLabel },
    programsAnswers.previousSpecialty
      ? {
          label: "Предыдущая специальность",
          value: String(programsAnswers.previousSpecialty),
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const finance: Array<{ label: string; value: string }> = [];
  const dsu = asText(programsAnswers.dsuScholarship);
  if (dsu) finance.push({ label: "Стипендия DSU", value: dsu });

  const comments = [asText(personalAnswers.comment), asText(programsAnswers.extraComment)].filter(
    (value): value is string => Boolean(value)
  );

  const cohorts = await prisma.intakeCohort.findMany();
  const acceptedStudents = await prisma.student.findMany({
    where: {
      accompanimentStatus: AccompanimentStatus.ACCEPTED,
      status: { not: "ARCHIVED" },
    },
    select: { accompanimentStatus: true, intake: true },
  });
  const occupied = occupiedSeatsForIntake(acceptedStudents, student.intake);
  const limit =
    cohorts.find(
      (cohort) =>
        normalizeIntakeKey(cohort.intake) === normalizeIntakeKey(student.intake)
    )?.seatLimit ?? null;
  const seatDecision = canAcceptToCohort(occupied, limit);
  const alreadyAccepted =
    student.accompanimentStatus === AccompanimentStatus.ACCEPTED;
  const roleCanAccept = canAcceptAccompaniment(input.role);
  const canAccept = roleCanAccept && !alreadyAccepted && seatDecision.ok;
  const insufficientReason =
    !studyLevelLabel || directions.length === 0 || !language
      ? "Не хватает уровня обучения, направления или языка"
      : null;
  const canClarify =
    !alreadyAccepted && student.accompanimentStatus !== AccompanimentStatus.REJECTED;
  const primaryAction: AnketaDecisionView["primaryAction"] = alreadyAccepted
    ? "none"
    : insufficientReason
      ? "clarify"
      : canAccept
        ? "accept"
        : canClarify
          ? "clarify"
          : "none";

  return {
    studentId: student.id,
    fullName: `${student.firstName} ${student.lastName}`,
    email: student.email,
    intake: formatIntakeLabel(student.intake),
    studyLevel: studyLevelLabel,
    accompanimentStatus: student.accompanimentStatus,
    statusLabel: accompanimentLabel(student.accompanimentStatus),
    curatorName: student.curator?.name ?? null,
    acceptedAt: student.acceptedAt,
    acceptedByName: student.acceptedBy?.name ?? null,
    personal,
    plan,
    directions,
    language,
    cities: citiesFromForm,
    avoidCities,
    finance,
    comments,
    canAccept,
    canReject: canRejectAccompaniment(input.role) && !alreadyAccepted,
    canClarify,
    acceptBlockedReason: alreadyAccepted
      ? "Ученик уже принят на сопровождение"
      : !roleCanAccept
        ? "Недостаточно прав"
        : seatDecision.reason,
    primaryAction,
    insufficientReason,
  };
}
