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
4. **Server.js monolith growth.** Adding `DEFAULT_ANIMA_PROMPT` + `callKiloAnimaAnalysis` + `/api/anima` is ~80–120 lines. **Mitigation:** the pattern is established (ADR 0018 per-field); the slice is well-bounded. Post-Slice-2, the `server/routes/` split can become its own slice.
5. **The Anima contract is more condition-heavy than Z-Image.** Pure-tag, pure-prose, hybrid shapes (§7 of the manual) depend on the image's subject. The LLM prompt must condition on image content. **Mitigation:** the system prompt itself instructs the LLM to choose shape based on subject (mirror principle from ADR 0019 §2). One server endpoint, three possible outputs.

### 14.4 Scope

#### 14.4.1 In scope (Slice 2 ships these)

- **`state.model`** in app state — string enum, defaults to `'zimage_turbo'`. Persisted in `localStorage`, recorded in chat sessions, exported with the prompt, mirrored in the URL.
- **Model selector UI** — dropdown or button group, placed near the Generate button. Switching it re-shapes the result panel and chat console.
- **`DEFAULT_ANIMA_PROMPT`** — the system prompt the LLM sees. Mirrors the structure of `DEFAULT_ZIMAGE_*` (when one exists) or the `actions`/`mood`/`lighting` pattern (ADR 0018).
- **`callKiloAnimaAnalysis`** — the LLM helper. Returns a `{ positive, negative }` shape (the Anima contract is two-output; the Z-Image contract is single-output).
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
- **`callKiloAnimaAnalysis`** (server helper) — interface: `(imageDataUri: string) → Promise<{ positive, negative }>`. Seam: `server.js` module export. Depth target: **deep** — single-attempt + schema builder + length guard all hidden behind one call.
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
| 2026-08-04 | Appended Slice 3 — Kilo Code provider migration + model selector | G1 approved by user; MiniMax M3 is the default LLM model; six hardcoded models via Kilo AI Gateway; model selector upstream of output-contract selector |

---

## 15. Slice 3 — Kilo Code provider migration + model selector

**Status:** Draft (awaiting Gate G2 user approval)
**Date:** 2026-08-04
**Origin:** User request — "review project and evaluate new feature for choosing kilocode as model provider … hardcode these minimax-m3, GPT-5.6 Luna, Gemini 3.1 Pro Preview, Gemini 3.5 Flash, Nemotron 3 Ultra, Grok 4.3"
**Context:** The current app calls MiniMax M3 directly via `api.minimaxi.chat`. The user wants to route all LLM calls through the **Kilo AI Gateway** (`api.kilo.ai`) — an OpenAI-compatible API gateway to 500+ models — and add a model selector dropdown so the artist can pick which underlying LLM model generates their prompts. The existing output-contract selector (Z-Image Turbo / Anima) is unchanged and sits downstream of the new model selector.

### 15.1 The Idea (one paragraph)

Swap the backend's LLM provider from direct MiniMax API calls to the Kilo AI Gateway, add a `buildVisionMessage` helper to consolidate the image-format change (MiniMax raw data URI → OpenAI-compatible `image_url` content parts), and render a **model selector** dropdown with six hardcoded models in the upload screen, positioned upstream of the existing output-contract selector. The selected model is sent with every LLM request, persisted in localStorage, mirrored in the URL, recorded in chat sessions, and defaults to MiniMax M3.

### 15.2 The Reframe

I heard this as: "replace the direct MiniMax integration with Kilo Code as the sole provider, keep all the prompt-engineering logic intact, and let me pick which LLM model does the work — without touching the Z-Image/Anima fork." Confirm or amend? *(Yes — confirmed by user at G1. Default model is MiniMax M3.)*

### 15.3 The Challenge (Goose argues against)

1. **Image format is a cross-cutting change.** Every one of the ~15 vision call sites currently embeds raw base64 data URIs in the MiniMax message shape. Kilo Code uses OpenAI-compatible `image_url` content parts — same data, different wrapper. Missing one call site means that button silently fails. **Mitigation:** a single `buildVisionMessage(imageDataUri, prompt)` helper used by every call site. Test the helper once; all call sites benefit. This is the expand-contract pattern: introduce the helper, migrate call sites one by one, delete the old inline pattern.
2. **Model capability mismatch.** Grok 4.3 and Nemotron 3 Ultra may produce weaker vision analysis than Gemini or GPT-5.6 Luna. A user picking the wrong model for Stage 1 gets poor output and blames the tool. **Mitigation:** the selector defaults to MiniMax M3 (the user's familiar baseline). The selector is explicit — the user owns the choice. We surface capability, we don't gatekeep it.
3. **Three selectors on one screen.** The upload screen now has: LLM model (new) → output contract (existing) → variant (existing, Anima-only). This risks dropdown fatigue. **Mitigation:** the model selector is visually distinct — it sits on its own row above the Generate button, styled differently from the contract selector. Most users set it once and rarely change it. localStorage persistence means it survives reloads.
4. **Provider migration touches every test.** The test suite has assertions about `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, `callMiniMax*` function names. Renaming ~15 helper functions + env vars means ~30-40 test assertions need updating. **Mitigation:** this is mechanical — s/MINIMAX/KILO/g plus s/callMiniMax/callKilo/g. The test shape (assert route registered, helper exported, response envelope correct) stays identical.

### 15.4 Scope

#### 15.4.1 In scope (Slice 3 ships these)

- **Env var swap:** `MINIMAX_API_KEY` → `KILO_API_KEY`, `MINIMAX_BASE_URL` → `KILO_BASE_URL` (default `https://api.kilo.ai/api/gateway`), `MINIMAX_MODEL` → removed (model is now dynamic from frontend).
- **`buildVisionMessage(imageDataUri, prompt)` helper** — single helper in `server.js` that constructs the OpenAI-compatible messages array with `image_url` content parts. Used by all vision call sites.
- **Rename ~15 helpers:** `callMiniMaxTextureAnalysis` → `callKiloTextureAnalysis`, etc. Each helper's fetch call updated to use `KILO_BASE_URL`, `KILO_API_KEY`, and accept a `model` parameter.
- **Model selector UI** — dropdown in `src/index.html` (or rendered programmatically), positioned above the output-contract selector. Six options:
  - `minimax/minimax-m3` — MiniMax M3 *(default)*
  - `openai/gpt-5.6-luna` — GPT-5.6 Luna
  - `google/gemini-3.1-pro-preview` — Gemini 3.1 Pro Preview
  - `google/gemini-3.5-flash` — Gemini 3.5 Flash
  - `nvidia/nemotron-3-ultra-550b-a55b` — Nemotron 3 Ultra
  - `x-ai/grok-4.3` — Grok 4.3
- **`state.llmModel`** — string, persisted in `localStorage` (`image-to-prompt.state.llmModel`), mirrored in URL (`?llm=minimax/minimax-m3`), recorded in chat session `model` field (renamed from current `state.model` to avoid collision with the output-contract `state.model`).
- **Model param on every endpoint** — Stage 1 (`/api/analyze`), all per-field re-analysis endpoints (`/api/subject`, `/api/camera_angle`, `/api/actions`, `/api/mood`, `/api/lighting`, `/api/texture`), Stage 2 (`/api/generate-prompt` and `/api/anima`), chat (`/api/chat/sessions`, `/api/chat/messages`). Frontend sends `llmModel` in the request body; server uses it as the `model` field in the Kilo Code API call.
- **Chat session `model` field** — captures which LLM model was active. (Existing `state.model` for output contract is separate and untouched.)
- **Tests** — env var validation, `buildVisionMessage` output shape, model selector rendering, model param on each endpoint, localStorage round-trip, URL mirror.
- **Documentation** — `CONTEXT.md` updated (provider section), `README.md` updated (env vars, architecture), this SPEC §15, forthcoming ARCHITECTURE.md appendix, ADR 0022, CODE-REVIEW-3.

#### 15.4.2 Out of scope (explicitly not doing)

- **Dynamic model list from `GET /models`.** The six models are hardcoded. No network fetch at startup.
- **Multi-provider architecture.** Kilo Code is the sole provider. No fallback to direct MiniMax API. No provider selector.
- **Model capability metadata.** The selector shows display names only — no context-length, pricing, or vision-capability badges.
- **Streaming responses.** All calls remain non-streaming (current behaviour).
- **Server.js split.** The file will grow by ~100 lines; well under the 290KB kill criterion.
- **Image format for chat.** Chat messages are text-only (analysis snapshot is JSON text). Chat does not send images — no image-format changes needed there.
- **Preset-aware model selection.** The model selector is global, not per-preset.
- **No new dependencies, no schema migration.** Chat session `model` field is additive.

#### 15.4.3 The ONE thing

**Clicking Generate with MiniMax M3 selected produces a prompt identical in quality to the current direct MiniMax integration — routed through Kilo Code instead. Switching to GPT-5.6 Luna and clicking Generate produces a prompt from GPT-5.6 Luna.**

This is the success criterion for Slice 3.

### 15.5 Users

**Primary user:** the AI artist who wants to experiment with different LLM models for prompt generation. They might use MiniMax M3 for consistency with their existing workflow, switch to GPT-5.6 Luna when they want stronger prompt-engineering, or try Gemini 3.5 Flash for speed. They pick a model once and it persists across sessions.

A day in their life: "I've been happy with MiniMax M3 for my oil-painting prompts, but tonight I want to try GPT-5.6 Luna for more creative texture descriptions. I pick it from the new dropdown, click Generate, and compare. Next week I might switch back — the dropdown remembers."

### 15.6 Constraints

| Constraint | Value | Reason |
|---|---|---|
| Stack | Node + Express + vanilla-JS frontend (unchanged) | mirrors existing |
| Hosting | localhost:3100 (unchanged) | running live; no deploy |
| Timeline | 1 session (Slice 3) | well-bounded; pattern is established |
| API provider | Kilo AI Gateway only | user explicitly chose single-provider |
| Model list | 6 hardcoded models | user explicitly provided the list |
| Default model | MiniMax M3 (`minimax/minimax-m3`) | user's familiar baseline; existing workflow |
| State persistence | `localStorage` | low-risk; mirrors Slice 2 pattern |
| URL mirror | `?llm=minimax/minimax-m3` | shareability |
| Kill criterion | `server.js` exceeds 290KB | well under (currently ~7,100 lines) |

### 15.7 User Stories

1. As a user, I want a model selector dropdown before the Generate button, so I can pick which LLM generates my prompts.
2. As a user, I want the model selector to default to MiniMax M3, so my existing workflow is unchanged on first use.
3. As a user, I want my model choice to persist across page reloads, so I don't re-pick every session.
4. As a user, I want to switch models and re-generate, so I can compare output quality across different LLMs.
5. As a user, I want the chat console to use the same model I selected, so refinements are consistent with the generation.
6. As a developer, I want a single `buildVisionMessage` helper for all vision calls, so the image-format change is centralized.
7. As a developer, I want the test suite to validate the model param on every endpoint, so no call site is missed.
8. As a developer, I want the provider migration to be mechanically verifiable (s/MINIMAX/KILO/g), so no hidden MiniMax references remain.

### 15.8 Implementation Decisions

#### Modules

- **`buildVisionMessage(imageDataUri, prompt)`** (server helper) — interface: `(string, string) → [{role: "user", content: [{type: "image_url", image_url: {url: string}}, {type: "text", text: string}]}]`. Seam: `server.js` module export. Depth: **deep** — image format conversion, data URI validation, prompt wrapping all hidden behind one call.
- **`state.llmModel`** (frontend state) — interface: string (one of six model IDs). Default: `'minimax/minimax-m3'`. Seam: `src/app.js` state object. Depth: **shallow** — a string, persisted, mirrored.
- **Model selector UI** (frontend component) — interface: `<select>` dropdown with six options. Position: above the output-contract selector, before Generate. Seam: `src/index.html` or programmatic render. Depth: **shallow** — pure state binding.
- **`callKilo*` helpers** (~15 functions) — renamed from `callMiniMax*`. Each accepts a `model` parameter. Seam: `server.js` module exports. Depth: **deep** — unchanged from existing, only the fetch URL + auth header + model param change.

#### Decisions

- **Single `buildVisionMessage` helper.** Every vision call site uses it. No inline image-format construction anywhere. This is the expand-contract pattern: introduce helper → migrate call sites → delete old pattern.
- **Rename all helpers:** `callMiniMaxTextureAnalysis` → `callKiloTextureAnalysis`, etc. Mechanical s/MiniMax/Kilo/g. No functional change beyond fetch target.
- **Model param on every endpoint.** Server routes extract `llmModel` from `req.body`, validate against the six allowed IDs, pass to the helper. 400 if invalid.
- **URL parameter:** `?llm=minimax/minimax-m3`. Read on boot: URL first, then localStorage, then default.
- **Chat session `model` field:** captures the LLM model used. Separate from the output-contract field (currently also called `model`; will be renamed to `contract` in chat session schema — or the LLM model field is named `llm_model` to avoid collision).
- **Display names vs model IDs.** The selector shows human-readable names. The `value` attribute is the Kilo Code model ID.
- **No retry loop, no fallback.** Single-attempt LLM call (mirrors existing). If Kilo Code returns 5xx, the error surfaces to the user.
- **Error handling.** 401/403 on Kilo Code → check `KILO_API_KEY`. 402 → "Kilo Code balance exhausted." 429 → "Rate limited — wait and retry." 502 → "Upstream provider error."
- **`provider` field in response envelope:** changed from `'minimax-m3'` to `'kilo-code'`.

#### Model list (canonical, hardcoded)

| Display Name | Model ID (`value`) | Notes |
|---|---|---|
| MiniMax M3 | `minimax/minimax-m3` | **Default.** Existing familiar baseline. |
| GPT-5.6 Luna | `openai/gpt-5.6-luna` | Strong vision + prompt engineering. |
| Gemini 3.1 Pro Preview | `google/gemini-3.1-pro-preview` | Large context, strong vision. |
| Gemini 3.5 Flash | `google/gemini-3.5-flash` | Fast, cost-effective. |
| Nemotron 3 Ultra | `nvidia/nemotron-3-ultra-550b-a55b` | NVIDIA large model. |
| Grok 4.3 | `x-ai/grok-4.3` | xAI flagship. |

### 15.9 Definition of Done (vertical sub-slices)

#### Slice 3.1 — env + server-side provider swap

- **Behaviour:** `server.js` reads `KILO_API_KEY` and `KILO_BASE_URL`. All `callMiniMax*` helpers renamed to `callKilo*`. All fetch calls pointed at Kilo Code gateway. No functional change in prompt quality for MiniMax M3 (it goes through Kilo Code instead of direct, but same model).
- **DoD:**
  - [ ] `KILO_API_KEY` and `KILO_BASE_URL` env vars read at startup with validation
  - [ ] All `callMiniMax*` → `callKilo*` renames
  - [ ] All fetch URLs → `${KILO_BASE_URL}/chat/completions`
  - [ ] All auth headers → `Bearer ${KILO_API_KEY}`
  - [ ] All model params → accept `model` argument
  - [ ] `node --check server.js` exit 0

#### Slice 3.2 — buildVisionMessage helper + call site migration

- **Behaviour:** `buildVisionMessage(imageDataUri, prompt)` exists and constructs correct OpenAI-compatible vision messages. Every vision call site uses it. No inline image-format construction remains.
- **DoD:**
  - [ ] `buildVisionMessage` exported from `server.js`
  - [ ] Helper produces `[{role: "user", content: [{type: "image_url", image_url: {url: "..."}}, {type: "text", text: "..."}]}]`
  - [ ] All ~15 vision call sites migrated (Stage 1, 6 per-field endpoints, Stage 2 Z-Image, Stage 2 Anima, subject re-analysis, camera-angle re-analysis)
  - [ ] `node --check server.js` exit 0

#### Slice 3.3 — model selector UI + state + persistence

- **Behaviour:** Model selector dropdown renders above the output-contract selector. Default is MiniMax M3. Selection persists in localStorage and mirrors in URL.
- **DoD:**
  - [ ] Dropdown with six options rendered in the UI
  - [ ] `state.llmModel` initialized from URL, then localStorage, then default
  - [ ] Changing selection updates `state.llmModel`, localStorage, URL
  - [ ] Reload preserves selection
  - [ ] `node --check src/app.js` exit 0

#### Slice 3.4 — wire model param through all endpoints

- **Behaviour:** Every LLM endpoint receives `llmModel` from the frontend and passes it as the `model` parameter to the Kilo Code API. Chat sessions record the LLM model. Response envelope says `provider: 'kilo-code'`.
- **DoD:**
  - [ ] All endpoints accept `llmModel` in request body
  - [ ] Server validates against six allowed model IDs (400 on mismatch)
  - [ ] Model param threaded to `callKilo*` helpers
  - [ ] Chat session records LLM model
  - [ ] Response envelope `provider` field updated
  - [ ] Manual demo: pick each model, generate, verify it doesn't error

#### Slice 3.5 — tests + code review + docs

- **Behaviour:** Test suite updated for new env vars, helper names, model param validation. CODE-REVIEW-3 written. CONTEXT.md and README.md updated.
- **DoD:**
  - [ ] `node tests/run-all.js` — all existing + new tests pass
  - [ ] `node scripts/session-init.js` — 10/10 V-checks
  - [ ] `node --check server.js && node --check src/app.js` — exit 0
  - [ ] `docs/CODE-REVIEW-3-kilo-code-provider.md` verdict: `pass` or `pass+minor`
  - [ ] `CONTEXT.md` updated (provider, env vars, buildVisionMessage)
  - [ ] `README.md` updated (env vars)

**Blocked by:** all five sub-slices are sequential. 3.1 → 3.2 → 3.3 → 3.4 → 3.5.

### 15.10 Open Questions

- None. All design decisions resolved at G1.

### 15.11 Glossary point-in-time

These terms either already exist in `CONTEXT.md` or are sharpened by this slice:

- **Kilo AI Gateway** — OpenAI-compatible API gateway at `api.kilo.ai`. Single provider for all LLM calls. Replaces direct MiniMax API integration. *Source: SPEC §15.1; kilo.ai/docs/gateway/api-reference.*
- **`state.llmModel`** — string enum of six model IDs. Default `'minimax/minimax-m3'`. Persisted in localStorage, mirrored in URL (`?llm=...`), recorded in chat sessions. *Source: SPEC §15.8.*
- **Model selector** — `<select>` dropdown before the Generate button. Picks the LLM model. Six hardcoded options. **Distinct from the output-contract selector** (Z-Image Turbo / Anima). *Source: SPEC §15.4.1.*
- **`buildVisionMessage(imageDataUri, prompt)`** — server helper that constructs OpenAI-compatible vision messages with `image_url` content parts. Single source of truth for image format. *Source: SPEC §15.8.*
- **`callKilo*` helpers** — renamed from `callMiniMax*`. ~15 functions. Each accepts a `model` param and calls Kilo Code `/chat/completions`. *Source: SPEC §15.8.*
- **`KILO_API_KEY`** — env var for Kilo Code API key (JWT Bearer token). Replaces `MINIMAX_API_KEY`. *Source: SPEC §15.4.1.*
---

## 16. Slice 4 — Tri-provider routing (Kilo Code / MiniMax / Alibaba DashScope)

**Status:** Draft (awaiting Gate G2 user approval — proceeding under Slice 3 closeout pre-commitment)
**Date:** 2026-09-03
**Origin:** User request — multi-provider routing so the artist can pick the underlying vendor (Kilo Code's aggregator vs. direct MiniMax vs. Alibaba's DashScope) and the model within that vendor.
**Context:** Slice 3 shipped Kilo Code as the sole provider with model selection within Kilo. Slice 4 introduces a **provider selector** upstream of the existing LLM model `<select>`. The provider determines the call shape (request format, auth header, response parsing); the model is scoped to the chosen provider.

### 16.1 The Idea (one paragraph)

Generalize the Kilo Code call path into a thin **provider abstraction layer** (`callProvider(provider, model, messages, options)`) backed by three concrete adapters: `callKiloProvider` (live, ship-ready), `callMiniMaxProvider` (live when `MINIMAX_LIVE=1`, stub otherwise), `callAlibabaProvider` (live when `DASHSCOPE_LIVE=1`, stub otherwise). The `<select id="provider-selector">` upstream of `#llm-model-selector` picks the provider; the per-provider `<select id="llm-model-selector">` swaps its option list when the provider changes. Resolution goes `URL (?provider=&llm=) > localStorage (i2p.state.provider, i2p.state.llmModel) > defaults (kilo_code, minimax/minimax-m3)`. The response envelope gains a `provider` field alongside the existing `model` field.

### 16.2 The Reframe

I heard this as: "give me a provider selector so I can route through Kilo Code, MiniMax direct, or Alibaba DashScope — and within each provider, pick the model — without rewriting the route handlers." Confirm or amend?

### 16.3 The Challenge (Goose argues against)

1. **Three response envelopes to normalize.** Kilo Code is OpenAI-compat (`choices[0].message.content`). MiniMax returns `{ reply, suggested_prompt }` (custom). DashScope returns `{ output: { choices: [{ message: { content: [...] } }] } }`. **Mitigation:** each adapter returns a normalized `{ ok, content, raw, error }` shape. Route handlers consume the normalized shape only; they never see provider-specific quirks.
2. **Auth complexity.** Kilo Code: `Authorization: Bearer ${KILO_API_KEY}`. MiniMax: `Authorization: Bearer ${MINIMAX_API_KEY}`. DashScope: `Authorization: Bearer ${DASHSCOPE_API_KEY}` (different key namespace). **Mitigation:** each adapter owns its own auth-header construction. The route handlers pass the raw `apiKey` from env; they never construct headers.
3. **Live-vs-stub gating.** The user wants real providers when keys are present, but the architecture must be provably correct via tests without burning API budget. **Mitigation:** each adapter checks `${PROVIDER}_LIVE=1` (env var) and falls back to a deterministic stub that returns canned-shape responses. Tests use the stub; production flips the env var to go live. This matches the "smallest slice" suggestion from BACKLOG.md Slice 4 entry.
4. **URL canonicalization.** With two new URL params (`?provider=` + `?llm=`), URL noise grows. **Mitigation:** omit both when at default; default is `kilo_code` + `minimax/minimax-m3`, so a first-load URL stays canonical (`/`, no params).

### 16.4 Scope

- **Server (`server.js`)**:
  - `ALLOWED_PROVIDERS = ['kilo_code', 'minimax', 'alibaba']`
  - `ALLOWED_LLM_MODELS_BY_PROVIDER = { kilo_code: [...6], minimax: ['MiniMax-M1'], alibaba: ['qwen-vl-max', 'qwen-vl-plus'] }`
  - `resolveProviderAndModel(body)` — chained resolver, returns `{ provider, model }`
  - `callProvider(provider, model, messages, options)` — dispatcher; calls the right adapter
  - Three adapters: `callKiloProvider`, `callMiniMaxProvider`, `callAlibabaProvider` (~30 lines each)
  - All 8 route handlers + 2 helper call sites pass `provider: provider, model: model` (replacing the existing `model: llmModel`)
  - Response envelope gains `provider` field alongside `model`
  - `isProviderLive(provider)` helper — returns true only when `${PROVIDER}_LIVE=1` is set; otherwise the adapter returns a deterministic stub

- **Frontend (`src/app.js` + `src/index.html` + `src/styles.css`)**:
  - `state.provider` (default `'kilo_code'`)
  - `PROVIDER_STORAGE_KEY = 'i2p.state.provider'`
  - `validateProvider` (defaults to `kilo_code` on invalid)
  - `renderProviderSelector()` + `onProviderChange()`
  - `<select id="provider-selector">` with three options (kilo_code, minimax, alibaba)
  - Per-provider `<select id="llm-model-selector">` swaps options when provider changes
  - `?provider=...` URL mirror (omitted when default)
  - `fd.append('provider', state.provider)` on `/api/analyze`, `/api/anima`
  - `provider: state.provider` on `/api/generate-prompt` body, chat messages body

- **Tests (`tests/run-all.js`)**:
  - 8 new tests for `resolveProviderAndModel` + `ALLOWED_LLM_MODELS_BY_PROVIDER`
  - 4 new tests for `callKiloProvider` adapter (real + stub)
  - 4 new tests for `callMiniMaxProvider` adapter (real + stub)
  - 4 new tests for `callAlibabaProvider` adapter (real + stub)
  - 4 new tests for frontend `state.provider` + persistence + URL mirror
  - 4 new tests for frontend endpoint forwarding (all 4 endpoints)

### 16.5 What stays the same

- The Z-Image / Anima output-contract selector (`state.model`) is unchanged — different abstraction level.
- The existing 6 Kilo Code models are unchanged.
- The chat assistant's schema-drop retry (Fix 2 from Slice 3 closeout) is preserved — the retry runs inside `callKiloProvider`, not at the dispatcher level.
- The frontend's existing model selector UI is unchanged; it just swaps its option list when the provider changes.

### 16.6 Slice 4 file touchpoints (preview)

| File | Touch | Lines (est.) |
|---|---|---|
| `server.js` | rewrite call path | +180 / −60 |
| `src/app.js` | provider selector + forwarding | +80 / −5 |
| `src/index.html` | provider `<select>` markup | +10 |
| `src/styles.css` | provider-row styles | +15 |
| `tests/run-all.js` | new tests | +120 |
| `docs/SPEC.md` | §16 (this entry) | +150 |
| `docs/adr/0023-tri-provider-routing.md` | new | +120 |
| `docs/ARCHITECTURE.md` | Slice 4 appendices | +150 |
| `docs/PRE-MORTEM.md` | Slice 4 risks | +60 |
| `docs/CODE-REVIEW-11-slice-4.md` | new | +200 |
| `docs/POLISH-AUDIT-4.md` | new | +100 |
| `docs/POLISH-AUDIT-3 addendum.md` | closes deferred gate | +40 |

### 16.7 Glossary point-in-time

- **Provider** — string enum of three LLM vendors. `'kilo_code'`, `'minimax'`, or `'alibaba'`. Persisted in localStorage, mirrored in URL (`?provider=...`), recorded in response envelope `provider` field. *Source: SPEC §16.1.*
- **`callProvider(provider, model, messages, options)`** — server-side dispatcher. Routes to one of three adapters based on `provider`. Each adapter returns a normalized `{ ok, content, raw, error }` shape. *Source: SPEC §16.4.*
- **`isProviderLive(provider)`** — server-side helper. Returns true when `${PROVIDER}_LIVE=1` env var is set. False → adapter returns deterministic stub. *Source: SPEC §16.4.*
- **`state.provider`** — frontend state flag, default `'kilo_code'`. Sibling to `state.llmModel`. *Source: SPEC §16.4.*


---

## Slice series UI-R — UI redesign implementation (2026-09-03)

**Source:** `docs/UI-REDESIGN-SPEC.md` (Approved — Q1–Q4 resolved). Approved for
implementation by standing full-autonomy directive (2026-09-03). All six slices
below are pre-approved G1–G3 artifacts; each ships with tests + demo + code review.

| Slice | Phase | Content | Guarantee |
|---|---|---|---|
| UI-R0 | 0 | Foundations: hash router, focus-trap, live-region, provider poller, `--focus` + reduced-motion tokens | zero behavior change |
| UI-R1 | 1 | App shell + nav + Create restructure (§4.1); `<section class="step">` pattern removed | all endpoints + URL params unchanged |
| UI-R2 | 2 | Provider keys: store + 4 endpoints (§6.4) + Providers & keys view + inline Create warnings; ADR 0024 | env-only deployments unchanged; stored keys additive |
| UI-R3 | 3 | Library view: presets/palettes/directives, list + inline edit panel, REST-driven | data files untouched |
| UI-R4 | 4 | Chat promoted to view; Settings view (system prompts + defaults) | chat API unchanged |
| UI-R5 | 5 | Identity: cyanotype tokens, typefaces, contact-sheet strip; a11y audit close-out | visual-only |

Constraints: no framework; vanilla JS only; `src/shell.js` (new) loads after
`src/app.js` and never mutates `app.js` internals — integration via DOM IDs,
REST endpoints, and `hashchange`. Acceptance criteria: `UI-REDESIGN-SPEC.md` §10.

---

## Slice UI-R7 — Model enablement manager (2026-09-04)

**Pre-approved G1–G3 under the standing full-autonomy directive (2026-09-04).**
Ships with tests + browser E2E demo + code review.

**Problem:** model lists were hardcoded in three places (server allowlist,
index.html `<option>`s, app.js map) with no user control. Users need to choose
which models are active per provider, persistently.

**Shape:**
- New dedicated view `#/models` (nav tab "Models"): one card per provider,
  checkbox toggle per model, custom-model add/remove, live status line.
- New store `data/model_config.json` (0600): `{ [providerId]: { enabled, custom } }`.
  Missing entry ⇒ full catalog enabled.
- New endpoints: `GET /api/models`; `PUT /api/providers/:id/models`
  (body `{ enabled?, custom? }`, whole-state replace for that provider).
- Enforcement: `resolveProviderAndModel` and `GET /api/providers` expose only
  enabled models; `window.__i2pEnabledModelsByProvider` (set by shell.js)
  drives `validateLlmModel` / `rebuildLlmModelSelectorOptions` in app.js, so
  Create + Settings dropdowns show only enabled models.
- Guard: `enabled` may never be empty for a provider — 409 with a clear
  message (disabling the last model would break generation on that provider).
- Custom models: non-empty ≤120 chars, no duplicates, must not collide with
  the built-in catalog; new customs are auto-enabled.
- Effective default: hardcoded `PROVIDER_DEFAULT_MODEL` when enabled, else
  first enabled model.

---

## Slice series CR — Chat Redesign (oil-painting RAG edition, 2026-09-04)

**Pre-approved G1–G3 under the standing full-autonomy directive (2026-09-04).**
Four slices below ship the redesign end-to-end. Each slice ships with tests +
browser E2E demo + code review + SESSION-STATE update.

**Strategic anchor:** All prompts generated through this tool are *exclusively*
used to create reference images for oil-painting practice. The chat assistant
becomes a specialised oil-painting-reference-creation expert grounded by a
dedicated vector database (composition, historical art data, oil-painting
style guides, previously generated prompt assets). Decisions D1–D5 (resolved
at G1): hand-rolled cosine vector store over JSON, Kilo gateway embeddings,
chat-only scope (Stage 1/2 contracts unchanged), curated default corpus
seeded on first read, auto-ingest of all generated prompts.

**Acceptance guarantees (across the whole series):**

1. Every chat turn has top-k RAG retrieval injected into the system prompt
   before the model is called. Retrieval provenance is captured per message.
2. The persona is oil-painting-reference-creation-specific: brushwork,
   pigment-aware color theory, fine-art composition, historical conventions.
3. The chat accepts image attachments; the server embeds them in the
   vision-capable message body for kilo_code; non-vision providers
   degrade gracefully (attachment stored, message text-only).
4. Direct in-place edit of `current_prompt` is available from the chat view.
5. The conversation persists: history, attachments, prompt revisions survive
   server restart; sync is a single-source-of-truth server + frontend refresh.
6. Anchor preservation (ADR 0012) remains in force; the wholesale-rewrite
   escape is preserved. Per-model sessions (ADR 0021) remain in force.

### Slice CR-1 — RAG foundation + persona rewrite (2026-09-04)

**Problem:** the chat system prompt is generic and explicitly forbids
aesthetic commentary; there is no domain corpus; the model lacks
oil-painting-specific grounding.

**Shape:**
- New `server/lib/rag.js` (~150 LOC): cosine similarity over a JSON-backed
  vector index. Embeddings stored as `Float32Array`-serialised float arrays
  next to each chunk. Query = (a) embed the user's last message + current
  prompt, (b) dot-product top-k against every chunk, (c) return the
  chunks above a similarity threshold.
- New `server/lib/embeddings.js` (~80 LOC): Kilo gateway embedding wrapper
  (`text-embedding-3-small`). One-call-per-batch with retry-on-429 back-off.
  Embedding source stored on every chunk so we can re-embed on swap.
- New `data/rag_corpus/` directory + 3 curated seed files:
  - `composition.json` — rule of thirds, golden ratio, focal hierarchy,
    atmospheric perspective, leading lines, negative space, gestural
    composition, value structure, edge control.
  - `historical_art.json` — Baroque chiaroscuro, Renaissance sfumato,
    Impressionist broken color, alla-prima freshness, Northern realism,
    Fauvism, Expressionist gestural brushwork.
  - `oil_painting_style.json` — brushwork techniques (alla prima, glazing,
    scumbling, impasto, sgraffito, dry-brush, fat-over-lean), color theory
    for traditional media (warm/cool contrast, complementary pairs, pigment
    properties), support/pigment notes, drying-time implications.
- New `data/rag_index.json` (0600): `{ chunks: [{ id, source, title,
  content, embedding: number[], embedding_model, embedded_at }] }`.
- New `POST /api/rag/reindex` (admin): re-embed every chunk (used after a
  model swap, or to backfill on first install).
- New `GET /api/rag/corpus`: returns the chunk titles + sources for the UI
  to render a "what the AI knows" affordance.
- Rewrite `DEFAULT_CHAT_SYSTEM_PROMPT`:
  - Persona: "You are an oil-painting reference-creation specialist
    collaborating with an artist. Every prompt you produce is destined
    for an image-gen model whose output will be used as a *reference*
    for oil-painting practice, never as a finished painting."
  - Drop the "Don't comment on style/aesthetic quality" rule.
  - Drop the "Don't ask clarifying questions" rule.
  - Add: "When refining, ground every recommendation in composition,
    brushwork, pigment behaviour, and historical convention."
  - Add: "Top of your context is a RETRIEVAL block with the most
    relevant excerpts from your domain corpus — cite them implicitly
    by using the same vocabulary."
  - Keep the anchor-preservation contract (ADR 0012) intact.
  - Keep the JSON schema (strict `{ reply, suggested_prompt }`).
- In `POST /api/chat/sessions/:id/messages`: before building the LLM
  request body, call `retrieveRelevantChunks(context, k=4)`, embed the
  result as a `RETRIEVAL` block in the system prompt, and stamp the
  retrieval ids onto the assistant message for provenance.
- Tests: ≥15 new tests covering (a) cosine math, (b) corpus seed load,
  (c) embedding-batch round-trip, (d) retrieval-injection in chat,
  (e) persona prompt structure (string contains the new keywords),
  (f) retrieval provenance on assistant messages.

### Slice CR-2 — Image attachments + vision (2026-09-04)

**Problem:** chat messages are text-only; users cannot share concept
images; the chat cannot see what the artist is iterating on.

**Shape:**
- New `POST /api/chat/sessions/:id/attachments` (mul­ter, 10 MB cap,
  mime allowlist: image/png, image/jpeg, image/webp). Stored under
  `data/chat_attachments/<session_id>/<attachment_id>.<ext>`.
- New `DELETE /api/chat/attachments/:id` (hard-delete one file + unlink
  from any message referencing it).
- New `GET /api/chat/attachments/:id` (serve the file with
  `Content-Disposition: inline` + correct mime).
- Message shape gains `attachments: [{ id, filename, mime, size }]`.
  Multiple attachments per message allowed.
- When `provider === 'kilo_code'` and the model supports vision
  (heuristic: model name contains `m3` / `minimax` / `gpt-4o` /
  `claude` / `vision` — fail-open if unknown), build the message
  body as a content-array: `[{ type: 'text', text }, { type: 'image_url',
  image_url: { url: 'data:<mime>;base64,...' } }, ...]`. Otherwise,
  fall back to text-only with a note that attachments are stored.
- `POST /api/chat/sessions/:id` (delete): cascade-delete every
  attachment directory for the session.
- `data/chat_sessions.json` shape unchanged at the JSON level (the
  attachment id is enough to look up the file).
- UI: attach button (paperclip) in the chat form; attachment
  thumbnails under the textarea; thumbnails in the transcript
  (click to enlarge in a lightbox modal).
- Tests: ≥8 new tests covering (a) upload round-trip, (b) mime
  rejection, (c) session-delete cascade, (d) vision message-body
  build, (e) text-only fallback for non-vision providers, (f)
  attachment GET serves correct mime, (g) attachment id is on the
  message, (h) attachment unlinked from messages after DELETE.

### Slice CR-3 — Two-way UX upgrade + direct edits (2026-09-04)

**Problem:** the chat feels transactional (input → reply → apply). The
"edit any stage" affordance is implicit; there is no direct hand-edit
of `current_prompt`; the transcript lacks ChatGPT-style polish.

**Shape:**
- New `PATCH /api/chat/sessions/:id` body `{ current_prompt?: string }`:
  in-place edit of the committed working prompt. Does NOT trigger an
  LLM call. Returns the updated session.
- New `POST /api/chat/sessions/:id/revert/:messageId`: revert
  `current_prompt` to whatever value it had at the moment the given
  message was applied. Does NOT mutate history; just rewinds the
  working prompt. Disabled if the message was a discussion (no
  prompt change at that turn).
- New `POST /api/chat/sessions/:id/fork-from/:messageId`: mint a
  *new* chat session whose `original_prompt` is `current_prompt` at
  the fork point. The original session is closed (read-only). Lets the
  user branch without losing either thread.
- UI: in the chat transcript, every assistant message with a
  `suggested_prompt` now also has an "Edit & apply" button that
  opens an inline editor pre-filled with the suggestion; on save,
  PATCH `/current_prompt` and POST `/apply/:messageId` atomically.
- UI: the "Current working prompt" header is editable (textarea +
  Save button). Save → PATCH.
- UI: ChatGPT-style polish — typing indicator while waiting on the
  LLM, smooth scroll-to-bottom on new message, message grouping by
  sender, draft autosave (localStorage), "Edit any prior message"
  hover affordance.
- Tests: ≥6 new tests covering (a) PATCH current_prompt round-trip,
  (b) revert round-trip, (c) fork mints a new session, (d) cascade
  integrity after edit, (e) draft autosave persistence, (f) PATCH
  rejection of empty/oversized prompt.

### Slice CR-4 — Auto-ingest + sync hardening + G5 polish (2026-09-04)

**Problem:** the curated corpus is static; the user's own prompt history
is the most domain-relevant signal we have; sync across restarts is not
explicitly tested; G5 audit hasn't run.

**Shape:**
- New `server/lib/rag_ingest.js` (~40 LOC): on every successful Stage 2
  (`POST /api/generate-prompt`) and every successful Anima Stage 2
  (`POST /api/anima`), call `appendChunkToIndex({ source: 'stage2',
  title: <preset name>, content: <final prompt> })`. The chunk is
  embedded lazily on the next retrieval (or eagerly on a debounced
  reindex). On every chat proposal that produces a non-null
  `suggested_prompt`, call `appendChunkToIndex({ source: 'chat',
  title: 'chat proposal <id>', content: <suggested_prompt> })`.
- Reindex is debounced (5 s) so a burst of activity doesn't hammer the
  embedding endpoint. On startup, finish any pending embeds.
- Cap the auto-ingested index at 5,000 chunks (oldest evicted
  first); the curated seed is never evicted (its `source` is in
  `['composition', 'historical_art', 'oil_painting_style']`).
- New `POST /api/rag/search` body `{ query, k }`: expose the
  underlying retrieval to the UI so users can preview what the AI
  sees (transparency affordance).
- Sync hardening tests: kill-server-restart-survives for (a) chat
  history, (b) attachments, (c) RAG index, (d) current/pending
  prompts.
- `docs/POLISH-AUDIT-CR.md`: full 7-section audit (accessibility,
  visual, prose, copy, performance, discipline, dependency). All
  blocking findings fixed inline; non-blocking parked in BACKLOG.

### File touchpoints (preview)

| File | Touch | Lines (est.) |
|---|---|---|
| `server.js` | persona rewrite + retrieval + attachments + PATCH + auto-ingest | +600 / −120 |
| `src/app.js` | chat view rewrite (UX + edit + lightbox + draft autosave) | +400 / −80 |
| `src/index.html` | chat panel markup + lightbox | +60 |
| `src/styles.css` | chat polish | +120 |
| `tests/run-all.js` | new tests across all 4 slices | +500 |
| `server/lib/rag.js` | new | ~150 |
| `server/lib/embeddings.js` | new | ~80 |
| `server/lib/rag_ingest.js` | new | ~40 |
| `data/rag_corpus/*.json` | new (curated seed) | ~30 KB total |
| `data/rag_index.json` | new (auto-managed) | grows with usage |
| `data/chat_attachments/` | new dir (auto-managed) | grows with usage |
| `docs/SPEC.md` | §17–20 (this entry) | +260 |
| `docs/adr/0025-rag-foundation.md` | new | ~150 |
| `docs/ARCHITECTURE.md` | CR appendices | +200 |
| `docs/PRE-MORTEM.md` | CR risks + pre-commitments | +100 |
| `docs/CODE-REVIEW-12-CR-1.md`, `…-CR-2.md`, `…-CR-3.md`, `…-CR-4.md` | new | ~200 each |
| `docs/VISUAL-DEMO-CR-1.md` … `…-CR-4.md` | new | ~80 each |
| `docs/POLISH-AUDIT-CR.md` | new | ~300 |
| `docs/SESSION-STATE.md` | per-slice updates | +200 |

### Glossary point-in-time (CR-series additions)

- **RAG** — Retrieval-Augmented Generation. At chat-message time, the
  server embeds the user's last message + current prompt, retrieves the
  top-k most similar chunks from the vector store, and injects them into
  the chat system prompt as a `RETRIEVAL` block before the LLM is
  called. *Source: SPEC §17.1.*
- **Vector store** — JSON-backed cosine index at `data/rag_index.json`.
  Every chunk has an embedding (Float32Array-serialised) and an
  embedding-model stamp. Hand-rolled; no external dependencies. *Source:
  SPEC §17.1, D1.*
- **Curated seed** — the three static JSON files in `data/rag_corpus/`
  that the app ships with on first read. Never evicted by the 5,000-cap
  logic. *Source: SPEC §17.1, D4.*
- **Auto-ingested chunk** — a chunk created by `appendChunkToIndex`
  from a Stage 2 output or a chat proposal. Subject to the 5,000-cap
  FIFO eviction. *Source: SPEC §20.1, D5.*
- **Retrieval provenance** — the list of chunk ids the server stamped
  on each assistant message in `retrieval_ids: string[]`. Lets the UI
  show "this answer used these references" and lets tests verify the
  RAG path actually ran. *Source: SPEC §17.1.*
- **Attachment** — a user-uploaded image stored under
  `data/chat_attachments/<session_id>/<attachment_id>.<ext>`. Referenced
  by id in messages. *Source: SPEC §18.1.*
- **Direct edit** — `PATCH /api/chat/sessions/:id` with
  `current_prompt`. A user-driven mutation that bypasses the AI and
  commits the change atomically. Distinct from "apply proposal". *Source:
  SPEC §19.1.*
- **Fork** — `POST /api/chat/sessions/:id/fork-from/:messageId`. Mints
  a new session whose `original_prompt` is the parent's
  `current_prompt` at the fork point. The parent is closed. *Source:
  SPEC §19.1.*

### Out-of-scope (parked in BACKLOG, not CR-series)

- Streaming responses (ChatGPT-style token streaming).
- Cross-device sync (no second user).
- Multi-user collaboration (still single-user).
- Per-attachment alt-text auto-generation.
- RAG re-ranking via cross-encoder (overkill for the corpus size).
- Live OCR of attached concept images.

## §21 — Chat-attachment vision-capability data model (Slice 26)

**Class:** CR-fix per `docs/agents/bug-workflow.md`. Wide enough to warrant an ADR (ADR 0026) but not wide enough to be a feature slice.

### Reframe

The chat image-sharing feature works end-to-end for the default model (`minimax/minimax-m3`) but silently demotes image attachments to a text-only placeholder for 3 of 6 Kilo Code models: `openai/gpt-5.6-luna`, `x-ai/grok-4.3`, `nvidia/nemotron-3-ultra-550b-a55b`. The model paraphrases the placeholder text into "the file came through but image content isn't visible to me here". Bug class: silent false-negative in a stringly-typed allowlist regex.

### Scope

Replace the substring regex `ALLOWED_CHAT_ATTACHMENT_VISION_MODELS` (was at `server.js:1143`) with an explicit `Set<VisionCapableModelId>` colocated with `ALLOWED_LLM_MODELS_BY_PROVIDER`. Lock membership with five static-parse regression tests in `tests/run-all.js`.

### Out of scope

- UI capability badges in the model dropdown (SPEC §15.7 "Model capability metadata"). Parked in BACKLOG; the Set is the seed for that future slice.
- Per-provider metadata table keyed by `{provider, model} → {vision, reasoning, ...}`. ADR 0026 §2 rejected for now; replaces the Set only when reasoning / context-length / pricing badges land.

### User stories

- As a chat user on `openai/gpt-5.6-luna`, I want to attach an image and have the model describe it, so I can iterate prompts off the image.

### Implementation decisions

- `VISION_CAPABLE_MODELS = new Set([...])` — single source of truth, colocated with `ALLOWED_LLM_MODELS_BY_PROVIDER`.
- Consumer in `buildUserMessageWithAttachments`: `VISION_CAPABLE_MODELS.has(llmModel)`.
- Update rule: every `ALLOWED_LLM_MODELS_BY_PROVIDER` model must be added to the Set or to a negative-case list. The five regression tests fail if the two lists diverge.

### Glossary

- **Vision-capable** — a model whose upstream API accepts the OpenAI-compat `image_url` content part. Distinct from "image-output-capable" (text-to-image models).

### References

- ADR 0026 — design rationale + rejected alternatives
- ARCHITECTURE §26.A1–A5 (data shape, consumer, refactor triggers, failure modes)
- PRE-MORTEM §26 (top risks + pre-commitments + kill criteria)
- docs/CODE-REVIEW-27-vision-capability-coverage.md (verdict pass)

### DoD

- [x] `server.js`: regex removed; Set colocated with `ALLOWED_LLM_MODELS_BY_PROVIDER`; consumer uses `.has()`.
- [x] `tests/run-all.js`: 5 static-parse regression tests added.
- [x] `docs/adr/0026-…`: ADR written.
- [x] Code-review verdict `pass`.

## §22 — Inline diff on Apply (Chat fluid-iteration Slice 1)

**Class:** Feature slice per App Build methodology. Companion to §19/§20 chat redesign; not wide enough to warrant an ADR (single-axis additive UI; no schema or protocol change).

### Reframe

Every chat revision is currently shown to the user as a `pre` block with `current_prompt` text. The user must mentally diff the proposal against the working prompt before clicking Apply, which is a real friction point. Adding an inline unified word-diff with per-hunk accept/reject turns "Apply" from a trust-leap into a transparent, granular operation. ADR 0012 anchor-preservation still runs server-side on the post-merge result, so per-hunk selections can never produce a prompt the validator rejects.

### Scope

- **Frontend only.** No new server endpoints. The diff is computed in the browser from the existing `m.suggested_prompt` and `session.current_prompt` fields; selection state is local to the message node.
- `suggested_prompt` already arrives as a complete string from the server. We render a unified word-diff against `current_prompt`; the original `pre` block remains as a fallback when JS is disabled or for users who prefer raw view.
- Per-hunk checkboxes let the user accept or reject each change individually.
- The Apply button cycles through three states depending on selection:
  1. **Apply all** (default; no hunks toggled) — current behavior (apply entire `suggested_prompt`).
  2. **Apply selected** (some hunks accepted, others rejected) — server-side merge of selected hunks against `current_prompt` to produce a partial `current_prompt`.
  3. **No changes** (all hunks rejected) — disabled, with a "All hunks rejected — nothing to apply" hint.
- Anchor-preservation runs server-side on the post-merge partial prompt. If the partial prompt fails the validator, the apply is rejected with the same `declined_suggested_prompt` fallback as today; the user can retry with "Try as rewrite".

### Out of scope

- Line-level diff (we use word-level; line-level is too coarse for prose).
- Side-by-side view (unified inline is what the user expects from a chat; side-by-side eats vertical space).
- Diff persistence across reloads (selection state is per-message ephemeral).
- New endpoints. Reuses `POST /api/chat/sessions/:id/apply/:messageId` with an optional `partial_prompt` body field.

### User stories

- As a chat user with a 14-field structured prompt, I want to see exactly which words the AI wants to change before I click Apply, so I can decide whether each change is an improvement.
- As a chat user, I want to apply only the changes I like and reject the rest, so the AI's ideas become suggestions instead of take-it-or-leave-it edits.
- As a chat user, I want the diff to remain readable when the prompt is long, so I can scan changes without losing context.

### Implementation decisions

- Diff algorithm: hand-rolled word-level LCS (Longest Common Subsequence) over the two strings. Word-level granularity because prompt prose uses commas, periods, and parentheses that would create noise at character level. No external dependency; ~80 LOC in `src/app.js`.
- Three diff classes: `chat-diff__added` (green), `chat-diff__removed` (red, strikethrough), `chat-diff__context` (neutral).
- Hunk grouping: contiguous runs of the same class collapse into one hunk. A hunk is one or more word tokens. Each hunk has a checkbox; toggling a checkbox changes the hunk's `data-accepted` attribute and re-computes the proposed partial prompt.
- The proposed partial prompt is computed client-side: start with `current_prompt`, replace removed words with added words in each accepted hunk. This must be byte-identical to `m.suggested_prompt` when all hunks are accepted (round-trip property verified by a test).
- When the user clicks "Apply selected", send `{ partial_prompt: <merged string> }` in the apply request body. The server's `/apply/:messageId` endpoint accepts `partial_prompt` as an optional override of `suggested_prompt`; if present, the server runs anchor-preservation on it instead of on `m.suggested_prompt`.
- When all hunks are accepted, the client sends `{}` (no body) to keep the existing fast path.
- Visual: diff goes directly above the existing `chat-message__preview` block; the preview block is hidden when a diff is rendered (avoid duplicate text).

### Glossary

- **Hunk** — a contiguous run of added/removed/context words in the unified diff. A single "Edit " addition + "Edit " removal pair is one hunk.
- **Partial apply** — `POST /api/chat/sessions/:id/apply/:messageId` with body `{ partial_prompt }`. Distinct from full apply (no body) and wholesale rewrite (`PATCH /current_prompt`).
- **Diff view** — the inline UI replacing `chat-message__preview` for assistant messages with a `suggested_prompt`. Shows word-level additions/removals with per-hunk accept/reject checkboxes.

### References

- ARCH §27.A1–A4 (diff render path, partial-merge algorithm, hunk grouping, server-side validation re-use)
- PRE-MORTEM §27 (top risks + pre-commitments + kill criteria)
- docs/CODE-REVIEW-29-inline-diff.md (verdict pass)

### DoD

- [ ] `src/app.js`: `renderChatMessageDiff` helper + hunk grouping + partial-merge helper + DOM mutations in `buildChatMessageNode`.
- [ ] `src/styles.css`: `.chat-diff`, `.chat-diff__added`, `.chat-diff__removed`, `.chat-diff__context`, `.chat-diff__hunk`, `.chat-diff__hunk-checkbox` styles.
- [ ] `server.js`: `/apply/:messageId` accepts optional `partial_prompt` body; runs anchor-preservation on it; falls back to current behavior when absent.
- [ ] `tests/run-all.js`: ≥10 tests covering (a) diff round-trip (all-accepted → byte-identical to `suggested_prompt`), (b) partial-merge against `current_prompt`, (c) empty partial prompt rejection, (d) oversized partial prompt rejection, (e) anchor-preservation runs on partial_prompt, (f) declined partial → declined_suggested_prompt + declined_missing_terms populated, (g) HTML/CSS wiring, (h) server endpoint accepts partial_prompt body.
- [ ] `docs/CODE-REVIEW-29-inline-diff.md`: written with verdict `pass` or `pass+minor`.

## §23 — Bounded AI autonomy — patch + annotate protocol (CR-A8 / ADR 0027)

**Class:** Feature slice + ADR (0027). New mutators on the chat assistant message envelope; additive UI; respects anchor-preservation (ADR 0012).

### Reframe

The chat model is currently constrained to a single mutator: a full-prompt rewrite. This makes localised edits impossible to express, forces the model into "all-or-nothing" turns, and over-triggers the anchor-preservation decline path (ADR 0012). Adding two typed mutators — `patch` (deterministic text replace) and `annotate` (non-mutating hint) — gives the model the *shape* of its new freedom. The system prompt is rewritten within the existing persona to teach the model when to use each mutator. The validator still runs on the merged result, so the safety rail is preserved.

### Scope

- **Schema extension (additive).** Assistant message envelope grows from `{ reply, suggested_prompt }` to `{ reply, suggested_prompt, patches?, annotations? }`. Older clients ignore the new fields; new clients render them.
- **Server-side merge pipeline.** When `patches[]` is present, the server merges patches against `current_prompt` in declared order, producing the candidate `suggested_prompt`. The merge result runs through `validatePromptPreservation` exactly as today.
- **Patch rejection modes.** Patches with ambiguous `find` (multiple occurrences, `all_occurrences: false`) are rejected at parse time and stamped on the assistant message as `rejected_patches: [{ patch, reason }]`. The UI shows them so the user can see what the model *intended*.
- **Annotation pass-through.** Annotations are stored on the assistant message verbatim; the UI renders them as dismissible info-pills above the patch list. They do not affect `suggested_prompt`.
- **System prompt rewrite (additive).** `DEFAULT_CHAT_SYSTEM_PROMPT` gains one paragraph teaching the model when to use patches vs full rewrite vs annotation. The persona framing, anchor-preservation contract, RAG grounding, and JSON schema all remain.
- **UI affordances.** Each patch renders as a chip with Accept/Reject; annotations render as info-pills with Dismiss. Apply button cycles through Apply all / Apply selected / Nothing to apply (re-uses SPEC §22 infrastructure).
- **Audit trail.** Each assistant message gains `applied_patches`, `no_op_patches`, `rejected_patches` arrays for transparency.

### Out of scope

- **Multi-occurrence patch with semantic disambiguation.** A patch that targets `"red"` with `all_occurrences: false` in a prompt containing the word "red" three times is rejected. The model must lengthen `find` to disambiguate. This is correct behaviour; semantic disambiguation is out of scope.
- **Patch dependency tracking.** The server applies patches in declared order without coordination. If two patches target overlapping text, the second operates on the result of the first — natural composition order. Patch-dependency graphs are out of scope.
- **Annotation validation.** `annotations[].field` is free-form; the server does not enforce that it matches one of the 14 structured-prompt field names. The UI surfaces field names as-is.
- **Per-patch decline granularity.** If the post-merge result fails anchor-preservation, the *entire* revision is still declined (the union of patches is the candidate). Per-patch decline is a future optimisation.
- **Patch streaming.** Patches are emitted as part of the assistant message envelope; they do not stream independently. Future: streaming patches is a Slice I (Streaming responses) follow-up.

### User stories

- As a chat user, I want the model to make small, specific changes when my request is small and specific, so I don't have to reject whole rewrites just to keep one tweak.
- As a chat user, I want to see what each mutator will change before I commit, so I can accept the lighting tweak and reject the subject rephrasing in the same turn.
- As a chat user, I want the model to surface its uncertainty ("consider whether softer palette would read better") without forcing me to apply or reject, so I have a thinking partner, not a take-it-or-leave-it editor.

### Implementation decisions

- **Patch shape:** `{ find: string, replace: string, all_occurrences?: boolean }`. Default `all_occurrences: false`.
- **Annotation shape:** `{ field: string, note: string }`. Both strings trimmed; max lengths enforced (`field` ≤ 64 chars, `note` ≤ 280 chars).
- **Merge order:** declared in the array. The server does not re-order or coalesce patches.
- **Patch tracking:** `applied_patches[]` (success), `no_op_patches[]` (find didn't match), `rejected_patches[]` (ambiguous). Each tracked entry includes the original patch object plus a `reason` for the no-op / rejected paths.
- **Decline path:** same as SPEC §22 — `declined_suggested_prompt` + `declined_missing_terms` + declined-audit message. The UI doesn't need to distinguish whether the candidate came from `suggested_prompt` directly or from a patch merge; the validator measures the merged result.
- **System prompt location:** `DEFAULT_CHAT_SYSTEM_PROMPT` is the single source of truth (already a code constant per ADR 0011a / CR-1). The new paragraph is appended to the existing "REFINEMENT RULES" section.
- **UI diff re-use:** SPEC §22's `computeWordDiff` + `groupDiffIntoHunks` are reused to render the patch preview. Each patch's `find → replace` is rendered as its own mini-diff inside its chip, so the user sees the local context of the change.

### Glossary

- **Patch** — A typed mutator `{ find, replace, all_occurrences? }` emitted by the model. Applied by the server in declared order against `current_prompt`. Distinct from `suggested_prompt`, which is a wholesale rewrite.
- **Annotation** — A non-mutating flag `{ field, note }` emitted by the model. Stored on the assistant message; rendered as an info-pill in the UI; does not affect `suggested_prompt`.
- **Merge result** — The string produced by applying `patches[]` in order against `current_prompt`. This is the candidate that runs through anchor-preservation; if accepted, it becomes `suggested_prompt`.
- **Rejection reason** — A short string on `no_op_patches[]` or `rejected_patches[]` entries. Possible values: `'find_not_found'`, `'ambiguous_match'`, `'oversized'`, `'empty_replace'`.

### References

- ADR 0027 — design rationale + rejected alternatives + consequences.
- ARCH §28.A1–A5 (envelope extension, merge pipeline, system prompt diff, UI affordances, audit shape).
- PRE-MORTEM §28 (top risks + pre-commitments + kill criteria).
- docs/CODE-REVIEW-30-patch-protocol.md (verdict pass).
- ADR 0012 (anchor-preservation contract — the safety rail this slice cooperates with).
- SPEC §22 (inline-diff-on-Apply — the diff infrastructure this slice reuses).

### DoD

- [ ] `server.js`: `DEFAULT_CHAT_SYSTEM_PROMPT` gains the patch + annotate paragraph; chat route extracts and merges `patches[]`; tracks applied / no-op / rejected; merges against `current_prompt` to produce the validator candidate; records annotations on the assistant message.
- [ ] `src/app.js`: `buildChatMessageNode` renders patch chips + annotation pills; SPEC §22 `reassembleFromHunks` is re-used; new state slices for chip toggles.
- [ ] `src/styles.css`: `.chat-patches`, `.chat-patch-chip`, `.chat-annotations`, `.chat-annotation-pill`.
- [ ] `tests/run-all.js`: ≥15 tests covering (a) merge round-trip (patches → expected text), (b) ambiguous-match rejection, (c) no-op tracking, (d) annotation pass-through, (e) merged result runs through validator, (f) declined patch merge → declined_suggested_prompt + audit, (g) system prompt paragraph presence, (h) schema additive (older clients ignore new fields), (i) UI affordance wiring.
- [ ] `docs/CODE-REVIEW-30-patch-protocol.md`: verdict `pass` or `pass+minor`.

## §24 — Streaming responses (CR-A9 / SPEC §19 "ChatGPT-style polish" follow-up)

**Class:** Feature slice. New endpoint + client-side streaming UX. Additive; existing `POST /api/chat/sessions/:id/messages` unchanged.

### Reframe

Today, the user clicks Send and stares at a spinner for 5-30 seconds while the model thinks. The reply then appears all at once. This is high-friction latency that breaks the conversational feel. Streaming the reply token-by-token via Server-Sent Events gives the user immediate feedback and a sense of progress — ChatGPT-style. The endpoint re-uses the existing chat infrastructure (RAG retrieval, persona prompt, anchor-preservation, decline fallback) but pipes the model's output as `text/event-stream` chunks of incremental `reply` text.

### Scope

- **New endpoint.** `GET /api/chat/sessions/:id/messages/stream?content=<text>&provider=<id>&llmModel=<id>&attachment_ids=<csv>`. Streams `reply` text via Server-Sent Events (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`). Each chunk is `data: {"delta": "..."}\n\n`. The stream ends with `data: {"done": true, "message_id": "msg_...", "session": {...}}\n\n`.
- **Backend re-use.** The endpoint reuses `buildChatRequestContext`, `callKiloChat` (with the schema-drop retry), `applyChatPatches` (SPEC §23), and `validatePromptPreservation` (ADR 0012). When the stream completes, the full assistant message (with `reply`, `suggested_prompt`, `patches`, `annotations`) is persisted to `data/chat_sessions.json` exactly as the existing route does.
- **Client-side streaming.** The UI replaces the `submitChatMessage` flow with a new `submitChatMessageStreaming` flow that opens an `EventSource` (or `fetch` with `ReadableStream`), renders each `delta` chunk into a placeholder message node, and shows a "Stop generating" button that aborts the stream.
- **Stop affordance.** The client sends `AbortController.abort()` on click; the server detects the closed connection and stops emitting chunks. The partial message is persisted (truncated if the stream was aborted mid-response) with an `audit: { kind: 'stream_aborted' }` marker.
- **Error handling.** If the model errors mid-stream, the server emits `data: {"error": "..."}\n\n` and closes. The client renders the partial reply as a regular message + shows an error indicator.
- **Provider scope.** Streaming is supported for `kilo_code` only. For `minimax` and `alibaba`, the client falls back to the non-streaming `POST` route.

### Out of scope

- **Streaming patches.** `patches[]` and `annotations[]` are emitted as part of the final message envelope; they do not stream incrementally. Future: stream patches as they arrive (incremental patch protocol).
- **Bidirectional streaming.** SSE is one-way (server → client). The client sends the initial request via query string; subsequent updates use the existing non-streaming endpoints (`PATCH /current_prompt`, `POST /apply/:messageId`, etc.).
- **Reconnect on disconnect.** If the SSE connection drops mid-stream (network blip), the client does not auto-reconnect. The partial reply is persisted; the user can re-send their message to get a fresh stream.
- **Concurrent streams per session.** Only one stream per session at a time. If a second stream is requested while one is active, the server returns 409 Conflict.

### User stories

- As a chat user, I want to see the assistant's reply appear token-by-token, so I have immediate feedback and a sense of progress.
- As a chat user, I want to be able to stop a long generation mid-stream, so I don't waste time on a response I've already decided against.
- As a chat user, I want the streamed reply to land in the transcript when it completes, so I can scroll back to it.

### Implementation decisions

- **Transport: SSE.** Server-Sent Events are simpler than WebSockets for one-way streaming; they work over plain HTTP and are supported by all modern browsers via the `EventSource` API.
- **Chunk size.** The server emits one chunk per token (word or sub-word) as it arrives from the upstream provider. Chunk granularity is provider-dependent; the server passes through whatever it receives.
- **Persistence timing.** The full assistant message is persisted when the stream completes (server's last chunk). The client does not need to persist anything — the server is the source of truth.
- **Stop mechanism.** `AbortController` on the client; `req.on('close')` on the server. When the server detects the closed connection, it stops reading from the upstream and aborts the upstream call.
- **Idempotency.** Each stream generates a fresh `message_id`. There's no client-supplied id, so a re-send is a new message in the transcript.
- **HTTP method.** `GET` (SSE convention; the request is small enough to fit in query string). The endpoint accepts the same query parameters as the existing `POST` route's body.
- **Content-Type.** `text/event-stream`. Each chunk is `data: <json>\n\n`. Empty lines delimit events.

### Glossary

- **Stream chunk** — A single `data:` line in the SSE response. Each chunk carries a `delta` (incremental text), `done` (final marker), or `error` (mid-stream failure).
- **AbortController** — A browser API that lets the client cancel a fetch / EventSource connection. The server detects the close via `req.on('close')`.
- **Stream id** — The `message_id` returned in the final `done` chunk. Lets the client scroll to the new message in the transcript.

### References

- ARCH §29.A1–A4 (transport, server pipeline, client pipeline, error handling).
- PRE-MORTEM §29 (top risks + pre-commitments + kill criteria).
- docs/CODE-REVIEW-31-streaming.md (verdict pass).
- ADR 0012 (anchor-preservation contract — runs on the merged result, unchanged by streaming).
- ADR 0025 (RAG grounding — runs before the stream starts, unchanged).
- SPEC §22 / §23 (inline-diff + patch protocol — re-used by the streaming endpoint's persist step).

### DoD

- [ ] `server.js`: new `GET /api/chat/sessions/:id/messages/stream` endpoint that streams the model reply via SSE, reuses the existing context-building pipeline, persists the full assistant message on completion.
- [ ] `src/app.js`: `submitChatMessageStreaming` flow that opens an EventSource, renders deltas into a placeholder message, shows a "Stop generating" button.
- [ ] `src/styles.css`: typing indicator + Stop button styles.
- [ ] `tests/run-all.js`: ≥10 tests covering (a) endpoint registered, (b) streaming produces SSE response, (c) abort stops the stream, (d) final message persists, (e) error path emits `error` event, (f) concurrent streams return 409, (g) non-kilo_code providers fall back to non-streaming.
- [ ] `docs/CODE-REVIEW-31-streaming.md`: verdict `pass` or `pass+minor`.

## §25 — Notes enhancements: folders + image attachments (UI-R9)

**Date:** 2026-09-09
**Owner:** goose (autonomous, full-ownership per user directive)
**Predecessors:** §UI-R8 (Notes tab — personal notes for prompts, shipped 2026-09-09, commit pending)
**Status:** Draft → In Review → Approved (Gate G2)

### 25.1 Reframe

The Notes tab (§UI-R8) currently offers flat CRUD: create / edit / auto-save / filter / delete notes. This slice extends it along two orthogonal axes:

1. **Folders.** Add first-class folder organisation. Users can create, rename, and delete folders; notes belong to zero or one folder; folders can be reordered; notes can be moved between folders via drag-and-drop or an explicit "Move to…" menu.
2. **Image attachments.** Each note can carry 0..5 image attachments. Images upload via a dedicated endpoint, are stored on disk under `data/note_attachments/<note_id>/`, and render as inline previews in the editor + thumbnails in the list.

The two features share the same shell: the Notes tab gains a left-most **Folders** sidebar (above the existing search/list), and the editor panel grows an **Attachments** section above the meta/actions row.

### 25.2 Storage decision — explicit user ask: "evaluate localStorage / IndexedDB / embedded DB"

**Decision: keep JSON file + new disk directory for images.** Rationale:

- **Consistency.** The app already has six JSON-file stores (`data/*.json`) and two multer-on-disk stores (`uploads/`, `data/chat_attachments/`). Adding a seventh JSON file + a third disk dir is the smallest possible delta.
- **localStorage caps at ~5 MB per origin.** A single 50 KB body + 5 × 2 MB images already exceeds that on the first note. localStorage is not viable.
- **IndexedDB would require restructuring.** All existing modules read/write through `fs.readFileSync` + atomic rename. Switching one module to IndexedDB creates a split-brain (some state in browser, some on disk) — every cross-cutting consumer would have to know which is which. That's a project-wide refactor, not a slice.
- **Embedded DB (better-sqlite3, etc.)** would add a native dependency. The project has zero native deps today. Pulling one in for a single feature violates the project's "smallest possible footprint" stance (see PROJECT-README §1).
- **Atomic write + manifest pattern matches chat attachments.** `data/chat_attachments/_manifest.json` already proves this scales for a per-record subdir layout; we mirror it for notes.

If a future slice ever needs offline / cross-device sync, IndexedDB is the right answer **at that time**, when the whole project migrates together. Not now.

### 25.3 Data model

**Note (extended — additive only):**

```jsonc
{
  "id":        "note_<random>",
  "title":     "string (1..120)",
  "body":      "string (1..50000)",
  "job_id":    "string | null",        // unchanged
  "folder_id": "string | null",         // NEW: optional, FK to folders[].id or null = "Unfiled"
  "created_at":"ISO8601",
  "updated_at":"ISO8601"
  // attachments are NOT inlined — fetched on demand from /api/notes/:id/attachments
}
```

**Folder (new file `data/notes_folders.json`):**

```jsonc
{
  "id":         "folder_<random>",
  "name":       "string (1..60, trimmed non-empty)",
  "created_at": "ISO8601",
  "sort_order": "integer (0..N-1, used to order the sidebar)",
  "notes_count": "integer (denormalised cache; recomputed on every move / delete)"
}
```

Notes → folders relationship is one-to-many (one folder, many notes; one note, zero or one folder). No nesting in v1. Two notes are never forced into the same folder.

**Attachment (new directory `data/note_attachments/` + manifest `data/note_attachments/_manifest.json`):**

```jsonc
{
  "id":          "att_<random>",
  "note_id":     "note_<random>",
  "filename":    "string (sanitised original filename, max 200 chars)",
  "stored_name": "string (random hex + ext; on disk)",
  "mime":        "image/jpeg | image/png | image/gif",
  "size":        "integer (bytes; 1..5*1024*1024)",
  "created_at":  "ISO8601"
}
```

Mirrors the chat-attachments manifest pattern (`_manifest.json` lookup table → never trust URL for fs access).

### 25.4 API surface (additive only — no breaking changes to §UI-R8)

| Method | Path | Behaviour |
|---|---|---|
| GET | `/api/notes/folders` | List folders, ordered by `sort_order` asc, then `created_at` asc. |
| POST | `/api/notes/folders` | Create folder. Body `{ name }`. 201 with the new folder. |
| PUT | `/api/notes/folders/:id` | Rename folder. Body `{ name?, sort_order? }`. 200 with updated folder. |
| DELETE | `/api/notes/folders/:id` | Hard-delete folder. All notes with `folder_id === id` are reset to `folder_id: null` (move to "Unfiled"). |
| GET | `/api/notes/:id/attachments` | List attachments for a note, ordered by `created_at` asc. |
| POST | `/api/notes/:id/attachments` | Multipart upload. Single file field `"image"`. JPG/PNG/GIF only, max 5 MB. Reject if note already has 5 attachments (return 409). 201 with the new attachment. |
| GET | `/api/note-attachments/:id/file` | Stream the file bytes. Sets `Content-Type` from manifest, `Content-Disposition: inline` with sanitised filename. |
| DELETE | `/api/note-attachments/:id` | Hard-delete attachment: removes file + manifest entry. 200 with `{ id, deleted: true }`. |
| PUT | `/api/notes/:id/move` | Move note to folder. Body `{ folder_id: "folder_…" \| null }`. Validates folder exists (when non-null). 200 with updated note. |
| GET | `/api/notes` | **Extended**: optional `?folder=<id\|null\|unfiled>` filter. Default (no param) returns all notes. |
| POST | `/api/notes` | **Extended**: optional `folder_id` field in body. Validated. |
| PUT | `/api/notes/:id` | **Extended**: optional `folder_id` field. Validated (must exist or be null). |

New endpoints total: **10**. Updated endpoints: **3**. Total after this slice: **65 + 10 = 75** API endpoints.

### 25.5 Validation rules

| Field | Rule |
|---|---|
| Folder `name` | 1..60 chars after trim; non-empty. No HTML/control chars (sanitised for display). |
| Note `folder_id` | When present: must be a string matching `^folder_[a-f0-9]{16}$` AND must reference an existing folder, OR null. |
| Attachment `mime` | Whitelist: `image/jpeg`, `image/png`, `image/gif`. Mismatch → 400. |
| Attachment size | ≤ 5 MB. Mismatch → 413. |
| Attachment count per note | ≤ 5. Mismatch → 409 with `error: "Maximum 5 attachments per note"`. |
| Note delete cascade | When a note is deleted, its attachments folder + manifest entries are removed. |
| Folder delete cascade | Notes reset to `folder_id: null` (Unfiled). Their attachments are preserved. |

### 25.6 Frontend behaviour

**Layout** (rendered when `view === 'notes'`):

```
┌─ Sidebar ──────┐  ┌─ Toolbar (search / count / New) ─┐
│ 📁 All notes   │  ├──────────────────────────────────┤
│ 📁 Drafts      │  │ List of notes (filtered)         │
│ 📁 Reference   │  │   - click to load into editor    │
│ 📁 ...         │  └──────────────────────────────────┘
│ ──             │  ┌─ Editor (selected note) ─────────┐
│ ➕ New folder  │  │ Title                            │
│                │  │ Body (textarea)                  │
│                │  │ job_id (optional)                │
│                │  │ ────────────────────             │
│                │  │ Attachments                      │
│                │  │ [thumb][thumb][+]                │
│                │  │ ────────────────────             │
│                │  │ Meta · Save · Delete             │
│                │  └──────────────────────────────────┘
```

- **Sidebar sort order.** `sort_order` ascending, then `created_at` ascending. The "Unfiled" pseudo-folder is always shown first (above the user-created list) and is **not deletable**.
- **Drag-and-drop.** Two operations: (a) reorder folders in the sidebar, (b) drag a note onto a folder name in the sidebar to move it. Both use the existing `sortablejs` dependency (already in `package.json`; used by the Library view).
- **Folder empty / Unfiled empty.** When the selected folder is empty, the list region shows a placeholder ("No notes in this folder yet.").
- **Attachment thumbnail grid.** Up to 5 thumbnails in a CSS grid; the "+" tile opens a file picker. Click thumbnail → opens the file in a new tab (`/api/note-attachments/:id/file`). Hover shows a delete button.
- **Upload progress.** A `aria-busy` flag on the attachments region + a "Uploading…" live-region announcement. No progress bar (no XHR upload progress event; fetch with FormData is opaque).
- **Responsive.** Below 900px the sidebar stacks above the list (mirrors §UI-R8). Below 600px the attachment grid drops to 3 columns.
- **Keyboard / a11y.** All buttons focusable; sortablejs supports keyboard out-of-the-box for reorder. Folder list uses `role="listbox"`; folder items use `role="option"`; selected folder has `aria-selected="true"`. Attachment grid is a `role="list"` with `role="listitem"` per thumb.

### 25.7 Error handling

| Scenario | UX |
|---|---|
| Folder name conflict | 400 from server → toast: "Folder name required." (mirrors existing notes pattern). |
| Folder delete while notes still reference it | Cascade auto-runs server-side; UI re-fetches notes list; sidebar count updates. |
| Attachment upload wrong MIME | Toast: "Only JPG, PNG, GIF allowed." |
| Attachment upload too large | Toast: "Image must be 5 MB or smaller." |
| Note already has 5 attachments | Toast: "Maximum 5 attachments per note." |
| Attachment file deleted on disk out-of-band | GET /file returns 404 + manifest entry is auto-pruned on next read. |
| Server down | Existing 500 / network-error handling (live-region announcement). |
| Corrupt `notes_folders.json` | Forgiving read (return `[]`); `console.warn` like §UI-R8. |

### 25.8 Testing (≥15 new tests)

| # | Test |
|---|---|
| 1 | GET `/api/notes/folders` returns `[]` on a fresh install. |
| 2 | POST creates folder; 201 + folder_<hex> id. |
| 3 | POST rejects empty name; 400. |
| 4 | POST rejects name >60 chars; 400. |
| 5 | PUT renames folder; 200 + updated payload. |
| 6 | PUT updates `sort_order`; sidebar order reflects change after GET. |
| 7 | DELETE folder → notes with that folder_id reset to null. |
| 8 | GET `/api/notes?folder=<id>` filters correctly; `?folder=unfiled` returns folder_id=null only. |
| 9 | POST `/api/notes` accepts `folder_id`; persisted. |
| 10 | PUT `/api/notes/:id` rejects unknown `folder_id`; 400. |
| 11 | PUT `/api/notes/:id/move` to valid folder; 200; new folder_id in payload. |
| 12 | PUT `/api/notes/:id/move` to null ("Unfiled"); 200. |
| 13 | POST attachment: JPG accepted (binary, valid magic bytes); 201 + manifest entry. |
| 14 | POST attachment: BMP rejected (wrong MIME); 400. |
| 15 | POST attachment: 6 MB JPG rejected; 413. |
| 16 | POST attachment: 6th attachment rejected; 409. |
| 17 | GET `/api/notes/:id/attachments` lists only that note's attachments. |
| 18 | GET `/api/note-attachments/:id/file` streams correct bytes + Content-Type. |
| 19 | DELETE attachment removes file from disk + manifest entry. |
| 20 | Static: nav-bar still has 7 tabs; sidebar role=listbox; attachment grid role=list. |
| 21 | Static: 10 new routes registered (regex match + handler count). |
| 22 | Endpoint count: 75 (65 + 10). |

Existing UI-R8 tests stay green; total ≥ 591 tests after slice.

### 25.9 Out of scope (deferred to BACKLOG)

- Nested folders (tree-of-folders).
- Folder colours / icons.
- Bulk-move (multi-select + drag).
- Image thumbnails (server-side resize) — currently we render full-size and rely on `max-width: 100%` CSS scaling.
- Re-ordering notes within a folder (notes are ordered by `updated_at desc`).
- Cross-device sync (see §25.2 — IndexedDB migration deferred).
- Image OCR / vision caption (existing `/api/texture`-style per-field AI buttons could later be wired in).
- Folder import/export (mirrors §UI-R8: notes deliberately simpler than directives).

### 25.10 DoD

- [ ] `server.js`: §Notes module extended with folders, attachments, and move endpoints. Multer config for note attachments (5 MB cap, JPG/PNG/GIF whitelist, max 5 per note).
- [ ] `src/index.html`: Notes view gains sidebar + attachment grid markup.
- [ ] `src/styles.css`: sidebar styles, attachment grid, drag/drop visual feedback.
- [ ] `src/shell.js`: `§11 Notes folders + attachments` block; sortablejs wiring for sidebar reorder + drag-to-folder; upload + delete attachment handlers; cascade-delete handling.
- [ ] `data/notes_folders.json` + `data/note_attachments/` + `data/note_attachments/_manifest.json` created lazily on first use.
- [ ] `tests/run-all.js`: ≥22 new tests as listed in §25.8.
- [ ] `docs/CODE-REVIEW-UI-R9-notes-folders-attachments.md`: verdict `pass`.
- [ ] `README.md`: endpoint tables for folders, attachments, move.
- [ ] `docs/PROJECT-README.md`: 65 → 75 endpoints; mention folders + attachments.
- [ ] `docs/SESSION-STATE.md`: slice outcome, decisions log entry.
- [ ] `.gitignore`: ignore `data/notes_folders.json` and `data/note_attachments/` (per-user state, mirrors `data/notes.json`).
- [ ] No new ADRs (3-criteria test: §25.2's storage decision IS interesting enough to file as ADR 0028 → counted in §25.2).

### 25.11 ADR candidate

Filing **ADR 0028 — Notes persistence model: JSON file + disk manifest** to record:
1. The localStorage/IndexedDB evaluation rejected (reasons in §25.2).
2. The decision to mirror the chat-attachments pattern (`_manifest.json` + per-record subdir).
3. The "no native deps" constraint that drove the choice.

3-criteria test:
- Hard to reverse? **Yes** — once user notes + images are on disk in this layout, changing it means a one-time migration.
- Surprising? **Moderately** — developers often reach for IndexedDB without considering the migration cost; documenting the reasoning here is high-leverage.
- Trade-off / scope? **Yes** — explicitly chooses "no native deps" over "simpler API." That trade-off should be on record.

→ **Will file ADR 0028 in this slice.**

---

## §26 — Preservation override (CR-A10 / ADR 0029)

**Context.** The chat revision flow's anchor-preservation validator (ADR 0012) intentionally declines revisions that drop too much of the original context — the failure mode ADR 0012 was created to prevent is the wholesale rewrite that loses paint-application context, production requirements, and pre-defined values (hex codes, dimensions, technical parameters). The validator is binary: if the rewrite drops below the keyword/bigram retention threshold, the *entire* revision is declined with no Apply button and a "too much of the original context would have been lost" message.

In practice, users sometimes **intentionally** want a more permissive revision — "rewrite this in a punchier voice", "give me a fresh take that uses none of the same adjectives", "shorter and more dramatic". These requests legitimately want to drop anchor terms that the user explicitly doesn't want preserved. The current flow forces the user to either (a) rephrase with the existing "Try as rewrite" affordance that prefixes `REWRITE FROM SCRATCH — anchor set is empty` (which the validator then runs against and sometimes still rejects), or (b) abandon the chat and manually edit. Neither is great when the user knows what they're asking for.

This slice adds a **user-controlled override** that bypasses the validator for the targeted-revision case, while keeping a hard-floor safety against the catastrophic-total-rewrite case (where production requirements vanish with no warning). The override is opt-in, per-message, and requires explicit confirmation — it is not a sticky global setting, deliberately, because the most common accidental case ("I clicked the wrong button") produces the exact failure mode ADR 0012 was built to prevent.

**Decision.** Add a single new boolean request field `preservation_override` on the chat message body. When `true`, the server skips the `validatePromptPreservation` rejection path for that single message and returns the model's `suggested_prompt` directly, but only if the revision still passes a hard catastrophic-floor check. The hard floor is `PRESERVATION_OVERRIDE_CATASTROPHIC_FLOOR = 0.10` keyword retention — strictly below the existing 0.70 long / 0.50 short threshold, so it only catches the case where 90%+ of the original content tokens are gone. The override does NOT bypass the catastrophic floor; the catastrophic case still produces a decline with `fallback_reason: 'preservation_failed_catastrophic'`.

The override is **per-message, opt-in, with explicit confirmation** on the frontend. The UI shows a checkbox labeled "Allow revision with reduced preservation check" inside the existing declined-revision preview block (`chat-message__declined-actions`), positioned next to the existing "Try as rewrite" affordance. The checkbox must be checked AND a `window.confirm()` dialog must be approved before the user can resubmit. State is held in `state.chatPreservationOverride` and reset to `false` after each submission. There is no persistent or global setting; the user opts in every time.

Telemetry: each bypass appends a row to `data/preservation_override_log.json` with `{ timestamp, session_id, message_id, nonTargetedRatio, bigramRatio, missing_count, applied: true|false }`. The file is append-only, capped at 1000 rows (oldest are dropped when the cap is hit). Telemetry lets the project observe override usage frequency so future threshold tuning is data-driven rather than anecdote-driven.

**DoD.**

- [ ] `server.js` exports `PRESERVATION_OVERRIDE_CATASTROPHIC_FLOOR`, `recordPreservationOverrideTelemetry`, `readPreservationOverrideTelemetry`.
- [ ] `server.js` `callKiloChat` accepts `options.preservationOverride` and routes the override branch.
- [ ] `server.js` chat message route accepts `preservation_override` in the body and threads it through to `callKiloChat`.
- [ ] `server.js` streaming chat route accepts `preservation_override` (query param) and threads it through.
- [ ] `server.js` writes a telemetry row on every override (applied OR catastrophic-decline).
- [ ] `src/app.js` adds the override checkbox + label + confirmation prompt to the declined-revision block.
- [ ] `src/app.js` threads `preservation_override: state.chatPreservationOverride` into the request body.
- [ ] `src/app.js` resets `state.chatPreservationOverride` after each submission.
- [ ] `src/styles.css` styles the override control (`chat-message__override-control`, `chat-message__override-checkbox`, `chat-message__override-warning`).
- [ ] `tests/run-all.js`: ≥12 new tests covering the override's exports, hard-floor behavior, telemetry, full flow.
- [ ] `docs/CODE-REVIEW-34-preservation-override.md` verdict `pass`.
- [ ] `docs/SESSION-STATE.md`: slice outcome, decisions log entry.
- [ ] `README.md`: chat-flow notes mention override; mention telemetry file.
- [ ] No regression in the 569 baseline tests.
- [ ] ADR 0029 filed.

**Out of scope (deferred to BACKLOG).**

- Per-session or per-model override settings (explicitly NOT in scope per design rationale).
- UI-driven threshold tuning (the user would have to see the validator report and choose; far more complex than per-message override).
- Override for the partial-apply path (`POST /api/chat/sessions/:id/apply/:messageId` with `partial_prompt`); the override is message-time only.



## §27 — Clear chat history (global erase, CR-A11)

**Context.** The existing chat flow has a per-session delete (`DELETE /api/chat/sessions/:id`, CR-2) that removes one conversation at a time, but no global "clear all" affordance. The Settings tab currently scopes itself to "defaults + system prompts; resists accretion" (UI-R4 §Deviations); this slice is a deliberate, user-approved accretion that adds a destructive-data panel for a one-time, irreversible cleanup action. The placement in Settings (rather than inside the Chat view) follows the platform convention every chat app uses: destructive bulk actions live in settings, not in the primary workflow surface.

The chat history is server-authoritative. All sessions live in `data/chat_sessions.json` (currently 50 sessions at the cap from CR-21); all attachment files live in `data/chat_attachments/<session_id>/<random-filename>` (currently 503 directories on disk, with 7 referenced attachment_ids in active sessions — many orphans from past deletes). There is **no client-side chat cache** — `localStorage` holds only model/variant/llmModel/provider keys (`i2p.state.model`, `i2p.state.animaVariant`, `i2p.state.llmModel`, `i2p.state.provider`); no `i2p.chat.*`, no `i2p.session*`, no IndexedDB, no ServiceWorker.

**Decision.** Add a **global clear** that permanently deletes every chat session, every attachment directory, and the attachments manifest — server-side — then resets the client's in-memory chat state, repaints the chat view, and clears any defensive `localStorage` keys matching `i2p.chat*` / `i2p.session*` (none today, but the sweep is included so a future client-cache addition won't accidentally leave data behind). The bulk endpoint `DELETE /api/chat/sessions` is a sibling of the per-session `DELETE /api/chat/sessions/:id`; both share the same cascade-delete helper. The Settings tab gains one new panel "Chat data" with one danger-styled button labeled "Clear chat history". The button opens a modal that shows the current session count + attachment count, requires the user to click a second "Erase all" button to confirm, and is dismissible by Cancel / Escape / backdrop click. After success, the chat view resets to its empty state and the chat session dropdown returns to "— No conversations yet —".

**Scope.**

- **Server (server.js):**
  - New endpoint `DELETE /api/chat/sessions` (no path params). Behavior: read all sessions, capture counts, atomically write `[]` to `CHAT_SESSIONS_FILE`, sweep every directory under `CHAT_ATTACHMENTS_DIR` whose name starts with `CHAT_SESSION_ID_PREFIX` (handling both the manifest-tracked and orphan cases by using a directory-list-based sweep rather than relying on the manifest), reset the attachments manifest to `[]`. Returns `{ success: true, data: { deleted_sessions, deleted_attachments, orphan_directories_removed } }`. 500 on partial failure with sanitized error.
  - New exported helper `clearAllChatSessions()` that encapsulates the read-clear-write-unlink-sweep sequence and returns the counts. Mirrors the shape of `cascadeDeleteChatSessionAttachments`.
  - The sweep uses `fs.readdirSync(CHAT_ATTACHMENTS_DIR)` and `fs.rmSync(dir, { recursive: true, force: true })` for each `chat_*` directory; failures are collected and reported but do not abort the rest of the sweep.

- **Settings UI (src/index.html):**
  - New panel `<div class="panel settings-panel">` with title "Chat data" and a single danger-styled `<button id="settings-clear-chat-history-btn" type="button" class="btn-danger-outline">Clear chat history</button>`. A short `<p class="settings-hint">` warns that the action is irreversible and what it removes.
  - New modal `<div id="clear-chat-history-modal" class="modal" hidden role="dialog" aria-labelledby="clear-chat-history-modal-title">` containing: heading, warning paragraph with live session count + attachment count, two buttons (`#clear-chat-history-cancel`, `#clear-chat-history-confirm`).
  - The Settings panel sits **after** the existing "System prompts" panel, as the third and final panel in the view.

- **Frontend (src/shell.js + src/app.js):**
  - `shell.js` wires the button to: GET counts (via existing `/api/chat/sessions` and a new `GET /api/chat/attachments/count` endpoint, OR by fetching the full session list and counting `attachments` directories on the server), populate the modal text, open the modal. On confirm: POST/DELETE the bulk endpoint, then call a new `onChatHistoryCleared()` exported by `app.js` that resets `state.chatSessions = []`, `state.chatSessionId = null`, `state.chatPendingAttachmentIds = []`, `state.chatPendingAttachmentMeta = {}`, calls `resetChatConsole()`, and calls `renderChatSessionSelect()`.
  - Defensive `localStorage` sweep: iterate `Object.keys(localStorage)` and remove any key matching `/^i2p\.(chat|session)\b/i`. The slice asserts in a test that the sweep runs.
  - Error UX: on 500 or network failure, show inline error in the Settings panel via the existing `#settings-status` line, with a "Try again" hint. On success, announce "All chat history cleared" via the existing `announce()` helper (screen-reader live region).
  - Loading state: while the bulk DELETE is in flight, disable both modal buttons + show a spinner glyph on the confirm button. Re-enable on response (success OR failure).

- **Accessibility (a11y):**
  - The button uses `class="btn-danger-outline"` (the existing project danger style from `chat-session-delete-btn`), which has `:focus-visible` and `:hover` states already styled.
  - The modal inherits the existing focus-trap infrastructure (`bindModalTraps` in shell.js), so Tab cycling and Escape-to-dismiss work for free.
  - On confirm, focus returns to the invoker button (already handled by the trap infrastructure's `MutationObserver`).
  - The warning paragraph names the consequence and the count, so screen-reader users hear "This will permanently delete all 50 chat sessions and 503 attachment files." before they confirm.

**Out of scope (deliberately).**

- `data/preservation_override_log.json` — usage telemetry from §26's override feature, NOT user-visible chat history. The user explicitly excluded this at G1 ("preserve_override_log NOT cleared"). The bulk endpoint does NOT touch it.
- `data/rag_corpus/`, `data/rag_index.json` — the curated RAG index, not chat content.
- `data/palettes.json`, `data/presets.json`, `data/directives.json`, `data/notes.json`, `data/provider_keys.json`, `data/model_config.json`, `data/subject_prompt.json`, `data/stage2_overrides.json` — none of these are chat history.
- A typed-phrase confirmation gate (e.g. "type ERASE to confirm"). The modal + explicit count is sufficient. If the user later wants a stronger gate, that's a separate slice.
- A bulk-undo or staging buffer. The action is irreversible by design.
- A keyboard shortcut for clearing. Discoverability via Settings is enough; keyboard shortcuts are a separate concern.
- Selective deletion (e.g. "delete only sessions older than 30 days"). Single global erase only.

**Implementation decisions (locked at G1).**

1. Placement: Settings tab, after "System prompts" panel.
2. Confirmation: two-factor via modal — Cancel button + Erase button (no typed phrase).
3. `preservation_override_log.json`: NOT cleared.
4. ADR: NOT filed (additive, follows the established pattern, no architectural change).

**DoD.**

- [ ] `server.js` exports `clearAllChatSessions` (returns `{ deleted_sessions, deleted_attachments, orphan_directories_removed }`).
- [ ] `server.js` route `app.delete('/api/chat/sessions', …)` registered, validates method-not-allowed for non-DELETE, returns 200 with counts.
- [ ] `server.js` route `app.get('/api/chat/sessions/count', …)` (or equivalent) returns `{ sessions, attachments }` for modal text population.
- [ ] `data/chat_sessions.json` is atomically rewritten to `[]` after clear.
- [ ] All `data/chat_attachments/chat_*/` directories are removed (manifest-tracked + orphans).
- [ ] `data/chat_attachments/_manifest.json` is reset to `[]`.
- [ ] `src/index.html` adds the Settings "Chat data" panel (`#settings-clear-chat-history-btn`).
- [ ] `src/index.html` adds the confirmation modal (`#clear-chat-history-modal` with cancel/confirm buttons).
- [ ] `src/shell.js` wires the button → fetch counts → open modal → on confirm call bulk endpoint + `app.onChatHistoryCleared()`.
- [ ] `src/app.js` exports `onChatHistoryCleared` that resets `state.chatSessions`, `state.chatSessionId`, `state.chatPendingAttachmentIds`, `state.chatPendingAttachmentMeta`, calls `resetChatConsole()`, `renderChatSessionSelect()`, and sweeps `localStorage` for `i2p.chat*` / `i2p.session*`.
- [ ] `src/styles.css` adds minimal styles for the new panel + modal (if not covered by existing modal classes).
- [ ] `tests/run-all.js`: ≥12 new tests covering: route returns 200 with counts; `data/chat_sessions.json` becomes `[]`; every attachment directory removed; manifest reset; counts are accurate; orphan-only case (sessions=0 but attachments present); empty case (sessions=0, attachments=0); partial-failure case (one bad attachment dir, others removed, response reports the failure); per-session delete still works (no regression); frontend wiring (`onChatHistoryCleared`, modal handlers, localStorage sweep); SPEC §27 cross-references in tests.
- [ ] `docs/CODE-REVIEW-27-clear-chat-history.md` verdict `pass`.
- [ ] `docs/SESSION-STATE.md`: slice outcome, decisions log entry, slice tracker row.
- [ ] `docs/BACKLOG.md`: append slice-outcome entry (append-only; if any out-of-scope items surface during implementation, append them as backlog items too).
- [ ] `README.md`: optional — brief mention in the chat section is nice but not blocking.
- [ ] No regression in the 589 baseline tests.
- [ ] Manual browser demo: open Settings tab, click "Clear chat history", confirm modal shows correct counts, click Cancel → nothing changes; click Clear chat history again, confirm → modal closes, chat view resets, server file is `[]`, attachment dir is empty (or only contains `_manifest.json`), reload page → still empty.

**Glossary.**

- **Bulk clear** — the irreversible deletion of all chat sessions, their message histories, and their attachment files, initiated from the Settings tab. Distinguished from the per-session delete (`DELETE /api/chat/sessions/:id`), which removes one session.
- **Orphan directory** — a `data/chat_attachments/chat_*/` directory that is not referenced by any active session in `data/chat_sessions.json` and not present in `_manifest.json`. May exist due to prior crashes, manual filesystem manipulation, or incomplete prior deletes. The bulk clear sweeps these too.

**References.**

- `server.js` lines 9672–9692 — the existing per-session `DELETE /api/chat/sessions/:id` route, whose pattern this slice mirrors.
- `server.js` lines 9940–9958 — the existing `cascadeDeleteChatSessionAttachments` helper.
- `src/app.js` lines 6516–6530 — the existing per-session `deleteChatSession` frontend handler.
- `src/app.js` lines 4672–4691 — the existing `resetChatConsole` helper.
- `src/app.js` lines 5717–5750 — the existing `renderChatSessionSelect` helper.
- `src/index.html` lines 513–580 — the existing Settings view layout (panel order: Defaults, System prompts).
- `src/shell.js` lines 320–367 — the existing focus-trap infrastructure (modals are auto-trapped).
- `docs/CODE-REVIEW-UI-R4-chat-settings.md` §Deviations — the prior decision on Settings scope ("resists accretion") that this slice deliberately overrides per G1.
