# ADR 0005 — Editable subject-extraction prompt

## Status

Accepted. Implemented 2026-06-22.

## Context

ADR 0004 introduced `POST /api/subject` (the "Populate with AI" button
beneath the `subject` textarea). The system prompt for that endpoint is
hardcoded in `server.js` as `SUBJECT_FACTUAL_SYSTEM_PROMPT` and ships with
a specific factual-only contract: no artistic-style, no medium, no
aesthetic commentary; mandatory coverage of five categories; length floor
≥ 600 chars.

Live testing against real MiniMax M3 responses showed the shipped prompt is
**a starting point, not a ceiling.** Some users want:

- Different exclusions (e.g. forbid color descriptions entirely if the
  colors field is populated separately; or permit color when the
  exclusion of color-from-subject becomes a problem).
- Different mandatory categories (e.g. add "visible text" as a separate
  category; drop "contextual details" if it's noisy).
- Different length targets (e.g. shorter for simple images, longer for
  forensic-style analyses).
- Different factual focus (e.g. architectural-description-first for real
  estate; medical-finding-first for clinical use).

Today, none of this is possible without forking `server.js`. The preset
editor (which controls Stage 1 + Stage 2 system prompts) is the wrong
place — the subject-extraction prompt is global, not per-preset (ADR 0004
deliberately decoupled it from presets so the contract holds across the
Alla Prima / Photorealistic / Danbooru specialties).

## Decision

### 1. Persist the prompt on disk at `data/subject_prompt.json`

The default content (the current `SUBJECT_FACTUAL_SYSTEM_PROMPT`) ships
in code. On first read, if the file is missing, the server writes the
default to it. Subsequent reads always come from disk, so the file is the
single source of truth at runtime.

Shape:

```json
{ "prompt": "You are an expert visual analyst..." }
```

A flat object with one `prompt` string field. Deliberately NOT the
`.i2p.json` preset-export envelope — different lifecycle, different
audience (this is a global setting, not a shareable preset).

### 2. `GET /api/subject-prompt` and `PUT /api/subject-prompt`

- `GET` returns `{ prompt, is_default }`. `is_default: true` when the
  on-disk content is byte-identical to the shipped default.
- `PUT` accepts `{ prompt: string }`. Validation:
  - `prompt` is a string.
  - Non-empty after trim.
  - Length ≤ `MAX_SUBJECT_PROMPT_LENGTH` (10 000 chars).
  - No rejection for forbidden vocabulary inside the prompt — the
    whole point of this ADR is to let the user pick their own exclusions.
    The user owns the prompt; the server just persists what they wrote.

### 3. `callMiniMaxSubjectAnalysis` reads the prompt from disk each call

No in-memory cache. Each `/api/subject` POST reads the file fresh, so an
edit made via `PUT` is picked up immediately by the next "Populate with
AI" click without a server restart.

### 4. UI: "Edit prompt" button + modal

A new `.btn-secondary` button labelled "Edit prompt" rendered alongside
"Populate with AI" in the `.field-row__action` wrapper. Clicking it opens
a modal containing:

- A large textarea pre-filled with the current prompt.
- A "Reset to default" button that restores the shipped default text
  (with a confirm prompt — destructive on a long edit).
- A character count (X / 10000).
- "Cancel" and "Save" buttons.

Save calls `PUT /api/subject-prompt`. Cancel discards changes. Errors
(from validation or transport) surface via the existing `showError` toast.

### 5. Out of scope for this ADR

- Per-preset subject-extraction prompts. The global-vs-per-preset
  decision is settled by ADR 0004; this ADR extends only the global path.
- Versioning of the prompt. Each `PUT` overwrites; there's no history.
  If a user wants to recover an older version, they edit it back in.
- Multi-user collaboration. The file is read/written with naive
  `fs.readFileSync` / `fs.writeFileSync`; concurrent writers can race.
  Real concurrency needs atomic write + lock. Out of scope for a single-
  user wizard UI.
- Prompt templates / variables. The prompt is a flat string. No
  `{{image}}` / `{{preset}}` interpolation.

## Architecture (after)

```
   ┌─────────────────────────────────────────────────────────────┐
   │  data/subject_prompt.json   ←── source of truth at runtime  │
   │  { "prompt": "..." }                                        │
   └─────────────┬───────────────────────────┬───────────────────┘
                 │ read on each call        │ PUT writes
                 ▼                           ▼
   ┌─────────────────────────┐   ┌──────────────────────────────┐
   │  POST /api/subject      │   │  PUT /api/subject-prompt     │
   │  (Populate with AI)     │   │  (Edit prompt modal → Save)  │
   │  reads prompt from disk │   │  validates + writes file     │
   │  uses it as system msg  │   └──────────────────────────────┘
   └─────────────────────────┘
                 │
                 ▼
   ┌─────────────────────────┐
   │  GET /api/subject-prompt │
   │  (Edit prompt modal     │
   │   on open: fetch current)│
   └─────────────────────────┘
```

## Files changed

| File | Change |
|---|---|
| `server.js` | Rename `SUBJECT_FACTUAL_SYSTEM_PROMPT` → `DEFAULT_SUBJECT_PROMPT` (kept as the shipped default; still exported for test access). New `SUBJECT_PROMPT_FILE` path, `readSubjectPrompt()` / `writeSubjectPrompt()` helpers. `callMiniMaxSubjectAnalysis` reads from disk on each call. New `GET /api/subject-prompt` and `PUT /api/subject-prompt` routes. New `MAX_SUBJECT_PROMPT_LENGTH` constant. New `validateSubjectPrompt()` helper. New exports. |
| `src/index.html` | Add "Edit prompt" button slot inside the `.field-row__action` wrapper. Add a new `.modal` (`#subject-prompt-modal`) for the prompt editor. |
| `src/app.js` | In `renderAnalysisEditor`, append an "Edit prompt" button next to "Populate with AI". New `openSubjectPromptModal()` / `closeSubjectPromptModal()` / `saveSubjectPrompt()` / `resetSubjectPromptToDefault()` functions. New DOM cache entries for the modal. |
| `src/styles.css` | Adjust `.field-row__action` to lay out the two buttons side-by-side. New `.subject-prompt-modal-content` / `.subject-prompt-textarea` classes (mostly reuse the existing `.modal` / `.textarea` patterns). |
| `CONTEXT.md` | Pipeline-stages section now notes that Stage 1.S reads its system prompt from `data/subject_prompt.json` (editable via UI). Core entities table gets a "Subject prompt" row. |
| `README.md` | New API endpoints `GET /api/subject-prompt` and `PUT /api/subject-prompt` documented under API Endpoints. New `data/subject_prompt.json` noted under Project Structure. |
| `tests/run-all.js` | Five new tests: (a) `GET /api/subject-prompt` route is registered; (b) `PUT /api/subject-prompt` route is registered; (c) `data/subject_prompt.json` is created on first read if missing; (d) `writeSubjectPrompt` round-trips; (e) validation rejects empty / oversized prompts. |

No changes to `FIELD_PALETTE`, `FIELD_FORMAT_HINTS`, the per-preset
prompts in `data/presets.json`, or the existing `/api/analyze` /
`/api/generate-prompt` handlers.

## Why these decisions

- **Disk persistence, not browser localStorage.** localStorage would
  bind the prompt to a single browser; a user switching devices or
  browsers would lose their edits. The server already owns
  `data/presets.json` and `uploads/`, so adding a sibling JSON file is
  consistent.
- **Disk persistence, not a new env var.** Env vars require a server
  restart and can't be edited from the UI. The whole point of this ADR
  is to let the user iterate on the prompt without touching the server.
- **Single global prompt, not per-preset.** Reaffirming ADR 0004. The
  factual contract is orthogonal to the preset's downstream specialty;
  splitting it would mean managing the contract separately for each of
  the three built-in presets and any future ones.
- **Naive read/write, not atomic + locked.** Single-user wizard UI in
  v1. If multi-user concurrent edits become a real problem, add
  `fs.renameSync` (atomic on POSIX) over a temp file + a simple file
  lock. Not in this iteration.
- **No versioning.** If a user breaks their prompt and wants to recover
  it, they can re-edit. Git history is the long-term backup. Adding a
  version history in-product is feature creep.
- **Validation is permissive (no forbidden-vocabulary filter).** The
  entire purpose of this ADR is to let the user pick what to forbid.
  Server-side validation guards against empty / oversized / non-string
  inputs — nothing more.

## Trade-offs and risks

- **Naive write can lose data under concurrent edits.** If two browser
  tabs both PUT at the same time, the last writer wins. For v1's
  single-user wizard this is acceptable; flag for future work.
- **A bad prompt can break the button.** A user can save a prompt that
  produces nothing useful (empty strings, JSON schema rejections, etc.).
  The endpoint surfaces the underlying API error via `showError`, so the
  failure mode is visible. The "Reset to default" button is the recovery
  path.
- **Server-side prompt length cap at 10 000 chars.** Enough for very
  elaborate prompts but bounded so a runaway edit can't blow up the
  per-call token cost. MiniMax M3's `max_tokens` is 1500 on the response
  side; the system prompt has its own context window which is generous.

## Verification

- `node scripts/session-init.js` — must still report 10/10 checks.
- `node tests/run-all.js` — all tests (17 existing + 5 new = 22) must
  pass.
- Manual smoke:
  1. Open the UI, upload an image, run Stage 1.
  2. Click "Edit prompt" beneath the subject textarea.
  3. Modify the prompt (e.g. shorten the length floor, drop the
     "Contextual Details" category). Save.
  4. Click "Populate with AI" — the response should reflect the edited
     prompt (e.g. shorter, or missing the dropped category).
  5. Re-open the "Edit prompt" modal — the edited text is still there.
  6. Click "Reset to default" — confirm — text reverts to shipped
     default; "Populate with AI" returns to the original behaviour.
- Server smoke: `GET /api/subject-prompt` returns 200 with `{ prompt,
  is_default: false }` after an edit, and 200 with `{ prompt,
  is_default: true }` after reset. `PUT /api/subject-prompt` with `{
  prompt: "" }` returns 400 with a clear error.