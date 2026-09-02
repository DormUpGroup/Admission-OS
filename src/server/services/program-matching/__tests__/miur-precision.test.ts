import { describe, expect, it } from "vitest";
import { FIT_SCORE_WEIGHTS, MATCH_LIMIT_MIN } from "@/lib/program-matching/config";
import {
  durataForClasse,
  isKnownSingleCycleClasse,
} from "@/lib/program-matching/miur-durata";
import { normalizeMiurCode } from "@/lib/program-matching/miur-code";
import { buildMiurProvenance } from "@/lib/program-matching/miur-provenance";
import {
  fieldTagsToDirectionSlices,
} from "@/lib/program-matching/taxonomy";
import { QUESTIONNAIRE_DIRECTION_MIUR } from "@/lib/program-directions";
import {
  isCandidateRelevant,
} from "@/server/services/program-matching/candidate-relevance";
import { calculateFitScore } from "@/server/services/program-matching/fit-score";
import { buildDiscoveryMeta } from "@/server/services/program-matching/discovery-meta";
import { compareProgramMatchOrder } from "@/server/services/program-matching/match-rank";
import { applyShortlistComposition } from "@/server/services/program-matching/match-compose";
import { resolveCampusCity } from "@/server/services/program-ingestion/universitaly-upsert";
import {
  allocatePagesRoundRobin,
  orderPrimaryQueriesForThinPoolRetry,
  shouldRetrySingleCycleDurata6,
  splitCoverageByAllocation,
} from "@/server/services/program-matching/universitaly-query";
import type { MatchingProfile } from "@/lib/program-matching/types";

function baseProfile(over: Partial<MatchingProfile> = {}): MatchingProfile {
  return {
    studentId: "s1",
    targetAcademicYear: "2027/2028",
    citizenship: "Kazakhstan",
    secondCitizenship: "UNKNOWN",
    countryOfResidence: "Kazakhstan",
    applicantCategory: "NON_EU_RESIDENT_ABROAD",
    visaRequired: true,
    currentEducationLevel: "HIGH_SCHOOL",
    schoolCountry: "Kazakhstan",
    yearsOfSchooling: 11,
    diplomaType: "UNKNOWN",
    universityDegree: "UNKNOWN",
    degreeField: "UNKNOWN",
    gpa: "UNKNOWN",
    englishLevel: "B2",
    englishCertificateRaw: "UNKNOWN",
    ielts: "UNKNOWN",
    toefl: "UNKNOWN",
    italianLevel: "UNKNOWN",
    italianCertificateRaw: "UNKNOWN",
    sat: "UNKNOWN",
    tolc: {},
    desiredDegreeLevel: "BACHELOR",
    fieldsOfInterest: ["Психология"],
    preferredTeachingLanguages: ["English"],
    preferredCities: [],
    preferredRegions: [],
    excludedCities: [],
    excludedRegions: [],
    mustBeInPreferredLocation: false,
    maxTuition: "UNKNOWN",
    needsScholarship: "UNKNOWN",
    dsuPriority: "UNKNOWN",
    studyModes: ["inPerson"],
    missingFields: [],
    ...over,
  };
}

describe("durataForClasse", () => {
  it("maps LM-41/46 → 6 and LM-42/LM-13/LMR/02 → 5", () => {
    expect(durataForClasse("LM-41", "SINGLE_CYCLE")).toBe("6");
    expect(durataForClasse("LM-46", "SINGLE_CYCLE")).toBe("6");
    expect(durataForClasse("LM-42", "SINGLE_CYCLE")).toBe("5");
    expect(durataForClasse("LM-13", "SINGLE_CYCLE")).toBe("5");
    expect(durataForClasse("LMR/02", "SINGLE_CYCLE")).toBe("5");
    expect(isKnownSingleCycleClasse("LM-41")).toBe(true);
  });

  it("uses bachelor/master defaults", () => {
    expect(durataForClasse("L-24", "BACHELOR")).toBe("3");
    expect(durataForClasse("LM-56", "MASTER")).toBe("2");
    expect(durataForClasse("LM-99", "SINGLE_CYCLE")).toBe("5");
  });
});

describe("normalizeMiurCode", () => {
  it("strips spaces and trailing dots", () => {
    expect(normalizeMiurCode(" lm-41 ")).toBe("LM-41");
    expect(normalizeMiurCode("LM-53.")).toBe("LM-53");
  });
});

describe("Psychology taxonomy", () => {
  it("bachelor Psychology is L-24 only; Cognitive keeps L-13", () => {
    expect(QUESTIONNAIRE_DIRECTION_MIUR["Психология"].bachelor).toEqual([
      "L-24",
    ]);
    expect(QUESTIONNAIRE_DIRECTION_MIUR["Когнитивные науки"].bachelor).toEqual(
      expect.arrayContaining(["L-24", "L-13"])
    );
    const psych = fieldTagsToDirectionSlices(["Психология"], {
      degreeLevel: "BACHELOR",
    });
    expect(psych.map((s) => s.classeCode)).toEqual(["L-24"]);
    expect(psych[0].role).toBe("primary");
  });
});

describe("multi-direction slices", () => {
  it("keeps all labels and marks primary/secondary without silent top-3 drop", () => {
    const labels = [
      "Экономические науки",
      "Компьютерные технологии",
      "Психология",
      "Химические науки",
    ];
    const slices = fieldTagsToDirectionSlices(labels, {
      degreeLevel: "BACHELOR",
    });
    const tags = [...new Set(slices.map((s) => s.tag))];
    expect(tags).toEqual(expect.arrayContaining(labels));
    expect(tags).toHaveLength(4);
    const econ = slices.filter((s) => s.tag === "Экономические науки");
    expect(econ[0].role).toBe("primary");
    expect(econ[1]?.role).toBe("secondary");
  });
});

describe("buildMiurProvenance", () => {
  it("characterizes primary/secondary roles and shared classe directions", () => {
    const provenance = buildMiurProvenance(
      baseProfile({
        fieldsOfInterest: [
          "Экономические науки",
          "Компьютерные технологии",
          "Психология",
        ],
      })
    );
    expect(provenance.directions).toEqual([
      "Экономические науки",
      "Компьютерные технологии",
      "Психология",
    ]);
    expect(provenance.classeCodes).toEqual(
      expect.arrayContaining(["L-33", "L-18", "L-31", "L-8", "L-24"])
    );
    expect(
      provenance.miurCodes.find((m) => m.code === "L-33" && m.role === "primary")
        ?.directions
    ).toContain("Экономические науки");
    expect(
      provenance.miurCodes.find((m) => m.code === "L-8" && m.role === "secondary")
        ?.directions
    ).toContain("Компьютерные технологии");
    expect(
      provenance.miurCodes.filter((m) => m.code === "L-24").map((m) => m.role)
    ).toEqual(["primary"]);
  });
});

describe("allocatePagesRoundRobin", () => {
  it("never exceeds page budget and defers when Q > budget", () => {
    const pages = allocatePagesRoundRobin(12, 10);
    expect(pages.reduce((a, b) => a + b, 0)).toBe(10);
    expect(pages.filter((p) => p === 0).length).toBe(2);
    expect(pages.filter((p) => p > 0).every((p) => p === 1)).toBe(true);
  });

  it("spreads evenly when budget > queries", () => {
    const pages = allocatePagesRoundRobin(3, 10);
    expect(pages.reduce((a, b) => a + b, 0)).toBe(10);
    expect(Math.max(...pages) - Math.min(...pages)).toBeLessThanOrEqual(1);
  });
});

describe("soft-gate isCandidateRelevant", () => {
  it("passes exact classe and rejects foreign classe without strong tag", () => {
    const pass = isCandidateRelevant({
      degreeClass: "L-24",
      name: "Psychology",
      fieldTags: [],
      selectedClasses: ["L-24"],
      selectedDirections: ["Психология"],
    });
    expect(pass.relevant).toBe(true);
    expect(pass.evidence?.kind).toBe("exact_classe");

    const reject = isCandidateRelevant({
      degreeClass: "L-32",
      name: "Marine Biology and Ecology",
      fieldTags: ["Biology"],
      selectedClasses: ["L-24"],
      selectedDirections: ["Психология"],
    });
    expect(reject.relevant).toBe(false);
  });

  it("rejects cached PAY with wrong degreeClass", () => {
    const r = isCandidateRelevant({
      degreeClass: "L-18",
      name: "Business Administration",
      fieldTags: ["Business"],
      selectedClasses: ["L-31", "L-8"],
      selectedDirections: ["Компьютерные технологии"],
    });
    expect(r.relevant).toBe(false);
  });
});

describe("primary/secondary field fit", () => {
  it("scores secondary shared classe below max without strong tag", () => {
    const profile = baseProfile({
      fieldsOfInterest: ["Компьютерные технологии"],
    });
    const secondaryOnly = calculateFitScore(
      profile,
      {
        name: "Industrial Engineering",
        field: "Engineering",
        fieldTags: ["Engineering"],
        teachingLanguages: ["English"],
        degreeClass: "L-8",
        miurCodes: [
          {
            code: "L-31",
            role: "primary",
            directions: ["Компьютерные технологии"],
          },
          {
            code: "L-8",
            role: "secondary",
            directions: ["Компьютерные технологии"],
          },
        ],
      },
      []
    );
    expect(secondaryOnly.field).toBeLessThan(FIT_SCORE_WEIGHTS.field);
    expect(secondaryOnly.field).toBeGreaterThan(0);

    const primary = calculateFitScore(
      profile,
      {
        name: "Computer Science",
        field: "Computer Science",
        fieldTags: ["Computer Science"],
        teachingLanguages: ["English"],
        degreeClass: "L-31",
        miurCodes: [
          {
            code: "L-31",
            role: "primary",
            directions: ["Компьютерные технологии"],
          },
        ],
      },
      []
    );
    expect(primary.field).toBe(FIT_SCORE_WEIGHTS.field);
  });
});

describe("discovery metadata", () => {
  it("includes directions, codes, inclusion evidence, whyIncluded", () => {
    const meta = buildDiscoveryMeta({
      selectedDirections: ["Психология"],
      miurCodes: [
        { code: "L-24", role: "primary", directions: ["Психология"] },
      ],
      evidence: {
        kind: "exact_classe",
        matchedCodes: ["L-24"],
        matchedDirections: [],
        detail: "L-24",
      },
    });
    expect(meta.selectedDirections).toContain("Психология");
    expect(meta.miurCodes[0].code).toBe("L-24");
    expect(meta.inclusion.kind).toBe("exact_classe");
    expect(meta.whyIncluded).toMatch(/L-24/);
  });
});

const COMPENG_MIUR = [
  {
    code: "L-31",
    role: "primary" as const,
    directions: ["Компьютерная инженерия", "IT безопасность"],
  },
  {
    code: "L-8",
    role: "secondary" as const,
    directions: ["Компьютерная инженерия", "IT безопасность"],
  },
];

describe("acceptance: Psychology vs Biology", () => {
  it("Psychology-only does not keep Biology (L-13) without Cognitive", () => {
    const r = isCandidateRelevant({
      degreeClass: "L-13",
      name: "Marine Biology and Blue Biotechnologies",
      fieldTags: ["Biology"],
      selectedClasses: ["L-24"],
      selectedDirections: ["Психология"],
      miurCodes: [
        { code: "L-24", role: "primary", directions: ["Психология"] },
      ],
    });
    expect(r.relevant).toBe(false);
  });

  it("Psychology + Cognitive keeps L-13 as secondary_classe", () => {
    const r = isCandidateRelevant({
      degreeClass: "L-13",
      name: "Marine Biology and Blue Biotechnologies",
      fieldTags: ["Biology"],
      selectedClasses: ["L-24", "L-13"],
      selectedDirections: ["Психология", "Когнитивные науки"],
      miurCodes: [
        { code: "L-24", role: "primary", directions: ["Психология", "Когнитивные науки"] },
        { code: "L-13", role: "secondary", directions: ["Когнитивные науки"] },
      ],
    });
    expect(r.relevant).toBe(true);
    expect(r.evidence?.kind).toBe("secondary_classe");
  });
});

describe("acceptance: CompEng vs Economics", () => {
  it("rejects Economics/Finance/Data Science without sufficient evidence", () => {
    const pool = [
      {
        name: "ECONOMICS AND FINANCE WITH DATA SCIENCE",
        degreeClass: "L-18",
      },
      {
        name: "Economics: Behavior, Data and Policy",
        degreeClass: "L-33",
      },
      {
        name: "Economics, Management and Computer Science",
        degreeClass: "L-18",
      },
      {
        name: "Computer Engineering",
        degreeClass: "L-8",
      },
      {
        name: "Informatics",
        degreeClass: "L-31",
      },
    ];
    const kept = pool.filter(
      (p) =>
        isCandidateRelevant({
          degreeClass: p.degreeClass,
          name: p.name,
          fieldTags: [],
          selectedClasses: ["L-31", "L-8"],
          selectedDirections: ["Компьютерная инженерия", "IT безопасность"],
          miurCodes: COMPENG_MIUR,
        }).relevant
    );
    expect(kept.map((p) => p.name)).toEqual([
      "Computer Engineering",
      "Informatics",
    ]);
  });

  it("caps broad L-8 without a strong CompEng title below Computer Engineering", () => {
    const profile = baseProfile({
      fieldsOfInterest: ["Компьютерная инженерия", "IT безопасность"],
    });
    const biomedical = calculateFitScore(
      profile,
      {
        name: "Biomedical Engineering",
        fieldTags: ["Engineering"],
        teachingLanguages: ["English"],
        degreeClass: "L-8",
        miurCodes: COMPENG_MIUR,
      },
      []
    );
    const compEng = calculateFitScore(
      profile,
      {
        name: "Computer Engineering",
        fieldTags: ["Computer Science"],
        teachingLanguages: ["English"],
        degreeClass: "L-8",
        miurCodes: COMPENG_MIUR,
      },
      []
    );
    expect(biomedical.field).toBeLessThan(compEng.field);
    expect(
      isCandidateRelevant({
        degreeClass: "L-8",
        name: "Biomedical Engineering",
        fieldTags: [],
        selectedClasses: ["L-31", "L-8"],
        selectedDirections: ["Компьютерная инженерия"],
        miurCodes: COMPENG_MIUR,
      }).evidence?.kind
    ).toBe("secondary_classe");
  });

  it("does not give full field for generic 'computer' in an economics title", () => {
    const profile = baseProfile({
      fieldsOfInterest: ["Компьютерная инженерия", "IT безопасность", "Computer Science"],
    });
    const score = calculateFitScore(
      profile,
      {
        name: "Economics, Management and Computer Science",
        field: "Economics",
        fieldTags: ["Economics", "Computer Science"],
        teachingLanguages: ["English"],
        degreeClass: "L-18",
        miurCodes: COMPENG_MIUR,
      },
      []
    );
    expect(score.field).toBeLessThan(FIT_SCORE_WEIGHTS.field);
  });

  it("passes strong_tag on Computer Engineering title without relying on weak 'computer'", () => {
    const r = isCandidateRelevant({
      degreeClass: "L-9",
      name: "Computer Engineering",
      fieldTags: [],
      selectedClasses: ["L-31", "L-8"],
      selectedDirections: ["Компьютерная инженерия"],
      miurCodes: COMPENG_MIUR,
    });
    expect(r.relevant).toBe(true);
    expect(r.evidence?.kind).toBe("strong_tag");
  });
});

describe("ranking tie-break and geography", () => {
  it("preferred city scores higher than a miss at equal field", () => {
    const profile = baseProfile({
      fieldsOfInterest: ["Психология"],
      preferredCities: ["Padova"],
      preferredRegions: ["Veneto"],
    });
    const miur = [
      { code: "L-24", role: "primary" as const, directions: ["Психология"] },
    ];
    const padova = calculateFitScore(
      profile,
      {
        name: "Psychological Science",
        fieldTags: ["Psychology"],
        campusCity: "Padova",
        region: "Veneto",
        universityName: "Università degli Studi di PADOVA",
        teachingLanguages: ["English"],
        degreeClass: "L-24",
        miurCodes: miur,
      },
      []
    );
    const messina = calculateFitScore(
      profile,
      {
        name: "Psychological Science",
        fieldTags: ["Psychology"],
        campusCity: "Messina",
        region: "Sicily",
        universityName: "Università degli Studi di MESSINA",
        teachingLanguages: ["English"],
        degreeClass: "L-24",
        miurCodes: miur,
      },
      []
    );
    expect(padova.geography).toBe(FIT_SCORE_WEIGHTS.geography);
    expect(messina.geography).toBeLessThan(padova.geography);
    expect(padova.total).toBeGreaterThan(messina.total);
  });

  it("breaks fit ties by evidence then admission call", () => {
    const tied = compareProgramMatchOrder(
      {
        eligibilityStatus: "NEEDS_REVIEW",
        fitScore: 81,
        discoveryMeta: {
          selectedDirections: [],
          miurCodes: [],
          inclusion: { kind: "secondary_classe" },
          whyIncluded: "x",
        },
        hasAdmissionCall: true,
        dataConfidence: "HIGH",
      },
      {
        eligibilityStatus: "NEEDS_REVIEW",
        fitScore: 81,
        discoveryMeta: {
          selectedDirections: [],
          miurCodes: [],
          inclusion: { kind: "exact_classe" },
          whyIncluded: "y",
        },
        hasAdmissionCall: false,
        dataConfidence: "LOW",
      }
    );
    expect(tied).toBeGreaterThan(0);
  });
});

describe("coverage split and durata retry", () => {
  it("defers queries when Q exceeds page budget", () => {
    const queries = Array.from({ length: 12 }, (_, i) => ({
      classeCode: `L-${i}`,
      lingua: "EN",
      durata: "3",
      sourceDirections: [`d${i}`],
    }));
    const pages = allocatePagesRoundRobin(12, 10);
    const { queried, deferred } = splitCoverageByAllocation(queries, pages);
    expect(queried).toHaveLength(10);
    expect(deferred).toHaveLength(2);
    expect(deferred.every((d) => d.reason === "page_budget_exhausted")).toBe(
      true
    );
  });

  it("retries unknown single-cycle durata 5 → 6, not known LM-41", () => {
    expect(
      shouldRetrySingleCycleDurata6({
        classeCode: "LM-99",
        degreeLevel: "SINGLE_CYCLE",
        durata: "5",
        emptyResults: true,
      })
    ).toBe(true);
    expect(
      shouldRetrySingleCycleDurata6({
        classeCode: "LM-41",
        degreeLevel: "SINGLE_CYCLE",
        durata: "5",
        emptyResults: true,
      })
    ).toBe(false);
  });
});

describe("v1.7 evidence-aware scoring and rank", () => {
  it("caps field for strong_tag without classe alignment via inclusionEvidence", () => {
    const profile = baseProfile({
      fieldsOfInterest: ["Компьютерные технологии"],
    });
    const misaligned = calculateFitScore(
      profile,
      {
        name: "Economics, Management and Computer Science",
        fieldTags: ["Economics"],
        teachingLanguages: ["English"],
        degreeClass: "L-33",
        miurCodes: [
          {
            code: "L-31",
            role: "primary",
            directions: ["Компьютерные технологии"],
          },
        ],
        inclusionEvidence: {
          kind: "strong_tag",
          matchedCodes: ["L-33"],
          matchedDirections: ["Компьютерные технологии"],
        },
      },
      []
    );
    const exact = calculateFitScore(
      profile,
      {
        name: "Artificial intelligence",
        fieldTags: ["Computer Science"],
        teachingLanguages: ["English"],
        degreeClass: "L-31",
        miurCodes: [
          {
            code: "L-31",
            role: "primary",
            directions: ["Компьютерные технологии"],
          },
        ],
        inclusionEvidence: {
          kind: "exact_classe",
          matchedCodes: ["L-31"],
          matchedDirections: ["Компьютерные технологии"],
        },
      },
      []
    );
    expect(misaligned.field).toBeLessThan(exact.field);
    expect(exact.field).toBe(FIT_SCORE_WEIGHTS.field);
  });

  it("ranks exact_classe above strong_tag even when fit is lower", () => {
    const order = compareProgramMatchOrder(
      {
        eligibilityStatus: "NEEDS_REVIEW",
        fitScore: 96,
        discoveryMeta: {
          selectedDirections: [],
          miurCodes: [],
          inclusion: { kind: "strong_tag" },
          whyIncluded: "tag",
        },
      },
      {
        eligibilityStatus: "NEEDS_REVIEW",
        fitScore: 80,
        discoveryMeta: {
          selectedDirections: [],
          miurCodes: [],
          inclusion: { kind: "exact_classe" },
          whyIncluded: "L-31",
        },
      }
    );
    expect(order).toBeGreaterThan(0);
  });

  it("downgrades multi-direction titles to synonym evidence", () => {
    const { relevant, evidence } = isCandidateRelevant({
      degreeClass: "L-33",
      name: "Economics, Management and Computer Science",
      fieldTags: ["Экономические науки", "Компьютерные технологии"],
      selectedClasses: ["L-31"],
      selectedDirections: ["Компьютерные технологии"],
      miurCodes: [
        {
          code: "L-31",
          role: "primary",
          directions: ["Компьютерные технологии"],
        },
      ],
    });
    expect(relevant).toBe(true);
    expect(evidence?.kind).toBe("synonym");
  });
});

describe("v1.8 shortlist composition", () => {
  it("keeps secondary_classe when degreeClass is in MIUR plan", () => {
    const base = {
      eligibilityStatus: "NEEDS_REVIEW",
      fitScore: 70,
      dataConfidence: "LOW",
      hasAdmissionCall: false,
      usingPreviousYear: false,
    };
    const exactRows = Array.from({ length: MATCH_LIMIT_MIN }, (_, i) => ({
      ...base,
      fitScore: 90 - i,
      degreeClass: "L-17",
      discoveryMeta: {
        selectedDirections: ["Архитектура и строительная инженерия-архитектура"],
        miurCodes: [
          { code: "L-17", role: "primary" as const, directions: ["Архитектура и строительная инженерия-архитектура"] },
          { code: "L-23", role: "secondary" as const, directions: ["Архитектура и строительная инженерия-архитектура"] },
        ],
        inclusion: { kind: "exact_classe" as const },
        whyIncluded: "e",
      },
    }));
    const relatedSecondary = {
      ...base,
      fitScore: 50,
      degreeClass: "L-23",
      discoveryMeta: {
        selectedDirections: ["Архитектура и строительная инженерия-архитектура"],
        miurCodes: [
          { code: "L-17", role: "primary" as const, directions: ["Архитектура и строительная инженерия-архитектура"] },
          { code: "L-23", role: "secondary" as const, directions: ["Архитектура и строительная инженерия-архитектура"] },
        ],
        inclusion: { kind: "secondary_classe" as const },
        whyIncluded: "L-23",
      },
    };
    const offDirection = {
      ...base,
      fitScore: 45,
      degreeClass: "L-33",
      discoveryMeta: {
        selectedDirections: [],
        miurCodes: [],
        inclusion: { kind: "secondary_classe" as const },
        whyIncluded: "noise",
      },
    };
    const sorted = [...exactRows, relatedSecondary, offDirection];
    const { matches, meta } = applyShortlistComposition(
      sorted,
      ["L-17", "L-23"],
      ["Архитектура и строительная инженерия-архитектура"],
      20
    );
    expect(matches.some((m) => m.degreeClass === "L-23")).toBe(true);
    expect(matches.some((m) => m.degreeClass === "L-33")).toBe(false);
    expect(meta.excludedOffDirection).toBe(1);
  });

  it("drops off-plan secondary when enough high-quality matches exist", () => {
    const base = {
      eligibilityStatus: "NEEDS_REVIEW",
      fitScore: 70,
      dataConfidence: "LOW",
      hasAdmissionCall: false,
      usingPreviousYear: false,
    };
    const exactRows = Array.from({ length: MATCH_LIMIT_MIN }, (_, i) => ({
      ...base,
      fitScore: 90 - i,
      degreeClass: "L-31",
      discoveryMeta: {
        selectedDirections: [],
        miurCodes: [],
        inclusion: { kind: "exact_classe" as const },
        whyIncluded: `e${i}`,
      },
    }));
    const sorted = [
      ...exactRows,
      {
        ...base,
        fitScore: 50,
        degreeClass: "L-8",
        discoveryMeta: {
          selectedDirections: [],
          miurCodes: [],
          inclusion: { kind: "secondary_classe" as const },
          whyIncluded: "c",
        },
      },
    ];
    const { matches, meta } = applyShortlistComposition(
      sorted,
      ["L-31"],
      ["Компьютерные технологии"],
      20
    );
    expect(matches.every((m) => m.discoveryMeta.inclusion.kind !== "secondary_classe" || m.degreeClass === "L-31")).toBe(true);
    expect(meta.excludedOffDirection).toBe(1);
  });
});

describe("v1.7 city resolution", () => {
  it("parses city from nomeStruttura when sede missing", () => {
    const city = resolveCampusCity({
      id: 1,
      nomeStruttura: 'Università Commerciale "Luigi Bocconi" MILANO',
      sede: null,
    } as import("@/server/services/program-ingestion/universitaly-client").UniversitalyCorso);
    expect(city?.toUpperCase()).toContain("MILANO");
  });

  it("parses Venezia from Ca' Foscari nomeStruttura", () => {
    const city = resolveCampusCity({
      id: 2,
      nomeStruttura: "Università Ca' Foscari VENEZIA",
      sede: null,
    } as import("@/server/services/program-ingestion/universitaly-client").UniversitalyCorso);
    expect(city?.toLowerCase()).toMatch(/venezia|venice/);
  });

  it("does not invent campus city when sede and name have no city", () => {
    const city = resolveCampusCity({
      id: 3,
      nomeStruttura: "Politecnico di Something",
      sede: null,
    } as import("@/server/services/program-ingestion/universitaly-client").UniversitalyCorso);
    // No university.city fallback parameter exists anymore.
    expect(city).toBeNull();
  });

  it("uses sede.comuneDescrizione when present", () => {
    const city = resolveCampusCity({
      id: 4,
      nomeStruttura: "Università di Bologna",
      sede: { comuneDescrizione: "Cesena" },
    } as import("@/server/services/program-ingestion/universitaly-client").UniversitalyCorso);
    expect(city).toBe("Cesena");
  });
});

describe("orderPrimaryQueriesForThinPoolRetry", () => {
  it("puts deferred primary queries before other primaries", () => {
    const queries = [
      {
        classeCode: "L-31",
        lingua: "2",
        durata: "3",
        roles: ["primary"],
        sourceDirections: ["CS"],
      },
      {
        classeCode: "L-18",
        lingua: "2",
        durata: "3",
        roles: ["primary"],
        sourceDirections: ["Econ"],
      },
      {
        classeCode: "L-33",
        lingua: "2",
        durata: "3",
        roles: ["secondary"],
        sourceDirections: ["Econ"],
      },
    ];
    const deferred = [
      {
        classeCode: "L-18",
        lingua: "2",
        durata: "3",
        sourceDirections: ["Econ"],
        pagesAllocated: 0,
        reason: "page_budget_exhausted",
      },
    ];
    const ordered = orderPrimaryQueriesForThinPoolRetry(queries, deferred);
    expect(ordered.map((q) => q.classeCode)).toEqual(["L-18", "L-31"]);
  });
});

