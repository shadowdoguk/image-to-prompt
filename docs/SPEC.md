# SPEC.md Template

**Usage:** Copy this file to `docs/SPEC.md` at the start of every project.

**Versioning notes (v1 → v2):**
- v2 additions: Blocked-by per slice, User Stories section, Testing Decisions section. Source: `to-spec` skill format (mattpocock/skills/engineering).
- v1 sections preserved: Idea, Reframe, Challenge, Scope, Constraints, Definition of Done, Kill Criteria, Open Questions, Change Log.

---

# Project: image-to-prompt

**Status:** Draft → In Review → Approved
**Created:** 2026-07-29
**Last updated:** 2026-07-29

---

## 1. The Idea (one paragraph)

In your own words, what is this? Don't over-polish. Two sentences is fine.

> /home/david/shadowdog-dev/projects/image-to-prompt

## 2. The Reframe (Goose reflects back)

I heard this as: {{REFRAME}}. If that's wrong, correct me here before we continue.

## 3. The Challenge (Goose argues against)

Three reasons this might fail or be the wrong project:

1. {{RISK_1}}
2. {{RISK_2}}
3. {{RISK_3}}

Mitigations we'll commit to:

1. {{MITIGATION_1}}
2. {{MITIGATION_2}}

## 4. Scope

### 4.1 In scope (this project ships these)

- {{IN_SCOPE_1}}
- {{IN_SCOPE_2}}

### 4.2 Out of scope (explicitly not doing)

- {{OUT_OF_SCOPE_1}}
- {{OUT_OF_SCOPE_2}}

### 4.3 The ONE thing

If this project is a success, the **one** thing it does well is: {{ONE_THING}}.

Everything else is secondary.

## 5. Users

**Primary user:** {{USER_DESCRIPTION}}

A day in their life with this app looks like: {{USAGE_SCENARIO}}

## 6. Constraints

| Constraint | Value | Reason |
|---|---|---|
| Stack | {{STACK}} | {{WHY}} |
| Hosting | {{HOST}} | {{WHY}} |
| Timeline | {{TIMELINE}} | {{WHY}} |
| Data sensitivity | {{LEVEL}} | {{WHY}} |
| Browser support | {{BROWSERS}} | {{WHY}} |
| Other | {{OTHER}} | {{WHY}} |

If a constraint is blank, we're not yet decided.

## 7. User Stories (v2 — from to-spec format)

A **long, numbered list** of user stories. Each in the form:

> 1. As an `<actor>`, I want a `<feature>`, so that `<benefit>`.

Example: "As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending."

This list should be **extensive** — it covers everything the slices build. Anything not on this list is out of scope.

1. As a {{ACTOR_1}}, I want a {{FEATURE_1}}, so that {{BENEFIT_1}}.
2. As a {{ACTOR_2}}, I want a {{FEATURE_2}}, so that {{BENEFIT_2}}.
3. As a {{ACTOR_3}}, I want a {{FEATURE_3}}, so that {{BENEFIT_3}}.
4. (continue)

If a user story cannot be mapped to a slice in §9, either (a) add a slice, or (b) move the story to "out of scope" in §4.2. No orphans.

## 8. Implementation Decisions (v2 — from to-spec format)

A list of decisions made during sync + architecture. May include:

- Modules that will be built or modified (named with the codebase-design vocabulary — module, interface, seam, depth).
- Interfaces of those modules.
- Technical clarifications from the developer.
- Architectural decisions.
- Schema changes.
- API contracts.
- Specific interactions.

**Do NOT include specific file paths or code snippets** — they go stale fast.

**Exception:** if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

### Modules

- **{{MODULE_1}}** — {{ROLE}}. Interface lives at the {{SEAM}}. Depth target: deep.
- **{{MODULE_2}}** — {{ROLE}}. Interface lives at the {{SEAM}}. Depth target: deep.

### Decisions

- {{DECISION_1}}
- {{DECISION_2}}

## 9. Definition of Done (vertical slices with blocking edges)

Each slice must be **end-to-end demoable**. List them in build order. Each slice declares **which other slices block it** — a slice with no blockers can start immediately.

### Slice 1: {{SLICE_1_NAME}}

- **Behavior:** {{ONE_SENTENCE}}
- **Acceptance test:** {{HOW_WE_VERIFY}}
- **DoD:** {{BINARY_YES_NO}}
- **Blocked by:** none — can start immediately
- **min / target / stretch:** min={{MIN}}, target={{TARGET}}, stretch={{STRETCH}}
- **Maps to user story:** #{{N}}

### Slice 2: {{SLICE_2_NAME}}

- **Behavior:** {{ONE_SENTENCE}}
- **Acceptance test:** {{HOW_WE_VERIFY}}
- **DoD:** {{BINARY_YES_NO}}
- **Blocked by:** Slice 1 ({{SLICE_1_NAME}})
- **min / target / stretch:** min={{MIN}}, target={{TARGET}}, stretch={{STRETCH}}
- **Maps to user story:** #{{N}}

(continue for each slice)

### Frontier view (work these in order)

Any slice whose **Blocked by** list is all done. For a purely linear chain that means top-to-bottom. Wide refactors (per PRINCIPLES.md §6.3) replace vertical slicing with expand → migrate batches → contract.

### Stretch (not in MVP; goes to BACKLOG.md if pursued)

- {{STRETCH_1}}
- {{STRETCH_2}}

## 10. Testing Decisions (v2 — from to-spec format)

A list of testing decisions made during sync + architecture.

### What makes a good test (this project)

Tests verify behaviour through **public interfaces**, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification — "user can checkout with valid cart" — and survives refactors because it doesn't care about internal structure.

Each test lives at a **pre-agreed seam**. Before writing any test, the seams are written down here and confirmed with you. Tests against internals are forbidden (anti-pattern A9).

### Modules that will be tested (with seams)

- **{{MODULE_1}}** — test at the {{SEAM_1}}. Expected-value source: {{KNOWN_GOOD_LITERAL_OR_WORKED_EXAMPLE}}.
- **{{MODULE_2}}** — test at the {{SEAM_2}}. Expected-value source: {{...}}.

### Prior art in the codebase

- {{EXISTING_TEST_THAT_SHOWS_THE_PATTERN}}

### Forbidden in tests (anti-patterns)

- **A9 — implementation-coupled tests.** Mocks of internal collaborators, tests of private methods, side-channel verification (querying the DB instead of using the interface).
- **A10 — tautological tests.** Assertions that recompute the expected value the way the code does.
- **A11 — horizontal slicing.** Writing all tests first, then all implementation.

## 11. Kill Criteria (pre-committed)

We will **kill** this project if any of these happen:

- {{KILL_1}}
- {{KILL_2}}
- {{KILL_3}}

These are not negotiable in the moment. They are pre-commitments.

## 12. Open Questions

- {{OPEN_1}}
- {{OPEN_2}}

(Items move to DECISIONS.md when resolved. If the answer is a domain term, also add to CONTEXT.md.)

## 13. Glossary point-in-time

The first terms to enter `CONTEXT.md` when the spec is approved (per PRINCIPLES.md P13):

- **{{TERM_1}}** — {{DEFINITION}}. Source: this spec §{{SECTION}}.
- **{{TERM_2}}** — {{DEFINITION}}. Source: this spec §{{SECTION}}.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Initial draft | — |
| 2026-07-29 | v2 additions: §7 user stories, §8 implementation decisions, §9 blocked-by + min/target/stretch + user-story mapping, §10 testing decisions, §13 glossary bootstrap | integration with mattpocock/skills/engineering to-spec format |

(Reverse-chronological. Append-only. Corrections are new entries, never edits.)