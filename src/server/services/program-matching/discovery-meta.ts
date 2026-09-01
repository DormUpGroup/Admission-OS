import type { MiurCodeProvenance } from "@/lib/program-matching/miur-provenance";
import type { RelevanceEvidence } from "@/server/services/program-matching/candidate-relevance";

export type DiscoveryMeta = {
  selectedDirections: string[];
  miurCodes: Array<{
    code: string;
    role: "primary" | "secondary";
    directions: string[];
  }>;
  inclusion: {
    kind:
      | "exact_classe"
      | "secondary_classe"
      | "strong_tag"
      | "strong_direction_tag"
      | "synonym"
      | "shortlist";
    matchedDirections?: string[];
    matchedCodes?: string[];
    detail?: string;
  };
  whyIncluded: string;
};

export function buildWhyIncluded(
  evidence: RelevanceEvidence | null,
  opts?: { shortlisted?: boolean; language?: "ru" | "en" }
): string {
  if (opts?.shortlisted) {
    return opts.language === "en"
      ? "Already on student shortlist"
      : "Уже в shortlist студента";
  }
  if (!evidence) {
    return opts?.language === "en"
      ? "Included from discovery pool"
      : "Из пула discovery";
  }
  if (evidence.kind === "exact_classe") {
    const code = evidence.matchedCodes[0] ?? evidence.detail ?? "";
    return opts?.language === "en"
      ? `Exact MIUR class ${code}`
      : `Точный класс MIUR ${code}`;
  }
  if (
    evidence.kind === "strong_tag" ||
    evidence.kind === "strong_direction_tag"
  ) {
    const dirs = evidence.matchedDirections.join(", ") || evidence.detail || "";
    return opts?.language === "en"
      ? `Strong direction match: ${dirs}`
      : `Сильный сигнал направления: ${dirs}`;
  }
  if (evidence.kind === "secondary_classe") {
    const code = evidence.matchedCodes[0] ?? evidence.detail ?? "";
    return opts?.language === "en"
      ? `Shared / secondary MIUR class ${code}`
      : `Соседний / вторичный класс MIUR ${code}`;
  }
  if (evidence.kind === "synonym") {
    return opts?.language === "en"
      ? "Synonym keyword fallback"
      : "Синонимный keyword fallback";
  }
  return evidence.detail ?? "";
}

export function buildDiscoveryMeta(input: {
  selectedDirections: string[];
  miurCodes: MiurCodeProvenance[];
  evidence: RelevanceEvidence | null;
  shortlisted?: boolean;
  usedSynonymFallback?: boolean;
}): DiscoveryMeta {
  const inclusion = input.shortlisted
    ? {
        kind: "shortlist" as const,
        detail: "shortlist",
      }
    : input.evidence
      ? {
          kind: input.evidence.kind,
          matchedDirections: input.evidence.matchedDirections,
          matchedCodes: input.evidence.matchedCodes,
          detail: input.evidence.detail,
        }
      : input.usedSynonymFallback
        ? { kind: "synonym" as const }
        : {
            kind: "exact_classe" as const,
            detail: "unknown",
          };

  const evidenceForWhy =
    input.shortlisted
      ? null
      : input.evidence ??
        (inclusion.kind === "synonym"
          ? {
              kind: "synonym" as const,
              matchedDirections: [],
              matchedCodes: [],
            }
          : null);

  return {
    selectedDirections: input.selectedDirections,
    miurCodes: input.miurCodes,
    inclusion,
    whyIncluded: buildWhyIncluded(evidenceForWhy, {
      shortlisted: input.shortlisted,
      language: "ru",
    }),
  };
}
