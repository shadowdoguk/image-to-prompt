# ADR 0014 — Phase 5 UAT Checklist

> **Status:** pending sign-off. Run after Phases 1–4 merge.
> **Owner:** ADR author (initial pass) + one second reviewer (sign-off).
> **Gate:** ADR 0014 Gate F. UAT pass is the hard gate before the
> feature flag flips to default-on.

## Purpose

ADR 0014 promised the user five things: weighted distribution,
logical weight-calculation algorithms with edge-case handling,
"punchy accent" colors with a built-in cap, a visual interface
showing weights + accents + measured distribution, and a phased
rollout with UAT before full deployment. Phases 1–4 (data layer →
Stage 2 injection → edit modal → telemetry + dashboard) ship the
mechanism. This checklist validates the **user-facing outcome** on
three reference palettes.

## Reference palettes

Pre-create these three palettes before starting UAT. They're the
fixture for every checklist item below.

### Palette A — "Sunset ochres" (3 colors, one accent)

Saved from a real run via `POST /api/palettes` (or hand-crafted with
`POST /api/palettes/custom`). Shape:

```json
{
  "name": "Sunset ochres",
  "colors": [
    { "hex": "#d97706", "name": "burnt orange", "weight": 8, "accent": false },
    { "hex": "#7c2d12", "name": "deep brown",   "weight": 2, "accent": false },
    { "hex": "#dc2626", "name": "signal red",   "weight": 5, "accent": true }
  ],
  "accent_max_mentions": 2
}
```

Target fractions: 53% / 13% / 33% (rounded). Accent cap: 2.

### Palette B — "Brand Q3" (5 colors, two accents)

Hand-crafted via `POST /api/palettes/custom` (no source run required):

```json
{
  "name": "Brand Q3",
  "colors": [
    { "hex": "#0f172a", "name": "ink",     "weight": 9, "accent": false },
    { "hex": "#1d4ed8", "name": "blue",    "weight": 7, "accent": false },
    { "hex": "#10b981", "name": "emerald", "weight": 6, "accent": false },
    { "hex": "#dc2626", "name": "alert",   "weight": 3, "accent": true },
    { "hex": "#f59e0b", "name": "amber",   "weight": 2, "accent": true }
  ],
  "accent_max_mentions": 1
}
```

Target fractions: 33% / 26% / 22% / 11% / 7% (rounded; sum may be 99
or 100 depending on rounding). Accent cap: 1 across the two accents.

### Palette C — "Legacy test" (1 color, no weighting fields)

Created with `POST /api/palettes` before this UAT (or hand-edited to
omit weight/accent on disk). Pure legacy — should emit NO budget
block when used.

```json
{
  "name": "Legacy test",
  "colors": [{ "hex": "#6b7280", "name": "neutral grey" }],
  "accent_max_mentions": 2
}
```

## Checklist

Sign each item with `[x]` and the reviewer's initials.

### A. Stage 1 → analysis flow (no palette selected)

- [ ] **A1.** Open the wizard. Do NOT pick a palette. Upload an image.
      Click Analyze. Stage 1 returns and the analysis chips show
      LLM-extracted colors as today. No change.
- [ ] **A2.** Click Generate prompt. Result envelope has NO
      `palette_id`, NO `palette_name`, NO `distribution_metrics`. Same
      shape as pre-ADR 0014.

### B. Palette A applied + weighted run

- [ ] **B1.** Step 1 picker → select "Sunset ochres". Upload any
      image. Click Analyze. Analysis chips show palette A's three
      colors (not LLM-extracted colors).
- [ ] **B2.** Click Generate prompt. Result envelope INCLUDES
      `palette_id` + `palette_name` + `distribution_metrics`. Open the
      Edit modal for palette A; the Distribution dashboard panel shows
      the last-run timestamp + measured mention count per color.
- [ ] **B3.** Edit modal — slider defaults: burnt orange = 8, deep
      brown = 2, signal red = 5. Accent checkbox checked only for
      signal red. Target distribution bars render with widths ≈53% /
      13% / 33% and the signal red row carries a ★ badge.

### C. Weight + accent editing

- [ ] **C1.** In the edit modal, drag burnt orange's weight slider to
      10. The target distribution bar for burnt orange grows live to
      ~62% (10 / (10+2+5) = 59%; rounds to 62%). The other bars
      shrink proportionally. Sum annotation reads "Sum: 100%" or
      "Sum: 99% (rounded)".
- [ ] **C2.** Tick the accent checkbox on burnt orange (now two
      accents). The row gets a warm outline (--color-accent). The
      budget-block preview at the top now shows two `(ACCENT — ...)`
      lines.
- [ ] **C3.** Set Accent cap to 5. Save. Reopen the palette. The cap
      input shows 5. Open the JSON via `GET /api/palettes/:id` —
      `accent_max_mentions: 5` is persisted.
- [ ] **C4.** Try to set weight to 0 or 11 via the JS console (or a
      tampered body). Server rejects with 400 ("must be 1 or greater"
      / "must be 10 or less").
- [ ] **C5.** Try to set accent_max_mentions to 0 or 6. Server
      rejects with 400.

### D. Palette B (multi-accent, low cap)

- [ ] **D1.** Step 1 picker → "Brand Q3". Upload an image. Analyze.
      Click Generate prompt. Inspect the response envelope's
      `distribution_metrics.counts` — five entries, one per color.
- [ ] **D2.** Reopen palette B's edit modal. The Distribution dashboard
      shows measured counts. The accent row(s) (alert + amber) are
      tinted with the warm accent color. The cap annotation reads
      "accent cap: 1 mention".
- [ ] **D3.** Manually count the number of "alert" + "amber"
      occurrences in the generated prompt body (paste into a text
      editor). Total should be ≤ accent_max_mentions (1) under
      ideal LLM obedience; the dashboard is the source of truth when
      the LLM under- or over-shoots.

### E. Palette C (legacy opt-out)

- [ ] **E1.** Pick palette C from the Step 1 picker. Upload any image.
      Analyze + Generate prompt. Response envelope includes
      `palette_id` (palette was resolved) but NO `color_budget` field
      in the analysis history (legacy palette emits no budget block).
- [ ] **E2.** Confirm via `GET /api/palettes/:id` that palette C has
      no `weight` / `accent` fields per color (or only the synthesised
      defaults `weight: 5, accent: false`). Distribution dashboard
      shows zero counts for all colors (LLM didn't mention them by
      name) — this is the expected observational baseline.
- [ ] **E3.** Open palette C in the edit modal. The Target
      distribution bars show equal widths (33% / 33% / ... because
      weights are all default). Click Save with no changes. After
      save, palette C's on-disk shape now has `weight: 5, accent:
      false` on every color (first PUT normalises).

### F. Version history + Restore

- [ ] **F1.** In palette A's edit modal, change burnt orange's weight
      from 8 to 9. Save. Open Edit again. Version history shows v1 +
      v2. v2's snapshot captures weight: 9.
- [ ] **F2.** Click Restore on v1. Modal prompts to confirm. After
      confirm, the palette rolls back: burnt orange weight is 8
      again. Version history grows to v3 (the rollback itself is
      recorded). The Distribution dashboard re-fetches and shows the
      newer recorded_at timestamp.

### G. Keyboard accessibility

- [ ] **G1.** Tab through the edit modal in order: name input →
      swatches (decorative, skip) → Accent cap → each color row
      (picker → hex → name → weight slider → accent checkbox → remove)
      → Add color → Save → Cancel → Delete → Version history →
      Distribution dashboard summary → close.
- [ ] **G2.** All form controls show visible focus (the existing
      --accent blue outline).
- [ ] **G3.** Arrow keys on a weight slider increment / decrement by
      1. `aria-valuetext` reads "N out of 10".
- [ ] **G4.** Accent checkbox toggling announces "Accent" via
      associated label.
- [ ] **G5.** Esc closes the edit modal; focus returns to the row's
      Edit button.

### H. Distribution dashboard

- [ ] **H1.** Open palette A's edit modal AFTER running Stage 2 at
      least once. The Distribution dashboard section is visible
      (collapsible, default open or closed is implementation-defined).
- [ ] **H2.** The dashboard shows "Last run 5 minutes ago" or similar
      relative time, plus "N mentions across M words" annotation.
- [ ] **H3.** The table renders one row per palette color with: swatch
      + name, target % (matches the bars above), measured integer
      (the count of mentions in the latest generated prompt).
- [ ] **H4.** For a brand-new palette (palette B with no runs yet),
      the dashboard shows the empty-state message: "No runs yet for
      this palette. Click Generate prompt... then reopen..."

### I. Backwards compatibility & edge cases

- [ ] **I1.** Pre-ADR 0014 palettes (created before this rollout)
      load in the manager, render in the picker, and apply to
      analysis as today. No data loss.
- [ ] **I2.** Pre-ADR 0014 palettes' first PUT (e.g. renaming one)
      normalises `weight: 5, accent: false` on every color on disk
      (verify via `cat data/palettes.json`).
- [ ] **I3.** Stage 2 with NO palette selected → response envelope is
      the pre-ADR 0014 shape (no new fields). Existing chat
      refinements work unchanged.
- [ ] **I4.** Delete a palette that has telemetry → the telemetry
      entries for that palette remain on disk (`data/palette_runs.json`
      is not auto-pruned). Acceptable for v1; out of scope to
      cascade-delete telemetry.

### J. Acceptance gates

- [ ] **J1.** `node scripts/session-init.js` reports 10/10 passed.
- [ ] **J2.** `node tests/run-all.js` reports 0 failed.
- [ ] **J3.** Manual UI smoke: open the wizard, pick a palette, run
      analyze + generate, open the chat refinement console, refine
      once. The chat refinement's `suggested_prompt` still uses the
      weighted palette's colors as expected.
- [ ] **J4.** No console errors during the full smoke run.
- [ ] **J5.** Screenshots attached to the UAT pass: edit modal with
      weight sliders + accent toggles, target distribution bars with ★
      badges, distribution dashboard table with target vs measured.

## Sign-off

| Reviewer | Initials | Date | Result |
|---|---|---|---|
| ADR author | _____ | ____-__-__ | ☐ pass / ☐ fail |
| Second reviewer | _____ | ____-__-__ | ☐ pass / ☐ fail |

When both rows are `pass`, the feature flag flips to default-on in a
follow-up commit. Any `fail` blocks rollout; the failing item(s)
become the next round of issues on the project board.