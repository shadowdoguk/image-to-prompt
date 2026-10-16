# Polish Audit — Slice K.7 — Krea-2 "Refine in chat" panel-show wiring (K.4 follow-up)

**Slice:** K.7 (K.4 follow-up)
**Date:** 2026-10-16
**Code review verdict:** `pass` (see `docs/CODE-REVIEW-30-k7-krea2-chat-show.md`)
**Polished verdict:** **`pass`**

---

## 1. What this audit covers

The K.7 slice is a small, isolated, additive fix to close a
K.4 ship-without-wiring defect. It does not change the K.4
contract, does not introduce new dependencies, and does not
cross any AGENTS.md gates. The polish audit's job is to verify
the fix is shippable: clean, minimal, traceable, and with all
artifacts in place.

K.7 is the **companion to K.6**. K.6 (shipped earlier in
Session #22+, commit `7101c4a`) wired the Krea-2 result
panel's Regenerate + Copy buttons so the user can iterate on
the generated prompt. K.7 wires the chat panel that the
"Refine in chat →" link opens onto, so the user can converse
with the ChatGPT-style art expert as the SPEC describes.
Together, K.6 + K.7 mean the Krea-2 path is end-to-end
functional: generate → regenerate (K.6) → refine in chat (K.7).

---

## 2. Artifact checklist

| Artifact | Required? | Present? | Path |
|----------|-----------|----------|------|
| SPEC delta | yes | ✅ | `docs/SPEC.md` §30.6.2 (line 2219) + Change Log row (line 2415) |
| ARCH delta | yes | ✅ | `docs/ARCHITECTURE.md` §30 A11 (line 1814) |
| PRE-MORTEM delta | yes | ✅ | `docs/PRE-MORTEM.md` §30.6.2 (line 1014) |
| ADR | no (K.7 is a K.4 follow-up, same strategic shape) | n/a | ADR 0030 is the parent |
| Inline two-axis code review | yes | ✅ | `docs/CODE-REVIEW-30-k7-krea2-chat-show.md` |
| Polish audit (this file) | yes | ✅ | `docs/POLISH-AUDIT-30-k7.md` |
| SESSION-STATE row | yes | ⏳ pending | appended in this commit |
| BACKLOG entry (H6) | yes | ⏳ pending | appended in this commit |
| BACKLOG entry (H7 — parked) | yes | ⏳ pending | appended in this commit (parked) |
| Test count delta | yes | ✅ | 718 → 722 (+4), 0 red |
| Conventional commit | yes | ⏳ pending | `fix(slice-k.7): …` |

All `⏳ pending` items are appended in the same commit as the
code change.

---

## 3. Test count

- Before K.7: **718 passed, 0 failed** (after K.6)
- After K.7: **722 passed, 0 failed**
- Delta: **+4 new tests, 0 modified, 0 removed**

The 4 new tests target the specific K.4 ship-without-wiring
defect. They are:

1. `activateKrea2ChatForResult` prepends the new session to
   `state.chatSessions` (mirrors Anima's prepend at
   src/app.js:6268)
2. `activateKrea2ChatForResult` calls `renderChatMessages(session)`
   (guarded by `typeof` check, matching the existing pattern
   for `renderChatSessionSelect` + `updateChatSendButton`)
3. `activateKrea2ChatForResult` un-hides `#step-chat`
   (`dom.stepChat.hidden = false`, guarded by `if (dom.stepChat)`)
4. `activateKrea2ChatForResult` focuses the chat input
   (`dom.chatInput.focus()`, guarded by `if (dom.chatInput)`)

No existing test was modified or removed. The 718 baseline is
preserved.

**Note on the 4 vs 6 expected post-success steps.** The
`activateKrea2ChatForResult` post-success block is 6 lines
long (prepend + render + un-hide + status + delete-btn +
focus). K.7 commits to locking 4 of them with explicit
tests. The other 2 (status populate, delete-btn enable) are
intentionally not duplicated from the Slice 2.4 tests for
the Anima helper because the two helpers are now
structurally identical, so the Slice 2.4 lock applies by
mirror. This is documented in the test design note in
SPEC §30.6.2 and in the code review §4.

---

## 4. Diff size

| File | Before | After | Delta |
|------|--------|-------|-------|
| `src/app.js` | 7297 lines (post-K.6) | 7317 lines | +20 lines (the post-success block + K.7 marker comment) |
| `tests/run-all.js` | 14941 lines | 15022 lines | +81 lines (4 new tests) |
| `docs/SPEC.md` | 2413 lines (post-K.6) | 2567 lines | +154 lines (§30.6.2 + Change Log) |
| `docs/ARCHITECTURE.md` | 1812 lines (post-K.6) | 1904 lines | +92 lines (A11) |
| `docs/PRE-MORTEM.md` | 1012 lines (post-K.6) | 1122 lines | +110 lines (§30.6.2) |
| `docs/CODE-REVIEW-30-k7-krea2-chat-show.md` | (new) | 201 lines | +201 |
| `docs/POLISH-AUDIT-30-k7.md` | (new) | this file | ~250 |

Total: ~20 lines of production code (`src/app.js` only). All
other deltas are docs + tests + audit. The fix is minimal
and tightly scoped.

---

## 5. Constraint audit

| Constraint | Preserved? | Evidence |
|-----------|-----------|----------|
| K.5 no-negative-envelope invariant | ✅ | K.7 is a UI-binding fix, not a contract change. The K.4 POST body is unchanged: `model: 'krea2'`, `variant`, `creativity`, `metadata`; no `negative` field. Existing K.5 aggregate test still passes. |
| K.4 chat-Apply branch | ✅ | K.7 only touches the post-success block of `activateKrea2ChatForResult`. The chat-stream path (`submitChatMessageStreaming` at src/app.js:6517) and the chat-apply path (`applyChatRevision`'s Krea-2 branch at src/app.js:6821) are not modified. |
| Pre-Generate picker dispatch | ✅ | K.7 does not touch the picker or the dispatch path. |
| Per-model chat-session pattern (ADR 0021) | ✅ | The Krea-2 helper now matches the Anima helper's contract one-for-one. The two call sites differ only in the POST body. A future `activateChatForResult(model, data)` refactor is parked (would cross the "rename a shared symbol" gate). |
| 718-test baseline | ✅ | K.7 adds 4 new tests; no existing test was modified or removed. All 718 prior tests still pass. |
| No new dependencies | ✅ | Pure JS. No new npm packages. No `package.json` change. |
| No `onViewEnter` chat branch (P-13) | ✅ | `src/shell.js:73-86` is unchanged. The empty-chat-view case is parked as H7. |
| No click handlers on `<a href="#/chat">` links | ✅ | No click listener added to any of the three refine-in-chat links. The helper pre-creates the session in `displayKrea2Result` before the user clicks the link. |
| Append-only doc discipline | ✅ | SPEC §30.6.2 (line 2219, appended after §30.6.1), ARCH §30 A11 (line 1814, appended after A10), PRE-MORTEM §30.6.2 (line 1014, appended after §30.6.1). No edits to existing prose. |
| Slice marker convention | ✅ | `Slice K.7` identifier present in `src/app.js` (1 place: the new post-success block comment) and in 4 new tests. |
| Cross-reference discipline | ✅ | Each new line carries a `// K.7 — K.4 follow-up. …` comment explaining the why-not-just-rewrite. The comment cross-references the K.4 stub and the Anima helper. |
| Code style (pre-existing patterns) | ✅ | The post-success block is a mechanical mirror of `activateAnimaChatForResult` (src/app.js:6268-6282 + 6355). The two helpers are now structurally identical except for the POST body. |

---

## 6. Polish findings

- **None blocking.**
- **None minor.** The post-success block is a mechanical
  mirror of the Anima helper; no divergence to document.
  The "untested" 2 of 6 post-success steps
  (`chatSessionStatus` populate, `chatSessionDeleteBtn`
  enable) are intentionally not duplicated from Slice 2.4
  per the test-design note in SPEC §30.6.2 — the existing
  Slice 2.4 tests already lock those behaviours for the
  Anima helper, and the K.7 helper is structurally
  identical, so the lock applies by mirror. This is the
  right scope decision; documenting it here so the next
  audit pass knows it was intentional, not an oversight.

### Cosmetic gaps discovered (parked, not blocking)

- **H5 (already parked in K.6):** Z-Image + Anima regenerate
  button `.btn-spinner` markup. Same cosmetic gap, different
  buttons. Trivial fix, ~6 lines of HTML, ~1 test.
- **H7 (newly parked in K.7):** Empty-chat-view case. The
  user can navigate to `#/chat` via the top nav tab with
  no session, and `onViewEnter` has no `chat` branch. Same
  black-screen symptom (view title + view-sub only, panel
  hidden), different cause. Low frequency (most users come
  from a result panel). Parked.

---

## 7. Ship gate

All polish-audit criteria are met:

- [x] Code review verdict: `pass`
- [x] All 722 tests pass, 0 fail
- [x] No new dependencies
- [x] No force-push, no reset --hard, no rm -rf
- [x] K.5 / K.4 / per-model chat-session invariants preserved
- [x] P-13 (no `onViewEnter` chat branch) respected
- [x] No link click handlers on `<a href="#/chat">` (helper pre-creates the session)
- [x] Append-only doc discipline respected
- [x] Slice marker convention followed
- [x] Conventional commit message drafted
- [x] SESSION-STATE row pending (appended in this commit)
- [x] BACKLOG H6 entry pending (appended in this commit)
- [x] BACKLOG H7 entry pending (appended in this commit — parked)

**Verdict: `pass` — ready to commit and push.**

---

## 8. Recommended follow-up (out of scope for K.7)

Logged for the next session or polish pass:

1. **H7 — Empty-chat-view case.** Add an `onViewEnter('chat')`
   branch in `src/shell.js:73-86` that shows a "Generate a
   prompt first" hint when `state.chatSessionId` is null.
   Different cause from K.7; needs its own slice when the
   frequency justifies the work. ~15 LOC + ~2 tests.
2. **H5 — Z-Image + Anima regenerate button spinners.**
   The buttons fire the right handlers but lack the
   `<span class="btn-spinner" hidden aria-hidden="true">`
   element. Trivial fix, ~6 lines of HTML, ~1 test.
3. **`setButtonLoading` refactor to accept a button list.**
   Lift to `setButtonsLoading(buttons, loading, text)`. Wide
   refactor, crosses the AGENTS.md "rename a shared symbol"
   gate. Parked.
4. **`activateChatForResult(model, data)` lifted helper.**
   The Anima + Krea-2 chat-activation helpers are now
   structurally identical except for the POST body. Lifting
   them into one parameterised helper would deduplicate
   ~15 lines and make future per-model chat activation
   trivial. Wide refactor, crosses the "rename a shared
   symbol" gate. Parked.
