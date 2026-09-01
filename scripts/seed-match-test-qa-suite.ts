/**
 * Upsert QA suite: runs batches A–Y seeds, then adds gap-filling profiles (32+ total).
 * Run: npx tsx scripts/seed-match-test-qa-suite.ts
 */
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { mapProgramsAnswersToProfile } from "../src/lib/questionnaire-programs";
import { QA_SUITE_EMAILS } from "./qa-suite-emails";

const prisma = new PrismaClient();
const PASSWORD = "password123";

type Spec = {
  email: string;
  firstName: string;
  lastName: string;
  country: string;
  nationality: string;
  mixNote: string;
  personal: Record<string, string>;
  programs: Record<string, unknown>;
};

const extraSpecs: Spec[] = [
  {
    email: "match-test-qa-med@student.local",
    firstName: "Med",
    lastName: "SingleCycle",
    country: "Russia",
    nationality: "Russia",
    mixNote: "Single-cycle: медицина и хирургия (Italian)",
    personal: {
      firstNameLatin: "Med",
      lastNameLatin: "SingleCycle",
      citizenship: "Russia",
      countryOfBirth: "Russia",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Med SingleCycle",
      studyLevelPlan: "Single-cycle (6 лет)",
      studyLanguage: "Итальянский",
      englishLevel: "B1",
      italianLevel: "B2",
      italianCertificate: "CILS B2",
      preferredDirections: ["Медицина и хирургия"],
      preferredCities: ["Milano", "Bologna", "Padova"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-qa-dent@student.local",
    firstName: "Dent",
    lastName: "SingleCycle",
    country: "Ukraine",
    nationality: "Ukraine",
    mixNote: "Single-cycle: стоматология (Italian)",
    personal: {
      firstNameLatin: "Dent",
      lastNameLatin: "SingleCycle",
      citizenship: "Ukraine",
      countryOfBirth: "Ukraine",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Dent SingleCycle",
      studyLevelPlan: "Single-cycle (6 лет)",
      studyLanguage: "Итальянский",
      englishLevel: "A2",
      italianLevel: "B2",
      italianCertificate: "PLIDA B2",
      preferredDirections: ["Стоматология и протезирование зубов"],
      preferredCities: ["Milano", "Roma", "Torino"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-qa-pharm@student.local",
    firstName: "Pharm",
    lastName: "SingleCycle",
    country: "Belarus",
    nationality: "Belarus",
    mixNote: "Single-cycle: фармация (Italian)",
    personal: {
      firstNameLatin: "Pharm",
      lastNameLatin: "SingleCycle",
      citizenship: "Belarus",
      countryOfBirth: "Belarus",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Pharm SingleCycle",
      studyLevelPlan: "Single-cycle (5 лет)",
      studyLanguage: "Итальянский",
      englishLevel: "B1",
      italianLevel: "B2",
      preferredDirections: ["Фармацевтика"],
      preferredCities: ["Milano", "Bologna", "Napoli"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-qa-budget@student.local",
    firstName: "Budget",
    lastName: "Known",
    country: "Kazakhstan",
    nationality: "Kazakhstan",
    mixNote: "Бюджет известен: max 3000 EUR/year",
    personal: {
      firstNameLatin: "Budget",
      lastNameLatin: "Known",
      citizenship: "Kazakhstan",
      countryOfBirth: "Kazakhstan",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
      annualBudgetMax: "3000",
    },
    programs: {
      fullName: "Budget Known",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "B2",
      preferredDirections: ["Экономические науки"],
      preferredCities: ["Bologna", "Milano"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-qa-nobudget@student.local",
    firstName: "Budget",
    lastName: "Unknown",
    country: "Georgia",
    nationality: "Georgia",
    mixNote: "Бюджет неизвестен",
    personal: {
      firstNameLatin: "Budget",
      lastNameLatin: "Unknown",
      citizenship: "Georgia",
      countryOfBirth: "Georgia",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Budget Unknown",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "B2",
      preferredDirections: ["Экономические науки"],
      preferredCities: ["Вся Италия"],
      avoidCities: [],
      dsuScholarship: "Нет",
    },
  },
  {
    email: "match-test-qa-megamix@student.local",
    firstName: "Mega",
    lastName: "Mix",
    country: "Russia",
    nationality: "Russia",
    mixNote: "5 направлений: psych+cog+CS+bio+humanities",
    personal: {
      firstNameLatin: "Mega",
      lastNameLatin: "Mix",
      citizenship: "Russia",
      countryOfBirth: "Russia",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Mega Mix",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "B2",
      preferredDirections: [
        "Психология",
        "Когнитивные науки",
        "Компьютерные технологии",
        "Биология",
        "Компьютерные методологии для гуманитарных наук",
      ],
      preferredCities: ["Milano", "Bologna", "Torino"],
      avoidCities: ["Napoli"],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-qa-bothlang@student.local",
    firstName: "Both",
    lastName: "Lang",
    country: "Italy",
    nationality: "Russia",
    mixNote: "Оба языка: филология + лингвистика",
    personal: {
      firstNameLatin: "Both",
      lastNameLatin: "Lang",
      citizenship: "Russia",
      countryOfBirth: "Russia",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Both Lang",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Рассматриваю оба варианта",
      englishLevel: "B2",
      italianLevel: "B2",
      preferredDirections: [
        "Филология, литература и история древности",
        "Лингвистика",
      ],
      preferredCities: ["Bologna", "Padova", "Roma"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
];

async function upsertSpec(spec: Spec, curatorId: string, passwordHash: string) {
  const mapped = mapProgramsAnswersToProfile(
    spec.programs as Parameters<typeof mapProgramsAnswersToProfile>[0]
  );
  const now = new Date();
  const user = await prisma.user.upsert({
    where: { email: spec.email },
    create: {
      email: spec.email,
      name: `${spec.firstName} ${spec.lastName}`,
      role: "STUDENT",
      passwordHash,
    },
    update: { name: `${spec.firstName} ${spec.lastName}`, passwordHash },
  });
  await prisma.student.upsert({
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
      curatorId,
      questionnaireAt: now,
      questionnaireProgramsAt: now,
      questionnairePersonalJson: JSON.stringify(spec.personal),
      questionnaireProgramsJson: JSON.stringify(spec.programs),
    },
    update: {
      userId: user.id,
      studyLevel: mapped.studyLevel,
      preferredLanguage: mapped.preferredLanguage,
      targetField: mapped.targetField,
      preferredCities: JSON.stringify(mapped.preferredCities),
      intake: "2027/28",
      journeyStage: "PROGRAMS",
      curatorId,
      questionnaireAt: now,
      questionnaireProgramsAt: now,
      questionnairePersonalJson: JSON.stringify(spec.personal),
      questionnaireProgramsJson: JSON.stringify(spec.programs),
    },
  });
  console.log("Upserted QA profile:", spec.email, "—", spec.mixNote);
}

async function main() {
  const seeds = [
    "scripts/seed-match-test-students.ts",
    "scripts/seed-match-test-batch2.ts",
    "scripts/seed-match-test-batch3.ts",
    "scripts/seed-match-test-batch4.ts",
  ];
  for (const script of seeds) {
    console.log("Running", script);
    execSync(`npx tsx ${script}`, { stdio: "inherit", cwd: process.cwd() });
  }

  const curator =
    (await prisma.user.findFirst({ where: { role: "CURATOR" } })) ??
    (await prisma.user.findFirst({ where: { role: "ADMIN" } }));
  if (!curator) {
    console.error("No curator/admin — run npm run db:seed first");
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const spec of extraSpecs) {
    await upsertSpec(spec, curator.id, passwordHash);
  }
  console.log("QA suite ready:", QA_SUITE_EMAILS.length, "profiles");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
