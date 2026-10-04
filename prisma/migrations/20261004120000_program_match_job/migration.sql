-- Durable programme-matching jobs claimed by the outbox worker.
-- RLS with no anon/authenticated policy: Prisma uses the table owner and
-- bypasses RLS; the Data API cannot read these rows.

CREATE TABLE "ProgramMatchJob" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "stage" TEXT,
    "label" TEXT,
    "percent" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    "done" INTEGER,
    "total" INTEGER,
    "error" TEXT,
    "matchCount" INTEGER,
    "engine" TEXT,
    "outboxEventId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramMatchJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProgramMatchJob_studentId_createdAt_idx" ON "ProgramMatchJob"("studentId", "createdAt");
CREATE INDEX "ProgramMatchJob_studentId_status_idx" ON "ProgramMatchJob"("studentId", "status");
CREATE INDEX "ProgramMatchJob_status_createdAt_idx" ON "ProgramMatchJob"("status", "createdAt");

ALTER TABLE "ProgramMatchJob" ADD CONSTRAINT "ProgramMatchJob_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProgramMatchJob" ENABLE ROW LEVEL SECURITY;
