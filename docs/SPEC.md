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