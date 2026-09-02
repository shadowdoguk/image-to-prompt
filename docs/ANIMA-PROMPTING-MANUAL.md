# ANIMA — PROMPTING MANUAL
## For: Anime / Illustration / Non-Photorealistic Style Generation
### Target Runtimes: ComfyUI, ComfyUI-Manager, and the 7 author-endorsed online platforms (CivitAI, TensorArt, KusArt, IMGNAI, mage, AliveAI, DreamerLand)

> **Document purpose:** A *practitioner's* reference for the Anima model line. The job of this document is to translate an artist's or operator's visual intent into Anima prompts that hit the model's design points. **Read §1 (Identity) and §3 (Variants) before writing prompts.** §6 (Worked Examples) is the closest thing to a "starter library." §7 (Failure Modes) lists what *not* to expect.
>
> **Document version:** 1.0
> **Compiled:** 2026-08-03
> **Primary source:** `circlestone-labs/Anima` model card & repo on HuggingFace (README.md, LICENSE.md, anima_comparison.json).
> **Target model:** Anima by **CircleStone Labs** (in collaboration with Comfy Org). Variant-specific guidance is called out inline.
> **Last verified against repo:** 2026-08-03 (commit `f7382c4bf9d7ffe4ceea593a0adbb470c56dd79b`, last commit by `tdrussell`, 2026-07-24).

---

## TABLE OF CONTENTS

1. Model Identity
2. Variants — which one to pick
3. Architecture — what the operator must know
4. Hard Specs (token / resolution / sampler / CFG / steps)
5. Absolute Rules (never violate)
6. Core Vocabulary Banks
7. Prompt Structure
8. Hybrid Tag + Natural-Language Prompting
9. Worked Examples
10. Self-Review Checklist
11. ComfyUI-Specific Configuration
12. Online-Platform Configuration
13. LoRA / Finetuning Tips
14. Failure Modes and How to Recover
15. Differences from FLUX / SDXL / SD3.5
16. License / Commercial Use
17. Quick-Reference Style Block (copy/paste)
18. Citation Index

---

## 1. MODEL IDENTITY

| Field | Value |
|---|---|
| **Name** | **Anima** (v1.0 line) |
| **Authors** | CircleStone Labs LLC (in collaboration with Comfy Org) |
| **Maintainer** | `tdrussell` (HuggingFace); commercial contact `tdrussell@circlestone.ai` |
| **Architecture** | Diffusion Transformer (DiT), text-to-image, **2 billion parameters** (diffusion model only) |
| **Base model** | Fine-tune of **NVIDIA Cosmos-Predict2-2B-Text2Image** |
| **Text encoder** | **Qwen-3 0.6B base** (`qwen_3_06b_base.safetensors`) |
| **VAE** | **Qwen-Image VAE** (`qwen_image_vae.safetensors`) — shared across Qwen-Image-family models, you may already own it |
| **Training data** | Several million anime images + ~800 k non-anime artistic images. No synthetic data. Anime knowledge cut-off: **September 2025** |
| **Output** | 2D still images only (no video, no audio) |
| **License** | CircleStone Labs Non-Commercial License v1.2 (custom) + NVIDIA Open Model License (as a Derivative Model of Cosmos) |
| **GitHub** | The author's training script `diffusion-pipe` (linked from the README) |
| **Where to discuss** | HuggingFace Discussions tab on the repo (226 threads; 206 open, 20 closed as of 2026-08-03) |

**Mental model in one sentence:** Anima is a 2B Cosmos-derived anime specialist with a Qwen-3 text encoder that explicitly accepts both Danbooru-style tags and natural-language captions, with three shipped variants that trade flexibility vs. consistency vs. speed.

[Source: `circlestone-labs/Anima/README.md`, accessed 2026-08-03.]

---

## 2. VARIANTS — WHICH ONE TO PICK

Anima ships in **three flavors**. The author recommends starting with **Anima-Turbo** and only switching away if you have a specific reason. The decision tree:

```
Need raw speed / cheap iteration? ─── YES ──► Anima-Turbo
                                          │
                                          NO
                                          │
Need best consistency / aesthetics? ── YES ──► Anima-Aesthetic (v1.1)
                                          │
                                          NO
                                          │
Want to train a LoRA, or need maximum tag fidelity? ── YES ──► Anima-Base
                                                  │
                                                  NO
                                                  │
                                                  ▼
                                                Anima-Aesthetic (default safe choice)
```

| Variant | File | Purpose | Recommended CFG | Recommended steps | Best for |
|---|---|---|---|---|---|
| **Anima-Turbo v1.0** | `anima-turbo-v1.0.safetensors` | Distilled, fast inference; weak default style baked in | **1** | **8–12** | Quick iteration, online platforms where step count is billed, anything that benefits from a stable default style |
| **Anima-Aesthetic v1.1** | `anima-aesthetic-v1.1.safetensors` | Fine-tuned for higher consistency and a better default art style | **4–6** | **30–50** | Final-render quality, "I just want a good image" defaults |
| **Anima-Aesthetic v1.0** | `anima-aesthetic-v1.0.safetensors` | Earlier Aesthetic, with stabilization LoRAs merged in. Author says v1.1 supersedes it. | **4–6** | **30–50** | Reproducing older results, comparing v1.0↔v1.1 |
| **Anima-Aesthetic v1.0b** | `anima-aesthetic-v1.0b.safetensors` | Pure aesthetics full finetune without the additional stabilization LoRAs. Author notes "I personally think 1.0 is better." | **4–6** | **30–50** | Reproducing the diff between a "raw" aesthetic fine-tune and the merged v1.0 |
| **Anima-Base v1.0** | `anima-base-v1.0.safetensors` | The pretrained, unrefined base. Plain / neutral default style. | **4–6** | **30–50** | **LoRA training. Full stop.** Do not train LoRAs on any variant except Base. |

**Author's recommendation (verbatim):** "I recommend starting with Anima-Turbo. On average, it is only slightly worse than Anima-Aesthetic, while being very fast to generate (and much cheaper if you use it on an online platform that scales the cost with step count). This makes it very convenient for quickly iterating on prompts. The increased stability can even make it better than Aesthetic in some cases."

> **Operator's note:** The author ships these as separate, un-mergeable checkpoints. They are not stacked — you pick one file and run it. The diffusers-format mirror `circlestone-labs/Anima-Base-v1.0-Diffusers` exists if you want to load the base in `diffusers`-style code rather than ComfyUI.

[Source: `circlestone-labs/Anima/README.md` "Versions" section, accessed 2026-08-03.]

---

## 3. ARCHITECTURE — WHAT THE OPERATOR MUST KNOW

You don't need code-level understanding, but you do need to know *what kind of text the model reads*, because the answer is **both tags and prose** — it is not a pure-tag model (Pony) and not a pure-prose model (FLUX).

| Component | What it is | Prompting implication |
|---|---|---|
| **Text encoder** | Qwen-3 0.6B base — a small but capable *LLM* used as the text encoder. Not CLIP, not T5. | Reads English sentences as well as comma-separated tag lists. Handles context, modification relationships, spatial arrangement. The model is "LLM-encodered" in the same family as the Qwen-Image line. |
| **LLM adapter** | A learned adapter between the Qwen-3 text encoder and the diffusion model. | **DO NOT train the LLM adapter when you LoRA-tune.** (See §13.) The adapter "contains a surprising amount of knowledge and is easy to degrade by training it." |
| **Diffusion transformer** | 2B DiT, Cosmos-derived, single-stream. | Standard flow-matching diffusion behavior. Cosmostrain inherits from NVIDIA Cosmos-Predict2-2B. |
| **VAE** | Qwen-Image VAE (shared family). | If you already run Qwen-Image / Qwen-video / similar, you can reuse the VAE file. Do not substitute a SD-VAE. |
| **Scheduler** | User-pickable in ComfyUI (the README lists `er_sde`, `euler_a`, `dpmpp_2m_sde_gpu`, `euler`, and optionally `beta57` via RES4LYF). | Anima gives you meaningful sampler choice. See §4. |
| **Dataset tags** | The text encoder was trained on three lineages: Danbooru, LAION-POP (ye-pop), and DeviantArt (non-photos filtered out). | Markdown-style dataset tags (`ye-pop`, `deviantart`) on the first line of the prompt unlock non-anime styles. Without these, non-anime prompts underperform. |

[Source: `circlestone-labs/Anima/README.md` "Installing and running" + "Dataset tags" sections, accessed 2026-08-03.]

---

## 4. HARD SPECS

### 4.1 Resolution

> "Works at resolutions between 512² and 1536² pixels."

- **Square-only guidance.** The author only documents square resolutions. The underlying Cosmos architecture supports multi-aspect, but the author does not document or recommend non-square outputs.
- **512²** is the lower bound. Below that, quality and composition degrade.
- **1536²** is the upper bound. Above that, the model produces artifacts.
- **Sweet spot:** 1024² to 1280² for portraits and single-character scenes. Larger for multi-character or environment-heavy scenes.

### 4.2 Sampler / Scheduler

The author's recommended favorites (in their own order):

| Sampler | Character | When to use |
|---|---|---|
| **`er_sde`** | Neutral style, flat colors, sharp lines. | **Default.** Pick this if you don't know. |
| **`euler_a`** | Softer, thinner lines. Can tend 2.5D. CFG can be pushed higher than other samplers without burning the image. | Painterly / soft style. |
| **`dpmpp_2m_sde_gpu`** | Similar to `er_sde` but more variety / "creative". Can sometimes get too wild. | When you want the model to surprise you. |
| **`euler`** | Basic, a bit more creative than `er_sde`. | Turbo and Aesthetic variants — works well because they're naturally more stable. |
| **`beta57`** (RES4LYF custom node) | Puts more weight on low-noise timesteps → better textures. | Realistic / painterly look. Requires ComfyUI RES4LYF custom node pack. |

**Operator's rule of thumb:** If you don't know, start with `er_sde` + 30 steps + CFG 4.5.

### 4.3 CFG / Guidance

| Variant | Recommended CFG |
|---|---|
| Anima-Base | **4–6** |
| Anima-Aesthetic (v1.0, v1.0b, v1.1) | **4–6** (can tolerate as low as 3) |
| Anima-Turbo | **1** (distilled; CFG > 1 will over-cook the image) |

### 4.4 Steps

| Variant | Recommended steps |
|---|---|
| Anima-Base | **30–50** |
| Anima-Aesthetic | **30–50** |
| Anima-Turbo | **8–12** |

### 4.5 Token limit / prompt length

**Not explicitly disclosed by the author.** Inferred from Qwen-3 0.6B's context window: likely 8 192–32 768 tokens, but the model has no documented "*prompt length sweet spot*" or hard cap. Empirical guidance:

- For tag-style prompts, the longest example in the README is ~50 tags.
- For natural-language prompts, the README warns "Extremely short prompts can give unexpected results" and recommends "at least 2 sentences."
- **A practical cap of ~500 tokens** is a sensible default until the community shares a contradicting benchmark.

[Source: `circlestone-labs/Anima/README.md` "Generation settings" section, accessed 2026-08-03.]

---

## 5. ABSOLUTE RULES (NEVER VIOLATE)

These are hard rules. Break them and you get worse results, not better.

### R1. Lowercase tags only, spaces (not underscores) — except `score_*`.

```
✓  masterpiece, best quality, score_7, 1girl, long hair, blue eyes
✗  Masterpiece, best_quality, SCORE_7, 1Girl, long_hair, blue_eyes
```

The `score_*` family is the *only* tag family that retains underscores. Every other tag is `lowercase with spaces`.

### R2. Artist tags require a leading `@`.

```
✓  @wlop, @ask, @big chungus
✗  wlop, ask, big chungus
```

The author: "You must put `@` in front of the artist. **The effect will be very weak if you don't.**"

### R3. On Aesthetic variants, do not use `score_*` in either prompt.

The author: "I recommend **not** using `score_*` tags in both the positive and negative prompt. It is already high quality enough and the score tags can push it too hard into slop territory."

(You can still use `masterpiece, best quality` on Aesthetic — those are safe to leave in.)

### R4. Tag order is fixed — five sections, in this order.

```
[quality/meta/year/safety] [count] [character] [series] [artist] [general tags]
```

Within each section, the order of tags is arbitrary. The section order is **not** arbitrary.

### R5. If you want non-anime output, put a dataset tag on line 1.

```
ye-pop
For Sale: Others by Arun Prem
Abstract, oil painting of three faceless, blue-skinned figures…
```

or

```
deviantart
Flame
Digital painting of a fiery dragon with glowing yellow eyes…
```

Line 1 = dataset tag. Line 2 = alt-text (ye-pop) or title (deviantart). Line 3+ = the caption. Without line 1, non-anime prompts underperform.

### R6. Multi-character prompts must describe each character's appearance.

If you just list character names, the model confuses them. Name the character, then describe hair, eye color, outfit.

```
✗  1girl, oomuro sakurako, furutani himawari, yuru yuri
✓  1girl, oomuro sakurako, yuru yuri, brown hair, brown eyes, hat, santa costume,
    1girl, furutani himawari, yuru yuri, orange hair, ponytail, school uniform
```

### R7. Use the recommended positive prefix on Base/Turbo.

```
masterpiece, best quality, score_7, safe,
```

On Aesthetic, drop `score_7` (and require `score_*` to be absent by R3).

### R8. Use the recommended negative.

```
worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration
```

(Adjust `score_1, score_2, score_3` away per R3 if on Aesthetic.)

### R9. Do not try to do realism.

Out of scope. The model is anime / illustration / art focused. If you attempt photorealism, you'll get a subpar result.

### R10. Do not ask for long-form text rendering.

Single words sometimes work. Short phrases rarely. Long sentences won't render correctly.

### R11. Don't try to train the LLM adapter.

In LoRA training: set `llm_adapter_lr=0` (or its equivalent in your trainer). The LLM adapter is sensitive; training it degrades the model.

### R12. When a tag differs between Danbooru and Gelbooru, prefer Gelbooru.

The Qwen-3 text encoder was trained with Gelbooru-favored tagging conventions. Using Danbooru variants of ambiguous tags can produce weaker results.

[Source: `circlestone-labs/Anima/README.md` "Prompting", "Aesthetic Version Prompting", "Tag order", "Artist tags", "Dataset tags", "Natural language prompting tips", "Limitations", "Finetuning Tips" sections, accessed 2026-08-03.]

---

## 6. CORE VOCABULARY BANKS

These are the *tag atoms* that reliably do work. Think of them as knapsack items you can throw in.

### 6.1 Quality tags — pick from one or both vocabularies

**Human-score (less aggressive, safer):**
```
masterpiece, best quality, good quality, normal quality, low quality, worst quality
```

**PonyV7 aesthetic-score (more aggressive, do not use on Aesthetic variant):**
```
score_9, score_8, score_7, score_6, score_5, score_4, score_3, score_2, score_1
```

You can use either vocabulary, both, or neither. The most common pattern is `masterpiece, best quality, score_7,` on Base/Turbo.

### 6.2 Time-period tags

```
year 2025, year 2024, year 2023, year 2022, ...
newest, recent, mid, early, old
```

The author doesn't specify a hard mapping from period-tag to dataset year, but the model treats "year 2025" as a fresher-cut pull than "year 2018."

### 6.3 Meta tags

```
highres, absurdres, anime screenshot, jpeg artifacts, official art, sketch, lineart, monochrome, greyscale
```

`highres` and `absurdres` boost the model's willingness to commit fine detail. `jpeg artifacts` and `chromatic aberration` are useful in the *negative* prompt to suppress compression / lens effects.

### 6.4 Safety tags

```
safe, sensitive, nsfw, explicit
```

Only one of these per prompt. The default is `safe`. The author's analysis thread repeatedly warns: "The model may generate undesired content, especially if the prompt is short or lacking details. Avoid this by using the appropriate safety tags in the positive and negative prompts, and by writing sufficiently detailed prompts."

### 6.5 Artist tags

The model knows a large vocabulary of artist names. **`@`-prefix is mandatory.** Without it, the effect is weak.

```
@wlop, @ask, @Ross Tran, @guweiz, @Ilya Kuvshinov, @wlou, @big chungus
```

(Anima knows many artists; the few listed here are for the canonical example. The exact territory of artists is large and not enumerated by the author.)

### 6.6 Character / series tags

The model knows massive Danbooru / anime IP. Standard Danbooru character names and series names work.

```
1girl, oomuro sakurako, yuru yuri,
2girls, oomuro sakurako, furutani himawari, yuru yuri,
```

`1girl` / `2girls` / `1boy` / `1other` are the count tags. The author doesn't document `multiple girls` as an alternative — the convention is numeric.

### 6.7 General tags

Whatever describes the image. The author gives the rule of thumb: "Tag dropout is built-in. You don't need to include every single relevant tag for the image." So tag generously, but don't try to enumerate every possible attribute.

Common high-frequency tags:
```
solo, looking at viewer, smile, open mouth, simple background, white background, upper body, full body, standing, sitting, outdoors, indoor, day, night, …
```

### 6.8 Dataset tags (line 1)

```
ye-pop           # unlocks LAION-POP (ye-pop) non-anime artistic styles
deviantart       # unlocks DeviantArt non-anime artistic styles
```

These are *not* style tags. They are *lineage* tags. They tell the model which training subset to attend to. Use them when you want a non-anime output.

### 6.9 Weighting syntax

Standard `(word:N)` syntax works, but you need stronger N than SDXL.

```
(chibi:2)        # roughly equivalent to (chibi:1.3) on SDXL
```

Rule of thumb: **multiply your SDXL weight by ~1.5** to get the equivalent strength on Anima.

[Source: `circlestone-labs/Anima/README.md` "Quality tags", "Time period tags", "Meta tags", "Safety tags", "Artist tags", "Full tag example", "Tag dropout", "Dataset tags", and Top-of-Prompting section, accessed 2026-08-03.]

---

## 7. PROMPT STRUCTURE

### 7.1 The full positive template (Base / Turbo)

```
[quality/meta/year/safety]      ← masterpiece, best quality, score_7, year 2025, newest, highres, safe,
[count]                          ← 1girl, 2girls, 1boy, 1other, etc.
[character]                      ← oomuro sakurako,
[series]                         ← yuru yuri,
[artist]                         ← @nnn yryr,
[general tags]                   ← smile, brown hair, hat, solo, fur-trimmed gloves, …
```

### 7.2 The full negative template

```
worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration
```

### 7.3 The multi-character variant

Add multiple `[character] [series] [general tags]` clusters, one per character, with the count tag up top being the sum.

```
masterpiece, best quality, score_7, safe,
2girls, oomuro sakurako, yuru yuri, brown hair, brown eyes, hat, santa costume,
1girl, furutani himawari, yuru yuri, orange hair, ponytail, school uniform,
@nnn yryr,
```

### 7.4 The Aesthetic variant

Drop `score_7` from the positive prefix. Drop `score_1, score_2, score_3` from the negative. Keep `masterpiece, best quality,` at the top.

```
masterpiece, best quality, year 2025, newest, highres, safe,
1girl, …,
```

```
worst quality, low quality, artist name, blurry, jpeg artifacts, chromatic aberration
```

### 7.5 The non-anime variant (oil-painting / digital-art)

Lead with the dataset tag. Add a generic-image-style phrase.

```
ye-pop
For Sale: Others by Arun Prem
Abstract, oil painting of three faceless, blue-skinned figures. Left: white, draped figure; center: yellow-shirted, dark-haired figure; right: red-veiled, dark-haired figure carrying another. Bold, textured colors, minimalist style.
```

```
deviantart
Flame
Digital painting of a fiery dragon with glowing yellow eyes, black horns, and a long, sinuous tail, perched on a glowing, molten rock formation. The background is a gradient of dark purple to orange.
```

### 7.6 The natural-language variant

```
masterpiece, best quality, @big chungus. An anime girl with medium-length blonde hair is standing in a sunlit meadow, looking back at the viewer with a slight smile, wind blowing through her hair, soft pastel sky in the background.
```

Note: the leading quality / artist tags are still tag-style. The description is free prose. Mixing is encouraged.

### 7.7 The named-character natural-language variant

```
masterpiece, best quality, safe. Digital artwork of Fern from Sousou no Frieren, with long purple hair and purple eyes, wearing a black coat over a white dress with puffy sleeves, standing in a forest clearing at dusk, holding a staff.
```

Author's note: "This is extra important when prompting for multiple characters. If you just list off character names with no description of appearance, the model can get confused."

[Source: `circlestone-labs/Anima/README.md` "Tag order", "Full tag example", "Aesthetic Version Prompting", "Dataset tags", "Natural language prompting tips", accessed 2026-08-03.]

---

## 8. HYBRID TAG + NATURAL-LANGUAGE PROMPTING

Anima was explicitly trained on **all three** of: Danbooru tags, natural-language captions, and combinations. The README is unambiguous: "You can mix tags and natural language in arbitrary order."

### 8.1 When to use pure tags

- Single-character, well-known IP scenes.
- Style exploration (you want to dial-in a specific gallery of artist / vibe).
- Quick iteration (tags are faster to type than prose).

### 8.2 When to use pure natural language

- Multi-character scenes where tag-multiplication gets unreadable.
- Unusual compositions the tag vocabulary doesn't have a word for.
- "Concept art" framing where the description is the point.

### 8.3 When to use hybrid (recommended default)

- Anything where you want quality control *and* nuance. Hybrid lets you lead with the safety/quality bucket and explain the scene in prose.

### 8.4 Style-mixing rules

- Tags come first, prose after. Don't bury a quality tag deep inside prose.
- Artist names belong in the tag prefix, even if the rest is prose.
- You can put character names in tags even if the rest is prose.

[Source: `circlestone-labs/Anima/README.md` "Natural language prompting tips" section, accessed 2026-08-03.]

---

## 9. WORKED EXAMPLES

All examples are reproduced verbatim from the README unless otherwise noted.

### 9.1 The canonical full tag example (Base / Turbo)

The README's headline example — a single-character, full-positive tag dump:

```
year 2025, newest, normal quality, score_5, highres, safe, 1girl, oomuro sakurako, yuru yuri, @nnn yryr, smile, brown hair, hat, solo, fur-trimmed gloves, open mouth, long hair, gift box, fang, skirt, red gloves, blunt bangs, gloves, one eye closed, shirt, brown eyes, santa costume, red hat, skin fang, twitter username, white background, holding bag, fur trim, simple background, brown skirt, bag, gift bag, looking at viewer, santa hat, ;d, red shirt, box, gift, fur-trimmed headwear, holding, red capelet, holding box, capelet
```

**Settings to pair with this:** Anima-Base, `er_sde`, 30 steps, CFG 4.5, 1024².

### 9.2 The minimal positive prefix

```
masterpiece, best quality, score_7, safe,
```

This is the recommended positive prefix. Use it as the first four tokens (or drop `score_7` on Aesthetic) before any other content.

### 9.3 The recommended negative

```
worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration
```

### 9.4 Hybrid opening (tags + prose)

```
masterpiece, best quality, @big chungus. An anime girl with medium-length blonde hair is standing in a sunlit meadow, looking back at the viewer with a slight smile, wind blowing through her hair, soft pastel sky in the background.
```

### 9.5 Named character prose

```
masterpiece, best quality, safe. Digital artwork of Fern from Sousou no Frieren, with long purple hair and purple eyes, wearing a black coat over a white dress with puffy sleeves, standing in a forest clearing at dusk, holding a staff.
```

Author's note: name the character, *then* describe their appearance. Don't list names without descriptions.

### 9.6 Weighted tag

```
(chibi:2)
```

### 9.7 Non-anime: ye-pop (oil-painting)

```
ye-pop
For Sale: Others by Arun Prem
Abstract, oil painting of three faceless, blue-skinned figures. Left: white, draped figure; center: yellow-shirted, dark-haired figure; right: red-veiled, dark-haired figure carrying another. Bold, textured colors, minimalist style.
```

### 9.8 Non-anime: deviantart (digital painting)

```
deviantart
Flame
Digital painting of a fiery dragon with glowing yellow eyes, black horns, and a long, sinuous tail, perched on a glowing, molten rock formation. The background is a gradient of dark purple to orange.
```

### 9.9 Aesthetic variant (drop score_*)

```
masterpiece, best quality, year 2025, newest, highres, safe,
1girl, oomuro sakurako, yuru yuri, @nnn yryr, smile, brown hair, hat, santa costume,
```

(Notice: no `score_*` tag, per R3.)

### 9.10 Turbo variant (fast iteration)

```
masterpiece, best quality, score_7, safe, 1girl, oomuro sakurako, yuru yuri, @nnn yryr, smile, brown hair, hat, santa costume,
```

Settings: Anima-Turbo, `er_sde` or `euler`, 8–12 steps, **CFG 1** (not 4–6).

### 9.11 Multi-character, multi-cluster

```
masterpiece, best quality, score_7, safe,
2girls, oomuro sakurako, yuru yuri, brown hair, brown eyes, hat, santa costume, smiling,
1girl, furutani himawari, yuru yuri, orange hair, ponytail, school uniform, surprised,
@nnn yryr,
indoor, warm lighting, gift exchange,
```

### 9.12 Painterly / realistic look (uses beta57 scheduler)

```
masterpiece, best quality, score_7, safe, 1girl, oomuro sakurako, portrait, oil painting, soft lighting, muted palette, looking at viewer,
```

Settings: Anima-Base, **beta57** scheduler (ComfyUI RES4LYF custom node), `er_sde`, 30 steps, CFG 4.5, 1024².

> **Note on the example image:** The repo's `example.png` is a ComfyUI workflow screenshot, not a generated-image sample. The `montage.jpg` is a multi-image collage assembled by the author. Useful for visual reference, but the prompts above are the canonical text examples.

[Source: `circlestone-labs/Anima/README.md` "Full tag example", "Generation settings", "Tips" sections, accessed 2026-08-03.]

---

## 10. SELF-REVIEW CHECKLIST

Before submitting any Anima prompt, run through this checklist:

### 10.1 Lowercase and spacing (R1)
- [ ] All tags are lowercase.
- [ ] Tags are separated by spaces (not underscores), except `score_*` which keeps underscores.
- [ ] Tags are comma-separated.

### 10.2 Artist tags (R2)
- [ ] Every artist tag has a leading `@`.

### 10.2a Danbooru/Gelbooru conflicts (R12)
- [ ] When a tag differs between Danbooru and Gelbooru, the Gelbooru variant is used.

### 10.3 Variant-appropriate quality tags (R3, R7)
- [ ] On Base / Turbo: positive prefix contains `masterpiece, best quality, score_7, safe,`.
- [ ] On Aesthetic: positive prefix contains `masterpiece, best quality,` (no `score_7`).
- [ ] On Aesthetic: no `score_*` tag in either prompt.

### 10.4 Tag order (R4)
- [ ] Quality/meta/year/safety tags are first.
- [ ] Count tag (`1girl`, `2girls`, etc.) comes next.
- [ ] Character → series → artist → general tags follow.

### 10.5 Non-anime routing (R5)
- [ ] If the scene is non-anime, the prompt starts with `ye-pop` or `deviantart` on line 1.

### 10.6 Multi-character (R6)
- [ ] Each character has a description of hair, eye color, and outfit — not just a name.

### 10.7 Negative prompt (R8)
- [ ] Negative contains `worst quality, low quality,`.
- [ ] On Base / Turbo: `score_1, score_2, score_3` in negative.
- [ ] Negative contains `artist name` (so when you `@artist` someone, the model doesn't bleed *other* artists' styles in).
- [ ] Negative contains `blurry, jpeg artifacts, chromatic aberration`.

### 10.8 Realism / text rendering (R9, R10)
- [ ] Not asking for photorealism.
- [ ] Not asking for multi-word text rendering.

### 10.9 Sampler / CFG / steps match the variant (§4)
- [ ] Base: 30–50 steps, CFG 4–6.
- [ ] Aesthetic: 30–50 steps, CFG 4–6 (can tolerate as low as 3).
- [ ] Turbo: 8–12 steps, **CFG 1**.

### 10.10 Resolution is in [512², 1536²] (R-spec)
- [ ] Output is square and within the supported range.

### 10.11 Weighting (R-weights)
- [ ] If using `(word:N)`, N is ~1.5× what an SDXL-er would use.

### 10.12 LoRA training sanity (R11, if applicable)
- [ ] If LoRA training, LLM adapter is frozen (`llm_adapter_lr=0` or equivalent).
- [ ] LoRA learning rate is low (2e-5 starting point for rank-32).

---

## 11. COMFYUI-SPECIFIC CONFIGURATION

### 11.1 File placement

The model is "natively supported in ComfyUI" per the README. Place each component:

| File | Target directory |
|---|---|
| `anima-base-v1.0.safetensors` (and other variants) | `ComfyUI/models/diffusion_models/` |
| `qwen_3_06b_base.safetensors` | `ComfyUI/models/text_encoders/` |
| `qwen_image_vae.safetensors` | `ComfyUI/models/vae/` (you may already have this if you run Qwen-Image) |

### 11.2 ComfyUI workflow nodes (minimum)

A working Anima ComfyUI workflow needs:

- **Load Checkpoint** → `anima-turbo-v1.0.safetensors` (or your chosen variant)
- **CLIPTextEncode (positive)** → text input: your prompt
- **CLIPTextEncode (negative)** → text input: your negative prompt
- **Empty Latent Image** → set width and height to your chosen square resolution (e.g., 1024 × 1024)
- **KSampler** → sampler = `er_sde`, steps = 30 (or 10 for Turbo), cfg = 4.5 (or 1 for Turbo), denoise = 1
- **VAE Decode** → uses the Qwen-Image VAE
- **Save Image** → output

### 11.3 The `anima_comparison.json` workflow

The author ships a ComfyUI workflow (`anima_comparison.json`, 41 KB) that generates a **grid of images** for comparing multiple models side-by-side. Configurable model list: Anima, SDXL, Lumina, Chroma, Newbie-Image. **Default configuration compares Anima vs NetaYume vs Newbie-Image.** Use it to:

- Compare Anima against other anime-class models.
- See how the same prompt produces different outputs across architectures.
- Run a fixed seed comparison across checkpoints.

> **Note:** This workflow is a JSON node-graph; inspect it for embedded prompts if you want a starting point.

[Source: `circlestone-labs/Anima/README.md` "Installing and running" section, accessed 2026-08-03. File listing from `circlestone-labs/Anima/tree/main`, accessed 2026-08-03.]

---

## 12. ONLINE-PLATFORM CONFIGURATION

The author officially endorses seven platforms (verbatim from the README):

| Platform | URL | Notes |
|---|---|---|
| **CivitAI** | https://civitai.com/models/2458426/anima | Author's model page on CivitAI. Has community examples. |
| **TensorArt** | https://tensor.art/models/998619401697644790/Anima-Official-circlestone_labs-base-v1.0 | Hosted variant. |
| **KusArt** | https://kusart.com | — |
| **IMGNAI** | https://imgnai.com/ | — |
| **mage** | https://www.mage.space/ | — |
| **AliveAI** | https://aliveai.app/ | — |
| **DreamerLand** | https://www.dreamerland.ai/ | — |

**Operator's rule:** when using a hosted platform, the per-platform UI may not expose all knobs (sampler, CFG, steps). Most expose prompt and negative. If the default UI hides a knob but you know the right value, look for "Advanced" or "Settings" — on hosted platforms, Anima-Turbo is preferred because costs scale with step count.

[Source: `circlestone-labs/Anima/README.md` "Online platforms" section, accessed 2026-08-03.]

---

## 13. LoRA / FINETUNING TIPS

The author gives clear, terse guidance in the README:

### 13.1 Don't train the LLM adapter

> "Don't train the LLM adapter. My own training script, diffusion-pipe, lets you set `llm_adapter_lr=0` to completely disable training it, and the example config has this as the default. Other trainers like sd-scripts have similar options that should be used. The LLM adapter processes the text embeddings before they get to the diffusion model, and therefore has an outsized influence on the generated images. The adapter itself contains a surprising amount of knowledge and is easy to degrade by training it."

### 13.2 Use a low learning rate

> "Use a low learning rate. For a rank 32 LoRA, start with 2e-5 and adjust up or down from there. As a base model, there is no aggressive aesthetic tuning or RLHF you need to overcome when finetuning. The model has an extremely large and diverse amount of visual concepts baked in already. A light touch is all you need."

### 13.3 Train Base, not Aesthetic or Turbo

> "**Anima-Base** is the pretrained, unrefined base model. Maximum flexibility, diversity, and style adherence. LoRAs should be trained using this version."

Aesthetic variants have additional LoRA merges baked in; training on them compounds and degrades. Turbo is a distillation; LoRA training on a distillation is technically possible but not the author's recommendation.

### 13.4 Example LoRA reference

The author publishes an example style LoRA with dataset and configs:
- https://civitai.com/models/2536147

[Source: `circlestone-labs/Anima/README.md` "Finetuning Tips" section, accessed 2026-08-03.]

---

## 14. FAILURE MODES AND HOW TO RECOVER

Listed in the README's "Limitations" section, plus observed behaviors:

| Failure mode | What you'll see | Fix |
|---|---|---|
| **Realism attempt** | Output looks flat, generic, or "uncanny anime" | Stop. Anima is not designed for this. Use FLUX, SDXL, or a photorealism model. |
| **Long text rendering** | Garbled glyphs, random characters, gibberish | Stop. Single words / short phrases only. Use a typography-tuned model for long text. |
| **Short, vague prompt** | Nonsensical composition, missing subject, style drift | Add 2+ sentences of description. Use the recommended positive prefix. |
| **Multi-character confusion** | Characters blend, hair colors swap, outfits mix | Name each character, then describe their appearance. Use one cluster per character. |
| **Wrong artist style** | Bleed from other artists, weak style | Always `@`-prefix the artist. Add `artist name` to the negative prompt. |
| **Image is "boring" / unscoped** | Default style, generic composition | Add `masterpiece, best quality, score_7,` (Base/Turbo). Add an `@artist` tag. |
| **Aesthetic variant looks "slop-ish"** | Over-cooked, hyper-saturated, plastic | Drop `score_*` from both prompts (R3). Reduce CFG toward 4. |
| **Turbo looks over-cooked** | Sharp outlines, harsh shadows | Reduce CFG to 1 (do not let the UI default to 4–6). |
| **Resolution > 1536²** | Artifacts, blurriness, "soft" output | Reduce to ≤ 1536². |
| **Base without quality tags** | Plain, neutral, low-effort | Add `masterpiece, best quality, score_7,` (Base/Turbo) or use Aesthetic. |
| **Weighting has no effect** | `(chibi:1.3)` is invisible | Bump the weight to ~2.0 (1.5× SDXL norms). |
| **Non-anime output looks "off"** | Half-anime / half-realistic, weird composition | Add `ye-pop` or `deviantart` on line 1. |
| **LoRA degrades the model** | Mixed outputs, broken text encoder, garbled compositions | Freeze the LLM adapter (`llm_adapter_lr=0`). Lower the learning rate. |

[Source: `circlestone-labs/Anima/README.md` "Limitations" section + §13 (finetuning tips), accessed 2026-08-03.]

---

## 15. DIFFERENCES FROM FLUX / SDXL / SD3.5

Anima sits in a different **architecture lineage** than FLUX, SDXL, and SD3.5. The author does not ship a direct comparison, but the architectural differences are large enough to make this §15a useful.

| Dimension | Anima | FLUX (-dev / -schnell) | SDXL | SD3.5 |
|---|---|---|---|---|
| **Architecture** | 2B DiT, Cosmos-derived | 12B MM-DiT (Black Forest Labs) | 2.6B UNet + dual CLIP | 8B MM-DiT (three text encoders) |
| **Text encoder** | Qwen-3 0.6B (LLM) | Dual: Mistral small + CLIP-L | Dual: OpenCLIP ViT-G + CLIP-L | Triple: CLIP-L + CLIP-G + T5-XXL |
| **VAE** | Qwen-Image VAE | FLUX autoencoder (FLUX-AE) | SD-VAE | SD-VAE |
| **Default token limit** | ~8K–32K (Qwen-3 inherited); not officially documented | 256–512 tokens typical | 77 tokens per CLIP encoder (~150 total) | Up to 256 tokens (CLIP) + 256 tokens (T5) |
| **Resolution sweet spot** | 1024²–1280² (range 512²–1536²) | 1024² native | 1024² native | 1024² native |
| **Prompting style** | Tags + prose + hybrid | Prose only | Tag / phrase hybrid | Prose |
| **Where it excels** | Anime, illustration, character art | Realism, photo, type, contexts | Wide reach, FOSS | High-fidelity, long text, type |
| **Where it falls short** | Realism, long text | Anime (limited) | Anime (limited without finetune) | Anime (limited) |
| **Parameter count** | 2B | 12B | ~2.6B + encoders | 8B |

**Operator's takeaway:** If your output is anime / illustration-first, **Anima wins on consistency without a finetune**. If your output is realism-first, **FLUX or SDXL** win. If you need long text rendering, **SD3.5 or a typography-tuned model** is the right choice.

**Where the author ships a comparison:** The `anima_comparison.json` workflow supports Anima, SDXL, Lumina, Chroma, Newbie-Image. The default config compares **Anima vs NetaYume (a Pony-based SDXL finetune) vs Newbie-Image (another anime SDXL-class model)**. This is the author's own signal: Anima's head-to-head is against other anime models, not against FLUX.

[Source: `circlestone-labs/Anima/README.md` "Model comparison" section, accessed 2026-08-03. Architectural inference from the file listing (`qwen_3_06b_base`, `qwen_image_vae`) and the README's "Built on NVIDIA Cosmos" line. Comparison to other models derived from their own well-known specs, not from any Anima-specific claim.]

---

## 16. LICENSE / COMMERCIAL USE

**The model itself is licensed under the CircleStone Labs Non-Commercial License v1.2.** It is also a "Derivative Model" of NVIDIA Cosmos-Predict2-2B-Text2Image, so the NVIDIA Open Model License applies to it as well.

### 16.1 What's free (commercial use OK)

The non-commercial restriction applies to the **Model**, **not** to the **Outputs** (the generated images). You may use generated images commercially:

- Selling generated images.
- Paid commissions for images.
- Generating images to use as concept art or assets for a paid product (e.g., video game, visual novel).
- Selling Derivative model weights, if you are operating as an individual (Section 2.c of the LICENSE has a carve-out for this specific use).

### 16.2 What's not free (without a separate commercial license)

- Hosting the model behind an API and charging for access.
- Hosting the model on a paid online image generation platform.
- Embedding the model weights inside a monetized game or other product.
- Using the model to power some feature as part of a larger, monetized product.

### 16.3 How to get a commercial license

> "If you would like a commercial license, please email `tdrussell@circlestone.ai`."

This is the only commercial-license channel the author publishes. As of mid-2026 there were community reports of email bounces (Discussion #215: "Commercial license inquiry — emails not getting through?") — try a follow-up email or contact via the HuggingFace Discussions tab if the email fails.

### 16.4 Outputs

Generated images can be used commercially even without a model commercial license. The author's wording is explicit: "Note that the non-commercial restriction applies only to the Model, and not to Outputs (the generated images). You may use generated images commercially."

### 16.5 LoRA / finetune licensing

LoRA-trained derivatives of Anima fall under the same CircleStone Labs Non-Commercial License, unless you have a separate commercial license. **Reselling a LoRA as an individual** is explicitly carved out by Section 2.c.

[Source: `circlestone-labs/Anima/README.md` "License" section, accessed 2026-08-03. LICENSE.md (`circlestone-labs/Anima/raw/main/LICENSE.md`) for full text.]

---

## 17. QUICK-REFERENCE STYLE BLOCK (copy/paste)

This is the **single block** to copy into a prompt editor.

### 17.1 The "safe default" — Anima-Turbo, single-character, anime

```
masterpiece, best quality, score_7, safe, 1girl, oomuro sakurako, yuru yuri, @nnn yryr, smile, brown hair, hat, solo, looking at viewer
```

Negative:
```
worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration
```

Settings: Anima-Turbo, `er_sde` or `euler`, 8–12 steps, **CFG 1**, 1024².

### 17.2 The "high quality" — Anima-Aesthetic

```
masterpiece, best quality, year 2025, newest, highres, safe, 1girl, oomuro sakurako, yuru yuri, @nnn yryr, smile, brown hair, hat, solo, looking at viewer, soft lighting, indoor
```

Negative:
```
worst quality, low quality, artist name, blurry, jpeg artifacts, chromatic aberration
```

Settings: Anima-Aesthetic v1.1, `er_sde`, 30 steps, CFG 4.5, 1024².

### 17.3 The "natural language" — Anima-Aesthetic, multi-character

```
masterpiece, best quality, safe. Two girls from the anime Yuru Yuri are exchanging gifts in a warmly lit room. The girl on the left, Oomuro Sakurako, has brown hair in a hat and a red-and-white Santa costume, smiling. The girl on the right, Furutani Himawari, has orange hair in a ponytail and a school uniform, looking surprised. Warm indoor lighting, soft focus, hand-drawn animation style.
```

Settings: Anima-Aesthetic, `euler_a`, 35 steps, CFG 4.5, 1280².

### 17.4 The "non-anime" — Anima-Aesthetic, oil painting

```
ye-pop
For Sale: Others by Arun Prem
Abstract, oil painting of three faceless, blue-skinned figures. Left: white, draped figure; center: yellow-shirted, dark-haired figure; right: red-veiled, dark-haired figure carrying another. Bold, textured colors, minimalist style.
```

Settings: Anima-Aesthetic, `euler_a`, 40 steps, CFG 4.5, 1024².

### 17.5 The "realistic / painterly" — Anima-Base, beta57 scheduler

```
masterpiece, best quality, score_7, safe, 1girl, solo, portrait, oil painting, soft lighting, muted palette, looking at viewer, hourglass lighting, gentle smile
```

Settings: Anima-Base, **beta57** scheduler (ComfyUI RES4LYF), `er_sde`, 30 steps, CFG 4.5, 1024².

### 17.6 The "minimal" — what to type when you have nothing

```
masterpiece, best quality, score_7, safe, 1girl, solo, looking at viewer
```

This is the irreducible Anima prompt. Add a character, an artist, and a scene to fill it out.

---

## 18. CITATION INDEX

All claims in this manual are sourced from the following primary sources, accessed 2026-08-03:

| # | URL | What it provided | Date accessed |
|---|---|---|---|
| 1 | https://huggingface.co/circlestone-labs/Anima | Repo metadata, sidebar, model card | 2026-08-03 |
| 2 | https://huggingface.co/circlestone-labs/Anima/raw/main/README.md | **Full model card** — every quoted section derives from this file | 2026-08-03 |
| 3 | https://huggingface.co/circlestone-labs/Anima/raw/main/LICENSE.md | Full CircleStone Labs Non-Commercial License v1.2 text | 2026-08-03 |
| 4 | https://huggingface.co/circlestone-labs/Anima/tree/main | File listing (README, LICENSE, montage.jpg, example.png, anima_comparison.json, split_files/) | 2026-08-03 |
| 5 | https://huggingface.co/circlestone-labs/Anima/tree/main/split_files | Confirmed filenames for diffusion_models, text_encoders, vae subfolders | 2026-08-03 |
| 6 | https://huggingface.co/circlestone-labs | Org page: 928 followers, 3 models, contributors tdrussell + comfyanonymous | 2026-08-03 |
| 7 | https://huggingface.co/circlestone-labs/Anima/discussions | Discussion list (titles only — 226 threads, 206 open) | 2026-08-03 |
| 8 | https://civitai.com/models/2458426/anima | Author's endorsed Civitai model page (rendered, JS-heavy) | 2026-08-03 |
| 9 | https://civitai.com/models/2536147 | Author's example style LoRA with dataset + configs | 2026-08-03 |

### Sources NOT consulted (and why)

- **Twitter / X** — no scraping tool with X auth available.
- **Reddit** — `reddit.com/search.json` returned HTTP 403 from this client.
- **YouTube** — not searched.
- **GitHub** — `diffusion-pipe` not pulled within remaining turn budget.
- **HF Spaces** — org page reports 0 spaces directly; spaces consuming Anima exist but were not pulled.
- **Discussion thread bodies** — only titles/structure were extractable from the JS-heavy Discussions tab.

### Notes on uncertainty

- Token limit / max prompt length: **not explicitly disclosed by the author.** Inferred from Qwen-3 0.6B context window.
- Exact parameter count of the diffusion model alone: 2B is the stated round number; the diffusers-format mirror's metadata gives 1,956,405,248.
- Stable diffusion guidelines for specific content categories: community-reported, not author-claimed.
- Comparison vs FLUX / SD3.5: the author does **not** explicitly compare Anima to FLUX or SD3.5 in the model card. §15 is an inference from architecture + file listing.

---

## END OF MANUAL

If you find an error, an outdated fact, or a tag the README doesn't actually support, raise a HuggingFace Discussion thread on `circlestone-labs/Anima` and — if you want — drop a note into this repo's `docs/ANIMA-PROMPTING-MANUAL.md` via the same workflow as the Z-Image Turbo manual (`docs/Z-IMAGE-TURBO-AGENT-PROMPT-GUIDE.md`).
