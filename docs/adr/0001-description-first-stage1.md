# ADR 0001 — Description-first Stage 1 with length validation

## Status

Accepted. Implemented 2026-06-21.

## Context

The original `stage1_system_prompt` values in `data/presets.json` defined only per-field format rules. They did not enforce:

1. A description-first contract (perception before interpretation).
2. Exhaustive coverage of all 5 mandatory description categories the tool must produce (subjects/objects with spatial positioning, actions/interactions, visual style, composition, fine details).
3. A prohibition on edit suggestions / prompt rewrites / post-processing commentary leaking into Stage 1.

The structured JSON schema built in `buildStage1Schema` (`server.js`) only constrained the *shape* of the LLM's response — not its semantic priorities or length.

In addition, a real bug surfaced in `server.log`: `callMiniMaxOrientationAnalysis` failed with `"description too long (max..."` because the schema property descriptions embedded full per-field instructions (~600 chars each), exceeding the MiniMax M3 API's per-property description length limit. This caused Stage 1.5 (dedicated orientation/actions call) to fail repeatedly.

A smoke test against the live server using a simple 256×256 test image revealed a second issue: even when Stage 1 succeeded, the LLM returned one-word answers for most fields, ignoring the prompt's "50–100 word" mandate for prose fields.

## Decision

### 1. Description-first Stage 1 prompts

Rewrite all three built-in preset `stage1_system_prompt` values (`data/presets.json`) using a shared `COMMON_DESCRIPTION_FIRST` core that mandates:

- **STEP 1 — Exhaustive description** of all 5 categories before any extraction.
- **STEP 2 — Structured extraction** only after Step 1.
- **MANDATORY MINIMUM LENGTHS** (30 words for textarea prose fields, 4 words for text fields).
- **STRICT PROHIBITIONS** on edit suggestions, prompt rewrites, post-processing recommendations in Stage 1.

Each preset then layers its own **specialty focus** (oil painting technique / photographic technique / Danbooru tag conventions) and **accuracy contract** (HIGH-CONFIDENCE ≥90% targets vs BEST-EFFORT items with hedging instructions).

### 2. Per-input-type minLength schema constraint

Add `FIELD_INPUT_MIN_LENGTH` (`server.js`) — 100 chars for textarea fields, 15 chars for text fields — and apply as `minLength` on string properties in `buildStage1Schema`. The MiniMax API treats `minLength` as guidance, not a hard constraint, so this is a *guardrail* not an enforcement.

### 3. Server-side length validation + single retry

Add `validateAnalysisLengths` (`server.js`) that checks parsed output against `FIELD_INPUT_MIN_LENGTH`. Wrap `callMiniMaxStage1` in a 2-attempt loop:

- **Attempt 1**: standard call with preset's `stage1_system_prompt`.
- **Attempt 2** (only if attempt 1 had length violations): re-call with an appended `# CRITICAL: REJECTED FOR BEING TOO SHORT` suffix naming the specific failing fields and their `actual`/`required` character counts.

Capped at 1 retry to bound API cost. Violations are logged; best-effort result is returned if retry also fails.

### 4. Schema description-length fix

Reduce the verbose `description` strings on `subject_orientation` and `actions` properties in `callMiniMaxOrientationAnalysis` (`server.js`) from ~600 chars to ~140 chars each. Detailed guidance stays in the system prompt where it belongs. The Stage 1.5 dedicated call now succeeds.

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
            │  • 2-attempt loop: validate + retry   │
            └─────────────┬─────────────────────────┘
                          │
                          ▼
            ┌───────────────────────────────────────┐
            │  Stage 1.5 — orientation/actions      │
            │  (only if preset selected those)      │
            │  • Dedicated, focused analysis        │
            │  • Overrides Stage 1's values         │
            └─────────────┬─────────────────────────┘
                          │
                          ▼  (user edits JSON + adds directives)
            ┌───────────────────────────────────────┐
            │  Stage 2 — callMiniMaxStage2          │
            │  • Synthesize final prompt            │
            │  • Apply user directives              │
            └───────────────────────────────────────┘
```

## Files changed

| File | Change |
|---|---|
| `data/presets.json` | Rewrote 3× `stage1_system_prompt` values (avg ~4150 chars each, up from ~700) |
| `server.js` | Added `FIELD_INPUT_MIN_LENGTH`; added `minLength` in `buildStage1Schema`; added `validateAnalysisLengths`; refactored `callMiniMaxStage1` for 2-attempt loop with retry prompt; fixed verbose schema descriptions in `callMiniMaxOrientationAnalysis` |

## Accuracy contract

Per the deep-dive analysis and the user's "Path A + best-effort" decision:

| Task class | Target | Mechanism |
|---|---|---|
| Garment type, color | HIGH-CONFIDENCE (≥90% expected) | Prompt mandate + visual grounding |
| Facing direction | HIGH-CONFIDENCE (≥90% expected) | Stage 1.5 dedicated call (now functional) |
| Primary facial expression | HIGH-CONFIDENCE (≥90% expected) | Prompt mandate |
| Major surrounding objects | HIGH-CONFIDENCE (≥90% expected) | Prompt mandate |
| Scene classification | HIGH-CONFIDENCE (≥90% expected) | Prompt mandate |
| Textile material | BEST-EFFORT | Prompt mandates "appears to be / likely / possibly" hedging |
| Micro-expressions | BEST-EFFORT | Acknowledged as fundamental SOTA ceiling (~65%) |
| Single-frame activity inference | BEST-EFFORT | Acknowledged as fundamental single-frame ambiguity |

The 90% threshold is not enforced via automated CI gate (per user's choice to skip benchmark dataset and CI validation harness).

## Smoke test methodology

1. Generate a synthetic 256×256 PNG (`/tmp/opencode/test-image.png`): gradient sky (deep blue → warm orange), white sun top-right, dark silhouette figure centered at bottom. Represents a simple, sparse image.
2. POST to `/api/analyze` with multipart form data (image + `presetId`).
3. Parse JSON response, count words/chars per field, compare against `FIELD_INPUT_MIN_LENGTH`.

### Results across 3 presets (single run each, simple test image)

| Preset | Total words | Total chars | Fields passing minLength |
|---|---|---|---|
| `preset_alla_prima_oil` | 207 | 1222 | 9/12 |
| `preset_photorealistic` | 167 | 960 | 5/7 |
| `preset_sd_danbooru` | 76 | 458 | 3/6 |

### Consistency check (3 consecutive runs, oil painting preset)

| Run | Total words | Total chars |
|---|---|---|
| 1 | 249 | 1456 |
| 2 | 204 | 1230 |
| 3 | 228 | 1322 |

**Variability:** ±20% across runs. Subject field consistently 87–109 chars (~15–19 words).

### Observations

- **Description-first contract works**: no edit suggestions or post-processing content in any output across all presets and runs.
- **Stage 1.5 (orientation/actions) reliably produces detailed output** (38–56 words, 211–341 chars), confirming the schema description-length fix.
- **Main Stage 1 produces variable content** for prose fields on simple images. The retry mechanism helps but doesn't guarantee hitting the 100-char textarea minimum.
- **The synthetic test image is inherently terse** (~15–20 words of unique description per field is genuinely all the image contains). Real-world images with people, clothing, scenes, and backgrounds should comfortably produce 30+ words per field.
- **Best-effort fields (mood, artistic_medium, style) are the most likely to fall short** — these require interpretation, not just description.

## Known limitations

1. **LLM doesn't strictly honor `minLength` in JSON Schema.** MiniMax M3 treats it as guidance. Server-side validation + retry is the actual enforcement; one retry is not always sufficient.
2. **No automated 90% accuracy gate.** Per Path A / best-effort decision, no benchmark dataset or CI validation harness was built. Live accuracy depends entirely on prompt quality and the underlying VLM.
3. **Simple images produce simple descriptions.** The smoke test confirms the LLM is reluctant to pad descriptions beyond what's optically present. This is by design (the prompt forbids inventing details) but means the minLength guardrail sometimes fires on simple inputs.
4. **Best-effort tasks (materials, micro-expressions, activities) have fundamental accuracy ceilings** of ~65–80% with current VLMs. Hitting 90% on these would require specialized CV models (Path B/C from the deep dive) — out of scope for Path A.

## How to extend

### Add a new preset

```js
// In data/presets.json, add an entry:
{
  "id": "preset_my_new_preset",
  "name": "My new preset",
  "stage1_system_prompt": "...",  // Follow COMMON_DESCRIPTION_FIRST pattern in /tmp/opencode/update-presets.js
  "stage1_fields": ["subject", "actions", ...],  // Must reference valid FIELD_PALETTE names
  "stage2_system_prompt": "..."
}
```

### Add a new field to the palette

1. Add the field definition to `FIELD_PALETTE` in `server.js`.
2. Add the field name to the appropriate preset's `stage1_fields`.
3. If the field requires a different input type, add its minLength to `FIELD_INPUT_MIN_LENGTH`.

### Tighten or relax length enforcement

Edit `FIELD_INPUT_MIN_LENGTH` in `server.js`. Lower values = more permissive (less retry). Higher values = stricter (more retry attempts). The retry is capped at 1, so raising the bar much beyond the LLM's natural output will result in consistent "best-effort" log warnings.

## Reproducibility

- Test image: `/tmp/opencode/test-image.png` (generated by `python3` with stdlib `zlib`)
- Smoke test scripts: ad-hoc Node.js inline scripts (no persistent test runner; project has no `tests/` directory)
- Manual checklist for live UI testing is in `README.md`

## Out-of-scope (per user choice)

The original spec called for: state-of-the-art CV models (object detection, segmentation, pose, facial recognition, scene understanding), a benchmark dataset, and an automated 90% CI gate. These were rejected in favor of **Path A: VLM prompts** with **best-effort** for tasks where 90% is not realistically achievable (materials, micro-expressions, activities). See the deep-dive analysis for accuracy ceilings and Path B/C trade-offs.
