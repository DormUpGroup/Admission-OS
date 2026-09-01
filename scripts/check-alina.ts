import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const alina = await p.student.findFirst({ where: { firstName: "Alina" } });
  console.log(alina?.nextActionJson);
}

main().finally(() => p.$disconnect());
