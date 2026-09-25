-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "staffLastReadAt" TIMESTAMP(3);

-- CreateIndex (supports unread Telegram sidebar counts)
CREATE INDEX IF NOT EXISTS "Conversation_channel_status_lastInboundAt_idx"
  ON "Conversation"("channel", "status", "lastInboundAt");
