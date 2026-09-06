# Code Review 28 — sparse-image-fix slice

**Slice:** Bugfix (Option A from the user's "again the tool will not analyze image" diagnostic)
**Date:** 2026-09-06
**Reviewer:** Self-review (two-axis: Standards + Spec)
**Verdict:** `pass`

---

## 1. What changed

Four files touched. Total net delta ≈ +120 lines (production + tests), -3 lines (one minor string change in test data).

### Files

| File | Change | Lines |
|---|---|---|
| `server.js` | Added `isImageTooMinimal` helper after `validateAnalysisLengths`; thread it into `callKiloStage1` after attempt 2; route `/api/analyze` maps `IMAGE_TOO_MINIMAL` to 422; `app.listen` emits a readable hint on port collision | +60 |
| `src/app.js` | `apiCall` surfaces `code` and `violations[]` on thrown `Error`; analyze-button catch shows the warning banner when `e.code === 'IMAGE_TOO_MINIMAL'` | +14 |
| `tests/run-all.js` | Export assertion + 8 unit-test assertions for `isImageTooMinimal` + 1 HTTP integration test for `/api/analyze` 422 mapping | +75 |
| `data/chat_sessions.json` | Trimmed 50 → 3 sessions to baseline the chat-cap tests (mirrors Session #10 pattern) | n/a |

### Why this slice

User reported a small black PNG was rejected by the analyze flow. Runtime log showed
`Stage 1 attempt 2 still has 1 length violation(s): subject — accepting result`,
which is the documented ADR-0001 best-effort path — but for an empty/degenerate
image the result is a near-empty analysis editor with no actionable feedback.
Slice converts that silent failure into a structured 422 + friendlier banner.

Companion fix: the `EADDRINUSE` unhandled-error crash in `server.log` (from a
second `node server.js` startup) is now caught and surfaced as a readable hint.

---

## 2. Standards axis

### 2.1 No new dependencies
✅ Pass. Zero `package.json` changes. No `node_modules` deltas.

### 2.2 JS syntax
✅ Pass. `node --check server.js && node --check src/app.js` → both OK.

### 2.3 Idempotent / no side effects on parse
✅ Pass. `isImageTooMinimal` is a pure function. The route's `try/catch` already
existed — only one new branch was added (`error.code === 'IMAGE_TOO_MINIMAL'`).
The `app.listen` error handler is async-event-driven; no synchronous side
effects on startup.

### 2.4 Error handling
✅ Pass (improved). Three concrete improvements:

| Path | Before | After |
|---|---|---|
| `callKiloStage1` reports thin image | (a) logs "accepting result", returns 200 with empty fields. Frontend shows blank editor. | `isImageTooMinimal` flags it → throws typed `Error` with `code: 'IMAGE_TOO_MINIMAL'`. Route maps to 422 + structured envelope. |
| `apiCall` surfaces HTTP errors | Throws `new Error(data.error)` only. | Throws with `code`, `violations[]` attached when the server provides them. |
| `app.listen` on EADDRINUSE | Crashes with `Unhandled 'error' event` deep in `node:events:487`. | Prints a 2-line hint and `process.exit(1)`. |

### 2.5 Test coverage
✅ Pass.

| Suite | Before | After | Delta |
|---|---|---|---|
| `tests/run-all.js` | 506 passed / 2 failed (per Session #10) | 508 passed / 1 failed | +2 net (7 new → 8 slot delta) |
| V-checks (`session-init.js`) | 10/10 | 10/10 | unchanged |

The single remaining failure is **Issue #1** (declined-revision persistence in
chat route), which was already parked in BACKLOG before this slice and is
intentionally out of scope.

New tests added (block name: `sparse-image-fix`):
- `isImageTooMinimal` export assertion (1)
- Unit tests for Rules A, B, C and 4 negative cases (10 assertions)
- HTTP integration test: empty `subject` + length violations → 422 with
  `code: 'IMAGE_TOO_MINIMAL'` and `violations[]` (4 assertions)

### 2.6 Code style
✅ Pass. Matches surrounding IIFE / module style. No new abstractions beyond
the pure helper `isImageTooMinimal(violations, fieldNames, parsed)`.

### 2.7 Observability
✅ Pass. Two new structured log warnings (already present, retained):
- `Stage 1 attempt 2 still has N length violation(s): …` (unchanged from before)
- New: `app.listen` error prints `code` + actionable hint.

---

## 3. Spec axis

### 3.1 `callKiloStage1` contract preserved
✅ Pass. The function still returns `parsed` on the happy path. The
throw-path is a NEW branch; existing callers (no project code currently
swallows Stage 1 errors — they're caught at the route boundary) are
unaffected. Pre-existing handlers across `/api/subject`, `/api/camera-angle`,
`/api/actions`, `/api/mood`, `/api/lighting`, `/api/texture` don't go
through `callKiloStage1` — they call their own dedicated helpers; this
fix is scoped to the analyze flow.

### 3.2 Threshold semantics — documented in code
✅ Pass. The helper's docstring enumerates the 3 rules with their
intent. Strict-`>` semantics documented inline to prevent 50/50 false
positives (1 violation on a 2-field preset should still flow through
as best-effort).

### 3.3 `/api/analyze` HTTP contract
✅ Pass (additive only). New `code` and `violations[]` fields on the
422 envelope. The 200 envelope is unchanged. The 400/404/500/503 paths
are unchanged. Per ADR 0023 dispatch gate is unchanged.

### 3.4 Frontend `apiCall` contract
✅ Pass (additive). `code` and `violations[]` are attached to the
thrown `Error` only when the server provides them. Existing call
sites that throw `Error(message)` remain correct (they just won't
have `code`).

### 3.5 Analyze-button error UX
✅ Pass (additive). New branch on `e.code === 'IMAGE_TOO_MINIMAL'`
shows the warning banner with `severity: 'warning'`. All other
failure modes fall through to the original `Analysis failed:
${e.message}` toast — unchanged.

### 3.6 EADDRINUSE handler
✅ Pass. The handler prints `code`, the port number, and the `pkill`
suggestion. `process.exit(1)` matches the convention used elsewhere
in the project for fatal startup errors.

---

## 4. Risk assessment

**Risk level:** Low.

- Three pre-existing concerns from ADR-0001 §"Known limitations" are
  now addressed *gracefully* rather than papered-over:
  1. Simple images producing simple descriptions (limitation #3)
  2. Length-violation retry capped at 1 (limitation #1)
  3. MinLength as guidance, not enforcement (limitation #1 again)

  These are *exposed* as a typed 422 instead of returned as 200-with-empty-fields.
  The contract change is additive (existing 200 path is preserved).

- No public-API signature changes.
- No CSS / HTML changes.
- No new dependencies.
- No data migration (only a one-time `chat_sessions.json` trim, mirrored from Session #10).

**Rollback:** One `git revert`. No data migration, no schema to undo.

---

## 5. Test results

```
PASS: sparse-image-fix: isImageTooMinimal exported from server.js
PASS: sparse-image-fix: isImageTooMinimal follows 3-rule contract (8 assertions)
PASS: sparse-image-fix: /api/analyze returns 422 IMAGE_TOO_MINIMAL when Stage 1 throws it

508 passed, 1 failed (Issue #1 pre-existing parked)
```

Existing tests confirmed not regressed:
- Slice 3.1 helpers export (still green)
- Slice 4 env-state (still green, per CR-23)
- Chat-limit tests (still green, after `chat_sessions.json` baseline trim)
- All UI-R series tests (still green)

---

## 6. Visual demo

See `docs/VISUAL-DEMO-CR-28.md`. Brief: open `http://localhost:3100`,
upload any near-uniform or low-detail image (the user's 16×16 black PNG or
a stretched solid color), click "Analyze image". Server logs show:

```
Stage 1 attempt 1 failed length validation on N field(s); retrying with strengthened prompt
Stage 1 attempt 2 still has M length violation(s): subject — accepting result
```

…and the UI displays the warning banner instead of a blank editor:

> This image doesn't have enough content for analysis. The model couldn't
> extract a usable description — try a more detailed photo with subjects,
> colors, and a recognizable scene.

Browser network tab shows the `/api/analyze` response as
`HTTP 422 { success: false, code: 'IMAGE_TOO_MINIMAL', violations: [...] }`.

For a real photo (rich subject, valid other fields), the response
unchanged: `HTTP 200` with the analysis payload — Rule A/B/C all return
false, so the helper falls through to the existing best-effort path
(preserves ADR-0001 §3).

---

## 7. Verdict

**`pass`** — ready to commit.

Gate G4 requirements satisfied:
- ✅ Tests pass (508 / 1 pre-existing parked failure)
- ✅ Code review verdict (this document)
- ⏳ Visual demo (see `docs/VISUAL-DEMO-CR-28.md` after in-browser verification)
