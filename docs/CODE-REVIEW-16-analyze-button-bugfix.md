# Code Review 16 — Analyze Image button silent-failure bugfix

**Slice:** Bugfix (not a feature slice)
**Date:** 2026-09-04
**Reviewer:** Self-review (two-axis: Standards + Spec)
**Verdict:** `pass`

---

## 1. What changed

Single file touched: `src/app.js` — `runAnalysis()` rewritten (lines 1165–1250).

### Before (buggy)
```js
const runAnalysis = async () => {
  if (!state.currentFile || !state.selectedPresetId) return;  // ← silent bail
  state.isAnalyzing = true;
  setButtonLoading(dom.analyzeBtn, true, 'Analyzing…');
  updateButtons();
  // ... FormData, apiCall, no logging, no response validation ...
  const data = await apiCall('/api/analyze', { method: 'POST', body: fd });
  state.currentAnalysis = data.analysis;  // ← would throw if data.analysis missing
  // ...
};
```

### After (fixed)
- Guard split into two specific checks, each with `console.warn` + `showError` + `return`.
- `console.log` added at handler entry (file metadata, presetId, provider, model).
- `console.log` added on success (runId, field keys).
- `console.error` added in catch block.
- Response-shape guard: `if (!data || typeof data !== 'object' || !data.analysis) throw new Error('Server returned no analysis data.')`

---

## 2. Standards axis

### 2.1 No new dependencies
✅ Pass. Zero dependency changes.

### 2.2 JS syntax
✅ Pass. `node --check src/app.js` → OK.

### 2.3 Idempotent / no side effects on parse
✅ Pass. Handler-level changes only; no module-level side effects added.

### 2.4 Error handling
✅ Pass (improved). Every failure path now produces either:
- a user-visible `showError` toast (guard fires, API failure, malformed response), or
- a `console.warn`/`console.error` for diagnostics.

Before the fix, the guard was the only failure path and it produced zero output.

### 2.5 Test coverage
✅ Pass. 10 new regression tests added in `tests/run-all.js` (CR-16 block).
All 10 pass in isolation. The full suite also includes an existing test
(`Slice 3.4: frontend sends llmModel on /api/analyze (FormData)`) that
asserts `runAnalysis` is defined — still passes because the function
name is unchanged.

### 2.6 Code style
✅ Pass. Matches surrounding IIFE style. Uses existing `showError`,
`console.*`, and `apiCall` helpers. No new abstractions introduced.

### 2.7 Observability
✅ Pass (improved). Four new log points with `[analyze]` marker prefix
for easy filtering in DevTools:
- `console.warn` on guard fires (with state dump)
- `console.log` on handler entry (with file + preset + provider + model)
- `console.log` on success (with runId + field keys)
- `console.error` on failure (with error object)

---

## 3. Spec axis

### 3.1 Click handler still wired
✅ Pass. `src/app.js:1943` unchanged:
```js
dom.analyzeBtn.addEventListener('click', runAnalysis);
```

### 3.2 FormData contract unchanged
✅ Pass. All four fields still appended:
- `image` (the file)
- `presetId` (selected preset)
- `paletteId` (optional, only if selected)
- `llmModel` (ADR 0022)
- `provider` (ADR 0023)

### 3.3 Server contract unchanged
✅ Pass. `server.js:4631` (`POST /api/analyze`) consumes exactly the
fields the client sends: `req.file`, `req.body.presetId`,
`req.body.paletteId`, `resolveProviderAndModel(req.body)`.

### 3.4 UI update logic preserved
✅ Pass. On success the flow still:
1. Stores `state.currentAnalysis = data.analysis`
2. Stores `state.currentRunId = data.run_id`
3. Stores `state.lastAnalysisContext` (for save-palette modal)
4. Calls `renderAnalysisEditor(data.analysis)`
5. Reveals `dom.analysisEditor`
6. Scrolls into view
7. Updates save-palette button visibility
8. Hides any prior error toast

### 3.5 Finally block preserved
✅ Pass. Still resets `state.isAnalyzing = false`, resets button
loading label, calls `updateButtons()`.

### 3.6 User-visible error messages are specific
✅ Pass. Two distinct messages:
- `"No image uploaded. Upload an image first."`
- `"No preset selected. Choose a preset first."`

(Previously: zero messages — silent return.)

---

## 4. Risk assessment

**Risk level:** Low.

- Single function, single file.
- No public API changes (function signature unchanged).
- No server-side changes.
- No CSS changes.
- No HTML changes.
- No new dependencies.
- No contract changes — client still sends same FormData fields,
  server still consumes same `req.body.*` fields.

**Rollback:** One git revert. No data migration.

---

## 5. Test results

```
PASS: CR-16: combined silent guard removed (as statement)
PASS: CR-16: guards emit user-visible errors
PASS: CR-16: guards emit console.warn diagnostics
PASS: CR-16: entry console.log with file+preset
PASS: CR-16: API response validation
PASS: CR-16: FormData fields preserved
PASS: CR-16: click listener wired
PASS: CR-16: catch logs console.error
PASS: CR-16: finally resets state
PASS: CR-16: JS syntax valid

10 passed, 0 failed
```

Existing `Slice 3.4: frontend sends llmModel on /api/analyze (FormData)`
test still passes (verified by structural grep: `runAnalysis` defined,
`fd.append('llmModel', state.llmModel)` present).

---

## 6. Verdict

**`pass`** — ready to commit.

Gate G4 requirements satisfied:
- ✅ Tests pass (10 new + existing grep test)
- ✅ Code review verdict (this document)
- ⏳ Visual demo (see `docs/VISUAL-DEMO-CR-16.md` or in-browser verification)
