-- Rehearsal-only rollback of the additive Hermes migration.
-- Do not run this against live production. It drops Hermes tables so
-- migrate deploy can be re-applied on a clone or empty CI database.

DROP TABLE IF EXISTS "AgentRunStep" CASCADE;
DROP TABLE IF EXISTS "DeliveryAttempt" CASCADE;
DROP TABLE IF EXISTS "ApprovalRequest" CASCADE;
DROP TABLE IF EXISTS "AgentRun" CASCADE;
DROP TABLE IF EXISTS "ConversationMessage" CASCADE;
DROP TABLE IF EXISTS "Conversation" CASCADE;
DROP TABLE IF EXISTS "ChannelIdentity" CASCADE;
DROP TABLE IF EXISTS "Appointment" CASCADE;
DROP TABLE IF EXISTS "InboxEvent" CASCADE;
DROP TABLE IF EXISTS "OutboxEvent" CASCADE;
DROP TABLE IF EXISTS "AuditLog" CASCADE;
DROP TABLE IF EXISTS "FollowUpRule" CASCADE;
DROP TABLE IF EXISTS "AutomationSetting" CASCADE;
DROP TABLE IF EXISTS "CommandExecution" CASCADE;
DROP TABLE IF EXISTS "AgentDefinition" CASCADE;
DROP TABLE IF EXISTS "Lead" CASCADE;

ALTER TABLE IF EXISTS "Application" DROP COLUMN IF EXISTS "version";
ALTER TABLE IF EXISTS "Student" DROP COLUMN IF EXISTS "version";
