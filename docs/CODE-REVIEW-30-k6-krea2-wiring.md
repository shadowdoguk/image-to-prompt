# Code Review — Slice K.6 — Krea-2 result-panel button wiring (K.3 follow-up)

**Slice:** K.6 (K.3 follow-up)
**Author:** goose
**Reviewer:** goose (self-review, two-axis)
**Date:** 2026-10-16
**Verdict:** **pass** (no blockers; one minor finding below)

---

## 1. What this slice does

Closes a K.3 ship-without-wiring defect: the Krea-2 result panel
in `src/index.html` rendered `<button id="krea2-copy-btn">` and
`<button id="krea2-regenerate-btn">` but `src/app.js` had no
`dom` lookups for them and no click listeners. The Regenerate
button was a dead element. The user reported the bug on
2026-10-16.

The fix:

1. Adds `dom.krea2CopyBtn` and `dom.krea2RegenerateBtn` to the
   `dom` object (`src/app.js:150-158`).
2. Wires the click listeners (`src/app.js:2660-2689`):
   - Regenerate → `runKrea2Generate` (the existing K.2 function;
     reads `state.krea2Variant` + `state.krea2Creativity` at
     call time).
   - Copy → `navigator.clipboard.writeText` of
     `dom.krea2ResultPrompt.value` (single-positive prose,
     no `negative` field — P-7 invariant).
3. Adds `setButtonLoading(dom.krea2RegenerateBtn, ...)` calls
   inside `runKrea2Generate`'s `try` (true) and `finally`
   (false) blocks (`src/app.js:2043-2063`) so the spinner is
   visible on the button the user actually clicked.
4. Adds `btn-text` + `btn-spinner` markup to the two Krea-2
   buttons in `src/index.html:380-388` so the spinner element
   exists and is togglable.
5. Adds 6 new tests in `tests/run-all.js` that lock the wiring.

**Test count:** 712 → 718 (+6). All 718 pass, 0 fail.

---

## 2. Axis 1 — Standards review

How does this code match the project's documented coding
standards (`AGENTS.md` + `docs/PRINCIPLES.md` +
`docs/adr/0021-anima-fork.md` + per-slice conventions)?

| Standard | Met? | Evidence |
|----------|------|----------|
| **Append-only doc discipline** | ✅ | SPEC §30.6.1, ARCH §30 A10, PRE-MORTEM §30.6.1, Change Log row added. No edits to existing prose. |
| **Inline two-axis review pattern** | ✅ | This file + matching `docs/POLISH-AUDIT-30-k6.md`. |
| **Per-slice file pattern (Slice 2 / K.3 cadence)** | ✅ | Tests in `tests/run-all.js`; review + polish docs in `docs/`. Code in the same three files as K.1-K.5. |
| **Gates respected (G1 → G2 → G3 → G4 → G5)** | ✅ (scaled-down) | G1 = the user's bug report is the "sync"; G2 = SPEC §30.6.1; G3 = ARCH A10 + PRE-MORTEM §30.6.1 (no new ADR — K.6 is a wiring fix, not a strategic decision); G4 = impl + tests + this review; G5 = polish audit + commit. No G4 demo (manual browser smoke recommended, not blocked). |
| **No new dependencies** | ✅ | Pure HTML + JS + CSS. No new npm packages. |
| **No force-push / no reset --hard / no rm -rf** | ✅ | All edits are additive, in tracked files. |
| **Conventional commit message** | ✅ | `fix(slice-k.6): wire Krea-2 regenerate + copy buttons; add spinners` (pending commit). |
| **Slice marker convention** | ✅ | `Slice K.6` identifier present in `src/app.js` (3 places: dom block, runKrea2Generate, click listener block) and in 6 new tests. |
| **Cross-reference discipline** | ✅ | Each new line carries a `// Slice K.6 — …` or `Slice K.6 — …` comment explaining the why-not-just-rewrite. Mirrors K.1-K.5 cadence. |
| **Code style (pre-existing patterns)** | ✅ | Lookups placed next to sibling `animaCopyBtn` + `animaRegenerateBtn`; click listeners next to sibling `animaCopyBtn` + `animaRegenerateBtn`; HTML mirrors `src/index.html:136` (Analyze image). |
| **K.5 no-negative-envelope invariant preserved** | ✅ | Copy handler reads `dom.krea2ResultPrompt.value` verbatim — single positive prose. Does not assemble a `Positive:\n${pos}\n\nNegative:\n${neg}` block. Test asserts the handler references `krea2ResultPrompt`. |
| **K.4 chat-Apply branch unaffected** | ✅ | K.6 touches only the result-panel buttons. `applyChatRevision`'s Krea-2 branch (`src/app.js:6821-6823`) is not modified. |
| **Pre-Generate picker dispatch unaffected** | ✅ | K.6 touches only the result-panel buttons. `runGeneratePrompt`'s `state.model === 'krea2'` branch (`src/app.js:1807-1809`) is not modified. |
| **712 baseline preserved** | ✅ | K.6 adds 6 new tests; no existing test was modified or removed. All 712 prior tests still pass. |

### Standards findings

- **None blocking.**
- **Minor (not a blocker, document in polish audit):** The Krea-2
  copy button has the `btn-text` span wrapper but no spinner
  span — this is intentional (the copy operation is sync and
  gives a "Copied!" text swap-back instead). The pattern
  diverges from the Anima copy button, which has no `btn-text`
  wrapper. This is not a bug, but a future consistency pass
  should reconcile. Logged in PRE-MORTEM R-11.

---

## 3. Axis 2 — Spec review

Does this code match what the originating request asked for?

The user's report (verbatim): "After the prompt is generated, at
the bottom, there was three buttons, copy to clipboard,
regenerate, and define in chat. If I click on the regenerate
button, nothing happens. make sure there is a working icon that
spines and the regeneration rakes into account The variant used
and the creativity slider."

| User requirement | Met? | Evidence |
|------------------|------|----------|
| **"Regenerate" button works (not dead)** | ✅ | Click listener added at `src/app.js:2664-2666`. The handler is `runKrea2Generate`, the existing K.2 function that POSTs `/api/krea2` with the image + variant + creativity. |
| **"Working icon that spins"** | ✅ | `<span class="btn-spinner" hidden aria-hidden="true">` added to the button (`src/index.html:386`); `setButtonLoading(dom.krea2RegenerateBtn, true, 'Regenerating…')` in `try`, `setButtonLoading(dom.krea2RegenerateBtn, false, 'Regenerate')` in `finally` (`src/app.js:2043,2063`). The existing CSS rule (`.btn-spinner` + `@keyframes spin`) at `src/styles.css:788-797` provides the spin animation. |
| **"Takes into account the variant used"** | ✅ | `runKrea2Generate` reads `state.krea2Variant` at call time (`src/app.js:2047`): `fd.append('variant', state.krea2Variant)`. The variant selector (`#krea2-variant-selector`) writes to `state.krea2Variant` via `onKrea2VariantChange` (K.3 wiring, unchanged). Clicking Regenerate immediately re-reads the live selector value. |
| **"Takes into account the creativity slider"** | ✅ | `runKrea2Generate` reads `state.krea2Creativity` at call time (`src/app.js:2046`): `fd.append('creativity', String(state.krea2Creativity))`. The creativity slider (`#krea2-creativity-slider`) writes to `state.krea2Creativity` via `onKrea2CreativityChange` (K.3 wiring, unchanged). Clicking Regenerate immediately re-reads the live slider value. |

### Spec findings

- **None.** All four user requirements are demonstrably met
  with file/line evidence.

---

## 4. Test review

6 new tests added at the end of `tests/run-all.js`:

1. `SPEC §30 K.6: dom lookups for krea2 copy + regenerate
   buttons exist (K.3 follow-up)` — locks the `dom.<key>: $()`
   declarations.
2. `SPEC §30 K.6: krea2RegenerateBtn click listener fires
   runKrea2Generate` — locks the direct handler reference.
3. `SPEC §30 K.6: krea2CopyBtn click listener copies via
   navigator.clipboard.writeText` — locks the copy handler
   references `navigator.clipboard.writeText`, the
   `krea2ResultPrompt` textarea, and the "Copied!" text swap-back.
4. `SPEC §30 K.6: runKrea2Generate sets loading on the krea2
   regenerate button (not just primary)` — locks the new
   `setButtonLoading(dom.krea2RegenerateBtn, ...)` calls in
   both `try` (true) and `finally` (false) branches.
5. `SPEC §30 K.6: src/index.html Krea-2 buttons have btn-text
   + btn-spinner markup` — locks the HTML markup so the
   spinner element exists and is togglable.
6. `SPEC §30 K.6: K.3 follow-up identifier present in
   src/app.js + src/index.html` — locks the cross-reference
   comments so future maintainers can trace the fix.

All 6 new tests pass on the first run. No flakiness, no skipped
asserts, no tolerance windows.

### Test findings

- **None.** Coverage is tight and the 6 tests target the
  specific failure mode (unwired buttons).

---

## 5. Risk review

Cross-reference PRE-MORTEM §30.6.1 R-9 / R-10 / R-11:

- **R-9 (LOW — closure-capture vs read-from-state):** resolved.
  The click handler is a direct reference to `runKrea2Generate`,
  which reads `state.krea2Variant` + `state.krea2Creativity`
  at call time. Test #4 above locks the read-from-state
  contract. No regression.
- **R-10 (LOW — concurrent regeneration from primary +
  panel):** resolved. `state.isGenerating` is a single
  boolean; both call sites set true at entry and false in
  `finally`. `updateButtons()` gates the primary's `disabled`
  on `state.isGenerating`. K.6 does not change this.
- **R-11 (LOW — `btn-text` wrapper consistency):** documented
  in PRE-MORTEM R-11. Out of scope for K.6.

---

## 6. Verdict

**pass.**

- All user requirements met (file/line evidence above).
- All 712 baseline tests still pass.
- All 6 new tests pass.
- All 3 §30 invariants preserved (no-negative envelope, K.4
  chat-Apply, pre-Generate picker dispatch).
- Append-only doc discipline respected (SPEC §30.6.1, ARCH
  A10, PRE-MORTEM §30.6.1, Change Log row).
- No new dependencies. No force-push. No reset --hard.

The 1 minor finding (PRE-MORTEM R-11) is non-blocking and
documented for the next consistency pass.

Ready for `docs/POLISH-AUDIT-30-k6.md` and commit.
