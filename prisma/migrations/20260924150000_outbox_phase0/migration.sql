-- Phase 0: transactional outbox + conversation/appointment scaffolding

CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "studentId" TEXT,
    "assignedCuratorId" TEXT,
    "hermesSessionId" TEXT,
    "automationPausedAt" TIMESTAMP(3),
    "automationPauseReason" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "clientRequestId" TEXT,
    "legacyActivityId" TEXT,
    "providerMessageId" TEXT,
    "direction" TEXT NOT NULL,
    "senderType" TEXT NOT NULL,
    "senderUserId" TEXT,
    "body" TEXT,
    "attachmentsJson" JSONB,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
    "policyStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "replyToMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "studentId" TEXT,
    "conversationId" TEXT,
    "assignedCuratorId" TEXT,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Rome',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "googleEventId" TEXT,
    "participantsJson" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "payloadJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "outboxEventId" TEXT,
    "provider" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "providerResponseId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- Conversation indexes / FKs
CREATE INDEX "Conversation_studentId_status_idx" ON "Conversation"("studentId", "status");
CREATE INDEX "Conversation_assignedCuratorId_status_idx" ON "Conversation"("assignedCuratorId", "status");
CREATE INDEX "Conversation_channel_status_idx" ON "Conversation"("channel", "status");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedCuratorId_fkey" FOREIGN KEY ("assignedCuratorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ConversationMessage indexes / FKs
CREATE UNIQUE INDEX "ConversationMessage_clientRequestId_key" ON "ConversationMessage"("clientRequestId");
CREATE UNIQUE INDEX "ConversationMessage_legacyActivityId_key" ON "ConversationMessage"("legacyActivityId");
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");
CREATE INDEX "ConversationMessage_deliveryStatus_createdAt_idx" ON "ConversationMessage"("deliveryStatus", "createdAt");
CREATE UNIQUE INDEX "ConversationMessage_conversationId_providerMessageId_key" ON "ConversationMessage"("conversationId", "providerMessageId");

ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "ConversationMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Appointment indexes / FKs
CREATE UNIQUE INDEX "Appointment_clientRequestId_key" ON "Appointment"("clientRequestId");
CREATE UNIQUE INDEX "Appointment_googleEventId_key" ON "Appointment"("googleEventId");
CREATE INDEX "Appointment_assignedCuratorId_startsAt_idx" ON "Appointment"("assignedCuratorId", "startsAt");
CREATE INDEX "Appointment_studentId_startsAt_idx" ON "Appointment"("studentId", "startsAt");
CREATE INDEX "Appointment_status_startsAt_idx" ON "Appointment"("status", "startsAt");

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_assignedCuratorId_fkey" FOREIGN KEY ("assignedCuratorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- OutboxEvent indexes
CREATE UNIQUE INDEX "OutboxEvent_idempotencyKey_key" ON "OutboxEvent"("idempotencyKey");
CREATE INDEX "OutboxEvent_status_nextAttemptAt_idx" ON "OutboxEvent"("status", "nextAttemptAt");
CREATE INDEX "OutboxEvent_aggregateType_aggregateId_createdAt_idx" ON "OutboxEvent"("aggregateType", "aggregateId", "createdAt");
CREATE INDEX "OutboxEvent_lockedAt_idx" ON "OutboxEvent"("lockedAt");
CREATE INDEX "OutboxEvent_status_leaseExpiresAt_idx" ON "OutboxEvent"("status", "leaseExpiresAt");

-- DeliveryAttempt indexes / FKs
CREATE INDEX "DeliveryAttempt_outboxEventId_idx" ON "DeliveryAttempt"("outboxEventId");
CREATE INDEX "DeliveryAttempt_status_nextRetryAt_idx" ON "DeliveryAttempt"("status", "nextRetryAt");
CREATE UNIQUE INDEX "DeliveryAttempt_provider_messageId_attempt_key" ON "DeliveryAttempt"("provider", "messageId", "attempt");

ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ConversationMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "OutboxEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
