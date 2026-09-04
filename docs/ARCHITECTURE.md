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
| 2026-08-04 | Appended Slice 3 — Kilo Code provider migration + model selector | Phase G3 of Slice 3; G2 approved by user; Kilo AI Gateway as sole provider; six hardcoded models; buildVisionMessage helper; MiniMax M3 default |

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

---

# Slice 3 — Kilo Code provider migration + model selector (the appendices)

**Status:** Draft → In Review → Approved (pending Gate G3)
**Slice:** 3 — Kilo Code provider migration + model selector
**Created:** 2026-08-04
**Origin:** `docs/SPEC.md` §15 (G2 approved)
**Reference doc:** `https://kilo.ai/docs/gateway/api-reference` (the API contract source of truth)

---

## B1. Stack (Slice 3 deltas)

| Layer | Choice | Why not the alternative |
|---|---|---|
| Language | JavaScript (CommonJS) | unchanged |
| Runtime | Node.js >= 18 | unchanged |
| Framework | Express 4.21 | unchanged |
| View layer | Vanilla HTML/CSS/JS, no build step | unchanged |
| LLM Provider | **Kilo AI Gateway** (`api.kilo.ai`) | OpenAI-compatible gateway to 500+ models; single `KILO_API_KEY`; replaces direct MiniMax API |
| Image format | OpenAI-compatible `image_url` content parts | Kilo Code uses this format; `buildVisionMessage` helper standardises it |
| State persistence | `localStorage` (extended) | sidebar: persist `state.llmModel` across reloads |
| URL mirror | `?llm=...` query string (new) | sidebar: shareable URLs |
| Tests | Bespoke Node scripts (`tests/run-all.js`) | unchanged |
| Process model | Single Node process | unchanged |

**No new dependencies.** No schema migration. Slice 3: one new helper, ~15 renamed helpers, one new state field, one UI selector, env var swap.

## B2. File / folder layout (Slice 3 deltas only)

```
image-to-prompt/
├── server.js                    ← + buildVisionMessage helper
                                  ← callMiniMax* → callKilo* (rename, +model param)
                                  ← MINIMAX_* env vars → KILO_* env vars
                                  ← all fetch URLs → KILO_BASE_URL
                                  ← response envelope provider: 'kilo-code'
├── src/
│   ├── app.js                   ← + state.llmModel, + model selector handler
│   ├── index.html               ← + model selector <select> in upload section
│   └── styles.css               ← + .model-selector styling
├── tests/
│   └── run-all.js               ← env var tests, buildVisionMessage tests,
                                  ← model param validation, selector rendering
├── docs/
│   ├── SPEC.md                  ← §15 (G2-approved)
│   ├── ARCHITECTURE.md          ← this section (G3)
│   ├── PRE-MORTEM.md            ← Slice 3 entry (G3)
│   ├── adr/0022-kilo-code-provider.md  ← new ADR (G3)
│   ├── SESSION-STATE.md         ← post-slice notes (G4)
│   └── CODE-REVIEW-3-kilo-code-provider.md ← post-slice (G4)
├── CONTEXT.md                   ← updated provider section
└── README.md                    ← updated env vars section
```

**No new directories.** No new files in `data/`. New ADR per the 3-criteria check (provider migration crosses seams — ADR 0022).

## B3. Seams (Slice 3 modules)

### Module A: `buildVisionMessage` (server helper — NEW)

| Attribute | Value |
|---|---|
| **Interface** | `(imageDataUri: string, prompt: string) → [{role: "user", content: ContentPart[]}]` |
| **Seam** | `server.js` module export |
| **Depth target** | **Deep** |
| **Hidden complexity** | Data URI validation, image_url content part construction, prompt wrapping, base64 passthrough (no re-encoding — Kilo Code accepts data URIs in `image_url.url`) |
| **Test surface** | Module export. Tests assert: output shape matches OpenAI vision format, data URI preserved in `url` field, text part follows image part, valid for both `system`+`user` and `user`-only message patterns. |
| **Deletion test** | Delete the helper → every vision call site breaks; must inline ~15 copies of the same format. **Earned.** |

### Module B: `callKilo*` helpers (~15 functions — RENAMED)

| Attribute | Value |
|---|---|
| **Interface** | Unchanged from `callMiniMax*` except: `(imageDataUri, model, ...optionalPerCallParams) → Promise<result>` |
| **Seam** | `server.js` module exports |
| **Depth target** | **Deep** (unchanged) |
| **Hidden complexity** | Kilo Code fetch (base URL, auth header, model param), JSON schema construction, response parsing (`choices[0].message.content`), error handling (401/402/429/502/503) |
| **Test surface** | Module exports. Tests assert: helpers exported with new names, model param accepted, fetch called with correct URL + auth, response parsed from OpenAI shape. |
| **Deletion test** | Delete one helper → its endpoint 500s; other endpoints unaffected. **Earned.** |

### Module C: `state.llmModel` (frontend state — NEW)

| Attribute | Value |
|---|---|
| **Interface** | `string` — one of six model IDs. Default `'minimax/minimax-m3'`. Persisted in `localStorage`. Mirrored in URL (`?llm=...`). |
| **Seam** | `src/app.js` state object |
| **Depth target** | **Shallow** — a string |
| **Hidden complexity** | localStorage read/write, URL read/write, validation against six allowed values, fallback to default on garbage |
| **Test surface** | The state object. Tests assert: persistence round-trip, URL mirror, default fallback, garbage rejection. |
| **Deletion test** | Delete the field → model selector defaults to MiniMax M3, UI behaves as before. **Earned.** |

### Module D: Model selector UI (frontend component — NEW)

| Attribute | Value |
|---|---|
| **Interface** | `<select>` dropdown with six options. Rendered in the upload section, upstream of the output-contract selector. |
| **Seam** | `src/index.html` (markup) + `src/app.js` (handler) |
| **Depth target** | **Shallow** — pure state binding |
| **Hidden complexity** | DOM event handler, `state.llmModel` binding, visual distinction from output-contract selector |
| **Test surface** | The rendered DOM. Tests assert: six options present, default = MiniMax M3, change updates state, option values are Kilo Code model IDs. |
| **Deletion test** | Delete the selector → app falls back to MiniMax M3 (default). **Earned.** |

### Module E: Model param on every endpoint (server routes — MODIFIED)

| Attribute | Value |
|---|---|
| **Interface** | Every endpoint accepts `llmModel` in `req.body`, validates against six allowed IDs, passes to helper. 400 on invalid. |
| **Seam** | All route handlers in `server.js` |
| **Depth target** | **Shallow** — validation + passthrough |
| **Hidden complexity** | Validation (whitelist check), error message on invalid model |
| **Test surface** | HTTP routes. Tests assert: valid model accepted, invalid model → 400, endpoint passes model to helper. |
| **Deletion test** | Delete validation → garbage model IDs reach Kilo Code → 400 from gateway (not as clear to user). **Earned.** |

## B4. Pre-mortem (Slice 3 — top 5)

(See `docs/PRE-MORTEM.md` Slice 3 entry for the full pre-mortem. Summary below.)

1. **Kilo Code gateway is down or returns 5xx.** All LLM calls fail. No fallback to direct MiniMax. **Mitigation:** clear error messaging per status code. User can wait and retry. This is an accepted risk of single-provider architecture.
2. **Image format mismatch produces garbled output.** If `buildVisionMessage` constructs the content parts incorrectly, models may ignore the image or misinterpret it. **Mitigation:** test the helper's output shape against the OpenAI vision spec. Manual demo with a known image across all six models.
3. **Model rename during helper migration misses a call site.** One of the ~15 call sites keeps the old `callMiniMax*` name → endpoint 500s. **Mitigation:** global search for `callMiniMax` after migration must return zero results. Add a test that asserts no `callMiniMax` string remains in `server.js`.
4. **localStorage collision with `state.model`.** The output-contract selector already uses `state.model`. Adding `state.llmModel` is unambiguous, but the chat session `model` field ambiguity could cause bugs. **Mitigation:** chat session stores both `llm_model` (LLM model ID) and `contract` (output contract, renamed from `model`).
5. **Model produces different output shape than MiniMax.** GPT-5.6 Luna or Grok 4.3 may emit JSON schemas or prose formats differently than MiniMax M3. The existing JSON Schema validators (`minLength`, etc.) should catch structural failures. **Mitigation:** all response schemas remain enforced server-side. The user sees validation errors, not silent garbage.

## B5. Slice order (reproduced from `docs/SPEC.md` §15.9)

| Sub-slice | min | target | stretch |
|---|---|---|---|
| 3.1 — env + server-side provider swap | env var rename + helper rename + fetch URL swap | + all 503 path updates | — |
| 3.2 — buildVisionMessage helper + migration | helper + all call sites migrated | + zero `callMiniMax` remaining | — |
| 3.3 — model selector UI + state | selector + state.llmModel + persistence + URL | + a11y (aria-label) | — |
| 3.4 — wire model param | model param on all endpoints + validation | + chat session LLM model field | — |
| 3.5 — tests + code review + docs | tests pass + CODE-REVIEW-3 + CONTEXT.md + README.md | + ADR 0022 | — |

**Frontier:** 5 sub-slices, sequential. 3.1 must precede 3.2 (helpers must be renamed before call sites use the new names). 3.2 must precede 3.4 (call sites must accept model param). 3.3 is parallelisable with 3.1–3.2 but must precede 3.4 (UI must exist before endpoints receive model param). 3.5 is last.

## B6. Decisions (Slice 3)

- **Lightweight decisions** (not separately ADR-worthy within Slice 3):
  - `buildVisionMessage` as single helper (expand-contract pattern)
  - Mechanical rename: `callMiniMax*` → `callKilo*`
  - Model validation: whitelist of six IDs, 400 on mismatch
  - `state.llmModel` default: `'minimax/minimax-m3'`
  - URL parameter: `?llm=...` (not `?model=...` — that's the output contract)
  - Chat session: `llm_model` field (not `model` — avoids collision with output contract)
  - Response envelope `provider`: `'kilo-code'`
  - Error messages: human-readable per status code
- **New ADR: `docs/adr/0022-kilo-code-provider.md`.** Captures the provider migration decision (the strategic choice to replace direct MiniMax with Kilo Code gateway, which crosses the entire server-side seam). Status: **Proposed** (awaiting G3 approval).

## B7. Out of scope (Slice 3)

- Dynamic model list from `GET /models` (deferred — six models are hardcoded)
- Multi-provider architecture (deferred — Kilo Code is sole provider)
- Provider fallback to direct MiniMax (deferred — single-provider by design)
- Model capability metadata in the selector (deferred — display names only)
- Streaming responses (deferred — all calls remain non-streaming)
- Server.js split (deferred — well under 290KB kill criterion)
- Preset-aware model selection (deferred — model selector is global)

## B8. Wide-refactor check (per `docs/PRINCIPLES.md` §6.3)

Slice 3 touches:
- `server.js` (renames + new helper + fetch URL changes, ~200 lines touched)
- `src/app.js` (additive, ~50 lines)
- `src/index.html` (additive, ~10 lines)
- `src/styles.css` (additive, ~15 lines)
- `tests/run-all.js` (additive + rename updates, ~80 lines)
- `docs/SPEC.md` (already written, §15)
- `docs/ARCHITECTURE.md` (this section)
- `docs/PRE-MORTEM.md` (Slice 3 entry)
- `docs/adr/0022-kilo-code-provider.md` (new)
- `CONTEXT.md` (update provider section)
- `README.md` (update env vars)

**Not a wide refactor.** The `callMiniMax*` → `callKilo*` rename is mechanical (global find-and-replace), not a semantic change. No schema migration, no symbol rename that crosses module boundaries, no library migration. The rename stays within `server.js`. Vertical slice holds.

## B9. Refactor-trigger criteria (Slice 3)

If a future slice needs to add a **second provider** (e.g., direct OpenAI alongside Kilo Code), trigger the provider-abstraction refactor (separate wide-refactor slice). Not now — Slice 3 is single-provider by design.

Also: if the Kilo Code gateway proves unreliable (≥3 downtime incidents in one week), trigger a fallback-provider slice (direct MiniMax or OpenAI as backup). This is captured in the Slice 3 PRE-MORTEM as failure mode #1.
---

# Slice 4 — Tri-provider routing (the appendices)

**Status:** Draft → In Review → Approved (pending Gate G3 user approval — proceeding under Slice 3 closeout pre-commitment)
**Slice:** 4 — Tri-provider routing (Kilo Code / MiniMax / Alibaba DashScope)
**Created:** 2026-09-03
**Origin:** `docs/SPEC.md` §16 (G2 approved); `docs/adr/0023-tri-provider-routing.md`
**Pre-commitment:** lands with the G4 visual-demo gate deferred from `docs/CODE-REVIEW-10-slice-3-closeout.md` follow-up #2.

---

## C1. Stack (Slice 4 deltas)

| Layer | Choice | Why not the alternative |
|---|---|---|
| Language | JavaScript (CommonJS) | unchanged |
| Runtime | Node.js >= 18 | unchanged |
| Framework | Express 4.21 | unchanged |
| View layer | Vanilla HTML/CSS/JS, no build step | unchanged |
| LLM provider abstraction | Thin adapter pattern (3 adapters, 1 dispatcher) | Third-party library (LiteLLM, Portkey) — over-abstraction for 3 providers |
| Provider allowlist | `ALLOWED_PROVIDERS` + `ALLOWED_LLM_MODELS_BY_PROVIDER` in `server.js` | Hardcoded per call site — fails single-source-of-truth |
| Live-vs-stub gating | `isProviderLive(provider)` checks `${PROVIDER}_LIVE` env var | Always-live — burns API budget in tests |
| Frontend state | `state.provider` sibling to `state.llmModel`, both URL-mirrored + localStorage-persisted | New state without persistence — re-selects on every reload |

## C2. Module map (Slice 4 deltas)

```
server.js
├── const ALLOWED_PROVIDERS
├── const ALLOWED_LLM_MODELS_BY_PROVIDER
├── const isProviderLive(provider)
├── function resolveProviderAndModel(body) → { provider, model }
├── function callProvider(provider, model, messages, options)
│   ├── dispatch to callKiloProvider
│   ├── dispatch to callMiniMaxProvider
│   └── dispatch to callAlibabaProvider
├── callKiloProvider(model, messages, options) — live (always)
├── callMiniMaxProvider(model, messages, options) — live if MINIMAX_LIVE=1, stub otherwise
├── callAlibabaProvider(model, messages, options) — live if DASHSCOPE_LIVE=1, stub otherwise
└── 8 route handlers + 2 helper call sites pass provider + model

src/app.js
├── state.provider = 'kilo_code'
├── ALLOWED_PROVIDERS_FRONTEND (mirrors server.js)
├── PROVIDER_STORAGE_KEY = 'i2p.state.provider'
├── validateProvider(raw) → 'kilo_code'
├── renderProviderSelector() + onProviderChange()
├── <select id="provider-selector"> change listener
├── renderLlmModelSelector() — option list derived from ALLOWED_LLM_MODELS_BY_PROVIDER[state.provider]
├── fd.append('provider', state.provider) on /api/analyze, /api/anima
└── provider: state.provider on /api/generate-prompt, chat messages

src/index.html
└── <select id="provider-selector"> upstream of <select id="llm-model-selector">

src/styles.css
└── .provider-row, .provider-label, .provider-select
```

## C3. Adapter pattern (shared)

Each of the three adapters implements the same shape:

```javascript
const callKiloProvider = async (model, messages, options = {}) => {
  // 1. Auth header
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.KILO_API_KEY}` };
  // 2. Request body
  const body = JSON.stringify({ model, messages, ...(options.response_format ? { response_format: options.response_format } : {}) });
  // 3. HTTP call
  const resp = await fetch(`${process.env.KILO_BASE_URL}/chat/completions`, { method: 'POST', headers, body });
  // 4. Normalize response
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';
  return { ok: resp.ok, content, raw: data, error: resp.ok ? null : `Kilo ${resp.status}` };
};
```

The dispatcher returns the **same shape** regardless of provider. Route handlers never branch on provider.

## C4. Stub gating (shared)

```javascript
const isProviderLive = (provider) => {
  if (provider === 'kilo_code') return true; // Slice 3 ship state — Kilo Code is always live.
  return process.env[`${provider.toUpperCase()}_LIVE`] === '1';
};

const stubResponse = (provider) => ({
  ok: true,
  content: `[${provider}_stub] Deterministic stub response. Set ${provider.toUpperCase()}_LIVE=1 to enable live calls.`,
  raw: { stub: true, provider },
  error: null
});
```

When `isProviderLive` returns false, the adapter returns `stubResponse(provider)` after a 100ms delay (so the loading-state UI is exercised in tests too).

## C5. Failure modes (Slice 4)

1. **Provider live but auth fails (401/403).** Adapter returns `{ ok: false, content: '', raw: data, error: `Provider auth failed: ${resp.status}` }`. Route handler surfaces as 500 with the provider-specific error.
2. **Provider live but rate-limited (429).** Same path as auth failure; the error message names the provider so the user can switch.
3. **Provider stub (env var unset).** Adapter returns `{ ok: true, content: '<stub>', raw: { stub: true }, error: null }`. Route handler returns 200 with the stub content as the prompt. Frontend shows a banner "stub mode — set `${PROVIDER}_LIVE=1`".
4. **Unknown provider.** `callProvider` returns `{ ok: false, error: 'Unknown provider: ${provider}' }`. Route handler surfaces as 400.
5. **Model not allowed for provider.** `resolveProviderAndModel` falls back to the provider's first allowed model. Silent fallback (logged) — same pattern as Slice 3.3 `validateLlmModel`.

## C6. URL canonicalization (Slice 4)

URL state: `?provider=` + `?llm=`. Both omitted when at default (provider=`kilo_code`, llm=`minimax/minimax-m3`). Default URL stays `/`. The frontend mirrors `state.provider` and `state.llmModel` symmetrically (URL > localStorage > defaults).

## C7. Refactor-trigger criteria (Slice 4)

Trigger the next refactor if:
- A fourth provider is added (separate slice for the dispatcher generalization).
- One of the three live providers changes its response shape (adapter-only update, no slice).
- Per-user API keys are introduced (BYOK) — requires auth-layer rewrite, separate slice.
- Provider selector grows from `<select>` to a richer UI (e.g. search + autocomplete) — separate slice.

---


## CR-series — Chat redesign (oil-painting RAG edition)

**Source:** `docs/SPEC.md` §17–20 + ADR 0025. Pre-approved under full-autonomy directive (2026-09-04).

### CR-A1. New modules

| Module | Path | Purpose |
|---|---|---|
| `rag.js` | `server/lib/rag.js` | Hand-rolled cosine similarity over `data/rag_index.json`. `indexChunks()`, `appendChunkToIndex()`, `retrieveRelevantChunks(query, k)`, `loadCorpus()`, `getCorpusSummary()`. |
| `embeddings.js` | `server/lib/embeddings.js` | Kilo gateway embedding wrapper (`text-embedding-3-small`). `embedBatch(texts)`, retry-on-429 with back-off. |
| `rag_ingest.js` | `server/lib/rag_ingest.js` | Auto-ingest hooks: `ingestStage2Output()`, `ingestChatProposal()`. Debounced + capped at 5,000 chunks. |

### CR-A2. New data files

| Path | Purpose | Mode |
|---|---|---|
| `data/rag_corpus/composition.json` | Curated seed: composition topics | 0644, gitignored (generated) |
| `data/rag_corpus/historical_art.json` | Curated seed: historical conventions | 0644, gitignored |
| `data/rag_corpus/oil_painting_style.json` | Curated seed: brushwork + pigment | 0644, gitignored |
| `data/rag_index.json` | Vector index: `{ chunks: [...] }` | 0600, gitignored |
| `data/chat_attachments/<session_id>/...` | User-uploaded images per session | 0600, gitignored |

### CR-A3. New endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/rag/reindex` | Re-embed every chunk (admin; debounced) |
| `GET` | `/api/rag/corpus` | Chunk titles + sources for UI affordance |
| `POST` | `/api/rag/search` | Preview the retrieval (`{ query, k }`) |
| `POST` | `/api/chat/sessions/:id/attachments` | Upload an image (mul­ter, 10 MB cap) |
| `GET` | `/api/chat/attachments/:id` | Serve an attachment (inline) |
| `DELETE` | `/api/chat/attachments/:id` | Hard-delete + unlink from messages |
| `PATCH` | `/api/chat/sessions/:id` | Direct edit of `current_prompt` |
| `POST` | `/api/chat/sessions/:id/revert/:messageId` | Rewind `current_prompt` to a prior message |
| `POST` | `/api/chat/sessions/:id/fork-from/:messageId` | Mint a new session whose `original_prompt` is the parent's `current_prompt` at fork point |

### CR-A4. Chat system prompt structure (after CR-1)

```
DEFAULT_CHAT_SYSTEM_PROMPT          ← oil-painting persona (rewritten)
SESSION CONTEXT (original/current/pending/analysis)
RETRIEVAL block (top-k chunks, k=4)
ZIMAGE_CHAT_CONSTRAINTS_BLOCK       ← if Z-Image preset
ANIMA_CHAT_CONSTRAINTS_BLOCK        ← if Anima preset
```

### CR-A5. Failure modes (CR-series)

1. **Kilo embedding 429.** Back-off retry; if all 3 attempts fail, run chat in no-RAG mode with a banner in the UI ("retrieval unavailable").
2. **Index corruption on load.** Reload from `data/rag_corpus/` (curated seed) and re-embed in a debounced background task. Logged.
3. **Attachment upload exceeds 10 MB.** Multer rejects; UI surfaces the error inline.
4. **Session-delete cascade race.** The attachment directory is removed synchronously after the JSON write succeeds. On any fs error, log + continue (best-effort).
5. **Vision message body too large.** Cap at 4 attachments × 10 MB = 40 MB per request; refuse with 413 if exceeded.
6. **Auto-ingest cap hit.** FIFO-evict oldest non-curated chunk. Curated seed is never evicted.

### CR-A6. Refactor-trigger criteria (CR-series)

- Corpus exceeds 5,000 chunks AND cosine scan latency > 50 ms p95 → expand-contract to LanceDB (ADR 0025 rejected alternatives §1).
- Embedding model swap → re-embed in background; bump `embedding_model` on the index.
- Attachment storage exceeds 1 GB total → add a per-session cap + warning.
- A user wants cross-device sync → separate slice (out of CR-series scope per ADR 0025 consequences).

---

