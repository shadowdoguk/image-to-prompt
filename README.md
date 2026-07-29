# Image-to-Prompt Generator

An AI-powered web application that transforms uploaded images into refined, detailed text prompts optimized for AI image generation models (Stable Diffusion, Midjourney, DALL-E, Flux). Powered by MiniMax M3.

## Features

- **Image upload** with drag-and-drop and click-to-browse (JPG, PNG, WebP up to 10MB)
- **Optional base prompt** — guide the generation with your own intent
- **Secure backend** — API key stored server-side in environment variables
- **Real-time preview** of uploaded image before submission
- **Loading state** during API processing
- **Copy-to-clipboard** for generated prompts
- **Error handling** for API timeouts, rate limits, and invalid responses
- **Responsive design** — works on mobile, tablet, and desktop
- **Saved color palettes** — name and reuse a palette from any run. After analyze, a "Save palette…" button sits directly under the analyzed colors — click it, name the palette, and it becomes available in the Step 1 picker to override the auto-analyzed colors on the next job. Per-color **weight** (1–10) + **accent flag** + palette-level **accent cap** shape how the palette influences generated prompts: the server appends a deterministic `Color usage budget` block to the Stage 2 user message, and a distribution dashboard panel surfaces measured vs target mention counts per color (ADR 0014).
- **Saved directives** — name, tag, version, search, share, and reuse your favorite Stage 2 directives. Below the directives textarea, a "Save directive…" button captures the current text as a named, tagged directive; a "Manage directives…" modal lets you edit, search, filter, restore prior versions, and import/export directive sets as `.i2p.json` files. Usage frequency and last-used date are tracked automatically each time you apply a directive.
- **Focused re-analysis + curated presets for Actions / Mood / Lighting** — three new "Populate with AI" buttons (ADR 0018) sit directly beneath the `actions`, `mood`, and `lighting` fields in the analysis editor, each delegating a focused MiniMax M3 vision call to a single field via dedicated endpoints (`/api/actions`, `/api/mood`, `/api/lighting`). For `mood` and `lighting`, a curated taxonomy of preset chips is rendered beneath the button — five labeled categories (Positive / Reflective / Intense / Atmospheric / Still for mood; Natural / Directional / Quality / Stylized / Studio for lighting). Click a chip to fill the field with a one-line descriptor; edit after clicking. Chips are a zero-credit quick override; the AI button is the custom image-derived escape hatch.
- **Focused re-analysis for Texture** — a "Populate with AI" button (Slice 1) sits directly beneath the `texture` field in the analysis editor, delegating a focused MiniMax M3 vision call to a single field via a dedicated endpoint (`/api/texture`). The shipped prompt excludes the subject, lighting, color, mood, composition, style, and medium — those are separate fields — and mandates coverage of five texture categories: surface quality (smooth / rough / pitted / polished / matte / glossy), mark-making and tool traces (brushstrokes / palette-knife slabs / pen hatching / photographic grain), material identification (oil / acrylic / watercolor / paper / canvas / photographic emulsion / 3D render), pigment interaction (impasto / glazing / scumbling / wet-in-wet bleeds / drybrush / washes / sgraffito), and tactile cues (chunky / slick / fibrous / velvety / sticky / gritty). Texture is image-specific and resists a curated chip taxonomy (mirror ADR 0018 §5); only the AI button is rendered, no chips.

## Architecture

- **Backend**: Node.js + Express, handles API communication with MiniMax M3
- **Frontend**: Vanilla HTML/CSS/JS (no build step), drag-and-drop upload, responsive UI
- **API**: MiniMax M3 (`MiniMax-Text-01`) for vision + prompt generation
- **Security**: API key never exposed to client; all uploads validated and sanitized

## Quick Start

### Prerequisites

- Node.js >= 18
- A MiniMax API key (sign up at https://api.minimaxi.chat)

### Local Development

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and set your `MINIMAX_API_KEY`:
   ```
   MINIMAX_API_KEY=your-actual-api-key-here
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Open the app:**
   Visit [http://localhost:3100](http://localhost:3100) (or whatever `PORT` you set in `.env`)

### Development Mode (auto-reload)

```bash
npm run dev
```

### Deployment (desktop launcher)

The production deploy model is a local desktop launcher, not a
container or cloud target. The repo ships a single detached-start
script that handles the lifecycle (kill stale, start `npm start`
in the background, poll readiness, open the browser):

```bash
bash scripts/start-detached.sh
```

That script is the `Exec=` target of the XDG desktop launcher at
`~/.local/share/applications/image-to-prompt.desktop`. To install
the desktop icon, generate it once with:

```bash
python3 scripts/make-icon.py
```

After that, double-clicking the **Image-to-Prompt** icon in the
application launcher opens the app — the script reuses the running
server if one is already up, or starts a fresh one otherwise. Logs
go to `.data/start.log` (tail with `tail -f .data/start.log`). Stop
the server with `pkill -f "node server.js"` from the repo root.

There is no Dockerfile, no CI/CD, and no cloud deploy target. The
single-user desktop pattern is the deployment — see
[`CONTEXT.md` → Deployment](../../CONTEXT.md#deployment) for the
rationale.

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIMAX_API_KEY` | — | **Required.** Your MiniMax API key |
| `MINIMAX_BASE_URL` | `https://api.minimaxi.chat/v1` | MiniMax API base URL |
| `MINIMAX_MODEL` | `MiniMax-Text-01` | Model to use for generation |
| `PORT` | `3100` | Server port (change if 3100 is also taken) |
| `MAX_FILE_SIZE_BYTES` | `10485760` | Max upload size (10MB) |

## API Endpoints

### `GET /api/health`

Health check.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "provider": "minimax-m3",
    "configured": true
  }
}
```

### `POST /api/analyze`

Upload an image and a `presetId`; returns a structured JSON analysis across
the fields defined by the chosen preset.

**Request:** `multipart/form-data`
- `image` — image file (JPG, PNG, WebP, max 10MB)
- `presetId` — ID of an existing preset

**Response:**
```json
{
  "success": true,
  "data": {
    "preset_id": "preset_alla_prima_oil",
    "preset_name": "Alla Prima Oil Painting",
    "analysis": { "subject": "...", "style": "...", "...": "..." },
    "requested_fields": ["subject", "style", "..."],
    "model": "MiniMax-Text-01"
  }
}
```

### `POST /api/generate-prompt`

Take a (possibly edited) analysis + optional user directives and synthesize the
final image-generation prompt via Stage 2.

**Request:** `application/json`
- `presetId` — ID of the preset whose Stage 2 prompt should be used. If a
  per-preset override exists in `data/stage2_overrides.json` (see ADR 0007),
  the override is used; otherwise the preset's built-in `stage2_system_prompt`.
- `analysis` — the (edited) Stage 1 analysis object
- `directives` — optional string of additional user instructions (≤ 1000 chars)

**Response:**
```json
{
  "success": true,
  "data": {
    "preset_id": "preset_alla_prima_oil",
    "preset_name": "Alla Prima Oil Painting",
    "prompt": "A serene mountain landscape at sunset...",
    "model": "MiniMax-Text-01"
  }
}
```

### `POST /api/subject`

Re-analyze an uploaded image with a factual-only system prompt and return a
single `subject` field. Powers the "Populate with AI" button beneath the
subject textarea in the analysis editor (ADR 0004).

Independent of the active preset — the system prompt itself is editable
via `GET/PUT /api/subject-prompt` (ADR 0005). The shipped default prompt
excludes artistic style, creative medium, and aesthetic qualities and
mandates coverage of five factual categories: people (placement, clothing,
facial expression), locations / settings / environments, spatial
arrangement, objects / items / environmental features, and contextual
details.

**Request:** `multipart/form-data`
- `image` — image file (JPG, PNG, WebP, max 10MB)

**Response:**
```json
{
  "success": true,
  "data": {
    "subject": "Two people are seated at a wooden dining table in the lower-center of the frame. The person on the left wears a navy blue wool sweater and is smiling with visible teeth; the person on the right wears a red and black plaid flannel shirt with a neutral expression...",
    "model": "MiniMax-Text-01"
  }
}
```

### `POST /api/camera-angle`

Re-analyse an uploaded image with a camera-only system prompt and return a
single `camera_angle` field. Powers the "Populate with AI" button beneath
the camera angle input in the analysis editor (ADR 0008).

Independent of the active preset. The shipped prompt excludes the subject
itself, lighting, color, mood, style, and medium — those are separate
fields — and mandates coverage of five camera-angle categories: camera
position (height + distance), camera orientation (lateral + level/tilt),
lens impression (focal length + depth of field), camera movement
(static vs implied), and frame geometry (subject placement + cropping).

Live testing showed `camera_angle` was the most underperforming field in
the 14-field Stage 1 schema — the LLM satisfied the 15-character `text`
floor with one-word labels (`"eye level"`, `"high angle"`) because the
prompt was balancing camera angle against twelve other fields. This
endpoint gives the camera-angle contract the full prompt-attention window
for one question.

**Request:** `multipart/form-data`
- `image` — image file (JPG, PNG, WebP, max 10MB)

**Response:**
```json
{
  "success": true,
  "data": {
    "camera_angle": "Eye-level medium shot captured from a three-quarter front-right perspective, with a normal lens showing natural perspective, shallow depth of field softly blurring the background, and a static frame with no implied motion.",
    "model": "MiniMax-Text-01"
  }
}
```

### `POST /api/actions`

Re-analyse an uploaded image with an actions-only system prompt and return a
single `actions` field. Powers the "Populate with AI" button beneath the
actions textarea in the analysis editor (ADR 0018).

Independent of the active preset. The shipped prompt excludes the subject
identity, clothing, lighting, color, mood, camera angle, composition,
style, and medium — those are separate fields — and mandates coverage of
five actions categories: body kinematics (posture, limbs, head, facial
expression), object interactions (hands, tools, manipulation), multi-figure
dynamics (relative action, group activity), implied motion (static vs
mid-action, direction, energy), and scene narrative (apparent context,
temporal moment).

Live testing showed the 14-field Stage 1 schema compresses `actions` into a
single-clause description (`"sitting cross-legged, smiling"`) because the
LLM balances it against twelve other fields and satisfies the 30-word
textarea floor with a flat response. This endpoint gives the actions
contract the full prompt-attention window for one question.

**Request:** `multipart/form-data`
- `image` — image file (JPG, PNG, WebP, max 10MB)

**Response:**
```json
{
  "success": true,
  "data": {
    "actions": "Seated cross-legged on a polished wooden floor, the woman rests her clasped hands in her lap with her eyes closed in serene contemplation. Her head tilts slightly forward, lips drawn together in a soft, settled expression. No object interaction is visible and no implied motion is present — the frame captures a moment of stillness, the body settled at the end of an exhale.",
    "model": "MiniMax-Text-01"
  }
}
```

### `POST /api/mood`

Re-analyse an uploaded image with a mood-only system prompt and return a
single `mood` field. Powers the "Populate with AI" button beneath the mood
textarea in the analysis editor (ADR 0018), complementing the curated
mood preset chips.

Independent of the active preset. The shipped prompt excludes the
subject, actions, lighting setup, color palette, composition, style, and
medium — those are separate fields — and mandates coverage of five mood
categories: primary emotional tone, secondary undercurrent (layering
signal), atmosphere (ambient temperature + spatial feel), pacing
(kinetic vs static), and viewer-response cue (the reaction the image
invites).

The 14-field Stage 1 schema compresses `mood` into one or two adjectives
(`"cheerful"`, `"melancholic"`) because the LLM has no consistent mood
vocabulary across presets. This endpoint gives the mood contract the full
prompt-attention window for one question, and produces layered
multi-clause descriptions.

**Request:** `multipart/form-data`
- `image` — image file (JPG, PNG, WebP, max 10MB)

**Response:**
```json
{
  "success": true,
  "data": {
    "mood": "Contemplative and serene, with a bittersweet undercurrent — the warmth of the wooden floor and the soft natural light pull the moment toward comfort, while the closed eyes and bowed head introduce a private, almost grief-tinged inwardness. The atmosphere is intimate and enclosed, the air still. Pacing is languid and meditative, the energy of a long-held breath.",
    "model": "MiniMax-Text-01"
  }
}
```

### `POST /api/lighting`

Re-analyse an uploaded image with a lighting-only system prompt and return
a single `lighting` field. Powers the "Populate with AI" button beneath
the lighting input in the analysis editor (ADR 0018), complementing the
curated lighting preset chips.

Independent of the active preset. The shipped prompt excludes the subject,
actions, mood, color palette, composition, style, and medium — those are
separate fields — and mandates coverage of five lighting categories: light
source / type (natural / artificial / stylized), direction (front / side /
back / top / under), quality (hard vs soft, contrast, specular
highlights), color temperature (warm / cool / neutral / mixed), and shadow
behavior (present / absent, hard-edged, soft, geometry).

The 14-field Stage 1 schema compresses `lighting` into a short label
(`"soft natural light"`, `"studio lighting"`) because the LLM balances it
against twelve other fields and satisfies the 4-word `text` floor with a
flat response. This endpoint gives the lighting contract the full
prompt-attention window for one question.

**Request:** `multipart/form-data`
- `image` — image file (JPG, PNG, WebP, max 10MB)

**Response:**
```json
{
  "success": true,
  "data": {
    "lighting": "Soft diffused natural daylight from a north-facing window at camera-left, falling across the subject with a warm golden cast; shadows are soft-edged and short, falling toward camera-right.",
    "model": "MiniMax-Text-01"
  }
}
```

### `POST /api/texture`

Re-analyse an uploaded image with a texture-only system prompt and return a
single `texture` field. Powers the "Populate with AI" button beneath the
texture textarea in the analysis editor (Slice 1 — App Build methodology,
pattern-mirrors ADR 0018).

Independent of the active preset. The shipped prompt excludes the subject,
lighting, color, mood, composition, style, and medium — those are
separate fields — and mandates coverage of five texture categories:
surface quality (smooth / rough / pitted / polished / matte / glossy),
mark-making and tool traces (brushstrokes / palette-knife slabs / pen
hatching / photographic grain), material identification (oil / acrylic /
watercolor / paper / canvas / photographic emulsion / 3D render), pigment
interaction (impasto / glazing / scumbling / wet-in-wet bleeds /
drybrush / washes / sgraffito), and tactile cues (chunky / slick /
fibrous / velvety / sticky / gritty).

Texture is image-specific and resists a curated chip taxonomy (mirror
ADR 0018 §5); only the AI button is rendered, no chips. Mirrors the
per-field pattern from `/api/actions`, `/api/mood`, and `/api/lighting`.

**Request:** `multipart/form-data`
- `image` — image file (JPG, PNG, WebP, max 10MB)

**Response:**
```json
{
  "success": true,
  "data": {
    "texture": "Heavy impasto with visible palette-knife slabs and sharp knife-edge ridges, layered alla prima with thick pigment standing proud of the canvas weave. The surface reads as chunky and ridged under the eye, with broken-color passages and canvas showing through in thinner scraped areas.",
    "model": "MiniMax-Text-01"
  }
}
```

### `GET /api/subject-prompt`

Return the active subject-extraction system prompt plus the shipped default
and an `is_default` flag. Powers the "Edit prompt" modal opened from the
"Edit prompt" button beside "Populate with AI" (ADR 0005).

**Response:**
```json
{
  "success": true,
  "data": {
    "prompt": "You are an expert visual analyst producing a comprehensive, factual description...",
    "default_prompt": "You are an expert visual analyst producing a comprehensive, factual description...",
    "is_default": true
  }
}
```

### `PUT /api/subject-prompt`

Overwrite the active subject-extraction system prompt. The new content is
persisted to `data/subject_prompt.json` and is picked up by the next
`POST /api/subject` call (no server restart). The prompt CONTENT is
unfiltered — the entire point is user ownership. Validation is shape-only:
non-empty string, ≤ 10 000 chars.

**Request:** `application/json`
- `prompt` — the new system prompt (string)

**Response:**
```json
{
  "success": true,
  "data": {
    "prompt": "...",
    "is_default": false
  }
}
```

## Stage 2 Prompt Override API

Per-preset overrides for the Stage 2 system prompt used by
`POST /api/generate-prompt` (ADR 0007). The override is layered on top of
the preset's built-in `stage2_system_prompt` so the user can iterate on
how a specific preset synthesizes the final prompt without editing the
preset itself. Overrides persist to `data/stage2_overrides.json` and are
read fresh on every `POST /api/generate-prompt` call (no server restart).

Powers the "Edit prompt" button rendered beside "Generate prompt" in the
analysis editor.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/stage2-prompt?presetId=...` | Get the effective Stage 2 prompt for a preset (override if set, otherwise the preset's built-in `stage2_system_prompt`) |
| `PUT` | `/api/stage2-prompt?presetId=...` | Write or overwrite the override for a preset |
| `DELETE` | `/api/stage2-prompt?presetId=...` | Remove the override for a preset (idempotent) |

### `GET /api/stage2-prompt`

**Query params:**
- `presetId` — ID of an existing preset

**Response:**
```json
{
  "success": true,
  "data": {
    "prompt": "You are a prompt engineer for AI image generators...",
    "default_prompt": "You are a prompt engineer for AI image generators...",
    "is_default": true
  }
}
```

`is_default` is content-based (`prompt === default_prompt`), mirroring the
ADR 0005 subject-prompt response shape.

### `PUT /api/stage2-prompt`

Write an override for the preset's Stage 2 prompt. Validation is shape-only:
non-empty string, ≤ 10 000 chars. The prompt CONTENT is unfiltered.

**Query params:**
- `presetId` — ID of an existing preset

**Request:** `application/json`
- `prompt` — the new Stage 2 prompt override

**Response:**
```json
{
  "success": true,
  "data": {
    "prompt": "...",
    "default_prompt": "...",
    "is_default": false
  }
}
```

### `DELETE /api/stage2-prompt`

Remove the override for a preset. Subsequent `POST /api/generate-prompt`
calls for this preset fall back to `preset.stage2_system_prompt`.

**Query params:**
- `presetId` — ID of an existing preset

**Response:**
```json
{
  "success": true,
  "data": {
    "preset_id": "preset_alla_prima_oil",
    "removed": true,
    "prompt": "You are a prompt engineer for AI image generators...",
    "default_prompt": "You are a prompt engineer for AI image generators...",
    "is_default": true
  }
}
```

## Saved Palette API

Saved palettes are reusable color sets extracted from a previous run or
authored from scratch. Each palette persists at `data/palettes.json` with
its `name`, `colors`, source `run_id` (or `null` for custom palettes),
source `preset_id`, `created_at` / `updated_at` timestamps, and a full
version `history` array. Pick one in the Step 1 picker to override the
auto-analyzed `colors` field on the next `/api/analyze` call (ADR 0006).
Edit, custom-create, and version history are covered by ADR 0013.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/palettes` | List all saved palettes |
| `GET` | `/api/palettes/:id` | Get a single palette (with history) |
| `GET` | `/api/palettes/:id/distribution` | Latest distribution telemetry (Phase 4 dashboard data) |
| `POST` | `/api/palettes` | Save a new palette from a finished run |
| `POST` | `/api/palettes/custom` | Create a brand-new palette from scratch (no source run required) |
| `PUT` | `/api/palettes/:id` | Partial edit — body: `{ name?, colors?, accent_max_mentions? }` |
| `POST` | `/api/palettes/:id/restore/:version` | Roll back to a specific history version |
| `DELETE` | `/api/palettes/:id` | Hard-delete a palette |

### `POST /api/analyze` with a palette override

The `/api/analyze` multipart form accepts an optional `paletteId` field. When
provided and resolvable, the route strips `colors` from the Stage 1 schema
(so the LLM does not re-extract them), appends a one-line system-prompt
instruction not to speculate colors, and injects the saved palette's colors
into the analysis response. The response envelope additionally includes
`run_id` (always), and `palette_id` / `palette_name` when an override was
applied.

**Form fields:**
- `image` — image file (JPG, PNG, WebP, max 10MB)
- `presetId` — ID of an existing preset
- `paletteId` — (optional) ID of a saved palette to apply

### `POST /api/palettes` body shape

```json
{
  "name": "Sunset ochres",
  "colors": [
    { "hex": "#d97706", "name": "burnt orange" },
    { "hex": "#7c2d12", "name": "deep brown" }
  ],
  "source_run_id": "run_0123456789abcdef",
  "source_preset_id": "preset_alla_prima_oil"
}
```

### `POST /api/palettes/custom` body shape

```json
{
  "name": "Brand book Q3",
  "colors": [
    { "hex": "#0f172a", "name": "ink" },
    { "hex": "#f59e0b", "name": "amber" }
  ],
  "source_preset_id": "preset_photorealistic"
}
```

`source_preset_id` is optional. `source_run_id` is omitted entirely and
stored as `null`. Same name + colors validation as `POST /api/palettes`.

### `PUT /api/palettes/:id` body shape

```json
{
  "name": "Sunset ochres v2",
  "colors": [
    { "hex": "#d97706", "name": "burnt orange" },
    { "hex": "#7c2d12", "name": "deep brown" },
    { "hex": "#f59e0b", "name": "amber highlight" }
  ]
}
```

Both fields are optional; at least one is required. `name`-only PUT
preserves the original rename-only behavior. Each successful edit appends
a new history entry — the rollback path has something to restore to.

Validation:
- `name`: non-empty string, 60 characters or fewer, **case-insensitively
  unique** among existing palettes (excluding the palette being edited).
- `colors`: array of 1–50 entries. Each entry accepts hex (`#d97706`,
  `d97706`, `#FFF`), `rgb(r, g, b)`, or `hsl(h, s%, l%)` in the `hex`
  field — anything that doesn't parse is rejected with a clear error.
  `rgba(...)` / `hsla(...)` are not supported in v1. The stored format
  is always lowercase 6-digit hex (`#rrggbb`).
- `source_run_id`: matches `/^run_[0-9a-f]{16}$/` (the `run_id` returned
  by the analyze call that produced this palette).
- `source_preset_id`: starts with `preset_` (existence is not enforced —
  presets can be deleted independently).

### Version history

Every write that produces a new user-visible state — initial POST,
`POST /api/palettes/custom`, partial PUT, and restore — appends a new
entry to the palette's `history` array capturing the post-write state.
The top-level `name` / `colors` are always the latest. Restoring a
prior version makes that version's values the new top-level state and
records a fresh history entry — nothing is ever deleted from history,
so the entire edit trail is preserved. `updated_at` is bumped on every
write.

### Editing in the UI

The palette manager modal gains an **Edit** button per row and a
**New palette** button in the footer. The edit modal exposes a name
field, a live preview row of swatches, an in-line color editor (each
chip has a color picker + name input + remove), an add-color form that
accepts any of the three color formats, and a version history list with
one-click **Restore** per prior version. Edits are committed via
`PUT /api/palettes/:id`; new palettes are committed via
`POST /api/palettes/custom`.

### Weighted distribution and accents (ADR 0014)

Each color in a palette carries an optional integer `weight` (1–10,
default 5) and an optional boolean `accent` flag (default false). The
palette as a whole carries an optional `accent_max_mentions` (1–5,
default 2). These shape how the saved palette influences generated
prompts:

- **Weight** sets the color's relative fraction of the prompt's color
  budget. Higher-weighted colors are emphasised more; the server
  appends a deterministic `Color usage budget` block to the Stage 2
  user message listing each color's fraction as a percentage.
- **Accent** flags a color as a "punchy" highlight. The budget block
  caps total accent mentions at `accent_max_mentions` and tags the
  line `(ACCENT — mention at most N times total; place where it adds
  focus)`.
- **Legacy palettes** (created before ADR 0014, with no weighting
  fields) keep their pre-ADR behaviour: no budget block is sent, the
  response envelope is the same shape as before.

In the edit modal, each color row gains a **weight slider** (1–10
with a live `Weight N` label) and an **accent checkbox**. The legend
of the colors fieldset gains an **Accent cap** number input (1–5).
Below the swatch preview, a **Target distribution** bar chart renders
one row per color with a coloured bar whose width matches the
normalised fraction; accent rows get a ★ badge and a warm outline.

The `Distribution dashboard` collapsible panel under the version
history fetches `GET /api/palettes/:id/distribution` on open and
renders a target vs measured comparison table for the most recent
Stage 2 run that used this palette. Measured counts come from
`measureColorDistribution`, which tokenizes the LLM output for color
names (case-insensitive, hyphen/space normalised) and hex strings
(with or without leading `#`). Telemetry is appended automatically
on every successful `/api/generate-prompt` run that used a palette;
entries are capped at 50 per palette (FIFO trim).

### Rollout gate

ADR 0014 ships behind a UAT sign-off rather than a runtime feature
flag (no flag infrastructure exists in this codebase). The full
checklist is at `docs/adr/0014-uat-checklist.md`. The feature is
"live" in the sense that all server endpoints + UI controls are
shipped, but rollout is treated as "pending reviewer sign-off" until
the UAT pass is recorded against the three reference palettes
(Sunset ochres, Brand Q3, Legacy test).

## Saved Directive API

Saved directives are reusable free-form text snippets that load into the
analysis editor's "Directives" textarea before running Stage 2. Each
directive persists at `data/directives.json` with its `name`, `content`,
optional `tags`, full version `history`, `usage_count`, and `last_used_at`
timestamp. (ADR 0009.)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/directives` | List all saved directives (with history) |
| `GET` | `/api/directives/:id` | Get a single directive (with history) |
| `POST` | `/api/directives` | Save a new directive |
| `PUT` | `/api/directives/:id` | Update an existing directive (body: `{ name?, content?, tags? }`, partial) |
| `DELETE` | `/api/directives/:id` | Hard-delete a directive and its full history |
| `POST` | `/api/directives/:id/apply` | Record that a directive was applied (increments `usage_count`, stamps `last_used_at`) |
| `POST` | `/api/directives/:id/restore/:version` | Roll back to a specific history version |
| `GET` | `/api/directives/export/all` | Download all directives as `.i2p.json` |
| `POST` | `/api/directives/import` | Import an `.i2p.json` envelope (atomic; mints fresh ids) |

### `POST /api/directives` body shape

```json
{
  "name": "Dramatic red accent",
  "content": "Add a punchy red accent in the upper-right corner.",
  "tags": ["color", "composition"]
}
```

Validation:
- `name`: non-empty string, 60 characters or fewer, **case-insensitively
  unique** among existing directives.
- `content`: non-empty string (after trim), 1000 characters or fewer.
- `tags`: optional array of ≤ 8 entries. Each tag must match
  `^[a-z0-9][a-z0-9-]*$` and be 24 characters or fewer. Tags are
  normalized to lowercase; duplicates are de-duplicated.

### Version history

Every save (initial POST, partial PUT, and restore) appends a new entry
to the directive's `history` array capturing the post-write state. The
top-level `name` / `content` / `tags` are always the latest. Restoring a
prior version makes that version's values the new top-level state and
records a fresh history entry — nothing is ever deleted, so the entire
edit trail is preserved.

### Export envelope

```json
{
  "format": "image-to-prompt-directives",
  "version": 1,
  "exported_at": "2026-06-22T12:34:56.789Z",
  "directives": [ ... ]
}
```

Imports always mint fresh `id` values to prevent collisions with existing
local directives, reset `usage_count` to 0 and `last_used_at` to null
(the recipient's library tracks its own usage), and preserve the full
`history` array. Imports are atomic — if any directive in the batch is
invalid, none are written.

## Preset API

Presets are reusable Stage 1 / Stage 2 prompt configurations, persisted in
`data/presets.json`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/presets` | List all presets |
| `GET` | `/api/presets/:id` | Get a single preset |
| `POST` | `/api/presets` | Create a new preset |
| `PUT` | `/api/presets/:id` | Update an existing preset (partial) |
| `DELETE` | `/api/presets/:id` | Delete a preset |
| `GET` | `/api/presets/export/all` | Download all presets as `.i2p.json` |
| `GET` | `/api/presets/export/:id` | Download a single preset as `.i2p.json` |
| `POST` | `/api/presets/import` | Import an `.i2p.json` envelope |

The export envelope format is `image-to-prompt-preset` (version `1`); see
the `i2p.json` files exported from the UI for the exact shape.

## Post-generation Chat API

After Stage 2 returns a final prompt, the chat console (ADR 0011) anchors
a session to that prompt and lets the user iterate by asking the AI for
revisions in natural language. Sessions are persisted in
`data/chat_sessions.json` and survive server restarts. Each session
carries an immutable `original_prompt` and a mutable `current_prompt`
that advances only when the user clicks Apply on a revision.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/chat/sessions` | Create a session anchored to a finished prompt |
| `GET` | `/api/chat/sessions` | List all sessions (newest first, with full messages) |
| `GET` | `/api/chat/sessions/:id` | Get one session |
| `POST` | `/api/chat/sessions/:id/messages` | Send a user message, append AI reply |
| `POST` | `/api/chat/sessions/:id/apply/:messageId` | Apply an assistant's `suggested_prompt` to `current_prompt` |
| `DELETE` | `/api/chat/sessions/:id` | Hard-delete a session and its full history |

### `POST /api/chat/sessions` body shape

```json
{
  "prompt": "the Stage 2 output text",
  "preset_id": "preset_<16 hex>",
  "preset_name": "Photorealistic photo description",
  "run_id": "run_<16 hex>  (optional)",
  "analysis_snapshot": { "subject": "...", "style": "..." }
}
```

`prompt` is required, non-empty, and capped at 5000 characters (matches
the Stage 2 output ceiling). `preset_id` must resolve to a known preset.
`analysis_snapshot` is optional; when present, the chat system prompt
keeps it as context so revisions are grounded in the same facts Stage 2
used.

### Chat reply shape

Each assistant message has a `suggested_prompt` field that is either
`null` (a pure-question reply — no revision to apply) or a string (the
revised prompt text the user can apply with one click). The
`json_schema`-enforced response from the model always includes both
fields.

## Project Structure

```
image-to-prompt/
├── server.js              # Express backend + MiniMax M3 integration
├── package.json
├── .env.example           # Environment variable template
├── .gitignore
├── README.md
├── AGENTS.md              # Agent skills configuration
├── data/                  # Persisted runtime state (presets + palettes + directives + subject prompt + stage2 overrides)
│   ├── presets.json
│   ├── palettes.json            # ADR 0006 — saved color palettes (seeded with [])
│   ├── directives.json          # ADR 0009 — saved directives (seeded with [])
│   ├── subject_prompt.json      # ADR 0005 — editable from UI; seeded on first read
│   └── stage2_overrides.json    # ADR 0007 — per-preset Stage 2 prompt overrides (seeded with {})
├── docs/
│   └── agents/
│       ├── issue-tracker.md
│       ├── triage-labels.md
│       └── domain.md
└── src/                   # Frontend (served as static files)
    ├── index.html
    ├── styles.css
    └── app.js
```

## Security

- **API key protection**: `MINIMAX_API_KEY` is read from `.env` server-side only; never sent to the client
- **Input validation**: file type and size validated before upload; base prompt sanitized to strip control characters and limit length
- **Error sanitization**: error messages are redacted to prevent API key/token leakage in client-facing responses
- **Upload cleanup**: uploaded files are deleted from disk after processing (success or error)

## Deployment

### Production Environment Variables

Set the following in your production environment:

```bash
MINIMAX_API_KEY=your-production-key
MINIMAX_BASE_URL=https://api.minimaxi.chat/v1
MINIMAX_MODEL=MiniMax-Text-01
PORT=3000
NODE_ENV=production
MAX_FILE_SIZE_BYTES=10485760
```

### Docker (example)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### Reverse Proxy (Nginx)

```nginx
client_max_body_size 12M;  # Slightly larger than MAX_FILE_SIZE for headers
```

## Testing

End-to-end test checklist:

- [ ] Upload a valid JPG image (< 10MB) → expect refined prompt
- [ ] Upload a valid PNG image → expect refined prompt
- [ ] Upload a valid WebP image → expect refined prompt
- [ ] Upload with base prompt → expect prompt that builds on base
- [ ] Upload without base prompt → expect pure image-based prompt
- [ ] Upload an oversized file (> 10MB) → expect validation error
- [ ] Upload an invalid file type (e.g., GIF, PDF) → expect validation error
- [ ] Test with invalid/missing API key → expect friendly error
- [ ] Test copy-to-clipboard functionality
- [ ] Test regenerate button
- [ ] Run an analysis → click "Save palette…" → name it → toast confirms; palette appears in Step 1 picker
- [ ] Step 1 picker: select a saved palette → run analyze → colors chips match the saved palette (not the new image's auto-analysis)
- [ ] Step 1 picker: clear selection (back to "Auto-analyze") → run analyze → colors chips come from the LLM as usual
- [ ] Manager modal: search filters by name (case-insensitive); sort toggles newest/oldest
- [ ] Manager modal: delete a palette → confirm → row disappears; if it was selected in Step 1, picker clears
- [ ] Save modal: empty name → error; duplicate name → error; name > 60 chars → error
- [ ] Apply a deleted palette (race condition): if the picker still references a deleted id, the next analyze 404s and the UI surfaces the error

## License

MIT

## Contributing

Issues and PRs welcome. This project uses GitHub Issues for tracking — see `docs/agents/issue-tracker.md`.