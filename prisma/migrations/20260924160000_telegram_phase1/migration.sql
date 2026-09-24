-- Phase 1: Telegram Lead / ChannelIdentity / InboxEvent + Conversation.leadId

CREATE TABLE IF NOT EXISTS "Lead" (
    "id" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "source" TEXT NOT NULL DEFAULT 'TELEGRAM',
    "locale" TEXT,
    "consentStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "consentAt" TIMESTAMP(3),
    "qualificationJson" JSONB,
    "assignedCuratorId" TEXT,
    "convertedStudentId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChannelIdentity" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "leadId" TEXT,
    "studentId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InboxEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "InboxEvent_pkey" PRIMARY KEY ("id")
);

-- Conversation.leadId (Phase 0 table may already exist without this column)
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "leadId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Lead_convertedStudentId_key" ON "Lead"("convertedStudentId");
CREATE INDEX IF NOT EXISTS "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Lead_assignedCuratorId_status_idx" ON "Lead"("assignedCuratorId", "status");
CREATE INDEX IF NOT EXISTS "Lead_email_idx" ON "Lead"("email");
CREATE INDEX IF NOT EXISTS "Lead_phone_idx" ON "Lead"("phone");

CREATE UNIQUE INDEX IF NOT EXISTS "ChannelIdentity_channel_externalId_key" ON "ChannelIdentity"("channel", "externalId");
CREATE INDEX IF NOT EXISTS "ChannelIdentity_leadId_idx" ON "ChannelIdentity"("leadId");
CREATE INDEX IF NOT EXISTS "ChannelIdentity_studentId_idx" ON "ChannelIdentity"("studentId");

CREATE UNIQUE INDEX IF NOT EXISTS "InboxEvent_provider_providerEventId_key" ON "InboxEvent"("provider", "providerEventId");
CREATE INDEX IF NOT EXISTS "InboxEvent_status_receivedAt_idx" ON "InboxEvent"("status", "receivedAt");

CREATE INDEX IF NOT EXISTS "Conversation_leadId_status_idx" ON "Conversation"("leadId", "status");

DO $$ BEGIN
  ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedCuratorId_fkey" FOREIGN KEY ("assignedCuratorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Lead" ADD CONSTRAINT "Lead_convertedStudentId_fkey" FOREIGN KEY ("convertedStudentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ChannelIdentity" ADD CONSTRAINT "ChannelIdentity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ChannelIdentity" ADD CONSTRAINT "ChannelIdentity_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
