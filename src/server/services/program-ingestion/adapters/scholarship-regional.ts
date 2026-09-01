import type { ProgramSourceAdapter } from "./base";

export type ScholarshipFixture = {
  region: string;
  authority: string;
  name: string;
  academicYear: string;
  sourceUrl: string;
  iseeThreshold?: number;
  amountMin?: number;
  amountMax?: number;
  notes?: string;
};

export const SCHOLARSHIP_FIXTURES: ScholarshipFixture[] = [
  {
    region: "Emilia-Romagna",
    authority: "ER.GO",
    name: "Diritto allo studio universitario",
    academicYear: "2027/2028",
    sourceUrl: "https://www.er-go.it/",
    iseeThreshold: 26000,
    amountMin: 2000,
    amountMax: 7000,
    notes: "Regional DSU — verify current-year thresholds before advising students.",
  },
  {
    region: "Piedmont",
    authority: "EDISU Piemonte",
    name: "Borsa di studio",
    academicYear: "2027/2028",
    sourceUrl: "https://www.edisu.piemonte.it/",
    iseeThreshold: 25000,
    amountMin: 2000,
    amountMax: 6500,
    notes: "Regional DSU — verify current-year thresholds before advising students.",
  },
];

export const regionalScholarshipAdapter: ProgramSourceAdapter = {
  name: "RegionalScholarshipAdapter",
  async discover(academicYear: string) {
    return SCHOLARSHIP_FIXTURES.filter((s) => s.academicYear === academicYear).map(
      (s) => ({
        title: s.name,
        universityName: s.authority,
        degreeLevel: "OTHER",
        region: s.region,
        officialUrl: s.sourceUrl,
        academicYear: s.academicYear,
      })
    );
  },
};
