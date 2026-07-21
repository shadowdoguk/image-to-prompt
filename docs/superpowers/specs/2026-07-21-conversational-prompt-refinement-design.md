# Conversational Prompt Refinement Design

## Status

Approved in conversation on 2026-07-21. Implementation has not started.

## Summary

Replace the current one-turn-oriented refinement behavior with a bounded conversational workflow that lets the user discuss the generated prompt, ask the AI for recommendations, iteratively refine an unapplied draft, and commit that draft only after explicit confirmation.

The workflow applies to every preset. Existing Z-Image constraints remain active for Z-Image sessions.

## Problem and evidence

The current chat console treats each request as an isolated request for either a question answer or a complete `suggested_prompt`. Every turn sends the full system contract, original prompt, current prompt, full analysis snapshot, and complete message history to MiniMax. A malformed or truncated model response is retried and then reduced to the generic fallback at `server.js:5438`.

Persisted sessions demonstrate the failure: affected Z-Image sessions build approximately 18,900–19,600 character system prompts before the conversation history is added. The current implementation also has no separate unapplied draft, so a user cannot have a multi-turn discussion about a proposed change without treating every proposal as a candidate against the last committed prompt.

## Goals

- Support natural two-way discussion about the prompt, its intent, and possible improvements.
- Let the AI recommend changes without changing the live result prompt.
- Let the user refine a proposed draft over multiple turns before committing it.
- Keep the original prompt available as an immutable reference throughout the session.
- Keep the last committed prompt separate from the unapplied proposal.
- Commit only through an explicit Apply action or an unambiguous text command.
- Prevent context growth from making responses unreliable.
- Preserve anchor validation and preset-specific prompt contracts.
- Keep existing sessions and existing API consumers readable.

## Non-goals

- Automatically regenerate an image after a prompt is committed.
- Automatically commit changes based only on an AI recommendation.
- Add branching conversations, multiple simultaneous proposals, or full diff editing in this iteration.
- Change the preset file format or Stage 1 / Stage 2 pipeline contracts.
- Move the MiniMax API key to the browser.

## State model

A chat session will contain these prompt states:

- `original_prompt`: immutable text returned by the original Stage 2 run.
- `current_prompt`: last prompt explicitly committed by the user. This remains the source for the Step 4 result and clipboard actions.
- `pending_prompt`: latest valid proposal under discussion, or `null` when no unapplied proposal exists.

Assistant messages continue to store `suggested_prompt` for compatibility. On a proposal turn it contains the proposed draft; on a discussion turn it is `null`. The latest proposal is also copied to `pending_prompt` so the server can resolve an Apply action without reconstructing intent from message history. Applying a proposal sets `current_prompt` to the selected proposal and clears `pending_prompt`.

A proposal is based on `pending_prompt` when one exists; otherwise it is based on `current_prompt`. The original remains reference material and is never silently replaced. The server-side preservation validator compares each new proposal with this active draft, allowing a user to refine a draft across several turns while still protecting content they did not request to change.

Existing sessions without `pending_prompt` are treated as having `pending_prompt: null`. Existing assistant messages with `suggested_prompt` continue to render and can be applied.

## Conversation behavior

Every user turn is handled as one of these outcomes:

1. **Discussion** — the assistant answers a question, explains a prompt choice, evaluates an idea, or asks for direction. No prompt state changes.
2. **Recommendation** — the assistant identifies useful changes and presents a concrete proposal. The proposal becomes `pending_prompt`; `current_prompt` is unchanged.
3. **Draft refinement** — the assistant updates the existing `pending_prompt` in response to further feedback. Only the pending draft changes.
4. **Explicit commit** — a button or unambiguous text command commits the latest pending proposal. Ambiguous language never commits automatically.

The assistant may suggest improvements proactively, but every suggestion remains a proposal until committed. A user can say that a proposal is close, request another change, ask why a change was recommended, or ask the assistant to compare the pending draft with the original/current prompt without losing the unapplied draft.

## API and server design

The existing chat route family remains in place:

- `POST /api/chat/sessions` creates the session and initializes `pending_prompt: null`.
- `POST /api/chat/sessions/:id/messages` handles discussion, recommendation, and draft-refinement turns.
- `POST /api/chat/sessions/:id/apply/:messageId` commits a selected proposal and clears the pending state.
- Existing list, fetch, and delete routes remain compatible.

The message response envelope remains `{ success, data, error }`. Assistant message fields remain `content` and `suggested_prompt`; the session response gains the backward-compatible `pending_prompt` field.

The message route will persist user and assistant turns as it does today. On a valid proposal it updates `session.pending_prompt`. On a discussion turn it leaves prompt state unchanged. On a fatal provider failure it preserves the current rollback behavior and keeps the user's text available in the frontend for retry. A recognized text commit is persisted as the user's command plus a short assistant confirmation, so the conversation remains complete without an unnecessary model call.

Explicit text commits are recognized conservatively from a small deterministic command set such as `apply it`, `use that`, and `commit this`, only when `pending_prompt` exists. The route will apply the latest pending proposal and return a normal updated session response. Non-matching language is sent to the AI as ordinary conversation. The Apply proposal button remains the primary, discoverable commit mechanism.

## Prompt construction and context budget

`buildChatSystemPrompt` will be split conceptually into a short stable contract and bounded live context:

- The stable contract will distinguish discussion, proposal, refinement, and commit behavior.
- The live context will identify original, committed, and pending prompts explicitly.
- The active editing base will be pending first, then current.
- The analysis snapshot will be compacted deterministically by limiting each field to useful text and omitting redundant empty values.
- Conversation history sent to MiniMax will be bounded to the most relevant recent turns rather than the entire 200-message persistence cap. The original prompt, current prompt, pending prompt, and visible persisted history remain available to the user even when older turns are omitted from a provider request.
- Duplicate prompt text will not be sent twice when original and current are identical.
- The assembled provider input will be measured before the request and kept below a conservative `CHAT_CONTEXT_CHAR_BUDGET` of 20,000 characters. The builder will prioritize the active draft and original prompt, then recent user/assistant turns, then analysis detail.

Parse retries will use a compact correction request rather than resending an ever-growing conversation. The parser will continue to reject invented proposals from malformed responses. Final failure will produce a useful assistant status and Retry affordance without changing prompt state.

Z-Image sessions will continue to receive the Z-Image contract, but the contract will be concise enough to fit inside the context budget. Its forbidden vocabulary, pastel-focal requirements, and token/length constraints remain enforced.

## Frontend interaction

The Step 5 console will show the conversation and the current proposal state:

- Discussion responses render as ordinary assistant messages with no action.
- Proposal responses render a draft preview labeled as unapplied, with an `Apply proposal` button.
- The session status identifies whether there is an unapplied proposal.
- Applying a proposal updates Step 4's result text, `state.finalPrompt`, token reminders, and the session state in one operation.
- After applying, the pending preview is marked committed and subsequent refinement uses the newly committed prompt.
- The text input remains available after every turn, including after a discussion response.
- On send failure the input is preserved and Retry resends the same message.
- Older sessions without the new field render normally.

The UI will not imply that a recommendation has changed the prompt until the user commits it.

## Error handling and safety

- Provider authentication, rate-limit, timeout, and network errors remain distinct internally and receive clear user-facing messages.
- Parse failures are retried with a strict compact correction instruction and never create a proposal from untrusted malformed output.
- Preservation failures retain the existing decline behavior, show the rejected proposal and missing anchors when available, and leave both current and pending prompt state unchanged.
- Applying a proposal is validated server-side against the session and message; the frontend cannot commit arbitrary text by changing DOM state.
- All user-controlled prompt text remains rendered through `textContent` / escaped server values.
- No API keys or provider responses containing secrets are logged.

## Migration and rollback

No persistent migration is required. `pending_prompt` is optional when reading old sessions and is initialized on new sessions. The existing `suggested_prompt` field remains the compatibility bridge for previously stored assistant messages.

Rollback is a code revert. Since `current_prompt` and the existing message format remain authoritative, reverting the new code does not destroy committed prompts or conversation history. The optional `pending_prompt` field is ignored by older code.

## Verification plan

Add regression coverage for:

- New session initialization with `pending_prompt: null`.
- Old session reads without `pending_prompt`.
- Discussion turns that return no proposal and preserve both prompt states.
- Initial recommendations that create `pending_prompt` without changing `current_prompt`.
- Multiple proposal refinements based on the pending draft.
- Button Apply committing a proposal and clearing pending state.
- Unambiguous text Apply committing the latest pending proposal.
- Ambiguous language not committing a proposal.
- Preservation validation against pending rather than stale current text.
- Bounded system/history context for long prompts and long sessions.
- Z-Image constraints remaining present while context remains bounded.
- Malformed provider responses retrying safely and never inventing a revision.
- Frontend rendering for discussion, pending proposal, committed proposal, legacy session, failure, and Retry states.
- Existing chat persistence, validation, delete, and no-ghost-message invariants.

Acceptance requires the canonical test suite, `node scripts/session-init.js`, and a manual browser smoke test covering discussion, proposal refinement, button commit, text commit, and retry behavior.

## Acceptance criteria

- [ ] A user can ask questions and discuss the prompt without creating a revision.
- [ ] The AI can recommend a concrete change without changing the live result prompt.
- [ ] The user can refine the unapplied proposal over multiple turns.
- [ ] The original prompt remains available as a stable reference.
- [ ] Apply proposal commits the selected draft and updates the Step 4 result.
- [ ] Clear text commands can commit the latest proposal; ambiguous language cannot.
- [ ] Long Z-Image sessions no longer routinely reach the generic parse fallback because of unbounded context.
- [ ] Anchor preservation and Z-Image contracts remain enforced.
- [ ] Existing sessions and persisted messages remain readable.
- [ ] Regression tests and session initialization pass.
