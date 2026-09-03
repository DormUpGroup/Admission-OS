import { z } from "zod";

export const ApplicantScopeSchema = z.enum([
  "ALL",
  "EU_CITIZEN",
  "EU_EQUIVALENT",
  "NON_EU_RESIDENT_ABROAD",
  "NON_EU_RESIDENT_ITALY",
]);

export const FreshnessSchema = z.enum([
  "CURRENT",
  "INDICATIVE",
  "UNKNOWN",
  "CONFLICT",
]);

export const ConfidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);

export const EvidenceFactSchema = z.object({
  value: z.unknown(),
  sourceDocumentId: z.string().min(1),
  sourceUrl: z.string().url().or(z.string().min(1)),
  quote: z.string().min(1),
  academicYear: z.string().min(1),
  scope: ApplicantScopeSchema,
  freshness: FreshnessSchema,
  confidence: ConfidenceSchema,
});

export type EvidenceFact = z.infer<typeof EvidenceFactSchema>;

export const EnrichmentOutputSchema = z.object({
  campuses: z.array(EvidenceFactSchema).default([]),
  access: z.array(EvidenceFactSchema).default([]),
  selection: z.array(EvidenceFactSchema).default([]),
  admissionExams: z.array(EvidenceFactSchema).default([]),
  languageRequirements: z.array(EvidenceFactSchema).default([]),
  deadlines: z.array(EvidenceFactSchema).default([]),
  tuition: z.array(EvidenceFactSchema).default([]),
  seats: z.array(EvidenceFactSchema).default([]),
  requiredDocuments: z.array(EvidenceFactSchema).default([]),
  importantNotes: z.array(EvidenceFactSchema).default([]),
  sourceConflicts: z
    .array(
      z.object({
        field: z.string(),
        description: z.string(),
        documentIds: z.array(z.string()).default([]),
      })
    )
    .default([]),
  unresolvedFields: z.array(z.string()).default([]),
  siteNavigationSummary: z
    .object({
      hops: z.array(z.string()).default([]),
      documentsUsed: z.array(z.string()).default([]),
      notes: z.string().optional(),
    })
    .default({ hops: [], documentsUsed: [] }),
});

export type EnrichmentOutput = z.infer<typeof EnrichmentOutputSchema>;

export const CRITICAL_FIELDS = [
  "access",
  "selection",
  "deadlines",
  "tuition",
  "seats",
  "admissionExams",
  "languageRequirements",
  "requiredDocuments",
  "campuses",
] as const;

export type CriticalField = (typeof CRITICAL_FIELDS)[number];

export const FIELD_TO_PROGRAM_FACT: Record<CriticalField, string> = {
  access: "ACCESS_TYPE",
  selection: "SELECTION",
  deadlines: "APPLICATION_DEADLINE",
  tuition: "TUITION",
  seats: "SEATS",
  admissionExams: "ADMISSION_EXAMS",
  languageRequirements: "LANGUAGE_REQUIREMENT",
  requiredDocuments: "REQUIRED_DOCUMENTS",
  campuses: "CAMPUS",
};
