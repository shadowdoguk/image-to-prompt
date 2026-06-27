# ADR 0014 — Weighted color distribution and accent highlighting

## Status

Proposed. Feasibility study accepted by author 2026-06-27; awaiting
implementation in the phased rollout at the foot of this document.

## Type

Feasibility study + phased implementation roadmap. The first half
establishes that the proposal is feasible against the current
infrastructure; the second half is the staged design and rollout. No
code changes land with this ADR.

## Context

ADR 0006 introduced saved color palettes, ADR 0013 added editing and
custom-create, and ADR 0006/0013 together have settled the palette
domain into a mature shape:

- Server stores palettes as `{ id, name, colors, source_run_id,
  source_preset_id, created_at, updated_at, history[] }` at
  `data/palettes.json` (atomic write).
- Each color is `{ hex, name }`, normalized to 7-char lowercase hex on
  save (hex / rgb() / hsl() accepted on input — ADR 0013 §2).
- `applyPaletteToAnalysis` (server.js:669) strips `colors` from the
  Stage 1 schema and injects the palette's colors after the LLM call.
- Stage 2 (`/api/generate-prompt`, server.js:2743) JSON-stringifies
  `{ analysis, directives }` into the user message and asks the LLM
  to synthesize the final image-generation prompt. The Stage 2 system
  prompt (preset-defined or per-preset override, ADR 0007) is the
  only thing that tells the LLM how to use the colors.

Real use of the palette feature has surfaced a recurring limitation
that the next user request formalizes:

- All saved colors are **implicitly equal weight**. Once a palette is
  applied, the Stage 2 LLM gets a flat list and decides for itself
  which colors dominate. Users with a deliberate palette (a brand kit,
  a designed poster reference) have no way to say "this is the
  dominant blue, this is the support, and this red is a punchy
  accent — use it once or twice, not on every object."
- The user can't flag a color as a "punchy accent" with a cap on how
  often it shows up. The system has no vocabulary for accent vs.
  dominant vs. supporting color.
- There's no visibility into how the LLM actually used the palette in
  the last generated prompt, so when the user feels a color is over-
  or under-used they have no signal to act on.

The requirement (from the user request that triggered this ADR):

1. Per-color percentage-style weight values; higher weighted colors
   receive more frequent distribution in generated prompts.
2. Weight-calculation algorithm that handles edge cases (sum not
   equal to 100%).
3. A way to flag specific colors as "punchy accent" with built-in
   controls to limit overuse while keeping them prominent.
4. A visual interface showing accent status, weight values, and
   real-time distribution metrics.
5. A phased implementation roadmap with testing milestones and a UAT
   gate before full deployment.

This ADR responds with (a) a feasibility verdict against current
infrastructure, (b) the design if feasibility holds, (c) the phased
rollout with UAT gates.

## Feasibility study

### A1. Current infrastructure audit

| Layer | Today | Adequate? |
|---|---|---|
| Persistence — palette schema | `data/palettes.json`, atomic write, history[] per palette (ADR 0013). | **Yes.** Adding optional per-color `weight` + `accent` fields is a backwards-compatible schema extension. `readPalettes` already synthesizes missing `history: []` for legacy entries; the same forgiving pattern handles legacy colors without `weight`. |
| Persistence — color shape | Each color is `{ hex, name }`; hex normalized on save. | **Yes.** Extend to `{ hex, name, weight?: number, accent?: boolean }`. Same `{ hex, name }` consumers (picker chips, analysis chips, renderColorsInput, color-chip CSS) keep working — extra fields are ignored by them. |
| Validation — colors on write | `validatePaletteColorsFlexible` (server.js:790) checks shape and parses hex/rgb/hsl. | **Yes.** Extend to also accept and validate the optional `weight` (integer 1–10) and `accent` (boolean). Failures return the same 400 envelope. |
| Stage 2 — color injection | `callMiniMaxStage2` (server.js:2091) JSON-stringifies `{ analysis, directives }` into the user message; the Stage 2 system prompt directs the LLM. | **Partial.** This is the seam that needs to change, but it's a single function — the only place where the analysis envelope is built. Adding a deterministic color-budget block is a small, local change. The LLM still interprets, but the budget is testable on the input side. |
| Stage 2 — system prompt ownership | Per-preset `stage2_system_prompt` with `data/stage2_overrides.json` overrides (ADR 0007). | **Yes.** The weight/accent contract is delivered as a *separate* block appended to the user message (not the system prompt). Preset authors don't need to know about weighting — the server appends the budget deterministically regardless of preset. |
| Frontend — chip rendering | `renderColorsInput` (src/app.js:754) + `.color-chip` (src/styles.css:440). Renders swatch + hex + name + remove. | **Yes.** Adding a `[data-accent="true"]` variant for a glow/badge and a small weight chip is purely additive CSS + 1 new `<span>` per chip. |
| Frontend — palette edit modal | `openEditPaletteModal` (src/app.js:1940 area) with name, color rows, add-color form, history. | **Yes.** Adding a weight slider + accent toggle per color row is a localized extension; the buffer shape grows the same way as the on-disk shape. |
| Frontend — palette manager / picker | Manager modal lists palettes; picker is a `<select>`; apply-on-edit uses `populateApplySelect`. | **Yes.** No change needed for basic selection. A new "Distribution" tab/panel in the edit modal is where metrics render. |
| Testing | `tests/run-all.js` covers all existing palette helpers with pure-function + HTTP integration tests. | **Yes.** New pure helpers (normalize weights, build budget, measure distribution) get unit tests; new routes / extended behavior get HTTP integration tests. The session-init 10/10 gate stays in place. |
| Concurrency | Single-user, naive writes, no file lock (ADR 0005 trade-off). | **Same.** Weight metadata is written through the same `writePalettes` path. No new concurrency hazard. |
| LLM behaviour — can it honour a budget? | `MiniMax-Text-01` (MiniMax M3) is instructed via JSON envelope + system prompt; weighted-color guidance is a standard "use color X more than Y" instruction. | **Plausible but not guaranteed.** This is the only risk. Mitigation: (a) deterministic budget block is testable on its own; (b) post-Stage-2 measurement pass exposes *observed* distribution so the user can see whether the LLM respected the budget. We do not promise a distribution contract — we promise a budget plus visibility. |
| Export format | No `.i2p.json` palette envelope yet (deferred in ADR 0013 §9). | **N/A for this ADR.** No export format change implied. |

### A2. Verdict

**Feasible.** All hard infrastructure (persistence, validation, the
Stage 2 envelope seam, the chip renderer, the test harness) is in
place. The only soft dependency is LLM obedience to a color-budget
block, which is observable (and the dashboard surfaces the
measurement) rather than enforceable.

### A3. Three strategies considered

| Strategy | Where weighting is applied | Determinism | Testability | Risk |
|---|---|---|---|---|
| **A. Server-side metadata appended to the Stage 2 envelope.** Server computes a deterministic color-budget block (per-color fraction, accent cap) and adds it to the user message alongside the analysis JSON. | Input side. | High — the budget is a pure function of the palette. | High — `buildColorBudgetBlock(palette)` is a pure helper; the generated text is fixture-friendly. | LLM may under- or over-shoot. Measured on the output side and surfaced in the dashboard. |
| B. Post-Stage-2 output rewrite. Server mutates the LLM's output string to insert/remove color mentions to hit targets. | Output side. | High in theory. | Low — string rewriting against arbitrary LLM wording is brittle (the LLM may write "crimson" not "red"; may not name colors at all in some presets). | Brittle, high maintenance, fights the LLM. **Rejected for v1.** |
| C. LLM-side via Stage 2 system prompt only. Rely on the system prompt telling the model to weight colors, with no server-side budget. | Prompt only. | Low — model-dependent. | Low — no server-side artifact to assert against. | Same as today; gives the user no leverage. **Rejected.** |

**Decision: Strategy A.** The budget is a server-side artifact the
user can read and trust; the dashboard measures what the LLM actually
did with it. Strategy B is deferred as v2 if measurement shows the
budget alone isn't enough. Strategy C is the status quo and not a
solution.

### A4. Out of scope (deliberate cuts)

These are documented here so the scope is locked before phases 1–5
begin. Each is a real future ADR if a use case surfaces.

- **Strict-percentage sum constraint.** Weights are positive
  integers (1–10) that are normalized at injection time. The "sum
  not equal to 100%" edge case the requirement asks about is
  addressed by *not requiring a sum at all* — the only invariant is
  that each weight is a finite positive integer.
- **Post-generation string rewriting** (Strategy B). Out for v1;
  revisit if Phase 4 telemetry shows the budget alone is ignored.
- **Per-color accent_max_mentions override.** v1 uses one global
  `accent_max_mentions` per palette (default 2). Per-color override
  is a v2 affordance if designers ask for it.
- **Accent-color highlight in the Stage 2 *output* prompt.** The
  server can request emphasis, but it cannot guarantee it. The
  dashboard measures observed emphasis — that's the v1 deliverable.
- **Cross-palette weighting.** A single palette is the unit of
  weighting. Merging two palettes (already out of scope per ADR
  0006 §9) would be a prerequisite.
- **Sharing weighted palettes as `.i2p.json`.** Out of scope per
  ADR 0013 §9.
- **Color spaces beyond sRGB hex.** The on-disk shape is hex; the
  budget block uses names + hex. Anything fancier is a separate ADR.

## Design (if feasibility holds — it does)

### 1. On-disk schema (extended)

```json
{
  "id": "palette_...",
  "name": "Sunset ochres",
  "colors": [
    { "hex": "#d97706", "name": "burnt orange", "weight": 8, "accent": false },
    { "hex": "#7c2d12", "name": "deep brown",   "weight": 3, "accent": false },
    { "hex": "#dc2626", "name": "signal red",   "weight": 5, "accent": true }
  ],
  "accent_max_mentions": 2,
  "source_run_id": "run_...",
  "source_preset_id": "preset_...",
  "created_at": "...",
  "updated_at": "...",
  "history": [
    {
      "version": 1,
      "name": "Sunset ochres",
      "colors": [
        { "hex": "#d97706", "name": "burnt orange" }
      ],
      "accent_max_mentions": 2,
      "saved_at": "..."
    }
  ]
}
```

- `weight` (integer, optional, default **5**). Valid range **1–10**.
  Zero or negative is invalid. Non-integer is invalid.
- `accent` (boolean, optional, default **false**).
- `accent_max_mentions` (integer, optional, default **2**). Valid
  range **1–5**. Cap is per-palette, not per-color, in v1.

#### Backwards compatibility

`readPalettes` synthesises the defaults for any legacy color that
doesn't have `weight`/`accent`:

```js
if (typeof c.weight !== 'number' || !Number.isFinite(c.weight)) c.weight = 5;
if (typeof c.accent !== 'boolean') c.accent = false;
```

`accent_max_mentions` defaults to **2** if missing or invalid.

The existing forgiving-read filter (ADR 0013 §1) is unchanged —
legacy entries stay visible; the first PUT pushes v1 with the
synthesised values, so the on-disk shape normalises over time.

### 2. New pure helpers

| Helper | Purpose |
|---|---|
| `validatePaletteColorWeight(weight)` | Integer in [1, 10]. Returns error string or null. |
| `validatePaletteAccentMaxMentions(n)` | Integer in [1, 5]. Returns error string or null. |
| `validatePaletteColorsWeighted(colors)` | Mirrors `validatePaletteColorsFlexible`, but also validates `weight`/`accent` per entry. Returns `{ colors, error }`. |
| `normalizeColorWeights(colors)` | Pure. Clamps bad weights to defaults, computes `fraction = weight / sum(weights)` per entry. Returns `{ colors: [{...normalized}], fractions: [...], totalWeight }`. **Always returns valid output** — empty/invalid input returns empty arrays and `totalWeight: 0`. |
| `buildColorBudgetBlock(palette)` | Pure. Renders the deterministic budget string that gets appended to the Stage 2 envelope. Includes: per-color fraction as a percentage (0 decimals), accent colors called out, the `accent_max_mentions` cap. |
| `measureColorDistribution(prompt, palette)` | Pure. Tokenizes the LLM output, counts occurrences of each color's name (case-insensitive) and hex (case-insensitive, with and without `#`). Returns `{ counts: { hex: number }[], totalMentions: number }`. Used by the dashboard — does NOT mutate the prompt. |

All helpers are exported (alongside the existing palette helpers) so
they can be unit-tested in `tests/run-all.js` without spinning up the
server.

### 3. The `normalizeColorWeights` algorithm (the edge-case requirement)

This is the algorithm that handles the brief's "sum of weights not
equal to 100%" requirement — by **not requiring a sum at all**, and
instead normalising at injection time:

```text
INPUT: colors = [{ hex, name, weight?, accent? }, ...]

STEP 1 — Synthesise defaults.
  For each color:
    if weight is missing, NaN, non-integer, or outside [1, 10]:
      weight := 5
    if accent is not a boolean: accent := false

STEP 2 — Compute total.
  total := sum(weights)
  if total == 0 (only possible if all colors were clamped to invalid):
    treat as empty palette; return { colors: [], fractions: [], totalWeight: 0 }

STEP 3 — Compute fractions.
  fractions[i] := weight[i] / total      // not the user's percentages;
                                          // these are derived fractions

STEP 4 — Compute percentage display strings (for the budget block + UI).
  displayPct[i] := round((weight[i] / total) * 100)   // 0-decimal int;
                                                       // may not sum to 100;
                                                       // rounding error is
                                                       // shown in the UI
                                                       // ("sums to 99%" or
                                                       // "sums to 101%")

RETURN { colors, fractions, totalWeight, displayPct }
```

**Edge-case matrix (test fixtures):**

| Input | Expected |
|---|---|
| All weights missing | All default to 5; total 25; fractions all 0.2; display all 20%. |
| One color with `weight: 10`, rest default 5 | Higher weight gets 10/(5n+5) of the budget; display rounded. |
| `weight: 0` or `weight: -3` or `weight: 11` | Clamped to 5 (default). Warning logged on the server (single line, no PII). |
| `weight: 5.5` or `weight: "5"` | Clamped to 5; non-integer is treated as invalid. |
| One accent, one not | Accent is preserved in the returned object; `accent_max_mentions` is taken from the palette, not from a per-color field. |
| Two accents, palette has `accent_max_mentions: 1` | Both kept on the palette; the budget block names both and shows the cap (LLM is told "no more than 1 mention across both"). v1 doesn't fail-fast on this — it's a soft warning. |
| Empty palette | Returns empty arrays; `buildColorBudgetBlock` produces an empty string. Stage 2 sees no budget block. |

The `normalizeColorWeights` function is the **single source of
truth** for distribution arithmetic. The UI, the budget block, and the
dashboard all read from its output. This is what makes the system
testable: every distribution question reduces to "what did
`normalizeColorWeights` say?".

### 4. Stage 2 injection — `buildColorBudgetBlock`

Appended to the user message in `callMiniMaxStage2`. The block is
plain English, deterministic, and explicitly names the fractions and
the accent cap. Format (one paragraph):

```
Color usage budget (use these fractions as a guide; do not invent
colors not on this list):
  - burnt orange #d97706: 40%
  - deep brown   #7c2d12: 15%
  - signal red   #dc2626: 45% (ACCENT — mention at most 2 times
                                  total; place where it adds focus)
Sum: 100% (accent cap: 2 mentions)
```

Order matches the palette's color order. Accent colors are tagged
with `(ACCENT — …)`. The block is omitted when `palette.colors` is
empty (no override + Stage 1 didn't extract any) or when the palette
is the bare default (no weighting fields present — pure legacy).

### 5. Telemetry — `measureColorDistribution`

Runs after Stage 2 returns. Reads the LLM output string and counts:

- Color **name** occurrences (case-insensitive, whole-word match).
- Hex string occurrences (`#d97706`, `d97706`, `D97706`).
- Total word count of the output (for "% of words that are colors").

Returns:

```js
{
  counts: [
    { hex: '#d97706', name: 'burnt orange', nameCount: 2, hexCount: 1, totalCount: 3 },
    ...
  ],
  totalMentions: 7,
  totalWords: 84,
  measuredAt: '2026-06-27T...'
}
```

Returned alongside the prompt in the `/api/generate-prompt` response
under a new `distribution_metrics` field. The frontend dashboard
reads this to render "what actually happened" bars next to the
"what was asked for" bars.

### 6. Visual interface

Three surfaces — additive, no removals:

#### 6a. Edit modal — per-color row (extending `renderEditPaletteColors`)

Each color row gains:

```
┌──────────────────────────────────────────────────────────────┐
│ [■] burnt orange  [#d97706]  ✕    Weight [───●────] 7  □ Accent │
└──────────────────────────────────────────────────────────────┘
```

- **Weight slider**: range 1–10, step 1, default 5. Live label.
- **Accent checkbox**: with `aria-describedby` pointing at a one-line
  hint ("Mark as a punchy accent. Use sparingly.").
- When `accent` is checked, the row gets `data-accent="true"` and the
  swatch grows a 2px outline using `--accent` (new CSS variable,
  default `--accent: #f59e0b`).

A "Accent cap: [2]" control sits at the top of the colors fieldset,
editable as `<input type="number" min="1" max="5">`.

#### 6b. Edit modal — live preview row

The existing `.palette-preview` row (ADR 0013 §5) is extended with:

- A "Target distribution" bar chart under the swatches: one
  horizontal bar per color, width proportional to the normalised
  fraction. Colors are labeled with `name · displayPct%`.
- Accent swatches show a small `★` badge in the bar.

```
■■■■■■■■■■■■  40%  burnt orange
■■■           15%  deep brown
■■■■■■■■■■■■  45%  signal red ★
```

Sum annotation reads "Sum: 100%" or "Sum: 99% — rounded" when
displayPct doesn't sum to 100.

#### 6c. New "Distribution" panel (dashboard)

A new collapsible section in the edit modal — only visible when the
palette has been used in at least one Stage 2 run — that reads
`distribution_metrics` from the most recent response and shows:

- Per-color **target** vs **measured** bar (two bars side by side).
- Total mentions, total words, accent mention count vs cap.
- "Last run at HH:MM" timestamp.

The panel fetches `/api/palettes/:id/distribution` (new endpoint) for
the latest telemetry if present. v1 persists distribution metrics
only on the most recent run (in-memory or as a new
`data/palette_runs.json` file, decided in Phase 4).

### 7. Accessibility

- Weight slider: `aria-valuemin/max/now`, label `Weight for <color
  name>`, live region announces value changes.
- Accent checkbox: `aria-describedby` to a `<span>` hint.
- Accent cap input: `aria-label="Maximum accent mentions in this
  palette (1 to 5)"`.
- Distribution bars: `<table>` with `<th scope="row">` per color so
  screen readers announce "burnt orange, target 40 percent, measured
  33 percent" rather than two `<div>`s.
- Color: accent outline uses `--accent` CSS variable plus a
  `data-accent` attribute so it's not color-only (a small `★` glyph
  is also present).

### 8. Out of scope (locked)

Repeated here so the implementation phases don't drift:

- No per-color `accent_max_mentions`.
- No post-Stage-2 output rewriting.
- No percentage sum constraint (weights are normalised, not summed).
- No color space beyond sRGB hex.
- No cross-palette weighting.

## Files that will change (per phase, not in this ADR)

| Phase | File | Change |
|---|---|---|
| 1 | `server.js` | New helpers: `validatePaletteColorWeight`, `validatePaletteAccentMaxMentions`, `validatePaletteColorsWeighted`, `normalizeColorWeights`, `buildColorBudgetBlock`, `measureColorDistribution`. Extend `readPalettes` to synthesise defaults for legacy colors. Extend `validatePalette` + `validatePaletteEdit` + `validatePaletteColorsFlexible` to accept the new fields. New exports. |
| 1 | `data/palettes.json` | No schema change (new fields are optional). First PUT normalises legacy palettes. |
| 1 | `tests/run-all.js` | ~25 new tests for the helpers + edge-case matrix. |
| 2 | `server.js` | `callMiniMaxStage2` calls `buildColorBudgetBlock` and appends to the user message; `/api/generate-prompt` response includes `distribution_metrics` from `measureColorDistribution`. |
| 2 | `tests/run-all.js` | HTTP integration test: budget block appears when palette has weights; metrics object is populated when given a mock LLM. |
| 3 | `src/index.html` | New fields in `#edit-palette-colors-list` row template (slider, accent checkbox). New "Accent cap" control at the top of the colors fieldset. New "Target distribution" bars in `.palette-preview-row`. |
| 3 | `src/app.js` | `renderEditPaletteColors` renders slider + accent + weight/accent state. Buffer shape gains `weight`/`accent`. `submitEditPalette` sends them. New client-side validators mirror the server. |
| 3 | `src/styles.css` | New `.edit-palette-color-row__weight`, `.edit-palette-color-row__accent`, `.palette-preview__bar`, `.palette-preview__bar[data-accent="true"]` rules. New `--accent` CSS variable. |
| 4 | `server.js` + new file `data/palette_runs.json` | New endpoint `GET /api/palettes/:id/distribution`. Telemetry writer appends after each Stage 2 run. |
| 4 | `src/index.html` + `src/app.js` | New collapsible `<details>` block in the edit modal: `renderDistributionPanel`. Reads `/api/palettes/:id/distribution`. |
| 5 | `README.md` | New "Weighted distribution and accents" section. Update API table. Update Features bullet list. |
| 5 | `CONTEXT.md` | Update the "Saved palette" entity row to mention `weight`, `accent`, `accent_max_mentions`. Add row referencing ADR 0014 in the recent ADRs list. Update Stage 2 description to note the budget block. |

No changes to `FIELD_PALETTE`, `validateStage2Prompt`, the existing
`applyPaletteToAnalysis` contract, the Stage 1 / Stage 1.5 / Stage
1.S / Stage 1.C logic, or the Stage 2 system prompt content.

## Verification (per-phase gates)

### Gate A — every phase

- `node scripts/session-init.js` must report **10/10** passed.
- `node tests/run-all.js` must report **0 failed**, with the new
  tests included.

### Gate B — Phase 1 only

- `normalizeColorWeights` test fixtures cover every edge case in
  the matrix above (8+ fixtures).
- `validatePaletteColorWeight` rejects 0, -1, 11, 5.5, "5", null,
  undefined.
- `validatePaletteAccentMaxMentions` rejects 0, 6, -1, "x".
- `readPalettes` on a legacy palette (no `weight`) returns colors
  with `weight: 5`.

### Gate C — Phase 2 only

- A palette with two colors at weights 8 and 2 produces a budget
  block whose percentages read "80%" and "20%" respectively (via
  fixture string comparison).
- An accent palette produces the `(ACCENT — mention at most N times
  total)` clause.
- A legacy palette (no weights) produces no budget block.
- `/api/generate-prompt` response envelope carries
  `data.distribution_metrics` for every successful run.

### Gate D — Phase 3 only

- `#edit-palette-colors-list` template contains `<input type="range"
  min="1" max="10">` and an accent checkbox per row.
- Each row has `data-color-index` (already present) plus
  `data-accent="true"` when the color is flagged.
- `.palette-preview__bar[data-accent="true"]` rule exists in CSS.
- Submitting via `PUT /api/palettes/:id` round-trips `weight` and
  `accent` (HTTP integration test).
- Keyboard: Tab through weight slider → accent checkbox → accent
  cap input → next color's slider. Visible focus at every step.

### Gate E — Phase 4 only

- `GET /api/palettes/:id/distribution` returns the latest telemetry
  for the palette.
- A run with no telemetry returns 404 with a clear error
  ("no distribution metrics recorded yet for this palette").
- The Distribution panel renders target vs measured bars side by
  side, with accent count vs cap.

### Gate F — Phase 5 (UAT — manual)

UAT runs **before full deployment** on a fixed reference set:

1. **Reference palette A** ("Sunset ochres", 3 colors, one accent)
   saved from a real run.
2. **Reference palette B** (5 colors, two accents, uneven weights)
   created via `POST /api/palettes/custom`.
3. **Legacy palette C** (one created before this ADR, no weights) —
   must keep working without re-save; first PUT normalises it.

UAT checklist:

- [ ] Palette A applied via Step 1 picker → Stage 1 returns →
      analysis chips show palette A's colors → "Save palette" reflects
      weights in the saved JSON.
- [ ] Edit modal opens for A → slider defaults visible, accent
      checkbox checked for the accent color → live preview bars show
      correct target fractions and a ★ on the accent.
- [ ] Stage 2 with A → generated prompt includes the accent color
      name ≤ `accent_max_mentions` times (manual count).
- [ ] Distribution panel shows measured count for each color;
      accent row shows count vs cap.
- [ ] Palette B (two accents, accent_max_mentions=1) → budget
      block names both accents and the cap; LLM output mentions ≤1.
- [ ] Palette C (legacy) → no budget block on first run after
      upgrade → open Edit → Save (no changes) → first PUT
      normalises `weight: 5` on every color.
- [ ] Keyboard navigation through the edit modal weight sliders +
      accent checkboxes → Esc closes; focus returns to the row's
      Edit button.
- [ ] One palette with `accent_max_mentions: 0` (forced via API)
      → Edit modal warns ("cap must be at least 1") and clamps.
- [ ] All three palettes round-trip via Restore to v1 (pre-weight
      snapshot) — restored palette is still weighted (snapshot
      captures post-ADR fields).
- [ ] `node scripts/session-init.js` 10/10; `node tests/run-all.js`
      0 failed.
- [ ] Manual UI smoke: Stage 1 picker → manager → edit modal →
      preview bars → save → Stage 2 → distribution panel → chat
      refinement does not break weight data.

Sign-off requires: the author of the UAT pass + one second reviewer
acknowledge each checkbox, with a screenshot of the distribution
panel attached to the sign-off comment.

## Phased implementation roadmap

Five phases. Each phase is independently shippable behind a feature
flag if needed (the rollout is purely additive). The phases are sized
to land one per working day in the existing single-author rhythm.

### Phase 1 — Data layer + pure helpers (no UI, no LLM change)

**Goal:** Extend the palette schema and validation. Add
`normalizeColorWeights`, `buildColorBudgetBlock`,
`measureColorDistribution`. Lock the algorithm with unit tests.

**Deliverables:**
- New constants in `server.js`: `MIN_COLOR_WEIGHT=1`,
  `MAX_COLOR_WEIGHT=10`, `DEFAULT_COLOR_WEIGHT=5`,
  `MIN_ACCENT_MAX_MENTIONS=1`, `MAX_ACCENT_MAX_MENTIONS=5`,
  `DEFAULT_ACCENT_MAX_MENTIONS=2`.
- `validatePaletteColorWeight`, `validatePaletteAccentMaxMentions`,
  `validatePaletteColorsWeighted` helpers.
- `normalizeColorWeights`, `buildColorBudgetBlock`,
  `measureColorDistribution` pure helpers, all exported.
- Extended `readPalettes` synthesis for legacy colors.
- Extended `validatePalette` + `validatePaletteEdit` to accept
  `colors[i].weight`, `colors[i].accent`, and the palette-level
  `accent_max_mentions`.
- ~25 new unit tests.

**Gate:** Gate A + Gate B.

### Phase 2 — Stage 2 injection + telemetry

**Goal:** `callMiniMaxStage2` appends the budget block; response
envelope carries `distribution_metrics`. No UI change yet.

**Deliverables:**
- `callMiniMaxStage2` resolves the palette (via `analysis.palette_id`
  if present, or via the most-recently-applied palette id stored in
  the chat session if available — Phase 4 will make this more robust;
  Phase 2 only needs the basic case).
- `buildColorBudgetBlock(palette)` is called and the resulting text
  is appended to the user message in a clearly delimited section
  ("Color usage budget: ...").
- After Stage 2 returns, `measureColorDistribution(prompt, palette)`
  populates `data.distribution_metrics` in the response envelope.
- HTTP integration test: budget block content + metrics shape.

**Gate:** Gate A + Gate C.

### Phase 3 — Edit modal: weight slider + accent toggle + live preview

**Goal:** User can adjust weights and toggle accent from the edit
modal. Live preview shows the target distribution.

**Deliverables:**
- Edit modal color-row template gains weight slider (1–10) and
  accent checkbox.
- "Accent cap" number input at the top of the colors fieldset.
- `.palette-preview__bar` chart in the preview row with ★ badges on
  accents.
- Buffer shape carries `weight`, `accent`, `accent_max_mentions`.
- `submitEditPalette` POSTs them; new client-side validators mirror
  server validation.
- CSS for `--accent`, slider, accent outline.
- Accessibility annotations (slider `aria-valuemin/max/now`,
  accent `aria-describedby`).
- HTML/JS assertions + HTTP round-trip test.

**Gate:** Gate A + Gate D.

### Phase 4 — Distribution dashboard

**Goal:** After a Stage 2 run, the edit modal shows target vs
measured bars.

**Deliverables:**
- New file `data/palette_runs.json` (atomic write, mirroring
  `writePalettes`). Each entry: `{ palette_id, run_id, prompt,
  metrics, recorded_at }`. Max 50 entries per palette; oldest
  trimmed.
- New endpoint `GET /api/palettes/:id/distribution` — returns the
  latest entry's `metrics`, or 404 if none.
- `callMiniMaxStage2` appends a new `palette_runs.json` entry on
  every successful run.
- Edit modal gains a collapsible `<details>` block with the
  dashboard. Reads from the new endpoint on open.
- New CSS for the bars + comparison view.

**Gate:** Gate A + Gate E.

### Phase 5 — UAT + docs + rollout

**Goal:** Manual UAT on three reference palettes; README + CONTEXT
update; UAT gate passed before removing any feature flag.

**Deliverables:**
- UAT run by the author; second reviewer sign-off on the checklist
  in Gate F.
- Screenshots of the edit modal weight sliders + preview bars +
  distribution panel for palettes A, B, C, attached to the UAT
  pass entry.
- `README.md` — new "Weighted distribution and accents" section.
  New API endpoint. Note in Features.
- `CONTEXT.md` — Saved palette row updated with the new fields.
  Stage 2 description notes the budget block. New row referencing
  ADR 0014 in the recent ADRs section.
- Rollout: feature flag (default OFF) until UAT passes; flip to
  default ON after Gate F.

**Gate:** Gate A + Gate F. **UAT is a hard gate before default-on.**

## Why these decisions

- **Strategy A (server-side metadata, not output rewriting).** The
  requirement asks for the system to "ensure distribution percentages
  align with assigned weights." The honest answer is that a remote LLM
  cannot be coerced — but the *budget* the server promises is fully
  testable. Strategy B (output rewriting) fights the LLM and is
  brittle; Strategy C (prompt-only) gives no leverage. Strategy A is
  the only one that delivers something verifiable.
- **Integer weights (1–10), not strict percentages.** Percentages
  that must sum to 100 are a UX trap: changing one forces the user to
  recompute the rest, and there's no natural default. Integer weights
  with auto-normalisation are robust to edits (changing one color
  shifts fractions everywhere) and trivially default to "5" for
  legacy palettes.
- **Single source of truth for arithmetic: `normalizeColorWeights`.**
  The edge-case requirement in the brief reduces to "what does the
  algorithm do when weights are weird?" Funnelling every consumer
  (UI preview, budget block, dashboard) through one pure function
  makes that testable.
- **Default `accent_max_mentions: 2`.** Matches how "punchy accent"
  is used in design parlance — a single dramatic emphasis, not zero
  and not ubiquitous. Configurable per palette (1–5) for designers
  who want stricter or looser caps.
- **Telemetry is read-only.** `measureColorDistribution` never
  mutates the prompt; it only observes. This keeps the LLM contract
  intact (no surprise rewrites) while giving the user a real signal
  to act on.
- **Phases sized to one working day each.** Each phase has a single
  verifiable gate; rollback between phases is "delete the diff for
  that phase" because no phase touches the others' files beyond the
  additive exports in Phase 1.
- **UAT is a hard gate.** The dashboard is the safety valve for any
  LLM obedience gap. Until the UAT pass shows the budget + dashboard
  delivers real value, the feature flag stays default-off.

## Trade-offs and risks

- **LLM obedience gap.** Strategy A relies on the model following the
  budget block. If `MiniMax-Text-01` ignores it, the dashboard
  surfaces this and the user can either re-run or use a different
  palette. Strategy B is the fallback — explicitly deferred to v2.
- **Two endpoints (POST/PUT) gain `accent_max_mentions`.** They share
  validation via `validatePaletteColorsWeighted`. The shared logic is
  extracted into helpers; the endpoints are thin wrappers, mirroring
  the ADR 0013 refactor.
- **Larger on-disk shape.** Each color grows by ~30 bytes
  (`"weight":5,"accent":false`). For a typical 5-color palette,
  +150 bytes. Negligible. `history[]` snapshots carry the same shape.
- **`palette_runs.json` is a new persistence file.** Atomic write,
  same pattern as `data/palettes.json`. Trim to 50 runs per palette
  to keep file size bounded.
- **No browser-level E2E.** Same as ADR 0006 and ADR 0013 — the
  HTTP integration tests cover the API surface; the UAT checklist
  covers the UI manually. A future ADR can add Playwright when a
  real multi-component UI regression bites.
- **The "sum not equal to 100%" requirement is addressed by *not*
  requiring a sum.** The user gets the property they wanted
  (distribution proportional to weights) without the bookkeeping tax
  of maintaining a sum-to-100 invariant. The display percentage can
  read "99%" or "101%" after rounding; the UI labels this as such.
