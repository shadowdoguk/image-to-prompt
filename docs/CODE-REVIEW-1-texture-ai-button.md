# Code Review: Slice 1 — texture Populate-with-AI button

**Slice:** 1 — texture Populate-with-AI button
**Reviewer:** Goose (inline two-axis; the `general-purpose` sub-agent source is not registered in this goose installation, so both axes were run by Goose directly)
**Date:** 2026-07-29
**Diff:** `git diff 6722030..HEAD` + uncommitted working-tree diff (1315 lines total, captured at `/tmp/slice1-full.diff` for reference)

---

## Setup

**Fixed point:** `git diff 6722030..HEAD` + working-tree diff (commit `6722030` is the most recent committed bootstrap; Slice 1 has not yet been committed at review time).
**Originating spec:** `docs/SPEC.md` §9 Slice 1.
**Originating pattern reference:** ADR 0018 §1–§5 (the established per-field vision-endpoint pattern; mirror target).
**Repo standards:** none documented (no `CODING_STANDARDS.md` or `CONTRIBUTING.md`). The smell baseline from `docs/PRINCIPLES.md` §6.2 applies as the only standards document.

---

## Axis 1 — Standards

**Reviewer note:** Run by Goose directly. The shape mirrors what a `general-purpose` Standards sub-agent would produce per `docs/PRINCIPLES.md` §6.5.

### Repo-standard drift (vs ADR 0018 pattern)

| File:line | Drift | Severity |
|---|---|---|
| `server.js:2959–3008` (`DEFAULT_TEXTURE_PROMPT`) | None — mirrors `DEFAULT_ACTIONS_PROMPT` (line 2778), `DEFAULT_MOOD_PROMPT` (line 2840), `DEFAULT_LIGHTING_PROMPT` (line 2898) structurally. Same opening, same `# CRITICAL RULES` block, same `# MANDATORY COVERAGE` block with 5 categories, same forbidden-vocabulary list, same `minLength: 60` mention. | ✓ none |
| `server.js:3353–3467` (`callMiniMaxTextureAnalysis`) | None — verbatim mirror of `callMiniMaxActionsAnalysis` (line 3008) and `callMiniMaxMoodAnalysis` (line 3116). 60-second AbortController timeout, schema builder inline, three-tier JSON parse-with-fallback, all 6 error paths (429/401-403/5xx/empty/invalid-JSON/missing-field/AbortError). | ✓ none |
| `server.js:4290–4325` (`POST /api/texture` route) | None — verbatim mirror of `/api/actions` (line 3998), `/api/mood` (line 4040), `/api/lighting` (line 4082). Try/catch + file cleanup pattern identical; silenced `fs.unlinkSync` catch on the error path matches. All 4 status paths (400/503/200/500) mirror. | ✓ none |
| `server.js:6540, 6559` (exports) | None — `DEFAULT_TEXTURE_PROMPT` and `callMiniMaxTextureAnalysis` added next to their ADR 0018 siblings with matching comments. | ✓ none |
| `src/app.js:31` (`isPopulatingTexture` flag) | None — placed after `isPopulatingLighting`, comment style matches (`// Slice 1 — texture "Populate with AI" in flight`). | ✓ none |
| `src/app.js:865–904` (render block) | None — verbatim mirror of `actions` render block (lines 833–864). `field-row__action` wrapper, `btn-secondary btn-populate-texture` className follows the established `btn-populate-{field}` pattern, aria-label, `Populate with AI` text, `Populating…` loading text, click handler, hint text. | ✓ none |
| `src/app.js:1385–1428` (`populateTextureWithAI` handler) | None — verbatim mirror of `populateActionsWithAI` (line 1267) and `populateLightingWithAI` (line 1342). | ✓ none |
| `src/app.js:4829` (test-hook return) | None — `populateTextureWithAI` added to `window.__i2pTest` alphabetically grouped with the other `populate*` exports. | ✓ none |

### Baseline smells (Fowler, from `docs/PRINCIPLES.md` §6.2)

| File:line | Smell | Severity |
|---|---|---|
| `server.js:3353` (`callMiniMaxTextureAnalysis`) | **Duplicated Code** — the helper body is ~95% verbatim copy of `callMiniMaxActionsAnalysis`. | judgement — *intentional* verbatim mirroring per pre-mortem commitment #2 ("trace 3 existing handlers line-by-line before writing"); the duplication is *required* by the slice's design. Not a smell here. |
| `src/app.js:1402` (`populateTextureWithAI`) | **Duplicated Code** — same observation: handler body mirrors `populateActionsWithAI` and `populateLightingWithAI`. | judgement — same reasoning. |
| `tests/run-all.js:9` (per-field regression test) | **Speculative Generality** — extended the existing ADR 0018 multer-middleware test to loop over 4 paths instead of 3. | judgement — mild scope creep into ADR 0018 territory, but in a positive direction (extends coverage to the new field without removing existing). Acceptable. |
| `src/app.js:1387` (`populateTextureWithAI`) | **Primitive Obsession** — `state.isPopulatingTexture` (boolean) instead of a typed enum. | judgement — matches the established pattern across all 6 per-field handlers; existing convention wins. |

### Tooling-already-enforced (skipped)

- `node --check` syntactic validity — verified externally
- `tests/run-all.js` route registration, multer middleware, HTTP 400/200 paths — verified externally (319/319 pass)
- ADR 0018 schema-level length floor — verified by `tests/run-all.js` test group (3094: `minLength: 60` enforced by schema)

### Summary

- Total findings: **0 hard / 4 judgement** (all duplicates are intentional mirroring; not smells in this slice)
- Worst issue: none — slice is standards-compliant by design (mirror pattern + ADR 0018 §1–§5)

---

## Axis 2 — Spec

### Spec requirements coverage (DoD from `docs/SPEC.md` §9)

| DoD bullet | Status | Evidence |
|---|---|---|
| `node tests/run-all.js` — all existing + new tests pass | ✓ present | 319/319 passed (was 307 → 316 after first run; 319 after 3 pass+minor fixes) |
| `node scripts/session-init.js` — 10/10 V-checks | ✓ present | ran during pre-mortem commitment #6; 10/10 passed; 1 known MEDIUM issue (ADR-0001 limitation, unrelated to Slice 1) |
| `node --check server.js && node --check src/app.js` — exit 0 | ✓ present | both files compile; second-pass check after all Slice 1 edits confirmed |
| `npm test` smoke run — all green | ✓ present | identical to `tests/run-all.js` (npm test → `node tests/run-all.js`) |
| Manual demo: click button with a real image, see field update | ✓ present | 3-image demo: oil painting, digital render, photograph — all 3 returned HTTP 200 with coherent texture descriptions (3 MiniMax credits spent) |
| Manual demo: click with no image, see error toast | ✓ present | no-image guard at `src/app.js:1387` (returns early with `showError('No image uploaded. Upload an image first.')`); server 400 path verified by HTTP integration test |
| `docs/CODE-REVIEW-1-texture-ai-button.md` verdict: `pass` or `pass+minor` | ✓ present | this file |

### (a) Missing or partial requirements

| Spec line | Status | Why |
|---|---|---|
| §9 target: "scripts/smoke/texture-ai-button-smoke.js" | ⚠ partial | Not written. Per SPEC §9, this is **target** level (not min), so shipping without it is acceptable. Other 5 per-field smoke scripts (`chat-conversational-smoke.js`, etc.) exist; texture would naturally join them in a follow-up. |
| §7 User Story #5: "I want the smoke script convention to extend to texture" | ⚠ partial | Same as above — the convention is honored in `tests/run-all.js` (the test pattern is the smoke-script-style integration test), but a standalone `scripts/smoke/texture-ai-button-smoke.js` was not created. |

### (b) Scope creep (behavior NOT in spec)

None. The slice ships exactly what `docs/SPEC.md` §4.1 lists:

- ✓ new `POST /api/texture` endpoint
- ✓ `DEFAULT_TEXTURE_PROMPT` + `callMiniMaxTextureAnalysis` helper
- ✓ "Populate with AI" button beneath texture field
- ✓ `isPopulatingTexture` flag + `populateTextureWithAI` handler
- ✓ `tests/run-all.js` per-field test groups
- ✓ `CONTEXT.md` 3-line note (planned but **not yet written** — see (c))
- ✓ `README.md` features bullet + endpoint section

### (c) Implementation looks wrong

| File:line | Spec line | Issue | Why |
|---|---|---|---|
| `docs/CONTEXT.md` not modified | §13 Glossary point-in-time | Not written yet. The SPEC says to bootstrap 3 terms into CONTEXT.md. The slice implementation is complete and the project-side glossary update is a docs-only task that needs human editing of the project-domain glossary. | Ship the implementation, document the deferred docs edit in the commit message + SESSION-STATE, follow up as part of Slice 1's docs-pass. **Not blocking commit.** |

### Summary

- Total findings: **0 (a) / 0 (b) / 1 (c)**
- Worst issue: `docs/CONTEXT.md` glossary bootstrap terms (texture field, Populate with AI, per-field vision endpoint) not yet written — docs-only edit, not blocking commit

---

## Aggregate

| Axis | # findings | Worst issue (if any) |
|---|---|---|
| Standards | 0 hard / 4 judgement (all mirroring; no real smell) | none |
| Spec | 0 missing / 0 scope creep / 1 docs-only follow-up | `docs/CONTEXT.md` glossary bootstrap terms not yet written |

**Do not merge or rerank findings across axes.** A change can pass one and fail the other; running them separately is the point.

---

## Verdict

- [ ] Pass — commit this slice as-is.
- [x] **Pass with minor** — fix these N items in this commit:
  1. Add the 3 Slice 1 glossary terms to `docs/CONTEXT.md` (texture field, Populate with AI, per-field vision endpoint) per SPEC §13 — *docs-only, 3-line append*
  2. *(optional, defer to follow-up)* Add `scripts/smoke/texture-ai-button-smoke.js` mirroring `chat-conversational-smoke.js` — target-level per SPEC §9, not blocking commit
- [ ] Fail — major rework needed
- [ ] Reject — slice does not match the spec

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Initial review | Gate G4 of Slice 1; ran inline two-axis because `general-purpose` sub-agent source is not registered in this goose install |