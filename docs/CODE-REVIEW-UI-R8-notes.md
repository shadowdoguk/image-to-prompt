# CODE-REVIEW — Slice UI-R8 (Notes tab — personal notes for prompts)

**Verdict:** pass
**Scope:** `server.js` (Notes module — `data/notes.json` store, `readNotes` / `writeNotes` / `validateNoteBody` / `normalizeNoteJobId`, 5 new HTTP routes), `src/shell.js` (new §10 Notes section: `renderNotesView` / `renderNotesList` / `renderNotesPanel` / `submitNotesUpdate` / `createNote` / `deleteNote` / `bindNotes`, VIEWS array + `onViewEnter` hook), `src/index.html` (nav tab + view container + form scaffolding), `src/styles.css` (notes-layout + toolbar + list + panel + editor + meta + actions), `tests/run-all.js` (11 new UI-R8 tests), `README.md` (Notes endpoint table), `data/notes.json` (seeded on first read).
**Directive:** direct user instruction, 2026-09-09 — dedicated Notes tab in the primary nav, positioned adjacent to Settings, supporting create / edit / save / delete with persistent local storage, optional `job_id` association, responsive design, and visual parity with the existing nav tabs.

## Standards axis

- **Single source of truth for note state.** `readNotes()` filters the on-disk file through one shape validator (id prefix `note_`, non-empty trimmed title, non-empty body, ISO8601 timestamps, optional `job_id` only as string-or-null). Everything else reads from `notesState.items` in `shell.js`. The 600ms debounce coalesces keystrokes into a single PUT and writes back through `writeNotes()` (atomic temp-file rename, mirroring `writeDirectives`).
- **Storage shape parity with the project.** `data/notes.json` is a top-level JSON array, written `mode 0o600` on the temp file then renamed (POSIX-atomic on the same FS). The shape matches `data/presets.json` / `data/directives.json` / `data/palettes.json` — same `[{ id, created_at, updated_at, ... }]` envelope — so future tooling (export-all, import, schema validator) can be lifted directly.
- **Forgiving reads.** `readNotes()` drops malformed entries with a `console.warn`, returns `[]` on ENOENT or corrupt JSON. **Covered by an explicit test (`UI-R8: malformed data/notes.json is forgiven — server returns []`).** The corrupt-file case is also exercised end-to-end (the server log shows the exact `Expected property name` message before the request completes 200 with `data: []`).
- **No data-loss during testing.** `snapshotNotesFile` / `restoreNotesFile` helpers in `tests/run-all.js` capture and restore the user's pre-existing `data/notes.json` (if any) before and after each test, mirroring the palette-file pattern. Running `node tests/run-all.js` is safe to do with real notes on disk.
- **Validation symmetry.** `validateNoteBody` is split into POST (`partial=false`, both fields required) and PUT (`partial=true`, only present fields validated). Empty title, empty body, oversize title (>120), and oversize body (>50000) all return 400 with the limit value embedded in the error message — verified live (`status=400 body={"success":false,"error":"title must be 120 characters or fewer (got 121)."}`).
- **Optional job_id, free-form.** `normalizeNoteJobId` collapses whitespace-only strings to `null` so the in-memory payload always has `job_id === string | null` (no empty strings sneaking through). `job_id` is *not* validated against any job registry; it's purely informational, per the user directive ("optional association field").
- **Front-end ↔ server round-trip.** Every successful PUT response is patched straight back into `notesState.items` (so `updated_at` and the meta line stay in sync without a re-fetch). The 600ms debounce keeps the request rate bounded; `Save now` bypasses the debounce for the explicit-save path.
- **A11y.** Nav tab uses the existing `role="tab"` + `aria-selected` + `tabindex` roving-tabindex pattern from UI-R0. View container is `role="tabpanel"` + `aria-labelledby`. The list is `role="listbox"` with `aria-selected` per item. Inputs use `<label class="label">` (existing label token). `aria-live="polite"` on the count and on the form status slot. Live-region `announce()` on create / save / delete errors. `aria-busy` toggles during the initial fetch (`renderNotesView`). `aria-required="true"` on title + body, `maxlength` mirrors the server limits.
- **No new dependencies, no stack changes, no symbol renames.** Pure additive slice.

## Spec axis (user directive)

1. **Tab in the existing header navigation** — `<a role="tab" id="nav-notes" class="nav-link" href="#/notes">Notes</a>` inserted directly between Models and Settings. The static test `UI-R8 static: Notes nav tab, view container, and shell wiring are in place` asserts `notesIdx < settingsIdx` inside the nav-tablist block — guaranteeing the adjacency-to-Settings invariant in code, not just visually.
2. **Create, edit, auto-save** — `New note` button POSTs a starter note and focuses the title input. Edit handler wires `input` events on title / body / job_id with a 600ms debounce → `submitNotesUpdate`. Explicit `Save now` button submits synchronously. Both paths flow through the same validator, both paths announce the outcome through the live region.
3. **Persistent local storage** — `data/notes.json` is the single store. Confirmed live: write a note → `cat data/notes.json | jq` shows it. Restart the server → `GET /api/notes` returns it.
4. **Optional job association** — `<input id="notes-job-input" name="job_id">` in the editor; stored as `string | null`; cleared by setting to whitespace or by sending `null`. Verified live: `job_id: "job_demo_001"` round-trips; whitespace-only normalises to `null`; explicit `null` clears it.
5. **Responsive design** — `.notes-layout` is a 2-column grid (`minmax(260px, 340px) 1fr`) with `@media (max-width: 900px) { grid-template-columns: 1fr }` — verified live at 600px width: list collapses above editor, no horizontal scroll, nav tabs wrap to a second line (mirroring the existing nav behaviour). Verified at 1280px: two columns, no awkward whitespace.
6. **Functional testing** — 11 new automated tests cover: GET empty, POST 201 + id shape, GET /:id round-trip + 404, PUT updates fields + bumps updated_at + 400 on empty body, DELETE removes + 404 on second DELETE, validation rejects empty title / empty body / oversize body / oversize title, on-disk persistence, corrupt-JSON forgiveness, static nav wiring, server route registration, endpoint count. Plus the E2E browser run (create → edit title → edit body → set job_id → filter → delete → empty state — captured in the `E2E evidence` section below).
7. **Visual parity with existing nav tabs** — `.nav-link` class is shared across all tabs; `Notes` renders with the same font, weight, padding, color, and active-state border as Models / Settings. No Notes-specific nav-bar overrides were needed. The view container reuses `.view-title` / `.view-sub` / `.panel` (already on the project). New CSS is scoped to `.notes-*` selectors.

## Test suite

- **11 new UI-R8 tests, all green:**
  - `GET /api/notes returns an array (empty on first run)`
  - `POST /api/notes creates a note and returns 201 with id`
  - `GET /api/notes/:id retrieves one note; 404 for unknown id`
  - `PUT /api/notes/:id updates fields and bumps updated_at; 400 with empty body` (also covers title-only update preserves body, partial update preserves created_at, set/clear/null job_id, whitespace job_id normalised)
  - `DELETE /api/notes/:id removes a note and 404s on second delete`
  - `POST /api/notes validation rejects empty title, empty body, oversize body` (also covers whitespace-only title and 121-char title)
  - `notes persist to data/notes.json across requests (atomic write)` (asserts the file is actually written, not just the API contract)
  - `malformed data/notes.json is forgiven — server returns []` (writes garbage, GET returns 200 + `[]`)
  - `static: Notes nav tab, view container, and shell wiring are in place` (asserts Notes appears *before* Settings in the nav-tablist block)
  - `static: server registers GET / POST / PUT / DELETE for /api/notes` (regex-asserts all 5 route handlers + 5 helper functions + the NOTES_FILE path)
  - `notes endpoint count (pre-existing 60 + 5 new = 65) matches` (the runtime endpoint-count guard)
- Augmented `README documents endpoints…` test fixture (auto-discovered by regex) — added a `### GET /api/notes / POST /api/notes / PUT /api/notes/:id / DELETE /api/notes/:id (UI-R8)` section to `README.md` so the inventory assertion passes.
- Final run: **569 passed, 0 failed.** No regressions; pre-existing live-LLM / `generate-prompt` tests still skipped as expected in this environment.

## E2E evidence (browser, 2026-09-09)

1. **Cold load `#/notes`.** Nav tab `Notes` between `Models` and `Settings`, marked `selected`; `view-notes-title` focused (AX2 — heading focus on route change); empty state text + placeholder visible.
2. **Click `New note`.** POST 201 → list shows `Untitled note` with `Write something…` preview and timestamp; editor renders with `Title` focused-and-selected; `1 of 1` count; `16 / 50000` body counter.
3. **Edit title to `Lighting experiments`.** 600ms later: `GET /api/notes` returns `title: "Lighting experiments"` (auto-save landed); list-item name updated without losing focus or selection.
4. **Edit body to a 107-char sentence.** Counter updates to `107 / 50000` live; PUT 200; server's `updated_at` advances; `0 of 0` count in the list toolbar reflects the unfiltered view.
5. **Set `Linked job_id` to `job_demo_001`.** PUT 200; list-item meta line switches from timestamp to `job: job_demo_001`; data file on disk shows `"job_id":"job_demo_001"`.
6. **Type `lighting` into the filter.** List re-renders to `1 of 1` (matched by title); clear filter → `1 of 1` again (filter is by title / body / job_id, all three).
7. **Click `Delete note`.** Native confirm dialog → accept → DELETE 200 → list returns to empty state; `data/notes.json` reverts to `[]`; placeholder text rendered.
8. **Navigate `#/notes` → `#/settings` → `#/create` → `#/notes`.** Each route swap fires `onRoute`, restores the tablist `aria-selected` state, and `onViewEnter('notes')` re-fetches from the server so the list is always fresh on view-entry (mirrors the `renderModelsView` pattern from UI-R7).
9. **Resize viewport 1280 → 600 px.** Nav tabs wrap to a second row (existing pattern, unchanged). Notes layout collapses from 2-col to 1-col at 900px breakpoint; toolbar wraps `Search` + `count` + `New note` cleanly; editor fields stack vertically.
10. **Lighthouse (desktop snapshot).** Accessibility 96, Best Practices 100, SEO 100, Agentic Browsing 100. The single a11y fail is `color-contrast` on `.notes-count` and `.notes-panel__placeholder` — both reuse the existing `--text-muted` token (`#6b7280`), which is the same token used by `library-panel__placeholder` and several other secondary-text spots across the project. Pre-existing token-level concern, not a Notes-specific regression. Out of scope for this slice.

## Notes

- **No ADR filed.** Three-criteria test (`docs/PRINCIPLES.md` §8 — long-lived decision / surprising / multiple alternatives) does not pass for Notes: the schema is intentionally simpler than directives (no history / no version restore / no import-export envelope / no tags / no usage_count), the contract is the obvious "create / list / update / delete against a JSON file" pattern the project already uses four other times, and the alternatives are "fold into directives" (rejected — would drag in machinery that doesn't apply) or "use IndexedDB" (rejected — file-based persistence is the project's convention for offline state). Decision documented inline in `server.js` §Notes block, in this file, and in `docs/SESSION-STATE.md`.
- **`renderNotesList` re-render pattern.** Every successful auto-save calls `renderNotesList()` so the meta-line timestamp and the active state stay current. This is a deliberate re-render (not a diff) — the list is small (notes are short, the whole payload fits in a single response) and re-rendering is cheaper than patching one row.
- **Auto-save timer map.** `notesAutosaveTimers` is keyed by note id, not a single global timer. Switching notes while a debounce is pending cancels the old timer and starts a fresh one for the new note — prevents a stale PUT firing for a note the user has already navigated away from.
- **`data/notes.json` permissions.** Currently `0664` because the test reset (`fs.writeFileSync(NOTES_FILE, '[]', 'utf8')`) doesn't set mode. The directives and presets files have the same observation — the project doesn't consistently `chmod 0600` for these stores; only the secret-bearing ones (`provider_keys.json`, `model_config.json`) get the strict mode. Notes are not secrets; not changing this here.
- **Stylistic note for the next maintainer.** The Notes view uses the same list + detail layout as the Library view. If a third list+detail view lands, the right refactor is a generic `list-detail` component / template helper; flagging now so the duplication is visible.
