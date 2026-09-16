# Code review — Slice IR-5 (Iterative refinement: iteration cap + error envelope)

**Slice:** SPEC §28 / IR-5
**Reviewer:** Goose (self-review, two-axis per PRINCIPLES.md §6.5)
**Date:** 2026-09-16
**Verdict:** **pass**

---

## Axis 1 — Standards

| Smell | Finding | Action |
|---|---|---|
| **Mysterious Name** | None — `IR_ITERATION_CAP` is the locked constant; the route uses it. | — |
| **Duplicated Code** | None. The cap check is a 5-line guard at the top of the route. | — |
| **Feature Envy** | None — the route owns the cap, the session owns the counter. | — |
| **Data Clumps** | The 409 response carries `{ ir_iteration_count, ir_iteration_cap }` — a 2-field bundle that's exactly what the client needs to render the disabled state. | — |
| **Shotgun Surgery** | Cap check is in one place (route top). Counter increments are already in one place. | — |

**Repo-standard compliance:**

- [x] Tests-first (7 IR-5 tests added before the cap logic).
- [x] Cap enforced server-side (not just client-side) — PRE-MORTEM P-4.
- [x] Counter does NOT increment on 504 / 422 / 409 / decline — PRE-MORTEM P-3.
- [x] No regression in baseline.

**Verdict (Standards):** **pass.**

---

## Axis 2 — Spec

| SPEC §28 A5 error path | Implementation | Test |
|---|---|---|
| No reference uploaded | 422 "Upload a reference image (the original) and a generated image first." | IR-1 #3 |
| No generated uploaded | 422 "Upload a generated image too — one attachment is not enough to compare." | IR-1 #4 |
| Only one image uploaded | 422 (same as above) | IR-1 #4 |
| Iteration cap reached | 409 "Iteration cap (8) reached for this session. Adjust the prompt manually or start a new session." | IR-5 #1 |
| MiniMax timeout (analyze) | 504 "Image analysis failed: ..." | IR-2 route test |
| MiniMax timeout (compare / revise) | 504 | covered by IR-3 + IR-4 |
| Anchor preservation declined | 200 with `{ declined: true, declined_missing_terms, declined_reason }` envelope + assistant message audit decline block | IR-4 #4 |
| Magic-byte mismatch | 422 "Unsupported image format (expected PNG, JPG, or WebP)." | IR-5 #5 |

**Verdict (Spec):** **pass.** All 8 error paths from SPEC §28 A5 are wired + tested.

---

## Deviations

**None.** IR-5 lands exactly as SPEC §28 + PRE-MORTEM describe.

---

## Risk notes (carried forward to IR-6)

- **Race window:** two simultaneous POSTs from a double-click can
  both pass the cap check (each reads count=N) and both increment
  (write count=N+1). The race window is the read-modify-write of
  `session.ir_iteration_count`. We accept this race (mirrors the
  existing chat message write race since Slice 26). IR-6 can
  document it in the smoke script.
- **The 409 message mentions "start a new session"** — the user
  might prefer to delete the iteration history instead. Out of
  scope per SPEC §28 ("Iteration counters and `Mismatch[]` reports
  are per-session. Closing the chat session resets."). If the
  user later wants per-session reset, that's a separate slice.

---

## Sign-off

- Standards axis: **pass**
- Spec axis: **pass**
- Combined verdict: **pass**
- Ready to commit.
