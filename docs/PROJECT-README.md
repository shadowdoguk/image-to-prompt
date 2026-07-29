# PROJECT-README.md Template

**Usage:** One-page project overview. Lives at `docs/PROJECT-README.md`. Edit freely as the project state changes. This is the file a stranger reads to understand what this project is, in 60 seconds.

---

# image-to-prompt

**Workflow:** existing
**Created:** 2026-07-29

---

## What this is (one paragraph)

{{ONE_PARAGRAPH_DESCRIPTION}}

## Why it exists (the problem it solves)

{{PROBLEM_STATEMENT}}

## Who it's for (the primary user)

{{PRIMARY_USER}}

## The ONE thing it does well

> {{ONE_THING}}

If this project succeeds, this is the single capability it nails.

## Current status

| Field | Value |
|---|---|
| Phase | Sync / Spec / Architecture / Slices (slice N of M) / Polish / Done |
| Last completed slice | image-to-prompt |
| Frontier | {{LIST_OF_UNBLOCKED_SLICES}} |
| Open questions | {{COUNT}} |
| Kill criteria status | {{0_TRIGGERED / 1_TRIGGERED — see SPEC §11}} |
| Session count | {{N}} |

## Where to start reading

**Cold start (60 seconds):**

1. **You are here.** ✓
2. `docs/AGENTS.md` — how to work in this project (in the repo root).
3. `docs/CONTEXT.md` — the project glossary (sharp domain terms).
4. `docs/SESSION-STATE.md` — current state, frontier, mood.
5. If new ADRs since you last looked, read those in `docs/DECISIONS.md`.

**Cold start (5 minutes):**

6. `docs/SPEC.md` — what we're building.
7. `docs/ARCHITECTURE.md` — how the pieces fit.
8. `docs/PRE-MORTEM.md` — top risks + pre-commitments.
9. `docs/BACKLOG.md` — parked / stretch work.
10. The most recent `docs/CODE-REVIEW-{{N}}-{{SLICE}}.md` — to see how prior slices were reviewed.

## In scope

- {{IN_SCOPE_1}}
- {{IN_SCOPE_2}}

## Out of scope

- {{OUT_OF_SCOPE_1}}
- {{OUT_OF_SCOPE_2}}

## Stack (one-line per layer)

| Layer | Choice |
|---|---|
| Language | {{LANG}} |
| Framework | {{FRAMEWORK}} |
| Database | {{DB}} |
| ORM | {{ORM}} |
| Auth | {{AUTH}} |
| Hosting | {{HOST}} |
| Testing | {{TEST}} |

## Slices (current plan)

| # | Slice | Blocked by | Status |
|---|---|---|---|
| 1 | image-to-prompt | — | ✅ / 🚧 / ⏸ |
| 2 | image-to-prompt | Slice 1 | ✅ / 🚧 / ⏸ |
| 3 | image-to-prompt | Slices 1, 2 | ✅ / 🚧 / ⏸ |

See `docs/SPEC.md` §9 for the full plan with min/target/stretch + acceptance tests + user-story mappings.

## Pointers

- **Methodology reference:** `docs/PRINCIPLES.md` (read-only)
- **Existing-project discipline:** `docs/EXISTING-PROJECT-WORKFLOW.md`
- **Background on the methodology:** `docs/COMPARISON-MATTPOCOCK.md`
- **Worked example (reference):** `~/.goose/methodology/examples/reading-list/README.md` (in your method home, not this repo)

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Initial overview | — |

(Edit freely. This file is not append-only.)