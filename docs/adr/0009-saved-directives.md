# ADR 0009 — Saved directives

## Status

Accepted. Implemented 2026-06-22.

## Context

Stage 2 (the text LLM) accepts a free-form `directives` string alongside the
edited analysis. Today it's a single ad-hoc textarea in the analysis editor:
the user types whatever they want for this run, Stage 2 receives it once, and
the text evaporates.

This forces three real pain points:

1. **No reuse.** A user who lands on a directive they like ("add a punchy red
   accent in the upper-right", "push lighting toward chiaroscuro", "use
   shorter sentences") has to retype it from memory for every subsequent
   job. The text isn't durable.
2. **No organization.** A user with 10+ useful directives has no way to
   keep them apart, label them, or find one by purpose.
3. **No evolution tracking.** When a user iterates on a directive, the old
   version is gone. They can't roll back if the new version regresses
   quality, and they can't A/B two phrasings against each other.

The palettes feature (ADR 0006) solved an analogous problem for color
overrides. Subject prompts (ADR 0005) and per-preset Stage 2 prompts (ADR
0007) are likewise persisted, but neither covers the *user* directives.

The requirement that landed is a full directive management subsystem:

- A **Save** button to store the current textarea as a named, reusable
  directive.
- An **Apply** button to load a selected saved directive into the textarea
  before running Stage 2.
- A **Manage** interface for viewing, editing, deleting, tagging, searching,
  filtering, importing, and exporting.
- **Persistence** across sessions.
- **Validation** to reject malformed directives at write time.
- **Version history** per directive, with rollback to any prior version.
- **Import / export** for sharing directive sets and backing up.

## Decision

### 1. Persist directives at `data/directives.json`

Ships as `[]`. Helper trio mirrors the ADR 0006 palette pattern:

- `readDirectives()` — read+parse; on missing file, seed `[]`; on parse
  failure, log + return `[]`. Drops malformed entries (warns to console).
- `writeDirectives(directives)` — atomic-ish write: write to a sibling
  temp file, then `fs.renameSync` over the real file. POSIX rename is
  atomic on the same filesystem; cheap insurance against half-written
  files on crash. Naive lock-free; same single-user assumption as the
  palettes file.
- `generateDirectiveId()` — `directive_<16 hex>`.

Shape of each entry:

```json
{
  "id": "directive_<16 hex>",
  "name": "Dramatic red accent",
  "content": "Add a punchy red accent in the upper-right corner.",
  "tags": ["color", "composition"],
  "created_at": "2026-06-22T12:00:00.000Z",
  "updated_at": "2026-06-22T12:00:00.000Z",
  "last_used_at": null,
  "usage_count": 0,
  "history": [
    {
      "version": 1,
      "name": "Dramatic red accent",
      "content": "Add a punchy red accent in the upper-right corner.",
      "tags": ["color", "composition"],
      "saved_at": "2026-06-22T12:00:00.000Z"
    }
  ]
}
```

`history` is **append-only**. Every write that changes `content`, `name`,
or `tags` pushes a new history entry capturing the *pre-update* values
(or, on initial save, the initial values), and bumps `version`. The
top-level `content` / `name` / `tags` are always the latest. `version` is
the integer count of saves (>= 1).

Rollback (`POST /api/directives/:id/restore/:version`) reads the named
version, makes its `content` / `name` / `tags` the new top-level values,
and pushes a new history entry with `version = current + 1` that
mirrors those values. The history array grows monotonically; entries are
never deleted or reordered. This means a user can roll forward and
backward through the entire edit history without losing intermediate
states.

### 2. New REST surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/directives` | List all saved directives |
| `GET` | `/api/directives/:id` | Get one (with history) |
| `POST` | `/api/directives` | Save a new directive (name + content + tags) |
| `PUT` | `/api/directives/:id` | Update an existing directive (partial: name, content, tags) |
| `DELETE` | `/api/directives/:id` | Hard-delete |
| `POST` | `/api/directives/:id/apply` | Mark as used (increments `usage_count`, sets `last_used_at`) |
| `POST` | `/api/directives/:id/restore/:version` | Rollback to a specific history version |
| `GET` | `/api/directives/export/all` | Download all directives as `.i2p.json` |
| `POST` | `/api/directives/import` | Import a `.i2p.json` envelope |

All endpoints reuse the existing `{ success, data, error }` envelope.
Validation errors → 400. Missing directive → 404. Disk failures → 500.
Name-uniqueness errors → 400 with the conflicting name.

### 3. Stage 2 integration

Stage 2 (the `POST /api/generate-prompt` route) does not change. The user
loads a saved directive into the textarea via the Apply button, and the
existing `directives` field of the request body carries the content to
Stage 2. Apply is purely a client-side "load into textarea" action; the
`POST /api/directives/:id/apply` endpoint only **tracks usage** for the
manager's "Most used" sort and usage-frequency filter.

This avoids a hidden server-side state that diverges from the textarea.
The textarea is the source of truth at the moment of Stage 2; the saved
directives are a library of pre-written inputs.

### 4. Frontend — three new UI surfaces

#### 4a. Actions row under the directives textarea

```
┌─ Directives (optional) ──────────────────────────────────────┐
│ Free-form instructions passed to Stage 2.                    │
│ ┌──────────────────────────────────────────────────────────┐  │
│ │ [textarea 1000 chars]                                    │  │
│ └──────────────────────────────────────────────────────────┘  │
│ 123 / 1000                                                    │
│                                                               │
│ ─── Saved directives (optional) ────────────────────────────  │
│ [ — Choose a saved directive — ▼ ]   [ Apply ]                │
│ [ Save… ]                              [ Manage… ]            │
└───────────────────────────────────────────────────────────────┘
```

- The `<select>` is populated from `GET /api/directives`. Each option:
  `name (N uses)`. Empty value = no selection.
- **Save…** opens the save modal. Saves the *current textarea content* as
  a new named directive. Disabled if the textarea is empty (whitespace
  doesn't count).
- **Apply** loads the selected option's `content` into the textarea,
  updates the char counter, and calls `POST /api/directives/:id/apply` to
  record usage. Disabled if nothing is selected.
- **Manage…** opens the manager modal.

#### 4b. Save modal

```
┌─ Save directive ─────────────────────────────────────────────┐
│ Name [________________________] (12 / 60)                    │
│ Tags (comma-separated) [color, composition]                  │
│ Content preview:                                              │
│ ┌──────────────────────────────────────────────────────────┐  │
│ │ Add a punchy red accent in the upper-right corner.       │  │
│ └──────────────────────────────────────────────────────────┘  │
│ [ Cancel ]  [ Save ]                                          │
└─────────────────────────────────────────────────────────┘
```

- Submitting with valid name + non-empty content + tags → `POST
  /api/directives`. On success, the new directive's `id` is selected in
  the saved-directives `<select>` so the user can re-apply it without
  re-picking.

#### 4c. Manager modal

```
┌─ Saved directives ───────────────────────────────────────────┐
│ [search by name or tag…]                                     │
│ Sort: ( ) Newest first  ( ) Oldest first                     │
│       ( ) Most used  ( ) Name A–Z                            │
│ Tags:  [color (2)] [composition (1)] [mood (1)]              │
│ ────────────────────────────────────────────────────────────  │
│ ┌─ Add dramatic red accent ───────────────[Edit] [Apply] [×]┐ │
│ │ "Add a punchy red accent in the upper-right corner."     │ │
│ │ #color #composition • 7 uses • last used 2h ago • 2 ver  │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─ Moodier lighting ─────────────────────[Edit] [Apply] [×]┐ │
│ │ "Push the lighting toward chiaroscuro..."                │ │
│ │ #lighting #mood • 3 uses • last used 1d ago • 1 ver       │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                               │
│ [Import…]  [Export all]                       [Close]         │
└───────────────────────────────────────────────────────────────┘
```

Features:

- **Search** filters by case-insensitive substring on `name` AND any
  `tag`. The `tags: [color]` chip filter is an AND: a directive must
  contain ALL selected tag chips to be visible.
- **Sort** order radio group:
  - `Newest first` (default) — by `created_at` desc.
  - `Oldest first` — by `created_at` asc.
  - `Most used` — by `usage_count` desc, ties broken by `created_at` desc.
  - `Name A–Z` — by `name` asc (case-insensitive).
- **Tag chip filter** built dynamically from the union of all tags
  across the current list, with usage counts. Clicking a chip toggles
  it. A directive is visible only if it contains all currently-active
  chips.
- **Edit** opens the edit modal.
- **Apply** loads into the textarea and closes the manager.
- **× (delete)** confirms with `confirm()` and then `DELETE`.
- **Import** opens a hidden `<input type="file">` for `.i2p.json`.
- **Export all** triggers `GET /api/directives/export/all` and saves the
  response as `directives.i2p.json`.

#### 4d. Edit modal

```
┌─ Edit directive ─────────────────────────────────────────────┐
│ Name [________________________]                              │
│ Content [________________________________________] (200/1000)│
│ Tags [color, composition]                                    │
│                                                               │
│ Version history (3 versions)                                 │
│   v3 (current) — 2d ago               [—]                    │
│   v2 — 3d ago                         [Restore]              │
│   v1 (initial) — 5d ago               [Restore]              │
│                                                               │
│ [Cancel]  [Delete]  [Save changes]                           │
└───────────────────────────────────────────────────────────────┘
```

- **Save changes** → `PUT /api/directives/:id` with the new
  `name` / `content` / `tags`. Server creates a new history entry and
  bumps `version`.
- **Restore** on a non-current version → `POST
  /api/directives/:id/restore/:version`. The restored values become the
  new top-level values, and a new history entry is appended with
  `version = current + 1`. The original target version is still in
  history; nothing is lost.
- **Delete** inside the edit modal hard-deletes the directive
  (alternative to the manager's per-row delete).

### 5. Validation rules

`validateDirectiveBody(body, { existingNames })`:

- `name`: string, trim length 1–60. Required.
- `name uniqueness`: `name.trim().toLowerCase()` must not equal an
  existing directive's `name.toLowerCase()`. 400 with the conflicting
  name.
- `content`: string, trim length 1–1000 (mirrors the existing
  `MAX_DIRECTIVES_LENGTH` cap used at the Stage 2 boundary, so saved
  directives are always safe to send to the LLM). Required.
- `tags`: array of strings; each tag is non-empty, ≤ 24 chars,
  lowercase-normalized, matches `^[a-z0-9][a-z0-9-]*$` (kebab-case
  identifiers, no spaces, no leading dash). Max 8 tags per directive.
  Omitted / null / `[]` is fine — a directive can have no tags.
- Unknown top-level fields: rejected (strict shape on POST; partial on
  PUT).

`PUT /api/directives/:id` accepts partial `{ name?, content?, tags? }` —
each field is validated independently, and any field present is updated
as a single atomic history entry. A PUT that sends no fields is a no-op
(400). A PUT that sends only a subset of the three fields updates only
those fields and records the *new full snapshot* (the merged result) in
history, so the history always captures the directive's complete state at
each save.

`POST /api/directives/import` accepts the envelope and validates each
directive using `validateDirectiveBody` with a per-directive
`existingNames` set that includes all *existing* names *plus* the names
of any directives already imported in the same batch. The import is
atomic — if any directive in the envelope is invalid, none are written
and the original file is untouched.

### 6. Export envelope

```json
{
  "format": "image-to-prompt-directives",
  "version": 1,
  "exported_at": "2026-06-22T12:34:56.789Z",
  "directives": [
    { "id": "directive_…", "name": "…", "content": "…", "tags": […],
      "created_at": "…", "updated_at": "…", "last_used_at": null,
      "usage_count": 0, "history": [ … ] }
  ]
}
```

`format` and `version` are validated on import. Unknown format → 400. A
directive's `id` in the import is **ignored** — the import always
mints fresh ids to prevent collisions with existing local directives.
`usage_count` is reset to 0 on import (the recipient's library tracks
its own usage). `history` is preserved as-is (preserves the import
provenance). `last_used_at` is reset to null on import.

### 7. Error scenarios covered

| Scenario | Response |
|---|---|
| Save: empty / whitespace / > 60 chars name | 400 |
| Save: name already used (case-insensitive) | 400 |
| Save: empty / > 1000 chars content | 400 |
| Save: invalid tag (uppercase, space, special char) | 400 |
| Save: more than 8 tags | 400 |
| Update: any of the above | 400 |
| Update: no fields in body | 400 |
| Update: directive id not found | 404 |
| Apply / Restore: id not found | 404 |
| Restore: version out of range | 400 |
| Delete: id not found | 404 |
| Storage layer I/O error during read or write | 500 |
| Import: missing format / unknown format | 400 |
| Import: any directive in batch invalid | 400, nothing written |
| Manager: corrupted directive entry | entry dropped, console warn |
| Manager: storage file missing | treated as empty list, file seeded |

### 8. Accessibility

- Save and Manager modals follow the existing `role="dialog"
  aria-labelledby` pattern from ADR 0006.
- All form controls have associated `<label for>` and `aria-label` where
  needed.
- Tag chips are toggleable buttons with `aria-pressed` reflecting state.
- Search input is `<input type="search">` with `aria-label`.
- Sort radios wrapped in `<fieldset><legend>`.
- Version history "Restore" buttons have `aria-label="Restore version N
  from <relative date>"`.
- Edit modal's content textarea has a live character counter wired via
  `aria-describedby` (screen reader announces "X / 1000").
- Esc closes any open modal (existing handler extended).
- Tab order is DOM order; no focus traps beyond the modal pattern.

### 9. Out of scope

- Per-user directives. Single global list, single-user app (same as
  palettes).
- Sharing individual directives (no `GET /api/directives/:id/export`).
  Export-all is sufficient for the v1 sharing use case.
- Soft-delete / Trash. Hard delete. A user who wants to recover can
  restore a previous version, but cannot undelete a removed directive.
- Multi-user concurrency / file locks. Same single-user assumption as
  palettes and overrides.
- Tag autocomplete / suggestions. The chip filter is built dynamically
  from existing tags, which is the v1 "discovery" affordance.
- Diffing between version snapshots. The history shows metadata and the
  content of each version side-by-side; a textual diff is a v2 feature.
- Cloud sync. The export-all endpoint is the v1 sharing mechanism.

## Architecture (after)

```
                                ┌──────────────────────────────────┐
   ┌──── POST /api/directives ───▶                                 │
   │                           │  data/directives.json             │
   │   (UI: Save modal)        │  [ { id, name, content, tags,    │
   │                           │      history, usage_count, ... } ]│
   │                           └──────────┬────────────────────────┘
   │                                      │
   │                            read      │        write (PUT, restore)
   │                                      ▼
   │                           ┌──────────────────────────────────┐
   │   GET /api/directives ──▶│  GET /api/directives               │
   │   (UI: apply select +    │  (manager modal + apply select)   │
   │        manager modal)    └──────────────────────────────────┘
   │
   │                           ┌──────────────────────────────────┐
   │   POST /:id/apply ──────▶│  increment usage_count            │
   │   (UI: Apply button)    │  set last_used_at                 │
   │                          └──────────────────────────────────┘
   │
   │   POST /:id/restore/:v ─▶│  read history[v], make current   │
   │   (UI: Edit modal       │  push new history entry           │
   │        Restore button)  └──────────────────────────────────┘
   │
   │   GET /export/all ──────▶│  build { format, version,        │
   │   (UI: Export all btn)  │    exported_at, directives }      │
   │                          └──────────────────────────────────┘
   │
   │   POST /import ─────────▶│  parse envelope, validate each,  │
   │   (UI: Import btn)      │  mint fresh ids, atomic write     │
   │                          └──────────────────────────────────┘
```

## Files changed

| File | Change |
|---|---|
| `server.js` | New constants: `DIRECTIVES_FILE`, `MAX_DIRECTIVE_NAME_LENGTH`, `MAX_DIRECTIVE_CONTENT_LENGTH`, `MAX_DIRECTIVE_TAGS`, `MAX_DIRECTIVE_TAG_LENGTH`, `DIRECTIVE_FILE_FORMAT`, `DIRECTIVE_FILE_VERSION`. New helpers: `generateDirectiveId`, `readDirectives`, `writeDirectives`, `validateDirectiveBody`, `normalizeDirectiveTags`, `pushDirectiveHistory`. New routes: `GET/POST/DELETE /api/directives`, `GET/PUT /api/directives/:id`, `POST /api/directives/:id/apply`, `POST /api/directives/:id/restore/:version`, `GET /api/directives/export/all`, `POST /api/directives/import`. New exports. |
| `data/directives.json` | New persistent file (seeded to `[]` on first read). |
| `src/index.html` | New `.directives-actions` row (select, Apply, Save, Manage). New save-directive modal. New manage-directive modal. New edit-directive modal. Hidden placeholder controls (so `dom.*` resolves before first render). |
| `src/app.js` | New state: `directives`, `directiveManagerSearch`, `directiveManagerSort`, `directiveTagFilter`, `selectedDirectiveId`, `editingDirectiveId`. New functions: `loadDirectives`, `renderDirectiveSelect`, `applySelectedDirective`, `openSaveDirectiveModal`, `saveDirective`, `openManageDirectivesModal`, `renderDirectiveManagerList`, `deleteDirective`, `openEditDirectiveModal`, `restoreDirectiveVersion`, `exportDirectives`, `importDirectivesFromFile`. New event handlers. Keyboard handler extended. |
| `src/styles.css` | New `.directives-actions`, `.directives-actions__row`, `.directive-tag-chip`, `.directive-manager-controls`, `.directive-manager-list`, `.directive-manager-item`, `.directive-manager-item__tags`, `.directive-history-list`, `.directive-history-item`, `.directive-history-item__restore` styles. Reuses `.modal`, `.btn-secondary`, `.btn-danger`, `.btn-primary`, `.char-count` from the existing palette/preset modals. |
| `CONTEXT.md` | New `SavedDirective` entity row. New `directives.json` row in data files. Note in the Stage 2 description that the textarea content is the source of truth at generation time, and that saved directives are loaded into the textarea before generation. |
| `README.md` | New "Saved directives" section. New API endpoints table. Note `data/directives.json` under Project Structure. |
| `tests/run-all.js` | New test block (see Verification). |
| `docs/adr/0009-saved-directives.md` | This file. |

No changes to the Stage 2 route, the field palette, the presets file, or
the directives textarea's maxlength.

## Why these decisions

- **Server-side disk, not localStorage.** Matches the rest of the
  persistence in this app (`data/presets.json`, `data/palettes.json`,
  `data/subject_prompt.json`). Survives browser refresh, browser switch,
  deploy. localStorage would also mean a divergent copy across browsers
  for the same user.
- **Append-only history.** Editing is the dominant operation; users
  iterate often. Keeping every prior version (rather than a fixed
  depth-of-N ring buffer) is a one-line trade: the file grows by one
  small entry per edit, which is bounded by the user's edit cadence.
  Rolling back is then a single POST that pushes the restored values as
  a new top-level state — a linear history that records the
  user's actual edit trail.
- **Stage 2 untouched.** The textarea is already the source of truth at
  generation time. Adding a server-side "active directive" would
  duplicate state and create a divergence risk (the textarea might
  have been edited since the last "apply"). Tracking usage separately
  keeps the library valuable (sort by most-used, filter by usage
  frequency) without touching the runtime path.
- **Apply as a two-step.** Loading the content into the textarea is
  done client-side, then a separate `POST /:id/apply` records usage.
  This keeps the textarea as the user-visible state and lets the user
  edit the loaded content before generating without leaving the
  directive underused in the metrics.
- **Tags as kebab-case identifiers.** Tags are an index key (used in
  search, chip filter, export). Kebab-case + lowercase normalization
  avoids "Color" vs "color" divergence and avoids parsing
  complications with spaces or punctuation in tag names. The UI shows
  them as `#color #composition` for the conventional look.
- **Import mints fresh ids.** Preserves the import as provenance but
  prevents collisions in the recipient's library. Usage stats reset on
  import so the recipient's stats reflect their own usage.
- **History preserved on import.** The import envelope keeps the
  full `history` array. This means a user importing someone else's
  directive can roll back through *their* edits, not just the
  recipient's.
- **No browser-level E2E in this iteration.** Same reasoning as ADR
  0006: no Playwright setup in the project, would balloon the PR. The
  new HTTP-level integration tests cover the full save → list → apply →
  update → restore → delete → import → export flow at the API layer.

## Trade-offs and risks

- **Naive write can lose data under concurrent edits.** Same as ADR
  0005 / 0006. Single-user wizard. File lock + retry deferred.
- **No undo on delete.** Hard delete. A user who accidentally deletes a
  directive loses its full history. Export-all is the safety net —
  encourage periodic export.
- **History grows unboundedly.** A power user who edits a single
  directive 1000 times ends up with 1000 history entries. The
  directive's current state is still small (one entry's worth of
  content + tags + name + metadata), but the history is large. The
  default cap is implicit — the file size grows linearly with edits,
  not with directives. For the v1 single-user wizard this is
  acceptable; a future ADR can add a per-directive history cap or
  compaction.
- **Tag filter is a frontend convenience, not a backend index.** For
  v1 the directive list is small (single-user app, low directive
  count). The full list is always sent to the client and filtered
  there. A backend tag-indexed search is a future optimization if the
  library grows beyond ~1000 directives.
- **A stale directive can be applied.** If the user loads an old
  directive and the underlying world has changed, the directive is
  still applied as-is. That's the user's choice (and the feature's
  point) — the search/sort affordances help them find the right one.

## Verification

- `node scripts/session-init.js` — must still report 10/10 checks.
- `node tests/run-all.js` — all tests (56 existing + 22 new = 78) must
  pass.
- HTTP integration smoke (covered by `tests/run-all.js`):
  1. `POST /api/directives` with valid body → 201, directive id
     returned.
  2. `POST /api/directives` with empty name → 400.
  3. `POST /api/directives` with empty content → 400.
  4. `POST /api/directives` with duplicate name (case-insensitive) →
     400.
  5. `POST /api/directives` with content > 1000 chars → 400.
  6. `POST /api/directives` with invalid tag (uppercase, space) → 400.
  7. `GET /api/directives` lists the new entry.
  8. `PUT /api/directives/:id` updates name + content + tags → 200;
     history grows by 1; GET reflects the update.
  9. `POST /api/directives/:id/apply` → 200; `usage_count` incremented,
     `last_used_at` set.
  10. `POST /api/directives/:id/restore/:version` → 200; current values
      match the named version; history grows by 1.
  11. `DELETE /api/directives/:id` → 200; subsequent GET → 404.
  12. `GET /api/directives/export/all` returns a valid envelope.
  13. `POST /api/directives/import` with the envelope → 201; new ids
      minted; usage stats reset; history preserved.
  14. `POST /api/directives/import` with an invalid envelope (unknown
      format) → 400; nothing written.
  15. `POST /api/directives/import` with one invalid directive in the
      batch → 400; nothing written (atomicity).
  16. Corrupt entry in `data/directives.json` → entry dropped, list
      returned without it.
- Manual UI smoke:
  1. Open the wizard. Run any analyze. Type "Add dramatic red accent"
     into the directives textarea. Click Save. Name it. Add tags. The
     new directive appears in the saved-directives `<select>`.
  2. Clear the textarea. Select the new directive in the `<select>`.
     Click Apply. The textarea now contains the directive. Char count
     updates.
  3. Click Generate prompt. The Stage 2 call receives the loaded
     directive as the `directives` field.
  4. Click Manage. The manager modal opens. The new directive appears
     with its tags, usage count (1), and version count (1). Search
     "dramatic" → row stays. Search "foo" → list is empty.
  5. Sort: Newest / Oldest / Most used / Name A–Z. All four orderings
     behave.
  6. Tag chip filter: click `color` chip → only directives with
     `color` tag are visible. Click again → unfiltered.
  7. Edit the directive: change name, content, add a tag. Save
     changes. The version count goes to 2. The history shows v1 (the
     original) and v2 (current).
  8. Click Restore on v1. The directive's current values become the
     v1 values. The version count goes to 3. The history shows v1,
     v2, v3.
  9. Delete the directive from the manager. Confirm. The row
     disappears. The apply `<select>` no longer lists it.
  10. Create a second directive. Click Export all. A `.i2p.json` file
      downloads. Inspect it — the envelope contains both directives
      with their full history.
  11. Delete the second directive. Click Import. Pick the exported
      file. Both directives reappear with their full history, fresh
      ids, and zero usage count.
  12. Tab through the directives controls, save modal, manager modal,
      edit modal. Focus is visible at every step. Esc closes any open
      modal.
- Keyboard: Tab through directives textarea → save → apply → manage
  → manager search → manager sort → manager tag chips → manager items
  → edit button → delete button → import → export all → close. Esc
  closes any open modal.
