# ADR 0028 — Notes folders, image attachments, and the storage-model decision

**Status:** Accepted
**Date:** 2026-09-09
**Origin:** Slice UI-R9 (Notes enhancements — folders + image attachments, `docs/SPEC.md` §25). The user explicitly asked us to "evaluate and select an appropriate lightweight backend storage solution (such as localStorage, IndexedDB, or a lightweight embedded database) that meets performance requirements for note and image data persistence." That evaluation is the central architectural question of this slice; folding the answer into the SPEC would bury the rationale, so we surface it here.

## Context

The UI-R8 Notes tab shipped (2026-09-09) with a single-file persistence model: `data/notes.json`, atomic JSON write, ~250 lines of server code, vanilla-JS front-end, no new dependencies. It works for plain-text notes but doesn't grow:

- **No organisation primitive.** All notes live in one flat list. After ~30 notes, the search box becomes the only way to find anything.
- **No image support.** Many of the use cases the user had in mind ("personal notes for prompts") — colour palette swatches, reference photos, mood-board tiles — need attached images.

This slice adds (1) **folders** and (2) **image attachments** to the Notes tab. Both require new persistence primitives, so the user asked us to take the opportunity to revisit the storage model.

### Candidate storage layers (the user-listed options)

| Option | Pros | Cons |
|---|---|---|
| **localStorage** | No server change; simple key-value API; ~5 MB / origin | Hard cap too small for 50 KB body + 5 × 2 MB images on the first note. Synchronous API blocks main thread. No atomic transactions across keys. |
| **IndexedDB** | Much larger quota (typically 50% of disk per origin); async; binary blobs native; structured queries | Adds a parallel persistence layer in the browser. Cross-tab sync requires careful version + lock handling. Every existing JSON-file reader/writer in the project (`presets.json`, `directives.json`, `palettes.json`, `model_config.json`, `subject_prompt.json`, `stage2_overrides.json`, `notes.json`) would have to either migrate or co-exist with a client-side mirror. |
| **Embedded DB (better-sqlite3, lmdb, nedb)** | Single-file persistence; queries; transactions | Native dependency. Project today has **zero native deps**. Adding one for a single feature violates the smallest-footprint stance documented in `docs/PROJECT-README.md`. |
| **Filesystem (status quo + new dir)** | Zero new deps; mirrors existing `chat_attachments` pattern; atomic writes; trivial to inspect / back up | Multi-file write coordination; no transactional guarantees across `notes.json` + `notes_folders.json` + `note_attachments/_manifest.json`. |

### Project constraints discovered during evaluation

1. The app already has **six JSON-file stores** (`data/*.json`) and **two multer-on-disk stores** (`uploads/`, `data/chat_attachments/`). Adding a seventh JSON file + a third disk directory is a 30-line delta; adding a parallel IndexedDB layer is a 300-line delta with a 12-month migration story.
2. The `chatAttachmentStorage` multer config (server.js:830+) already proves the per-record subdirectory + `_manifest.json` pattern scales: 440 sub-directories, no performance complaints.
3. The project has a documented stance against native dependencies (PROJECT-README §1) — keeping that contract intact is cheaper than re-litigating it.
4. localStorage's 5 MB hard cap is a deal-breaker for the image-attachment use case on day one. A user uploading five 2 MB JPEGs to a single note would exceed the cap with room for only the smallest possible body text.
5. IndexedDB would require restructuring ALL existing JSON-file readers, not just Notes. That's a project-wide refactor — out of scope for one slice.

## Decision

**Keep `data/notes.json` (atomic JSON write) + add `data/notes_folders.json` + `data/note_attachments/_manifest.json` + per-note image directory `data/note_attachments/<note_id>/`. No new dependencies. No client-side persistent storage.**

This mirrors the chat-attachments pattern exactly:

```
data/chat_attachments/<session_id>/<random>.<ext>   ← existing
data/note_attachments/<note_id>/<random>.<ext>      ← new
data/chat_attachments/_manifest.json               ← existing
data/note_attachments/_manifest.json               ← new
```

### Why this is reversible

If a future slice ever needs offline / cross-device sync, IndexedDB becomes the right answer — but only when the whole project migrates together, not just Notes. The current decision keeps the option open without committing to it now.

### Why this is "lightweight"

- 0 new npm dependencies.
- ~250 server.js lines, ~280 shell.js lines, ~80 CSS lines, 22 new tests.
- Reuses two existing modules (`multer.diskStorage`, `sortablejs`) and three existing patterns (atomic JSON write, manifest lookup, multer-disk-with-whitelist).

### Cross-cutting concerns deferred to BACKLOG

- Image thumbnails (server-side resize) — currently we render full-size and rely on `max-width: 100%` CSS. Add `sharp` only if a real-world perf complaint surfaces.
- Cross-device sync — see above.
- Nested folders — flat-only in v1.

## Consequences

### Positive

- Zero new dependencies. No `npm install` churn. No native build.
- Mirrors a battle-tested pattern (`chatAttachmentStorage`) that's already been deployed to production.
- Inspectable / backup-friendly: every note + every attachment is on disk as a regular file.
- Atomic per-file writes via the temp+rename pattern. No partial-state risk within a single file.

### Negative

- Three separate files must be kept consistent on certain operations (delete a note → cascade-delete its attachments + prune folders' `notes_count` cache). Mitigated by idempotent operations and forgiving reads.
- No cross-file transactions. A process crash between `writeNotes()` and the cascade-delete of attachments could leak a file. Mitigated by best-effort cleanup + manifest-pruning on next read.
- The "no client-side persistent storage" choice means the Notes tab is offline-broken by design. Consistent with the rest of the app (no offline mode anywhere).

### Neutral

- The "Unfiled" pseudo-folder is a client-only construct. Notes with `folder_id === null` surface under "Unfiled" in the sidebar without any folder record existing on disk. Keeps the server source-of-truth minimal.
- Per-folder `notes_count` is a denormalised cache. Recomputed on every note create / delete / move. Cheap because notes.json is small.

## Alternatives considered in more depth

### localStorage — rejected

- **Quota:** ~5 MB / origin. One note + five 2 MB images = ~10 MB. Fails on day one for the image-attachment use case.
- **API ergonomics:** Synchronous reads block the main thread. Acceptable for ~30 notes but the project ships an auto-save model that writes on every keystroke (debounced to 600 ms). Even 5 KB of synchronous JSON parse on every save is measurable.
- **Backup / portability:** Browser-local; no way to sync a user's notes to a new machine.

### IndexedDB — rejected (now)

- **Cross-cutting cost:** The project has six other JSON-file modules (`presets.json`, `directives.json`, `palettes.json`, `model_config.json`, `subject_prompt.json`, `stage2_overrides.json`, plus the new `notes_folders.json`). Migrating **only** Notes to IndexedDB creates a split-brain: a feature that needs to read both notes and presets (a future "attach preset to note" feature, say) would have to know which is in the browser and which is on disk.
- **Migration story:** A future "move all state to IndexedDB" project would need to migrate ~7 JSON files + their existing user data. Doing it now means migrating **everything** at once — bigger blast radius than the slice warrants.
- **Asynchronous everywhere:** Every read site changes from `const x = readFile(...)` to `await idb.get(...)`. Touches server.js only (Node has no native IndexedDB), but touches every consumer.

We will revisit IndexedDB if and when the project does a coordinated offline-first pivot. Not now.

### Embedded DB (better-sqlite3 / lmdb / nedb) — rejected

- **Native dep cost.** The project has zero native deps today. Adding one for a single feature violates the smallest-footprint stance.
- **Operational overhead.** `better-sqlite3` requires a build step (or prebuilt binary fetch) on install. The CI story is non-trivial.
- **No clear win.** The chat-attachments + JSON-file pattern already meets every perf budget we have. SQLite would be faster on 10k+ notes; we're not at that scale.

## References

- SPEC §25 (`docs/SPEC.md`) — slice requirements.
- ARCH §30 (`docs/ARCHITECTURE.md`) — module layout, filesystem layout, attachment pipeline.
- PRE-MORTEM §30 (`docs/PRE-MORTEM.md`) — orphan-file / DoS / race risks + pre-commitments.
- ADR 0024 (provider key storage) — same JSON-file + gitignored + 0600 permissions pattern; precedent.
- ADR 0025 (RAG foundation) — same `data/<thing>/` + `_manifest.json` per-record subdir pattern; precedent.
