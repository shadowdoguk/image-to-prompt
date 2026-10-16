# Polish Audit — Slice K.9 — H7 close — Empty-chat-view `onViewEnter('chat')` branch

**Slice:** K.9 (H7 close)
**Date:** 2026-10-16
**Code review verdict:** `pass` (see `docs/CODE-REVIEW-30-k9-h7-empty-chat.md`)
**Polished verdict:** **`pass`**

---

## 1. What this audit covers

K.9 is a small, isolated, additive UX fix that closes H7
— the related-but-different cause for the same black-screen
symptom that K.7 closed for the result-panel link path.
K.9 adds a `showEmptyChatState()` helper in src/app.js and
an `onViewEnter('chat')` branch in src/shell.js so the
chat view shows a friendly empty-state paragraph when the
user navigates to `#/chat` via the top nav tab without
first generating a prompt.

After K.9, the chat view always shows the user something
actionable — never just a black background, regardless of
whether they came from a result panel or the top nav tab.

---

## 2. Artifact checklist

| Artifact | Required? | Present? | Path |
|----------|-----------|----------|------|
| SPEC delta | yes | ✅ | `docs/SPEC.md` §30.6.4 + Change Log row |
| ARCH delta | yes | ✅ | `docs/ARCHITECTURE.md` §30 A13 |
| PRE-MORTEM delta | yes | ✅ | `docs/PRE-MORTEM.md` §30.6.4 |
| ADR | no (UX gap fix, no strategic decision) | n/a | — |
| Inline two-axis code review | yes | ✅ | `docs/CODE-REVIEW-30-k9-h7-empty-chat.md` |
| Polish audit (this file) | yes | ✅ | `docs/POLISH-AUDIT-30-k9.md` |
| SESSION-STATE row | yes | ✅ | appended in this commit |
| BACKLOG H7 closure | yes | ✅ | appended in this commit |
| Test count delta | yes | ✅ | 725 → 728 (+3), 0 red |
| Conventional commit | yes | ✅ | `fix(slice-k.9): …` |

---

## 3. Test count

- Before K.9: **725 passed, 0 failed** (after K.8)
- After K.9: **728 passed, 0 failed**
- Delta: **+3 new tests, 0 modified, 0 removed**

The 3 new tests target:
1. `__i2pShowEmptyChatState` exposed on window (with
   function definition in src/app.js)
2. `onViewEnter('chat')` branch in src/shell.js calls
   it (guarded by `typeof` check)
3. The helper un-hides `#step-chat`, clears
   `#chat-messages`, writes a `chat-empty` paragraph
   with the two-step flow text

No existing test was modified or removed. The 725
baseline is preserved.

---

## 4. Diff size

| File | Before | After | Delta |
|------|--------|-------|-------|
| `src/app.js` | 7337 lines (post-K.8) | 7369 lines | +32 lines (helper + bridge export) |
| `src/shell.js` | ~1950 lines | ~1963 lines | +13 lines (onViewEnter branch) |
| `tests/run-all.js` | 15060 lines | 15115 lines | +55 lines (3 new tests) |
| `docs/SPEC.md` | 2609 lines | 2717 lines | +108 lines (§30.6.4 + Change Log) |
| `docs/ARCHITECTURE.md` | 1934 lines | 2012 lines | +78 lines (A13) |
| `docs/PRE-MORTEM.md` | 1148 lines | 1242 lines | +94 lines (§30.6.4) |
| `docs/CODE-REVIEW-30-k9-h7-empty-chat.md` | (new) | 138 lines | +138 |
| `docs/POLISH-AUDIT-30-k9.md` | (new) | this file | ~150 |

Total: ~45 lines of production code (`src/app.js` + `src/shell.js`).
All other deltas are docs + tests + audit. The fix is minimal
and tightly scoped.

---

## 5. Constraint audit

| Constraint | Preserved? | Evidence |
|-----------|-----------|----------|
| K.7 active-session post-success block | ✅ | K.9's helper returns `false` when `state.chatSessionId` is set, so the K.7 path is the only writer to `#step-chat` / `#chat-messages` in the active-session case. |
| K.5 no-negative-envelope invariant | ✅ | No code change to the response envelope. |
| K.4 / per-model chat-session pattern (ADR 0021) | ✅ | K.9 is the no-session path only. The per-model helpers (K.7 + Slice 2.4) retain exclusive ownership of the active-session path. |
| Shell.js → app.js bridge pattern | ✅ | New `__i2pShowEmptyChatState` bridge mirrors the existing `__i2pClearChatHistory` + `__i2pAnalyzeGenerated` pattern. Guarded by `typeof` check. |
| 725-test baseline | ✅ | K.9 adds 3 new tests; no existing test was modified or removed. |
| No new dependencies | ✅ | Pure JS. No new npm packages. No `package.json` change. |
| Append-only doc discipline | ✅ | SPEC §30.6.4 + Change Log row, ARCH §30 A13, PRE-MORTEM §30.6.4. No edits to existing prose. |
| Slice marker convention | ✅ | `Slice K.9` identifier present in `src/app.js` (1 place) + `src/shell.js` (1 place) + 3 new tests. |
| Code style (pre-existing patterns) | ✅ | Mirrors `__i2pClearChatHistory` (src/app.js:5115) and `__i2pAnalyzeGenerated` (src/app.js:5163) bridge pattern verbatim. |

---

## 6. Polish findings

- **None blocking.**
- **None minor.** Small JS addition that follows the
  existing bridge pattern verbatim; no divergence to
  document.

### Cosmetic gaps discovered (none new)

- The chat-hint at src/index.html:447 ("Discuss the
  prompt, ask for recommendations, or request a
  change…") is always visible inside `#step-chat`.
  The K.9 empty-state paragraph is below the chat-hint.
  Together they read as: hint + action prompt. No
  redundancy, no contradiction.

---

## 7. Ship gate

- [x] Code review verdict: `pass`
- [x] All 728 tests pass, 0 fail
- [x] No new dependencies
- [x] No force-push, no reset --hard, no rm -rf
- [x] K.5 / K.7 / per-model chat-session invariants preserved
- [x] Shell.js → app.js bridge pattern preserved
- [x] Append-only doc discipline respected
- [x] Slice marker convention followed
- [x] Conventional commit message drafted
- [x] SESSION-STATE row appended
- [x] BACKLOG H7 closure appended

**Verdict: `pass` — ready to commit and push.**
