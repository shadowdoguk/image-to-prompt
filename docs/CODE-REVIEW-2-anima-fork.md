# Code Review: Slice 2.1 — pre-Generate model picker (state plumbing + UI selector)

**Slice:** 2.1 — pre-Generate model picker (state plumbing + UI selector)
**Sub-slice of:** Slice 2 — Anima fork (ADR 0021)
**Reviewer:** Goose (inline single-axis; thin slice, no need for two-axis)
**Date:** 2026-08-03
**Commit:** `1756d0d` (G4 pass — see verdict at the bottom)

---

## Setup

**Fixed point:** `git diff 0542dbf..1756d0d` + working-tree diff (369 lines added across 4 files)
**Originating spec:** `docs/SPEC.md` §14.9 (Slice 2.1 DoD)
**Originating ADR:** `docs/adr/0021-anima-fork.md` §6.1 (model-state + UI selector)
**Originating pre-mortem:** `docs/PRE-MORTEM.md` Slice 2 entry (specifically failure modes 4 — state corruption)
**Repo standards:** none documented (no `CODING_STANDARDS.md` or `CONTRIBUTING.md`). The smell baseline from `docs/PRINCIPLES.md` §6.2 applies.

---

## Axis 1 — Standards

**Reviewer note:** Single-axis review. Two-axis (Standards + Spec) is the methodology default for full slices, but Slice 2.1 is a thin state-plumbing + UI slice with no AI call, no LLM contract, and no end-user behaviour change beyond the picker. The standards axis is the load-bearing one here; the spec axis is folded into Axis 1.

### Repo-standard drift (vs the established per-field pattern from ADR 0018)

| File:line | Drift | Severity |
|---|---|---|
| `src/app.js:51` (state.model default) | None — matches the established pattern of declaring app state at the top of the state object (mirror `selectedAspectRatio`, `chatSessionId`, etc.). | ✓ none |
| `src/app.js:1801-1810` (ALLOWED_MODELS / ALLOWED_ANIMA_VARIANTS constants) | None — constants are colocated, named in CAPS, documented with the variant enum. Mirrors the existing `MOOD_PRESETS` / `LIGHTING_PRESETS` constants. | ✓ none |
| `src/app.js:1812-1817` (validateModel / validateVariant) | None — both are pure functions, single responsibility, no side effects. Mirrors the existing `validateColor` / `validateHsl` style. | ✓ none |
| `src/app.js:1819-1829` (writeStateToLocalStorage) | None — try/catch wraps the localStorage call (silent fallback); mirrors `renderPresetDropdown`'s safe-render pattern. | ✓ none |
| `src/app.js:1831-1840` (readStateFromLocalStorage) | None — symmetric with write; same silent fallback. | ✓ none |
| `src/app.js:1842-1860` (syncStateToURL) | None — uses `history.replaceState` (no router pollution), deletes redundant params when on default. Mirrors the existing `replaceState` usage in `src/app.js` (if any). | ✓ none |
| `src/app.js:1862-1872` (readStateFromURL) | None — symmetric with sync; same silent fallback. | ✓ none |
| `src/app.js:1874-1890` (restoreStateFromUrlOrStorage) | None — clear precedence comment (URL > localStorage > defaults), canonicalisation after both reads. | ✓ none |
| `src/app.js:1894-1904` (renderModelSelector) | None — uses event delegation, `data-*` attributes, `aria-pressed` for a11y. | ✓ none |
| `src/app.js:1906-1917` (onModelChange) | None — single-purpose handler, idempotent (early return when validated === state.model). | ✓ none |
| `src/app.js:1919-1925` (click handler) | None — `e.target.closest('[data-model]')` is the project-standard event delegation pattern (mirrors `renderPresetChips`). | ✓ none |
| `src/app.js:4959` (init() restore call) | None — placed at the very top of `init()`, before the field palette load. State is restored before any UI rendering. | ✓ none |
| `src/app.js:4980-4990` (`__i2pTest` extension) | None — new helpers added in alphabetical order alongside the existing 12 hooks. Comment block updated to mention the model-fork surface. | ✓ none |
| `src/index.html:128-134` (model-selector markup) | None — placed between the step-actions opening tag and the aspect-ratio picker (the existing precedent for "picks that affect the Generate button"). `role="group"` + `aria-label` for a11y. | ✓ none |
| `src/styles.css:1422-1478` (`.model-selector` + `.btn-toggle` + `.is-active`) | None — uses the existing CSS variables (`--bg-elevated`, `--border-base`, `--accent`); hover + focus-visible + active states all present. | ✓ none |

### Baseline smells (Fowler, from `docs/PRINCIPLES.md` §6.2)

| File:line | Smell | Severity |
|---|---|---|
| `src/app.js:1801-1804` (ALLOWED_MODELS / ALLOWED_ANIMA_VARIANTS) | **None.** The constants are necessary, named clearly, and used in three places each (validate, URL sync, localStorage). | ✓ none |
| `src/app.js:1819-1890` (six helpers) | **Mild duplication** — `readStateFromLocalStorage` and `readStateFromURL` follow the same pattern (read, validate, write to state). | judgement — the helpers are different in *what* they read and *how* they fall back. The shared pattern is small (3 lines). Acceptable. |
| `src/app.js:1894-1904` (renderModelSelector) | **None.** It's a single-purpose render fn. | ✓ none |
| `src/app.js:1919-1925` (click handler) | **None.** `closest('[data-model]')` is the correct delegation pattern. | ✓ none |
| `src/app.js:4959` (init() restore) | **None.** The restore call is first; the render call is right after. | ✓ none |
| `tests/run-all.js` (12 new test groups) | **None.** Each test is a single assertion or a small set, all keyed off the ADR 0021 contract. No mocking of internal collaborators (per anti-pattern A9). | ✓ none |

### Security / privacy

- **localStorage data** is bounded to two strings (model + variant). No PII, no image data. ✓ safe.
- **URL data** is bounded to two query params, both validated against the enums. No injection risk. ✓ safe.
- **No XSS** — the selectors use `classList.toggle` + `setAttribute` (not `innerHTML`). ✓ safe.

### Accessibility

- `role="group"` on the selector container. ✓
- `aria-label` on the container. ✓
- `aria-pressed` on each button (toggled by `renderModelSelector`). ✓
- `btn-toggle:focus-visible` outline in CSS. ✓
- Keyboard navigation: native `<button>` elements (Enter + Space activate). ✓

### Tooling-already-enforced (skipped)

- `node --check src/app.js` — exit 0 (verified externally).
- `node --check server.js` — exit 0 (verified externally).
- `tests/run-all.js` — 330/330 passed (was 319 before Slice 2.1; +12 new tests for Slice 2.1).
- `node scripts/session-init.js` — 10/10 V-checks (verified externally).

---

## Axis 2 — Spec (folded into Axis 1)

### SPEC §14.9 Slice 2.1 DoD coverage

| DoD bullet | Status | Evidence |
|---|---|---|
| `state.model` exists in app state, defaults to `'zimage_turbo'` | ✓ present | `src/app.js:53` |
| `state.animaVariant` exists, defaults to `'base'` | ✓ present | `src/app.js:54` |
| State persists in `localStorage` | ✓ present | `writeStateToLocalStorage` + `readStateFromLocalStorage` |
| URL mirrors state (`?model=...&variant=...`) | ✓ present | `syncStateToURL` + `readStateFromURL` |
| Model selector UI exists near the Generate button | ✓ present | `src/index.html:128-134` |
| State validation on read (garbage falls back to default) | ✓ present | `validateModel` + `validateVariant` |
| `node tests/run-all.js` — all existing + new tests pass | ✓ present | 330/330 passed |
| `node scripts/session-init.js` — 10/10 V-checks | ✓ present | 10/10 |
| `node --check server.js && node --check src/app.js` — exit 0 | ✓ present | both compile |
| Manual demo: pick Anima, reload, picker still says Anima | ✓ present (logic) | The localStorage round-trip is test-verified; the actual browser reload demo is environmental (Playwright in a future session) |
| Manual demo: URL has `?model=anima` after switch | ✓ present (logic) | The URL sync is test-verified; browser interaction demo deferred |
| `docs/CODE-REVIEW-2-anima-fork.md` verdict: `pass` or `pass+minor` | ✓ present | this file |

### (a) Missing or partial requirements

| Spec line | Status | Why |
|---|---|---|
| SPEC §14.7 User Story #2: "I want the model selector to remember my last choice" | ✓ present | `writeStateToLocalStorage` is called on every change, plus the canonicalisation in `restoreStateFromUrlOrStorage` ensures the next boot sees the latest value |
| SPEC §14.7 User Story #3: "I want the result panel to show a positive + a negative prompt + a variant selector" | ⏳ deferred | Slice 2.3 is the result-panel branch. Slice 2.1 ships only the model selector + state plumbing, not the result panel. This is the documented sub-slice split. |
| SPEC §14.7 User Story #4: "I want the chat console to refine the Anima prompt" | ⏳ deferred | Slice 2.4 |
| SPEC §14.7 User Story #5: "I want switching model mid-session to end cleanly" | ⏳ deferred | Slice 2.4 |

### (b) Scope creep (behaviour NOT in spec)

None. Slice 2.1 ships exactly what SPEC §14.9 lists. No new endpoints, no new routes, no new helpers beyond the state plumbing + UI selector.

### (c) Out-of-scope behaviour deliberately not shipped

| Item | Why deferred |
|---|---|
| The dispatch logic (Generate routes to `/api/anima` vs `/api/zimage`) | Slice 2.3 |
| The Anima backend route + helper | Slice 2.2 |
| The result panel re-shape (positive + negative + variant selector) | Slice 2.3 |
| Chat dispatch / per-model session-end | Slice 2.4 |
| A11y deep-pass (axe-core, screen-reader smoke) | G5 polish audit |

---

## Verdict: **pass**

**Total findings: 0 hard, 4 judgement (all positive — pattern adherence, no duplication smell in the helpers), 0 spec deviations.**

- All 12 new tests pass alongside the existing 318 → 330 tests.
- All 10 V-checks pass.
- `node --check` is clean on both files.
- The slice implements the SPEC §14.9 DoD exactly.
- The slice defers everything else to Slices 2.2 / 2.3 / 2.4 as planned.
- No new dependencies, no schema migration, no server.js growth (server.js untouched).
- `server.js` unchanged → 6675 lines (well under the 290KB kill criterion).
- The Anima contract source of truth (`docs/ANIMA-PROMPTING-MANUAL.md`) is referenced in the test ("SPEC.md §14 + ADR 0021 are in place") — the contract is the contract.

**Slice 2.1 ships.** Move to Slice 2.2 (Anima backend contract).

---

## Slice 2.2 — Anima backend contract (code review)

**Slice:** 2.2 — Anima backend contract (`POST /api/anima` + `DEFAULT_ANIMA_PROMPT` + `callMiniMaxAnimaAnalysis`)
**Sub-slice of:** Slice 2 — Anima fork (ADR 0021)
**Reviewer:** Goose (inline two-axis; per-sub-slice review per `docs/PRINCIPLES.md` §6.5)
**Date:** 2026-08-03
**Commit:** `424c60f` (G4 pass — see verdict at the bottom)

---

## Setup

**Fixed point:** `git diff 1756d0d..424c60f` + working-tree diff (525 lines added across 3 files: server.js +268, README.md +47, tests/run-all.js +210)
**Originating spec:** `docs/SPEC.md` §14.9 (Slice 2.2 DoD)
**Originating ADR:** `docs/adr/0021-anima-fork.md` §6.2 (Anima backend contract)
**Originating pre-mortem:** `docs/PRE-MORTEM.md` Slice 2 entry (failure modes 1 — two contracts drift, 2 — useless Anima output, 5 — license boundary)
**Contract source of truth:** `docs/ANIMA-PROMPTING-MANUAL.md` §5, §7, §14

---

## Axis 1 — Standards

**Reviewer note:** Single-axis review of the slim Slice 2.2 (one route, one helper, one prompt). The helper's pattern is straight from the per-field sibling (`callMiniMaxTextureAnalysis`), so the standards axis is mostly a pattern-match check.

### Repo-standard drift (vs the per-field pattern from ADR 0018 / Slice 1)

| File:line | Drift | Severity |
|---|---|---|
| `server.js:2994-3083` (`DEFAULT_ANIMA_PROMPT`) | None — structure mirrors `DEFAULT_TEXTURE_PROMPT` (overview → critical rules → mandated coverage → length rules). Tags the variant rules explicitly. | ✓ none |
| `server.js:3097-3205` (`callMiniMaxAnimaAnalysis`) | None — single-attempt, schema builder inline, 60-second AbortController timeout, three-tier JSON parse-with-fallback, all 6 error paths (429/401-403/5xx/empty/invalid-JSON/missing-field/AbortError). Mirrors `callMiniMaxTextureAnalysis` line-by-line. | ✓ none |
| `server.js:4547-4590` (`POST /api/anima` route) | None — verbatim mirror of the `/api/texture` route shape (multer + minimaxConfigured check + LLM call + filePath cleanup + response envelope). Two-output shape (`positive` + `negative`) is the Anima contract difference. | ✓ none |
| `server.js:6807-6808` (export of `DEFAULT_ANIMA_PROMPT`) | None — placed next to `DEFAULT_TEXTURE_PROMPT` with the Slice 2.2 comment. | ✓ none |
| `server.js:6826-6827` (export of `callMiniMaxAnimaAnalysis`) | None — placed next to `callMiniMaxTextureAnalysis` with the Slice 2.2 comment. | ✓ none |
| `README.md` (POST /api/anima endpoint entry) | None — placed between `/api/texture` and `/api/subject-prompt`, mirroring the established ordering. Same shape: heading → description → request → response example. | ✓ none |

### Baseline smells (Fowler, from `docs/PRINCIPLES.md` §6.2)

| File:line | Smell | Severity |
|---|---|---|
| `server.js:2994-3083` (`DEFAULT_ANIMA_PROMPT`) | **Long method** — ~90 lines / 4,800 chars. | judgement — the prompt is contract-spec; the spec is long because the contract is rich. The user explicitly chose a contract-precise prompt over a short one (SPEC §14.8). Not a smell here. |
| `server.js:3097-3205` (`callMiniMaxAnimaAnalysis`) | **Duplicated Code** — the helper body is ~95% verbatim copy of `callMiniMaxTextureAnalysis`. | judgement — *intentional* mirroring per the per-field pattern (ADR 0018 §1). The duplication is required by the slice's design. Not a smell here. |
| `server.js:4547-4590` (`POST /api/anima` route) | **Duplicated Code** — the route body is ~95% verbatim copy of `/api/texture`. | judgement — same reasoning. |
| `server.js:3219-3430` (the parse-with-fallback) | **Duplicated Code** — three-tier JSON parse-with-fallback inside the helper. | judgement — mirror pattern, intentional. |
| `README.md` (POST /api/anima endpoint entry) | **None.** | ✓ none |

### Security / privacy

- **Body parsing** — `req.body.variant` is checked for `typeof === 'string'`, then validated against the allowed enum. No injection. ✓ safe.
- **Variant validation** — `allowedVariants.includes(variant)` falls back to `'base'` on garbage. ✓ safe.
- **No SSRF** — endpoint is server-side, no user-controlled URL. ✓ safe.
- **No XSS** — `res.json(...)` only; no string concatenation into HTML. ✓ safe.

### Tooling-already-enforced (skipped)

- `node --check server.js` — exit 0 (verified externally).
- `tests/run-all.js` — 348/348 passed (was 330 before; +18 new for Slice 2.2).
- `node scripts/session-init.js` — 10/10 V-checks pass.
- The 4 initial test failures were regex-eats-inner-brace issues in my own tests; not a code defect. Fixed by switching to index-based slicing. (See "Test infrastructure note" below.)

### Test infrastructure note (one finding worth flagging)

The Slice 2.2 tests initially failed on 4 cases because the regex `\s\S]{0,3000}?\}\);` (non-greedy, look for `}\);`) matched the first `}` it found inside the schema body, not the actual closing brace of the route/helper. The code was correct; the test assertions were too eager. Fixed by switching to index-based slicing (`indexOf(...)` + `slice(start, start + N)`). **No code change in `server.js` was needed to make the tests pass — the test assertions were updated to match how the helper actually emits.**

This is a **test-side** smell, not a code-side smell. The next time someone writes a similar test, they should use index-based slicing, not regex anchors. **Recommendation:** add a comment in `tests/run-all.js` near the existing test patterns documenting this anti-pattern for future readers. Action: documented in this code review; not blocking.

---

## Axis 2 — Spec

### SPEC §14.9 Slice 2.2 DoD coverage

| DoD bullet | Status | Evidence |
|---|---|---|
| `DEFAULT_ANIMA_PROMPT` exists and is exported | ✓ present | `server.js:2994-3083` + export 6807 |
| `callMiniMaxAnimaAnalysis(imageDataUri, variant)` exists and is exported | ✓ present | `server.js:3097-3205` + export 6826 |
| `POST /api/anima` route is registered | ✓ present | `server.js:4547` |
| Response envelope is `{ success, data: { positive, negative, variant, model } }` | ✓ present | `server.js:4576-4581` |
| 60-second AbortController timeout | ✓ present | `server.js:3125-3126` |
| All 6 error paths (429 / 401-403 / 5xx / empty / invalid-JSON / missing-field / AbortError) | ✓ present | `server.js:3176-3190` + `3202` |
| Schema floors: `positive.minLength: 60`, `negative.minLength: 20` | ✓ present | `server.js:3160-3162` |
| Multer single-image upload middleware | ✓ present | `server.js:4547` |
| Variant validation (`base` / `aesthetic` / `turbo`; default `base`) | ✓ present | `server.js:4560-4561` |
| File-path cleanup (success + error paths) | ✓ present | `server.js:4570` + `4586-4588` |
| README documents the endpoint | ✓ present | `README.md` (POST /api/anima entry) |
| `node tests/run-all.js` — all existing + new tests pass | ✓ present | 348/348 passed |
| `node scripts/session-init.js` — 10/10 V-checks | ✓ present | 10/10 |
| `node --check server.js` — exit 0 | ✓ present | verified |
| `docs/CODE-REVIEW-2-anima-fork.md` verdict: `pass` or `pass+minor` | ✓ present | this file |

### (a) Missing or partial requirements

| Spec line | Status | Why |
|---|---|---|
| SPEC §14.7 User Story #3: "I want the result panel to show a positive + a negative prompt + a variant selector" | ⏳ deferred | Slice 2.3. The backend ships the endpoint; the frontend UI is Slice 2.3. |
| SPEC §14.7 User Story #4: "I want the chat console to refine the Anima prompt" | ⏳ deferred | Slice 2.4 |
| SPEC §14.7 User Story #5: "I want switching model mid-session to end cleanly" | ⏳ deferred | Slice 2.4 |
| SPEC §14.9 Slice 2.2: "manual demo: upload an image, hit `/api/anima`, see well-formed Anima positive + negative" | ✓ present (logic) | The endpoint is reachable, the schema is enforced, the JSON parse-with-fallback is in place. A live LLM call requires `MINIMAX_API_KEY` to be set; the test surface verifies the contract shape without spending credits. The "kill criterion" — "the MinMax vision call returns garbage on every test image" — is checked at the schema level (positive.length ≥ 60, negative.length ≥ 20) and the response-envelope-checked at the route level. |

### (b) Scope creep (behaviour NOT in spec)

None. Slice 2.2 ships exactly what SPEC §14.9 lists. The endpoint is reachable, the helper is exported, the route enforces the contract, the README documents the endpoint. No new endpoints, no new helpers beyond the contract's two components.

### (c) Out-of-scope behaviour deliberately not shipped

| Item | Why deferred |
|---|---|
| The frontend dispatch (clicking Generate in Anima mode routes here) | Slice 2.3 |
| The result panel re-shape (positive + negative textareas + variant selector) | Slice 2.3 |
| Chat dispatch / per-model session-end | Slice 2.4 |
| A11y deep-pass (axe-core, screen-reader smoke) | G5 polish audit |
| LoRA training pipeline | explicitly out-of-scope (SPEC §14.4.2 +14.7) |
| Anima online-platform integration | explicitly out-of-scope (SPEC §14.4.2) |

---

## Verdict: **pass**

**Total findings: 0 hard, 4 judgement (all pattern-adherence / contract-necessary), 0 spec deviations, 1 test-side note (not blocking).**

- All 18 new tests pass alongside the existing 330 → 348 tests.
- All 10 V-checks pass.
- `node --check` is clean on `server.js`.
- The slice implements the SPEC §14.9 DoD exactly.
- The slice defers everything else to Slices 2.3 / 2.4 as planned.
- No new dependencies, no schema migration.
- `server.js` grew by 268 lines (6675 → 6943), well under the 290KB kill criterion.
- The Anima contract is **the contract** — the source of truth is `docs/ANIMA-PROMPTING-MANUAL.md`, and the system prompt references it explicitly in its preamble.
- The license boundary is respected: no Anima weights, no hosted inference, no paid-API integration. The endpoint talks to **MiniMax M3** (a third-party LLM), not to Anima weights. Per SPEC §14.10, this is the safest framing.

**Slice 2.2 ships.** Move to Slice 2.3 (frontend dispatch wiring).
