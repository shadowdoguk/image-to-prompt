# ADR 0013 — Palette editing, custom-create, and version tracking

## Status

Accepted. Implemented 2026-06-27.

## Context

ADR 0006 shipped saved color palettes with a tight scope: name + colors,
sourced from a finished run, rename-only via `PUT`, hard delete via
`DELETE`. It explicitly deferred three things in §9 "Out of scope":

> - Editing saved colors in the manager. Users can rename but not
>   recolor. To change the colors, save a new palette from a new run.
> - Versioning / soft-delete / undo. DELETE is hard.
> - Sharing palettes as `.i2p.json`-style files.

Real use has surfaced two problems with that scope:

1. **Users want to tweak colors after the fact.** The Stage 1 LLM
   picks the dominant colors. Often the user likes the palette but
   wants to nudge one or two — drop a tinty accent, replace a near-clone
   with a clearer name, add an exact hex from a brand book. Re-running
   analyze costs money and time, and (because the LLM is stochastic)
   may not even produce the same palette the user wanted to start
   from. The current workaround — save the palette, then save another
   one with a different name — produces palette sprawl with no
   relationship between "before" and "after."
2. **Users want to author palettes from scratch.** A user with a brand
   kit ("always these five hexes for the summer campaign") has no way
   to capture that without uploading an image that contains those
   colors. This is the same shape of artifact as a saved-from-run
   palette, so it should land in the same store.

A version history is the natural complement: any edit is a soft
commit, and the user can roll back if a tweak goes wrong. This mirrors
ADR 0009's directive history.

### Color formats

ADR 0006 accepts only `#RRGGBB` hex. Designers paste from many sources —
brand books, Figma inspect panels, CSS files — and `rgb(245, 158, 11)`
or `hsl(36, 91%, 56%)` are common. Rejecting them is hostile; converting
them on the way in is straightforward and keeps the on-disk shape
unchanged (hex only), so the rest of the system (picker chips, analysis
override, Stage 2 injection) doesn't need to learn a new format.

### Accessibility + parity

The new edit modal must follow the existing patterns: `role="dialog"`,
`aria-labelledby`, `<label for>`, keyboard nav, Esc closes, focus moves
to the first input on open. This is also covered in ADR 0006 §8.

## Decision

### 1. On-disk schema (extended)

Each palette gains a `history` array and `updated_at`, mirroring
ADR 0009's directives:

```json
{
  "id": "palette_<16 hex>",
  "name": "Sunset ochres",
  "colors": [
    { "hex": "#d97706", "name": "burnt orange" },
    { "hex": "#7c2d12", "name": "deep brown" }
  ],
  "source_run_id": "run_...",
  "source_preset_id": "preset_...",
  "created_at": "2026-06-22T11:00:00.000Z",
  "updated_at": "2026-06-27T10:00:00.000Z",
  "history": [
    {
      "version": 1,
      "name": "Sunset ochres",
      "colors": [{ "hex": "#d97706", "name": "burnt orange" }],
      "saved_at": "2026-06-22T11:00:00.000Z"
    },
    {
      "version": 2,
      "name": "Sunset ochres v2",
      "colors": [
        { "hex": "#d97706", "name": "burnt orange" },
        { "hex": "#7c2d12", "name": "deep brown" }
      ],
      "saved_at": "2026-06-27T10:00:00.000Z"
    }
  ]
}
```

The top-level `colors` / `name` always reflect the current state; each
history entry is a snapshot of those values at the time of the save.
This matches `data/directives.json`.

`readPalettes` filters out entries that are missing the new required
shape (`history` not an array) with a console warning, so a partial
corruption doesn't brick the list (same forgiving behavior as the
existing color/name checks).

### 2. Color input — accept hex, RGB, HSL; normalize to hex

New pure helper `parseColorInput(raw)`:

| Input | Output |
|---|---|
| `#d97706` | `{ hex: '#d97706', name }` |
| `d97706` | `{ hex: '#d97706', name }` (auto-prefixed) |
| `#FFF` | `{ hex: '#ffffff', name }` (3-digit expanded) |
| `rgb(245, 158, 11)` | `{ hex: '#f59e0b', name }` |
| `rgba(245, 158, 11, 0.5)` | 400 — alpha not supported (v1) |
| `hsl(36, 91%, 56%)` | `{ hex: '#f59e0b', name }` |
| `hsla(36, 91%, 56%, 1)` | 400 — alpha not supported (v1) |
| Anything else | error string |

Whitespace inside `rgb()` / `hsl()` is tolerated; case is tolerated
(`RGB(245,158,11)`, `Hsl(...)`). The output hex is always lowercase,
always 7 chars (`#rrggbb`). Names are preserved as the user typed them.

This means **the wire format for new palette saves accepts any of the
three syntaxes**, but the stored format is unchanged — still
`{ hex, name }` arrays with hex as the canonical form.

### 3. Server helpers (new)

- `parseColorInput(raw)` — returns `{ hex, name }` on success or
  `{ error }` on parse failure. Reused everywhere.
- `validatePaletteColorsFlexible(colors, opts)` — accepts the three
  input formats; mirrors `validatePaletteColors` but with the parser
  inside. Returns `{ colors, error }` so the caller can use the
  normalized array directly.
- `validatePaletteEdit(body, { existingNames, excludeId })` —
  partial mode. Each field present is validated; empty body → error;
  must have at least one of `name`, `colors`. Reuses
  `validatePaletteName` for the name field.
- `applyPaletteUpdate(palette, body)` — pure helper. Mutates the
  palette in place; returns null on success or an error string.
- `snapshotPalette(palette)` — builds a fresh history entry from the
  current top-level state.
- `pushPaletteHistory(palette)` — appends a snapshot and bumps
  `updated_at`. Used on every write that produces a new user-visible
  state (initial POST, PUT, custom POST, restore).

### 4. Routes (new + extended)

| Method | Path | Change |
|---|---|---|
| `GET`    | `/api/palettes` | unchanged |
| `GET`    | `/api/palettes/:id` | response now includes `history` + `updated_at` |
| `POST`   | `/api/palettes` | unchanged contract; now also pushes v1 to `history` and writes `updated_at` |
| `POST`   | `/api/palettes/custom` | **new**. Creates a palette from scratch. Body: `{ name, colors }`; `source_preset_id` optional. No `source_run_id` required (omitted). Same `name` + `colors` validation as POST. Response: 201 with the new palette. |
| `PUT`    | `/api/palettes/:id` | body now accepts `{ name?, colors? }` (partial). Empty body → 400. Each successful update pushes a history entry. Existing rename-only behavior is preserved (name-only PUT still works). |
| `POST`   | `/api/palettes/:id/restore/:version` | **new**. Rollback. Body of the named version becomes the new top-level values; a new history entry is appended (version = current + 1) so the rollback is itself a recorded edit. |
| `DELETE` | `/api/palettes/:id` | unchanged. |

### 5. Edit UI — new modal `edit-palette-modal`

Opened two ways:
- From the palette manager row → "Edit" button (loads the palette).
- From the manager footer → "New palette" button (empty fields, edit
  in place; save calls `POST /api/palettes/custom`).

Layout:

```
┌─ Edit palette ─  (also: "New palette" when empty) ──┐
│ Name [_______________]  (12 / 60)                    │
│ Preview: ■■■■■ (live swatches, n colors)             │
│ Colors                                               │
│   ■ burnt orange  [#d97706]  [×]  ◀ color picker     │
│   ■ deep brown    [#7c2d12]  [×]  ◀ color picker     │
│   … (one row per color)                              │
│ [+ Add color]   picker | hex/rgb/hsl input | name    │
│ Source: from preset_alla_prima_oil  (read-only)      │
│ Version history                                      │
│   v3  now    ■■■■■  current                          │
│   v2  3d ago ■■■■   [Restore]                        │
│   v1  5d ago ■■■    [Restore]                        │
│ [ Cancel ]  [ Delete… ]            [ Save changes ]  │
└──────────────────────────────────────────────────────┘
```

Behavior:

- **Name field.** Char count live; empty → Save disabled with inline
  hint.
- **Color editor.** Each row is the existing chip pattern
  (swatch + hex + name + remove ×), plus a `<input type="color">` that
  updates the swatch and the hex input live. The hex input accepts
  `#rgb`, `#rrggbb`, `rgb(...)`, `hsl(...)`. As the user types, an
  invalid entry marks the input with `aria-invalid="true"` and a
  field-level error message; the swatch preview goes gray. A valid
  entry updates the swatch live. The name field accepts freeform text.
- **Add color.** A small form at the bottom: color picker (defaults to
  `#3b82f6`), a text input that accepts any of the three formats, and
  a name field. "+ Add" pushes the new entry; clear the inputs.
- **Live preview.** A row of swatches at the top of the modal reflects
  the current editing buffer, so the user sees the final palette
  before saving. (The individual chip rows below are the editor; the
  preview is the "what will be saved" view.)
- **Save.** Validates client-side first (name non-empty, ≥ 1 color,
  all colors parseable). On 200/201, closes the modal, refreshes
  the manager list + picker, shows a toast.
- **Cancel.** Discards the buffer and closes. If the buffer is dirty,
  confirms first.
- **Delete.** Inside the edit modal (more discoverable than the row
  button). Confirms, then calls DELETE.
- **Restore.** Each non-current history entry has a Restore button.
  Confirm dialog → rollback → modal re-populates with the restored
  values, history list re-renders (the restore itself is a new entry).

### 6. Validation rules (recap, with new bits)

`validatePaletteEdit(body, { existingNames, excludeId })`:

- Body must be a JSON object.
- Empty body (no `name`, no `colors`) → 400.
- If `name` present: same rules as `validatePaletteName` (1..60
  chars, unique within `existingNames` minus self).
- If `colors` present: array, ≥ 1 entry, ≤ `MAX_PALETTE_COLORS`
  (50). Each entry parses as hex / rgb / hsl (via `parseColorInput`).
  Resulting normalized colors are returned for the caller to apply.

`parseColorInput(raw)`:

- Trim, lowercase the syntax prefix.
- Hex: `/^#?[0-9a-f]{3}$/` → expand to 6; `/^#?[0-9a-f]{6}$/` → as-is.
  Auto-prefix `#` if missing.
- `rgb(r, g, b)`: r,g,b integers 0..255. Convert to hex.
- `rgba(...)`, `hsla(...)`: 400 — alpha not supported in v1. (Documented
  as a deliberate scope cut; can be added later without schema change.)
- Anything else: 400.

### 7. Error scenarios

| Scenario | Response |
|---|---|
| Edit: empty body | 400 "At least one of `name` or `colors` must be provided." |
| Edit: invalid color string (`rgb(999,...)`, `hsl(red,...)`) | 400 with the failing index |
| Edit: empty colors array | 400 (min 1 color) |
| Edit: duplicate name | 400 |
| Edit: name > 60 chars | 400 |
| Restore: invalid version | 400 |
| Custom-create: empty name / empty colors / bad colors | 400 |
| Custom-create: duplicate name | 400 |
| Disk I/O failure on any write | 500 |
| Disk read failure on restore | 500 |
| Manager: legacy entry missing `history` | dropped with warning (existing pattern) |

### 8. Accessibility

- Edit modal: `role="dialog"`, `aria-labelledby="edit-palette-modal-title"`.
- Each color row's remove button: `aria-label="Remove color <name>"`.
- Add-color inputs each have a `<label>`; the hex text input has
  `aria-describedby` pointing at the format hint.
- Inline error span has `role="alert"` so screen readers announce
  invalid input as it occurs.
- Save button has `aria-disabled` while the buffer is invalid (also
  `disabled` so it's not focusable).
- Version history list is `<ul>`; each entry is `<li>`; the Restore
  button's `aria-label` includes the version number and relative time.
- Esc closes the modal (extends the existing global Esc handler).
- On open, focus moves to the name input; on close, focus returns to
  the originating button (the manager row's Edit button).

### 9. Out of scope

- Alpha / opacity on colors (deliberate cut — defer until a real
  use case surfaces).
- Drag-to-reorder colors. Reordering changes identity (the picker
  applies colors in order), and the saving flow treats order as
  meaningful. Defer until reorder is a real ask.
- Soft-delete / Trash. DELETE is hard, as in ADR 0006.
- Sharing palettes as `.i2p.json` files (also out of scope in 0006,
  same rationale).
- Live collaboration / multi-user (single-user app).
- Per-color opacity channel in `colors[]` — schema stays `{ hex, name }`.

## Architecture (after)

```
   ┌── POST /api/palettes/custom ──┐
   │   (UI: New palette button)    │
   │                                ▼
   │                          ┌──────────────────────────────────┐
   │                          │  data/palettes.json              │
   │   POST /api/palettes  ─▶ │  [ { id, name, colors, history,  │
   │   (UI: Save modal)        │      source_run_id,             │
   │                           │      source_preset_id,          │
   │   PUT /api/palettes/:id ─▶│      created_at, updated_at } ] │
   │   (UI: Edit modal)        └──────────────┬───────────────────┘
   │   POST /api/palettes/:id/                 │
   │       restore/:version                   │ read
   │                                          ▼
   │                          ┌──────────────────────────────────┐
   │   GET /api/palettes  ──▶│  GET /api/palettes               │
   │   (UI: picker + manager) │  (manager modal + picker)        │
   │                          └──────────────────────────────────┘
   │
   │                          ┌──────────────────────────────────┐
   │   POST /api/analyze  ──▶│  paletteId in form (ADR 0006)     │
   │                          │  → strips colors from schema      │
   │                          │  → injects palette colors        │
   │                          └──────────────────────────────────┘
```

## Files changed

| File | Change |
|---|---|
| `server.js` | New constants: `MAX_PALETTE_HISTORY`. New helpers: `parseColorInput`, `validatePaletteColorsFlexible`, `validatePaletteEdit`, `applyPaletteUpdate`, `snapshotPalette`, `pushPaletteHistory`. Existing `readPalettes` filter extended to require `history` array. New routes: `POST /api/palettes/custom`, `POST /api/palettes/:id/restore/:version`. Extended `POST /api/palettes` and `PUT /api/palettes/:id` to push history. New exports. |
| `src/index.html` | New edit-palette modal: name input + char count, live preview swatches, color editor (chip rows with pickers + remove), add-color form, version history list, save/cancel/delete buttons. Manager modal footer gains "New palette" button. Each manager row gains an "Edit" button alongside Delete. |
| `src/app.js` | New state: `editingPaletteId`, `editingPaletteBuffer`, `editingPaletteIsNew`. New functions: `openEditPaletteModal`, `closeEditPaletteModal`, `renderPaletteColorEditor`, `renderPaletteHistoryList`, `addColorToBuffer`, `removeColorFromBuffer`, `submitPaletteEdit`, `createNewPalette`, `deletePaletteFromEdit`, `restorePaletteVersion`. Manager list now renders Edit + Delete buttons per row. New global Esc handler covers the new modal. |
| `src/styles.css` | New `.edit-palette-*` rules. Reuse `.color-chip`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.modal`, `.modal-content--wide`. New `.palette-history-*` rules mirroring `.directive-history-*`. |
| `CONTEXT.md` | Update Saved palette entity row to mention `history`, `updated_at`, and the new endpoints. Add a note that palettes can now be edited/custom-created. |
| `README.md` | Update "Saved palettes" section: editing, custom-create, version history. Add new endpoints to the API table. Note that colors can be input as hex/RGB/HSL. |
| `tests/run-all.js` | New tests (see Verification). |
| `docs/adr/0013-palette-editing.md` | This file. |

No changes to `FIELD_PALETTE`, the per-preset prompts, the Stage 1
schema, the Stage 1.5 logic, the subject prompt, or the picker chips
(`renderColorsInput` still consumes `{ hex, name }`).

## Why these decisions

- **Canonical storage stays hex.** Adding `{ rgb, hsl, hex }` per entry
  would triple the on-disk size for no benefit — every consumer
  (picker, chips, analysis override) only uses hex. Normalize on write,
  accept any format on read. Same pattern as ADR 0009's tags (the
  client can paste `"Moody, Cinematic"`, the server stores them
  normalized).
- **History per palette, not a separate audit log.** The directives
  precedent (ADR 0009) puts `history[]` on the entity itself. Same
  rules apply: one file, atomic write, no cross-references to keep in
  sync. Read once, render the timeline.
- **`POST /api/palettes/custom`, not overloading `POST /api/palettes`.**
  The original endpoint is "save a palette from a finished run" —
  `source_run_id` is required because it's the whole point (linking
  the saved palette to the run that produced it). A custom-created
  palette has no run. Two endpoints with disjoint contracts is clearer
  than one endpoint with a "is this from a run?" boolean.
- **Top-level state + history, not deltas.** A snapshot per write
  keeps the diff legible (`v2` shows the whole palette at v2 time),
  which is what users actually want when they're deciding whether to
  restore. Deltas would save a few bytes; v1 follows the directives
  precedent.
- **No reordering in this iteration.** Reorder changes the *meaning*
  of "this is the third color" (color order matters when the palette
  is applied — the third chip is the third color in the prompt). Add
  reorder when the user asks for it.
- **Alpha / opacity deferred.** Every existing call site treats colors
  as opaque. Adding alpha means teaching the chip renderer, the
  Stage 2 prompt injection, and the analysis-override path about it —
  nontrivial for v1. Defer until a use case surfaces.

## Trade-offs and risks

- **More schema fields to migrate.** Existing palettes on disk (after
  this ADR lands) have no `history` field. `readPalettes` filters
  those out today; the migration is "re-save the palette" (open the
  manager, click Edit, click Save). That's painful for users with
  many palettes. The mitigations: (a) `readPalettes` synthesizes an
  empty `history: []` array on read for entries that lack it, so
  existing palettes keep working without re-save; the first PUT on
  such a palette pushes v1 to history. (b) The list filter is
  relaxed, not strict, so a missing `history` doesn't drop the entry.
- **Larger JSON file over time.** Each history entry is ~80 bytes for
  a typical palette. A user with 50 palettes and 10 edits each
  adds ~40 KB. Trivial. No cap needed in v1.
- **Two endpoints to keep in sync.** `POST /api/palettes` and
  `POST /api/palettes/custom` both write palettes; the latter just
  skips `source_run_id`. They share `validatePaletteName` /
  `validatePaletteColorsFlexible` / `pushPaletteHistory`. The shared
  logic is extracted into helpers; the endpoints are thin wrappers.
- **No undo for accidental Delete from the edit modal.** Same as
  ADR 0006 — Delete is hard. The history helps for *edits*, not for
  delete. A Trash pattern is feature creep for v1.
- **Browser E2E not added.** Same reasoning as ADR 0006 — no
  Playwright setup, the HTTP integration tests cover the full
  save→edit→restore→delete flow.

## Verification

- `node scripts/session-init.js` — must still report 10/10 checks.
- `node tests/run-all.js` — all existing tests must still pass,
  plus the new tests below.
- New pure-function tests:
  1. `parseColorInput` accepts hex (`#d97706`, `d97706`, `#FFF`),
     `rgb(...)`, `hsl(...)` with permissive whitespace + case.
  2. `parseColorInput` rejects `rgba(...)`, `hsla(...)`, `rgb(999,0,0)`,
     `hsl(red,...)`, empty string, non-strings, `transparent`.
  3. `parseColorInput` always returns 7-char lowercase hex on success.
  4. `validatePaletteEdit` empty body → error; name-only OK; colors-only
     OK; both OK.
  5. `validatePaletteEdit` rejects colors with any invalid color string.
  6. `validatePaletteEdit` rejects empty colors array.
  7. `validatePaletteEdit` enforces name uniqueness via existingNames.
  8. `pushPaletteHistory` appends with `version = history.length + 1`
     and bumps `updated_at`.
  9. `snapshotPalette` round-trips top-level state.
- New HTTP integration tests:
  1. `POST /api/palettes` now includes `history[0]` and `updated_at`.
  2. `PUT /api/palettes/:id` with name only → 200, history appended
     (v2), top-level name updated.
  3. `PUT /api/palettes/:id` with colors only → 200, history appended,
     colors replaced with normalized hex.
  4. `PUT /api/palettes/:id` with both → 200, history appended once.
  5. `PUT /api/palettes/:id` with `colors: []` → 400.
  6. `PUT /api/palettes/:id` with empty body → 400.
  7. `PUT /api/palettes/:id` with `colors: [{ hex: 'not-hex' }]`
     → 400.
  8. `PUT /api/palettes/:id` with `colors: [{ hex: 'rgb(245,158,11)' }]`
     → 200; stored as `{ hex: '#f59e0b', name: 'x' }`.
  9. `PUT /api/palettes/:id` with `colors: [{ hex: 'hsl(36,91%,56%)' }]`
     → 200; stored as hex.
  10. `POST /api/palettes/custom` with valid body → 201, no
      `source_run_id` written.
  11. `POST /api/palettes/custom` with duplicate name → 400.
  12. `POST /api/palettes/custom` with empty colors → 400.
  13. `POST /api/palettes/:id/restore/1` → 200, top-level values equal
      history[0], a new history entry appended (v3 on a 2-edit palette).
  14. `POST /api/palettes/:id/restore/999` → 400 (version not found).
  15. `DELETE /api/palettes/:id` (regression) → 200, palette gone.
  16. `GET /api/palettes/:id` returns palette with `history` populated.
- Frontend HTML/JS assertions:
  1. `#edit-palette-modal` exists with `role="dialog"`, an
     `aria-labelledby` pointing at a real title id.
  2. Each color row has a remove button with `aria-label` referencing
     the color name.
  3. Manager row has both an Edit and a Delete button.
  4. "New palette" button exists in the manager modal footer.
- Manual UI smoke:
  1. Open the manager. Click Edit on a saved palette. Modal opens with
     the palette's current state.
  2. Edit a color's name; click Save → toast; manager list shows the
     new name.
  3. Open Edit again; pick a new color via the swatch picker; the
     preview at the top updates live.
  4. Type `rgb(245, 158, 11)` into the hex input → swatch turns orange;
     Save → reopens with the new color.
  5. Click Restore on v1 → modal confirms; after confirm, palette
     rolls back; history list shows the new v3 entry.
  6. Manager → New palette → fill name + 3 colors → Save → new palette
     appears in the picker.
  7. Tab through the modal — focus is visible at every step; Esc closes.
  8. Try to save with 0 colors → Save is disabled, inline error
     appears.
