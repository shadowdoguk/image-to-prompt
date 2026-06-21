#!/usr/bin/env node
/**
 * session-init.js
 *
 * Session initialization mechanism for the image-to-prompt project.
 *
 * Runs at the start of every AI session to produce a normalized, validated
 * snapshot of the project's current state. Outputs:
 *
 *   - JSON to stdout (machine-readable)
 *   - .opencode/state/session-latest.json (durable snapshot)
 *   - .opencode/state/session-<timestamp>.json (historical snapshot)
 *   - human-readable summary to stderr
 *
 * Scanners (each is independent and degrades gracefully if its source is
 * unavailable — no scanner failure should block the rest):
 *
 *   1. version_control  — git status, last commit, branch, uncommitted changes
 *   2. issue_tracker    — gh CLI for GitHub Issues (open, by label, by state)
 *   3. adr_log          — docs/adr/*.md, status, date, summary
 *   4. domain_doc       — CONTEXT.md presence + freshness
 *   5. runtime_logs     — server.log pattern detection (Stage 1 length violations,
 *                         rate limits, auth errors, etc.)
 *   6. code_drift       — README ↔ server.js endpoint drift; missing files;
 *                         references to missing modules
 *   7. presets          — data/presets.json shape + integrity
 *   8. uploads          — uploaded files left behind (should be ephemeral)
 *
 * The scanner NEVER mutates the project. It only reads.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const STATE_DIR = path.join(PROJECT_ROOT, '.opencode', 'state');
const ADR_DIR = path.join(PROJECT_ROOT, 'docs', 'adr');
const AGENT_DOCS_DIR = path.join(PROJECT_ROOT, 'docs', 'agents');
const CONTEXT_FILE = path.join(PROJECT_ROOT, 'CONTEXT.md');
const SERVER_LOG = path.join(PROJECT_ROOT, 'server.log');
const SERVER_JS = path.join(PROJECT_ROOT, 'server.js');
const README = path.join(PROJECT_ROOT, 'README.md');
const PRESETS_FILE = path.join(PROJECT_ROOT, 'data', 'presets.json');
const UPLOADS_DIR = path.join(PROJECT_ROOT, 'uploads');
const PACKAGE_JSON = path.join(PROJECT_ROOT, 'package.json');
const CLAUDE_MD = path.join(PROJECT_ROOT, 'CLAUDE.md');

const STARTED_AT = new Date().toISOString();
const SESSION_ID = `sess_${STARTED_AT.replace(/[:.]/g, '-')}_${crypto.randomBytes(3).toString('hex')}`;

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function safe(fn, fallback = null) {
  try { return fn(); } catch (e) { return fallback; }
}

function shell(cmd, args, opts = {}) {
  return safe(
    () => execFileSync(cmd, args, {
      encoding: 'utf8',
      cwd: PROJECT_ROOT,
      timeout: opts.timeout || 10000,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim(),
    opts.fallback !== undefined ? opts.fallback : null
  );
}

function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function dirExists(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function readText(p) {
  return safe(() => fs.readFileSync(p, 'utf8'), null);
}

function fileMtime(p) {
  return safe(() => fs.statSync(p).mtime.toISOString(), null);
}

function fileSize(p) {
  return safe(() => fs.statSync(p).size, 0);
}

function relPath(p) {
  return path.relative(PROJECT_ROOT, p);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scanner 1 — Version control
// ─────────────────────────────────────────────────────────────────────────────

function scanVersionControl() {
  const isGitRepo = dirExists(path.join(PROJECT_ROOT, '.git'));
  if (!isGitRepo) {
    return {
      available: false,
      status: 'not-a-git-repo',
      drift_signal: 'CRITICAL: CLAUDE.md references GitHub Issues via `gh`, but project is not under git version control. All change tracking and `#N` commit references are impossible.',
      last_commit: null,
      branch: null,
      uncommitted_changes: null
    };
  }

  const branch = shell('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const lastCommit = shell('git', ['log', '-1', '--format=%H|%ai|%s|%an']);
  const statusPorcelain = shell('git', ['status', '--porcelain'], { fallback: '' });

  let lastCommitParsed = null;
  if (lastCommit) {
    const [hash, date, subject, author] = lastCommit.split('|');
    lastCommitParsed = { hash, date, subject, author };
  }

  return {
    available: true,
    status: statusPorcelain ? 'dirty' : 'clean',
    branch,
    last_commit: lastCommitParsed,
    uncommitted_changes: statusPorcelain
      ? statusPorcelain.split('\n').filter(Boolean)
      : []
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scanner 2 — Issue tracker (GitHub Issues via gh CLI)
// ─────────────────────────────────────────────────────────────────────────────

function scanIssueTracker() {
  // Check if gh is available + authenticated
  const ghVersion = shell('gh', ['--version'], { fallback: null });
  if (!ghVersion) {
    return {
      available: false,
      status: 'gh-cli-missing',
      drift_signal: 'Cannot query issues: `gh` CLI not available on PATH.'
    };
  }

  // Try to detect a remote (gh issue list requires a repo context)
  const remoteUrl = shell('git', ['config', '--get', 'remote.origin.url'], { fallback: null });
  if (!remoteUrl) {
    return {
      available: false,
      status: 'no-remote',
      drift_signal: 'Cannot query issues: project has no git remote configured. `gh` cannot resolve a repository context.',
      issues: []
    };
  }

  // gh issue list with --json for structured output
  const json = shell('gh', ['issue', 'list', '--state', 'all', '--limit', '100', '--json',
    'number,title,state,labels,createdAt,updatedAt,closedAt,author'],
    { fallback: null, timeout: 15000 });

  if (!json) {
    return {
      available: false,
      status: 'gh-query-failed',
      drift_signal: '`gh issue list` failed. Run `gh auth status` to verify credentials.',
      issues: []
    };
  }

  let issues = [];
  try { issues = JSON.parse(json); } catch { /* malformed */ }

  // Group by label
  const byLabel = {};
  for (const issue of issues) {
    for (const label of (issue.labels || [])) {
      const name = label.name || label;
      byLabel[name] = (byLabel[name] || 0) + 1;
    }
  }

  return {
    available: true,
    status: 'ok',
    remote: remoteUrl,
    total: issues.length,
    open: issues.filter(i => i.state === 'OPEN').length,
    closed: issues.filter(i => i.state === 'CLOSED').length,
    by_label: byLabel,
    issues: issues.map(i => ({
      number: i.number,
      title: i.title,
      state: i.state,
      labels: (i.labels || []).map(l => l.name || l),
      created: i.createdAt,
      updated: i.updatedAt,
      author: i.author?.login || null
    }))
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scanner 3 — ADR log
// ─────────────────────────────────────────────────────────────────────────────

function scanAdrLog() {
  if (!dirExists(ADR_DIR)) {
    return {
      available: false,
      status: 'no-adr-dir',
      drift_signal: `docs/adr/ directory missing. Architectural decisions have no canonical home.`,
      adrs: []
    };
  }

  const files = fs.readdirSync(ADR_DIR).filter(f => /^\d{4}-.+\.md$/.test(f)).sort();
  const adrs = files.map(f => {
    const full = path.join(ADR_DIR, f);
    const text = readText(full) || '';
    const statusMatch = text.match(/^##\s*Status\s*\n+([^\n#]+)/m);
    const titleMatch = text.match(/^#\s*(ADR\s+\d+\s*[—-]\s*.+)$/m);
    return {
      file: relPath(full),
      number: f.match(/^(\d{4})/)?.[1],
      title: titleMatch?.[1]?.trim() || f,
      status: statusMatch?.[1]?.trim() || 'unknown',
      size_bytes: fileSize(full),
      mtime: fileMtime(full)
    };
  });

  return { available: true, status: 'ok', count: adrs.length, adrs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scanner 4 — Domain doc
// ─────────────────────────────────────────────────────────────────────────────

function scanDomainDoc() {
  if (!fileExists(CONTEXT_FILE)) {
    return {
      available: false,
      status: 'missing',
      drift_signal: 'CONTEXT.md missing despite docs/agents/domain.md declaring it the canonical single-context file.'
    };
  }
  const text = readText(CONTEXT_FILE) || '';
  return {
    available: true,
    status: 'ok',
    size_bytes: fileSize(CONTEXT_FILE),
    line_count: text.split('\n').length,
    mtime: fileMtime(CONTEXT_FILE),
    has_known_gaps_section: /Known gaps/i.test(text),
    has_accuracy_contract: /Accuracy contract|HIGH-CONFIDENCE|BEST-EFFORT/i.test(text)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scanner 5 — Runtime logs (server.log pattern detection)
// ─────────────────────────────────────────────────────────────────────────────

function scanRuntimeLogs() {
  if (!fileExists(SERVER_LOG)) {
    return { available: false, status: 'no-log', signals: [] };
  }
  const text = readText(SERVER_LOG) || '';
  const lines = text.split('\n');

  const signals = [];
  const stage1LenViolation = (text.match(/Stage 1 attempt 2 still has \d+ length violation/g) || []).length;
  const rateLimit = (text.match(/Rate limit|429/g) || []).length;
  const authFail = (text.match(/authentication failed|401|403/g) || []).length;
  const timeout = (text.match(/timed out|AbortError/g) || []).length;
  const apiError = (text.match(/MiniMax M3 .* error \(\d+\)/g) || []).length;

  if (stage1LenViolation > 0) signals.push({
    type: 'stage1-length-violations',
    severity: 'medium',
    detail: `${stage1LenViolation} occurrences of "Stage 1 attempt 2 still has N length violation(s)" — known ADR-0001 limitation, but persistent.`
  });
  if (rateLimit > 0) signals.push({
    type: 'rate-limit',
    severity: 'medium',
    detail: `${rateLimit} rate-limit occurrences.`
  });
  if (authFail > 0) signals.push({
    type: 'auth-failures',
    severity: 'high',
    detail: `${authFail} auth failures. Check MINIMAX_API_KEY.`
  });
  if (timeout > 0) signals.push({
    type: 'timeouts',
    severity: 'medium',
    detail: `${timeout} timeout occurrences.`
  });
  if (apiError > 0) signals.push({
    type: 'api-errors',
    severity: 'medium',
    detail: `${apiError} API error responses.`
  });

  return {
    available: true,
    status: 'ok',
    log_lines: lines.length,
    log_size_bytes: fileSize(SERVER_LOG),
    log_mtime: fileMtime(SERVER_LOG),
    signals,
    signal_counts: { stage1LenViolation, rateLimit, authFail, timeout, apiError }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scanner 6 — Code drift (README ↔ code, missing files, broken refs)
// ─────────────────────────────────────────────────────────────────────────────

function scanCodeDrift() {
  const drifts = [];
  const checks = [];

  // README documents POST /api/generate — actual code uses /api/analyze + /api/generate-prompt
  const readme = readText(README) || '';
  const serverText = readText(SERVER_JS) || '';

  // Use a regex that matches /api/generate as a standalone endpoint (not as a
  // prefix of /api/generate-prompt). The negative lookahead prevents the
  // word-boundary issue where `-` is a word boundary.
  const readmeMentionsGenerate = /POST\s+\/api\/generate(?!-)/.test(readme);
  const serverHasAnalyze = /app\.post\(['"]\/api\/analyze['"]/.test(serverText);
  const serverHasGeneratePrompt = /app\.post\(['"]\/api\/generate-prompt['"]/.test(serverText);
  const serverHasPlainGenerate = /app\.post\(['"]\/api\/generate['"]/.test(serverText);

  if (readmeMentionsGenerate && !serverHasPlainGenerate) {
    drifts.push({
      type: 'endpoint-doc-drift',
      severity: 'medium',
      detail: `README documents "POST /api/generate" but server exposes "/api/analyze" (Stage 1) and "/api/generate-prompt" (Stage 2). Update README to match.`
    });
  }
  checks.push({ readmeMentionsGenerate, serverHasAnalyze, serverHasGeneratePrompt });

  // package.json references tests/run-all.js but tests/ doesn't exist
  const pkg = safe(() => JSON.parse(readText(PACKAGE_JSON) || '{}'), {});
  const testScript = pkg?.scripts?.test;
  if (testScript && /tests\/run-all\.js/.test(testScript) && !dirExists(path.join(PROJECT_ROOT, 'tests'))) {
    drifts.push({
      type: 'broken-test-script',
      severity: 'high',
      detail: `package.json "test" script references tests/run-all.js but tests/ directory does not exist. Run \`npm test\` will fail.`
    });
  }

  // CONTEXT.md presence (already covered by scanDomainDoc, but flag here too)
  if (!fileExists(CONTEXT_FILE)) {
    drifts.push({
      type: 'missing-context-doc',
      severity: 'high',
      detail: `CONTEXT.md missing despite docs/agents/domain.md declaring it the canonical single-context doc.`
    });
  }

  // Leftover uploads
  if (dirExists(UPLOADS_DIR)) {
    const leftovers = fs.readdirSync(UPLOADS_DIR).filter(f => !f.startsWith('.'));
    if (leftovers.length > 0) {
      drifts.push({
        type: 'leftover-uploads',
        severity: 'low',
        detail: `${leftovers.length} file(s) in uploads/ that should have been deleted after processing.`,
        files: leftovers
      });
    }
  }

  // Agent docs presence
  const requiredAgentDocs = ['issue-tracker.md', 'triage-labels.md', 'domain.md'];
  for (const doc of requiredAgentDocs) {
    const p = path.join(AGENT_DOCS_DIR, doc);
    if (!fileExists(p)) {
      drifts.push({
        type: 'missing-agent-doc',
        severity: 'high',
        detail: `Required agent doc missing: docs/agents/${doc}`
      });
    }
  }

  return {
    available: true,
    status: drifts.length === 0 ? 'clean' : 'drift-detected',
    drifts,
    checks
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scanner 7 — Presets
// ─────────────────────────────────────────────────────────────────────────────

function scanPresets() {
  if (!fileExists(PRESETS_FILE)) {
    return { available: false, status: 'missing' };
  }
  let presets = [];
  try { presets = JSON.parse(readText(PRESETS_FILE) || '[]'); }
  catch (e) {
    return { available: true, status: 'corrupt', error: e.message };
  }
  if (!Array.isArray(presets)) {
    return { available: true, status: 'invalid', error: 'presets.json is not an array' };
  }

  return {
    available: true,
    status: 'ok',
    count: presets.length,
    ids: presets.map(p => p.id),
    names: presets.map(p => p.name),
    mtime: fileMtime(PRESETS_FILE)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scanner 8 — Uploads
// ─────────────────────────────────────────────────────────────────────────────

function scanUploads() {
  if (!dirExists(UPLOADS_DIR)) {
    return { available: false, status: 'no-dir', files: [] };
  }
  const files = fs.readdirSync(UPLOADS_DIR).filter(f => !f.startsWith('.'));
  return {
    available: true,
    status: 'ok',
    file_count: files.length,
    files: files.map(f => {
      const p = path.join(UPLOADS_DIR, f);
      return { name: f, size_bytes: fileSize(p), mtime: fileMtime(p) };
    })
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// State normalization layer
// ─────────────────────────────────────────────────────────────────────────────

const NORMALIZED_STATUS = {
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  DEGRADED: 'degraded'
};

function normalizeStatus(raw) {
  if (!raw) return { ...raw, normalized: NORMALIZED_STATUS.UNAVAILABLE };
  if (raw.status === 'ok' || raw.status === 'clean') {
    return { ...raw, normalized: NORMALIZED_STATUS.AVAILABLE };
  }
  if (raw.status === 'drift-detected' || raw.status === 'dirty' || raw.status === 'corrupt') {
    return { ...raw, normalized: NORMALIZED_STATUS.DEGRADED };
  }
  return { ...raw, normalized: NORMALIZED_STATUS.UNAVAILABLE };
}

// Compute a unified project status from all scanner outputs
function unifyState(scanners) {
  const issues = [];

  // Critical: no git repo (but CLAUDE.md claims to use GitHub Issues)
  if (scanners.version_control.status === 'not-a-git-repo') {
    issues.push({
      severity: 'critical',
      area: 'version_control',
      message: scanners.version_control.drift_signal,
      action: 'Initialize git: `git init && git add . && git commit -m "Initial commit"` then create GitHub remote.'
    });
  }

  // Critical: missing CONTEXT.md
  if (scanners.domain_doc.status === 'missing') {
    issues.push({
      severity: 'critical',
      area: 'domain_doc',
      message: scanners.domain_doc.drift_signal,
      action: 'Create CONTEXT.md from docs/agents/domain.md contract.'
    });
  }

  // High: code drift
  if (scanners.code_drift.drifts) {
    for (const d of scanners.code_drift.drifts) {
      if (d.severity === 'high' || d.severity === 'medium') {
        issues.push({
          severity: d.severity,
          area: 'code_drift',
          message: d.detail,
          action: 'See drift_type=' + d.type
        });
      }
    }
  }

  // Medium: runtime signals
  if (scanners.runtime_logs.signals) {
    for (const s of scanners.runtime_logs.signals) {
      issues.push({
        severity: s.severity,
        area: 'runtime',
        message: s.detail,
        action: 'Investigate: ' + s.type
      });
    }
  }

  // Infer open issue buckets from GitHub Issues by label
  const openIssuesByLabel = scanners.issue_tracker.by_label || {};

  // Infer in-progress features / unresolved bugs from ADR statuses
  const adrs = scanners.adr_log.adrs || [];
  const recentAdrs = adrs.slice(-3).map(a => ({
    file: a.file,
    status: a.status,
    title: a.title
  }));

  return {
    issues,
    open_issues_by_label: openIssuesByLabel,
    recent_adrs: recentAdrs,
    pending_actions: issues.filter(i => i.severity === 'critical' || i.severity === 'high')
                          .map(i => i.action)
                          .filter(Boolean)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Context loading sequence
// ─────────────────────────────────────────────────────────────────────────────

function loadContextTimeline(scanners) {
  // Reconstruct a timeline from ADRs (architectural decisions),
  // commits (if git), and runtime log mtimes.
  const events = [];

  for (const adr of (scanners.adr_log.adrs || [])) {
    events.push({
      date: adr.mtime,
      type: 'adr',
      summary: `${adr.title} — ${adr.status}`,
      ref: adr.file
    });
  }

  if (scanners.version_control.last_commit) {
    const c = scanners.version_control.last_commit;
    events.push({
      date: c.date,
      type: 'commit',
      summary: c.subject,
      ref: c.hash.substring(0, 7),
      author: c.author
    });
  }

  if (scanners.runtime_logs.log_mtime) {
    events.push({
      date: scanners.runtime_logs.log_mtime,
      type: 'runtime',
      summary: 'server.log last updated',
      ref: 'server.log'
    });
  }

  events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Automated validation checks
// ─────────────────────────────────────────────────────────────────────────────

function runValidationChecks(scanners, unified) {
  const checks = [];

  // V1: Every required agent doc exists
  const requiredAgentDocs = ['issue-tracker.md', 'triage-labels.md', 'domain.md'];
  const missingAgentDocs = requiredAgentDocs.filter(d =>
    !fileExists(path.join(AGENT_DOCS_DIR, d))
  );
  checks.push({
    id: 'V1-agent-docs-complete',
    pass: missingAgentDocs.length === 0,
    detail: missingAgentDocs.length === 0
      ? 'All required agent docs present.'
      : `Missing: ${missingAgentDocs.join(', ')}`
  });

  // V2: CONTEXT.md present
  checks.push({
    id: 'V2-context-doc-exists',
    pass: scanners.domain_doc.status !== 'missing',
    detail: scanners.domain_doc.status === 'missing' ? 'CONTEXT.md missing' : 'CONTEXT.md present'
  });

  // V3: presets.json valid JSON
  checks.push({
    id: 'V3-presets-valid',
    pass: scanners.presets.status === 'ok',
    detail: `presets status = ${scanners.presets.status}`
  });

  // V4: package.json test script points to existing file
  const pkg = safe(() => JSON.parse(readText(PACKAGE_JSON) || '{}'), {});
  const testScript = pkg?.scripts?.test;
  let testPass = true;
  let testDetail = 'No test script or non-tests/ path';
  if (testScript && /tests\/run-all\.js/.test(testScript)) {
    const testsExists = fileExists(path.join(PROJECT_ROOT, 'tests/run-all.js'));
    testPass = testsExists;
    testDetail = testsExists ? 'test script target exists' : 'test script target missing';
  }
  checks.push({ id: 'V4-test-script-resolves', pass: testPass, detail: testDetail });

  // V5: No high-severity drift
  const highDrifts = (scanners.code_drift.drifts || []).filter(d => d.severity === 'high');
  checks.push({
    id: 'V5-no-high-severity-drift',
    pass: highDrifts.length === 0,
    detail: highDrifts.length === 0 ? 'No high-severity drift' : `${highDrifts.length} high-severity drift(s)`
  });

  // V6: CLAUDE.md references docs that exist
  const claudeText = readText(CLAUDE_MD) || '';
  const referencedDocs = [];
  const refRegex = /docs\/agents\/([\w-]+\.md)/g;
  let m;
  while ((m = refRegex.exec(claudeText)) !== null) referencedDocs.push(m[1]);
  const missingRefs = referencedDocs.filter(d =>
    !fileExists(path.join(AGENT_DOCS_DIR, d))
  );
  checks.push({
    id: 'V6-claude-md-refs-resolve',
    pass: missingRefs.length === 0,
    detail: missingRefs.length === 0
      ? `All ${referencedDocs.length} CLAUDE.md refs resolve`
      : `Missing: ${missingRefs.join(', ')}`
  });

  // V7: No leftover uploads
  checks.push({
    id: 'V7-no-leftover-uploads',
    pass: (scanners.uploads.file_count || 0) === 0,
    detail: `${scanners.uploads.file_count || 0} file(s) in uploads/`
  });

  // V8: ADR log present if any code references it
  const hasAdrRefs = /docs\/adr\//.test(readText(README) || '') ||
                     /docs\/adr\//.test(readText(CLAUDE_MD) || '');
  checks.push({
    id: 'V8-adr-log-present-if-referenced',
    pass: !hasAdrRefs || scanners.adr_log.status === 'ok',
    detail: hasAdrRefs
      ? (scanners.adr_log.status === 'ok' ? 'ADR log present' : 'ADR log missing despite refs')
      : 'No ADR refs in docs (skipped)'
  });

  // V9: All issues reachable
  checks.push({
    id: 'V9-issue-tracker-available',
    pass: scanners.issue_tracker.status === 'ok',
    detail: `issue tracker status = ${scanners.issue_tracker.status}`
  });

  // V10: Runtime log has no auth-failure signals (security signal)
  const authSignals = (scanners.runtime_logs.signals || []).filter(s => s.type === 'auth-failures');
  checks.push({
    id: 'V10-no-auth-failures-in-log',
    pass: authSignals.length === 0,
    detail: authSignals.length === 0 ? 'No auth failures' : `${authSignals.length} auth failure(s)`
  });

  const passed = checks.filter(c => c.pass).length;
  const failed = checks.filter(c => !c.pass);

  return {
    summary: {
      total: checks.length,
      passed,
      failed: failed.length,
      pass_rate: checks.length === 0 ? 1 : passed / checks.length
    },
    checks,
    failed_checks: failed
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const scanners = {
    version_control: normalizeStatus(scanVersionControl()),
    issue_tracker: normalizeStatus(scanIssueTracker()),
    adr_log: normalizeStatus(scanAdrLog()),
    domain_doc: normalizeStatus(scanDomainDoc()),
    runtime_logs: normalizeStatus(scanRuntimeLogs()),
    code_drift: normalizeStatus(scanCodeDrift()),
    presets: normalizeStatus(scanPresets()),
    uploads: normalizeStatus(scanUploads())
  };

  const unified = unifyState(scanners);
  const timeline = loadContextTimeline(scanners);
  const validation = runValidationChecks(scanners, unified);

  const snapshot = {
    schema_version: 1,
    session_id: SESSION_ID,
    started_at: STARTED_AT,
    finished_at: new Date().toISOString(),
    project_root: PROJECT_ROOT,
    scanners,
    unified,
    timeline,
    validation
  };

  // Persist
  if (!dirExists(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  const latestPath = path.join(STATE_DIR, 'session-latest.json');
  const histPath = path.join(STATE_DIR, `session-${STARTED_AT.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(histPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  fs.writeFileSync(latestPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  // Emit JSON to stdout for piping
  process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');

  // Emit a human-readable summary to stderr
  process.stderr.write(`\n── session-init summary ─────────────────────────────\n`);
  process.stderr.write(`Session:        ${SESSION_ID}\n`);
  process.stderr.write(`Started:        ${STARTED_AT}\n`);
  process.stderr.write(`Finished:       ${snapshot.finished_at}\n`);
  process.stderr.write(`\nScanners:\n`);
  for (const [name, s] of Object.entries(scanners)) {
    process.stderr.write(`  ${name.padEnd(20)} ${s.normalized.padEnd(11)} (${s.status})\n`);
  }
  process.stderr.write(`\nValidation:    ${validation.summary.passed}/${validation.summary.total} passed (${(validation.summary.pass_rate * 100).toFixed(0)}%)\n`);
  if (validation.failed_checks.length > 0) {
    process.stderr.write(`Failed checks:\n`);
    for (const c of validation.failed_checks) {
      process.stderr.write(`  ✗ ${c.id}: ${c.detail}\n`);
    }
  }
  process.stderr.write(`\nIssues found:   ${unified.issues.length}\n`);
  for (const i of unified.issues) {
    process.stderr.write(`  [${i.severity.toUpperCase()}] ${i.area}: ${i.message}\n`);
  }
  process.stderr.write(`\nSnapshots:\n  ${relPath(latestPath)}\n  ${relPath(histPath)}\n`);
  process.stderr.write(`─────────────────────────────────────────────────────\n`);
}

main();
