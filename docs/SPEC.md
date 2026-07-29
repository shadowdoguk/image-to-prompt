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

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Initial draft (Slice 1) | Phase C of `goose-review`; user selected Candidate 1 (texture AI button) at the Phase C prompt |