# ADR 0016 — Z-Image Turbo palette strength + accent placement

## Status

Accepted. Implemented 2026-06-28 (commit `f2c76d2`).

## Type

Prompt contract + palette schema + post-generation validation.
Touches `server.js` (schema + prompt + helpers + endpoint),
`src/app.js` + `src/index.html` + `src/styles.css` (edit modal),
and `tests/run-all.js`.

## Context

ADR 0014 introduced weighted color distribution (per-color `weight`,
per-color `accent`, palette-level `accent_max_mentions`) and a
post-generation `measureColorDistribution` helper. ADR 0015
established the canonical Z-Image Stage 2 prompt
(`DEFAULT_ZIMAGE_STAGE2_PROMPT`) with two-section output and 10
format-order rules.

In live use after 0014/0015 shipped, three gaps surfaced:

1. **No "strength" semantic on the palette.** The current weight
   system is quantitative (1–10) and produces percentage splits.
   Users want a qualitative knob (`subtle` / `moderate` / `strong` /
   `strict`) that controls how aggressively the LLM is told to
   honor the palette. Today, the LLM receives the same color budget
   block whether the user wants a strict brand-locked image or a
   loose color hint.

2. **Accent placement is implicit.** The current accent contract
   says "this color is the primary tone of its region" but does not
   name the region. For brand work, the user often knows exactly
   where the accent should land ("upper-left quadrant", "the
   subject's collar", "the background sky"). The LLM is forced to
   infer, which is fine for naturalistic prompts but loses control
   for layout-driven work.

3. **`measureColorDistribution` only measures, never validates.**
   When a user requests a `strict` palette, they expect the output
   to be checked — not just measured — so a failure is surfaced
   rather than silently ignored. The current helper returns zeros
   and counts but no pass/fail signal.

A fourth, smaller driver: the canonical Z-Image Stage 2 prompt
(ADR 0015) was authored generically. It does not explicitly
reference Z-Image Turbo's known model profile (6B S3-DiT, Qwen3-4B
text encoder, ~8 NFEs, guidance_scale=0.0, Flux 1 VAE) and does
not mention `strength` or `placement`. Once strength + placement
fields exist on palettes, the prompt contract must interpret them.

## Decision

### 1. New palette field: `strength` (string enum)

Four valid values: `subtle` | `moderate` | `strong` | `strict`.
Default: `moderate`.

Semantics (encoded in the prompt; see §5):

| Level | LLM instruction language | Expected mention ratio |
|---|---|---|
| `subtle` | "Use these as gentle reference colors; feel free to introduce complementary tones that fit the subject." | 40–70% |
| `moderate` | "Honor the palette closely; deviations allowed only for natural shadows and skin tones." | 70–90% |
| `strong` | "Every named color must appear in the prompt at least once. No off-palette introductions." | 90–100% |
| `strict` | "The final prompt must mention each color the documented number of times (±0). No substitutions." | 100% (validated) |

Storage: `palette.strength` (string).
Validation: `validatePaletteStrength(value)` enforces membership.
Legacy synthesis: `readPalettes` synthesizes `strength = "moderate"`
for palettes missing the field (mirroring `weight`/`accent`).
History: `snapshotPalette` captures `strength` so restore works.

### 2. New color field: `placement` (optional string, ≤60 chars)

Storage: `color.placement` (string).
Validation: `validatePaletteColorsFlexible` accepts `placement` when
supplied. Empty string → no placement directive.
Effect on `buildColorBudgetBlock`: appends `, placement: <region>`
to the line when `placement` is non-empty AND `accent === true`.
History: `snapshotPalette` captures `placement` per color.

The LLM instruction language (rule 12, see §5) is:

> Accent overrides fully replace the original region's color AND
> must appear within the documented placement region. If the
> source image's accent region contradicts the user-supplied
> placement, user placement wins.

### 3. `measureColorDistribution` extension: `strict_pass`

When `palette.strength === "strict"`, the helper compares measured
counts to the documented counts and returns:

```json
{
  ...existing fields...,
  "strict_pass": true | false,
  "strict_violations": [
    { "name": "Crimson", "expected_min": 1, "measured": 0 }
  ]
}
```

`strict_pass === true` when every named color appears at least once
AND no color exceeds `accent_max_mentions` (for accent colors) or
appears more than `expected_max` (a function of weight). The exact
algorithm: per-color expected count = `Math.max(1, Math.round(
weight / 2 ))` for non-accents; accent colors use
`accent_max_mentions` as the cap. The helper reports the first 10
violations and a boolean.

### 4. Endpoint changes

`POST /api/generate-prompt` already returns `distribution_metrics`
when a weighted palette is supplied. The extension: when
`palette.strength === "strict"`, `distribution_metrics.strict_pass`
+ `distribution_metrics.strict_violations` are added. The frontend
surfaces a non-blocking warning on `strict_pass === false`.

`GET /api/palettes/:id/distribution` (added in ADR 0014 Phase 4)
also propagates `strict_pass` from the latest telemetry entry.

### 5. Canonical Stage 2 prompt updates (append, not rewrite)

`DEFAULT_ZIMAGE_STAGE2_PROMPT` gains two new rules appended to the
existing "RULES (priority order)" list (currently 10 items, becomes
12):

```
11. STRENGTH MODIFIER (when palette supplied): interpret
    palette.strength per the four-level contract — subtle (gentle
    reference, complementary tones allowed), moderate (close
    adherence, natural-shadow deviations only), strong (every named
    color appears at least once, no off-palette introductions),
    strict (per-color mention count is locked, validated
    post-hoc).
12. ACCENT PLACEMENT (when an accent has a placement): accent
    overrides fully replace the original region's color AND must
    appear within the documented placement region. If the source
    image's accent region contradicts the user-supplied placement,
    user placement wins.
```

The vocabulary anchor, sub-components, format-order rules 1–10,
Section A/B structure, and "RULES (priority order)" header all
remain unchanged. This is the smallest viable delta to the locked
prompt contract.

### 6. Frontend: edit modal additions

- `palette.strength` — a `<select>` with 4 options in the edit
  modal, defaulting to `moderate`.
- `color.placement` — a text input (`maxlength="60"`) per color
  row, visible only when `accent === true`. Empty when no
  placement is set.
- `distribution_metrics.strict_pass` — when false, the result
  panel shows a warning chip + "Regenerate with stronger directive"
  button. Non-blocking; the user can copy the prompt anyway.

All controls mirror the existing edit modal pattern (ADR 0013
Phase 3 + ADR 0014 Phase 3): edit-buffer → apply on Save → PUT
`/api/palettes/:id`. No new endpoints.

### 7. ADR 0014 / 0015 cross-references

- 0014 Phase 1 (`isPaletteUnweighted`) is unchanged: a palette
  with only `strength` changed (no `weight`/`accent` customization)
  is still "pure legacy" and the `color_budget` block is omitted.
  This means a user who creates a new palette, sets only `strength`
  to `strong`, and leaves colors default — will not see a color
  budget in Stage 2. This is intentional: `strength` only has
  effect when the palette is "weighted" by some other criteria.
  Rationale: prevents an empty color list from producing a
  meaningless "strict" run.
- 0015 sentinel substitution is unchanged. `strength` and
  `placement` ride along inside the prompt envelope, not the
  prompt itself.
- 0014 distribution telemetry (`palette_runs.json`) is unchanged in
  shape; the new `strict_pass` field is an additive property of
  the existing `distribution_metrics` object.

## Feasibility

| Constraint | Decision |
|---|---|
| `MAX_PROMPT_LENGTH = 5000` cap on `preset.stage2_system_prompt` | Unaffected — we add ~400 chars to the canonical constant in `server.js`, not to any preset's value. The sentinel substitution is unchanged. |
| `MAX_STAGE2_PROMPT_LENGTH = 10000` cap on user-entered overrides | Unaffected. User overrides continue to bypass `DEFAULT_ZIMAGE_STAGE2_PROMPT` and inherit no automatic strength/placement interpretation. Documented in ADR 0017 follow-up note if needed. |
| Palette JSON size on disk (`data/palettes.json`) | Additive — one string per palette + ≤60 chars per accent color. Negligible. |
| `readPalettes` legacy synthesis (ADR 0014) | Extended — adds `strength` synthesis alongside `weight`/`accent`. |
| Edit modal UX space (ADR 0014 Phase 3) | Two new controls fit in the existing modal layout. Strength is a single row; placement is a per-color row that's hidden when `accent === false`. |
| Frontend test surface (existing) | ~3 new wiring tests for the new controls (HTML/CSS/JS). |
| `measureColorDistribution` backwards compat | Unaffected for non-strict palettes. New `strict_pass` field is added only when relevant. |
| Chat refinement (ADR 0011/0012) | Out of scope. Refinement requests currently ignore palette strength. Documented in §"Out of scope". |
| Sentinel substitution (ADR 0015) | Unchanged. Strength + placement ride along inside the prompt envelope, not the prompt itself. |

## Design (concrete)

### server.js — new constants + helpers (append to existing palette block)

```js
// ADR 0016 — palette strength levels.
const PALETTE_STRENGTH_LEVELS = ['subtle', 'moderate', 'strong', 'strict'];
const DEFAULT_PALETTE_STRENGTH = 'moderate';

const validatePaletteStrength = (value) => {
  if (typeof value !== 'string') return 'strength must be a string';
  if (!PALETTE_STRENGTH_LEVELS.includes(value)) {
    return `strength must be one of: ${PALETTE_STRENGTH_LEVELS.join(', ')}`;
  }
  return null;
};
```

### server.js — `readPalettes` legacy synthesis (extend existing block)

```js
if (typeof p.strength !== 'string' || !PALETTE_STRENGTH_LEVELS.includes(p.strength)) {
  p.strength = DEFAULT_PALETTE_STRENGTH;
}
for (const c of (p.colors || [])) {
  if (typeof c.placement !== 'string') c.placement = '';
  if (c.placement.length > 60) c.placement = c.placement.slice(0, 60);
}
```

### server.js — `buildColorBudgetBlock` extension

Add a `strength` clause to each line:

```text
- Crimson #cc3344 — ~40% — foreground subject [STRENGTH: strong]
- Burnt sienna #884422 — ~30% — lower background [STRENGTH: moderate]
- Bone white #f4e9d8 — ~20% — upper sky (ACCENT — mention at most 2 times, placement: upper-left quadrant) [STRENGTH: strict]
```

The opening "COLOR BUDGET" header gains a one-line preamble:

```text
STRENGTH: strong — Every named color must appear at least once; no off-palette introductions.
```

This preamble uses the four-level contract table from §1.

### server.js — `measureColorDistribution` extension

```js
const strict_pass = violations.length === 0;
distribution_metrics.strict_pass = strict_pass;
distribution_metrics.strict_violations = violations.slice(0, 10);
```

`violations` is built only when `palette.strength === 'strict'`. The
exact per-color expectation:

```js
const expected_min = color.accent ? 1 : Math.max(1, Math.round(color.weight / 2));
const expected_max = color.accent ? palette.accent_max_mentions : Infinity;
```

### server.js — `DEFAULT_ZIMAGE_STAGE2_PROMPT` rules 11 + 12

Appended to the existing `RULES (priority order):` block, just
before `Start your reply with these section headers exactly:`.

### server.js — `/api/palettes/:id/distribution` propagation

When the latest telemetry entry has `strict_pass` defined, return it
in the response. No new fields on disk.

### server.js — `/api/generate-prompt` propagation

After `measureColorDistribution`, if `appliedPalette.strength ===
'strict'`, add `strict_pass` + `strict_violations` to the response
envelope.

### Frontend — index.html

Two new controls in the existing edit palette modal:

- `<select id="edit-palette-strength">` (4 options)
- `<input type="text" maxlength="60" data-field="placement">` per
  color row (visible only when accent is checked)

### Frontend — styles.css

`.edit-palette-strength`, `.edit-color-placement`, `.result-strict-warn`
with a11y (`:focus-visible`, `aria-live`).

### Frontend — app.js

- `openEditPaletteModal` populates strength + placement.
- `applyPaletteEdit` (frontend) reads + writes the new fields.
- `displayResult` shows the warning chip on `strict_pass === false`.

### Tests (run-all.js)

~15 new tests:

| # | Test |
|---|---|
| 1 | `validatePaletteStrength` accepts the four valid values |
| 2 | `validatePaletteStrength` rejects non-string, unknown value, null, undefined |
| 3 | `palette.strength` round-trips through POST + GET |
| 4 | `PUT /api/palettes/:id` with `strength: "strict"` succeeds |
| 5 | `POST /api/palettes` with invalid `strength` returns 400 |
| 6 | `readPalettes` synthesizes `strength: "moderate"` for legacy palettes |
| 7 | `color.placement` round-trips through POST + GET |
| 8 | `buildColorBudgetBlock` emits `[STRENGTH: <level>]` for each line |
| 9 | `buildColorBudgetBlock` emits `placement: <region>` when set |
| 10 | `buildColorBudgetBlock` omits `placement:` when empty |
| 11 | `measureColorDistribution` returns `strict_pass: true` for strict palette when counts match |
| 12 | `measureColorDistribution` returns `strict_pass: false` for strict palette when counts mismatch |
| 13 | `measureColorDistribution` does NOT add `strict_pass` for non-strict palettes |
| 14 | `DEFAULT_ZIMAGE_STAGE2_PROMPT` includes rules 11 + 12 |
| 15 | `POST /api/generate-prompt` with strict palette includes `strict_pass` in response |
| 16 | Frontend HTML has the strength select + placement input markup |
| 17 | Frontend JS wires the new controls to the edit buffer + PUT |

## Files that change

| File | Change |
|---|---|
| `docs/adr/0016-zimage-strength-and-placement.md` | This ADR. |
| `docs/zimage-turbo-prompting.md` | Update §5.2 status from "To add" to "Implemented". |
| `server.js` | New constants + helpers; `readPalettes` synthesis; `buildColorBudgetBlock` extension; `measureColorDistribution` extension; `DEFAULT_ZIMAGE_STAGE2_PROMPT` rules 11 + 12; `/api/palettes/:id/distribution` propagation; `/api/generate-prompt` envelope propagation; new module exports. |
| `src/index.html` | Two new controls in edit palette modal. |
| `src/styles.css` | Styles for the new controls + result warning chip. |
| `src/app.js` | Wire the new controls; surface `strict_pass` warning. |
| `tests/run-all.js` | ~17 new tests. |

## Out of scope (locked)

- **Chat-layer integration of strength.** Refinement requests
  ignore palette strength; documented as a follow-up.
- **Bilingual text-in-image.** Separate capability; not part of
  strength/placement scope.
- **Other presets adopting strength.** Only the two oil-painting
  presets route through the Z-Image sentinel today; the others
  have their own Stage 2 contracts and don't need it.
- **Output validation beyond distribution.** Colorimetric distance
  from hex / ΔE would require a downstream image render step.
- **Collapsible Section B in result panel.** Already deferred from
  ADR 0015 §4.
- **User-entered Stage 2 overrides.** They bypass the canonical
  prompt and therefore the strength/placement interpretation.
  Documented in §"Consequences".

## Verification

- `node scripts/session-init.js` reports **10/10 passed** (no
  schema drift, no agent-doc drift after ADR 0016 is filed).
- `node tests/run-all.js` reports **0 failed**, including the ~17
  new tests.
- Manual smoke:
  1. Create a palette with `strength: "strict"`, one accent with
     `placement: "upper-left quadrant"`.
  2. Apply to `preset_alla_prima_oil` (Z-Image sentinel preset).
  3. Upload an image, generate a prompt.
  4. Confirm Section A names the accent in the upper-left
     quadrant at least once.
  5. Confirm `distribution_metrics.strict_pass` appears in the
     result panel.

## Why these decisions

- **Append rules 11 + 12 instead of rewriting the prompt.**
  Preserves all existing tests; minimizes blast radius; the new
  rules are additive and don't interact with the existing
  format-order chain.
- **Strength as a string enum, not a numeric.** The four levels
  map cleanly to LLM instruction language; numeric values would
  require piecewise mapping at the prompt layer anyway.
- **Default `moderate`.** Mirrors the previous unquantified
  behavior ("honor the palette closely; deviations allowed only
  for natural shadows and skin tones") so existing users see no
  change.
- **Strict palette validates post-hoc.** A user picking `strict`
  has explicitly opted into a hard contract; silently measuring
  without surfacing a failure would defeat the point.
- **Placement is per-color, not per-palette.** Different accents
  may need to land in different regions. Palette-level placement
  would force one region for all accents, which is rarely what
  brand work wants.
- **Placement visible only when `accent === true`.** Non-accent
  colors don't override regions, so placement is meaningless for
  them. Hiding the input reduces noise.
- **`strict_pass` on `distribution_metrics`, not a separate
  endpoint.** Keeps the wire format additive; the existing
  dashboard panel (ADR 0014 Phase 4) reads the same field.
- **No chat-layer changes in this ADR.** Chat refinements are
  semantically distinct (edit the working prompt, not re-run the
  palette). A future ADR can address how a chat-applied revision
  interacts with `strict_pass`.

## Consequences

- **Existing palettes** get `strength: "moderate"` + `placement: ""`
  on next read. No migration needed; the synthesis is silent.
- **Existing distribution telemetry** continues to be valid; new
  runs append `strict_pass` only when the palette is strict.
- **User-entered Stage 2 overrides** (ADR 0007) bypass the
  canonical prompt entirely. They never interpret strength or
  placement; this is documented in the Stage 2 modal hint.
- **Test count grows by ~17.** Total becomes ~244 (was ~227).
- **The canonical prompt grows by ~400 chars.** Now ~5 900 chars
  total; well under any LLM context-window limit.
