# Polish Audit — Slice K.6 — Krea-2 result-panel button wiring (K.3 follow-up)

**Slice:** K.6 (K.3 follow-up)
**Date:** 2026-10-16
**Code review verdict:** `pass` (see `docs/CODE-REVIEW-30-k6-krea2-wiring.md`)
**Polished verdict:** **`pass`**

---

## 1. What this audit covers

The K.6 slice is a small, isolated, additive fix to close a
K.3 ship-without-wiring defect. It does not change the K.5
contract, does not introduce new dependencies, and does not
cross any AGENTS.md gates. The polish audit's job is to verify
the fix is shippable: clean, minimal, traceable, and with all
artifacts in place.

---

## 2. Artifact checklist

| Artifact | Required? | Present? | Path |
|----------|-----------|----------|------|
| SPEC delta | yes | ✅ | `docs/SPEC.md` §30.6.1 |
| ARCH delta | yes | ✅ | `docs/ARCHITECTURE.md` §30 A10 |
| PRE-MORTEM delta | yes | ✅ | `docs/PRE-MORTEM.md` §30.6.1 |
| ADR | no (K.6 is a wiring fix, not a strategic decision) | n/a | — |
| Inline two-axis code review | yes | ✅ | `docs/CODE-REVIEW-30-k6-krea2-wiring.md` |
| Polish audit (this file) | yes | ✅ | `docs/POLISH-AUDIT-30-k6.md` |
| SESSION-STATE row | yes | ⏳ pending | appended in this commit |
| BACKLOG entry | yes (H5) | ⏳ pending | appended in this commit |
| Test count delta | yes | ✅ | 712 → 718 (+6), 0 red |
| Conventional commit | yes | ⏳ pending | `fix(slice-k.6): …` |

All `⏳ pending` items are appended in the same commit as the
code change.

---

## 3. Test count

- Before K.6: **712 passed, 0 failed**
- After K.6: **718 passed, 0 failed**
- Delta: **+6 new tests, 0 modified, 0 removed**

The 6 new tests target the specific K.3 ship-without-wiring
defect. They are:

1. dom lookups for both Krea-2 buttons declared
2. krea2RegenerateBtn click listener calls `runKrea2Generate`
3. krea2CopyBtn click handler uses `navigator.clipboard.writeText`
   and reads from `krea2ResultPrompt`
4. `runKrea2Generate` sets loading on `krea2RegenerateBtn` in
   both `try` (true) and `finally` (false) branches
5. `src/index.html` Krea-2 buttons have `btn-text` +
   `btn-spinner` markup
6. K.6 cross-reference comments present in `src/app.js`

No existing test was modified or removed. The 712 baseline is
preserved.

---

## 4. Diff size

| File | Before | After | Delta |
|------|--------|-------|-------|
| `src/index.html` | 519 lines | 524 lines | +5 lines |
| `src/app.js` | 7221 lines (approx) | 7261 lines | +40 lines |
| `tests/run-all.js` | 14857 lines | 14947 lines | +90 lines (6 new tests) |
| `docs/SPEC.md` | ~2165 lines | ~2235 lines | +70 lines (§30.6.1 + Change Log) |
| `docs/ARCHITECTURE.md` | 1749 lines | 1814 lines | +65 lines (A10) |
| `docs/PRE-MORTEM.md` | ~865 lines | ~970 lines | +105 lines (§30.6.1) |
| `docs/CODE-REVIEW-30-k6-krea2-wiring.md` | (new) | 174 lines | +174 |
| `docs/POLISH-AUDIT-30-k6.md` | (new) | this file | ~200 |

Total: ~50 lines of production code (HTML + JS). All other
deltas are docs + tests + audit. The fix is minimal and tightly
scoped.

---

## 5. Constraint audit

| Constraint | Met? | Evidence |
|------------|------|----------|
| No new dependencies | ✅ | Pure HTML + JS + CSS. No `package.json` delta. |
| No force-push to main | ✅ | Local commit only. Push is `git push origin main` after the user has authenticated via `gh auth login` (already done in Session #21+). |
| No reset --hard | ✅ | All changes are additive. |
| No `rm -rf` without listing targets | ✅ | No filesystem deletions. |
| K.5 no-negative-envelope invariant preserved | ✅ | Copy handler reads `dom.krea2ResultPrompt.value` verbatim — single positive prose. The `Positive:\n${pos}\n\nNegative:\n${neg}` pattern (Anima) is NOT used. |
| K.4 chat-Apply branch preserved | ✅ | `applyChatRevision`'s Krea-2 branch is not modified. |
| Pre-Generate picker dispatch preserved | ✅ | `runGeneratePrompt`'s `state.model === 'krea2'` branch is not modified. |
| Slice marker convention | ✅ | `Slice K.6` identifier in 3 places in `src/app.js` + 6 new tests. |
| Append-only doc discipline | ✅ | No edits to existing §30 prose. All additions are new §30.6.1 / A10 / §30.6.1 / Change Log entries. |
| Inline two-axis review pattern | ✅ | `docs/CODE-REVIEW-30-k6-krea2-wiring.md` follows the same format as the K.1-K.5 reviews. |
| Conventional commit | ✅ | `fix(slice-k.6): wire Krea-2 regenerate + copy buttons; add spinners` (matches repo's `fix(<scope>):` convention; matches the per-slice fix-cadence commit style). |

---

## 6. Polish findings

### Minor (non-blocking, already documented)

- **R-11 / `btn-text` wrapper consistency:** The Krea-2 copy
  button has the `btn-text` span wrapper (K.6 added) but no
  spinner span — this is intentional (copy is sync, gives a
  "Copied!" text swap-back instead). The Anima copy button
  does NOT have the `btn-text` wrapper. The Z-Image copy
  button does not either. A future consistency pass should
  reconcile. Logged in PRE-MORTEM R-11 + Code Review §2
  (minor). **No action required for K.6.**

### Cosmetic (out of scope, parked)

- **Z-Image + Anima regenerate button `.btn-spinner` markup:**
  same cosmetic gap as K.6 closes for Krea-2. The buttons
  fire the right handlers; they just don't show a spinner.
  The user reported only the Krea-2 symptom. Parked.
- **`setButtonLoading` refactor to accept a button list:**
  wide refactor, would cross the AGENTS.md "rename a shared
  symbol" gate. Parked.

### Behaviour (verified, no issues)

- The Regenerate click handler is the direct reference
  `runKrea2Generate` — no inline closure, no closure-captured
  variant/creativity. The function reads both fields from the
  global `state` object at call time. Test #4 locks this
  contract.
- The Copy handler reads from `dom.krea2ResultPrompt.value`
  only — does not assemble a `Positive:\n${pos}\n\nNegative:
  \n${neg}` block. The Krea-2 contract is prose-only (P-7
  invariant). Test #3 locks this.
- The `setButtonLoading` on the secondary
  `krea2RegenerateBtn` does not regress the existing
  primary-button loading behaviour. The primary
  `dom.generatePromptBtn` is still set to loading at entry
  and reset in `finally`, exactly as K.2 / K.3 left it. The
  K.5 aggregate test still asserts the baseline invariant.

---

## 7. Ship gate

All polish-audit criteria are met:

- [x] Code review verdict: `pass`
- [x] All 718 tests pass, 0 fail
- [x] No new dependencies
- [x] No force-push, no reset --hard, no rm -rf
- [x] K.5 / K.4 / picker invariants preserved
- [x] Append-only doc discipline respected
- [x] Slice marker convention followed
- [x] Conventional commit message drafted
- [x] SESSION-STATE row pending (appended in this commit)
- [x] BACKLOG H5 entry pending (appended in this commit)

**Verdict: `pass` — ready to commit and push.**

---

## 8. Recommended follow-up (out of scope for K.6)

Logged for the next session or polish pass:

1. **Z-Image + Anima regenerate button `.btn-spinner` markup.**
   The buttons fire the right handlers but lack the
   `<span class="btn-spinner" hidden aria-hidden="true">`
   element. Trivial fix, ~6 lines of HTML, ~1 test.
2. **`setButtonLoading` refactor to accept a button list.**
   Lift to `setButtonsLoading(buttons, loading, text)`. Wide
   refactor, crosses the AGENTS.md "rename a shared symbol"
   gate. Parked.
3. **`btn-text` wrapper consistency.** The Krea-2 + Anima +
   Z-Image copy buttons diverge in their internal structure
   (K.6 added `btn-text` to Krea-2; Anima and Z-Image have
   no wrapper). Reconcile to one pattern in a future polish
   pass. Logged in PRE-MORTEM R-11.
