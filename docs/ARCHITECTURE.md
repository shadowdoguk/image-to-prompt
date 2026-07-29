# ARCHITECTURE.md Template

**Usage:** Created at gate G3. Reviewed and approved before any slice starts.

---

# Architecture: image-to-prompt

**Created:** 2026-07-29
**Status:** Draft → Approved

---

## 1. Stack

| Layer | Choice | Why this, not the alternative |
|---|---|---|
| Language | {{LANG}} | {{WHY}} |
| Framework | {{FRAMEWORK}} | {{WHY}} |
| Database | {{DB}} | {{WHY}} |
| ORM / data layer | {{ORM}} | {{WHY}} |
| Auth | {{AUTH}} | {{WHY}} |
| Hosting | {{HOST}} | {{WHY}} |
| Testing | {{TEST}} | {{WHY}} |
| Other | {{OTHER}} | {{WHY}} |

If any cell is "TBD," the architecture is not approved yet.

## 2. File / Folder Layout

```
project-root/
  docs/                  ← all methodology docs live here
  src/ or app/           ← application code
  tests/                 ← tests
  scripts/               ← build / utility scripts
  .agents/               ← agent-specific config (optional)
  README.md
  ...
```

Explain any choice that isn't obvious (e.g. why no `components/` folder, why monorepo, why flat).

## 3. Seams (where chunks can be cut)

A **seam** is a public boundary that the codebase exposes for slicing/testing:

- **Seam 1:** {{SEAM}} — e.g. "the `LibraryService` interface"
- **Seam 2:** {{SEAM}}
- **Seam 3:** {{SEAM}}

Tests live at seams, not against internals.

## 4. Pre-mortem (top 3 ways this project fails)

We pretend it's 6 months from now and this project failed. How did it fail?

### Failure mode 1: image-to-prompt
- **What went wrong:** {{DESC}}
- **Warning sign we'd notice:** {{SIGNAL}}
- **Pre-commitment if it happens:** {{WHAT_WE_DO}}

### Failure mode 2: image-to-prompt
- **What went wrong:** {{DESC}}
- **Warning sign we'd notice:** {{SIGNAL}}
- **Pre-commitment if it happens:** {{WHAT_WE_DO}}

### Failure mode 3: image-to-prompt
- **What went wrong:** {{DESC}}
- **Warning sign we'd notice:** {{SIGNAL}}
- **Pre-commitment if it happens:** {{WHAT_WE_DO}}

## 5. Slice Order (with min / target / stretch)

For each slice from SPEC.md:

| # | Slice | Min | Target | Stretch |
|---|---|---|---|---|
| 1 | image-to-prompt | {{MIN}} | {{TARGET}} | {{STRETCH}} |
| 2 | image-to-prompt | {{MIN}} | {{TARGET}} | {{STRETCH}} |
| 3 | image-to-prompt | {{MIN}} | {{TARGET}} | {{STRETCH}} |

We aim for **target**. Stretch goes to BACKLOG.md. Min unblocks the next slice.

## 6. Decisions Captured

This section cross-references DECISIONS.md. New entries are appended to that file with `ADR-###` IDs. Architecture-relevant decisions:

- See `DECISIONS.md` for full log.
- Inline reference: `ADR-001` (stack), `ADR-002` (auth), ...

## 7. Out of Architecture Scope

Things explicitly NOT in the architecture (will need re-architecture later if pursued):

- {{SCOPE_OUT_1}}
- {{SCOPE_OUT_2}}

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Initial draft | — |

(Append-only.)