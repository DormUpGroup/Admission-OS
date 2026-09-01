import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const students = await p.student.count();
  const applications = await p.application.count();
  const documents = await p.document.count();
  const requirements = await p.requirement.count();
  const tasks = await p.task.count();
  const deadlines = await p.deadline.count();
  const alina = await p.student.findFirst({
    where: { firstName: "Alina" },
    include: { applications: { include: { requirements: true } } },
  });
  console.log({ students, applications, documents, requirements, tasks, deadlines });
  console.log("Alina", {
    apps: alina?.applications.length,
    risk: alina?.riskLevel,
    next: alina?.nextActionJson?.slice(0, 160),
    bolognaReqs: alina?.applications[0]?.requirements.map((r) => `${r.name}:${r.status}`),
  });
}

main()
  .finally(() => p.$disconnect());
