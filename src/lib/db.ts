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
  // Always pin on globalThis: serverless/hot-reload otherwise spawn
  // multiple clients and interactive transactions can die mid-request.
  globalForPrisma.prisma = client;
  return client;
}

export const prisma = getPrisma();
