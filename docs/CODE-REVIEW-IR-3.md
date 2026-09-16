# Code review — Slice IR-3 (Iterative refinement: irCompareImages module)

**Slice:** SPEC §28 / IR-3
**Reviewer:** Goose (self-review, two-axis per PRINCIPLES.md §6.5)
**Diff:** `git diff HEAD -- server.js tests/ tests/fixtures/`
**Date:** 2026-09-16
**Verdict:** **pass**

---

## Axis 1 — Standards

| Smell | Finding | Action |
|---|---|---|
| **Mysterious Name** | `callImageComparisonVision`, `parseMismatchList`, `IR_VALID_DIMENSIONS`, `IR_VALID_SEVERITIES` map 1:1 to the SPEC §28 contract. | — |
| **Duplicated Code** | The JSON-parse-fallback ladder (try-direct → code-block → balanced-bracket) duplicates the IR-2 + existing per-field-vision pattern. Extraction not worth it (3 callers max, the helper would be 12 lines). | Acceptable. |
| **Feature Envy** | None — `irCompareImages` is a pure orchestrator. | — |
| **Data Clumps** | `Mismatch` is a 5-field record that travels together; bundling it as one record is the SPEC §28 contract. | — |
| **Speculative Generality** | The IR-1 stub fallback (no API key) is preserved and clearly labelled in the response value ("IR-1 stub fallback"). Not speculative — it's an explicit demoability commitment. | Acceptable. |
| **Refactoring bonus** | `fileToImageDataUri` was extracted from `irAnalyzeImage` so the magic-byte sniff + size cap aren't duplicated when both IR-Analyze and IR-Compare need to read the same image. Good — addresses duplication risk. | — |

**Repo-standard compliance:**

- [x] Tests-first (7 IR-3 tests + 2 fixtures added before the implementation).
- [x] Pure validator (`parseMismatchList`) tested offline against fixtures.
- [x] No `callMiniMax*` prefix on the new function — preserves Slice 3.1 ADR-0022 invariant.
- [x] Latency instrumentation added per SPEC §28 A6 — `latency.analyze`, `latency.compare`, `latency.revise` carried on the assistant message audit.

**Verdict (Standards):** **pass.**

---

## Axis 2 — Spec

| SPEC §28 commitment | Implementation | Status |
|---|---|---|
| `irCompareImages(reference, generated)` returns `Mismatch[]` | Wired. Stub at IR-1 replaced with real MiniMax call. | ✅ |
| `Mismatch` schema (dimension/severity/generated_value/reference_value/suggested_fix) | `IR_MISMATCH_SCHEMA` + `parseMismatchList` enforce this exact shape. | ✅ |
| `dimension` ∈ locked set (7 entries) | `IR_VALID_DIMENSIONS` exported; validator rejects anything outside. | ✅ |
| `severity` ∈ {low, med, high} | `IR_VALID_SEVERITIES` exported; validator rejects anything outside. | ✅ |
| Empty `Mismatch[]` is a valid result (no discrepancies) | Validator accepts `[]`. `irCompareImages` returns `[]` when model emits `[]`. | ✅ |
| Real MiniMax M3 vision call (per IR-3 commitment) | `callImageComparisonVision` (named to avoid ADR-0022 conflict) sends both images + both structured analyses. | ✅ |
| 18s timeout per SPEC §28 A6 | `AbortController` + `setTimeout(18000)`. | ✅ |
| Per-step error envelope (504) | Each pipeline stage wrapped in try/catch; returns 504 on failure. | ✅ |
| Latency instrumentation per step | `latency.analyze` / `latency.compare` / `latency.revise` measured via `Date.now()` deltas, carried on `audit.latency_ms`. | ✅ |
| Tests ≥ 4 (SPEC §28 DoD) | 7 IR-3 tests added: 1 surface, 2 fixtures, 2 invalid-field rejection, 1 route happy/504, 1 prompt-grep. Plus 2 fixture JSON files. | ✅ |
| No regression in baseline | 647 baseline tests still green (654 total = 647 + 7 IR-3 net). | ✅ |

**Verdict (Spec):** **pass.**

---

## Deviations

**Function signatures changed.** `irCompareImages(reference, generated)` at IR-1 became `irCompareImages(reference, generated, imageDataUriRef, imageDataUriGen)` at IR-3 because the second vision call needs the raw images, not just the structured analyses. This is a small breaking change in the contract — captured in ARCHITECTURE §28 A2 update via this review (no separate ADR; SPEC §28 A2 already lists "single vision call that receives both structured analyses AS TEXT (already-extracted JSON) plus a fresh vision pass over both images" which requires the data URIs).

**`fileToImageDataUri` extracted** from `irAnalyzeImage` so the magic-byte sniff + size cap aren't duplicated. This is a small refactor that was forced by IR-3 (the same image is read twice: once for analyze, once for compare). Captured in this review; no ADR.

---

## Risk notes (carried forward to IR-4)

- **The two MiniMax calls are sequential.** At 15s + 15s soft
  budget, the worst case is 30s before revise starts. IR-6's
  end-to-end p95 budget is 90s; this leaves 60s for revise + I/O,
  which is comfortable. IR-6 can re-evaluate if real measurements
  come in hotter.
- **The compare call sends the same images twice.** If MiniMax
  rate-limits, both calls fail. IR-6 can add a single shared
  upload if needed.
- **Empty `Mismatch[]` is the correct success state.** No mismatches
  means the generated image already matches the reference; the user
  gets an assistant message with `suggested_prompt` equal to
  `current_prompt` (a no-op Apply). IR-4 must NOT silently drop
  this — the user wants to see the model say "no changes needed".

---

## Sign-off

- Standards axis: **pass**
- Spec axis: **pass**
- Combined verdict: **pass**
- Ready to commit.
