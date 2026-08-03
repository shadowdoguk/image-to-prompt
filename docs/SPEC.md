# SPEC.md — image-to-prompt

**Status:** Draft → In Review → Approved (pending Gate G2)
**Created:** 2026-07-29 (Slice 1 — texture AI button)
**Last updated:** 2026-07-29

---

## 1. The Idea (one paragraph)

Slice 1 of the App Build methodology: add a "Populate with AI" button beneath the `texture` field in the analysis editor, mirroring the established pattern from ADR 0018 (actions/mood/lighting) and ADR 0004/0008 (subject/camera_angle). On click, uploads the current image to a new `POST /api/texture` endpoint that delegates a focused MiniMax M3 vision call to texture alone, then updates the field in place. No new schema changes; no new dependencies; no chat/prompt-contract touch. Pattern is proven, execution is the slice.

## 2. The Reframe

I heard this as: "the smallest possible vertical slice that exercises the methodology end-to-end on a real user-visible feature, using an established project pattern." Is that right? *(Yes — confirmed by user at the Phase C selection point.)*

## 3. The Challenge (Goose argues against)

1. **Single-field API proliferation.** The project already has 5 per-field vision endpoints (subject, camera_angle, actions, mood, lighting). Adding `/api/texture` makes 6 — one per field. Each new endpoint is server.js growth that pushes us toward the 287KB monolith risk identified in `docs/SYNTHESIS.md` §9. **Mitigation:** this slice adds ~80 lines to server.js, well within the 287K room. Future slice could refactor per-field routes into a module (`server/routes/per-field.js`).
2. **API cost on click.** Each click costs one MiniMax M3 vision call. Users spamming the button burn credits. **Mitigation:** the existing in-flight guard pattern (`isPopulatingX`) prevents double-clicks. ADR 0018 explicitly accepted this risk; we inherit the decision.
3. **Texture's semantic ambiguity.** Unlike `mood`/`lighting`/`camera_angle` which have canonical vocabularies, `texture` ranges from canvas weave to skin pores to impasto thickness to fabric weave. The LLM may over-fit to one register. **Mitigation:** the system prompt will name several registers explicitly (surface, mark-making, material), and `minLength: 60` enforces rich response. The user can edit after — same escape hatch as other fields.

## 4. Scope

### 4.1 In scope (Slice 1 ships these)

- New `POST /api/texture` endpoint (single-attempt, multer `image` upload, MiniMax M3 vision call).
- New `DEFAULT_TEXTURE_PROMPT` system prompt + new `callMiniMaxTextureAnalysis` helper.
- New "Populate with AI" button beneath the `texture` field in `renderAnalysisEditor`.
- Frontend state flag `isPopulatingTexture` + handler `populateTextureWithAI`.
- Tests in `tests/run-all.js` mirroring the per-field pattern.
- Optional: smoke script `scripts/smoke/texture-ai-button-smoke.js`.
- Documentation: update `CONTEXT.md` field-palette note + `README.md` endpoint list.

### 4.2 Out of scope (explicitly not doing)

- **No chip presets for texture.** Texture is image-specific (impasto, canvas weave, skin pores, fabric weave); a curated chip set would feel arbitrary. AI re-analysis only — same reasoning as ADR 0018 §1 for `actions`.
- **No preset override or per-user prompt editor.** The prompt ships as a code constant. Mirrors ADR 0008.
- **No retry-with-strengthened-prompt loop.** Mirrors ADR 0018.
- **No new dependencies, no schema changes, no migration.** Same shape as ADR 0018's additions.
- **No refactor of `server.js`.** Save the split for a slice that *needs* to touch ≥3 feature groups.

### 4.3 The ONE thing

**Clicking "Populate with AI" beneath the texture field returns a 30+ word focused texture description within ~10 seconds.**

This is the success criterion for Slice 1.

## 5. Users

**Primary user:** the AI artist who's mid-iteration in Step 3. They've run Stage 1, gotten a generic "smooth surface" texture description, want richer texture analysis without re-running all 14 fields. They click the button, get a focused re-analysis, edit if needed.

A day in their life: "Stage 1 gave me 'oil painting texture, smooth'. I want impasto and canvas weave detail. Click. Now I have 60+ words on mark-making, surface, and pigment. Edit. Done."

## 6. Constraints

| Constraint | Value | Reason |
|---|---|---|
| Stack | Node + Express + vanilla-JS frontend (unchanged) | mirrors ADR 0018 |
| Hosting | localhost:3100 (development) | running live; no deploy |
| Timeline | 1 session (Slice 1) | mirror the existing pattern, no design decisions |
| Data sensitivity | none — no PII touched | one image upload, no persistence beyond uploads/ cleanup |
| Browser support | modern evergreen | mirrors existing tests |
| API cost | 1 MiniMax vision call per click (mirrors ADR 0018) | explicit per-click credit, opt-in |

## 7. User Stories

1. As a user, I want to click "Populate with AI" beneath the texture field, so I get a richer texture description without re-running all 14 fields.
2. As a user with no image uploaded, I want clicking the button to surface a clear error without firing a network request.
3. As a user mid-iteration, I want the texture field to update in place (not a full re-render) so my edits to other fields are preserved.
4. As a developer, I want the per-field test pattern from ADR 0018 to extend cleanly to texture, so the test suite stays consistent.
5. As a developer, I want the smoke script convention to extend to texture, so smoke tests stay per-feature.

## 8. Implementation Decisions

### Modules (codebase-design vocabulary per `docs/PRINCIPLES.md` §6.1)

- **`/api/texture`** (module) — interface: `POST /api/texture (multipart image) → { success, data: { texture, model } }`. Seam: `server.js` route handler. Depth target: **deep** — same depth as `/api/actions` etc. (multer file cleanup + LLM call + response envelope + 503/500 handling all hidden behind one POST).
- **`callMiniMaxTextureAnalysis`** (helper) — interface: `(imageDataUri: string) → Promise<string>`. Seam: `server.js` module export. Depth target: **deep** — single-attempt + schema builder + length guard all hidden behind one call.
- **`populateTextureWithAI`** (frontend handler) — interface: button-click handler. Seam: `src/app.js`. Mirrors `populateActionsWithAI` etc.

### Decisions

- **Mirror ADR 0018 §1 verbatim.** Single endpoint, single helper, single prompt, single frontend handler, single state flag.
- **Endpoint path:** `POST /api/texture` (matches the field name pattern).
- **Response envelope:** `{ success, data: { texture, model } }` (mirrors `/api/actions`).
- **Length floor:** `minLength: 60` on the JSON Schema (mirrors `actions`/`mood` — `texture` is a textarea field, same length contract).
- **System prompt categories** (mirroring ADR 0018 §2a–§2c shape, adapted to texture):
  1. **Surface quality** — smooth, rough, pitted, polished, matte, glossy.
  2. **Mark-making / tool traces** — visible brushstrokes, palette-knife slabs, pen hatching, photographic grain, digital artifacts.
  3. **Material identification** — paint (oil / acrylic / watercolor / gouache), paper, canvas, photographic emulsion, 3D render, mixed media.
  4. **Pigment interaction** — impasto ridges, glazing, scumbling, wet-in-wet bleeds, drybrush, washes.
  5. **Tactile cues** — what the surface feels like to touch (chunky, slick, fibrous, velvety, sticky).
- **Forbidden vocabulary** (per ADR 0018 §2 conventions): "beautiful", "striking", "vibrant", "dramatic", "elegant", "majestic", "imposing", "ethereal", "luminous", "bold". Plus meta-references to "the painting", "the photograph", "the image".
- **No category spillover** — forbid referencing subject, style, mood, composition by name (mirror ADR 0018's no-spillover rule).
- **In-place DOM update** — `state.currentAnalysis.texture` + the field's textarea value, no full re-render.
- **Client-side "no image" guard** — mirror `populateSubjectWithAI`.

## 9. Definition of Done (vertical slices with blocking edges)

### Slice 1: `texture` Populate-with-AI button

- **Behavior:** click "Populate with AI" beneath texture field with an image uploaded → field updates with 30+ word texture description within ~10s
- **Acceptance test:** `POST /api/texture` with a test image → `{ success: true, data: { texture: "≥30-word string", model: "MiniMax-Text-01" } }` (or 503 if no API key); manual demo: click button, see field update
- **DoD:**
  - [ ] `node tests/run-all.js` — all existing + new tests pass
  - [ ] `node scripts/session-init.js` — 10/10 V-checks
  - [ ] `node --check server.js && node --check src/app.js` — exit 0
  - [ ] `npm test` smoke run — all green
  - [ ] Manual demo: click button with a real image, see field update; click with no image, see error toast
  - [ ] `docs/CODE-REVIEW-1-texture-ai-button.md` verdict: `pass` or `pass+minor`
- **Blocked by:** none — can start immediately
- **min / target / stretch:**
  - **min** = endpoint + handler + button + happy path + no-image guard
  - **target** = + tests + smoke script + CONTEXT.md + README.md update
  - **stretch** = + curated chip taxonomy for texture (ADR 0018 §4d question, deferred — texture's vocabulary is too image-specific per ADR 0018 §1)
- **Maps to user story:** #1, #2, #3, #4, #5

### Stretch (not in MVP)

- Curated chip presets for texture (deferred; ADR 0018 §4d reasoning)
- Per-field route module split (`server/routes/per-field.js` — wide refactor, separate slice)

## 10. Testing Decisions

### What makes a good test (this project)

Tests verify behaviour through **public interfaces** (the HTTP route + the exported helper + the rendered UI button). No test queries the DB or reaches into the module under test. Mirrors the per-field pattern from ADR 0018's "Files changed" table.

### Modules tested at named seams

- **`/api/texture`** at `server.js` route — test: endpoint registered, multer middleware used, helper called, response envelope correct, 503 when no API key, 400 when no file.
- **`callMiniMaxTextureAnalysis`** at `server.js` export — test: helper exported, default prompt exported, prompt excludes forbidden vocabulary, prompt mandates category list, no retry loop.
- **`populateTextureWithAI`** at `src/app.js` — test: handler defined, button rendered with no-image guard, in-flight state flag, in-place DOM update on success.

### Prior art in the codebase

ADR 0004 (subject), ADR 0008 (camera_angle), ADR 0018 (actions/mood/lighting). All three established the same per-field pattern. Slice 1 extends it.

### Forbidden in tests (anti-patterns A9, A10, A11)

- **A9:** No mocking of internal collaborators inside the module under test. Use the existing test infrastructure.
- **A10:** No assertions like `expect(texture.length).toBe(callTexture(...).length)`. Expected values from worked examples.
- **A11:** No writing all tests first then implementation. Vertical slices.

## 11. Kill Criteria

Set fresh for this project under the methodology:

- **Slice 1 takes >2 sessions** → kill the slice (the pattern is well-established; >2 sessions means we're drifting, not slicing).
- **`server.js` exceeds 290KB** as a result of this slice → kill and refactor (back to expand-contract on `server.js` split first).
- **The MiniMax vision call returns garbage on every test image** → kill the slice; texture isn't a good fit for the per-field pattern (the prompt doesn't elicit useful output).

## 12. Open Questions

- None. Slice 1 mirrors an established pattern; no design decisions to defer.

## 13. Glossary point-in-time

These terms either already exist in `CONTEXT.md` or are sharpened by this slice:

- **`texture` field** — one of the 14 prompt fields; `textarea` input; minimum 30 words. ADR 0018 lists this as one of the "image-specific" fields that doesn't get curated chips. *Source: this spec §8; mirrors `/api/health` field palette.*
- **`Populate with AI`** — UI affordance beneath a field that triggers a focused MiniMax M3 re-analysis for that field alone. *Source: ADR 0004 / 0008 / 0018.*
- **Per-field vision endpoint** — `POST /api/<field>` that delegates to `callMiniMax<Field>Analysis(imageDataUri)`. *Source: ADR 0004 / 0008 / 0018; Slice 1 adds the 6th instance.*

---

## 14. Slice 2 — Anima contract (the fork)

**Status:** Draft (awaiting Gate G2 user approval)
**Date:** 2026-08-03
**Origin:** User request — "have a fork … specify a selection of variables, then generate … choose either model. Z-Image Turbo or Anima."
**Context:** The current app emits a single Z-Image Turbo prompt (ADR 0019 pastel-focal-glow contract). The user wants the same upload + chat flow to also target **Anima** (CircleStone Labs, 2 B-parameter Cosmos-based anime/illustration model — see `docs/ANIMA-PROMPTING-MANUAL.md` for full reference). The user has **explicitly chosen a pre-Generate model picker** (dropdown or button group before Generate) over a dual-output design. The two contracts are **exclusive siblings**: one model is selected per generation, the prompt panel and chat console both operate on that model's logic.

### 14.1 The Idea (one paragraph)

Add a **model selector** to the upload screen, sitting before Generate. The user picks `Z-Image Turbo` (default — current behaviour) or `Anima`. Click Generate, and the app routes the same image through the chosen contract. The result panel knows which contract it just rendered and shapes the UI accordingly: Z-Image → single pastel-focal-glow prompt; Anima → positive prompt + negative prompt + variant selector (Base / Aesthetic / Turbo). The chat console refines the selected model's prompt. The selector is persisted app state (last-used wins), recorded in chat sessions, exported with the prompt, available in the URL. The fork is at the **dispatch layer** — same upload, same Stage-1 field analysis, same chat-revision infrastructure, but two different `DEFAULT_*_PROMPT` contracts and two different prompt-assembly paths downstream.

### 14.2 The Reframe

I heard this as: "keep the existing Z-Image pipeline intact and add a sibling pipeline that runs only when the user picks Anima. The picker is upstream of Generate, not a post-hoc toggle." Confirm or amend? *(Yes — confirmed by user at G1.)*

### 14.3 The Challenge (Goose argues against)

1. **Two contracts to keep coherent.** Every bug fix, every preset, every chat refinement template needs to be either model-agnostic or duplicated. The fallout from past contract drift (ADR 0019 — gestural → pastel-focal-glow) is recent and well-documented. **Mitigation:** the per-field artifacts (`subject`, `actions`, `mood`, `lighting`, `texture`, etc.) remain shared between both pipelines. Only the **final-prompt assembly** is model-specific. ADR 0021 (forthcoming, G3) will codify this.
2. **Frontend state proliferation.** `state.model` joins a long list of model-side state flags. The risk is hidden coupling — "what happens when the user switches model mid-chat?" **Mitigation:** explicit per-model chat behaviour (see §14.7 Open Questions Q3). The state is first-class and introspectable.
3. **Anima license boundary.** The CircleStone Labs Non-Commercial License v1.2 restricts hosting the model behind a paid API, but does **not** restrict us from generating prompts for Anima via a third-party LLM (the API call is to MiniMax M3, not to Anima weights). Prompt-engineering for Anima is not a Derivative Model per §1.a of the LICENSE. We are not embedding weights or hosting inference. **Mitigation:** SPEC §14.10 documents the boundary in plain English. Outputs from Anima are reusable commercially; the model itself is not.
4. **Server.js monolith growth.** Adding `DEFAULT_ANIMA_PROMPT` + `callMiniMaxAnimaAnalysis` + `/api/anima` is ~80–120 lines. **Mitigation:** the pattern is established (ADR 0018 per-field); the slice is well-bounded. Post-Slice-2, the `server/routes/` split can become its own slice.
5. **The Anima contract is more condition-heavy than Z-Image.** Pure-tag, pure-prose, hybrid shapes (§7 of the manual) depend on the image's subject. The LLM prompt must condition on image content. **Mitigation:** the system prompt itself instructs the LLM to choose shape based on subject (mirror principle from ADR 0019 §2). One server endpoint, three possible outputs.

### 14.4 Scope

#### 14.4.1 In scope (Slice 2 ships these)

- **`state.model`** in app state — string enum, defaults to `'zimage_turbo'`. Persisted in `localStorage`, recorded in chat sessions, exported with the prompt, mirrored in the URL.
- **Model selector UI** — dropdown or button group, placed near the Generate button. Switching it re-shapes the result panel and chat console.
- **`DEFAULT_ANIMA_PROMPT`** — the system prompt the LLM sees. Mirrors the structure of `DEFAULT_ZIMAGE_*` (when one exists) or the `actions`/`mood`/`lighting` pattern (ADR 0018).
- **`callMiniMaxAnimaAnalysis`** — the LLM helper. Returns a `{ positive, negative }` shape (the Anima contract is two-output; the Z-Image contract is single-output).
- **`POST /api/anima`** — sibling route to `POST /api/zimage`. The frontend dispatches to one or the other based on `state.model`.
- **Anima variant selector** — Base / Aesthetic / Turbo. Defaults to Base (per the manual §2 — "LoRAs should be trained using this version"). Lives in the result panel, not in the model selector (different abstraction levels).
- **Result panel shapes per contract** — Z-Image: single prompt. Anima: positive textarea + negative textarea + variant selector.
- **Chat console dispatch** — chat history records `model` per message; the chat default-system-prompt is `state.model`-aware; chat revisions target the right prompt.
- **Tests in `tests/run-all.js`** — `/api/anima` route registered, helper exported, default prompt excludes forbidden vocabulary, no-retry loop, response envelope correct, 503 on missing API key, 400 on missing file.
- **Smoke script** — `scripts/smoke/anima-fork-smoke.js` (optional, target-level).
- **Documentation** — `docs/ANIMA-PROMPTING-MANUAL.md` (already written), `docs/SPEC.md` (this section), `docs/ARCHITECTURE.md` (forthcoming, G3), `docs/adr/0021-anima-fork.md` (forthcoming, G3), `docs/SESSION-STATE.md` (post-slice), `docs/CODE-REVIEW-2-anima-fork.md` (post-slice).
- **Prompt length enforcement** — same shape as the Z-Image side (ADR 0019 / 0020). Positive prompt varies in length, never blind-truncated. Negative prompt is a flat list of vocabulary.

#### 14.4.2 Out of scope (explicitly not doing)

- **No LoRA training pipeline.** The user is generating prompts, not training models. The README's LoRA advice lives in the manual only.
- **No Anima online-platform integration.** The slice emits prompts the user can copy/paste into ComfyUI / Civitai / TensorArt. We are not hosting an Anima inference endpoint.
- **No automatic non-anime auto-prepend.** The `ye-pop` / `deviantart` dataset tags (manual §7.5) are emitted by the LLM contract itself, gated on the LLM's interpretation of the image. The user can edit the result. (This is the answer to Open Question Q2.)
- **No two-level model selector.** The model selector is one dropdown (Z-Image Turbo / Anima). The variant selector is a separate control nested in the Anima result panel. (This is the answer to Open Question Q1.)
- **No cross-model chat history.** Chat history is **per-model** (this is the answer to Open Question Q3, option **a**). Switching model mid-session ends the current session and starts a new one. (See §14.7 for the rationale.)
- **No server.js split.** The pattern is well-established; the slice is well-bounded. Defer the routes split to a future slice.
- **No new dependencies, no schema changes, no migration.**
- **No rewriting the Z-Image side.** Sibling, not replacement.

#### 14.4.3 The ONE thing

**Clicking Generate with the model selector set to Anima returns a positive prompt + a negative prompt that satisfy the Anima contract (lowercase tags, spaces, `@`-prefixed artist tags, recommended positive prefix, recommended negative vocabulary, score_* handling per variant) within ~10 seconds.**

This is the success criterion for Slice 2.

### 14.5 Users

**Primary user:** the AI artist who works across multiple model checkpoints. They might be in Z-Image mode for one project and Anima mode for another, depending on the visual style. They want a single upload flow that targets whichever model they're working with tonight.

A day in their life: "Last week I was iterating on a pastel-focal-glow oil painting in Z-Image. Tonight I want to try Anima for an anime-style character study. I upload the same reference image, pick Anima from the dropdown, click Generate. I get a positive + negative prompt pair in the Danbooru-tag form. I edit a few tags, drop the prompt into ComfyUI with `anima-base-v1.0.safetensors`, generate. Next week I'm back in Z-Image — the dropdown remembers."

### 14.6 Constraints

| Constraint | Value | Reason |
|---|---|---|
| Stack | Node + Express + vanilla-JS frontend (unchanged) | mirrors the existing app |
| Hosting | localhost:3100 (development) | running live; no deploy |
| Timeline | 1 session (Slice 2) | reuses the established pattern; design is locked at G1 |
| Data sensitivity | none — no PII touched | one image upload, no persistence beyond uploads/ cleanup |
| Browser support | modern evergreen | mirrors existing tests |
| API cost | 1 MiniMax M3 vision call per Generate (mirrors the existing flow) | explicit per-click credit, opt-in |
| License boundary | CircleStone Labs Non-Commercial License v1.2 (Anima); we are generating prompts, not distributing weights | manual §16 |
| Model selector persistence | `localStorage` | low-risk, no backend needed |
| Model selector URL mirror | `?model=anima` or `?model=zimage_turbo` | shareability |

### 14.7 User Stories

1. As a user, I want a model selector before the Generate button, so I can choose Z-Image Turbo or Anima before submitting.
2. As a user, I want the model selector to remember my last choice, so I don't re-pick every time.
3. As a user in Anima mode, I want the result panel to show a positive prompt + a negative prompt + a variant selector (Base / Aesthetic / Turbo), so I can copy the correct pair into ComfyUI.
4. As a user in Anima mode, I want the chat console to refine the Anima prompt (not the Z-Image one), so my refinements land where I expect them.
5. As a user switching model mid-session, I want the chat history to end cleanly and a new session to begin, so I don't mix two contracts' revisions.
6. As a developer, I want the per-field + per-prompt pattern from ADR 0018 / 0019 to extend cleanly to Anima, so the test suite stays consistent.
7. As a developer, I want the dispatcher to be a single dispatch path, not parallel dual endpoints, so the code stays small.
8. As a developer, I want a smoke script for the Anima path, so smoke tests stay per-feature.

### 14.8 Implementation Decisions

#### Modules (codebase-design vocabulary per `docs/PRINCIPLES.md` §6.1)

- **`state.model`** (frontend state) — interface: `'zimage_turbo' | 'anima'`. Seam: `src/app.js` state object. Depth: **shallow** — a single string, persisted in localStorage, mirrored in URL.
- **Model selector UI** (frontend component) — interface: a dropdown or button group near the Generate button. Seam: `src/app.js` render. Depth: **shallow** — pure state binding.
- **Result panel per contract** (frontend component) — interface: receives a `model` prop, renders the right UI. Seam: `src/app.js` render. Depth target: **deep** — shape, behaviour, and chat-anchor all hidden behind one component.
- **`/api/anima`** (server module) — interface: `POST /api/anima (multipart image) → { success, data: { positive, negative, variant, model } }`. Seam: `server.js` route handler. Depth target: **deep** — same depth as the existing final-prompt route (multer + LLM call + response envelope + 503/500 handling).
- **`callMiniMaxAnimaAnalysis`** (server helper) — interface: `(imageDataUri: string) → Promise<{ positive, negative }>`. Seam: `server.js` module export. Depth target: **deep** — single-attempt + schema builder + length guard all hidden behind one call.
- **`DEFAULT_ANIMA_PROMPT`** (server constant) — interface: string. Seam: `server.js` module export. Mirrors existing `DEFAULT_*_PROMPT` exports.
- **Chat dispatch** (frontend handler) — interface: chat-session anchor is per-model. Seam: `src/app.js`. Depth: **shallow** — state flag + dispatch.

#### Decisions

- **Mirror ADR 0018 verbatim** for the per-field pattern. One endpoint, one helper, one prompt, one frontend handler, one state flag.
- **Endpoint path:** `POST /api/anima` (matches the model name).
- **Response envelope:** `{ success, data: { positive, negative, variant, model } }`. The Anima contract is two-output; the Z-Image contract remains single-output.
- **Variant selector default:** `Base` (per the manual §2 — "LoRAs should be trained using this version").
- **`state.model` default:** `'zimage_turbo'`. Existing users see no change.
- **State persistence:** `localStorage` (`image-to-prompt.state.model`). Survives reloads.
- **URL mirror:** `?model=anima` or `?model=zimage_turbo`. On app boot, read URL first, then localStorage, then default.
- **Chat session model-tag:** each chat session message has a `model` field. Switching model starts a new session. (See §14.7 Q3 rationale.)
- **System prompt categories** (mirroring the existing per-field pattern, adapted to Anima):
  1. **Output shape** — produce both a positive prompt (the artist's intent) and a negative prompt (what to avoid). Both follow the Anima contract.
  2. **Positive prompt rules** — lowercase tags, spaces (not underscores), score_* keeps underscores, `@`-prefix for artist tags, recommended positive prefix, tag-order convention.
  3. **Negative prompt rules** — recommended negative vocabulary; `score_1, score_2, score_3` on Base/Turbo, dropped on Aesthetic.
  4. **Variant rules** — Base: full prefix; Aesthetic: drop `score_*`; Turbo: keep prefix (the variant affects CFG/steps, not prompt vocabulary).
  5. **Non-anime routing** — if the image is non-anime, prepend `ye-pop` or `deviantart` on line 1.
  6. **Multi-character** — name + describe each character.
- **Forbidden vocabulary** (per the manual §5 R9–R10): asking for photorealism, asking for long-form text rendering.
- **Length floor:** `positive: minLength: 60` (the manual's full-character example is ~50 tags; 60 tokens minimum). `negative: minLength: 20` (the recommended negative is ~10 items; 20 tokens minimum).
- **In-place DOM update** — `state.currentPrompt.anima = { positive, negative, variant }` + the textareas' values. No full re-render of the upload form.
- **No-image guard** — same shape as the existing flow (`showError('No image uploaded. Upload an image first.')`).

#### Per-contract prompt rules (the Anima contract)

These are the rules the LLM must follow when emitting the positive / negative pair. They mirror the manual's §5 and §7.

**Positive prompt (Anima):**
- Lowercase tags, comma-separated.
- Tag order: `[quality/meta/year/safety] [count] [character] [series] [artist] [general]`.
- Artist tags prefixed with `@`.
- On Base / Turbo: lead with `masterpiece, best quality, score_7, safe,`.
- On Aesthetic: lead with `masterpiece, best quality,` (no `score_*`).
- For non-anime images: start with `ye-pop` or `deviantart` on line 1, then alt-text or title on line 2, then prompt on line 3+.
- Multi-character: each character gets a cluster of name + hair + eyes + outfit.

**Negative prompt (Anima):**
- Recommended negative on Base / Turbo: `worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration`.
- On Aesthetic: drop `score_1, score_2, score_3`. Keep `worst quality, low quality, artist name, blurry, jpeg artifacts, chromatic aberration`.

### 14.9 Definition of Done (vertical slices with blocking edges)

The methodology requires a single vertical slice per DoD. Slice 2 is composed of **four sub-slices** that ship together (the dispatch is meaningless without the contract; the contract is meaningless without the selector). Each sub-slice has its own DoD.

#### Slice 2.1 — model-state + UI selector

- **Behaviour:** user sees a model selector near the Generate button. Default is `zimage_turbo`. Switching it changes the result panel placeholder ("Upload an image, then click Generate" → which contract content is shown). Persists across reloads. URL mirrors.
- **Acceptance test:** `state.model === 'anima'` after picking Anima, persists across reload, mirrored in URL.
- **DoD:**
  - [ ] `node tests/run-all.js` — all existing tests pass
  - [ ] `node scripts/session-init.js` — 10/10 V-checks
  - [ ] `node --check server.js && node --check src/app.js` — exit 0
  - [ ] Manual demo: pick Anima, reload, picker still says Anima; URL has `?model=anima`
  - [ ] `docs/CODE-REVIEW-2-anima-fork.md` (or per-sub-slice code review) verdict: `pass` or `pass+minor`

#### Slice 2.2 — Anima backend contract

- **Behaviour:** `POST /api/anima` exists and returns a `{ positive, negative, variant }` envelope. Inputs: `multipart image` + optional `variant` (`base` / `aesthetic` / `turbo`). Output: Anima-formatted positive + negative prompts, variant-aware.
- **Acceptance test:** `POST /api/anima` with a test image → `{ success: true, data: { positive, negative, variant, model } }` (or 503 if no API key); 400 on missing file; manual demo: hit the endpoint, see the envelope.
- **DoD:**
  - [ ] `node tests/run-all.js` — all existing + new tests pass
  - [ ] `node scripts/session-init.js` — 10/10 V-checks
  - [ ] `node --check server.js && node --check src/app.js` — exit 0
  - [ ] Manual demo: upload an image, hit `/api/anima`, see well-formed Anima positive + negative
  - [ ] `docs/CODE-REVIEW-2-anima-fork.md` verdict: `pass` or `pass+minor`

#### Slice 2.3 — frontend dispatch wiring

- **Behaviour:** clicking Generate calls `/api/anima` when `state.model === 'anima'`, `/api/zimage` (or equivalent) when `state.model === 'zimage_turbo'`. Result panel renders the right shape per contract. Variant selector appears in the Anima result panel.
- **Acceptance test:** pick Anima, upload, click Generate → Anima positive + negative panels appear. Pick Z-Image Turbo, upload, click Generate → Z-Image prompt panel appears.
- **DoD:**
  - [ ] `node tests/run-all.js` — all existing + new tests pass
  - [ ] `node scripts/session-init.js` — 10/10 V-checks
  - [ ] `node --check server.js && node --check src/app.js` — exit 0
  - [ ] Manual demo: pick Anima, generate, see positive + negative; pick Z-Image Turbo, generate, see single prompt
  - [ ] `docs/CODE-REVIEW-2-anima-fork.md` verdict: `pass` or `pass+minor`

#### Slice 2.4 — chat refines the selected model

- **Behaviour:** chat console refines the prompt that was just generated. Switching model ends the current session and starts a new one. Chat history is per-model.
- **Acceptance test:** generate Anima, refine via chat, the Anima prompt updates. Switch to Z-Image, generate, refine via chat, the Z-Image prompt updates. Switch back to Anima — a new chat session has begun.
- **DoD:**
  - [ ] `node tests/run-all.js` — all existing + new tests pass
  - [ ] `node scripts/session-init.js` — 10/10 V-checks
  - [ ] `node --check server.js && node --check src/app.js` — exit 0
  - [ ] Manual demo: the cross-model behaviour above
  - [ ] `docs/CODE-REVIEW-2-anima-fork.md` verdict: `pass` or `pass+minor`

#### Slice 2.5 — pre-mortem + ADR 0021 + final code review

- **Behaviour:** ADR 0021 documents the fork decision. Pre-mortem entry lists the risks. Final code review aggregates the per-sub-slice reviews.
- **DoD:**
  - [ ] `docs/adr/0021-anima-fork.md` exists with status `Accepted`
  - [ ] `docs/PRE-MORTEM.md` has a new entry dated 2026-08-03
  - [ ] `docs/CODE-REVIEW-2-anima-fork.md` verdict: `pass` or `pass+minor`
  - [ ] `docs/SESSION-STATE.md` updated (post-slice)

**Blocked by:** all four sub-slices are sequential — 2.1 → 2.2 → 2.3 → 2.4 → 2.5. Each requires the previous.

### 14.10 License / commercial use

Per `docs/ANIMA-PROMPTING-MANUAL.md` §16:
- **Anima model weights** are licensed under the CircleStone Labs Non-Commercial License v1.2 + the NVIDIA Open Model License (as a Derivative Model of Cosmos-Predict2-2B).
- **Anima outputs** (generated images) are reusable commercially — the non-commercial restriction applies to the Model, not to Outputs.
- **Prompt-engineering for Anima** (this app) is not a Derivative Model per §1.a of the LICENSE. We are generating prompts via a third-party LLM (MiniMax M3), not embedding weights, not hosting inference, not finetuning.
- **The user's prompts** (the strings emitted by this app) are not subject to Anima's license — they are the user's own creative work.
- **The risk** is in the user *using* this app to host Anima weights behind a paid API. This app does not do that. The slice is safe.

### 14.11 Open Questions

- **Q1. Variant selector placement.** RESOLVED — variant selector lives in the Anima result panel header, not in the model selector. Model selector is line-level (which model); variant is line-level (which checkpoint). Different abstraction levels.
- **Q2. Non-anime auto-prepend.** RESOLVED — the LLM contract itself conditions on the image content and prepends `ye-pop` / `deviantart` on line 1 when appropriate. No user button needed.
- **Q3. Chat cross-model behaviour.** RESOLVED — chat history is per-model. Switching model ends the current session and starts a new one. (Option **a** in the G1 framing.) Rationale: the chat default-system-prompt is completely different per contract (Z-Image's pastel-focal-glow vs. Anima's Danbooru-tag rules). Mixing them in one session would produce inconsistent revisions. The model field on each message preserves the audit trail.
- **Q4. Anima variant default.** RESOLVED — `Base` (per the manual §2 — "LoRAs should be trained using this version," and "Maximum flexibility, diversity, and style adherence").
- **Q5. Should the variant selector be persisted in `localStorage` too?** RESOLVED — yes. `state.model = 'anima'` + `state.animaVariant = 'base'` are both persisted. Default `base`.

### 14.12 Glossary point-in-time

These terms either already exist in `CONTEXT.md` or are sharpened by this slice:

- **`state.model`** — `'zimage_turbo' | 'anima'`. First-class app state. Persisted in localStorage, mirrored in URL, recorded in chat sessions. *Source: SPEC §14.4.1.*
- **Model selector** — UI control near the Generate button. Pre-Generate. One dropdown. *Source: SPEC §14.8.*
- **Anima variant** — `Base | Aesthetic | Turbo`. Which checkpoint of the Anima line. Default `Base`. *Source: manual §2; SPEC §14.4.1.*
- **Anima prompt contract** — the set of rules the LLM must follow when emitting the positive / negative pair. Mirrors manual §5–§7. *Source: SPEC §14.8.*
- **Fork** — the pre-Generate model picker that decides which `DEFAULT_*_PROMPT` contract runs. *Source: SPEC §14.1.*
- **`/api/anima`** — sibling route to `/api/zimage`. Receives `multipart image + variant`. Returns `{ positive, negative, variant, model }`. *Source: SPEC §14.8.*
- **Per-model chat session** — each chat session has a `model` field. Switching model ends the current session. *Source: SPEC §14.4.2, §14.7 Q3.*

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Initial draft (Slice 1) | Phase C of `goose-review`; user selected Candidate 1 (texture AI button) at the Phase C prompt |
| 2026-08-03 | Appended Slice 2 — Anima contract (the fork) | G1 approved by user; pre-Generate model picker chosen over dual-output design; Z-Image Turbo remains the default; Anima is a sibling contract with its own positive + negative prompts, variant selector (Base / Aesthetic / Turbo), and per-model chat sessions |