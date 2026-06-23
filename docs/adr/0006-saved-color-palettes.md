# ADR 0006 — Saved color palettes

## Status

Accepted. Implemented 2026-06-22.

## Context

Stage 1 (ADR 0001) and Stage 1.5 always ask the MiniMax M3 vision model to
extract a `colors` array — a list of `{ hex, name }` chips describing the
dominant colors visible in the uploaded image. Users frequently want to
**reuse a palette across jobs**: an art director who lands on a palette
they like from a reference image wants to apply the same palette to a
different image without the LLM re-deriving it (and potentially drifting
from what they liked). Conversely, if the user wants the LLM to analyze
fresh, they should still be able to.

Today the workflow has no way to do either:

- Every analyze call re-runs the colors extraction. Two images of
  similar subjects yield two slightly different palettes.
- There's no storage for "I liked the palette from job X" — the only
  durable state is the preset config and the on-disk subject prompt
  (ADR 0005). The analysis itself is transient.
- There's no UI affordance for "use this palette again" — even if
  palettes were saved, users couldn't pick them.

The requirement landed as:

1. Save generated palettes with metadata (timestamp, source run id,
   original palette properties, user-assigned name).
2. UI to prompt users to name and save a palette at run completion.
3. Palette selection in the new-job config flow with search and filter
   by name or creation date.
4. Apply a selected saved palette to a new job, overriding the default
   automatic palette analysis.
5. Input validation (unique / non-empty / char limit).
6. Error handling for failed saves, failed applications, deleted /
   corrupted palettes.
7. Unit tests + E2E coverage.
8. Accessibility (screen reader, keyboard nav) for every new UI element.

## Decision

### 1. Persist palettes at `data/palettes.json`

Ships as `[]`. New helper trio mirrors the `data/presets.json` pattern
already in place:

- `readPalettes()` — read+parse; on missing file, seed `[]`; on parse
  failure, log + return `[]`. Drops malformed entries (warns to
  console) so a partial corruption doesn't break the whole list.
- `writePalettes(palettes)` — atomic-ish write: write to
  `data/palettes.json.tmp` then `fs.renameSync` over the real file.
  Avoids half-written files on crash. Naive lock-free; same single-user
  assumption as ADR 0005's subject prompt.

Shape of each entry:

```json
{
  "id": "palette_<16 hex>",
  "name": "Sunset ochres",
  "colors": [
    { "hex": "#d97706", "name": "burnt orange" },
    { "hex": "#7c2d12", "name": "deep brown" }
  ],
  "source_run_id": "run_<16 hex>",
  "source_preset_id": "preset_alla_prima_oil",
  "created_at": "2026-06-22T11:00:00.000Z"
}
```

`source_run_id` and `source_preset_id` are **provenance only** — they
let the UI show "extracted from preset X" in the palette manager but
are not consulted when applying a palette. A palette saved under the
Alla Prima preset can be applied to a Photorealistic job.

### 2. New run id on every `/api/analyze`

Each analyze call mints `run_<16 hex>` and includes it in the response
envelope as `run_id`. The frontend captures it; the "Save palette"
modal passes it as `source_run_id`. The id is opaque to the user;
its only job is to link a saved palette back to the run that produced
it.

### 3. Palette override wired into `/api/analyze`

`POST /api/analyze` now accepts an optional multipart `paletteId`
field. When present:

1. The handler looks the palette up server-side (404 if missing).
2. The handler computes `effectiveFields = preset.stage1_fields`
   minus `colors`. The Stage 1 schema and Stage 1.5 schema therefore
   do not require colors — saving the LLM the work.
3. The system prompt gets a single appended sentence:
   `"A saved palette override is active. Do not extract colors —
   they will be supplied externally."`
4. After Stage 1 + Stage 1.5 return, the handler injects
   `analysis.colors = savedPalette.colors` and returns the augmented
   analysis alongside `palette_id`, `palette_name`, and the new
   `run_id`.

When `paletteId` is absent or empty, behavior is identical to today —
Stage 1 extracts colors normally. Backward compatible.

### 4. New REST surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/palettes` | List all saved palettes |
| `GET` | `/api/palettes/:id` | Get one (used by picker refresh after a save) |
| `POST` | `/api/palettes` | Save a new palette from a finished run |
| `PUT` | `/api/palettes/:id` | Rename an existing palette (name only) |
| `DELETE` | `/api/palettes/:id` | Delete a palette |

All endpoints reuse the existing `{ success, data, error }` envelope.
Validation errors → 400. Missing palette → 404. Disk failures → 500.

### 5. Frontend — three new UI surfaces

#### 5a. Step 1 picker (above preset dropdown)

```
┌──────────────────────────────────────────────┐
│ Saved palette (optional)  [Manage…]          │
│ [ — Auto-analyze colors —                 ▼ ] │
└──────────────────────────────────────────────┘
```

A `<select>` whose default empty value means "no override, analyze
colors normally". Each saved palette is listed as `name (n colors)`.
The "Manage…" button opens the manager modal. When a saved palette
is selected, the existing flow continues normally — the override is
applied silently during `/api/analyze`.

#### 5b. "Save this palette" button at analysis completion

When Stage 1 returns and the analysis editor renders, a new button
appears in the `.step-actions` row:

```
[ Re-analyze ]  [ Save palette… ]  [ Generate prompt ]
```

Disabled if the analysis has no `colors` array or it's empty. Clicking
opens the save modal:

```
┌─ Save palette ────────────────────────────────┐
│ Name [____________________]  (12 / 60)        │
│ Source: preset Photorealistic photo,           │
│         4 colors (sunset palette)              │
│ [ Cancel ]  [ Save ]                           │
└───────────────────────────────────────────────┘
```

On Save → `POST /api/palettes`. On success → close modal + toast
`Saved palette "Sunset ochres"` + refresh the Step 1 picker so the
new palette is selectable.

#### 5c. Manager modal

Searchable, sortable list:

```
┌─ Saved palettes ──────────────────────────────┐
│ [search name…]  Sort: (•) Newest  ( ) Oldest  │
│ ─────────────────────────────────────────────  │
│ ○ Sunset ochres            4 colors  2d ago  [×]│
│   from preset_alla_prima_oil                   │
│ ○ Twilight blues          3 colors  1w ago  [×]│
│   from preset_photorealistic                   │
│ …                                              │
│ [ Close ]                                      │
└───────────────────────────────────────────────┘
```

- Search filters by case-insensitive substring on `name`.
- Sort toggle (radio): `Newest first` (default) vs `Oldest first`.
- Delete button per row — confirm dialog, then `DELETE`.
- Empty state: "No saved palettes yet. Run an analysis and click
  'Save palette' to create one."
- Loading state: simple "Loading…" while fetch in flight.

### 6. Validation rules

`validatePalette(body, { existingNames })`:

- `name`: string, trim length 1–60. Required.
- `name uniqueness`: `name.trim().toLowerCase()` must not equal an
  existing palette's `name.toLowerCase()`. 400 with a clear error.
- `colors`: array, 1–50 items. Each item: `{ hex: /^#[0-9a-f]{6}$/i,
  name: string }`. 400 with the failing index.
- `source_run_id`: matches `/^run_[0-9a-f]{16}$/`.
- `source_preset_id`: starts with `preset_` (existence not enforced —
  presets can be deleted independently of palettes).
- All other fields: rejected (strict shape).

`PUT /api/palettes/:id` accepts `{ name }` only (partial). Same name
validation, but uniqueness check excludes the palette being renamed.

### 7. Error scenarios covered

| Scenario | Response |
|---|---|
| Save: empty / whitespace / > 60 chars name | 400 |
| Save: name already used (case-insensitive) | 400 |
| Save: invalid hex / wrong colors shape | 400 |
| Save: missing source_run_id or wrong shape | 400 |
| Save: disk write fails | 500 |
| Apply: paletteId refers to deleted palette | 404 |
| Apply: paletteId malformed | 400 |
| Apply: palette file is corrupt → entry dropped on read | 404 (treated as missing) |
| Apply: storage layer I/O error during read | 500 |
| Delete: id not found | 404 |
| Delete: storage layer I/O error | 500 |
| Manager: corrupted palette file | list with corrupt entry dropped + console warn; UI unaffected |

### 8. Accessibility

All new UI elements follow the existing patterns in this codebase
(modals with `role="dialog" aria-labelledby`, inputs with `<label
for>`, focus-visible outlines, native form controls where possible).

Specifically:

- Step 1 palette `<select>` has `aria-label="Use saved palette"`.
- Manager modal `role="dialog" aria-labelledby="palette-manager-title"`.
- Search input is `<input type="search">` with visible label and
  `aria-label` for screen readers.
- Sort radio buttons wrapped in a `<fieldset><legend>Sort order</legend>`.
- Each palette row is a `<li>` with the delete button having
  `aria-label="Delete palette Sunset ochres"`.
- Save modal has `aria-describedby` pointing at the source-line text
  so screen readers announce the provenance.
- All buttons reachable via Tab in DOM order. Esc closes modals
  (focus the close button on open).
- Color count text in the picker options is part of the option text —
  native `<select>` announces it.

### 9. Out of scope

- Per-user palettes (single global list, single-user app).
- Versioning / soft-delete / undo. DELETE is hard.
- Cross-palette merging (e.g., "Sunset + Twilight"). A palette is
  applied whole or not at all.
- Editing saved colors in the manager. Users can rename but not
  recolor. To change the colors, save a new palette from a new run.
- Sharing palettes as `.i2p.json`-style files. The feature is for
  local reuse; if a sharing format is wanted later, it's a separate
  ADR.
- Importing palettes from preset defaults. The preset is config; the
  palette is derived state. Crossing that line would entangle
  concerns.

## Architecture (after)

```
                              ┌──────────────────────────────────┐
   ┌──── POST /api/palettes ───▶                                  │
   │                          │  data/palettes.json              │
   │   (UI: Save modal)       │  [ { id, name, colors, ... } ]    │
   │                          └──────────────┬───────────────────┘
   │                                         │
   │                            read         │        apply
   │                                         ▼
   │                          ┌──────────────────────────────────┐
   │   GET /api/palettes ────▶│  GET /api/palettes               │
   │   (UI: picker + manager) │  (manager modal + Step 1 picker) │
   │                          └──────────────────────────────────┘
   │
   │                          ┌──────────────────────────────────┐
   │   POST /api/analyze  ───▶│  optional paletteId in form      │
   │   (with paletteId)       │  → strip colors from schema      │
   │                          │  → Stage 1 returns w/o colors    │
   │                          │  → analysis.colors = palette     │
   │                          └──────────────────────────────────┘
```

## Files changed

| File | Change |
|---|---|
| `server.js` | New constants: `PALETTE_FILE`, `MAX_PALETTE_NAME_LENGTH`, `MAX_PALETTE_COLORS`. New helpers: `generatePaletteId`, `generateRunId`, `validatePalette`, `validatePaletteName`, `applyPaletteToAnalysis`, `readPalettes`, `writePalettes`. New routes: `GET/POST/DELETE /api/palettes`, `GET/PUT /api/palettes/:id`. Modified `/api/analyze` to accept `paletteId` and a `run_id` field. New exports. |
| `data/palettes.json` | New persistent file (seeded to `[]` on first read). |
| `src/index.html` | Step 1 picker block above preset dropdown; "Save palette…" button in `.step-actions`; save-palette modal; manager modal. |
| `src/app.js` | New state: `palettes`, `selectedPaletteId`. New functions: `loadPalettes`, `renderPalettePicker`, `openSavePaletteModal`, `savePalette`, `openPaletteManagerModal`, `closePaletteManagerModal`, `deletePalette`. Modified `runAnalysis` to include `paletteId` in the form; render the "Save palette" button conditionally; render manager list with search + sort. Keyboard handlers: Esc closes any open modal. |
| `src/styles.css` | New `.palette-picker-row` and `.palette-manager-list` styles. Reuse existing `.modal`, `.btn-secondary`, `.color-chip`, `.char-count` classes where possible. |
| `CONTEXT.md` | Add `SavedPalette` entity row to the entities table. New row in the Core entities section. Note in the Step 1 description that the picker overrides the analyze step. |
| `README.md` | New "Saved palettes" section under Features. New API endpoints table. Note `data/palettes.json` under Project Structure. |
| `tests/run-all.js` | 12 new tests (see Verification). |
| `docs/adr/0006-saved-color-palettes.md` | This file. |

No changes to `FIELD_PALETTE`, `FIELD_FORMAT_HINTS`, the per-preset
prompts in `data/presets.json`, the `data/subject_prompt.json`
contract, or the existing `/api/analyze` Stage 1.5 logic.

## Why these decisions

- **Server-side disk, not localStorage.** Matches the rest of the
  persistence in this app (`data/presets.json`,
  `data/subject_prompt.json`). Survives browser refresh, browser
  switch, deploy. localStorage would also mean a divergent copy
  across browsers for the same user.
- **Atomic write (tmp + rename).** Defends against half-written
  files on crash. POSIX `rename` is atomic on the same filesystem.
  Cheap insurance.
- **Synthetic `run_<id>` rather than image filename.** Filenames can
  collide (two uploads of `photo.jpg`). The id is opaque and unique.
  Naming it `run_` rather than `palette_` distinguishes it from
  palette identity and makes the relationship explicit ("the palette
  was extracted from run X").
- **Strip `colors` from Stage 1 schema when palette override is
  active.** Cleanest way to skip the LLM work; the schema's
  `additionalProperties: false` would otherwise force the LLM to
  extract colors or risk rejection. The one-line system-prompt
  suffix covers the rare LLM that speculates colors anyway.
- **Apply by replacing, not merging.** "Override" is the user-stated
  semantics. Merging requires a dedup rule that's not obvious from
  the requirement; defer.
- **Manager is a modal, not a route.** This is a single-page wizard.
  A new route would require router state and URL handling. A modal
  fits the existing pattern (preset editor modal, subject prompt
  modal).
- **No browser-level E2E in this iteration.** The project has no
  Playwright/Puppeteer setup. Adding it would balloon the PR
  (~150MB dev deps, config, first-run install latency). The 12
  HTTP-level integration tests in `tests/run-all.js` cover the full
  save→list→apply→delete flow at the API layer. A follow-up ADR can
  add browser automation when a real multi-component UI regression
  bites.
- **Corrupted palette entries are dropped, not fatal.** A single bad
  entry shouldn't brick the whole list (which the picker depends on
  to render). Log + drop is the forgiving behavior.

## Trade-offs and risks

- **Naive write can lose data under concurrent edits.** Same as ADR
  0005. Single-user wizard. File lock + retry deferred until a real
  concurrent editor surfaces.
- **No undo on delete.** Hard delete. If a user accidentally deletes
  a palette they liked, they have to re-run an analyze to recreate
  it (the original image is gone from `uploads/` after analyze, but
  they can re-upload). A "Trash" pattern is feature creep for v1.
- **A stale palette can be applied.** If the user picks a palette
  saved months ago from a reference image and applies it to a
  totally different image, the colors won't match what's in the
  current image. That's the user's choice (and the feature's
  point). Surface this in the picker label
  ("Sunset ochres — 4 colors") so the user can self-check.
- **No browser-level regression.** A UI bug that doesn't show up at
  the HTTP layer (e.g., focus trap in the modal) won't be caught by
  the test suite. Document the manual smoke checklist (below) and
  flag browser E2E as a future ADR.

## Verification

- `node scripts/session-init.js` — must still report 10/10 checks.
- `node tests/run-all.js` — all tests (22 existing + 12 new = 34)
  must pass.
- HTTP integration smoke (covered by `tests/run-all.js`):
  1. `POST /api/palettes` with a valid body → 201, palette id
     returned.
  2. `POST /api/palettes` with empty name → 400.
  3. `POST /api/palettes` with duplicate name (case-insensitive) →
     400.
  4. `POST /api/palettes` with bad hex in colors → 400.
  5. `GET /api/palettes` lists the new entry.
  6. `PUT /api/palettes/:id` with new name → 200; GET reflects
     rename.
  7. `DELETE /api/palettes/:id` → 200; subsequent GET → 404.
  8. `POST /api/analyze` with valid `paletteId` body field returns
     analysis with the palette colors applied (mocked MiniMax or
     tested via the pure `applyPaletteToAnalysis` helper).
  9. `POST /api/analyze` with non-existent `paletteId` → 404.
- Manual UI smoke:
  1. Open the wizard. Pick a saved palette (or none).
  2. Upload an image. Click Analyze.
  3. Stage 1 returns. Click "Save palette…". Name it. Save. Toast
     appears; Step 1 picker now shows the new palette.
  4. Click "Manage…" → modal opens. Search "ochres" → row stays.
     Sort toggle works. Delete (with confirm) removes the row.
  5. Re-open the wizard. Pick the saved palette from Step 1.
     Upload a different image. Click Analyze. The analysis editor's
     colors chips show the saved palette's colors (not the new
     image's colors).
  6. Tab through the picker, save modal, and manager modal —
     focus is visible at every step. Esc closes the manager.
- Keyboard: Tab through picker → preset dropdown → upload zone →
  analyze button → editor → save button → generate. Esc closes
  any open modal.
