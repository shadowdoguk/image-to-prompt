## Agent skills

### Session initialization

Every session begins by running `node scripts/session-init.js` to load the
project's current state. The script emits a normalized snapshot to
`.opencode/state/session-latest.json` and validates against ten checks (V1–V10).
The mechanism is documented in `docs/agents/session-init.md` (this file's
peer); the acceptance gate is in `docs/agents/success-criteria.md`.

If validation pass rate is below 100%, follow `docs/agents/drift-prevention.md`
§3 before any other work.

### Issue tracker

Issues are tracked in GitHub Issues (using the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Bug resolution workflow

When a bug is reported, follow `docs/agents/bug-workflow.md` (triage → class →
label → file → priority → fix → verify).

### Feature request workflow

When a feature is requested, follow `docs/agents/feature-workflow.md`
(requirements → feasibility → design → implement → verify).

### Triage labels

The default triage label vocabulary is used: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Drift prevention

Operational protocol for drift detection and mitigation. See `docs/agents/drift-prevention.md`.

### Success criteria

Measurable acceptance criteria for the session initialization mechanism. See `docs/agents/success-criteria.md`.
