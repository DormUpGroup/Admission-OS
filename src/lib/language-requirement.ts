/**
 * A student-friendly orientation for IELTS Academic overall band scores.
 * Universities make the final equivalency decision; this label only explains
 * the CEFR level usually associated with the score.
 */
export function cefrLevelForIelts(score: number): string | null {
  if (!Number.isFinite(score) || score < 0 || score > 9) return null;
  if (score >= 8.5) return "C2";
  if (score >= 7) return "C1";
  if (score >= 5.5) return "B2";
  if (score >= 4) return "B1";
  return "ниже B1";
}

function hasCefrLevel(value: string): boolean {
  return /\b[ABC][12]\b/i.test(value);
}

/** Adds a CEFR explanation without changing the university's stated requirement. */
export function explainLanguageRequirement(value: string | null): string | null {
  const requirement = value?.trim();
  if (!requirement) return null;
  if (hasCefrLevel(requirement)) return requirement;

  const match = requirement.match(
    /\bIELTS(?:\s+(?:Academic|General))?\s*(?:overall\s*)?(?:score\s*)?(?:≥|>=|at\s+least|minimum)?\s*(\d(?:[.,]\d)?)/i
  );
  if (!match) return requirement;

  const score = Number(match[1].replace(",", "."));
  const level = cefrLevelForIelts(score);
  return level ? `${requirement} · ориентир по CEFR: ${level}` : requirement;
}
