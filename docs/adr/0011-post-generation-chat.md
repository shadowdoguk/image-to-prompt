# ADR 0011 — Post-generation interactive chat (prompt refinements)

## Status

Accepted. Implemented 2026-06-23.

## Context

The image-to-prompt workflow ends at Step 4 — the user reads the final
prompt Stage 2 produced and copies it out to a downstream image-generation
tool. From there, refinement happens in a black box: if the user wants the
subject more poetic, the lighting punchier, or the composition reframed,
they must manually edit the prompt text in a different app and lose
contact with the AI that produced it.

Three concrete pain points that drove the design:

1. **No conversational refinement.** A user who wants a tweak has to leave
   the app and hand-edit the prompt. There's no way to ask the AI to
   "make the lighting more dramatic" or "expand the subject description"
   and have it return a revised prompt.

2. **Lost context after generation.** The analysis (the structured JSON
   Stage 1 returned) is what Stage 2 used to synthesize the prompt. Once
   the prompt is displayed, that context evaporates from the UI. A user
   who wants to ask "why is the camera framed this way?" or "which part
   of the analysis drove the chiaroscuro language?" has nowhere to look.

3. **No audit trail of refinements.** If the user iterates ("shorten by
   20%", "add film-grain texture"), each iteration overwrites the last.
   They can't roll back to a previous version, compare two variants, or
   keep the conversation tied to the run that produced the prompt.

The palette manager (ADR 0006), directive manager (ADR 0009), and prompt
editors (ADR 0005 / 0007) all solved the *library* problem: persistent
storage, version history, validation. None of them solves the
*dialogue* problem.

## Decision

Add a **post-generation chat console** that activates as soon as Stage 2
returns. The console lets the user converse with the AI about the
specific prompt just produced, accept proposed revisions with one click,
and keep the entire conversation history attached to that run across
sessions.

### 1. New entity: Chat session (`data/chat_sessions.json`)

Persistent file seeded with `[]`. Helper trio mirrors the palette (ADR
0006) and directive (ADR 0009) patterns:

- `readChatSessions()` — read+parse; missing file seeds `[]`; parse
  failure logs and returns `[]`. Drops malformed entries with a
  console warning so a partial corruption doesn't brick the list.
- `writeChatSessions(sessions)` — atomic-ish write (write to sibling
  temp file, then `fs.renameSync` over the real file). POSIX rename is
  atomic on the same filesystem. Same single-user assumption as the
  palette and directive files.
- `generateChatSessionId()` — `chat_<16 hex>`.
- `generateChatMessageId()` — `msg_<16 hex>`.

Shape of each session:

```json
{
  "id": "chat_<16 hex>",
  "preset_id": "preset_<16 hex>",
  "preset_name": "Photorealistic photo description",
  "run_id": "run_<16 hex>",
  "title": "first ~60 chars of original_prompt",
  "original_prompt": "the prompt Stage 2 returned",
  "current_prompt": "current working version (== original_prompt initially)",
  "analysis_snapshot": { "subject": "...", "style": "...", ... },
  "messages": [
    {
      "id": "msg_<16 hex>",
      "role": "user | assistant",
      "content": "the message text",
      "suggested_prompt": "string | null  -- present only on assistant messages that propose a new prompt version",
      "timestamp": "ISO 8601"
    }
  ],
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

`messages` is append-only: each `POST /api/chat/sessions/:id/messages`
appends exactly two entries (the user's message and the assistant's
reply). Edits never rewrite history. `current_prompt` advances only
when the user explicitly applies an assistant's `suggested_prompt`
through `POST /api/chat/sessions/:id/apply/:messageId`.

`analysis_snapshot` is captured at session creation time so the chat
system prompt can keep the full context (which fields drove the
synthesis) regardless of whether the user later edits the live
analysis editor.

### 2. New REST surface

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/chat/sessions` | Create a session anchored to a finished run |
| `GET` | `/api/chat/sessions` | List all sessions (newest first) |
| `GET` | `/api/chat/sessions/:id` | Get one session (with full messages) |
| `POST` | `/api/chat/sessions/:id/messages` | Send a user message, append AI reply |
| `POST` | `/api/chat/sessions/:id/apply/:messageId` | Apply an assistant's `suggested_prompt` to `current_prompt` |
| `DELETE` | `/api/chat/sessions/:id` | Hard-delete a session |

All routes share the existing `{ success, data, error }` envelope.

### 3. Chat system prompt

The chat endpoint injects a dedicated system prompt at every turn. The
prompt carries three context blocks:

- The **original generated prompt** (the user's starting point).
- The **current working prompt** (`current_prompt`, which may equal the
  original or reflect prior applies).
- The **analysis snapshot** (the JSON Stage 1 returned — preserves the
  context Stage 2 used even if the user has since edited the live
  editor).

The system prompt instructs the model that:

- The conversation is anchored to the current working prompt; every
  reply should treat that text as the authoritative state.
- A revision request ("make it more dramatic") must produce a revised
  prompt in the response. The model returns a JSON object with two
  fields: `reply` (a short natural-language acknowledgement visible in
  the chat) and `suggested_prompt` (the revised text, only present when
  the user is asking for a change).
- A pure question ("why did you pick this lighting?") returns a
  `suggested_prompt: null`. The chat applies no change.

The JSON schema forces `suggested_prompt` to be either `null` or a
string, so the API has a clean discriminator for whether to render an
Apply button on the assistant message.

### 4. Validation rules

- `POST /api/chat/sessions` body: `{ prompt, preset_id, run_id?,
  analysis_snapshot? }`. `prompt` required, non-empty string,
  ≤ `MAX_FINAL_PROMPT_LENGTH` (5000 chars — matches Stage 2's
  `MAX_STAGE2_TOKENS` ceiling). `preset_id` must start with
  `preset_` and resolve to an existing preset. `analysis_snapshot` is
  optional; if provided, it must be a plain object.
- `POST /api/chat/sessions/:id/messages` body: `{ content }`. `content`
  required, non-empty string, ≤ `MAX_CHAT_MESSAGE_LENGTH` (2000 chars).
  Empty / whitespace-only messages 400.
- `POST /api/chat/sessions/:id/apply/:messageId` requires the message to
  exist on the session and to be an assistant message with a non-null
  `suggested_prompt`. On success, sets `session.current_prompt =
  message.suggested_prompt` and bumps `updated_at`.

A separate helper `extractChatReply(json)` parses the model response,
rejecting anything that isn't `{ reply: string, suggested_prompt: string
| null }`. Defensive: extracts JSON from code fences and balanced
braces, mirroring the Stage 1 extraction logic in
`callMiniMaxStage1`.

### 5. Frontend chat console

A new `<section id="step-chat">` appears immediately under the result
section as soon as Stage 2 returns. Layout:

```
┌──────────────────────────────────────────────┐
│ Conversation about this prompt   [Clear ↺]  │
├──────────────────────────────────────────────┤
│ [USER 14:23]   Make the lighting more dramatic│
│ [ASSISTANT 14:23] Done — here's a revision.  │
│   [ Apply revision ]                         │
│ [USER 14:24]   Now shorten the subject line. │
│ [ASSISTANT 14:24] Here's a tighter version.  │
│   [ Apply revision ]                         │
├──────────────────────────────────────────────┤
│ [textarea: Ask for a tweak or revision…]    │
│                              [Send]          │
└──────────────────────────────────────────────┘
```

- **User vs assistant distinction:** classes `chat-message--user` and
  `chat-message--assistant` with role badges and a vertical accent bar.
- **Timestamps:** ISO-formatted full timestamp on hover; relative ("just
  now" / "3m ago") rendered inline. Reuses the `formatRelativeDate`
  helper from the palette manager (ADR 0006).
- **Apply button:** visible only on assistant messages where
  `suggested_prompt` is non-null. One click writes it into the live
  result prompt (the Step 4 `<p id="result-prompt">` text) AND
  advances `current_prompt` on the server. Re-renders the Step 4 result
  in place without a network round-trip.
- **Send button:** disabled while a request is in flight; spinner
  mirrors the Analyze / Generate buttons.
- **Input validation:** client-side checks for non-empty + ≤
  `MAX_CHAT_MESSAGE_LENGTH` before submit (server re-validates).
- **Persistence:** every chat session is loaded on page init via
  `GET /api/chat/sessions`. Sessions are listed in a small panel above
  the console ("Recent conversations") so a user returning to the app
  can pick up an old thread without re-generating the prompt.

### 6. Concurrency / responsiveness

The chat console renders entirely on the right side of the step-3
editor, so typing into an analysis field while the AI is responding
does not block either side: the live editor's `<textarea>` events are
synchronous DOM updates; the chat's network call only mutates the
session's `messages` array on the server. The result prompt text is
also independent — the user can edit the live analysis editor while
chatting, and apply a chat revision that incorporates the latest
working prompt without trampling the live edits.

The frontend disables Send (and shows a spinner) during the network
call so the user can't double-submit, but does not disable the rest of
the UI. The Apply button is independent: clicking it during a pending
send is fine — it just updates the local `current_prompt` immediately.

## Consequences

- One new persistent file (`data/chat_sessions.json`); same single-user,
  no-locking assumption as the other JSON stores.
- One new endpoint family (`/api/chat/sessions/...`); six routes total.
- One new frontend section; one new helper section in `app.js`; CSS
  additions in `styles.css` only — no existing styles change.
- The chat system prompt is shipped as a constant in `server.js`
  (`DEFAULT_CHAT_SYSTEM_PROMPT`), matching the pattern of
  `DEFAULT_SUBJECT_PROMPT` (ADR 0004) and `DEFAULT_CAMERA_ANGLE_PROMPT`
  (ADR 0008). Not user-editable in this iteration; if iteration proves
  useful, follow up with an ADR mirroring ADR 0005's edit-prompt modal.
- New constants exported from `server.js` for testing:
  `MAX_CHAT_MESSAGE_LENGTH`, `MAX_FINAL_PROMPT_LENGTH`,
  `CHAT_SESSION_ID_PREFIX`, `DEFAULT_CHAT_SYSTEM_PROMPT`,
  `extractChatReply`, `readChatSessions`, `writeChatSessions`,
  `generateChatSessionId`, `generateChatMessageId`, `validateChatMessage`,
  `validateChatSessionCreate`.
- Tests verify: validation rejects bad inputs (empty, too long, wrong
  shape), persistence writes are atomic and round-trip cleanly, an
  apply advances `current_prompt`, a delete removes the session, and
  the schema `suggested_prompt: string | null` discriminator is
  enforced on the response side.