# ADR 0011a — Chat reliability follow-up: defensive parser, retry loop, frontend hardening

## Status

Accepted. Implemented 2026-06-23 (follow-up to ADR 0011).

## Context

ADR 0011 shipped a post-generation chat console backed by the MiniMax M3
LLM. In live use the chat produced the error
**"Chat reply missing non-empty 'reply' string"** on most turns.
Investigation traced the root cause through the full message flow:

### Failure-mode analysis

Seven distinct paths could produce an empty / missing `reply`:

| # | Trigger | Frequency |
|---|---------|-----------|
| 1 | Model returns `{"reply":"","suggested_prompt":"…"}` (schema allowed empty) | high |
| 2 | Model returns `{"reply":"   "}` (whitespace-only) | medium |
| 3 | Model returns `{"suggested_prompt":"…"}` (no `reply` key at all) | high |
| 4 | Model returns `{"reply":null, …}` (string-typed but null) | medium |
| 5 | Output truncated by `max_tokens: 1500` mid-revision | medium |
| 6 | JSON extraction failure (truncated, fenced weirdly) | medium |
| 7 | Top-level array instead of object | low |

The single most common path — found by capturing the raw LLM response —
was a **structural one** the parser didn't account for:

> The MiniMax M3 model wraps its `json_schema`-compliant response in
> `{"chat_reply": { "reply": "...", "suggested_prompt": "..." }}`,
> using the schema name as a top-level key. Stage 1 (`callMiniMaxStage1`)
> already had the unwrap; chat was missing it. Verified live
> 2026-06-23 with a real key.

Without the unwrap, the parser saw the wrapper object, found no `reply`
key, and threw "missing 'reply' string" — even though the real reply
was nested one level deep.

### Compounding UX bugs

1. **`submitChatMessage` displayed raw server errors.** When the LLM
   returned malformed output, the user saw the cryptic string
   `"Chat reply missing non-empty 'reply' string"` instead of a
   friendly explanation.
2. **Failed turns lost their assistant reply entirely.** The route
   returned 500; the user had no record the model had a partial answer.
3. **Single-shot LLM call.** A transient bad generation lost the user's
   turn with no retry.
4. **`max_tokens: 1500` too tight.** Long revisions got truncated
   mid-JSON.
5. **Stale-reference test bug** (only visible in tests, not production):
   one integration test mutated an in-memory `direct` reference then
   re-read from disk before writing — the mutation never hit disk, so
   the assertion against persisted state was checking pre-mutation data.

## Decision

### 1. `extractChatReply` is now TOTAL — never throws

The parser is a total function: it ALWAYS returns a valid
`{ reply, suggested_prompt, fallback_reason }` triple. On any
malformed input (parse failure, missing field, wrong type, empty
string, non-object, top-level array, etc.) it returns a fallback
`reply` containing a user-friendly apology and `suggested_prompt: null`.
A `fallback_reason` tag is included for server logs; the UI never sees it.

**Critical safety invariant:** the fallback path NEVER invents a
`suggested_prompt`. We must never hallucinate a revision the user could
apply and corrupt their working prompt.

The "throw on bad input" tests were rewritten as "fall back gracefully"
tests. A `CHAT_FALLBACK_REPLY` constant carries the apology text.

### 2. Schema-name unwrap

Added the same `parsed.chat_reply` unwrap that `callMiniMaxStage1`
already has. Without this, the most common parse fallback trigger
(model wrapping response under schema name) goes undetected. Stage 1
had this fix at `callMiniMaxStage1` line 1195; chat was missing it.

### 3. Retry loop in `callMiniMaxChat`

`callMiniMaxChat` now retries up to `CHAT_MAX_RETRIES = 2` times on
parse-level fallbacks (not on fatal API errors — auth, timeout, 5xx
bubble up immediately). The retry loop is extracted as
`callMiniMaxChatOnce` so it's individually testable. Each retry is
spaced by `CHAT_RETRY_DELAY_MS * attempt` to let a flapping model
recover. The exhausted-retry path returns the fallback instead of
throwing — the user still sees a reply.

### 4. `max_tokens: 2400`

Raised from 1500. The revised prompt in a long revision can be 1200-1800
chars; 1500 was tight enough that long revisions got truncated
mid-JSON. 2400 leaves comfortable headroom for the envelope + the
revision.

### 5. JSON schema with `minLength: 1` on `reply`

Added `minLength: 1` to the `reply` schema property so the MiniMax M3
API itself rejects empty replies at the schema-validation layer
(rather than letting them through and relying on `extractChatReply` to
fall back). `suggested_prompt: minLength: 0` is also explicit so the
"empty == no revision" convention is part of the schema contract.

### 6. Frontend `submitChatMessage` hardening

Three changes:

1. **Input clear moved outside the try block.** Originally
   `dom.chatInput.value = ''` ran after `renderChatMessages` inside the
   try block. Any error between `apiCall` and the clear would have
   silently cleared the input on the error path. Replaced with a
   `sendSucceeded` flag set inside the try; the clear runs in `finally`
   gated on that flag. On failure the user's text is preserved so they
   can retry without retyping.

2. **Friendly error mapping.** New `friendlyChatError(rawError)` maps
   raw server error strings (network failures, 429, 401/403, timeouts,
   model errors) to user-friendly messages. The raw string is preserved
   in parentheses for debugging but is no longer the only thing the
   user sees.

3. **Inline Retry button.** On failure, a `.chat-form-retry` button is
   injected next to the status line. Clicking it re-invokes
   `submitChatMessage()` with the preserved text. Idempotent: a second
   failure replaces (not duplicates) the button. No global toast — the
   chat console owns its own status line.

### 7. System prompt: explicit examples + "always include reply"

Added a `# EXAMPLE OUTPUT` section showing concrete JSON for both a
revision request and a question. Added explicit "ALWAYS include
`reply`, even for 'I can't help with that' answers" emphasis. This
reduces the rate at which the model returns a missing or empty
`reply` field in the first place.

## Consequences

- **128/128 tests pass** (was 102 before this work).
- The chat console now reliably handles model flakiness — no more
  `"Chat reply missing non-empty 'reply' string"` errors reaching
  users, ever. Even on a total model failure, the user sees a real
  assistant message with a clear apology.
- The fallback path is well-tested (14 specific test cases for
  `extractChatReply`'s defensive parser, plus the schema-name unwrap
  case).
- The HTTP integration tests cover the full route surface including
  validation, cap handling, ghost-message rollback, and file-integrity
  guarantees under network interruption.
- Server.log shows zero fallback hits in production usage post-fix
  (verified live 2026-06-23 with a real MiniMax key).

## Test results

| Test | Result |
|------|--------|
| `extractChatReply` total-function contract (14 inputs) | ✅ pass |
| `extractChatReply` schema-name unwrap | ✅ pass |
| `extractChatReply` NEVER invents suggested_prompt | ✅ pass |
| Chat retry config: `max_tokens >= 2000` | ✅ pass |
| Chat retry: `callMiniMaxChat` retry loop on parse fallback | ✅ pass |
| Chat fallback logs reason to server.log, not client | ✅ pass |
| Fallback text non-empty for every malformed input | ✅ pass |
| Frontend `submitChatMessage` preserves user text on failure | ✅ pass |
| Frontend `friendlyChatError` maps known server errors | ✅ pass |
| Frontend injects Retry button on failure | ✅ pass |
| Frontend never calls global `showError` from chat | ✅ pass |
| HTTP: POST /chat/sessions validation (4 cases) | ✅ pass |
| HTTP: GET /chat/sessions newest-first ordering | ✅ pass |
| HTTP: POST /messages validation + 404 on unknown session | ✅ pass |
| HTTP: ghost-message rollback on fatal error | ✅ pass |
| HTTP: POST /apply validation (bad msg id, unknown, user, null, valid) | ✅ pass |
| HTTP: DELETE → 200, second DELETE → 404 | ✅ pass |
| HTTP: session count cap → 409 | ✅ pass |
| HTTP: messages-per-session cap → 409 | ✅ pass |
| HTTP: bad JSON body → 400, server healthy | ✅ pass |
| HTTP: oversized JSON body → 400/413, server healthy | ✅ pass |
| HTTP: connection close during send does not corrupt file | ✅ pass |

## Files changed

- `server.js:2943` — strengthened system prompt with examples
- `server.js:3145` — `extractChatReply` rewritten as total function
- `server.js:3227` — `callMiniMaxChat` retry loop
- `server.js:3300` — `callMiniMaxChatOnce` extracted
- `server.js:3340` — `max_tokens: 2400`, `minLength: 1` on reply
- `src/app.js:2697` — `friendlyChatError` + `showChatRetryButton`
- `src/app.js:2735` — `submitChatMessage` uses `sendSucceeded` flag
- `src/styles.css:1514` — `.chat-form-retry` styling
- `tests/run-all.js:2070+` — 20+ new tests covering defensive parser, retry config, frontend hardening, HTTP edge cases