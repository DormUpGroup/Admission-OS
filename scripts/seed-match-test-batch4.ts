/**
 * Upsert 10 match-test students (P–Y), including multi-direction mixes.
 * Run: npx tsx scripts/seed-match-test-batch4.ts
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

const specs: Spec[] = [
  {
    email: "match-test-p@student.local",
    firstName: "Pavel",
    lastName: "Arch",
    country: "Russia",
    nationality: "Russia",
    mixNote: "Одна сфера: архитектура",
    personal: {
      firstNameLatin: "Pavel",
      lastNameLatin: "Arch",
      citizenship: "Russia",
      countryOfBirth: "Russia",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Pavel Arch",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "B2",
      englishCertificate: "IELTS 6.5",
      italianLevel: "A1",
      italianCertificate: "Нет",
      preferredDirections: ["Архитектура и строительная инженерия-архитектура"],
      preferredCities: ["Milano", "Roma", "Firenze"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-q@student.local",
    firstName: "Qira",
    lastName: "EconFin",
    country: "Kazakhstan",
    nationality: "Kazakhstan",
    mixNote: "Микс: экономика + финансы",
    personal: {
      firstNameLatin: "Qira",
      lastNameLatin: "EconFin",
      citizenship: "Kazakhstan",
      countryOfBirth: "Kazakhstan",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Qira EconFin",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "B2",
      englishCertificate: "IELTS 6.0",
      italianLevel: "A2",
      italianCertificate: "Нет",
      preferredDirections: ["Экономические науки", "Финансы"],
      preferredCities: ["Bologna", "Milano", "Roma"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-r@student.local",
    firstName: "Rustam",
    lastName: "CompSec",
    country: "Uzbekistan",
    nationality: "Uzbekistan",
    mixNote: "Микс: компьютерная инженерия + IT безопасность",
    personal: {
      firstNameLatin: "Rustam",
      lastNameLatin: "CompSec",
      citizenship: "Uzbekistan",
      countryOfBirth: "Uzbekistan",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Rustam CompSec",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "B2",
      englishCertificate: "IELTS 6.5",
      italianLevel: "A1",
      italianCertificate: "Нет",
      preferredDirections: ["Компьютерная инженерия", "IT безопасность"],
      preferredCities: ["Torino", "Milano", "Bologna"],
      avoidCities: [],
      dsuScholarship: "Нет",
    },
  },
  {
    email: "match-test-s@student.local",
    firstName: "Sara",
    lastName: "IR",
    country: "Turkey",
    nationality: "Turkey",
    mixNote: "Одна сфера: международные отношения",
    personal: {
      firstNameLatin: "Sara",
      lastNameLatin: "IR",
      citizenship: "Turkey",
      countryOfBirth: "Turkey",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Sara IR",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "C1",
      englishCertificate: "IELTS 7.0",
      italianLevel: "B1",
      italianCertificate: "Нет",
      preferredDirections: ["Международные отношения"],
      preferredCities: ["Roma", "Bologna", "Milano"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-t@student.local",
    firstName: "Tamara",
    lastName: "PsychCog",
    country: "Ukraine",
    nationality: "Ukraine",
    mixNote: "Микс: психология + когнитивные науки",
    personal: {
      firstNameLatin: "Tamara",
      lastNameLatin: "PsychCog",
      citizenship: "Ukraine",
      countryOfBirth: "Ukraine",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Tamara PsychCog",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "B2",
      englishCertificate: "IELTS 6.5",
      italianLevel: "A2",
      italianCertificate: "Нет",
      preferredDirections: ["Психология", "Когнитивные науки"],
      preferredCities: ["Padova", "Milano", "Bologna"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-u@student.local",
    firstName: "Ulugbek",
    lastName: "Math",
    country: "Uzbekistan",
    nationality: "Uzbekistan",
    mixNote: "Одна сфера: математика",
    personal: {
      firstNameLatin: "Ulugbek",
      lastNameLatin: "Math",
      citizenship: "Uzbekistan",
      countryOfBirth: "Uzbekistan",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Ulugbek Math",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "B2",
      englishCertificate: "IELTS 6.0",
      italianLevel: "A1",
      italianCertificate: "Нет",
      preferredDirections: ["Математика"],
      preferredCities: ["Pisa", "Torino", "Milano"],
      avoidCities: [],
      dsuScholarship: "Нет",
    },
  },
  {
    email: "match-test-v@student.local",
    firstName: "Vera",
    lastName: "BioTech",
    country: "Belarus",
    nationality: "Belarus",
    mixNote: "Микс: биология + промышленные биотехнологии",
    personal: {
      firstNameLatin: "Vera",
      lastNameLatin: "BioTech",
      citizenship: "Belarus",
      countryOfBirth: "Belarus",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Vera BioTech",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "B2",
      englishCertificate: "IELTS 6.5",
      italianLevel: "A1",
      italianCertificate: "Нет",
      preferredDirections: ["Биология", "Промышленные биотехнологии"],
      preferredCities: ["Bologna", "Milano", "Pavia"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-w@student.local",
    firstName: "Waleed",
    lastName: "CivilM",
    country: "Egypt",
    nationality: "Egypt",
    mixNote: "Магистратура: гражданское строительство + инженерия систем",
    personal: {
      firstNameLatin: "Waleed",
      lastNameLatin: "CivilM",
      citizenship: "Egypt",
      countryOfBirth: "Egypt",
      schoolDiploma: "Есть",
      bachelorDiploma: "Есть",
    },
    programs: {
      fullName: "Waleed CivilM",
      studyLevelPlan: "Магистратура",
      studyLanguage: "Английский",
      englishLevel: "C1",
      englishCertificate: "IELTS 7.0",
      italianLevel: "B1",
      italianCertificate: "Нет",
      previousSpecialty: "Civil Engineering",
      preferredDirections: [
        "Гражданское строительство",
        "Инженерия строительных систем",
      ],
      preferredCities: ["Torino", "Genova", "Milano"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-x@student.local",
    firstName: "Xenia",
    lastName: "Lingua",
    country: "Russia",
    nationality: "Russia",
    mixNote: "Микс: филология + лингвистика (IT)",
    personal: {
      firstNameLatin: "Xenia",
      lastNameLatin: "Lingua",
      citizenship: "Russia",
      countryOfBirth: "Russia",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Xenia Lingua",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Итальянский",
      englishLevel: "B1",
      englishCertificate: "Нет",
      italianLevel: "B2",
      italianCertificate: "CILS B2",
      preferredDirections: ["Современная филология", "Лингвистика"],
      preferredCities: ["Roma", "Firenze", "Bologna"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-y@student.local",
    firstName: "Yana",
    lastName: "EconCS",
    country: "Kazakhstan",
    nationality: "Kazakhstan",
    mixNote: "Стресс-микс: экономика + компьютерные технологии",
    personal: {
      firstNameLatin: "Yana",
      lastNameLatin: "EconCS",
      citizenship: "Kazakhstan",
      countryOfBirth: "Kazakhstan",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Yana EconCS",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "B2",
      englishCertificate: "IELTS 6.5",
      italianLevel: "A2",
      italianCertificate: "Нет",
      preferredDirections: ["Экономические науки", "Компьютерные технологии"],
      preferredCities: ["Milano", "Bologna", "Torino"],
      avoidCities: [],
      dsuScholarship: "Нет",
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
