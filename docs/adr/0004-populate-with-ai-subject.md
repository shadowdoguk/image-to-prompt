# ADR 0004 — Factual-only subject re-analysis ("Populate with AI" button)

## Status

Accepted. Implemented 2026-06-22.

## Context

The `subject` field produced by Stage 1 (ADR 0003) is exhaustive and
paragraph-length, but it inherits the preset's specialty focus. Each preset
asks the LLM to describe the image "for downstream image-generation" — so
the response naturally mixes factual content with style, medium, and
aesthetic commentary (e.g. "the subject is bathed in dramatic chiaroscuro
lighting reminiscent of the Dutch Golden Age", "vibrant complementary
color palette", "expressive gestural brushwork"). That is correct for the
final prompt but it pollutes the `subject` field for users who want pure
factual content.

Users have asked for a way to populate the `subject` field with a
description that:

1. **People** — every visible person, their placement in the frame, their
   clothing (garment type + color + visible material), their facial
   expression.
2. **Locations / settings / environments** — what the image depicts,
   indoors vs outdoors, environmental features.
3. **Spatial arrangement** — where each person and object sits in the
   frame, and how they relate to each other (seated at, next to, behind,
   in front of, above, below).
4. **Objects, items, and environmental features** — every visible item
   with specific placement and attributes.
5. **Contextual details** — surrounding environment + individual details
   (apparent age when relevant, posture, activity, attire, background and
   peripheral elements, visible text/signage).

…**without** any commentary on artistic style, creative medium, or
aesthetic qualities.

Today, the only way to get this content is to:
- Edit the `subject` field manually after Stage 1, or
- Add a new preset whose `stage1_system_prompt` enforces this contract.

The first option is friction. The second option requires creating and
selecting a new preset just to refresh one field. Neither fits the
"re-analyze the uploaded image" mental model.

## Decision

### 1. New endpoint: `POST /api/subject`

A dedicated endpoint that accepts an uploaded image and returns a single
`subject` field, populated by a focused factual-only system prompt.

```
POST /api/subject           multipart/form-data: image (file)
                            response: { success, data: { subject } }
```

The endpoint does not depend on the active preset. The system prompt is
fixed — it is not parameterised by `preset.stage1_system_prompt` — because
the factual contract is orthogonal to the preset's downstream-generation
specialty (oil painting, photography, Danbooru, etc.).

### 2. New helper: `callMiniMaxSubjectAnalysis`

Mirrors the structure of `callMiniMaxStage1` (single-attempt for now, no
length-retry loop — the system prompt enforces the length contract in one
shot and a retry would just double the API cost). Uses the same
`MINIMAX_BASE_URL`, `MINIMAX_MODEL`, and 60-second timeout.

Schema is a strict JSON Schema with a single `subject` property:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "subject": { "type": "string", "minLength": 600 }
  },
  "required": ["subject"]
}
```

`minLength: 600` mirrors ADR 0003's subject floor. The schema `description`
field is intentionally NOT set (see ADR 0003 amendment — the MiniMax M3
API rejects `description` strings over 200 chars with code 2013). The
full per-field contract is delivered via the system prompt instead.

### 3. New constant: `SUBJECT_FACTUAL_SYSTEM_PROMPT`

A purpose-built system prompt that:

- **Excludes** artistic style, creative medium, and aesthetic qualities
  by name (and lists forbidden aesthetic vocabulary — "beautiful",
  "striking", "vibrant", "dramatic", "elegant", etc. — explicitly).
- **Forbids** meta-references to the medium ("the painting", "the
  photograph", "the image", "the artwork") so the LLM cannot slip into
  "this photograph shows…" phrasing.
- **Forbids** aesthetic interpretation of lighting ("moody",
  "atmospheric", "cinematic"); only physical descriptions ("natural
  daylight from upper left", "warm overhead incandescent").
- **Mandates** coverage of all five user-stated categories as labeled
  sections.
- **Requires** the response to be ≥ 600 characters and 120-200 words,
  matching ADR 0003's subject length contract.
- **Instructs** the LLM to say "No X is visible" when a category is empty
  rather than skipping it silently.

### 4. New UI control: "Populate with AI" button

A `.btn-secondary` button rendered directly beneath the `subject`
textarea in the analysis editor (only when `subject` is in the preset's
`stage1_fields` — i.e. the button lives with its field, not as a global
control).

Click handler:
- Posts `state.currentFile` to `/api/subject` via `FormData`.
- Disables itself + shows inline spinner while in flight.
- On success, updates `state.currentAnalysis.subject` and the subject
  textarea's DOM value in-place (no full re-render — preserves edits to
  other fields).
- On failure, surfaces the error via the existing `showError` toast.

The button is enabled whenever `state.currentFile` is set (i.e. an image
has been uploaded) — the analysis editor itself is only visible after the
initial Stage 1 has run, so the button is only reachable after the user
already has an analysis to edit.

### 5. Out of scope for this ADR

- The button does not appear for presets that omit `subject` from
  `stage1_fields`. None of the built-in presets omit it, but custom
  presets could.
- No retry-with-strengthened-prompt loop (ADR 0001's mechanism) — the
  factual prompt is short and explicit; a second attempt would only
  consume API budget without improving the contract. Best-effort failure
  logs to `server.log` instead.
- No length-override mechanism — the contract is fixed at 600 chars
  regardless of preset.

## Architecture (after)

```
                   ┌────────────────────────────┐
                   │  User uploads image        │
                   │  + selects preset          │
                   └─────────────┬──────────────┘
                                 │
                                 ▼
             ┌───────────────────────────────────────┐
             │  Stage 1 — callMiniMaxStage1          │  (preset-bound,
             │  (description-first, length-guarded)  │   style + facts)
             └─────────────┬─────────────────────────┘
                           │
                           ▼
             ┌───────────────────────────────────────┐
             │  Step 3 — analysis editor             │
             │                                       │
             │   subject ┌──────────────────────┐   │
             │   [textarea with Stage 1 result]     │
             │   [Populate with AI]  ◄── NEW BUTTON │
             │              │                        │
             │              ▼ (uploads image)        │
             │   POST /api/subject                   │
             │      └─► callMiniMaxSubjectAnalysis   │
             │          (factual-only prompt)        │
             │      └─► { subject: "..." }           │
             │              │                        │
             │              ▼                        │
             │   subject textarea value updated     │
             │   in-place (other fields preserved)   │
             └───────────────────────────────────────┘
```

## Files changed

| File | Change |
|---|---|
| `server.js` | New `SUBJECT_FACTUAL_SYSTEM_PROMPT` constant. New `callMiniMaxSubjectAnalysis(imageDataUri)` helper (schema builder inline, no retry loop). New `POST /api/subject` route reusing the existing `upload.single('image')` multer middleware. Module export of the new helper. |
| `src/app.js` | In `renderAnalysisEditor`, when the current field is `subject`, append a `.btn-secondary` "Populate with AI" button below the textarea. New `populateSubjectWithAI` async function posts the current file to `/api/subject`, updates `state.currentAnalysis.subject` and the textarea DOM value in place, toggles button loading state, surfaces errors via `showError`. |
| `src/styles.css` | Small wrapper class `.field-row__action` so the button aligns under the textarea with appropriate left margin. |
| `CONTEXT.md` | Pipeline-stages section now notes that the `subject` field can be refreshed independently of the active preset via `/api/subject`. |
| `README.md` | New endpoint documented under API Endpoints. |
| `tests/run-all.js` | Three new tests: (a) `/api/subject` route is registered, (b) README documents it, (c) `SUBJECT_FACTUAL_SYSTEM_PROMPT` exists and contains the anti-style/forbidden-vocabulary guarantees. |

No changes to `data/presets.json`, `FIELD_PALETTE`, `FIELD_FORMAT_HINTS`,
or the existing per-preset system prompts.

## Why these decisions

- **Dedicated endpoint, not a flag on `/api/analyze`.** The factual contract
  is mutually exclusive with the preset-bound style contract. A flag
  (`?mode=factual`) on the same endpoint would entangle two different
  contracts in one handler, and the system prompt would have to be
  constructed conditionally. A dedicated endpoint keeps each handler
  reading as a single linear narrative.
- **No preset dependency.** Re-running the factual analysis with a
  different preset selected should still work, because the factual
  contract is the same regardless of the user's eventual prompt target
  (oil painting vs. photograph vs. Danbooru tags). Decoupling the input
  contract from the active preset also means the button works the same
  way after the user switches presets mid-edit.
- **No retry loop.** ADR 0001's retry mechanism was added because the
  per-preset prompts were being diluted by their own specialty focus and
  the description-first contract. The factual prompt is short, fully
  focused, and self-contained — the same mechanism that ADR 0003 uses
  for re-stating the contract in retries is already in the system prompt
  itself (the `# CRITICAL RULES` + `# MANDATORY COVERAGE` sections are
  in the LLM's primary attention window). Best-effort behaviour on a
  partial response is logged but does not block the response, matching
  the existing Stage 1 best-effort fallback.
- **In-place DOM update, not full re-render.** The user may have edited
  other fields (style, lighting, colors). A full re-render of the
  analysis editor would clobber those edits or, worse, lose focus state
  in the middle of typing. The populate button updates only the subject
  field's textarea value and `state.currentAnalysis.subject`.
- **`.btn-secondary` styling, not a new visual primitive.** The existing
  `.btn-secondary` already has hover, focus, disabled, and loading
  spinner styles. Adding a new visual class without a clear use case
  would be visual drift (drift-prevention.md §6).

## Trade-offs and risks

- **Extra API call per click.** Each "Populate with AI" click costs one
  MiniMax M3 vision call. The button is only meaningful after an
  analysis has run, so users who spam-click will spend credits
  intentionally. There's no rate-limit or debounce in this iteration;
  add one if abuse becomes a problem.
- **LLM may still slip into style commentary.** The forbidden-vocabulary
  list is a strong signal but not a guarantee. The user can edit the
  response, which is the same escape hatch available for any other
  Stage 1 field. No regex post-filter is applied — false positives
  ("vibrant tomato on the table" describes a real-world object) would
  be worse than occasional slips.
- **Same 60-second timeout.** Inherits `callMiniMaxStage1`'s timeout.
  Subject-only analysis is a shorter call (one field, shorter prompt)
  than full Stage 1, so timeouts are less likely.

## Verification

- `node scripts/session-init.js` — must still report 10/10 checks.
- `node tests/run-all.js` — all 13 tests (10 existing + 3 new) must pass.
- Manual smoke: with a real image and a real `MINIMAX_API_KEY`, upload an
  image, run Stage 1 with any preset, then click "Populate with AI"
  beneath the `subject` field. Confirm the response:
  - Has `success: true` and a `subject` string ≥ 600 characters.
  - Mentions specific people (placement, clothing, expression) if any
    are visible, or explicitly states "No people are visible".
  - Does not contain the forbidden vocabulary
    ("beautiful", "striking", "vibrant", "dramatic", "elegant",
    "imposing", "stunning", "dynamic", "luminous", "ethereal", "serene",
    "majestic") used as aesthetic judgment.
  - Does not contain meta-references to the medium ("the painting",
    "the photograph", "the image", "the artwork", "the illustration").
- Confirm other fields in the analysis editor (style, lighting, etc.)
  remain unchanged after the populate click.