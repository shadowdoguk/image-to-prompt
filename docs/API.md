# API — SPEC §28 Iterative refinement (Analyze Generated Image)

This document specifies the public surface of the iterative refinement
(IR) feature. It covers the HTTP endpoint exposed to the browser plus
the three module exports consumed by tests, the smoke script, and any
future internal callers.

## Surface at a glance

| Item | Kind | Owner | Status |
|---|---|---|---|
| `POST /api/chat/sessions/:id/analyze-generated` | HTTP route | `server.js` | Shipped (IR-5) |
| `irAnalyzeImage(imagePath)` | Module export | `server.js` | Shipped (IR-2) |
| `irCompareImages(reference, generated, refDataUri, genDataUri)` | Module export | `server.js` | Shipped (IR-3) |
| `irRevisePrompt(currentPrompt, mismatches)` | Module export | `server.js` | Shipped (IR-4) |
| `parseImageAttributes(raw)` | Module export | `server.js` | Shipped (IR-2) |
| `parseMismatchList(raw)` | Module export | `server.js` | Shipped (IR-3) |
| `parseRevisedPrompt(raw)` | Module export | `server.js` | Shipped (IR-4) |
| `fileToImageDataUri(imagePath)` | Module export | `server.js` | Shipped (IR-3) |
| `markChatAttachmentAsReference(sessionId, attachmentId)` | Module export | `server.js` | Shipped (IR-2) |
| `IR_ITERATION_CAP` | Constant | `server.js` | `8`, locked at G2 |

## HTTP route

### `POST /api/chat/sessions/:id/analyze-generated`

Iterative refinement entry point. Compares the most recently uploaded
chat attachment (the "generated" image) against the first attachment
(the "reference") for the session, identifies discrepancies on seven
locked dimensions, and emits a revised `suggested_prompt` as an
assistant message tagged `audit.kind='ir_iteration'`.

**Path parameters**

| Name | Type | Description |
|---|---|---|
| `id` | string | Chat session id. Must start with `chat_`. |

**Request body**

Empty JSON object (`{}`) is sufficient. Reserved for future options
(e.g. a custom iteration cap override). No fields are read at IR-5.

**Response (200 OK)**

```json
{
  "success": true,
  "data": {
    "session": { ... full session object ... },
    "message": {
      "id": "msg_...",
      "role": "assistant",
      "content": "IR iteration: 3 mismatch(es) flagged. The revised prompt below addresses them.",
      "suggested_prompt": "...",
      "audit": {
        "kind": "ir_iteration",
        "iteration_index": 1,
        "reference_attachment_id": "att_...",
        "generated_attachment_id": "att_...",
        "mismatches": [
          {
            "dimension": "palette",
            "severity": "high",
            "generated_value": "...",
            "reference_value": "...",
            "suggested_fix": "..."
          }
        ],
        "latency_ms": { "analyze": 1234, "compare": 987, "revise": 654 }
      },
      "timestamp": "2026-09-16T..."
    },
    "reference_attributes": { "subjects": [...], "style": "...", "palette": [...], ... },
    "generated_attributes": { "subjects": [...], "style": "...", "palette": [...], ... },
    "mismatches": [ ... ],
    "revised_prompt": "...",
    "ir_iteration_count": 1
  }
}
```

**Response (200 OK, anchor-preservation decline)**

```json
{
  "success": true,
  "data": {
    "session": { ... },
    "message": {
      "id": "msg_...",
      "role": "assistant",
      "content": "Revision declined — too much of the original context would have been lost. N non-targeted term(s) missing: ...",
      "suggested_prompt": "the revised prompt the model proposed (not applied)",
      "audit": {
        "kind": "ir_iteration",
        "iteration_index": 1,
        "mismatches": [ ... ],
        "latency_ms": { ... },
        "declined_partial_prompt": "...",
        "declined_missing_terms": ["term1", "term2"],
        "declined_reason": "..."
      }
    },
    "declined": true,
    "declined_missing_terms": ["term1", "term2"],
    "declined_reason": "..."
  }
}
```

**Error envelopes**

| Status | When | Error message |
|---|---|---|
| `400` | Invalid session id prefix | `id must start with "chat_".` |
| `404` | Session not found | `Chat session "{id}" not found.` |
| `409` | Iteration cap reached (8) | `Iteration cap (8) reached for this session. Adjust the prompt manually or start a new session.` |
| `422` | No reference uploaded | `Upload a reference image (the original) and a generated image first.` |
| `422` | Only one attachment | `Upload a generated image too — one attachment is not enough to compare.` |
| `422` | Unsupported image format | `Image read failed: Unsupported image format (expected PNG, JPG, or WebP).` |
| `422` | Image > 8MB | `Image read failed: Image too large; resize to under 8MB before analyzing.` |
| `504` | MiniMax API failure (timeout, empty response, auth, JSON parse) | `Image analysis failed: ...` / `Image comparison failed: ...` / `Prompt revision failed: ...` |

**Latency budgets**

| Stage | Soft | Hard | Per |
|---|---|---|---|
| Analyze (IR-2) | 15s | 18s | SPEC §28 A6 |
| Compare (IR-3) | 15s | 18s | SPEC §28 A6 |
| Revise (IR-4) | 10s | 12s | SPEC §28 A6 |
| End-to-end | 45s p95 | 90s | SPEC §28 A6 |

Each stage's measured duration is threaded onto
`audit.latency_ms.{analyze,compare,revise}` for live measurement.

## Module exports

### `irAnalyzeImage(imagePath: string) -> Promise<ImageAttributes>`

Reads the file at `imagePath`, validates it (magic-byte sniff + 8MB
cap), base64-encodes it, sends a single MiniMax M3 vision call with
the locked JSON schema, and returns the parsed `ImageAttributes`
object. Falls back to a stub shape when the MiniMax provider has no
API key set.

**Throws:**
- `Image too large; resize to under 8MB before analyzing.`
- `Unsupported image format (expected PNG, JPG, or WebP).`
- `MINIMAX_API_KEY not set. Configure MiniMax in Providers & keys.`
- 18s timeout (rejected via `AbortController`).
- MiniMax API errors (auth, rate limit, empty response, JSON parse).

**ImageAttributes shape:**

```json
{
  "subjects":    ["string", ...],   // 0..16 short phrases
  "style":       "string",          // 4..200 chars
  "palette":     ["string", ...],   // 0..12 color descriptors
  "composition": "string",          // 4..240 chars
  "objects":     ["string", ...],   // 0..24 notable objects
  "text":        "string|null",     // visible text or null
  "aesthetic":   "string"           // 4..200 chars
}
```

### `irCompareImages(reference: ImageAttributes, generated: ImageAttributes, refDataUri: string, genDataUri: string) -> Promise<Mismatch[]>`

Receives both `ImageAttributes` objects plus both image data URIs.
Sends a single MiniMax M3 vision call with the locked
`IR_MISMATCH_SCHEMA` and returns the parsed `Mismatch[]`.

**Throws:** Same categories as `irAnalyzeImage` (MiniMax errors).
Falls back to a one-mismatch stub shape when the provider has no
API key.

**Mismatch shape:**

```json
{
  "dimension":      "subjects" | "style" | "palette" | "composition" | "objects" | "text" | "aesthetic",
  "severity":       "low" | "med" | "high",
  "generated_value": "string",   // ≤240 chars
  "reference_value": "string",   // ≤240 chars
  "suggested_fix":   "string"    // ≤240 chars
}
```

### `irRevisePrompt(currentPrompt: string, mismatches: Mismatch[]) -> Promise<string | DeclineEnvelope>`

Sends a single MiniMax M3 text call with the current prompt and the
mismatch list, then runs the model output through
`validatePromptPreservation` (ADR 0012) before returning.

**Returns:**
- A `string` (the revised prompt) on preservation pass.
- A `DeclineEnvelope` object on preservation decline (mirrors SPEC §22
  partial-apply shape):

```json
{
  "declined": true,
  "declined_partial_prompt": "...",
  "declined_missing_terms": ["term1", ...],
  "declined_reason": "..."
}
```

### Validators (pure functions, no network)

| Validator | Input | Output | Throws |
|---|---|---|---|
| `parseImageAttributes(raw)` | arbitrary JSON | `ImageAttributes` | Field-specific error if any of the 7 fields is wrong type/shape |
| `parseMismatchList(raw)` | arbitrary JSON | `Mismatch[]` | Field-specific error on bad dimension, severity, or empty strings |
| `parseRevisedPrompt(raw)` | arbitrary value | `string` | On empty or oversize (`> MAX_FINAL_PROMPT_LENGTH`) |

### Helpers

| Helper | Signature | Purpose |
|---|---|---|
| `fileToImageDataUri(imagePath)` | `(string) -> string` | Read file, validate magic bytes + size cap, return base64 data URI |
| `markChatAttachmentAsReference(sessionId, attachmentId)` | `(string, string) -> { ok, role?, error? }` | Set `role: 'reference'` on one manifest entry, clear it on every other in the session |
| `IR_ITERATION_CAP` | `number` (`8`) | Locked at G2 |

## Frontend wire

| Element | Where | Purpose |
|---|---|---|
| `#chat-analyze-generated-btn` | `src/index.html` chat input bar | Triggers `onAnalyzeGeneratedClick` |
| `#chat-ir-counter` | `src/index.html` chat input bar | Shows `N / 8`; updated via `window.__i2pUpdateIrCounter(n)` |
| `onAnalyzeGeneratedClick` | `src/app.js` (hoisted) | POST + render + update counter |
| `window.__i2pAnalyzeGenerated` | `src/app.js` | Shell.js hook for the button click |
| `window.__i2pUpdateIrCounter(n)` | `src/shell.js` | Counter visibility + disabled state at the cap |

## Iteration counter semantics

| Event | Counter |
|---|---|
| `404` session not found | unchanged |
| `400` invalid id | unchanged |
| `409` cap reached | unchanged |
| `422` missing/unsupported attachments | unchanged |
| `504` MiniMax failure (any step) | unchanged |
| `200` success (declined or not) | `+= 1` |

## Constants

| Name | Value | Locked at |
|---|---|---|
| `IR_ITERATION_CAP` | `8` | G2 (SPEC §28 §Behaviour #5) |
| `MAX_FINAL_PROMPT_LENGTH` | `5000` (chars) | Project-wide (existing) |

## Test surface

- **Unit / integration tests:** `tests/run-all.js` — 35 new IR tests
  across IR-1 (9), IR-2 (7), IR-3 (7), IR-4 (7), IR-5 (7), IR-6 (4).
  Total suite: 672 passed / 0 failed.
- **Fixture data:** `tests/fixtures/ir/` — 8 JSON files (3 analyze,
  2 compare, 3 revise).
- **Smoke script:** `scripts/smoke/ir-loop-smoke.js` — 26 static-source
  assertions. Run via `node scripts/smoke/ir-loop-smoke.js`.
- **Code reviews:** `docs/CODE-REVIEW-IR-{1..6}.md` — two-axis
  (Standards + Spec), all `pass` verdicts.
