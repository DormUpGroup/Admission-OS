/**
 * Upsert 5 fresh match-test students (K–O) after deleting old batch.
 * Run: npx tsx scripts/delete-match-test-students.ts && npx tsx scripts/seed-match-test-batch3.ts
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { mapProgramsAnswersToProfile } from "../src/lib/questionnaire-programs";
import { QUESTIONNAIRE_DIRECTION_MIUR } from "../src/lib/program-directions";

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

/** Five clean single-sphere questionnaires for precision evaluation. */
const specs: Spec[] = [
  {
    email: "match-test-k@student.local",
    firstName: "Karina",
    lastName: "PsychOnly",
    country: "Kazakhstan",
    nationality: "Kazakhstan",
    mixNote: "Только психология (без когнитивных / биологии)",
    personal: {
      firstNameLatin: "Karina",
      lastNameLatin: "PsychOnly",
      citizenship: "Kazakhstan",
      countryOfBirth: "Kazakhstan",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Karina PsychOnly",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "B2",
      englishCertificate: "IELTS 6.5",
      italianLevel: "A1",
      italianCertificate: "Нет",
      preferredDirections: ["Психология"],
      preferredCities: ["Padova", "Milano", "Bologna"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-l@student.local",
    firstName: "Leon",
    lastName: "CSOnly",
    country: "Uzbekistan",
    nationality: "Uzbekistan",
    mixNote: "Только компьютерные технологии (без экономики)",
    personal: {
      firstNameLatin: "Leon",
      lastNameLatin: "CSOnly",
      citizenship: "Uzbekistan",
      countryOfBirth: "Uzbekistan",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Leon CSOnly",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "B2",
      englishCertificate: "IELTS 6.0",
      italianLevel: "A1",
      italianCertificate: "Нет",
      preferredDirections: ["Компьютерные технологии"],
      preferredCities: ["Bologna", "Milano", "Torino"],
      avoidCities: [],
      dsuScholarship: "Нет",
    },
  },
  {
    email: "match-test-m@student.local",
    firstName: "Marco",
    lastName: "EconOnly",
    country: "Russia",
    nationality: "Russia",
    mixNote: "Только экономические науки",
    personal: {
      firstNameLatin: "Marco",
      lastNameLatin: "EconOnly",
      citizenship: "Russia",
      countryOfBirth: "Russia",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Marco EconOnly",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "B2",
      englishCertificate: "IELTS 6.5",
      italianLevel: "A2",
      italianCertificate: "Нет",
      preferredDirections: ["Экономические науки"],
      preferredCities: ["Bologna", "Roma", "Milano"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-n@student.local",
    firstName: "Nina",
    lastName: "Physics",
    country: "Ukraine",
    nationality: "Ukraine",
    mixNote: "Физика бакалавриат",
    personal: {
      firstNameLatin: "Nina",
      lastNameLatin: "Physics",
      citizenship: "Ukraine",
      countryOfBirth: "Ukraine",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Nina Physics",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "C1",
      englishCertificate: "IELTS 7.0",
      italianLevel: "A2",
      italianCertificate: "Нет",
      preferredDirections: ["Физика"],
      preferredCities: ["Pisa", "Roma", "Torino"],
      avoidCities: [],
      dsuScholarship: "Нет",
    },
  },
  {
    email: "match-test-o@student.local",
    firstName: "Olga",
    lastName: "Design",
    country: "Belarus",
    nationality: "Belarus",
    mixNote: "Дизайн, итальянский язык",
    personal: {
      firstNameLatin: "Olga",
      lastNameLatin: "Design",
      citizenship: "Belarus",
      countryOfBirth: "Belarus",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Olga Design",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Итальянский",
      englishLevel: "B1",
      englishCertificate: "Нет",
      italianLevel: "B2",
      italianCertificate: "CILS B2",
      preferredDirections: ["Дизайн"],
      preferredCities: ["Milano", "Firenze", "Roma"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
];

async function main() {
  const existing = await prisma.student.count();
  console.log("Existing students:", existing);
  if (existing === 0) {
    console.error("No students — run npm run db:seed first");
    process.exit(1);
  }

  const curator =
    (await prisma.user.findFirst({ where: { role: "CURATOR" } })) ??
    (await prisma.user.findFirst({ where: { role: "ADMIN" } }));
  if (!curator) {
    console.error("No curator/admin");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const now = new Date();

  for (const spec of specs) {
    const dirs = (spec.programs.preferredDirections as string[]) ?? [];
    for (const d of dirs) {
      if (!QUESTIONNAIRE_DIRECTION_MIUR[d]) {
        console.warn("WARN unknown direction label:", d);
      } else {
        console.log(
          "MIUR",
          d,
          "→",
          QUESTIONNAIRE_DIRECTION_MIUR[d].bachelor.length
            ? QUESTIONNAIRE_DIRECTION_MIUR[d].bachelor
            : QUESTIONNAIRE_DIRECTION_MIUR[d].singleCycle,
          "/",
          QUESTIONNAIRE_DIRECTION_MIUR[d].master
        );
      }
    }

    const mapped = mapProgramsAnswersToProfile(
      spec.programs as Parameters<typeof mapProgramsAnswersToProfile>[0]
    );

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
      note: spec.mixNote,
      studyLevel: student.studyLevel,
      lang: student.preferredLanguage,
      field: student.targetField,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
