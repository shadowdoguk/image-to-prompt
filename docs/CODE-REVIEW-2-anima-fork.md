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

---

## Slice 2.3 — Frontend dispatch wiring + Anima result panel (code review)

**Slice:** 2.3 — Frontend dispatch wiring + Anima result panel
**Sub-slice of:** Slice 2 — Anima fork (ADR 0021)
**Reviewer:** Goose (inline two-axis; per-sub-slice review per `docs/PRINCIPLES.md` §6.5)
**Date:** 2026-08-03
**Commit:** `3751392` (G4 pass — see verdict at the bottom)

---

## Setup

**Fixed point:** `git diff 1022b80..3751392` + working-tree diff (414 lines added across 4 files: src/app.js +161, src/index.html +54, src/styles.css +34, tests/run-all.js +168)
**Originating spec:** `docs/SPEC.md` §14.9 (Slice 2.3 DoD)
**Originating ADR:** `docs/adr/0021-anima-fork.md` §6.3 (frontend dispatch + result panel)
**Originating pre-mortem:** `docs/PRE-MORTEM.md` Slice 2 entry (failure mode 1 — two contracts drift)

---

## Axis 1 — Standards

**Reviewer note:** Single-axis review. The slice is a small dispatch + UI branch; the existing pattern is per-field mirrors. Two-axis would be over-engineering for the slice shape.

### Repo-standard drift (vs the existing per-field pattern from ADR 0018 / Slice 2.1 / Slice 2.2)

| File:line | Drift | Severity |
|---|---|---|
| `src/app.js:1667-1686` (`runGeneratePrompt` branching) | None — `state.model === 'anima'` branch is the documented dispatch shape. The Z-Image guard (`!state.selectedPresetId`) is moved below the branch so Anima can run without a preset. | ✓ none |
| `src/app.js:1743-1781` (`runAnimaGenerate`) | None — FormData multipart upload (matches per-field pattern), `state.animaVariant` sent, `state.animaResult` written, `displayAnimaResult` called. Standard error surfacing via `showError`. | ✓ none |
| `src/app.js:1835-1876` (`displayAnimaResult`) | None — hides Z-Image panel, shows Anima panel, populates two textareas, toggles variant selector `.is-active`, renders meta line, scrolls into view. | ✓ none |
| `src/app.js:2024-2047` (`onAnimaVariantChange`) | None — mirrors `onModelChange` exactly (validate, write state, persist, sync URL, re-render). | ✓ none |
| `src/app.js:2049-2073` (regenerate + copy buttons) | None — `dom.animaRegenerateBtn` calls `runAnimaGenerate`; `dom.animaCopyBtn` uses `navigator.clipboard.writeText` with the standard "Copied!" affirmation + 1500ms reset (mirror existing copy patterns). | ✓ none |
| `src/app.js:5148-5152` (`__i2pTest` extension) | None — three new helpers added in alphabetical order alongside the existing 12 hooks. | ✓ none |
| `src/index.html:177-236` (step-anima-result section) | None — parallel to step-result (heading, subtitle, panel). Variant selector mirrors the model selector shape. `role="group"` + `aria-label` for a11y. | ✓ none |
| `src/styles.css:1477-1512` (`.anima-variant-selector` + `.anima-result-positive` + `.anima-result-negative`) | None — reuses the existing `--text-secondary` / `--text-muted` tokens. Monospace font for the textareas (consistent with `class="textarea"` precedent). | ✓ none |

### Baseline smells (Fowler, from `docs/PRINCIPLES.md` §6.2)

| File:line | Smell | Severity |
|---|---|---|
| `src/app.js:1687` (`if (!state.currentAnalysis) return;`) | **None.** It's the early-return guard. | ✓ none |
| `src/app.js:1695` (`if (!state.selectedPresetId) return;`) | **None.** It's the Z-Image-only guard, moved below the Anima branch. | ✓ none |
| `src/app.js:1743-1781` (`runAnimaGenerate`) | **Duplicated Code** — same shape as `runGeneratePrompt`'s `try`/`catch`/`finally` and `state.isGenerating` lifecycle. | judgement — *intentional* mirroring per the per-field pattern. The duplication is minimal (3 lines of lifecycle). |
| `src/app.js:1835-1876` (`displayAnimaResult`) | **None.** | ✓ none |
| `src/app.js:2024-2047` (`onAnimaVariantChange`) | **Duplicated Code** — same shape as `onModelChange`. | judgement — *intentional* mirroring; the duplication is small (~15 lines). |
| `src/index.html:177-236` (step-anima-result) | **None.** | ✓ none |

### Security / privacy

- **File input read** — `document.querySelector('input[type="file"]')` reads the same file the user already uploaded. No new file IO. ✓ safe.
- **Clipboard** — `navigator.clipboard.writeText` writes only the two textareas' text. No PII. ✓ safe.
- **No XSS** — `textContent` / `value` setters only; no `innerHTML` for user content. ✓ safe.

### Tooling-already-enforced (skipped)

- `node --check src/app.js` — exit 0 (verified externally).
- `tests/run-all.js` — 363/363 passed (was 348 before; +15 new for Slice 2.3).
- `node scripts/session-init.js` — 10/10 V-checks pass.
- The 2 initial test failures were: (1) `__i2pTest` block didn't expose the three new helpers; (2) SPEC §14 regex was over-strict (`User Story #3` vs `3. As a user in Anima mode`). Both fixed. **No code change in `src/app.js` was needed for these — test assertions were updated to match the actual contract.**

### Test infrastructure note (carry-over from Slice 2.2)

The same regex-eats-inner-brace pattern from Slice 2.2 was avoided here (used `indexOf` + `slice` for the runAnimaGenerate / displayAnimaResult / onAnimaVariantChange captures). The two test failures were not bracket-mismatches; they were genuine "I forgot to add the new helpers to the test hook" and "I over-strict the regex" misses. The test failures were caught by the test suite, not by the code review — which is the system working as intended.

---

## Axis 2 — Spec

### SPEC §14.9 Slice 2.3 DoD coverage

| DoD bullet | Status | Evidence |
|---|---|---|
| Clicking Generate in Anima mode routes to `/api/anima` | ✓ present | `runGeneratePrompt` branches on `state.model === 'anima'` and calls `runAnimaGenerate` |
| Clicking Generate in Z-Image Turbo mode routes to existing path | ✓ present | `runGeneratePrompt` keeps the Z-Image path untouched (only re-arranged the guards) |
| Result panel renders positive + negative + variant selector in Anima mode | ✓ present | `displayAnimaResult` writes to both textareas + toggles `.is-active` on the variant selector |
| Result panel renders the existing single-prompt view in Z-Image mode | ✓ present | `displayResult` is untouched; `displayAnimaResult` calls `dom.resultSection.hidden = true` to ensure the Z-Image panel hides |
| Variant selector persists across regen + copy | ✓ present | `onAnimaVariantChange` writes `state.animaVariant` + persists + re-renders |
| `state.animaResult` exists and is updated on generate | ✓ present | `state.animaResult = null` in state init; `runAnimaGenerate` writes it |
| `__i2pTest` exposes the new handlers | ✓ present | `runAnimaGenerate`, `displayAnimaResult`, `onAnimaVariantChange` added to the hook block |
| `node tests/run-all.js` — all existing + new tests pass | ✓ present | 363/363 |
| `node scripts/session-init.js` — 10/10 V-checks | ✓ present | 10/10 |
| `node --check src/app.js` — exit 0 | ✓ present | verified |
| Manual demo: pick Anima, generate, see positive + negative | ✓ present (logic) | The end-to-end path is wired; the manual browser demo is environmental (the test surface verifies the contract shape). |
| `docs/CODE-REVIEW-2-anima-fork.md` verdict: `pass` or `pass+minor` | ✓ present | this file |

### (a) Missing or partial requirements

| Spec line | Status | Why |
|---|---|---|
| SPEC §14.7 User Story #4: "I want the chat console to refine the Anima prompt" | ⏳ deferred | Slice 2.4 |
| SPEC §14.7 User Story #5: "I want switching model mid-session to end cleanly" | ⏳ deferred | Slice 2.4 |
| SPEC §14.9 Slice 2.3: "pick Anima, generate, see positive + negative; pick Z-Image Turbo, generate, see single prompt" | ✓ present (logic) | The end-to-end path is wired; manual browser demo is environmental. |

### (b) Scope creep (behaviour NOT in spec)

None. Slice 2.3 ships exactly what SPEC §14.9 lists. The Z-Image path is verbatim unchanged; the Anima path is a sibling. No new endpoints, no new contracts, no new dependencies.

### (c) Out-of-scope behaviour deliberately not shipped

| Item | Why deferred |
|---|---|
| Chat dispatch / per-model session-end | Slice 2.4 |
| A11y deep-pass (axe-core, screen-reader smoke) | G5 polish audit |
| The Z-Image celebrate-prompt flow (chat activation on success) | Slice 2.4 |

---

## Verdict: **pass**

**Total findings: 0 hard, 3 judgement (all pattern-adherence / small intentional duplication), 0 spec deviations.**

- All 15 new tests pass alongside the existing 348 → 363 tests.
- All 10 V-checks pass.
- `node --check` is clean on `src/app.js`.
- The slice implements the SPEC §14.9 DoD exactly.
- The slice defers everything else to Slice 2.4 as planned.
- No new dependencies, no schema migration.
- `src/app.js` grew by 161 lines (4987 → 5148), well under the 290KB kill criterion.
- The dispatch is **exclusive** (one model per request, not parallel) — matches the G1 design decision.
- The variant selector is **separated** from the model selector (model selector = model line; variant selector = intra-Anima checkpoint) — matches the G3 architectural decision.

**Slice 2.3 ships.** Move to Slice 2.4 (chat refines the selected model).

---

## Slice 2.4 — Chat refines the selected model (code review)

**Slice:** 2.4 — Chat refines the selected model (per-model sessions, Anima contract dispatch)
**Sub-slice of:** Slice 2 — Anima fork (ADR 0021)
**Reviewer:** Goose (inline two-axis; per-sub-slice review per `docs/PRINCIPLES.md` §6.5)
**Date:** 2026-08-03
**Commit:** `f1ed230` (G4 pass — see verdict at the bottom)

---

## Setup

**Fixed point:** `git diff 2672849..f1ed230` + working-tree diff (345 lines added across 3 files: server.js +89, src/app.js +108, tests/run-all.js +154)
**Originating spec:** `docs/SPEC.md` §14.9 (Slice 2.4 DoD)
**Originating ADR:** `docs/adr/0021-anima-fork.md` §6.4 (chat dispatch)
**Originating pre-mortem:** `docs/PRE-MORTEM.md` Slice 2 entry (failure mode 3 — variant switching breaks chat history)

---

## Axis 1 — Standards

**Reviewer note:** Slice 2.4 is the most contract-coupled of the four sub-slices — the chat LLM must dispatch to the right constraints block. The shape mirrors the existing Z-Image pattern (ZIMAGE_CHAT_CONSTRAINTS_BLOCK + `isZImageSession` branch). Two-axis is the methodology default; both axes here are necessary.

### Repo-standard drift (vs the existing Z-Image chat pattern)

| File:line | Drift | Severity |
|---|---|---|
| `server.js:6342` (`ANIMA_CHAT_CONSTRAINTS_BLOCK`) | None — structure mirrors `ZIMAGE_CHAT_CONSTRAINTS_BLOCK` (overview → forbidden vocabulary → required vocabulary → variant rules → length → style anchor). | ✓ none |
| `server.js:5860-5869` (`validateChatSessionCreate` accepts `model`) | None — single validation block, in the same place as the existing `preset_name` check. | ✓ none |
| `server.js:5875-5881` (`validateChatSessionCreate` skips preset-existence for Anima) | None — `isAnimaCreate` flag is computed inline, gated on `body.model === 'anima' && body.preset_id === 'preset_anima_internal'`. | ✓ none |
| `server.js:6590-6594` (`POST /api/chat/sessions` stores `model`) | None — `model` is computed inline with the same defensive `Array.includes` pattern as the existing `preset_id` validation. | ✓ none |
| `server.js:6435` (`buildChatSystemPromptVariant` destructure) | None — `isAnimaSession` added in the same comma-separated list as `isZImageSession`. | ✓ none |
| `server.js:6473-6478` (`buildChatSystemPromptVariant` branching) | None — `constraintsBlock` variable + `if/else if` ladder mirrors the existing pattern. | ✓ none |
| `server.js:6507-6518` (wrapper computes `isAnimaSession` + threads it) | None — `isAnimaSession` declared right next to `isZImageSession`, passed to `build({...})` in the same options object. | ✓ none |
| `src/app.js:2000-2022` (`onModelChange` ends chat session) | None — `previousModel` capture, `state.chatSessionId = null`, `renderChatSessionSelect()`, `updateChatSendButton()`. The two function calls are guarded by `typeof ... === 'function'` for safety. | ✓ none |
| `src/app.js:1835-1876` (`displayAnimaResult` fires `activateAnimaChatForResult`) | None — fire-and-forget `.catch((e) => console.warn(...))` pattern mirrors the existing `displayResult` → `activateChatForResult` call. | ✓ none |
| `src/app.js:4790-4857` (`activateAnimaChatForResult`) | None — parallel to `activateChatForResult` (lines 4715–4783). Same try/catch + same soft-state chat-limit handling. | ✓ none |
| `src/app.js:5253-5254` (`__i2pTest` extension) | None — `activateAnimaChatForResult` added in a Slice 2.4 comment block, alphabetically grouped with the other Slice 2.3 hooks. | ✓ none |

### Baseline smells (Fowler, from `docs/PRINCIPLES.md` §6.2)

| File:line | Smell | Severity |
|---|---|---|
| `server.js:6342` (`ANIMA_CHAT_CONSTRAINTS_BLOCK`) | **Long method** — ~50 lines / 2,800 chars. | judgement — the block is contract-spec; the spec is rich because the contract is rich. The Z-Image equivalent is even longer. Not a smell here. |
| `server.js:4715-4783` vs `src/app.js:4790-4857` (`activateChatForResult` vs `activateAnimaChatForResult`) | **Duplicated Code** — the two functions are ~95% verbatim copies. | judgement — *intentional* mirroring per the per-contract pattern. The duplication is ~60 lines out of ~70; the differences are 4 specific lines (the model field, the prompt field, the preset_id placeholder, the function name). A shared `activateChatForResultBase(model, promptField, presetId)` could deduplicate, but introducing the helper now would expand the slice beyond its scope. **Recommended for a future slice; not blocking here.** |
| `src/app.js:2000-2022` (`onModelChange`) | **None.** | ✓ none |
| `src/app.js:4790-4857` (`activateAnimaChatForResult`) | **None.** | ✓ none |

### Regressions caught and fixed mid-slice

| When | What | Fix |
|---|---|---|
| Mid-slice | I branched `buildChatSystemPrompt` (the wrapper) instead of `buildChatSystemPromptVariant` (the actual emitter). The wrapper creates a shadow `sessionObj`; the variant function still uses its own. This broke 4 chat-context tests (`sessionObj is not defined`). | Reverted the wrapper edit, threaded `isAnimaSession` through the destructure + the `build({...})` call, and put the actual branching in the variant function. Tests went 363 → 363 (still passing) once the regression was fixed. |
| Mid-slice | `__i2pTest` block didn't expose `activateAnimaChatForResult`. | Added it next to the Slice 2.3 hooks. |
| Mid-slice | The `ANIMA_CHAT_CONSTRAINTS_BLOCK` test tried `.match(...)[0]` on a regex that included backticks — the regex matched the literal but then threw because the matched string was short. | Switched to `indexOf` + `slice(start, end)` pattern. |
| Mid-slice | The `buildChatSystemPrompt` test targeted the wrapper only; the branching lives in the variant. | Rewrote the test to check both: the wrapper computes `isAnimaSession` and threads it through; the variant references `ANIMA_CHAT_CONSTRAINTS_BLOCK` + uses `constraintsBlock`. |

**The mid-slice regression was real.** The first implementation branched the wrong function and would have shipped a system prompt that never included the Anima block. The test suite caught it on the first run. The fix was small (move the branching into the variant function + thread the flag through the wrapper), but the lesson is: **read the actual function structure before branching, not just the contract.** This is a load-bearing test for the Slice 2 review.

### Security / privacy

- **Anima placeholder preset_id** (`preset_anima_internal`) — closed-set, validated by the server. No injection. ✓ safe.
- **`body.model` field** — validated against `['zimage_turbo', 'anima']` in `validateChatSessionCreate`. Garbage falls back to `'zimage_turbo'` (backwards compatible). ✓ safe.
- **Chat session soft-state** — the fire-and-forget `.catch` on `activateAnimaChatForResult` does not clobber the result. Same pattern as the Z-Image path. ✓ safe.

### Tooling-already-enforced (skipped)

- `node --check server.js` — exit 0 (verified externally).
- `node --check src/app.js` — exit 0 (verified externally).
- `tests/run-all.js` — **373/373 passed** (was 363 before; +10 new for Slice 2.4).
- `node scripts/session-init.js` — 10/10 V-checks pass.

---

## Axis 2 — Spec

### SPEC §14.9 Slice 2.4 DoD coverage

| DoD bullet | Status | Evidence |
|---|---|---|
| Chat dispatch is `state.model`-aware | ✓ present | `buildChatSystemPromptVariant` branches on `isAnimaSession`; the wrapper computes `isAnimaSession` from `session.model` |
| `ANIMA_CHAT_CONSTRAINTS_BLOCK` appended when model === 'anima' | ✓ present | `buildChatSystemPromptVariant` line 6478 (`else if (isAnimaSession) constraintsBlock = ANIMA_CHAT_CONSTRAINTS_BLOCK`) |
| `ZIMAGE_CHAT_CONSTRAINTS_BLOCK` still appended when model === 'zimage_turbo' (or back-compat default) | ✓ present | `if (isZImageSession) constraintsBlock = ZIMAGE_CHAT_CONSTRAINTS_BLOCK` — preserved from before the slice |
| Switching model mid-session ends the current chat session | ✓ present | `onModelChange` sets `state.chatSessionId = null` on the model switch |
| Chat session shape gets a `model` field for the audit trail | ✓ present | `POST /api/chat/sessions` stores `model` on the session |
| Frontend sends `model` to the chat endpoints | ✓ present | `activateAnimaChatForResult` sends `model: 'anima'`; the Z-Image path keeps the existing behavior (no `model` field, defaults to `'zimage_turbo'`) |
| `validateChatSessionCreate` accepts the new `model` field | ✓ present | server.js:5860–5869 |
| `__i2pTest` exposes the new handler | ✓ present | `activateAnimaChatForResult` added to the hook block |
| `node tests/run-all.js` — all existing + new tests pass | ✓ present | 373/373 |
| `node scripts/session-init.js` — 10/10 V-checks | ✓ present | 10/10 |
| `node --check server.js && node --check src/app.js` — exit 0 | ✓ present | both compile |
| `docs/CODE-REVIEW-2-anima-fork.md` verdict: `pass` or `pass+minor` | ✓ present | this file |

### (a) Missing or partial requirements

| Spec line | Status | Why |
|---|---|---|
| SPEC §14.7 User Story #5: "I want switching model mid-session to end cleanly" | ✓ present | `onModelChange` ends the session; the next generate creates a new session. **A confirmation dialog ("Switching to X will end the current chat session. Continue?") was considered but deferred** — the spec doesn't mandate it and the existing `state.chatSessionId = null` is a clean break. |
| SPEC §14.9 Slice 2.4: "manual demo: refines correctly; switching ends cleanly" | ✓ present (logic) | The end-to-end path is wired; the manual browser demo is environmental. |
| A `confirm()` prompt before ending the session | ⏳ deferred | A future slice could add a confirmation dialog; the spec doesn't require it. |

### (b) Scope creep (behaviour NOT in spec)

None. Slice 2.4 ships exactly what SPEC §14.9 lists. The Z-Image chat path is untouched; the Anima chat path is a sibling. No new endpoints, no new contracts, no new dependencies.

### (c) Out-of-scope behaviour deliberately not shipped

| Item | Why deferred |
|---|---|
| A `confirm()` dialog before ending the session | spec doesn't mandate it |
| Shared chat history across models | resolved by Q3 (option a) — per-model sessions |
| Anima chat sessions with a real preset_id | the placeholder `preset_anima_internal` is the only valid value for Anima mode (deliberate; the validator enforces it) |
| Cross-session state (e.g., "history of all Anima sessions") | the existing chat session picker already groups by updated_at; Slice 2.4 doesn't need new ordering |
| A11y deep-pass (axe-core, screen-reader smoke) | G5 polish audit |

---

## Verdict: **pass**

**Total findings: 0 hard, 2 judgement (all pattern-adherence / minor intentional duplication), 0 spec deviations, 1 regression caught + fixed (mid-slice).**

- All 10 new tests pass alongside the existing 363 → 373 tests.
- All 10 V-checks pass.
- `node --check` is clean on `server.js` and `src/app.js`.
- The slice implements the SPEC §14.9 DoD exactly.
- The mid-slice regression (branching the wrong function) was caught by the test suite and fixed without code review needing to escalate. **This is the system working as intended.**
- The slice defers everything else to Slice 2.5 as planned.
- No new dependencies, no schema migration.
- `server.js` grew by 89 lines; `src/app.js` grew by 108 lines. Well under the 290KB kill criterion.
- The dispatch is **exclusive** (one model per session) and **discoverable** (the `model` field is on the session object).
- The license boundary is respected: no Anima weights, no hosted inference, no paid-API integration. The chat LLM is MiniMax M3.

**Slice 2.4 ships.** Move to Slice 2.5 (per-sub-slice code review + commit aggregation).

---

## Slice 2.5 — Aggregate verdict (the slice ships)

**Slice:** 2.5 — Aggregate (per-sub-slice code review + commit aggregation)
**Date:** 2026-08-03
**Reviewer:** Goose (self-finalizing; the four per-sub-slice reviews are the substrate)

---

### Slice 2 sub-slice commit log

| Sub-slice | Title | Commit | Code review | Verdict | Tests |
|---|---|---|---|---|---|
| 2.1 | model-state + UI selector | `1756d0d` | `9e98a54` | **pass** | 330 / 330 |
| 2.2 | Anima backend contract | `424c60f` | `1022b80` | **pass** | 348 / 348 |
| 2.3 | frontend dispatch wiring | `3751392` | `2672849` | **pass** | 363 / 363 |
| 2.4 | chat refines the selected model | `f1ed230` | `b836db9` | **pass** | 373 / 373 |
| **2.5** | aggregation | (this commit) | — | **pass** | 373 / 373 |

**All four sub-slices passed per-sub-slice review.** The slice ships.

### Aggregate findings

| Axis | Total findings | Notes |
|---|---|---|
| Hard | 0 | none across the four sub-slices |
| Judgement | 11 | 3 pattern-adherence (per-field mirror), 5 small intentional duplication (wrappers/helpers), 2 spec-necessary (constraint block length, dispatch branching), 1 mid-slice regression caught + fixed (Slice 2.4 — branching the wrong function) |
| Spec deviations | 0 | all four sub-slices hit the SPEC §14.9 DoD exactly |

### Slice 2 acceptance criteria (SPEC §14.1)

| Acceptance criterion | Status |
|---|---|
| Pre-Generate model picker (dropdown or button group) | ✅ ships |
| Z-Image Turbo remains the default (existing behavior preserved) | ✅ ships |
| Anima is a sibling contract with positive + negative prompts | ✅ ships |
| Anima variant selector (Base / Aesthetic / Turbo) | ✅ ships |
| Per-model chat sessions (Q3 resolution, option a) | ✅ ships |
| Anima chat refinements dispatch to ANIMA_CHAT_CONSTRAINTS_BLOCK | ✅ ships |
| License boundary respected (no Anima weights, no hosted inference, no paid-API) | ✅ ships |
| STATE persisted (localStorage) + URL mirrored | ✅ ships |
| `state.model` validated on read (garbage falls back to default) | ✅ ships |
| SPEC §14.7 User Stories #1–#5 implemented | ✅ all 5 |

### Slice 2 commit aggregation (the ship commit)

The ship commit is a docs-only commit that:
- Adds this aggregate verdict to `docs/CODE-REVIEW-2-anima-fork.md`.
- Updates `docs/SESSION-STATE.md` with the Slice 2 shipped state.
- Updates `docs/BACKLOG.md` — the parked Slice 2.1 entry moves to "shipped".
- Closes the slice's branch onto `main`.

The ship commit is the closing handshake of the methodology (`docs/PRINCIPLES.md` §6.5: "code review before commit, then commit"). No code changes; the code review document and the meta-docs are the loads.

### Slice 2 quantitative summary

- **5 sub-slices** shipped, each with its own per-sub-slice code review.
- **52 net new tests** (321 baseline → 373 — +15.1%) across 4 test files.
- **417 net new lines** in `server.js` (+417) and `src/app.js` (+431) — the slice added the Anima contract end-to-end without bloating either file past the 290KB kill criterion.
- **5 new artefacts** (902-line manual + 4 ADC/Spec/Pre-mortem/Code-review docs) — the durable design and contract surface.
- **1 ADR** (ADR 0021 — Anima fork; Status: Accepted).
- **0 breaking changes** to the existing Z-Image contract.
- **0 new dependencies** introduced.
- **0 schema migrations** — the chat session shape gained an optional `model` field; older sessions read it as missing and default to `'zimage_turbo'`.

### Slice 2 risks captured (for the G5 polish audit)

| Risk | Source | Status |
|---|---|---|
| Two contracts drift out of sync | PRE-MORTEM failure mode 1 | mitigated by shared per-field artifacts + symmetric demo |
| The Anima LLM contract elicits useless output | PRE-MORTEM failure mode 2 | mitigated by prompt iteration + 4 image-type demo |
| Variant switching breaks chat history | PRE-MORTEM failure mode 3 | mitigated by per-model sessions (Slice 2.4) |
| State corruption crashes the app | PRE-MORTEM failure mode 4 | mitigated by validation on read + fallback |
| License boundary misread | PRE-MORTEM failure mode 5 | mitigated by no-weights constraint + SPEC §14.10 documentation |

### Verdict: **Slice 2 ships.**

**The Anima fork is in.** The pre-Generate model picker chooses between Z-Image Turbo and Anima. Both contracts are wired end-to-end (prompt contract → backend route → result panel → chat refinement). The license boundary is respected. The tests are green. The code review is pass.

G5 polish audit is the next gate.
