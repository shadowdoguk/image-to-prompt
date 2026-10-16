# Polish Audit — Slice K.14 — H8 close — "Refine in chat →" link wiring

**Slice:** K.14 (H8 close)
**Date:** 2026-10-16
**Code review verdict:** `pass` (see `docs/CODE-REVIEW-30-k14-h8-refine-link.md`)
**Polished verdict:** **`pass`**

---

## 1. What this audit covers

K.14 is a small, isolated, additive UI wiring fix that closes H8 — the third in the chat-anchor bug family (K.6 / K.7 / K.9 / K.14). The three "Refine in chat →" links in `src/index.html` were bare `<a href="#/chat">` anchors with no JS handler. After Generate, clicking the link landed on the chat view with no session (`state.chatSessionId === null`) and K.9's empty-state helper showed its "No chat session yet…" paragraph — which directly contradicted the just-completed action.

K.14 wires all three links as click handlers in `src/app.js`. Each handler snapshots which result panel is visible, calls the matching per-model body builder and awaits it, navigates to `#/chat` on success (with `preventDefault()` to avoid the bare-anchor double-navigate), and surfaces failures as a toast (no silent `console.warn`). HTML is unchanged.

After K.14, the "Refine in chat →" links actually do what the link text promises: take the user to a chat view with a fresh session anchored to the just-generated prompt and the chat input focused. If the server rejects the body, the user sees a clear toast instead of a silent black screen.

---

## 2. Artifact checklist

| Artifact | Required? | Present? | Path |
|----------|-----------|----------|------|
| SPEC delta | yes | ✅ | `docs/SPEC.md` §30.6.7 + Change Log row |
| ARCH delta | yes | ✅ | `docs/ARCHITECTURE.md` §30 A15 |
| PRE-MORTEM delta | yes | ✅ | `docs/PRE-MORTEM.md` §30.6.7 |
| ADR | no (UI wiring bug, no strategic decision) | n/a | — |
| Inline two-axis code review | yes | ✅ | `docs/CODE-REVIEW-30-k14-h8-refine-link.md` |
| Polish audit (this file) | yes | ✅ | `docs/POLISH-AUDIT-30-k14.md` |
| SESSION-STATE row | yes | ✅ | appended in this commit |
| BACKLOG parked items | yes | ✅ | 4 items appended |
| Test count delta | yes | ✅ | 736 → 740 (+4), 0 red |
| Conventional commit | yes | ✅ | `fix(slice-k.14): wire Refine in chat links + surface silent failures` |

---

## 3. Test count

- Before K.14: **736 passed, 0 failed** (after K.13)
- After K.14: **740 passed, 0 failed**
- Delta: **+4 new tests, 0 modified, 0 removed**

The 4 new tests target:

1. `dom.refineInChatLink` / `dom.animaRefineInChatLink` / `dom.krea2RefineInChatLink` lookups declared + HTML `href="#/chat"` preserved on all three links
2. All three links have `addEventListener('click', …)` wiring via `wireRefineInChatLink`
3. Click handler dispatches to `activateChatForResult` / `activateAnimaChatForResult` / `activateKrea2ChatForResult` based on `isPanelVisible(dom.<panel>)`
4. Click handler awaits activation, sets `location.hash = '#/chat'` + `e.preventDefault()` on success, calls `showError(…, { severity: 'warning' })` on failure, contains no `console.warn` in the K.14 code

No existing test was modified or removed. The 736 baseline is preserved.

---

## 4. Diff size

| File | Before | After | Delta |
|------|--------|-------|-------|
| `src/app.js` | 7323 lines (post-K.13) | 7446 lines | +123 lines (3 dom lookups + 1 wiring block) |
| `tests/run-all.js` | 15344 lines | 15467 lines | +123 lines (4 new tests + 7 lines of comment header) |
| `docs/SPEC.md` | 2868 lines (pre-K.14) | 3116 lines | +248 lines (§30.6.7 + Change Log row) |
| `docs/ARCHITECTURE.md` | 2051 lines (pre-K.14) | 2186 lines | +135 lines (A15) |
| `docs/PRE-MORTEM.md` | 1338 lines (pre-K.14) | 1462 lines | +124 lines (§30.6.7) |
| `docs/CODE-REVIEW-30-k14-h8-refine-link.md` | (new) | 145 lines | +145 |
| `docs/POLISH-AUDIT-30-k14.md` | (new) | this file | ~170 |

Total: ~123 lines of production code (`src/app.js` only).
All other deltas are docs + tests + audit. The fix is
minimal and tightly scoped to the click handler.

---

## 5. Constraint audit

| Constraint | Preserved? | Evidence |
|-----------|-----------|----------|
| K.7 active-session post-success block | ✅ | K.14 only adds a new entry point. The K.7 path is unchanged. If a session is already active, the body builder still creates a NEW session (matching the link's "refine THIS prompt in chat" intent). |
| K.9 empty-state helper | ✅ | K.14 calls `preventDefault()` ONLY on success. On failure, the bare-anchor fallback navigates to `#/chat` and K.9's helper runs. |
| K.6 / K.7 / K.8 / K.9 / K.11 lift invariants | ✅ | No code change to the per-model builders, `runChatActivationSession`, `setButtonLoading`, or regenerate/copy button wiring. |
| Per-model chat-session pattern (ADR 0021) | ✅ | K.14 routes through the existing `activateChatForResult` / `activateAnimaChatForResult` / `activateKrea2ChatForResult`. No new body builder. |
| `runChatActivationSession` contract | ✅ | K.14 calls the per-model body builders exactly the same way the auto-activation path calls them. The body builders → `runChatActivationSession` → POST `/api/chat/sessions` chain is untouched. |
| No server change | ✅ | Only `src/app.js` + `tests/run-all.js` modified. No `server.js` change. |
| No HTML structural change | ✅ | `src/index.html` unchanged. The `href="#/chat"` stays on all three links for keyboard nav + right-click semantics. |
| No new toast-style primitives | ✅ | Uses the existing `showError` helper (severity: 'warning') — same one `runChatActivationSession` uses for the chat-limit warning. |
| No new dependencies | ✅ | Pure JS. No new npm packages. No `package.json` change. |
| Append-only doc discipline | ✅ | SPEC §30.6.7 + Change Log row, ARCH §30 A15, PRE-MORTEM §30.6.7. No edits to existing prose. |
| Slice marker convention | ✅ | `Slice K.14` identifier present in `src/app.js` (2 places: dom block + wiring block) + 4 new tests + 1 reference in the K.14 test block comment. |
| Code style (pre-existing patterns) | ✅ | Mirrors the per-panel regenerate/copy wiring pattern (K.6 / Slice 2.3 / Slice K.7) verbatim. The `wireRefineInChatLink` helper is the parallel of `wireRegenerateButton` / `wireCopyButton` but for the chat-link case. |
| 736-test baseline | ✅ | K.14 adds 4 new tests; no existing test was modified or removed. |
| `node --check src/app.js` passes | ✅ | Verified on 2026-10-16. |

---

## 6. Polish findings

- **None blocking.**
- **None minor.** Thin click handler that follows the
  existing per-panel regenerate/copy wiring pattern
  verbatim; no divergence to document.

### Cosmetic gaps discovered (none new)

- The K.14 wiring block has its own "Slice K.14 (H8
  close)" marker comment in TWO places (the dom block
  at line 159 and the wiring block at line 2794). The
  dom-block marker is a one-liner noting the three
  lookups; the wiring-block marker is the long
  comment block. This matches the K.6 / K.7 / K.8 / K.9
  pattern (lookups and wiring each get their own
  short marker). No change needed.
- The K.14 spec comment in the wiring block (line
  2803) mentions `console.warn` by name in a "no
  silent console.warn" callout. The 4th K.14 test
  specifically strips JS comments before searching for
  `console.warn` to avoid a false positive on this
  self-referential comment. This is a test-design
  note, not a code change.
- The K.14 window for the 4th test is bounded by the
  wiring-block marker AND the model-selector end
  divider. This prevents pre-existing `console.warn`
  calls in unrelated code (palette, directives, chat
  helpers) from false-positiving the K.14
  no-silent-failure invariant. The bounding is a
  test-design note.

---

## 7. Parked items (BACKLOG.md)

K.14 surfaces 4 latent issues as parked BACKLOG entries
rather than fixing them in this slice (per the K.14
scope-lock decision):

1. **Krea-2 model allowlist server fix** — `server.js:8015`
   still rejects `model: 'krea2'` (allowlist is
   `['zimage_turbo', 'anima']`). K.14 surfaces the 400
   as a toast — strictly better than the silent black
   screen. The server allowlist fix is a separate
   slice.
2. **Krea-2 regenerate button + copy button spinners**
   — stale planning notes from a prior session describe
   a different bug. Parked; the next session should
   re-investigate before scoping.
3. **Refactor of the three body builders into one
   parameterized function** — K.14 routes through the
   existing builders; the parameterization is
   attractive but adds a new abstraction the project
   doesn't need yet. Parked.
4. **Auto-activation's silent-failure path on the
   per-model Generate flows** — the three
   fire-and-forget catches at `src/app.js:1659`,
   `:1701`, `:1802` silently swallow errors. K.14 fixes
   the user-visible link bug; the auto-activation
   silent failure is a latent bug that would only
   matter if a user generated a prompt and then
   navigated directly to the chat view without
   clicking the link. The link fix makes this case
   unreachable for the link surface; the
   auto-activation is left as a belt-and-braces
   backup. If the auto-activation ever fails in the
   wild, the user still has the link as a retry.

---

## 8. Ship gate

- [x] Code review verdict: `pass`
- [x] All 740 tests pass, 0 fail
- [x] No new dependencies
- [x] No force-push, no reset --hard, no rm -rf
- [x] K.6 / K.7 / K.8 / K.9 / K.11 lift invariants preserved
- [x] Per-model chat-session pattern (ADR 0021) preserved
- [x] `runChatActivationSession` contract preserved
- [x] No server change, no HTML structural change
- [x] No new toast-style primitives
- [x] Append-only doc discipline respected
- [x] Slice marker convention followed
- [x] Conventional commit message drafted
- [x] SESSION-STATE row appended
- [x] BACKLOG parked items appended (4 entries)

**Verdict: `pass` — ready to commit and push.**
