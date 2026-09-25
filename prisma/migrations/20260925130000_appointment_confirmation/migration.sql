-- Appointment client confirmation + pending reschedule fields

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "pendingStartsAt" TIMESTAMP(3);
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "pendingEndsAt" TIMESTAMP(3);
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "confirmationToken" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "confirmationRequestedAt" TIMESTAMP(3);
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "lastClientNudgeAt" TIMESTAMP(3);
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "curatorNudgeSentAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_confirmationToken_key"
  ON "Appointment"("confirmationToken");
