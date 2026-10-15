# POLISH-AUDIT-30-K.1-picker-state

**Slice:** K.1 — pre-Generate three-way picker (state + UI selector only)
**Date:** 2026-10-15
**Verdict:** PASS — ship-ready

## Summary

Sub-slice of Slice K (Krea 2 picker). Pure state + UI selector — no backend, no /api/krea2 route, no LLM-facing prompt. Mirrors the Slice 2.1 (ADR 0021) pattern mechanically: third sibling button + third settings radio + state fields + validators + localStorage + URL mirror. K.2, K.3, K.4 follow per SPEC §30.5.

---

## §1 Accessibility

| # | Finding | Blocking |
|---|---|---|
| A1 | Both settings-radio and model-selector use proper ARIA semantics: `role="group"` on the picker, `aria-pressed` toggling per button (mirrored from Slice 2.1), `<fieldset>` + `<legend>` on the settings radio. The third button inherits the existing accessibility tree without modification. | — |
| A2 | The third button's label is plain text "Krea 2" — readable, no abbreviation, no icon-only. The existing two buttons ("Z-Image Turbo", "Anima") follow the same pattern, so the third option preserves the group's visual + cognitive consistency. | — |

**0 findings, 0 blocking.**

## §2 Visual

| # | Finding | Blocking |
|---|---|---|
| V1 | The third button is rendered inside the same `.model-selector` flexbox container (already `flex-wrap: wrap` per UI-R-series layout). Three buttons fit at ≥768px viewport (the project's tight-layout threshold). Manual resize verification deferred to K.3 (the picker is the visible UI for the new model; visual demo gate per PRE-MORTEM P-5). | — |
| V2 | The third settings-radio option inherits the same `.settings-radio-option` class as the existing two; no new CSS rules are needed. | — |

**0 findings, 0 blocking.**

## §3 Prose (SPEC / ARCH / PRE-MORTEM readability)

| # | Finding | Severity | Blocking |
|---|---|---|---|
| S1 | SPEC §30 K.1 acceptance points are listed inline in the code-review (8 points, 8 tests). Clean. | minor | no |
| S2 | ARCH §30 A1 (picker extension) + A3 (frontend state) already enumerate krea2 fields. | minor | no |
| S3 | PRE-MORTEM §30 R-1..R-8 + P-1..P-7 + K-1..K-5 enumerate the constraints K.1 owns vs defers. | minor | no |

**3 findings, 0 blocking.**

## §4 Copy (code comments, error messages, commit messages)

| # | Finding | Severity | Blocking |
|---|---|---|---|
| C1 | Each K.1 touchpoint carries a `// Slice K.1 — ADR 0030 — ...` comment explaining the change. The HTML comment in `index.html` cites manual §7 (5-layer formula), manual §10 (no-negative-prompt constraint), and ADR 0030. | minor | no |
| C2 | No new error messages or user-facing copy in this sub-slice. Errors live in the validators (silent fallback to canonical defaults per existing Slice 2.1 contract). | minor | no |

**2 findings, 0 blocking.**

## §5 Performance

| # | Finding | Severity | Blocking |
|---|---|---|---|
| P1 | No measurable perf change. The state additions are two scalar fields. The validator additions are constant-time. localStorage writes are bounded to ~5 keys (was 3; now 5). URL mirror is bounded to ~5 params (was 3; now 5). All within the existing per-render budget. | minor | no |

**1 finding, 0 blocking.**

## §6 Discipline (preserved)

| # | Finding | Severity | Blocking |
|---|---|---|---|
| D1 | Pattern-mirrors Slice 2.1 (ADR 0021) exactly — the same persistence keys, validators, URL mirror structure. No new convention introduced. | minor | no |
| D2 | No new dependencies; no schema migration; no shared-symbol rename; no wide refactor. Pure additive sub-slice. | minor | no |
| D3 | Slice 2.1 enum-invariant test honestly evolved from `[zimage_turbo, anima]` to `[zimage_turbo, anima, krea2]` — the contract genuinely grew. Methodology says "corrections are new entries, never edits"; here the entry was updated with explanatory comment ("Slice 2.1's documented-values assertion. The Krea-2 picker (Slice K.1, ADR 0030) extends ALLOWED_MODELS..."). Plus a new SPEC §30 K.1 test asserts the 3-way invariant independently. | minor | no |
| D4 | SPEC §30 K.1 deliberately does NOT implement `/api/krea2` — that is K.2's scope. K.1 ships state + UI only. The minimal-scope principle prevents over-reach. | minor | no |
| D5 | The helpers `validateKrea2Variant` + `validateKrea2Creativity` mirror the existing `validateVariant` shape exactly: enum-allowed-list check → fallback. The creativity validator additionally clamps to integer 0-100 with Math.round. Consistent with the project's "forgiving defaults" convention. | minor | no |
| D6 | No new console warns, no new ESLint violations, no new stack rules. Helpers use existing primitive `Array.includes`. | minor | no |

**6 findings, 0 blocking.**

## §7 Dependency / stack hygiene

| # | Finding | Blocking |
|---|---|---|
| Dep1 | No `package.json` change. No new imports. `node --check server.js && node --check src/app.js && node --check tests/run-all.js` exit 0. Test surface: 686 / 0 green (was 678; +8 net new SPEC §30 K.1). | — |

**0 findings, 0 blocking.**

---

## Aggregate score

- 12 non-blocking findings across 7 sections.
- 0 blocking.
- Slice K.1 ships as documented. **Ready for G5 sign-off.**

## G5 sign-off

**PASS** — slice K.1 ships clean. State + UI selector ready for K.2 to layer the backend contract on top.

## What's next (K.2 — the actual `/api/krea2`)

K.2 implements `DEFAULT_KREA2_PROMPT` (the LLM-facing 5-layer formula + creativity bucket branches), `callMiniMaxKrea2Analysis` (the helper mirroring `callKiloAnimaAnalysis`), and `POST /api/krea2` (the dispatcher). K.2 adds ≥7 backend tests. K.2 lands independently of K.3 / K.4 — the frontend can stay two-way (Z-Image / Anima) until K.3 wires the third branch.
