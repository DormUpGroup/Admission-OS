-- Deterministic SourceDocument sections for retrieval.
-- Embeddings may be added later only as a second retrieval stage after hard
-- metadata filtering. They are never a source of truth for facts or eligibility.
-- Existing SourceDocument / ProgramFact rows are unchanged.
-- Apply via `npx prisma db push`.

CREATE TABLE IF NOT EXISTS "SourceDocumentSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceDocumentId" TEXT NOT NULL,
    "heading" TEXT NOT NULL DEFAULT '',
    "sectionType" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SourceDocumentSection_sourceDocumentId_fkey"
      FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "SourceDocumentSection_sourceDocumentId_sectionType_idx"
  ON "SourceDocumentSection"("sourceDocumentId", "sectionType");
CREATE INDEX IF NOT EXISTS "SourceDocumentSection_sourceDocumentId_position_idx"
  ON "SourceDocumentSection"("sourceDocumentId", "position");
CREATE INDEX IF NOT EXISTS "SourceDocumentSection_contentHash_idx"
  ON "SourceDocumentSection"("contentHash");
