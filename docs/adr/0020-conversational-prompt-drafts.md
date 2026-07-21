# ADR 0020 — Conversational prompt drafts with explicit commit

## Status

Proposed until implementation verification completes.

## Context

The post-generation chat needed to support discussion and iterative refinement, while unbounded prompt/history context caused MiniMax parse fallbacks and the existing current_prompt-only model gave the user no unapplied draft state.

## Decision

Maintain original_prompt, current_prompt, and pending_prompt separately. Discussion does not mutate prompt state. Recommendations and refinements update pending_prompt only. A button or deterministic explicit text command commits the pending proposal to current_prompt. Provider context is bounded at 20,000 characters using compact analysis and recent history.

## Consequences

The session shape gains an optional pending_prompt field, old sessions remain readable, the existing route family remains in place, and users gain a safe multi-turn proposal workflow. Older chat messages retain suggested_prompt compatibility.

## Rejected alternatives

Automatically applying model proposals was rejected because conversational exploration must not alter the prompt unexpectedly. Sending all persisted history was rejected because it made reliability depend on conversation length.

## Verification

Implementation is accepted only after the canonical test suite, session initialization, and manual browser smoke test pass.
