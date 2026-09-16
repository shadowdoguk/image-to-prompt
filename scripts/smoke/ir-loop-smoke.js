#!/usr/bin/env node
/**
 * Smoke test — SPEC §28 iterative refinement loop.
 *
 * Verifies the end-to-end wire of the IR feature without depending on
 * a live MiniMax API. Runs as a static-source assertion: reads
 * server.js, src/index.html, src/app.js, src/shell.js, docs/SPEC.md
 * and asserts that the SPEC §28 / IR-1..IR-5 contracts are all in
 * place.
 *
 * Mirrors the pattern of:
 *   scripts/smoke/anima-coverage-categories.js
 *   scripts/smoke/anima-chat-apply-sync.js
 *
 * Run:  node scripts/smoke/ir-loop-smoke.js
 * Pass: exits 0 with "N passed, 0 failed".
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER_PATH = path.join(ROOT, 'server.js');
const APP_PATH = path.join(ROOT, 'src', 'app.js');
const SHELL_PATH = path.join(ROOT, 'src', 'shell.js');
const HTML_PATH = path.join(ROOT, 'src', 'index.html');
const SPEC_PATH = path.join(ROOT, 'docs', 'SPEC.md');

let pass = 0;
let fail = 0;
const failures = [];

function assert(label, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const serverSrc = fs.readFileSync(SERVER_PATH, 'utf8');
const appSrc = fs.readFileSync(APP_PATH, 'utf8');
const shellSrc = fs.readFileSync(SHELL_PATH, 'utf8');
const htmlSrc = fs.readFileSync(HTML_PATH, 'utf8');
const specSrc = fs.readFileSync(SPEC_PATH, 'utf8');

// ─── Section 1 — server.js exports ────────────────────────────────────────
// All IR exports go through a single `module.exports = { ... }` block
// at the bottom of server.js. We assert each name appears in that
// block (rather than as a separate `exports.X =` line).

const exportsBlockMatch = serverSrc.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\};/);
const exportsBlock = exportsBlockMatch ? exportsBlockMatch[1] : '';
const isExported = (name) => new RegExp(`(?:^|,|\\s)${name}\\s*(?:,|$)`, 'm').test(exportsBlock);

assert(
  'IR_ITERATION_CAP exported (locked at 8)',
  /const IR_ITERATION_CAP\s*=\s*8\b/.test(serverSrc) && isExported('IR_ITERATION_CAP'),
  'IR_ITERATION_CAP = 8 not exported'
);

assert(
  'irAnalyzeImage exported',
  isExported('irAnalyzeImage'),
  'irAnalyzeImage not exported'
);

assert(
  'irCompareImages exported',
  isExported('irCompareImages'),
  'irCompareImages not exported'
);

assert(
  'irRevisePrompt exported',
  isExported('irRevisePrompt'),
  'irRevisePrompt not exported'
);

assert(
  'parseImageAttributes validator exported',
  isExported('parseImageAttributes'),
  'parseImageAttributes not exported'
);

assert(
  'parseMismatchList validator exported',
  isExported('parseMismatchList'),
  'parseMismatchList not exported'
);

assert(
  'parseRevisedPrompt validator exported',
  isExported('parseRevisedPrompt'),
  'parseRevisedPrompt not exported'
);

assert(
  'markChatAttachmentAsReference helper exported',
  isExported('markChatAttachmentAsReference'),
  'markChatAttachmentAsReference not exported'
);

assert(
  'fileToImageDataUri helper exported',
  isExported('fileToImageDataUri'),
  'fileToImageDataUri not exported'
);

// ─── Section 2 — route registration + error envelope ─────────────────────
assert(
  'POST /api/chat/sessions/:id/analyze-generated registered',
  /app\.post\(\s*['"`]\/api\/chat\/sessions\/[^'"`]*analyze-generated['"`]/.test(serverSrc),
  'analyze-generated POST route not registered'
);

assert(
  'Cap check at start of route (returns 409)',
  /ir_iteration_count[\s\S]{0,200}>=\s*IR_ITERATION_CAP[\s\S]{0,200}res\.status\(409\)/.test(serverSrc),
  'cap check + 409 envelope not wired'
);

assert(
  'No-attachments case returns 422',
  /sessionAttachments\.length\s*<\s*2[\s\S]{0,200}res\.status\(422\)/.test(serverSrc),
  '422 envelope for missing attachments not wired'
);

assert(
  'Per-step timeout protection (AbortController)',
  /AbortController/.test(serverSrc) && /setTimeout\(\(\)\s*=>\s*controller\.abort\(\),\s*18000\)/.test(serverSrc),
  'AbortController + 18s timeout not in place'
);

assert(
  'Per-step error envelope (504 on MiniMax failure)',
  /res\.status\(504\)/.test(serverSrc),
  '504 envelope not wired'
);

assert(
  'Anchor preservation runs through validatePromptPreservation',
  /validatePromptPreservation\(/.test(serverSrc) && /irRevisePrompt/.test(serverSrc),
  'irRevisePrompt does not run through validatePromptPreservation'
);

assert(
  'Decline envelope mirrors SPEC §22 partial-apply shape',
  /declined:\s*true/.test(serverSrc) && /declined_missing_terms/.test(serverSrc) && /declined_reason/.test(serverSrc),
  'decline envelope shape mismatch'
);

assert(
  'Latency instrumentation per step (latency_ms on audit)',
  /latency_ms:\s*latency/.test(serverSrc),
  'latency_ms not threaded onto audit'
);

// ─── Section 3 — frontend wire ────────────────────────────────────────────
assert(
  'chat input bar button #chat-analyze-generated-btn',
  htmlSrc.includes('id="chat-analyze-generated-btn"'),
  '#chat-analyze-generated-btn not in index.html'
);

assert(
  'chat input bar counter #chat-ir-counter',
  htmlSrc.includes('id="chat-ir-counter"'),
  '#chat-ir-counter not in index.html'
);

assert(
  'app.js wires onAnalyzeGeneratedClick + window hook',
  /onAnalyzeGeneratedClick/.test(appSrc) && /window\.__i2pAnalyzeGenerated\s*=\s*onAnalyzeGeneratedClick/.test(appSrc),
  'app.js does not export the Analyze handler'
);

assert(
  'shell.js bindAnalyzeGenerated wires button + counter',
  /bindAnalyzeGenerated/.test(shellSrc) && /bindAnalyzeGenerated\(\)/.test(shellSrc),
  'shell.js does not call bindAnalyzeGenerated in init'
);

// ─── Section 4 — SPEC + fixtures + README ─────────────────────────────────
assert(
  'SPEC §28 present',
  /##\s*§28/.test(specSrc) && /Analyze Generated Image/.test(specSrc),
  'SPEC §28 not present'
);

assert(
  'README documents analyze-generated endpoint',
  /\/api\/chat\/sessions\/:id\/analyze-generated/.test(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')),
  'README does not document the analyze-generated endpoint'
);

assert(
  'Fixture directory exists',
  fs.existsSync(path.join(ROOT, 'tests', 'fixtures', 'ir')),
  'tests/fixtures/ir/ does not exist'
);

assert(
  'all 8 IR fixture JSON files present',
  ['ir-analyze-ok.json', 'ir-analyze-minimal.json', 'ir-analyze-malformed.json',
   'ir-compare-with-mismatches.json', 'ir-compare-no-mismatches.json',
   'ir-revise-ok.json', 'ir-revise-too-long.json', 'ir-revise-empty.json']
    .every((f) => fs.existsSync(path.join(ROOT, 'tests', 'fixtures', 'ir', f))),
  'one or more IR fixture JSON files missing'
);

assert(
  'all 5 IR code-review files present',
  ['IR-1', 'IR-2', 'IR-3', 'IR-4', 'IR-5']
    .every((s) => fs.existsSync(path.join(ROOT, 'docs', `CODE-REVIEW-${s}.md`))),
  'one or more IR CODE-REVIEW files missing'
);

// ─── Result ───────────────────────────────────────────────────────────────
console.log('');
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('');
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
