# Z-Image Turbo — Prompt Engineering & Color Palette Integration

A practical guide for crafting prompts that the **Z-Image Turbo** model
interprets reliably, and for integrating our custom palette system so
generated images honor brand colors, strength modifiers, and accent
placement.

> **Scope:** This document is the reference for the
> `DEFAULT_ZIMAGE_STAGE2_PROMPT` constant in `server.js` (ADR 0019) and
> the `buildColorBudgetBlock` / `measureColorDistribution` helpers
> (ADRs 0014/0016/0017/0019). It is a how-to for the prompt engineer;
> the decision record lives in ADR 0019; the data shapes live in
> ADR 0014; ADR 0019 supersedes the gestural-school / two-section
> contract that ADR 0015 originally locked.

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

### 2.1 Single-prose contract

ADR 0019 rewrote `DEFAULT_ZIMAGE_STAGE2_PROMPT` from a two-section
output (Section A prose + Section B audit metadata) to a **single
flowing-prose paragraph** of 150-300 words, optionally 2-3 short
paragraphs if complex. The audit-trail shape that ADR 0015 locked
into Section B has been replaced by a `length_check` descriptor in
the response envelope (ADR 0019).

| Output shape | Length | Format |
|---|---|---|
| **Single prompt body** | 150–300 words target; hard ceiling 750 / 1024 tokens; minimum 80 | Prose. No bullets, no lists, no YAML, no markup, no labels, no `== SECTION A/B ==` markers. |

Why single-prose: the Stage 2 output is what gets pasted into
InvokeAI's main prompt field verbatim. Z-Image Turbo interprets
prose naturally (Qwen3-4B is a chat encoder); any markers, audit
blocks, or labels leak into the model's conditioning as
text-in-image glyphs.

### 2.2 Format order (strict)

The canonical prompt locks the response in six blocks woven into
prose (close paraphrase of `docs/Z-IMAGE-TURBO-AGENT-PROMPT-GUIDE.md`
§6). They are re-stated here so prompt authors can write a prompt by
hand and get the same output as the LLM-driven path:

1. **Subject** (40-80 words) — what the painting depicts. Specific
   subjects ("a 34-year-old woman in a long charcoal wool coat, in
   profile, looking left") — never generic ones ("a woman").
2. **Scene / Ground** (15-40 words) — the contextual field around
   the subject. Background colour and treatment. Floating, embedded,
   emerging, isolated.
3. **Composition** (20-40 words) — how the painting is framed. Shot
   type, placement, foreground/background, breathing room, plus the
   **canvas proportion** (square 1:1, portrait 4:5, landscape 16:9,
   panoramic 21:9). Default framing: "the painting fills the frame
   edge to edge, the painted surface itself the image, lit by even
   diffused gallery light."
4. **Lighting** (20-40 words) — the most important block. For this
   style the radiance MUST come from color contrast against the
   muted surround, never from a depicted lamp, sun, halo, backlight,
   or rim light. Required phrases: "achieved through color contrast,
   not depicted illumination" and "no depicted light source; the
   glow emerges from chroma and temperature juxtaposition alone".
5. **Style & Technique** (60-120 words) — the longest block. Oil
   painting on canvas (or oil on raw linen when weave should read).
   Palette-knife application. Pastel palette with named pigments
   (chalky pale greens, dusty putty, soft creams, weathered bone,
   muted lavender-grays) and **ONE highly saturated accent**
   (cadmium-coral, cobalt blue, vermillion, etc.) anchored to a
   specific subject element. Thick pasto / impasto ridges at the
   focal; the surrounding field rendered in thinly scraped, dragged,
   and smeared washes. Knife-edge marks visible, no brush hairs.
   Alla prima, paint still pliable.
6. **Constraints** (15-30 words, positive anchors at the end).
   "A real oil painting, not a photograph, not a 3D render. Natural
   paint sheen — matte in thick passages, slight gloss in scraped
   areas — no plastic gloss, no digital airbrush finish, no CGI
   look. Visible paint surface texture throughout."

### 2.3 Style anchor (use verbatim)

The pastel-focal default style anchor — quoted from the canonical
prompt so any author writing the prompt by hand can reproduce the
contract:

> Oil painting on canvas, alla prima, applied with a palette knife.
> The palette is pastel — chalky pale greens, dusty putty, soft
> creams, weathered bone, muted lavender-grays — with a single
> highly saturated accent of [SATURATED FOCAL COLOUR] in the
> [FOCAL ELEMENT]. Thick pasto ridges in the focal area, paint
> standing in relief with knife-edge marks. The surrounding field
> is rendered in thinly scraped, dragged, and smeared washes, the
> canvas weave visible in the thinner passages. Chromatic vibration
> from juxtaposed warm and cool near-complementaries. The radiance
> of the focal area emerges from color contrast alone, not from any
> depicted light source. Loose, gestural, economical mark-making,
> knife-edge marks visible, no brush hairs. The painting reads as
> recently completed, paint still pliable.

Use this as the style declaration whenever the user request is
"artistic / painterly / expressive / abstract" — gesturing at this
artist's pastel-focal tradition. For photographic or flat-vector
requests, the user-specified style wins.

**Do not** use the gestural-school anchor ("heavy impasto with
vigorous scraped, dragged, and smeared paint. … gestural streaks of
energy radiate outward from the figure … reminiscent of the late
paintings of de Kooning and the energetic scrape-and-drag technique
of Riopelle"). That anchor was ADR 0015's default and now sits in
the Z-Image chat-system prompt's STYLE-SCHOOL ANCHOR section under
"do not introduce" — it points at a different focal logic.

### 2.4 Sub-component vocabulary (≥3 where relevant)

- **THICK PAINT:** "impasto", "thickly loaded", "palette-knife
  ridges", "bold raised strokes".
- **SCRAPED / DRAGGED:** "scraped, dragged, and smeared paint",
  "drag marks visible in the medium" — applied to the field; the
  focal stays thick.
- **THICK / THIN CONTRAST:** "thick areas contrast with thin
  bare-canvas washes", "loaded strokes over thin washes".
- **ALLA PRIMA:** "alla prima freshness", "wet-in-wet",
  "no overpainting", "direct brushwork", "paint still pliable".
- **FOCAL ANCHOR:** "saturated [pigment] anchored to [subject
  element]" — names which element of the subject the focal glow
  clings to.
- **GLOW MECHANISM:** "achieved through color contrast, not
  depicted illumination"; "chroma and temperature juxtaposition".

### 2.5 Hard syntax rules

- **Single style declaration.** Multiple styles ("oil and watercolor
  hybrid") confuse the model. Pick one and stick to it.
- **No markup in the prompt.** Markdown, bullets, YAML, HTML, JSON
  all end up rendered as visible text in the image (or as ignored
  noise). Prose only.
- **No "and" lists of subjects.** "A dog and a cat and a horse"
  fragments spatial composition. One primary subject per prompt;
  mention others as background context only.
- **Numbers spelled out.** "Three birds" not "3 birds". The model
  treats digits as text glyphs that bleed into the image.
- **No hex codes in the prompt body.** The model approximates hex
  values; use named pigments only (chalky, dusty, pale, etc.).
  Hex codes live on the palette schema for storage and dashboard
  use; they don't appear in the LLM-emitted prose.
- **No "no X" constraints.** CFG=0 in Z-Image Turbo ignores
  negative-prompt language ("no text", "no watermark", "no logos").
  Use positive anchors instead — close the prompt with the §17.1
  natural-paint-sheen line and the "a real oil painting" line.

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

### 3.3 Accent color placement (FLUX/SDXL paths only)

Accent colors now carry an optional `placement` field that names the
region where the accent must appear. The placement is appended to the
color budget block:

```
- Crimson #cc3344 — ~25% — upper-left quadrant (ACCENT — mention at most 2 times, placement: upper-left quadrant)
```

**As of ADR 0019, `placement` is FLUX/SDXL-only.** Z-Image interprets
prose naturally and the §6 Block 3 composition rule already covers
spatial placement; an explicit `placement: <region>` binding would
conflict with the prompt's compositional logic.

For the FLUX/SDXL canonical Stage 2 prompt, `placement: <region>` is
a hard region-binding directive:

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

### 3.4 Strength + accent interaction (FLUX/SDXL paths only)

- `subtle + accent=true`: the accent is treated as a *tonal* accent.
  The prompt is told "use this as a secondary tint in the named
  region, not a full replacement".
- `strict + accent=true`: the accent fully overrides the original
  region AND must appear exactly `accent_max_mentions` times.
- `moderate + accent=true`: the existing ADR 0014 behavior is
  unchanged.
- `strong + accent=false`: the color is a hard requirement but
  doesn't override region semantics.

### 3.4a Z-Image preset-aware emission (ADR 0019)

`buildColorBudgetBlock(palette, opts)` now takes an `opts.isZImage`
flag. When `true` (calling preset is one of the two Z-Image sentinel
presets — `preset_alla_prima_oil` or `preset_968c0ccdf6fc6151`),
the block drops:

- the per-line `Name #hexcode` form (emits pigment name only — guide
  §5.3 pigment vocabulary)
- the strength preamble + per-line `[STRENGTH: <level>]` tag (strength
  is FLUX/SDXL semantics; Z-Image interprets prose naturally)
- the per-accent `placement: <region>` tag (placement region is
  FLUX/SDXL semantics; conflicts with §6 Block 3)
- the cumulative sum/cap notes

Default `isZImage = false` preserves the existing FLUX/SDXL/Danbooru
emission. The active preset is detected in `/api/generate-prompt` by
comparing `getEffectiveStage2Prompt(preset)` against
`DEFAULT_ZIMAGE_STAGE2_PROMPT`.

`measureColorDistribution` is unchanged — it counts color names
case-insensitively in the output prompt; absence of hex strings in
the Z-Image prompt just means the dashboard's hex% bar reflects 0.

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
  **Superseded for the Z-Image preset family by ADR 0019**; the
  sentinel + per-preset override pattern (ADR 0007) remains valid.
- ADR 0016 — palette strength + accent placement + `strict_pass`
  validation. The canonical Stage 2 prompt now interprets
  `palette.strength` (subtle / moderate / strong / strict) and
  `color.placement` (per-accent region binding). `buildColorBudgetBlock`
  emits a strength preamble + per-line `[STRENGTH: <level>]` tag and a
  `placement: <region>` tag on accents. `measureColorDistribution`
  appends `strict_pass` + `strict_violations` to the response envelope
  when the palette is `strict`. The result panel surfaces a non-
  blocking warning chip on `strict_pass === false`.
- ADR 0017 — order-based color priority (replaces per-color `weight`).
- ADR 0018 — focused re-analysis + curated preset chips for
  `actions` / `mood` / `lighting`.
- **ADR 0019** — pastel-focal-glow prompt contract, length-check
  orchestrator, preset-aware palette emission, chat-layer Z-Image
  constraints block, aspect-ratio picker, 1024-token reminder
  banner, defensive Copy-to-clipboard stripper. See
  `docs/adr/0019-zimage-pastel-focal-glow-contract.md`.

### 5.2 Z-Image contract revisions (ADR 0019)

The following were resolved in ADR 0019 (this branch, commits
`ebd65dd` through `2dfb131`):

1. Rewrite `DEFAULT_ZIMAGE_STAGE2_PROMPT` to single-prose
   pastel-focal-glow contract. Pastel palette anchor, palette knife,
   alla prima, no gestural-school vocabulary. ✅
2. Drop `de Kooning / Riopelle` reference. ✅
3. Drop `== SECTION A ==` / `== SECTION B ==` markers; remove
   Section B audit metadata block from the contract. ✅
4. Drop "no X" trailing constraints (CFG=0 ignores them). Replace
   with the §17.1 positive-anchor "natural paint sheen" closing
   line. ✅
5. Add §8.1 "glow by color contrast" module + forbid-list for
   depicted-light vocabulary. ✅
6. Length window 150-300 words, hard ceiling 750 / 1024 tokens. ✅
7. Add Composition rule with aspect ratio + §8.3 painting-fills-
   the-frame framing default. ✅
8. `buildColorBudgetBlock` preset-aware: drop hex + `[STRENGTH]`
   tag + `placement` + sum/cap notes for Z-Image presets. ✅
9. Length-check orchestrator (server-side word counter, one retry
   with reinforcement directive, response envelope carries
   `length_check` descriptor). ✅
10. Chat system prompt gets a Z-Image constraints block for
    sessions anchored to Z-Image presets. ✅
11. Aspect-ratio body field + frontend `<select>` (square / portrait /
    landscape / panoramic). ✅
12. 1024-token reminder banner in the chat panel. ✅
13. Defensive Copy-to-clipboard strip (`stripSectionMarkers`) — load-
    bearing safety net for any future regression. ✅
14. `data/presets.json` — both Z-Image presets' `field_defaults` and
    visible names updated to pastel-focal wording. ✅
15. New ADR `0019-zimage-pastel-focal-glow-contract.md` capturing
    the decision rationale, the new contracts, the preset-aware
    emission split, and the out-of-scope locks. ✅

### 5.3 Out of scope (locked for follow-on)

- Other presets adopting the new contract. (Photorealistic and
  Danbooru presets don't use the Z-Image sentinel; they keep their
  existing FLUX/SDXL Stage 2 prompts and palette emission
  semantics. Migrating them would be a separate decision.)
- Frontend collapsible Section B in result panel — **resolved**
  implicitly by ADR 0019's Section B removal; no separate work
  needed. The defensive Copy-to-clipboard strip
  (`#12` above) is the user-facing safety net.
- Real InvokeAI resolution push-through (the artist still has to set
  the resolution in InvokeAI's panel to match the chosen aspect
  ratio). The aspect-ratio body field tells the prompt what to
  *describe*, not what to render at.
- Bilingual text-in-image support (Qwen3-4B's bilingual strength —
  separate feature, irrelevant to the painterly tradition).
- Chat-layer integration of palette strength (refinement requests
  currently ignore palette strength on Z-Image presets because
  strength is FLUX/SDXL-only; out of scope).
- Output validation beyond length (colorimetric ΔE from a palette
  would need a downstream image-render step).
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
