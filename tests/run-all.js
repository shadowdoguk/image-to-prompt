'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RESULTS = [];
const COLORS = { pass: '\x1b[32m', fail: '\x1b[31m', dim: '\x1b[2m', reset: '\x1b[0m' };

function test(name, fn) {
  try {
    fn();
    RESULTS.push({ name, status: 'pass' });
    console.log(`${COLORS.pass}✓${COLORS.reset} ${name}`);
  } catch (err) {
    RESULTS.push({ name, status: 'fail', error: err.message });
    console.log(`${COLORS.fail}✗${COLORS.reset} ${name}`);
    console.log(`  ${COLORS.dim}${err.message}${COLORS.reset}`);
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'assertTrue failed');
}

function assertExists(p) {
  if (!fs.existsSync(p)) throw new Error(`Expected to exist: ${p}`);
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

test('CONTEXT.md exists and has required sections', () => {
  assertExists(path.join(PROJECT_ROOT, 'CONTEXT.md'));
  const text = fs.readFileSync(path.join(PROJECT_ROOT, 'CONTEXT.md'), 'utf8');
  assertTrue(/Pipeline stages/.test(text), 'Missing "Pipeline stages" section');
  assertTrue(/Field palette/.test(text), 'Missing "Field palette" section');
  assertTrue(/Accuracy contract/.test(text), 'Missing "Accuracy contract" section');
  assertTrue(/Known gaps/.test(text), 'Missing "Known gaps" section');
});

test('FIELD_PALETTE in server.js matches CONTEXT.md taxonomy (14 fields)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const m = serverText.match(/const FIELD_PALETTE = \{([\s\S]*?)\n\}/);
  assertTrue(m, 'FIELD_PALETTE not found in server.js');
  const block = m[1];
  const expected = [
    'subject', 'subject_orientation', 'actions', 'style', 'mood',
    'colors', 'lighting', 'composition', 'era', 'camera_angle',
    'texture', 'artistic_medium', 'depth_of_field', 'contrast'
  ];
  for (const f of expected) {
    assertTrue(block.includes(`${f}:`), `FIELD_PALETTE missing field: ${f}`);
  }
});

test('presets.json parses as array of objects with required keys', () => {
  const presets = readJSON(path.join(PROJECT_ROOT, 'data/presets.json'));
  assertTrue(Array.isArray(presets), 'presets.json is not an array');
  assertTrue(presets.length >= 1, 'presets.json is empty');
  for (const p of presets) {
    assertTrue(typeof p.id === 'string' && p.id.startsWith('preset_'), `Bad id: ${p.id}`);
    assertTrue(typeof p.name === 'string' && p.name.length > 0, `Bad name on ${p.id}`);
    assertTrue(typeof p.stage1_system_prompt === 'string', `Missing stage1_system_prompt on ${p.id}`);
    assertTrue(Array.isArray(p.stage1_fields) && p.stage1_fields.length > 0, `Bad stage1_fields on ${p.id}`);
    assertTrue(typeof p.stage2_system_prompt === 'string', `Missing stage2_system_prompt on ${p.id}`);
  }
});

test('Every preset.stage1_fields references valid FIELD_PALETTE names', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const m = serverText.match(/const VALID_FIELD_NAMES = Object\.keys\(FIELD_PALETTE\);/);
  assertTrue(m, 'VALID_FIELD_NAMES declaration not found');
  const paletteMatch = serverText.match(/const FIELD_PALETTE = \{([\s\S]*?)\n\}/);
  const paletteFields = new Set();
  const fieldLineRegex = /^\s{2}(\w+):\s*\{/gm;
  let fm;
  while ((fm = fieldLineRegex.exec(paletteMatch[1])) !== null) paletteFields.add(fm[1]);

  const presets = readJSON(path.join(PROJECT_ROOT, 'data/presets.json'));
  for (const p of presets) {
    for (const f of p.stage1_fields) {
      assertTrue(paletteFields.has(f), `Preset ${p.id} references unknown field: ${f}`);
    }
  }
});

test('Preset stage1 prompts fit MAX_PROMPT_LENGTH', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const m = serverText.match(/const MAX_PROMPT_LENGTH = (\d+);/);
  assertTrue(m, 'MAX_PROMPT_LENGTH not found');
  const max = parseInt(m[1], 10);
  const presets = readJSON(path.join(PROJECT_ROOT, 'data/presets.json'));
  for (const p of presets) {
    assertTrue(p.stage1_system_prompt.length <= max,
      `Preset ${p.id} stage1_system_prompt is ${p.stage1_system_prompt.length} chars (max ${max})`);
    assertTrue(p.stage2_system_prompt.length <= max,
      `Preset ${p.id} stage2_system_prompt is ${p.stage2_system_prompt.length} chars (max ${max})`);
  }
});

test('No stale upload files in uploads/', () => {
  const uploadsDir = path.join(PROJECT_ROOT, 'uploads');
  if (!fs.existsSync(uploadsDir)) return;
  const files = fs.readdirSync(uploadsDir).filter(f => !f.startsWith('.'));
  assertEqual(files.length, 0, `uploads/ contains leftover files: ${files.join(', ')}`);
});

test('All agent docs referenced from CLAUDE.md exist', () => {
  const claudeText = fs.readFileSync(path.join(PROJECT_ROOT, 'CLAUDE.md'), 'utf8');
  const refs = [];
  const re = /docs\/agents\/([\w-]+\.md)/g;
  let m;
  while ((m = re.exec(claudeText)) !== null) refs.push(m[1]);
  for (const r of refs) {
    assertExists(path.join(PROJECT_ROOT, 'docs/agents', r));
  }
});

test('README documents endpoints that the server actually exposes', () => {
  const readme = fs.readFileSync(path.join(PROJECT_ROOT, 'README.md'), 'utf8');
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const endpoints = [];
  const re = /app\.(get|post|put|delete)\(['"](\/api\/[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(serverText)) !== null) endpoints.push(m[2]);
  assertTrue(endpoints.length > 0, 'No API endpoints found in server.js');
  for (const ep of endpoints) {
    assertTrue(readme.includes(ep), `README missing endpoint: ${ep}`);
  }
});

test('session-init.js executes and emits a parseable snapshot', () => {
  const out = execFileSync('node', ['scripts/session-init.js'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const parsed = JSON.parse(out);
  assertTrue(typeof parsed.session_id === 'string', 'session_id missing');
  assertTrue(parsed.scanners && typeof parsed.scanners === 'object', 'scanners missing');
  assertTrue(parsed.validation && typeof parsed.validation === 'object', 'validation missing');
  assertTrue(parsed.unified && Array.isArray(parsed.unified.issues), 'unified.issues missing');
});

const passed = RESULTS.filter(r => r.status === 'pass').length;
const failed = RESULTS.filter(r => r.status === 'fail').length;
console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('\nFailures:');
  for (const r of RESULTS.filter(x => x.status === 'fail')) {
    console.log(`  - ${r.name}: ${r.error}`);
  }
  process.exit(1);
}
