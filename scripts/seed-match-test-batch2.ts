/**
 * Upsert 5 new match-test students (F–J) and print questionnaires.
 * Run: npx tsx scripts/seed-match-test-batch2.ts
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
  personal: Record<string, string>;
  programs: Record<string, unknown>;
};

/** Five new questionnaires covering spheres not fully exercised in A–C. */
const specs: Spec[] = [
  {
    email: "match-test-f@student.local",
    firstName: "Farid",
    lastName: "Psych",
    country: "Kazakhstan",
    nationality: "Kazakhstan",
    personal: {
      firstNameLatin: "Farid",
      lastNameLatin: "Psych",
      citizenship: "Kazakhstan",
      countryOfBirth: "Kazakhstan",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Farid Psych",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "B2",
      englishCertificate: "IELTS 6.5",
      italianLevel: "A1",
      italianCertificate: "Нет",
      preferredDirections: ["Психология", "Когнитивные науки"],
      preferredCities: ["Padova", "Milano", "Bologna"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-g@student.local",
    firstName: "Greta",
    lastName: "Bio",
    country: "Russia",
    nationality: "Russia",
    personal: {
      firstNameLatin: "Greta",
      lastNameLatin: "Bio",
      citizenship: "Russia",
      countryOfBirth: "Russia",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Greta Bio",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "C1",
      englishCertificate: "IELTS 7.5",
      italianLevel: "A2",
      italianCertificate: "Нет",
      preferredDirections: [
        "Биология",
        "Промышленные биотехнологии",
      ],
      preferredCities: ["Bologna", "Milano", "Pavia"],
      avoidCities: [],
      dsuScholarship: "Нет",
    },
  },
  {
    email: "match-test-h@student.local",
    firstName: "Hasan",
    lastName: "Civil",
    country: "Turkey",
    nationality: "Turkey",
    personal: {
      firstNameLatin: "Hasan",
      lastNameLatin: "Civil",
      citizenship: "Turkey",
      countryOfBirth: "Turkey",
      schoolDiploma: "Есть",
      bachelorDiploma: "Есть",
    },
    programs: {
      fullName: "Hasan Civil",
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
      preferredCities: ["Torino", "Milano", "Genova"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-i@student.local",
    firstName: "Irina",
    lastName: "Lingua",
    country: "Ukraine",
    nationality: "Ukraine",
    personal: {
      firstNameLatin: "Irina",
      lastNameLatin: "Lingua",
      citizenship: "Ukraine",
      countryOfBirth: "Ukraine",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Irina Lingua",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Итальянский",
      englishLevel: "B1",
      englishCertificate: "Нет",
      italianLevel: "B2",
      italianCertificate: "CILS B2",
      preferredDirections: [
        "Современная филология",
        "Лингвистика",
      ],
      preferredCities: ["Roma", "Firenze", "Bologna"],
      avoidCities: [],
      dsuScholarship: "Да",
    },
  },
  {
    email: "match-test-j@student.local",
    firstName: "Julia",
    lastName: "CompEng",
    country: "Belarus",
    nationality: "Belarus",
    personal: {
      firstNameLatin: "Julia",
      lastNameLatin: "CompEng",
      citizenship: "Belarus",
      countryOfBirth: "Belarus",
      schoolDiploma: "Есть",
      bachelorDiploma: "Нет",
    },
    programs: {
      fullName: "Julia CompEng",
      studyLevelPlan: "Бакалавриат",
      studyLanguage: "Английский",
      englishLevel: "B2",
      englishCertificate: "нет",
      italianLevel: "A1",
      italianCertificate: "Нет",
      preferredDirections: ["Компьютерная инженерия", "IT безопасность"],
      preferredCities: ["Вся Италия"],
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
