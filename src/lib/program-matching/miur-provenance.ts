import { normalizeMiurCode } from "@/lib/program-matching/miur-code";
import type { MatchingProfile } from "@/lib/program-matching/types";
import {
  fieldTagsToDirectionSlices,
  type ClasseRole,
} from "@/lib/program-matching/taxonomy";

export type MiurCodeProvenance = {
  code: string;
  role: ClasseRole;
  directions: string[];
};

export type MiurProvenance = {
  /** Selected questionnaire / interest labels (order-stable unique). */
  directions: string[];
  /** All selected MIUR codes, normalized — soft-gate / fit source of truth. */
  classeCodes: string[];
  /** Per-code primary/secondary provenance across directions. */
  miurCodes: MiurCodeProvenance[];
};

type ProfileLike = Pick<MatchingProfile, "fieldsOfInterest" | "desiredDegreeLevel">;

/**
 * Shared direction → MIUR classe provenance for discovery, soft-gate, and fit.
 * Does not call Universitaly resolve — unresolved codes stay in the selected set.
 */
export function buildMiurProvenance(profile: ProfileLike): MiurProvenance {
  const slices = fieldTagsToDirectionSlices(profile.fieldsOfInterest, {
    degreeLevel: profile.desiredDegreeLevel,
  });
  const directions = [
    ...new Set(slices.map((s) => s.tag).filter(Boolean)),
  ];
  const byCode = new Map<
    string,
    { roles: Set<ClasseRole>; directions: Set<string> }
  >();

  for (const s of slices) {
    if (!s.classeCode) continue;
    const norm = normalizeMiurCode(s.classeCode);
    let row = byCode.get(norm);
    if (!row) {
      row = { roles: new Set(), directions: new Set() };
      byCode.set(norm, row);
    }
    row.roles.add(s.role ?? "primary");
    if (s.tag) row.directions.add(s.tag);
  }

  const miurCodes: MiurCodeProvenance[] = [];
  for (const [code, v] of [...byCode.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const dirs = [...v.directions].sort();
    for (const role of ["primary", "secondary"] as const) {
      if (v.roles.has(role)) {
        miurCodes.push({ code, role, directions: dirs });
      }
    }
  }

  return {
    directions,
    classeCodes: [...byCode.keys()].sort(),
    miurCodes,
  };
}
