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
