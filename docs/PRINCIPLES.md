# Application Development Methodology

**Author:** Goose
**Version:** 2.0 (2026-07-29) — upgraded after deep comparison with mattpocock/skills/engineering
**Purpose:** A controlled, repeatable, hard-to-mess-up workflow for building **new** apps/sites and **understanding/continuing** existing ones.

This document is the *single source of truth* for how we work. If anything in another artifact contradicts this, this wins.

**Versioning notes (v1 → v2):**
- v1: 12 principles, 8 anti-patterns
- v2 additions: codebase-design vocabulary, Fowler smell baseline, context-clearing rule, wide-refactor (expand-contract) handling, prototype-detour rule, diagnosing-bugs as escape hatch, user-stories and testing-decisions in spec, blocked-by per slice, code-review per slice, CONTEXT.md glossary file
- See `COMPARISON-MATTPOCOCK.md` for the full diff vs mattpocock/skills/engineering

---

## 1. Core Principles

These are non-negotiable. They are not aspirational; they are mechanical. Every phase below enforces them.

| # | Principle | What it means in practice |
|---|---|---|
| P1 | **Spec before code** | No code is written until SPEC.md is approved by you. |
| P2 | **Sync before action** | I reflect back what I heard in my own words; you confirm or correct. |
| P3 | **Challenge before commit** | Before approving a phase, I argue against it. You decide. |
| P4 | **Vertical slices only** | One demoable end-to-end feature per slice. Never a layer. |
| P5 | **One slice at a time** | Sequential by default. Parallel sub-agents only for genuinely independent work. |
| P6 | **Red before green** | Tests first (where applicable). Implementation only enough to pass. |
| P7 | **No speculative features** | If a slice's test doesn't require it, it doesn't exist. |
| P8 | **Demo before next slice** | After every slice I show a working artifact + screenshot (if UI). No "trust me, it works." |
| P9 | **Decisions are recorded** | Every Phase 1–2 decision is appended to DECISIONS.md with a reason. |
| P10 | **Kill is a feature** | Killing a bad project is success, not failure. Kill criteria are pre-committed. |
| P11 | **Sessions are continuous** | SESSION-STATE.md is the recovery document. Future-me reads it first. |
| P12 | **Audit gates are mandatory** | Accessibility + visual + prose cleanup before declaring done. |
| **P13** | **Terms are sharp** | Domain terms are defined in `CONTEXT.md` and used exactly. Overloaded terms are flagged and sharpened immediately, not deferred. |
| **P14** | **Wide refactors expand-contract** | When a refactor fans across the codebase (rename, retype, schema column), the slice is *not* vertical. Use expand → migrate batches → contract sequence. See §6.3. |
| **P15** | **Fresh context per slice is the default** | Each slice runs in a fresh context window. Cross-session continuity happens *between* slices via SESSION-STATE.md, not within one. See §6.4. |
| **P16** | **Code-review per slice** | After tests pass + visual demo, before commit, run the two-axis review (Standards + Spec) per `templates/CODE-REVIEW.md`. See §6.5. |
| **P17** | **Hard bugs get the diagnosing-bugs escape hatch** | When a bug resists a first glance, switch to the `diagnosing-bugs` skill until you have a tight feedback loop. Do not theorise without one. See §6.6. |
| **P18** | **Prototype detour for hard design questions** | If a design question can't be settled on paper (state model, UI shape), branch to a throwaway prototype per the `prototype` discipline. Fold the answer back, delete the code. See §6.7. |

## 2. Workflows

There are two workflows. Pick the right one at the start.

### 2a. Greenfield workflow (new project)
For new apps/sites with no existing code.

```
Idea → Sync → Spec → Architecture → Slices → Polish → Ship
```

### 2b. Existing-project workflow (reverse-engineer + continue)
For projects that already exist, where we need to understand them first.

```
Ingest → Recon → Synthesize → Spec (delta) → Plan slices → Execute → Polish → Hand off
```

The existing-project workflow always starts with the **Ingest** phase. We do not skip it, no matter how simple the codebase looks. AI agents that skip reconnaissance rewrite working code.

## 3. Phase Gates

A **gate** is a checkpoint where the human must explicitly approve before we move on. Gates exist because AI assistants don't reliably self-correct on subjective calls (design, scope, tone).

| Gate | When | Who approves | What is required to approve |
|---|---|---|---|
| G1 | After Sync | You | I reflect the idea back; you say "yes, that's it" |
| G2 | After Spec | You | SPEC.md exists, has Definition of Done, kill criteria are set, terms are in CONTEXT.md |
| G3 | After Architecture | You | Stack + file layout + slice list exist; risks + pre-mortems are stated; seams named |
| G4 | Per slice | You (checkpoint) | Tests pass + (if UI) visual screenshot reviewed + code-review verdict from CODE-REVIEW.md |
| G5 | Before declaring done | You | Polish audit completed; nothing in BACKLOG.md is "must have" |

If you decline at any gate, we **do not** advance. We either amend the upstream artifact and re-review, or kill.

## 4. Anti-patterns (project-flow level)

I will refuse to do any of these. If I notice myself doing one, I stop and call it out.

- A1. **Premature code** — writing code before SPEC.md is approved.
- A2. **Layer-first thinking** — "build all the models" then "build all the routes" then "build all the UI." This produces a non-working app for a long time, then a fragile app forever.
- A3. **Speculative features** — adding hooks, configs, or abstractions for "what we might need later." 90% of them are wrong guesses.
- A4. **Silent scope creep** — adding work without updating SPEC.md and asking.
- A5. **Tests as afterthought** — writing implementation first, then tests that confirm the implementation.
- A6. **Trust-me-demo** — claiming a slice is done without showing it actually works (screenshot, run output, or live preview).
- A7. **Doc rewrite instead of append** — overwriting SPEC.md so decision history is lost.
- A8. **Continued investment past kill criteria** — "just one more iteration."
- **A9. **Implementation-coupled tests**** — tests that mock internal collaborators, test private methods, or verify through a side channel (e.g. querying the database instead of the interface). The tell: the test breaks on a refactor when behaviour hasn't changed.
- **A10. **Tautological tests**** — assertions that recompute the expected value the way the code does (`expect(add(a,b)).toBe(a+b)`, snapshots derived by hand the same way). Passes by construction. Expected values must come from an independent source of truth: a known-good literal, a worked example, the spec.
- **A11. **Horizontal slicing**** — writing all tests first, then all implementation. Bulk tests verify *imagined* behaviour: you test the shape of things rather than user-facing behaviour, the tests go insensitive to real changes. Work in vertical slices.
- **A12. **Fuzzy terms as scaffolding**** — using overloaded or undefined domain words in code, tests, or commits without sharpening them in `CONTEXT.md`. ("Account" doing three jobs, "session" meaning two things, etc.)

## 5. Doc Layout

Every project gets a `/docs` directory with this layout. Some files are created in Phase 1, some in Phase 2, some in Phase 3. None are created speculatively.

```
project-root/
  docs/
    CONTEXT.md          ← created in Phase 1 when first term is resolved
    SPEC.md             ← Phase 1 (gate G2)
    ARCHITECTURE.md     ← Phase 2 (gate G3)
    DECISIONS.md        ← Phase 2 onward (append-only ADR log)
    PRE-MORTEM.md       ← Phase 2 (gate G3)
    BACKLOG.md          ← created in Phase 3 when stretch items arise
    SESSION-STATE.md    ← maintained across sessions (P11)
    CODE-REVIEW.md      ← one per slice (P16)
    POLISH-AUDIT.md     ← Phase 4 (gate G5)
```

Templates for each are in `~/.goose/methodology/templates/`.

## 6. Discipline Add-Ons (v2 — from mattpocock integration)

### 6.1 Codebase-design vocabulary

Use these terms exactly throughout the project. Don't substitute "component," "service," "API," or "boundary."

| Term | Definition |
|---|---|
| **Module** | Anything with an interface and an implementation. Scale-agnostic: function, class, package, or tier-spanning slice. |
| **Interface** | Everything a caller must know to use the module: signature + invariants + ordering + error modes + config + perf characteristics. |
| **Implementation** | What's inside a module. Distinct from **Adapter**: a Postgres repo is a small adapter with a large implementation; an in-memory fake is a large adapter with a small implementation. |
| **Depth** | The amount of behaviour behind a small interface. A module is **deep** when callers get a lot per unit of interface they have to learn. **Depth is a property of the interface, not the implementation.** |
| **Seam** | A place you can alter behaviour without editing in that place. The location where a module's interface lives. |
| **Adapter** | A concrete thing that satisfies an interface at a seam. Describes role, not substance. |
| **Leverage** | What callers get from depth: more capability per unit of interface they learn. One implementation pays back across N call sites and M tests. |
| **Locality** | What maintainers get from depth: change, bugs, knowledge, and verification concentrate in one place. Fix once, fixed everywhere. |

**Design tests:**

- **The deletion test** — imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface** — callers and tests cross the same seam. If you want to test past the interface, the module is probably the wrong shape.
- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a seam unless something actually varies across it.

### 6.2 Smell baseline (Fowler)

The Standards axis of every CODE-REVIEW.md runs this baseline in addition to any repo-specific standards. Each smell is a labelled heuristic, never a hard violation.

| Smell | What it is | Fix |
|---|---|---|
| **Mysterious Name** | Function/variable/type whose name doesn't reveal what it does | Rename; if no honest name comes, the design's murky |
| **Duplicated Code** | Same logic shape appears in more than one hunk/file | Extract the shared shape |
| **Feature Envy** | Method that reaches into another object's data more than its own | Move the method onto the data it envies |
| **Data Clumps** | Same few fields/params keep travelling together | Bundle them into one type |
| **Primitive Obsession** | Primitive/string standing for a domain concept that deserves a type | Give the concept its own small type |
| **Repeated Switches** | Same switch/if-cascade on the same type recurs across the change | Replace with polymorphism or a shared map |
| **Shotgun Surgery** | One logical change forces scattered edits across many files | Gather what changes together into one module |
| **Divergent Change** | One file/module edited for several unrelated reasons | Split so each module changes for one reason |
| **Speculative Generality** | Abstraction/params/hooks added for needs the spec doesn't have | Delete it; inline back until a real need shows |
| **Message Chains** | Long `a.b().c().d()` navigation the caller shouldn't depend on | Hide the walk behind one method on the first object |
| **Middle Man** | Class/function that mostly just delegates onward | Cut it; call the real target directly |
| **Refused Bequest** | Subclass/implementer that ignores most of what it inherits | Drop inheritance, use composition |

**Repo standard overrides baseline.** A documented repo convention always wins. Smells tooling already enforces are skipped.

### 6.3 Wide refactors: expand → migrate batches → contract

A vertical slice cannot land green when the change fans across thousands of call sites at once. Examples:
- Rename a database column.
- Retype a shared symbol.
- Migrate all uses of one library to another.

For these, the sequence is:

1. **Expand.** Add the new form *beside* the old. Nothing breaks. Tests still pass against the old form. New code can use the new form.
2. **Migrate batches.** Walk the codebase, batched by blast radius (per package, per directory). Each batch is its own ticket, blocked by the Expand ticket. CI stays green batch-to-batch because the old form still exists.
3. **Contract.** Once no caller uses the old form, delete it in a final ticket blocked by every migrate batch.

If even batches can't stay green alone, the sequence holds but they share an integration branch; green is promised only at a final integrate-and-verify ticket.

### 6.4 Context-clearing between slices (the smart zone)

Default: each slice runs in a **fresh context window**. Reasoning:

- A long context drifts; the model can lose its way mid-phase.
- A fresh context loads only SESSION-STATE.md + the relevant slice + relevant ADRs.
- Cross-session continuity lives in the docs, not in the context.

Exception: keep one window for the entire **Phase 1 sync + spec** sequence (so the grilling + spec build on the same thinking). Past gate G2, slices are independent.

**When the smart zone approaches** (~120k tokens on state-of-the-art models), do not push on degraded context. Compact or fork a new session per the recipe's session-crossing rules.

### 6.5 Code-review per slice

After every slice passes tests + visual demo, run **two-axis review** per `templates/CODE-REVIEW.md`:

1. **Standards axis** — does the code conform to the repo's documented standards + the smell baseline? Run as one sub-agent.
2. **Spec axis** — does the code faithfully implement the originating slice? Run as another sub-agent, in **parallel** so contexts don't pollute each other.

Both run as parallel `general-purpose` sub-agents. Aggregate the two reports side-by-side. **Do not merge or rerank findings across axes.** A change can pass one and fail the other; running them separately is the point.

Each sub-agent gets:
- The diff command (`git diff <fixed-point>...HEAD`)
- The commit list
- Either the standards sources (file paths + the smell baseline for the Standards agent) or the spec source (for the Spec agent)

Output under 400 words per agent.

Verdict options:
- **Pass** — commit as-is
- **Pass with minor** — fix N items in this commit
- **Fail** — major rework needed
- **Reject** — slice does not match the spec

### 6.5a Frontier discipline (blocking edges)

Every slice in `SPEC.md` §9 declares a **Blocked by** list — the other slices that must complete before it can start. A slice with no blockers can start immediately.

The **frontier** is the set of slices whose Blocked-by are all done. We work the frontier, in any order. For a purely linear chain that's top-to-bottom; for a graph it might be several slices at once (still handled sequentially by one agent, but the spec can show the parallelism visually).

**Operational rules:**

- **Frontier recompute at every slice close.** After committing a slice, recompute the frontier in `SESSION-STATE.md` §2. Note any newly-unblocked slices.
- **Do not start a slice outside the frontier.** Even if a slice "looks ready," if its blockers aren't done, starting it produces either (a) work that has to be redone when the blocker lands, or (b) scope creep to work around the blocker. Both are silent-killers.
- **A blocked slice's status in the tracker is `⏸ blocked` (not `🚧 in progress`).** This prevents accidentally picking it up in a future session.
- **Blocker resolution is its own work.** If a blocker reveals new scope, that scope becomes either a new slice (added to `SPEC.md` §9) or a new ADR — never an in-flight extension of the blocked slice.
- **Wide refactors reshape the graph.** Expand-contract slices (P14 / §6.3) have blocking edges too: Expand → Migrate batches → Contract. The frontier discipline still applies; it just looks like a fan-in at the end.

**Why this matters:** without frontier discipline, agents start slices optimistically, work around blockers, ship something that *looks* done, and then have to redo it. Frontier discipline is what makes the slice plan actually executable as written.

### 6.6 Diagnosing-bugs as escape hatch

When a bug resists a first glance — the bug that resists a first attempt, the intermittent flake, the regression between two known-good states — switch to the `diagnosing-bugs` skill until you have a **tight feedback loop** (one command that already goes red on *this* bug). Then fix with a regression test.

Refuse to theorise without a loop. The loop is the skill.

If diagnosing reveals the real finding is "there's no good seam to lock this down at," hand off to `improve-codebase-architecture` for a deepening pass before fixing.

### 6.7 Prototype detour for hard design questions

If a design question can't be settled on paper — "does this state model feel right," "what should this UI look like" — branch to a throwaway prototype:

- **Logic question** → tiny terminal app that pushes the state through hard cases. State in memory. Surface the state after every action.
- **UI question** → several radically different UI variations on a single route, switchable via URL param + floating bar.

Rules:
1. Throwaway from day one, clearly marked.
2. One command to run.
3. No persistence by default.
4. Skip the polish — no tests, no abstractions.
5. Fold the validated decision back into the real code. Capture the prototype itself on a throwaway branch with a context pointer from the implementation ticket. Delete from main.

If prototyping blocks more than a session's worth, consider Wayfinder fork (see §7.3).

## 7. Wayfinder Fork (for genuinely foggy efforts)

The standard workflow assumes the path is clear by Phase 1. For **huge, foggy efforts** — too big for one session, the route not visible yet — fork to **Wayfinder discipline** before Phase 1.

### 7.1 When to fork to Wayfinder

- Effort is too big to hold in one context window.
- The way from "here" to "done" is not visible yet.
- Naming the destination is itself unclear.

### 7.2 Wayfinder mechanics (abbreviated)

- Name the **destination** first via a grilling session. The destination fixes the scope.
- Chart a **shared map** as a `wayfinder:map` index issue. Body: Destination, Notes, Decisions-so-far (index only, not store), Not-yet-specified (fog), Out-of-scope.
- Each ticket on the map is a **decision ticket**, not a build ticket. The map produces **decisions, not deliverables**.
- Resolve one ticket per session. Each resolution may graduate fog into new tickets, or rule something out of scope.
- When the fog clears, hand off to **to-spec** (collapse the linked decisions into a buildable spec), then continue at Phase 3 of the standard workflow.

### 7.3 Fog of war

Beyond the live tickets lies the fog — decisions you can tell are coming but can't yet pin down because they hang on questions still open. Resolve a ticket, clear the fog ahead of it, graduate whatever's now specifiable into fresh tickets. The map's **Not-yet-specified** section is where that dim view lives.

**Fog or ticket?** The test is whether you can state the question precisely now — *not* whether you can answer it now.
- Ticket when the question is already sharp, even if blocked.
- Not-yet-specified when you can't yet phrase it that sharply.

## 8. ADR Discipline (the 3 criteria)

`DECISIONS.md` is append-only. But not every decision is an ADR. An ADR is only written when **all three** criteria are met:

1. **Hard to reverse** — the cost of changing your mind later is meaningful.
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and we picked one for specific reasons.

If any one is missing, skip the ADR. Note the decision in `SESSION-STATE.md` instead, or inline in `SPEC.md`/`ARCHITECTURE.md`.

ADRs use this exact format:

```
# ADR-NNN: {{TITLE}}
- Date: ...
- Status: Accepted | Superseded by ADR-XXX
- Context: ...
- Decision: ...
- Consequences: ...
- Alternatives considered: ...
```

## 9. Slicing Rules

A vertical slice must pass **all four** checks:

1. **End-to-end.** Touches UI + logic + data, OR the closest analog for non-UI apps.
2. **Demoable.** There is a concrete action you can take to see it work.
3. **Small.** Roughly 1–3 hours of focused work, fits one fresh context window.
4. **Tested.** Has a test that fails before, passes after.

If a candidate slice fails any of these, it gets broken down further. **Exception:** wide refactors use expand-contract (P14 / §6.3) instead.

## 10. Session Continuity Rules

- SESSION-STATE.md is updated **at the end of every slice**, not at the end of every session.
- The session that opens the project reads SESSION-STATE.md **first**, before any other context.
- DECISIONS.md is **append-only**. Corrections are added as new entries, not edits to old ones.
- CONTEXT.md is **append-only** for term definitions. Changed terms get a new entry that says "supersedes the entry above."

## 11. Kill Criteria

These are set at gate G2 and enforced by gate G5 (and informal checkpoints).

Examples (project-specific, not universal):
- "If we exceed N sessions, kill."
- "If slice count exceeds N, kill."
- "If the schema needs >2 major revisions, kill."
- "If we discover the user's problem is solved better by X, kill."

The criteria are not negotiable in the moment. They are pre-commitments.

## 12. Tooling

- **Spec / docs:** plain Markdown in `/docs/`.
- **TODO tracking:** `todo` tool (persists across compaction).
- **Sub-agents:** only for genuinely independent slices (P5) and for the two axes of code-review (P16 / §6.5). Each sub-agent receives the relevant slice spec + DECISIONS.md excerpt — nothing else.
- **Visual check:** `chromedevtools` (you already have it enabled).
- **Background research:** `delegate` tool with the `summon` extension for primary-source investigation.
- **Persistence:** git. Each slice is a commit. No "we'll commit later."