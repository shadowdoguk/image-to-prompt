# Code review — Slice IR-4 (Iterative refinement: irRevisePrompt module)

**Slice:** SPEC §28 / IR-4
**Reviewer:** Goose (self-review, two-axis per PRINCIPLES.md §6.5)
**Date:** 2026-09-16
**Verdict:** **pass**

---

## Axis 1 — Standards

| Smell | Finding | Action |
|---|---|---|
| **Mysterious Name** | All module names map 1:1 to the SPEC §28 contract (`irRevisePrompt`, `parseRevisedPrompt`, `callImageRevisionText`, `DEFAULT_IR_REVISE_PROMPT`). | — |
| **Duplicated Code** | The MiniMax fetch + retry envelope pattern is repeated 3× now (IR-2, IR-3, IR-4). Extraction would force a 30-line helper called from 3 places; the duplication is bounded and the helper would obscure per-call differences (timeout, response_format shape). Acceptable. | Acceptable. |
| **Feature Envy** | `irRevisePrompt` is a thin orchestrator over `callImageRevisionText` + `validatePromptPreservation`. Each collaborator owns its concern. | — |
| **Data Clumps** | The decline envelope `{ declined, declined_partial_prompt, declined_missing_terms, declined_reason }` is a 4-field bundle; mirrors the SPEC §22 partial-apply decline shape exactly. Not speculative — the SPEC names it. | — |
| **Speculative Generality** | The empty-`Mismatch[]` case is handled by the model prompt ("If the mismatch list is empty, return the current prompt unchanged"). IR-4 explicitly preserves this — the user wants to see "no changes needed" rather than silently drop the iteration. | Good. |

**Repo-standard compliance:**

- [x] Tests-first (7 IR-4 tests + 3 fixtures added before implementation).
- [x] Pure validator (`parseRevisedPrompt`) tested offline against fixtures.
- [x] No `callMiniMax*` prefix on the new function — preserves Slice 3.1 ADR-0022 invariant.
- [x] Anchor preservation (ADR 0012) wired through `validatePromptPreservation`.
- [x] Decline envelope mirrors SPEC §22 partial-apply shape.

**Verdict (Standards):** **pass.**

---

## Axis 2 — Spec

| SPEC §28 commitment | Implementation | Status |
|---|---|---|
| Real MiniMax M3 text call (per IR-4 commitment) | `callImageRevisionText` (named to avoid ADR-0022 conflict). | ✅ |
| Revised prompt ≤ `MAX_FINAL_PROMPT_LENGTH` (5000 chars) | `parseRevisedPrompt` enforces; error message includes the cap value. | ✅ |
| Anchor-preservation through `validatePromptPreservation` | `irRevisePrompt` runs the model output through the validator after the call; passes joined `dimension + generated + reference + suggested_fix` as the "user request". | ✅ |
| Decline envelope mirrors SPEC §22 partial-apply shape | `{ declined: true, declined_partial_prompt, declined_missing_terms, declined_reason }`. Returned as the function value (string vs object discriminator). Route threads it onto `audit.declined_partial_prompt` + `audit.declined_missing_terms`. | ✅ |
| Empty `Mismatch[]` → no-op revised prompt | The system prompt tells the model to return the current prompt unchanged. | ✅ |
| Per-step error envelope (504) | Each pipeline stage wrapped in try/catch at the route. | ✅ |
| Latency instrumentation per step | Already added in IR-3 (`latency.revise` measured). | ✅ (carried forward) |
| Tests ≥ 5 (SPEC §28 DoD) | 7 IR-4 tests added: 1 surface, 3 fixtures, 1 validator-through, 1 decline envelope, 1 prompt-grep. | ✅ |
| No regression in baseline | 654 baseline tests still green (661 total = 654 + 7 IR-4 net). | ✅ |

**Verdict (Spec):** **pass.**

---

## Deviations

**Decline shape on `audit.kind='ir_iteration'`:** The route attaches
`declined_partial_prompt` + `declined_missing_terms` + `declined_reason`
to the assistant message `audit` block when `irRevisePrompt` declines.
This mirrors SPEC §22's partial-apply decline envelope. New shape
addition for the audit envelope (previously ir_iteration audits
didn't carry these fields). Documented in SPEC §28 architecture
(§28 A3); no separate ADR — additive, follows established pattern.

---

## Risk notes (carried forward to IR-5)

- **Iteration counter still increments on decline** (current
  behaviour). Spec §28 DoD says "iteration counter does NOT
  increment on 504" but is silent on decline. The current
  behaviour treats a decline as a successful iteration (the user
  did ask for a revision, the model did respond). IR-5 should
  formalise this with a test (P-3 from PRE-MORTEM says "MUST be
  incremented only after a successful (non-declined) Analyze").
  **Carry-forward note:** IR-5 must enforce "non-declined" and
  add a test.
- **The decline envelope is returned from the function as an object,
  not thrown.** This is the established pattern (the function
  succeeds at its job — it told the caller "the model produced an
  answer, but anchor-preservation rejected it"). The route knows
  to check `result.declined === true`. Acceptable; documented.

---

## Sign-off

- Standards axis: **pass**
- Spec axis: **pass**
- Combined verdict: **pass**
- Ready to commit.
