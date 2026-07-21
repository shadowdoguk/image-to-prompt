# ADR 0020 — Conversational prompt drafts with explicit commit

## Status

Accepted. Implemented 2026-07-21.

## Context

The post-generation chat needed to support discussion and iterative refinement, while unbounded prompt/history context caused MiniMax parse fallbacks and the existing current_prompt-only model gave the user no unapplied draft state.

## Decision

Maintain original_prompt, current_prompt, and pending_prompt separately. Discussion does not mutate prompt state. Recommendations and refinements update pending_prompt only. A button or deterministic explicit text command commits the pending proposal to current_prompt. Provider context is bounded at 20,000 characters using compact analysis and recent history.

## Consequences

The session shape gains an optional pending_prompt field, old sessions remain readable, the existing route family remains in place, and users gain a safe multi-turn proposal workflow. Older chat messages retain suggested_prompt compatibility.

## Rejected alternatives

Automatically applying model proposals was rejected because conversational exploration must not alter the prompt unexpectedly. Sending all persisted history was rejected because it made reliability depend on conversation length.

## Verification

Verification commands run in the worktree on `db48e52`:

- `npm test` — 308 passed, 0 failed (matches baseline; full transcript preserved in the task-6 verification report).
- `node scripts/session-init.js` — 10/10 V-checks passed (validation gate green; `version_control` scanner reports `unavailable` for `not-a-git-repo` but the gate is non-blocking).
- `node --check server.js && node --check src/app.js && node --check tests/run-all.js && echo "syntax OK"` — exit 0, prints `syntax OK`.
- `git diff --check` — exit 0, no whitespace conflict markers.
- `git status --short` — clean tree.
- `git diff --stat` — no uncommitted changes against `db48e52`.
- `node scripts/smoke/chat-conversational-smoke.js` — exit 0; four scenario blocks (`POST /api/chat/sessions`, discussion, proposal, `apply it`) each emitted the expected `current_prompt` / `pending_prompt` transitions; final line `SMOKE TEST RESULT: all checks passed`.
