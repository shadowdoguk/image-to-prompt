# Session Initialization Mechanism

The session initialization mechanism is the AI's "boot sequence" at the
start of every session. It produces a single, normalized, validated snapshot
of the project's current state so the AI can act on accurate context.

## How to run

```bash
node scripts/session-init.js
```

Always run this before any other work in a session. The script is
read-only — it never mutates the project.

## What it does

The script runs eight independent scanners, normalizes their results, runs
ten validation checks, and emits:

- **JSON to stdout** — machine-readable, parseable by other tools.
- **Summary to stderr** — human-readable, fits a terminal scrollback.
- **Snapshot file** at `.opencode/state/session-latest.json` — overwritten each run.
- **Historical file** at `.opencode/state/session-<timestamp>.json` — append-only.

## Scanners

| # | Scanner | Source | Degraded when |
|---|---|---|---|
| 1 | `version_control` | `git` (if `.git/` exists) | Project is not a git repo |
| 2 | `issue_tracker` | `gh` CLI + `git remote` | No git, no remote, gh not authenticated, or query fails |
| 3 | `adr_log` | `docs/adr/*.md` | Directory missing |
| 4 | `domain_doc` | `CONTEXT.md` | File missing |
| 5 | `runtime_logs` | `server.log` pattern detection | No log file or no signals of interest |
| 6 | `code_drift` | README ↔ server.js, package.json ↔ filesystem, agent docs ↔ CLAUDE.md | Disagreements found |
| 7 | `presets` | `data/presets.json` | Missing, corrupt, or wrong shape |
| 8 | `uploads` | `uploads/` contents | Leftover files detected |

Each scanner is independent. A failure in one does not block the others.

## Normalization

Every scanner's raw `status` is mapped to one of three normalized values:

- `available` — the source is reachable and the data is clean.
- `degraded` — the source is reachable but reports a problem (drift, dirty
  tree, corrupt data, leftover uploads).
- `unavailable` — the source is unreachable (no git repo, no `gh`, no
  remote, no log file).

The normalized value drives how the unified state treats the scanner's
contribution.

## Validation checks (V1–V10)

| ID | Check |
|---|---|
| V1 | All required agent docs present |
| V2 | CONTEXT.md exists |
| V3 | presets.json parses as a valid array |
| V4 | package.json `test` script path resolves |
| V5 | Zero high-severity drifts |
| V6 | Every docs/agents/*.md referenced from CLAUDE.md exists |
| V7 | uploads/ is empty |
| V8 | docs/adr/ present iff any doc references it |
| V9 | Issue tracker (gh) is reachable |
| V10 | server.log has no auth-failure patterns |

See `docs/agents/success-criteria.md` for the precise pass conditions and
the acceptance gate.

## Unified state

The script's `unified` block collapses scanner outputs into:

- `issues[]` — every critical/high/medium signal, tagged with severity,
  area, message, and suggested action.
- `open_issues_by_label` — counts of GitHub issues per triage label.
- `recent_adrs` — the most recent 3 ADRs with status.
- `pending_actions` — concrete next steps derived from critical/high issues.

## Timeline reconstruction

The `timeline` array is built from:

- Every ADR (with its `## Status` section).
- The most recent git commit (if git is available).
- The `mtime` of `server.log` (if it exists).
- Any high-severity scanner signal.

Events are sorted chronologically. The timeline is the AI's reconstructed
view of "where the project is right now."

## Usage pattern

```bash
# At session start:
node scripts/session-init.js

# Inspect the snapshot:
cat .opencode/state/session-latest.json | jq '.unified.issues'
cat .opencode/state/session-latest.json | jq '.validation.summary'
cat .opencode/state/session-latest.json | jq '.timeline'
```

## Acceptance gate

A session is considered to have started with "100% accurate knowledge" iff
`validation.summary.pass_rate === 1.0` (over available checks) AND zero
critical-severity issues. See `docs/agents/success-criteria.md` §12.

If the gate fails, follow `docs/agents/drift-prevention.md` §3 before any
other work.

## Idempotency

Running the script twice in a row produces identical `validation` and
`unified` blocks (only `session_id`, `started_at`, `finished_at`, and
`timeline` may differ).
