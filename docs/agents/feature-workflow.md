# Feature Request Workflow

Operational protocol for the AI when a new feature is requested.

## 1. Requirements gathering

Before writing any code, capture the requirement with the template below. If
the user provides the request verbally, write the issue on their behalf and
ask them to confirm.

```markdown
## Summary
<one sentence describing the feature>

## User story
As a <role>, I want <capability>, so that <benefit>.

## Acceptance criteria
- [ ] <observable behavior 1>
- [ ] <observable behavior 2>
- [ ] ...

## Out of scope
- <explicit non-goal 1>
- <explicit non-goal 2>

## Open questions
- <question 1>
- <question 2>

## Proposed label
<needs-triage | ready-for-agent | wontfix>

## Affected contracts
- [ ] API endpoints (server.js)
- [ ] Frontend (src/)
- [ ] Preset schema (data/presets.json, FIELD_PALETTE)
- [ ] Configuration (.env, .env.example)
- [ ] Documentation (README.md, CONTEXT.md)
- [ ] New ADR required
```

Do not begin implementation until every "Open question" is resolved or marked
"Not blocking" with a fallback plan.

## 2. Feasibility analysis

For each candidate feature, run this analysis before committing to a design.

### 2.1 Domain impact
- Does it touch `FIELD_PALETTE`? If yes, every preset must be reviewed.
  `data/presets.json` references these by name; renaming or removing a field
  is a breaking change for all existing presets.
- Does it change the preset file format (`PRESET_FILE_FORMAT` /
  `PRESET_FILE_VERSION`)? If yes, you need a migration path for
  `.i2p.json` exports already in the wild.
- Does it add a new route? If yes, README's API section needs an update.

### 2.2 Provider impact
- Does it require a new MiniMax M3 call? (e.g., a new Stage 1.5 dedicated
  field.) Estimate token cost per request and confirm the 60-second timeout
  in `server.js` still bounds the worst case.
- Does it add new fields to the schema? The MiniMax API rejects schema
  property descriptions longer than ~250 chars (the bug fixed by ADR-0001
  Decision #4). Keep new descriptions under that limit.

### 2.3 Persistence impact
- Does it require a new persistent file? If yes, follow the same pattern as
  `data/presets.json`: `ensureDataFileExists` on startup, atomic writes,
  `.gitignore` if ephemeral.

### 2.4 Frontend impact
- Does it require a new UI control? If yes, check `src/styles.css` for an
  existing pattern (e.g., `.btn-secondary`); do not introduce new visual
  primitives without justification.
- Does it touch `src/app.js`? The frontend is ~600 lines of vanilla JS with
  no build step. Additions should preserve that.

### 2.5 Test impact
- Does the feature introduce a path that needs regression coverage? If `tests/`
  is created, add a test there. Otherwise, add a smoke-test snippet under
  `scripts/smoke/` and reference it from the closing PR.

### 2.6 Decision: Build / Defer / Decline

| Verdict | Criteria |
|---|---|
| **Build** | Feasibility = green on all five dimensions above. Cost is bounded. No open questions blocking. |
| **Defer** | One or more dimensions are yellow (risky but solvable) and there is a concrete trigger to revisit. |
| **Decline** | One or more dimensions are red (architecturally infeasible, conflicts with ADR, breaks the model) OR cost is unbounded. |

For **Defer**, file the issue with `needs-info` and the trigger to revisit
(e.g., "when tests/ is created", "when Stage 2 latency budget increases").

For **Decline**, file the issue with `wontfix` and write a 3-sentence
justification: (1) what was requested, (2) why it's being declined,
(3) what (if anything) would unblock it.

## 3. Integration planning

Once the feature is approved to build, write a short design note inside the
issue (or, if it's architecturally significant, as a `Proposed` ADR):

```markdown
## Design

### Files changed
| File | Change |
|---|---|
| `server.js` | Add route / modify function / add constant |
| `data/presets.json` | (if needed) |
| `src/app.js` | (if needed) |
| `src/styles.css` | (if needed) |
| `README.md` | Document new endpoint or env var |
| `CONTEXT.md` | Add new entity or contract |

### Sequencing
1. <step>
2. <step>
3. <step>

### Risks
- <risk 1> — mitigation: <mitigation>
- <risk 2> — mitigation: <mitigation>

### Rollback
<how to revert safely>

### Validation
- [ ] `node scripts/session-init.js` returns 100% validation pass rate
- [ ] V-check for the new contract is added if relevant
- [ ] Manual smoke test against the live UI passes
```

## 4. Implementation rules

- One feature per branch / per PR. Do not bundle unrelated changes.
- Update `CONTEXT.md` in the same commit if a new entity, field, or contract
  is introduced.
- Update `.env.example` and `README.md` in the same commit if a new env var
  or endpoint is introduced.
- Reference the issue in commits as `#N`.
- After implementation, run `node scripts/session-init.js` and confirm the
  validation pass rate is unchanged or improved.

## 5. ADR requirement

Write a new `docs/adr/NNNN-title.md` (status `Proposed`) if the feature:

- Introduces a new pipeline stage (Stage 3, parallel Stage 1.5, etc.)
- Changes the preset file format or version
- Adds a new persistent data file
- Changes the auth/secret model (where the API key lives, how it's loaded)
- Establishes a new convention for the field palette

Link the ADR from the issue with `Depends on / Supersedes ADR-0001` as
appropriate.

Promote to `Accepted` only after the implementation is merged and the issue
is closed.
