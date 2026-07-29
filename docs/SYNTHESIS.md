# SYNTHESIS.md Template

**Usage:** Phase B of the existing-project workflow. Interpretation + model, not inventory.

---

# Synthesis: image-to-prompt

**Date:** 2026-07-29
**Synthesizer:** Goose
**Built on:** `docs/RECON.md`

---

## 1. The elevator pitch (3 sentences)

If you had 30 seconds to explain this project to a stranger:

> {{PITCH}}

Test: would a stranger understand what it does, who it's for, and why it exists?

## 2. The primary user

**Who:** {{USER}}

**Their life before this app:** {{BEFORE}}

**Their life after:** {{AFTER}}

**Why this beats the alternative:** {{WHY_THIS}}

## 3. The primary surface

| Question | Answer |
|---|---|
| What does the user actually touch? | {{SURFACE}} |
| What's the main loop? | {{LOOP}} |
| What's the one thing they do repeatedly? | {{CORE_ACTION}} |

## 4. Observable behaviors (can be verified by running)

These are the user-facing behaviors that define "it works." If you can't verify these by running the app, they're hypotheses, not behaviors.

| # | Behavior | How to verify | Currently works? |
|---|---|---|---|
| 1 | {{BEHAVIOR}} | {{HOW}} | ✅ / ⚠ / ❌ |
| 2 | {{BEHAVIOR}} | {{HOW}} | ✅ / ⚠ / ❌ |
| 3 | {{BEHAVIOR}} | {{HOW}} | ✅ / ⚠ / ❌ |
| 4 | {{BEHAVIOR}} | {{HOW}} | ✅ / ⚠ / ❌ |
| 5 | {{BEHAVIOR}} | {{HOW}} | ✅ / ⚠ / ❌ |

If "currently works" is ❌ for any of these, that's a "Heal" mode trigger for SPEC.md.

## 5. Seams (where the code can be cut)

A **seam** is a public boundary the codebase exposes for slicing/testing. These are the natural cut points for new work.

| Seam | Where it lives | Why it's a seam | Current test coverage |
|---|---|---|---|
| {{SEAM_1}} | {{PATH}} | {{REASON}} | {{COVERAGE}} |
| {{SEAM_2}} | {{PATH}} | {{REASON}} | {{COVERAGE}} |
| {{SEAM_3}} | {{PATH}} | {{REASON}} | {{COVERAGE}} |

If a seam has no tests, that's a risk for any change in that area. Plan tests-first there.

## 6. Invariants (rules the code assumes to be true)

These are unspoken assumptions baked into the code. Breaking them breaks the app.

| Invariant | Where it's enforced | What would break it |
|---|---|---|
| {{INVARIANT_1}} | {{PATH}} | {{WHAT_BREAKS}} |
| {{INVARIANT_2}} | {{PATH}} | {{WHAT_BREAKS}} |
| {{INVARIANT_3}} | {{PATH}} | {{WHAT_BREAKS}} |

If you're going to change code near an invariant, verify the invariant still holds after.

## 7. Unknowns / surprises / smells

Things I noticed that I don't yet understand, or that worry me:

| Item | What I see | Why it's a worry |
|---|---|---|
| {{ITEM_1}} | {{OBSERVATION}} | {{WORRY}} |
| {{ITEM_2}} | {{OBSERVATION}} | {{WORRY}} |

These get addressed in the Spec (delta) phase before any code changes.

## 8. Drift (where reality has shifted from docs/code)

If README, comments, or docs contradict what the code does, that's drift.

| Where | What it says | What the code does |
|---|---|---|
| {{LOCATION}} | {{DOC_SAYS}} | {{CODE_DOES}} |

Drift is not a bug to fix in passing. It's a sign of accumulated change that needs to be reconciled explicitly. Decide: update the doc, update the code, or note as intentional drift.

## 9. Where the risk lives

If I had to bet where the next bug will come from, I'd bet on:

1. {{RISK_AREA_1}} — {{WHY}}
2. {{RISK_AREA_2}} — {{WHY}}
3. {{RISK_AREA_3}} — {{WHY}}

These become the pre-mortem inputs when we plan changes.

## 10. One-line verdict

A blunt summary I can read on cold-start tomorrow:

> {{ONE_LINE}}

Examples:
- "Clean Next.js app, ~3 months old, the auth module is the only spooky part."
- "Sprawling Python service, no tests at the API layer, but core logic is well-isolated."
- "Early-stage prototype. Spec doesn't match code in three places — needs heal before continue."

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Initial synthesis | — |

(Append-only.)