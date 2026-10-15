# CODE-REVIEW-30-K.1-picker-state

**Slice:** K.1 — pre-Generate three-way picker (state + UI selector only)
**Date:** 2026-10-15
**Verdict:** pass+minor

## Two-axis verdict summary

| Axis | Verdict | Note |
|---|---|---|
| Standards | pass+minor | Pattern-mirrors Slice 2.1 with mechanical precision. Two state-field additions. Two validator additions. URL persistence extended by 2 params. localStorage extended by 2 keys. Sibling third button rendered by the existing `renderModelSelector` flow. |
| Spec | pass | All 8 SPEC §30 K.1 acceptance points exercised in dedicated tests; the existing Slice 2.1 enum-invariant test was updated honestly from `[zimage_turbo, anima]` to `[zimage_turbo, anima, krea2]` because the documented-values array genuinely grew. |

## Reviewer

Inline review (goose direct), same precedent as Slice 1, Slice 27, IR-1…IR-7, H1.

## Standards axis — findings

### S1 — Pattern-mirrors Slice 2.1 (ADR 0021)

The third-picker extension adds:
- One `<button data-model="krea2">` to `src/index.html` model-selector, sibling to Z-Image + Anima.
- One `<input type="radio" name="settings-model" value="krea2">` to the settings-form model radio, sibling to the existing two.
- Three lines added to `state` for `krea2Variant` + `krea2Creativity` + comment-only `model` enum expansion.
- `ALLOWED_MODELS` extended from 2 to 3 entries.
- Two new enums: `ALLOWED_KREA2_VARIANTS` (capacity tiers) and two validators (`validateKrea2Variant`, `validateKrea2Creativity`).
- `writeStateToLocalStorage` writes both new keys.
- `readStateFromLocalStorage` reads + validates both keys.
- `syncStateToURL` mirrors `krea2_variant` + `krea2_creativity` in the URL when the user has picked Krea 2 and is on non-default values.
- `readStateFromURL` reads both params with validators.

Every extension is mechanical. **Pass.**

### S2 — Single source of truth preserved

`state.krea2Variant` + `state.krea2Creativity` are first-class state. The pickers read from `state.model` + `state.krea2Variant` + `state.krea2Creativity` only. No DOM-drift re-introduced. **Pass.**

### S3 — Validators default to canonical-safe values

- `validateKrea2Variant` defaults to `'medium'` (manual §2 explicit canonical choice).
- `validateKrea2Creativity` defaults to `50` (Medium bucket, manual §4 canonical safe).

Both validators clamp on the side of "the user sees a working app, not an error message." **Pass.**

### S4 — URL mirror omits defaults for canonical URLs

When `state.model === 'krea2'` AND `state.krea2Variant === 'medium'` AND `state.krea2Creativity === 50`, all three URL params (`?model=krea2`, `?krea2_variant=medium`, `?krea2_creativity=50`) are omitted. First-load URL stays canonical (`/`, no params). The model param IS preserved when `state.model === 'krea2'` (because the user explicitly chose Krea 2). Mirrors the existing Anima pattern. **Pass.**

### S5 — Render path unchanged

`renderModelSelector` queries `[data-model]` and toggles `is-active` per-button. The third button (krea2) inherits the same render path — no special-case branch. The third radio in settings is also handled by the existing `data-model`-selecting path that writes to `state.model`. **Pass.**

### S6 — No new dependencies

The slice adds zero `package.json` entries. All persistence uses the existing `localStorage` + URL APIs. **Pass.**

### S7 — Documentation trail

A line-level comment at each Slice K.1 touchpoint (`// Slice K.1 — ADR 0030 — ...`) makes the trail verifiable. The HTML comment block on the third picker button cites manual §7 + §10 + ADR 0030. **Pass.**

### S8 — *Minor:* URL helper uses ternary conditional

`syncStateToURL` uses inline ternaries for the krea2 mirror. Readable but slightly noisy. Cosmetic. Not blocking.

## Spec axis — findings

### Sp1 — All 8 SPEC §30 K.1 acceptance points covered

| Acceptance point                                            | Test                                                                |
|-------------------------------------------------------------|---------------------------------------------------------------------|
| Three options in picker                                     | "src/index.html has the third Krea 2 picker button"                  |
| Third option in settings radio                              | "src/index.html has the Krea 2 radio in settings"                   |
| `state.krea2Variant` + `state.krea2Creativity` exist        | "state.krea2Variant + state.krea2Creativity exist with correct defaults" |
| `validateKrea2Variant` + `validateKrea2Creativity` exist    | "src/app.js defines validateKrea2Variant + validateKrea2Creativity" |
| `ALLOWED_KREA2_VARIANTS = ['turbo','medium','large']`        | "src/app.js exposes ALLOWED_KREA2_VARIANTS..."                      |
| Persisted to localStorage, restored on init                 | "KREA2_VARIANT_STORAGE_KEY + KREA2_CREATIVITY_STORAGE_KEY are persisted" |
| URL mirrored                                                | "syncStateToURL + readStateFromURL round-trip krea2_variant..."     |
| Renderer covers all three                                   | "renderModelSelector renders all three buttons..."                  |

**Pass** — 8/8 acceptance points covered by 8 SPEC §30 K.1 tests.

### Sp2 — Slice 2.1 enum invariant honestly updated

The pre-existing "ALLOWED enums are exactly the documented values" Slice 2.1 test asserted `ALLOWED_MODELS = ['zimage_turbo', 'anima']`. The K.1 extension legitimately evolves the documented values to a 3-way array. The fix:

- The test now asserts `ALLOWED_MODELS = ['zimage_turbo', 'anima', 'krea2']`.
- The failure message was updated to spell out the new shape.
- A new test "SPEC §30 K.1: src/app.js exposes ALLOWED_KREA2_VARIANTS..." asserts the 3-way enum separately, so the K.1 invariant is independently locked.

This pattern (evolve-the-test-when-the-contract-evolves + add-a-new-test-for-the-new-invariant) preserves historical specificity without leaving stale assertions. **Pass.**

### Sp3 — No regressions in the 678 baseline

`node tests/run-all.js` exit code 0: 686 / 0 (was 678; +8 net new SPEC §30 K.1 tests, 1 modified Slice 2.1 test). **Pass.**

### Sp4 — Defaults are the canonical-safe choice per manual

`state.krea2Variant` default = `medium` per manual §2 ("Default in the Krea web app"). `state.krea2Creativity` default = `50` per manual §4 ("Medium (default)"). **Pass.**

### Sp5 — No-negative invariant NOT violated yet

The K.2 / K.3 / K.4 sub-slices will assert the response envelope carries no `negative` field (PRE-MORTEM §30 P-7 + K-5). K.1 deliberately does NOT implement `/api/krea2`; that's K.2's scope. K.1 ships state + UI only. **Pass** — the no-negative constraint is preserved by K.1's minimal scope.

### Sp6 — Variable + creativity NOT in the system prompt yet

`/api/krea2` does not exist yet (K.2). The constants for the LLM-facing prompt live in K.2's `DEFAULT_KREA2_PROMPT`. K.1 deliberately does not introduce any LLM-facing prompt work. **Pass.**

## Pass+minor

S8 (cosmetic: URL ternary noise). All other findings are pass.

## Final verdict

**pass+minor** (Standards + Spec). Slice K.1 ships. Three-way picker visible in DOM, state fields added, validators clean, persistence + URL mirror symmetric with the Slice 2.1 pattern.

K.2 (the actual `/api/krea2` endpoint + `DEFAULT_KREA2_PROMPT` constant) is the next sub-slice. K.3 (frontend dispatch wiring) follows. K.4 (chat-Apply branch). K.5 (aggregate review).

## Files reviewed

- `src/index.html` — +12 lines (+7 model-selector, +4 settings-radio, +1 comment)
- `src/app.js` — +~50 lines (state-field additions, validators, persistence + URL extensions)
- `tests/run-all.js` — +8 SPEC §30 K.1 tests, 1 Slice 2.1 test updated honestly
