-- Website booking links. The token is an unguessable URL secret, not a sequence.
-- RLS with no anon/authenticated policy: Prisma uses the table owner and
-- bypasses RLS; the Data API cannot read these rows.

CREATE TABLE "BookingInvite" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "leadId" TEXT,
    "studentId" TEXT,
    "curatorId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "appointmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BookingInvite_token_key" ON "BookingInvite"("token");
CREATE UNIQUE INDEX "BookingInvite_appointmentId_key" ON "BookingInvite"("appointmentId");
CREATE INDEX "BookingInvite_conversationId_expiresAt_idx" ON "BookingInvite"("conversationId", "expiresAt");
CREATE INDEX "BookingInvite_leadId_idx" ON "BookingInvite"("leadId");
CREATE INDEX "BookingInvite_studentId_idx" ON "BookingInvite"("studentId");
CREATE INDEX "BookingInvite_curatorId_idx" ON "BookingInvite"("curatorId");

-- A booked invite keeps its row. Only the open one blocks a second link.
CREATE UNIQUE INDEX "BookingInvite_one_open_per_conversation"
ON "BookingInvite" ("conversationId")
WHERE "appointmentId" IS NULL;

ALTER TABLE "BookingInvite" ADD CONSTRAINT "BookingInvite_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingInvite" ADD CONSTRAINT "BookingInvite_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingInvite" ADD CONSTRAINT "BookingInvite_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BookingInvite" ADD CONSTRAINT "BookingInvite_curatorId_fkey" FOREIGN KEY ("curatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BookingInvite" ADD CONSTRAINT "BookingInvite_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BookingInvite" ENABLE ROW LEVEL SECURITY;
