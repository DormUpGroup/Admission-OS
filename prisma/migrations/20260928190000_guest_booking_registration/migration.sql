-- Public consultation booking stores the guest on the appointment.
-- Registration invites are emailed after a curator promotes the lead.
-- RLS with no anon/authenticated policy: Prisma uses the table owner and
-- bypasses RLS; the Data API cannot read these rows.

ALTER TABLE "Appointment" ADD COLUMN "guestName" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "guestEmail" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "meetingUrl" TEXT;

CREATE TABLE "RegistrationInvite" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RegistrationInvite_token_key" ON "RegistrationInvite"("token");
CREATE INDEX "RegistrationInvite_studentId_idx" ON "RegistrationInvite"("studentId");
CREATE INDEX "RegistrationInvite_email_idx" ON "RegistrationInvite"("email");

-- A used invite keeps its row. Only the open one blocks a second link.
CREATE UNIQUE INDEX "RegistrationInvite_one_open_per_student"
ON "RegistrationInvite" ("studentId")
WHERE "consumedAt" IS NULL;

ALTER TABLE "RegistrationInvite" ADD CONSTRAINT "RegistrationInvite_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RegistrationInvite" ENABLE ROW LEVEL SECURITY;
