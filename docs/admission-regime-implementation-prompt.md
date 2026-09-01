# Implementation prompt: unify admission-dossier extraction

Copy everything below the line into an agent session. Do not treat this file as documentation of current behavior — it is a **work order**.

---

## Agent instructions

Implement a **single AdmissionRegime** for every Italian programme in IMMIGROME OS. Do not add per-university scrapers. Do not call an LLM to parse pages. Do not change matching, eligibility, or fit-score formulas except where they **read** access/exams/seats from the dossier.

Work from the repo as it exists. Prefer a small diff. UNKNOWN is better than a false OPEN.

Bump `PARSER_VERSION` in `src/lib/program-matching/config.ts` from `call-v1.1` to `call-v1.2` so stale 30-day dossiers re-enrich.

## Why this is broken today

Curator cards lie because three independent regexes (`accessMode`, exams, seats) never form one “how you get in” object. Universitaly is a catalogue; admission rules live on the bando / programme page. In practice Universitaly `programmazione=libero` often wins, private unis are marked PUBLIC, IELTS is confused with entrance tests, and non-EU seats are a single brittle regex.

Concrete failure classes (same bugs on Bocconi, Ca’ Foscari, and any new Universitaly hit):

- Ownership: name contains `universit` → PUBLIC (LUISS, Bocconi, libera).
- Access: Universitaly `libero` → Open access. For private universities that means “not ministerial numerus clausus”, not “no selection”.
- Exams: whole-document keyword scan. Footer SAT / partner TOLC false positives. Bocconi test / ACT weak. Alternatives render as `TOLC-E или SAT · SAT`.
- Open + language only (the common state-uni case) has **no regime**: exams UNKNOWN, or CLOSED because the page mentioned TOLC.
- Seats: only `nonEuSeats`; no EU/community; tables and `posti complessivi / di cui extra-UE` fail; OPEN shows UNKNOWN instead of unlimited.
- `PROGRAM_DOSSIER_TTL_DAYS = 30` freezes bad facts. Display-time patches in `program-dossier.ts` do not rewrite stored facts.

## Current pipeline (do not replace discovery)

```text
Universitaly cerca-corsi
  → upsert (name, city, programmazione → accessMode, officialUrl)
  → rank top ~28
  → deepEnrich: officialUrl → same-domain bando links (max ~5 fetch)
  → parseCallText → ONE winner document by fieldCoverageScore
  → ProgramAcademicYear + facts
  → curator card
```

Keep Universitaly as **discovery only**. Admission authority remains the call / programme page, with Universitaly as a vetoed hint.

## Non-goals

- No LLM / vision extraction in this version.
- No Bocconi-only, Padova-only, or Foscari-only adapters.
- No full Universitaly catalog mirror.
- Do not invent seat counts. Do not copy last year’s deadlines as this year’s.
- Do not change `generateProgramMatches` ranking weights, MIUR classe mapping, or eligibility hard filters.
- Do not expand fetch budget beyond the existing ~5 documents unless a test proves a bando link is dropped; prefer better **field merge** over more HTTP.

## Target model: AdmissionRegime

Introduce a typed object (pure TS first). Persist it without a large Prisma rewrite if possible.

```ts
type Provenanced<T> = {
  value: T;
  sourceUrl: string | null;
  snippet: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  sourceType: string; // MANUAL_VERIFIED | ADMISSION_CALL | PROGRAMME_PAGE | UNIVERSITALY | ...
};

type AdmissionRegime = {
  access: Provenanced<"OPEN" | "CLOSED" | "UNKNOWN">;
  selection: Provenanced<"NONE" | "EVALUATION" | "ENTRANCE_EXAM" | "UNKNOWN">;
  admissionExams: Provenanced<Array<{ name: string; detail?: string }>>; // alternatives = one list
  languageRequirement: Provenanced<string | null>; // CEFR / IELTS / TOEFL / CILS — NOT exams
  seats: Provenanced<{
    eu: number | null;
    nonEu: number | null;
    total: number | null;
    unlimited: boolean;
  }>;
  ownership: Provenanced<"PUBLIC" | "PRIVATE" | "UNKNOWN">;
};
```

Semantics:

- `OPEN` + `NONE` = open enrolment, language certificate only.
- `OPEN` + `EVALUATION` = accesso libero + non-selective TOLC / prova di verifica.
- `CLOSED` + `ENTRANCE_EXAM` = numerus clausus or private selection (SAT / TOLC gate / Bocconi test / IMAT / prova di ammissione).
- OPEN ⇒ `seats.unlimited = true`; fill eu/nonEu/total only if the document states them.
- CLOSED ⇒ parse EU / extra-UE / community table; leave null if absent (do not guess).

### Prisma mapping (minimal)

Reuse existing columns; add JSON fact rather than a new table unless a column is clearly missing.

| Slot | Persist as |
|---|---|
| `access` | `ProgramAcademicYear.accessMode` (`OPEN` / `CLOSED` / `UNKNOWN`) + fact `ADMISSION_REGIME` or keep `ACCESS_TYPE` with `{ mode, selection, unlimitedSeats }` |
| `selection` | inside that fact JSON (do **not** overload `accessMode`) |
| `admissionExams` | `AdmissionRequirement` types `SAT` \| `TOLC` \| `ADMISSION_TEST` \| `IMAT` only. Alternatives in `valueJson.alternatives`. Never store IELTS/TOEFL as these types |
| `languageRequirement` | existing LANGUAGE requirement |
| `seats` | `AdmissionCycle.euSeats`, `nonEuSeats`, `totalSeats`. OPEN unlimited: set `notes` or fact `unlimited: true`; do not write fake totals |
| `ownership` | `University.publicPrivate` via `inferPublicPrivateFromUniversityName` (already allowlist-based) |

`AdmissionCycle` already has `euSeats`, `nonEuSeats`, `totalSeats`, `nonEuResidentAbroadSeats` — **parse EU seats**; they are unused by the HTML parser today.

If you add a column, prefer `ProgramAcademicYear.selectionMode` (`NONE` \| `EVALUATION` \| `ENTRANCE_EXAM` \| `UNKNOWN`) over stuffing selection into `accessMode`.

## Merge / veto rules (must be one function)

Implement `mergeAdmissionRegime(parts: AdmissionRegime[]): AdmissionRegime` (or field-wise merge) using `SOURCE_PRIORITY` in `src/lib/program-matching/config.ts` and `resolveProgramFact` in `src/server/services/program-matching/source-resolver.ts`.

Order:

1. Manual Confirm dossier (`MANUAL_VERIFIED`)
2. Bando / regolamento / call — **sections** Ammissione, Requisiti, Posti, Prove (not the whole PDF dump when a heading window exists)
3. Programme page
4. Universitaly `programmazione` / `modalitaAccesso` — **catalogue hint only**

Hard vetoes (apply even if Universitaly or a marketing page disagrees):

- `ownership === PRIVATE` and Universitaly/page says `libero` ⇒ do **not** emit OPEN unless a call section explicitly says student-facing open enrolment **and** `selection === NONE` with no entrance exam.
- Presence of a real **entrance** exam (SAT, TOLC used as admission gate, IMAT, Bocconi test, prova di ammissione) ⇒ not OPEN. Prefer CLOSED + ENTRANCE_EXAM. Distinguish TOLC-as-gate vs TOLC-as-optional-evaluation using section context (ammissione/selezione vs orientamento). If ambiguous, `selection = UNKNOWN` or `EVALUATION` with `access` left UNKNOWN — never false OPEN.
- IELTS / TOEFL / CILS / CEFR ⇒ language only. Never CLOSED from a language test.
- Do not set CLOSED from a bare word `test` on a marketing page.
- Stamp duty / marca da bollo (€16–17) is not tuition min (already partially handled in `sanitizeTuitionPair`).

Do **not** pick a single winner HTML by `fieldCoverageScore` and throw away the rest. `deepEnrichProgram` must **merge by field**: deadlines from the call, tuition from tasse, seats from posti/bando, language from requisiti, exams from prove/ammissione.

## Parser changes (`call-text-parse.ts`)

Bump conceptual version with `PARSER_VERSION`.

- Reuse `headingWindows` for `ammissione` / `admission` / `posti` / `seats` / `requisiti` / `requirements` / `prove` — same idea as tasse. Run `extractExams` and `extractAccess` **inside those windows first**, full text only as fallback with lower confidence.
- Split language tests vs admission tests in `extractExams` (IELTS/TOEFL already extracted; they must not enter `admissionExams` or curator «Экзамены»).
- Alternatives: one list (`SAT oppure TOLC-E`). `examsDisplayLabel` in `program-dossier.ts` must remain duplicate-free.
- Keep Bocconi test / ACT / IMAT / prova di ammissione.
- `extractAccess`: keep `numero programmato` / `accesso libero` / `open access`, but return selection + seats together, not access alone.
- Seats: parse EU and extra-UE / non-EU / community; patterns like `posti complessivi`, `di cui extra-UE`, table-ish lines. Add `euSeats` on the parse result (today only `nonEuSeats`).
- OPEN + no numeric cap ⇒ `unlimited: true`.

Export a function `inferAdmissionRegime(parsed, ctx: { universityName, universitalyProgrammazione?, universitalyModalitaAccesso? }): AdmissionRegime` so upsert + enrich + dossier share one brain. Move display-time hacks in `deriveAccessMode` (private+OPEN → UNKNOWN, exams → CLOSED) **into this function** and persist the result, so filters and cards match.

## Enrich changes (`program-deep-enrich.ts`)

- After fetching officialUrl + discovered bando/tasse/requisiti (same domain, existing caps), parse **each** document, then merge fields.
- Write `euSeats` onto `AdmissionCycle` when parsed.
- Write `ADMISSION_REGIME` (or expanded `ACCESS_TYPE`) fact with selection + unlimited + snippets.
- Filter stored exam requirements to SAT/TOLC/IMAT/ADMISSION_TEST (already partly done).
- On parser version bump: `ensureProgramDossiers` / freshness must treat dossiers parsed with old `parserVersion` as stale (check `SourceDocument.parserVersion` vs `PARSER_VERSION`, not only `dossierEnrichedAt` TTL).

## Universitaly upsert (`universitaly-upsert.ts`)

- Keep storing `programmazione` + `modalitaAccesso` as facts (MEDIUM).
- Do **not** set `accessMode = OPEN` from bare `libero` for private names (`inferPublicPrivateFromUniversityName`).
- Tighten CLOSED to `programmato` (already moved off bare `numero`); do not let Universitaly overwrite a later call parse.
- Ownership: continue allowlist in `infer-public-private.ts`; persist on upsert (already wired).

## Dossier + curator UI

Files: `src/server/services/program-matching/program-dossier.ts`, `src/server/services/program-matching/curator-match-filters.ts`, `src/components/curator-program-match-card.tsx`.

Card must show:

- Access: Open / Closed / UNKNOWN **plus** selection subtitle: «только язык» | «оценка (TOLC)» | «вступительный экзамен» (or English equivalents consistent with the card).
- Exams row: admission exams only; if OPEN+NONE, show «не требуются» rather than UNKNOWN.
- Seats: `EU n · non-EU m` or «без лимита мест» when unlimited; never imply a number from OPEN.
- Ownership: Частный / Государственный from regime.ownership.
- Keep provenance links (CISIA / College Board) without duplicating labels.

Extend `CuratorMatchView` with `selection`, `euSeats`, `seatsUnlimited` as needed. Filters: accessMode still works; do not break `hasExam`.

## Tests

Keep `npm run bando:eval` green. Add golden fixtures under `tests/fixtures/bando/`:

1. **open-language-only** — `Accesso libero` + English B2, no TOLC/SAT → OPEN + NONE, exams empty, unlimited seats.
2. **closed-posti-table** — `Numero programmato` + `posti extra-UE` and EU/community numbers → CLOSED + ENTRANCE_EXAM or EVALUATION as text implies, `euSeats` + `nonEuSeats`.
3. **sat-oppure-tolc** — alternatives one list, display without duplicated SAT.
4. **private-libero** — Bocconi-like name + Universitaly-style `accesso libero` + Bocconi test or SAT → not OPEN; PRIVATE ownership.
5. **bollo-not-tuition** — marca da bollo €16 and real max €14.840 → min not 16/17 (existing sanitizer).

Unit-test `inferAdmissionRegime` / merge vetoes in `program-ingestion/__tests__/` or `program-matching/__tests__/dossier.test.ts`.

Existing fixtures in `tests/fixtures/bando/` must still pass (`english-c1-requirement` has tuition from EUR 0 — do not treat 0 as noise).

## Cache / re-parse

- Stale if `dossierEnrichedAt` older than TTL **or** stored `parserVersion < PARSER_VERSION`.
- Do not copy `indicativeFromYear` deadlines as current-year deadlines (existing rule).

## Acceptance

- Bocconi-like card: Частный; not Open access if a selection test exists; exams not UNKNOWN when the call names Bocconi test/SAT; tuition not €17–max.
- Ca’ Foscari-like card: city from `VENEZIA` in the name if sede missing; Closed (or explicit OPEN+EVALUATION if the call says libero + TOLC verifica); exams `TOLC-E или SAT` once; seats if present on the call.
- **Any new Universitaly programme** uses the same `inferAdmissionRegime` path — no special cases by slug.
- `npx vitest run` for ingestion + dossier + bando-golden; `npm run bando:eval`.
- Matching engine version / eligibility tests still pass.

## Files to touch (expected)

- `src/server/services/program-ingestion/call-text-parse.ts`
- `src/server/services/program-ingestion/program-deep-enrich.ts`
- `src/server/services/program-ingestion/universitaly-upsert.ts`
- `src/server/services/program-ingestion/infer-public-private.ts` (only if ownership gaps remain)
- `src/server/services/program-matching/program-dossier.ts`
- `src/server/services/program-matching/program-dossier.ts` freshness in `ensureProgramDossiers`
- `src/lib/program-matching/config.ts` (`PARSER_VERSION`)
- `src/components/curator-program-match-card.tsx`
- `src/server/services/program-matching/curator-match-filters.ts`
- `prisma/schema.prisma` only if `selectionMode` (or equivalent) is required
- `tests/fixtures/bando/*` + `__tests__` listed above
- Optionally a short note in `docs/program-matching.md` under admission-call enrich (source hierarchy + regime). Do not rewrite the matching doc.

## Done when

One regime object drives access, selection, admission exams, language, seats, and ownership for every enriched programme; Universitaly cannot label a private selective course Open access; open state programmes with only a language cert show that clearly; EU and non-EU seats parse when the call states them; golden eval stays green.
