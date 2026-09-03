import { describe, expect, it } from "vitest";
import {
  compareLanguageLevel,
  compareNumericRequirement,
  deadlineStatus,
  normalizeAcademicYear,
  parseIeltsFromText,
  parseSatFromText,
  previousAcademicYear,
} from "@/server/services/program-matching/compare";
import { resolveProgramFact } from "@/server/services/program-matching/source-resolver";
import {
  buildMatchingProfileFromStudent,
  inferApplicantCategory,
} from "@/server/services/program-matching/matching-profile";
import { evaluateEligibility } from "@/server/services/program-matching/eligibility";
import { calculateFitScore } from "@/server/services/program-matching/fit-score";
import { FIT_SCORE_WEIGHTS } from "@/lib/program-matching/config";

describe("compare helpers", () => {
  it("compares SAT scores", () => {
    expect(compareNumericRequirement(1280, ">=", 1200)).toBe("MET");
    expect(compareNumericRequirement(1150, ">=", 1200)).toBe("NOT_MET");
    expect(compareNumericRequirement("UNKNOWN", ">=", 1200)).toBe("UNKNOWN");
  });

  it("compares CEFR language levels", () => {
    expect(compareLanguageLevel("C1", "B2")).toBe("MET");
    expect(compareLanguageLevel("B1", "B2")).toBe("NOT_MET");
    expect(compareLanguageLevel("UNKNOWN", "B2")).toBe("UNKNOWN");
  });

  it("parses certificate text without inventing scores", () => {
    expect(parseIeltsFromText("IELTS 7.0, SAT 1280")).toBe(7);
    expect(parseSatFromText("IELTS 7.0, SAT 1280")).toBe(1280);
    expect(parseIeltsFromText("есть сертификат")).toBe("UNKNOWN");
    expect(parseSatFromText("нет")).toBe("UNKNOWN");
  });

  it("classifies deadlines", () => {
    expect(deadlineStatus(new Date(Date.now() - 86400000))).toBe("PASSED");
    expect(deadlineStatus(new Date(Date.now() + 5 * 86400000))).toBe("SOON");
    expect(deadlineStatus(new Date(Date.now() + 40 * 86400000))).toBe("OPEN");
    expect(deadlineStatus(null)).toBe("UNKNOWN");
  });

  it("resolves academic years", () => {
    expect(normalizeAcademicYear("2027/28")).toBe("2027/2028");
    expect(previousAcademicYear("2027/2028")).toBe("2026/2027");
  });
});

describe("initial-shortlist scoring", () => {
  it("keeps fit independent of tuition until a programme is shortlisted", () => {
    const base = {
      name: "Economics",
      field: "Economics",
      fieldTags: ["economics"],
      teachingLanguages: ["English"],
      campusCity: "Bologna",
    };
    const lowFee = calculateFitScore(profileA, { ...base, minTuition: 100 }, []);
    const highFee = calculateFitScore(profileA, { ...base, minTuition: 50_000 }, []);

    expect(lowFee.budget).toBe(highFee.budget);
    expect(lowFee.total).toBe(highFee.total);
  });
});

describe("EU / non-EU category", () => {
  it("does not collapse categories", () => {
    expect(inferApplicantCategory({ nationality: "Italy" })).toBe("EU_CITIZEN");
    expect(inferApplicantCategory({ nationality: "Kazakhstan" })).toBe(
      "NON_EU_RESIDENT_ABROAD"
    );
    expect(
      inferApplicantCategory({
        nationality: "Kazakhstan",
        country: "Italy",
      })
    ).toBe("NON_EU_RESIDENT_ITALY");
    expect(
      inferApplicantCategory({ citizenship: "EU equivalent" })
    ).toBe("EU_EQUIVALENT");
    expect(inferApplicantCategory({})).toBe("UNKNOWN");
  });
});

describe("source priority resolver", () => {
  const quoted = (over: Record<string, unknown>) => ({
    sourceType: "PROGRAMME_PAGE",
    academicYear: "2026/2027",
    freshness: "CURRENT",
    applicantCategoryScope: "NON_EU_RESIDENT_ABROAD",
    evidenceQuote: "Non-EU candidates residing abroad: 40 places",
    sourceDocumentId: "doc-1",
    sourceUrl: "https://example.edu/programme",
    evidenceValidatedAt: new Date("2026-01-01"),
    decisionStatus: "ELIGIBLE",
    normalizedValueJson: "40",
    ...over,
  });

  it("rejects Universitaly and unquoted legacy decision facts", () => {
    const winner = resolveProgramFact(
      [
        { sourceType: "UNIVERSITALY", academicYear: "2026/2027", confidence: "HIGH" },
        { sourceType: "ADMISSION_CALL", academicYear: "2026/2027", confidence: "MEDIUM" },
      ],
      "2026/2027",
      { applicantCategory: "NON_EU_RESIDENT_ABROAD" }
    );
    expect(winner).toBeNull();
  });

  it("prefers verified manual values", () => {
    const winner = resolveProgramFact([
      quoted({ origin: "AI" }),
      {
        sourceType: "MANUAL_VERIFIED",
        verificationStatus: "VERIFIED",
        extractionMethod: "MANUAL",
      },
    ]);
    expect(winner?.sourceType).toBe("MANUAL_VERIFIED");
  });

  it("orders scoped AI, scoped fallback, ALL, then unknown", () => {
    const all = quoted({
      origin: "AI",
      applicantCategoryScope: "ALL",
      normalizedValueJson: "10",
    });
    const fallback = quoted({
      origin: "OFFICIAL_FALLBACK",
      normalizedValueJson: "20",
    });
    const ai = quoted({ origin: "AI", normalizedValueJson: "40" });
    expect(
      resolveProgramFact([all, fallback, ai], "2026/2027", {
        applicantCategory: "NON_EU_RESIDENT_ABROAD",
      })?.normalizedValueJson
    ).toBe("40");
    expect(
      resolveProgramFact([all, fallback], "2026/2027", {
        applicantCategory: "NON_EU_RESIDENT_ABROAD",
      })?.normalizedValueJson
    ).toBe("20");
    expect(
      resolveProgramFact([all], "2026/2027", {
        applicantCategory: "NON_EU_RESIDENT_ABROAD",
      })?.normalizedValueJson
    ).toBe("10");
  });

  it("never uses another applicant scope or academic year", () => {
    const wrongScope = quoted({
      origin: "AI",
      applicantCategoryScope: "EU_CITIZEN",
    });
    const wrongYear = quoted({ origin: "AI", academicYear: "2025/2026" });
    expect(
      resolveProgramFact([wrongScope, wrongYear], "2026/2027", {
        applicantCategory: "NON_EU_RESIDENT_ABROAD",
      })
    ).toBeNull();
  });

  it("returns unknown for equal-priority conflicting facts", () => {
    expect(
      resolveProgramFact(
        [
          quoted({ origin: "AI", normalizedValueJson: "40" }),
          quoted({ origin: "AI", normalizedValueJson: "200" }),
        ],
        "2026/2027",
        { applicantCategory: "NON_EU_RESIDENT_ABROAD" }
      )
    ).toBeNull();
  });
});

const profileA = buildMatchingProfileFromStudent({
  id: "a",
  intake: "2027/28",
  nationality: "Kazakhstan",
  country: "Kazakhstan",
  studyLevel: "BACHELOR",
  preferredLanguage: "English",
  targetField: "Экономические науки",
  preferredCities: JSON.stringify(["Bologna", "Turin"]),
  questionnairePersonalJson: JSON.stringify({ citizenship: "Kazakhstan" }),
  questionnaireProgramsJson: JSON.stringify({
    studyLevelPlan: "Бакалавриат",
    studyLanguage: "Английский",
    englishLevel: "C1",
    englishCertificate: "IELTS 7.0, SAT 1280",
    italianLevel: "A2",
    // Cross-sphere: economics OR computers
    preferredDirections: [
      "Экономические науки",
      "Компьютерные технологии",
    ],
    preferredCities: ["Bologna", "Turin", "Milano"],
    avoidCities: [],
    dsuScholarship: "Да",
  }),
});

const profileB = buildMatchingProfileFromStudent({
  id: "b",
  intake: "2027/28",
  nationality: "Russia",
  studyLevel: "BACHELOR",
  preferredLanguage: "English",
  questionnaireProgramsJson: JSON.stringify({
    studyLevelPlan: "Бакалавриат",
    studyLanguage: "Английский",
    englishLevel: "B2",
    englishCertificate: "нет",
    preferredDirections: ["Биология", "Компьютерные технологии"],
    preferredCities: ["Вся Италия"],
    dsuScholarship: "Нет",
  }),
});

const profileC = buildMatchingProfileFromStudent({
  id: "c",
  intake: "2027/28",
  nationality: "Ukraine",
  studyLevel: "MASTER",
  questionnaireProgramsJson: JSON.stringify({
    studyLevelPlan: "Магистратура",
    studyLanguage: "Английский",
    englishLevel: "C1",
    englishCertificate: "C1",
    previousSpecialty: "Biology",
    preferredDirections: [
      "Медицина и хирургия",
      "Химические науки",
    ],
    preferredCities: ["Turin"],
    dsuScholarship: "Да",
  }),
});

describe("questionnaire adapter profiles A/B/C", () => {
  it("builds profile A without inventing budget", () => {
    expect(profileA.desiredDegreeLevel).toBe("BACHELOR");
    expect(profileA.ielts).toBe(7);
    expect(profileA.sat).toBe(1280);
    expect(profileA.maxTuition).toBe("UNKNOWN");
    expect(profileA.fieldsOfInterest).toEqual(
      expect.arrayContaining([
        "Экономические науки",
        "Компьютерные технологии",
      ])
    );
  });

  it("keeps SAT unknown for profile B and keeps multi-direction mix", () => {
    expect(profileB.sat).toBe("UNKNOWN");
    expect(profileB.englishLevel).toBe("B2");
    expect(profileB.fieldsOfInterest).toEqual(
      expect.arrayContaining(["Биология", "Компьютерные технологии"])
    );
  });

  it("flags curricular uncertainty for profile C", () => {
    expect(profileC.desiredDegreeLevel).toBe("MASTER");
    expect(profileC.degreeField).toBe("Biology");
    expect(profileC.fieldsOfInterest).toEqual(
      expect.arrayContaining(["Медицина и хирургия", "Химические науки"])
    );
  });
});

describe("eligibility engine", () => {
  it("hard-excludes degree mismatch", () => {
    const result = evaluateEligibility({
      profile: profileA,
      programDegreeLevel: "MASTER",
      teachingLanguages: ["English"],
      campusCity: "Bologna",
      region: "Emilia-Romagna",
      requirements: [],
      cycles: [],
      dataConfidence: "HIGH",
    });
    expect(result.status).toBe("NOT_ELIGIBLE");
  });

  it("does not hard-exclude preferred-city mismatch — geography is secondary", () => {
    const result = evaluateEligibility({
      profile: profileA,
      programDegreeLevel: "BACHELOR",
      teachingLanguages: ["English"],
      campusCity: "Palermo",
      region: "Sicily",
      requirements: [],
      cycles: [],
      dataConfidence: "HIGH",
    });
    expect(result.status).not.toBe("NOT_ELIGIBLE");
  });

  it("hard-excludes avoid-list cities", () => {
    const withAvoid = {
      ...profileA,
      excludedCities: ["Palermo"],
      excludedRegions: ["Sicily"],
    };
    const result = evaluateEligibility({
      profile: withAvoid,
      programDegreeLevel: "BACHELOR",
      teachingLanguages: ["English"],
      campusCity: "Palermo",
      region: "Sicily",
      requirements: [],
      cycles: [],
      dataConfidence: "HIGH",
    });
    expect(result.status).toBe("NOT_ELIGIBLE");
  });

  it("keeps preferred-city programme eligible", () => {
    const result = evaluateEligibility({
      profile: profileA,
      programDegreeLevel: "BACHELOR",
      teachingLanguages: ["English"],
      campusCity: "Bologna",
      region: "Emilia-Romagna",
      requirements: [],
      cycles: [],
      dataConfidence: "HIGH",
    });
    expect(result.status).toBe("ELIGIBLE");
  });

  it("hard-excludes teaching-language preference mismatch", () => {
    const result = evaluateEligibility({
      profile: profileA,
      programDegreeLevel: "BACHELOR",
      teachingLanguages: ["Italian"],
      campusCity: "Bologna",
      region: "Emilia-Romagna",
      requirements: [],
      cycles: [],
      dataConfidence: "HIGH",
    });
    expect(result.status).toBe("NOT_ELIGIBLE");
  });

  it("treats missing SAT as aspirational, not a hard block", () => {
    const result = evaluateEligibility({
      profile: profileB,
      programDegreeLevel: "BACHELOR",
      teachingLanguages: ["English"],
      requirements: [
        {
          type: "SAT",
          required: true,
          operator: ">=",
          valueJson: JSON.stringify({ score: 1200 }),
          description: "SAT ≥ 1200",
          hardExclusion: true,
        },
      ],
      cycles: [],
      dataConfidence: "HIGH",
    });
    expect(result.status).toBe("ELIGIBLE");
    expect(result.evaluations[0]?.status).toBe("UNKNOWN");
    expect(result.evaluations[0]?.hardExclusion).toBe(false);
    expect(result.risks).not.toContain("CURATOR_REVIEW_REQUIRED");
  });

  it("does not hard-exclude when language cert is still below threshold", () => {
    const result = evaluateEligibility({
      profile: profileB,
      programDegreeLevel: "BACHELOR",
      teachingLanguages: ["English"],
      requirements: [
        {
          type: "LANGUAGE",
          required: true,
          valueJson: JSON.stringify({ language: "English", level: "C1" }),
          description: "English C1",
          hardExclusion: true,
        },
      ],
      cycles: [],
      dataConfidence: "HIGH",
    });
    expect(result.status).not.toBe("NOT_ELIGIBLE");
    expect(result.evaluations[0]?.hardExclusion).toBe(false);
  });

  it("marks met SAT as eligible when confidence high", () => {
    const result = evaluateEligibility({
      profile: profileA,
      programDegreeLevel: "BACHELOR",
      teachingLanguages: ["English"],
      campusCity: "Bologna",
      region: "Emilia-Romagna",
      requirements: [
        {
          type: "LANGUAGE",
          required: true,
          valueJson: JSON.stringify({ language: "English", level: "B2" }),
          description: "English B2",
          hardExclusion: true,
        },
        {
          type: "SAT",
          required: true,
          operator: ">=",
          valueJson: JSON.stringify({ score: 1200 }),
          description: "SAT ≥ 1200",
          hardExclusion: true,
        },
      ],
      cycles: [],
      dataConfidence: "HIGH",
    });
    expect(result.status).toBe("ELIGIBLE");
  });

  it("does not hard-exclude on passed deadlines", () => {
    const result = evaluateEligibility({
      profile: profileA,
      programDegreeLevel: "BACHELOR",
      teachingLanguages: ["English"],
      campusCity: "Bologna",
      region: "Emilia-Romagna",
      requirements: [],
      cycles: [
        {
          applicationDeadline: new Date(Date.now() - 86400000 * 30),
          applicantCategory: "ALL",
        },
      ],
      dataConfidence: "HIGH",
      usingPreviousYear: false,
    });
    expect(result.status).not.toBe("NOT_ELIGIBLE");
  });

  it("does not hard-exclude on previous-year passed deadlines", () => {
    const result = evaluateEligibility({
      profile: profileA,
      programDegreeLevel: "BACHELOR",
      teachingLanguages: ["English"],
      campusCity: "Bologna",
      region: "Emilia-Romagna",
      requirements: [],
      cycles: [
        {
          applicationDeadline: new Date(Date.now() - 86400000 * 30),
          applicantCategory: "ALL",
        },
      ],
      dataConfidence: "HIGH",
      usingPreviousYear: true,
    });
    expect(result.status).not.toBe("NOT_ELIGIBLE");
    expect(result.risks).toContain("USING_PREVIOUS_YEAR_DATA");
  });
});

describe("fit score", () => {
  it("rewards field and geography", () => {
    const score = calculateFitScore(
      profileA,
      {
        name: "Economics and Finance",
        field: "Economics",
        fieldTags: ["Economics", "Finance"],
        campusCity: "Bologna",
        region: "Emilia-Romagna",
        teachingLanguages: ["English"],
        minTuition: 0,
        maxTuition: 3000,
      },
      []
    );
    expect(score.total).toBeGreaterThan(50);
    expect(score.field).toBeGreaterThan(10);
    expect(score.geography).toBeGreaterThan(0);
  });

  it("does not score Italian literature highly for finance profile", () => {
    const score = calculateFitScore(
      profileA,
      {
        name: "Italian Literature",
        field: "Languages",
        fieldTags: ["Languages"],
        campusCity: "Palermo",
        region: "Sicily",
        teachingLanguages: ["Italian"],
      },
      []
    );
    expect(score.field).toBe(0);
  });

  it("does not penalize missing language cert or admission test", () => {
    const score = calculateFitScore(
      profileB,
      {
        name: "Economics",
        field: "Economics",
        fieldTags: ["Economics"],
        campusCity: "Milan",
        region: "Lombardy",
        teachingLanguages: ["English"],
      },
      [
        {
          type: "LANGUAGE",
          description: "English B2",
          status: "UNKNOWN",
          required: true,
          hardExclusion: false,
        },
        {
          type: "SAT",
          description: "SAT ≥ 1200",
          status: "UNKNOWN",
          required: true,
          hardExclusion: false,
        },
      ]
    );
    expect(score.admissionTest).toBe(4);
    expect(score.language).toBe(34);
    expect(score.academicReadiness).toBe(4);
  });

  it("caps field for title-only direction match without MIUR classe (v1.7)", () => {
    const multi = {
      ...profileA,
      fieldsOfInterest: ["Finance", "Computer Science", "Design"],
    };
    const score = calculateFitScore(
      multi,
      {
        name: "Finance BSc",
        field: "Finance",
        fieldTags: ["Finance"],
        campusCity: "Bologna",
        region: "Emilia-Romagna",
        teachingLanguages: ["English"],
        inclusionEvidence: {
          kind: "strong_tag",
          matchedCodes: [],
          matchedDirections: ["Finance"],
        },
      },
      []
    );
    expect(score.field).toBe(Math.round(FIT_SCORE_WEIGHTS.field * 0.5));
    expect(score.language).toBe(34);
  });

  it("gives full field score when MIUR classe aligns", () => {
    const multi = {
      ...profileA,
      fieldsOfInterest: ["Finance", "Computer Science", "Design"],
    };
    const score = calculateFitScore(
      multi,
      {
        name: "Finance BSc",
        field: "Finance",
        fieldTags: ["Finance"],
        campusCity: "Bologna",
        region: "Emilia-Romagna",
        teachingLanguages: ["English"],
        degreeClass: "L-33",
        miurCodes: [
          { code: "L-33", role: "primary", directions: ["Finance"] },
        ],
        inclusionEvidence: {
          kind: "exact_classe",
          matchedCodes: ["L-33"],
          matchedDirections: ["Finance"],
        },
      },
      []
    );
    expect(score.field).toBe(26);
    expect(score.language).toBe(34);
  });
});
