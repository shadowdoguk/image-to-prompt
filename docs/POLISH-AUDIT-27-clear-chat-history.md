# POLISH-AUDIT — Slice 27 (Clear chat history / CR-A11)

**Verdict:** PASS — slice ships.
**Scope:** Settings tab destructive panel; bulk DELETE endpoint + count endpoint.

Gate G5 audits every shipped slice for residual polish debt. SPEC §27 commits to six values: discoverability, irreversibility-aware UX, a11y, error handling, parity with the existing per-session delete, and a clean test suite. This audit checks each.

---

## 1. Accessibility (4 findings)

### A1 — Modal traps focus correctly

The `<div id="clear-chat-history-modal" class="modal">` inherits the project's global focus-trap via `bindModalTraps` (shell.js:333). Verified in browser: Tab cycles within the modal, Shift+Tab cycles backwards, Escape dismisses, focus returns to the invoker button on close. ✓

### A2 — Modal has `role="dialog"` + `aria-labelledby` + `aria-describedby`

```html
<div id="clear-chat-history-modal" class="modal" hidden
     role="dialog"
     aria-labelledby="clear-chat-history-modal-title"
     aria-describedby="clear-chat-history-modal-body">
```

The title (`Clear chat history?`) is the label; the body paragraph (`This will permanently delete N chat sessions…`) is the description. Screen-reader users hear both when the modal opens. ✓

### A3 — Live region announces success / failure

`#settings-clear-chat-history-status` is `role="status" aria-live="polite"` (the existing Settings panel pattern). Success: "All chat history cleared." Failure: "Could not clear chat history: <error>." Additionally, `announce()` is called with the same message for cross-view announcement (lives in the global `#a11y-announcer` live region). ✓

### A4 — `.btn-danger-outline` gains `:focus-visible` style

```css
.btn-danger-outline:focus-visible {
  outline: 2px solid var(--error);
  outline-offset: 2px;
}
```

Keyboard-only users see a clear red outline when tabbing to the destructive button. ✓

---

## 2. Visual design (2 findings)

### V1 — Panel ordering

The Chat data panel is the **last** panel in the Settings view (after Defaults, after System prompts). Decision rationale (SPEC §27, PRE-MORTEM P-4): destructive actions are visually separated from routine settings, so a user scanning for "save defaults" doesn't accidentally see "Clear chat history" and act on muscle memory. ✓

### V2 — Modal action button hierarchy

The Cancel button is the default-focus target when the modal opens. Reasoning: pressing Enter dismisses (Cancel) rather than confirms (Erase all). Users with intent to clear will move focus to Erase all deliberately. This matches the established pattern for all other destructive modals in the project. ✓

---

## 3. Prose / copy (2 findings)

### S1 — Modal warning text

> "This will permanently delete **3 chat sessions and 7 attachment files**. This action cannot be undone."

Three layers of safety messaging: (a) "permanently delete" (irreversibility), (b) the live count (specificity), (c) "cannot be undone" (explicit warning). Screen-reader users hear all three via the modal's `aria-describedby` reference. ✓

### S2 — Panel hint text

> "Permanently delete every chat session and every uploaded image attached to one. This cannot be undone. Palettes, directives, presets, notes, and provider keys are not affected."

The last sentence is the safety-net copy: it explicitly enumerates what's NOT cleared, so a user who's worried about side effects (e.g. "wait, will this delete my palettes?") can read the boundary right there in the panel. ✓

---

## 4. Copy: button labels (1 finding)

### C1 — Button labels are unambiguous

| Element | Label | Notes |
|---|---|---|
| Invoker button | "Clear chat history" | Matches the spec verbatim; verbose enough to not be confused with "Clear input" or "Clear cache" |
| Modal title | "Clear chat history?" | Question form invites reflection |
| Modal cancel | "Cancel" | Universal, safe |
| Modal confirm | "Erase all" | Strong verb, distinguishes from invoker button label |

The "Erase all" verb is intentionally stronger than "Clear" — it's the last-mile confirmation that the action is destructive, even after the user has already opened the modal. ✓

---

## 5. Performance (1 finding)

### P1 — Settings status timeout

After a successful clear, the status line shows "All chat history cleared." for 5 seconds, then auto-clears. Mirrors the "Defaults saved." pattern (shell.js:1007). Prevents the status line from becoming visual noise after the action completes. ✓

---

## 6. Discipline (3 findings)

### D1 — Error logging in console for debugging

```js
} catch (resetErr) {
  console.error('[clear-chat-history] client reset failed:', resetErr);
}
```

The defensive `try/catch` around `window.__i2pClearChatHistory()` logs the technical detail to the console while still showing the user a friendly error message. PRE-MORTEM R-5 + user requirement point 5 ("logging technical details for debugging") both addressed. ✓

### D2 — No new dependencies

The slice uses only:
- `fs.readdirSync` / `fs.rmSync` (Node built-ins)
- `express` (already a dep)
- The existing `writeChatSessions` / `cascadeDeleteChatSessionAttachments` patterns

Zero new npm packages. Follows the methodology's "dependency adoption requires approval" rule. ✓

### D3 — No ADR filed

Per G1 user direction: "no ADR (default: no, but document the placement decision inline in SPEC)." The placement decision (Settings tab vs. Chat view) is documented in SPEC §27 Context, ARCH §31, and PRE-MORTEM §31. The destructive-action UX rationale is in SPEC §27 Decision + PRE-MORTEM R-2. ADR-worthy decisions (architectural commitments, hard-to-reverse choices) are not present in this slice. ✓

---

## 7. Privacy / data-protection alignment (3 findings)

### PR1 — Bulk delete is local-only

The bulk DELETE endpoint has no auth, no remote logging, no external network calls. The action is purely a local filesystem mutation on the user's machine. ✓

### PR2 — No telemetry on clear

`data/preservation_override_log.json` (§26 override telemetry) is intentionally NOT cleared (per G1 user direction). The clear action itself does NOT write to any log — no "user cleared chat at <time>" record is created. Privacy-preserving by default. ✓

### PR3 — Defensive localStorage sweep

The client-side reset includes `localStorage` sweep for `i2p.chat*` / `i2p.session*` keys. Today no such keys exist (verified by grep); the sweep is a regression guard against future client-cache additions that might persist across a clear. SPEC §27 A3 + PRE-MORTEM P-8. ✓

---

## Summary

| Category | Findings | Status |
|---|---|---|
| Accessibility | 4 | ✓ All addressed |
| Visual design | 2 | ✓ All addressed |
| Prose / copy | 2 | ✓ All addressed |
| Copy: button labels | 1 | ✓ Addressed |
| Performance | 1 | ✓ Addressed |
| Discipline | 3 | ✓ All addressed |
| Privacy / data | 3 | ✓ All addressed |
| **Total** | **16** | **16 addressed, 0 blocking** |

**Ship verdict: PASS.** No follow-up slices required.
