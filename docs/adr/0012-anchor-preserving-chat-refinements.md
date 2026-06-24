# ADR 0012 — Anchor-preserving chat refinements (wholesale rewrite fix)

## Status

Accepted. Implemented 2026-06-24.

## Context

ADR 0011 shipped the post-generation chat console. In live use after
ship, the most common failure mode is **not** an empty reply or a parse
fallback (those were addressed in ADR 0011a) — it is the LLM doing a
**wholesale rewrite** of the current working prompt instead of a
targeted edit. Concrete repro:

> User asks the chat: *"Change the colors to navy, gold, and white."*
> Original prompt is a paint-application specification — eggshell
> finish, low-VOC formula, 350 sq ft coverage, drying time, brush
> requirements, three named hex colors. The assistant's
> `suggested_prompt` comes back as a generic 2-sentence "paint palette
> concept" with none of the original production requirements, no
> specific values, and no paint-application context. Applying it would
> destroy the prompt.

The current system prompt (ADR 0011, lines 2956–2969) does instruct
the model to "Preserve any facts in the current prompt that the user
did NOT ask to change. Refinements should be targeted, not wholesale
rewrites." That instruction is buried mid-prompt, framed as a soft
preference rather than a hard contract, and the model frequently
ignores it.

Root cause: the LLM is told the prompt is *the thing to write*, not
*the thing to edit*. When a user asks for a small change, the model's
generation prior drifts toward "produce a complete new image prompt"
because that is the dominant pattern in its training data — image
prompts are written standalone, not edited. Without an explicit
edit-vs-generate distinction, small requests trigger the "generate"
path.

Three concrete pain points:

1. **Loss of application context.** A prompt that names a specific
   use case (paint, packaging, architectural rendering, medical
   illustration, ...) loses that context in the revision.
2. **Loss of pre-defined values.** Anything in the prompt that was
   *specified* — hex codes, dimensions, technical parameters, named
   constraints — is treated as free text and rewritten.
3. **Loss of production requirements.** Production guardrails (low
   VOC, food-safe, ADA-compliant, royalty-free, ...) vanish with no
   warning.

The chat console must guarantee that a revision request which targets
one parameter leaves every other parameter bit-for-bit intact.

## Decision

Add an **anchor-preservation contract** between the chat system
prompt and a server-side validation step. Two parts:

### 1. System-prompt rewrite: edit-vs-generate contract

Rewrite `DEFAULT_CHAT_SYSTEM_PROMPT` in `server.js` to treat the
current working prompt as a **base to edit**, not a **topic to write
about**. The new contract has five explicit rules:

- **Inventory first.** Before generating the revision, the model must
  silently list (a) what the user asked to change and (b) every other
  element of the current prompt. The first set is the *delta*; the
  second is the *anchor set*.
- **Anchor set is immutable.** Every element of the anchor set must
  appear in the revised prompt verbatim or with paraphrastic
  equivalence that preserves meaning (numbers, names, technical
  terms, units, codes, specific constraints). The model's job is to
  *swap the delta into the anchor set*, not to regenerate the whole
  prompt.
- **No new facts unless requested.** If the original prompt doesn't
  mention something (a different medium, an unrelated adjective, a
  new style direction), the revision MUST NOT introduce it. Adding
  facts the user did not ask for is a wholesale rewrite by another
  name.
- **Targeted exceptions.** A user who says "rewrite the whole prompt
  in a punchier voice" is making an explicit wholesale request — that
  is permitted and the anchor set is empty. The model must use
  judgement here: does the user want a small edit or a fresh take?
- **Self-report the delta.** The revised prompt must be a complete,
  self-contained image-generation prompt — the user sees ONLY the
  revised text. The `reply` is a short acknowledgement, NOT a
  diff. Same contract as ADR 0011.

The system prompt also gains an **EXAMPLES** section with two
contrasted cases: (a) a targeted color-change on a paint-spec prompt
that retains all production requirements, and (b) a wholesale
rewrite (which is allowed when explicitly requested).

The JSON output shape is unchanged: `{ reply, suggested_prompt }`
with `suggested_prompt: ""` for question-only turns.

### 2. Server-side validation: deterministic anchor check

Add `validatePromptPreservation(original, revised, userRequest)` — a
pure, deterministic helper that scores the revised prompt against the
original and reports whether non-targeted content was preserved. It
runs **after** every successful chat call that returns a non-null
`suggested_prompt`.

Algorithm:

1. **Tokenize** both prompts: lowercase, strip punctuation, drop
   tokens shorter than 3 characters and a stop-word list.
2. **Compute keyword retention.** Build a set of unique content
   words from the original. For each, check if it appears in the
   revised. `keywordRatio = matched / unique`.
3. **Compute bigram retention.** Build a set of 2-grams from the
   original content tokens and from the revised. Compute
   `bigramRatio = matched / originalBigrams`. Bigrams catch phrases
   like "interior wall", "eggshell finish", "low-VOC" that keyword
   overlap alone would miss.
4. **Identify user-targeted tokens.** Tokenize the user's chat
   message. Anything in both the user's request and the original
   prompt counts as "targeted" — the user is allowed to drop those.
5. **Compute non-targeted retention.** Of the original content words
   that were NOT mentioned by the user, what fraction still appear in
   the revised? `nonTargetedRatio`. This is the headline metric —
   it answers "did the revision preserve what the user did NOT ask
   to change?".
6. **Pass criteria** (chosen from empirical tests against the
   paint-spec use case and other real prompts):
   - `nonTargetedRatio >= 0.70` for prompts longer than 200 chars
   - `nonTargetedRatio >= 0.50` for prompts ≤ 200 chars (short
     prompts have fewer content words, so the absolute match count
     matters less)
   - `bigramRatio >= 0.40` (long prompts) or `>= 0.20` (short
     prompts) — catches wholesale-rewrite paraphrases that drop
     multi-word phrases even when individual keywords survive

7. Return `{ preserved, keywordRatio, nonTargetedRatio, bigramRatio,
   missing, nonTargetedMissing, reason }`.

### 3. Retry behaviour

Wire the validator into `callMiniMaxChat`'s retry loop:

- After each successful LLM call that produced a non-null
  `suggested_prompt`, run `validatePromptPreservation`. The
  reference "original" for this check is the session's
  `current_prompt` (not `original_prompt`) — that's the text the
  user is actually iterating on.
- If validation fails AND `attempt < CHAT_MAX_RETRIES`: re-call the
  model with a **reinforcement user-message** appended that names the
  specific missing phrases and instructs the model to keep them. This
  is a targeted prompt-strengthening; no system-prompt edit is
  needed.
- If validation still fails after the last retry: **decline the
  revision**. Set `suggested_prompt = null` and append a note to
  `reply` explaining that the proposed revision would have lost too
  much original context. Tag the assistant message with
  `fallback_reason: 'preservation_failed'` for the server log. The
  user can rephrase with a more specific request.

The retry count is bounded at the existing `CHAT_MAX_RETRIES = 2`
(3 total attempts). Each retry adds latency; the user-visible budget
is roughly 60s × 3 ≈ 3s in the happy path (validation passes on
attempt 1).

### 4. No schema changes

The `extractChatReply` parser, the JSON-schema response shape, and
the on-disk `messages[]` shape are all unchanged. The validator is
a server-side concern that runs *after* parsing. This keeps the
blast radius of the fix small and avoids touching the LLM response
contract that ADR 0011a already debugged.

### 5. Helpers exported

New constants and helpers exported from `server.js` for tests and
potential future consumers:

- `PRESERVATION_STOP_WORDS` — the stop-word set used by the tokenizer
- `PRESERVATION_MIN_PHRASE_LENGTH` — minimum token length to count
- `PRESERVATION_KEYWORD_THRESHOLD_LONG` / `..._SHORT` — keyword
  retention thresholds
- `PRESERVATION_BIGRAM_THRESHOLD_LONG` / `..._SHORT` — bigram
  retention thresholds
- `PRESERVATION_SHORT_PROMPT_LENGTH` — length cutoff (200 chars)
- `tokenizeForPreservation(text)` — lowercase / dedup tokens
- `extractPreservationBigrams(tokens)` — 2-gram set
- `validatePromptPreservation(original, revised, userRequest)` —
  the headline validator returning a structured report
- `PRESERVATION_FAILED_REPLY_NOTE` — the text appended to `reply`
  when a revision is declined

## Consequences

- One new ADR-documented behavior (anchor preservation) layered on
  top of ADR 0011 + 0011a. No new endpoints, no new persistent
  state, no new schema fields.
- The chat system prompt is ~40% longer. The added text is rule
  statements and two contrasted examples (paint-spec targeted edit vs.
  wholesale rewrite). Max-prompt budget on the chat system side was
  never a concern; the user message is the one that hit
  `MAX_CHAT_MESSAGE_LENGTH = 2000`.
- A wholesale rewrite ("rewrite the whole prompt in a punchier
  voice") is still permitted — the contract explicitly carves out
  the case where the user has flagged everything as targeted.
- A revision that legitimately needs to remove an anchor (e.g., the
  user says "remove the VOC requirement") is handled by the user's
  message naming the target; the targeted-token set absorbs it and
  the validator's non-targeted ratio stays high.
- Tests verify: the tokenizer, the bigram extraction, the keyword /
  bigram / non-targeted ratios, the pass/fail thresholds, the
  paint-application use case end-to-end, and that the
  `callMiniMaxChat` retry path declines with `suggested_prompt: null`
  when validation fails on every attempt.
