-- Staff can pin a Telegram thread to Чаты, Технические, or Мусор.
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "inboxFolder" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Conversation_inboxFolder_check'
      AND conrelid = 'public."Conversation"'::regclass
  ) THEN
    ALTER TABLE "Conversation"
      ADD CONSTRAINT "Conversation_inboxFolder_check"
      CHECK (
        "inboxFolder" IS NULL
        OR "inboxFolder" IN ('chats', 'technical', 'trash')
      );
  END IF;
END $$;
