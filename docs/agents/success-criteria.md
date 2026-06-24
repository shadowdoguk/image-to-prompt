# Success Criteria & Validation Metrics

Measurable success criteria for the session initialization mechanism. Every
criterion is automated-checkable via `node scripts/session-init.js`. The goal
is **100% accurate, up-to-date knowledge of project state at the start of every
session**.

## 1. Primary success criterion (the headline number)

**`validation.summary.pass_rate === 1.0`** at the start of every session.

Translation: zero failed V-checks. The mechanism produces a 10-check
validation report and the answer must be 10/10 every single time.

### Sub-criteria (each V-check must pass)

| ID | Check | Pass condition |
|---|---|---|
| V1 | `agent-docs-complete` | `issue-tracker.md`, `triage-labels.md`, `domain.md` all exist |
| V2 | `context-doc-exists` | `CONTEXT.md` exists and is non-empty |
| V3 | `presets-valid` | `data/presets.json` parses as an array |
| V4 | `test-script-resolves` | `package.json` `test` script's path exists, OR no `tests/`-path reference |
| V5 | `no-high-severity-drift` | Zero `high`-severity drifts in scanner 6 output |
| V6 | `agents-md-refs-resolve` | Every `docs/agents/X.md` referenced from `AGENTS.md` exists |
| V7 | `no-leftover-uploads` | `uploads/` directory is empty (or absent) |
| V8 | `adr-log-present-if-referenced` | `docs/adr/` exists iff any doc references it |
| V9 | `issue-tracker-available` | `gh issue list` returns successfully and the project has a remote |
| V10 | `no-auth-failures-in-log` | `server.log` contains no auth-failure patterns |

If V1–V10 is impossible (e.g., V9 requires a git remote that does not
exist), the criterion is replaced by an explicit `unavailable` status and the
session proceeds with the remaining checks. The pass rate is computed over
the checks that ARE available.

## 2. Scanner-coverage criterion

Every category of project state must have a scanner, and the scanner must
either be `available` or have a documented rationale for being `unavailable`.

| Category | Scanner | Required status |
|---|---|---|
| Version control | scanner 1 (git) | `available` after git init |
| Issue tracking | scanner 2 (gh) | `available` after remote is configured |
| Architectural decisions | scanner 3 (ADR) | `available` |
| Domain language | scanner 4 (CONTEXT.md) | `available` |
| Runtime signals | scanner 5 (server.log) | `available` whenever log exists |
| Code ↔ doc drift | scanner 6 | `available` |
| Preset state | scanner 7 | `available` |
| Ephemeral artifact cleanup | scanner 8 | `available` |

If any category has a scanner with status `unavailable` and the rationale is
not documented in `CONTEXT.md` "Known gaps", the session must remediate.

## 3. State-synchronization criterion

**Within 1 session of an introduced drift, `session-init.js` must detect it.**

Definition: if a change is committed (or, in the no-git-repo case, applied to
disk) that introduces drift of any type listed in
`docs/agents/drift-prevention.md` §1, then the very next
`session-init.js` run must surface it as either a V-check failure or a
critical/high issue.

Mechanism: every drift of type `drift` (per the bug taxonomy) introduces a
new V-check as part of the fix. This compounds coverage over time.

## 4. Timeline reconstruction criterion

**Every session produces a timeline that includes at minimum:**

- All `docs/adr/*.md` files with their `## Status` section.
- The most recent commit (if git is available).
- The `mtime` of `server.log` (if it exists).
- Any high-severity scanner signal.

The timeline is emitted in `.opencode/state/session-<timestamp>.json` under
the `timeline` key.

## 5. Drift-budget criterion (operational)

From `docs/agents/drift-prevention.md` §4:

| Metric | Threshold |
|---|---|
| Validation pass rate | 100% |
| Critical-severity issues | 0 |
| High-severity issues | 0 |
| Medium-severity issues | ≤ 2 |
| Drift detection latency | ≤ 1 session |

## 6. Output-format criterion

Every `session-init.js` run MUST emit:

1. **JSON to stdout** — machine-readable, parseable by other tools.
2. **Summary to stderr** — human-readable, fits in a terminal scrollback.
3. **Snapshot file** at `.opencode/state/session-latest.json`.
4. **Historical file** at `.opencode/state/session-<timestamp>.json`.

The two files are byte-identical except for filename + timestamp.

## 7. Idempotency criterion

Running `node scripts/session-init.js` twice in a row (without intervening
mutations) MUST produce identical `validation` and `unified` blocks, and
the only difference in the snapshot must be `finished_at` and `session_id`.

## 8. Performance criterion

`session-init.js` MUST complete in under 5 seconds on a clean project, and
under 15 seconds when git history is large. (No hard cap yet — measure and
adjust as the codebase grows.)

## 9. Failure-mode criterion

When a scanner's source is unavailable (e.g., `gh` CLI missing), that
scanner MUST emit `{ normalized: "unavailable", status: <reason> }` and
MUST NOT cause the entire run to fail. Other scanners continue.

The validation summary's `pass_rate` is computed only over the checks that
CAN be evaluated; unavailable checks are reported but do not block the pass
rate. (A separate metric, `coverage_rate = available_checks / total_checks`,
tracks this — see §10.)

## 10. Coverage criterion

**`coverage_rate === 1.0`** — i.e., all eight scanners should reach
`available` status once the project is fully set up. This is a one-time
condition for the project, not a per-session one. The `coverage_rate` is
exposed in the snapshot for visibility.

## 11. Adoption criterion

Every session that touches the project MUST start with:

```bash
node scripts/session-init.js
```

This is enforced socially by including the requirement in `AGENTS.md`
(updated as part of this work) and architecturally by having every other
operational protocol reference the snapshot at `.opencode/state/session-latest.json`.

## 12. Acceptance gate

A session is considered to have started with "100% accurate, up-to-date
knowledge of the project's current status" iff, at session start:

- `validation.summary.pass_rate === 1.0` (over available checks), AND
- `coverage_rate === 1.0` (after the one-time setup phase), AND
- Zero critical-severity issues in `unified.issues`, AND
- The timeline includes at least one event (proving the load step worked).

If any of these fail, the session does not have accurate knowledge and
remediation is the first order of business — per the drift prevention
framework §3.
