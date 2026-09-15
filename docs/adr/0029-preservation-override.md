# ADR 0029 — Preservation override (per-message opt-in)

**Status:** Accepted. Implemented 2026-09-10.
**Origin:** Session #17 follow-up. User-reported recurring friction: "Revision declined — too much of the original context would have been lost" appears repeatedly on chat refinements the user *intentionally* wanted to be permissive.

## Context

The chat revision pipeline (ADR 0011) runs an anchor-preservation validator (ADR 0012) that declines revisions whose keyword/bigram retention against the current working prompt drops below the configured threshold. The validator exists to prevent a documented failure mode: the model doing a wholesale rewrite of a paint-spec prompt into a generic 2-sentence "paint palette" description, dropping every production requirement (ADR 0012 §"Concrete pain points"). The validator is binary — if the rewrite drops below threshold, the entire revision is declined; there is no partial credit and no way for the user to say "I know, do it anyway."

The chat-fluid work (Sessions #13 / SPEC §22 / §23 / §24, ADR 0027) added bounded AI mutators (`patches[]` + `annotations[]`) so many revisions that would have triggered a whole-prompt rewrite can instead be expressed as targeted patches with a much higher preservation rate. Slice 26 of the chat-fluid polish (the most recent entry on `docs/SESSION-STATE.md`) shipped the patch protocol with anchor-preservation still active on the merged result.

The remaining friction: when the user *intentionally* wants a permissive revision ("rewrite this in a punchier voice", "shorter and more dramatic", "give me a fresh take using none of the same adjectives"), the validator still declines. The existing escape hatch (`Try as rewrite` button, which prefixes `REWRITE FROM SCRATCH — anchor set is empty`) sometimes works and sometimes still fails validation (because the model doesn't always honour the wholesale-rewrite marker). Users have no way to say "yes, drop anchor terms; I want the revision as the model proposed it."

The requested change is explicit: add a user-facing override toggle in the chat revision flow that bypasses the preservation validator when active. The user's framing: "to resolve the recurring error 'Revision declined — too much of the original context would have been lost'."

## Decision

### 1. Per-message, opt-in, with explicit confirmation

Add a single new boolean request field `preservation_override` on the chat message body (`POST /api/chat/sessions/:id/messages`). When `true`, the server skips the `validatePromptPreservation` rejection path for that single message and returns the model's `suggested_prompt` directly. The override is **not a sticky or global setting** — every override requires an explicit user confirmation (a checkbox + `window.confirm()` dialog) at the moment of use. State is held in `state.chatPreservationOverride`, reset to `false` after each submission.

Why per-message + confirmation, not a sticky toggle:

- The most common accidental case is "I clicked the wrong button". A sticky toggle clears the default protection 100% of the time the user forgets it. A per-message, confirmation-gated toggle requires deliberate intent at every use.
- ADR 0012's rejection-rate hazard (referenced in the Session #13 BACKLOG entry) explicitly warns against a free-standing permissions bump. Per-message + confirmation honors the warning while still satisfying the user's literal ask.
- The catastrophic case (model drops 90%+ of original content) is still blocked — see §3.

### 2. Hard-floor catastrophic safety

The override does NOT bypass the catastrophic case. After running `validatePromptPreservation`, if the revision's keyword retention drops strictly below `PRESERVATION_OVERRIDE_CATASTROPHIC_FLOOR = 0.10` (i.e. 10% of original content tokens survive), the server still declines the revision. The catastrophic case produces `fallback_reason: 'preservation_failed_catastrophic'` and the user sees the same decline UI as the existing path (just with the new fallback reason).

The 0.10 floor is strictly below the existing short-prompt keyword threshold (0.50) and long-prompt threshold (0.70), so the catastrophic case is the only thing the floor catches. In the original paint-spec → "paint palette" failure (ADR 0012 §"Concrete pain points"), the bad revision retained ~5% of the original content tokens, so the floor catches it. In the typical "rewrite in a punchier voice" case (which preserves 30-50% of content), the floor does NOT catch it and the override applies.

If the user disagrees with the floor — wants even the catastrophic case to pass — the floor is a single constant that can be lowered or removed without touching the rest of the pipeline.

### 3. Telemetry

Every override (applied or catastrophic-decline) appends a row to `data/preservation_override_log.json`:

```json
{
  "timestamp": "2026-09-10T14:02:31.123Z",
  "session_id": "chat_a1b2c3d4e5f6g7h8",
  "message_id": "msg_...",
  "nonTargetedRatio": 0.34,
  "bigramRatio": 0.21,
  "missing_count": 14,
  "applied": true,
  "catastrophic": false
}
```

The file is append-only, capped at 1000 rows (oldest are dropped when the cap is hit). Telemetry lets the project observe override usage frequency so future threshold tuning is data-driven. The file lives in `data/` (gitignored, mirroring the chat-sessions.json pattern).

### 4. No new endpoints, no schema changes

The override is a new optional field on the existing `/api/chat/sessions/:id/messages` request body and `/api/chat/sessions/:id/messages/stream` query string. No new routes. No schema migration. No new persistent state on the chat session (the override is request-time only).

### 5. UI placement

The override control is rendered **inside the existing declined-revision block** (`chat-message__declined-actions`), positioned next to the existing "Try as rewrite" affordance. It is visible ONLY when a revision is declined, not preemptively. The control is:

- A checkbox labeled "Allow revision with reduced preservation check".
- A small explanatory line: "Bypasses the safety check that prevents wholesale rewrites. The model may drop production requirements, named values, or application context."
- The user must check the box AND approve a `window.confirm()` dialog (which restates the risk) before the resubmit goes through.
- The control is **not** sticky: the checkbox state lives only in `state.chatPreservationOverride` for the duration of one resubmit.

### 6. Helpers exported

New constants and helpers exported from `server.js`:

- `PRESERVATION_OVERRIDE_CATASTROPHIC_FLOOR` — `0.10`. Keyword retention floor below which the override does not apply.
- `recordPreservationOverrideTelemetry(row)` — appends a row to `data/preservation_override_log.json`. Caps the file at 1000 rows.
- `readPreservationOverrideTelemetry()` — returns the full array for tests / inspection.
- `PRESERVATION_FAILED_CATASTROPHIC_REPLY_NOTE` — the user-facing decline note for the catastrophic-with-override case (mirrors `PRESERVATION_FAILED_REPLY_NOTE` but names the override).

## Consequences

### Positive

- The user's recurring friction ("revision declined") is resolved: every decline now has a one-click escape that bypasses the validator for that message.
- The catastrophic case (90%+ content loss, e.g. the original paint-spec failure) remains blocked, so the protection ADR 0012 was built for is preserved.
- The override is observable: `data/preservation_override_log.json` makes the override rate visible to future threshold tuning.
- The contract change is additive: existing clients that don't know about the flag see no change.
- No schema migration, no new endpoints, no new persistent state.

### Negative / Risk

- Users will sometimes opt-in to overrides they didn't intend. The `window.confirm()` dialog is the safety net; it is one extra click but matches the project's existing confirmation pattern (e.g. `deleteChatSession` uses `confirm()`).
- Telemetry file grows over time. Capped at 1000 rows; if the cap becomes a real constraint, future ADR can promote to a rolling-window file or to a structured log.
- The 0.10 catastrophic floor is a judgement call. A user who genuinely wants the catastrophic case ("rewrite the prompt with NONE of the original content, I want a fresh take") will hit the floor. The path forward for that user is to use the existing "Try as rewrite" affordance (which uses the wholesale-rewrite marker) or to edit manually — both of which the user already has.

### Reversibility

Easy. To roll back: remove the override UI, remove the override field from the route bodies, restore the validator gate. The telemetry file can be left in place (it's append-only and small) or deleted. Total diff: ~150 LOC server, ~80 LOC frontend, ~12 tests, 1 ADR. Single slice, single review, single commit.

## 3-criteria test (PRINCIPLES.md §8)

- **Hard to reverse?** No — single slice, single commit, additive field on existing request body.
- **Surprising?** Moderate — developers reading the chat route may not expect a request-time flag to bypass a server-side validator. The flag name (`preservation_override`) and the explicit ADR make the surprise legible.
- **Trade-off / scope?** Yes — explicitly chooses "per-message + confirmation + catastrophic floor" over "sticky global toggle" or "no floor". That trade-off should be on record (it is).

→ **ADR-worthy. Filed as ADR 0029.**
