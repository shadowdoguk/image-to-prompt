# ADR 0010 — Allow textarea fields in preset `field_defaults`

## Status

Accepted. Implemented 2026-06-23.

## Context

ADR 0002 introduced preset `field_defaults` to let a preset author contribute
content (not just extraction instructions) to Stage 2. v1 restricted defaults
to `text` input fields only. The rationale, quoted verbatim from ADR 0002:

> **`textarea` field defaults** — too easy to misuse (e.g. preset-defaulted
> `subject` would never match the uploaded image).

That concern is real for *image-content* textareas (`subject`,
`subject_orientation`, `actions`, `composition`). A preset-defaulted `subject`
would inject a string that has nothing to do with the user's uploaded image,
and Stage 2 would be obliged to incorporate it.

But the rationale does not apply to *style/atmosphere* textareas, of which
the palette has two:

- `texture` — surface qualities (impasto, smooth glaze, brushwork, weave).
- `mood` — atmosphere / emotional register (somber, exuberant, brooding).

Both are stylistic assertions a preset author wants to make about the *kind*
of output, not factual claims about the *depicted* content. A user selecting
the `preset_alla_prima_oil` preset reasonably expects "impasto, palette-knife
ridges, dragged paint" to flow through to Stage 2 — exactly the same
expectation they already have for `artistic_medium` and `style`.

The current state forces the author to either:

1. Stuff the texture assertion into `stage1_system_prompt`, which dilutes the
   description-first contract and competes with the LLM's own visual analysis,
   or
2. Stuff it into `artistic_medium` (a `text` field, allowed), which is the
   wrong semantic place — `artistic_medium` describes *what the artist used*,
   while `texture` describes *how the surface reads*.

## Decision

### 1. Lift the `text`-only restriction on `field_defaults`

`validateFieldDefaults` in `server.js` now accepts both `text` and `textarea`
fields. Validation rules become:

- Keys must still be valid `FIELD_PALETTE` names.
- Keys must still be members of the preset's own `stage1_fields`.
- Values must be non-empty strings.
- Values must meet `FIELD_INPUT_MIN_LENGTH` for the field's input type
  (text → 15 chars, textarea → 100 chars).
- `colors` array fields remain blocked (separate UI affordance still owed).

The error message changes from "only text fields are supported in v1" to
"only text and textarea fields are supported", removing the version-gate
phrasing that suggested the restriction was permanent.

### 2. Seed `texture` defaults for the two oil presets

Both oil-painting presets (`preset_alla_prima_oil` and the imported
`preset_968c0ccdf6fc6151`) gain a `texture` default of 100+ chars describing
their surface qualities:

- `preset_alla_prima_oil`: impasto, palette-knife ridges, dragged pigment
  revealing canvas weave.
- `preset_968c0ccdf6fc6151`: heavy scraped/smeared impasto, gestural
  streaks radiating outward, thin scraped background washes.

Both values pass the 100-char textarea floor. Neither preset overrides the
LLM's texture analysis by default — the source toggle in Step 3 still
defaults to "Analysis" (per ADR 0002 §2), and the user explicitly opts into
the preset value by clicking the "Preset" button. That keeps the trust
model intact: the LLM's reading of the actual image is shown first; the
preset value is a one-click override for when the LLM missed the surface
identity the preset is asserting.

Presets that do not include `texture` in `stage1_fields` (photorealistic,
sd_danbooru) are unaffected — `validateFieldDefaultsAreSubset` already
rejects defaults for fields the LLM isn't analysing.

### 3. ADR 0002 amended by reference

This ADR does not rewrite ADR 0002. ADR 0002 is immutable once Accepted;
the v1 "text only" rule is preserved in its text as historical record. This
ADR supersedes only the input-type restriction clause; everything else in
ADR 0002 (per-field source toggle, client-side merge, .i2p.json envelope,
modal editor deferral) stands.

## Architecture (after)

```
preset.field_defaults = {
  artistic_medium: "Palette knife ...",   // text   — ADR 0002 (unchanged)
  style:           "Gestural ...",       // text   — ADR 0002 (unchanged)
  texture:         "Thick impasto ..."   // textarea — ADR 0010 (new)
}
                  ▲
                  │  validateFieldDefaults now accepts both input types.
                  │  FIELD_INPUT_MIN_LENGTH floors each (text=15, textarea=100).
```

No client-side change. The source toggle UI in Step 3 already renders for
any field with a default; `texture` automatically appears there once the
preset defines one. No `src/app.js` or `src/styles.css` edits.

## Files changed

| File | Change |
|---|---|
| `server.js` | `validateFieldDefaults`: input-type check accepts both `text` and `textarea`; error message updated; JSDoc cites ADR 0010. |
| `src/app.js` | `renderAnalysisEditor` (line ~496): `hasToggle` predicate widened from `def?.input === 'text'` to also admit `def?.input === 'textarea'`. Without this, the server accepts the texture default but the client never renders the `[Analysis][Preset]` toggle, so the user sees no parity with `artistic_medium`. |
| `data/presets.json` | `preset_alla_prima_oil` and `preset_968c0ccdf6fc6151` gain `texture` default. |
| `docs/adr/0010-textarea-field-defaults.md` | This ADR. |

No CSS change: `.field-row__label-row` already uses `flex-wrap: wrap`, so the
toggle sits cleanly next to a textarea label exactly as it does next to a
text-input label. No test changes: `tests/run-all.js` already asserts preset
field references resolve and stage1 prompts fit `MAX_PROMPT_LENGTH`; both
remain true, and there is no existing test for the toggle predicate
(smoke-tested manually — see Verification).

## Backward compatibility

- **Existing presets without `texture` defaults** are unaffected. The merge
  step in `collectAnalysisFromEditor` is a no-op for fields without a
  default.
- **Existing `.i2p.json` exports without `texture`** import successfully.
- **Existing tests** continue to pass. The validation contract was
  *expanded*, not changed: previously-rejected textarea defaults now
  succeed, but no previously-valid input is now invalid.
- **Stage 2 wire format** is unchanged. The client-side merge in
  `collectAnalysisFromEditor` (ADR 0002 §3) is the same path.

## Why these decisions

- **Server-side validation, not client-side.** Consistent with ADR 0002
  §1. The server is the only place that knows the full preset schema, so
  it stays the gatekeeper. The client gets the toggle for free because the
  toggle condition is "field has a default", which is schema-derived.
- **No field-by-field allowlist.** Maintaining a list of which textareas
  are "safe to default" would drift as new fields are added. The minLength
  check (100 chars for textarea) is the meaningful guardrail: a one-line
  `texture` default is rejected the same way a one-line `subject` default
  would be.
- **Analysis still wins by default.** ADR 0002 §2 chose "Analysis" as the
  default source toggle position for safety. Keeping that default for
  `texture` means the user's first view of the texture field still reflects
  the uploaded image, not the preset author's assertion. The override
  remains a conscious opt-in.
- **Two presets seeded, not four.** The photorealistic and Danbooru presets
  don't include `texture` in `stage1_fields`, so adding a default would be
  rejected by `validateFieldDefaultsAreSubset`. The two oil presets are the
  ones for which a `texture` default is meaningful and used.

## Out of scope (deferred)

- **`colors` array defaults** — still blocked. Needs a structured editor
  (`{hex, name}[]`) and per-color validation. Separate UI affordance, same
  as ADR 0002 §"Out of scope".
- **Per-preset `texture` length overrides** — every textarea is held to the
  generic 100-char floor. If a preset author wants a longer mandated
  texture default (e.g. "exactly 200 chars"), `FIELD_FORMAT_HINTS` is the
  existing extension point (see ADR 0003 §"Per-field overrides").
- **Default-source change for `texture`** — "Preset" remains opt-in. Flipping
  the default to "Preset" would surprise users whose image clearly shows
  smooth acrylic when the preset author wrote "impasto"; the original
  trust argument in ADR 0002 §"Why these decisions" still applies.

## Reproducibility / verification

- After implementation: `node scripts/session-init.js` should still report
  10/10 validation checks passing.
- `node tests/run-all.js` should still pass all existing assertions
  (no test covers `validateFieldDefaults` directly today; manual smoke is
  sufficient for this small extension).
- Manual: select `preset_alla_prima_oil`, upload any image, run Stage 1,
  confirm the `Texture` row now shows `[Analysis][Preset]` toggle (in
  addition to `Artistic medium` and `Style`); click "Preset" and watch the
  value swap to the impasto ridge description; generate and confirm Stage 2
  uses the preset value.