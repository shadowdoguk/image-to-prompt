# CONTEXT — image-to-prompt

Domain language, concepts, and entities for this project. Skills read this first.

## What this project is

An AI-powered web application that transforms an uploaded image into a refined,
detailed text prompt suitable for downstream image-generation models (Stable
Diffusion, Midjourney, DALL-E, Flux). The provider is the **Kilo AI Gateway**
(`api.kilo.ai`), an OpenAI-compatible gateway to 500+ models (ADR 0022).
Default LLM model: MiniMax M3 (`minimax/minimax-m3`).

The product has two top-level surfaces:

1. **Backend** — Node.js + Express, owns the MiniMax API key, runs the two-stage
   analysis pipeline, persists presets on disk.
2. **Frontend** — vanilla HTML/CSS/JS served as static assets; no build step.

## Pipeline stages

```
   upload(image, presetId)         user edits + adds directives
         │                                       │
         ▼                                       ▼
    ┌─────────────┐   ┌──────────────┐   ┌─────────────┐
    │  Stage 1    │ → │  Stage 1.5   │ → │  Stage 2    │
    │  Vision LLM │   │ orientation  │   │  Text LLM   │
    │  + length   │   │ + actions    │   │  synthesize │
    │  validation │   │ (optional)   │   │  final p.   │
    └─────────────┘   └──────────────┘   └─────────────┘
         structured JSON w/ all stage1_fields
               │
               │  "Populate with AI" (ADR 0004)
               │  user clicks → /api/subject → subject-only refresh
               ▼
    ┌────────────────────┐
    │  Subject re-analysis │ factual-only prompt, preset-independent
    │  (Stage 1.S)         │ excludes style / medium / aesthetic
    └────────────────────┘
               │
│  "Populate with AI" (ADR 0008)
                │  user clicks → /api/camera-angle → camera-only refresh
                ▼
     ┌───────────────────────┐
     │  Camera-angle re-analysis│ camera-only prompt, preset-independent
     │  (Stage 1.C)             │ excludes subject / lighting / color /
     │                          │ mood / style / medium
     └───────────────────────┘
                │
                │  "Populate with AI" (ADR 0018)
                │  user clicks → /api/actions, /api/mood, /api/lighting
                │  → actions / mood / lighting-only refresh
                ▼
     ┌──────────────────────────────────────────────────────┐
     │  Actions / Mood / Lighting re-analysis  (Stage 1.A / │
     │  1.M / 1.L) — focused per-field prompts, preset-     │
     │  independent. Mood and Lighting additionally ship    │
     │  with curated preset chips (5 categories each) that  │
     │  the user can click for a zero-credit quick override. │
     │  Actions gets the AI button only (no presets — too   │
     │  image-specific for a curated taxonomy).              │
     └──────────────────────────────────────────────────────┘
```

- **Stage 1** is always run. Produces a JSON object containing every field in
  the chosen preset's `stage1_fields`. Has a built-in retry-with-strengthened-prompt
  if the LLM output violates minimum-length contract.
  **Palette override (ADR 0006):** when the user has selected a saved palette
  in the Step 1 picker, the `colors` field is stripped from `stage1_fields`
  for this run (so the LLM does not extract colors), the system prompt gets a
  one-line instruction not to speculate colors, and the saved palette's
  colors are injected into the analysis response in place of the (absent)
  Stage 1 colors.
- **Stage 1.5** runs ONLY if `subject_orientation` and/or `actions` is in the
  preset's `stage1_fields`. Runs a dedicated, focused analysis. Its output
  overwrites the corresponding Stage 1 fields.
- **Stage 1.S** (Subject re-analysis, ADR 0004) runs ONLY when the user clicks
  the "Populate with AI" button beneath the `subject` textarea in the analysis
  editor. Calls `/api/subject` with a factual-only system prompt that excludes
  artistic style, creative medium, and aesthetic commentary, and covers five
  factual categories (people, locations, spatial arrangement, objects,
  contextual details). Independent of the active preset. Updates the
  `subject` textarea in place — does not re-render the analysis editor.
  The system prompt itself is editable (ADR 0005): it lives at
  `data/subject_prompt.json`, seeded with the shipped default on first
  read, and can be overridden from the "Edit prompt" modal in the UI.
- **Stage 1.C** (Camera-angle re-analysis, ADR 0008) runs ONLY when the user
  clicks the "Populate with AI" button beneath the `camera_angle` input
  field in the analysis editor. Calls `/api/camera-angle` with a camera-only
  system prompt that excludes the subject itself, lighting, color, mood,
  style, and medium, and covers five camera-angle categories (position,
  orientation, lens impression, movement, frame geometry). Independent of
  the active preset. Updates the `camera_angle` input in place — does not
  re-render the analysis editor. The system prompt is the shipped default
  constant `DEFAULT_CAMERA_ANGLE_PROMPT` in `server.js`; a UI editor is
  out of scope for ADR 0008 (the camera-angle contract is narrower than
  the subject factual contract, so user iteration is less likely).
- **Stage 1.T** (Texture re-analysis, Slice 1 — App Build methodology,
  pattern-mirrors ADR 0018) runs ONLY when the user clicks the "Populate
  with AI" button beneath the `texture` textarea in the analysis editor.
  Calls `/api/texture` with a texture-only system prompt that excludes the
  subject, lighting, color, mood, composition, style, and medium, and
  covers five texture categories (surface quality, mark-making / tool
  traces, material identification, pigment interaction, tactile cues).
  Independent of the active preset. Updates the `texture` textarea value
  in place — does not re-render the analysis editor. The system prompt is
  the shipped default constant `DEFAULT_TEXTURE_PROMPT` in `server.js`.
  Texture is image-specific and resists a curated chip taxonomy (mirror
  ADR 0018 §5 / Slice 1 SPEC §8); only the AI button is rendered, no
  curated chips. Texture is the 6th per-field vision endpoint, joining
  subject (Stage 1.S), camera_angle (Stage 1.C), actions, mood, and
  lighting from ADR 0018.
- **Stage 2** runs ONLY when the user explicitly clicks "Generate prompt" with
  an edited analysis + optional directives. Synthesizes the final image-gen prompt.
  The system prompt used for Stage 2 is resolved at call time:
  `data/stage2_overrides.json[preset.id]` if a per-preset override exists
  (ADR 0007), otherwise the preset's built-in `stage2_system_prompt`. The
  override is editable from the "Edit prompt" button beside "Generate prompt".
  The `directives` field sent to Stage 2 is the current textarea content
  at click time — saved directives (ADR 0009) are a library of pre-written
  inputs that the user loads into the textarea via Apply; the textarea is
  always the source of truth at generation time. **ADR 0014 (implemented):**
  when a weighted palette is supplied (optional `paletteId` in the body),
  the Stage 2 user message is augmented with a deterministic
  `buildColorBudgetBlock` derived from the palette's per-color weights +
  accents; the response envelope gains a `palette_id`, `palette_name`, and
  `distribution_metrics` field from `measureColorDistribution`. The block is
  omitted for "pure legacy" palettes (no user-customized weighting) so
  existing palettes behave unchanged. **ADR 0015 (implemented):** the
  "Gestural alla prima oil painting" preset family (`preset_alla_prima_oil`,
  `preset_968c0ccdf6fc6151`) uses the canonical Z-Image Turbo final-prompt
  contract, defined as the code constant `DEFAULT_ZIMAGE_STAGE2_PROMPT` in
  `server.js`. The preset's on-disk `stage2_system_prompt` is the 28-char
  sentinel string `DEFAULT_ZIMAGE_STAGE2_PROMPT`; `getEffectiveStage2Prompt`
  substitutes the canonical constant after override resolution. The contract
  drives a two-section output: **Section A** is a 80–200-word prose
  description (subject + spatial position, color → region binding in priority
  order, impasto paint-handling language, lighting, style declaration,
  compositional constraints); **Section B** is structured metadata
  (`color_map`, `priority_order`, `accent_overrides`, `accent_regions`,
  `gestural_elements`, `style_confidence`, `composition_note`,
  `word_count_section_a`). The style anchor for "user_unspecified" / "artistic
  / painterly / expressive / abstract" requests is the verbatim heavy impasto /
  gestural alla prima description (palette-knife ridges, scraped dragged
  smeared paint, gestural streaks radiating outward, alla prima freshness).
- **Stage 2.5 (Post-generation chat, ADR 0011)** activates the moment
  Stage 2 returns successfully. The frontend posts the new prompt +
  analysis snapshot to `/api/chat/sessions`; the server mints a fresh
  `chat_<16 hex>` session anchored to that run. The chat session tracks three prompt fields with distinct semantics: `original_prompt` is the immutable Stage 2 output, `current_prompt` is the user-committed working prompt, and `pending_prompt` is an optional unapplied model proposal. Discussion turns ("why this framing?") do not change prompt state and return `suggested_prompt: null`. Recommendation and refinement turns ("make the lighting more dramatic") update `pending_prompt` only — never `current_prompt`. The user commits a pending proposal to `current_prompt` via an explicit "Apply proposal" button (or a deterministic explicit text command). The chat provider context is bounded at 20,000 characters using the compact analysis snapshot plus recent history. Revisions still return a JSON `{ reply, suggested_prompt }` envelope. `messages[]` is append-only; sessions survive server restarts. ADR 0011a added a defensive parser + retry loop + frontend hardening. **ADR 0012 (anchor-preservation)** layers a wholesale-rewrite guard on top: the system prompt reframes the assistant's job as "edit, do not regenerate" (with an inventory-classify-apply contract and contrasted examples), and a server-side validator (`validatePromptPreservation`) scores every revision against the current working prompt and retries with a reinforcement message if too much of the original context was lost — declining the revision (no Apply button) if the model can't produce a targeted edit.

## Core entities

| Entity | Storage | Identity | Notes |
|---|---|---|---|
| Preset | `data/presets.json` | `id` (`preset_<16 hex>`) | name, stage1_system_prompt, stage1_fields, stage2_system_prompt, created_at, updated_at |
| Field | in code (`FIELD_PALETTE`) | name (string) | 14 fixed fields. Has `type` (string\|array), `label`, `input` (textarea\|text\|colors) |
| Upload | ephemeral `uploads/` | filename | Created by multer, deleted after Stage 1 |
| Stage 1 output | transient (response) | field names match palette | Validated against `FIELD_INPUT_MIN_LENGTH` |
| Analysis | transient (response) | JSON w/ palette fields | Edited by user in UI between Stage 1 and Stage 2 |
| Run | transient (response) | `id` (`run_<16 hex>`) | Minted on every `POST /api/analyze`; returned in response envelope. Captured by the "Save palette" modal as `source_run_id`. |
| Saved palette | `data/palettes.json` | `id` (`palette_<16 hex>`) | name, colors, source_run_id, source_preset_id, created_at, updated_at, history[] (ADR 0006, ADR 0013). Colors input accepts hex / rgb() / hsl(); stored canonically as `{ hex: '#rrggbb', name }`. Selected via the Step 1 picker; overrides the auto-analyzed `colors` field when applied. Editable in place via the edit modal (name + add/remove/rename colors); every write appends a `history[]` entry capturing the post-write state, and `POST /:id/restore/:version` rolls back to a prior entry. Brand-new palettes from scratch are created via `POST /api/palettes/custom` (no source_run_id required; `source_preset_id` optional). **ADR 0014 (implemented):** per-color `weight` (1–10, default 5), per-color `accent` boolean (default false), palette-level `accent_max_mentions` (1–5, default 2). The server synthesises defaults for legacy palettes on read; the first PUT normalises the on-disk shape. All three fields round-trip through `snapshotPalette` + `restorePaletteVersion` so palette history faithfully captures the weighted state. |
| Palette run telemetry | `data/palette_runs.json` | n/a (append log) | **ADR 0014 (implemented).** Per-palette capped log (≤50 entries) of `measureColorDistribution` outputs from each Stage 2 run that used a saved palette. Driven by `appendPaletteRun` inside `/api/generate-prompt`. Read via `GET /api/palettes/:id/distribution` (404 when no runs yet) for the Phase 4 distribution dashboard. |
| Subject prompt | `data/subject_prompt.json` | n/a (single global) | System prompt for `POST /api/subject` (ADR 0005). Editable from UI; seeded with the shipped default on first read. |
| Camera-angle prompt | code constant `DEFAULT_CAMERA_ANGLE_PROMPT` in `server.js` | n/a (single global) | System prompt for `POST /api/camera-angle` (ADR 0008). NOT persisted to disk — the shipped default is the source of truth at runtime. UI editor is out of scope for ADR 0008. |
| Actions / Mood / Lighting prompts | code constants `DEFAULT_ACTIONS_PROMPT`, `DEFAULT_MOOD_PROMPT`, `DEFAULT_LIGHTING_PROMPT` in `server.js` | n/a (single global each) | System prompts for `POST /api/actions`, `POST /api/mood`, `POST /api/lighting` (ADR 0018). NOT persisted to disk — shipped defaults are the source of truth at runtime. UI editor is out of scope for ADR 0018. |
| Mood / Lighting curated presets | code constants `MOOD_PRESETS`, `LIGHTING_PRESETS` in `src/app.js` | n/a (single global each) | Static, code-defined taxonomies of one-click descriptors rendered as chips beneath the Populate-with-AI button on the `mood` and `lighting` fields (ADR 0018). NOT persisted (unlike saved directives, ADR 0009) — they are a canonical taxonomy shared by every user. Mood: 5 categories × 7-9 items (Positive / Reflective / Intense / Atmospheric / Still). Lighting: 5 categories × 6-8 items (Natural / Directional / Quality / Stylized / Studio). Clicking a chip sets the field value to the chip's label and updates `state.currentAnalysis`. The user is free to edit the value after clicking — chips are a quick starting point, not a lock. |
| Stage 2 override | `data/stage2_overrides.json` | `presetId` | Per-preset override of `preset.stage2_system_prompt` (ADR 0007). Editable from UI via the "Edit prompt" button beside "Generate prompt". When present, used instead of the preset's built-in Stage 2 prompt on the next `POST /api/generate-prompt`. |
| Saved directive | `data/directives.json` | `id` (`directive_<16 hex>`) | name, content, tags, history[], usage_count, last_used_at, created_at, updated_at (ADR 0009). Selectable from the apply `<select>` below the directives textarea; editable from the Manage modal; rollback via version history; importable / exportable as `.i2p.json` envelope. The textarea is the source of truth at Stage 2 time; saved directives are a library loaded into the textarea via Apply. |
| Chat session | `data/chat_sessions.json` | `id` (`chat_<16 hex>`) | preset_id, preset_name, run_id, title, original_prompt, current_prompt, pending_prompt, analysis_snapshot, messages[], created_at, updated_at (ADR 0011). Anchored to a finished Stage 2 run; activated immediately after `displayResult`. `original_prompt` is the immutable Stage 2 output; `current_prompt` is the user-committed working prompt; `pending_prompt` is an optional unapplied model proposal. Discussion turns do not change prompt state; recommendation and refinement turns update `pending_prompt` only — never `current_prompt`. Apply proposal commits `pending_prompt` to `current_prompt`. `messages` is append-only (`role: user \| assistant`, `content`, `suggested_prompt: string \| null`, `timestamp`). Persists across server restarts. Chat provider context is bounded at 20,000 characters using the compact analysis snapshot plus recent history. |
| Issue | GitHub Issues (planned) | number | Tracked via `gh` CLI per `docs/agents/issue-tracker.md` |
| ADR | `docs/adr/NNNN-*.md` | filename | Architectural decisions; immutable once Accepted |

## Field palette (canonical, 14 fields)

textarea: `subject`, `subject_orientation`, `actions`, `mood`, `composition`, `texture`
text: `style`, `lighting`, `era`, `camera_angle`, `artistic_medium`, `depth_of_field`, `contrast`
colors: `colors` (array of `{hex, name}`)

**Per-field re-analysis endpoints (ADR 0004 / 0008 / 0018):** five of these
fields — `subject`, `camera_angle`, `actions`, `mood`, `lighting` — have
dedicated "Populate with AI" buttons in the analysis editor. Each posts the
uploaded image to a focused, preset-independent endpoint and updates the
field's value in place. `mood` and `lighting` additionally ship with
curated preset chip taxonomies (ADR 0018 §4) that provide zero-credit
quick-pick overrides alongside the AI option.

## Accuracy contract (per ADR-0001)

HIGH-CONFIDENCE (≥90% expected): garment type/color, facing direction, primary
facial expression, major surrounding objects, scene classification.

BEST-EFFORT (hedge with "appears to be / likely / possibly"): textile material,
micro-expressions, single-frame activity inference.

The 90% threshold is NOT enforced via CI gate (user explicitly opted out of a
benchmark dataset and CI validation harness in ADR-0001).

## Configuration sources (in priority order)

1. **Environment variables** (`.env` → `process.env`) — required for `KILO_API_KEY`.
2. **Field palette constants** in `server.js` — single source of truth for the
   Stage 1 schema and edit UI.
3. **Preset JSON** in `data/presets.json` — user-modifiable, persisted via API.
4. **Export envelope** `.i2p.json` (`PRESET_FILE_FORMAT` = `image-to-prompt-preset`,
   `PRESET_FILE_VERSION` = 1) — interop format for sharing presets.

## Conventions

- One issue per concern. Apply a triage label on creation if state is known.
- Reference issues in commits as `#N` (git is initialised; see Resolved gaps).
- ADRs use the `docs/adr/NNNN-kebab-title.md` filename pattern, increment NNNN.
- Preset IDs are `preset_<16 hex chars>`; never reuse.
- Uploaded files MUST be deleted from `uploads/` after processing (success or error).
- API key MUST stay server-side; never sent to the client; never logged.

## Deployment

This is a Node.js + Express app with a vanilla HTML/CSS/JS frontend
(no build step). The deploy mechanism is local-desktop, not
container/cloud:

- `scripts/start-detached.sh` — kills any stale `node server.js`,
  starts `npm start` detached (logs to `.data/start.log`), polls
  `GET /api/health` for readiness, opens the browser at
  `http://localhost:${PORT}` (default 3100). Idempotent: if the
  server is already running, it just re-opens the browser.
- `scripts/make-icon.py` — generates `~/.local/share/icons/image-to-prompt.png`
  (the app icon for the desktop launcher).
- `~/.local/share/applications/image-to-prompt.desktop` —
  XDG desktop launcher pointing at `scripts/start-detached.sh`.
  Install path is per-user; the desktop file itself lives outside
  the repo (it's the user's launcher, not the project's).

The deploy flow is "click the desktop icon". For headless starts
(no GUI), run `bash scripts/start-detached.sh` directly and tail
`.data/start.log`. There is no Dockerfile, no CI/CD, no cloud
target — the single-user desktop pattern is the deployment.

## Resolved gaps (formerly "Known gaps")

The original CONTEXT.md listed five known gaps; all five are now
resolved. Tracked here so the audit trail is clear:

1. **Git repository** ✅ — `.git/` initialised, remote at
   `https://github.com/shadowdoguk/image-to-prompt.git`, 11 commits
   as of 2026-06-27. GitHub Issues available via `gh`.
2. **`CONTEXT.md` exists** ✅ — created per `docs/agents/domain.md`.
3. **`tests/` directory exists** ✅ — `tests/run-all.js` covers 227+
   tests across all ADRs (Phase 1–4 included); session-init reports
   10/10. Run via `node tests/run-all.js`.
4. **README drift fixed** ✅ — `POST /api/analyze` + `POST /api/generate-prompt`
   are the documented endpoints; ADR 0014 Phase 4 endpoint
   (`GET /api/palettes/:id/distribution`) is also documented.
5. **`uploads/` is empty** ✅ — multer cleans up after each analyze.
   The `node tests/run-all.js` final-invariant test
   (`No stale upload files in uploads/`) guards against regressions.

### UI-R series glossary (2026-09-03)

- **View** — one of the five hash-routed destinations (Create, Library, Chat,
  Providers & keys, Settings). Exactly one is mounted at a time; reachable in
  one navigation action from anywhere. Not a scroll section.
- **Providers & keys** — the API key management module (ADR 0024): per-provider
  input, server-side storage (`data/provider_keys.json`, mode 0600), switching,
  validation, masked display. Keys never travel to the browser.
- **Provider dot** — header status glyph per provider: green configured+tested,
  amber configured/untested, red missing/error. Click deep-links into
  Providers & keys.
- **Output options** — the collapsed disclosure on Create holding provider,
  generation model, prompt format, and aspect ratio. Configuration, not action.
- **Contact-sheet strip** — the film-frame presentation of the generated prompt
  (sprocket corners, gradient frame edge, mono text, exposure counter). The
  app's signature element.
