# ADR 0008 — Factual-only camera-angle re-analysis ("Populate with AI" button)

## Status

Accepted. Implemented 2026-06-22.

## Context

The `camera_angle` field produced by Stage 1 is a short text value pulled
out of a larger structured analysis. Live testing showed it is the most
underperforming field in the schema: the LLM compresses "camera angle"
into a one- or two-word tag (`"eye level"`, `"high angle"`) because the
preset-bound Stage 1 prompt is balancing it against twelve other fields,
and the `text` input type's 15-character minimum is short enough that the
LLM satisfies it with a label rather than a description.

Users have asked for a way to populate the `camera_angle` field with a
**dedicated** analysis that focuses exclusively on the camera's spatial
relationship to the subject — position, orientation, lens impression,
movement, frame geometry — and nothing else. A focused call gives the LLM
the full prompt attention window for one question instead of diluting it
across a 14-field schema.

Today, the only way to get richer camera-angle content is to:
- Edit the `camera_angle` field manually after Stage 1, or
- Add a new preset whose `stage1_system_prompt` over-allocates attention
  to camera angle (and under-allocates to everything else).

Neither fits the "re-analyze the uploaded image" mental model, and both
are friction.

## Decision

### 1. New endpoint: `POST /api/camera-angle`

A dedicated endpoint that accepts an uploaded image and returns a single
`camera_angle` field, populated by a focused, camera-only system prompt.

```
POST /api/camera-angle     multipart/form-data: image (file)
                           response: { success, data: { camera_angle } }
```

The endpoint does not depend on the active preset. The system prompt is
fixed and not parameterised by `preset.stage1_system_prompt`, mirroring
ADR 0004's reasoning that the camera-angle contract is orthogonal to the
preset's downstream-generation specialty (oil painting, photography,
Danbooru, etc.).

### 2. New helper: `callMiniMaxCameraAngleAnalysis`

Mirrors the structure of `callMiniMaxSubjectAnalysis` (single-attempt,
no retry-with-strengthened-prompt loop — the system prompt enforces the
contract in one shot and the response is short enough that a retry would
just double the API cost without changing the outcome). Uses the same
`MINIMAX_BASE_URL`, `MINIMAX_MODEL`, and 60-second timeout.

Schema is a strict JSON Schema with a single `camera_angle` string
property enforcing `minLength: 20` (above the generic 15-char floor for
`text` fields; see "Length floor" below for the rationale).

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "camera_angle": { "type": "string", "minLength": 20 }
  },
  "required": ["camera_angle"]
}
```

### 3. New constant: `DEFAULT_CAMERA_ANGLE_PROMPT`

A purpose-built system prompt that:

- **Excludes** subject description (people, places, objects) — those
  are separate fields.
- **Excludes** artistic style, creative medium, and aesthetic qualities
  by name (same forbidden vocabulary pattern as ADR 0004).
- **Forbids** meta-references to the medium ("the painting", "the
  photograph", "the image", "the artwork") so the LLM cannot slip into
  "this photograph was taken from…" phrasing.
- **Excludes** lighting, color, and mood commentary — those are separate
  fields in the palette.
- **Mandates** coverage of five camera-angle categories:
  1. **Camera position** — height (eye-level, low, high, bird's eye,
     worm's eye, overhead), distance (extreme close-up, close-up,
     medium, wide, extreme wide).
  2. **Camera orientation** — front / profile / three-quarter / behind
     the subject; horizontal level, tilt (Dutch angle / canted).
  3. **Lens impression** — focal-length feel (telephoto, normal,
     wide-angle, fisheye, macro); depth-of-field impression (shallow,
     deep) only as it relates to lens choice.
  4. **Movement** — static frame vs implied motion (tracking, dolly,
     handheld, zoom).
  5. **Frame geometry** — composition placement of the subject within
     the frame (centered, rule-of-thirds, off-center, cropped edges),
     but NOT compositional aesthetics (that's the `composition` field).
- **Requires** a precise, single-paragraph response (1-3 sentences,
  25-80 words) — long enough to be more than a label, short enough to
  fit the `camera_angle` field's role as a single-line descriptor.
- **Instructs** the LLM to say "not determinable from the image" when a
  category is genuinely ambiguous, rather than guessing.

### 4. New UI control: "Populate with AI" button

A `.btn-secondary` button rendered directly beneath the `camera_angle`
input field in the analysis editor (only when `camera_angle` is in the
preset's `stage1_fields` — the button lives with its field, not as a
global control).

Click handler:
- Posts `state.currentFile` to `/api/camera-angle` via `FormData`.
- Disables itself + shows inline spinner while in flight.
- On success, updates `state.currentAnalysis.camera_angle` and the
  field's DOM value in-place (no full re-render — preserves edits to
  other fields).
- On failure, surfaces the error via the existing `showError` toast.
- **Error handling for "no image loaded":** if `state.currentFile` is
  null when the button is clicked, the handler calls `showError` with
  a clear message ("No image uploaded. Upload an image first.") and
  returns without firing the network request. This matches the
  `populateSubjectWithAI` pattern (ADR 0004) and prevents a 400 from
  the route (which itself returns "No image file provided.").

The button is enabled whenever `state.currentFile` is set — the
analysis editor itself is only visible after the initial Stage 1 has
run, so the button is only reachable after the user already has an
analysis to edit.

### 5. Out of scope for this ADR

- The button does not appear for presets that omit `camera_angle` from
  `stage1_fields`. The built-in presets (`preset_alla_prima_oil`,
  `preset_photorealistic`, `preset_danbooru`) all include it, but a
  custom preset could omit it.
- No retry-with-strengthened-prompt loop. The prompt is short and
  explicit; a second attempt would only consume API budget without
  improving the contract. Best-effort failure logs to `server.log`.
- No length-override mechanism — the contract is fixed at 20 chars
  regardless of preset.
- No prompt editor modal. ADR 0004 ships one for `subject` (ADR 0005)
  because the factual-only contract has many knobs users want to tune.
  The camera-angle prompt is narrower; if user iteration proves useful,
  follow-up ADR can mirror ADR 0005's edit-prompt modal pattern.

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
              │  (description-first, length-guarded)  │   compresses camera
              │                                       │   angle to a label)
              └─────────────┬─────────────────────────┘
                            │
                            ▼
              ┌───────────────────────────────────────┐
              │  Step 3 — analysis editor             │
              │                                       │
              │   camera_angle ┌───────────────────┐  │
              │   [short text from Stage 1]          │  │
              │   [Populate with AI]  ◄── NEW BUTTON │
              │              │                        │
              │              ▼ (uploads image)        │
              │   POST /api/camera-angle              │
              │      └─► callMiniMaxCameraAngleAnalysis
              │          (camera-only prompt)         │
              │      └─► { camera_angle: "..." }     │
              │              │                        │
              │              ▼                        │
              │   camera_angle input value updated   │
              │   in-place (other fields preserved)  │
              └───────────────────────────────────────┘
```

## Files changed

| File | Change |
|---|---|
| `server.js` | New `DEFAULT_CAMERA_ANGLE_PROMPT` constant. New `callMiniMaxCameraAngleAnalysis(imageDataUri)` helper (single-attempt, schema builder inline). New `POST /api/camera-angle` route reusing the existing `upload.single('image')` multer middleware. Module export of the new helper. |
| `src/app.js` | In `renderAnalysisEditor`, when the current field is `camera_angle`, append a `.btn-secondary` "Populate with AI" button below the input. New `populateCameraAngleWithAI` async function posts the current file to `/api/camera-angle`, updates `state.currentAnalysis.camera_angle` and the field's DOM value in place, toggles button loading state, surfaces errors via `showError`. New `isPopulatingCameraAngle` state flag. |
| `src/styles.css` | New `.btn-populate-camera-angle` class mirroring `.btn-populate-subject` sizing. |
| `CONTEXT.md` | Pipeline-stages section now mentions Stage 1.C (camera-angle re-analysis). Field palette section notes that `camera_angle` has a dedicated re-analysis endpoint. |
| `README.md` | New `POST /api/camera-angle` endpoint documented under API Endpoints. |
| `tests/run-all.js` | Six new tests: (a) route is registered, (b) helper is exported, (c) default prompt excludes subject/style/medium/aesthetic vocabulary, (d) default prompt mandates the five camera-angle categories, (e) HTTP integration: route accepts multipart upload and returns 200 envelope shape on missing key (503), (f) frontend HTML/CSS: button class is rendered when field is camera_angle. |

No changes to `data/presets.json`, `FIELD_PALETTE`, `FIELD_FORMAT_HINTS`,
or the existing per-preset system prompts.

## Why these decisions

- **Dedicated endpoint, not a flag on `/api/analyze`.** The camera-angle
  contract is mutually exclusive with the preset-bound Stage 1 schema.
  A flag (`?field=camera_angle`) on the same endpoint would entangle
  two different contracts in one handler, and the system prompt would
  have to be constructed conditionally. A dedicated endpoint keeps each
  handler reading as a single linear narrative — mirrors ADR 0004.
- **No preset dependency.** Re-running the camera-angle analysis with a
  different preset selected should still work, because the camera-angle
  contract is the same regardless of the user's eventual prompt target.
  Decoupling the input contract from the active preset also means the
  button works the same way after the user switches presets mid-edit.
- **No retry loop.** Same reasoning as ADR 0004: the prompt is short,
  fully focused, and self-contained. A retry would just double API cost.
- **Length floor at 20 chars (above the generic 15-char text floor).**
  The minimum-length contract is at the schema level (`minLength: 20`).
  20 chars is enough for "low angle from below" / "overhead bird's-eye
  shot" — short, descriptive labels — but excludes single-word
  responses like "above" that are the symptom of the bug being fixed.
  The system prompt then targets a richer 25-80 word paragraph.
- **In-place DOM update, not full re-render.** The user may have edited
  other fields. A full re-render of the analysis editor would clobber
  those edits. The populate button updates only the camera-angle
  field's value and `state.currentAnalysis.camera_angle` — same
  rationale as ADR 0004.
- **`.btn-secondary` styling, not a new visual primitive.** The existing
  `.btn-secondary` already has hover, focus, disabled, and loading
  spinner styles. A new class without a clear use case would be visual
  drift (drift-prevention.md §6).
- **Client-side "no image" guard, not server-only.** The server already
  400s on `req.file === null` ("No image file provided."), but the
  client-side guard surfaces a clearer error in the UI before the
  request is fired (no round-trip latency, no aborted-request noise in
  the network tab). This mirrors ADR 0004's `populateSubjectWithAI`
  handler.

## Trade-offs and risks

- **Extra API call per click.** Each "Populate with AI" click costs one
  MiniMax M3 vision call. The button is only meaningful after an
  analysis has run, so users who spam-click will spend credits
  intentionally. There's no rate-limit or debounce in this iteration;
  add one if abuse becomes a problem.
- **LLM may slip into subject/style commentary.** The forbidden-
  vocabulary list is a strong signal but not a guarantee. The user can
  edit the response, which is the same escape hatch available for any
  other Stage 1 field. No regex post-filter is applied — false
  positives ("wide-angle lens of the cathedral" could describe an
  architectural photograph) would be worse than occasional slips.
- **Same 60-second timeout.** Inherits `callMiniMaxSubjectAnalysis`'s
  timeout. Camera-angle-only analysis is a shorter call than full
  Stage 1, so timeouts are less likely.

## Verification

- `node scripts/session-init.js` — must still report 10/10 checks.
- `node tests/run-all.js` — all tests (existing + 6 new) must pass.
- Manual smoke: with a real image and a real `MINIMAX_API_KEY`, upload an
  image, run Stage 1 with any preset that includes `camera_angle` in
  `stage1_fields`, then click "Populate with AI" beneath the camera
  angle field. Confirm the response:
  - Has `success: true` and a `camera_angle` string ≥ 20 characters.
  - Names the camera position (height + distance) precisely.
  - Names the camera orientation (front / profile / three-quarter /
    behind) when determinable.
  - Does not describe the subject, lighting, color, mood, or medium.
  - Does not contain the forbidden vocabulary ("beautiful", "striking",
    "vibrant", "dramatic", "elegant", etc.).
  - Does not contain meta-references to the medium ("the painting",
    "the photograph", "the image", "the artwork").
- Confirm the camera_angle input field shows the new value immediately
  after the API call returns.
- Click the button with no image uploaded (after clearing the image
  preview) — confirm a clear error toast appears without a network
  request firing.
- Confirm other fields in the analysis editor (style, lighting, etc.)
  remain unchanged after the populate click.
