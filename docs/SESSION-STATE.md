# SESSION-STATE.md Template

**Usage:** Maintained across every session. The very first thing future-me (or future-you) reads on project open.

**Versioning notes (v1 → v2):**
- v2 additions: Blocked-by column in slice tracker, Code-review verdict per slice, Context-window column (which slice ran in fresh context vs carried over), Code-review file pointer. Source: mattpocock/skills/engineering — `to-tickets` blocking edges + `implement` per-slice context discipline.
- v1 sections preserved: At-a-glance, Project summary, Slice tracker, Decisions, Blockers, Open questions, Mood, How-to-use.

---

# Session State: image-to-prompt

**Last updated:** 2026-07-29 at end of session #{{N}}

---

## At-a-glance

| Field | Value |
|---|---|
| **Workflow** | Greenfield / Existing (re-ingest) |
| **Current phase** | Sync / Spec / Architecture / Slices (slice N of M) / Polish / Done |
| **Last completed slice** | Slice N — image-to-prompt |
| **Currently in** | Slice N — image-to-prompt ({{WHAT_WE'RE_DOING_NOW}}) |
| **Open questions** | {{COUNT}} — see §5 |
| **Kill criteria status** | {{0_TRIGGERED / 1_TRIGGERED — see SPEC §11}} |
| **Next action** | {{ONE_SENTENCE}} |

---

## 1. Project summary (one paragraph for cold start)

{{PROJECT_SUMMARY}}

## 2. Slice tracker

| # | Slice | Blocked by | Status | Commit | Code-review verdict | Context | Notes |
|---|---|---|---|---|---|---|---|
| 1 | image-to-prompt | — | ✅ / 🚧 / ⏸ | {{SHA}} | pass / pass+minor / fail / reject | fresh / carried | {{NOTES}} |
| 2 | image-to-prompt | Slice 1 | ✅ / 🚧 / ⏸ | {{SHA}} | pass / pass+minor / fail / reject | fresh / carried | {{NOTES}} |
| 3 | image-to-prompt | Slices 1, 2 | ✅ / 🚧 / ⏸ | {{SHA}} | pass / pass+minor / fail / reject | fresh / carried | {{NOTES}} |

**Legend:**
- Status: ✅ done, 🚧 in progress, ⏸ blocked
- Code-review verdict: from `docs/CODE-REVIEW-{{N}}-{{SLICE}}.md`. Each slice has its own review file
- Context: `fresh` = this slice ran in a fresh context window (per PRINCIPLES.md P15); `carried` = continued from prior context

### Frontier

The set of slices whose **Blocked by** list is all done. Work these next, in any order. For a linear chain that's top-to-bottom.

If the frontier is empty but slices remain, all remaining slices are blocked. Resolve blockers before coding.

## 3. Decisions since last session

New ADRs added to DECISIONS.md:

- ADR-XXX — {{TITLE}} — meets 3 criteria: hard-to-reverse ✓ / surprising ✓ / trade-off ✓

If any ADR was added, read DECISIONS.md before doing anything else. Per PRINCIPLES.md §8, an ADR only gets written when all three criteria are met — so any new ADR is load-bearing.

## 4. Blockers / parked items

- {{BLOCKER_1}} — owner: {{WHO}} — resolution: {{HOW_IT_UNBLOCKS}}
- {{BLOCKER_2}} — owner: {{WHO}} — resolution: {{HOW_IT_UNBLOCKS}}

If the list is non-empty, the next session should triage before coding. **Do not start the next frontier slice while blockers exist** — opening it would either (a) put the new slice into ⏸ state too, or (b) cause scope creep to work around the blocker.

## 5. Open questions (from SPEC.md §12)

- {{Q_1}} — owner: {{WHO}} — status: open / resolved → ADR-{{N}} if it earned one
- {{Q_2}} — owner: {{WHO}} — status: open / resolved

When an open question resolves:
- If it earns an ADR (3 criteria met) → add to DECISIONS.md, reference here.
- If it sharpens a domain term → add to CONTEXT.md, reference here.
- If it's a lightweight choice → add to DECISIONS.md "Lightweight decisions" section.

## 6. Code-review trail

One CODE-REVIEW file per slice, in `docs/CODE-REVIEW-{{N}}-{{SLICE}}.md` (template: `templates/CODE-REVIEW.md`). The summary verdict per slice lives in the tracker above; the full Standards + Spec reports live in the review file.

## 7. Mood / risk flag

A one-line gut check from the last session:

> {{ONE_LINE}}

Examples:
- "On track, but slice 4 (auth) is the riskiest one — pre-mortem said so."
- "Scope creep risk. Two items parked in BACKLOG.md this session. Caught before code."
- "We hit a hard bug in slice 5; switched to diagnosing-bugs skill; feedback loop took 90s to build. Fixed with regression test. No slice slip."
- "Context window getting heavy. Forks from sync+spec are safe to compact; per-slice work is fresh by default."

---

## How to use this file

**Opening the project:**
1. Read the At-a-glance table.
2. Read §1 (project summary) and §7 (mood).
3. Check §2 frontier — that's what to work on next.
4. Check §4 blockers — if non-empty, triage before coding.
5. If §3 has new ADRs, read DECISIONS.md.
6. If §6 has code-review files for the slice you're about to start, skim them so you know what the prior slices got wrong.

**During the session:**
- Update at end of every slice, not end of session. (Slippage compounds otherwise.)
- Append new ADRs to DECISIONS.md **inline** the moment the decision crystallises (per `domain-modeling` discipline). Don't batch.

**At end of session:**
- Refresh the At-a-glance table (kill-criteria status, next action).
- Append any new ADRs.
- Update the Mood line.
- If a wide refactor is in progress (per PRINCIPLES.md §6.3), note where the Expand / Migrate batches / Contract sequence currently sits.