# ARCHITECTURE.md — image-to-prompt (Slice 1)

**Status:** Draft → In Review → Approved (pending Gate G3)
**Slice:** 1 — texture Populate-with-AI button
**Created:** 2026-07-29

---

## 1. Stack (unchanged for Slice 1)

| Layer | Choice | Why not the alternative |
|---|---|---|
| Language | JavaScript (CommonJS) | matches existing codebase |
| Runtime | Node.js >= 18 | mirrors existing `package.json` |
| Framework | Express 4.21 | mirrors existing |
| View layer | Vanilla HTML/CSS/JS, no build step | mirrors existing |
| External API | MiniMax M3 (`MiniMax-Text-01`) | mirrors existing; same env vars |
| Tests | Bespoke Node scripts (`tests/run-all.js` + `scripts/smoke/`) | mirrors existing |
| Process model | Single Node process | mirrors existing |

**No new dependencies.** No new env vars. No schema migration. Slice 1 adds three code constructs (route, helper, prompt) following the established pattern.

## 2. File / folder layout (slice deltas only)

Slice 1 modifies these files. No new files except the optional smoke script.

```
image-to-prompt/
├── server.js                    ← + DEFAULT_TEXTURE_PROMPT, + callMiniMaxTextureAnalysis, + POST /api/texture route
├── src/
│   ├── app.js                   ← + isPopulatingTexture state flag, + populateTextureWithAI handler, + button in renderAnalysisEditor
│   ├── index.html               ← no change expected (button rendered programmatically)
│   └── styles.css               ← reuse existing .btn-secondary; no new selectors expected
├── tests/
│   └── run-all.js               ← + per-field test groups for /api/texture mirroring ADR 0018's pattern
├── scripts/smoke/               ← optional: + texture-ai-button-smoke.js (mirrors chat-conversational-smoke.js)
├── CONTEXT.md                   ← + 3-line note about Stage 1.T (texture re-analysis)
└── README.md                    ← + /api/texture entry in API Endpoints
```

**No new directories.** No new files in `data/`. No new ADR (per 3-criteria check above).

## 3. Seams (codebase-design vocabulary per `docs/PRINCIPLES.md` §6.1)

For Slice 1, three new external seams (and they're internal to the same module — `server.js` + `src/app.js`).

### Module: `POST /api/texture` (server-side)

| Attribute | Value |
|---|---|
| **Interface** | `POST /api/texture` (multipart/form-data, `image` field) → `{ success, data: { texture, model } }` |
| **Seam** | `server.js` line ~4082 (after the `/api/lighting` route, mirroring ADR 0018's ordering) |
| **Depth target** | **Deep** (same as `/api/actions`, `/api/mood`, `/api/lighting`) |
| **Hidden complexity** | multer file cleanup, MiniMax API key check (503 path), JSON Schema with `minLength: 60`, single-attempt LLM call, error sanitisation |
| **Test surface** | same as the seam — HTTP route at the route handler. Tests assert envelope shape + status codes. |
| **Deletion test** | Delete the route → the "Populate with AI" button on the frontend breaks for one field only (texture); the other 5 per-field buttons still work. **Earned.** Not a pass-through. |

### Module: `callMiniMaxTextureAnalysis` (helper)

| Attribute | Value |
|---|---|
| **Interface** | `(imageDataUri: string) → Promise<string>` |
| **Seam** | `server.js` module export (alongside `callMiniMaxActionsAnalysis`, `callMiniMaxMoodAnalysis`, `callMiniMaxLightingAnalysis`) |
| **Depth target** | **Deep** |
| **Hidden complexity** | Single-attempt LLM call, JSON schema construction, length-floor enforcement, prompt construction (uses `DEFAULT_TEXTURE_PROMPT`) |
| **Test surface** | Module export. Tests assert: prompt excludes forbidden vocab, prompt mandates category list, no retry loop, response schema enforces `minLength: 60`. |
| **Deletion test** | Delete the helper → `/api/texture` route cannot function; must be inlined back. **Earned.** |
| **Adapter** | One adapter: the MiniMax M3 HTTP client. No second adapter → no real seam at this layer (per `docs/PRINCIPLES.md` §6.1 "one adapter = hypothetical seam, two = real"). |

### Module: `populateTextureWithAI` (frontend handler)

| Attribute | Value |
|---|---|
| **Interface** | Click handler attached to the "Populate with AI" button beneath the texture textarea. |
| **Seam** | `src/app.js` (alongside `populateActionsWithAI`, `populateMoodWithAI`, `populateLightingWithAI`) |
| **Depth target** | **Deep** (same as the others) |
| **Hidden complexity** | no-image guard, in-flight flag, multer form-data construction, response envelope parsing, in-place DOM update, error surfacing via `showError` |
| **Test surface** | The click handler. Tests assert: handler defined, no-image guard present, in-flight flag toggles, in-place update path. |
| **Deletion test** | Delete the handler → button renders but does nothing; other 5 still work. **Earned.** |

### Internal seams (per `docs/PRINCIPLES.md` §6.1)

The new code can have internal seams (private to its implementation, used by its own tests). For Slice 1, no internal seams — the helper is the only internal piece, and it's tested through its public surface.

## 4. Pre-mortem (top 3)

1. **Prompt elicits useless output.** If `DEFAULT_TEXTURE_PROMPT` is poorly calibrated, the LLM may return generic text like "the image shows a textured surface" (12 words, fails `minLength: 60` → 503 path) or verb-heavy text that re-describes the whole image. **Pre-commit:** the prompt's 5 categories (surface quality, mark-making, material, pigment, tactile) are explicit; the schema's `minLength: 60` enforces substance. If the first 2 manual-demo attempts return garbage, kill the slice per `docs/SPEC.md` §11.
2. **Schema mismatch with frontend.** If `data.texture` returned by the endpoint has a different shape than `state.currentAnalysis.texture` (which the frontend uses for re-renders), the in-place update might fail silently. **Pre-commit:** mirror the established handler return shape (`{ success, data: { <field>, model } }`); mirror the established frontend destructuring (`.data.texture`). Run the existing per-field test group before manual demo.
3. **Backend state leak via uploads/.** Multer uploads the file to `uploads/` before the route handler; if the handler's cleanup `fs.unlinkSync` fails (e.g. file already deleted), the throw bubbles into the catch block. **Pre-commit:** mirror the existing handler's `try { ... if (filePath && fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch (_) {} } ... }` pattern — the silent catch on cleanup is a load-bearing safety net. (Inspect lines 3998–4038 of `server.js` to confirm before writing.)

## 5. Slice order with min/target/stretch (reproduced from `docs/SPEC.md` §9)

| # | Slice | min | target | stretch |
|---|---|---|---|---|
| 1 | texture Populate-with-AI | endpoint + handler + button + happy path + no-image guard | + tests + smoke + CONTEXT.md + README.md | + curated chip taxonomy (deferred per ADR 0018 §4d reasoning) |

This is the only slice in flight. **Frontier: 1 slice, no blockers.**

## 6. Decisions (this slice)

- **Lightweight decisions** (not ADR-worthy per 3-criteria check):
  - Endpoint path: `POST /api/texture` (mirrors field name, matches `/api/actions`/`/api/mood`/`/api/lighting`)
  - Length floor: `minLength: 60` (mirrors `actions`/`mood`; `texture` is a textarea, same contract)
  - No curated chips for texture (mirror ADR 0018 §1 reasoning for `actions` — image-specific field)
  - No retry loop (mirror ADR 0018 §5)
  - No preset override (mirror ADR 0018 §5)
  - Single-attempt LLM call (mirror ADR 0018 §2)
  - In-place DOM update (mirror all 5 prior per-field buttons)
- **No new ADR.** ADR 0018 is the canonical reference; this slice implements a pattern ADR 0018 already documents. Adding `docs/adr/0021-...md` would be redundant — it would say "do exactly what 0018 said, but for texture."

## 7. Out of scope (this slice)

- Curated chip taxonomy for texture (deferred; ADR 0018 §4d reasoning)
- Per-field route module split (`server/routes/per-field.js` — wide refactor, separate slice)
- Retry-with-strengthened-prompt loop
- Preset-aware prompt overrides
- User-editable per-field prompt modal
- New env vars, new dependencies, new schema, new migrations

## 8. Wide-refactor check (per `docs/PRINCIPLES.md` §6.3)

Slice 1 touches:
- `server.js` (additive, ~95 lines)
- `src/app.js` (additive, ~45 lines)
- `tests/run-all.js` (additive, ~80 lines)
- `CONTEXT.md` (3-line append)
- `README.md` (5-line append)

**Not a wide refactor.** Each change is additive within its file. No symbol rename, no schema column rename, no library migration. Vertical slice holds.

## 9. Refactor-trigger criteria (deferred)

If a future slice needs to touch **≥3 of these files for non-additive reasons** (rename, retype, schema change, library migration), trigger the per-field route split (separate wide-refactor slice per `docs/SYNTHESIS.md` §9 risk #3). Not now.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Initial slice 1 architecture | Phase G3 of Slice 1 |
| 2026-08-03 | Appended Slice 2 — Anima fork (model selector + dispatch + Anima contract) | Phase G3 of Slice 2; G2 approved by user; pre-Generate model picker chosen over dual-output design |

---

# Slice 2 — Anima fork (the appendices)

**Status:** Draft → In Review → Approved (pending Gate G3)
**Slice:** 2 — Anima fork (model selector + dispatch + Anima contract)
**Created:** 2026-08-03
**Origin:** `docs/SPEC.md` §14 (G2 approved)
**Reference doc:** `docs/ANIMA-PROMPTING-MANUAL.md` (the contract source of truth)

---

## A1. Stack (Slice 2 deltas)

| Layer | Choice | Why not the alternative |
|---|---|---|
| Language | JavaScript (CommonJS) | unchanged — matches existing codebase |
| Runtime | Node.js >= 18 | unchanged |
| Framework | Express 4.21 | unchanged |
| View layer | Vanilla HTML/CSS/JS, no build step | unchanged |
| External API | MiniMax M3 (`MiniMax-Text-01`) | unchanged — the Anima contract is prompt-engineering, not Anima inference |
| State persistence | `localStorage` (new) | sidebar: persist `state.model` + `state.animaVariant` across reloads |
| URL mirror | `?model=...` query string (new) | sidebar: shareable URLs |
| Tests | Bespoke Node scripts (`tests/run-all.js` + `scripts/smoke/`) | unchanged |
| Process model | Single Node process | unchanged |

**No new dependencies.** No new env vars. No schema migration. Slice 2 adds: one server route, one server helper, one server constant, three frontend state fields, one UI selector, one result-panel branch, one chat dispatch.

## A2. File / folder layout (Slice 2 deltas only)

```
image-to-prompt/
├── server.js                    ← + DEFAULT_ANIMA_PROMPT, + callMiniMaxAnimaAnalysis, + POST /api/anima route
├── src/
│   ├── app.js                   ← + state.model, + state.animaVariant, + ModelSelector component, + AnimaResultPanel branch, + chat dispatch
│   ├── index.html               ← no change expected (selector rendered programmatically)
│   └── styles.css               ← + .model-selector, + .anima-prompt-pair (positive/negative), + .variant-selector
├── tests/
│   └── run-all.js               ← + /api/anima route + helper + default-prompt tests (mirror ADR 0018 per-field pattern)
├── scripts/smoke/               ← + anima-fork-smoke.js (mirrors chat-conversational-smoke.js)
├── docs/
│   ├── ANIMA-PROMPTING-MANUAL.md ← already written (882 lines, the contract source of truth)
│   ├── SPEC.md                  ← + §14 Slice 2 (G2-approved)
│   ├── ARCHITECTURE.md          ← this section (G3)
│   ├── PRE-MORTEM.md            ← + Slice 2 entry (G3)
│   ├── SESSION-STATE.md         ← + post-slice notes (G4)
│   └── adr/0021-anima-fork.md   ← new ADR (G3)
├── CONTEXT.md                   ← + 3-line note about the model fork + Anima prompt contract
└── README.md                    ← + /api/anima entry in API Endpoints + the Anima manual link
```

**No new directories.** No new files in `data/`. New ADR per the 3-criteria check (see ADR 0021).

## A3. Seams (Slice 2 modules)

### Module A: `POST /api/anima` (server-side)

| Attribute | Value |
|---|---|
| **Interface** | `POST /api/anima` (multipart/form-data, `image` field + optional `variant` field ∈ {`base`, `aesthetic`, `turbo`}) → `{ success, data: { positive, negative, variant, model } }` |
| **Seam** | `server.js` (alongside the existing final-prompt route, after the per-field routes — placement mirrors the existing layering) |
| **Depth target** | **Deep** — same as the existing final-prompt route |
| **Hidden complexity** | multer file cleanup, MiniMax API key check (503 path), JSON Schema with `positive.minLength: 60` + `negative.minLength: 20`, single-attempt LLM call, variant-aware prompt selection, error sanitisation |
| **Test surface** | HTTP route at the route handler. Tests assert envelope shape + status codes + variant handling. |
| **Deletion test** | Delete the route → the Anima picker still works in the UI (no crash), but clicking Generate in Anima mode returns 404. The Z-Image picker is unaffected. **Earned.** |

### Module B: `callMiniMaxAnimaAnalysis` (server helper)

| Attribute | Value |
|---|---|
| **Interface** | `(imageDataUri: string, variant: 'base'|'aesthetic'|'turbo') → Promise<{ positive, negative }>` |
| **Seam** | `server.js` module export (alongside `callMiniMaxActionsAnalysis`, `callMiniMaxTexturesAnalysis`, etc.) |
| **Depth target** | **Deep** |
| **Hidden complexity** | Single-attempt LLM call, JSON schema construction with `positive` + `negative` shapes, length-floor enforcement, variant-aware prompt selection (Base / Aesthetic / Turbo), forbidden vocabulary check |
| **Test surface** | Module export. Tests assert: prompt excludes forbidden vocab, prompt mandates Anima contract rules, variant handling correct, no retry loop, response schema enforces both length floors. |
| **Deletion test** | Delete the helper → `/api/anima` route cannot function; must be inlined back. **Earned.** |
| **Adapter** | One adapter: the MiniMax M3 HTTP client. Same adapter used elsewhere — no new seam at this layer. |

### Module C: `DEFAULT_ANIMA_PROMPT` (server constant)

| Attribute | Value |
|---|---|
| **Interface** | `string` (the system prompt) |
| **Seam** | `server.js` module export |
| **Source of truth** | `docs/ANIMA-PROMPTING-MANUAL.md` §5, §7, §14 (the Anima contract codified) |
| **Depth target** | **Shallow** — a single string |
| **Variant handling** | The prompt is one base string; variant differences are encoded inside the prompt itself (the LLM is told to handle Base/Aesthetic/Turbo differences in the output). Alternative would be three constant exports, but the per-variant rules are short enough to keep in one prompt. |
| **Deletion test** | Delete the export → helper cannot construct its prompt; `/api/anima` 500s. **Earned.** |

### Module D: `state.model` + `state.animaVariant` (frontend state)

| Attribute | Value |
|---|---|
| **Interface** | `state.model: 'zimage_turbo' \| 'anima'`, `state.animaVariant: 'base' \| 'aesthetic' \| 'turbo'`. Persisted in `localStorage`. Mirrored in URL (`?model=anima&variant=turbo`). |
| **Seam** | `src/app.js` state object |
| **Depth target** | **Shallow** — two strings |
| **Hidden complexity** | localStorage read/write, URL read/write, default fallback (`'zimage_turbo'` for model, `'base'` for variant), reset on version bumps |
| **Test surface** | The state object. Tests assert: persistence round-trip, URL mirror, default fallback. |
| **Deletion test** | Delete the state fields → the model selector stays on the default (Z-Image Turbo), UI behaves as before. **Earned.** |

### Module E: `ModelSelector` (frontend component)

| Attribute | Value |
|---|---|
| **Interface** | A dropdown or button group near the Generate button. Reads `state.model`, writes on change. |
| **Seam** | `src/app.js` render |
| **Depth target** | **Shallow** — pure state binding |
| **Hidden complexity** | UI styling, accessibility (aria-label, keyboard navigation), default preset |
| **Test surface** | The rendered DOM. Tests assert: rendered with both options, default = Z-Image Turbo, change updates state. |
| **Deletion test** | Delete the component → app falls back to Z-Image Turbo only (existing behavior). **Earned.** |

### Module F: Result panel per contract (frontend component)

| Attribute | Value |
|---|---|
| **Interface** | Receives a `model` prop, renders the right shape. Z-Image: single prompt textarea. Anima: positive textarea + negative textarea + variant selector. |
| **Seam** | `src/app.js` render |
| **Depth target** | **Deep** — shape, behaviour, and chat-anchor all hidden behind one component |
| **Hidden complexity** | branch on `state.model`, conditional fields, in-place state updates, chat-anchor binding |
| **Test surface** | The rendered DOM. Tests assert: Z-Image mode renders single textarea, Anima mode renders positive + negative + variant selector. |
| **Deletion test** | Delete the component → result panel renders nothing (or a placeholder); the rest of the app is unaffected. **Earned.** |

### Module G: Chat dispatch (frontend handler)

| Attribute | Value |
|---|---|
| **Interface** | Chat console reads `state.model`, picks the right default system prompt, refines the right prompt. Switching model ends the current session. |
| **Seam** | `src/app.js` chat handler |
| **Depth target** | **Shallow** — state flag + dispatch |
| **Hidden complexity** | per-model default system prompt, per-model chat-anchor (refining Z-Image vs. Anima), session-end on model switch |
| **Test surface** | The chat handler. Tests assert: state.model-aware dispatch, per-model default system prompt, session-end on model switch. |
| **Deletion test** | Delete the dispatch → chat console refines the Z-Image prompt only (existing behavior). **Earned.** |

### Internal seams (per `docs/PRINCIPLES.md` §6.1)

The new code can have internal seams (private to its implementation, used by its own tests). For Slice 2, no internal seams — the helpers are the only internal pieces, and they're tested through their public surfaces.

## A4. Pre-mortem (Slice 2 — top 5)

(See `docs/PRE-MORTEM.md` Slice 2 entry for the full pre-mortem in the project's established format. Summary below.)

1. **Two contracts drift out of sync.** If the Z-Image side evolves (e.g., the next contract rewrite) and the Anima side doesn't, the two contracts diverge in the chat refinement experience. **Mitigation:** the per-field artifacts (`subject`, `actions`, `mood`, `lighting`, `texture`) are shared and are model-agnostic. Only the final-prompt assembly is model-specific. The dispatch state is first-class.
2. **The LLM emits generic Anima output that doesn't match the contract.** If `DEFAULT_ANIMA_PROMPT` is poorly calibrated, the LLM may return a generic "anime girl with detailed features" (fails length floor, fails tag rules, fails `@`-prefix on artist). **Mitigation:** the prompt's 6 categories (positive rules, negative rules, variant rules, non-anime routing, multi-character, forbidden vocabulary) are explicit. Length floors enforced. Manual demo with 3 image types.
3. **Variant switching mid-session confuses the chat history.** If the user switches from Base to Aesthetic mid-session, the chat history is now refining the wrong prompt. **Mitigation:** chat history is per-model AND per-variant. Switching either ends the current session.
4. **localStorage state corruption.** If the persisted `state.model` is a garbage string (e.g., from a future migration), the app crashes. **Mitigation:** validate on read against the allowed enum; fall back to default on mismatch.
5. **URL mirror with non-trivial states.** `?model=anima&variant=turbo` is fine, but if the user arrives with `?model=foo`, the app should silently fall back. **Mitigation:** same as #4 — validate against the enum.

## A5. Slice order (reproduced from `docs/SPEC.md` §14.9)

| Sub-slice | min | target | stretch |
|---|---|---|---|
| 2.1 — model-state + UI selector | state.model + state.animaVariant + persistence + URL mirror + selector UI | + tests + smoke | + a11y (aria-label, keyboard nav) |
| 2.2 — Anima backend contract | `DEFAULT_ANIMA_PROMPT` + `callMiniMaxAnimaAnalysis` + `/api/anima` + tests | + smoke script | + variant-specific prompt constants |
| 2.3 — frontend dispatch wiring | Generate routes to the right endpoint, result panel renders the right shape | + variant selector in Anima panel | + paste-detection (Z-Image prompt in Anima mode) |
| 2.4 — chat refines the selected model | chat dispatch is state.model-aware | + chat history is per-model | + chat history is per-model-and-per-variant |
| 2.5 — pre-mortem + ADR 0021 + final code review | ADR 0021 + PRE-MORTEM entry + CODE-REVIEW-2-anima-fork.md | n/a | n/a |

**Frontier:** 5 sub-slices, sequential. 2.1 must precede 2.2 because 2.1 establishes the state plumbing 2.2's frontend dispatch will use. 2.2 must precede 2.3 because 2.3 wires the dispatch. 2.3 must precede 2.4. 2.5 is last.

## A6. Decisions (Slice 2)

- **Lightweight decisions** (not separately ADR-worthy within Slice 2):
  - Endpoint path: `POST /api/anima` (matches the model name)
  - Response envelope: `{ success, data: { positive, negative, variant, model } }` (the Anima contract is two-output)
  - `state.model` default: `'zimage_turbo'` (existing behavior preserved)
  - `state.animaVariant` default: `'base'` (per manual §2 — "LoRAs should be trained using this version")
  - Persistence: `localStorage` for both state fields
  - URL mirror: `?model=...` + `?variant=...` query strings
  - Length floor: `positive: minLength: 60`, `negative: minLength: 20`
  - No retry loop (mirror ADR 0018 / 0019)
  - In-place DOM update (mirror existing pattern)
  - Chat history is per-model (resolve Open Question Q3)
  - Variant selector lives in the Anima result panel, not in the model selector (resolve Open Question Q1)
- **New ADR: `docs/adr/0021-anima-fork.md`.** Captures the fork decision itself (the strategic / architectural choice that crosses seams, per the 3-criteria check).

## A7. Out of scope (Slice 2)

- LoRA training pipeline (deferred — this is a prompt-engineering app, not a training app)
- Anima online-platform integration (deferred — the slice emits prompts; the user copies them)
- Two-level model selector (deferred — variant lives in the result panel)
- Paste-detection (Z-Image prompt in Anima mode UX nicety, deferred)
- Compare mode (generate both contracts side-by-side, deferred — explicitly out of scope per G1)
- Server.js split (deferred — pattern is well-established; slice is well-bounded)
- CircleStone Labs license redistribution (we are not redistributing weights; we are prompt-engineering)

## A8. Wide-refactor check (per `docs/PRINCIPLES.md` §6.3)

Slice 2 touches:
- `server.js` (additive, ~120 lines)
- `src/app.js` (additive, ~150 lines)
- `src/styles.css` (additive, ~30 lines)
- `tests/run-all.js` (additive, ~120 lines)
- `docs/SPEC.md` (already written, +74 lines)
- `docs/ANIMA-PROMPTING-MANUAL.md` (already written, 902 lines)
- `docs/ARCHITECTURE.md` (this section, +250 lines)
- `docs/PRE-MORTEM.md` (Slice 2 entry, +150 lines)
- `docs/adr/0021-anima-fork.md` (new, ~120 lines)
- `docs/SESSION-STATE.md` (post-slice, +20 lines)
- `docs/CODE-REVIEW-2-anima-fork.md` (post-slice, ~100 lines)
- `CONTEXT.md` (3-line append)
- `README.md` (5-line append)

**Not a wide refactor.** Each change is additive within its file. No symbol rename, no schema column rename, no library migration. Vertical slice holds.

## A9. Refactor-trigger criteria (Slice 2)

If a future slice needs to touch **≥3 of these files for non-additive reasons** (rename, retype, schema change, library migration), trigger the per-field route split (separate wide-refactor slice per `docs/SYNTHESIS.md` §9 risk #3). Not now.

Also: if the Anima LLM contract proves inadequate (the LLM keeps mis-emitting the Anima contract), the slice's contract may need to be split into per-variant constants. This is captured in the Slice 2 PRE-MORTEM as a "stretch" path under §A5.