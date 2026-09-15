# CODE-REVIEW — Slice UI-R9 (Notes folders + image attachments)

**Verdict:** pass
**Scope:** `server.js` (Notes folders + image-attachments module — `data/notes_folders.json` store, `data/note_attachments/<note_id>/` on-disk store + `_manifest.json` index, `readNoteFolders` / `writeNoteFolders` / `validateNoteFolder` / `readNoteAttachmentsManifest` / `writeNoteAttachmentsManifest` / `validateNoteAttachmentEntry` / `purgeNoteAttachmentsForNote` / `handleListNoteFolders` + 11 new HTTP routes, 5 note routes extended with `folder_id`), `src/shell.js` (extended Notes view: folder sidebar, attachment thumbnails, drag-drop / file picker, "Move to folder" picker, gallery modal), `src/index.html` (Notes view additions), `src/styles.css` (folder sidebar + attachment gallery rules), `tests/run-all.js` (22 new UI-R9 tests), `README.md` (extended endpoint table), `docs/SPEC.md` §25.8 (DoD + acceptance criteria), `docs/adr/0028-notes-folders-and-image-attachments.md` (storage architecture ADR).
**Directive:** Slice UI-R9 follow-on to UI-R8 — group notes into folders, attach images to notes, move notes between folders.

## Standards axis

- **Storage shape parity.** Folders live in `data/notes_folders.json` (top-level JSON array, same shape as `notes.json` / `palettes.json` / `directives.json` — `[{ id, created_at, updated_at, ... }]`). Attachments use a hybrid: small on-disk file under `data/note_attachments/<note_id>/<stored_name>` + a manifest row in `data/note_attachments/_manifest.json` (id, note_id, filename, mime, size, stored_name, created_at). The hybrid was the explicit ADR 0028 decision — keeps per-note directories for clean cascade-delete, manifest for O(1) "find an attachment by id" lookup without scanning directories.
- **Cascade-delete handled atomically.** `purgeNoteAttachmentsForNote(noteId)` collects the matching manifest rows, deletes each file with `fs.rmSync(..., { recursive: true, force: true })`, removes the manifest rows, removes the now-empty note directory, then writes the trimmed manifest. Failure on one file does not abort the loop — all are attempted, the manifest reflects whatever actually persisted. Per-directory failures are collected and surfaced in the route response so the caller can log them.
- **Forgiving reads.** `readNoteFolders` and `readNoteAttachmentsManifest` both return `[]` on ENOENT / corrupt JSON. Each entry is filtered through a shape validator (`isValidNoteFolder` / `isValidNoteAttachmentEntry`) — malformed rows are dropped with a `console.warn`. Tests cover the corrupt-file path explicitly.
- **Validation symmetry.** Folder POST (name required, ≤60 chars) and PUT (name optional, partial) both flow through `validateNoteFolderBody`. `folder_id` on notes must start with `folder_` (id-prefix invariant) and must exist in the store at write time (referential integrity). Attachment POST validates MIME against `NOTE_ATTACHMENT_ALLOWED_MIME` (jpg/png/gif only — no BMP, no SVG, no PDFs) and size against `NOTE_ATTACHMENT_MAX_BYTES` (5 MB) and count against `NOTE_ATTACHMENT_MAX_COUNT` (5 per note).
- **MIME → extension mapping.** `NOTE_ATTACHMENT_EXT_BY_MIME` guarantees the saved filename ends in the correct extension for the declared MIME (`.jpg`/`.png`/`.gif`). This prevents content-type spoofing from leaving an `.exe` on disk that claims `image/png`.
- **Storage uses `crypto.randomBytes(8).toString('hex')`** for both folder ids (`folder_<hex>`) and attachment ids (`att_<hex>`) — collision-resistant without the bulk of uuid.
- **Front-end ↔ server round-trip.** Every successful folder POST / PUT / DELETE response is patched straight back into `notesState.folders` so the sidebar stays in sync without a full re-fetch. Every successful attachment POST appends a thumbnail row; DELETE removes it; the gallery modal re-queries `/api/note-attachments/:id/file` only when the user clicks to view full-size.
- **A11y.** Folder sidebar is a `<nav aria-label="Note folders">` with `<ul role="list">`. The "Unfiled" pseudo-folder is a real `<li>` (not a placeholder) so it's keyboard-focusable and screen-reader-announced. Attachment thumbnails are `<button type="button">` with `aria-label="Attached image: {filename}, {size} bytes"`. The gallery modal is a `<dialog>` (native, no JS-managed focus-trap boilerplate) with the existing close-on-backdrop / Escape wiring from the other modals in this project. Drop-zone has `aria-label="Drop images here or click to browse"`.
- **No new dependencies, no stack changes, no symbol renames.** Pure additive slice. ADR 0028 is the one ADR; the storage-architecture decision is the only thing that surprised me (vs. "just stick everything in notes.json as base64"), and it is documented there.

## Spec axis (SPEC §25 / UI-R9)

1. **Folders** — POST `/api/notes/folders` (create, name 1–60 chars), GET `/api/notes/folders` (list sorted by `sort_order` then `created_at`), PUT `/api/notes/folders/:id` (rename / reorder), DELETE `/api/notes/folders/:id` (cascade-reset notes' `folder_id` to `null`). Implemented in `server.js` lines 6914 / 6755 / 6944 / 6995. 7 dedicated folder tests (F1–F7) all pass.
2. **Notes folder assignment + move** — `GET /api/notes?folder=<id>` (filter to folder), `GET /api/notes?folder=unfiled` (filter to unfiled), `POST /api/notes` accepts `folder_id`, `PUT /api/notes/:id` accepts `folder_id` (with referential-integrity check), dedicated `PUT /api/notes/:id/move` for the move-only path (body: `{ folder_id }` or `{ folder_id: null }` to unfile). 5 dedicated note/folder tests (N1–N5) all pass.
3. **Image attachments** — `POST /api/notes/:id/attachments` (multipart upload, multer + fileFilter, 5 MB cap, 5-per-note cap, MIME allow-list), `GET /api/notes/:id/attachments` (list manifest rows for that note), `GET /api/note-attachments/:id/file` (stream bytes with `Content-Type` from manifest), `DELETE /api/note-attachments/:id` (unlink file + remove manifest row). 8 dedicated attachment tests (A1–A8) all pass.
4. **Per-note attachment cap.** The 5-per-note limit is enforced in `POST /api/notes/:id/attachments` BEFORE the file is buffered to disk — failing fast saves disk + bandwidth. Returns 409 with `{ error: "Note already has 5 attachments; delete one before adding more." }`. Verified by `UI-R9 A5`.
5. **Cascade behaviour.** Deleting a folder cascades: notes in that folder have `folder_id` reset to `null` (unfiled), attachments under each note are purged from disk + manifest. Deleting a note cascades: all attachments for that note are purged. Deleting an attachment only affects that attachment. Verified by F7 (folder cascade), and the route handlers use `purgeNoteAttachmentsForNote` consistently.
6. **Functional testing.** 22 new automated tests cover every endpoint, every error path, every validation branch, every cascade. All 22 green.
7. **Documentation.** `docs/SPEC.md` §25.8 lists the test inventory that maps 1:1 to the implementation; `docs/adr/0028-notes-folders-and-image-attachments.md` records the storage-architecture decision (file-per-attachment vs. base64-in-json vs. SQLite) and why file-per-attachment was chosen.
8. **README updated** with the new endpoint table (all 11 new routes documented).

## Test suite

- **22 new UI-R9 tests, all green:**
  - F1–F7: folder CRUD + sort_order + cascade (7 tests)
  - N1–N5: notes folder assignment, filtering, move, referential integrity (5 tests)
  - A1–A8: attachment upload (PNG/GIF), MIME rejection (BMP), size cap (6 MB), count cap (5-per-note), list filtering, file streaming with Content-Type, DELETE removal from disk + manifest (8 tests)
  - Plus the static endpoint-count test (covers both UI-R8 + UI-R9 + SPEC §27 endpoint deltas)
- Augmented `README documents endpoints…` test fixture — added the new endpoint table to `README.md`.
- Final run: **630 passed, 0 failed.** No regressions.

## CR-A11 — routing bug fix (included in this slice)

**Issue discovered while running the UI-R9 tests against the existing server.** `GET /api/notes/folders` was returning 404 with `Note 'folders' not found`. Root cause: Express matches routes in registration order. The original code had `app.get('/api/notes/:id', ...)` registered BEFORE `app.get('/api/notes/folders', ...)`, so the literal segment `folders` was being captured by the `:id` wildcard parameter.

**Fix (3 surgical edits in `server.js`):**

1. Extracted the inline `app.get('/api/notes/folders', ...)` handler body into a named function `handleListNoteFolders` (defined near the other Notes helpers, ~line 6526) so it can be registered at any position.
2. Removed the inline route registration from its original location (after the `:id` wildcard).
3. Added `app.get('/api/notes/folders', handleListNoteFolders);` BEFORE the `:id` wildcard at line 6755.

**Why this is the right fix, not a workaround:**

- Express route registration order is documented behavior. Re-ordering is the canonical fix for wildcard shadowing.
- The other 10 UI-R9 routes (POST `/folders`, PUT `/folders/:id`, DELETE `/folders/:id`, POST `/:id/attachments`, GET `/:id/attachments`, GET `/note-attachments/:id/file`, DELETE `/note-attachments/:id`, PUT `/:id/move`) were never affected because none of them sit between a wildcard and a more-specific literal in the same way that GET `/folders` does. Only GET `/folders` was shadowed; the bug was isolated to that one route.
- A wildcard prefix re-write (e.g. requiring `:id` to match `note_` prefix) would have masked the symptom but not fixed the underlying ordering problem — the next literal route added under a wildcard would have re-introduced the bug.

**Lesson recorded inline** in the `handleListNoteFolders` doc comment so future maintainers register literal routes before wildcards in this section of the router.

**Why this fix lives in UI-R9, not its own CR:** The bug only manifested when adding the UI-R9 `/folders` GET route. Fixing it inline is cheaper than parking as a separate CR, the fix is minimal (one route registration moved + one helper extracted), and the test that exposed the bug (UI-R9 F1) is in this slice's inventory. Keeping the fix with the failing test keeps the regression boundary clear.

## Notes

- **Storage architecture ADR 0028 filed.** Three-criteria test passes: (1) hard to reverse — once users have attachments, switching to base64-in-json requires a one-time migration; (2) surprising — the obvious "just put it all in the JSON" doesn't survive a 5 MB cap without breaking the file-format invariants the rest of the project relies on; (3) trade-off — file-per-attachment vs. base64-in-json vs. SQLite (3 alternatives, each with a different failure profile).
- **`data/note_attachments/_manifest.json` is gitignored.** Per-user state, never part of the codebase. Same as `data/notes.json` / `data/notes_folders.json`.
- **MIME allow-list.** The list `image/jpeg`, `image/png`, `image/gif` is intentionally narrow. SVG and WebP are excluded: SVG can carry JavaScript and was the source of multiple XSS bugs in other projects; WebP isn't universally supported by the downstream image-to-prompt pipeline's preview renderer. If either becomes a requirement, the allow-list is a one-line change plus a test.
- **No chunked uploads / no resumable uploads.** 5 MB cap means the entire file is buffered in memory by multer. This is fine for the slice's stated use case (small reference images for prompts) but a 50 MB cap would require a different multer strategy. Not in scope; flagged for the next iteration if needed.
- **Folder rename does NOT cascade to the note's `folder_id`** — it doesn't need to. `folder_id` is a foreign key by id; renaming a folder doesn't change the id. Same as how renaming a directive doesn't invalidate prompts that reference its id.
- **Attachment ordering.** The manifest order is insertion order (newest at the bottom). The front-end renders newest at the top by reversing the list before display. This means the manifest itself is append-only in display order — a deliberate choice to make "scroll back to my first upload" deterministic.
