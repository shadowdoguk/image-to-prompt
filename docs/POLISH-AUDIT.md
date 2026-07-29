# POLISH-AUDIT.md Template

**Usage:** Run at gate G5 (before declaring done). Covers accessibility, visual, prose, performance.

---

# Polish Audit: image-to-prompt

**Date:** 2026-07-29
**Auditor:** Goose (with the kept skills)

---

## 1. Accessibility (WCAG 2.2)

**Source skill:** `accessibility`

| Check | Result | Fix |
|---|---|---|
| Color contrast (4.5:1 text, 3:1 large) | ✅ / ⚠ / ❌ | {{NOTES}} |
| Keyboard navigation (all interactive) | ✅ / ⚠ / ❌ | {{NOTES}} |
| Focus indicators visible | ✅ / ⚠ / ❌ | {{NOTES}} |
| Alt text on images | ✅ / ⚠ / ❌ | {{NOTES}} |
| Form labels associated | ✅ / ⚠ / ❌ | {{NOTES}} |
| ARIA roles correct | ✅ / ⚠ / ❌ | {{NOTES}} |
| Heading hierarchy | ✅ / ⚠ / ❌ | {{NOTES}} |
| Reduced-motion respected | ✅ / ⚠ / ❌ | {{NOTES}} |
| Screen-reader smoke test | ✅ / ⚠ / ❌ | {{NOTES}} |

**Issues to fix before ship:**
- {{ISSUE_1}}
- {{ISSUE_2}}

## 2. Visual (distinctive, not templated)

**Source skill:** `frontend-design`

| Check | Result | Fix |
|---|---|---|
| Visual direction is intentional (not generic defaults) | ✅ / ⚠ / ❌ | {{NOTES}} |
| Typography is paired deliberately | ✅ / ⚠ / ❌ | {{NOTES}} |
| Color palette is 4–6 named values, used consistently | ✅ / ⚠ / ❌ | {{NOTES}} |
| Signature element exists | ✅ / ⚠ / ❌ | {{NOTES}} |
| Responsive down to mobile | ✅ / ⚠ / ❌ | {{NOTES}} |
| Looks the same on Chrome/Firefox/Safari | ✅ / ⚠ / ❌ | {{NOTES}} |

**Issues to fix before ship:**
- {{ISSUE_1}}
- {{ISSUE_2}}

## 3. Prose (no AI slop)

**Source skill:** `stop-slop`

| Check | Result | Fix |
|---|---|---|
| No filler phrases ("in today's fast-paced world") | ✅ / ⚠ / ❌ | {{NOTES}} |
| No binary contrasts ("not X, it's Y") | ✅ / ⚠ / ❌ | {{NOTES}} |
| Active voice throughout | ✅ / ⚠ / ❌ | {{NOTES}} |
| No inanimate things doing human verbs | ✅ / ⚠ / ❌ | {{NOTES}} |
| No vague declaratives | ✅ / ⚠ / ❌ | {{NOTES}} |
| Sentence rhythm varies | ✅ / ⚠ / ❌ | {{NOTES}} |

**Audit all user-facing prose:**
- Microcopy (buttons, labels, hints)
- Empty states
- Error messages
- Onboarding text
- Marketing copy
- README, docs

**Issues to fix before ship:**
- {{ISSUE_1}}
- {{ISSUE_2}}

## 4. Copy (persuasive, clear)

**Source skill:** `copywriting`

| Check | Result | Fix |
|---|---|---|
| Headline communicates value | ✅ / ⚠ / ❌ | {{NOTES}} |
| Sub-headline clarifies | ✅ / ⚠ / ❌ | {{NOTES}} |
| CTAs are specific (not "Submit") | ✅ / ⚠ / ❌ | {{NOTES}} |
| One primary action per page | ✅ / ⚠ / ❌ | {{NOTES}} |
| Benefits > features | ✅ / ⚠ / ❌ | {{NOTES}} |
| Specifics beat vagueness | ✅ / ⚠ / ❌ | {{NOTES}} |

**Issues to fix before ship:**
- {{ISSUE_1}}
- {{ISSUE_2}}

## 5. Performance (Core Web Vitals)

**Source:** Manual check via `chromedevtools` performance trace

| Metric | Target | Result | Fix |
|---|---|---|---|
| LCP | < 2.5s | {{VALUE}} | {{NOTES}} |
| INP | < 200ms | {{VALUE}} | {{NOTES}} |
| CLS | < 0.1 | {{VALUE}} | {{NOTES}} |
| TTFB | < 800ms | {{VALUE}} | {{NOTES}} |

**Issues to fix before ship:**
- {{ISSUE_1}}

## 6. Discipline (TDD / anti-slop)

| Check | Result |
|---|---|
| Every slice has a test | ✅ / ❌ |
| Tests test behavior, not internals | ✅ / ❌ |
| No implementation-coupling (mocks of internals) | ✅ / ❌ |
| No tautological tests | ✅ / ❌ |
| No skipped `.only` / `.skip` / `xit` in committed code | ✅ / ❌ |

## 7. Final report

What changed:
- {{CHANGE_1}}
- {{CHANGE_2}}

What was deliberately left as-is (and why):
- {{LEAVE_1}}
- {{LEAVE_2}}

What to look at first as a user:
- {{LOOK_FIRST_1}}
- {{LOOK_FIRST_2}}

---

## Gate G5

This document is the artifact at gate G5. Approval here means "ship."