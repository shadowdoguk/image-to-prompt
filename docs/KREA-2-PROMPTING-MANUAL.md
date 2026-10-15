# KREA 2 — PROMPTING MANUAL
## For: General-purpose image generation, prose-driven natural-language prompting
### Target Runtimes: Krea web app (krea.ai/image), Krea REST API, Replicate, fal.ai, and self-hosted ComfyUI / InvokeAI from the open-weights release

> **Document purpose:** A *practitioner's* reference for the **Krea 2** model line. The job of this document is to translate an artist's or operator's visual intent into Krea 2 prompts that hit the model's design points. **Read §1 (Identity) and §3 (Variants) before writing prompts.** §8 (Worked Examples) is the closest thing to a "starter library." §14 (Failure Modes) lists what *not* to expect.
>
> **Document version:** 1.0
> **Compiled:** 2026-10-07
> **Primary sources:** Krea vendor docs (`krea.ai/blog/krea-2-deep-dive-walkthrough`, `krea.ai/docs/user-guide/features/krea-2`, `krea.ai/docs/developers/krea-2/overview`), HuggingFace model card (`huggingface.co/krea/Krea-2-Raw`), Krea 2 Technical Report (`krea.ai/blog/krea-2-technical-report`), and corroborated community patterns from r/StableDiffusion, Ambience AI tutorial, Civitai "Z-Image Turbo vs Krea 2" comparison, and the Krea X account.
> **Target model:** **Krea 2** by **Krea AI** (San Francisco). Variant-specific guidance is called out inline.

---

## TABLE OF CONTENTS

1. Model Identity
2. Variants — which one to pick
3. Architecture — what the operator must know
4. Hard Specs (token / word / length / sliders)
5. Absolute Rules (never violate)
6. Core Vocabulary Banks
7. Prompt Structure
8. Worked Examples
9. Style References and Moodboards (style-transfer workflow)
10. Typography / In-Image Text
11. Self-Review Checklist
12. ComfyUI / Self-Hosted Configuration
13. Online-Platform Configuration (Replicate, fal.ai, Krea web app, API)
14. Failure Modes and How to Recover
15. Differences from FLUX / SDXL / Z-Image / Anima
16. License / Commercial Use
17. Quick-Reference Style Block (copy/paste)
18. Citation Index

---

## 1. MODEL IDENTITY

| Field | Value |
|---|---|
| **Name** | **Krea 2** (image + video) |
| **Vendor** | **Krea AI** (San Francisco; founder: Victor Perez) |
| **Architecture** | **Diffusion Transformer (DiT)** — Krea's first image foundation model **built from scratch** (not FLUX-derived, not SD-derived). Uses iREPA for convergence, GQA + sigmoid-gated attention, Qwen3-VL text encoder. |
| **Parameter count** | **Not officially disclosed** by Krea. (Third-party coverage has referenced "12B" but Krea does not confirm.) |
| **Training data** | **Not disclosed.** Krea publishes no dataset card, no training-data summary. |
| **Text encoder** | **Qwen3-VL** (vision-language model used as the encoder — a small LLM, not CLIP, not T5) |
| **VAE** | Qwen VAE (same family as the Anima / Qwen-Image line — shared with `qwen_image_vae.safetensors`). Known to introduce subtle halftone artifacts at low output sizes. |
| **Variants shipped** | Medium, Large, Turbo (separate, non-stacked checkpoints) |
| **Release** | Announced 2026-05-12; open weights released 2026-06-22 |
| **License** | **Krea Community License v1** (2026-06-22) for non-commercial / personal use + **Krea Commercial License** for commercial / self-hosting / fine-tuning |
| **Open weights** | **Yes** — `krea/Krea-2-Raw` on HuggingFace; Community License covers redistribution under the license terms |
| **Where to access** | (a) Krea web app `krea.ai/image` (canonical), (b) Krea REST API `krea.ai/docs/developers/krea-2`, (c) Replicate `replicate.com/krea/krea-2-large`, (d) fal.ai `fal.ai/krea-2`, (e) self-hosted ComfyUI / InvokeAI from HF weights |
| **Where to discuss** | Krea Discord (private invite; ~50k+ members); X `#krea2`; r/StableDiffusion threads |

**Mental model in one sentence:** Krea 2 is a from-scratch DiT with a Qwen3-VL encoder, deliberately *unopinionated* about style — it renders whatever the prompt and style-reference ask for, with the **Creativity slider** as the contract lever (Raw / Low / Medium / High).

[Sources: `krea.ai/krea-2`; `krea.ai/blog/krea-2-technical-report`; `krea.ai/docs/user-guide/features/krea-2`; `huggingface.co/krea/Krea-2-Raw`.]

---

## 2. VARIANTS — WHICH ONE TO PICK

Krea 2 ships in **three flavors**. Unlike Anima (where Turbo / Aesthetic / Base trade flexibility vs. consistency vs. speed), Krea 2's variants are primarily **capacity** and **speed** tiers; the **style** and **interpretation** control is the **Creativity slider**, not the variant.

| Variant | Purpose | Recommended for | Notes |
|---|---|---|---|
| **Krea 2 — Turbo** | Distilled, low-step, fastest inference | Quick iteration, online platforms where step count is billed, anything that benefits from a stable default rendering | 8-NFE equivalent; runs on consumer GPUs |
| **Krea 2 — Medium** | Default capacity / quality | General use; the canonical Krea 2 output | Default in the Krea web app |
| **Krea 2 — Large** | Maximum capacity / quality | Final-render quality, hero shots, anything where the extra latency is acceptable | Slowest, most VRAM-hungry |

**Operator's decision tree:**

```
Need raw speed / cheap iteration?        ─── YES ──► Krea 2 Turbo
                                            │
                                            NO
                                            │
Need best fidelity / detail / size?     ─── YES ──► Krea 2 Large
                                            │
                                            NO
                                            │
                                            ▼
                                        Krea 2 Medium (default safe choice)
```

> **Note:** All three variants accept the same prompt format and use the same **Creativity slider** (Raw / Low / Medium / High). The variants do not change the contract — they change the capacity / latency trade-off.

[Sources: `krea.ai/docs/user-guide/features/krea-2`; `krea.ai/krea-2`.]

---

## 3. ARCHITECTURE — WHAT THE OPERATOR MUST KNOW

You don't need code-level understanding, but you need to know *what kind of text the model reads*, because Krea 2's prompt contract is **prose-only** — it does not read tags, weights, or quality markers.

| Component | What it is | Prompting implication |
|---|---|---|
| **Text encoder** | **Qwen3-VL** — a vision-language model used as the text encoder. Small but capable *LLM*. | Reads **English sentences**, not tag lists. Understands context, modification relationships, spatial arrangement. The model is "LLM-encodered" in the same family as Anima's Qwen-3 encoder. |
| **Diffusion transformer** | DiT, built from scratch by Krea, single-stream. | Standard flow-matching diffusion behavior; **default CFG = 0** (CFG-free guidance) — this is why negative prompts are ignored. |
| **iREPA convergence** | Krea's published acceleration technique | Lets the model converge in fewer steps; the prompt contract is unaffected. |
| **VAE** | Qwen-Image VAE (shared family with Anima / Qwen-Image) | Known to introduce subtle halftone artifacts at low output sizes. Mitigation: render at ≥1024 px on the long edge. |
| **Default CFG** | **0.0** | **Negative prompts have no effect.** Do not emit negative-prompt language. |
| **Default steps** | Varies by variant (Turbo: ~8, Medium: ~28, Large: ~30+) | Operator-adjustable in API / ComfyUI; fixed in web app. |
| **Creativity slider** | Raw / Low / Medium (default) / High | This is the **style / interpretation** control. Medium = balanced. Raw = literal. High = strong expansion / stylization. |
| **Generative sliders** | Intensity, Complexity, Movement, Creativity | All four are exposed in the web app and the API. The image-to-prompt project's contract emits the **Creativity** value as part of the prompt's metadata. |

**Mental model in one sentence:** Krea 2 is an LLM-encodered DiT with default CFG=0 — it does exactly what you ask, no more, no less. The **Creativity slider** is the only knob that changes interpretation; everything else in the prompt is taken literally.

[Sources: `krea.ai/blog/krea-2-technical-report`; `krea.ai/docs/user-guide/features/krea-2`; `krea.ai/blog/krea-2-deep-dive-walkthrough`.]

---

## 4. HARD SPECS

### 4.1 Prompt length

Krea's official prompting guide gives **three explicit ranges** by intent:

| Intent | Recommended length | Example |
|---|---|---|
| **Exploration** | **5–20 words** | *"a fox on a misty hill at dawn"* |
| **Controlled image** (sweet spot) | **30–80 words** | *"a lone red fox on a misty hillside at dawn, 35 mm film photograph, shallow depth of field, fine grain, soft backlight through the fog, muted green and amber palette"* |
| **Complex scene** | **80–140 words** | A multi-clause scene with subject + setting + lighting + medium + texture + camera + mood all spelled out |

> **Hard cap:** **140 words** is the practical ceiling for the "complex scene" tier. Longer prompts risk **muddy** output as the encoder under-weights later clauses (Krea's own docs: *"Too many style adjectives can muddy the output, especially when a moodboard or reference image already carries the look."*)

> **Minimum effective:** ~5 words. Below this the model fills in generic defaults.

[Source: Krea 2 Prompting Guide — Exploration / Controlled image / Complex scene bands.]

### 4.2 Aspect ratio

The web app exposes a fixed set; the API exposes the full set. **For this project, emit the user's selected aspect ratio** alongside the prompt — Krea's web app and API both honor `aspect_ratio` / `aspectRatio` parameters.

### 4.3 Sampler / scheduler / CFG / steps

| Setting | Default | Notes |
|---|---|---|
| **CFG** | **0** (CFG-free guidance) | **Negative prompts ignored.** Do not emit them. |
| **Steps** | Turbo: 8; Medium: 28; Large: 30+ | Operator-adjustable in API / ComfyUI; not exposed in the web app. |
| **Sampler** | Krea-default (flow-matching) | Not officially disclosed; the web app uses Krea's internal scheduler. |

> **Operator's rule of thumb:** If you don't know, render with **Krea 2 Medium + Creativity Medium** and iterate from there.

### 4.4 Token limit / hard ceiling

Krea has not published a hard token cap. Empirically (community + 5,000-character reference in community guides), the **5,000-character** mark is the practical ceiling. Past that, later clauses are dropped. This is well above the 140-word "complex scene" sweet spot, so length is rarely the binding constraint.

[Source: `krea.ai/docs/developers/krea-2/overview`; community length guidance.]

---

## 5. ABSOLUTE RULES (NEVER VIOLATE)

These are hard rules. Break them and you get worse results, not better.

### R1. Use natural-language prose. **Not** tag lists.

```
✓  A lone red fox on a misty hillside at dawn, 35 mm film photograph,
   shallow depth of field, fine grain, soft backlight through the fog.
✗  fox, misty, hill, dawn, 35mm, film, photograph, shallow dof, fine grain,
   soft backlight, fog, muted green, amber palette.
```

Krea's own docs (verbatim): *"Use natural language. Not tag lists."*

### R2. Do not use weight syntax.

```
✗  (red dress:1.3)
✗  (cinematic:1.5) (low contrast:0.7)
```

Weight syntax is **not parsed** by Krea 2. If you want emphasis, use **word order** and **adjectives** instead.

### R3. Do not use quality tags.

```
✗  masterpiece, best quality, 8K, ultra detailed, award winning,
   photorealistic, hyperrealistic
```

Krea 2 does not benefit; the model is already trained for high fidelity. Quality tags can actually bias the output toward over-processed results.

### R4. Do not use Midjourney / SDXL / Stable Diffusion parameters.

```
✗  --ar 16:9 --s 750 --v 6 --niji
✗  --q 2 --style raw
```

Not parsed. Krea's web app exposes its own aspect-ratio picker; use that (or the `aspect_ratio` API parameter) instead.

### R5. Do not emit negative prompts.

```
✗  --no text, watermark, blurry, deformed hands
✗  negative: blurry, low quality, deformed hands, extra fingers
```

Krea's own FAQ (verbatim): *"Does Krea 2 need a negative prompt? No."* Default CFG=0 means negative prompts have no effect. If you need to suppress a tendency, push the **Creativity slider** toward Raw and rewrite the positive prompt to be more specific.

### R6. Keep prompt length in the documented bands.

| Intent | Length |
|---|---|
| Exploration | 5–20 words |
| Controlled (sweet spot) | **30–80 words** |
| Complex scene | 80–140 words |
| Beyond 140 words | Risk of muddy output — drop adjectives, not clauses |

### R7. For in-image text, use double quotes.

```
✓  a vintage protest poster reading "WORKERS OF THE WORLD UNITE"
   in large white serif letters across the top
✗  a vintage protest poster with text WORKERS OF THE WORLD UNITE
```

Krea's troubleshooting (verbatim): *"Text is garbled. Quotes were missing, the string was too long, or creativity was too high. Fix in that order."*

### R8. For text rendering, lower the Creativity slider.

When rendering in-image text, set **Creativity = Low** (not Medium, not High). The default Medium / High values invite the model to stylize — which corrupts the lettering. This applies to the Creativity slider, which the image-to-prompt project emits as part of the prompt's metadata.

### R9. Do not depict light sources with glow vocabulary.

Krea 2 has its own convergence mechanism (iREPA) and **will literally render** words like "glowing," "neon," "rim-lit" — sometimes to excess, producing over-bloomed outputs. **Do not** use Z-Image Turbo's pastel-focal-glow vocabulary here. Specify the light source explicitly and physically: *"soft window light from the left, not a glowing lamp."*

### R10. Do not invent subjects the artist did not specify.

The operator is a translator, not a co-author. If the artist says "a vase of peonies," the prompt does not add a cat, a window, or a person. (Same rule as Z-Image manual R8.)

### R11. Always specify the rendering medium explicitly.

Photoreal / oil painting / risograph / 35 mm film / 3D render / Studio Ghibli / comic book / watercolor — the medium cue is the single most leverage-loaded word in the prompt. Without it, the model falls back to its "Krea 2 default" rendering, which is a deliberate but unopinionated neutral look.

### R12. Always describe lighting as a physical source, not a glow effect.

Krea 2 takes "soft window light from the left" literally and renders a window. "Halo of light" or "rim-lit glow" invites over-processing. Spell out the physical source: *"practical low light from a farmhouse window,"* *"hard directional sunlight from the upper right,"* *"diffused overcast skylight."*

### R13. Render at ≥1024 px on the long edge when possible.

The Qwen VAE introduces subtle halftone artifacts at lower output sizes. Mitigation: render at ≥1024 px long edge. The web app defaults to this for Medium / Large variants.

### R14. Never combine Midjourney-style "1girl, solo, long hair" tags with natural-language prose.

Mixed prompts confuse the encoder. **Pick one or the other** — Krea 2 wants prose only.

[Sources: `krea.ai/docs/user-guide/features/krea-2`; `krea.ai/blog/krea-2-deep-dive-walkthrough`; community patterns from r/StableDiffusion + Ambience AI.]

---

## 6. CORE VOCABULARY BANKS

These are the *phrase atoms* that reliably do work. Think of them as knapsack items you can drop into the appropriate clause of the 5-layer structure.

### 6.1 Medium / rendering style (drop one early in the prompt)

| Phrase | Effect |
|---|---|
| `"photorealistic 35 mm film photograph"` | Default photographic rendering, natural-grain texture |
| `"cinematic photograph"` | Wider aspect, stronger color grade, film-like contrast |
| `"oil painting"` | Painterly rendering, brushstroke-driven |
| `"watercolor"` | Wet, transparent, paper-textured |
| `"3D render"` | CGI look, smooth surfaces, studio lighting |
| `"anime illustration"` | Stylized, line-driven, anime aesthetic |
| `"Studio Ghibli"` | Specific anime-studio aesthetic — soft palette, hand-drawn feel |
| `"risograph print"` | Two-color palette, slight misregistration, grainy ink texture |
| `"comic book"` | Outlined, panel-ready rendering |
| `"watercolor illustration"` | Loose, wet, paper-textured |
| `"Polaroid instant film"` | Square-ish, soft borders, color-shift characteristic |
| `"Hasselblad medium format"` | High-fidelity medium-format color science |

### 6.2 Lighting (drop one physical-source phrase in the lighting clause)

```
soft window light from the left
practical low light from a farmhouse window
hard directional sunlight from the upper right
diffused overcast skylight
golden hour, late afternoon, low sun angle
overcast dusk, no direct light source
dappled light through forest canopy
single overhead studio softbox
practical tungsten lamp, warm cast
candle-lit, low key, deep shadows
fluorescent overhead, cool green cast
moonlit, cool blue, low ambient
```

### 6.3 Lens / camera / texture (drop one in the texture / camera clause)

```
shot on 35 mm film
85 mm portrait lens, shallow depth of field
24 mm wide-angle
Hasselblad medium format
Polaroid instant film
visible grain, fine grain
shallow depth of field
deep focus, large depth of field
slight motion blur
documentary photograph, natural light
studio photograph, controlled lighting
```

### 6.4 Palette descriptors (drop as a colour clause)

```
muted green and amber palette
soft pastel palette — chalky, low-chroma
warm neutral palette — cream, putty, bone
high-contrast palette — saturated focal against muted surround
complementary palette — teal and coral, lavender and chrome yellow
risograph two-colour palette — fluorescent pink and navy
monochrome palette — sepia / cyanotype / silver gelatin
desaturated, washed-out palette
```

### 6.5 Composition / framing (drop in the composition clause)

```
wide shot, rule of thirds, generous negative space
medium close-up portrait
extreme close-up, macro photograph
low angle, looking up
high angle, looking down
over-the-shoulder framing
centered subject, symmetrical
off-center subject, dynamic
shallow depth of field, subject isolated
deep focus, environmental context
wide-angle establishing shot
```

### 6.6 Mood / atmosphere (drop at the end, or fold into the lighting clause)

```
eerie folk-horror mood
intimate and unhurried mood
dreamy cinematic scene
brooding, low-key, deep shadows
cheerful, high-key, washed-out
melancholic, overcast, muted
whimsical, fairy-tale, storybook
```

[Sources: community patterns from r/StableDiffusion, Ambience AI tutorial, Krea X account prompt examples.]

---

## 7. PROMPT STRUCTURE — THE 5-LAYER FORMULA

Krea 2's official prompt guide spells out a **five-layer prose formula**. Every Krea 2 prompt is composed of these clauses, in this order:

```
[Subject and action] + [Setting and environment] + [Lighting and mood] + [Style reference or aesthetic keyword] + [Composition notes]
```

### 7.1 The full template

```
A {subject doing something}, {in a setting}, {under lighting}, {rendered as a medium}, {composed a certain way}.
```

**Worked template (photorealistic):**

```
A lone red fox on a misty hillside at dawn,
in a sparse alpine meadow with low grass and scattered stones,
soft backlight through the fog, muted green and amber palette,
photorealistic 35 mm film photograph,
shallow depth of field, fine grain, wide shot, atmospheric mood.
```

### 7.2 Layer-by-layer instructions

| Layer | What it answers | Example phrase |
|---|---|---|
| **Subject and action** | *What* is in the image? | *"A lone red fox on a misty hillside at dawn"* |
| **Setting and environment** | *Where* is the subject? | *"in a sparse alpine meadow with low grass and scattered stones"* |
| **Lighting and mood** | *How* is it lit and what feeling does it carry? | *"soft backlight through the fog, muted green and amber palette"* |
| **Style reference / aesthetic keyword** | *What rendering / medium / look?* | *"photorealistic 35 mm film photograph"* |
| **Composition notes** | *How is it framed?* | *"shallow depth of field, fine grain, wide shot, atmospheric mood"* |

> **Operator's rule of thumb:** Each clause should be one phrase — a noun phrase, a prepositional phrase, or a short clause. Do not pack multiple ideas into one comma-separated word stack; Krea 2 reads prose, not stanzas of tags.

### 7.3 The Krea X / community five-attribute stack (variant)

A second pattern circulates in the community, attributed to Krea's X account and the Ambience AI tutorial:

```
Subject + setting + composition + lighting + mood + medium/style + texture/camera detail
```

This is the same 5-layer formula with **composition** and **texture/camera** split out as their own clauses. Both shapes work; the community variant is slightly more verbose.

[Source: Krea 2 Prompting Guide; Krea X account prompt examples; Ambience AI tutorial.]

---

## 8. WORKED EXAMPLES

### 8.1 Photorealistic landscape

> *"A lone red fox on a misty hillside at dawn, in a sparse alpine meadow with low grass and scattered stones, soft backlight through the fog, muted green and amber palette, photorealistic 35 mm film photograph, shallow depth of field, fine grain, wide shot, atmospheric mood, solid dark background."*

| Layer | Clause |
|---|---|
| Subject | A lone red fox on a misty hillside at dawn |
| Setting | in a sparse alpine meadow with low grass and scattered stones |
| Lighting + mood | soft backlight through the fog, muted green and amber palette |
| Style | photorealistic 35 mm film photograph |
| Composition | shallow depth of field, fine grain, wide shot, atmospheric mood, solid dark background |

**Recommended Creativity:** Medium (default).

### 8.2 Cinematic portrait

> *"A weathered fisherman sits alone in a dim kitchen. Rain streaks the window behind him. The image is a natural-light documentary photograph with muted blue-gray tones, worn wood textures, and subtle film grain. Tight close-up, shallow depth of field, eyes in focus, hands blurred in foreground, intimate and reflective mood."*

| Layer | Clause |
|---|---|
| Subject | A weathered fisherman sits alone in a dim kitchen |
| Setting | (implied — dim kitchen; explicit: rain streaks the window behind him) |
| Lighting + mood | natural-light documentary photograph, muted blue-gray tones |
| Style | (folded into lighting — documentary photograph, film grain) |
| Composition | tight close-up, shallow depth of field, eyes in focus, hands blurred in foreground, intimate and reflective mood |

**Recommended Creativity:** Low (portrait — stay literal).

### 8.3 Oil painting, alla prima

> *"A haunted roadside motel at night, wide shot, low angle, moonlit, eerie ambience, oil painting, thick visible brushstrokes, textured canvas, palette-knife ridges, muted indigo and bone-white palette, atmospheric mood."*

| Layer | Clause |
|---|---|
| Subject | A haunted roadside motel at night |
| Setting | (implied; composition is wide shot, low angle) |
| Lighting + mood | moonlit, eerie ambience, muted indigo and bone-white palette |
| Style | oil painting, thick visible brushstrokes, textured canvas, palette-knife ridges |
| Composition | wide shot, low angle, atmospheric mood |

**Recommended Creativity:** Medium (painterly).

### 8.4 In-image text (poster)

> *"A vintage-style protest poster with the bold text 'WORKERS OF THE WORLD' in large white serif letters across the top, and 'UNITE' in smaller red sans-serif underneath, slight grain, 1970s screen-print aesthetic, risograph two-color palette of fluorescent pink and navy, bold flat silhouettes, solid cream background."*

| Layer | Clause |
|---|---|
| Subject | A vintage-style protest poster |
| Setting | (in-image text + typographic detail in subject) |
| Lighting + mood | (flat — graphic poster) |
| Style | 1970s screen-print aesthetic, risograph two-color palette of fluorescent pink and navy, bold flat silhouettes |
| Composition | slight grain, solid cream background, in-image text in quotes |

**Recommended Creativity:** **Low** (text rendering — keep it literal).

### 8.5 Risograph / illustration

> *"A risograph print of a bicycle against a lamppost, two-colour palette of fluorescent pink and navy, bold flat silhouettes, slight misregistration, grainy ink texture, solid cream background."*

**Recommended Creativity:** Medium.

### 8.6 Cyberpunk cityscape

> *"A futuristic city skyline at twilight, neon lighting, cyan-purple palette, glossy reflective surfaces, wide-angle view, slight haze, concept art, bold saturated colors, dramatic backlight, cinematic atmosphere."*

**Recommended Creativity:** Medium–High (concept art benefits from stronger interpretation).

### 8.7 Multi-character (use explicit "Subject:" / second character clauses)

> *"A wizard in red robes standing beside a knight in silver armor in a torchlit stone hall. The wizard has a long white beard and holds a gnarled wooden staff; the knight wears polished silver plate and carries a broadsword. Dramatic warm orange light from a single brazier, cinematic photograph, deep shadows, painted concept art, wide shot, rule of thirds, atmospheric mood."*

> **R-multicharacter rule:** When two characters must be distinct, **name the second explicitly** ("a knight in silver armor…"). Without this, Krea 2 sometimes merges the two figures into a single confused silhouette.

**Recommended Creativity:** Medium.

[Sources: r/StableDiffusion threads (u/cadissimus, u/LowCatch4324); Ambience AI tutorial; Krea X account.]

---

## 9. STYLE REFERENCES AND MOODBOARDS (style-transfer workflow)

Krea 2 supports a **style-transfer workflow** that this project does not currently emit (the user's source image IS the style reference for image-to-prompt), but the LLM-driven Stage-2 contract should be aware of it.

### 9.1 The two style-reference shapes

Krea's docs (verbatim): *"Prompting Krea 2 has three layers: starting with a vague prompt to explore a spread of styles, adding a style reference to carry a specific look, or building a moodboard to set a whole aesthetic."*

| Shape | What it does | Prompt format |
|---|---|---|
| **Vague prompt** | Explore a spread of styles | 5–20 words; one subject + one medium cue |
| **Style reference** | Carry one look forward into new prompts | Drop the reference image into "add as style transfer," then write whatever prompt you want |
| **Moodboard** | Set a whole aesthetic | Multiple reference images, used as a coherent style package |

For this project's Stage-2 contract, the **user's uploaded image** is the implicit style reference — the LLM extracts the analysis (subject, palette, lighting, mood) and emits a Krea 2 prompt that recreates it.

[Source: `krea.ai/blog/krea-2-deep-dive-walkthrough`.]

---

## 10. TYPOGRAPHY / IN-IMAGE TEXT

Krea 2 is **materially better than FLUX / SDXL / Anima** at rendering legible in-image text. The contract:

### 10.1 The four rules

1. **Put the text in double quotes.** `a poster reading "GRAND OPENING"`
2. **Keep it short.** A few words. Long phrases degrade.
3. **Lower the Creativity slider to Low.** Medium and High invite artistic reinterpretation that corrupts lettering.
4. **Plain background.** Do not overlay text on busy scenes — Krea 2 reads the background texture and confuses letterforms with it.

### 10.2 Krea's own troubleshooting (verbatim)

> *"Text is garbled. Quotes were missing, the string was too long, or creativity was too high. Fix in that order."*

### 10.3 Worked example

> *"A vintage-style protest poster with the bold text 'WORKERS OF THE WORLD' in large white serif letters across the top, and 'UNITE' in smaller red sans-serif underneath, slight grain, 1970s screen-print aesthetic, risograph two-color palette of fluorescent pink and navy, bold flat silhouettes, solid cream background."*

[Source: `krea.ai/blog/krea-2-deep-dive-walkthrough`; `krea.ai/docs/user-guide/features/krea-2`.]

---

## 11. SELF-REVIEW CHECKLIST

Before emitting any Krea 2 prompt, walk this checklist. Every item must be a yes.

- [ ] **R1:** Is the prompt natural-language prose? (No tag lists.)
- [ ] **R2:** No weight syntax anywhere? (`(keyword:1.3)` is forbidden.)
- [ ] **R3:** No quality tags? (`masterpiece, 8K, ultra detailed` removed.)
- [ ] **R4:** No Midjourney / SDXL parameters? (`--ar`, `--s`, `--v`, `--niji` removed.)
- [ ] **R5:** No negative prompt emitted? (Drop or rewrite as positive constraint.)
- [ ] **R6:** Length in band? (5–20 / 30–80 / 80–140 words.)
- [ ] **R7:** In-image text in double quotes?
- [ ] **R8:** Creativity slider Low for text, Medium default otherwise?
- [ ] **R9:** No glow vocabulary? (No "halo of light," "neon glow," "rim-lit.")
- [ ] **R10:** No invented subjects?
- [ ] **R11:** Medium cue specified? (photoreal / oil painting / 3D render / etc.)
- [ ] **R12:** Lighting spelled as physical source? (window, sun, candle — not abstract glow.)
- [ ] **R13:** Output ≥1024 px on long edge recommended?
- [ ] **R14:** No mixed tag + prose / no-prose hybrid?

If any item is a no, **revise before emission**.

---

## 12. COMFYUI / SELF-HOSTED CONFIGURATION

### 12.1 Required components

| Component | File | Notes |
|---|---|---|
| **Model** | `krea-2-medium.safetensors` (or `large`, `turbo`) | From `krea/Krea-2-Raw` on HuggingFace, under Krea Community License v1 |
| **Text encoder** | Qwen3-VL encoder files | Bundled with the Krea 2 weights or available as a sibling download |
| **VAE** | `qwen_image_vae.safetensors` | Same as Anima / Qwen-Image — you may already own it |
| **Sampler** | Krea-default (flow-matching) | ComfyUI Krea 2 custom nodes typically expose this; community guides document the exact node setup |

### 12.2 Recommended settings

| Setting | Recommended |
|---|---|
| **Steps** | 28–30 for Medium / Large; ~8 for Turbo |
| **CFG** | **0** (mandatory — negative prompts are ignored otherwise) |
| **Sampler** | Krea-default flow-matching |
| **Scheduler** | Krea-default |
| **Resolution** | ≥1024 px long edge (Qwen VAE halftone mitigation) |

### 12.3 The license boundary

Per Krea Community License v1, open-weights use is **non-commercial** by default. **Commercial use** (self-hosting behind a paid API, embedding in a commercial product, fine-tuning for redistribution) requires the **Krea Commercial License**.

**For this project:** we emit prompts only. The image-to-prompt project does not embed Krea 2 weights, host Krea 2 inference, or integrate with paid Krea 2 APIs. The Community License does not restrict prompt-engineering for Krea 2, the same way the Anima license does not restrict prompt-engineering for Anima (per ADR 0021's license-boundary reasoning).

[Source: `krea.ai/krea-2-licensing`; `krea.ai/open-source-pricing`.]

---

## 13. ONLINE-PLATFORM CONFIGURATION

| Platform | URL | Notes |
|---|---|---|
| **Krea web app (canonical)** | `krea.ai/image` | The primary entry point. Free tier + paid plans. Creativity slider + Generative Sliders exposed. |
| **Krea REST API** | `krea.ai/docs/developers/krea-2` | Programmatic access. `aspect_ratio` parameter, `creativity` parameter, etc. |
| **Replicate** | `replicate.com/krea/krea-2-large` | Third-party cloud hosting. Same prompt contract, same defaults. |
| **fal.ai** | `fal.ai/krea-2` | Third-party cloud hosting. Same prompt contract. |
| **HuggingFace Spaces (community)** | Various | Community-maintained; contract varies — defer to krea.ai docs as source-of-truth. |

> **For this project:** the user copies the generated Krea 2 prompt and pastes it into the Krea web app (or any third-party host). The image-to-prompt project ships prompts only — not inference, not weights, not API integration. This matches ADR 0021's license-boundary reasoning for Anima.

---

## 14. FAILURE MODES AND HOW TO RECOVER

| Failure mode | Symptom | Mitigation |
|---|---|---|
| **Hands** | Distorted finger count, fused digits, mangled thumbs | Crop tighter (don't ask for full-body portraits with hands in foreground); generate at higher resolution; consider post-gen inpainting with a hand-fix LoRA |
| **Fine particles / hair** | Hair looks melted; small particulate (rain, snow, dust) renders as smears | Lower the **Creativity slider** (Raw or Low); render at ≥1024 px; reduce stylistic adjectives |
| **Multi-character bleed** | Two named characters merge into a single confused silhouette | Use explicit per-character clauses (e.g. *"a wizard in red robes… a knight in silver armor…"*); reduce number of characters to ≤2; lower Complexity slider |
| **Text garbled** | In-image text is mis-rendered or missing | **Fix in this order** (Krea's own docs): add double quotes → shorten the string → lower Creativity to Low |
| **Text on busy background** | Letterforms merge into background texture | Move text to a plain background (solid colour, gradient); use the "Reference Image" workflow to embed text into a clean reference |
| **Halftone grid artifact** | Subtle repeating dot pattern, especially at low resolution | Render at ≥1024 px on the long edge; upscale post-generation with SwinIR / Real-ESRGAN if needed |
| **Over-bloomed glow** | "Glowing," "neon," "rim-lit" phrases produce unrealistic luminance | Replace with physical light source (*"practical lamp,"* *"diffused window light"*); lower Creativity slider |
| **Generic AI look** | Output feels like a "default" Krea 2 render — unopinionated | Specify the medium explicitly (*"oil painting,"* *"risograph,"* *"cinematic photograph"*); use a style reference image |
| **Muddy output** | Too many adjectives, output feels confused | Trim to 30–80 words for controlled, 80–140 for scene-heavy; drop adjectives rather than clauses |
| **Subject lost** | The main subject is lost to background or detail | Move subject clause to the front; add *"in the foreground"* or *"centered"*; lower Complexity slider |

[Sources: r/StableDiffusion threads (u/Broken-Arrow-D07); Ambience AI tutorial; Civitai "Z-Image Turbo vs Krea 2" article.]

---

## 15. DIFFERENCES FROM FLUX / SDXL / Z-IMAGE / ANIMA

| Aspect | Krea 2 | FLUX (Dev/Pro) | SDXL | Z-Image Turbo | Anima |
|---|---|---|---|---|---|
| **Format** | Natural-language prose, 5-layer formula | Email/URL | Comma-separated tags | Single flowing prose paragraph (~750 words max) | Comma-separated Danbooru tags, dual positive/negative |
| **Negative prompt** | **No** (CFG=0) | Respected | Heavily respected | **No** (CFG=0) | **Yes** (concise tag list) |
| **Quality tags** | **No** | Marginal | **Yes** (`masterpiece, best quality`) | **No** (anti-pattern) | **Yes** (`masterpiece, best quality, score_7`) |
| **Weight syntax** | **No** | Marginal | **Yes** `(keyword:1.3)` | **No** (rarely) | **Yes**, multiply SDXL weight by 1.5 |
| **Midjourney params** | **No** | **No** | Marginal | **No** | **No** |
| **Sweet-spot length** | 30–80 words | 30–60 words | 50–100 words | 150–300 words | ~50 tags + ~10 negatives |
| **Variants** | Medium / Large / Turbo | Dev / Pro / Schnell | Base + Refiner | (single) | Base / Aesthetic / Turbo |
| **Style control** | Creativity slider (Raw/Low/Medium/High) | (none) | (none) | (embedded in prompt) | Variant selector |
| **Typography** | **Strong** (quotes + Low creativity) | Quoted strings | Variable | (out of scope) | Single words only |
| **Architecture** | DiT, from-scratch, Qwen3-VL | DiT, FLUX-derived | UNet | DiT, Qwen3-4B | DiT, Qwen-3 0.6B |
| **Open weights** | Yes (Community License v1) | Yes (FLUX.1-dev non-commercial) | Yes (OpenRAIL) | Yes | **No** |
| **License** | Community License v1 (non-commercial) + Commercial | FLUX.1-dev: non-commercial; FLUX.1-pro: commercial | OpenRAIL | Tongyi-MAI | CircleStone Labs Non-Commercial v1.2 |

**Key contract divergence for the image-to-prompt project:** the Krea 2 contract is the **most prose-strict** of all four targets. Where Z-Image Turbo is long-prose with pastel-focal-glow vocabulary and Anima is dual-tag-list, Krea 2 is **single short-medium prose paragraph** with **no negative, no weights, no quality tags**. The Stage-2 system prompt must condition on this — emit one paragraph in 30–80 words (or up to 140 for complex scenes), no negative, no `masterpiece`/`best quality`, no `(keyword:1.3)`.

---

## 16. LICENSE / COMMERCIAL USE

| Use case | License | Notes |
|---|---|---|
| **Personal / non-commercial use of generated images** | Krea Community License v1 (covered) | No restrictions on output |
| **Personal / non-commercial prompt-engineering for Krea 2** | Krea Community License v1 (covered) | This is what the image-to-prompt project does |
| **Open-weights download for non-commercial use** | Krea Community License v1 (covered) | Per `krea.ai/krea-2-licensing` |
| **Self-hosting Krea 2 behind a paid API** | **Krea Commercial License required** | Per `krea.ai/open-source-pricing` |
| **Fine-tuning Krea 2 weights for redistribution** | **Krea Commercial License required** | Per `krea.ai/open-source-pricing` |
| **Embedding Krea 2 weights in a commercial product** | **Krea Commercial License required** | Per `krea.ai/open-source-pricing` |

**For this project:** the image-to-prompt project emits **prompts only**. We do not embed Krea 2 weights, host Krea 2 inference, or integrate with paid Krea 2 APIs. The Krea Community License v1 covers prompt-engineering. The Krea Commercial License boundary is not crossed. (This matches ADR 0021's license-boundary reasoning for Anima.)

---

## 17. QUICK-REFERENCE STYLE BLOCK (copy/paste)

For use as a Stage-2 system-prompt preamble, the project's `DEFAULT_KREA2_STAGE2_PROMPT` constant can be derived from the following skeleton:

```
You are an expert prompt engineer for the Krea 2 text-to-image model
(Krea AI, Diffusion Transformer with Qwen3-VL text encoder, default CFG=0).

You transform a structured visual analysis into a single Krea 2 prose prompt.

# CONTRACT

- Single natural-language paragraph in English. NOT a tag list.
- 5-layer formula: Subject + Setting + Lighting/Mood + Style/Medium + Composition.
- Length: 30–80 words for controlled images; 80–140 for complex scenes.
  Never below 5 words. Never above 140 words.
- DO NOT use weight syntax "(keyword:1.3)" — not parsed.
- DO NOT use quality tags ("masterpiece, best quality, 8K, ultra detailed") — anti-pattern.
- DO NOT use Midjourney parameters ("--ar", "--s", "--v", "--niji") — not parsed.
- DO NOT emit a negative prompt. Krea 2's CFG=0 ignores it. Default Creativity = Medium.
- DO NOT depict light with glow vocabulary ("halo of light," "neon glow"). Use physical light sources.
- For in-image text, use double quotes around the literal string AND recommend Creativity = Low.
- Specify the rendering medium explicitly ("photorealistic 35 mm film photograph," "oil painting," "3D render," "risograph print").
- Lighting clauses name a physical source ("soft window light from the left," "hard directional sunlight from the upper right").

# OUTPUT SHAPE

- Single string. No JSON, no labels, no preamble, no explanation.
- The user's selected aspect ratio is emitted separately as metadata.
- The user's selected Creativity level (default Medium) is emitted separately as metadata.

# VARIANT BEHAVIOR

- If Creativity = Raw: stay close to the literal prompt, fill only obvious gaps.
- If Creativity = Low: stay close to the literal prompt, restrained.
- If Creativity = Medium (default): balanced interpretation.
- If Creativity = High: take meaningful creative liberty with style, mood, and aesthetics.

# CREATIVITY METADATA

Emit the recommended Creativity value as a separate field:
  creativity: "low" | "medium" | "high"
For in-image text, default to "low".
For everything else, default to "medium".
```

---

## 18. CITATION INDEX

| # | Source | Type |
|---|---|---|
| 1 | `krea.ai/krea-2` | Vendor primary — model identity, marketing |
| 2 | `krea.ai/blog/krea-2-technical-report` | Vendor primary — architecture (DiT, iREPA, Qwen3-VL, GQA, sigmoid-gated attention) |
| 3 | `krea.ai/blog/krea-2-deep-dive-walkthrough` | Vendor primary — 5-layer prompt formula, typography rule, style-reference workflow, "Fix in this order" troubleshooting |
| 4 | `krea.ai/docs/user-guide/features/krea-2` | Vendor primary — variants (Medium/Large/Turbo), Creativity slider (Raw/Low/Medium/High), Generative Sliders |
| 5 | `krea.ai/docs/developers/krea-2/overview` | Vendor primary — REST API surface, parameters |
| 6 | `krea.ai/krea-2-licensing` | Vendor primary — Krea Community License v1 (2026-06-22) |
| 7 | `krea.ai/open-source-pricing` | Vendor primary — Commercial License terms |
| 8 | `huggingface.co/krea/Krea-2-Raw` | Vendor primary — HuggingFace model card (open weights, from-scratch DiT) |
| 9 | r/StableDiffusion (u/cadissimus, u/LowCatch4324, u/meshyai, u/Broken-Arrow-D07) | Community — worked examples, multi-character handling, hand/hair failure modes |
| 10 | Ambience AI tutorial — `ambienceai.com/tutorials/krea-2-prompting-guide` | Community — five-attribute stack, worked examples |
| 11 | Civitai "Z-Image Turbo vs Krea 2" article | Community — prompt-format differences, CFG=0 behavior |
| 12 | Krea X account (`@krea_ai`) with `#krea2` hashtag | Vendor social — sample prompt/output pairs |

**Document confidence:** High. The 5-layer formula, the absolute prohibitions (no tags / no weights / no quality / no negative), the 30–80-word sweet spot, the typography-in-quotes rule, and the Creativity slider values are all verified against primary `krea.ai` documentation. Community patterns are corroborated across r/StableDiffusion, Ambience AI, Civitai, and Krea's own X account. Parameter count is **not disclosed** by Krea; third-party coverage has referenced "12B" but Krea does not confirm. The Krea X account and the HF model card together cover every major contract claim.