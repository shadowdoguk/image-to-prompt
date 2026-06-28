# ADR 0015 — Z-Image Turbo final prompt logic (Section A / Section B)

## Status

Accepted. Implemented 2026-06-28.

## Type

Prompt contract. Touches Stage 2 system-prompt ownership only. No wire-
format changes, no new endpoints, no new persistence.

## Context

The "Gestural alla prima oil painting" preset family drives the bulk of
this project's outputs. Its Stage 2 system prompt (`stage2_system_prompt`
on `data/presets.json` for `preset_alla_prima_oil` and the imported
`preset_968c0ccdf6fc6151`) was authored against an earlier, looser
contract: a single prose paragraph of 100–180 words, lead-with-subject,
hex codes inline, painterly vocabulary at the end. That format has
worked but produced inconsistent results for two recurring use cases:

1. **Color priority is fuzzy.** The LLM is told to "place colors in
   spatial context" and "list each color with both its hex code and
   color name", but with no priority language it tends to either spread
   every color evenly across the description or pick a dominant and
   drop the rest. Palette weights (ADR 0014) only get as far as the
   LLM's interpretation, and the gap between "user said 40% / 15% /
   45%" and "what the LLM actually wrote" is wide enough that the
   dashboard's measurement bars look like a different palette.
2. **Accent overrides don't read as overrides.** When the user
   explicitly substitutes an original color with an accent (ADR 0014's
   `accent` boolean), the LLM treats the accent as a secondary tint
   rather than as a full regional replacement. The accent cap
   (`accent_max_mentions`) helps but only constrains count, not tone.

A new user request formalized the contract:

- Color priority must be **explicit, ranked, and bound to a region**.
  Each color → region → priority triple should be readable on its own.
- Accent overrides must **replace** the original region's color
  entirely, not overlay it. The accent must read as the natural
  dominant color of its region in the final prompt.
- The default style is **heavy impasto / gestural alla prima**, with
  a verbatim style anchor. Other styles (photographic, flat vector)
  are opt-in overrides.
- Gestural energy streaks are a first-class feature: when an accent
  is in a gestural region, the LLM describes it as "radiating outward
  from the focal point" and treats the accent as the most energetically
  loaded paint in the image.
- The final prompt is split into two sections:

  - **Section A**: prose (80–200 words) — what you'd tell a painter.
  - **Section B**: structured metadata — color_map, priority_order,
    accent_overrides, accent_regions, gestural_elements,
    style_confidence, composition_note, word_count_section_a.

The format-order is strict and the rules are in priority order:

1. Lead with subject + spatial position.
2. Bind every color to a region.
3. Accent colors fully override the original region.
4. User-unspecified style → heavy impasto / alla prima / gestural
   language verbatim.
5. Gestural energy streaks radiate outward from the focal point when
   an accent is in a gestural region.
6. Mention thick / thin contrast when the source has significant
   texture.
7. "No X" constraints go at the end of Section A.
8. No bullets / lists / YAML in Section A.
9. Section A = 80–200 words. Count and report in Section B.
10. One style declaration.

## Feasibility

| Constraint | Decision |
|---|---|
| `MAX_PROMPT_LENGTH = 5000` cap on `preset.stage2_system_prompt` (server.js:63) | The full new prompt is ~5500 characters; the cap can't be relaxed without weakening the validator. **Solution:** put the full prompt in a code constant (`DEFAULT_ZIMAGE_STAGE2_PROMPT`) and have the preset's `stage2_system_prompt` reference it via a sentinel string. The server substitutes at Stage 2 time. |
| `MAX_STAGE2_PROMPT_LENGTH = 10000` cap on user-entered overrides | Not affected — overrides are still bounded by this larger cap. The sentinel substitution happens after override resolution, so user overrides always win. |
| User-editable per-preset Stage 2 prompt (ADR 0007) | Preserved. The sentinel substitution only kicks in when the resolved prompt (override if present, else built-in) equals the sentinel. A user-entered override of `DEFAULT_ZIMAGE_STAGE2_PROMPT` is treated as an explicit choice to opt out of the canonical contract. |
| Existing call sites (`/api/generate-prompt`, `/api/stage2-prompt` GET/PUT/DELETE) | Unchanged. `getEffectiveStage2Prompt` does the sentinel substitution transparently before returning the string the route uses. |
| Existing tests (`tests/run-all.js`) | Need a small update: the test that asserts `getEffectiveStage2Prompt(preset) === preset.stage2_system_prompt` for the first preset must now use a preset whose `stage2_system_prompt` is NOT the sentinel (e.g. `preset_photorealistic` or `preset_sd_danbooru`), OR must be parameterized to skip the equality assertion when the preset uses the sentinel. |

## Design

### 1. Two new code constants in `server.js`

```js
// ADR 0015 — sentinel value used by presets whose Stage 2 system prompt
// is the canonical Z-Image Turbo final-prompt contract. ...
const ZIMAGE_STAGE2_SENTINEL = 'DEFAULT_ZIMAGE_STAGE2_PROMPT';

// ADR 0015 — the canonical Stage 2 system prompt used by the
// "Gestural alla prima oil painting" preset family. ...
const DEFAULT_ZIMAGE_STAGE2_PROMPT = `<full ~5500 char prompt>`;
```

Both are exported (alongside `DEFAULT_SUBJECT_PROMPT` and
`DEFAULT_CAMERA_ANGLE_PROMPT`) so tests can reference them.

### 2. Sentinel substitution in `getEffectiveStage2Prompt`

```js
const getEffectiveStage2Prompt = (preset) => {
  if (!preset || typeof preset !== 'object') return '';
  const override = getStage2Override(preset.id);
  const builtIn = preset.stage2_system_prompt || '';
  const resolved = override != null ? override : builtIn;
  if (resolved === ZIMAGE_STAGE2_SENTINEL) return DEFAULT_ZIMAGE_STAGE2_PROMPT;
  return resolved;
};
```

The substitution happens **after** override resolution so:
- The built-in sentinel resolves to the canonical prompt.
- A user-entered override resolves to the override verbatim (a
  user who pastes `DEFAULT_ZIMAGE_STAGE2_PROMPT` into the Stage 2
  override modal gets exactly that string back, not the substituted
  one — they're free to opt out by entering the literal sentinel).
- A user-entered override that's any OTHER string gets used as-is.

### 3. Preset updates

The two oil-painting presets in `data/presets.json` flip their
`stage2_system_prompt` from the old ~3700-char inline string to the
28-char sentinel:

```json
"stage2_system_prompt": "DEFAULT_ZIMAGE_STAGE2_PROMPT"
```

Both presets stay under the 5000-char `MAX_PROMPT_LENGTH` cap and the
existing schema validator passes unchanged.

The `data/stage2_overrides.json` entry for `preset_968c0ccdf6fc6151`
(a longer, more detailed variant authored manually) is **removed**.
The canonical constant now supersedes it; if the user wants the older
prose, they can paste it back into the Stage 2 override modal.

### 4. No frontend changes

The frontend renders `data.prompt` as a text block in
`#result-prompt-text` (`src/app.js:1230`). The two-section shape
(Section A prose + Section B metadata) is readable as plain text and
needs no markup-level handling. Users who want to copy just Section A
can do so by eye; the chat-refinement path (ADR 0011, ADR 0012) treats
the full string as the working prompt.

### 5. Frontmatter touchpoints

The `resultMetaInfo` line already prints preset + model. No change
needed there; the prompt envelope is unchanged on the wire.

## The new prompt contract

(Verbatim, ~5500 chars. Authoritative copy lives in
`DEFAULT_ZIMAGE_STAGE2_PROMPT` in `server.js`.)

```
Your job: take a source image's extracted data and produce a precise,
compositionally-accurate text prompt for the Z-Image Turbo generator.
Enforce four contracts:

1. COLOR PRIORITY -- dominant, secondary, tertiary hues applied to specific regions.
2. ACCENT COLOR OVERRIDES -- user accent colors REPLACE corresponding original hues.
3. STYLE ENFORCEMENT -- HEAVY IMPASTO / GESTURAL PAINTING (unless user overrides with photography or flat vector).
4. SPATIAL COMPOSITION -- where each color appears in the frame.

STYLE ANCHOR (verbatim default for all "artistic / painterly / expressive / abstract" requests):
"Heavy impasto with vigorous scraped, dragged, and smeared paint.
 Palette-knife ridges and bold directional strokes follow the form;
 gestural streaks of energy radiate outward from the figure, fusing
 with thin, scraped background washes. Alla prima freshness throughout,
 with strong variation between thickly loaded areas and bare-canvas thin spots."

Sub-components (use AT LEAST THREE where relevant):
- THICK PAINT, SCRAPED/DRAGGED, GESTURAL ENERGY, THICK/THIN CONTRAST,
  ALLA PRIMA, FORM-FOLLOWING

SOURCE DATA: dominant palette, named hues, priority overrides,
accent colors + application regions, subject description, user style.

SECTION A: single paragraph (or 2-3 if complex), 80-200 words, pure
prose. FORMAT ORDER (strict):

1. SUBJECT + COMPOSITION + SPATIAL POSITION -- lead with subject
   + spatial position.
2. COLOR BOUND TO REGION, IN PRIORITY ORDER -- dominant first,
   secondary next, accents last. Accent overrides are the primary
   tone for their region.
3. PAINT HANDLING -- include at least 3 of the impasto phrases.
4. LIGHTING AND ATMOSPHERE -- painterly terms, link light to color.
5. STYLE DECLARATION -- user-specified OR the verbatim
   "heavy impasto gestural painting, alla prima oil technique,
   bold palette-knife and brushwork".
6. COMPOSITIONAL CONSTRAINTS -- no text, no watermark, no logos,
   no thin photographic detail.

SECTION B: PROMPT METADATA
- color_map, priority_order, accent_overrides, accent_regions,
  gestural_elements, style_confidence, composition_note,
  word_count_section_a.

RULES (priority order):
1. lead with subject + spatial position
2. bind every color to a region
3. accent colors fully override the original region
4. user-unspecified style -> impasto/alla prima/gestural verbatim
5. gestural energy streaks radiate outward from the focal point
6. mention thick/thin contrast when the source has significant texture
7. "no X" constraints go at the end of Section A
8. no bullets/lists/YAML in Section A
9. Section A = 80-200 words (count and report)
10. one style declaration

Reply format: start with these section headers exactly:
== SECTION A ==
[prose here]
== SECTION B ==
[metadata here]
```

## Files that change

| File | Change |
|---|---|
| `server.js` | New constants `ZIMAGE_STAGE2_SENTINEL` and `DEFAULT_ZIMAGE_STAGE2_PROMPT`. Modified `getEffectiveStage2Prompt` does sentinel substitution. Two new module exports. |
| `data/presets.json` | `preset_alla_prima_oil` and `preset_968c0ccdf6fc6151` flip their `stage2_system_prompt` to the 28-char sentinel. |
| `data/stage2_overrides.json` | Remove the entry for `preset_968c0ccdf6fc6151` (now superseded by the canonical constant). |
| `tests/run-all.js` | The "falls back to preset.stage2_system_prompt when no override" test (`run-all.js:2382-2389`) now picks a preset whose built-in prompt is NOT the sentinel (`preset_photorealistic` or `preset_sd_danbooru`). New test: `getEffectiveStage2Prompt` substitutes the sentinel when the preset's built-in prompt equals `ZIMAGE_STAGE2_SENTINEL`. |
| `CONTEXT.md` | Update Stage 2 description (Pipeline stages → Stage 2) to mention the canonical Z-Image Turbo contract and the sentinel substitution. |
| `docs/adr/0015-zimage-final-prompt-logic.md` | This ADR. |

## Out of scope (locked)

- **Front-end prompt rendering.** The two-section format is readable as
  plain text. Future enhancement: collapsible Section B in the result
  panel, copy-Section-A-only button. Not in this ADR.
- **Post-Stage-2 distribution enforcement.** ADR 0014's
  `measureColorDistribution` continues to measure, not enforce. The
  richer Section A contract should narrow the gap; a future ADR can
  re-evaluate enforcement if the dashboard still shows large
  target/measured deltas.
- **Output parsing.** No `parseStage2Output` helper for Section B in
  this ADR. The chat-refinement path treats the whole string as the
  working prompt (ADR 0012 anchor-preservation works unchanged).
- **Other presets.** `preset_photorealistic` and `preset_sd_danbooru`
  keep their existing Stage 2 prompts. They are not gestural-painting
  presets; applying the impasto anchor to them would be a separate
  decision.

## Verification

- `node scripts/session-init.js` reports **10/10 passed** (no schema
  drift, no agent-doc drift).
- `node tests/run-all.js` reports **0 failed**, including the new
  sentinel-substitution test.
- Manual smoke: pick an oil-painting preset, run Stage 1, hit
  "Generate prompt", confirm the response has both `== SECTION A ==`
  and `== SECTION B ==` headers and that Section A starts with the
  subject + spatial position.

## Why these decisions

- **Sentinel + code constant, not a 5500-char preset value.** The
  `MAX_PROMPT_LENGTH = 5000` validator exists for a reason — long
  preset values are hard to diff, audit, and reason about. Splitting
  the prompt into a small marker (`DEFAULT_ZIMAGE_STAGE2_PROMPT`) in
  JSON and the full text in code keeps the on-disk shape clean and
  makes the canonical prompt a single source of truth that any preset
  in the oil-painting family can opt into by flipping one line.
- **Substitution AFTER override resolution.** Keeps ADR 0007's
  user-editable Stage 2 prompt working unchanged. A user who pastes
  the literal sentinel into the override modal gets exactly that
  string back — they can opt out of the canonical contract without
  server cooperation. (The cleanest way to keep the door open for
  per-preset contract variants without forcing the user to use the
  UI.)
- **Two sections, not one big metadata table.** The Section A prose is
  the actual prompt the downstream image generator will consume;
  Section B is the audit metadata. Keeping them as two clearly
  labelled blocks (with literal `== SECTION A ==` /
  `== SECTION B ==` headers) makes both copy/paste and post-hoc review
  trivial. Future enhancement: a frontend toggle to collapse Section
  B.
- **Style anchor quoted verbatim, not paraphrased.** The user's brief
  includes a specific multi-sentence style definition that names
  specific sub-components (THICK PAINT, SCRAPED/DRAGGED, etc.). The
  contract instructs the LLM to translate all "artistic / painterly /
  expressive / abstract" requests into this vocabulary. Paraphrasing
  would weaken the constraint and reintroduce the inconsistency that
  motivated the ADR.
- **No bullet points in Section A.** The user's brief explicitly bans
  bullets, lists, and YAML in Section A. Section B IS structured —
  that's the audit trail. Keeping Section A as pure prose forces the
  LLM to write something a painter could follow from a single read.
- **Rule 9: "Section A = 80–200 words. Count and report in Section B."
  is the load-bearing rule.** Everything else is style; this one is
  measurable. `word_count_section_a` is the single integer the LLM
  MUST put in Section B, and it's the easiest thing to spot-check on
  any sample output.