# ADR 0007 — Editable Stage 2 system prompt (per-preset override)

## Status

Accepted. Implemented 2026-06-22.

## Context

The two-stage pipeline runs `Stage 1` (vision LLM, image → structured analysis)
and `Stage 2` (text LLM, analysis → final image-gen prompt). The Stage 2 system
prompt is currently stored **per-preset** in `data/presets.json` as
`stage2_system_prompt`. Every shipped preset has a specialty contract baked
into its prompt: oil-painting field-integration order, photorealistic
camera-language, Danbooru tag taxonomy, etc.

Two pain points surfaced in live testing:

1. **A preset's Stage 2 prompt is correct in principle but the user wants a
   house-style tweak.** Examples:
   - "Always append `editorial photography, magazine cover quality` to the
     Photorealistic preset's output."
   - "Force Danbooru output to omit the `masterpiece, best_quality` suffix
     I find noisy."
   - "Make the oil-painting preset lead with the subject's spatial position
     rather than the subject noun phrase."
   These are all per-preset customizations — there is no good reason to fork
   the preset or save a duplicate under a new name.

2. **Editing the preset is the wrong surface.** The preset editor commits the
   change to `data/presets.json` permanently, mixes Stage 2 prompt edits with
   Stage 1 prompt / stage1_fields / field_defaults edits, and is hostile to
   iteration: every save overwrites the previous version with no rollback.

ADR 0005 already solved the parallel problem for the subject-extraction
prompt (`/api/subject`, "Populate with AI"): the prompt is global, persisted
to `data/subject_prompt.json`, editable from a modal beside the action
button. That ADR is the template.

The difference for Stage 2: prompts are **per-preset**, not global. A global
Stage 2 override would erase the per-preset specialty (oil-painting field
order, Danbooru tag taxonomy, etc.). The override must therefore be keyed
by `presetId`.

## Decision

### 1. Persist overrides on disk at `data/stage2_overrides.json`

Shape:

```json
{
  "preset_alla_prima_oil": "custom prompt text...",
  "preset_photorealistic": "another custom prompt..."
}
```

A flat object: keys are preset ids, values are the user's override text.
Missing keys mean "no override for this preset — use `preset.stage2_system_prompt`".

Seeded with `{}` on first read. Same atomic-ish write pattern as
`data/palettes.json` (write to `.tmp`, rename over).

### 2. `GET /api/stage2-prompt?presetId=...` and `PUT /api/stage2-prompt?presetId=...`

- `GET` requires `presetId` query param. Validates against the preset
  registry; 404 if unknown. Returns:
  ```json
  {
    "prompt": "<effective prompt: override OR preset.stage2_system_prompt>",
    "default_prompt": "<preset.stage2_system_prompt>",
    "is_default": true|false
  }
  ```
  `is_default` is `prompt === default_prompt` (content-based, mirroring ADR 0005
  for the subject prompt). The on-disk file stores whatever the user saved,
  including the default text — `is_default` is purely a UI affordance, not a
  storage invariant.
- `PUT` requires `presetId` query param + body `{ prompt: string }`.
  Validates shape / emptiness / length (≤ `MAX_STAGE2_PROMPT_LENGTH`,
  same 10 000 cap as the subject prompt). Writes the override; an existing
  entry for the same preset is overwritten. No body-content filtering —
  the user owns the prompt.
- `DELETE /api/stage2-prompt?presetId=...` removes the override for the
  given preset (returns 204 / 200 with confirmation). Used by the modal's
  "Use preset default" action — an explicit path for "I want this preset
  to stop using my override". The PUT path always writes; the DELETE path
  always removes; no merge semantics.

### 3. `callMiniMaxStage2` resolves the effective prompt at call time

In the `/api/generate-prompt` route, the Stage 2 call changes from:

```js
const finalPrompt = await callMiniMaxStage2(analysis, directives || '', preset.stage2_system_prompt);
```

to:

```js
const effectivePrompt = getEffectiveStage2Prompt(preset);
const finalPrompt = await callMiniMaxStage2(analysis, directives || '', effectivePrompt);
```

`getEffectiveStage2Prompt(preset)` reads `data/stage2_overrides.json` once,
returns `overrides[preset.id] ?? preset.stage2_system_prompt`. No caching:
edits via the modal must take effect on the very next "Generate prompt"
click without a server restart, exactly as ADR 0005 requires for the
subject prompt.

### 4. UI: "Edit prompt" button + modal

A new `.btn-secondary` button labelled "Edit prompt" rendered inside the
existing `.step-actions` row in Step 3, beside `re-analyze-btn` and
`generate-prompt-btn`. Clicking it opens a modal containing:

- A large textarea pre-filled with the **effective** prompt (override or
  preset default).
- A "Use preset default" button (red, destructive-style) that DELETEs the
  override for the current preset and reloads the modal with the preset's
  built-in prompt. Confirmed before destructive action.
- A "Reset to default" button that puts the preset's built-in prompt in
  the textarea (without saving) — same semantics as ADR 0005's subject
  prompt modal. After reset, the user can Save to persist the default text
  as an explicit override (content-based `is_default` stays true), or
  Cancel to discard.
- Character count (X / 10000).
- "Cancel" and "Save" buttons.

The modal title is "Edit final-prompt synthesis prompt" to make clear it
controls Stage 2 (the final prompt), not Stage 1 (the analysis) or Stage 1.S
(the subject re-analysis). A short hint in the modal explains: "This
system prompt controls how the structured analysis is synthesized into the
final image-generation prompt. Override the preset's default without
editing the preset itself."

### 5. No changes to the preset editor

The existing "Edit preset" modal still owns `stage2_system_prompt` as the
**preset default**. The override layer sits on top and never writes back to
`presets.json`. Renaming a preset (id stays stable) keeps overrides
attached; deleting a preset leaves a stale entry in the overrides file
that the next read silently drops (filtered out by the `startsWith('preset_')`
shape check, same defensive pattern as ADR 0006's palette reads).

### 6. Out of scope

- Per-run override (overrides attached to a specific analysis run, not the
  preset). The wizard model is "configure the preset, then run" — a
  per-run override would need a separate UI affordance and persistence
  story. Out of scope for v1.
- Versioning of overrides. Same as ADR 0005: each PUT overwrites, no
  history. Git is the long-term backup.
- Multi-user concurrency. Naive read/write; the same caveat as ADR 0005
  applies. Single-user wizard UI in v1.
- Override inheritance. Overrides are flat per-preset; no "all presets
  derived from this template" mechanism.
- Showing a "this generation used an override" indicator in the result
  card. Could be a v2 feature; not in this iteration.

## Architecture (after)

```
   ┌─────────────────────────────────────────────────────────────┐
   │  data/presets.json                                          │
   │  presets[*].stage2_system_prompt  ←── preset default        │
   └─────────────┬───────────────────────────────────────────────┘
                 │
                 │  if no override for preset.id:
                 │    effective = preset.stage2_system_prompt
                 │
                 ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  data/stage2_overrides.json                                 │
   │  { "preset_xxx": "user's custom prompt" }                  │
   └─────────────┬───────────────────────────┬───────────────────┘
                 │ read on each call          │ PUT writes / DELETE removes
                 ▼                           ▼
   ┌─────────────────────────┐   ┌──────────────────────────────────┐
   │  POST /api/generate-    │   │  GET  /api/stage2-prompt?presetId│
   │  prompt                 │   │  PUT  /api/stage2-prompt?presetId│
   │  resolves effective     │   │  DELETE /api/stage2-prompt?prId │
   │  prompt at call time    │   │  (Edit prompt modal)            │
   └─────────────────────────┘   └──────────────────────────────────┘
```

## Files changed

| File | Change |
|---|---|
| `server.js` | New `STAGE2_OVERRIDES_FILE`, `MAX_STAGE2_PROMPT_LENGTH`, `readStage2Overrides`, `writeStage2Overrides`, `getStage2Override`, `setStage2Override`, `removeStage2Override`, `getEffectiveStage2Prompt`, `validateStage2Prompt` helpers. New `GET`, `PUT`, `DELETE` `/api/stage2-prompt` routes. `/api/generate-prompt` resolves the effective prompt via `getEffectiveStage2Prompt(preset)` before calling `callMiniMaxStage2`. New exports. |
| `src/index.html` | New `<button id="edit-stage2-prompt-btn">` inside `.step-actions`. New `.modal` (`#stage2-prompt-modal`) mirroring `#subject-prompt-modal` with textarea, char count, three action buttons (Use preset default / Cancel / Save). |
| `src/app.js` | DOM cache entries for new modal + button. `openStage2PromptModal`, `closeStage2PromptModal`, `saveStage2Prompt`, `useStage2PresetDefault`, `resetStage2PromptToDefault` functions. Event listeners. `openStage2PromptModal` validates that a preset is selected and disables the Edit button otherwise (mirrors `generate-prompt-btn`'s enablement). |
| `src/styles.css` | Reuse `.modal`, `.modal-content--wide`, `.textarea`, `.char-count--inline`, `.btn-secondary`, `.btn-danger`, `.btn-primary` patterns. Add `.stage2-prompt-textarea` alias if needed (none required — `.subject-prompt-textarea` rules are generic enough; the new modal can just use `.textarea`). |
| `CONTEXT.md` | Pipeline stages section: Stage 2 reads from `preset.stage2_system_prompt` UNLESS an override exists in `data/stage2_overrides.json`. Core entities table: new "Stage 2 override" row. |
| `README.md` | Document new endpoints under API Endpoints. Note `data/stage2_overrides.json` under Project Structure. |
| `tests/run-all.js` | Five new tests: (a) `GET /api/stage2-prompt` route is registered; (b) `PUT /api/stage2-prompt` route is registered; (c) `DELETE /api/stage2-prompt` route is registered; (d) `setStage2Override` + `getStage2Override` round-trip through disk; (e) `getEffectiveStage2Prompt` returns override when set, preset default otherwise; (f) `validateStage2Prompt` rejects empty / oversized / non-string inputs. |

No changes to `FIELD_PALETTE`, `FIELD_FORMAT_HINTS`, the Stage 1 pipeline,
`/api/analyze`, `/api/subject`, `/api/subject-prompt`, the palette editor,
or the preset editor's `stage2_system_prompt` field (which remains the
default and is still editable from the preset modal).

## Why these decisions

- **Per-preset overrides, not global.** Reaffirming the design choice
  surfaced by the user. A global Stage 2 override would erase the per-preset
  specialty; per-preset overrides compose cleanly with the existing
  preset contract.
- **Disk persistence, not localStorage.** Same reasoning as ADR 0005:
  device-portable, consistent with the existing `data/` storage story, no
  server restart needed.
- **Separate file, not embedded in `presets.json`.** Embedding would
  require preset-editor changes to preserve the override when the user
  edits other fields, plus a load-bearing invariant that "saving the
  preset never clobbers the user's override". A sibling file sidesteps
  the invariant entirely.
- **DELETE endpoint for "Use preset default".** The subject prompt
  (ADR 0005) doesn't have this because the subject prompt is global — the
  default is the shipped constant, and a save of that text gives the same
  effect as no override. For Stage 2 the "default" is per-preset and
  lives on the preset itself, so a true revert requires removing the
  override file entry. DELETE is the cleanest semantic.
- **Content-based `is_default`, not storage-based.** Mirrors ADR 0005.
  Lets the modal show "shipped default" when the user has typed the
  preset's prompt back in, even though an override file entry exists.
  Keeps the UI honest without complicating the storage layer.
- **Naive read/write, not atomic + locked.** Same caveat as ADR 0005.
  Single-user wizard UI in v1.

## Trade-offs and risks

- **Stale override entries on preset delete.** If the user deletes a
  preset while it has an override, the entry stays in
  `data/stage2_overrides.json` until manually cleaned. Mitigation:
  `readStage2Overrides` filters entries by `startsWith('preset_')` and
  shape-checks the value; stale entries are silently dropped at read time.
  No automatic GC for now — the file is bounded by the number of presets
  the user creates (handfuls), so it won't grow without bound in practice.
- **A bad override can break Stage 2.** Same risk as ADR 0005: the user
  can save a prompt that produces nothing useful. The API error is
  surfaced via `showError`, and the "Use preset default" button is the
  recovery path.
- **Per-preset storage means the file's keys can drift from the preset
  registry.** Mitigated by the read-time filter; never a runtime crash,
  just stale entries that are ignored.
- **Validation is permissive.** Same as ADR 0005: server-side validation
  is shape / emptiness / length only. The user owns the prompt.

## Verification

- `node scripts/session-init.js` — must still report 10/10 checks.
- `node tests/run-all.js` — all tests (22 existing + 6 new = 28) must
  pass.
- Manual smoke:
  1. Open the UI, upload an image, run Stage 1, edit the analysis.
  2. Click "Edit prompt" beside "Generate prompt". Modal shows the
     preset's `stage2_system_prompt` with `— shipped default` indicator.
  3. Modify the prompt (e.g. shorten the field-integration order). Save.
  4. Click "Generate prompt" — the response reflects the edited prompt
     (e.g. the new ordering).
  5. Re-open "Edit prompt" — the edited text is still there, indicator
     now reads `— custom (edited)`.
  6. Click "Use preset default", confirm — modal reloads with the
     preset's built-in prompt; "Generate prompt" returns to original
     behaviour.
  7. Re-edit, then click "Reset to default" — textarea reverts to the
     preset's prompt without persisting. Click Save — prompt is saved
     as an explicit override; indicator reads `— shipped default` (content-
     based check passes).
  8. Switch to a different preset — the modal, when re-opened, shows
     THAT preset's default (overrides are per-preset).
- Server smoke: `GET /api/stage2-prompt?presetId=preset_xxx` returns
  200 with `{ prompt, default_prompt, is_default }`. With an unknown
  presetId it returns 404. `PUT /api/stage2-prompt?presetId=preset_xxx`
  with `{ prompt: "" }` returns 400. `DELETE` returns 200 and the
  override is gone on next read.
