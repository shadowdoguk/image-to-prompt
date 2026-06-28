# Z-Image Turbo — Prompt Engineering & Color Palette Integration

A practical guide for crafting prompts that the **Z-Image Turbo** model
interprets reliably, and for integrating our custom palette system so
generated images honor brand colors, strength modifiers, and accent
placement.

> **Scope:** This document is the reference for the
> `DEFAULT_ZIMAGE_STAGE2_PROMPT` constant in `server.js` (ADR 0015) and
> the `buildColorBudgetBlock` / `measureColorDistribution` helpers
> (ADR 0014). It is a how-to for the prompt engineer; the decision
> record lives in ADR 0015; the data shapes live in ADR 0014.

---

## Part 1 — Z-Image Turbo: model overview

### 1.1 What it is

- **Developer:** Alibaba Tongyi-MAI (Z-Image project).
- **Parameters:** 6 B (single-stream diffusion Transformer / S3-DiT).
- **Sampling:** ~8 diffusion steps (NFEs) for strong quality.
- **Text encoder:** Qwen3-4B (chat-template friendly; bilingual EN/ZH).
- **VAE:** Flux 1 VAE (`ae.safetensors`).
- **Sampling params:** `guidance_scale = 0.0` (Turbo models are trained
  without classifier-free guidance; non-zero CFG degrades quality).
- **License:** Apache 2.0.

### 1.2 What it does well

- **Photorealism at low step counts.** Skin texture, fabric weave,
  hair, and material micro-detail are the model's strongest suites.
- **Painterly rendering under gestural prompts.** When the prompt
  names "impasto", "palette-knife ridges", "gestural streaks", the
  model reliably maps them onto the painterly register.
- **Bilingual text rendering** in-image (English + Chinese). Useful
  for posters, title cards, signage. Our tool does not yet target
  text-in-image directly; flagged here as a future capability.
- **Spatial composition following.** Given a layout hint
  ("lower-third foreground", "upper-left quadrant"), the model
  consistently places the named subject in the requested region.

### 1.3 Known weak spots (write the prompt around them)

- **Long bullet lists dilute focus.** The model attends most to the
  first 80–200 words of prose. Lists of 30+ tags degrade layout
  coherence and color fidelity.
- **"Wholesale rewrite" mid-conversation.** In a multi-turn chat, the
  model tends to regenerate instead of edit. The chat layer in our
  tool uses the anchor-preservation validator (ADR 0012) to catch
  this.
- **Tiny color accents.** A color specified as "0.5% of the image" is
  effectively invisible; we cap accent minimum at the existing
  `accent_max_mentions` floor of 1, with the model's attention
  span as the practical lower bound.
- **Exact hex codes.** The model approximates hex values. A "pure
  #ff0000" will land in the red family but rarely match the exact
  chromaticity. We name the hex AND the human color name
  ("crimson #cc3344") so the model can recover.

---

## Part 2 — Prompt structure best practices

### 2.1 Two-section contract

Our tool requires every final Stage 2 output to ship as two clearly
labelled sections:

| Section | Purpose | Length | Format |
|---|---|---|---|
| **Section A** | The image-generation prompt itself. | 80–200 words | Prose. No bullets, no lists, no YAML, no markup. |
| **Section B** | Audit metadata. | Unbounded | Structured keys: `color_map`, `priority_order`, `accent_overrides`, `accent_regions`, `gestural_elements`, `style_confidence`, `composition_note`, `word_count_section_a`. |

Why two sections: Section A is what downstream tools will copy into
the image generator. Section B is what a human reviewer (or our
`measureColorDistribution` helper) can spot-check against the
palette. Keeping them as labelled blocks makes copy/paste and audit
both trivial.

### 2.2 Format order (strict)

The canonical prompt locks 10 rules in priority order. They are
re-stated here so prompt authors can write Section A by hand and get
the same output as the LLM-driven path:

1. **Subject + composition + spatial position** lead the prompt.
   Never open with style, color, or technique. Always name the
   subject and WHERE in the frame.
2. **Color bound to region, in priority order.** Dominant first,
   secondary next, accents last. Accent overrides are the **primary
   tone** for their region (not a tint, not an overlay).
3. **Paint handling (impasto description).** When the source has any
   painterly texture, translate it into at least 3 of the named
   sub-components (see §2.4).
4. **Lighting and atmosphere.** Painterly terms. Link light to color
   ("warm light catches the ridges of #cc8844 ochre").
5. **Style declaration.** User-specified OR the verbatim style anchor
   (see §2.4). Exactly one.
6. **Compositional constraints.** "No text, no watermark, no logos."
   If gestural: "no thin photographic detail — this is a painted
   work." If minimal background: "background reduced to thin
   scraped washes, no busy detail."
7. Accent colors fully override the original region.
8. User-unspecified style → impasto / alla prima / gestural verbatim.
9. Gestural energy streaks radiate outward from the focal point when
   an accent is in a gestural region.
10. Section A = 80–200 words (count and report in Section B).

### 2.3 Vocabulary anchor (use verbatim)

The painterly default style anchor — quoted from the canonical
prompt so any author writing Section A manually can reproduce the
contract:

> "Heavy impasto with vigorous scraped, dragged, and smeared paint.
> Palette-knife ridges and bold directional strokes follow the
> form; gestural streaks of energy radiate outward from the figure,
> fusing with thin, scraped background washes. Alla prima freshness
> throughout, with strong variation between thickly loaded areas and
> bare-canvas thin spots."

Use this as the style declaration whenever the user request is
"artistic / painterly / expressive / abstract". For photographic or
flat-vector requests, replace it with the user-specified style
verbatim.

### 2.4 Sub-component vocabulary (≥3 where relevant)

- **THICK PAINT:** "impasto", "thickly loaded", "palette-knife
  ridges", "bold raised strokes".
- **SCRAPED / DRAGGED:** "scraped, dragged, and smeared paint",
  "drag marks visible in the medium".
- **GESTURAL ENERGY:** "gestural strokes radiate outward",
  "directional strokes follow the form".
- **THICK / THIN CONTRAST:** "thick areas contrast with thin
  bare-canvas washes", "loaded strokes over thin washes".
- **ALLA PRIMA:** "alla prima freshness", "wet-in-wet",
  "no overpainting", "direct brushwork".
- **FORM-FOLLOWING:** "strokes follow the form of the subject",
  "paint application describes the underlying shape".

### 2.5 Hard syntax rules

- **Single style declaration.** Multiple styles ("oil and watercolor
  hybrid") confuse the model. Pick one and stick to it.
- **No markup in Section A.** Markdown, bullets, YAML, and HTML all
  end up rendered as visible text in the image (or as ignored noise).
  Prose only.
- **No "and" lists of subjects.** "A dog and a cat and a horse"
  fragments spatial composition. One primary subject per prompt;
  mention others as background context only.
- **Numbers spelled out.** "Three birds" not "3 birds". The model
  treats digits as text glyphs that bleed into the image.
- **Hex codes appear with their color name.** "Crimson #cc3344",
  not "#cc3344" alone. The model recovers the named color when the
  exact hex is ambiguous.
- **"No X" constraints at the end.** "no text, no watermark, no
  logos" must be the last phrases of Section A. The model treats
  trailing negative constraints as global exclusions.

---

## Part 3 — Color palette integration

### 3.1 What we already do (ADR 0014)

The current pipeline injects a `color_budget` block into the Stage 2
user envelope when a weighted palette is supplied. The block is built
by `buildColorBudgetBlock` and looks like:

```
COLOR BUDGET (use these colors as named anchors in your prompt):
- Crimson #cc3344 — ~40% — foreground subject (ACCENT — mention at most 2 times)
- Burnt sienna #884422 — ~30% — lower background
- Bone white #f4e9d8 — ~20% — upper sky
- Deep umber #2a1810 — ~10% — shadow reserves
```

`measureColorDistribution` then counts how many times each color
name + hex appears in the final prompt, producing a dashboard of
target vs measured.

### 3.2 Strength modifiers (NEW)

The user can now choose a **palette strength level** per palette.
Strength controls how aggressively the LLM is told to honor the
palette:

| Level | Semantic | LLM instruction language | Expected mention ratio |
|---|---|---|---|
| `subtle` | Color hints only. LLM free to introduce other tones. | "Use these as gentle reference colors; feel free to introduce complementary tones that fit the subject." | 40–70% |
| `moderate` | (Default.) Honor the palette; minor deviations allowed. | "Honor the palette closely; deviations allowed only for natural shadows and skin tones." | 70–90% |
| `strong` | Strict adherence. Each color appears at least once. | "Every named color must appear in the prompt at least once. No off-palette introductions." | 90–100% |
| `strict` | Locked. The output is validated post-hoc. | "The final prompt must mention each color the documented number of times (±0). No substitutions." | 100% (validated) |

**Storage:** `palette.strength` (string, one of the four values,
default `"moderate"`).
**Validation:** `validatePaletteStrength` enforces membership and
returns a 400 message on rejection.
**Backward compatibility:** Legacy palettes without `strength` are
synthesized to `"moderate"` on read (mirroring ADR 0014's
`weight`/`accent` synthesis).

### 3.3 Accent color placement (NEW)

Accent colors now carry an optional `placement` field that names the
region where the accent must appear. The placement is appended to
the color budget block:

```
- Crimson #cc3344 — ~25% — upper-left quadrant (ACCENT — mention at most 2 times, placement: upper-left quadrant)
```

The canonical Stage 2 prompt is updated to interpret
`placement: <region>` as a hard region-binding directive. The
format-order rule is strengthened from "accent overrides are the
primary tone for their region" to:

> **Accent overrides fully replace the original region's color, AND
> must appear within the documented placement region. If the source
> image's accent region contradicts the user-supplied placement,
> user placement wins.**

This gives the prompt author explicit control over where accents
land, while still allowing the LLM to interpret the source image's
composition when no placement is specified.

**Storage:** `color.placement` (string, ≤60 chars, optional).
**Validation:** `validatePaletteColorsFlexible` accepts `placement`
when supplied.
**Default:** empty string (no placement; LLM infers from source).

### 3.4 Strength + accent interaction

- `subtle + accent=true`: the accent is treated as a *tonal* accent.
  The prompt is told "use this as a secondary tint in the named
  region, not a full replacement".
- `strict + accent=true`: the accent fully overrides the original
  region AND must appear exactly `accent_max_mentions` times.
- `moderate + accent=true`: the existing ADR 0014 behavior is
  unchanged.
- `strong + accent=false`: the color is a hard requirement but
  doesn't override region semantics.

---

## Part 4 — End-to-end flow with strength + placement

1. User creates or edits a palette (Step 1 or Manager modal).
2. User picks a strength level (subtle / moderate / strong / strict).
3. User optionally sets `placement` per accent color.
4. User uploads an image; preset optionally strips `colors` from
   Stage 1 schema (existing behavior).
5. Stage 1 returns analysis (with `colors` from LLM OR overridden
   by palette).
6. User edits analysis; "Apply palette" re-injects palette colors
   (in-place mutation of `state.currentAnalysis.colors`).
7. User clicks "Generate prompt"; `/api/generate-prompt` is called.
8. `buildStage2Envelope` builds the user envelope:
   - Always: `{analysis, directives}`.
   - With weighted palette: `{analysis, directives, color_budget}`
     where `color_budget` includes strength + placement metadata.
9. `callMiniMaxStage2` runs the LLM with the canonical Stage 2
   prompt (which now interprets strength + placement directives).
10. `measureColorDistribution` measures output; if `strength ===
    "strict"`, it asserts per-color mention count and returns a
    `distribution_metrics.strict_pass: true|false` flag in the
    response envelope.
11. The frontend surfaces the result; on `strict_pass: false`, the
    result panel shows a non-blocking warning and offers "Regenerate
    with stronger directive".

---

## Part 5 — Implementation status & roadmap

### 5.1 Implemented today (locked)

- ADR 0001, 0003 — Stage 1 vision analysis with per-field contracts.
- ADR 0006, 0013 — palette CRUD + editing.
- ADR 0014 — weighted distribution + telemetry + dashboard.
- ADR 0015 — canonical Z-Image Stage 2 prompt with two sections.
- ADR 0016 — palette strength + accent placement + `strict_pass`
  validation. The canonical Stage 2 prompt now interprets
  `palette.strength` (subtle / moderate / strong / strict) and
  `color.placement` (per-accent region binding). `buildColorBudgetBlock`
  emits a strength preamble + per-line `[STRENGTH: <level>]` tag and a
  `placement: <region>` tag on accents. `measureColorDistribution`
  appends `strict_pass` + `strict_violations` to the response envelope
  when the palette is `strict`. The result panel surfaces a non-
  blocking warning chip on `strict_pass === false`.

### 5.2 To add (this work)

*Resolved.* All ten items below were implemented in commit
`f2c76d2` (ADR 0016). For the design rationale see
`docs/adr/0016-zimage-strength-and-placement.md`; for the contract see
§3.2–§3.4 above; for tests see `tests/run-all.js` lines ~5698–6140
(ADR 0016 block).

1. `palette.strength` field with four-level enum (default
   `moderate`). Validation + legacy synthesis. ✅
2. `color.placement` field (optional, ≤60 chars). Validation. ✅
3. `buildColorBudgetBlock` extended to emit strength language and
   placement tags. ✅
4. `measureColorDistribution` extended with `strict_pass` flag when
   `strength === "strict"`. ✅
5. `DEFAULT_ZIMAGE_STAGE2_PROMPT` updated with two new rules:
   - Strength modifier interpretation (subtle / moderate / strong /
     strict). ✅
   - Accent placement region interpretation. ✅
6. Frontend: palette edit modal adds strength `<select>` (4 options). ✅
7. Frontend: palette edit modal adds per-color `placement` text
   input (visible only when `accent === true`). ✅
8. Frontend: result panel surfaces `strict_pass` warning. ✅
9. New tests in `tests/run-all.js` covering each change. ✅
   (`260 passed, 0 failed` as of the ADR 0016 commit.)
10. New ADR `0016-zimage-strength-and-placement.md` capturing the
    decision rationale and consequences. ✅

### 5.3 Out of scope (locked for follow-on)

- Other presets adopting the new fields. (Photorealistic and Danbooru
  presets don't use the Z-Image sentinel.)
- Frontend collapsible Section B in result panel (ADR 0015 §4).
- Bilingual text-in-image support (Qwen3-4B's strength — separate
  feature).
- Chat-layer integration of strength (refinement requests currently
  ignore palette strength; out of scope).
- Output validation beyond distribution (colorimetric distance from
  hex, perceptual ΔE — would need a downstream image render step).

---

## Part 6 — Verification plan

1. **Unit tests** (added to `tests/run-all.js`):
   - `validatePaletteStrength` accepts the four valid values, rejects
     everything else.
   - `palette.strength` round-trips through PUT/GET.
   - Legacy palettes without `strength` are synthesized to
     `"moderate"` on read (mirroring weight/accent synthesis tests).
   - `color.placement` round-trips through PUT/GET.
   - `buildColorBudgetBlock` emits strength language for each level.
   - `buildColorBudgetBlock` emits `placement: <region>` when set.
   - `measureColorDistribution` returns `strict_pass: true` when
     every color appears the documented number of times for `strict`.
   - `measureColorDistribution` returns `strict_pass: false` when
     any color is under-mention or over-mention for `strict`.
   - `DEFAULT_ZIMAGE_STAGE2_PROMPT` includes strength + placement
     interpretation rules.

2. **HTTP integration tests**:
   - POST `/api/palettes` with `strength: "strong"` succeeds and
     round-trips.
   - POST `/api/palettes` with invalid `strength` returns 400.
   - PUT `/api/palettes/:id` with `strength: "strict"` succeeds.
   - POST `/api/palettes/custom` accepts strength + placement.
   - POST `/api/generate-prompt` with a `strict` palette returns
     `distribution_metrics.strict_pass` in the response.

3. **Frontend wiring tests**:
   - Edit modal HTML has strength `<select>` with 4 options.
   - Edit modal HTML has per-color `placement` input visible when
     `accent === true`.
   - styles.css has rules for the new controls.
   - app.js reads + writes strength + placement through the edit
     buffer.

4. **Manual smoke**:
   - Load `preset_alla_prima_oil` (Z-Image sentinel preset).
   - Create a palette with `strength: "strict"`, one accent with
     `placement: "upper-left quadrant"`.
   - Upload an image, generate a prompt, confirm Section A names the
     accent color in the upper-left quadrant at least once.
   - Run `node tests/run-all.js`, confirm 0 failed.

---

## Part 7 — Quick-reference checklist

When writing a Z-Image Stage 2 prompt manually:

- [ ] Section A opens with subject + spatial position.
- [ ] Every named color is bound to a region.
- [ ] Accent overrides are the primary tone (not a tint).
- [ ] At least 3 paint-handling sub-components present (if painterly).
- [ ] Style declaration is exactly one (verbatim anchor if not
      user-specified).
- [ ] "No X" constraints are the last phrases.
- [ ] Hex codes appear with their color name.
- [ ] Strength modifier (if palette-bound) is honored.
- [ ] Accent placement regions (if specified) are honored.
- [ ] Section A word count is between 80 and 200 (counted and
      reported in Section B).
- [ ] Section B includes all required keys.

When designing a palette for Z-Image:

- [ ] Pick a `strength` level (default `moderate`).
- [ ] Set per-color `weight` (1–10) only if you want explicit
      distribution; defaults to equal split.
- [ ] Mark each `accent` color explicitly.
- [ ] Set palette-level `accent_max_mentions` (1–5; default 2).
- [ ] For each accent, optionally set `placement` (≤60 char
      region description).

---

*End of document. Implementation per §5.2; tests per §6.*
