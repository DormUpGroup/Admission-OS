-- Opaque per-run capability. The id is a random secret, not a sequence.
-- RLS with no anon/authenticated policy: Prisma uses the table owner and
-- bypasses RLS; the Data API cannot read these rows.

CREATE TABLE "AgentCapabilityGrant" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "allowedToolsJson" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCapabilityGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentCapabilityGrant_agentRunId_key" ON "AgentCapabilityGrant"("agentRunId");
CREATE INDEX "AgentCapabilityGrant_expiresAt_idx" ON "AgentCapabilityGrant"("expiresAt");
CREATE INDEX "AgentCapabilityGrant_conversationId_idx" ON "AgentCapabilityGrant"("conversationId");

ALTER TABLE "AgentCapabilityGrant" ADD CONSTRAINT "AgentCapabilityGrant_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentCapabilityGrant" ADD CONSTRAINT "AgentCapabilityGrant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentCapabilityGrant" ENABLE ROW LEVEL SECURITY;
