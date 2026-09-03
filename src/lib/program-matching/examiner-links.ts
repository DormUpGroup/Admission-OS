/** Examiner / test board reference links for curator cards. */
export const EXAMINER_LINKS: Record<
  string,
  { label: string; url: string; aliases: string[] }
> = {
  TOLC: {
    label: "CISIA — TOLC",
    url: "https://www.cisiaonline.it/area-tematica-tolc-cisia/home-tolc-generale/",
    aliases: ["TOLC", "TOLC-E", "TOLC-I", "TOLC-SU", "TOLC-F", "TOLC-S"],
  },
  SAT: {
    label: "College Board — SAT",
    url: "https://satsuite.collegeboard.org/sat",
    aliases: ["SAT"],
  },
  IELTS: {
    label: "IELTS",
    url: "https://www.ielts.org/",
    aliases: ["IELTS"],
  },
  TOEFL: {
    label: "ETS — TOEFL",
    url: "https://www.ets.org/toefl.html",
    aliases: ["TOEFL", "TOEFL iBT"],
  },
  CILS: {
    label: "CILS — Università per Stranieri di Siena",
    url: "https://cils.unistrasi.it/",
    aliases: ["CILS"],
  },
  CELI: {
    label: "CELI — Università per Stranieri di Perugia",
    url: "https://www.cvcl.it/",
    aliases: ["CELI"],
  },
  PLIDA: {
    label: "PLIDA — Società Dante Alighieri",
    url: "https://plida.it/",
    aliases: ["PLIDA"],
  },
};

export function examinerLinkForExam(examName: string): {
  label: string;
  url: string;
} | null {
  const upper = examName.toUpperCase();
  for (const entry of Object.values(EXAMINER_LINKS)) {
    if (entry.aliases.some((a) => upper.includes(a.toUpperCase()))) {
      return { label: entry.label, url: entry.url };
    }
  }
  return null;
}

export function humanizeExamName(name: string): string {
  const upper = name.trim().toUpperCase();
  if (upper === "ADMISSION_TEST") return "вступительный экзамен";
  if (upper === "BOCCONI_TEST") return "тест Bocconi";
  return name.trim();
}

/** Format exam alternatives for display: "SAT ≥ 1200 или TOLC-E". */
export function formatExamAlternatives(
  parts: Array<{ name: string; detail?: string | null }>
): string {
  return parts
    .map((p) => {
      const name = humanizeExamName(p.name);
      return p.detail ? `${name} ${p.detail}`.trim() : name;
    })
    .join(" или ");
}
