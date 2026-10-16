# Code Review — Slice K.9 — H7 close — Empty-chat-view `onViewEnter('chat')` branch

**Slice:** K.9 (H7 close)
**Author:** goose
**Reviewer:** goose (self-review, two-axis)
**Date:** 2026-10-16
**Verdict:** **pass** (no blockers; no minor findings)

---

## 1. What this slice does

Closes H7 — the related-but-different cause for the same
black-screen symptom that K.7 closed for the result-panel
link path. If the user navigates to `#/chat` via the
**top nav tab** without first generating a prompt,
`state.chatSessionId` is null and `onViewEnter`
(src/shell.js:73-86) had no `chat` branch. The chat-view
router un-hid `#view-chat` but `#step-chat` (default
`hidden`) stayed hidden. K.9 closes the gap by adding a
`showEmptyChatState()` helper in src/app.js (exposed via
`window.__i2pShowEmptyChatState`) and an
`onViewEnter('chat')` branch in src/shell.js that calls it.

The helper un-hides `#step-chat`, clears `#chat-messages`,
and writes a friendly `chat-empty` paragraph with the
two-step "Generate → Refine in chat" instruction so the
user has actionable instructions instead of a black
background.

**Test count:** 725 → 728 (+3), all green, 0 fail.

---

## 2. Axis 1 — Standards review

| Standard | Met? | Evidence |
|----------|------|----------|
| **Append-only doc discipline** | ✅ | SPEC §30.6.4, ARCH §30 A13, PRE-MORTEM §30.6.4, SESSION-STATE row, BACKLOG H7 closure, Change Log row. No edits to existing prose. |
| **Inline two-axis review pattern** | ✅ | This file + matching `docs/POLISH-AUDIT-30-k9.md`. |
| **Per-slice file pattern** | ✅ | JS in `src/app.js` + `src/shell.js`; tests in `tests/run-all.js`; review + polish docs in `docs/`. No HTML / CSS / server.js change. |
| **Gates respected** | ✅ (scaled-down) | G1 = the user's bug report was the trigger (H7 was discovered during K.7); G2 = SPEC §30.6.4; G3 = ARCH A13 + PRE-MORTEM §30.6.4 (no new ADR — K.9 is a UX gap fix, no strategic decision); G4 = impl + tests + this review; G5 = polish audit + commit. |
| **No new dependencies** | ✅ | Pure JS. No new npm packages. |
| **No force-push / no reset --hard** | ✅ | Additive JS edits. |
| **Conventional commit message** | ✅ | `fix(slice-k.9): render empty-state in chat view when no session exists (H7 close)` |
| **Slice marker convention** | ✅ | `Slice K.9` identifier present in `src/app.js` (1 place: the helper comment) + `src/shell.js` (1 place: the branch comment) + 3 new tests. |
| **Cross-reference discipline** | ✅ | Each new line carries a `// Slice K.9 (H7 close) — …` comment explaining the why-not-just-rewrite. |
| **Shell.js → app.js bridge pattern preserved** | ✅ | New `__i2pShowEmptyChatState` bridge mirrors the existing `__i2pClearChatHistory` (src/app.js:5115) + `__i2pAnalyzeGenerated` (src/app.js:5163) pattern. Guarded by `typeof` check on shell.js side. |
| **K.7 active-session post-success block unaffected** | ✅ | K.9's `showEmptyChatState` returns `false` when `state.chatSessionId` is set, so the K.7 path is the only writer to `#step-chat` / `#chat-messages` in the active-session case. |
| **K.5 no-negative-envelope invariant preserved** | ✅ | No code change to the response envelope. |
| **K.4 / per-model chat-session pattern preserved** | ✅ | K.9 is the no-session path only. The per-model helpers (K.7 + Slice 2.4) retain exclusive ownership of the active-session path. |
| **725 baseline preserved** | ✅ | K.9 adds 3 new tests; no existing test was modified or removed. |

### Standards findings

- **None blocking.**
- **None minor.** Small JS addition that follows the
  existing bridge pattern verbatim.

---

## 3. Axis 2 — Spec review

| Spec requirement | Met? | Evidence |
|------------------|------|----------|
| `showEmptyChatState` helper defined in src/app.js | ✅ | src/app.js:5117-5145. Test `SPEC §30 K.9: src/app.js exposes __i2pShowEmptyChatState` passes. |
| `showEmptyChatState` exposed via `window.__i2pShowEmptyChatState` | ✅ | src/app.js:5146. Test passes. |
| No-op (return `false`) when `state.chatSessionId` is set | ✅ | src/app.js:5121. Test `SPEC §30 K.9: showEmptyChatState un-hides #step-chat` asserts the no-op-when-active pattern. |
| Un-hides `#step-chat` (the core fix) | ✅ | src/app.js:5126. Test passes. |
| Clears `#chat-messages` before writing the empty state | ✅ | src/app.js:5128. Test passes. |
| Uses the `chat-empty` class (mirrors the existing renderChatMessages empty-state pattern at src/app.js:5391) | ✅ | src/app.js:5131. Test passes. |
| Empty-state text mentions the two-step flow | ✅ | src/app.js:5132-5134 ("Generate a prompt in the Create view, then click 'Refine in chat →' on the result panel…"). Test passes. |
| `onViewEnter('chat')` branch added in src/shell.js | ✅ | src/shell.js:87-99. Test `SPEC §30 K.9: src/shell.js onViewEnter calls __i2pShowEmptyChatState for view=chat` passes. |
| Call guarded by `typeof` check (mirrors the other shell.js → app.js bridges) | ✅ | src/shell.js:96. Test passes. |
| No new endpoint / no new dependency / no new contract | ✅ | Only `src/app.js` + `src/shell.js` modified. No server.js change, no package.json change, no SPEC contract change, no HTML change. |
| 3 new tests (725 → 728) | ✅ | tests/run-all.js tail block, 3 new tests. Total: 728 / 0 green. |

### Spec findings

- **None blocking.**
- **None minor.** All 11 spec requirements met; all 3
  test targets locked; 2-axis invariants preserved.

---

## 4. Test review

3 new tests, all use the existing K.6/K.7/K.8 test
pattern (`fs.readFileSync` + regex on the relevant
function or block). The tests assert literal source
patterns that were independently derived from the
SPEC §30.6.4 spec + the existing `__i2pClearChatHistory`
bridge pattern. They would catch a future regression
that:
- Removes the function definition
- Removes the `window.__i2pShowEmptyChatState` export
- Removes the `onViewEnter('chat')` branch
- Removes the `typeof` guard
- Changes the empty-state class from `chat-empty`
- Removes the no-op-when-active pattern

**No tautological tests. No implementation-coupled tests.**

---

## 5. Risk review

| Risk | Mitigation | Present? |
|------|-----------|----------|
| **R-17 (LOW):** Per-navigation function call cost | Function is cheap (one boolean check + early return). | ✅ No caching needed. |
| **R-18 (LOW):** Empty-state overwrites active-session messages | Early `return false` in the function ensures it never touches `#chat-messages` when a session is active. | ✅ src/app.js:5121. Test locks the no-op-when-active pattern. |
| **R-19 (LOW):** One more `window.__i2p*` bridge | Established pattern; stable, documented, `typeof`-guarded. | ✅ Mirrors `__i2pClearChatHistory` (src/app.js:5115). |

### Risk findings

- **None blocking.** All 3 risks LOW, all 3 mitigations
  present.

---

## 6. Cross-references

- SPEC §30.6.4 (K.9 sub-slice spec) — `docs/SPEC.md`
- ARCH §30 A13 (K.9 wiring architecture) — `docs/ARCHITECTURE.md`
- PRE-MORTEM §30.6.4 (K.9 pre-mortem) — `docs/PRE-MORTEM.md`
- H7 parked entry — `docs/BACKLOG.md` (closed in this commit)
- P-13 (K.7 pre-mortem) — the constraint K.9 now satisfies
- K.7 post-success block — `src/app.js:2651-2668` (the active-session path K.9 explicitly does not touch)
- Existing bridge pattern — `__i2pClearChatHistory` at `src/app.js:5115`, `__i2pAnalyzeGenerated` at `src/app.js:5163`

---

## Verdict

**pass.** Small, isolated, additive UX fix; 728/0
green; no blockers, no minor findings. After K.9, the
chat view always shows the user something actionable —
never just a black background.
