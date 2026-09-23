-- Additive outbox lease fencing + IntakeCohort versioning.

ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "leaseToken" TEXT;
ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "OutboxEvent_status_leaseExpiresAt_idx"
  ON "OutboxEvent"("status", "leaseExpiresAt");

ALTER TABLE "IntakeCohort" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
