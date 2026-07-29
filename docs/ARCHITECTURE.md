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