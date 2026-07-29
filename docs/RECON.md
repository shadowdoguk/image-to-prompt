# RECON.md Template

**Usage:** Phase A (Ingest) of the existing-project workflow. Pure inventory. No interpretation yet.

---

# Recon: image-to-prompt

**Date:** 2026-07-29
**Recon by:** Goose
**Repo path:** {{PATH}}

---

## 1. Identification

| Field | Value |
|---|---|
| Project name | image-to-prompt |
| One-line description | {{ONE_LINE}} |
| Primary surface | web app / CLI / API / library / desktop / mobile / monorepo / other |
| Repo URL | {{URL}} |
| Latest commit (SHA + date) | {{SHA}} 2026-07-29 |
| Default branch | {{BRANCH}} |

## 2. Stack (observed)

| Layer | Choice | Evidence (file/line) |
|---|---|---|
| Language(s) | {{LANG}} | {{EVIDENCE}} |
| Framework(s) | {{FRAMEWORK}} | {{EVIDENCE}} |
| Database(s) | {{DB}} | {{EVIDENCE}} |
| ORM / data layer | {{ORM}} | {{EVIDENCE}} |
| Auth | {{AUTH}} | {{EVIDENCE}} |
| Build tool | {{BUILD}} | {{EVIDENCE}} |
| Test framework | {{TEST}} | {{EVIDENCE}} |
| Linter / formatter | {{LINT}} | {{EVIDENCE}} |

## 3. Dependencies (top 10 by direct dep)

List the top dependencies with their role, not the full lockfile. This is for orientation.

| Package | Version | Role | Notes |
|---|---|---|---|
| {{PKG}} | {{VER}} | {{ROLE}} | {{NOTES}} |

## 4. File / folder layout (top 2 levels)

```
project-root/
  {{DIR_OR_FILE}}      ← {{ROLE}}
  {{DIR_OR_FILE}}      ← {{ROLE}}
  ...
```

Anything that surprised you, note here:

- {{SURPRISE}}

## 5. Commands

| Action | Command | Source |
|---|---|---|
| Install | {{CMD}} | {{WHERE_DEFINED}} |
| Dev (run locally) | {{CMD}} | {{WHERE_DEFINED}} |
| Build | {{CMD}} | {{WHERE_DEFINED}} |
| Test | {{CMD}} | {{WHERE_DEFINED}} |
| Lint | {{CMD}} | {{WHERE_DEFINED}} |
| Format | {{CMD}} | {{WHERE_DEFINED}} |

## 6. Environment

| Variable | Required | Purpose | Source of truth |
|---|---|---|---|
| {{VAR}} | yes/no | {{PURPOSE}} | {{WHERE_DEFINED}} |

## 7. Data stores

| Store | Type | Connection method | Migrations? |
|---|---|---|---|
| {{STORE}} | {{TYPE}} | {{CONN}} | yes/no |

## 8. External services

| Service | Purpose | Auth method |
|---|---|---|
| {{SERVICE}} | {{PURPOSE}} | {{AUTH}} |

## 9. Tests — observed coverage (rough)

| Type | Count | Location | Notes |
|---|---|---|---|
| Unit | {{N}} | {{DIR}} | {{NOTES}} |
| Integration | {{N}} | {{DIR}} | {{NOTES}} |
| E2E | {{N}} | {{DIR}} | {{NOTES}} |

## 10. Smoke test result

**Did the project boot?** (Yes / No / Partial)

If Yes, what did you observe? {{OBSERVATION}}

If No, what's the failure? {{ERROR}}

If Partial, what's broken? {{BROKEN}}

## 11. Known TODOs / FIXMEs (top 10 only)

| Location | Text | Severity guess |
|---|---|---|
| {{PATH:LINE}} | {{TEXT}} | low / med / high |

## 12. Smells / red flags

Anything that looks off, undocumented, or risky:

- {{SMELL}}
- {{SMELL}}

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Initial recon | — |

(Append-only.)