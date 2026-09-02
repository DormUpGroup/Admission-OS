# Program Matching Engine

> **Current state:** matching **v1.9** adds an optional OpenAI second filter (official-site navigator + Luna/Terra) after Universitaly discovery. Feature flag `OPENAI_PROGRAM_ENRICHMENT_ENABLED` defaults to **false** (regex/PDF dossier remains fallback).

Italy-specific program matching for IMMIGROME OS. Matches use the **existing questionnaires** as source of truth, a local **Program Database** with fact-level provenance, deterministic **eligibility**, configurable **fit score**, and **curator verification** before student shortlist.

## Architecture

```text
Questionnaire → MatchingProfile → Universitaly (lingua × MIUR classe)
  → Soft-gate + upsert → Deterministic fit (Pass 1)
  → AI enrichment queue (≤35) OR regex/PDF dossier fallback
  → Re-score + compose (≤25, no padding) → Curator review
  → Select ≤5 for monitoring → programs:monitor-selected
```

**Hybrid rule:** no full Universitaly catalog mirror. Generate searches online with questionnaire filters, caches candidates locally for 24h (same fingerprint), then runs eligibility/fit only on those programmes (+ shortlisted).

Matching does **not** scrape the whole of Italy on each click. Caps: max **10 pages** total budget shared across classe×lingua queries (extended thin-pool retry prefers deferred primary MIUR classes). Curator receives **up to 25** matches without artificial padding. Program dossier enrich is reused across students for **30 days** (`PROGRAM_DOSSIER_TTL_DAYS`). AI facts are keyed by program + academic year + applicant category + source hashes + prompt version (not by student PII).

### OpenAI second filter (optional)

| Env | Default |
|---|---|
| `OPENAI_PROGRAM_ENRICHMENT_ENABLED` | `false` |
| `OPENAI_PROGRAM_ENRICHMENT_MODEL` | `gpt-5.6-luna` |
| `OPENAI_PROGRAM_ENRICHMENT_ESCALATION_MODEL` | `gpt-5.6-terra` |
| `OPENAI_PROGRAM_ENRICHMENT_MAX_CANDIDATES` | `35` |

Tools are limited to `inspect_programme_site` / `follow_official_link` / `read_official_section` / `read_official_pdf` (no free web search). Every saved fact requires a quote present in its `SourceDocument`. Monitor only selected programmes: `npm run programs:monitor-selected`.

## Universitaly / Cineca API

Server-side only (browser CORS blocks non-`universitaly.it` origins).

| Item | Value |
|---|---|
| Base | `https://universitaly-backend.cineca.it` |
| Search | `GET /api/offerta-formativa/cerca-corsi` |
| Classes | `GET /api/offerta-formativa/lista-classi` |
| Provinces | `GET /api/usocomune/province` |
| Client | `src/server/services/program-ingestion/universitaly-client.ts` |
| Query map | `src/server/services/program-matching/universitaly-query.ts` |

### Query mapping

| Questionnaire | API param |
|---|---|
| English / Italian | `lingua=EN` / `IT` (**primary**); **оба** → separate EN + IT queries |
| Bachelor / Master / Single-cycle | `durata=3` / `2` / per-classe map (`LM-41`/`LM-46`→`6`, `LM-42`/`LM-13`/`LMR/02`→`5`; unknown single-cycle tries `5` then optional `6`) |
| Field sphere | All selected questionnaire **direction labels** → MIUR set with **primary/secondary** roles → Universitaly `tipoClasse`; API dedupe by `classe\|lingua\|durata`; **page budget** (`UNIVERSITALY_MAX_PAGES`) is the only hard capacity limit (deferred coverage when Q > budget) |
| Soft-gate | Keep corsi with exact selected `degreeClass` or strong direction title/tag; shortlist never auto-removed |
| Synonym backup | `searchText` keywords when **post-gate** relevant count &lt; `UNIVERSITALY_SYNONYM_FALLBACK_MIN_CANDIDATES` (= `MATCH_LIMIT_MIN`, 15) |
| Pagination | Round-robin pages across unique queries; `page`, `order=ASC`, `searchType=u` |

Discovery is **sphere-first** (official degree class), not exact programme-title match. CUN `area` is legacy/compat only. Resolver: `miur-classi.ts` (`lista-classi` → code→id).

Cities: **secondary** — preferred cities only affect fit; discovery post-filter drops **avoid-list** only.

### Pitfalls

- Unofficial UI API — can change without notice; no SLA
- Exact filter values matter (`lingua=EN`, not `inglese`)
- ~10 results per page; always set hard page caps on Vercel
- Universitaly is **discovery**, not admission-requirements authority
- Official `url` may be PDF — deep enrich runs **text-layer** extract via `pdf-parse` (no OCR); scanned PDFs stay `NEEDS_REVIEW`
- Rate-limit via `rateLimitedFetch`; on API error return partial + curator warning

Probe scripts under `scripts/probe-universitaly-*.js` remain as reference.

### Admission call enrich (parser `call-v1.1`)

```text
officialUrl → fetch page
  → discover bando / tasse / requisiti links (same domain)
  → pick by field coverage (not first-OK)
  → section-aware parse (heading windows)
  → ProgramFact ADMISSION_CALL (+ TuitionInfo / AdmissionCycle)
  → curator Confirm dossier → MANUAL_VERIFIED
```

- Shared parser: `call-text-parse.ts` (`PARSER_VERSION=call-v1.1`)
- URL discovery: `bando-url-discover.ts`
- Golden fixtures: `tests/fixtures/bando/` · `npm run bando:eval` → `storage/bando-eval-latest.json`
- Miss report: `npm run bando:miss-report`
- OCR: set `BANDO_OCR=1` (optional `BANDO_OCR_STUB_TEXT` for CI); method `PDF_OCR`, quality stays review-flagged. PDF page rasterization is not bundled — stub or PNG/JPEG input for real tess.
- Synonym merge when post-gate relevant pool &lt; `UNIVERSITALY_SYNONYM_FALLBACK_MIN_CANDIDATES` (15)
- Thin-pool retry: extra pages on **primary** classe queries up to `UNIVERSITALY_MAX_PAGES_EXTENDED` (15)

### Cache

Fingerprint = hash of all direction×lingua queries + excluded cities. Same student + fingerprint within **24h** reuses local `programAcademicYearIds`.

Program dossier (tuition, deadlines, exams, career text) is shared across students via `ProgramAcademicYear.dossierEnrichedAt` + TTL.

## Source hierarchy

1. Manual verified curator facts
2. Official admission call / bando
3. Official programme page
4. University generic page
5. Universitaly (discovery/catalog only)
6. CISIA (general TOLC info; programme-specific TOLC must be from university call)
7. Regional scholarship authorities (ER.GO, EDISU, …)
8. MAECI / Study in Italy (secondary context)

Conflict resolution: `resolveProgramFact()` in `src/server/services/program-matching/source-resolver.ts`.

## Key models

- `University` / `Program` — catalogue (extended, not duplicated)
- `ProgramAcademicYear` — year-specific admission state + data confidence
- `SourceDocument` — raw snapshot + `contentHash`
- `ProgramFact` — field-level provenance
- `AdmissionRequirement` / `AdmissionCycle` / `TuitionInfo`
- `ProgramMatch` — persisted engine output + curator status
- `StudentShortlistItem` — curator-approved student-visible list
- `ScholarshipProgram` / `ScholarshipRule`

## Questionnaire → MatchingProfile

Adapter: `buildMatchingProfile()` / `buildMatchingProfileFromStudent()`.

Uses анкета №1 + №2 JSON on `Student`. Missing fields become `UNKNOWN` — never inferred.

## Eligibility ≠ Fit

- Eligibility: `ELIGIBLE` | `LIKELY_ELIGIBLE` | `NEEDS_REVIEW` | `NOT_ELIGIBLE`
- Per-requirement: `MET` | `NOT_MET` | `UNKNOWN` | `NOT_APPLICABLE`
- Fit score 0–100 with weights in `src/lib/program-matching/config.ts` (engine `v1.7`)
- Rank order: eligibility → **evidence kind** → fit → admission call → confidence
- Field score uses inclusion evidence multipliers (exact &gt; strong_tag+classe &gt; secondary &gt; synonym)
- **Hard exclusion only**: degree level, teaching-language preference, avoid-list geography
- Preferred cities are **fit-only** (secondary)
- **Prep-track gaps** (language certificate, SAT/TOLC, interview, portfolio, curricular) do not block
- Fit prioritises **teaching language first**, then field/sphere; several directions are **OR**. Primary MIUR classe → full field weight; secondary/shared without strong title/tag → ~45–55% of field weight. All selected directions are queried (page-budget may defer some). Test questionnaires intentionally mix cross-sphere pairs (e.g. Economics+CS, Biology+CS, Medicine+Chemistry).
- Per-match `discoveryMetaJson` stores directions, MIUR roles, inclusion evidence (`exact_classe` / `secondary_classe` / `strong_tag` / `synonym`), and curator `whyIncluded`. The match tab shows queried vs deferred classes and synonym fallback.
- Curator list size: **15–20** (`MATCH_LIMIT_DEFAULT=20`)
- Program dossier card fields come from shared `ProgramAcademicYear` (reuse if enriched within TTL)
- Curator can **Confirm dossier** on the match card → `MANUAL_VERIFIED` facts

Ambiguity on applicant category / stale year data → `NEEDS_REVIEW`.

Academic-year fallback: prior year may be shown as **indicative** with `USING_PREVIOUS_YEAR_DATA`. Prior deadlines are **not** copied as next-year deadlines.

## Curator UI

`/admin/students/[id]?tab=match`

- Generate Program Matches
- Filters, sources, approve / reject / needs review / shortlist
- Manual add from Program DB

Student portal shows **shortlist only**.

## Program Data

`/admin/programs/data` — catalogue quality metrics.

## CLI

```bash
npm run programs:discover
npm run programs:ingest
npm run programs:refresh
npm run programs:enrich-dossiers -- --limit=50
npm run bando:eval
npm run bando:miss-report -- --limit=50
npm run programs:match -- --email=alina.sokolova@student.local
npm run programs:match-batch2
npm run programs:audit-directions
```

Config: `TARGET_ACADEMIC_YEARS` in `src/lib/program-matching/config.ts` (no hardcoded single year in logic).

## Adding a university / adapter

1. Prefer live Generate (Universitaly) or add rows to `catalog-fixtures.ts`
2. Wire into `ingestAllCatalog()` / refresh script for offline seed
3. Prefer official call URLs; store `SourceDocument` before facts
4. Universitaly = discovery IDs + catalogue fields only — never final admission authority

## Adding a scholarship region

1. Extend `SCHOLARSHIP_FIXTURES` / `RegionalScholarshipAdapter`
2. Version rules by `academicYear`
3. Keep scholarship eligibility separate from programme eligibility

## Tests

```bash
npm test
```

## Known limitations

- Hybrid live Universitaly search (capped); fixtures remain seed/fallback for CLI ingest
- PDF OCR is **gated** (`BANDO_OCR=1`); without page rasterizer, scanned PDFs need stub or image input
- No admission probability model / custom ML
- No weekly full-catalog mirror / cron worker (CLI: `programs:refresh`, `programs:enrich-dossiers`, `bando:eval`)
- Budget / TOLC scores often `UNKNOWN` until questionnaire collects them
- Background refresh is CLI-first (no cron worker yet)
