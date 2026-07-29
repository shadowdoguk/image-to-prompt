# CONTEXT.md Template

**Usage:** Project glossary. The single source of truth for **what terms mean** in this project. NOT a spec, NOT a decision log, NOT a scratch pad.

**Maintenance rule:** Update *inline* the moment a term is resolved. Don't batch. If a term is changed, add a new entry that supersedes the old — never rewrite.

---

# Project Glossary: image-to-prompt

**Created:** 2026-07-29

---

## What this file is

A glossary of domain terms used in this project. Every term here has one meaning in this project. If a term is overloaded or ambiguous, it does not belong here yet — sharpen it first via the `domain-modeling` discipline.

This file is **devoid of implementation details**. It does not say *how* anything works. It says *what the things are called*.

## What this file is NOT

- Not a spec (use `SPEC.md`).
- Not a decision log (use `DECISIONS.md` / ADRs).
- Not a TODO list.
- Not an architecture diagram.
- Not a place for "the user said X" notes.

---

## Terms

### {{TERM}}

- **Definition:** {{PRECISE_DEFINITION}}
- **Also called:** {{ALIASES_THAT_MEAN_THE_SAME_THING}}
- **NOT to be confused with:** {{NEAR_TERM_THAT_IS_DIFFERENT}}
- **Examples:** {{ONE_SENTENCE_USAGE}}
- **Source:** {{WHERE_THIS_WAS_DECIDED — e.g. ADR-003, Phase 1 grilling session}}

### {{TERM}}

- **Definition:** {{PRECISE_DEFINITION}}
- **Also called:** {{ALIASES_THAT_MEAN_THE_SAME_THING}}
- **NOT to be confused with:** {{NEAR_TERM_THAT_IS_DIFFERENT}}
- **Examples:** {{ONE_SENTENCE_USAGE}}
- **Source:** {{WHERE_THIS_WAS_DECIDED}}

(continue for each term)

---

## Overloaded terms we've deliberately avoided

These are words we explicitly chose NOT to use, because they have multiple meanings in adjacent domains and we'd confuse readers. If you find yourself reaching for one, sharpen it first.

| Forbidden term | Why it's banned here | Use instead |
|---|---|---|
| {{TERM}} | {{WHY}} | {{BETTER_TERM}} |

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Initial terms | — |

**Append-only.** Corrections are new entries. If a definition changes, add a new entry that says "supersedes the entry above." Never edit the old entry.

---

## Related files

- `docs/SPEC.md` — what we're building
- `docs/DECISIONS.md` — why we chose to build it this way
- `docs/ARCHITECTURE.md` — how the pieces fit
- `docs/CONTEXT.md` (this file) — what we call things