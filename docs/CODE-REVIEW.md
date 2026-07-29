# CODE-REVIEW.md Template

**Usage:** Run after every slice, before committing. Two-axis review: Standards + Spec. Both axes run as parallel sub-agents to keep contexts clean.

---

# Code Review: image-to-prompt

**Slice:** {{SLICE_NAME}}
**Date:** 2026-07-29
**Reviewer:** Goose (two parallel sub-agents)

---

## Setup

**Fixed point:** git SHA before this slice's work began: `{{BEFORE_SHA}}`
**Head:** `{{AFTER_SHA}}`

```bash
git diff {{BEFORE_SHA}}...{{AFTER_SHA}} --stat
git log {{BEFORE_SHA}}..{{AFTER_SHA}} --oneline
```

**Originating spec source:** `docs/SPEC.md` §{{SECTION}}
**Originating ticket:** {{TICKET_PATH_OR_NUMBER}}

---

## Axis 1 — Standards

**Sub-agent:** `general-purpose`
**Brief:** Report per file/hunk where relevant — (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls — documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling already enforces. Under 400 words.

### Smell baseline (always applied)

| Smell | What it is | Fix |
|---|---|---|
| **Mysterious Name** | Function/variable/type whose name doesn't reveal what it does or holds | Rename; if no honest name comes, the design's murky |
| **Duplicated Code** | Same logic shape appears in more than one hunk/file | Extract the shared shape |
| **Feature Envy** | Method that reaches into another object's data more than its own | Move the method onto the data it envies |
| **Data Clumps** | Same few fields/params keep travelling together | Bundle them into one type |
| **Primitive Obsession** | Primitive/string standing in for a domain concept that deserves a type | Give the concept its own small type |
| **Repeated Switches** | Same `switch`/`if`-cascade on same type recurs | Replace with polymorphism or a shared map |
| **Shotgun Surgery** | One logical change forces scattered edits across many files | Gather what changes together into one module |
| **Divergent Change** | One file/module edited for several unrelated reasons | Split so each module changes for one reason |
| **Speculative Generality** | Abstraction/parameters/hooks added for needs the spec doesn't have | Delete it; inline back until a real need shows |
| **Message Chains** | Long `a.b().c().d()` navigation the caller shouldn't depend on | Hide the walk behind one method on the first object |
| **Middle Man** | Class/function that mostly just delegates onward | Cut it; call the real target directly |
| **Refused Bequest** | Subclass/implementer that ignores most of what it inherits | Drop inheritance, use composition |

### Repo-specific standards

If the repo has `CODING_STANDARDS.md`, `CONTRIBUTING.md`, lint config, or similar, the sub-agent reads those first. **Repo standard overrides baseline.**

### Findings

{{STANDARDS_FINDINGS_UNDER_400_WORDS}}

---

## Axis 2 — Spec

**Sub-agent:** `general-purpose`
**Brief:** Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words.

If no spec source exists, skip this axis and note it here: {{NO_SPEC_NOTE}}.

### Findings

{{SPEC_FINDINGS_UNDER_400_WORDS}}

---

## Aggregate

| Axis | # findings | Worst issue (if any) |
|---|---|---|
| Standards | {{N}} | {{WORST}} |
| Spec | {{N}} | {{WORST}} |

**Do not merge or rerank findings across axes.** A change can pass one and fail the other — that's the point of running them separately.

---

## Verdict

- [ ] **Pass — commit this slice as-is.**
- [ ] **Pass with minor — fix these N items in this commit:**
  1. {{MINOR_1}}
  2. {{MINOR_2}}
- [ ] **Fail — major rework needed:** {{REASON}}
- [ ] **Reject — slice does not match the spec:** {{REASON}}

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Initial review | — |

(Append-only.)