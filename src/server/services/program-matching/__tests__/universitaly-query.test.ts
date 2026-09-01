import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  fingerprintUniversitalyQuery,
  mapProfileToUniversitalyQuery,
  corsoMatchesCities,
} from "@/server/services/program-matching/universitaly-query";
import { buildMiurProvenance } from "@/lib/program-matching/miur-provenance";
import { normalizeMiurCode } from "@/lib/program-matching/miur-code";
import { normalizeCercaCorsiPage } from "@/server/services/program-ingestion/universitaly-client";
import type { MatchingProfile } from "@/lib/program-matching/types";
import { clearMiurClasseCache } from "@/server/services/program-matching/miur-classi";

vi.mock("@/server/services/program-matching/miur-classi", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/services/program-matching/miur-classi")
  >("@/server/services/program-matching/miur-classi");
  return {
    ...actual,
    resolveClasseId: vi.fn(async (code: string) => {
      const map: Record<string, number> = {
        "L-33": 3233,
        "L-18": 3218,
        "L-31": 3231,
        "L-8": 3208,
        "L-24": 3224,
        "L-13": 3213,
        "LM-18": 3019,
        "LM-32": 3033,
        "LM-41": 3041,
        "LM-46": 3046,
        "LM-42": 3042,
        "LM-13": 3013,
        "LM-56": 3357,
        "LM-77": 3378,
        "L-4": 9994,
      };
      const key = code.trim().toUpperCase().replace(/\s+/g, "").replace(/\.+$/g, "");
      return map[key] ?? map[code.trim().toUpperCase()] ?? null;
    }),
  };
});

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
    fieldsOfInterest: ["Economics"],
    preferredTeachingLanguages: ["English"],
    preferredCities: ["Bologna"],
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

describe("mapProfileToUniversitalyQuery", () => {
  beforeEach(() => {
    clearMiurClasseCache();
  });

  it("maps EN / bachelor / economics via MIUR classi (not area+exact name)", async () => {
    const plan = await mapProfileToUniversitalyQuery(baseProfile());
    expect(plan.query.lingua).toBe("EN");
    expect(plan.query.durata).toBe("3");
    expect(plan.query.area).toBeUndefined();
    expect(plan.classeCodes).toEqual(expect.arrayContaining(["L-33", "L-18"]));
    expect(plan.queries.some((q) => q.tipoClasse === 3233)).toBe(true);
    expect(plan.queries.some((q) => q.tipoClasse === 3218)).toBe(true);
    expect(plan.fingerprint).toHaveLength(24);
  });

  it("maps master CS to LM-18 / LM-32 with Italian", async () => {
    const plan = await mapProfileToUniversitalyQuery(
      baseProfile({
        desiredDegreeLevel: "MASTER",
        preferredTeachingLanguages: ["Italian"],
        fieldsOfInterest: ["Computer Science"],
      })
    );
    expect(plan.query.lingua).toBe("IT");
    expect(plan.query.durata).toBe("2");
    expect(plan.classeCodes).toEqual(expect.arrayContaining(["LM-18", "LM-32"]));
    expect(plan.query.tipoClasse).toBeDefined();
  });

  it("maps bachelor CS to L-31 + L-8 sphere", async () => {
    const plan = await mapProfileToUniversitalyQuery(
      baseProfile({ fieldsOfInterest: ["Computer Science"] })
    );
    expect(plan.classeCodes).toEqual(expect.arrayContaining(["L-31", "L-8"]));
    expect(plan.queries.some((q) => q.tipoClasse === 3231)).toBe(true);
    expect(plan.queries.some((q) => q.tipoClasse === 3208)).toBe(true);
  });

  it("maps medicine LM-41 to durata 6", async () => {
    const plan = await mapProfileToUniversitalyQuery(
      baseProfile({
        desiredDegreeLevel: "SINGLE_CYCLE",
        fieldsOfInterest: ["Медицина и хирургия"],
      })
    );
    expect(plan.classeCodes).toContain("LM-41");
    expect(plan.queries.every((q) => q.durata === "6")).toBe(true);
  });

  it("maps single-cycle without known classe map to durata 5", async () => {
    const plan = await mapProfileToUniversitalyQuery(
      baseProfile({ desiredDegreeLevel: "SINGLE_CYCLE" })
    );
    expect(plan.query.durata).toBe("5");
  });

  it("preserves all selected questionnaire directions in provenance", async () => {
    const plan = await mapProfileToUniversitalyQuery(
      baseProfile({
        fieldsOfInterest: [
          "Экономические науки",
          "Компьютерные технологии",
          "Психология",
        ],
      })
    );
    expect(plan.directions).toEqual(
      expect.arrayContaining([
        "Экономические науки",
        "Компьютерные технологии",
        "Психология",
      ])
    );
    expect(plan.miurCodes.some((m) => m.code === "L-24" && m.role === "primary")).toBe(
      true
    );
  });

  it("aligns query plan provenance with shared buildMiurProvenance", async () => {
    const profile = baseProfile({
      fieldsOfInterest: [
        "Экономические науки",
        "Компьютерные технологии",
        "Психология",
      ],
    });
    const provenance = buildMiurProvenance(profile);
    const plan = await mapProfileToUniversitalyQuery(profile);
    expect(plan.directions).toEqual(provenance.directions);
    expect(plan.miurCodes).toEqual(provenance.miurCodes);
    expect(plan.classeCodes).toEqual(provenance.classeCodes);
    for (const q of plan.queries) {
      expect(provenance.classeCodes).toContain(
        normalizeMiurCode(q.classeCode ?? "")
      );
    }
  });

  it("opens dual lingua queries when both English and Italian preferred", async () => {
    const plan = await mapProfileToUniversitalyQuery(
      baseProfile({ preferredTeachingLanguages: ["English", "Italian"] })
    );
    expect(plan.queries.map((q) => q.lingua).sort()).toEqual(
      expect.arrayContaining(["EN", "IT"])
    );
    const en = plan.queries.filter((q) => q.lingua === "EN").length;
    const it = plan.queries.filter((q) => q.lingua === "IT").length;
    expect(en).toBe(it);
    expect(en).toBeGreaterThan(0);
  });

  it("builds queries across distinct directions / classi", async () => {
    const plan = await mapProfileToUniversitalyQuery(
      baseProfile({
        fieldsOfInterest: ["Economics", "Computer Science", "Design"],
      })
    );
    expect(plan.directions).toEqual([
      "Economics",
      "Computer Science",
      "Design",
    ]);
    expect(plan.classeCodes.length).toBeGreaterThanOrEqual(3);
    expect(plan.queries.length).toBeGreaterThanOrEqual(3);
  });

  it("multiplies slices by both linguas", async () => {
    const plan = await mapProfileToUniversitalyQuery(
      baseProfile({
        preferredTeachingLanguages: ["English", "Italian"],
        fieldsOfInterest: ["Economics", "Design"],
      })
    );
    expect(plan.queries.length).toBeGreaterThanOrEqual(4);
    expect(plan.queries.filter((q) => q.lingua === "EN").length).toBe(
      plan.queries.filter((q) => q.lingua === "IT").length
    );
  });

  it("dedupes shared MIUR classi across Economics/Finance/Business", async () => {
    const plan = await mapProfileToUniversitalyQuery(
      baseProfile({
        fieldsOfInterest: ["Economics", "Finance", "Business"],
      })
    );
    const classeQueries = plan.queries.filter((q) => q.tipoClasse != null);
    const ids = new Set(classeQueries.map((q) => q.tipoClasse));
    expect(ids.size).toBe(2); // L-33 + L-18 only once each
  });

  it("prepares CS synonymQueries from filled synonym dictionaries", async () => {
    const plan = await mapProfileToUniversitalyQuery(
      baseProfile({ fieldsOfInterest: ["Computer Science"] })
    );
    expect(plan.queries.length).toBeGreaterThan(0);
    expect(plan.synonymQueries.map((q) => q.searchText)).toEqual(
      expect.arrayContaining([
        "computer",
        "informatics",
        "intelligenza artificiale",
      ])
    );
  });

  it("builds synonymQueries from FIELD_TAG_SEARCH_SYNONYMS for empty-MIUR fallback", async () => {
    const { FIELD_TAG_SEARCH_SYNONYMS } = await import(
      "@/lib/program-matching/taxonomy"
    );
    const prev = FIELD_TAG_SEARCH_SYNONYMS["Computer Science"];
    FIELD_TAG_SEARCH_SYNONYMS["Computer Science"] = ["computer", "informatics"];
    try {
      const plan = await mapProfileToUniversitalyQuery(
        baseProfile({ fieldsOfInterest: ["Computer Science"] })
      );
      expect(plan.synonymQueries.map((q) => q.searchText).sort()).toEqual([
        "computer",
        "informatics",
      ]);
      expect(plan.synonymQueries.every((q) => q.tipoClasse == null)).toBe(true);
      expect(plan.synonymQueries.every((q) => q.lingua === "EN")).toBe(true);
    } finally {
      if (prev) FIELD_TAG_SEARCH_SYNONYMS["Computer Science"] = prev;
      else delete FIELD_TAG_SEARCH_SYNONYMS["Computer Science"];
    }
  });

  it("fingerprints stably for same excluded cities", () => {
    const a = fingerprintUniversitalyQuery(
      { lingua: "EN", durata: "3", tipoClasse: 3233 },
      ["Bologna", "Milan"]
    );
    const b = fingerprintUniversitalyQuery(
      { lingua: "EN", durata: "3", tipoClasse: 3233 },
      ["Milan", "Bologna"]
    );
    expect(a).toBe(b);
  });
});

describe("corsoMatchesCities", () => {
  it("keeps excluded cities out", () => {
    expect(
      corsoMatchesCities(
        {
          nomeStruttura: "Università di Milano",
          sede: { comuneDescrizione: "Milano" },
        },
        [],
        ["Milano"]
      )
    ).toBe(false);
  });

  it("does not gate on preferred cities — secondary filter only", () => {
    expect(
      corsoMatchesCities(
        {
          nomeStruttura: "Università di Palermo",
          sede: { comuneDescrizione: "Palermo" },
        },
        ["Bologna"],
        []
      )
    ).toBe(true);
  });

  it("soft-keeps when sede empty", () => {
    expect(
      corsoMatchesCities(
        {
          nomeStruttura: "Alma Mater Studiorum - Università di Bologna",
          sede: null,
        },
        ["Bologna"],
        []
      )
    ).toBe(true);
  });
});

describe("Cineca response normalize", () => {
  it("normalizes flat searchType=u shape", () => {
    const page = normalizeCercaCorsiPage({
      corsi: [{ id: 1, nomeCorso: "Economics" }],
      totalResults: 1,
      totalPages: 1,
      currentPage: 1,
    });
    expect(page.corsi).toHaveLength(1);
    expect(page.totalPages).toBe(1);
  });

  it("normalizes nested universita shape", () => {
    const page = normalizeCercaCorsiPage({
      universita: {
        corsi: [{ id: 2 }],
        totalResults: 12,
        totalPages: 2,
        currentPage: 1,
      },
      afam: { corsi: [] },
    });
    expect(page.corsi[0].id).toBe(2);
    expect(page.totalResults).toBe(12);
  });
});
