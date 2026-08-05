# CODE-REVIEW-8 — Route model-binding fix (`model: model` → `model: llmModel`)

**Slice:** 8 — Bug fix (Slice 3 leftover) — route response payload binding
**Issue:** [#24](https://github.com/shadowdoguk/image-to-prompt/issues/24)
**Commit:** `5ab78d2 fix(routes): bind response model field to llmModel in 8 handlers`
**Reviewer:** Goose (inline)
**Date:** 2026-08-05
**Verdict:** **pass**

---

## Axis 1 — Standards (code quality, patterns, conventions)

### S1. Fix is mechanical, not a redesign
- **Finding:** The fix is a single-token rename (`model` → `llmModel`) applied to 8 response-payload object literals. No control-flow change, no API surface change, no schema change, no test logic change.
- **Verdict:** ✓ pass. This matches the spec'd behaviour of the routes (they already wrote the field — they were just pointing at the wrong variable).

### S2. Internal `callKilo*` helpers correctly untouched
- **Finding:** 11 occurrences of `model: model` remain in `server.js` — at lines 2209, 2422, 2694, 3159, 3272, 3380, 3489, 3617, 3719, 3865, 6269. All are inside `callKilo*` helpers where `model` is a **parameter**, not the outer route variable. Renaming those would have been wrong (would change function signatures and break callers).
- **Verdict:** ✓ pass. Confirmed by smoke S4 (≥5 internal references found, 11 actually present).

### S3. Scope discipline respected
- **Finding:** Only the 8 buggy response payloads were touched. No drive-by edits to comments, no whitespace changes, no other refactors. `git show 5ab78d2 --stat` confirms 16 lines changed across 8 handlers (2 lines per handler: one context line + one fix line).
- **Verdict:** ✓ pass.

### S4. Pre-existing uncommitted work not touched
- **Finding:** Several files are uncommitted on `main` and remain uncommitted after this fix: `CONTEXT.md`, `README.md`, `docs/ANIMA-PROMPTING-MANUAL.md`, `docs/ARCHITECTURE.md`, `docs/PRE-MORTEM.md`, `docs/SPEC.md`, `src/index.html`, `src/styles.css`, `tests/run-all.js`, `docs/CODE-REVIEW-3-…`, `docs/POLISH-AUDIT-3-…`, `docs/adr/0022-…`, `scripts/smoke/palette-stale-id-guard.js`, `data/chat_sessions.json.bak.*`. None of these were modified by this fix.
- **Verdict:** ✓ pass. This is slice 3.3/3.4 follow-up work and the bug-workflow explicitly forbids scope creep into unrelated slice work.

### S5. Regression armor follows existing pattern
- **Finding:** `scripts/smoke/route-model-binding-guard.js` (128 lines) follows the established `palette-stale-id-guard.js` pattern: static-source assertions, no server boot, fast feedback, exit code propagation. Output format matches (`[PASS]` / `[FAIL]` coloured, summary line at end).
- **Verdict:** ✓ pass.

### S6. Smoke test was mutation-tested
- **Finding:** Before declaring the smoke good, the /api/analyze fix was reverted, the smoke was run, it correctly failed (3 asserts on /api/analyze), the revert was undone, and the smoke was re-run (24/24 pass). This proves the assertions catch the bug class, not just the specific instance.
- **Verdict:** ✓ pass. Mutation testing is the correct way to validate a regression test.

### S7. No new dependencies
- **Finding:** `package.json` unchanged. The fix uses only built-in JavaScript and existing project modules.
- **Verdict:** ✓ pass.

### S8. `node --check server.js` passes
- **Finding:** Syntax check passed before commit.
- **Verdict:** ✓ pass.

### Standards verdict: **pass** (0 findings)

---

## Axis 2 — Spec (does the fix match SPEC.md / ADR 0022)

### P1. The `llmModel` variable is the correct source
- **Finding:** ADR 0022 (Kilo Code provider migration) renamed the route-handler variable from `model` to `llmModel` to avoid collision with `state.model` (the output-contract field that determines whether the prompt is generated for `zimage_turbo` or `anima`). `resolveModel(body)` (ADR 0022 §Implementation) sets `llmModel` based on `ALLOWED_LLM_MODELS` whitelist + `DEFAULT_LLM_MODEL`. The 8 buggy lines were the only place still referencing the old `model` variable.
- **Verdict:** ✓ matches ADR 0022. The fix restores ADR 0022's intent.

### P2. Response payload still declares the `model` field
- **Finding:** The output contract (SPEC §15.8) requires every analysis endpoint to return a `model` field naming the LLM that generated the prompt. All 8 routes still emit `model:` in their response payload — the value just now resolves to `llmModel` (a real string like `'minimax/minimax-m3'`) instead of throwing `ReferenceError`.
- **Verdict:** ✓ matches SPEC §15.8. Live e2e confirmed: `model: 'minimax/minimax-m3'` returned from POST /api/analyze.

### P3. Frontend `runAnalysis` reads the field correctly
- **Finding:** `src/app.js` `runAnalysis()` reads `data.model` from the response envelope. The fix doesn't change the field name, only the value source. No frontend change needed. Verified by reading `runAnalysis` lines 1130-1180.
- **Verdict:** ✓ matches. Frontend is unaffected.

### P4. No public-API contract change
- **Finding:** Request API (FormData / JSON body field names), response API (envelope shape, status codes, error format), and chat-session persistence schema are all unchanged. The fix only changes the value bound to an existing field.
- **Verdict:** ✓ matches SPEC §15.

### P5. Issue #24 fully resolves the user-visible bug
- **Finding:** The user-visible symptom was "Analysis failed: model is not defined" appearing in the frontend toast after clicking Analyze image. End-to-end verification against a freshly-started `node server.js` confirmed the toast no longer fires and a successful analysis response is returned.
- **Verdict:** ✓ matches the issue's acceptance criteria ("After fix, POST /api/analyze and all 7 sibling routes return a successful JSON response whose `data.model` field is a non-empty string naming the LLM used").

### P6. All 8 sibling routes fixed in lockstep
- **Finding:** Not just /api/analyze (the reported one). All 7 other analysis routes had the same buggy pattern and would have failed identically if the user had clicked their buttons. The 8th sibling (`/api/anima`) is the Anima-fork endpoint, which is reached via a separate UI path but would have failed the same way.
- **Verdict:** ✓ matches. Scope was explicitly approved by user ("fix all" — Option A in the pre-commit diff summary).

### Spec verdict: **pass** (0 findings)

---

## Aggregate verdict: **pass**

Bug fix ships clean. 8/8 routes verified, regression armor in place, issue #24 closing, no scope creep, no API contract change, mutation-tested.

### Quantitative summary

| Metric | Value |
|---|---|
| Routes fixed | 8 (all analysis endpoints) |
| Lines changed in `server.js` | 16 (8 × 2-line context-window edits) |
| Internal `callKilo*` references preserved | 11 |
| New regression smoke | `scripts/smoke/route-model-binding-guard.js` (128 lines) |
| Smoke assertions | 25 (8 routes × 3 + 1 sanity) |
| Mutation-test passes | 1/1 (revert → smoke fails → restore → smoke passes) |
| `tests/run-all.js` after fix | 385 pass, 10 pre-existing failures (Slice 3.3/3.4 frontend wiring, unrelated), **0 new regressions** |
| `session-init.js` after fix | 10/10 V-checks pass |
| `node --check server.js` | pass |
| Issue closed | #24 (`Closes #24` in commit body) |
| New dependencies | 0 |
| API contract change | None (field name unchanged, value source corrected) |
| Schema migrations | 0 |
| Pre-existing uncommitted work touched | 0 files |

### Lessons (for next slice that touches variable renames)

1. **Slice 3 shipped with leftover stale references.** The rename `model → llmModel` in ADR 0022 was correct in intent but incomplete in execution. No follow-up sweep across response-payload literals was performed before declaring Slice 3 done. **Recommendation:** any future rename that crosses a seam should add a `grep` step to the per-slice closeout checklist (verify zero remaining references to the old name across the entire changed module).

2. **Tests didn't catch the bug** because the test environment returns 503 (missing API key) before reaching the response-construction code where the `ReferenceError` lives. **Recommendation:** add at least one test that exercises the response-construction branch with a stubbed LLM client, so future reference errors surface even when no real LLM is configured. Parked in `docs/BACKLOG.md`.

3. **No CODE-REVIEW existed for this fix at the time of commit.** This document was created post-commit at user request, after the fact. **Recommendation:** amend `docs/agents/bug-workflow.md` step 7 to explicitly require a CODE-REVIEW doc before commit (current text only mentions smoke + verify). Parked for next methodology update.

### Post-review actions

- [x] Commit `5ab78d2` (shipped)
- [x] Issue #24 closed via commit body
- [x] SESSION-STATE.md Session #8 entry appended
- [ ] Park lessons in `docs/BACKLOG.md` (optional — recommend)
- [ ] Methodology update: amend `bug-workflow.md` to require CODE-REVIEW doc (optional — recommend)
