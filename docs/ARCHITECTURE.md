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


---

## Slice 26 — Vision-capability-data-model appendix

**Appended 2026-09-05.** Source: SPEC §21, ADR 0026.

### §26.A1 — Files touched

| Path | Status | Purpose |
|---|---|---|
| `server.js` | modified | removed regex; added Set near model registry; consumer uses `.has()` |
| `tests/run-all.js` | modified | 5 new static-parse regression tests |
| `docs/adr/0026-vision-capability-data-model.md` | new | design rationale |
| `docs/SPEC.md` §21 | appended | slice spec |
| `docs/PRE-MORTEM.md` §26 | appended | risks + pre-commitments |
| `docs/CODE-REVIEW-27-vision-capability-coverage.md` | new | two-axis review, verdict pass |

### §26.A2 — Data shape

`VISION_CAPABLE_MODELS = new Set([modelId, ...])` — flat list of vision-capable model ids. Colocated with `ALLOWED_LLM_MODELS_BY_PROVIDER`. Update rule: every id in the catalog is either in the Set (vision-capable) or explicitly noted as text-only with a negative-case test. The 5 regression tests fail if the two lists diverge.

### §26.A3 — Consumer

`buildUserMessageWithAttachments(sessionId, messageContent, attachmentIds, llmModel)` — boolean check via `VISION_CAPABLE_MODELS.has(llmModel)`. Truthy → render image_url content parts from the manifest. Falsy → inject `[N attachment(s) attached — not visible to the current model.]` text placeholder.

### §26.A4 — Refactor-trigger criteria

- A model with vision + reasoning + context-length + pricing capabilities needs surfacing in the UI → replace the Set with a per-provider metadata table (ADR 0026 §2 rejected alternative, parked). That refactor wraps the Set without reshaping the consumer.
- A user adds a custom model via UI-R7 → it is NOT in the Set by default. Chat degrades to text-only for it. Surfacing this in the UI is out of CR-26 scope.

### §26.A5 — Failure modes

- User on a model not in the Set and not in the catalog (corrupted `data/model_config.json`) → chat still works, attachment demoted to text-only. Logged as a `WARN` (existing pattern).
- Set and `ALLOWED_LLM_MODELS_BY_PROVIDER` diverge → regression tests fail at `node tests/run-all.js`. Smoke flow blocked.
- Set literal accidentally emptied → all attachments demoted to text-only. Caught by the "Set is defined" regression test.

---

## §27 — Inline-diff-on-Apply (CR-A7, SPEC §22)

### A1 — Render path

Assistant messages with a non-null `suggested_prompt` are rendered through a new `renderChatMessageDiff(messageNode, currentPrompt, suggestedPrompt)` helper in `src/app.js`. The helper:

1. Tokenises both strings into word arrays using `/(\s+|[.,;:()\[\]"'`])/` as the boundary regex (whitespace and punctuation are split-separators).
2. Runs an LCS-based word-diff (`computeWordDiff(a, b)`) producing a flat array of `{ type: 'context' | 'added' | 'removed', text }` tokens.
3. Groups contiguous tokens of the same type into **hunks**. A hunk is one or more tokens; each has a checkbox. Default state: `accepted: true` for added, `accepted: false` for removed (so the default "Apply all" produces exactly `suggested_prompt`).
4. Builds the DOM:
   ```
   <div class="chat-diff">
     <span class="chat-diff__hunk chat-diff__hunk--context" data-hunk-id="0">…context text…</span>
     <span class="chat-diff__hunk chat-diff__hunk--removed" data-hunk-id="1" data-accepted="false">
       <input type="checkbox" class="chat-diff__hunk-checkbox" />
       <span class="chat-diff__text">…removed words…</span>
     </span>
     <span class="chat-diff__hunk chat-diff__hunk--added" data-hunk-id="2" data-accepted="true">
       <input type="checkbox" class="chat-diff__hunk-checkbox" />
       <span class="chat-diff__text">…added words…</span>
     </span>
   </div>
   ```
5. Replaces the existing `chat-message__preview` `pre` element when the diff is non-empty (i.e., when the strings differ).

### A2 — Partial-merge algorithm

`computePartialPrompt(currentPrompt, hunks)`:

1. Start with an empty result string.
2. Iterate over the flat token array (preserving order).
3. For each token:
   - `context` → append `text` to result.
   - `added` with `accepted: true` → append `text` to result.
   - `removed` with `accepted: true` → append `text` to result (kept = not deleted).
   - `added` with `accepted: false` → skip.
   - `removed` with `accepted: false` → skip.
4. Return result.

**Round-trip property:** when every hunk's `accepted` matches its default state (added → true, removed → false, context → true), the result is byte-identical to `suggested_prompt`. Verified by a test that asserts `computePartialPrompt(currentPrompt, defaultHunks) === suggestedPrompt`.

**Identity property:** when all hunks are toggled to their non-default state (added → false, removed → true), the result is byte-identical to `currentPrompt`. Verified by a test.

### A3 — Hunk grouping + UX

A hunk spans one or more consecutive tokens. A context token surrounded by removed/added pairs stays as its own hunk (it cannot be toggled). The grouping algorithm:

```js
const hunks = [];
let current = [];
for (const token of tokens) {
  if (current.length === 0 || current[0].type === token.type) {
    current.push(token);
  } else {
    hunks.push(current);
    current = [token];
  }
}
if (current.length > 0) hunks.push(current);
```

Context hunks are not user-toggleable (they have no checkbox). Added hunks default to `accepted: true`. Removed hunks default to `accepted: false`. The "Apply all" affordance corresponds to "all added accepted, all removed rejected" — the default state.

The Apply button label cycles through three states based on `acceptedHunks`:

| Accepted hunks count | Button label | Action |
|---|---|---|
| All added accepted, all removed rejected (default) | "Apply all" | Apply full `suggested_prompt` (no body) |
| Some but not all in default state | "Apply selected" | Apply `partial_prompt` body |
| All added rejected OR all context-only | disabled, "Nothing to apply" | No-op |

### A4 — Server-side reuse

`POST /api/chat/sessions/:id/apply/:messageId` gains an optional `partial_prompt` field. When present:

1. Validate (non-empty string, ≤ `MAX_FINAL_PROMPT_LENGTH`).
2. Run `validatePromptPreservation(currentPrompt, partialPrompt, …)` instead of `(currentPrompt, suggestedPrompt, …)`.
3. On accept: set `current_prompt = partialPrompt`, clear `pending_prompt`, append an audit message `{ role: 'assistant', content: 'Working prompt edited via partial apply (N hunks).', audit: { kind: 'partial_apply', hunkCount } }`.
4. On decline: set `declined_suggested_prompt = partialPrompt` (not `suggestedPrompt`), persist `declined_missing_terms`, append a declined-audit message. The "Try as rewrite" affordance still works because it re-sends the user's original text framed as wholesale.

When `partial_prompt` is absent, behaviour is unchanged (full apply of `suggested_prompt`).

---

## §28 — Patch + annotate protocol (CR-A8 / SPEC §23 / ADR 0027)

### A1 — Envelope extension

The chat assistant message envelope grows from `{ reply, suggested_prompt }` to:

```ts
{
  reply: string,                      // existing — conversational text
  suggested_prompt: string | null,    // existing — full prompt candidate
  patches?: Array<{                   // NEW — typed mutators
    find: string,
    replace: string,
    all_occurrences?: boolean         // default false
  }>,
  annotations?: Array<{               // NEW — non-mutating flags
    field: string,
    note: string
  }>,
  applied_patches?: Array<PatchResult>,   // server-stamped on success
  no_op_patches?: Array<PatchResult>,     // server-stamped on no-op
  rejected_patches?: Array<PatchResult>   // server-stamped on rejection
}

type PatchResult = {
  patch: { find, replace, all_occurrences? },
  reason: 'find_not_found' | 'ambiguous_match' | 'oversized' | 'empty_replace',
  position?: number  // for successful patches, byte offset in the merged result
}
```

The envelope is additive. The `apiCall` client (CR-1) and the existing UI (`buildChatMessageNode`) read only `reply` and `suggested_prompt`; the new fields are ignored until the Slice III UI is shipped. Server-side parsing is permissive — absent `patches` or `annotations` keys mean "model did not emit any".

### A2 — Merge pipeline

```js
function applyPatches(currentPrompt, patches) {
  let working = currentPrompt;
  const applied = [];
  const noOp = [];
  const rejected = [];

  for (const patch of patches) {
    // 1. Validate shape
    if (typeof patch.find !== 'string' || typeof patch.replace !== 'string') {
      rejected.push({ patch, reason: 'oversized' });
      continue;
    }
    if (patch.find.length === 0) {
      rejected.push({ patch, reason: 'empty_replace' });
      continue;
    }
    if (patch.find.length > MAX_FIND_LENGTH || patch.replace.length > MAX_REPLACE_LENGTH) {
      rejected.push({ patch, reason: 'oversized' });
      continue;
    }

    // 2. Find occurrences
    const occurrences = countOccurrences(working, patch.find);
    const allOccurrences = patch.all_occurrences === true;

    if (occurrences === 0) {
      noOp.push({ patch, reason: 'find_not_found' });
      continue;
    }
    if (occurrences > 1 && !allOccurrences) {
      rejected.push({ patch, reason: 'ambiguous_match' });
      continue;
    }

    // 3. Apply
    const position = working.indexOf(patch.find);
    working = allOccurrences
      ? working.split(patch.find).join(patch.replace)
      : working.slice(0, position) + patch.replace + working.slice(position + patch.find.length);
    applied.push({ patch, position });
  }

  return { merged: working, applied, noOp, rejected };
}
```

Constants:
- `MAX_FIND_LENGTH = 500` — bound per-find scan time.
- `MAX_REPLACE_LENGTH = 5000` — matches `MAX_FINAL_PROMPT_LENGTH`.

The merged string is the validator candidate. `countOccurrences` is a single-pass O(n) scan; the entire pipeline is O(patches × prompt_length) which is bounded for sane patch counts (≤ 50 patches × 5000 chars = 250K ops worst case; in practice ≤ 5 patches × 1000 chars = 5K ops).

### A3 — System prompt paragraph

`DEFAULT_CHAT_SYSTEM_PROMPT` (server.js:6345) gains a new paragraph under "REFINEMENT RULES":

> **Localised edits.** When the artist's request maps to a specific token, phrase, or field of the working prompt, prefer `patches[]` over a full `suggested_prompt` rewrite. Patches are deterministic, auditable, and let the user accept or reject individual changes. Reserve `suggested_prompt` for genuine restructurings (reordering, tag-style conversion, scene relocation) where patches would be ambiguous. When you're uncertain which way to go, emit an `annotation[]` instead of guessing — annotations surface your hesitation to the artist without committing to a change. **Patch hygiene:** keep `find` strings short and unambiguous (≤ ~50 characters when possible), use `all_occurrences: true` only when every instance truly should change.

### A4 — UI affordances

`buildChatMessageNode` (src/app.js) gains two new sections, rendered before the SPEC §22 diff:

1. **Annotations panel.** Renders one `.chat-annotation-pill` per annotation. Each pill shows `field` in a bold monospace prefix and `note` as the body, with a small "Dismiss" × button. Dismiss is client-side only (toggles a `chat-annotation-pill--dismissed` class); the annotation stays on the message on disk.

2. **Patches panel.** Renders one `.chat-patch-chip` per patch. Each chip shows `find → replace` in a small diff (uses SPEC §22's `computeWordDiff` on the two strings), with an Accept/Reject checkbox. Default state: Accept (matches the SPEC §22 "Apply all" default). Toggling a chip updates a local `acceptedPatches` set; the SPEC §22 `reassembleFromHunks` infrastructure is reused to compute the merged preview in real time.

3. **Apply button** — identical to SPEC §22. Cycles through Apply all / Apply selected / Nothing to apply. When the user clicks Apply selected, the UI sends `{ partial_prompt: <merged>, accepted_hunk_count: <count>, patch_indices: <indices> }` in the body. The server merges `partial_prompt` against `current_prompt` exactly as today (no need to know which path produced the partial).

### A5 — Audit shape

Each assistant message gains three optional arrays (server-stamped):

```ts
applied_patches: [
  { patch: { find, replace, all_occurrences? }, position: number }
],
no_op_patches: [
  { patch: { find, replace, all_occurrences? }, reason: 'find_not_found' }
],
rejected_patches: [
  { patch: { find, replace, all_occurrences? }, reason: 'ambiguous_match' | 'oversized' | 'empty_replace' }
]
```

These arrays persist on the message on disk. The UI uses them to render "applied 2 of 3 patches; 1 was a no-op" status text. The audit message appended on Apply gains an extra field:

```ts
audit: {
  kind: 'patch_apply' | 'partial_apply' | 'apply',
  accepted_patch_count: number,
  total_patch_count: number,
  applied_patch_indices?: number[]   // for SPEC §22 partial-apply path
}
```

The audit trail is end-to-end inspectable from `data/chat_sessions.json` without re-running the merge logic.

---

## §29 — Streaming responses (CR-A9 / SPEC §24)

### A1 — Transport

Server-Sent Events over plain HTTP. The endpoint is `GET /api/chat/sessions/:id/messages/stream` with query parameters:

```
content:       string   (the user's message; required)
provider:      string   (default 'kilo_code')
llmModel:      string   (provider-specific)
attachment_ids: csv     (comma-separated; optional)
```

Response headers:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no   (disable nginx-style buffering if behind a proxy)
```

Each event is one `data: <json>\n\n` line. Three event types:

```
data: {"delta": "incremental text"}\n\n
data: {"done": true, "message_id": "msg_...", "session": {...}}\n\n
data: {"error": "error message"}\n\n
```

The client uses the `delta` events to append to a placeholder message; the `done` event carries the final session state; the `error` event indicates mid-stream failure.

### A2 — Server pipeline

The streaming endpoint mirrors the existing `POST /api/chat/sessions/:id/messages` route but pipes the model's response as it arrives. The pipeline:

1. Validate query params (mirror of `validateChatMessage` for `content`, `provider`, `llmModel`, `attachment_ids`).
2. Resolve session + provider/model.
3. Build the chat request context (RAG retrieval, history compaction, persona prompt assembly).
4. Append the user message to the session.
5. Call the upstream provider with `stream: true`. The provider returns a ReadableStream of chunks.
6. Pipe each chunk to the SSE response: parse the chunk, extract the `delta` field, write `data: {"delta": "..."}\n\n` to `res`.
7. On stream completion, extract the full `reply` + `suggested_prompt` + `patches` + `annotations` from the accumulated response.
8. Run the SPEC §23 patch merge + ADR 0012 anchor-preservation on the result.
9. Persist the full assistant message on the session.
10. Emit `data: {"done": true, "message_id": "...", "session": {...}}\n\n`.
11. Listen for `req.on('close')` to abort the upstream call if the client disconnects.

```js
app.get('/api/chat/sessions/:id/messages/stream', async (req, res) => {
  // 1-4: validate + resolve + context + append user message
  // ...
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  
  let aborted = false;
  req.on('close', () => { aborted = true; });
  
  try {
    const stream = callProviderStream(provider, llmModel, 'chat', {
      messages: [...],
      stream: true
    });
    
    let accumulatedReply = '';
    for await (const chunk of stream) {
      if (aborted) break;
      const delta = extractDelta(chunk);
      if (delta) {
        accumulatedReply += delta;
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }
    
    if (aborted) {
      // Persist partial reply + audit
      persistAssistantMessage(session, accumulatedReply, null, /* audit */ { kind: 'stream_aborted' });
      return;
    }
    
    // 6-9: parse + merge + validate + persist
    const parsedReply = extractChatReply(accumulatedReply);
    const patchResult = applyChatPatches(currentPrompt, parsedReply.patches);
    const finalSuggested = patchResult.merged || parsedReply.suggested_prompt;
    persistAssistantMessage(session, parsedReply.reply, finalSuggested, /* ... */);
    
    res.write(`data: ${JSON.stringify({ done: true, message_id: '...', session: session })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: sanitizeError(err.message) })}\n\n`);
    res.end();
  }
});
```

### A3 — Client pipeline

The client replaces `submitChatMessage` with a streaming flow:

```js
const submitChatMessageStreaming = async () => {
  if (!state.chatSessionId) return;
  const content = dom.chatInput.value.trim();
  if (!content) return;
  
  // Optimistically append a placeholder user message + an empty assistant message
  const userMessage = { id: 'temp_user', role: 'user', content, timestamp: new Date().toISOString() };
  const assistantPlaceholder = { id: 'temp_assistant', role: 'assistant', content: '', timestamp: new Date().toISOString() };
  renderChatMessages({ ...session, messages: [...session.messages, userMessage, assistantPlaceholder] });
  
  // Build the URL with query params
  const params = new URLSearchParams({
    content,
    provider: state.provider || 'kilo_code',
    llmModel: state.llmModel || '',
    attachment_ids: state.chatPendingAttachmentIds.join(',')
  });
  const url = `/api/chat/sessions/${state.chatSessionId}/messages/stream?${params}`;
  
  // Use fetch + ReadableStream (works in all modern browsers; EventSource is GET-only and doesn't support POST bodies — we use GET because the request fits in a query string)
  const controller = new AbortController();
  state.chatStreamAbortController = controller;
  
  // Show Stop button
  showStopButton();
  
  try {
    const res = await fetch(url, { signal: controller.signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop(); // incomplete event stays in buffer
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = JSON.parse(line.slice(6));
        if (payload.delta) {
          assistantPlaceholder.content += payload.delta;
          // Re-render the placeholder
          renderChatMessages({ ...session, messages: [...session.messages, userMessage, assistantPlaceholder] });
        } else if (payload.done) {
          // Replace placeholder with final message
          state.chatSessions[idx] = payload.session;
          renderChatMessages(payload.session);
        } else if (payload.error) {
          showChatError(payload.error);
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      // User clicked Stop
      assistantPlaceholder.audit = { kind: 'stream_aborted' };
    } else {
      showChatError(err.message);
    }
  } finally {
    hideStopButton();
    state.chatStreamAbortController = null;
  }
};
```

The Stop button:

```js
const stopStreaming = () => {
  if (state.chatStreamAbortController) {
    state.chatStreamAbortController.abort();
  }
};
```

### A4 — Error handling

Three failure modes:

1. **Connection drop mid-stream.** Server detects `req.on('close')`, aborts upstream call, persists partial reply with `audit: { kind: 'stream_aborted' }`. Client sees `AbortError`, doesn't show error toast (just stops rendering).
2. **Model error mid-stream.** Server catches the upstream error, emits `data: {"error": "..."}\n\n`, ends the stream. Client shows error toast + replaces the placeholder with the partial reply + an error indicator.
3. **Concurrent stream.** Server's session-level mutex rejects a second concurrent stream with 409. Client falls back to non-streaming `POST` and shows "another stream is already in progress" status.

The session-level mutex is a simple `Set<sessionId>` of active streams, cleared when the stream completes or errors.

## §30 — Notes folders + image attachments (UI-R9)

Companion to SPEC §25. The architecture reuses two existing patterns: (1) **JSON-file + atomic-write** for tiny state (mirrors `notes.json`, `presets.json`, `directives.json`), and (2) **multer-disk + `_manifest.json` lookup** for binary blobs (mirrors `data/chat_attachments/`).

### A1 — Module boundaries

Three new sub-modules live inside the existing `Notes (UI-R8)` section of `server.js`:

```
server.js
└── §Notes (UI-R8) ─────────────────────────────
    ├── (existing) CRUD on data/notes.json
    ├── (NEW) Folders      — data/notes_folders.json
    │     ├── readNoteFolders()
    │     ├── writeNoteFolders()
    │     ├── validateNoteFolderBody()
    │     └── 4 routes: GET / POST / PUT / DELETE
    │
    └── (NEW) Attachments  — data/note_attachments/
          ├── readAttachmentsManifest()
          ├── writeAttachmentsManifest()
          ├── noteAttachmentStorage (multer.diskStorage)
          ├── noteAttachmentUpload  (multer)
          ├── resolveNoteAttachment(id)
          ├── cascadeDeleteNoteAttachments(noteId)
          └── 4 routes:
                GET  /api/notes/:id/attachments
                POST /api/notes/:id/attachments
                GET  /api/note-attachments/:id/file
                DELETE /api/note-attachments/:id
```

The existing 5 note-CRUD routes gain 1 new field (`folder_id`) and 1 new endpoint (`PUT /api/notes/:id/move`). The schema change is purely additive — existing payloads continue to parse.

### A2 — Filesystem layout

```
data/
├── notes.json                   (existing, extended)
├── notes_folders.json           (NEW — list of { id, name, sort_order, created_at })
└── note_attachments/
    ├── _manifest.json           (NEW — list of { id, note_id, filename, stored_name, mime, size, created_at })
    ├── <note_id_1>/
    │   ├── <random>.jpg
    │   └── <random>.png
    ├── <note_id_2>/
    │   └── <random>.gif
    └── ...
```

The `data/note_attachments/<note_id>/` subdirectory mirrors `data/chat_attachments/<session_id>/`. Cascade-delete a note → `rm -rf data/note_attachments/<note_id>/` + prune manifest.

### A3 — Folder model

Flat list, ordered by `sort_order` (server-side managed; client sends the new sort_order on PUT). The "Unfiled" pseudo-folder is a **client-only construct**: notes with `folder_id === null` are surfaced under "Unfiled" in the sidebar, but no folder record exists for it. This keeps the server source-of-truth minimal (no special-casing "Unfiled" in folders.json).

Sidebar order:

1. **All notes** (always first; pseudo; non-deletable; sums across folders).
2. **Unfiled** (always second; pseudo; non-deletable; notes with folder_id=null).
3. User-created folders, ordered by `sort_order` asc, then `created_at` asc.

### A4 — Attachment upload pipeline

Mirrors `chatAttachmentUpload` (`server.js:830+`) but scoped per note:

```js
const NOTE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;       // 5 MB
const NOTE_ATTACHMENT_MAX_COUNT = 5;                     // per note
const NOTE_ATTACHMENT_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif']);

const noteAttachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const noteId = req.params.id;
    if (!noteId || !noteId.startsWith('note_')) {
      return cb(new Error('Invalid note id.'));
    }
    const dir = path.join(NOTE_ATTACHMENTS_DIR, noteId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || mimeToExt(file.mimetype);
    const storedName = `${crypto.randomBytes(12).toString('hex')}${ext}`;
    cb(null, storedName);
  }
});

const noteAttachmentUpload = multer({
  storage: noteAttachmentStorage,
  limits: { fileSize: NOTE_ATTACHMENT_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (NOTE_ATTACHMENT_ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: JPG, PNG, GIF.`));
  }
});
```

Pre-upload count check: server reads manifest, counts entries where `note_id === req.params.id`, rejects with 409 if `>= NOTE_ATTACHMENT_MAX_COUNT`.

Pre-upload note-existence check: server reads `notes.json`, returns 404 if the note doesn't exist (prevents orphaned attachment dirs).

Post-upload manifest append with a single entry. The file is already on disk before the manifest is written; if the manifest write fails, the file is unlinked (`fs.unlink`) — best-effort cleanup.

### A5 — Folder drag-and-drop

The sidebar's user-created folders list is wrapped in a `<ul>` with `sortablejs` (already in `package.json`). On reorder, the client:

1. Optimistically updates the in-memory folder list.
2. Sends `PUT /api/notes/folders/:id` with the new `sort_order` for each affected folder.
3. Re-fetches to reconcile on failure.

Dragging a **note onto a folder name** in the sidebar fires `PUT /api/notes/:id/move` with `folder_id: <that_folder.id>`. This is the same call used by the explicit "Move to…" menu, so there's exactly one server endpoint per move operation.

### A6 — Attachments UI lifecycle

State machine (per note, per attachment slot):

```
       [empty slot] ──pick file──► [uploading] ──201──► [rendered]
                            │
                            └──400/413/409──► [error toast] ──► [empty slot]
```

The attachments region holds an `aria-busy` flag that's `true` only while a request is in flight. After completion, the thumbnails re-render and `aria-busy` resets. No spinner animation — just a CSS class that dims the slot.

### A7 — Concurrent upload guard

Two tabs opening the same note and uploading simultaneously: the server enforces `NOTE_ATTACHMENT_MAX_COUNT` per request, so the worst case is one upload gets through and the other gets 409. Both client tabs re-fetch after their PUT resolves; the manifest is the source of truth.

### A8 — Why this is small

- **Reuses `multer.diskStorage`** — same pattern as `chatAttachmentStorage`.
- **Reuses `sortablejs`** — already a dep; used by the Library view.
- **Reuses atomic JSON write** — `writeNotes()` pattern extended to `writeNoteFolders()`.
- **Reuses manifest pattern** — same shape as `data/chat_attachments/_manifest.json`.
- **Reuses the Notes CRUD helper** — `readNotes()` extended with a `folder_id` filter and `findById()` returns the raw note.

The server.js delta is ~250 lines. The frontend delta is ~280 lines. Total new tests: 22. No new dependencies.


## §31 — Clear chat history (SPEC §27 / CR-A11)

Additive slice to `server.js` + Settings UI. No architectural shift; mirrors the per-session delete (server.js:9672) and the cascade-delete helper (server.js:9940).

### A1 — Endpoint shape

Two new routes on the existing Express app:

```
DELETE /api/chat/sessions            → 200 { data: { deleted_sessions, deleted_attachments, orphan_directories_removed } }
GET    /api/chat/sessions/count      → 200 { data: { sessions, attachments } }
```

Both follow the project's `{ success, data, error }` envelope (already in use everywhere). 405 for non-DELETE/non-GET. 500 on partial failure with `sanitizeError`.

The bulk DELETE writes `[]` atomically via `writeChatSessions([])` (server.js:7554 — the existing atomic rename helper). No new write helper needed.

### A2 — Sweep strategy (the orphan problem)

Live state at slice start: `data/chat_attachments/` contains 503 directories, but `data/chat_sessions.json` references only 7 attachment_ids. The 496-directory delta is orphans from prior partial deletes and crashes.

The bulk endpoint therefore uses a **directory-list sweep**, not a manifest walk:

```
1. readChatSessions()      → capture count
2. writeChatSessions([])    → atomic rewrite to empty
3. fs.readdirSync(CHAT_ATTACHMENTS_DIR)
   filter: name.startsWith(CHAT_SESSION_ID_PREFIX)
   for each: fs.rmSync(dir, { recursive: true, force: true })
4. writeChatAttachmentsManifest([])   → reset manifest
5. return counts
```

The manifest-reset is the "trust the directory list, not the manifest" move — the manifest is rebuilt lazily by future uploads, not by a reconciliation pass. This is the same pattern the existing `cascadeDeleteChatSessionAttachments` uses (best-effort, log + continue on per-entry failure), but lifted to the bulk level.

### A3 — Frontend seam (`app.js` ↔ `shell.js`)

`shell.js` already owns the Settings-view wiring. The new panel needs three things from `app.js`:

1. A live count of sessions + attachments — fetched lazily on button click via the new count endpoint (not preloaded on Settings-tab open, since Settings is opened frequently and the counts would be stale immediately).
2. A reset hook — exported as `window.app.onChatHistoryCleared = () => {…}` after the bulk DELETE resolves. The hook resets `state.chatSessions`, `state.chatSessionId`, `state.chatPendingAttachmentIds`, `state.chatPendingAttachmentMeta`, calls `resetChatConsole()` (existing, server.js:4672), and calls `renderChatSessionSelect()` (existing, server.js:5717).
3. The defensive `localStorage` sweep — runs inside `onChatHistoryCleared`, iterates `Object.keys(localStorage)` and removes keys matching `/^i2p\.(chat|session)\b/i`. Today this is a no-op (confirmed via grep on app.js:2027+); the sweep is included so a future client-cache addition doesn't accidentally persist data across a clear.

### A4 — Modal lifecycle

Reuses `bindModalTraps` (shell.js:333) — every `<div class="modal">` element is auto-trapped, Esc-to-dismiss, focus-return-on-close. The new modal just needs the correct class + ids for the dismiss buttons (`#clear-chat-history-cancel` matches the `[id$="-cancel"]` selector in the trap).

### A5 — Error UX

Failure paths:

| Failure | Server returns | Client behavior |
|---|---|---|
| Partial attachment sweep failure (one `fs.rmSync` throws) | 500 `{ error: "Chat sessions cleared, but N attachment directories could not be removed. …" }` | Settings panel shows the error inline via `#settings-status`. The chat file IS still `[]` (the session write succeeds first). The user can retry; the bulk endpoint is idempotent. |
| Network failure | `fetch` throws | Inline error: "Could not clear chat history. Try again." |
| Server returns 200 but client state reset fails | n/a (defensive `try/catch` around `onChatHistoryCleared`) | Logs `console.error`, still reloads the chat view to its empty state via `renderChatSessionSelect()`. The server is the source of truth; a reload would fix any client drift. |

### A6 — Why this is small

- **Reuses `cascadeDeleteChatSessionAttachments`** — same per-session pattern, lifted to a loop.
- **Reuses `writeChatSessions`** — the atomic-rename helper (server.js:7554).
- **Reuses `bindModalTraps`** — the global modal focus trap (shell.js:333).
- **Reuses `resetChatConsole`** + `renderChatSessionSelect` — existing chat reset helpers.
- **Reuses `#settings-status`** — the existing Settings error/success inline status line.

Total server.js delta: ~80 LOC. Total frontend delta: ~100 LOC (HTML 25, CSS 5, shell.js 30, app.js 40). Total tests: ≥12.

### A7 — Privacy / data-handling notes

- No chat content leaves the user's machine. The bulk DELETE is purely local.
- No telemetry / no audit log for clears. The action is reversible only by the user restoring from a manual backup of `data/chat_sessions.json` (the file is gitignored, so backups are the user's responsibility).
- `data/preservation_override_log.json` (SPEC §26 telemetry) is intentionally NOT cleared — it's aggregate usage analytics, not user-visible chat content. This is documented in SPEC §27 "Out of scope".
- The Settings panel surfaces the bulk action but does NOT auto-prompt the user on first visit, on every Nth session, or via any other nudge. Discovery is via Settings → Chat data → button, matching the platform convention.
