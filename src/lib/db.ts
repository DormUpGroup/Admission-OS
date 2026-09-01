import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrisma() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function hasIntakeCohort(client: PrismaClient) {
  return typeof (client as { intakeCohort?: { findMany?: unknown } }).intakeCohort
    ?.findMany === "function";
}

function getPrisma() {
  const existing = globalForPrisma.prisma;
  if (existing && hasIntakeCohort(existing)) return existing;
  const client = createPrisma();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }
  return client;
}

export const prisma = getPrisma();
