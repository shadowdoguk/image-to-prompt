# Code Review — Slice K.7 — Krea-2 "Refine in chat" panel-show wiring (K.4 follow-up)

**Slice:** K.7 (K.4 follow-up)
**Author:** goose
**Reviewer:** goose (self-review, two-axis)
**Date:** 2026-10-16
**Verdict:** **pass** (no blockers; no minor findings)

---

## 1. What this slice does

Closes a K.4 ship-without-wiring defect:
`activateKrea2ChatForResult` (src/app.js:2627) was a half-
complete helper. It POSTed `/api/chat/sessions`, set
`state.chatSessionId`, called `renderChatSessionSelect()` +
`updateChatSendButton()`, and returned. The Anima parallel
helper (`activateAnimaChatForResult` at src/app.js:6305) does
the same PLUS the post-success block that brings the chat
panel to life: prepend the new session to `state.chatSessions`,
call `renderChatMessages(session)`, un-hide `#step-chat`,
populate the session status, enable the delete button, and
focus the input. The Krea-2 helper skipped every one of
those post-success steps.

Consequence: when the user clicked the third button at the
bottom of the Krea-2 result panel — `#krea2-refine-in-chat-link`
(src/index.html:387), a bare `<a href="#/chat">` — the hash
router (src/shell.js:269) un-hid `#view-chat`, but the inner
`#step-chat` panel (src/index.html:433, default `hidden`)
stayed hidden, and the message area was never populated.
The user saw the view title + view-sub and nothing else.
A black background underneath, because no panel rendered.

The fix:

1. Appends the Anima post-success block to
   `activateKrea2ChatForResult`'s `try` block
   (src/app.js:2652-2672). Specifically:
   - `state.chatSessions = [session].concat(state.chatSessions.filter(...))`
   - `renderChatMessages(session)` (guarded by `typeof`)
   - `dom.stepChat.hidden = false` (guarded by `if (dom.stepChat)`)
   - `dom.chatSessionStatus.{hidden = false, textContent = formatChatSessionStatus(session)}`
   - `dom.chatSessionDeleteBtn.disabled = false`
   - `dom.chatInput.focus()` (guarded by `if (dom.chatInput)`)
2. Adds 4 new tests in `tests/run-all.js` that lock the four
   critical post-success steps: `state.chatSessions` prepend,
   `renderChatMessages` call, `dom.stepChat.hidden = false`,
   `dom.chatInput.focus()`. (The other two post-success steps
   — `chatSessionStatus` and `chatSessionDeleteBtn` — are
   already tested at Slice 2.4 for the Anima helper and
   intentionally not duplicated, per the test-design note in
   SPEC §30.6.2.)

**Test count:** 718 → 722 (+4). All 722 pass, 0 fail.

---

## 2. Axis 1 — Standards review

How does this code match the project's documented coding
standards (`AGENTS.md` + `docs/PRINCIPLES.md` +
`docs/adr/0021-anima-fork.md` + per-slice conventions)?

| Standard | Met? | Evidence |
|----------|------|----------|
| **Append-only doc discipline** | ✅ | SPEC §30.6.2, ARCH §30 A11, PRE-MORTEM §30.6.2, Change Log row added. No edits to existing prose. |
| **Inline two-axis review pattern** | ✅ | This file + matching `docs/POLISH-AUDIT-30-k7.md`. |
| **Per-slice file pattern (Slice 2 / K.3 cadence)** | ✅ | Tests in `tests/run-all.js`; review + polish docs in `docs/`. Code in `src/app.js` only (no HTML / CSS / server.js change). |
| **Gates respected (G1 → G2 → G3 → G4 → G5)** | ✅ (scaled-down) | G1 = the user's bug report is the "sync" + the user confirmed the intent (chat is a ChatGPT-style art expert); G2 = SPEC §30.6.2; G3 = ARCH A11 + PRE-MORTEM §30.6.2 (no new ADR — K.7 is a K.4 follow-up, same strategic shape); G4 = impl + tests + this review; G5 = polish audit + commit. |
| **No new dependencies** | ✅ | Pure JS. No new npm packages. |
| **No force-push / no reset --hard / no rm -rf** | ✅ | All edits are additive, in tracked files. |
| **Conventional commit message** | ✅ | `fix(slice-k.7): un-hide chat panel + render messages after Krea-2 chat-session mint` (pending commit). |
| **Slice marker convention** | ✅ | `Slice K.7` identifier present in `src/app.js` (1 place: the new post-success block comment) and in 4 new tests. |
| **Cross-reference discipline** | ✅ | Each new line carries a `// K.7 — K.4 follow-up. …` comment explaining the why-not-just-rewrite. The comment also cross-references the K.4 stub and the Anima helper. |
| **Code style (pre-existing patterns)** | ✅ | The post-success block is a mechanical mirror of `activateAnimaChatForResult` (src/app.js:6268-6282 + 6355). The two helpers are now structurally identical except for the POST body. |
| **K.5 no-negative-envelope invariant preserved** | ✅ | K.7 is a UI-binding fix, not a contract change. The K.4 POST body is unchanged (`model: 'krea2'`, `variant`, `creativity`, `metadata`; no `negative` field). |
| **K.4 chat-Apply branch unaffected** | ✅ | K.7 only touches the post-success block of `activateKrea2ChatForResult`. The chat-stream / chat-apply path (`submitChatMessageStreaming`, `applyChatRevision`'s Krea-2 branch) is not modified. |
| **Pre-Generate picker dispatch unaffected** | ✅ | K.7 does not touch the picker or the dispatch path. |
| **Per-model chat-session pattern from ADR 0021 preserved** | ✅ | The Krea-2 helper now matches the Anima helper's contract one-for-one. The two call sites differ only in the POST body. A future refactor could lift this into one parameterised `activateChatForResult(model, data)` helper (parked; would cross the AGENTS.md "rename a shared symbol" gate). |
| **718 baseline preserved** | ✅ | K.7 adds 4 new tests; no existing test was modified or removed. All 718 prior tests still pass. |

### Standards findings

- **None blocking.**
- **None minor.** The post-success block is a mechanical
  mirror of the Anima helper; no divergence to document.
  The two un-tested post-success steps
  (`chatSessionStatus` populate, `chatSessionDeleteBtn`
  enable) are intentionally not duplicated from Slice 2.4
  per the test-design note in SPEC §30.6.2 — the existing
  Slice 2.4 tests already lock those behaviours for the
  Anima helper, and the K.7 helper is structurally
  identical, so the lock applies by mirror.

---

## 3. Axis 2 — Spec review

Does the implementation match what `docs/SPEC.md` §30.6.2
(and the user's bug report) said it should do?

| Spec requirement | Met? | Evidence |
|------------------|------|----------|
| `state.chatSessions` prepend (mirrors Anima line 6268) | ✅ | src/app.js:2653-2655. Test `SPEC §30 K.7: activateKrea2ChatForResult prepends new session to state.chatSessions` passes. |
| `renderChatMessages(session)` call (mirrors Anima line 6272) | ✅ | src/app.js:2657. Test `SPEC §30 K.7: activateKrea2ChatForResult calls renderChatMessages(session)` passes. |
| `dom.stepChat.hidden = false` (mirrors Anima line 6273) | ✅ | src/app.js:2658. Test `SPEC §30 K.7: activateKrea2ChatForResult un-hides #step-chat` passes. |
| `dom.chatSessionStatus.{hidden = false, textContent = …}` (mirrors Anima line 6274-6277) | ✅ | src/app.js:2659-2662. (Locked by Slice 2.4 tests for the Anima helper; intentionally not duplicated per test-design note in SPEC §30.6.2.) |
| `dom.chatSessionDeleteBtn.disabled = false` (mirrors Anima line 6278-6280) | ✅ | src/app.js:2663-2665. (Locked by Slice 2.4 tests for the Anima helper; intentionally not duplicated per test-design note in SPEC §30.6.2.) |
| `dom.chatInput.focus()` (mirrors Anima line 6355) | ✅ | src/app.js:2668. Test `SPEC §30 K.7: activateKrea2ChatForResult focuses the chat input` passes. |
| Helper is a K.4 follow-up (K.4 contract decision preserved) | ✅ | POST body unchanged: `model: 'krea2'`, `variant`, `creativity`, `metadata`, no `negative` field. Existing K.4 tests still pass. |
| Helper is NOT a `onViewEnter` chat branch (P-13) | ✅ | src/shell.js:73-86 unchanged. The helper fix is the right scope. |
| Helper is NOT a click handler on the three `<a href="#/chat">` links | ✅ | No click listener added to any of `#refine-in-chat-link`, `#anima-refine-in-chat-link`, `#krea2-refine-in-chat-link`. The session is pre-created in `displayKrea2Result` before the user ever clicks the link. |
| No new endpoint / no new dependency / no new contract | ✅ | Only src/app.js modified. No server.js change, no package.json change, no SPEC contract change. |
| 4 new tests (718 → 722) | ✅ | tests/run-all.js tail block, 4 new tests. Total: 722 / 0 green. |

### Spec findings

- **None blocking.**
- **None minor.** All 11 spec requirements met; all 4
  committed test targets locked; all 3 in-scope items
  (prepend, render, un-hide, focus) covered by explicit
  tests.

---

## 4. Test review

Are the 4 new tests well-formed and do they lock what
they claim to lock?

| Test | Locks | Independent source of truth | Risk |
|------|-------|----------------------------|------|
| `SPEC §30 K.7: activateKrea2ChatForResult prepends new session to state.chatSessions` | The exact regex pattern from the Anima helper at src/app.js:6268. | Independent: the pattern is read from the Anima helper, not invented. | LOW. A future refactor that lifts the helpers into one parameterised function would not regress this test (the pattern would still match). |
| `SPEC §30 K.7: activateKrea2ChatForResult calls renderChatMessages(session)` | The call site (must be guarded by `typeof` check, matching the existing pattern for `renderChatSessionSelect` + `updateChatSendButton` in the same helper). | Independent: the `typeof` guard pattern is already used twice in the same helper for the sibling calls. | LOW. |
| `SPEC §30 K.7: activateKrea2ChatForResult un-hides #step-chat` | The `dom.stepChat.hidden = false` line + its `if (dom.stepChat)` guard. | Independent: this is the line that un-hides the panel; the test asserts the literal source pattern. | LOW. |
| `SPEC §30 K.7: activateKrea2ChatForResult focuses the chat input` | The `dom.chatInput.focus()` call + its `if (dom.chatInput)` guard. | Independent: mirrors the Anima helper's focus pattern. | LOW. |

**No tautological tests.** Each test asserts a literal source
pattern that was independently derived from the Anima helper
or the SPEC §30.6.2 commit. The tests would catch a future
regression that removes any of the four post-success steps.

**No implementation-coupled tests.** The tests use
`fs.readFileSync` + `indexOf` + regex, not the live
`window.__i2pTest` hook. This matches the existing K.4 +
K.6 test pattern.

---

## 5. Risk review

Do the 3 risks logged in PRE-MORTEM §30.6.2 (R-12, R-13, R-14)
have their mitigations present in the code?

| Risk | Mitigation | Present? |
|------|-----------|----------|
| **R-12 (LOW):** Helper divergence | Block diagram in ARCH §30 A11 documents the structural identity. No immediate refactor motivation beyond keeping the two helpers in sync. | ✅ ARCH §30 A11 documents the structural identity. No new abstraction introduced. |
| **R-13 (LOW):** Previous session message-area wipe | `state.chatSessionId` is set BEFORE `renderChatMessages` is called. The previous session is preserved in `state.chatSessions` and re-selectable from the session rail. | ✅ src/app.js:2651 sets `state.chatSessionId = session.id` BEFORE src/app.js:2657 calls `renderChatMessages(session)`. Order is correct. |
| **R-14 (LOW):** Focus stealing | The user just clicked a "Refine in chat →" link, so they have signalled they want to type in the chat. Focus stealing is the intended UX. Same pattern as Anima (Slice 2.4). | ✅ src/app.js:2668 calls `dom.chatInput.focus()`. Mirrors Anima line 6355. |

### Risk findings

- **None blocking.** All 3 risks LOW, all 3 mitigations
  present.
- **R-12 follow-up note:** The block diagram in ARCH §30
  A11 explicitly calls out that a future
  `activateChatForResult(model, data)` refactor is parked.
  This is the right scope decision: doing it now would
  cross the AGENTS.md "rename a shared symbol" gate and
  require explicit user approval.

---

## 6. Cross-references

- SPEC §30.6.2 (K.7 sub-slice spec) — `docs/SPEC.md:2219`
- ARCH §30 A11 (K.7 wiring architecture) — `docs/ARCHITECTURE.md:1814`
- PRE-MORTEM §30.6.2 (K.7 pre-mortem, R-12/R-13/R-14, P-11/P-12/P-13, K-8/K-9) — `docs/PRE-MORTEM.md:1014`
- K.4 stub at `src/app.js:2627-2664` (K.7 closes the gap at `src/app.js:2652-2668`)
- Anima parallel helper at `src/app.js:6305-6357` (K.7's post-success block mirrors this verbatim)
- ADR 0030 (Krea 2 fork) — `docs/adr/0030-krea2-fork.md` (K.7 is a K.4 follow-up, no new ADR)
- ADR 0021 (Anima fork) — `docs/adr/0021-anima-fork.md` (per-model chat-session pattern; K.7 brings Krea-2 to parity)
- Polish audit `docs/POLISH-AUDIT-30-k7.md` (companion to this file)

---

## Verdict

**pass.**

- All 11 spec requirements met (file/line evidence above).
- All 718 baseline tests still pass.
- All 4 new tests pass.
- All 3 PRE-MORTEM risks have present mitigations.
- All 3 PRE-MORTEM pre-commitments met.
- All 3 K.7 invariants preserved (no-negative envelope,
  per-model chat-session, K.4 contract).
- Append-only doc discipline respected across SPEC §30.6.2,
  ARCH §30 A11, PRE-MORTEM §30.6.2, Change Log row.
- No new dependencies. No force-push. No reset --hard.
