# BACKLOG.md Template

**Usage:** Created in Phase 3. Anything not on the slice plan goes here, with a clear reason and a next step.

---

# Backlog: image-to-prompt

**Created:** 2026-07-29

This is **not** a TODO list. TODO is what's happening now. Backlog is what we *chose not to do* (yet).

---

## Why this exists

A slice plan is a contract. Backlog is the parking lot for everything we encountered but decided to defer. If you don't write things down, they re-litigate themselves later.

---

## Parked items

### Item: {{TITLE}}

- **Origin:** When did this come up? Which slice / which conversation?
- **Why parked:** {{REASON}}
- **To un-park, we'd need:** {{CONDITION}}
- **Estimated impact if pursued:** {{LOW / MED / HIGH}}

### Item: Slice 2.1 — Anima fork: model-state + UI selector (the pre-Generate picker)

- **Origin:** Session #3 (2026-08-03). User asked for an Anima prompt manual + a goose-review of the Anima model. The session re-shaped into a feature request: "extend the app so the upload flow also produces Anima positive + negative prompts alongside Z-Image Turbo." User chose a **pre-Generate model fork** (dropdown or button group before Generate, exclusive siblings) over a dual-output design. G1 was approved, followed by G2 (SPEC §14) and G3 (ARCH A1–A9, PRE-MORTEM Slice 2, ADR 0021). All three gates approved.
- **Why parked:** Slice 2.1 was mid-implementation when I surfaced a candid checkpoint (state fields + helpers + UI binding were in `src/app.js`, but no `dom.modelSelector` reference, no HTML markup, no `init()` restore call, no tests, no demo, no code review). Per AGENTS.md, a slice must not ship without a passing demo + a code-review verdict. The user picked **Option A** ("stop, revert the partial code, summarise") rather than finish mid-session. The partial code was reverted via `git checkout -- src/app.js`. The durable G2/G3 artifacts remain.
- **What's parked (and where the design lives):**
  - Sub-slice plan: `docs/SPEC.md` §14.9 (5 sub-slices 2.1 → 2.5).
  - Slice 2.1 design: `docs/ARCHITECTURE.md` A3 (Modules D + E), A6 decisions.
  - Slice 2.1 failure modes: `docs/PRE-MORTEM.md` Slice 2 entry (specifically failure modes 4 — state corruption — and 5 — license boundary).
  - The full fork decision: `docs/adr/0021-anima-fork.md`.
  - The contract source of truth: `docs/ANIMA-PROMPTING-MANUAL.md` §5, §7, §14.
- **To un-park, we'd need:** (a) a fresh session dedicated to Slice 2.1 implementation. The work is bounded: ~30 more lines of `src/app.js`, ~12 lines of `src/index.html` (model selector button group), ~20 lines of `src/styles.css` (`.model-selector` + `.is-active`), ~80 lines of `tests/run-all.js` (5 test groups), one `docs/CODE-REVIEW-2-anima-fork.md` (one-axis, since the slice is small). The user already approved the design at G3. The next concrete action is "open a fresh session, read the durable docs above, land Slice 2.1 to a demoable state."
- **Estimated impact if pursued:** **MEDIUM** — adds a real feature (the Anima fork), but bounded by the existing per-field pattern. No new dependencies, no schema migration, no server.js split. After Slice 2.1 lands, Slices 2.2 → 2.5 follow in sequence (per `docs/SPEC.md` §14.9 blocking edges).

### Item: {{TITLE}}

- **Origin:** When did this come up? Which slice / which conversation?
- **Why parked:** {{REASON}}
- **To un-park, we'd need:** {{CONDITION}}
- **Estimated impact if pursued:** {{LOW / MED / HIGH}}

(continue)

---

## Stretch items (from SPEC.md §7)

Items the user marked as "stretch" at gate G2. Parked by definition; revisit at end of MVP.

- {{STRETCH_1}}
- {{STRETCH_2}}

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Created | — |

(Append-only.)

| 2026-08-03 | Appended: Slice 2.1 (Anima fork) + Q3 re-opened | Session #3 — research + G1–G3 design approved; implementation stopped at user's choice (Option A revert) |
| 2026-08-03 | Appended: Slice 2.1 SHIPPED | Session #4 — Slice 2.1 (and the rest of Slice 2) shipped end-to-end. The parked item above is now closed. Per AGENTS.md "corrections are new entries, never edits," the parked entry is preserved as-is; this entry is the cross-reference. |
| 2026-08-04 | Appended: Anima coverage gap (camera/mood/lighting/posture), issue #23 filed | Session #8 — bug reported by user, filed as issue #23 (`bug`, `runtime`). Fix parked pending user direction: in-session fix vs. next-slice pass. Issue body fully populated with repro, root-cause hypothesis, suggested fix area, acceptance criteria. |

---

## Shipped items (append-only)

Parked items that have since shipped. The original Parked-items entry is preserved verbatim above; this section is the cross-reference.

### Item: Slice 2.1 — Anima fork: model-state + UI selector (the pre-Generate picker)

- **Shipped:** 2026-08-03 (commit `1756d0d` + code review `9e98a54`).
- **Within:** Slice 2 — Anima fork (ADR 0021). The parked-item entry above describes the design that was implemented. Slice 2.1 shipped as the first of 5 sub-slices (2.1 → 2.2 → 2.3 → 2.4 → 2.5); all five passed per-sub-slice review with verdict `pass`.
- **Aggregate verdict:** `docs/CODE-REVIEW-2-anima-fork.md` §Slice 2.5 — "Slice 2 ships."
- **Tests:** 373 / 373 passing (was 321 baseline; +52 net new tests).
- **Quantitative:** 5 sub-slices shipped, 1 ADR (0021) accepted, 5 new docs (1 manual + 4 design docs), 1 aggregate code review, 0 regressions, 0 new dependencies, 0 schema migrations.

### Item: Anima coverage gap — camera / mood / lighting / posture tags missing from `positive` output

- **Origin:** Session #8 (2026-08-04). User reported: "when an Anima prompt is generated it omits the camera angle, mood, lighting, and posture of the subject." Filed as issue [#23](https://github.com/shadowdoguk/image-to-prompt/issues/23), label `bug`, class `runtime`.
- **Why parked (decision pending):** The fix is bounded — one constant edit (`DEFAULT_ANIMA_PROMPT` in `server.js:3050-3117`) plus one new smoke file (`scripts/smoke/anima-coverage-categories.js`). It mirrors the precedent of issues #1 (stale palette), #20 (chat-limit UX), #22 (Anima chat-apply sync) — all three were fixed in-session as small, single-seam changes with no slice plan. AGENTS.md "What you must ask before doing" requires a slice plan only when "new code that touches more than one module" is involved. This fix touches two modules (`server.js` constant + new smoke file), so it falls in a grey zone. **Awaiting user direction** before implementing.
- **Why the bug exists (root cause hypothesis):** `DEFAULT_ANIMA_PROMPT` specifies output *format* (lowercase, comma-separated, quality prefix, variant rules, forbidden vocabulary) but does not enumerate *coverage categories* — the categories the LLM should hit. The Anima manual's worked examples (`docs/ANIMA-PROMPTING-MANUAL.md` §9, §17) always include camera, mood, lighting, and posture tags, so the LLM is missing the explicit prompt hint to cover those categories. The Z-Image Turbo path captures all four in `state.currentAnalysis` but the Anima endpoint ignores those fields entirely (`callKiloAnimaAnalysis` reads only the image, not the analysis snapshot).
- **Suggested fix (smallest diff):**
  1. Add a "COVERAGE CATEGORIES" section to `DEFAULT_ANIMA_PROMPT` enumerating: subject/character, camera/shot (e.g. `looking at viewer`, `portrait`, `upper body`), mood/emotion (e.g. `smile`, `gentle smile`), lighting (e.g. `soft lighting`, `indoor`, `day`), posture/action (e.g. `standing`, `sitting`). Mirror the tag vocabulary from `docs/ANIMA-PROMPTING-MANUAL.md` §7.6 + §17.
  2. (Optional, more invasive) Thread `state.currentAnalysis.camera_angle`, `mood`, `lighting`, `actions` into the Anima endpoint's user prompt as a coverage hint. Skipped unless the prompt-only fix is insufficient.
  3. Add `scripts/smoke/anima-coverage-categories.js` — 7 static-source assertions: (a) the constant has a "COVERAGE" section, (b) camera tokens present, (c) mood tokens present, (d) lighting tokens present, (e) posture tokens present, (f) the helper signature is unchanged, (g) the response envelope is unchanged.
  4. Append "Consequences (2026-08-04)" section to ADR 0021 documenting the prompt-coverage sharpening.
- **To un-park, we'd need:** user OK on (i) in-session fix (mirror issue #22 precedent) vs. (ii) defer to next-slice planning pass. Estimated cost: ~30 minutes, 1 commit, 1 ADR append, ~80 lines of new smoke code.
- **Estimated impact if pursued:** **LOW–MEDIUM** — qualitative UX win, no contract change, no architectural commitment. The Anima manual already documents that the model supports these tag categories; the fix sharpens the prompt to nudge the LLM toward covering them.
- **Issue:** [#23](https://github.com/shadowdoguk/image-to-prompt/issues/23).
