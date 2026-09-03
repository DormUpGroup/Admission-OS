import { parsePersonalAnswers } from "@/lib/questionnaire-personal";
import {
  mapProgramsAnswersToProfile,
  parseProgramsAnswers,
} from "@/lib/questionnaire-programs";
import { DEFAULT_TARGET_ACADEMIC_YEAR } from "@/lib/program-matching/config";
import {
  EU_COUNTRIES,
  regionForCity,
  tagsFromList,
} from "@/lib/program-matching/taxonomy";
import type {
  ApplicantCategory,
  DegreeLevel,
  MatchingProfile,
} from "@/lib/program-matching/types";
import {
  UNKNOWN,
  normalizeAcademicYear,
  parseIeltsFromText,
  parseSatFromText,
} from "./compare";

type StudentInput = {
  id: string;
  intake: string;
  country?: string | null;
  nationality?: string | null;
  studyLevel?: string | null;
  preferredLanguage?: string | null;
  targetField?: string | null;
  preferredCities?: string | null;
  questionnairePersonalJson?: string | null;
  questionnaireProgramsJson?: string | null;
};

function asUnknown(value: string | null | undefined): string | typeof UNKNOWN {
  const v = (value ?? "").trim();
  return v ? v : UNKNOWN;
}

function parseCitiesJson(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function inferApplicantCategory(input: {
  nationality?: string | null;
  country?: string | null;
  citizenship?: string | null;
}): ApplicantCategory {
  const blob = [input.nationality, input.country, input.citizenship]
    .filter(Boolean)
    .join(" ");
  if (!blob.trim()) return "UNKNOWN";
  if (
    /\b(?:eu\s+equivalent|equivalent\s+to\s+eu|equiparat[oaie]|assimilated\s+to\s+eu)\b/i.test(
      blob
    )
  ) {
    return "EU_EQUIVALENT";
  }
  const citizenship = [input.nationality, input.citizenship]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const residence = (input.country || "").toLowerCase();
  const hasEuCitizenship =
    EU_COUNTRIES.has(citizenship) ||
    [...EU_COUNTRIES].some((country) => citizenship.includes(country));
  if (hasEuCitizenship) return "EU_CITIZEN";
  if (!citizenship.trim()) return "UNKNOWN";
  if (
    /resident in italy|residente in italia|permesso/i.test(blob) ||
    /\b(?:italy|italia)\b/.test(residence)
  ) {
    return "NON_EU_RESIDENT_ITALY";
  }
  return "NON_EU_RESIDENT_ABROAD";
}

export function mapDegreeLevel(studyLevel: string | null | undefined): DegreeLevel | typeof UNKNOWN {
  if (!studyLevel) return UNKNOWN;
  if (studyLevel === "BACHELOR") return "BACHELOR";
  if (studyLevel === "MASTER") return "MASTER";
  if (studyLevel === "SINGLE_CYCLE") return "SINGLE_CYCLE";
  if (studyLevel === "FOUNDATION") return "FOUNDATION";
  return "OTHER";
}

export function buildMatchingProfileFromStudent(student: StudentInput): MatchingProfile {
  const personal = parsePersonalAnswers(student.questionnairePersonalJson);
  const programs = parseProgramsAnswers(student.questionnaireProgramsJson);
  const mapped = mapProgramsAnswersToProfile(programs);

  const preferredCities = Array.isArray(programs.preferredCities)
    ? programs.preferredCities.filter((c) => c !== "Вся Италия")
    : parseCitiesJson(student.preferredCities);

  const excludedCities = Array.isArray(programs.avoidCities)
    ? programs.avoidCities.map(String)
    : [];

  const directions = Array.isArray(programs.preferredDirections)
    ? programs.preferredDirections.map(String)
    : [];
  if (typeof programs.otherDirections === "string" && programs.otherDirections.trim()) {
    directions.push(programs.otherDirections.trim());
  }
  if (directions.length === 0 && student.targetField) directions.push(student.targetField);

  const englishCert = asUnknown(
    typeof programs.englishCertificate === "string" ? programs.englishCertificate : null
  );
  const ielts =
    englishCert === UNKNOWN ? UNKNOWN : parseIeltsFromText(englishCert);
  const sat =
    englishCert === UNKNOWN
      ? UNKNOWN
      : parseSatFromText(englishCert);

  const dsu = String(programs.dsuScholarship ?? "");
  const needsScholarship =
    dsu === ""
      ? UNKNOWN
      : /да/i.test(dsu)
        ? true
        : /нет/i.test(dsu)
          ? false
          : UNKNOWN;

  const langPref = mapped.preferredLanguage || student.preferredLanguage;
  const preferredTeachingLanguages: string[] = [];
  const studyLang = String(programs.studyLanguage ?? "");
  if (studyLang.toLowerCase().includes("оба")) {
    preferredTeachingLanguages.push("English", "Italian");
  } else if (langPref) {
    preferredTeachingLanguages.push(langPref);
  }

  const citizenship = asUnknown(
    typeof personal.citizenship === "string"
      ? personal.citizenship
      : student.nationality
  );

  const applicantCategory = inferApplicantCategory({
    nationality: student.nationality,
    country: student.country,
    citizenship: citizenship === UNKNOWN ? null : citizenship,
  });

  const missingFields: string[] = [];
  const pushMissing = (label: string, value: unknown) => {
    if (value === UNKNOWN) missingFields.push(label);
  };

  pushMissing("Citizenship / applicant category", citizenship === UNKNOWN ? UNKNOWN : applicantCategory === "UNKNOWN" ? UNKNOWN : true);
  if (applicantCategory === "UNKNOWN") missingFields.push("Applicant category requires verification");
  pushMissing("English certificate / IELTS score", ielts);
  pushMissing("SAT score", sat);
  pushMissing("Budget / max tuition", UNKNOWN);
  if (!programs.englishLevel) missingFields.push("English level");

  const targetAcademicYear =
    normalizeAcademicYear(student.intake) || DEFAULT_TARGET_ACADEMIC_YEAR;

  return {
    studentId: student.id,
    targetAcademicYear,
    citizenship,
    secondCitizenship: UNKNOWN,
    countryOfResidence: asUnknown(student.country),
    applicantCategory,
    visaRequired: applicantCategory === "NON_EU_RESIDENT_ABROAD" ? true : applicantCategory === "UNKNOWN" ? UNKNOWN : false,
    currentEducationLevel: asUnknown(
      typeof personal.bachelorDiploma === "string" ? personal.bachelorDiploma : null
    ),
    schoolCountry: UNKNOWN,
    yearsOfSchooling: UNKNOWN,
    diplomaType: asUnknown(
      typeof personal.schoolDiploma === "string" ? personal.schoolDiploma : null
    ),
    universityDegree: asUnknown(
      typeof personal.bachelorDiploma === "string" ? personal.bachelorDiploma : null
    ),
    degreeField: asUnknown(
      typeof programs.previousSpecialty === "string" ? programs.previousSpecialty : null
    ),
    gpa: UNKNOWN,
    englishLevel: asUnknown(
      typeof programs.englishLevel === "string" ? programs.englishLevel : null
    ),
    englishCertificateRaw: englishCert,
    ielts,
    toefl: UNKNOWN,
    italianLevel: asUnknown(
      typeof programs.italianLevel === "string" ? programs.italianLevel : null
    ),
    italianCertificateRaw: asUnknown(
      typeof programs.italianCertificate === "string" ? programs.italianCertificate : null
    ),
    sat,
    tolc: {},
    desiredDegreeLevel: mapDegreeLevel(mapped.studyLevel || student.studyLevel),
    // Keep questionnaire direction labels for MIUR classe lookup; also keep
    // FieldTags for fit-score overlap with program name tags.
    fieldsOfInterest: (() => {
      const tags = tagsFromList(directions);
      const merged = [...new Set([...directions, ...tags])];
      return merged.length ? merged : directions;
    })(),
    preferredTeachingLanguages,
    preferredCities,
    preferredRegions: [
      ...new Set(preferredCities.map((c) => regionForCity(c)).filter(Boolean) as string[]),
    ],
    excludedCities,
    excludedRegions: [
      ...new Set(excludedCities.map((c) => regionForCity(c)).filter(Boolean) as string[]),
    ],
    mustBeInPreferredLocation: preferredCities.length > 0 && !Array.isArray(programs.preferredCities)
      ? false
      : Array.isArray(programs.preferredCities) && programs.preferredCities.includes("Вся Италия")
        ? false
        : preferredCities.length > 0,
    maxTuition: (() => {
      const personal = student.questionnairePersonalJson
        ? (JSON.parse(student.questionnairePersonalJson) as Record<string, string>)
        : {};
      const raw = personal.annualBudgetMax;
      const n = raw != null ? Number(String(raw).replace(/[^\d.]/g, "")) : NaN;
      return Number.isFinite(n) && n > 0 ? n : UNKNOWN;
    })(),
    needsScholarship,
    dsuPriority: needsScholarship === true,
    studyModes: ["inPerson"],
    missingFields: [...new Set(missingFields)],
  };
}
