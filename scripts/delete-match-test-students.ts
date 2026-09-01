/**
 * Delete all match-test-* students and their user accounts.
 * Run: npx tsx scripts/delete-match-test-students.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const students = await prisma.student.findMany({
    where: { email: { startsWith: "match-test-" } },
    select: { id: true, email: true, userId: true },
  });

  if (students.length === 0) {
    console.log("No match-test students found.");
    return;
  }

  console.log("Deleting", students.length, "match-test students…");
  for (const s of students) {
    await prisma.student.delete({ where: { id: s.id } });
    console.log("  deleted student", s.email);
    if (s.userId) {
      await prisma.user.delete({ where: { id: s.userId } }).catch(() => {
        console.warn("  could not delete user for", s.email);
      });
    }
  }
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
