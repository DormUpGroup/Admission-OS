-- Phase 2: Appointment.leadId for Telegram leads

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "leadId" TEXT;

CREATE INDEX IF NOT EXISTS "Appointment_leadId_startsAt_idx" ON "Appointment"("leadId", "startsAt");

DO $$ BEGIN
  ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
