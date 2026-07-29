# Comparison: Our Methodology vs mattpocock/skills/engineering

**Date:** 2026-07-29
**Purpose:** Honest, line-by-line comparison. What's in theirs we lack, what we have they lack, what overlaps, what disagrees. Then decisions: integrate / adapt / reject.

**Method:** Read all 17 SKILL.md files fully. Read our 13 methodology artifacts fully. Compare principle-by-principle.

---

## A. The 17 skills at a glance

Matt Pocock's repo has two kinds of skills:

**User-invoked** (`disable-model-invocation: true` — you type them):
1. `ask-matt` — router over the other skills (a "which one fits?" guide)
2. `grill-with-docs` — relentless interview, builds domain model + ADRs
3. `triage` — moves issues through state machine (needs-triage → ready-for-agent, etc.)
4. `improve-codebase-architecture` — scans for deepening opportunities
5. `setup-matt-pocock-skills` — one-time install (we skipped)
6. `to-spec` — turn conversation into spec
7. `to-tickets` — break spec into tracer-bullet tickets with blocking edges
8. `implement` — build from spec/tickets, driving `/tdd` + `/code-review`
9. `wayfinder` — for huge foggy multi-session efforts; charts a shared map of *decision* tickets

**Model-invoked** (skill can fire itself based on description):
10. `prototype` — throwaway code to answer a design question
11. `diagnosing-bugs` — disciplined debug loop
12. `research` — background agent to investigate primary sources
13. `tdd` — red-green-refactor discipline
14. `domain-modeling` — sharpen domain glossary + ADRs
15. `codebase-design` — deep-module vocabulary (module, interface, seam, depth)
16. `code-review` — two-axis review (Standards + Spec), parallel sub-agents
17. `resolving-merge-conflicts` — work through merge/rebase conflicts

---

## B. Skill-by-skill: integrate / adapt / reject / overlap

### Cluster 1 — Vocabulary & discipline (the foundations)

| Skill | Theirs | Ours | Verdict |
|---|---|---|---|
| `tdd` | Red-green loop; pre-agreed seams; anti-patterns (implementation-coupled, tautological, horizontal-slicing) | We cite TDD as discipline but don't define what a good test is or name the anti-patterns | **INTEGRATE** — bring their anti-pattern list + seam-pre-agreement into our SPEC template |
| `codebase-design` | Glossary: module, interface, depth, seam, adapter, leverage, locality. **Depth is property of the interface, not implementation.** Deletion test. "One adapter = hypothetical seam, two = real" | We have "seams" in ARCHITECTURE.md §3 but no vocabulary for depth, leverage, locality | **INTEGRATE** — add their glossary + deletion test to PRINCIPLES.md and ARCHITECTURE.md |
| `domain-modeling` | Active discipline: challenge fuzzy terms, stress-test with scenarios, update `CONTEXT.md` inline, ADR only when 3 criteria met (hard-to-reverse, surprising, real trade-off) | We have DECISIONS.md but no CONTEXT.md-equivalent; we don't challenge fuzzy terms inline | **INTEGRATE** — add a CONTEXT.md concept (project glossary), and add the "3 ADR criteria" rule to our DECISIONS.md template |

### Cluster 2 — Phase flow (idea → ship)

| Skill | Theirs | Ours | Verdict |
|---|---|---|---|
| `grill-with-docs` | One-question-at-a-time interview that *also* drives domain-modeling + writes ADRs as side effects. Stateful: retains what it learns | Our Phase 1 (Sync) is conversational but doesn't actively drive terminology or write ADRs | **INTEGRATE** — wire their grilling pattern (one-question-at-a-time, decisions captured inline) into our Phase 1 |
| `to-spec` | Synthesize conversation into a published spec. Specific template: Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope | Our SPEC.md has Re-Invented sections: Reframe / Challenge / Scope / DoD / Kill Criteria. They overlap but differ in shape | **ADAPT** — adopt their user-stories and testing-decisions sections (we lack both); keep our kill criteria (they lack it); keep our challenge section (they don't have one) |
| `to-tickets` | Break plan into **tracer-bullet** tickets, each declaring **blocking edges**. Tickets reference each other via native tracker links (or text on local files). Wide refactors get expand-contract sequencing, not vertical slices | We have slices in SPEC.md but no formal blocking edges / dependency graph | **INTEGRATE** — add a "Blocked by" line per slice in our SPEC template + a tickets-by-dep view in SESSION-STATE |
| `implement` | Builds a spec/ticket, drives `/tdd` at seams, runs `/code-review` before committing. **Clears context between tickets** | Our Phase 4 (Slices) does the same shape but we don't explicitly mention context-clearing | **ADAPT** — add the "fresh context per slice" rule to PRINCIPLES.md |
| `wayfinder` | For multi-session foggy efforts: a **map of decision tickets**, not build tickets. Resolves one ticket per session. Hits "fog of war" — knows what it doesn't know. Hands off to `to-spec` when fog clears | We have no equivalent. Our workflow assumes a clear idea at Phase 1. For genuinely foggy / huge efforts, we have nothing | **INTEGRATE** (selective) — add a "Wayfinder fork" before Phase 1 when the effort is too foggy/sized for one session |
| `prototype` | Throwaway code, two branches: LOGIC (terminal state machine) or UI (toggleable variations). One command to run, no persistence, no polish, capture as primary source on a throwaway branch | We don't have anything equivalent. Polish audit happens at the end | **INTEGRATE** — add a "Prototype detour" off Phase 3 for hard design questions |

### Cluster 3 — Maintenance & recovery

| Skill | Theirs | Ours | Verdict |
|---|---|---|---|
| `diagnosing-bugs` | "Tight feedback loop" discipline. Refuse to theorise without a loop. Throwaway harnesses. Bisection. Replay. Differential. We have it installed but it's not wired into our methodology | We don't reference it in any phase | **INTEGRATE** — call it out from PRINCIPLES.md as the escape hatch for hard bugs in any phase |
| `code-review` | Two-axis review (Standards + Spec), runs as **parallel sub-agents** so contexts don't pollute each other. Fowler smell baseline (12 named smells: Mysterious Name, Duplicated Code, Feature Envy, etc.) | We don't have a code-review step at all | **INTEGRATE** — add a code-review gate at the end of every slice (after tests pass, before commit), using the two-axis + smell baseline |
| `resolving-merge-conflicts` | Find primary source for each side, resolve by intent, never `--abort` | We don't have anything | **REJECT for now** — relevant only when there's a real merge conflict; not a methodology primitive |
| `improve-codebase-architecture` | Scan for **deepening opportunities**, render as visual HTML report, then grill the chosen one | We have nothing equivalent | **INTEGRATE (optional)** — add as a separate periodic maintenance skill, not part of build flow. Note: requires HTML report + visual rendering (Tailwind + Mermaid CDN). Defer if no time |

### Cluster 4 — Triage & issue routing

| Skill | Theirs | Ours | Verdict |
|---|---|---|---|
| `triage` | State machine for issues: needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix. Required disclaimer on every AI comment. Verifies claims. Searches for prior rejections | We have nothing equivalent | **REJECT for now** — depends on having an issue tracker configured (GitHub/Linear/local). Our user does solo dev, no tracker. Defer until they adopt one |
| `research` | Background agent investigates primary sources, writes cited Markdown to repo | We have the `delegate` tool + `summon` extension which can do this | **ADAPT** — note in PRINCIPLES.md that the `delegate` tool is the research primitive; no need for a separate skill |
| `ask-matt` | A *router* that recommends which skill to use given your situation | We have the recipe (`start-app.yaml`) which already routes between greenfield and existing | **REJECT** — we have a better routing mechanism (the recipe). Their router is for ad-hoc "I don't know which skill" — recipe doesn't need one |

---

## C. Gaps in OUR methodology they exposed

These are things mattpocock has that we don't, and that would meaningfully tighten the bulletproof-ness:

| Gap | Severity | Why it matters |
|---|---|---|
| **CONTEXT.md (project glossary)** | HIGH | Our SPEC.md mixes domain terms with implementation decisions. A dedicated glossary keeps terms sharp. Without it, "account" / "user" / "session" get overloaded and the AI silently flips meanings mid-build |
| **ADR discipline (3 criteria)** | HIGH | Our DECISIONS.md says "append decisions with reasons" but doesn't say *when* to write one. Matt's rule: only when hard-to-reverse + surprising + real trade-off. Stops ADR spam |
| **Code-review gate per slice** | HIGH | We have a "demo before commit" but no **structured** review. Tests passing ≠ code good. Two-axis review (Standards + Spec) catches scope creep, dead code, smell patterns |
| **Context-clearing between slices** | MEDIUM | Our SESSION-STATE.md implies cross-session continuity but doesn't say "fresh context window per slice is preferred." Matt's rule: each `/implement` clears context to stay in the smart zone |
| **Blocking edges between slices** | MEDIUM | Our SPEC.md lists slices in order but doesn't formally declare dependencies. "Slice N is blocked by slices A, B" prevents premature starting |
| **Wide-refactor handling (expand-contract)** | MEDIUM | Our methodology assumes vertical slicing always works. Matt correctly notes wide refactors (rename a column, retype a symbol) need a different sequence: expand → migrate batches → contract |
| **Fowler smell baseline** | MEDIUM | We name anti-patterns (A1–A8) but they're project-flow anti-patterns (premature code, scope creep). We don't have code-smell anti-patterns (Mysterious Name, Feature Envy, etc.) |
| **Fog of war concept** | MEDIUM | We assume the path is clear at Phase 1. Real projects aren't. "We know what we don't know" is a discipline |
| **Verification of claims (in triage)** | LOW | We don't verify bug claims against code before fixing. (We're not a triage tool, but the habit of "reproduce before fix" should be in diagnosing-bugs integration) |
| **Primary-source citation** | LOW | Our research outputs don't require cited sources. Matt's `research` skill does. Low impact for solo dev, high impact for shared work |

## D. Things WE have that mattpocock lacks (our wins)

| Our feature | Matt has equivalent? | Comment |
|---|---|---|
| **Challenge gate (G1)** — I argue against the project before you approve | NO | Matt's grill-with-docs sharpens ideas but doesn't adversarially challenge. Our challenge pre-mortems risk before code exists |
| **Kill criteria (pre-committed)** | NO | Matt's system has wontfix/closed issues but not pre-committed project-level kill criteria. Our 3-kill-criterion pattern (sessions exceeded, schema revisions >2, etc.) is stronger |
| **min / target / stretch per slice** | NO | Matt's tickets have acceptance criteria; ours have min/target/stretch — explicit permission to defer |
| **Backlog discipline** | NO | Matt has issues; we have an explicit parking-lot with "to un-park we'd need X" reasoning |
| **Gates model (G1–G5)** | NO | Matt has phase flow but not explicit gates. Our gates force approval at every transition, which prevents silent drift |
| **Polish audit with named skills** | PARTIAL | Matt has code-review (Standards + Spec); we have a full audit covering accessibility, visual, prose, copy, perf, discipline |
| **Existing-project workflow (Ingest → Recon → Synthesis)** | NO | Matt assumes codebase exists and is fresh in context. Our Recon/Synthesis is more rigorous |
| **Single recipe-driven invocation** | NO | Matt's 17 skills are individual commands. Our `start-app.yaml` recipe wraps the whole flow into one command with parameters |

## E. Conflicts (where we disagree)

| Topic | Our position | Their position | Resolution |
|---|---|---|---|
| **Anti-patterns in PRINCIPLES** | "A1–A8: project-flow anti-patterns (premature code, layer-first, speculative features, etc.)" | Their codebase-design + tdd cover code-shape anti-patterns (Feature Envy, Mysterious Name, etc.) | **Both are needed.** Keep our flow-level anti-patterns AND add their code-level smells. Different scopes |
| **Where ADR lives** | `docs/DECISIONS.md` (single file) | `docs/adr/NNNN-title.md` (one file per ADR) | **Their approach is better** for long-lived projects. One file per ADR is greppable, diffable, sortable. But our single-file works fine for solo dev / small projects. **Decision: keep ours, note theirs as alternative for big projects** |
| **Where CONTEXT.md lives** | We don't have one | `CONTEXT.md` at root + per-context variants via `CONTEXT-MAP.md` | **Adopt theirs.** Their structure handles monorepos well |
| **Context clearing strategy** | Implicit via SESSION-STATE.md (cross-session continuity) | Explicit: fresh context per slice, /handoff between sessions | **Adopt theirs as default; ours as exception.** Fresh context is healthier; cross-session only when truly needed |
| **Code review** | Demo gate (G4) per slice (tests pass + visual screenshot) | Two-axis review (Standards + Spec) + smell baseline | **Adopt theirs as code-review step.** Our demo gate proves the slice *works*; their code-review proves it's *good* |

## F. Net decision: what to integrate

**HIGH priority (genuinely bulletproof-improving):**
1. ✅ **CONTEXT.md template** — project glossary, kept separate from decisions
2. ✅ **Code-review skill** — per-slice, two-axis (Standards + Spec), with Fowler smell baseline
3. ✅ **Domain-modeling discipline** — into Phase 1 (grilling) and Phase 3 (architecture decisions). The 3-criteria rule for ADRs
4. ✅ **Codebase-design vocabulary** — module, interface, depth, seam, adapter, leverage, locality; the deletion test; "one adapter = hypothetical seam"
5. ✅ **Blocking edges in SPEC.md** — "Slice N is blocked by slices A, B"
6. ✅ **Wide-refactor handling** — expand-contract pattern documented in PRINCIPLES.md
7. ✅ **Context-clearing between slices** — explicit rule
8. ✅ **Smell baseline** — add the 12 Fowler smells to PRINCIPLES.md
9. ✅ **Prototype detour** — Phase 3 can branch to throwaway prototype for hard design questions

**MEDIUM priority (nice-to-have, doesn't break anything):**
10. ⚠️ **Wayfinder fork** — for genuinely foggy / huge efforts, before Phase 1
11. ⚠️ **Fog of war concept** — acknowledge what we don't know
12. ⚠️ **Research background-agent pattern** — note the `delegate` tool as the primitive
13. ⚠️ **`CONTEXT-MAP.md`** — for projects with multiple bounded contexts

**LOW priority (skip for now):**
14. ❌ **Triage skill** — needs an issue tracker we don't use
15. ❌ **Ask-matt router** — we have the recipe
16. ❌ **Setup skill** — install script, irrelevant
17. ❌ **Resolve-merge-conflicts** — not a methodology primitive
18. ❌ **One-file-per-ADR vs single DECISIONS.md** — ours is fine for solo

---

## G. Things that DIDN'T move the needle

Reading all 17 skills, I want to be honest: **most of what mattpocock has, we already cover or it's not relevant to a solo dev building apps**. The high-impact differences are concentrated in ~9 things listed above. Everything else is either overlap (tdd, diagnosing-bugs we already have), tooling integration (triage needs an issue tracker), or router/dispatcher work (ask-matt).

**Bottom line:** Matt's system is *excellent* for a multi-engineer team with an issue tracker, ADRs in `docs/adr/NNNN-name.md`, and shared domain vocabulary. For a solo dev building apps with goose, the right answer is **his vocabulary + discipline, our workflow + gates.** Not wholesale replacement.

---

## H. Implementation plan (next step)

This document is the comparison. Implementation is a separate artifact. Order:

1. Add new template: `templates/CONTEXT.md`
2. Update PRINCIPLES.md:
   - Add codebase-design vocabulary (depth, seam, adapter, leverage, locality, deletion test)
   - Add smell baseline (12 Fowler smells)
   - Add context-clearing rule (fresh context per slice)
   - Add wide-refactor rule (expand-contract)
   - Add prototype-detour rule
3. Update SPEC.md template:
   - Add "Blocked by" per slice
   - Add user-stories section (from to-spec)
   - Add testing-decisions section (from to-spec)
4. Add new template: `templates/CODE-REVIEW.md`
5. Update DECISIONS.md template with the 3-criteria rule
6. Update SESSION-STATE.md with "blocked-by" tracker column
7. Update PRINCIPLES.md: explicit "diagnosing-bugs is the escape hatch" rule
8. Update recipe `start-app.yaml` to invoke code-review per slice
9. Update worked example to demonstrate: glossary-driven grilling, blocking edges, code-review per slice, smell check, context clearing