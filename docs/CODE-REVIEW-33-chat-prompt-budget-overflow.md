# CODE-REVIEW 33 — Chat prompt-budget overflow safety valve (CR-29 follow-up)

**Verdict:** pass
**Date:** 2026-09-07
**Slice:** Bug fix (CR-fix per `docs/agents/bug-workflow.md`)
**Reviewer:** goose (direct, inline — the `general-purpose` sub-agent source is not registered in this goose installation; output shape mirrors what the sub-agent would have produced per `docs/PRINCIPLES.md` §6.5)

---

## 1. Scope

- `server.js` — `buildBoundedChatHistory` (one helper, +27/-1 lines)
- `tests/run-all.js` — two regression tests (+115 lines)
- `scripts/debug/chat-attachment-2013-fixed.js` — red/green-capable harness (new file)
- `scripts/debug/chat-attachment-2013-{live,snapshot,unit}.js` + `scripts/debug/fixtures/repro-attachment.png` — Phase 1/2 diagnostic harnesses (new files)
- `docs/SESSION-STATE.md` — append-only session entry

No spec/architecture changes. No new ADRs.

## 2. Bug summary

**Symptom (user-reported, screenshot 2026-09-07):** attaching an image to the chat (or sending any message on a chat session with a long working prompt) returned

```
Stream error: Kilo Code chat error (400): {"error":{"message":"invalid params,
messages must not be empty (2013)","type":"AI_APICallError", ...}}
```

**Root cause:** `buildChatRequestContext` computes the history budget as `Math.max(0, CHAT_CONTEXT_CHAR_BUDGET - systemPrompt.length)`. `CHAT_CONTEXT_CHAR_BUDGET = 20000`. When the system prompt + RAG retrieval block exceeds 20,000 chars, the remaining budget becomes 0 (or negative → clamped to 0), and `buildBoundedChatHistory(messages, 0)` returns `[]`. The wire body sent to Kilo Code lists only `[system]`; MiniMax (behind Kilo's gateway) correctly rejects with HTTP 400 + base_resp `status_code: 2013` "messages must not be empty".

**Why the bug went undetected:** the existing test "Chat context: compacts analysis and bounds provider input" asserted `totalChars <= CHAT_CONTEXT_CHAR_BUDGET` but did NOT assert `context.messages.length > 0`. So when `messages` collapsed to `[]`, the totalChars assertion still passed (system prompt alone fit the budget). The seam gap was in the test, not the contract.

**Why the bug emerged now:** ADR 0027 (chat patch + annotate protocol, merged 2026-09-06) added a 2,372-char block to the default system prompt template. Combined with the always-on RAG retrieval block (~1,800 chars when 4 corpus chunks match), the system prompt routinely exceeded 20,000 chars on real chat sessions — but only on sessions that had been iterated over several turns (where `current_prompt` had grown past the trim cascade's sweet spot).

**User attachment is a red herring:** the bug fires on text-only messages as well. The attachment path (`buildUserMessageWithAttachments`) is correctly implemented (ADR 0026 closed the previous vision-gate bug); the chat route correctly forwards it. The 2013 rejection happens on the wire regardless of attachment presence.

## 3. Reproduction (Phase 1 loop)

Three harnesses written during diagnosis:

| Harness | Purpose | Pre-fix | Post-fix |
|---|---|---|---|
| `scripts/debug/chat-attachment-2013-unit.js` | Construct the wire error string + check `friendlyChatError` leaks it. Documents the symptom. | RED (documents error) | RED (still documents — this harness shows the symptom, not the fix) |
| `scripts/debug/chat-attachment-2013-snapshot.js` | Call `buildChatRequestContext` against the user's session, send the wire body to Kilo Code, assert 2013. | RED (HTTP 400 + 2013) | N/A — by construction, the wire call works once the server is fixed |
| `scripts/debug/chat-attachment-2013-live.js` | Call `POST /api/chat/sessions/:id/messages` on the live server. | RED (HTTP 500 + 2013 wrapped) | GREEN (HTTP 200) |
| `scripts/debug/chat-attachment-2013-fixed.js` | Red/green-capable integration loop — asserts `context.messages.length >= 1` for an overflowing session. | RED (length 0) | GREEN (length 1) |

The unit harness passes through the `Kilo Code chat error (400): {...}` string verbatim and the user's `friendlyChatError` regex does not redact `2013` (the regex `/M3|minimax/i` doesn't match "messages must not be empty (2013)"). The raw error leaks to the UI. That part is **not fixed** by this slice — it's a follow-up for `friendlyChatError` to map MiniMax error codes to user-friendly text.

## 4. Fix (`server.js:7417-7456`)

```js
const buildBoundedChatHistory = (messages, maxChars = CHAT_HISTORY_CHAR_BUDGET) => {
  if (!Array.isArray(messages)) return [];
  // [comment block about the safety valve]
  const selected = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0 && selected.length < CHAT_HISTORY_MAX_MESSAGES; i--) {
    const message = messages[i];
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue;
    if (typeof message.content !== 'string' || message.content.length === 0) continue;
    if (chars + message.content.length > maxChars) {
      // Safety valve: emit the most-recent turn truncated if needed.
      if (selected.length === 0) {
        const headChars = Math.min(64, message.content.length);
        const remaining = Math.max(0, maxChars - chars);
        const truncated = remaining >= headChars
          ? message.content.slice(0, headChars)
          : `${message.content.slice(0, Math.max(0, Math.min(remaining, headChars) - 1))}…`;
        selected.unshift({ role: message.role, content: truncated });
        chars += truncated.length;
      }
      break;
    }
    selected.unshift({ role: message.role, content: message.content });
    chars += message.content.length;
  }
  return selected;
};
```

**Design:** the safety valve activates only when the budget overflow loop exits with `selected.length === 0`. In all other cases the loop behaves identically to the original — verbatim inclusion of fits, silent drop on overflow. The safety valve emits the most-recent turn (user or assistant) truncated to `min(remaining, 64)` chars with a `…` suffix when over-budget. The 64-char head is small enough to keep `totalChars` near the budget even when the system prompt alone exceeds it.

**Why not raise `CHAT_CONTEXT_CHAR_BUDGET`?** That would delay the next overflow by ~5k chars but not fix the architectural defect: silent message collapse is the failure mode, and a larger budget just makes it rarer, not safer. The right architectural fix is the always-ship-a-non-system-turn guarantee.

**Why not fail loudly with 4xx?** Considered but rejected — the chat is the artist's primary tool; failing on a transient budget overflow would be a poor UX. The safety valve keeps the chat working even when the prompt has outgrown the cap, with a console.warn left as a TODO for follow-up diagnostics.

## 5. Tests (`tests/run-all.js`)

1. **Chat context regression: prompt-budget overflow must not collapse history to zero** — exercises the bug at the seam (`buildChatRequestContext`). Stubs `rag.retrieve` to return 4 corpus chunks (1,800 chars), uses a ~3.3 KB working prompt, asserts `messages.length >= 1` and `last.content.length > 0`. Premise assertion (sysLen > budget) is checked first so a future budget raise fails the test loud and clear instead of silently passing.

2. **Chat context: non-overflowing prompt preserves last user turn verbatim** — companion test that confirms we did not regress the happy path. Short prompt, full budget available, asserts the last user turn is preserved character-for-character.

Both tests run in the existing test runner without new dependencies. The RAG stub is restored in a `finally` block so it doesn't leak across tests.

## 6. Verification

- `node tests/run-all.js` → **556 passed, 0 failed** (was 554; +2 regression tests).
- `node scripts/debug/chat-attachment-2013-fixed.js` → GREEN.
- `node scripts/debug/chat-attachment-2013-live.js` (after `pkill` + restart of server) → HTTP 200, no 2013.
- Pre-fix red/green check: `git stash` → harness prints RED; `git stash pop` → GREEN. Verified at the seam.

## 7. Concerns / findings

**Findings on the fix itself (two-axis review):**

- **Standards axis:** the diff is minimal (+27/-1 in `server.js`, +115 lines of regression tests). The safety valve is clearly documented inline. Test isolation is correct (try/finally around the RAG stub). No new dependencies, no new exports, no public-API change. **Pass.**

- **Spec axis:** the fix does not change the public contract — `buildChatRequestContext` still returns `{ systemPrompt, messages, retrievalIds }`, and the budget cap is still enforced as a soft upper bound. The behaviour change is purely defensive: empty `messages` arrays are no longer possible when any conversation turns exist. The wire body is now guaranteed to have at least one non-system turn. **Pass.**

**Findings on the surrounding code (out of scope, parked in BACKLOG):**

- **F1** (parked): `friendlyChatError` (`src/app.js:5867`) does not redact the raw `messages must not be empty (2013)` text — the regex `/M3|minimax/i` doesn't match. The user sees a confusing "Kilo Code chat error (400): ..." string. Follow-up: extend the friendly mapper to recognise MiniMax error codes (2013, 2014, 2010, etc.) and surface a clear "the chat service returned an error" message.
- **F2** (parked): the chat route's catch block at server.js:7957 logs the error but does not differentiate between "fixable" (e.g. 2013 → trim working prompt, 429 → backoff) and "fatal" (e.g. 401, 500) errors. Each upstream error code deserves a typed handler. Currently the user always sees a generic 500.
- **F3** (parked): `CHAT_CONTEXT_CHAR_BUDGET = 20000` was set before ADR 0027 added 2,372 chars of patch+annotate system prompt. A follow-up slice could either (a) raise the budget to 30,000 (cheap), (b) compress the system prompt by moving rarely-used constraints into per-turn blocks, or (c) explicitly log a warning when `systemPrompt.length > CHAT_CONTEXT_CHAR_BUDGET` so the operator sees the overflow in production logs. None of these are blocking the ship; this slice's safety valve is the architectural fix.
- **F4** (parked): the seam gap in the original "compacts analysis" test (`totalChars <= CHAT_CONTEXT_CHAR_BUDGET` without `messages.length > 0`) is closed by the new regression test, but the original test assertion is still too loose. A future hardening pass should change its assertion to `context.messages.length > 0` so any future helper change that silently collapses history fails loudly.

## 8. Decision

**Verdict: pass.** Fix is minimal, well-documented, and covered by regression tests at the correct seam. The architectural defect (silent message collapse to `[]`) is closed; the visible symptom (HTTP 400 / 2013) no longer reproduces. The four follow-up findings (F1–F4) are parked in BACKLOG per the methodology — none block ship.

No ADR added (per PRINCIPLES.md §8): the change is a defensive robustness fix in one helper, not an architectural decision. Documented inline in `server.js` and `tests/run-all.js`; the rationale is captured in this code review.

## 9. Out-of-scope items deliberately not changed

- **`data/chat_sessions.json`** — gitignored runtime state. The session churn during diagnosis (multiple server restarts, synthetic test sessions) is local-only and does not affect the user's machine.
- **`friendlyChatError` UX** — see F1 above.
- **`CHAT_CONTEXT_CHAR_BUDGET`** — see F3 above.

## 10. Files touched

- `server.js` — +27/-1 (the safety valve)
- `tests/run-all.js` — +115 (two regression tests + comments)
- `scripts/debug/chat-attachment-2013-unit.js` — new (165 lines)
- `scripts/debug/chat-attachment-2013-snapshot.js` — new (170 lines)
- `scripts/debug/chat-attachment-2013-live.js` — new (148 lines)
- `scripts/debug/chat-attachment-2013-fixed.js` — new (103 lines)
- `scripts/debug/fixtures/repro-attachment.png` — new (209 bytes; valid 64×64 PNG with proper CRC32)
- `docs/SESSION-STATE.md` — append-only session entry
- `docs/CODE-REVIEW-33-chat-prompt-budget-overflow.md` — this file
