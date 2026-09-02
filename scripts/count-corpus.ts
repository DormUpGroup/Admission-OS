/** One-off: print program corpus counts for QA scope verification. */
import { PrismaClient } from "@prisma/client";
import { QA_SUITE_EMAILS } from "./qa-suite-emails";

const prisma = new PrismaClient();

async function main() {
  const [programs, universities, qaFound] = await Promise.all([
    prisma.program.count(),
    prisma.university.count(),
    prisma.student.count({ where: { email: { in: QA_SUITE_EMAILS } } }),
  ]);
  console.log(
    JSON.stringify(
      {
        programs,
        universities,
        qaProfilesExpected: QA_SUITE_EMAILS.length,
        qaProfilesFound: qaFound,
        scope: "full-base (no university filter)",
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
