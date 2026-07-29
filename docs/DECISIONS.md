# DECISIONS.md Template

**Usage:** Append-only decision log. New entries are added; old entries are never edited. Corrections are new entries that reference the old.

**Versioning notes (v1 → v2):**
- v2 additions: the 3-criteria rule for what becomes an ADR. Source: `domain-modeling` skill (mattpocock/skills/engineering).
- v1 sections preserved: append-only log, ADR format.

---

# Decision Log: image-to-prompt

---

## When to write an ADR (v2 — the 3-criteria rule)

**An ADR is only written when ALL THREE criteria are met.** If any one is missing, do not write an ADR — note the decision in `SESSION-STATE.md` or inline in `SPEC.md`/`ARCHITECTURE.md` instead.

1. **Hard to reverse.** The cost of changing your mind later is meaningful.
2. **Surprising without context.** A future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off.** There were genuine alternatives and we picked one for specific reasons.

Examples of decisions that **do not** deserve an ADR (any criterion missing):

- "We picked TypeScript" — not hard to reverse (rewrite a file), not surprising (TS is everywhere), no real trade-off (TS is the default for new TS projects).
- "We use bcrypt" — not hard to reverse (swap a function), not surprising, but there IS a trade-off (argon2id is theoretically better). Borderline — write the ADR if the choice is non-obvious.
- "We added a `createdAt` column" — not hard to reverse, not surprising. No ADR.

Examples that **do** deserve an ADR:

- "We chose Postgres over SQLite for a single-user MVP." — Hard to reverse (migration), surprising without context (why not SQLite for one user?), real trade-off (operational overhead vs query flexibility). ✓
- "We chose expand-contract sequencing for the auth refactor instead of vertical slices." — Hard to reverse (touching the whole auth seam), surprising without context (everyone defaults to slices), real trade-off. ✓
- "We chose a single DECISIONS.md instead of `docs/adr/NNNN-*.md` per ADR." — Hard to reverse? No (it's just file layout). Not surprising. No real trade-off for a solo project. ✗

**Default: under-write ADRs. Most decisions are not ADR-worthy.** The discipline is in *not* writing one for things that don't meet all three.

---

## ADR format

Each ADR uses this exact shape. Replace `{{...}}` placeholders. Append a new ADR for every qualifying decision; never edit a prior ADR.

```
## ADR-NNN: {{TITLE}}

- **Date:** 2026-07-29
- **Status:** Accepted | Superseded by ADR-XXX | Rejected
- **Context:** {{WHY_THIS_CAME_UP — what question were we trying to answer?}}
- **Decision:** {{WHAT_WE_DECIDED, in one sentence}}
- **Consequences:** {{WHAT_THIS_MEANS_GOING_FORWARD — what now becomes easier or harder?}}
- **Alternatives considered:** {{WHAT_WE_REJECTED_AND_WHY}}
- **Meets the 3 criteria:** hard-to-reverse ✓ / surprising-without-context ✓ / real-trade-off ✓
```

---

## ADRs

### ADR-001: {{TITLE}}

- **Date:** 2026-07-29
- **Status:** Accepted | Superseded by ADR-XXX
- **Context:** {{WHY_THIS_CAME_UP}}
- **Decision:** {{WHAT_WE_DECIDED}}
- **Consequences:** {{WHAT_THIS_MEANS_GOING_FORWARD}}
- **Alternatives considered:** {{WHAT_WE_REJECTED_AND_WHY}}
- **Meets the 3 criteria:** hard-to-reverse ✓ / surprising-without-context ✓ / real-trade-off ✓

### ADR-002: {{TITLE}}

- **Date:** 2026-07-29
- **Status:** Accepted | Superseded by ADR-XXX
- **Context:** {{WHY_THIS_CAME_UP}}
- **Decision:** {{WHAT_WE_DECIDED}}
- **Consequences:** {{WHAT_THIS_MEANS_GOING_FORWARD}}
- **Alternatives considered:** {{WHAT_WE_REJECTED_AND_WHY}}
- **Meets the 3 criteria:** hard-to-reverse ✓ / surprising-without-context ✓ / real-trade-off ✓

(continue for each ADR)

---

## Lightweight decisions (NOT ADRs)

Some choices get made during sync/architecture that don't meet all three criteria. We note them here so the trail isn't lost, but they are not ADRs. They are just… choices we made.

- 2026-07-29 — {{CHOICE}}. Reason: {{ONE_LINE}}.
- 2026-07-29 — {{CHOICE}}. Reason: {{ONE_LINE}}.

If a lightweight decision later proves load-bearing, promote it to a full ADR (new entry, reference the lightweight note).

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Initial draft | — |
| 2026-07-29 | v2 additions: 3-criteria rule, "Meets the 3 criteria" line per ADR, "Lightweight decisions" section | integration with mattpocock/skills/engineering domain-modeling skill |

(Append-only.)