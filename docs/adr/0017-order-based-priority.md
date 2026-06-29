# ADR 0017 — Order-based color priority (replaces ADR 0014 weight system)

## Status

Accepted. Implemented 2026-06-29.

Supersedes the per-color `weight` (integer 1–10) mechanism introduced
by ADR 0014. Adds drag-and-drop reordering to the edit-palette modal.
Accent (boolean) + accent cap (palette-level integer 1–5) + placement
(per-accent text up to 60 chars) + strength (palette-level
`subtle|moderate|strong|strict`) are unchanged and remain orthogonal
to priority.

## Type

User-facing feature + data-shape change + UI re-design. Touches
`server.js`, `src/app.js`, `src/index.html`, `src/styles.css`, and
`tests/run-all.js`. Adds the `sortablejs` dependency.

## Context

ADR 0014 made priority *numerical*: each color carried an integer
`weight` in `[1, 10]`, defaulted to `5`, normalised via
`normalizeColorWeights(colors)` to fractions that drove the
`Color usage budget` block in Stage 2. The edit modal exposed a
per-row slider so users could amplify individual colors.

In practice, the slider proved troublesome:

- The arithmetic was non-obvious: raising one color's weight forced
  proportional shrinkage of every other color. Users who wanted "this
  color to dominate" had to set every other color's weight down — and
  if they later added a new color, they had to redo the relative
  tuning.
- The Stage 2 prompt already presents colors in palette array order
  (`buildColorBudgetBlock` at `server.js:1428`). The
  `dominant → secondary → faint traces of` ladder is order-driven, not
  fraction-driven. Weight was a parallel signal that the LLM had to
  reconcile against order, and `accent` already provided the
  "low-volume, high-focus" override.
- Adding, removing, or reordering colors silently invalidated all the
  weight tuning. The preview bars in the edit modal jumped every
  time, which masked the *intent* behind the weights.
- The post-hoc `strict_pass` validator derived
  `expected_min = max(1, round(weight/2))` — a non-linear mapping
  that was hard to predict and didn't correspond to a clear LLM
  contract.

Users repeatedly asked for "drag-to-reorder" during ADR 0014 Phase 5
UAT. ADR 0013 §9 explicitly deferred that work as out-of-scope
("Reorder changes the meaning of 'this is the third color'"). This
ADR closes that loop: order *is* the priority signal, and the edit
modal exposes it directly.

## Decision

### 1. Priority is the array index, not a numeric field

`palette.colors[]` becomes the canonical priority list:

- `colors[0]` is priority 1 (the highest-priority / dominant color).
- `colors[i]` is priority `i + 1`.
- `colors[colors.length - 1]` is the lowest-priority color.
- Accents follow the same rule *plus* their existing per-color
  overrides (cap, placement) — they are not "lower priority" than
  non-accents, just volume-constrained.

A pure helper `prioritiesFromOrder(colors)` at `server.js` replaces
`normalizeColorWeights`. It returns `{ colors, priorities }` where
`priorities[i] = i + 1`. No sums, no rounding, no fractional
artefacts.

### 2. The on-disk `weight` field is removed

The write paths (`POST /api/palettes`, `POST /api/palettes/custom`,
`PUT /api/palettes/:id`) reject any color object that includes a
`weight` key — return `400 { error: 'colors[N].weight: weight is
no longer accepted; reorder colors instead' }`. This catches
clients built against ADR 0014.

`readPalettes` ignores any pre-existing `weight` field on disk and
does not re-synthesise it. Old palettes are migrated by treating
their existing array order as authoritative — the file on disk stays
byte-identical, but the priority semantics now flow from the order
the editor last saved.

`isPaletteUnweighted` is deleted; every palette is implicitly
ordered. The "pure legacy" opt-out in `buildColorBudgetBlock` is
dropped.

### 3. Drag-and-drop reorder via SortableJS

The edit modal renders each color row with:

- A drag handle (grip icon) on the far left, focusable, draggable via
  pointer or keyboard.
- A "Priority N" chip (e.g. "1", "2", ...) on the left of the row to
  make the priority visible without reordering.

`sortablejs@^1` is loaded as the DnD engine because it:

- Has zero runtime dependencies,
- Provides built-in keyboard accessibility (Tab to handle, Space to
  pick up, ArrowUp/Down to move, Space to drop, Escape to cancel),
- Is small (~12 KB gzipped) and shipped as both ESM and UMD bundles,
- Mature, widely audited, used in many production systems.

On `onEnd`, the edit buffer's `colors[]` is rebuilt from the new DOM
order, and the preview re-renders so the priority chip + bar widths
update immediately. The save flow already serialises `buf.colors`
as-is, so reorder is persisted automatically on the next Save.

### 4. Uniform share, two-knob priority

The `Color usage budget` block lists every color with a
`priority N` label instead of a percent. The *share* is uniform
(`Math.round(100 / colors.length)` per entry) — the proportional
control surface lives in the existing `strength` knob:

- `subtle` — gentle reference colors; complementary tones allowed.
- `moderate` — honour the palette closely; natural shadow deviations.
- `strong` — every named color must appear at least once; no
  off-palette introductions.
- `strict` — every named color appears a priority-derived expected
  count, validated post-hoc.

`strength` is unchanged.

### 5. Strict-pass expected counts from position

`computeStrictPass` rederives `expected_min` from position:

```text
accent:                  expected_min = 1, expected_max = accent_max_mentions
position 0 (priority 1): expected_min = 2, expected_max = Infinity
position ≥ 1:            expected_min = 1, expected_max = Infinity
```

Rationale: position 0 is the dominant color, so we bias the LLM
toward mentioning it twice (matches the prior default `weight: 5 →
Math.round(5/2) = 2`). All other positions require ≥1 mention — the
minimum guarantee.

`strict_violations` keeps the existing shape
(`{ name, hex, expected_min, expected_max, measured, reason }`)
capped at 10 entries.

### 6. ADR 0016 rules 11 + 12 wording refreshes

`DEFAULT_ZIMAGE_STAGE2_PROMPT` rules 11 and 12 are reworded to refer
to "top of the palette list" instead of weight-derived expectations.
The qualitative LLM-facing language is otherwise unchanged.

Rule 11 (current → new):

- Current: "STRENGTH MODIFIER … strict (per-color mention count is
  locked, validated post-hoc)."
- New: "STRENGTH MODIFIER … strict (per-color mention count is
  derived from palette order — priority 1 expects ≥2 mentions, the
  rest ≥1 — and is validated post-hoc)."

Rule 12 (new clause):

- "ACCENT PLACEMENT (when an accent has a placement): accent
  overrides fully replace the original region's color AND must
  appear within the documented placement region. The highest-priority
  accent (top of the palette list) leads the visual hierarchy;
  lower-priority accents fill secondary regions. If the source
  image's accent region contradicts the user-supplied placement,
  user placement wins."

## Implementation outline

### Server (`server.js`)

- Delete constants `MIN_COLOR_WEIGHT`, `MAX_COLOR_WEIGHT`,
  `DEFAULT_COLOR_WEIGHT` (lines 840–842) and exports (5221–5223).
- Delete helpers `validatePaletteColorWeight` (1286–1293),
  `isPaletteUnweighted` (1331–1342), `normalizeColorWeights`
  (1362–1393).
- Add `prioritiesFromOrder(colors)` returning `{ colors: safeColors,
  priorities: [1, 2, …] }`. Single source of truth for priority
  arithmetic.
- Rewrite `buildColorBudgetBlock` to use priority labels and 1/N
  shares. Drop the `isPaletteUnweighted` short-circuit.
- Rewrite `computeStrictPass` `expected_min` to follow rule 5.
- `readPalettes` strips `weight` on read (no synthesis). Pre-existing
  on-disk entries pass through unchanged; legacy weight field is
  simply not echoed back.
- `validatePalette*`: reject any color with a `weight` key (400).
- `snapshotPalette`: stop recording `weight` in `history[]`.
- `applyPaletteToAnalysis`: already drops weight — no change.
- `DEFAULT_ZIMAGE_STAGE2_PROMPT` rules 11 + 12 reworded.

### Frontend (`src/app.js`, `src/index.html`, `src/styles.css`)

- `renderEditPaletteColors`: render drag handle + priority chip; no
  weight input. Iterate `buf.colors` with `c.priority = i + 1` chip.
- Init `Sortable.create(editPaletteColorsList, …)` once after the
  list mounts; on `onEnd`, rebuild `buf.colors` from new DOM order
  and re-render colors list and preview.
- `submitEditPalette`: drop `weight` validation block.
- `wireAddColorRow`: drop `weight: 5` from the add-color default.
- `clientNormalizeColorWeights`: rename to `clientUniformShares` or
  inline; return `displayPct` = `1/N` uniform.
- `renderEditPaletteDistributionBars` / `renderDistributionPanel`:
  use the uniform shares; update label to "Priority N · Color" rather
  than "NN% · Color".
- Edit-modal hint text in `index.html:423` and `index.html:451`
  reworded: "Tweak the colors, flag accents, set per-accent
  placement, then drag rows to set priority" instead of "Adjust
  per-color weight (1–10)".
- `styles.css`: remove `.edit-palette-color-row__weight*` rules;
  add `.edit-palette-color-row__handle` and `__priority` styles;
  update the row `grid-template-columns` from
  `48px minmax(0,1.1fr) minmax(0,1fr) minmax(160px,1fr) auto auto`
  to
  `auto minmax(0,1.1fr) minmax(0,1fr) auto auto auto`;
  tighten the mobile breakpoint.
- `package.json`: add `sortablejs: ^1`.

### Tests (`tests/run-all.js`)

- Delete tests targeting the removed helpers
  (`validatePaletteColorWeight`, `normalizeColorWeights`,
  `isPaletteUnweighted`, weight-round-trip in
  `readPalettes`/`snapshotPalette`/REST routes, the
  `rejects invalid weight` cases).
- Add tests for `prioritiesFromOrder` (empty, single, multi, defensive
  against missing `accent`/`placement`).
- Add tests for `buildColorBudgetBlock` using priority labels and
  uniform 1/N fractions (plus the existing accent/placement cases).
- Add tests for `computeStrictPass` priority-derived expected counts
  (priority 1 → 2; priority ≥ 1 → 1; accent unchanged).
- Add tests for `readPalettes` ignoring pre-existing `weight` and
  not synthesising one.
- Add tests that `validatePalette*` rejects a body with `weight`.
- Add frontend HTML/CSS/JS assertions: handle exists, priority chip
  exists, weight input is gone, edit-modal hint reworded.
- Add a Playwright cross-browser DnD test (Chromium, Firefox, WebKit,
  and Chromium mobile viewport) that opens the edit modal, drags the
  lowest-priority color to the top, asserts new order in the DOM and
  confirms the chip labels flip.

## Trade-offs

### Why not keep both: numeric weight AND order?

Two priority signals invite conflicts. The Stage 2 prompt can only
emit one priority chain per call; the LLM has to pick a winner. In
testing, mixed signals routinely produced output that honoured the
weaker axis and dropped the other. A single axis — order — is
strictly clearer to author and to validate.

### Why uniform share instead of geometric / Fibonacci?

Geometric decay (e.g. `2 / (i + 1)`) gives a more visually
"weighted" feel — top color gets a chunky slice, the bottom gets a
sliver. It also re-introduces the silent-rebalance problem every
time the user adds or removes a color. Uniform share is *boring on
purpose*: it doesn't lie about importance, and the importance signal
lives in the order + the `strength` level. Anyone who needs a
non-uniform distribution can drop `strength` to `strict` and let
`expected_min` govern.

### Why not keyboard-only reorder (up/down buttons)?

The drag-and-drop UX was the explicit ask from ADR 0013 §9 and
recurring UAT feedback. Keyboard accessibility is a baseline, not
the primary input. SortableJS gives both with one dependency.

### Why forbid `weight` rather than ignore it silently?

Silent ignore produces happy-path works-on-my-machine failures when
an older ADR 0014 client still sends weight and never realises the
field is dead. The 400 is loud, cheap, and self-documenting.

## Success criteria

- `node tests/run-all.js` reports 0 failed, with new + rewritten
  tests replacing the deleted weight tests.
- Playwright DnD test passes in Chromium, Firefox, and WebKit; mobile
  viewport (375×812) tab-order + drag-via-touch also passes.
- Drag a color from the bottom to the top of the list in the edit
  modal, save, reload the modal — the chip labels ("1", "2", ...)
  match the new order, and `GET /api/palettes/:id` returns colors in
  that order.
- `GET /api/palettes` continues to load pre-ADR-0017
  `data/palettes.json` files without error.
- Stage 2 prompt runs against the new palette and emits a budget
  block listing colors top-to-bottom in priority order.
- `accent_max_mentions`, `accent` boolean, and `placement` text
  continue to govern the budget block and the strict-pass validator
  exactly as before.

## Out of scope (deferred)

- Multi-select reorder (drag a contiguous range). Current
  implementation reorders one row at a time, which is the
  drag-and-drop minimum.
- Undo/redo of reorder within the modal session. Refreshing the
  modal restores from the buffer; explicit undo lives in the system
  history (ADR 0013 `palette.history[]`).
- Persistence of `priority_order` to `data/palette_runs.json`. The
  telemetry log already records the prompt the LLM produced (which
  contains its own `priority_order` in Section B metadata); the
  server-side priority derivation is reproducible from `palette_id`
  + run timestamp.
