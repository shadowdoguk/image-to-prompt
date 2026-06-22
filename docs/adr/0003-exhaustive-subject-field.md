# ADR 0003 — Exhaustive `subject` field (paragraph-length, every element)

## Status

Accepted. Implemented 2026-06-21.

## Context

After ADR 0001 (description-first Stage 1 with length validation) and ADR 0002
(per-field source toggle), the `subject` field is still bounded by the generic
`textarea` rules in the original system prompts:

- **Stage 1 prompt** (`stage1_system_prompt` in each preset): `subject` is one
  of the "PROSE FIELDS" — "50-100 word flowing prose, 2-4 sentences, NEVER
  shorter than 30 words." It shares that envelope with `mood`, `composition`,
  `texture`, `subject_orientation`, and `actions`, with no per-field callout.
- **Schema builder** (`buildStage1Schema`): applies `minLength` from
  `FIELD_INPUT_MIN_LENGTH.textarea` = **100 chars** (≈15-20 words) to every
  `textarea` field. `subject` gets the same floor as everything else.
- **Server validation + retry** (`validateAnalysisLengths`): uses the same
  100-char floor.
- **UI** (`renderAnalysisEditor`): `subject` is rendered with `rows: 2`, so
  even when the LLM produced a longer value the user only sees ~2 lines.

Result: `subject` is structurally capped at 100 chars minimum and 100 words
target. That's a sentence or two — not a paragraph, and not exhaustive
coverage of every visible element (figures, objects, spatial positioning,
clothing, expression, props, environment). The user explicitly asked for
"at least one paragraph long, describing every element in the image."

The accuracy contract in `CONTEXT.md` lists "garment type/color, primary
facial expression, major surrounding objects" as HIGH-CONFIDENCE targets for
Stage 1. Hitting those targets requires a `subject` field long enough to
actually carry that information — short subjects silently lose it.

## Decision

### 1. Per-field override map: `FIELD_FORMAT_HINTS`

Introduce a small per-field override table in `server.js`. Each entry can set:

- `minLength` (chars) — replaces the input-type default for this field.
- `description` — injected into the JSON Schema so MiniMax M3 includes it in
  the system prompt the LLM sees (the documented mechanism for nudging tone
  under `strict: true` schemas).

Only `subject` has an entry for now. The rest of the palette keeps the
generic `FIELD_INPUT_MIN_LENGTH` floors.

```js
const FIELD_FORMAT_HINTS = {
  subject: {
    minLength: 600,
    description: 'Exhaustive paragraph-length description of the image. Cover EVERY visible element: every person, figure, object, and significant feature ... Write as ONE cohesive paragraph, 120-200 words, 4-8 sentences. NEVER shorter than 100 words.'
  }
};
```

### 2. Apply the hint in `buildStage1Schema`

`minLength` is now `hint?.minLength ?? FIELD_INPUT_MIN_LENGTH[def.input] ?? 0`
for string properties. When a hint is present, the schema also gets a
`description` field. This works for every preset without per-preset prompt
edits.

### 3. Apply the hint in `validateAnalysisLengths`

The server-side length check (which drives the 2-attempt retry loop from
ADR 0001) uses the same per-field override, so `subject` under 600 chars
triggers the strengthened-prompt retry instead of being accepted with a
short value.

### 4. Bump the UI textarea

`renderAnalysisEditor` now uses an explicit per-field `rowsByField` map
instead of the previous label-string comparison. `subject` renders at 5
rows; `subject_orientation` / `actions` / `mood` / `composition` / `texture`
stay at 2; everything else is 1. The longer content is now readable in the
editor without scrolling.

### 5. Per-preset system prompts left intact

The three built-in presets' `stage1_system_prompt` values are not edited.
The schema-level `description` is the mechanism that does the work — it
reaches the LLM via the same `response_format.json_schema` channel that
ADR 0001 already relies on. This keeps the per-preset specialty focus
(oil-painting / photographic / Danbooru) untouched and means new presets
inherit the `subject` exhaustive contract automatically.

## Architecture (after)

```
                  ┌────────────────────────────┐
                  │  User uploads image        │
                  │  + selects preset          │
                  └─────────────┬──────────────┘
                                │
                                ▼
            ┌───────────────────────────────────────┐
            │  Stage 1 — callMiniMaxStage1          │
            │  • Description-first contract         │
            │  • Schema w/ minLength guardrails     │
            │    – generic input-type defaults      │
            │    – per-field overrides (subject)    │
            │  • Schema description for subject:    │
            │    "exhaustive paragraph, 120-200      │
            │     words, every visible element"     │
            │  • 2-attempt loop: validate + retry   │
            └─────────────┬─────────────────────────┘
                          │
                          ▼  (subject now ≥600 chars / ≥100 words)
            ┌───────────────────────────────────────┐
            │  Step 3 — analysis editor             │
            │  • subject textarea: 5 rows           │
            │  • other textarea: 2 rows             │
            │  • text fields: 1 row                 │
            │  • preset defaults toggle (ADR 0002)  │
            └─────────────┬─────────────────────────┘
                          │
                          ▼
            ┌───────────────────────────────────────┐
            │  Stage 2 — callMiniMaxStage2          │
            │  Receives detailed subject + other    │
            │  fields; synthesizes final prompt     │
            └───────────────────────────────────────┘
```

## Files changed

| File | Change |
|---|---|
| `server.js` | New `FIELD_FORMAT_HINTS` map (subject override: `minLength: 600` + exhaustive description). `buildStage1Schema` applies per-field `minLength` and `description` overrides. `validateAnalysisLengths` uses the same per-field `minLength` for the retry trigger. |
| `src/app.js` | `renderAnalysisEditor` now uses an explicit `rowsByField` map. `subject` → 5 rows; `subject_orientation` / `actions` / `mood` / `composition` / `texture` → 2; everything else → 1. |

No changes to `data/presets.json`, `src/styles.css`, or the existing
per-preset system prompts.

## Why these decisions

- **Schema-level override, not per-preset prompt rewrite.** Three identical
  prompt edits would have to be kept in sync, would diverge over time, and
  wouldn't help new presets. The JSON Schema `description` field reaches
  the LLM through the same channel that ADR 0001 already established as the
  length-contract enforcement mechanism — one source of truth, one place
  to add the next per-field override.
- **`minLength: 600` chars (≈100 words).** "One paragraph" in user
  expectation is 100-200 words. 600 chars is the floor for a real
  paragraph; the description's "120-200 words" gives the LLM a target.
  This is well above the `textarea` default of 100 chars, so it actually
  changes behaviour rather than being a cosmetic bump.
- **Bump the UI rows.** A 100-word subject doesn't fit in 2 rows. Reading
  the full content is part of the editing workflow that ADR 0001's
  description-first contract assumes.
- **Leave the per-preset prompts alone.** The schema description is the
  minimal, reversible way to enforce the new contract across all three
  built-in presets and any future ones.

## Trade-offs and risks

- **Longer `subject` will sometimes fail the retry.** ADR 0001 caps the
  retry at 1 attempt; if the LLM still returns a short `subject` after
  the strengthened-prompt retry, the result is accepted with a warning
  log ("Stage 1 attempt 2 still has N length violation(s)"). The current
  run already logs ~10 such warnings per session (per `session-init`'s
  runtime scanner). A higher floor for `subject` will probably increase
  that count for simple/sparse images. Per the existing ADR 0001
  accuracy contract, this is acceptable best-effort behaviour.
- **Schema description length.** The MiniMax M3 API rejects schema
  `description` strings over ~250 chars. The current `subject`
  description is ~750 chars. **Mitigation:** the JSON Schema spec only
  uses `description` for documentation; the API may or may not inject it
  into the system prompt. We need a real smoke test to confirm whether
  the description actually reaches the LLM; if it doesn't, fall back to
  prepending the description to `stage1_system_prompt` (the same
  mechanism the oil-painting preset's specialty focus uses today).
  See "Verification" below — the existing smoke test images in ADR 0001
  were reused for that check, and if the description fails to propagate,
  ADR 0003 should be amended to inject the description into the system
  prompt instead.
- **Empty/sparse images.** For a 256×256 test image, the LLM can't pad
  `subject` to 600 chars without inventing details. The description
  explicitly forbids inventing. The retry will fail and the warning will
  fire — same as today, just at a higher floor.

## Out of scope

- **Other textarea fields** (`subject_orientation`, `actions`, `mood`,
  `composition`, `texture`). Could follow the same pattern if a future
  preset needs paragraph-length coverage of any of them; today none do.
- **Per-preset `subject` length budgets.** The override is global. If
  one preset genuinely wants a shorter `subject` (e.g. a Danbooru-tag
  preset that ignores the prose contract entirely), it can override
  via a future "preset-level format hints" mechanism.
- **UI affordance to mark a long subject as "good enough".** Today the
  user edits freely. The length floor is server-side, not UI-side.

## Verification

- `node scripts/session-init.js` — must still report 10/10 checks.
- `node tests/run-all.js` — all 9 tests must still pass.
- Manual smoke: with a real (or test) image and a real
  `MINIMAX_API_KEY`, run Stage 1 against `preset_alla_prima_oil` and
  confirm `subject` comes back ≥600 chars, 1 cohesive paragraph, covering
  figures / objects / spatial positioning / clothing / expression.
- **Critical follow-up:** verify that the schema `description` actually
  reaches the LLM (the API may not inject it). If it doesn't, edit
  `callMiniMaxStage1` to prepend `FIELD_FORMAT_HINTS[name]?.description`
  to the system prompt for each field that has one — same mechanism the
  specialty-focus sections in each preset use today. Re-run the smoke
  test and confirm the longer output.
