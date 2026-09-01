# Program Matching Quality Report

**Generated:** 2026-08-31T21:01:19.705Z
**Engine:** v1.8 · **Parser:** call-v1.12
**Target intake:** 2027/2028

## Aggregate

| Metric | Value |
|--------|-------|
| QA students | 32 |
| Programme cards | 451 |
| Critical field observations | 4059 |
| Raw unknown rate | 25.9% |
| Unexplained unknown rate | 0.0% |
| False-source rejections | 19 |
| OCR success / failure | 0 / 0 |
| Acceptable empty share (NOT_PUBLISHED / all empties) | 19.0% |

## Empty reasons

| Reason | Count |
|--------|------:|
| ONLY_PREVIOUS_YEAR_AVAILABLE | 409 |
| OFFICIAL_SOURCE_DOES_NOT_STATE_FIELD | 299 |
| NOT_PUBLISHED_FOR_TARGET_YEAR | 200 |
| SOURCE_FETCH_FAILED | 101 |
| OFFICIAL_SOURCE_NOT_FOUND | 32 |
| SCANNED_PDF_NEEDS_OCR | 11 |

## Per-field fill

| Field | Filled | Raw unknown % | Unexplained unknown % |
|-------|--------|---------------|------------------------|
| teachingLanguage | 451/451 | 0.0% | 0.0% |
| languageRequirement | 234/451 | 48.1% | 0.0% |
| access | 426/451 | 5.5% | 0.0% |
| selection | 399/451 | 11.5% | 0.0% |
| exams | 399/451 | 11.5% | 0.0% |
| tuition | 179/451 | 60.3% | 0.0% |
| deadline | 280/451 | 37.9% | 0.0% |
| seats | 277/451 | 38.6% | 0.0% |
| admissionCall | 362/451 | 19.7% | 0.0% |

## Before / after

| Metric | Previous | Current |
|--------|----------|---------|
| Unexplained unknown (total) | 0.0% | 0.0% |
| Raw unknown (total) | 27.5% | 25.9% |
| Acceptable empty share | 20.1% | 19.0% |

## Notes

- `unexplained_unknown` = empty field without classified reason and verified source.
- Honest reasons (`NOT_PUBLISHED_FOR_TARGET_YEAR`, `ONLY_PREVIOUS_YEAR_AVAILABLE`, etc.) count as explained.
- Career is excluded from critical-field metrics.
