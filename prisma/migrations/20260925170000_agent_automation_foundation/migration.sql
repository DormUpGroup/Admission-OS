-- Phase 3 foundation on top of legacy Hermes tables already present in production.
-- Additive only: no DROP / RENAME of existing tables or columns.

-- Consent audit fields on Lead (projection stays on consentStatus/consentAt).
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "consentEvidence" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "consentChannel" TEXT;

-- AgentDefinition: PR0 policy contract fields (legacy version/approvalPolicyJson kept).
ALTER TABLE "AgentDefinition" ADD COLUMN IF NOT EXISTS "policyJson" JSONB;
ALTER TABLE "AgentDefinition" ADD COLUMN IF NOT EXISTS "policyVersion" TEXT NOT NULL DEFAULT 'v1';
UPDATE "AgentDefinition" SET "policyJson" = COALESCE("policyJson", "approvalPolicyJson", '{}'::jsonb);
ALTER TABLE "AgentDefinition" ALTER COLUMN "policyJson" SET DEFAULT '{}'::jsonb;
ALTER TABLE "AgentDefinition" ALTER COLUMN "policyJson" SET NOT NULL;

-- AgentRun: queue / correlation fields used by the shadow Intake hand-off.
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "correlationId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "queuedAt" TIMESTAMP(3);
UPDATE "AgentRun"
SET
  "correlationId" = COALESCE("correlationId", "idempotencyKey", "id"),
  "queuedAt" = COALESCE("queuedAt", "createdAt");
ALTER TABLE "AgentRun" ALTER COLUMN "correlationId" SET NOT NULL;
ALTER TABLE "AgentRun" ALTER COLUMN "queuedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "AgentRun" ALTER COLUMN "queuedAt" SET NOT NULL;

-- ApprovalRequest: immutable payload hash + requester metadata (legacy action/proposedJson kept).
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "actionKey" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "payloadJson" JSONB;
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "payloadHash" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "requestedByType" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "requestedById" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "decisionReason" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "executedAt" TIMESTAMP(3);

UPDATE "ApprovalRequest"
SET
  "actionKey" = COALESCE("actionKey", "action"),
  "payloadJson" = COALESCE("payloadJson", "proposedJson"),
  "payloadHash" = COALESCE(
    "payloadHash",
    encode(sha256(convert_to(COALESCE("proposedJson", '{}'::jsonb)::text, 'UTF8')), 'hex')
  ),
  "requestedByType" = COALESCE("requestedByType", 'SYSTEM');

ALTER TABLE "ApprovalRequest" ALTER COLUMN "actionKey" SET NOT NULL;
ALTER TABLE "ApprovalRequest" ALTER COLUMN "payloadJson" SET NOT NULL;
ALTER TABLE "ApprovalRequest" ALTER COLUMN "payloadHash" SET NOT NULL;
ALTER TABLE "ApprovalRequest" ALTER COLUMN "requestedByType" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "AgentRun_agentKey_status_queuedAt_idx"
  ON "AgentRun"("agentKey", "status", "queuedAt");
CREATE INDEX IF NOT EXISTS "AgentRun_conversationId_createdAt_idx"
  ON "AgentRun"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_status_expiresAt_idx"
  ON "ApprovalRequest"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_agentRunId_createdAt_idx"
  ON "ApprovalRequest"("agentRunId", "createdAt");
