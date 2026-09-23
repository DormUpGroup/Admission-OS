-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "Lead" (
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

-- CreateTable
CREATE TABLE "ChannelIdentity" (
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

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "leadId" TEXT,
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

-- CreateTable
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
    "agentRunId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "leadId" TEXT,
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

-- CreateTable
CREATE TABLE "AgentDefinition" (
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autonomyLevel" TEXT NOT NULL DEFAULT 'DRAFT_ONLY',
    "allowedToolsJson" JSONB NOT NULL,
    "eventTypesJson" JSONB NOT NULL,
    "approvalPolicyJson" JSONB NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "maxIterations" INTEGER NOT NULL DEFAULT 8,
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 120,
    "maxCostUsd" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentDefinition_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "parentRunId" TEXT,
    "conversationId" TEXT,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "hermesRunId" TEXT,
    "hermesSessionId" TEXT,
    "model" TEXT,
    "promptVersion" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "inputJson" JSONB,
    "outputJson" JSONB,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRunStep" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "toolName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "inputJson" JSONB,
    "outputJson" JSONB,
    "approvalStatus" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRunStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT,
    "action" TEXT NOT NULL,
    "riskClass" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "proposedJson" JSONB NOT NULL,
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxEvent" (
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "userId" TEXT,
    "agentRunId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerEvent" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "delayMinutes" INTEGER NOT NULL,
    "quietHoursJson" JSONB NOT NULL,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "templateKey" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationSetting" (
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CommandExecution" (
    "id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "correlationId" TEXT NOT NULL,
    "responseJson" JSONB,
    "httpStatus" INTEGER,
    "entityType" TEXT,
    "entityId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommandExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_convertedStudentId_key" ON "Lead"("convertedStudentId");

-- CreateIndex
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_assignedCuratorId_status_idx" ON "Lead"("assignedCuratorId", "status");

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "Lead_phone_idx" ON "Lead"("phone");

-- CreateIndex
CREATE INDEX "ChannelIdentity_leadId_idx" ON "ChannelIdentity"("leadId");

-- CreateIndex
CREATE INDEX "ChannelIdentity_studentId_idx" ON "ChannelIdentity"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelIdentity_channel_externalId_key" ON "ChannelIdentity"("channel", "externalId");

-- CreateIndex
CREATE INDEX "Conversation_leadId_status_idx" ON "Conversation"("leadId", "status");

-- CreateIndex
CREATE INDEX "Conversation_studentId_status_idx" ON "Conversation"("studentId", "status");

-- CreateIndex
CREATE INDEX "Conversation_assignedCuratorId_status_idx" ON "Conversation"("assignedCuratorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_clientRequestId_key" ON "ConversationMessage"("clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_legacyActivityId_key" ON "ConversationMessage"("legacyActivityId");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_deliveryStatus_createdAt_idx" ON "ConversationMessage"("deliveryStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_agentRunId_idx" ON "ConversationMessage"("agentRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_conversationId_providerMessageId_key" ON "ConversationMessage"("conversationId", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_clientRequestId_key" ON "Appointment"("clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_googleEventId_key" ON "Appointment"("googleEventId");

-- CreateIndex
CREATE INDEX "Appointment_assignedCuratorId_startsAt_idx" ON "Appointment"("assignedCuratorId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_leadId_startsAt_idx" ON "Appointment"("leadId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_studentId_startsAt_idx" ON "Appointment"("studentId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_status_startsAt_idx" ON "Appointment"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_hermesRunId_key" ON "AgentRun"("hermesRunId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_idempotencyKey_key" ON "AgentRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentRun_subjectType_subjectId_createdAt_idx" ON "AgentRun"("subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_status_createdAt_idx" ON "AgentRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_agentKey_createdAt_idx" ON "AgentRun"("agentKey", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_conversationId_idx" ON "AgentRun"("conversationId");

-- CreateIndex
CREATE INDEX "AgentRunStep_status_createdAt_idx" ON "AgentRunStep"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRunStep_agentRunId_sequence_key" ON "AgentRunStep"("agentRunId", "sequence");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_createdAt_idx" ON "ApprovalRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_subjectType_subjectId_idx" ON "ApprovalRequest"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_decidedById_idx" ON "ApprovalRequest"("decidedById");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_idempotencyKey_key" ON "OutboxEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_nextAttemptAt_idx" ON "OutboxEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregateType_aggregateId_createdAt_idx" ON "OutboxEvent"("aggregateType", "aggregateId", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_lockedAt_idx" ON "OutboxEvent"("lockedAt");

-- CreateIndex
CREATE INDEX "InboxEvent_status_receivedAt_idx" ON "InboxEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboxEvent_provider_providerEventId_key" ON "InboxEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_outboxEventId_idx" ON "DeliveryAttempt"("outboxEventId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_status_nextRetryAt_idx" ON "DeliveryAttempt"("status", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAttempt_provider_messageId_attempt_key" ON "DeliveryAttempt"("provider", "messageId", "attempt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

-- CreateIndex
CREATE INDEX "AuditLog_actorType_actorId_createdAt_idx" ON "AuditLog"("actorType", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "FollowUpRule_enabled_triggerEvent_idx" ON "FollowUpRule"("enabled", "triggerEvent");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpRule_name_policyVersion_key" ON "FollowUpRule"("name", "policyVersion");

-- CreateIndex
CREATE INDEX "CommandExecution_status_createdAt_idx" ON "CommandExecution"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CommandExecution_correlationId_idx" ON "CommandExecution"("correlationId");

-- CreateIndex
CREATE INDEX "CommandExecution_entityType_entityId_idx" ON "CommandExecution"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "CommandExecution_principalId_operation_idempotencyKey_key" ON "CommandExecution"("principalId", "operation", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedCuratorId_fkey" FOREIGN KEY ("assignedCuratorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_convertedStudentId_fkey" FOREIGN KEY ("convertedStudentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelIdentity" ADD CONSTRAINT "ChannelIdentity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelIdentity" ADD CONSTRAINT "ChannelIdentity_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedCuratorId_fkey" FOREIGN KEY ("assignedCuratorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "ConversationMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_assignedCuratorId_fkey" FOREIGN KEY ("assignedCuratorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentKey_fkey" FOREIGN KEY ("agentKey") REFERENCES "AgentDefinition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRunStep" ADD CONSTRAINT "AgentRunStep_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ConversationMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "OutboxEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Prisma cannot express these cross-column domain constraints.
ALTER TABLE "ChannelIdentity"
  ADD CONSTRAINT "ChannelIdentity_exactly_one_subject"
  CHECK (num_nonnulls("leadId", "studentId") = 1);

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_exactly_one_subject"
  CHECK (num_nonnulls("leadId", "studentId") = 1);

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_exactly_one_subject"
  CHECK (num_nonnulls("leadId", "studentId") = 1);

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_valid_interval"
  CHECK ("endsAt" > "startsAt");

ALTER TABLE "DeliveryAttempt"
  ADD CONSTRAINT "DeliveryAttempt_has_source"
  CHECK (num_nonnulls("messageId", "outboxEventId") >= 1);

-- Exactly one active internal student-curator conversation per case.
CREATE UNIQUE INDEX "Conversation_one_open_portal_student_key"
  ON "Conversation" ("studentId")
  WHERE "channel" = 'PORTAL' AND "status" = 'OPEN' AND "studentId" IS NOT NULL;

-- Internal command/orchestration tables are not a Supabase Data API surface.
DO $$
DECLARE
  table_name text;
  internal_tables text[] := ARRAY[
    'Lead',
    'ChannelIdentity',
    'Conversation',
    'ConversationMessage',
    'Appointment',
    'AgentDefinition',
    'AgentRun',
    'AgentRunStep',
    'ApprovalRequest',
    'OutboxEvent',
    'InboxEvent',
    'DeliveryAttempt',
    'AuditLog',
    'FollowUpRule',
    'AutomationSetting',
    'CommandExecution'
  ];
BEGIN
  FOREACH table_name IN ARRAY internal_tables
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      current_schema(),
      table_name
    );
    EXECUTE format(
      'REVOKE ALL ON TABLE %I.%I FROM anon, authenticated',
      current_schema(),
      table_name
    );
  END LOOP;
END $$;
