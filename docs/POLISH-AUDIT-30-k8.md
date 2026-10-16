# Polish Audit — Slice K.8 — H5 close — Z-Image + Anima regenerate button spinners

**Slice:** K.8 (H5 close)
**Date:** 2026-10-16
**Code review verdict:** `pass` (see `docs/CODE-REVIEW-30-k8-h5-zimage-anima-spinners.md`)
**Polished verdict:** **`pass`**

---

## 1. What this audit covers

K.8 is a tiny HTML-only fix that closes the parallel
cosmetic gap K.6 left open. K.6 added `btn-text` +
`btn-spinner` markup to the Krea-2 Regenerate button. The
Z-Image and Anima Regenerate buttons lacked the same
markup, so `setButtonLoading` on them only updated the
text (no visible spinner). K.8 brings the two buttons to
parity with Krea-2.

---

## 2. Artifact checklist

| Artifact | Required? | Present? | Path |
|----------|-----------|----------|------|
| SPEC delta | yes | ✅ | `docs/SPEC.md` §30.6.3 + Change Log row |
| ARCH delta | yes | ✅ | `docs/ARCHITECTURE.md` §30 A12 |
| PRE-MORTEM delta | yes | ✅ | `docs/PRE-MORTEM.md` §30.6.3 |
| ADR | no (HTML-only, no strategic decision) | n/a | — |
| Inline two-axis code review | yes | ✅ | `docs/CODE-REVIEW-30-k8-h5-zimage-anima-spinners.md` |
| Polish audit (this file) | yes | ✅ | `docs/POLISH-AUDIT-30-k8.md` |
| SESSION-STATE row | yes | ✅ | appended in this commit |
| BACKLOG H5 closure | yes | ✅ | appended in this commit |
| Test count delta | yes | ✅ | 722 → 725 (+3), 0 red |
| Conventional commit | yes | ✅ | `fix(slice-k.8): …` |

---

## 3. Test count

- Before K.8: **722 passed, 0 failed**
- After K.8: **725 passed, 0 failed**
- Delta: **+3 new tests, 0 modified, 0 removed**

The 3 new tests target the markup presence:
1. Z-Image Regenerate button has `btn-text` + `btn-spinner`
2. Anima Regenerate button has `btn-text` + `btn-spinner`
3. Slice K.8 marker comment present in src/index.html

---

## 4. Diff size

| File | Before | After | Delta |
|------|--------|-------|-------|
| `src/index.html` | 537 lines (post-K.7) | 553 lines | +16 lines (2 buttons × 8-line markup block) |
| `tests/run-all.js` | 15014 lines | 15060 lines | +46 lines (3 new tests) |
| `docs/SPEC.md` | 2567 lines | 2609 lines | +42 lines (§30.6.3 + Change Log) |
| `docs/ARCHITECTURE.md` | 1904 lines | 1934 lines | +30 lines (A12) |
| `docs/PRE-MORTEM.md` | 1122 lines | 1148 lines | +26 lines (§30.6.3) |
| `docs/CODE-REVIEW-30-k8-h5-zimage-anima-spinners.md` | (new) | 107 lines | +107 |
| `docs/POLISH-AUDIT-30-k8.md` | (new) | this file | ~150 |

Total: ~16 lines of production code (HTML only). All
other deltas are docs + tests + audit. The fix is minimal
and tightly scoped.

---

## 5. Ship gate

- [x] Code review verdict: `pass`
- [x] All 725 tests pass, 0 fail
- [x] No new dependencies
- [x] No force-push, no reset --hard, no rm -rf
- [x] K.5 / K.7 / per-model chat-session invariants preserved
- [x] Append-only doc discipline respected
- [x] Slice marker convention followed
- [x] Conventional commit message drafted
- [x] SESSION-STATE row appended
- [x] BACKLOG H5 closure appended

**Verdict: `pass` — ready to commit and push.**
