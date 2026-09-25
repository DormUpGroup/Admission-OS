-- Admin 5a: runtime kill-switch (env AND DB)

CREATE TABLE IF NOT EXISTS "AutomationSetting" (
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationSetting_pkey" PRIMARY KEY ("key")
);
