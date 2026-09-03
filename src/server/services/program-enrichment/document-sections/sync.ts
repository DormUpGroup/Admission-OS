import { prisma } from "@/lib/db";
import { extractDocumentSections } from "./extract";
import type { ExtractedSection } from "./types";

export async function syncSourceDocumentSections(input: {
  sourceDocumentId: string;
  body: string;
  html?: string;
  contentType?: string;
  sourceType?: string | null;
  sourceAuthority?: string | null;
  academicYear?: string | null;
  pageUrl?: string;
  /** Skip extraction when sections already exist (unchanged document). */
  onlyIfEmpty?: boolean;
}): Promise<{ skipped: boolean; count: number; sections: ExtractedSection[] }> {
  if (input.onlyIfEmpty) {
    const existing = await prisma.sourceDocumentSection.count({
      where: { sourceDocumentId: input.sourceDocumentId },
    });
    if (existing > 0) {
      return { skipped: true, count: existing, sections: [] };
    }
  }

  const sections = extractDocumentSections({
    html: input.html,
    text: input.body,
    contentType: input.contentType,
    sourceType: input.sourceType,
    sourceAuthority: input.sourceAuthority,
    academicYear: input.academicYear,
    pageUrl: input.pageUrl,
  });

  await prisma.sourceDocumentSection.deleteMany({
    where: { sourceDocumentId: input.sourceDocumentId },
  });

  if (sections.length > 0) {
    await prisma.sourceDocumentSection.createMany({
      data: sections.map((section) => ({
        sourceDocumentId: input.sourceDocumentId,
        heading: section.heading,
        sectionType: section.sectionType,
        position: section.position,
        text: section.text,
        contentHash: section.contentHash,
        metadataJson: JSON.stringify(section.metadata),
      })),
    });
  }

  return { skipped: false, count: sections.length, sections };
}
