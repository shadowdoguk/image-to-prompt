# Drift Prevention Framework

Operational protocol for the AI when drift is detected — i.e., when the code,
the docs, the contracts, and the runtime state disagree.

Drift is the single largest risk to this project. See the main report
(`docs/reports/session-state-assessment.md` §"Why minimal drift matters")
for the rationale.

## 1. Drift taxonomy

| Type | Example | Detection |
|---|---|---|
| `version_control` | No git repo; missing remote; dirty working tree | `session-init.js` scanner 1 |
| `doc_contract` | `CONTEXT.md` missing; `docs/agents/X.md` referenced from CLAUDE.md but absent | scanner 4 + validation V1, V6 |
| `endpoint_doc` | README documents endpoint X; server exposes endpoint Y | scanner 6 |
| `code_doc` | package.json script references path that doesn't exist | scanner 6 |
| `data_drift` | `presets.json` corrupt or shape changed without schema bump | scanner 7 |
| `runtime_drift` | `server.log` shows persistent error patterns not tracked as issues | scanner 5 |
| `ephemeral_leak` | Files left in `uploads/` that should have been deleted | scanner 8 |
| `accuracy_drift` | Field definitions diverge from `CONTEXT.md` Field palette section | manual + V-check |

## 2. Detection

Every session starts with `node scripts/session-init.js`. The script:

1. Runs all eight scanners.
2. Normalizes their statuses (`available | degraded | unavailable`).
3. Produces a unified state with severity-tagged issues.
4. Runs the ten V-checks and computes a pass rate.
5. Persists the snapshot to `.opencode/state/`.

**Trigger:** Any V-check fails OR any `critical` or `high`-severity issue is
emitted.

## 3. Immediate drift mitigation actions

When a session-init scan reports drift, follow this decision tree:

```
                    ┌─ git missing?  → STOP. Initialize git (see §3.1).
                    │
                    ├─ CONTEXT.md missing? → STOP. Create it from domain.md
                    │                        contract (see §3.2).
                    │
                    ├─ endpoint_doc drift? → Update README.md OR revert
                    │                       server.js. Pick the side
                    │                       that matches the implementation.
                    │
                    ├─ code_doc drift (package.json)? → Either create the
                    │                              missing dir or remove
                    │                              the dead script reference.
                    │
                    ├─ runtime_drift (auth failures)? → STOP. Verify
                    │                                  MINIMAX_API_KEY before
                    │                                  any other work.
                    │
                    ├─ ephemeral_leak? → `rm uploads/*` (these are
                    │                     temporary by definition).
                    │
                    └─ accuracy_drift? → Reconcile CONTEXT.md with
                                         FIELD_PALETTE in server.js.
                                         One of them is wrong.
```

### 3.1 Initialize git (one-time)

```bash
cd /home/david/shadowdog-dev/projects/image-to-prompt
git init
git add .
git commit -m "Initial commit — pre-version-control state"
gh repo create image-to-prompt --public --source=. --remote=origin --push
```

After this, re-run `node scripts/session-init.js` and confirm
`version_control.normalized === 'available'` and `V-issue-tracker-available`
passes.

### 3.2 Create CONTEXT.md (one-time)

Per `docs/agents/domain.md` contract. Use the existing `CONTEXT.md` in this
repo as the canonical template. Required sections:

- What this project is
- Pipeline stages (with diagram)
- Core entities table
- Field palette (mirrors `FIELD_PALETTE` in `server.js`)
- Accuracy contract (mirrors ADR-0001)
- Configuration sources
- Conventions
- Known gaps

### 3.3 Update README to match code

The README currently documents `POST /api/generate`. The implementation
exposes `POST /api/analyze` and `POST /api/generate-prompt`. Fix in the
README. Do NOT add a `/api/generate` alias unless explicitly approved —
aliases accumulate.

### 3.4 Fix package.json test script

Either:
- Create `tests/run-all.js` with a minimal smoke-test runner, OR
- Remove the `test` script from `package.json` until the harness exists.

Option A is preferred (see §4.2 below).

## 4. Drift budget (acceptance thresholds)

| Metric | Threshold | Action on breach |
|---|---|---|
| Validation pass rate (V1–V10) | 100% | Block session until fixed |
| Critical-severity issues | 0 | Block session until fixed |
| High-severity issues | 0 | Same-session fix required |
| Medium-severity issues | ≤ 2 | Allow session to continue, file issue |
| Low-severity issues | unlimited | Allow, clean up opportunistically |
| Drift detection latency (time from drift introduced to time detected) | ≤ 1 session | Add to V-check catalogue if not detected |

If any threshold is breached, the session produces a drift report at the
top of its response (see §5).

## 5. Drift report format

When drift is detected mid-session, emit this report at the top of the next
response:

```markdown
## Drift detected

- **Severity:** <critical | high | medium | low>
- **Type:** <type from §1>
- **Detail:** <one sentence>
- **Affected files:** <list>
- **Action taken:** <what was done this session>
- **Remaining work:** <what's still open>

(See `docs/agents/drift-prevention.md` §5 for the format.)
```

## 6. Drift prevention rules (proactive)

These prevent drift from being introduced in the first place:

1. **Every code change that adds a new contract** (endpoint, env var,
   palette field, preset schema field) MUST update all three of:
   `CONTEXT.md`, `README.md`, `.env.example` (if applicable), in the same
   commit.
2. **Every ADR that changes architecture** MUST update `CONTEXT.md` if it
   adds or removes an entity, a stage, or a contract.
3. **Every bug fix in a `drift` class** MUST add or update a V-check in
   `scripts/session-init.js` so the same drift is detected automatically
   next time.
4. **No silent aliases.** If two endpoints or env vars do the same thing,
   pick one and delete the other. Aliases are drift magnets.
5. **Ephemeral is ephemeral.** `uploads/` is for files in flight only.
   Anything still there at session-start is drift and must be cleaned.
6. **No "I'll document it later."** If a change is made, the docs go in the
   same commit. CI-grade enforcement comes once the harness exists.

## 7. Drift review (end of every session)

Before responding "done" at the end of a session, run:

```bash
node scripts/session-init.js
```

Confirm validation pass rate is at or above the session-start rate. If it
dropped, the session has introduced drift — fix it before signing off, or
explicitly hand it off as an issue.
