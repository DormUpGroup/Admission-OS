/**
 * Upsert 5 match-test students with questionnaires.
 * Directions are intentionally cross-sphere (OR matching — any one direction is enough).
 * Cap in engine: UNIVERSITALY_MAX_DIRECTION_QUERIES = 3.
 *
 * Run: npx tsx scripts/seed-match-test-students.ts
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { mapProgramsAnswersToProfile } from "../src/lib/questionnaire-programs";

const prisma = new PrismaClient();

const PASSWORD = "password123";

type Spec = {
  email: string;
  firstName: string;
  lastName: string;
  country: string;
  nationality: string;
  /** Short note for ops / batch reports */
  mixNote: string;
  personal: Record<string, string>;
  programs: Record<string, unknown>;
};

/**
 * Multi-direction mixes (different spheres), as real applicants often choose.
 * Labels must match PROGRAM_DIRECTIONS in program-directions.ts.
 */
const specs: Spec[] = [
  {
    email: "match-test-a@student.local",
    firstName: "Amina",
    lastName: "EconCS",
    country: "Kazakhstan",
    nationality: "Kazakhstan",
    mixNote: "Экономика + Компьютерные технологии",
    personal: {
      firstNameLatin: "Amina",
      lastNameLatin: "EconCS",
      citizenship: "Kazakhstan",
      countryOfBirth: "Kazakhstan",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Amina EconCS",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "C1",
      englishCertificate: "IELTS 7.0, SAT 1280",
      italianLevel: "A2",
      italianCertificate: "Нет",
      otherLanguages: "Russian C2",
      studyAbroad: "Нет",
      previousSpecialty: "Economics",
      preferredDirections: [
        "Экономические науки",
        "Компьютерные технологии",
      ],
      preferredCities: ["Bologna", "Turin", "Milano"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-b@student.local",
    firstName: "Boris",
    lastName: "BioCS",
    country: "Russia",
    nationality: "Russia",
    mixNote: "Биология + Компьютерные технологии",
    personal: {
      firstNameLatin: "Boris",
      lastNameLatin: "BioCS",
      citizenship: "Russia",
      countryOfBirth: "Russia",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Boris BioCS",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "B2",
      englishCertificate: "нет",
      italianLevel: "A1",
      italianCertificate: "Нет",
      preferredDirections: ["Биология", "Компьютерные технологии"],
      preferredCities: ["Вся Италия"],
      avoidCities: [],
      dsuScholarship: "Нет",
    },
  },
  {
    email: "match-test-c@student.local",
    firstName: "Clara",
    lastName: "MedChem",
    country: "Ukraine",
    nationality: "Ukraine",
    mixNote: "Медицина и хирургия + Химические науки",
    personal: {
      firstNameLatin: "Clara",
      lastNameLatin: "MedChem",
      citizenship: "Ukraine",
      countryOfBirth: "Ukraine",
      schoolDiploma: "Есть",
      bachelorDiploma: "Есть",
    },
    programs: {
      fullName: "Clara MedChem",
      studyLevelPlan: "Магистратура",
      studyLanguage: "Английский",
      englishLevel: "C1",
      englishCertificate: "C1",
      italianLevel: "A2",
      italianCertificate: "Нет",
      previousSpecialty: "Biology",
      preferredDirections: [
        "Медицина и хирургия",
        "Химические науки",
      ],
      preferredCities: ["Turin", "Milano"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-d@student.local",
    firstName: "Daria",
    lastName: "MedCS",
    country: "Belarus",
    nationality: "Belarus",
    mixNote: "Медицина и хирургия + Компьютерные технологии",
    personal: {
      firstNameLatin: "Daria",
      lastNameLatin: "MedCS",
      citizenship: "Belarus",
      countryOfBirth: "Belarus",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Daria MedCS",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Итальянский",
      englishLevel: "B1",
      englishCertificate: "Нет",
      italianLevel: "B2",
      italianCertificate: "CILS B2",
      previousSpecialty: "Science",
      preferredDirections: [
        "Медицина и хирургия",
        "Компьютерные технологии",
      ],
      preferredCities: ["Milano", "Roma"],
      avoidCities: ["Napoli"],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-e@student.local",
    firstName: "Elena",
    lastName: "ChemCS",
    country: "Georgia",
    nationality: "Georgia",
    mixNote: "Химические науки + Компьютерные технологии (оба языка)",
    personal: {
      firstNameLatin: "Elena",
      lastNameLatin: "ChemCS",
      citizenship: "Georgia",
      countryOfBirth: "Georgia",
      schoolDiploma: "Есть",
      bachelorDiploma: "Есть",
    },
    programs: {
      fullName: "Elena ChemCS",
      studyLevelPlan: "Магистратура",
      studyLanguage: "Рассматриваю оба варианта",
      englishLevel: "C1",
      englishCertificate: "IELTS 6.5",
      italianLevel: "B1",
      italianCertificate: "Нет",
      previousSpecialty: "Chemistry",
      preferredDirections: [
        "Химические науки",
        "Компьютерные технологии",
        "Химическая инженерия",
      ],
      preferredCities: ["Roma", "Bologna", "Firenze"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
];

async function main() {
  const existing = await prisma.student.count();
  console.log("Existing students:", existing);

  if (existing === 0) {
    console.log("No students — run npm run db:seed first");
    process.exit(1);
  }

  const curator =
    (await prisma.user.findFirst({ where: { role: "CURATOR" } })) ??
    (await prisma.user.findFirst({ where: { role: "ADMIN" } }));

  if (!curator) {
    console.error("No curator/admin user found. Seed the DB first.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const now = new Date();

  for (const spec of specs) {
    const mapped = mapProgramsAnswersToProfile(
      spec.programs as Parameters<typeof mapProgramsAnswersToProfile>[0]
    );
    const directions = Array.isArray(spec.programs.preferredDirections)
      ? (spec.programs.preferredDirections as string[])
      : [];

    const user = await prisma.user.upsert({
      where: { email: spec.email },
      create: {
        email: spec.email,
        name: `${spec.firstName} ${spec.lastName}`,
        role: "STUDENT",
        passwordHash,
      },
      update: {
        name: `${spec.firstName} ${spec.lastName}`,
        passwordHash,
      },
    });

    const student = await prisma.student.upsert({
      where: { email: spec.email },
      create: {
        userId: user.id,
        firstName: spec.firstName,
        lastName: spec.lastName,
        email: spec.email,
        country: spec.country,
        nationality: spec.nationality,
        studyLevel: mapped.studyLevel,
        preferredLanguage: mapped.preferredLanguage,
        targetField: mapped.targetField,
        preferredCities: JSON.stringify(mapped.preferredCities),
        intake: "2027/28",
        status: "ACTIVE",
        journeyStage: "PROGRAMS",
        curatorId: curator.id,
        questionnaireAt: now,
        questionnaireProgramsAt: now,
        questionnairePersonalJson: JSON.stringify(spec.personal),
        questionnaireProgramsJson: JSON.stringify(spec.programs),
      },
      update: {
        userId: user.id,
        firstName: spec.firstName,
        lastName: spec.lastName,
        country: spec.country,
        nationality: spec.nationality,
        studyLevel: mapped.studyLevel,
        preferredLanguage: mapped.preferredLanguage,
        targetField: mapped.targetField,
        preferredCities: JSON.stringify(mapped.preferredCities),
        intake: "2027/28",
        journeyStage: "PROGRAMS",
        curatorId: curator.id,
        questionnaireAt: now,
        questionnaireProgramsAt: now,
        questionnairePersonalJson: JSON.stringify(spec.personal),
        questionnaireProgramsJson: JSON.stringify(spec.programs),
      },
    });

    console.log("Upserted", {
      email: student.email,
      id: student.id,
      mix: spec.mixNote,
      directions,
      studyLevel: student.studyLevel,
      targetField: student.targetField,
      cities: mapped.preferredCities,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
