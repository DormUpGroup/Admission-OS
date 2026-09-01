/**
 * One manual-test student for curator UI matching.
 * Run: npx tsx scripts/seed-manual-test-student.ts
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { mapProgramsAnswersToProfile } from "../src/lib/questionnaire-programs";

const prisma = new PrismaClient();
const PASSWORD = "password123";

const EMAIL = "manual-demo@student.local";

const spec = {
  email: EMAIL,
  firstName: "Diana",
  lastName: "ManualDemo",
  country: "Georgia",
  nationality: "Georgia",
  personal: {
    firstNameLatin: "Diana",
    lastNameLatin: "ManualDemo",
    citizenship: "Georgia",
    countryOfBirth: "Georgia",
    schoolDiploma: "Есть",
    bachelorDiploma: "Нет",
  },
  programs: {
    fullName: "Diana ManualDemo",
    studyLevelPlan: "Бакалавриат",
    studyLanguage: "Английский",
    englishLevel: "B2",
    englishCertificate: "IELTS 6.5",
    italianLevel: "A2",
    italianCertificate: "Нет",
    preferredDirections: [
      "Экономические науки",
      "Компьютерные технологии",
    ],
    preferredCities: ["Milano", "Bologna", "Torino"],
    avoidCities: [],
    dsuScholarship: "Да",
  },
};

async function main() {
  const curator =
    (await prisma.user.findFirst({ where: { role: "CURATOR" } })) ??
    (await prisma.user.findFirst({ where: { role: "ADMIN" } }));
  if (!curator) {
    console.error("No curator/admin — run npm run db:seed first");
    process.exit(1);
  }

  const mapped = mapProgramsAnswersToProfile(
    spec.programs as Parameters<typeof mapProgramsAnswersToProfile>[0]
  );
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const now = new Date();

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

  // Clear old auto-matches so manual run starts fresh
  await prisma.programMatch.deleteMany({
    where: {
      studentId: student.id,
      curatorStatus: { in: ["AUTO_MATCHED", "NEEDS_REVIEW"] },
    },
  });

  console.log("\n=== Manual demo student ready ===");
  console.log("Name:", `${student.firstName} ${student.lastName}`);
  console.log("Email:", student.email);
  console.log("Password:", PASSWORD);
  console.log("Student ID:", student.id);
  console.log("Directions:", spec.programs.preferredDirections);
  console.log("Cities:", spec.programs.preferredCities);
  console.log("Language:", spec.programs.studyLanguage);
  console.log("\nOpen admin → Students → Diana ManualDemo → tab Match → Generate Program Matches");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
