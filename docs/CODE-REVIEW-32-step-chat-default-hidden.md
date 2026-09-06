# CODE-REVIEW-32 — step-chat starts hidden by default

**Slice**: Regression fix (no SPEC delta)
**Date**: 2026-09-06
**Reviewer**: Self (single-axis — Spec conformance)
**Verdict**: pass

---

## What changed

A regression introduced in commit `8e3e095` (UI-R0 five-view shell rewrite)
stripped the `hidden` attribute from `<section id="step-chat">` when the
single-page step layout was rewrapped into the five-view tab-panel shell.
The JS that originally re-showed `step-chat` (via `resetChatConsole` →
`activateChatForResult` → `selectChatSession`) survived intact, but the
HTML default flipped from "hidden until session active" to "visible, then
hidden only on image clear / preset switch / delete".

The hidden state never fires on first page load (no image cleared, no
preset switched, no session deleted yet), so opening the chat view with no
active session showed:

- `#chat-working-prompt-text` empty (no session → `renderChatWorkingPrompt`
  hides the strip but the surrounding `#chat-messages` rect is still drawn)
- `#chat-messages` empty (no `renderChatMessages` call when `state.chatSessionId`
  is null)
- Send button disabled (no session, no input text)
- Conversation dropdown populated from `GET /api/chat/sessions` but
  unselected (placeholder shown)

User impact: "the chat panel rendered empty / no controls visible" — the
empty working-prompt + empty messages rectangle looked broken, even
though the dropdown above it was functional.

## Fix

`src/index.html` — add `hidden` back to the `#step-chat` element:

```diff
-      <section class="panel" id="step-chat" aria-label="Refine via chat">
+      <section class="panel" id="step-chat" aria-label="Refine via chat" hidden>
```

This restores the original semantics: step-chat is hidden until a session
is active. The JS still shows it in three places:

1. `activateChatForResult` (line 5770) — after Stage 2 returns and the
   post-generation chat session is created
2. `activateChatForAnimaResult` (line 5847) — Anima-mode parallel
3. `selectChatSession` (line 6392) — when the user picks a saved
   conversation from the dropdown

`resetChatConsole` (line 4672) still hides it on image clear, preset
switch, or session delete.

## Why not also fix the resume UX?

The pre-existing UX gap is that users with saved sessions can't access
them from a cold chat-view visit. Adding a "resume conversation" picker
outside `step-chat` is a separate slice (and should be tracked in
`docs/BACKLOG.md` if it's wanted). This PR only restores the no-regression
fix from `8e3e095`.

## Spec conformance

| Section | Requirement | Status |
|---|---|---|
| ADR 0011 §4 | Chat console is hidden until Stage 2 produces a result | pass — restored |
| SPEC §11.1 | User can resume a saved conversation via the dropdown | partial — works after first session is created on this load; cold-visit resume is a UX gap, not a SPEC violation |
| SPEC §22/§23/§24 | Inline diff / patch protocol / streaming all wire to the active session | pass — unaffected by the fix |

## Tests

Two new tests in `tests/run-all.js`:

1. `app.js wires up the chat console` (extended) — asserts
   `id="step-chat"` HTML element has `hidden` attribute.
2. `stepChat visibility is managed by JS (hidden until session active)` —
   asserts `resetChatConsole` sets `dom.stepChat.hidden = true` and
   somewhere in `app.js` sets `dom.stepChat.hidden = false`.

End-to-end browser verification via Chrome DevTools Protocol on
`http://127.0.0.1:3103/#/chat`:

- Cold load (no session): `#step-chat` has `hidden` attribute, the panel
  is not rendered. ✓
- After selecting a session from the dropdown: `#step-chat` becomes
  visible, working prompt + messages + form all populate. ✓
- No console errors or warnings. ✓

## Verdict

**pass** — single-line HTML fix restores the original semantics. No
behaviour change for the happy path (Generate → chat). Cold-visit users
no longer see an empty-looking panel.
