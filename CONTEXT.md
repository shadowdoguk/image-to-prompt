# CONTEXT — image-to-prompt

Domain language, concepts, and entities for this project. Skills read this first.

## What this project is

An AI-powered web application that transforms an uploaded image into a refined,
detailed text prompt suitable for downstream image-generation models (Stable
Diffusion, Midjourney, DALL-E, Flux). The provider is MiniMax M3 (`MiniMax-Text-01`).

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
  existing palettes behave unchanged.
- **Stage 2.5 (Post-generation chat, ADR 0011)** activates the moment
  Stage 2 returns successfully. The frontend posts the new prompt +
  analysis snapshot to `/api/chat/sessions`; the server mints a fresh
  `chat_<16 hex>` session anchored to that run. The chat system prompt
  (`DEFAULT_CHAT_SYSTEM_PROMPT`, code constant) carries three context
  blocks (original prompt, current working prompt, analysis snapshot)
  and forces the model to respond with a JSON object
  `{ reply, suggested_prompt }`. Revisions ("make the lighting more
  dramatic") return a non-null `suggested_prompt` and surface an Apply
  button that advances `current_prompt`. Pure questions ("why this
  framing?") return `suggested_prompt: null`. `messages[]` is
  append-only; sessions survive server restarts. ADR 0011a added a
  defensive parser + retry loop + frontend hardening. **ADR 0012
  (anchor-preservation)** layers a wholesale-rewrite guard on top:
  the system prompt reframes the assistant's job as "edit, do not
  regenerate" (with an inventory-classify-apply contract and
  contrasted examples), and a server-side validator
  (`validatePromptPreservation`) scores every revision against the
  current working prompt and retries with a reinforcement message if
  too much of the original context was lost — declining the revision
  (no Apply button) if the model can't produce a targeted edit.

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
| Stage 2 override | `data/stage2_overrides.json` | `presetId` | Per-preset override of `preset.stage2_system_prompt` (ADR 0007). Editable from UI via the "Edit prompt" button beside "Generate prompt". When present, used instead of the preset's built-in Stage 2 prompt on the next `POST /api/generate-prompt`. |
| Saved directive | `data/directives.json` | `id` (`directive_<16 hex>`) | name, content, tags, history[], usage_count, last_used_at, created_at, updated_at (ADR 0009). Selectable from the apply `<select>` below the directives textarea; editable from the Manage modal; rollback via version history; importable / exportable as `.i2p.json` envelope. The textarea is the source of truth at Stage 2 time; saved directives are a library loaded into the textarea via Apply. |
| Chat session | `data/chat_sessions.json` | `id` (`chat_<16 hex>`) | preset_id, preset_name, run_id, title, original_prompt, current_prompt, analysis_snapshot, messages[], created_at, updated_at (ADR 0011). Anchored to a finished Stage 2 run; activated immediately after `displayResult`. `messages` is append-only (`role: user \| assistant`, `content`, `suggested_prompt: string \| null`, `timestamp`). Apply advances `current_prompt` from an assistant's `suggested_prompt`. Persists across server restarts. |
| Issue | GitHub Issues (planned) | number | Tracked via `gh` CLI per `docs/agents/issue-tracker.md` |
| ADR | `docs/adr/NNNN-*.md` | filename | Architectural decisions; immutable once Accepted |

## Field palette (canonical, 14 fields)

textarea: `subject`, `subject_orientation`, `actions`, `mood`, `composition`, `texture`
text: `style`, `lighting`, `era`, `camera_angle`, `artistic_medium`, `depth_of_field`, `contrast`
colors: `colors` (array of `{hex, name}`)

## Accuracy contract (per ADR-0001)

HIGH-CONFIDENCE (≥90% expected): garment type/color, facing direction, primary
facial expression, major surrounding objects, scene classification.

BEST-EFFORT (hedge with "appears to be / likely / possibly"): textile material,
micro-expressions, single-frame activity inference.

The 90% threshold is NOT enforced via CI gate (user explicitly opted out of a
benchmark dataset and CI validation harness in ADR-0001).

## Configuration sources (in priority order)

1. **Environment variables** (`.env` → `process.env`) — required for `MINIMAX_API_KEY`.
2. **Field palette constants** in `server.js` — single source of truth for the
   Stage 1 schema and edit UI.
3. **Preset JSON** in `data/presets.json` — user-modifiable, persisted via API.
4. **Export envelope** `.i2p.json` (`PRESET_FILE_FORMAT` = `image-to-prompt-preset`,
   `PRESET_FILE_VERSION` = 1) — interop format for sharing presets.

## Conventions

- One issue per concern. Apply a triage label on creation if state is known.
- Reference issues in commits as `#N` (once git is initialized — see Known gaps).
- ADRs use the `docs/adr/NNNN-kebab-title.md` filename pattern, increment NNNN.
- Preset IDs are `preset_<16 hex chars>`; never reuse.
- Uploaded files MUST be deleted from `uploads/` after processing (success or error).
- API key MUST stay server-side; never sent to the client; never logged.

## Known gaps (must be fixed to fully eliminate drift)

1. **No git repository.** `AGENTS.md` references GitHub Issues via `gh`, but
   the project has no `.git/` and no remote. Version control + issue linkage
   is currently impossible.
2. **`CONTEXT.md` missing prior to this commit.** This file is now being created
   per the contract in `docs/agents/domain.md`.
3. **`tests/` directory missing** despite `package.json` referencing
   `node tests/run-all.js`. No regression harness exists.
4. **README drift:** README documents `POST /api/generate`; actual code uses
   `POST /api/analyze` (Stage 1) and `POST /api/generate-prompt` (Stage 2).
   Fix in README to match implementation.
5. **`uploads/` contains a leftover 1×1 PNG** from earlier testing. Safe to delete.

These are tracked as `Known gaps` rather than issues because there is no issue
tracker to track them in yet (gap #1).
