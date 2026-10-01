/**
 * Creates or updates the owner admin. Password is read from the environment
 * and stored only as a bcrypt hash.
 *
 *   OWNER_ADMIN_EMAIL=... OWNER_ADMIN_PASSWORD=... npx tsx scripts/ensure-owner-admin.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { staffPasswordIssue, normalizeStaffEmail } from "../src/server/staff-accounts";

function loadEnvFile() {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // DATABASE_URL may already be in the environment.
  }
}

loadEnvFile();

const prisma = new PrismaClient();

async function main() {
  const email = normalizeStaffEmail(process.env.OWNER_ADMIN_EMAIL || "");
  const password = process.env.OWNER_ADMIN_PASSWORD || "";
  if (!email || !password) {
    throw new Error("Set OWNER_ADMIN_EMAIL and OWNER_ADMIN_PASSWORD.");
  }
  const issue = staffPasswordIssue(password);
  if (issue) throw new Error(issue);

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: "ADMIN", passwordHash },
    });
    console.log(`Updated admin ${email}`);
  } else {
    await prisma.user.create({
      data: {
        email,
        name: "Администратор",
        role: "ADMIN",
        passwordHash,
      },
    });
    console.log(`Created admin ${email}`);
  }

  const saved = await prisma.user.findUnique({
    where: { email },
    select: { role: true, passwordHash: true },
  });
  if (saved?.role !== "ADMIN" || !saved.passwordHash) {
    throw new Error("Admin was not saved.");
  }
  const matches = await bcrypt.compare(password, saved.passwordHash);
  if (!matches) throw new Error("Stored password hash does not match.");
  console.log(`Admin ${email} role=${saved.role} password hash verified`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
