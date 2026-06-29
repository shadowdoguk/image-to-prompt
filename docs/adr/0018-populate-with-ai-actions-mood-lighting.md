# ADR 0018 — Focused re-analysis + curated presets for `actions`, `mood`, `lighting`

## Status

Accepted. Implemented 2026-06-29.

## Context

The analysis editor (Step 3) currently shows three re-analysis buttons that
delegate a focused MiniMax M3 vision call to a single field — `subject`
(ADR 0004) and `camera_angle` (ADR 0008). Three more fields have the same
underperforming-in-Stage-1 problem and the same user-facing friction, but
the fix is not identical for all three:

- **`actions` (Actions / events)** — Stage 1 compresses ongoing activity
  ("sitting", "smiling", "standing") because the preset-bound Stage 1 prompt
  balances it against twelve other fields. The `textarea` minimum-length
  floor (30 words) is just enough that the LLM satisfies it with a flat
  one-clause description. Users have asked for a richer, actions-only
  re-analysis that focuses on body kinematics, object interactions,
  multi-figure dynamics, and the "story" of the moment.

- **`mood` (Mood)** — Stage 1 compresses mood into one or two adjectives
  ("cheerful", "melancholic") for the same reason. Worse, the LLM has no
  consistent mood vocabulary — different presets return different label
  sets. Users have asked for both (a) a focused, mood-only AI re-analysis
  and (b) a curated set of mood chips they can click as a quick manual
  override ("joyful", "serene", "dramatic", …) without spending an API
  credit.

- **`lighting` (Lighting)** — Stage 1 compresses lighting into a short
  label ("soft natural light", "studio lighting") for the same reason.
  Lighting has a well-known, canonical vocabulary (golden hour, chiaroscuro,
  rim-lit, low-key, neon, etc.) and is the field where curated presets
  have the highest payoff — a single click can replace a Stage-1 label
  with a production-quality descriptor. Users have asked for both (a) a
  focused, lighting-only AI re-analysis and (b) a curated set of lighting
  chips.

The two-tier design (AI re-analysis + curated presets for mood/lighting;
AI re-analysis only for actions) mirrors how the underlying task differs:

- **Actions** is image-specific and resists a small canonical label set
  (every photo has different actions). A chip library would be arbitrary
  and incomplete — AI re-analysis is the right fix.
- **Mood and lighting** have well-known, broadly-accepted taxonomies.
  Curated chips provide an instant, zero-credit manual override alongside
  the AI option.

This ADR mirrors ADR 0004's "Populate with AI" pattern for the
server-side re-analysis and ADR 0009's modal pattern for client-side UI
controls, but adds a new client-side primitive — a clickable preset-chip
row that updates a field value in place.

## Decision

### 1. Three new endpoints

```
POST /api/actions            multipart/form-data: image (file)
                             response: { success, data: { actions, model } }

POST /api/mood               multipart/form-data: image (file)
                             response: { success, data: { mood, model } }

POST /api/lighting           multipart/form-data: image (file)
                             response: { success, data: { lighting, model } }
```

All three mirror `/api/camera-angle` (ADR 0008): independent of the active
preset, single-attempt (no retry-with-strengthened-prompt loop), strict
JSON Schema with a single required property, 60-second timeout, file
cleanup on success and on error.

### 2. Three new server-side helpers + prompts

- `callMiniMaxActionsAnalysis(imageDataUri)` — uses `DEFAULT_ACTIONS_PROMPT`.
- `callMiniMaxMoodAnalysis(imageDataUri)` — uses `DEFAULT_MOOD_PROMPT`.
- `callMiniMaxLightingAnalysis(imageDataUri)` — uses `DEFAULT_LIGHTING_PROMPT`.

Each prompt is a focused, field-only system prompt that excludes the
adjacent fields (so the LLM cannot slip into describing subject / lighting
/ mood when asked for actions, etc.) and enforces the existing
length-contract floor (30 words for textarea fields, 4 words for text
fields). All three prompts:

- Forbid meta-references to the medium ("the painting", "the photograph",
  "the image", "the artwork", "the illustration").
- Forbid the standard forbidden aesthetic vocabulary ("beautiful",
  "striking", "vibrant", "dramatic", "elegant", "majestic", "imposing",
  "ethereal", "luminous", "bold").
- Forbid commentary on adjacent fields by name (subject, style, medium,
  composition, etc., as relevant per field).
- Require coverage of an explicit category list (see §2a–§2c below).

#### 2a. `DEFAULT_ACTIONS_PROMPT` categories

1. **Body kinematics** — posture, limb positions, head orientation,
   facial expression, gaze direction.
2. **Object interactions** — hands holding, gripping, touching, or
   manipulating objects; tools in use; objects being moved.
3. **Multi-figure dynamics** — who is doing what relative to whom;
   interactions between subjects; group activity.
4. **Implied motion** — static vs. mid-action; motion blur; movement
   direction; energy / stillness.
5. **Scene narrative** — the moment's apparent context (working,
   resting, performing, conversing, in transit, …).

Length: 50–120 words. Minimum 30 words (the textarea floor).

#### 2b. `DEFAULT_MOOD_PROMPT` categories

1. **Primary emotional tone** — the dominant affective register
   (uplifting, somber, tense, contemplative, playful, etc.).
2. **Secondary undercurrent** — any contradicting or layering emotional
   signal ("bittersweet", "quietly defiant", "triumphant but exhausted").
3. **Atmosphere** — ambient temperature (warm, cold, intimate, vast,
   enclosed, exposed).
4. **Pacing** — energetic, languid, frozen, urgent, measured.
5. **Viewer response cue** — what reaction the image invites (invites
   contemplation, demands attention, disarms, unsettles, reassures).

Length: 30–80 words. Minimum 30 words (the textarea floor).

#### 2c. `DEFAULT_LIGHTING_PROMPT` categories

1. **Light source / type** — natural (sun, sky, ambient), artificial
   (tungsten, fluorescent, LED, neon), stylized (candlelight, fireplace).
2. **Direction** — front, side, back, top, under, ambient/diffuse,
   multi-source.
3. **Quality** — hard vs soft, harsh vs diffused, specular vs matte,
   specular highlights present.
4. **Color temperature** — warm (golden, amber), cool (blue, cyan),
   neutral, mixed.
5. **Shadow behavior** — present / absent, hard-edged, soft, long,
   short, multiple shadow directions.

Length: 25–80 words. Minimum 4 words (the text floor; the schema-level
floor is set higher — see below).

The JSON schemas enforce the field minimum:

```json
// actions + mood (textarea)
{ "type": "string", "minLength": 60 }

// lighting (text)
{ "type": "string", "minLength": 20 }
```

`minLength: 60` for `actions` and `mood` (≈ 12 words at English average)
excludes single-clause responses that satisfy the 30-word floor but add no
real signal. `minLength: 20` for `lighting` mirrors ADR 0008's camera-angle
floor — enough for "soft golden hour light from camera-left" but excluding
single-word responses like "overcast".

### 3. Three new UI controls: "Populate with AI" buttons

Each button is a `.btn-secondary` rendered directly beneath its field's
input in the analysis editor — only when that field is in the preset's
`stage1_fields` (the button lives with its field, not as a global control,
mirroring ADR 0004 / ADR 0008).

Click handler mirrors `populateSubjectWithAI` (ADR 0004):

- Client-side "no image" guard: if `state.currentFile` is null, surface a
  `showError` and return without firing the network request.
- In-flight guard: a per-field `isPopulating*` state flag prevents
  double-clicks during the request.
- Disables the button + shows an inline spinner while in flight.
- On success, updates `state.currentAnalysis[fieldName]` and the field's
  DOM value in-place — no full re-render (preserves edits to other
  fields).
- On failure, surfaces the error via the existing `showError` toast.

### 4. Two new UI primitives: curated preset chips

For `mood` and `lighting`, a second row of clickable chips appears
beneath the "Populate with AI" button. The chips are **not** persisted —
they are a static, code-defined taxonomy that ships with the app. They
complement (not replace) the AI re-analysis: chips give an instant
zero-credit manual override, the AI button gives a custom
image-derived description.

#### 4a. Mood presets (28 chips, 5 categories)

Categories group chips visually with a small label prefix:

| Category | Chips |
|---|---|
| **Positive** | joyful, happy, playful, hopeful, serene, content, romantic, triumphant, whimsical |
| **Reflective** | introspective, contemplative, melancholic, wistful, nostalgic, somber, lonely, pensive, brooding |
| **Intense** | dramatic, tense, ominous, mysterious, anxious, urgent, fierce, defiant, restless |
| **Atmospheric** | dreamlike, ethereal, surreal, mystical, magical, transcendent, cinematic |
| **Still** | quiet, peaceful, calm, meditative, intimate, hushed, restrained |

Click handler:

- Sets the field's input value to the chip's label as a one-line
  descriptor (e.g., clicking "serene" sets the mood textarea to
  `"serene"`).
- Updates `state.currentAnalysis.mood` so the analysis snapshot stays
  in sync.
- The user can freely edit the value after clicking — chips are a quick
  starting point, not a lock.
- The chip does not "stick" as selected — each click is independent, and
  the user can chain chips (each replaces the field value) or layer chips
  in their own words after.

#### 4b. Lighting presets (28 chips, 5 categories)

| Category | Chips |
|---|---|
| **Natural** | golden hour, blue hour, midday sun, overcast, dappled, twilight, dawn, harsh sun |
| **Directional** | backlit, side-lit, top-down, underlit, rim-lit, edge-lit, silhouette |
| **Quality** | soft diffused, hard shadows, harsh contrast, low-contrast, flat, specular |
| **Stylized** | chiaroscuro, low-key, high-key, neon, candlelight, fireplace, streetlight, fluorescent |
| **Studio** | studio softbox, three-point, ring light, Rembrandt, butterfly, split |

Click handler mirrors mood chips: sets the input value to the chip's
label, updates `state.currentAnalysis.lighting`, does not "stick".

#### 4c. Why chips, not a dropdown or modal

A dropdown (`<select>`) shows one value at a time and forces two clicks
(open + select). A modal is heavy — the user opens a list, picks, closes.
A chip row lets the user see the full taxonomy at a glance and click any
option in one motion. Mood and lighting taxonomies are short enough
(28 each) that a single wrap-flow row of chips fits within the existing
field-row layout. The taxonomy is intentionally short — these are
starting points, not an exhaustive list of every valid mood / lighting
descriptor.

#### 4d. Why code-defined, not persisted (unlike ADR 0009)

Saved directives (ADR 0009) are a user library of free-form Stage-2
inputs that need persistence, version history, search, and tags because
the user's content is bespoke and per-job. Mood and lighting chips are a
**canonical taxonomy** — the same set should appear for every user on
every job, and they don't evolve per-job. A persisted user library would
add three pieces of friction (Save / Apply / Manage modals) for a UX
that wants a single click. The ADR 0009 persistence pattern would be
over-engineered for this surface.

If users later ask for a "save my own mood / lighting chips" library,
that's a follow-up ADR — but the static taxonomy is the right starting
point because every user benefits from the canonical set immediately.

### 5. Out of scope for this ADR

- **No actions chips.** Actions are too image-specific for a curated
  taxonomy — adding chips here would force arbitrary / incomplete
  choices. The AI re-analysis is the right fix for actions.
- **No prompt editor modals.** Like ADR 0008's camera-angle prompt, the
  three new prompts are shipped-default code constants. User iteration
  via the UI is out of scope; if it proves useful, follow up with an
  ADR mirroring ADR 0005's edit-prompt modal pattern.
- **No retry-with-strengthened-prompt loop.** Same reasoning as ADR
  0008: the prompts are short, explicit, and self-contained; a retry
  would just double API cost without changing the outcome.
- **No per-preset override.** Unlike Stage 2 prompts (ADR 0007), these
  prompts are preset-independent. The contract is the same regardless of
  the user's eventual prompt target.
- **No length-override mechanism.** Length floors are fixed at the schema
  level (`minLength: 60` for `actions` + `mood`, `minLength: 20` for
  `lighting`).

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
               │  (description-first, length-guarded)  │   compresses actions,
               │                                       │   mood, lighting)
               └─────────────┬─────────────────────────┘
                             │
                             ▼
               ┌───────────────────────────────────────┐
               │  Step 3 — analysis editor             │
               │                                       │
               │   actions    ┌───────────────────┐    │
               │   [prose from Stage 1]                │
               │   [Populate with AI] ◄── NEW (ADR 0018) │
               │              │                        │
               │              ▼ (uploads image)       │
               │   POST /api/actions                   │
               │      └─► callMiniMaxActionsAnalysis  │
               │          (actions-only prompt)        │
               │      └─► { actions: "..." }          │
               │              │                        │
               │              ▼                        │
               │   actions textarea updated in-place  │
               │                                       │
               │   mood       ┌───────────────────┐    │
               │   [prose from Stage 1]                │
               │   [Populate with AI] ◄── NEW (ADR 0018) │
               │              │                        │
               │              ▼ (uploads image)       │
               │   POST /api/mood                      │
               │      └─► callMiniMaxMoodAnalysis     │
               │          (mood-only prompt)          │
               │      └─► { mood: "..." }             │
               │                                       │
               │   [mood presets row ◄── NEW (ADR 0018)│
               │    Positive: joyful happy playful …   │
               │    Reflective: introspective …        │
               │    Intense: dramatic tense …          │
               │    Atmospheric: dreamlike …           │
               │    Still: quiet peaceful …            │
               │   (click chip → fills mood value)     │
               │                                       │
               │   lighting   ┌───────────────────┐    │
               │   [short text from Stage 1]           │
               │   [Populate with AI] ◄── NEW (ADR 0018) │
               │              │                        │
               │              ▼ (uploads image)       │
               │   POST /api/lighting                  │
               │      └─► callMiniMaxLightingAnalysis │
               │          (lighting-only prompt)       │
               │                                       │
               │   [lighting presets row ◄── NEW (ADR 0018)]
               │    Natural: golden hour blue hour …   │
               │    Directional: backlit …             │
               │    Quality: soft diffused …           │
               │    Stylized: chiaroscuro …            │
               │    Studio: studio softbox …           │
               │   (click chip → fills lighting value) │
               └───────────────────────────────────────┘
```

## Files changed

| File | Change |
|---|---|
| `server.js` | New `DEFAULT_ACTIONS_PROMPT`, `DEFAULT_MOOD_PROMPT`, `DEFAULT_LIGHTING_PROMPT` constants. New `callMiniMaxActionsAnalysis`, `callMiniMaxMoodAnalysis`, `callMiniMaxLightingAnalysis` helpers (single-attempt, schema builder inline). Three new POST routes (`/api/actions`, `/api/mood`, `/api/lighting`) reusing the existing `upload.single('image')` multer middleware. Module exports for the three new helpers and three new prompts. |
| `src/app.js` | Three new state flags (`isPopulatingActions`, `isPopulatingMood`, `isPopulatingLighting`). Three new handlers (`populateActionsWithAI`, `populateMoodWithAI`, `populateLightingWithAI`) mirroring `populateSubjectWithAI` (ADR 0004) and `populateCameraAngleWithAI` (ADR 0008). In `renderAnalysisEditor`, append a `.btn-secondary` "Populate with AI" button for `actions`, `mood`, `lighting` below the input. For `mood` and `lighting`, additionally append a `.preset-chips` row (code-defined taxonomy, see §4a / §4b) below the button. |
| `src/styles.css` | Three new `.btn-populate-*` selectors mirroring the existing populate button sizing. New `.preset-chips`, `.preset-chip-group`, `.preset-chip-label`, `.preset-chip` selectors (chip row, group label, clickable chip). |
| `CONTEXT.md` | Pipeline-stages section now mentions Stage 1.A (actions re-analysis), Stage 1.M (mood re-analysis), Stage 1.L (lighting re-analysis). Field palette notes that `actions`, `mood`, `lighting` have dedicated re-analysis endpoints, and that `mood` / `lighting` have curated preset chips. |
| `README.md` | Three new endpoints documented under API Endpoints. New "Curated mood and lighting presets" subsection in the Usage / Step 3 section. |
| `tests/run-all.js` | Per-field test groups mirroring ADR 0008: (a) endpoint registered, (b) helper + default prompt exported, (c) default prompt excludes adjacent-field commentary + forbidden vocabulary, (d) default prompt mandates its category list, (e) route uses multer middleware, (f) HTTP integration: route accepts upload + reaches LLM (200/500/503). Plus frontend tests: (g) populate handler + button rendered + no-image guard, (h) CSS selector defined, (i) preset taxonomy present in app.js with correct category structure. |

No changes to `data/presets.json`, `FIELD_PALETTE`, `FIELD_FORMAT_HINTS`,
or the existing per-preset system prompts.

## Why these decisions

- **Three dedicated endpoints, not a flag on `/api/analyze`.** Each
  field's contract is mutually exclusive with the preset-bound Stage 1
  schema. A flag would entangle three different contracts in one handler,
  and the system prompt would have to be constructed conditionally. A
  dedicated endpoint keeps each handler reading as a single linear
  narrative — mirrors ADR 0004 and ADR 0008.
- **No preset dependency.** Re-running the analysis with a different
  preset selected should still work, because each contract (actions,
  mood, lighting) is the same regardless of the user's eventual prompt
  target. Decoupling also means the button works after the user switches
  presets mid-edit.
- **No retry loop.** Same reasoning as ADR 0004 and ADR 0008: the prompts
  are short, focused, and self-contained.
- **Length floors at the schema level.** `minLength: 60` for `actions`
  and `mood` excludes single-clause responses; `minLength: 20` for
  `lighting` mirrors ADR 0008's camera-angle floor.
- **In-place DOM update, not full re-render.** The user may have edited
  other fields. A full re-render would clobber those edits. Each handler
  updates only its field's value and `state.currentAnalysis[fieldName]`.
- **`.btn-secondary` styling, not a new visual primitive.** The existing
  `.btn-secondary` already has hover, focus, disabled, and loading
  spinner styles. A new class without a clear use case would be visual
  drift (drift-prevention.md §6).
- **Client-side "no image" guard.** Mirrors ADR 0004 / ADR 0008.
  Prevents a 400 from the route when the analysis editor is open with no
  image.
- **Chips for mood and lighting, not actions.** Mood and lighting have
  well-known canonical taxonomies; actions are too image-specific for a
  small static set to be useful.
- **Code-defined taxonomy, not persisted.** Mood and lighting chips are
  a canonical taxonomy shared across all users; persisted user
  libraries (ADR 0009) are for bespoke content. A persisted library would
  add Save / Apply / Manage friction that contradicts the
  one-click-quick-pick UX. If user iteration proves useful, follow up
  with a separate ADR.
- **Chip click replaces, doesn't append.** Each click sets the field to
  the chip's label as a single starting point. Layering multiple chips
  is the user's job (they edit the field after). This keeps the click
  semantics simple and predictable.
- **Chips don't "stick" as selected.** Each chip click is independent;
  the chip row shows the taxonomy, not the current value. This avoids
  the "where is my active selection" friction of dropdowns and the
  "deselect before you can pick another" friction of toggles.

## Trade-offs and risks

- **Three extra API calls per Populate click.** Each click costs one
  MiniMax M3 vision call. The button is only meaningful after an
  analysis has run, so users who spam-click will spend credits
  intentionally. There's no rate-limit or debounce in this iteration;
  add one if abuse becomes a problem.
- **Curated chips may feel arbitrary.** A user wanting "brooding,
  pensive, melancholy" gets three near-synonyms; a user wanting
  "psychedelic" or "hallucinatory" gets nothing in the curated set. The
  user can always edit the field after clicking — the chip is a starting
  point, not a closed list — and the "Populate with AI" button is the
  AI-derived escape hatch. This is the same trade-off every static
  taxonomy makes; ADR 0009's saved directives exist for users who want
  a personalized library.
- **Mood / lighting chips share vocabulary.** Some chips overlap
  (e.g., mood's "dramatic" and lighting's "dramatic contrast"). They
  live on different fields so there's no UI confusion, but the same
  word can mean different things — "dramatic" for mood is
  affect (intensity of feeling), while "dramatic" lighting would be
  chiaroscuro-style. The chip taxonomy is curated per field so the
  overlap is intentional and the user always knows which field they're
  populating.
- **LLM may slip into forbidden vocabulary.** The forbidden list is a
  strong signal but not a guarantee. The user can edit the response,
  which is the same escape hatch available for every other Stage 1
  field. No regex post-filter is applied — false positives would be
  worse than occasional slips.

## Verification

- `node scripts/session-init.js` — must still report 10/10 checks.
- `node tests/run-all.js` — all tests (existing + new) must pass.
- Manual smoke: with a real image and a real `MINIMAX_API_KEY`, upload an
  image, run Stage 1 with any preset that includes `actions`, `mood`,
  `lighting` in `stage1_fields`. Then:
  - Click "Populate with AI" beneath each field. Confirm the response
    has `success: true` and a non-empty string ≥ the schema `minLength`.
    Confirm the field input value updates immediately after the API
    call returns.
  - Confirm other fields in the analysis editor (subject, style, colors,
    etc.) remain unchanged after each populate click.
  - Click a mood chip — confirm the mood textarea is filled with the
    chip's label. Edit the field after clicking — confirm edits stick.
  - Click a lighting chip — confirm the lighting input is filled with
    the chip's label.
  - Click "Populate with AI" with no image uploaded (after clearing the
    image preview) — confirm a clear error toast appears without a
    network request firing.