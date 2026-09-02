import { parseJsonArray } from "@/lib/parse-json-array";
import { prisma } from "@/lib/db";
import {
  LIGHT_ENRICH_CANDIDATE_CAP,
  MATCH_LIMIT_DEFAULT,
  MATCH_LIMIT_MAX,
  MATCHING_ENGINE_VERSION,
} from "@/lib/program-matching/config";
import { buildMiurProvenance } from "@/lib/program-matching/miur-provenance";
import type { MatchingProfile } from "@/lib/program-matching/types";
import { previousAcademicYear } from "./compare";
import { evaluateEligibility } from "./eligibility";
import { buildExplanation } from "./explanation";
import { calculateFitScore } from "./fit-score";
import { buildMatchingProfileFromStudent } from "./matching-profile";
import { isCandidateRelevant } from "./candidate-relevance";
import { buildDiscoveryMeta, type DiscoveryMeta } from "./discovery-meta";
import { compareProgramMatchOrder } from "./match-rank";
import {
  applyShortlistComposition,
  shareByInclusionKind,
} from "./match-compose";
import {
  getEnrichmentConfig,
  isProgramEnrichmentEnabled,
  toMinimalMatchingContext,
} from "@/server/services/program-enrichment";

export async function buildMatchingProfile(studentId: string): Promise<MatchingProfile | null> {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student) return null;
  return buildMatchingProfileFromStudent(student);
}

export async function generateProgramMatches(
  studentId: string,
  options?: {
    limit?: number;
    includeNotEligible?: boolean;
    /** When set, only score these academic-year rows (+ shortlisted if includeShortlisted). */
    programAcademicYearIds?: string[];
    includeShortlisted?: boolean;
    /** Skip shortlist composition filter (used for enrich pass). */
    skipComposition?: boolean;
  }
) {
  const limit = options?.limit ?? MATCH_LIMIT_DEFAULT;
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { applications: { select: { id: true, programId: true } } },
  });
  if (!student) return [];

  const profile = buildMatchingProfileFromStudent(student);
  const targetYear = profile.targetAcademicYear;
  const fallbackYear = previousAcademicYear(targetYear);
  const provenance = buildMiurProvenance(profile);

  const hasScope = options?.programAcademicYearIds !== undefined;
  const scopedIds = new Set(options?.programAcademicYearIds ?? []);
  const shortlistedPayIds = new Set<string>();
  if (hasScope && options?.includeShortlisted !== false) {
    const shortlisted = await prisma.studentShortlistItem.findMany({
      where: { studentId },
      select: { programAcademicYearId: true },
    });
    for (const s of shortlisted) {
      scopedIds.add(s.programAcademicYearId);
      shortlistedPayIds.add(s.programAcademicYearId);
    }
  } else {
    const shortlisted = await prisma.studentShortlistItem.findMany({
      where: { studentId },
      select: { programAcademicYearId: true },
    });
    for (const s of shortlisted) shortlistedPayIds.add(s.programAcademicYearId);
  }

  const academicYears = await prisma.programAcademicYear.findMany({
    where: hasScope
      ? { id: { in: [...scopedIds] } }
      : {
          academicYear: {
            in: [targetYear, fallbackYear].filter(Boolean) as string[],
          },
          program: { active: true },
        },
    include: {
      program: { include: { university: true } },
      requirements: true,
      cycles: true,
      tuition: true,
      facts: { where: { superseded: false }, take: 20 },
    },
  });
  // Prefer target year row per program; fall back to previous year
  const byProgram = new Map<string, (typeof academicYears)[number]>();
  for (const row of academicYears) {
    const existing = byProgram.get(row.programId);
    if (!existing) {
      byProgram.set(row.programId, row);
      continue;
    }
    if (row.academicYear === targetYear) byProgram.set(row.programId, row);
  }

  const applied = new Map(student.applications.map((a) => [a.programId, a.id]));
  const results: Array<{
    programAcademicYearId: string;
    programId: string;
    programName: string;
    degreeClass: string | null;
    degreeLevel: string;
    language: string | null;
    field: string | null;
    universityId: string;
    universityName: string;
    city: string | null;
    region: string | null;
    academicYear: string;
    eligibilityStatus: string;
    fitScore: number;
    scoreBreakdown: ReturnType<typeof calculateFitScore>;
    evaluations: ReturnType<typeof evaluateEligibility>["evaluations"];
    reasons: string[];
    risks: string[];
    riskNotes: string[];
    missingInformation: string[];
    dataConfidence: string;
    deadline: Date | null;
    tuitionMin: number | null;
    tuitionMax: number | null;
    usingPreviousYear: boolean;
    alreadyApplied: boolean;
    applicationId: string | undefined;
    sourceUrls: string[];
    discoveryMeta: DiscoveryMeta;
    hasAdmissionCall: boolean;
  }> = [];

  for (const pay of byProgram.values()) {
    const program = pay.program;
    const teachingLanguages =
      parseJsonArray(program.teachingLanguagesJson).length > 0
        ? parseJsonArray(program.teachingLanguagesJson)
        : program.language
          ? [program.language]
          : [];
    const fieldTags = parseJsonArray(program.fieldTagsJson);
    const usingPreviousYear = pay.academicYear !== targetYear;
    const callMissing = !pay.facts.some((f) => f.sourceType === "ADMISSION_CALL");
    const isShortlisted = shortlistedPayIds.has(pay.id);

    const relevance = isCandidateRelevant({
      degreeClass: program.degreeClass,
      name: program.name,
      fieldTags,
      selectedClasses: provenance.classeCodes,
      selectedDirections: provenance.directions.length
        ? provenance.directions
        : profile.fieldsOfInterest,
      miurCodes: provenance.miurCodes,
    });

    // Soft-gate before fit rank; never drop manual shortlist items.
    if (
      !isShortlisted &&
      provenance.classeCodes.length > 0 &&
      !relevance.relevant
    ) {
      continue;
    }

    const eligibility = evaluateEligibility({
      profile,
      programDegreeLevel: program.degreeLevel,
      teachingLanguages,
      campusCity: program.campusCity,
      region: program.region,
      requirements: pay.requirements.map((r) => ({
        type: r.type,
        required: r.required,
        operator: r.operator,
        valueJson: r.valueJson,
        description: r.description,
        hardExclusion: r.hardExclusion,
      })),
      cycles: pay.cycles.map((c) => ({
        applicationDeadline: c.applicationDeadline,
        applicantCategory: c.applicantCategory,
      })),
      dataConfidence: pay.dataConfidence,
      usingPreviousYear,
    });

    if (eligibility.status === "NOT_ELIGIBLE" && !options?.includeNotEligible) {
      continue;
    }

    const englishReq = pay.requirements.find((r) => r.type === "LANGUAGE");
    let englishRequired: string | null = null;
    if (englishReq?.valueJson) {
      try {
        englishRequired = String(JSON.parse(englishReq.valueJson).level ?? null);
      } catch {
        englishRequired = null;
      }
    }

    const breakdown = calculateFitScore(
      profile,
      {
        name: program.name,
        field: program.field,
        fieldTags,
        campusCity: program.campusCity,
        region: program.region,
        universityName: program.university.name,
        teachingLanguages,
        deliveryMode: program.deliveryMode,
        minTuition: pay.tuition?.minTuition,
        maxTuition: pay.tuition?.maxTuition,
        degreeClass: program.degreeClass,
        miurCodes: provenance.miurCodes,
        inclusionEvidence: relevance.evidence,
        englishRequired,
      },
      eligibility.evaluations
    );

    const explanation = buildExplanation({
      profile,
      eligibility: eligibility.status,
      breakdown,
      evaluations: eligibility.evaluations,
      risks: eligibility.risks,
      teachingLanguages,
      city: program.campusCity,
      region: program.region,
      tuitionKnown: !!(pay.tuition?.minTuition || pay.tuition?.maxTuition || pay.tuition?.fixedTuition),
      usingPreviousYear,
      callMissing,
    });

    const discoveryMeta = buildDiscoveryMeta({
      selectedDirections: provenance.directions.length
        ? provenance.directions
        : profile.fieldsOfInterest,
      miurCodes: provenance.miurCodes,
      evidence: relevance.evidence,
      shortlisted: isShortlisted,
    });

    results.push({
      programAcademicYearId: pay.id,
      programId: program.id,
      programName: program.name,
      degreeClass: program.degreeClass,
      degreeLevel: program.degreeLevel,
      language: teachingLanguages[0] || program.language,
      field: program.field,
      universityId: program.universityId,
      universityName: program.university.name,
      city: program.campusCity,
      region: program.region,
      academicYear: pay.academicYear,
      eligibilityStatus: eligibility.status,
      fitScore: breakdown.total,
      scoreBreakdown: breakdown,
      evaluations: eligibility.evaluations,
      reasons: explanation.reasons,
      risks: explanation.risks,
      riskNotes: explanation.riskNotes,
      missingInformation: explanation.missingInformation,
      dataConfidence: pay.dataConfidence,
      deadline: pay.cycles[0]?.applicationDeadline ?? null,
      tuitionMin: pay.tuition?.minTuition ?? null,
      tuitionMax: pay.tuition?.maxTuition ?? null,
      usingPreviousYear,
      alreadyApplied: applied.has(program.id),
      applicationId: applied.get(program.id),
      sourceUrls: [
        ...new Set(
          [
            program.officialUrl,
            program.universitalyUrl,
            ...pay.facts.map((f) => f.sourceUrl).filter(Boolean),
          ].filter(Boolean) as string[]
        ),
      ],
      discoveryMeta,
      hasAdmissionCall: !callMissing,
    });
  }

  results.sort((a, b) =>
    compareProgramMatchOrder(
      { ...a, degreeClass: a.degreeClass },
      { ...b, degreeClass: b.degreeClass }
    )
  );

  if (options?.skipComposition) {
    return results.slice(0, limit);
  }

  const { matches } = applyShortlistComposition(
    results,
    provenance.classeCodes,
    provenance.directions,
    limit
  );
  return matches;
}

export type MatchProgressStage =
  | "profile"
  | "universitaly"
  | "score"
  | "documents"
  | "ai_extract"
  | "enrich"
  | "rank"
  | "save"
  | "done";

export type MatchProgressEvent = {
  stage: MatchProgressStage;
  label: string;
  percent: number;
  detail?: string;
};

export async function persistProgramMatches(
  studentId: string,
  options?: {
    forceRefresh?: boolean;
    skipLiveSearch?: boolean;
    onProgress?: (event: MatchProgressEvent) => void;
  }
) {
  const report = (
    stage: MatchProgressStage,
    label: string,
    percent: number,
    detail?: string
  ) => options?.onProgress?.({ stage, label, percent, detail });

  report("profile", "Читаем профиль анкеты", 5);
  const profile = await buildMatchingProfile(studentId);
  let liveMeta: Awaited<
    ReturnType<
      typeof import("./universitaly-live-search").searchUniversitalyForProfile
    >
  > | null = null;

  if (profile && !options?.skipLiveSearch) {
    report("universitaly", "Поиск программ на Universitaly", 15);
    const { searchUniversitalyForProfile } = await import(
      "./universitaly-live-search"
    );
    liveMeta = await searchUniversitalyForProfile(profile, {
      forceRefresh: options?.forceRefresh,
    });
    report(
      "universitaly",
      "Поиск на Universitaly завершён",
      45,
      liveMeta.candidateCount != null
        ? `${liveMeta.candidateCount} кандидатов`
        : undefined
    );
  } else {
    report("universitaly", "Используем локальный каталог", 45);
  }

  report("score", "Оценка fit и eligibility", 55);
  // Pass 1: hard eligibility + fit on discovery pool (no enrich yet).
  const aiCap = isProgramEnrichmentEnabled()
    ? getEnrichmentConfig().maxCandidates
    : LIGHT_ENRICH_CANDIDATE_CAP;
  const ranked = await generateProgramMatches(studentId, {
    includeNotEligible: false,
    limit: Math.max(MATCH_LIMIT_DEFAULT, aiCap),
    programAcademicYearIds: liveMeta?.programAcademicYearIds,
    includeShortlisted: true,
    skipComposition: true,
  });

  report("documents", "Официальные документы программ", 62);
  let enrichedCount = 0;
  let reusedCount = 0;
  let aiProcessed = 0;
  let enrichedPayIds: string[] = [];

  if (ranked.length > 0 && profile) {
    const queueSize = Math.min(ranked.length, aiCap);
    const queue = ranked.slice(0, queueSize);
    const remaining = ranked.slice(queueSize);
    const matchingContexts = new Map(
      queue.map((m) => [
        m.programAcademicYearId,
        toMinimalMatchingContext({
          profile,
          miurCodes: (liveMeta?.miurCodes ?? []).map((c) => ({
            code: c.code,
            role: c.role,
            sourceDirections: c.directions ?? [],
          })),
          program: {
            name: m.programName,
            universityName: m.universityName,
            degreeClass: m.degreeClass,
            language: m.language,
            durationYears: null,
            campusCity: m.city,
            officialUrl: m.sourceUrls?.[0] ?? null,
          },
        }),
      ])
    );

    const { ensureProgramDossiers } = await import("./program-dossier");

    const runBatch = async (ids: string[], labelPrefix: string) => {
      report(
        "ai_extract",
        isProgramEnrichmentEnabled()
          ? `AI extraction: 0 / ${ids.length}`
          : `${labelPrefix}: regex/PDF fallback`,
        70,
        isProgramEnrichmentEnabled() ? undefined : "AI enrichment выключен"
      );
      return ensureProgramDossiers(ids, {
        applicantCategory: profile.applicantCategory,
        matchingContexts,
        onProgress: (done, total) => {
          report(
            "ai_extract",
            isProgramEnrichmentEnabled()
              ? `AI extraction: ${done} / ${total}`
              : `Обогащение: ${done} / ${total}`,
            70 + Math.round((done / Math.max(total, 1)) * 10)
          );
        },
      });
    };

    let dossierResults = await runBatch(
      queue.map((m) => m.programAcademicYearId),
      "Обогащение досье"
    );
    enrichedCount = dossierResults.filter((r) => r.enriched).length;
    reusedCount = dossierResults.filter((r) => r.reused).length;
    aiProcessed = dossierResults.length;
    enrichedPayIds = queue.map((m) => m.programAcademicYearId);

    // If quality cards are thin, pull next batch from remaining discovery pool
    const qualityAfter = dossierResults.filter(
      (r) => r.enriched || r.reused
    ).length;
    if (
      qualityAfter < MATCH_LIMIT_DEFAULT &&
      remaining.length > 0 &&
      isProgramEnrichmentEnabled()
    ) {
      const next = remaining.slice(0, Math.min(remaining.length, aiCap));
      for (const m of next) {
        matchingContexts.set(
          m.programAcademicYearId,
          toMinimalMatchingContext({
            profile,
            program: {
              name: m.programName,
              universityName: m.universityName,
              degreeClass: m.degreeClass,
              language: m.language,
              durationYears: null,
              campusCity: m.city,
              officialUrl: m.sourceUrls?.[0] ?? null,
            },
          })
        );
      }
      const extra = await runBatch(
        next.map((m) => m.programAcademicYearId),
        "Доп. порция"
      );
      dossierResults = [...dossierResults, ...extra];
      enrichedCount += extra.filter((r) => r.enriched).length;
      reusedCount += extra.filter((r) => r.reused).length;
      aiProcessed += extra.length;
      enrichedPayIds = [
        ...enrichedPayIds,
        ...next.map((m) => m.programAcademicYearId),
      ];
    }

    if (liveMeta) {
      liveMeta = { ...liveMeta, enrichedCount };
    }
  }

  report("rank", "Финальное ранжирование", 85);
  // Pass 2: re-score after dossier ensure (language / tuition / facts may have updated).
  const enrichScopeIds =
    enrichedPayIds.length > 0
      ? enrichedPayIds
      : ranked.slice(0, LIGHT_ENRICH_CANDIDATE_CAP).map((m) => m.programAcademicYearId);
  const generated = await generateProgramMatches(studentId, {
    includeNotEligible: false,
    limit: MATCH_LIMIT_MAX,
    programAcademicYearIds:
      enrichScopeIds.length > 0
        ? enrichScopeIds
        : liveMeta?.programAcademicYearIds,
    includeShortlisted: true,
  });

  const profileForMeta = profile ?? (await buildMatchingProfile(studentId));
  const provenanceForMeta = profileForMeta
    ? buildMiurProvenance(profileForMeta)
    : { classeCodes: [] as string[], directions: [] as string[] };
  const compositionPreview = applyShortlistComposition(
    generated,
    provenanceForMeta.classeCodes,
    provenanceForMeta.directions ?? profileForMeta?.fieldsOfInterest ?? [],
    MATCH_LIMIT_DEFAULT
  );
  const topForMetrics = generated.slice(0, MATCH_LIMIT_DEFAULT);
  const compositionMeta = compositionPreview.meta;
  const underfillWarning =
    compositionMeta.underfill
      ? `Only ${generated.length} programmes matched (target up to ${MATCH_LIMIT_DEFAULT}; no artificial padding).`
      : null;

  report("save", "Сохранение результатов", 95);
  const preserved = await prisma.programMatch.findMany({
    where: {
      studentId,
      curatorStatus: { in: ["APPROVED", "REJECTED", "SHORTLISTED", "SELECTED"] },
    },
  });
  const preservedByPay = new Map(preserved.map((p) => [p.programAcademicYearId, p]));

  await prisma.programMatch.deleteMany({
    where: {
      studentId,
      curatorStatus: { in: ["AUTO_MATCHED", "NEEDS_REVIEW"] },
    },
  });

  for (const m of generated) {
    const existing = preservedByPay.get(m.programAcademicYearId);
    if (existing) {
      await prisma.programMatch.update({
        where: { id: existing.id },
        data: {
          eligibilityStatus: m.eligibilityStatus,
          fitScore: m.fitScore,
          scoreBreakdownJson: JSON.stringify(m.scoreBreakdown),
          requirementsSummaryJson: JSON.stringify(m.evaluations),
          reasonsJson: JSON.stringify(m.reasons),
          risksJson: JSON.stringify({ flags: m.risks, notes: m.riskNotes }),
          missingInformationJson: JSON.stringify(m.missingInformation),
          discoveryMetaJson: JSON.stringify(m.discoveryMeta),
          dataConfidence: m.dataConfidence,
          generatedAt: new Date(),
          matchingEngineVersion: MATCHING_ENGINE_VERSION,
        },
      });
      continue;
    }

    await prisma.programMatch.create({
      data: {
        studentId,
        programAcademicYearId: m.programAcademicYearId,
        eligibilityStatus: m.eligibilityStatus,
        fitScore: m.fitScore,
        scoreBreakdownJson: JSON.stringify(m.scoreBreakdown),
        requirementsSummaryJson: JSON.stringify(m.evaluations),
        reasonsJson: JSON.stringify(m.reasons),
        risksJson: JSON.stringify({ flags: m.risks, notes: m.riskNotes }),
        missingInformationJson: JSON.stringify(m.missingInformation),
        discoveryMetaJson: JSON.stringify(m.discoveryMeta),
        dataConfidence: m.dataConfidence,
        matchingEngineVersion: MATCHING_ENGINE_VERSION,
        curatorStatus:
          m.eligibilityStatus === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "AUTO_MATCHED",
      },
    });
  }

  await prisma.activity.create({
    data: {
      type: "PROGRAM_MATCH_GENERATED",
      studentId,
      metadata: JSON.stringify({
        count: generated.length,
        engine: MATCHING_ENGINE_VERSION,
        source: liveMeta?.source ?? "local-catalog",
        fingerprint: liveMeta?.fingerprint ?? null,
        pagesFetched: liveMeta?.pagesFetched ?? 0,
        candidateCount: liveMeta?.candidateCount ?? generated.length,
        enrichedCount: liveMeta?.enrichedCount ?? enrichedCount,
        reusedDossierCount: reusedCount,
        aiEnrichmentEnabled: isProgramEnrichmentEnabled(),
        aiProcessedCount: aiProcessed,
        truncated: liveMeta?.truncated ?? false,
        errors: liveMeta?.errors ?? [],
        warning: [liveMeta?.warning, underfillWarning].filter(Boolean).join(" ") || null,
        directionsSearched: liveMeta?.directionsSearched ?? [],
        directionsSelected: liveMeta?.directionsSelected ?? [],
        classeQueries: liveMeta?.classeQueries ?? [],
        coverage: liveMeta?.coverage ?? null,
        usedSynonymFallback: liveMeta?.usedSynonymFallback ?? false,
        relevantBeforeSynonym: liveMeta?.relevantBeforeSynonym ?? null,
        relevantAfterSynonym: liveMeta?.relevantAfterSynonym ?? null,
        rawCount: liveMeta?.rawCount ?? null,
        afterCityFilterCount: liveMeta?.afterCityFilterCount ?? null,
        afterSoftGateCount: liveMeta?.afterSoftGateCount ?? null,
        afterSynonymCount: liveMeta?.afterSynonymCount ?? null,
        coverageQueried: liveMeta?.coverage?.queried ?? [],
        coverageDeferred: liveMeta?.coverage?.deferred ?? [],
        durataFallbackTried: liveMeta?.durataFallbackTried ?? false,
        miurCodes: liveMeta?.miurCodes ?? [],
        gateHistogram: liveMeta?.gateHistogram ?? null,
        queryResults: liveMeta?.queryResults ?? [],
        preGateSample: liveMeta?.preGateSample ?? [],
        postGateSample: liveMeta?.postGateSample ?? [],
        exactShareTop20: shareByInclusionKind(topForMetrics, "exact_classe"),
        secondaryShareTop20: shareByInclusionKind(
          topForMetrics,
          "secondary_classe"
        ),
        underfill: compositionMeta.underfill,
        highQualityCount: compositionMeta.highQualityCount,
        excludedSecondarySynonym: compositionMeta.excludedOffDirection,
        directionBalanceApplied: compositionMeta.directionBalanceApplied,
        programAcademicYearIds: generated.map((g) => g.programAcademicYearId),
      }),
    },
  });

  report(
    "done",
    `Готово: ${generated.length} программ`,
    100,
    liveMeta?.source ? `источник: ${liveMeta.source}` : undefined
  );

  return { matches: generated, liveMeta };
}

export async function listPersistedMatches(studentId: string) {
  const rows = await prisma.programMatch.findMany({
    where: { studentId },
    include: {
      programAcademicYear: {
        include: {
          program: { include: { university: true } },
          cycles: true,
          tuition: true,
          requirements: true,
          facts: { where: { superseded: false }, take: 40 },
          enrichmentRuns: { orderBy: { startedAt: "desc" }, take: 1 },
          sourceDocuments: { orderBy: { retrievedAt: "desc" }, take: 8 },
          // change events via separate query if needed
        },
      },
    },
  });

  type Row = (typeof rows)[number];
  const rankable = rows.map((row: Row) => {
    let discoveryMeta: DiscoveryMeta | undefined;
    try {
      discoveryMeta = row.discoveryMetaJson
        ? (JSON.parse(row.discoveryMetaJson) as DiscoveryMeta)
        : undefined;
    } catch {
      discoveryMeta = undefined;
    }
    const pay = row.programAcademicYear;
    const callMissing = !pay.facts.some((f) => f.sourceType === "ADMISSION_CALL");
    return {
      row,
      sortKey: {
        eligibilityStatus: row.eligibilityStatus,
        fitScore: row.fitScore,
        discoveryMeta,
        dataConfidence: row.dataConfidence,
        hasAdmissionCall: !callMissing,
        usingPreviousYear: false,
        degreeClass: row.programAcademicYear.program.degreeClass,
      },
    };
  });

  rankable.sort((a, b) => compareProgramMatchOrder(a.sortKey, b.sortKey));
  return rankable.map((r) => r.row);
}
