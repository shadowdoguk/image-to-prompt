# Code Review — Slice K.14 — H8 close — "Refine in chat →" link wiring

**Slice:** K.14 (H8 close)
**Author:** goose
**Reviewer:** goose (self-review, two-axis)
**Date:** 2026-10-16
**Verdict:** **pass** (no blockers; no minor findings)

---

## 1. What this slice does

Closes H8 — the third in the chat-anchor bug family (K.6 / K.7 / K.9 / K.14). The three "Refine in chat →" links in `src/index.html` (lines 264, 326, 399) were bare `<a href="#/chat">` anchors with no JS handler. After Generate, clicking the link landed on the chat view with no session (`state.chatSessionId === null`) and K.9's empty-state helper showed its "No chat session yet…" paragraph — which directly contradicted the just-completed action.

K.14 wires all three links as click handlers in `src/app.js`. Each handler:

1. Snapshots which result panel is visible (`dom.resultSection.hidden` / `dom.animaResultSection.hidden` / `dom.krea2ResultSection.hidden`) — the single source of truth for "which model did the user just generate with".
2. Calls the matching per-model body builder (`activateChatForResult` / `activateAnimaChatForResult` / `activateKrea2ChatForResult`) and awaits the activation.
3. On success: sets `location.hash = '#/chat'` (idempotent) and calls `e.preventDefault()` so the bare-anchor fallback doesn't double-navigate.
4. On failure: surfaces the error as a toast via `showError(msg, { severity: 'warning' })` and lets the bare-anchor fallback run so the URL bar still updates and K.9's empty-state helper shows.

HTML is unchanged — `href="#/chat"` stays for keyboard nav + right-click semantics. The click handler is a thin wire: no new body builder, no new state machine, no per-model branching beyond "which body builder to call."

**Test count:** 736 → 740 (+4), all green, 0 fail.

---

## 2. Axis 1 — Standards review

| Standard | Met? | Evidence |
|----------|------|----------|
| **Append-only doc discipline** | ✅ | SPEC §30.6.7, ARCH §30 A15, PRE-MORTEM §30.6.7. No edits to existing prose. |
| **Inline two-axis review pattern** | ✅ | This file + matching `docs/POLISH-AUDIT-30-k14.md`. |
| **Per-slice file pattern** | ✅ | JS in `src/app.js`; tests in `tests/run-all.js`; review + polish docs in `docs/`. No HTML / CSS / server.js change. |
| **Gates respected** | ✅ (scaled-down) | G1 = the user's bug report was the trigger; G2 = SPEC §30.6.7; G3 = ARCH A15 + PRE-MORTEM §30.6.7 (no new ADR — K.14 is a UI wiring bug, no strategic decision); G4 = impl + tests + this review; G5 = polish audit + commit. |
| **No new dependencies** | ✅ | Pure JS. No new npm packages. No `package.json` change. |
| **No force-push / no reset --hard** | ✅ | Additive JS edits. |
| **Conventional commit message** | ✅ | `fix(slice-k.14): wire Refine in chat links + surface silent failures` |
| **Slice marker convention** | ✅ | `Slice K.14` identifier present in `src/app.js` (2 places: dom block + wiring block) + 4 new tests + 1 reference in the K.14 test block comment. |
| **Cross-reference discipline** | ✅ | Each new line carries a `// Slice K.14 (H8 close) — …` comment explaining the why-not-just-rewrite. |
| **Visible-panel dispatch pattern** | ✅ | Reads the canonical `hidden` flag on the three result panels — the same signal used by `displayResult` / `displayAnimaResult` / `displayKrea2Result` to enforce the "exactly one panel visible at a time" invariant. |
| **Per-model body-builder pattern preserved** | ✅ | K.14 routes through the existing `activateChatForResult` / `activateAnimaChatForResult` / `activateKrea2ChatForResult` (K.7 / Slice 2.4 / Slice K.4). No third "click-handler body builder" introduced. |
| **`runChatActivationSession` contract preserved** | ✅ | K.14 calls the per-model body builders exactly the same way the auto-activation path calls them. The body builders → `runChatActivationSession` → POST `/api/chat/sessions` chain is untouched. |
| **K.7 active-session post-success block unaffected** | ✅ | K.14 only adds a new entry point. The K.7 path (post-Generate auto-activation) is unchanged. If a session is already active, the body builder still creates a NEW session (matching the link's "refine THIS prompt in chat" intent) — same behavior as before for the link path. |
| **K.9 empty-state helper unaffected** | ✅ | K.14 calls `preventDefault()` ONLY on success. On failure, the bare-anchor fallback navigates to `#/chat` and K.9's helper runs (showing the friendly message + the new toast overlays). |
| **K.6 / K.7 / K.8 / K.9 / K.11 lift invariants preserved** | ✅ | No code change to the per-model builders, no change to `runChatActivationSession`, no change to `setButtonLoading`, no change to the regenerate/copy button wiring. |
| **736 baseline preserved** | ✅ | K.14 adds 4 new tests; no existing test was modified or removed. |

### Standards findings

- **None blocking.**
- **None minor.** Thin click handler that follows the
  existing per-model regenerate/copy wiring pattern
  (K.6 / Slice 2.3 / Slice K.3 / Slice K.7) verbatim.

---

## 3. Axis 2 — Spec review

| Spec requirement | Met? | Evidence |
|------------------|------|----------|
| 3 `refine-in-chat-link` / `anima-refine-in-chat-link` / `krea2-refine-in-chat-link` dom lookups in src/app.js | ✅ | src/app.js:159-166 (dom block). Test `SPEC §30 K.14: src/app.js declares dom lookups` passes. |
| HTML `href="#/chat"` preserved on all three links | ✅ | src/index.html:264 / :326 / :399 unchanged. Test passes. |
| All three links have `addEventListener('click', …)` wiring | ✅ | src/app.js:2851 (the `linkEl.addEventListener('click', …)` call inside `wireRefineInChatLink`) + 3 wire calls at the bottom of the block. Test passes. |
| Click handler dispatches to the matching per-model body builder based on visible result panel | ✅ | `isPanelVisible(dom.resultSection)` / `dom.animaResultSection` / `dom.krea2ResultSection` at src/app.js:2856-2858. Test passes. |
| Routes to `activateChatForResult` / `activateAnimaChatForResult` / `activateKrea2ChatForResult` | ✅ | `refineInChatActivators` map at src/app.js:2811-2815. Test passes. |
| Click handler awaits activation before navigating | ✅ | `const session = await activator(buildBody())` at src/app.js:2874. Test passes. |
| Success path sets `location.hash = '#/chat'` (idempotent) | ✅ | src/app.js:2879. Test passes. |
| Success path calls `e.preventDefault()` so the bare-anchor fallback doesn't double-navigate | ✅ | src/app.js:2895 (`if (succeeded) { e.preventDefault(); }` in the `finally` block). Test passes. |
| Failure path calls `showError(msg, { severity: 'warning' })` (no silent `console.warn`) | ✅ | src/app.js:2891 (the body-builder-throws catch) + src/app.js:2867-2868 (the misconfiguration defensive toast). Test passes. |
| Failure path does NOT call `preventDefault()` so the bare-anchor fallback navigates to `#/chat` | ✅ | src/app.js:2894-2897 (the `finally` only fires `preventDefault` on `succeeded === true`). Test passes (verified by the absence of a `preventDefault` in the `else` branch + the comment). |
| No server change (Krea-2 model allowlist fix is parked) | ✅ | Only `src/app.js` + `tests/run-all.js` modified. No `server.js` change. |
| No HTML structural change | ✅ | `src/index.html` unchanged. |
| No new toast-style primitives | ✅ | Uses the existing `showError` helper (severity: 'warning') — same one `runChatActivationSession` uses for the chat-limit warning. |
| 4 new tests (736 → 740) | ✅ | tests/run-all.js tail block, 4 new tests. Total: 740 / 0 green. |

### Spec findings

- **None blocking.**
- **None minor.** All 14 spec requirements met; all 4
  test targets locked; 2-axis invariants preserved.

---

## 4. Test review

4 new tests, all use the existing K.6 / K.7 / K.9 test pattern (`fs.readFileSync` + regex on the relevant block, bounded by markers). The tests assert literal source patterns that were independently derived from the SPEC §30.6.7 spec. They would catch a future regression that:

- Removes any of the 3 `refine*InChatLink` dom lookups
- Changes any of the 3 HTML `href="#/chat"` attributes (regression: would break keyboard nav + right-click)
- Removes the `linkEl.addEventListener('click', …)` wiring
- Changes which model a visible panel dispatches to
- Removes the `await` on the body builder (regression: race between POST and route change)
- Removes the `e.preventDefault()` on the success path (regression: bare-anchor double-navigates)
- Removes the `showError(…, { severity: 'warning' })` toast (regression: silent failure returns)
- Re-introduces a `console.warn` in the K.14 wiring block (regression: silent-failure contract violated)

**No tautological tests. No implementation-coupled tests.** The 4th test specifically strips JS comments before searching for `console.warn` so the K.14 spec comment that mentions `console.warn` by name doesn't false-positive the check. The window is bounded by the wiring-block marker AND the model-selector end divider so pre-existing `console.warn` calls in unrelated code (palette, directives, chat helpers) don't false-positive either.

---

## 5. Risk review

| Risk | Mitigation | Present? |
|------|-----------|----------|
| **R-23 (LOW):** Click handler dispatches to the wrong per-model body builder | Visibility snapshot is taken BEFORE the `await` — the body builder un-hides `#step-chat` via `runChatActivationSession`, so a post-await read could see the panel as visible even when the click came from a different model. The handler reads `hidden` flags first, then falls back to the link's own model if no panel is visible (rare race window). | ✅ src/app.js:2855-2861 (snapshot pattern). |
| **R-24 (LOW):** `e.preventDefault()` race with bare-anchor hash change | `preventDefault()` is called in a `finally` block based on the `succeeded` flag. On success, no bare-anchor fallback fires. On failure, no `preventDefault()` fires, so the URL bar updates and K.9's helper can run. | ✅ src/app.js:2893-2897. |
| **R-25 (MEDIUM):** Krea-2 path still 400s on the server's model allowlist | K.14 surfaces the 400 as a toast via `showError(…, { severity: 'warning' })` — strictly better than the silent black screen. The server allowlist fix is parked as a separate BACKLOG entry. The user sees "Chat console unavailable: model must be one of: zimage_turbo, anima" with actionable feedback. | ✅ src/app.js:2891. Server fix parked in `docs/BACKLOG.md`. |
| **R-26 (LOW):** Visible-panel dispatch races a fast click after a hide animation | No fade animation in current code. If a future slice adds one, the link-model fallback at src/app.js:2863 handles the race. | ✅ src/app.js:2863. |

### Risk findings

- **None blocking.** All 4 risks are LOW or
  MEDIUM-with-mitigation, all 4 mitigations present.

---

## 6. Cross-references

- SPEC §30.6.7 (K.14 sub-slice spec) — `docs/SPEC.md`
- ARCH §30 A15 (K.14 wiring architecture) — `docs/ARCHITECTURE.md`
- PRE-MORTEM §30.6.7 (K.14 pre-mortem) — `docs/PRE-MORTEM.md`
- H8 parked entry — `docs/BACKLOG.md` (closed in this commit)
- P-19 / P-20 / P-21 (K.14 pre-commitments) — `docs/PRE-MORTEM.md`
- K-16 / K-17 / K-18 (K.14 kill criteria) — `docs/PRE-MORTEM.md`
- K.7 active-session post-success block — `src/app.js:2651-2668`
- K.9 empty-state helper — `src/app.js` `showEmptyChatState` (K.9)
- Per-model body builders — `activateChatForResult` / `activateAnimaChatForResult` / `activateKrea2ChatForResult` (K.7 / Slice 2.4 / Slice K.4)
- `runChatActivationSession` — `src/app.js:2659` (K.11 lift)
- K.6 / K.7 / K.8 / K.9 wiring pattern — `src/app.js:2720-2798` (per-panel regenerate/copy)
- `showError` helper — `src/app.js:331`
- Server `validateChatSessionCreate` (model allowlist bug parked) — `server.js:7972-8043`

---

## Verdict

**pass.** Small, isolated, additive UI wiring fix;
740/0 green; no blockers, no minor findings. After
K.14, the "Refine in chat →" links actually do what
the link text promises: take the user to a chat view
with a fresh session anchored to the just-generated
prompt and the chat input focused. If the server
rejects the body, the user sees a clear toast instead
of a silent black screen.
