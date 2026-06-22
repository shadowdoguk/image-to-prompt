# ADR 0002 — Preset field defaults with per-field source toggle

## Status

Accepted. Implemented 2026-06-21.

## Context

Presets (`data/presets.json`) currently control **what** Stage 1 extracts
(`stage1_fields`) and **how** both stages think (`stage1_system_prompt`,
`stage2_system_prompt`), but they cannot contribute any **content** of their
own. Every field value in the analysis is whatever the vision LLM produced —
even when the preset's whole reason for existing is to assert a particular
stylistic identity (e.g. "this is always an alla prima oil painting").

A concrete example: a user picks the `preset_alla_prima_oil` preset to
generate oil-painting prompts, but the LLM's `artistic_medium` field comes
back as "mixed media on paper" for a photograph that's been uploaded. The
preset author knows the desired output is "Palette knife and vigorous,
directional brushwork. Oil on canvas" — but has no way to bake that into the
preset.

The user is then forced to either:

1. Re-prompt or hand-edit `artistic_medium` after every analysis, or
2. Add heavy-handed boilerplate to `stage1_system_prompt` trying to coerce
   the LLM, which hurts other fields and drifts the prompt away from its
   description-first contract (see ADR 0001).

There is also no concept of a per-field "use the preset's value instead of
what the LLM discovered" — every field is treated as image-derived by default.

## Decision

### 1. New optional preset field: `field_defaults`

Each preset gains an optional object whose keys are subset of
`stage1_fields` and whose values are strings the user wants Stage 2 to see
instead of (or as well as) the LLM's analysis:

```json
{
  "id": "preset_alla_prima_oil",
  "stage1_fields": ["subject", "style", "artistic_medium", "..."],
  "field_defaults": {
    "artistic_medium": "Palette knife and vigorous, directional brushwork. Oil on canvas.",
    "style": "Gestural alla prima oil painting"
  }
}
```

Constraints:

- Optional. Absent → behaviour identical to today. No migration needed.
- Keys must be valid `FIELD_PALETTE` names AND members of the preset's own
  `stage1_fields` (a default for a field Stage 1 isn't asked to analyse is
  nonsense).
- **Text fields only** for v1 (`style`, `lighting`, `artistic_medium`,
  `camera_angle`, `depth_of_field`, `contrast`, `era`). `textarea` fields
  (e.g. `subject`, `composition`) and the `colors` array are out of scope —
  image-blind pre-fills for prose would mislead Stage 2, and structured
  color defaults need a separate UI.
- Values are validated as non-empty strings. They are also checked against
  `FIELD_INPUT_MIN_LENGTH` so the Stage 2 prompt stays coherent (a one-word
  `artistic_medium` defeats the purpose).
- Server-validated in `validatePreset`; persisted through `POST`, `PUT`,
  and the export/import envelope (`image-to-prompt-preset` v1).

### 2. Per-field source toggle in Step 3

For each field row in the analysis editor (`src/app.js: renderAnalysisEditor`):

- If `preset.field_defaults[fieldName]` is present, render two small buttons
  next to the label: **Analysis** and **Preset**.
- The active button is styled; the input/textarea shows the value of the
  active source. Switching swaps the displayed value.
- If absent, render as today (single input, no toggle).
- **Default selection when a default exists: Analysis.** The LLM's value is
  already loaded; the toggle becomes an explicit, conscious choice. This
  keeps the override safe — users opt into it rather than discovering the
  preset silently overruled their image.

The input remains editable in both modes. The user can tweak either source's
value before clicking "Generate prompt".

### 3. Client-side merge at submit time

The merge happens in `collectAnalysisFromEditor` (`src/app.js`). For every
field whose current source is "Preset", the client's `state.currentAnalysis`
is overwritten with `preset.field_defaults[field]`. The merged object is
sent to `POST /api/generate-prompt` as today.

Server `/api/generate-prompt` is **unchanged**. The wire format and the
"analysis is the analysis" contract documented in `CONTEXT.md` both stay
intact. This keeps the change additive and the ADR testable in isolation.

### 4. .i2p.json envelope updated

`/api/presets/export/all` and `/api/presets/export/:id` now include
`field_defaults`. `/api/presets/import` accepts and persists it.
Envelopes without `field_defaults` import successfully (treated as empty).

### 5. No preset-editor modal changes in v1

The preset editor modal in `src/index.html` is unchanged. Defaults are
edited by editing `data/presets.json` directly, or by importing an
`.i2p.json` envelope that contains them. Adding per-field inputs to the
modal would balloon the UI surface (one input per palette field per preset)
and is deferred.

## Architecture (after)

```
                ┌─────────────────────────────┐
                │  User uploads image          │
                │  + selects preset            │
                └─────────────┬───────────────┘
                              │
                              ▼
       ┌──────────────────────────────────────────┐
       │  Stage 1 — callMiniMaxStage1             │
       │  Analyzes every field in stage1_fields   │
       │  (including any fields with defaults —   │
       │   defaults don't suppress analysis)      │
       └─────────────┬────────────────────────────┘
                     │
                     ▼
       ┌──────────────────────────────────────────┐
       │  Stage 1.5 — orientation/actions         │
       │  (if applicable; unchanged)              │
       └─────────────┬────────────────────────────┘
                     │
                     ▼
       ┌──────────────────────────────────────────┐
       │  Step 3 — analysis editor                │
       │  For each field:                         │
       │    • has default → [Analysis][Preset]    │
       │      toggle next to label                │
       │    • no default → plain input            │
       │  User may edit either source.            │
       └─────────────┬────────────────────────────┘
                     │  client merges preset defaults
                     │  for fields in "Preset" mode
                     ▼
       ┌──────────────────────────────────────────┐
       │  Stage 2 — callMiniMaxStage2             │
       │  Receives merged analysis as before.     │
       │  Server untouched.                       │
       └──────────────────────────────────────────┘
```

## Files changed

| File | Change |
|---|---|
| `data/presets.json` | Added `field_defaults` to `preset_alla_prima_oil` (artistic_medium + style) as the worked example. |
| `server.js` | `validatePreset` now accepts optional `field_defaults` (object, text fields only, subset of `stage1_fields`, minLength-checked). `POST` and `PUT` pass it through. Export endpoints include it; import endpoint accepts it. |
| `src/app.js` | `renderAnalysisEditor` renders the `[Analysis][Preset]` toggle when a field has a default. `collectAnalysisFromEditor` overlays chosen preset values onto `state.currentAnalysis` before sending to Stage 2. State keeps `selectedFieldSources: { [field]: 'analysis' \| 'preset' }`. |
| `src/styles.css` | `.field-row__toggle`, `.source-btn`, `.source-btn.is-active` — small pill-style buttons, fits existing button palette. |
| `src/index.html` | No structural change. Toggle is JS-built. |

## Backward compatibility

- **Existing presets** without `field_defaults` are unaffected. The merge
  step in `collectAnalysisFromEditor` is a no-op when `state.selectedFieldSources`
  is empty (no toggles shown → no overrides applied).
- **Existing `.i2p.json` exports** without `field_defaults` import
  successfully. `validatePreset` treats absent `field_defaults` as `{}`.
- **Existing tests** in `tests/run-all.js` continue to pass — the new
  field is validated separately and is optional everywhere.
- **Stage 2 contract unchanged.** The wire format of
  `POST /api/generate-prompt` is identical; the server treats `analysis`
  as opaque.

## Why these decisions

- **Client-side merge, not server-side.** Keeps the Stage 2 wire format
  intact, keeps the analysis as the single object the rest of the system
  reasons about, and keeps the server free of preset-aware merging logic
  that would have to be re-implemented for any future caller (CLI, tests,
  third-party integrations).
- **Text fields only for v1.** Image-blind pre-fills for `subject` or
  `composition` would actively mislead Stage 2. Restricting to text fields
  matches the user's worked example (`artistic_medium`) and avoids the
  most obvious misuse class.
- **Analysis as default source.** The LLM value is already loaded; making
  "Preset" the default would silently override what the user just saw and
  produce surprises. Opt-in keeps the trust model intact.
- **JSON-file editing only for v1.** Modal editing is a larger UI surface
  than the rest of the feature and easy to defer; exporting/importing
  `.i2p.json` covers the "share defaults" use case in the meantime.

## Out of scope (deferred)

- **`colors` field defaults** — would need a structured array editor and
  validation (`{hex, name}[]`), separate UI affordance.
- **`textarea` field defaults** — too easy to misuse (e.g. preset-defaulted
  `subject` would never match the uploaded image).
- **Per-field "lock" mode** — preventing edits to preset source. The
  override is already opt-in per field; a lock adds friction without
  solving a real problem yet.
- **"Apply preset defaults to all" bulk button** — trivial to add later,
  not worth the v1 surface area.
- **Per-session memory of toggle state** — `localStorage`-backed "last
  choice per field" tracking. Not asked for; deferred.
- **Modal-based preset-default editor** — see §1 above; editing
  `data/presets.json` directly is the v1 path.

## Reproducibility / verification

- After implementation: `node scripts/session-init.js` should still report
  10/10 validation checks passing (the new field is schema-validated by
  the same scanner that already inspects presets).
- `node tests/run-all.js` should still pass all existing assertions.
- Manual: select `preset_alla_prima_oil`, upload any image, run Stage 1,
  confirm the `Artistic medium` and `Style` rows show `[Analysis][Preset]`
  toggles with "Analysis" highlighted by default; click "Preset" and watch
  the value swap to the preset-defined string; generate and confirm Stage 2
  uses the preset value.
