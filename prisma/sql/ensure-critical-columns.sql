-- Idempotent safety net for live Railway boots when migrate history
-- and the physical schema diverge (or Start Command was overridden).

ALTER TABLE "IntakeCohort" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Application" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "leaseToken" TEXT;
ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);
