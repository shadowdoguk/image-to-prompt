# POLISH-AUDIT-3 — Addendum (Session #12 + Session #13 closeout)

**Original audit:** `docs/POLISH-AUDIT-3-kilo-code-provider.md` (landed via commit `2568fad`, Session #10)
**Addendum date:** 2026-09-03
**Addendum author:** goose (driven by the user instruction "commit and get the change completed")
**Scope:** Closes the visual-demo gate deferred from `docs/CODE-REVIEW-10-slice-3-closeout.md` follow-up #2.

---

## What was deferred

The original POLISH-AUDIT-3 was a paper audit only — it did not record a manual smoke test. The methodology's G4 step requires running the slice in a browser before commit. This was skipped during the Sessions #8–#11 drift-parking cycle.

## What landed in this addendum

`docs/VISUAL-DEMO-slice-4.md` (Session #13, 2026-09-03) exercises the G4 visual-demo gate for Slice 4, which in turn verifies the Slice 3 closeout end-to-end:

| Scenario | Result |
|---|---|
| 1. First-load defaults (kilo_code + minimax/minimax-m3) | ✓ PASS |
| 2. Switch to `minimax` (user-driven, URL mirrors update) | ✓ PASS |
| 3. Switch to `alibaba` (URL mirrors update) | ✓ PASS |
| 4. Deep-link `?provider=alibaba` (model-list rebuilds) | ✓ PASS (bug fixed during gate) |
| 5. Stage 1 stub-mode end-to-end | ✓ PASS |
| 6. Stage 2 stub-mode end-to-end | ✓ PASS |
| 7. localStorage persistence across reloads | ✓ PASS |
| 8. Chat stub (architecture unit-tested, not browser-exercised) | ⚠ pass+minor |

The verification covers the entire Slice 3 ship state (LLM model selector UI, model persistence, URL mirror, endpoint forwarding) plus the Slice 4 addition (provider selector, per-provider model list, dispatcher).

## Bug surfaced and fixed

The deep-link reload case (Scenario 4) caught a real bug: the LLM model `<select>` did not rebuild its option list when `state.provider` was resolved to a non-default value from the URL on init. Fixed by extracting `rebuildLlmModelSelectorOptions()` and calling it from `renderProviderSelector()`.

This is the kind of bug a paper audit cannot catch — only a browser-driven gate catches it. The methodology's G4 step is non-negotiable.

## Verdict

✓ **PASS** — the Slice 3 deferred visual-demo gate is now exercised. The Slice 3 ship state is verified end-to-end via `docs/VISUAL-DEMO-slice-4.md` Scenarios 1–3 and 7 (Slice 3 wiring) + Scenarios 4–6 (Slice 4 wiring built on top of Slice 3).

The Slice 3 closeout is fully closed. No further follow-ups from POLISH-AUDIT-3.
