-- Accompaniment enrollment: explicit decision status + per-intake seat limit.
-- Existing students stay NONE (not accepted). Apply via `npx prisma db push`.

CREATE TABLE IF NOT EXISTS "IntakeCohort" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "intake" TEXT NOT NULL,
    "seatLimit" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "IntakeCohort_intake_key" ON "IntakeCohort"("intake");
