# AGENTS.md — image-to-prompt

**Purpose:** The first file any agent (human or AI) reads when they open this project. Tells them how to work here.

**Structure:** Two sections, in order —
1. **Project runtime** — agent skills, session-init, issue tracker, triage, domain docs, drift prevention, success criteria. Project-specific.
2. **Methodology** — the App Build v2 workflow (gates G1–G5, gates, decision log, code review per slice). General; comes from `~/.goose/methodology/`.

**Maintenance:** Edit only when something genuinely changes. This is not a changelog. If you change the methodology section, mirror it to `~/.goose/methodology/bootstrap/AGENTS.md` so future projects get the same update.

---

## 1. Project runtime — agent skills

### Session initialization

Every session begins by running `node scripts/session-init.js` to load the
project's current state. The script emits a normalized snapshot to
`.opencode/state/session-latest.json` and validates against ten checks (V1–V10).
The mechanism is documented in `docs/agents/session-init.md` (this file's
peer); the acceptance gate is in `docs/agents/success-criteria.md`.

If validation pass rate is below 100%, follow `docs/agents/drift-prevention.md`
§3 before any other work.

### Issue tracker

Issues are tracked in GitHub Issues (using the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Bug resolution workflow

When a bug is reported, follow `docs/agents/bug-workflow.md` (triage → class →
label → file → priority → fix → verify).

### Feature request workflow

When a feature is requested, follow `docs/agents/feature-workflow.md`
(requirements → feasibility → design → implement → verify).

### Triage labels

The default triage label vocabulary is used: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `CONTEXT.md` (at the repo root) and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

> **Note:** `docs/CONTEXT.md` is a symlink to the root `CONTEXT.md` so the
> App Build methodology's pointer works. Do not write to one without writing
> to the other; they're the same file. The ADR home is `docs/adr/NNNN-*.md`
> (one file per ADR), which is the format this project has used since the
> beginning — the methodology's `DECISIONS.md` template has been removed
> because it would be a duplicate home.

### Drift prevention

Operational protocol for drift detection and mitigation. See `docs/agents/drift-prevention.md`.

### Success criteria

Measurable acceptance criteria for the session initialization mechanism. See `docs/agents/success-criteria.md`.

---

## 2. Methodology — App Build v2

This project also follows the **App Build methodology v2** — a controlled, gate-based, spec-first workflow for ongoing work. The full reference is in `docs/PRINCIPLES.md`. Read it before doing anything substantive.

### On cold-start (every new session)

1. **Read this file** (you're doing it).
2. **Run `node scripts/session-init.js`** (project-runtime step above). This validates against V1–V10.
3. **Read `docs/PROJECT-README.md`** — one-page project overview.
4. **Read `CONTEXT.md`** — the project glossary (sharp domain terms). It's the same file as `docs/CONTEXT.md` (symlinked).
5. **Read `docs/SESSION-STATE.md`** — at-a-glance current state, last completed slice, frontier, open questions, mood.
6. If `docs/SESSION-STATE.md` §3 lists new ADRs since last session, read those entries in `docs/adr/NNNN-*.md`.
7. If `docs/SESSION-STATE.md` §4 lists blockers, triage before coding.

### What you can do without asking

- Read any file under `docs/`.
- Read any code file.
- Run tests, linters, type-checkers.
- Use `chromedevtools` for browser verification.
- Use the `tdd`, `diagnosing-bugs`, `domain-modeling`, `codebase-design`, `frontend-design`, `accessibility`, `copywriting`, `stop-slop` skills when relevant.
- Add entries to `CONTEXT.md` and `docs/BACKLOG.md` (append-only).
- Add new ADRs to `docs/adr/` when all 3 criteria (PRINCIPLES.md §8) are met.
- Park non-slice work in `docs/BACKLOG.md`.

### What you must ask before doing

- **Write code that crosses a seam.** No new code that touches more than one module until the slice plan is in `docs/SPEC.md` and approved.
- **Edit `CONTEXT.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/SESSION-STATE.md`, `docs/PRE-MORTEM.md`, `docs/BACKLOG.md`, `docs/adr/*.md`.** Append-only. Corrections are new entries, never edits.
- **Advance past a gate (G1–G5).** Every gate requires explicit user approval.
- **Commit.** Verify the slice's tests pass + visual demo is reviewed + `docs/CODE-REVIEW-{{N}}-{{SLICE}}.md` verdict is `pass` or `pass+minor` first.
- **Write an ADR.** Only when all 3 criteria are met (see `docs/PRINCIPLES.md` §8). ADRs go in `docs/adr/NNNN-*.md`, not in `docs/DECISIONS.md` (which has been removed).
- **Adopt a new dependency, change the stack, or rename a shared symbol.** These are wide refactors — use the expand-contract sequence per `docs/PRINCIPLES.md` §6.3.
- **Skip the demo gate (G4).** No "trust me, it works." The slice must be runnable.
- **Skip the code-review step before committing.** Two-axis review (Standards + Spec) is mandatory.

### What to do when you don't know

- **The idea is fuzzy.** Read `docs/PRINCIPLES.md` §7 (Wayfinder fork). If the effort is too foggy or too big for one session, fork to Wayfinder first.
- **A bug resists a first glance.** Switch to the `diagnosing-bugs` skill per `docs/PRINCIPLES.md` §6.6. Build a tight feedback loop before theorising.
- **A design question can't be settled on paper.** Branch to a throwaway prototype per `docs/PRINCIPLES.md` §6.7. Fold the answer back, delete the code.
- **A term is fuzzy or overloaded.** Challenge it inline. Sharpen it. Update `CONTEXT.md` (don't batch).
- **A slice you want to do has a blocker.** Don't start it. Work the frontier (slices whose Blocked-by are all done) per `docs/PRINCIPLES.md` §6.5a.
- **You're tempted to add "just one more thing" that's not in the slice.** Park it in `docs/BACKLOG.md`. Don't speculatively build it.
- **A kill criterion is met.** STOP. Do not push through. Report it.

### Output discipline

- Be terse. Be structured. Be disciplined.
- Show the diff, not a description of the diff.
- After every slice, update `docs/SESSION-STATE.md` *before* you commit.
- After every ADR-worthy decision, append to `docs/adr/` *inline*.
- After every slice, create `docs/CODE-REVIEW-{{N}}-{{SLICE}}.md` *before* you commit.

### The five gates, in order

| Gate | Artifact | What approval means |
|---|---|---|
| G1 | Sync (one-paragraph reframe + assumptions + challenge) | "Yes, that's what I want." |
| G2 | `docs/SPEC.md` complete | "Approve this spec, or amend." |
| G3 | `docs/ARCHITECTURE.md`, `docs/PRE-MORTEM.md`, ADRs in `docs/adr/` | "Approve this architecture, or amend." |
| G4 | Per slice: tests pass + visual demo + `docs/CODE-REVIEW-{{N}}-{{SLICE}}.md` verdict | "Approve this slice, or amend." |
| G5 | `docs/POLISH-AUDIT.md` complete | "Ship it." |

You may not advance past a gate without an explicit "yes."

### Quick reference: file roles (this project)

| File | Role | Edit mode |
|---|---|---|
| `AGENTS.md` (this file) | Project + methodology instruction file | Edit when the project genuinely changes |
| `CONTEXT.md` (= `docs/CONTEXT.md` via symlink) | Domain glossary | Append-only |
| `docs/PROJECT-README.md` | One-page project overview | Edit freely |
| `docs/SPEC.md` | What we're building (delta slices) | Append-only |
| `docs/ARCHITECTURE.md` | How the pieces fit | Append-only |
| `docs/PRE-MORTEM.md` | Top risks + pre-commitments | Append-only |
| `docs/SESSION-STATE.md` | Cold-start recovery | Updated per slice |
| `docs/BACKLOG.md` | Parked / stretch work | Append-only |
| `docs/CODE-REVIEW-{{N}}-{{SLICE}}.md` | Per-slice review | Append-only (one per slice) |
| `docs/POLISH-AUDIT.md` | Final ship audit | Append-only |
| `docs/RECON.md` | Existing-project inventory | Append-only |
| `docs/SYNTHESIS.md` | Existing-project mental model | Append-only |
| `docs/adr/NNNN-*.md` | ADRs (one file each) | Append-only — **the project's ADR home** |
| `docs/PRINCIPLES.md`, `docs/EXISTING-PROJECT-WORKFLOW.md`, `docs/COMPARISON-MATTPOCOCK.md` | Methodology reference (read-only) | Never edit |
| `docs/agents/*` | Project-runtime agent workflows (session-init, triage, drift) | Per project-runtime policy |

---

## How to invoke the recipe

From a terminal, with the methodology installed at `~/.goose/methodology/`:

```bash
export GOOSE_RECIPE_PATH=~/.goose/methodology/recipes
goose run start-app --workflow existing  --idea "$PWD"
```

Or, in any goose session:

> *"Run app-build workflow on this project. Existing."*

The recipe drives every gate with explicit approval.

---

## One-line project description

> An AI-powered web app that transforms uploaded images into refined, detailed text prompts optimized for AI image generation models (SD, Midjourney, DALL-E, Flux), powered by MiniMax M3.