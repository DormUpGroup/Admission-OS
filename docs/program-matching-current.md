# Program Matching — Current Report

**Status date:** 31 August 2026  
**Matching engine:** v1.8  
**Admission parser:** call-v1.10  
**Target intake:** 2027/2028

## Executive summary

IMMIGROME OS is a curator-assist system. It produces a ranked pool of Italian programmes; it does not promise admission and does not show an unverified shortlist to a student.

Discovery is based on official MIUR degree classes, teaching language and degree duration. The major remaining risk is not finding programmes but keeping the curator list precise when a MIUR class is shared by several professions. The current engine reduces this with class provenance, soft relevance gates and evidence-aware field scoring.

Admission data is now represented as a single **AdmissionRegime**. It prevents contradictory cards such as “Open access” together with a SAT gate, or IELTS shown as an entrance exam.

## Current flow

1. The questionnaire builds a matching profile: study level, teaching language, selected directions, geography and known preparation data.
2. Each selected direction is mapped to one or more MIUR classes. Shared classes retain their primary/secondary direction provenance.
3. Universitaly is queried by MIUR classe × language × duration. The normal shared page budget is 10 pages; a thin-pool retry can use an extended 15-page budget.
4. Returned programmes pass a relevance check before ranking. Exact selected MIUR class is strongest evidence; broad secondary classes need a stronger title/tag signal. Manual shortlist entries are never auto-removed.
5. Eligibility excludes only structural conflicts: wrong degree level, teaching language or an explicitly excluded city. Missing exams, certificates and documents remain preparation work, not a reason to discard a programme.
6. Fit ranks the curator pool. Teaching language is strongest, then field/class evidence, then geography. Budget, tests and readiness have deliberately low impact when the student can still prepare.
7. The top candidates are enriched from the official programme page and same-domain bando/tasse/requisiti links. The fetch cap remains five documents.
8. The curator confirms, rejects or shortlists. Only the curated shortlist becomes student-facing.

## Discovery and ranking

| Area | Current behaviour |
|---|---|
| Direction catalogue | 75 questionnaire directions map to MIUR classes; the 27 Aug audit recorded 110 codes and zero unresolved codes. |
| Multiple directions | Directions are OR choices. Their class provenance is retained even when API queries are deduplicated. |
| Broad classes | Primary class matches score more strongly than secondary/shared classes. A weak cross-sphere title does not receive full field credit. |
| Language | Teaching language is both the largest fit signal and a structural filter. |
| Geography | Excluded cities are filtered out; preferred cities raise rank but do not suppress other Italian programmes. |
| Cache | Universitaly discovery is cached per profile fingerprint for 24 hours. |

The last all-direction audit showed usable English bachelor coverage for roughly 80% of directions. Expected gaps remain for several Italian-language or single-cycle niches. These are a product/UX constraint, not evidence that the student is unsuitable.

## AdmissionRegime (new in parser call-v1.2)

Every enriched programme now has one field-level, source-backed regime:

| Field | Meaning |
|---|---|
| Access | `OPEN`, `CLOSED` or `UNKNOWN` |
| Selection | `NONE`, `EVALUATION`, `ENTRANCE_EXAM` or `UNKNOWN` |
| Admission exams | Only admission gates such as SAT, TOLC, IMAT, ACT, Bocconi test or an explicit admission test |
| Language | CEFR / IELTS / TOEFL / CILS requirement, kept separately from entrance exams |
| Seats | EU, non-EU, total, or unlimited for documented open enrolment |
| Ownership | Public, private or unknown |

Facts are merged **by field**, not by choosing one “best” document. A bando can provide seats and access while a linked tasse page provides tuition and a requisiti page supplies the language requirement. Source precedence is: manual curator verification → admission call → programme page → Universitaly.

Conservative rules:

- A private university is not labelled open access merely because Universitaly says `libero`.
- A real SAT/TOLC/IMAT/Bocconi/admission-test gate yields `CLOSED + ENTRANCE_EXAM`.
- A non-selective TOLC verification can remain `OPEN + EVALUATION`.
- IELTS/TOEFL never enter the admission-exam row.
- Open access without a documented numeric cap is displayed as “no seat limit”; no fictional seat count is stored.
- Unknown remains unknown. The parser never invents quotas or carries a prior-year deadline into the current call.

`ADMISSION_REGIME` is persisted as a program fact, so the dossier, filters and curator card read the same decision. A manual access confirmation still overrides automatic display data.

## Field status and honest unknowns (call-v1.7)

Every critical admission field on a programme card now carries a **field status** with:

- confirmed value, or
- a classified reason (`NOT_PUBLISHED_FOR_TARGET_YEAR`, `ONLY_PREVIOUS_YEAR_AVAILABLE`, `OFFICIAL_SOURCE_NOT_FOUND`, `SOURCE_FETCH_FAILED`, `SCANNED_PDF_NEEDS_OCR`, `OFFICIAL_SOURCE_DOES_NOT_STATE_FIELD`, `CURATOR_CONFIRMATION_NEEDED`), plus
- source URL, academic year, parser version, extraction quality, and current/indicative freshness.

**Previous-year data:** when the target intake call is not published yet, confirmed facts from the previous academic year are still shown (tuition, deadlines, seats, access, exams). They are marked `freshness: indicative` and `reason: ONLY_PREVIOUS_YEAR_AVAILABLE` — never presented as current rules. The curator card adds an «ориентир YYYY/YYYY» suffix on those fields. If even the previous year has no value, the field stays empty with `NOT_PUBLISHED_FOR_TARGET_YEAR` or `OFFICIAL_SOURCE_DOES_NOT_STATE_FIELD`.

**Parser iterations (31 Aug 2026):** v1.8 wrong-doc/HTML/Universitaly access; v1.9 language + catalogue fold-in; v1.10 gated PDF raster OCR (`BANDO_OCR` + `BANDO_OCR_RASTER`). Unexplained **0%**. Raw unknown ~**30%** (was ~44%). Access fill ~**92%**. Remaining mass: unpublished 2027/28 calls, tuition/language not on official text, fetch/OCR ceilings.

Metrics:

- **raw_unknown_rate** — share of fields without a value.
- **unexplained_unknown_rate** — share of empty fields without a classified reason and verified source check.

QA tooling:

```bash
npm run programs:qa-seed      # 32 profiles (A–Y + gap fillers)
npm run programs:qa-match     # live Universitaly + enrich for all QA profiles
npm run programs:qa-report    # scripts/match-quality-latest.json + docs/program-matching-quality-latest.md
npm run programs:diagnose-gaps
```

Parser v1.4 improvements:

- `Modalità di accesso: Prova in ingresso per la verifica delle conoscenze` → OPEN + EVALUATION (not an entrance exam).
- Year-aware reason codes when catalogue year is 2026/27 but student intake is 2027/28.
- HTML table seat extraction; improved bando follow-link scoring (same programme path, Cineca/timeview).
- Enrichment trace persisted as `ENRICHMENT_TRACE` fact for diagnostics.

Golden fixtures: **24 / 24** evaluated (including `prova-ingresso-verifica`).

## Dossier freshness and quality

Programme dossiers normally live for 30 days. Parser version `call-v1.2` is part of freshness: a dossier built with an older parser is treated as stale and is re-enriched when selected for enrichment. This releases the earlier bad extraction cache without a destructive database reset.

The parser has golden fixtures for open-language-only, closed seat tables, SAT-or-TOLC alternatives, private selective programmes and stamp-duty-vs-tuition handling. The current golden evaluator passes all 23 fixtures.

## Curator experience

The programme card now shows:

- access and selection subtype;
- admission exams only, or “not required” for `OPEN + NONE`;
- EU/non-EU seats or “no seat limit”;
- public/private ownership;
- language requirement, tuition, deadline, source links and call freshness.

This is a review tool: a curator remains responsible for confirming uncertain or newly published calls.

## Current limitations and next operational work

1. Parser accuracy is limited by the quality and availability of official pages/PDF text. Scanned PDFs require the existing OCR fallback and may still need review.
2. Live Universitaly discovery is intentionally capped; when many directions are selected, coverage metadata must be watched so deferred queries are visible rather than silently lost.
3. Tuition, seat and exam fill should be monitored on `/admin/programs/data` after each parser change. The next high-value dataset is a broader golden set of real bando documents with labelled access, seats, tuition and exams.
4. The current system does not calculate probability of admission, use ML, mirror the full Italian catalogue or scrape university-specific adapters. These remain intentionally out of scope.

## QA checkpoint — 31 August 2026

**32 QA profiles** (A–Y + 7 gap fillers: single-cycle med/dent/pharm, budget known/unknown, 5-direction mega-mix, both-language humanities). Live Universitaly discovery + dossier enrichment on **440 programme cards**.

| Metric | Value |
|--------|-------|
| Raw unknown rate | 44.5% |
| **Unexplained unknown rate** | **0.0%** |
| False-source rejections | 6 |
| OCR success / failure | 0 / 0 |

Per-field fill (440 cards): teaching language 100%; admission call/source 66%; access 62%; deadline 54%; exams 50%; tuition 33%; seats 28%; language requirement 51%.

All empty critical fields carry a classified reason (`NOT_PUBLISHED_FOR_TARGET_YEAR`, `ONLY_PREVIOUS_YEAR_AVAILABLE`, `OFFICIAL_SOURCE_DOES_NOT_STATE_FIELD`, etc.) with source metadata. Raw unknown remains high where official 2027/28 calls are not yet published — this is honest, not unexplained.

Full report: [`docs/program-matching-quality-latest.md`](program-matching-quality-latest.md) · JSON: [`scripts/match-quality-latest.json`](../scripts/match-quality-latest.json)

## QA checkpoint — 28 August 2026 (batch4 baseline)

Ten deliberately different questionnaire profiles were created as QA-only students and run through live Universitaly discovery and dossier enrichment: Architecture; Economics + Finance; Computer Engineering + IT Security; International Relations; Psychology + Cognitive Sciences; Mathematics; Biology + Industrial Biotechnology; Civil Engineering (master); Italian Philology + Linguistics; Economics + Computer Science.

The rerun produced 108 programme cards. Top-five direction precision was **87/100** overall (single direction 72/100; mixed directions 93/100). The lower single-direction result is due to genuinely small English pools in Architecture and Mathematics, not broad cross-field pollution. The selection logic did not return unrelated professions in the top five of the tested profiles.

Current card-field fill in that sample: language 100%; official call/source 68%; access 55%; deadline 55%; admission exam or confirmed no-exam 52%; annual tuition 36%; non-EU quota or confirmed unlimited places 27%; career text 2%.

The low quota, tuition and career figures are primarily a publication limitation: all 108 discovered records are for 2026/2027 while the test intake is 2027/2028. A previous-year call is now shown as an **indicative reference**, not as current rules for the student. Career is hidden from the first matching card when no verified text exists; it is not an admission decision field.

Parser v1.3 also rejects clearly unrelated notices that happen to use the word *bando* (transport discounts, scholarships, accommodation, welfare benefits). Such a notice is no longer used as an admission call, and facts derived from it are superseded on the next enrichment. This can make a previously populated field become honestly unknown; that is a data-quality correction, not a loss of verified information.

## Verification recorded for this version

- Full automated test suite: **155 tests passed**.
- Admission-regime, parser and dossier focused suite: **58 tests passed**.
- Golden bando evaluator: **23 / 23 fixtures passed**.
- TypeScript type check passed.

## Key implementation files

- `src/server/services/program-matching/program-matching.ts`
- `src/server/services/program-matching/fit-score.ts`
- `src/server/services/program-matching/program-dossier.ts`
- `src/server/services/program-ingestion/call-text-parse.ts`
- `src/server/services/program-ingestion/admission-regime.ts`
- `src/server/services/program-ingestion/program-deep-enrich.ts`
- `scripts/seed-match-test-batch4.ts`
- `scripts/run-match-batch4.ts`
- `scripts/diagnose-match-batch4.ts`
