-- Client-driven consultation changes stay unseen until a curator opens them.

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "clientChangeUnseen" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Appointment_clientChangeUnseen_idx"
  ON "Appointment"("clientChangeUnseen");
