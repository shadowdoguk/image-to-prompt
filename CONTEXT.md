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
```

- **Stage 1** is always run. Produces a JSON object containing every field in
  the chosen preset's `stage1_fields`. Has a built-in retry-with-strengthened-prompt
  if the LLM output violates minimum-length contract.
- **Stage 1.5** runs ONLY if `subject_orientation` and/or `actions` is in the
  preset's `stage1_fields`. Runs a dedicated, focused analysis. Its output
  overwrites the corresponding Stage 1 fields.
- **Stage 2** runs ONLY when the user explicitly clicks "Generate prompt" with
  an edited analysis + optional directives. Synthesizes the final image-gen prompt.

## Core entities

| Entity | Storage | Identity | Notes |
|---|---|---|---|
| Preset | `data/presets.json` | `id` (`preset_<16 hex>`) | name, stage1_system_prompt, stage1_fields, stage2_system_prompt, created_at, updated_at |
| Field | in code (`FIELD_PALETTE`) | name (string) | 14 fixed fields. Has `type` (string\|array), `label`, `input` (textarea\|text\|colors) |
| Upload | ephemeral `uploads/` | filename | Created by multer, deleted after Stage 1 |
| Stage 1 output | transient (response) | field names match palette | Validated against `FIELD_INPUT_MIN_LENGTH` |
| Analysis | transient (response) | JSON w/ palette fields | Edited by user in UI between Stage 1 and Stage 2 |
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

1. **No git repository.** `CLAUDE.md` references GitHub Issues via `gh`, but
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
