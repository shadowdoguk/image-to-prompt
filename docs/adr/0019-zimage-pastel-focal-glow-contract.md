# ADR 0019 — Z-Image Turbo pastel-focal-glow prompt contract

## Status

Accepted. Implemented 2026-07-02 (this branch `feature/zimage-pastel-focal-glow`,
commits `ebd65dd` … `2dfb131`).

## Type

Prompt contract + palette emission split + chat-layer constraint block +
frontend safety net + length orchestrator. Touches `server.js`,
`src/app.js`, `src/index.html`, `src/styles.css`, `tests/run-all.js`,
`data/presets.json`, `docs/zimage-turbo-prompting.md`,
`docs/adr/0015-zimage-final-prompt-logic.md` (Superseded-for-Z-Image note).

## Context

Per `docs/Z-IMAGE-TURBO-AGENT-PROMPT-GUIDE.md` §1, the artist's
reference tradition is **pastel-palette, palette-knife, impasto alla
prima with radiant glow**: chalky low-chroma dominant tones (pale
sage, dusty putty, weathered bone, muted lavender-grey) with one
highly saturated focal element (cadmium-coral, vermillion, cobalt
blue, …) anchored to a specific part of the subject; the radiance is
*optical*, emerging from chroma and temperature contrast against the
muted surround, never from a depicted lamp.

The contract originally shipped under ADR 0015 anchored on a
different tradition: gestural abstract-expressionism ("heavy impasto
with vigorous scraped, dragged, and smeared paint. … gestural streaks
of energy radiate outward from the figure … reminiscent of the late
paintings of de Kooning and the energetic scrape-and-drag technique
of Riopelle"). Both traditions share vocabulary (palette knife,
impasto, alla prima) but the focal logic is fundamentally different:
gestural-expressive vs pastel-focal-chroma-glow.

In addition, ADR 0015's output format was a two-section structure
(`== SECTION A ==` prose + `== SECTION B ==` audit metadata). The
artist pastes the Stage 2 output verbatim into InvokeAI's prompt
field; the Section B block leaked metadata into Z-Image's
conditioning, and the format hard-conflicted with the guide's §4
absolute rule "Output only the prompt text."

Beyond the contract, three supporting layers needed to follow the
new contract:

- `buildColorBudgetBlock` emitted `Name #hexcode` strings and a
  `[STRENGTH: <level>]` tag — FLUX/SDXL semantics that Z-Image
  doesn't honour; the guide §5.3 specifies pigment names only.
- The chat system prompt was a generic editor that accepted user
  requests like "add a backlit halo" without raising a flag, even
  though §16.2 of the guide lists depicted-light vocabulary as a top
  failure mode.
- There was no length enforcement; Stage 2 could ship a 60-word
  prompt (below the guide's reliability floor) or a runaway 1k-word
  prompt (silently truncated at the encoder at 1024 tokens).

## Decision

### 1. The Stage 2 contract is single-prose pastel-focal-glow

`DEFAULT_ZIMAGE_STAGE2_PROMPT` (`server.js:519-572`) becomes a
single-paragraph (or 2–3 short paragraphs) Stage 2 system prompt
that:

- Names the target model facts up front (CFG=0, Qwen3-4B encoder,
  8 NFE, max_sequence_length = 1024 tokens ≈ 750 English words).
- Outputs a single flowing paragraph of 150–300 words, woven from
  six blocks: Subject → Scene/Ground → Composition → Lighting →
  Style & Technique → Constraints (close paraphrase of guide §6).
- Anchors on pastel palette with named pigments (chalky pale greens,
  dusty putty, soft creams, weathered bone, muted lavender-grays)
  + ONE highly saturated accent anchored to a specific subject
  element.
- Carries the §8.1 glow-by-color-contrast module verbatim — required
  phrases "achieved through color contrast, not depicted illumination"
  and "no depicted light source"; explicit forbid-list for
  depicted-light vocabulary (soft light / backlit / rim light /
  halo of light / rays of light).
- Includes a Composition rule that names the §6 / §12.1 aspect
  ratios (square 1:1, portrait 4:5, landscape 16:9, panoramic 21:9)
  with the painting-fills-the-frame Option-A framing default.
- Closes with the §17.1 positive-anchor line ("natural paint sheen
  — matte in thick passages, slight gloss in scraped areas — visible
  paint surface texture throughout").
- Drops `de Kooning / Riopelle` reference and all gestural-school
  vocabulary.

The contract no longer references STRENGTH MODIFIER or ACCENT
PLACEMENT — those are FLUX/SDXL semantics and are explicitly
forbidden in the Z-Image anti-patterns list.

ADR 0015 is **superseded for the Z-Image preset family only** by
this ADR. The sentinel pattern (`DEFAULT_ZIMAGE_STAGE2_PROMPT`
substitution via `getEffectiveStage2Prompt`) and the per-preset
override path (ADR 0007) remain valid.

### 2. `buildColorBudgetBlock` becomes preset-aware

`server.js:1394-1447`. New `opts.isZImage` boolean. When true
(calling preset is `preset_alla_prima_oil` or
`preset_968c0ccdf6fc6151`), the block drops:

- the per-line `Name #hexcode` form (emits pigment name only)
- the strength preamble + per-line `[STRENGTH: <level>]` tag
- the per-accent `placement: <region>` tag
- the cumulative sum/cap notes

Default `isZImage=false` preserves the existing FLUX/SDXL/Danbooru
emission. The active preset is detected in `/api/generate-prompt` by
comparing `getEffectiveStage2Prompt(preset)` against
`DEFAULT_ZIMAGE_STAGE2_PROMPT`.

### 3. Field defaults pre-fill pastel-focal wording

`data/presets.json:7-11` and `:87-91` (`field_defaults.texture` for
both Z-Image presets, plus `field_defaults.style` for the imported
one) ship the pastel-focal wording — pastel palette, palette knife,
alla prima, thick pasto at the focal, thinly scraped field, knife-
edge marks visible, no brush hairs. The two visible preset names
update from "Gestural alla prima oil painting" → "Pastel-focal alla
prima oil painting" so the picker no longer names a tradition the
contract no longer targets. Preset ids unchanged.

### 4. Length-check + retry orchestrator

`server.js: STAGE2_SWEET_SPOT_MIN/MAX = 150/300`,
`STAGE2_HARD_MAX_WORDS = 750`, `countStage2Words`,
`isWithinStage2SweetSpot`, `classifyStage2Length`,
`generateStage2WithLengthCheck` (`server.js:3456+`). On the first
miss (output outside the sweet spot), the orchestrator retries once
with a reinforcement directive. If the retry also misses, the
response carries `length_check` in the envelope; the result panel
appends a `(N words, sweet spot|outside)` badge to the meta line.

The retry is opt-in (`opts.enableLengthRetry`) and is enabled only
for Z-Image presets in `/api/generate-prompt`, so FLUX/SDXL/Danbooru
paths are not slowed by a second LLM round-trip.

### 5. Chat-layer constraint block

`server.js: ZIMAGE_PRESET_IDS`, `ZIMAGE_CHAT_CONSTRAINTS_BLOCK`,
`buildChatSystemPrompt` (`server.js:5717+`). When
`session.preset_id ∈ {preset_alla_prima_oil,
preset_968c0ccdf6fc6151}` the chat system prompt appends a
constraints block that forbids negative prompts / depicted-light
vocabulary / quality tags / tag lists / weight syntax / Midjourney
parameters / hex codes / section markers, and reinforces the
pastel-palette / saturated-focal contract. The ADR 0011/0012
anchor-preservation contract is unaffected — the block layers on
top.

### 6. Frontend: aspect-ratio picker + 1024-token reminder banner

`src/index.html:127-135` — `<select id="aspect-ratio-select">` in
the Generate-prompt row with the four §6/§12.1 options + 'Auto'.
`src/app.js:1603` — `state.selectedAspectRatio` is sent as
`body.aspectRatio` to `/api/generate-prompt`. Server validates
against `VALID_ASPECT_RATIOS`; `buildAspectRatioDirective` prepends
an "Aspect ratio: portrait 4:5" style anchor to the Stage 2 user
directives so the LLM anchors Block 3 on the chosen canvas
proportion.

`src/index.html:184-191` + `src/app.js: updateTokenReminderBanner` +
`src/styles.css: .token-reminder-banner` — a yellow-tinted banner in
the chat panel that surfaces a non-blocking warning when the
current prompt hits 750 words. Re-evaluated on every
`displayResult` and every chat Apply.

### 7. Defensive Copy-to-clipboard strip

`src/app.js: stripSectionMarkers` + `window.__imageToPromptCopyStrip`
exposed for tests. Even though the contract no longer emits
`== SECTION A ==` / `== SECTION B ==` markers, the Copy-to-
clipboard button runs the prompt through a defensive strip so any
future regression — or a user-pasted Stage 2 override — cannot leak
audit metadata into InvokeAI's prompt field.

## Files that change

| File | Change |
|---|---|
| `server.js` | `DEFAULT_ZIMAGE_STAGE2_PROMPT` rewritten; `buildColorBudgetBlock` preset-aware; `countStage2Words` / `isWithinStage2SweetSpot` / `classifyStage2Length` / `generateStage2WithLengthCheck`; `VALID_ASPECT_RATIOS` / `ASPECT_RATIO_LABEL` / `buildAspectRatioDirective`; `ZIMAGE_PRESET_IDS` / `ZIMAGE_CHAT_CONSTRAINTS_BLOCK` / `buildChatSystemPrompt`; exports. |
| `data/presets.json` | Both Z-Image presets' `field_defaults` updated to pastel-focal wording; visible names updated. |
| `src/app.js` | `stripSectionMarkers` + `window.__imageToPromptCopyStrip`; `state.selectedAspectRatio` + aspect-ratio select change handler; `state.lastLengthCheck`; meta-line badge for sweet-spot / outside-sweet-spot; `updateTokenReminderBanner` + `#token-reminder-banner`; chat Apply triggers banner re-evaluation. |
| `src/index.html` | Aspect-ratio `<select>` in Generate-prompt row; 1024-token reminder banner in chat panel. |
| `src/styles.css` | `.aspect-ratio-label`, `.aspect-ratio-select`, `.token-reminder-banner` rules. |
| `tests/run-all.js` | Replace ADR 0015 contract test with ADR 0019 equivalent; length-classifier tests; preset-aware budget block tests; chat-system prompt Z-Image injection test; aspect-ratio directive test; defensive stripper test. |
| `docs/zimage-turbo-prompting.md` | Update §2, §3, §5.2 to reflect the new contract (Issue #16). |
| `docs/adr/0015-zimage-final-prompt-logic.md` | Add Superseded-by-ADR-0019 banner. |

## Out of scope (locked)

- **Real InvokeAI resolution control.** The aspect-ratio picker
  tells the prompt the artist *intends* a given canvas proportion;
  the artist still has to set InvokeAI's resolution in the
  model-loader panel to match (per guide §12.1). A future ADR can
  propose pushing the resolution directly through InvokeAI's API,
  not through InvokeAI's UI, but that's a separate seam.
- **Hex → pigment migration on storage.** Saved palettes still
  store `hex`. The Z-Image emission simply drops hex from the
  budget block; storage format is unchanged so other emission paths
  keep working.
- **Other presets adopting the new contract automatically.**
  `preset_photorealistic` and `preset_sd_danbooru` keep their
  existing Stage 2 prompts and palette-emission semantics — those
  are FLUX/SDXL paths. Migrating them would be a separate decision.
- **Output parsing.** No `parseStage2Output` helper for any future
  Section-B equivalent in this ADR. The chat-refinement path treats
  the whole string as the working prompt.
- **Validation beyond length.** No colorimetric ΔE check against
  the palette; no shape / aspect-ratio / focal-region validation
  in the prompt. Length is the only verifiable signal at the
  post-generation boundary.

## Verification

- `node scripts/session-init.js` → 10/10 passed (no schema drift,
  no agent-doc drift).
- `node tests/run-all.js` → 0 failed; contract test renamed
  "ADR 0015: §X" → "ADR 0019: pastel-focal-glow contract"; new
  tests for length-classifier, preset-aware budget block, Z-Image
  chat-system prompt injection, aspect-ratio directive, defensive
  Copy-to-clipboard stripper.
- Manual smoke: pick `preset_alla_prima_oil`, run Stage 1, hit
  Generate prompt (one Z-Image run); switch to
  `preset_photorealistic`, hit Generate prompt (one FLUX/SDXL run);
  switch to `preset_sd_danbooru`, hit Generate prompt (one tag-
  list run). Verify each prompt lands in the right language and the
  meta line shows the word-count badge for Z-Image runs only.
- Manual chat smoke: with a Z-Image session active, type "add a
  backlit halo", confirm the chat assistant's `reply` warns
  against added depicted-light vocabulary.

## Why these decisions

- **One canonical constant in code, not in a 28-char sentinel with
  a 5500-char inline preamble.** `MAX_PROMPT_LENGTH = 5000` cap
  stays clean (`server.js:63`). Same pattern as ADR 0015.
- **Single-prose output, not two-section.** The contract is for
  Z-Image's prompt field, not for an audit-metadata block. The
  audit shape from ADR 0015 lived only to make
  `measureColorDistribution` back-checkable; §16 of ADR 0014 +
  the new `length_check` descriptor covers the audit need from the
  *response envelope*, not from within the prompt.
- **Pastel-palette anchor, not gestural.** The two traditions
  share vocabulary but not focal logic; the artist's guide (and
  the test fixtures in §9 of the guide) are unambiguously
  pastel-focal. Locking the contract on the artist's tradition is
  the requirement; gestural-school language belongs in the
  exclusion list.
- **Length orchestrator, not just a word-count assertion.** A
  word-count check at the boundary (and a non-blocking warning
  chip) catches the failure modes the LLM tends to drift into.
  The single retry-with-reinforcement is bounded so worst-case
  latency is ~120s (still inside the user's tolerance for an
  interactive button click).
- **Aspect-ratio body field, not a UI control that calls a
  separate endpoint.** Aspect-ratio is part of Stage 2's
  composition rules; threading it through `/api/generate-prompt`
  keeps the wire format pure.
- **Chat-layer constraint block layered after anchor-preservation,
  not replacing it.** Anchor-preservation (ADR 0012) is the
  workshop's load-bearing rule; the Z-Image block is a
  domain-model vocabulary filter on top. The two compose without
  conflict.

## Cross-links

- Supersedes (Z-Image portion only): `docs/adr/0015-zimage-final-prompt-logic.md`
- Companion doc update: `docs/zimage-turbo-prompting.md` (Issue #16)
- Reference contract: `docs/Z-IMAGE-TURBO-AGENT-PROMPT-GUIDE.md`
