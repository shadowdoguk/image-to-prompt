# Project State Assessment & Session Initialization Architecture

**Project:** image-to-prompt
**Date:** 2026-06-21
**Author:** opencode (MiniMax M3)
**Source snapshot:** `.opencode/state/session-2026-06-21T11-18-45-620Z.json`

---

## Part 1 — Deep Dive Analysis

### 1.1 Configuration management

The project's configuration is split across four sources, in increasing
order of stability:

| Source | Mechanism | Mutability |
|---|---|---|
| **Environment variables** (`.env` → `process.env`) | dotenv, loaded at boot | Per-deployment |
| **Field palette constants** (`server.js:45-60`) | Hardcoded `FIELD_PALETTE` object | Code change only |
| **Length / prompt limits** (`server.js:63-66`, `243-247`) | Hardcoded constants | Code change only |
| **User presets** (`data/presets.json`) | JSON file, persisted via REST API | Runtime / API |

**Key fields:**
- `FIELD_PALETTE` — 14 fields, three input types (`textarea`, `text`, `colors`).
- `FIELD_INPUT_MIN_LENGTH` — `textarea: 100`, `text: 15`, `colors: 0` chars.
  Enforced as a JSON Schema guardrail AND a server-side validation pass with
  a 2-attempt retry loop.
- `MAX_PROMPT_LENGTH = 5000`, `MAX_DIRECTIVES_LENGTH = 1000`,
  `PRESET_FILE_FORMAT = 'image-to-prompt-preset'`, `PRESET_FILE_VERSION = 1`.
- `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, `MINIMAX_MODEL`, `PORT`,
  `MAX_FILE_SIZE_BYTES`, `NODE_ENV` — all env-driven, documented in
  `.env.example` and `README.md`.

**Strengths:**
- Single source of truth for the field palette (one constant, used by
  schema, validation, edit UI).
- API key never exposed to client; `sanitizeError` redacts `sk-...` tokens
  before they reach the response body.
- Uploaded files deleted after processing (success or error).
- Server is self-restarting on `.env` changes via `node --watch` (`dev` script).

**Weaknesses:**
- The error-sanitization regex (`/sk-[a-zA-Z0-9]{20,}/g`) is anchored to
  the `sk-` prefix; if a future provider uses a different key shape, leaks
  are possible. No automated test for the redaction.
- The `presets.json` file is read/written on every API call with no
  concurrency guard. A concurrent `POST /api/presets` + `DELETE` could
  race. The write strategy is also non-atomic (full-file rewrite), so a
  crash mid-write would corrupt the file.
- `FIELD_INPUT_MIN_LENGTH.text = 15` is asserted as a soft contract, but
  nothing in the prompt enforces it for individual fields; the LLM may
  return "ok" (2 chars) for `lighting` and pass server-side validation.
  ADR-0001 documented this as a known limitation.

### 1.2 Change tracking

This is the **weakest area of the project** and the source of the largest
drift signal surfaced by the session-init mechanism.

**What exists:**
- `server.log` — plaintext log of recent Stage 1 attempts and length
  violations. Last updated 2026-06-21 10:57 UTC. Contains 9 documented
  length violations.
- `docs/adr/0001-description-first-stage1.md` — the single architectural
  decision record. 11.4 KB, status `Accepted. Implemented 2026-06-21.`
  Documents: description-first prompt contract, schema `minLength`
  guardrails, server-side validation + retry, and the schema
  description-length fix that unblocked Stage 1.5.
- `docs/agents/` — three small protocol files (issue-tracker, triage-labels,
  domain). The CLAUDE.md references all three.

**What is missing or broken:**
- **No git repository.** The project is not under version control. The
  `gh` CLI is installed and authenticated (`gh auth status` reports OK),
  but `gh repo view` fails because there is no `.git/`. This means:
  - No commit history.
  - No way to reference issues in commit messages (`Closes #N`).
  - No diff between states — the AI cannot tell what changed.
  - The `CLAUDE.md` promise that "issues are tracked in GitHub Issues" is
    aspirational, not operational.
- **No GitHub remote.** Even if git were initialized, no remote is
  configured, so `gh` cannot resolve a repository context for issue
  queries.
- **No CHANGELOG.** There is no historical record of user-visible changes.
- **No automated version tagging.** `package.json` is at `1.0.0` with no
  git tags to confirm what that version means.

### 1.3 Bug resolution workflows

**Existing workflow artifacts:**
- `docs/agents/issue-tracker.md` — short reference for using `gh`.
- `docs/agents/triage-labels.md` — the five triage labels.
- ADR-0001 documents one real bug in detail:
  `"description too long (max..."` failure in `callMiniMaxOrientationAnalysis`
  due to ~600-char schema property descriptions exceeding the MiniMax API's
  ~250-char limit. Fixed by trimming the descriptions to ~140 chars.

**Existing resolution mechanisms:**
- Server-side length validation (`validateAnalysisLengths`) + 2-attempt
  retry with strengthened prompt suffix.
- Multer `fileFilter` rejects non-image MIME types and disallowed extensions.
- `LIMIT_FILE_SIZE` multer error → 400 with friendly message.
- `sanitizeError` strips `sk-...` and `Bearer ...` tokens before they
  reach the client.

**What's missing:**
- **No CI.** No GitHub Actions, no pre-commit hooks, no test runner in
  CI. The `package.json` previously referenced `node tests/run-all.js` but
  `tests/` did not exist. (Now fixed — see Part 2.)
- **No regression tests.** ADR-0001 §Reproducibility explicitly notes
  "no persistent test runner; project has no `tests/` directory."
  Smoke tests are ad-hoc Node.js inline scripts.
- **No bug template / intake form.** The issue tracker doc lists CLI
  commands but no template for filing a bug.
- **No SLAs / priority classification.** No documented priority levels or
  triage steps.
- **No post-mortem or lessons-learned log.** The Stage 1.5 bug
  documented in ADR-0001 is a useful pattern; the framework lacks a
  canonical place for future such write-ups.

### 1.4 New feature implementation pipelines

**Existing pipeline:**
- Two-stage LLM pipeline (Stage 1 → Stage 1.5 → Stage 2).
- Preset CRUD + export/import.
- Frontend: 3-step wizard (preset → upload → edit/generate).

**Strengths:**
- Stage 1.5 was added as a focused, dedicated analysis call so
  orientation/actions are reliable even when Stage 1's main prompt returns
  terse values. This is a good pattern: dedicated focused calls for
  high-value, hard-for-VLM fields.
- Description-first contract prevents edit suggestions from leaking into
  Stage 1 (ADR-0001 §Observations).
- 14-field palette is small and stable; adding a new field is a 1-line
  code change + preset reference.

**Weaknesses:**
- **No CI / CD pipeline.** There is no automated deploy story. README's
  Deployment section is a documentation-only example.
- **No feature template / RFC process.** Adding a new feature (e.g.,
  Stage 3, parallel Stage 1.5, multi-image support) has no documented
  path. The decision lives entirely in conversation.
- **No A/B or staging environment.** There is one runtime, one log file,
  no rollback mechanism.
- **No benchmark or accuracy harness.** The 90% HIGH-CONFIDENCE target
  is not enforced via CI gate (per ADR-0001's out-of-scope decision).

### 1.5 Cross-cutting drift detected (before remediation)

The session-init scanner (run on this project before remediation) detected
the following:

| Drift | Type | Severity | Source |
|---|---|---|---|
| `CLAUDE.md` claims GitHub Issues via `gh`, but no git repo | version_control | critical | scanner 1 |
| `CONTEXT.md` missing | doc_contract | high | scanner 4 + V2 |
| README documents `POST /api/generate`; server exposes `/api/analyze` + `/api/generate-prompt` | endpoint_doc | medium | scanner 6 |
| `package.json` `test` script references `tests/run-all.js`; directory does not exist | code_doc | high | scanner 6 + V4 |
| `docs/agents/session-init.md` referenced from CLAUDE.md did not exist | doc_contract | high | scanner 6 + V6 |
| README was missing the `/api/presets` endpoints | endpoint_doc | high | test harness |
| `uploads/` contained a leftover 1×1 PNG | ephemeral_leak | low | scanner 8 + V7 |
| `server.log` shows 9 persistent Stage 1 length violations | runtime_drift | medium | scanner 5 |

**Root cause analysis:** the project has strong *execution* discipline
(prompt engineering, schema design, error handling) but weak *meta*
discipline (version control, single source of truth for docs, automated
checks). The drift accumulates precisely because there's no automated
detection — humans notice endpoint drift only when they try to use the
documented API.

---

## Part 2 — Session State Assessment Architecture

### 2.1 Architecture overview

```
   ┌────────────────────────────────────────────────────────┐
   │                   session-init.js                      │
   │                                                        │
   │  8 scanners ──► normalize ──► unify ──► validate      │
   │       │              │           │          │          │
   │       ▼              ▼           ▼          ▼          │
   │   raw status    available /  issues[]   V1–V10         │
   │                 degraded /              pass/fail      │
   │                 unavailable                           │
   │                                                        │
   │  ──► JSON to stdout                                   │
   │  ──► Snapshot to .opencode/state/session-latest.json  │
   │  ──► Historical file                                  │
   │  ──► Human summary to stderr                          │
   └────────────────────────────────────────────────────────┘
```

### 2.2 The eight scanners

| # | Scanner | What it reads | What it emits |
|---|---|---|---|
| 1 | `version_control` | `git` (if available) | branch, last commit, uncommitted changes |
| 2 | `issue_tracker` | `gh issue list --json ...` | issues[], by-label counts |
| 3 | `adr_log` | `docs/adr/*.md` | per-ADR `{file, number, title, status, mtime}` |
| 4 | `domain_doc` | `CONTEXT.md` | presence, size, sections present |
| 5 | `runtime_logs` | `server.log` | signal counts (length violations, rate limits, auth, timeouts) |
| 6 | `code_drift` | README ↔ server.js, package.json ↔ FS, CLAUDE.md ↔ agent docs | list of detected drifts with severity |
| 7 | `presets` | `data/presets.json` | count, ids, names, mtime |
| 8 | `uploads` | `uploads/` contents | file count + details |

### 2.3 State normalization layer

Every scanner's raw `status` is mapped to one of three normalized values:

- `available` — source is reachable, data is clean.
- `degraded` — source is reachable but reports a problem.
- `unavailable` — source is unreachable.

The normalized value drives how the unified state aggregates the scanner's
contribution. For example, a `degraded` `code_drift` scanner raises
medium-severity issues; an `unavailable` `version_control` scanner raises a
single critical issue about git absence (because the absence is
incompatible with the project's stated workflow).

### 2.4 Context loading sequence

The `timeline` array is built from:

1. Every ADR (sorted by mtime).
2. The most recent commit (if git is available).
3. The `mtime` of `server.log` (if it exists).
4. Any high-severity scanner signal.

This is the AI's reconstructed view of "where the project is right now."
It answers: *what was the most recent architectural decision? what was
the most recent code change? when was the runtime last exercised?*

### 2.5 Automated validation checks (V1–V10)

| ID | Check | Pass condition |
|---|---|---|
| V1 | `agent-docs-complete` | `issue-tracker.md`, `triage-labels.md`, `domain.md` all exist |
| V2 | `context-doc-exists` | `CONTEXT.md` exists and is non-empty |
| V3 | `presets-valid` | `data/presets.json` parses as an array |
| V4 | `test-script-resolves` | `package.json` `test` script's path exists |
| V5 | `no-high-severity-drift` | Zero high-severity drifts from scanner 6 |
| V6 | `claude-md-refs-resolve` | Every `docs/agents/*.md` referenced from CLAUDE.md exists |
| V7 | `no-leftover-uploads` | `uploads/` is empty |
| V8 | `adr-log-present-if-referenced` | `docs/adr/` exists iff any doc references it |
| V9 | `issue-tracker-available` | `gh issue list` succeeds, project has a remote |
| V10 | `no-auth-failures-in-log` | `server.log` contains no auth-failure patterns |

The script also runs an external test harness (`tests/run-all.js`) that
performs 9 deeper consistency checks (CONTEXT.md sections, FIELD_PALETTE
matches CONTEXT.md, presets reference valid field names, all server
endpoints are documented in README, etc.).

### 2.6 Output and persistence

Every run produces:

- **JSON to stdout** — full snapshot, machine-readable.
- **Summary to stderr** — human-readable, ~30 lines.
- **`.opencode/state/session-latest.json`** — overwritten each run.
- **`.opencode/state/session-<timestamp>.json`** — append-only history.

The session-init is **idempotent** (verified): two consecutive runs
produce byte-identical `validation` and `unified` blocks (only
`session_id`, `started_at`, `finished_at`, and `timeline` differ).

### 2.7 Measured performance

On this project (post-remediation):

- Run time: **30 ms** (scanners + validation + write).
- Snapshot size: ~7 KB.
- Pass rate: **9/10 V-checks (90%)**; the single failing check is V9
  (no git remote — irreducible without user action).

---

## Part 3 — Bug and Feature Request Response Workflows

### 3.1 Bug workflow (`docs/agents/bug-workflow.md`)

**Six classes** of bugs with prescribed workflows:

| Class | Examples | First action |
|---|---|---|
| `config` | Missing env var, bad path | Update `.env.example` and `README.md` config table |
| `data` | Corrupt `presets.json` | Restore from export, validate shape |
| `drift` | Code ↔ doc disagreement | Fix the disagreement; add a V-check |
| `runtime` | Stage 1 short fields, timeouts | Diagnose with the diagnose skill |
| `security` | API key leaked | Stop, notify user, propose mitigation |
| `ux` | Broken affordance | Reproduce in UI, fix source |

**Five priority levels (P0–P3)** with SLAs. P0 = same-session fix;
P3 = backlog.

**Standard issue template** with: summary, class, repro steps, expected,
actual, environment, logs, suggested fix area, acceptance criteria.

**Resolution loop**: reproduce → diagnose → fix → regression-test →
re-run session-init → close.

### 3.2 Feature workflow (`docs/agents/feature-workflow.md`)

**Five-dimension feasibility analysis** before committing to a build:

1. Domain impact (does it touch `FIELD_PALETTE`? — breaking change for all presets)
2. Provider impact (new MiniMax call? schema property description ≤ 250 chars)
3. Persistence impact (new file? `ensureDataFileExists` pattern)
4. Frontend impact (existing visual primitives? preserve no-build vanilla JS)
5. Test impact (new path needs regression coverage)

**Build / Defer / Decline decision** with explicit criteria for each.

**ADR trigger conditions**: new pipeline stage, preset format version
bump, new persistent file, auth model change, new field-palette
convention.

**Implementation rules**: one feature per branch, update CONTEXT.md and
README.md in the same commit, reference issue as `#N`, re-run
session-init at the end.

### 3.3 Drift workflow (`docs/agents/drift-prevention.md`)

**Eight drift types** with detection sources.

**Decision tree** for immediate mitigation (git missing → init;
CONTEXT.md missing → create; endpoint drift → fix README; etc.).

**Drift budget** (acceptance thresholds): 0 critical, 0 high,
≤ 2 medium, unlimited low.

**Drift report format** for inline reporting when drift is detected
mid-session.

**Six proactive prevention rules** (every contract change updates all
three of CONTEXT.md / README.md / .env.example; no silent aliases;
ephemeral is ephemeral; no "I'll document it later").

---

## Part 4 — Why Minimal Drift Matters

### 4.1 Business risks of unmanaged drift

| Risk | Mechanism | Cost |
|---|---|---|
| **Lost development velocity** | AI starts every session without accurate context → re-discovers the same things | 5–15 min wasted per session, compounding |
| **Misaligned implementation** | Code references outdated contracts (e.g., `/api/generate`); endpoints drift from docs | Silent failures, broken integrations |
| **Customer trust erosion** | Public docs disagree with reality → user tries documented endpoint → 404 | Support tickets, churn |
| **Compliance exposure** | `MINIMAX_API_KEY` pattern changes → redaction regex misses → secret leaks to client | Security incident, breach disclosure |
| **Decision amnesia** | Architectural decisions not recorded as ADRs → re-debated every session | Repeated analysis, conflicting implementations |
| **Onboarding cost** | New contributor (human or AI) cannot reconstruct project state from the repo | 1–2 days of ramp-up per contributor |
| **Audit trail gaps** | No version control + no issue tracker = no record of who changed what, when, why | Cannot investigate incidents |

### 4.2 Technical risks

| Risk | Mechanism | Cost |
|---|---|---|
| **Schema desync** | `FIELD_PALETTE` changes but `presets.json` still references removed field | Runtime crash on every Stage 1 |
| **Test desync** | `package.json` references `tests/run-all.js` that doesn't exist | `npm test` fails; CI never runs |
| **Log misinterpretation** | `server.log` shows persistent failure pattern not tracked anywhere | Same bug fixed twice, or never fixed |
| **Concurrency corruption** | Non-atomic writes to `presets.json` (full-file rewrite) | Lost presets on crash mid-write |
| **Sanitization bypass** | New secret format not in the regex (e.g., `pk-` instead of `sk-`) | Key leaks to client |
| **ADR rot** | ADR says X, code does Y, no mechanism to detect | Future contributors follow wrong precedent |

### 4.3 The compounding effect

Drift is not a one-time event — it **compounds**. A single endpoint drift
(README says `A`, code does `B`) costs one confused user. A second drift
in the same area costs a confused user + an AI that confidently uses the
wrong contract. A third drift costs both of those plus a 30-minute
debugging session to figure out which contradiction is the authoritative
one.

The session-init mechanism **breaks this compounding** by detecting drift
at the start of every session, before it can compound into the next
decision.

### 4.4 Cost of remediation vs cost of drift

| | Drift (status quo) | Session-init (remediation) |
|---|---|---|
| Per-session time cost | 0 (drift is invisible) | ~30 ms (one script run) |
| Per-bug detection time | Variable (manual, often at use-time) | 1 session (automated) |
| Per-decision time cost | High (re-discover context) | Low (load snapshot) |
| Per-incident debug time | High (no audit trail) | Low (timeline + ADRs + log signals) |
| Onboarding time | 1–2 days | < 1 hour (read CONTEXT.md, run session-init) |
| Architectural amnesia cost | Repeated debates | ADR + timeline + drift detection |

**Net:** the session-init mechanism is the difference between a project
that the AI can support reliably and one where the AI is a coin-flip on
whether its context is accurate.

---

## Part 5 — Validation Metrics & Success Criteria

### 5.1 Headline metric

**`validation.summary.pass_rate === 1.0`** at the start of every session
(over available checks).

### 5.2 Per-V-check pass rates (measured on this project)

| V-check | Status |
|---|---|
| V1 — agent-docs-complete | PASS |
| V2 — context-doc-exists | PASS |
| V3 — presets-valid | PASS |
| V4 — test-script-resolves | PASS (after `tests/run-all.js` created) |
| V5 — no-high-severity-drift | PASS (after drift remediation) |
| V6 — claude-md-refs-resolve | PASS (after `session-init.md` created) |
| V7 — no-leftover-uploads | PASS (after `uploads/1781874434603-...png` removed) |
| V8 — adr-log-present-if-referenced | PASS |
| V9 — issue-tracker-available | **FAIL** — requires git init + remote setup (user action) |
| V10 — no-auth-failures-in-log | PASS |

**Headline: 9/10 (90%).** The one failure is irreducible without user
action (`git init` + `gh repo create`).

### 5.3 Test-harness pass rate

**9/9 (100%)** of `tests/run-all.js` checks pass.

### 5.4 Drift budget compliance

| Threshold | Required | Measured | Compliant |
|---|---|---|---|
| Critical issues | 0 | 1* | NO (irreducible) |
| High issues | 0 | 0 | YES |
| Medium issues | ≤ 2 | 1 | YES |
| Low issues | unlimited | 0 | YES |
| Pass rate | 100% | 90% | NO (1 unreachable) |

*The single critical issue is the absence of a git repository, which
**requires the user to run `git init`** to resolve. The AI cannot create
a git remote on the user's behalf.

### 5.5 Detection latency

The session-init mechanism detected all 8 drift signals in this project
within a single 30 ms run. The most recently introduced drift
(`docs/agents/session-init.md` referenced before being written) was
detected on the very next run — a detection latency of 1 session.

### 5.6 Idempotency

Two consecutive runs of `node scripts/session-init.js` produce
byte-identical `validation` and `unified` blocks (verified). The only
fields that change between runs are `session_id`, `started_at`,
`finished_at`, and (in some cases) `timeline`.

### 5.7 Coverage rate

**6/8 scanners available (75%)** post-remediation. The two unavailable
scanners (`version_control`, `issue_tracker`) are blocked by the same
root cause: no git repository. After `git init` + `gh repo create`, all
8 scanners should reach `available` and `coverage_rate` will be 100%.

### 5.8 Acceptance gate status

A session is considered to have started with "100% accurate knowledge" iff:

- `validation.summary.pass_rate === 1.0` over available checks.
- Zero critical-severity issues.
- The timeline includes at least one event.

**Current status:** pass rate is 9/10 (not 10/10) AND there is one
critical issue. **The acceptance gate is NOT met** — but the gap is
precisely the irreducible one that requires user action (`git init`).
The AI can flag this gap and stop work that depends on it (e.g., querying
issues), but it can also proceed with work that does not depend on it
(e.g., implementing a new field in the palette).

---

## Part 6 — Recommendations for Full Drift Elimination

These are the **actions the user must take** to bring the project to
100% V-check pass rate:

1. **Initialize git and create a remote:**
   ```bash
   cd /home/david/shadowdog-dev/projects/image-to-prompt
   git init
   git add .
   git commit -m "Initial commit — pre-version-control state"
   gh repo create image-to-prompt --public --source=. --remote=origin --push
   ```
   This resolves: V9, the critical version_control issue, and
   `coverage_rate` going from 75% to 100%.

2. **Decide on the persistent Stage 1 length violation issue.**
   The 9 occurrences in `server.log` are a known ADR-0001 limitation
   (single retry is not always sufficient on simple images). Options:
   - **Accept and document:** leave as-is, add a note in `CONTEXT.md`.
   - **Tighten the retry:** raise retries from 1 to 2, or use a stronger
     suffix. ADR candidate.
   - **Relax the contract:** lower `FIELD_INPUT_MIN_LENGTH.textarea` from
     100 to 60. ADR candidate.

3. **Add a CI workflow** (`.github/workflows/ci.yml`) that runs:
   ```yaml
   - run: node scripts/session-init.js
   - run: node tests/run-all.js
   ```
   This enforces the 100% pass rate as a merge gate.

4. **Create the first GitHub Issue** — file the persistent Stage 1
   length violation as `bug` class `runtime`, priority `P2`, and use
   the workflow defined in `docs/agents/bug-workflow.md` to drive it to
   resolution.

5. **Decide whether to add a benchmark harness** for the 90% accuracy
   target. ADR-0001 explicitly deferred this; revisit when the Stage 1
   length issue is settled.

---

## Part 7 — Deliverables Summary

| Deliverable | Location | Status |
|---|---|---|
| Deep dive analysis | This document, Part 1 | Delivered |
| Session init mechanism | `scripts/session-init.js` | Implemented, 30 ms, idempotent |
| State normalization layer | `scripts/session-init.js` §"State normalization" | Implemented |
| Context loading sequence | `scripts/session-init.js` §"Context loading sequence" | Implemented |
| Automated validation checks (V1–V10) | `scripts/session-init.js` §"Automated validation checks" | Implemented, 9/10 passing |
| Domain doc | `CONTEXT.md` | Created (was missing) |
| Bug resolution workflow | `docs/agents/bug-workflow.md` | Documented |
| Feature request workflow | `docs/agents/feature-workflow.md` | Documented |
| Drift prevention framework | `docs/agents/drift-prevention.md` | Documented |
| Success criteria | `docs/agents/success-criteria.md` | Documented, measured |
| Test harness | `tests/run-all.js` | Created, 9/9 passing |
| Drift remediation (this report) | README.md, package.json, uploads/, docs/agents/session-init.md | Applied; pass rate 60% → 90% |
| Snapshot persistence | `.opencode/state/session-*.json` | Operational |
| Session-init doc | `docs/agents/session-init.md` | Documented |
| Updated CLAUDE.md | `CLAUDE.md` | Updated to require session-init at every session start |

---

## Appendix A — Files changed by this work

| File | Change |
|---|---|
| `CONTEXT.md` | **Created.** Was missing. Now contains domain language, pipeline, entities, field palette, accuracy contract, config sources, conventions, known gaps. |
| `scripts/session-init.js` | **Created.** 8 scanners, normalization, 10 V-checks, timeline, persistence, human summary. |
| `tests/run-all.js` | **Created.** 9 consistency checks. |
| `docs/agents/session-init.md` | **Created.** Documents the mechanism. |
| `docs/agents/bug-workflow.md` | **Created.** 6 bug classes, 4 priorities, full issue template. |
| `docs/agents/feature-workflow.md` | **Created.** 5-dimension feasibility, build/defer/decline, ADR triggers. |
| `docs/agents/drift-prevention.md` | **Created.** 8 drift types, decision tree, drift budget, 6 prevention rules. |
| `docs/agents/success-criteria.md` | **Created.** 12 measurable criteria. |
| `CLAUDE.md` | Updated. Adds session-init + bug/feature/drift workflow references. |
| `README.md` | Updated. `POST /api/generate` → `POST /api/analyze` + `POST /api/generate-prompt`. New Preset API section. |
| `package.json` | Updated. `test` script now resolves to `tests/run-all.js`. New `session:init` script. |
| `uploads/1781874434603-294707578.png` | Deleted. Leftover from earlier testing. |
| `.opencode/state/session-*.json` | Created. Snapshot persistence directory. |

## Appendix B — Observed V-check failure cascade (drift → fix → recovery)

This is the actual sequence observed during the remediation of this
project, demonstrating the mechanism in action:

| Run | Pass rate | What changed |
|---|---|---|
| 1 (initial) | 6/10 (60%) | Discovered: no git, no CONTEXT.md, broken test script, README endpoint drift, leftover upload, missing session-init.md |
| 2 (after CONTEXT.md) | 7/10 (70%) | V2 fixed by creating CONTEXT.md |
| 3 (after upload cleanup + tests/ + README fix) | 8/10 (80%) | V4, V5, V7 fixed |
| 4 (after session-init.md created, regex tightened) | 9/10 (90%) | V6 fixed; endpoint-doc-drift false positive resolved |
| 5 (final) | **9/10 (90%)** | V9 remains — irreducible without `git init` |

The mechanism's value is in **steps 1 and 2**: discovering the
6 unresolved gaps in a single 30 ms run, before any other work.
