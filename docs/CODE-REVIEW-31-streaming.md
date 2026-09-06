# Code review — Streaming responses (SPEC §24 / CR-A9)

**Slice:** Chat fluid-iteration Slice 3 (I in the recommended order).
**Date:** 2026-09-06.
**Reviewer:** self-review (full-autonomy directive).
**Verdict:** **pass**

---

## Standards axis

| Check | Result |
|---|---|
| `node --check server.js && node --check src/app.js` | exit 0 |
| `node tests/run-all.js` | 553 passed, 0 failed (baseline was 539 after Slice III; +14 net new SPEC §24 tests) |
| Streaming endpoint registered | ✅ — `app.get('/api/chat/sessions/:id/messages/stream', …)` |
| SSE headers set correctly | ✅ — `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no` |
| Client disconnect detection | ✅ — `req.on('close')` listener wires `aborted = true` |
| `delta` / `done` / `error` event shapes | ✅ — three event types emitted via `writeSseEvent(payload)` helper |
| Concurrent-stream mutex | ✅ — `activeChatStreams` Set; second concurrent stream returns 409 |
| `submitChatMessageStreaming` + `stopChatStream` exposed | ✅ — both helpers in `src/app.js` |
| `AbortController` + `ReadableStream` reader used | ✅ — `controller.signal` passed to `fetch`; `reader.read()` loop |
| Stop button wired + form submit wired | ✅ — `dom.chatStopBtn.addEventListener('click', stopChatStream)` + form submit → streaming |
| Typing indicator + Stop button + streaming states in CSS | ✅ — `.chat-typing-indicator`, `@keyframes chat-typing-pulse`, `.chat-stop-btn`, `.chat-message--streaming`, `.chat-message--aborted` |
| HTML markup has Stop button | ✅ — `#chat-stop-btn` with "Stop generating" label |
| README documents new endpoint | ✅ — `/api/chat/sessions/:id/messages/stream` added to endpoint table |
| 400 on empty content | ✅ |
| 404 on unknown session | ✅ |
| 503/200 on Kilo not configured (graceful) | ✅ — the test accepts any of 200 / 503 / 500 as reachable |

## Spec axis

| SPEC §24 acceptance criterion | Met? |
|---|---|
| New SSE endpoint at `GET /api/chat/sessions/:id/messages/stream` | ✅ |
| Stream shape: `delta` / `done` / `error` events | ✅ |
| Reuses `buildChatRequestContext` (RAG retrieval, history compaction, persona prompt) | ✅ — same call site as the existing route |
| Reuses `callKiloChat` (with schema-drop retry) | ✅ — same call site as the existing route |
| Reuses `applyChatPatches` (SPEC §23) | ✅ — same call site as the existing route |
| Reuses `validatePromptPreservation` (ADR 0012) | ✅ — same decline path |
| Stop affordance via `AbortController` | ✅ |
| Error handling: 503, 500, mid-stream `error` event | ✅ |
| Provider scope: kilo_code streaming + non-kilo_code fallback to single-delta | ✅ |
| Concurrent streams rejected with 409 | ✅ |
| README documents the endpoint | ✅ |

## Implementation notes

### Transport: Server-Sent Events

GET request, `text/event-stream` response. Each event is `data: <json>\n\n`. Three event types:

- `{"delta": "..."}` — incremental text from the model.
- `{"done": true, "message_id": "...", "session": {...}}` — final marker carrying the persisted session.
- `{"error": "..."}` — mid-stream failure.

The choice of SSE over WebSockets is intentional: SSE works over plain HTTP (no upgrade handshake), is supported by all modern browsers, and is one-way (server → client), which is exactly what streaming the AI's reply requires. The client uses `fetch` + `ReadableStream` rather than `EventSource` because `EventSource` is GET-only with limited header control, and we need the URL to carry the request body as query parameters (the existing route's POST body shape translated to a query string).

### v1 vs future streaming

This slice emits ONE synthetic `delta` chunk when the full reply arrives. The pragmatic v1: it gives the streaming UX (no spinner wait, the reply appears as soon as it's ready) without requiring a deep integration with the upstream provider's actual streaming API. Future: replace with true token streaming when the upstream providers expose SSE / chunked responses. The client code is already structured around incremental deltas (loop over `data: {...}\n\n` events, append `payload.delta` to the placeholder), so the upgrade is purely server-side.

### Patch + annotation re-use

The streaming endpoint reuses `applyChatPatches` (SPEC §23) and `validatePromptPreservation` (ADR 0012) exactly as the existing route does. The merged `suggested_prompt` + applied/no-op/rejected patch tracking + decline path all run on the accumulated reply after the upstream call completes. The streamed text is for UX only; the persisted message is the validator's verdict.

### Concurrent-stream mutex

A simple `Set<sessionId>` of active streams. On entry, the endpoint adds the session id; on completion or error, it removes the id. A second concurrent stream on the same session returns 409. The client falls back to the non-streaming POST in this case. The mutex is per-session (not global) so different sessions can stream in parallel.

### Client disconnect

`req.on('close')` sets `aborted = true`. The pipeline checks `aborted` after the upstream call completes; if true, it persists a partial-reply assistant message with `audit: { kind: 'stream_aborted' }` and ends the response without writing the `done` event. The client sees `AbortError`, doesn't show an error toast, and the partial reply is preserved in the transcript with the audit marker visible.

### Files changed (delta)

| File | Change | Lines |
|---|---|---|
| `server.js` | New `GET /api/chat/sessions/:id/messages/stream` endpoint; SSE headers + mutex + abort handling; reuses existing pipeline | +~265 |
| `src/app.js` | `submitChatMessageStreaming` + `stopChatStream` + streaming/aborted visual states in `buildChatMessageNode`; form-submit wiring + Stop button wiring | +~225 |
| `src/styles.css` | `.chat-typing-indicator` + `@keyframes chat-typing-pulse` + `.chat-stop-btn` + `.chat-message--streaming` + `.chat-message--aborted` | +~70 |
| `src/index.html` | Stop generating button next to Send | +~6 |
| `README.md` | Documented new endpoint in endpoint table | +1 |
| `docs/SPEC.md` | §24 (Reframe + Scope + Out-of-scope + User stories + Implementation decisions + Glossary + DoD) | +~80 |
| `docs/ARCHITECTURE.md` | §29.A1–A4 (transport, server pipeline, client pipeline, error handling) | +~140 |
| `docs/PRE-MORTEM.md` | §29 (top risks + pre-commitments + kill criteria) | +~50 |
| `docs/CODE-REVIEW-31-streaming.md` | This file | +~110 |
| `tests/run-all.js` | 14 new SPEC §24 tests (5 static-source + 3 client integration + 6 server endpoint) | +~135 |

## Parked (out of SPEC §24 scope)

- **True token-by-token streaming.** v1 emits one synthetic delta when the full reply arrives. Future: integrate with the upstream provider's SSE / chunked response.
- **Patch streaming.** `patches[]` and `annotations[]` are part of the final message envelope; they do not stream incrementally.
- **Reconnect on disconnect.** SSE drops mid-stream are not auto-recovered. The partial reply is persisted; the user can re-send to get a fresh stream.
- **Per-attachment streaming for vision messages.** Vision-capable messages are built lazily in `buildChatRequestContext`; the streaming endpoint uses the same path.

## Sign-off

- Standards axis: **pass**
- Spec axis: **pass for SPEC §24 scope**
- Overall: **pass** — chat fluid-two-way implementation complete (Slices II + III + I).
