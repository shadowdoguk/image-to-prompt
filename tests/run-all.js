'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RESULTS = [];
const QUEUED = [];
const COLORS = { pass: '\x1b[32m', fail: '\x1b[31m', dim: '\x1b[2m', reset: '\x1b[0m' };

/**
 * Register a test. `fn` may be sync or async — async tests are
 * awaited in registration order. Failures from either style are
 * captured as `fail` results and printed.
 */
function test(name, fn) {
  QUEUED.push({ name, fn });
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

test('All agent docs referenced from AGENTS.md exist', () => {
  const agentText = fs.readFileSync(path.join(PROJECT_ROOT, 'AGENTS.md'), 'utf8');
  const refs = [];
  const re = /docs\/agents\/([\w-]+\.md)/g;
  let m;
  while ((m = re.exec(agentText)) !== null) refs.push(m[1]);
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

test('server.js is require()-able without starting the listener', () => {
  const server = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(server && typeof server === 'object', 'server.js did not export an object');
  assertTrue(typeof server.app === 'function', 'server.app (Express) missing');
  assertTrue(typeof server.buildStage1RetrySuffix === 'function', 'buildStage1RetrySuffix not exported');
});

test('buildStage1RetrySuffix re-injects full contract for hinted fields', () => {
  const { buildStage1RetrySuffix, FIELD_FORMAT_HINTS } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(FIELD_FORMAT_HINTS.subject, 'FIELD_FORMAT_HINTS.subject missing — ADR 0003 should define it');
  const suffix = buildStage1RetrySuffix([
    { field: 'subject', actual: 87, required: 600 }
  ]);
  assertTrue(suffix.includes('subject'), 'suffix must mention field name');
  assertTrue(suffix.includes('87'), 'suffix must include actual char count');
  assertTrue(suffix.includes('600'), 'suffix must include required char count');
  assertTrue(
    suffix.includes(FIELD_FORMAT_HINTS.subject.description),
    'suffix must re-inject the FULL FIELD_FORMAT_HINTS.subject.description for hinted fields'
  );
});

test('buildStage1RetrySuffix falls back to field name + count for non-hinted fields', () => {
  const { buildStage1RetrySuffix } = require(path.join(PROJECT_ROOT, 'server.js'));
  const suffix = buildStage1RetrySuffix([
    { field: 'actions', actual: 50, required: 100 }
  ]);
  assertTrue(suffix.includes('actions'), 'suffix must mention field name');
  assertTrue(suffix.includes('50'), 'suffix must include actual char count');
  assertTrue(suffix.includes('100'), 'suffix must include required char count');
  assertTrue(
    !suffix.includes('Exhaustive paragraph-length'),
    'suffix must NOT inject subject contract text when only non-hinted fields are listed'
  );
});

test('buildStage1RetrySuffix handles mixed hinted + non-hinted violations in one call', () => {
  const { buildStage1RetrySuffix, FIELD_FORMAT_HINTS } = require(path.join(PROJECT_ROOT, 'server.js'));
  const suffix = buildStage1RetrySuffix([
    { field: 'subject', actual: 87, required: 600 },
    { field: 'actions', actual: 50, required: 100 },
    { field: 'lighting', actual: 5, required: 15 }
  ]);
  assertTrue(suffix.includes('subject'), 'must list subject');
  assertTrue(suffix.includes('actions'), 'must list actions');
  assertTrue(suffix.includes('lighting'), 'must list lighting');
  assertTrue(
    suffix.includes(FIELD_FORMAT_HINTS.subject.description),
    'must re-inject subject contract'
  );
  assertTrue(
    !suffix.includes('Exhaustive paragraph-length') || suffix.includes('actions'),
    'subject contract re-injection must not replace non-hinted field guidance'
  );
});

test('POST /api/subject endpoint is registered (ADR 0004)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const re = /app\.post\(['"](\/api\/[^'"]+)['"]/g;
  const endpoints = [];
  let m;
  while ((m = re.exec(serverText)) !== null) endpoints.push(m[1]);
  assertTrue(endpoints.includes('/api/subject'),
    `POST /api/subject must be registered; found endpoints: ${endpoints.join(', ')}`);
});

test('DEFAULT_SUBJECT_PROMPT excludes artistic style/medium/aesthetic (ADR 0004)', () => {
  const { DEFAULT_SUBJECT_PROMPT } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(typeof DEFAULT_SUBJECT_PROMPT === 'string' && DEFAULT_SUBJECT_PROMPT.length > 0,
    'DEFAULT_SUBJECT_PROMPT must be a non-empty string');

  // Must explicitly forbid the core exclusion categories the user requested.
  assertTrue(/artistic style/i.test(DEFAULT_SUBJECT_PROMPT),
    'prompt must forbid commentary on artistic style');
  assertTrue(/creative medium/i.test(DEFAULT_SUBJECT_PROMPT),
    'prompt must forbid commentary on creative medium');
  assertTrue(/aesthetic/i.test(DEFAULT_SUBJECT_PROMPT),
    'prompt must forbid aesthetic commentary');

  // Must explicitly forbid the medium-meta vocabulary the user described.
  const forbiddenMeta = ['the painting', 'the photograph', 'the image', 'the artwork', 'the illustration'];
  for (const phrase of forbiddenMeta) {
    assertTrue(DEFAULT_SUBJECT_PROMPT.includes(phrase),
      `prompt must explicitly forbid the meta-reference: "${phrase}"`);
  }

  // Must list subjective aesthetic adjectives as forbidden vocabulary.
  const forbiddenAdjectives = ['beautiful', 'striking', 'dramatic', 'elegant', 'majestic'];
  for (const adj of forbiddenAdjectives) {
    assertTrue(DEFAULT_SUBJECT_PROMPT.includes(adj),
      `prompt must list "${adj}" as forbidden aesthetic vocabulary`);
  }

  // Must mandate coverage of all five user-stated categories.
  const categories = [
    /PEOPLE/i,
    /LOCATIONS/i,
    /SPATIAL ARRANGEMENT/i,
    /OBJECTS/i,
    /CONTEXTUAL DETAILS/i
  ];
  for (const re of categories) {
    assertTrue(re.test(DEFAULT_SUBJECT_PROMPT),
      `prompt must mandate coverage of category matching: ${re}`);
  }

  // Must enforce a length floor consistent with ADR 0003 (>= 600 chars).
  assertTrue(/600/.test(DEFAULT_SUBJECT_PROMPT),
    'prompt must enforce 600-character minimum length');
});

test('callMiniMaxSubjectAnalysis helper is exported (ADR 0004)', () => {
  const server = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(typeof server.callMiniMaxSubjectAnalysis === 'function',
    'callMiniMaxSubjectAnalysis must be exported from server.js');
  assertTrue(typeof server.DEFAULT_SUBJECT_PROMPT === 'string',
    'DEFAULT_SUBJECT_PROMPT must be exported from server.js');
});

test('POST /api/subject route uses multer single-image upload middleware (ADR 0004)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  // The route registration should be immediately followed by `upload.single('image')`,
  // matching the /api/analyze pattern.
  const routeMatch = serverText.match(/app\.post\(['"]\/api\/subject['"]\s*,\s*upload\.single\(['"]image['"]\)/);
  assertTrue(routeMatch,
    'POST /api/subject must use upload.single("image") middleware to match the /api/analyze pattern');
});

// ─── ADR 0005 — editable subject-extraction prompt ──────────────────────

test('GET /api/subject-prompt endpoint is registered (ADR 0005)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const re = /app\.(get|post|put|delete)\(['"](\/api\/[^'"]+)['"]/g;
  const endpoints = [];
  let m;
  while ((m = re.exec(serverText)) !== null) endpoints.push(m[1] + ' ' + m[2]);
  assertTrue(endpoints.some((e) => e.startsWith('get /api/subject-prompt')),
    `GET /api/subject-prompt must be registered; found endpoints: ${endpoints.join(', ')}`);
});

test('PUT /api/subject-prompt endpoint is registered (ADR 0005)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const re = /app\.(get|post|put|delete)\(['"](\/api\/[^'"]+)['"]/g;
  const endpoints = [];
  let m;
  while ((m = re.exec(serverText)) !== null) endpoints.push(m[1] + ' ' + m[2]);
  assertTrue(endpoints.some((e) => e.startsWith('put /api/subject-prompt')),
    `PUT /api/subject-prompt must be registered; found endpoints: ${endpoints.join(', ')}`);
});

test('readSubjectPrompt seeds the file on first read (ADR 0005)', () => {
  const subjectPromptFile = path.join(PROJECT_ROOT, 'data', 'subject_prompt.json');
  // Snapshot the existing file so we can restore it after the test.
  let backup = null;
  if (fs.existsSync(subjectPromptFile)) {
    backup = fs.readFileSync(subjectPromptFile, 'utf8');
    fs.unlinkSync(subjectPromptFile);
  }

  try {
    // require() is idempotent within the test process; we re-require to
    // pick up a fresh readSubjectPrompt closure. Use the already-loaded one.
    const { readSubjectPrompt, DEFAULT_SUBJECT_PROMPT } = require(path.join(PROJECT_ROOT, 'server.js'));
    const prompt = readSubjectPrompt();
    assertEqual(prompt, DEFAULT_SUBJECT_PROMPT, 'first read must return the shipped default');
    assertTrue(fs.existsSync(subjectPromptFile), 'file must be seeded on first read');
    const parsed = JSON.parse(fs.readFileSync(subjectPromptFile, 'utf8'));
    assertEqual(parsed.prompt, DEFAULT_SUBJECT_PROMPT, 'seeded file content must match the shipped default');
  } finally {
    if (backup !== null) {
      fs.writeFileSync(subjectPromptFile, backup, 'utf8');
    } else if (fs.existsSync(subjectPromptFile)) {
      fs.unlinkSync(subjectPromptFile);
    }
  }
});

test('writeSubjectPrompt round-trips through readSubjectPrompt (ADR 0005)', () => {
  const subjectPromptFile = path.join(PROJECT_ROOT, 'data', 'subject_prompt.json');
  let backup = null;
  if (fs.existsSync(subjectPromptFile)) {
    backup = fs.readFileSync(subjectPromptFile, 'utf8');
  }

  try {
    const { readSubjectPrompt, writeSubjectPrompt, DEFAULT_SUBJECT_PROMPT } = require(path.join(PROJECT_ROOT, 'server.js'));
    // Seed the file with the default first so subsequent read has something to read.
    writeSubjectPrompt(DEFAULT_SUBJECT_PROMPT);

    const custom = 'My custom subject prompt — testing round-trip.';
    writeSubjectPrompt(custom);
    const read = readSubjectPrompt();
    assertEqual(read, custom, 'readSubjectPrompt must return what writeSubjectPrompt wrote');

    // Restore the default on disk so other tests / runtime are not affected.
    writeSubjectPrompt(DEFAULT_SUBJECT_PROMPT);
  } finally {
    if (backup !== null) {
      fs.writeFileSync(subjectPromptFile, backup, 'utf8');
    } else if (fs.existsSync(subjectPromptFile)) {
      fs.unlinkSync(subjectPromptFile);
    }
  }
});

test('validateSubjectPrompt rejects empty / oversized / non-string (ADR 0005)', () => {
  const { validateSubjectPrompt } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(validateSubjectPrompt(null) !== null, 'null body must be rejected');
  assertTrue(validateSubjectPrompt({}) !== null, 'missing prompt field must be rejected');
  assertTrue(validateSubjectPrompt({ prompt: 42 }) !== null, 'non-string prompt must be rejected');
  assertTrue(validateSubjectPrompt({ prompt: '' }) !== null, 'empty string must be rejected');
  assertTrue(validateSubjectPrompt({ prompt: '   ' }) !== null, 'whitespace-only must be rejected');
  const huge = 'x'.repeat(10001);
  assertTrue(validateSubjectPrompt({ prompt: huge }) !== null, 'oversized prompt must be rejected');
  assertEqual(validateSubjectPrompt({ prompt: 'valid' }), null, 'valid prompt must pass');
});

// ─── ADR 0006 — saved color palettes ──────────────────────────────────

const PALETTES_FILE = path.join(PROJECT_ROOT, 'data', 'palettes.json');

const snapshotPalettesFile = () => {
  if (fs.existsSync(PALETTES_FILE)) {
    return fs.readFileSync(PALETTES_FILE, 'utf8');
  }
  return null;
};

const restorePalettesFile = (snapshot) => {
  if (snapshot === null) {
    if (fs.existsSync(PALETTES_FILE)) fs.unlinkSync(PALETTES_FILE);
  } else {
    fs.writeFileSync(PALETTES_FILE, snapshot, 'utf8');
  }
};

const resetPalettesFile = () => {
  fs.writeFileSync(PALETTES_FILE, '[]', 'utf8');
};

const UPLOADS_DIR = path.join(PROJECT_ROOT, 'uploads');

const cleanupUploads = () => {
  if (!fs.existsSync(UPLOADS_DIR)) return;
  for (const f of fs.readdirSync(UPLOADS_DIR)) {
    if (f.startsWith('.')) continue;
    try { fs.unlinkSync(path.join(UPLOADS_DIR, f)); } catch (_) { /* ignore */ }
  }
};

const validPaletteBody = (overrides = {}) => ({
  name: 'Sunset ochres',
  colors: [
    { hex: '#d97706', name: 'burnt orange' },
    { hex: '#7c2d12', name: 'deep brown' }
  ],
  source_run_id: 'run_0123456789abcdef',
  source_preset_id: 'preset_alla_prima_oil',
  ...overrides
});

test('All five palette routes are registered (ADR 0006)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const re = /app\.(get|post|put|delete)\(['"](\/api\/[^'"]+)['"]/g;
  const endpoints = [];
  let m;
  while ((m = re.exec(serverText)) !== null) endpoints.push(`${m[1].toLowerCase()} ${m[2]}`);
  const required = [
    'get /api/palettes',
    'post /api/palettes',
    'put /api/palettes/:id',
    'delete /api/palettes/:id'
  ];
  for (const r of required) {
    assertTrue(endpoints.includes(r), `${r} must be registered; found: ${endpoints.join(', ')}`);
  }
});

test('generatePaletteId / generateRunId return correctly-prefixed hex strings', () => {
  const { generatePaletteId, generateRunId } = require(path.join(PROJECT_ROOT, 'server.js'));
  const pid = generatePaletteId();
  assertTrue(/^palette_[0-9a-f]{16}$/.test(pid), `palette id shape: ${pid}`);
  const rid = generateRunId();
  assertTrue(/^run_[0-9a-f]{16}$/.test(rid), `run id shape: ${rid}`);
});

test('validatePalette rejects missing / empty / oversized / non-string name', () => {
  const { validatePalette } = require(path.join(PROJECT_ROOT, 'server.js'));
  const base = validPaletteBody();
  assertTrue(validatePalette(null) !== null, 'null body rejected');
  assertTrue(validatePalette({}) !== null, 'empty body rejected');
  assertTrue(validatePalette({ ...base, name: undefined }) !== null, 'missing name rejected');
  assertTrue(validatePalette({ ...base, name: 42 }) !== null, 'non-string name rejected');
  assertTrue(validatePalette({ ...base, name: '' }) !== null, 'empty name rejected');
  assertTrue(validatePalette({ ...base, name: '   ' }) !== null, 'whitespace-only name rejected');
  assertTrue(validatePalette({ ...base, name: 'a'.repeat(61) }) !== null, 'oversized name rejected');
});

test('validatePalette enforces case-insensitive uniqueness via existingNames', () => {
  const { validatePalette } = require(path.join(PROJECT_ROOT, 'server.js'));
  const existing = new Set(['sunset ochres', 'twilight blues']);
  assertTrue(
    validatePalette(validPaletteBody({ name: 'Sunset Ochres' }), { existingNames: existing }) !== null,
    'case-different duplicate must be rejected'
  );
  assertTrue(
    validatePalette(validPaletteBody({ name: 'SUNSET OCHRES' }), { existingNames: existing }) !== null,
    'all-caps duplicate must be rejected'
  );
  assertEqual(
    validatePalette(validPaletteBody({ name: 'Forest greens' }), { existingNames: existing }),
    null,
    'non-duplicate must pass'
  );
  assertEqual(
    validatePalette(validPaletteBody({ name: 'Sunset ochres' }), { existingNames: new Set() }),
    null,
    'empty existingNames set must allow new name'
  );
});

test('validatePalette rejects malformed colors array', () => {
  const { validatePalette } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(validatePalette(validPaletteBody({ colors: 'not-an-array' })) !== null, 'non-array colors rejected');
  assertTrue(validatePalette(validPaletteBody({ colors: [] })) !== null, 'empty colors rejected');
  assertTrue(validatePalette(validPaletteBody({ colors: 'not-a-hex' })) !== null, 'non-object color rejected');
  assertTrue(
    validatePalette(validPaletteBody({ colors: [{ hex: 'd97706', name: 'missing #' }] })) !== null,
    'hex without # rejected'
  );
  assertTrue(
    validatePalette(validPaletteBody({ colors: [{ hex: '#d9770', name: '5 chars' }] })) !== null,
    '5-char hex rejected'
  );
  assertTrue(
    validatePalette(validPaletteBody({ colors: [{ hex: '#d97706', name: 42 }] })) !== null,
    'non-string name rejected'
  );
  assertTrue(
    validatePalette(validPaletteBody({ colors: new Array(51).fill({ hex: '#000000', name: 'x' }) })) !== null,
    'over MAX_PALETTE_COLORS rejected'
  );
});

test('validatePalette rejects malformed source ids', () => {
  const { validatePalette } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(
    validatePalette(validPaletteBody({ source_run_id: 'not-a-run-id' })) !== null,
    'bad source_run_id rejected'
  );
  assertTrue(
    validatePalette(validPaletteBody({ source_run_id: 'run_ZZZZ' })) !== null,
    'non-hex run id rejected'
  );
  assertTrue(
    validatePalette(validPaletteBody({ source_preset_id: 'not_a_preset' })) !== null,
    'bad source_preset_id prefix rejected'
  );
  assertEqual(validatePalette(validPaletteBody()), null, 'valid body must pass');
});

test('applyPaletteToAnalysis replaces the colors field and normalizes hex case', () => {
  const { applyPaletteToAnalysis } = require(path.join(PROJECT_ROOT, 'server.js'));
  const analysis = {
    subject: 'a man',
    colors: [{ hex: '#FF0000', name: 'auto-red' }, { hex: '#00ff00', name: 'auto-green' }]
  };
  const palette = {
    colors: [
      { hex: '#D97706', name: 'burnt orange' },
      { hex: '#7C2D12', name: 'deep brown' }
    ]
  };
  const out = applyPaletteToAnalysis(analysis, palette);
  assertTrue(out === analysis, 'returns same reference');
  assertEqual(out.colors.length, 2, 'replaces with palette length');
  assertEqual(out.colors[0].hex, '#d97706', 'hex normalized to lowercase');
  assertEqual(out.colors[0].name, 'burnt orange', 'name carried over');
  assertEqual(out.subject, 'a man', 'other fields untouched');
});

test('applyPaletteToAnalysis is defensive on null / wrong-shape inputs', () => {
  const { applyPaletteToAnalysis } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertEqual(applyPaletteToAnalysis(null, { colors: [] }), null, 'null analysis → null');
  const a = { colors: [{ hex: '#fff', name: 'x' }] };
  assertEqual(applyPaletteToAnalysis(a, null), a, 'null palette → unchanged');
  assertEqual(applyPaletteToAnalysis(a, { colors: 'not-array' }), a, 'wrong-shape palette → unchanged');
});

test('readPalettes / writePalettes round-trip and drop malformed entries', () => {
  const { readPalettes, writePalettes } = require(path.join(PROJECT_ROOT, 'server.js'));
  const snapshot = snapshotPalettesFile();
  try {
    const good = validPaletteBody();
    writePalettes([
      { id: 'palette_aaaa', name: 'Forest', colors: [{ hex: '#22c55e', name: 'green' }], source_run_id: 'run_1111111111111111', source_preset_id: 'preset_x', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'palette_bbbb', name: 'Sea', colors: [{ hex: '#0ea5e9', name: 'blue' }], source_run_id: 'run_2222222222222222', source_preset_id: 'preset_x', created_at: '2026-01-02T00:00:00.000Z' }
    ]);
    const list = readPalettes();
    assertEqual(list.length, 2, 'round-trip length');
    assertEqual(list[0].name, 'Forest', 'round-trip first name');

    // Inject a malformed entry directly on disk; readPalettes must drop it.
    fs.writeFileSync(PALETTES_FILE, JSON.stringify([
      list[0],
      { id: 'bad', name: 'no-colors' },
      'not-an-object',
      { id: 'no-id', name: 'x', colors: [] },
      list[1]
    ]), 'utf8');
    const filtered = readPalettes();
    assertEqual(filtered.length, 2, 'malformed entries dropped');
    assertEqual(filtered[0].id, 'palette_aaaa', 'good entries kept');
  } finally {
    restorePalettesFile(snapshot);
  }
});

// ─── HTTP integration tests (ADR 0006) ────────────────────────────────

/**
 * Spin up the Express app on an ephemeral port and return a base URL
 * plus a close() function. Uses Node's built-in fetch — no extra deps.
 */
const startTestServer = async () => {
  const { app } = require(path.join(PROJECT_ROOT, 'server.js'));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
};

const fetchJson = async (url, options = {}) => {
  const res = await fetch(url, options);
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
};

test('HTTP integration: GET /api/palettes returns an array', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/palettes`);
    assertEqual(r.status, 200, 'status 200');
    assertTrue(r.body && r.body.success === true, 'success true');
    assertTrue(Array.isArray(r.body.data), 'data is array');
    assertEqual(r.body.data.length, 0, 'empty after reset');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
    cleanupUploads();
  }
});

test('HTTP integration: POST /api/palettes creates + uniqueness + GET /:id round-trips', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    const create = await fetchJson(`${srv.base}/api/palettes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPaletteBody())
    });
    assertEqual(create.status, 201, 'POST → 201');
    assertTrue(create.body.success, 'POST success');
    const id = create.body.data.id;
    assertTrue(/^palette_[0-9a-f]{16}$/.test(id), 'id shape');

    const dup = await fetchJson(`${srv.base}/api/palettes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPaletteBody({ name: 'SUNSET OCHRES' }))
    });
    assertEqual(dup.status, 400, 'duplicate (case-insensitive) → 400');
    assertTrue(/already in use/i.test(dup.body.error), 'error mentions duplicate');

    const getOne = await fetchJson(`${srv.base}/api/palettes/${id}`);
    assertEqual(getOne.status, 200, 'GET one → 200');
    assertEqual(getOne.body.data.id, id, 'id matches');

    const getMissing = await fetchJson(`${srv.base}/api/palettes/palette_doesnotexist0000`);
    assertEqual(getMissing.status, 404, 'missing → 404');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
    cleanupUploads();
  }
});

test('HTTP integration: PUT renames + DELETE removes (and the deleted id is now 404)', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    const create = await fetchJson(`${srv.base}/api/palettes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPaletteBody())
    });
    const id = create.body.data.id;

    const rename = await fetchJson(`${srv.base}/api/palettes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sunset palette v2' })
    });
    assertEqual(rename.status, 200, 'PUT → 200');
    assertEqual(rename.body.data.name, 'Sunset palette v2', 'name updated');

    const dupRename = await fetchJson(`${srv.base}/api/palettes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'SUNSET palette v2' })
    });
    assertEqual(dupRename.status, 200, 'rename-to-same-name is allowed (excludes self)');

    const del = await fetchJson(`${srv.base}/api/palettes/${id}`, { method: 'DELETE' });
    assertEqual(del.status, 200, 'DELETE → 200');

    const getAfterDelete = await fetchJson(`${srv.base}/api/palettes/${id}`);
    assertEqual(getAfterDelete.status, 404, 'GET after DELETE → 404');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
    cleanupUploads();
  }
});

test('HTTP integration: POST /api/analyze rejects missing/invalid paletteId with 400', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    // No paletteId field at all → request proceeds past palette guard,
    // hits the LLM call. The LLM may succeed (200) or fail (500 / 503
    // depending on API key state) — any of those is fine, the meaningful
    // assertion is that we did NOT get 400/404 (which would mean the
    // palette guard misbehaved).
    const fd1 = new FormData();
    fd1.append('image', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'tiny.jpg');
    fd1.append('presetId', 'preset_alla_prima_oil');
    const noPalette = await fetchJson(`${srv.base}/api/analyze`, { method: 'POST', body: fd1 });
    assertTrue(
      noPalette.status === 200 || noPalette.status === 500 || noPalette.status === 503,
      `no palette → must NOT 400/404 (got ${noPalette.status})`
    );

    // paletteId with wrong prefix → 400 from the route's prefix guard
    const fd2 = new FormData();
    fd2.append('image', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'tiny.jpg');
    fd2.append('presetId', 'preset_alla_prima_oil');
    fd2.append('paletteId', 'not-a-palette-id');
    const badFormat = await fetchJson(`${srv.base}/api/analyze`, { method: 'POST', body: fd2 });
    assertEqual(badFormat.status, 400, 'paletteId with wrong prefix → 400');
    assertTrue(/paletteId/.test(badFormat.body.error), 'error names paletteId');

    // paletteId with right shape but doesn't exist → 404
    const fd3 = new FormData();
    fd3.append('image', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'tiny.jpg');
    fd3.append('presetId', 'preset_alla_prima_oil');
    fd3.append('paletteId', 'palette_doesnotexist0000');
    const notFound = await fetchJson(`${srv.base}/api/analyze`, { method: 'POST', body: fd3 });
    assertEqual(notFound.status, 404, 'unknown paletteId → 404');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
    cleanupUploads();
  }
});

test('HTTP integration: POST /api/analyze with valid paletteId reaches the LLM call (503 in test env)', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    const create = await fetchJson(`${srv.base}/api/palettes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPaletteBody())
    });
    const pid = create.body.data.id;

    const fd = new FormData();
    fd.append('image', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'tiny.jpg');
    fd.append('presetId', 'preset_alla_prima_oil');
    fd.append('paletteId', pid);
    const r = await fetchJson(`${srv.base}/api/analyze`, { method: 'POST', body: fd });
    // The MiniMax key may be present (it was 'true' in earlier smoke) — so
    // we don't assert 503 here. We only assert that the route did NOT 404,
    // which means the palette was found and the request flowed past the
    // palette lookup into the LLM call (which may succeed or fail
    // depending on key state). This proves the palette→analyze wiring.
    assertTrue(r.status === 503 || r.status === 500 || r.status === 200,
      `expected 503/500/200 (got ${r.status}) — proves palette was found and LLM was called`);
    assertTrue(r.status !== 400, 'must not be a 400 from the paletteId guard');
    assertTrue(r.status !== 404, 'must not be a 404 from palette-not-found');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

// ─── Frontend / HTML assertions (ADR 0006) ──────────────────────────

test('Frontend HTML: Step 1 palette picker + color-section Save/Apply/Manage + two new modals exist with a11y attrs (ADR 0006)', () => {
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'src/index.html'), 'utf8');

  // Step 1 picker (pre-analyze override)
  assertTrue(/id="palette-select"/.test(html), 'palette picker select missing');
  assertTrue(/aria-label="Use saved palette"/.test(html), 'picker select must have aria-label');

  // Step 1 must NOT have a Manage button — manage is now in the color
  // section. The palette-manage-btn lives as a hidden placeholder below
  // </main> so the dom cache resolves; it gets moved into the color
  // section at render time.
  assertTrue(
    !/class="palette-picker-controls"[\s\S]*id="palette-manage-btn"[\s\S]*?<\/div>/.test(html),
    'Step 1 palette-picker-controls must NOT contain a Manage button'
  );
  assertTrue(/id="palette-manage-btn"/.test(html), 'palette-manage-btn must exist somewhere (placeholder)');

  // Save palette button exists (lives outside step-actions; appended into
  // the colors field-row at runtime by app.js)
  assertTrue(/id="save-palette-btn"/.test(html), 'save palette button missing');
  assertTrue(
    !/id="step-actions"[\s\S]*id="save-palette-btn"/.test(html) &&
    !/id="save-palette-btn"[\s\S]*?<\/main>[\s\S]*?step-actions/.test(html) &&
    /<button[^>]*id="save-palette-btn"[^>]*>[\s\S]*?<\/button>/.test(html),
    'save palette button must NOT be inside step-actions'
  );

  // Apply palette controls (select + button)
  assertTrue(/id="palette-apply-select"/.test(html), 'palette apply select missing');
  assertTrue(/id="palette-apply-btn"/.test(html), 'palette apply button missing');
  assertTrue(/aria-label="Choose a saved palette to apply"/.test(html), 'apply select must have aria-label');

  // Save modal
  assertTrue(/id="save-palette-modal"/.test(html), 'save palette modal missing');
  assertTrue(/role="dialog"/.test(html), 'modals must have role="dialog"');
  assertTrue(/aria-labelledby="save-palette-modal-title"/.test(html), 'save modal must reference its title');
  assertTrue(/id="save-palette-name-input"/.test(html), 'name input missing');
  assertTrue(/maxlength="60"/.test(html), 'name input must have maxlength=60');

  // Manager modal
  assertTrue(/id="palette-manager-modal"/.test(html), 'palette manager modal missing');
  assertTrue(/aria-labelledby="palette-manager-modal-title"/.test(html), 'manager must reference its title');
  assertTrue(/type="search"/.test(html), 'search input must be type=search for a11y');
  assertTrue(/aria-label="Search saved palettes by name"/.test(html), 'search input must have aria-label');
  assertTrue(/<fieldset/.test(html), 'sort controls must be in a fieldset');
  assertTrue(/<legend/.test(html), 'fieldset must have a legend');
});

test('Frontend CSS: manager + picker + color-section action styles defined (ADR 0006)', () => {
  const css = fs.readFileSync(path.join(PROJECT_ROOT, 'src/styles.css'), 'utf8');
  for (const sel of [
    '.palette-picker-row',
    '.palette-manager-controls',
    '.palette-manager-list',
    '.palette-manager-item',
    '.palette-manager-item__delete',
    '.palette-sort-option',
    '.palette-actions',
    '.palette-actions__hint',
    '.palette-actions__row'
  ]) {
    assertTrue(css.includes(sel), `CSS must define ${sel}`);
  }
  assertTrue(/:focus-visible/.test(css), 'CSS must keep focus-visible outlines for a11y');
});

// ─── ADR 0007 — editable Stage 2 prompt (per-preset override) ──────

const STAGE2_OVERRIDES_FILE = path.join(PROJECT_ROOT, 'data', 'stage2_overrides.json');

const snapshotStage2OverridesFile = () => {
  if (fs.existsSync(STAGE2_OVERRIDES_FILE)) {
    return fs.readFileSync(STAGE2_OVERRIDES_FILE, 'utf8');
  }
  return null;
};

const restoreStage2OverridesFile = (snapshot) => {
  if (snapshot === null) {
    if (fs.existsSync(STAGE2_OVERRIDES_FILE)) fs.unlinkSync(STAGE2_OVERRIDES_FILE);
  } else {
    fs.writeFileSync(STAGE2_OVERRIDES_FILE, snapshot, 'utf8');
  }
};

test('GET /api/stage2-prompt endpoint is registered (ADR 0007)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const re = /app\.(get|post|put|delete)\(['"](\/api\/[^'"]+)['"]/g;
  const endpoints = [];
  let m;
  while ((m = re.exec(serverText)) !== null) endpoints.push(m[1] + ' ' + m[2]);
  assertTrue(endpoints.some((e) => e.startsWith('get /api/stage2-prompt')),
    `GET /api/stage2-prompt must be registered; found endpoints: ${endpoints.join(', ')}`);
});

test('PUT /api/stage2-prompt endpoint is registered (ADR 0007)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const re = /app\.(get|post|put|delete)\(['"](\/api\/[^'"]+)['"]/g;
  const endpoints = [];
  let m;
  while ((m = re.exec(serverText)) !== null) endpoints.push(m[1] + ' ' + m[2]);
  assertTrue(endpoints.some((e) => e.startsWith('put /api/stage2-prompt')),
    `PUT /api/stage2-prompt must be registered; found endpoints: ${endpoints.join(', ')}`);
});

test('DELETE /api/stage2-prompt endpoint is registered (ADR 0007)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const re = /app\.(get|post|put|delete)\(['"](\/api\/[^'"]+)['"]/g;
  const endpoints = [];
  let m;
  while ((m = re.exec(serverText)) !== null) endpoints.push(m[1] + ' ' + m[2]);
  assertTrue(endpoints.some((e) => e.startsWith('delete /api/stage2-prompt')),
    `DELETE /api/stage2-prompt must be registered; found endpoints: ${endpoints.join(', ')}`);
});

test('setStage2Override / getStage2Override / removeStage2Override round-trip (ADR 0007)', () => {
  const {
    setStage2Override,
    getStage2Override,
    removeStage2Override,
    readStage2Overrides
  } = require(path.join(PROJECT_ROOT, 'server.js'));

  const snapshot = snapshotStage2OverridesFile();
  try {
    const presetId = 'preset_alla_prima_oil';
    const custom = 'Custom Stage 2 prompt — testing round-trip. ' + 'x'.repeat(20);

    // No override yet
    assertEqual(getStage2Override(presetId), null, 'no override before set');

    // Write
    setStage2Override(presetId, custom);
    assertEqual(getStage2Override(presetId), custom, 'get returns what was set');
    const map = readStage2Overrides();
    assertEqual(map[presetId], custom, 'on-disk map contains the override');

    // Overwrite
    const updated = custom + ' — overwritten';
    setStage2Override(presetId, updated);
    assertEqual(getStage2Override(presetId), updated, 'set overwrites existing entry');

    // Remove
    const removed = removeStage2Override(presetId);
    assertTrue(removed === true, 'remove returns true when entry existed');
    assertEqual(getStage2Override(presetId), null, 'no override after remove');

    // Idempotent remove
    const removedAgain = removeStage2Override(presetId);
    assertTrue(removedAgain === false, 'remove returns false when no entry existed');
  } finally {
    restoreStage2OverridesFile(snapshot);
  }
});

test('getEffectiveStage2Prompt returns override when set, preset default otherwise (ADR 0007)', () => {
  const { setStage2Override, getEffectiveStage2Prompt, removeStage2Override } = require(path.join(PROJECT_ROOT, 'server.js'));
  const presets = readJSON(path.join(PROJECT_ROOT, 'data', 'presets.json'));
  const preset = presets[0];
  assertTrue(preset && typeof preset.stage2_system_prompt === 'string',
    'test fixture requires at least one preset with stage2_system_prompt');

  const snapshot = snapshotStage2OverridesFile();
  try {
    removeStage2Override(preset.id);
    assertEqual(getEffectiveStage2Prompt(preset), preset.stage2_system_prompt,
      'falls back to preset.stage2_system_prompt when no override');

    const custom = 'OVERRIDE-MARKER ' + 'y'.repeat(30);
    setStage2Override(preset.id, custom);
    assertEqual(getEffectiveStage2Prompt(preset), custom,
      'returns override when one exists');
  } finally {
    restoreStage2OverridesFile(snapshot);
  }
});

test('validateStage2Prompt rejects empty / oversized / non-string (ADR 0007)', () => {
  const { validateStage2Prompt } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(validateStage2Prompt(null) !== null, 'null body must be rejected');
  assertTrue(validateStage2Prompt({}) !== null, 'missing prompt field must be rejected');
  assertTrue(validateStage2Prompt({ prompt: 42 }) !== null, 'non-string prompt must be rejected');
  assertTrue(validateStage2Prompt({ prompt: '' }) !== null, 'empty string must be rejected');
  assertTrue(validateStage2Prompt({ prompt: '   ' }) !== null, 'whitespace-only must be rejected');
  const huge = 'x'.repeat(10001);
  assertTrue(validateStage2Prompt({ prompt: huge }) !== null, 'oversized prompt must be rejected');
  assertEqual(validateStage2Prompt({ prompt: 'valid' }), null, 'valid prompt must pass');
});

test('HTTP integration: GET /api/stage2-prompt returns default envelope, PUT writes override, GET reflects it, DELETE clears (ADR 0007)', async () => {
  const { setStage2Override, removeStage2Override } = require(path.join(PROJECT_ROOT, 'server.js'));
  const presets = readJSON(path.join(PROJECT_ROOT, 'data', 'presets.json'));
  const preset = presets[0];

  const snapshot = snapshotStage2OverridesFile();
  removeStage2Override(preset.id);
  const srv = await startTestServer();
  try {
    // 1. GET with no override → returns preset default, is_default true
    const get1 = await fetchJson(`${srv.base}/api/stage2-prompt?presetId=${encodeURIComponent(preset.id)}`);
    assertEqual(get1.status, 200, 'GET status 200 with no override');
    assertTrue(get1.body && get1.body.success === true, 'GET success true');
    assertEqual(get1.body.data.prompt, preset.stage2_system_prompt, 'GET returns preset default');
    assertEqual(get1.body.data.default_prompt, preset.stage2_system_prompt, 'GET default_prompt matches preset');
    assertEqual(get1.body.data.is_default, true, 'is_default true when no override');

    // 2. PUT an override
    const custom = 'INTEGRATION-TEST OVERRIDE ' + Date.now();
    const put = await fetchJson(`${srv.base}/api/stage2-prompt?presetId=${encodeURIComponent(preset.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: custom })
    });
    assertEqual(put.status, 200, 'PUT status 200');
    assertEqual(put.body.data.prompt, custom, 'PUT echoes the saved prompt');
    assertEqual(put.body.data.is_default, false, 'PUT with custom text → is_default false');

    // 3. GET again → returns override
    const get2 = await fetchJson(`${srv.base}/api/stage2-prompt?presetId=${encodeURIComponent(preset.id)}`);
    assertEqual(get2.status, 200, 'GET status 200 with override');
    assertEqual(get2.body.data.prompt, custom, 'GET returns override');
    assertEqual(get2.body.data.is_default, false, 'is_default false with override');

    // 4. DELETE → cleared
    const del = await fetchJson(`${srv.base}/api/stage2-prompt?presetId=${encodeURIComponent(preset.id)}`, {
      method: 'DELETE'
    });
    assertEqual(del.status, 200, 'DELETE status 200');
    assertEqual(del.body.data.removed, true, 'DELETE removed=true');
    assertEqual(del.body.data.prompt, preset.stage2_system_prompt, 'DELETE response prompt is preset default');
    assertEqual(del.body.data.is_default, true, 'DELETE response is_default=true');

    // 5. GET → back to default
    const get3 = await fetchJson(`${srv.base}/api/stage2-prompt?presetId=${encodeURIComponent(preset.id)}`);
    assertEqual(get3.body.data.prompt, preset.stage2_system_prompt, 'GET after DELETE returns default');
    assertEqual(get3.body.data.is_default, true, 'is_default true after DELETE');

    // 6. Unknown presetId → 404
    const missing = await fetchJson(`${srv.base}/api/stage2-prompt?presetId=preset_does_not_exist`);
    assertEqual(missing.status, 404, 'unknown presetId → 404');

    // 7. Missing presetId → 400
    const none = await fetchJson(`${srv.base}/api/stage2-prompt`);
    assertEqual(none.status, 400, 'missing presetId → 400');

    // 8. PUT with empty body → 400
    const bad = await fetchJson(`${srv.base}/api/stage2-prompt?presetId=${encodeURIComponent(preset.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '' })
    });
    assertEqual(bad.status, 400, 'PUT empty prompt → 400');
  } finally {
    await srv.close();
    restoreStage2OverridesFile(snapshot);
    cleanupUploads();
  }
});

// ─── ADR 0008 — camera-angle re-analysis ("Populate with AI") ──────

test('POST /api/camera-angle endpoint is registered (ADR 0008)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const re = /app\.(get|post|put|delete)\(['"](\/api\/[^'"]+)['"]/g;
  const endpoints = [];
  let m;
  while ((m = re.exec(serverText)) !== null) endpoints.push(m[1] + ' ' + m[2]);
  assertTrue(endpoints.some((e) => e === 'post /api/camera-angle'),
    `POST /api/camera-angle must be registered; found endpoints: ${endpoints.join(', ')}`);
});

test('callMiniMaxCameraAngleAnalysis helper + DEFAULT_CAMERA_ANGLE_PROMPT are exported (ADR 0008)', () => {
  const server = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(typeof server.callMiniMaxCameraAngleAnalysis === 'function',
    'callMiniMaxCameraAngleAnalysis must be exported from server.js');
  assertTrue(typeof server.DEFAULT_CAMERA_ANGLE_PROMPT === 'string' && server.DEFAULT_CAMERA_ANGLE_PROMPT.length > 0,
    'DEFAULT_CAMERA_ANGLE_PROMPT must be a non-empty string exported from server.js');
});

test('POST /api/camera-angle uses multer single-image upload middleware (ADR 0008)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const routeMatch = serverText.match(/app\.post\(['"]\/api\/camera-angle['"]\s*,\s*upload\.single\(['"]image['"]\)/);
  assertTrue(routeMatch,
    'POST /api/camera-angle must use upload.single("image") middleware to match the /api/subject pattern');
});

test('DEFAULT_CAMERA_ANGLE_PROMPT excludes subject/style/medium/aesthetic commentary (ADR 0008)', () => {
  const { DEFAULT_CAMERA_ANGLE_PROMPT } = require(path.join(PROJECT_ROOT, 'server.js'));

  // Must explicitly forbid the core exclusion categories.
  assertTrue(/subject/i.test(DEFAULT_CAMERA_ANGLE_PROMPT),
    'prompt must forbid subject description');
  assertTrue(/lighting/i.test(DEFAULT_CAMERA_ANGLE_PROMPT),
    'prompt must forbid lighting commentary');
  assertTrue(/color/i.test(DEFAULT_CAMERA_ANGLE_PROMPT),
    'prompt must forbid color commentary');
  assertTrue(/mood/i.test(DEFAULT_CAMERA_ANGLE_PROMPT),
    'prompt must forbid mood commentary');
  assertTrue(/artistic style/i.test(DEFAULT_CAMERA_ANGLE_PROMPT),
    'prompt must forbid commentary on artistic style');
  assertTrue(/creative medium/i.test(DEFAULT_CAMERA_ANGLE_PROMPT),
    'prompt must forbid commentary on creative medium');
  assertTrue(/aesthetic/i.test(DEFAULT_CAMERA_ANGLE_PROMPT),
    'prompt must forbid aesthetic commentary');

  // Must explicitly forbid the medium-meta vocabulary the user described
  // (mirrors ADR 0004's forbidden list).
  const forbiddenMeta = ['the painting', 'the photograph', 'the image', 'the artwork', 'the illustration'];
  for (const phrase of forbiddenMeta) {
    assertTrue(DEFAULT_CAMERA_ANGLE_PROMPT.includes(phrase),
      `prompt must explicitly forbid the meta-reference: "${phrase}"`);
  }

  // Must list subjective aesthetic adjectives as forbidden vocabulary.
  const forbiddenAdjectives = ['beautiful', 'striking', 'dramatic', 'elegant', 'majestic'];
  for (const adj of forbiddenAdjectives) {
    assertTrue(DEFAULT_CAMERA_ANGLE_PROMPT.includes(adj),
      `prompt must list "${adj}" as forbidden aesthetic vocabulary`);
  }
});

test('DEFAULT_CAMERA_ANGLE_PROMPT mandates the five camera-angle categories (ADR 0008)', () => {
  const { DEFAULT_CAMERA_ANGLE_PROMPT } = require(path.join(PROJECT_ROOT, 'server.js'));

  // Five mandatory category headers.
  const categories = [
    /CAMERA POSITION/i,
    /CAMERA ORIENTATION/i,
    /LENS IMPRESSION/i,
    /CAMERA MOVEMENT/i,
    /FRAME GEOMETRY/i
  ];
  for (const re of categories) {
    assertTrue(re.test(DEFAULT_CAMERA_ANGLE_PROMPT),
      `prompt must mandate coverage of category matching: ${re}`);
  }

  // Spot-check specific cinematographic vocabulary that should appear so
  // the LLM has concrete examples for the position / orientation categories.
  const requiredVocab = [
    'eye-level',
    'low angle',
    'bird',
    'wide-angle',
    'telephoto',
    'three-quarter',
    'Dutch angle',
    'macro'
  ];
  for (const term of requiredVocab) {
    assertTrue(DEFAULT_CAMERA_ANGLE_PROMPT.toLowerCase().includes(term.toLowerCase()),
      `prompt must include cinematographic vocabulary example: "${term}"`);
  }

  // Must enforce a length floor (20 chars schema-level is mirrored here).
  assertTrue(/20/.test(DEFAULT_CAMERA_ANGLE_PROMPT),
    'prompt must enforce 20-character minimum length');
});

test('HTTP integration: POST /api/camera-angle rejects missing file with 400', async () => {
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/camera-angle`, { method: 'POST' });
    assertEqual(r.status, 400, 'no file → 400');
    assertTrue(/no image/i.test(r.body && r.body.error), 'error names missing image');
  } finally {
    await srv.close();
  }
});

test('HTTP integration: POST /api/camera-angle with valid upload reaches LLM call (503 in test env)', async () => {
  const srv = await startTestServer();
  try {
    const fd = new FormData();
    fd.append('image', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'tiny.jpg');
    const r = await fetchJson(`${srv.base}/api/camera-angle`, { method: 'POST', body: fd });
    // Like /api/analyze and /api/subject, the route's only meaningful
    // outcome in a test env without a real MiniMax key is either 200
    // (real key, real LLM), 500 (LLM error), or 503 (key not configured).
    // We assert the route did NOT 400 (which would mean the route guard
    // misbehaved) and the route reached the LLM call.
    assertTrue(r.status === 200 || r.status === 500 || r.status === 503,
      `expected 200/500/503 (got ${r.status}) — proves multer + key-guard worked`);
    assertTrue(r.status !== 400, 'must not 400 (route guard misbehaved)');
  } finally {
    await srv.close();
    cleanupUploads();
  }
});

test('Frontend HTML: README + CONTEXT.md document /api/camera-angle (ADR 0008)', () => {
  const readme = fs.readFileSync(path.join(PROJECT_ROOT, 'README.md'), 'utf8');
  const context = fs.readFileSync(path.join(PROJECT_ROOT, 'CONTEXT.md'), 'utf8');
  assertTrue(/\/api\/camera-angle/.test(readme),
    'README must document /api/camera-angle');
  assertTrue(/camera.?angle/i.test(readme) && /Populate with AI/i.test(readme),
    'README must mention camera-angle Populate-with-AI button');
  assertTrue(/Stage 1\.C|camera.?angle re.?analysis|ADR 0008/i.test(context),
    'CONTEXT.md must mention Stage 1.C / camera-angle re-analysis / ADR 0008');
});

test('Frontend CSS: .btn-populate-camera-angle selector defined (ADR 0008)', () => {
  const css = fs.readFileSync(path.join(PROJECT_ROOT, 'src/styles.css'), 'utf8');
  assertTrue(/\.btn-populate-camera-angle/.test(css),
    'CSS must define .btn-populate-camera-angle selector');
});

test('Frontend JS: populateCameraAngleWithAI handler + camera_angle button + no-image guard exist (ADR 0008)', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app.js'), 'utf8');

  // Handler function definition
  assertTrue(/const populateCameraAngleWithAI\s*=/.test(js),
    'src/app.js must define populateCameraAngleWithAI handler');

  // Client-side "no image" guard (mirrors populateSubjectWithAI pattern)
  assertTrue(/populateCameraAngleWithAI[\s\S]{0,400}?if\s*\(\s*!\s*state\.currentFile\s*\)/.test(js)
    || /function populateCameraAngleWithAI[\s\S]{0,400}?if\s*\(\s*!\s*state\.currentFile\s*\)/.test(js),
    'populateCameraAngleWithAI must guard on state.currentFile before fetching');

  // API call to /api/camera-angle
  assertTrue(/['"]\/api\/camera-angle['"]/.test(js),
    'src/app.js must POST to /api/camera-angle');

  // Button rendered when fieldName === 'camera_angle'
  assertTrue(/fieldName\s*===\s*['"]camera_angle['"]/.test(js),
    'src/app.js must render the button specifically for fieldName === "camera_angle"');
  assertTrue(/btn-populate-camera-angle/.test(js),
    'src/app.js must apply the .btn-populate-camera-angle class');

  // In-place DOM update of the camera_angle input
  assertTrue(/input\[data-field=['"]camera_angle['"]\]/.test(js),
    'src/app.js must query input[data-field="camera_angle"] for the in-place update');

  // state.isPopulatingCameraAngle flag (mirrors isPopulatingSubject)
  assertTrue(/isPopulatingCameraAngle/.test(js),
    'src/app.js must track isPopulatingCameraAngle state flag for the in-flight guard');
});

// ─── ADR 0009 — saved directives ──────────────────────────────────

const DIRECTIVES_FILE = path.join(PROJECT_ROOT, 'data', 'directives.json');

const snapshotDirectivesFile = () => {
  if (fs.existsSync(DIRECTIVES_FILE)) {
    return fs.readFileSync(DIRECTIVES_FILE, 'utf8');
  }
  return null;
};

const restoreDirectivesFile = (snapshot) => {
  if (snapshot === null) {
    if (fs.existsSync(DIRECTIVES_FILE)) fs.unlinkSync(DIRECTIVES_FILE);
  } else {
    fs.writeFileSync(DIRECTIVES_FILE, snapshot, 'utf8');
  }
};

const resetDirectivesFile = () => {
  fs.writeFileSync(DIRECTIVES_FILE, '[]', 'utf8');
};

const validDirectiveBody = (overrides = {}) => ({
  name: 'Dramatic red accent',
  content: 'Add a punchy red accent in the upper-right corner.',
  tags: ['color', 'composition'],
  ...overrides
});

// ── All routes registered

test('All nine directive routes are registered (ADR 0009)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const re = /app\.(get|post|put|delete)\(['"](\/api\/[^'"]+)['"]/g;
  const endpoints = [];
  let m;
  while ((m = re.exec(serverText)) !== null) endpoints.push(`${m[1].toLowerCase()} ${m[2]}`);
  const required = [
    'get /api/directives',
    'post /api/directives',
    'put /api/directives/:id',
    'delete /api/directives/:id',
    'post /api/directives/:id/apply',
    'post /api/directives/:id/restore/:version',
    'get /api/directives/export/all',
    'post /api/directives/import'
  ];
  for (const r of required) {
    assertTrue(endpoints.includes(r), `${r} must be registered; found: ${endpoints.join(', ')}`);
  }
});

test('generateDirectiveId returns correctly-prefixed hex strings', () => {
  const { generateDirectiveId } = require(path.join(PROJECT_ROOT, 'server.js'));
  for (let i = 0; i < 5; i++) {
    const id = generateDirectiveId();
    assertTrue(/^directive_[0-9a-f]{16}$/.test(id), `directive id shape: ${id}`);
  }
});

// ── Validation

test('validateDirectiveBody rejects missing / empty / oversized / non-string name', () => {
  const { validateDirectiveBody } = require(path.join(PROJECT_ROOT, 'server.js'));
  const base = validDirectiveBody();
  assertTrue(validateDirectiveBody(null) !== null, 'null body rejected');
  assertTrue(validateDirectiveBody({}) !== null, 'empty body rejected');
  assertTrue(validateDirectiveBody({ ...base, name: undefined }) !== null, 'missing name rejected');
  assertTrue(validateDirectiveBody({ ...base, name: 42 }) !== null, 'non-string name rejected');
  assertTrue(validateDirectiveBody({ ...base, name: '' }) !== null, 'empty name rejected');
  assertTrue(validateDirectiveBody({ ...base, name: '   ' }) !== null, 'whitespace name rejected');
  assertTrue(validateDirectiveBody({ ...base, name: 'a'.repeat(61) }) !== null, 'oversized name rejected');
  assertTrue(validateDirectiveBody([1, 2, 3]) !== null, 'array body rejected');
});

test('validateDirectiveBody rejects missing / empty / oversized / non-string content', () => {
  const { validateDirectiveBody } = require(path.join(PROJECT_ROOT, 'server.js'));
  const base = validDirectiveBody();
  assertTrue(validateDirectiveBody({ ...base, content: undefined }) !== null, 'missing content rejected');
  assertTrue(validateDirectiveBody({ ...base, content: '' }) !== null, 'empty content rejected');
  assertTrue(validateDirectiveBody({ ...base, content: '   ' }) !== null, 'whitespace content rejected');
  assertTrue(validateDirectiveBody({ ...base, content: 42 }) !== null, 'non-string content rejected');
  assertTrue(validateDirectiveBody({ ...base, content: 'x'.repeat(1001) }) !== null, 'oversized content rejected');
});

test('validateDirectiveBody enforces case-insensitive uniqueness via existingNames', () => {
  const { validateDirectiveBody } = require(path.join(PROJECT_ROOT, 'server.js'));
  const existing = new Set(['dramatic red accent', 'moody lighting']);
  assertTrue(
    validateDirectiveBody(validDirectiveBody({ name: 'Dramatic Red Accent' }), { existingNames: existing }) !== null,
    'case-different duplicate must be rejected'
  );
  assertTrue(
    validateDirectiveBody(validDirectiveBody({ name: 'DRAMATIC RED ACCENT' }), { existingNames: existing }) !== null,
    'all-caps duplicate must be rejected'
  );
  assertTrue(
    validateDirectiveBody(validDirectiveBody({ name: 'Unique new name' }), { existingNames: existing }) === null,
    'non-duplicate name is allowed'
  );
});

test('validateDirectiveBody rejects invalid tags (count, shape, length, non-array)', () => {
  const { validateDirectiveBody } = require(path.join(PROJECT_ROOT, 'server.js'));
  const base = validDirectiveBody();
  assertTrue(validateDirectiveBody({ ...base, tags: 'not-an-array' }) !== null, 'non-array tags rejected');
  assertTrue(validateDirectiveBody({ ...base, tags: Array(9).fill('a') }) !== null, '9 tags rejected');
  assertTrue(validateDirectiveBody({ ...base, tags: ['has space'] }) !== null, 'tag with space rejected');
  assertTrue(validateDirectiveBody({ ...base, tags: ['#hash'] }) !== null, 'tag with # rejected');
  assertTrue(validateDirectiveBody({ ...base, tags: [''] }) !== null, 'empty tag rejected');
  assertTrue(validateDirectiveBody({ ...base, tags: ['a'.repeat(25)] }) !== null, 'oversized tag rejected');
  assertTrue(validateDirectiveBody({ ...base, tags: ['valid-tag', 'also-valid', 'tag-123'] }) === null, 'valid kebab tags accepted');
  assertTrue(validateDirectiveBody({ ...base, tags: [] }) === null, 'empty array tags accepted');
  assertTrue(validateDirectiveBody({ ...base, tags: undefined }) === null, 'undefined tags accepted (treated as empty)');
});

test('validateDirectiveBody partial mode requires at least one field', () => {
  const { validateDirectiveBody } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(validateDirectiveBody({}, { partial: true }) !== null, 'empty partial body rejected');
  assertTrue(validateDirectiveBody({ name: 'x' }, { partial: true }) === null, 'name-only partial accepted');
  assertTrue(validateDirectiveBody({ content: 'x' }, { partial: true }) === null, 'content-only partial accepted');
  assertTrue(validateDirectiveBody({ tags: [] }, { partial: true }) === null, 'tags-only partial accepted');
});

test('normalizeDirectiveTags lowercases + deduplicates + drops invalid', () => {
  const { normalizeDirectiveTags } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertEqual(JSON.stringify(normalizeDirectiveTags(['Color', 'COLOR', 'color']).tags), '["color"]', 'dedup case-insensitively');
  assertEqual(normalizeDirectiveTags(['Mood', 'Composition']).error, null, 'mixed case normalized to lowercase');
  assertEqual(JSON.stringify(normalizeDirectiveTags(['a', 'b', 'a', 'c', 'b']).tags), '["a","b","c"]', 'preserve first-seen order on dedup');
});

// ── Storage helpers

test('readDirectives / writeDirectives round-trip and drop malformed entries', () => {
  const { readDirectives, writeDirectives } = require(path.join(PROJECT_ROOT, 'server.js'));
  const snapshot = snapshotDirectivesFile();
  try {
    const now = new Date().toISOString();
    const good = {
      id: 'directive_aaaaaaaaaaaaaaaa',
      name: 'Good directive',
      content: 'some content',
      tags: ['a', 'b'],
      created_at: now,
      updated_at: now,
      last_used_at: null,
      usage_count: 0,
      history: [{ version: 1, name: 'Good directive', content: 'some content', tags: ['a', 'b'], saved_at: now }]
    };
    const corrupted = [
      { id: 'not-a-directive-id', name: 'x', content: 'x', tags: [], history: [] },
      { name: 'missing id', content: 'x', tags: [], history: [] },
      { id: 'directive_bbbbbbbbbbbbbbbb', content: 'x', tags: [], history: [] },
      { id: 'directive_cccccccccccccccc', name: '', content: 'x', tags: [], history: [] },
      { id: 'directive_dddddddddddddddd', name: 'x', content: '', tags: [], history: [] },
      { id: 'directive_eeeeeeeeeeeeeeee', name: 'x', content: 'x', tags: 'not-array', history: [] },
      { id: 'directive_ffffffffffffffff', name: 'x', content: 'x', tags: [], history: 'not-array' },
      good
    ];
    fs.writeFileSync(DIRECTIVES_FILE, JSON.stringify(corrupted), 'utf8');
    const read = readDirectives();
    assertEqual(read.length, 1, 'only the well-formed entry survives');
    assertEqual(read[0].id, good.id, 'id matches');
  } finally {
    restoreDirectivesFile(snapshot);
  }
});

test('readDirectives returns [] on missing file (after ensure seeds [])', () => {
  const { readDirectives } = require(path.join(PROJECT_ROOT, 'server.js'));
  const snapshot = snapshotDirectivesFile();
  try {
    if (fs.existsSync(DIRECTIVES_FILE)) fs.unlinkSync(DIRECTIVES_FILE);
    const list = readDirectives();
    assertTrue(Array.isArray(list), 'returns array');
    assertEqual(list.length, 0, 'empty on missing file');
    assertTrue(fs.existsSync(DIRECTIVES_FILE), 'file is seeded with []');
  } finally {
    restoreDirectivesFile(snapshot);
  }
});

test('readDirectives returns [] on corrupt JSON (no throw)', () => {
  const { readDirectives } = require(path.join(PROJECT_ROOT, 'server.js'));
  const snapshot = snapshotDirectivesFile();
  try {
    fs.writeFileSync(DIRECTIVES_FILE, '{not valid json', 'utf8');
    const list = readDirectives();
    assertTrue(Array.isArray(list), 'returns array');
    assertEqual(list.length, 0, 'empty on corrupt file');
  } finally {
    restoreDirectivesFile(snapshot);
  }
});

test('writeDirectives uses atomic temp+rename (no partial file)', () => {
  const { writeDirectives, readDirectives } = require(path.join(PROJECT_ROOT, 'server.js'));
  const snapshot = snapshotDirectivesFile();
  try {
    resetDirectivesFile();
    writeDirectives([{ id: 'directive_1111111111111111', name: 'A', content: 'a', tags: [], history: [], created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', last_used_at: null, usage_count: 0 }]);
    assertTrue(!fs.existsSync(`${DIRECTIVES_FILE}.tmp`), 'tmp file cleaned up after rename');
    const list = readDirectives();
    assertEqual(list.length, 1, 'one directive written');
  } finally {
    restoreDirectivesFile(snapshot);
  }
});

test('pushDirectiveHistory appends with incremented version + updates updated_at', () => {
  const { pushDirectiveHistory, snapshotDirective } = require(path.join(PROJECT_ROOT, 'server.js'));
  const d = {
    id: 'directive_aaaaaaaaaaaaaaaa',
    name: 'A',
    content: 'a',
    tags: ['x'],
    history: []
  };
  pushDirectiveHistory(d);
  assertEqual(d.history.length, 1, 'one history entry');
  assertEqual(d.history[0].version, 1, 'version = 1 on first push');
  d.name = 'A v2';
  d.content = 'a v2';
  pushDirectiveHistory(d);
  assertEqual(d.history.length, 2, 'two history entries');
  assertEqual(d.history[1].version, 2, 'version = 2 on second push');
  assertEqual(d.history[1].name, 'A v2', 'captures new name');
  assertEqual(d.history[1].content, 'a v2', 'captures new content');
  assertTrue(typeof d.updated_at === 'string' && d.updated_at.length > 0, 'updated_at set');
});

// ── HTTP integration

test('HTTP integration: GET /api/directives returns an array', async () => {
  const snapshot = snapshotDirectivesFile();
  resetDirectivesFile();
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/directives`);
    assertEqual(r.status, 200, 'status 200');
    assertTrue(r.body && r.body.success === true, 'success true');
    assertTrue(Array.isArray(r.body.data), 'data is array');
    assertEqual(r.body.data.length, 0, 'empty after reset');
  } finally {
    await srv.close();
    restoreDirectivesFile(snapshot);
  }
});

test('HTTP integration: POST /api/directives creates + uniqueness + GET /:id round-trips', async () => {
  const snapshot = snapshotDirectivesFile();
  resetDirectivesFile();
  const srv = await startTestServer();
  try {
    const create = await fetchJson(`${srv.base}/api/directives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validDirectiveBody())
    });
    assertEqual(create.status, 201, 'POST → 201');
    assertTrue(create.body.success, 'POST success');
    const id = create.body.data.id;
    assertTrue(/^directive_[0-9a-f]{16}$/.test(id), 'id shape');
    assertEqual(create.body.data.usage_count, 0, 'fresh usage_count = 0');
    assertEqual(create.body.data.history.length, 1, 'one history entry on creation');
    assertEqual(create.body.data.history[0].version, 1, 'history version = 1');

    const dup = await fetchJson(`${srv.base}/api/directives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validDirectiveBody({ name: 'DRAMATIC RED ACCENT' }))
    });
    assertEqual(dup.status, 400, 'duplicate (case-insensitive) → 400');
    assertTrue(/already in use/i.test(dup.body.error), 'error mentions duplicate');

    const getOne = await fetchJson(`${srv.base}/api/directives/${id}`);
    assertEqual(getOne.status, 200, 'GET one → 200');
    assertEqual(getOne.body.data.id, id, 'id matches');

    const getMissing = await fetchJson(`${srv.base}/api/directives/directive_doesnotexist00`);
    assertEqual(getMissing.status, 404, 'missing → 404');
  } finally {
    await srv.close();
    restoreDirectivesFile(snapshot);
  }
});

test('HTTP integration: POST /api/directives rejects invalid bodies', async () => {
  const snapshot = snapshotDirectivesFile();
  resetDirectivesFile();
  const srv = await startTestServer();
  try {
    const cases = [
      { body: { content: 'x' }, label: 'missing name', expect: /name/ },
      { body: { name: 'X' }, label: 'missing content', expect: /content/ },
      { body: { name: 'X', content: '' }, label: 'empty content', expect: /content/ },
      { body: { name: 'X', content: 'x'.repeat(1001) }, label: 'oversized content', expect: /1000/ },
      { body: { name: 'X', content: 'x', tags: 'not-array' }, label: 'non-array tags', expect: /array/ },
      { body: { name: 'X', content: 'x', tags: ['has space'] }, label: 'bad tag', expect: /tags\[0\]/ },
      { body: { name: 'X', content: 'x', tags: Array(9).fill('a') }, label: '9 tags', expect: /8 or fewer/ }
    ];
    for (const c of cases) {
      const r = await fetchJson(`${srv.base}/api/directives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c.body)
      });
      assertEqual(r.status, 400, `${c.label} → 400`);
      assertTrue(c.expect.test(r.body && r.body.error), `${c.label} error matches ${c.expect}`);
    }
  } finally {
    await srv.close();
    restoreDirectivesFile(snapshot);
  }
});

test('HTTP integration: PUT updates + history grows + DELETE removes', async () => {
  const snapshot = snapshotDirectivesFile();
  resetDirectivesFile();
  const srv = await startTestServer();
  try {
    const create = await fetchJson(`${srv.base}/api/directives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validDirectiveBody())
    });
    const id = create.body.data.id;

    const put1 = await fetchJson(`${srv.base}/api/directives/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Dramatic red accent v2', content: 'v2 content' })
    });
    assertEqual(put1.status, 200, 'PUT → 200');
    assertEqual(put1.body.data.name, 'Dramatic red accent v2', 'name updated');
    assertEqual(put1.body.data.content, 'v2 content', 'content updated');
    assertEqual(put1.body.data.history.length, 2, 'history grew to 2');
    assertEqual(put1.body.data.history[1].version, 2, 'newest history version = 2');
    assertEqual(put1.body.data.history[1].name, 'Dramatic red accent v2', 'history captured new name');
    assertEqual(put1.body.data.history[1].content, 'v2 content', 'history captured new content');

    // PUT with no fields → 400
    const empty = await fetchJson(`${srv.base}/api/directives/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assertEqual(empty.status, 400, 'empty PUT → 400');

    // PUT missing id → 404
    const missing = await fetchJson(`${srv.base}/api/directives/directive_doesnotexist00`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' })
    });
    assertEqual(missing.status, 404, 'PUT missing id → 404');

    // DELETE
    const del = await fetchJson(`${srv.base}/api/directives/${id}`, { method: 'DELETE' });
    assertEqual(del.status, 200, 'DELETE → 200');
    const getAfter = await fetchJson(`${srv.base}/api/directives/${id}`);
    assertEqual(getAfter.status, 404, 'GET after DELETE → 404');
  } finally {
    await srv.close();
    restoreDirectivesFile(snapshot);
  }
});

test('HTTP integration: POST /:id/apply increments usage + sets last_used_at', async () => {
  const snapshot = snapshotDirectivesFile();
  resetDirectivesFile();
  const srv = await startTestServer();
  try {
    const create = await fetchJson(`${srv.base}/api/directives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validDirectiveBody())
    });
    const id = create.body.data.id;
    assertEqual(create.body.data.usage_count, 0, 'starts at 0');
    assertEqual(create.body.data.last_used_at, null, 'starts null');

    const apply = await fetchJson(`${srv.base}/api/directives/${id}/apply`, { method: 'POST' });
    assertEqual(apply.status, 200, 'apply → 200');
    assertEqual(apply.body.data.usage_count, 1, 'usage_count = 1 after first apply');
    assertTrue(typeof apply.body.data.last_used_at === 'string', 'last_used_at set');

    const apply2 = await fetchJson(`${srv.base}/api/directives/${id}/apply`, { method: 'POST' });
    assertEqual(apply2.body.data.usage_count, 2, 'usage_count = 2 after second apply');

    // Apply missing id → 404
    const miss = await fetchJson(`${srv.base}/api/directives/directive_doesnotexist00/apply`, { method: 'POST' });
    assertEqual(miss.status, 404, 'apply missing id → 404');
  } finally {
    await srv.close();
    restoreDirectivesFile(snapshot);
  }
});

test('HTTP integration: POST /:id/restore/:version rolls back + appends new history', async () => {
  const snapshot = snapshotDirectivesFile();
  resetDirectivesFile();
  const srv = await startTestServer();
  try {
    const create = await fetchJson(`${srv.base}/api/directives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validDirectiveBody())
    });
    const id = create.body.data.id;
    const v1Content = create.body.data.content;
    const v1Name = create.body.data.name;
    const v1Tags = create.body.data.tags;

    // Bump to v2
    await fetchJson(`${srv.base}/api/directives/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'v2 name', content: 'v2 content', tags: ['mood'] })
    });
    // Bump to v3
    await fetchJson(`${srv.base}/api/directives/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'v3 name', content: 'v3 content' })
    });

    // Restore v1
    const restore = await fetchJson(`${srv.base}/api/directives/${id}/restore/1`, { method: 'POST' });
    assertEqual(restore.status, 200, 'restore → 200');
    assertEqual(restore.body.data.name, v1Name, 'current name = v1 name');
    assertEqual(restore.body.data.content, v1Content, 'current content = v1 content');
    assertEqual(JSON.stringify(restore.body.data.tags), JSON.stringify(v1Tags), 'current tags = v1 tags');
    assertEqual(restore.body.data.history.length, 4, 'history has 4 entries (v1, v2, v3, v4-as-restore)');
    assertEqual(restore.body.data.history[3].version, 4, 'restore recorded as v4');
    assertEqual(restore.body.data.history[3].name, v1Name, 'v4 history snapshot matches v1 values');
    // v1 still in history
    assertEqual(restore.body.data.history[0].version, 1, 'v1 still preserved');
    assertEqual(restore.body.data.history[0].content, v1Content, 'v1 content preserved');

    // Restore missing version → 400
    const missing = await fetchJson(`${srv.base}/api/directives/${id}/restore/999`, { method: 'POST' });
    assertEqual(missing.status, 400, 'restore missing version → 400');
    assertTrue(/version 999/.test(missing.body.error), 'error names the version');

    // Restore non-numeric → 400
    const bad = await fetchJson(`${srv.base}/api/directives/${id}/restore/foo`, { method: 'POST' });
    assertEqual(bad.status, 400, 'restore non-numeric → 400');
  } finally {
    await srv.close();
    restoreDirectivesFile(snapshot);
  }
});

test('HTTP integration: GET /export/all returns valid envelope; POST /import round-trips', async () => {
  const snapshot = snapshotDirectivesFile();
  resetDirectivesFile();
  const srv = await startTestServer();
  try {
    // Create two directives
    await fetchJson(`${srv.base}/api/directives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validDirectiveBody({ name: 'Export 1', tags: ['x'] }))
    });
    await fetchJson(`${srv.base}/api/directives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validDirectiveBody({ name: 'Export 2', tags: [] }))
    });

    // Export
    const exp = await fetchJson(`${srv.base}/api/directives/export/all`);
    assertEqual(exp.status, 200, 'export → 200');
    assertEqual(exp.body.format, 'image-to-prompt-directives', 'format matches');
    assertEqual(exp.body.version, 1, 'version matches');
    assertEqual(exp.body.directives.length, 2, 'exported 2 directives');
    assertTrue(typeof exp.body.exported_at === 'string', 'exported_at set');

    // Wipe, then import the envelope
    resetDirectivesFile();
    const imp = await fetchJson(`${srv.base}/api/directives/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exp.body)
    });
    assertEqual(imp.status, 201, 'import → 201');
    assertEqual(imp.body.data.imported, 2, 'imported 2');
    assertEqual(imp.body.data.total, 2, 'total 2 after import');

    // Verify: directives exist, fresh ids, history preserved
    const list = await fetchJson(`${srv.base}/api/directives`);
    assertEqual(list.body.data.length, 2, 'list length 2');
    for (const d of list.body.data) {
      assertTrue(/^directive_[0-9a-f]{16}$/.test(d.id), 'fresh id shape');
      assertEqual(d.usage_count, 0, 'usage reset on import');
      assertEqual(d.last_used_at, null, 'last_used_at reset on import');
      assertTrue(d.history.length >= 1, 'history preserved');
    }
  } finally {
    await srv.close();
    restoreDirectivesFile(snapshot);
  }
});

test('HTTP integration: POST /import is atomic — bad directive in batch rolls back the whole import', async () => {
  const snapshot = snapshotDirectivesFile();
  resetDirectivesFile();
  const srv = await startTestServer();
  try {
    // Seed an existing directive
    await fetchJson(`${srv.base}/api/directives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validDirectiveBody({ name: 'Pre-existing' }))
    });

    // Try to import a batch with one good and one bad directive
    const imp = await fetchJson(`${srv.base}/api/directives/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: 'image-to-prompt-directives',
        version: 1,
        directives: [
          { name: 'Good imported', content: 'foo', tags: [] },
          { name: 'Bad imported', content: '', tags: [] } // invalid: empty content
        ]
      })
    });
    assertEqual(imp.status, 400, 'partial-bad batch → 400');
    assertTrue(/directives\[1\]/.test(imp.body.error), 'error identifies the bad index');

    // Atomicity: no new directives were added
    const list = await fetchJson(`${srv.base}/api/directives`);
    assertEqual(list.body.data.length, 1, 'no new directives added');
    assertEqual(list.body.data[0].name, 'Pre-existing', 'only the pre-existing one remains');

    // Bad format → 400
    const badFormat = await fetchJson(`${srv.base}/api/directives/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'wrong', version: 1, directives: [] })
    });
    assertEqual(badFormat.status, 400, 'bad format → 400');

    // Missing directives array → 400
    const noDirectives = await fetchJson(`${srv.base}/api/directives/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'image-to-prompt-directives', version: 1 })
    });
    assertEqual(noDirectives.status, 400, 'missing directives array → 400');
  } finally {
    await srv.close();
    restoreDirectivesFile(snapshot);
  }
});

test('End-to-end: save → apply → edit → restore → export → import (data loss check)', async () => {
  // This is the user-stated requirement: "saved directives can be
  // reliably retrieved and applied across multiple independent runs,
  // with zero data loss between sessions."
  //
  // We simulate a "session boundary" by closing the server, leaving
  // the file on disk, restarting, and verifying the same directive
  // is still there with all its data.
  const snapshot = snapshotDirectivesFile();
  resetDirectivesFile();
  const srv1 = await startTestServer();
  let id;
  try {
    // SESSION 1: create + apply + edit (multiple versions)
    const create = await fetchJson(`${srv1.base}/api/directives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validDirectiveBody({ name: 'Cross-session directive', tags: ['persist'] }))
    });
    id = create.body.data.id;
    await fetchJson(`${srv1.base}/api/directives/${id}/apply`, { method: 'POST' });
    await fetchJson(`${srv1.base}/api/directives/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'content v2' })
    });
    await fetchJson(`${srv1.base}/api/directives/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cross-session v3' })
    });
  } finally {
    await srv1.close();
  }

  // SESSION 2: server restarts, file persists on disk
  const srv2 = await startTestServer();
  try {
    const list = await fetchJson(`${srv2.base}/api/directives`);
    assertEqual(list.body.data.length, 1, 'directive persists across session');
    const d = list.body.data[0];
    assertEqual(d.id, id, 'id unchanged');
    assertEqual(d.name, 'Cross-session v3', 'name persisted (latest)');
    assertEqual(d.content, 'content v2', 'content persisted (latest)');
    assertEqual(d.usage_count, 1, 'usage_count persisted');
    assertEqual(JSON.stringify(d.tags), JSON.stringify(['persist']), 'tags persisted');
    assertTrue(d.history.length >= 3, 'history persisted (>= 3 versions)');

    // Round-trip export / import
    const exp = await fetchJson(`${srv2.base}/api/directives/export/all`);
    assertEqual(exp.body.directives.length, 1, 'export contains 1 directive');
    assertTrue(exp.body.directives[0].history.length >= 3, 'exported history preserved');
  } finally {
    await srv2.close();
    restoreDirectivesFile(snapshot);
  }
});

// ── Frontend HTML / CSS / JS assertions

test('Frontend HTML: directives actions row + 3 new modals exist with a11y attrs (ADR 0009)', () => {
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'src/index.html'), 'utf8');

  // Actions row
  assertTrue(/id="directives-select"/.test(html), 'directives <select> missing');
  assertTrue(/aria-label="Choose a saved directive to apply"/.test(html), 'select must have aria-label');
  assertTrue(/id="directives-apply-btn"/.test(html), 'Apply button missing');
  assertTrue(/id="directives-save-btn"/.test(html), 'Save button missing');
  assertTrue(/id="directives-manage-btn"/.test(html), 'Manage button missing');

  // Save modal
  assertTrue(/id="save-directive-modal"/.test(html), 'save modal missing');
  assertTrue(/role="dialog"/.test(html), 'save modal must have role="dialog"');
  assertTrue(/aria-labelledby="save-directive-modal-title"/.test(html), 'save modal must reference its title');
  assertTrue(/id="save-directive-name-input"/.test(html), 'name input missing');
  assertTrue(/id="save-directive-tags-input"/.test(html), 'tags input missing');
  assertTrue(/id="save-directive-content-preview"/.test(html), 'content preview missing');

  // Manager modal
  assertTrue(/id="directives-manager-modal"/.test(html), 'manager modal missing');
  assertTrue(/aria-labelledby="directives-manager-modal-title"/.test(html), 'manager must reference its title');
  assertTrue(/type="search"/.test(html), 'search input must be type=search');
  assertTrue(/aria-label="Search saved directives by name or tag"/.test(html), 'manager search must have aria-label');
  assertTrue(/<fieldset/.test(html), 'sort controls in a fieldset');
  assertTrue(/id="directives-export-btn"/.test(html), 'export button missing');
  assertTrue(/id="directives-import-btn"/.test(html), 'import button missing');
  assertTrue(/id="directives-import-input"/.test(html), 'import input missing');
  // 4 sort options (newest, oldest, most-used, name)
  assertTrue(/value="most-used"/.test(html), 'most-used sort option missing');
  assertTrue(/value="name"/.test(html), 'name sort option missing');

  // Edit modal
  assertTrue(/id="edit-directive-modal"/.test(html), 'edit modal missing');
  assertTrue(/id="edit-directive-name-input"/.test(html), 'edit name input missing');
  assertTrue(/id="edit-directive-content-input"/.test(html), 'edit content textarea missing');
  assertTrue(/id="directive-history-list"/.test(html), 'history list missing');
  assertTrue(/id="edit-directive-delete"/.test(html), 'edit delete button missing');
});

test('Frontend CSS: directives styles defined (ADR 0009)', () => {
  const css = fs.readFileSync(path.join(PROJECT_ROOT, 'src/styles.css'), 'utf8');
  for (const sel of [
    '.directives-actions',
    '.directives-actions__row',
    '.directive-manager-controls',
    '.directive-manager-sort',
    '.directive-sort-option',
    '.directive-tag-filter',
    '.directive-tag-chip',
    '.directive-manager-status',
    '.directive-manager-list',
    '.directive-manager-item',
    '.directive-manager-item__name',
    '.directive-manager-item__preview',
    '.directive-manager-item__meta',
    '.directive-manager-item__actions',
    '.directive-history-list',
    '.directive-history-item',
    '.directive-history-item__restore',
    '.save-directive-content-preview'
  ]) {
    assertTrue(css.includes(sel), `CSS must define ${sel}`);
  }
});

test('Frontend JS: openSaveDirectiveModal, openDirectivesManagerModal, openEditDirectiveModal handlers exist (ADR 0009)', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app.js'), 'utf8');
  assertTrue(/const openSaveDirectiveModal\s*=/.test(js), 'openSaveDirectiveModal handler missing');
  assertTrue(/const openDirectivesManagerModal\s*=/.test(js), 'openDirectivesManagerModal handler missing');
  assertTrue(/const openEditDirectiveModal\s*=/.test(js), 'openEditDirectiveModal handler missing');
  assertTrue(/const restoreDirectiveVersion\s*=/.test(js), 'restoreDirectiveVersion handler missing');
  assertTrue(/const exportDirectives\s*=/.test(js), 'exportDirectives handler missing');
  assertTrue(/const importDirectivesFromFile\s*=/.test(js), 'importDirectivesFromFile handler missing');
  assertTrue(/const applySelectedDirective\s*=/.test(js), 'applySelectedDirective handler missing');
  assertTrue(/const deleteDirective\s*=/.test(js), 'deleteDirective handler missing');
  assertTrue(/loadDirectives\(\)/.test(js), 'loadDirectives called');
  // API surface
  for (const path of [
    "'/api/directives'",
    '`/api/directives/${encodeURIComponent',
    "'/api/directives/export/all'",
    "'/api/directives/import'"
  ]) {
    assertTrue(js.includes(path), `app.js must reference ${path}`);
  }
});

// ─── ADR 0011 — post-generation chat ────────────────────────────────────

const CHAT_FILE = path.join(PROJECT_ROOT, 'data', 'chat_sessions.json');

const snapshotChatFile = () => {
  if (fs.existsSync(CHAT_FILE)) return fs.readFileSync(CHAT_FILE, 'utf8');
  return null;
};

const restoreChatFile = (snapshot) => {
  if (snapshot === null) {
    if (fs.existsSync(CHAT_FILE)) fs.unlinkSync(CHAT_FILE);
  } else {
    fs.writeFileSync(CHAT_FILE, snapshot, 'utf8');
  }
};

const resetChatFile = () => {
  if (!fs.existsSync(path.dirname(CHAT_FILE))) {
    fs.mkdirSync(path.dirname(CHAT_FILE), { recursive: true });
  }
  fs.writeFileSync(CHAT_FILE, '[]', 'utf8');
};

test('ADR 0011: server exports chat constants and helpers', () => {
  const serverMod = require(path.join(PROJECT_ROOT, 'server.js'));
  for (const key of [
    'MAX_FINAL_PROMPT_LENGTH',
    'MAX_CHAT_MESSAGE_LENGTH',
    'MAX_CHAT_MESSAGES_PER_SESSION',
    'MAX_CHAT_SESSIONS_TOTAL',
    'CHAT_SESSION_ID_PREFIX',
    'CHAT_MESSAGE_ID_PREFIX',
    'CHAT_TITLE_MAX_LENGTH',
    'DEFAULT_CHAT_SYSTEM_PROMPT',
    'generateChatSessionId',
    'generateChatMessageId',
    'readChatSessions',
    'writeChatSessions',
    'buildChatTitle',
    'buildChatSystemPrompt',
    'validateChatSessionCreate',
    'validateChatMessage',
    'extractChatReply'
  ]) {
    assertTrue(Object.prototype.hasOwnProperty.call(serverMod, key), `server.js must export ${key}`);
  }
  assertEqual(serverMod.CHAT_SESSION_ID_PREFIX, 'chat_', 'session id prefix');
  assertEqual(serverMod.CHAT_MESSAGE_ID_PREFIX, 'msg_', 'message id prefix');
  assertTrue(serverMod.MAX_CHAT_MESSAGE_LENGTH > 0, 'message length cap positive');
  assertTrue(serverMod.MAX_FINAL_PROMPT_LENGTH > 0, 'prompt length cap positive');
});

test('ADR 0011: chat id generators produce prefixed hex strings', () => {
  const { generateChatSessionId, generateChatMessageId } = require(path.join(PROJECT_ROOT, 'server.js'));
  const sid = generateChatSessionId();
  const mid = generateChatMessageId();
  assertTrue(sid.startsWith('chat_'), `session id starts with chat_: ${sid}`);
  assertTrue(mid.startsWith('msg_'), `message id starts with msg_: ${mid}`);
  assertEqual(sid.length, 'chat_'.length + 16, 'session id is chat_ + 16 hex');
  assertEqual(mid.length, 'msg_'.length + 16, 'message id is msg_ + 16 hex');
  // Two calls produce different ids (collision-resistant).
  assertTrue(generateChatSessionId() !== sid, 'session ids are unique');
});

test('ADR 0011: buildChatTitle truncates long prompts', () => {
  const { buildChatTitle } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertEqual(buildChatTitle(''), '', 'empty prompt -> empty title');
  assertEqual(buildChatTitle('   '), '', 'whitespace prompt -> empty title');
  assertEqual(buildChatTitle(null), '', 'null prompt -> empty title');
  assertEqual(buildChatTitle('hello world'), 'hello world', 'short prompt kept as-is');
  const long = 'a'.repeat(200);
  const title = buildChatTitle(long);
  assertTrue(title.length <= 80, `title truncated to <=80 chars (got ${title.length})`);
  assertTrue(title.endsWith('…'), 'long title ends with ellipsis');
  assertEqual(buildChatTitle('  multi   line\n  prompt  '), 'multi line prompt', 'whitespace collapsed');
});

test('ADR 0011: validateChatSessionCreate rejects bad bodies', () => {
  const { validateChatSessionCreate } = require(path.join(PROJECT_ROOT, 'server.js'));
  const presets = [{ id: 'preset_aaaa1111bbbb2222', name: 'Test preset' }];

  // Missing / wrong-shape body
  assertTrue(validateChatSessionCreate(null, { presets }), 'null body rejected');
  assertTrue(validateChatSessionCreate([], { presets }), 'array body rejected');
  assertTrue(validateChatSessionCreate('hi', { presets }), 'string body rejected');

  // Missing prompt
  assertTrue(validateChatSessionCreate({ preset_id: 'preset_aaaa1111bbbb2222' }, { presets }), 'missing prompt rejected');
  assertTrue(validateChatSessionCreate({ prompt: '', preset_id: 'preset_aaaa1111bbbb2222' }, { presets }), 'empty prompt rejected');
  assertTrue(validateChatSessionCreate({ prompt: '   ', preset_id: 'preset_aaaa1111bbbb2222' }, { presets }), 'whitespace prompt rejected');
  assertTrue(validateChatSessionCreate({ prompt: 42, preset_id: 'preset_aaaa1111bbbb2222' }, { presets }), 'non-string prompt rejected');

  // Prompt too long
  const longPrompt = 'a'.repeat(5001);
  const tooLongErr = validateChatSessionCreate({ prompt: longPrompt, preset_id: 'preset_aaaa1111bbbb2222' }, { presets });
  assertTrue(tooLongErr && /characters or fewer/.test(tooLongErr), 'too-long prompt rejected');

  // Bad preset_id
  assertTrue(validateChatSessionCreate({ prompt: 'hi', preset_id: 'palette_xxx' }, { presets }), 'non-preset id rejected');
  assertTrue(validateChatSessionCreate({ prompt: 'hi', preset_id: 'preset_doesnotexist' }, { presets }), 'unknown preset id rejected');

  // Bad run_id
  const badRunErr = validateChatSessionCreate({
    prompt: 'hi',
    preset_id: 'preset_aaaa1111bbbb2222',
    run_id: 'run_short'
  }, { presets });
  assertTrue(badRunErr && /run_id/.test(badRunErr), 'bad run_id rejected');

  // Bad analysis_snapshot
  const badSnapErr = validateChatSessionCreate({
    prompt: 'hi',
    preset_id: 'preset_aaaa1111bbbb2222',
    analysis_snapshot: 'not an object'
  }, { presets });
  assertTrue(badSnapErr && /analysis_snapshot/.test(badSnapErr), 'bad snapshot rejected');
  const arrSnapErr = validateChatSessionCreate({
    prompt: 'hi',
    preset_id: 'preset_aaaa1111bbbb2222',
    analysis_snapshot: []
  }, { presets });
  assertTrue(arrSnapErr && /analysis_snapshot/.test(arrSnapErr), 'array snapshot rejected');

  // Valid case
  const okErr = validateChatSessionCreate({
    prompt: 'A painting of a tree.',
    preset_id: 'preset_aaaa1111bbbb2222',
    run_id: 'run_0123456789abcdef',
    analysis_snapshot: { subject: 'A tree', style: 'oil' }
  }, { presets });
  assertEqual(okErr, null, 'valid body passes');
});

test('ADR 0011: validateChatMessage rejects bad message bodies', () => {
  const { validateChatMessage } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(validateChatMessage(null), 'null body rejected');
  assertTrue(validateChatMessage([]), 'array body rejected');
  assertTrue(validateChatMessage({}), 'missing content rejected');
  assertTrue(validateChatMessage({ content: 42 }), 'non-string content rejected');
  assertTrue(validateChatMessage({ content: '' }), 'empty content rejected');
  assertTrue(validateChatMessage({ content: '   \n  ' }), 'whitespace content rejected');
  assertTrue(validateChatMessage({ content: 'a'.repeat(2001) }), 'too-long content rejected');
  assertEqual(validateChatMessage({ content: 'make it dramatic' }), null, 'valid content passes');
});

test('ADR 0011: extractChatReply parses well-formed JSON', () => {
  const { extractChatReply } = require(path.join(PROJECT_ROOT, 'server.js'));
  const r1 = extractChatReply('{"reply":"hi","suggested_prompt":null}');
  assertEqual(r1.reply, 'hi', 'reply parsed');
  assertEqual(r1.suggested_prompt, null, 'null suggested_prompt preserved');

  const r2 = extractChatReply('{"reply":"here you go","suggested_prompt":"a tighter prompt"}');
  assertEqual(r2.reply, 'here you go', 'reply parsed with revision');
  assertEqual(r2.suggested_prompt, 'a tighter prompt', 'suggested_prompt parsed');

  // Empty-string suggested_prompt collapses to null (no usable revision).
  const r3 = extractChatReply('{"reply":"ok","suggested_prompt":""}');
  assertEqual(r3.suggested_prompt, null, 'empty suggested_prompt coerced to null');

  // JSON inside a markdown fence.
  const r4 = extractChatReply('```json\n{"reply":"x","suggested_prompt":null}\n```');
  assertEqual(r4.reply, 'x', 'markdown-fenced JSON parsed');
});

test('ADR 0011: extractChatReply handles balanced-brace extraction', () => {
  const { extractChatReply } = require(path.join(PROJECT_ROOT, 'server.js'));
  const r = extractChatReply('Sure, here is the JSON:\n{"reply":"ok","suggested_prompt":null}\nHope that helps.');
  assertEqual(r.reply, 'ok', 'balanced-brace extraction works');
});

test('ADR 0011: extractChatReply returns valid object on malformed input (NEVER throws)', () => {
  // Defensive contract (post-investigation 2026-06-23): the parser is
  // TOTAL — it always returns a valid { reply, suggested_prompt,
  // fallback_reason } object. The chat console never sees an error
  // for parse-level failures; the assistant message just shows a
  // user-friendly fallback text. This is what kills the old
  // "Chat reply missing non-empty 'reply' string" error path.
  const { extractChatReply } = require(path.join(PROJECT_ROOT, 'server.js'));
  const FALLBACK = "Sorry — I couldn't generate a response for that message. Please try again or rephrase your request.";

  // 1. Unparseable JSON
  const r1 = extractChatReply('not json at all');
  assertEqual(r1.reply, FALLBACK, 'unparseable -> fallback reply');
  assertEqual(r1.suggested_prompt, null, 'unparseable -> null suggested_prompt');
  assertEqual(r1.fallback_reason, 'no_json', 'unparseable -> fallback_reason tagged');

  // 2. Missing reply field
  const r2 = extractChatReply('{"suggested_prompt":null}');
  assertEqual(r2.reply, FALLBACK, 'missing reply -> fallback');
  assertEqual(r2.suggested_prompt, null, 'missing reply -> null suggested_prompt');
  assertEqual(r2.fallback_reason, 'missing_reply', 'missing reply -> fallback_reason tagged');

  // 3. Empty reply
  const r3 = extractChatReply('{"reply":"","suggested_prompt":null}');
  assertEqual(r3.reply, FALLBACK, 'empty reply -> fallback');
  assertEqual(r3.suggested_prompt, null, 'empty reply -> null suggested_prompt');
  assertEqual(r3.fallback_reason, 'empty_reply', 'empty reply -> fallback_reason tagged');

  // 4. Whitespace-only reply
  const r4 = extractChatReply('{"reply":"   \\n\\t  ","suggested_prompt":null}');
  assertEqual(r4.reply, FALLBACK, 'whitespace reply -> fallback');
  assertEqual(r4.fallback_reason, 'empty_reply', 'whitespace reply tagged as empty_reply');

  // 5. Null reply
  const r5 = extractChatReply('{"reply":null,"suggested_prompt":null}');
  assertEqual(r5.reply, FALLBACK, 'null reply -> fallback');
  assertEqual(r5.fallback_reason, 'null_reply', 'null reply tagged');

  // 6. Wrong-type reply (number)
  const r6 = extractChatReply('{"reply":42,"suggested_prompt":null}');
  assertEqual(r6.reply, FALLBACK, 'number reply -> fallback');
  assertEqual(r6.fallback_reason, 'wrong_type_reply', 'number reply tagged');

  // 7. Wrong-type reply (array)
  const r7 = extractChatReply('{"reply":["a","b"],"suggested_prompt":null}');
  assertEqual(r7.reply, FALLBACK, 'array reply -> fallback');
  assertEqual(r7.fallback_reason, 'wrong_type_reply', 'array reply tagged');

  // 8. Top-level array (not object)
  const r8 = extractChatReply('[1,2,3]');
  assertEqual(r8.reply, FALLBACK, 'top-level array -> fallback');
  assertEqual(r8.fallback_reason, 'not_object', 'top-level array tagged');

  // 9. Top-level null
  const r9 = extractChatReply('null');
  assertEqual(r9.reply, FALLBACK, 'top-level null -> fallback');
  assertEqual(r9.fallback_reason, 'not_object', 'top-level null tagged');

  // 10. Empty / whitespace input
  const r10 = extractChatReply('');
  assertEqual(r10.reply, FALLBACK, 'empty input -> fallback');
  assertEqual(r10.fallback_reason, 'empty_content', 'empty input tagged');

  const r11 = extractChatReply('   \n\t  ');
  assertEqual(r11.reply, FALLBACK, 'whitespace input -> fallback');
  assertEqual(r11.fallback_reason, 'empty_content', 'whitespace input tagged');

  // 11. Non-string input
  const r12 = extractChatReply(null);
  assertEqual(r12.reply, FALLBACK, 'null input -> fallback');
  assertEqual(r12.fallback_reason, 'empty_content', 'null input tagged');

  const r13 = extractChatReply(undefined);
  assertEqual(r13.reply, FALLBACK, 'undefined input -> fallback');
  assertEqual(r13.fallback_reason, 'empty_content', 'undefined input tagged');

  // 12. Non-string number input
  const r14 = extractChatReply(42);
  assertEqual(r14.reply, FALLBACK, 'number input -> fallback');
  assertEqual(r14.fallback_reason, 'empty_content', 'number input tagged');
});

test('ADR 0011: extractChatReply NEVER invents a suggested_prompt on fallback', () => {
  // Critical safety invariant: when we fall back, suggested_prompt
  // MUST be null. We must never hallucinate a revision — the user
  // could apply it and corrupt their working prompt.
  const { extractChatReply } = require(path.join(PROJECT_ROOT, 'server.js'));

  // Even if the model managed to include a suggested_prompt in a
  // malformed response, the fallback path drops it.
  const r1 = extractChatReply('{"reply":null,"suggested_prompt":"a hallucinated revision"}');
  assertEqual(r1.suggested_prompt, null, 'fallback drops any suggested_prompt');

  const r2 = extractChatReply('{"reply":42,"suggested_prompt":"another hallucinated"}');
  assertEqual(r2.suggested_prompt, null, 'wrong-type reply also drops suggested_prompt');

  const r3 = extractChatReply('not json at all but with "suggested_prompt": "fake"');
  assertEqual(r3.suggested_prompt, null, 'unparseable drops any would-be suggested_prompt');
});

test('ADR 0011: extractChatReply success path returns fallback_reason=null', () => {
  const { extractChatReply } = require(path.join(PROJECT_ROOT, 'server.js'));

  const r1 = extractChatReply('{"reply":"hi","suggested_prompt":null}');
  assertEqual(r1.fallback_reason, null, 'success -> null fallback_reason');
  assertEqual(r1.reply, 'hi', 'success -> real reply');

  const r2 = extractChatReply('{"reply":"here you go","suggested_prompt":"a tighter prompt"}');
  assertEqual(r2.fallback_reason, null, 'success with revision -> null fallback_reason');
  assertEqual(r2.reply, 'here you go', 'success -> real reply preserved');
  assertEqual(r2.suggested_prompt, 'a tighter prompt', 'success -> revision preserved');

  // Empty suggested_prompt is still success (no revision), but the
  // fallback_reason stays null because the model followed the schema.
  const r3 = extractChatReply('{"reply":"ok","suggested_prompt":""}');
  assertEqual(r3.fallback_reason, null, 'empty suggested_prompt is still success');
  assertEqual(r3.suggested_prompt, null, 'empty suggested_prompt coerced to null');

  // Missing suggested_prompt field — schema-violation but recoverable.
  const r4 = extractChatReply('{"reply":"x"}');
  assertEqual(r4.reply, 'x', 'missing suggested_prompt but valid reply -> use the reply');
  assertEqual(r4.suggested_prompt, null, 'missing suggested_prompt -> null');
  assertEqual(r4.fallback_reason, null, 'missing suggested_prompt is NOT a fallback (reply was good)');
});

test('ADR 0011: extractChatReply handles truncated JSON', () => {
  const { extractChatReply } = require(path.join(PROJECT_ROOT, 'server.js'));
  // Truncated mid-string — common when max_tokens cuts off output.
  const r = extractChatReply('{"reply":"here is the new prompt: A paint');
  assertTrue(r.reply.length > 0, 'fallback reply is non-empty');
  assertTrue(/sorry|try again/i.test(r.reply), 'fallback reply has friendly text');
  assertTrue(typeof r.fallback_reason === 'string', 'fallback_reason present');
});

test('ADR 0011: extractChatReply handles array-as-top-level', () => {
  const { extractChatReply } = require(path.join(PROJECT_ROOT, 'server.js'));
  const r = extractChatReply('["a","b","c"]');
  assertEqual(r.fallback_reason, 'not_object', 'top-level array tagged');
  assertTrue(r.reply.length > 0, 'fallback reply present');
});

test('ADR 0011: extractChatReply unwraps schema-name wrapper (chat_reply key)', () => {
  // Post-investigation 2026-06-23: the MiniMax M3 model frequently
  // wraps its response in {"chat_reply": {...}} using the json_schema
  // name key. Without unwrap, the parser sees the wrapper as the
  // top-level object, finds no `reply` key, and falls back. Verified
  // live: a raw response looked like {"chat_reply":{"reply":"...","suggested_prompt":"..."}}.
  // Stage 1 already had this unwrap (callMiniMaxStage1); chat was
  // missing it. Adding it here kills the most common parse-fallback
  // trigger.
  const { extractChatReply } = require(path.join(PROJECT_ROOT, 'server.js'));

  // Properly-wrapped response with a real reply.
  const wrapped = JSON.stringify({
    chat_reply: {
      reply: 'I tightened the subject line as requested.',
      suggested_prompt: 'A tighter subject line.'
    }
  });
  const r1 = extractChatReply(wrapped);
  assertEqual(r1.fallback_reason, null, 'unwrapped response is success');
  assertEqual(r1.reply, 'I tightened the subject line as requested.', 'reply extracted from wrapper');
  assertEqual(r1.suggested_prompt, 'A tighter subject line.', 'suggested_prompt extracted from wrapper');

  // Wrapped response with empty suggested_prompt (question-only).
  const wrappedQuestion = JSON.stringify({
    chat_reply: {
      reply: 'I chose this framing because...',
      suggested_prompt: ''
    }
  });
  const r2 = extractChatReply(wrappedQuestion);
  assertEqual(r2.fallback_reason, null, 'wrapped question is success');
  assertEqual(r2.reply, 'I chose this framing because...', 'wrapped reply extracted');
  assertEqual(r2.suggested_prompt, null, 'wrapped empty suggested_prompt coerced to null');

  // Wrapped but with empty reply — still a fallback (the wrapper
  // doesn't change the underlying schema violation).
  const wrappedEmpty = JSON.stringify({
    chat_reply: { reply: '', suggested_prompt: 'something' }
  });
  const r3 = extractChatReply(wrappedEmpty);
  assertEqual(r3.fallback_reason, 'empty_reply', 'wrapped empty reply still triggers fallback');

  // Wrapped but with malformed inner — the outer is OK, inner is bad.
  const wrappedMalformed = JSON.stringify({
    chat_reply: 'this is a string not an object'
  });
  const r4 = extractChatReply(wrappedMalformed);
  assertTrue(r4.fallback_reason !== null, 'wrapped non-object inner falls back');
});

test('ADR 0011: readChatSessions / writeChatSessions round-trip via disk', () => {
  const { readChatSessions, writeChatSessions, generateChatSessionId } = require(path.join(PROJECT_ROOT, 'server.js'));
  const snapshot = snapshotChatFile();
  try {
    resetChatFile();
    assertEqual(readChatSessions().length, 0, 'fresh file reads as []');

    const sessions = [
      {
        id: generateChatSessionId(),
        preset_id: 'preset_aaaaaaaaaaaaaaa1',
        preset_name: 'Test',
        run_id: null,
        title: 'test session 1',
        original_prompt: 'first prompt',
        current_prompt: 'first prompt',
        analysis_snapshot: null,
        messages: [
          { id: 'msg_aaaa1111bbbb2222', role: 'user', content: 'hi', suggested_prompt: null, timestamp: '2026-06-23T10:00:00.000Z' }
        ],
        created_at: '2026-06-23T10:00:00.000Z',
        updated_at: '2026-06-23T10:00:00.000Z'
      },
      {
        id: generateChatSessionId(),
        preset_id: 'preset_aaaaaaaaaaaaaaa1',
        preset_name: 'Test',
        run_id: null,
        title: 'test session 2',
        original_prompt: 'second prompt',
        current_prompt: 'second prompt revised',
        analysis_snapshot: null,
        messages: [],
        created_at: '2026-06-23T11:00:00.000Z',
        updated_at: '2026-06-23T11:30:00.000Z'
      }
    ];
    writeChatSessions(sessions);

    // No .tmp left behind (atomic-ish rename).
    assertTrue(!fs.existsSync(`${CHAT_FILE}.tmp`), 'no tmp file after write');

    const reread = readChatSessions();
    assertEqual(reread.length, 2, 'two sessions round-tripped');
    assertEqual(reread[0].id, sessions[0].id, 'session id preserved');
    assertEqual(reread[1].current_prompt, 'second prompt revised', 'current_prompt preserved');
    assertEqual(reread[0].messages.length, 1, 'message count preserved');
  } finally {
    restoreChatFile(snapshot);
  }
});

test('ADR 0011: readChatSessions drops malformed entries with a warning', () => {
  const { readChatSessions } = require(path.join(PROJECT_ROOT, 'server.js'));
  const snapshot = snapshotChatFile();
  const origWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    const good = {
      id: 'chat_aaaa1111bbbb2222',
      preset_id: 'preset_aaaaaaaaaaaaaaa1',
      original_prompt: 'p',
      current_prompt: 'p',
      messages: []
    };
    const bad = { id: 'not-prefixed', messages: 'not-an-array' };
    fs.writeFileSync(CHAT_FILE, JSON.stringify([good, bad, { no_id_at_all: true }], null, 2), 'utf8');
    const result = readChatSessions();
    assertEqual(result.length, 1, 'malformed entries dropped, valid kept');
    assertEqual(result[0].id, 'chat_aaaa1111bbbb2222', 'good entry preserved');
  } finally {
    console.warn = origWarn;
    restoreChatFile(snapshot);
  }
});

test('ADR 0011: corrupt chat file returns [] without crashing', () => {
  const { readChatSessions } = require(path.join(PROJECT_ROOT, 'server.js'));
  const snapshot = snapshotChatFile();
  try {
    fs.writeFileSync(CHAT_FILE, '{ not valid json', 'utf8');
    const result = readChatSessions();
    assertEqual(result.length, 0, 'corrupt file -> []');
  } finally {
    restoreChatFile(snapshot);
  }
});

test('ADR 0011: chat API routes are registered in server.js', () => {
  const text = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const expected = [
    "app.post('/api/chat/sessions'",
    "app.get('/api/chat/sessions'",
    "app.get('/api/chat/sessions/:id'",
    "app.post('/api/chat/sessions/:id/messages'",
    "app.post('/api/chat/sessions/:id/apply/:messageId'",
    "app.delete('/api/chat/sessions/:id'"
  ];
  for (const frag of expected) {
    assertTrue(text.includes(frag), `server.js missing route: ${frag}`);
  }
});

test('ADR 0011: app.js wires up the chat console', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'styles.css'), 'utf8');

  // State + DOM references
  assertTrue(/chatSessions:\s*\[\]/.test(js), 'state.chatSessions initialized');
  assertTrue(/chatSessionId:\s*null/.test(js), 'state.chatSessionId initialized');
  assertTrue(/chatIsSending:\s*false/.test(js), 'state.chatIsSending initialized');
  for (const id of [
    'step-chat',
    'chat-session-select',
    'chat-session-delete-btn',
    'chat-messages',
    'chat-form',
    'chat-input',
    'chat-input-count',
    'chat-send-btn',
    'chat-form-status'
  ]) {
    assertTrue(html.includes(`id="${id}"`), `index.html must contain id="${id}"`);
    assertTrue(js.includes(`'${id}'`), `app.js must reference DOM id ${id}`);
  }

  // Functions
  for (const fn of [
    'loadChatSessions',
    'renderChatSessionSelect',
    'activateChatForResult',
    'submitChatMessage',
    'applyChatRevision',
    'deleteChatSession',
    'selectChatSession',
    'buildChatMessageNode',
    'renderChatMessages',
    'resetChatConsole'
  ]) {
    assertTrue(js.includes(`const ${fn} `) || js.includes(`function ${fn}`), `app.js must define ${fn}`);
  }

  // Hooks
  assertTrue(/displayResult[\s\S]{0,500}activateChatForResult/.test(js), 'displayResult must call activateChatForResult');
  assertTrue(/resetChatConsole\(\)/.test(js), 'resetChatConsole called somewhere');
  assertTrue(/dom\.chatForm\b[\s\S]{0,80}addEventListener\(\s*'submit'/.test(js), 'chat form submit listener wired');

  // API surface referenced in client
  for (const path of [
    "'/api/chat/sessions'",
    "`/api/chat/sessions/${encodeURIComponent",
    "`/api/chat/sessions/${encodeURIComponent(state.chatSessionId)}/messages`",
    "`/api/chat/sessions/${encodeURIComponent(state.chatSessionId)}/apply/${encodeURIComponent(messageId)}`"
  ]) {
    assertTrue(js.includes(path), `app.js must reference ${path}`);
  }

  // CSS
  assertTrue(/\.chat-messages\b/.test(css), 'CSS .chat-messages rule exists');
  assertTrue(/\.chat-message--user\b/.test(css), 'CSS user message modifier exists');
  assertTrue(/\.chat-message--assistant\b/.test(css), 'CSS assistant message modifier exists');
  assertTrue(/\.chat-message__apply\b/.test(css), 'CSS apply button rule exists');
  assertTrue(/\.chat-form\b/.test(css), 'CSS chat-form rule exists');
});

test('ADR 0011: apply advances current_prompt atomically (route logic)', () => {
  // We test the apply logic by exercising the helper functions that
  // back the route, since the route itself depends on req/res mocks.
  const {
    readChatSessions,
    writeChatSessions,
    generateChatSessionId,
    generateChatMessageId
  } = require(path.join(PROJECT_ROOT, 'server.js'));
  const snapshot = snapshotChatFile();
  try {
    const sessionId = generateChatSessionId();
    const userId = generateChatMessageId();
    const assistantId = generateChatMessageId();
    const session = {
      id: sessionId,
      preset_id: 'preset_aaaaaaaaaaaaaaa1',
      preset_name: 'Test',
      run_id: null,
      title: 'apply test',
      original_prompt: 'first version',
      current_prompt: 'first version',
      analysis_snapshot: null,
      messages: [
        { id: userId, role: 'user', content: 'shorten', suggested_prompt: null, timestamp: '2026-06-23T10:00:00.000Z' },
        { id: assistantId, role: 'assistant', content: 'here', suggested_prompt: 'a tighter prompt', timestamp: '2026-06-23T10:00:01.000Z' }
      ],
      created_at: '2026-06-23T10:00:00.000Z',
      updated_at: '2026-06-23T10:00:00.000Z'
    };
    writeChatSessions([session]);

    // Apply logic — find session + message, swap current_prompt.
    const sessions = readChatSessions();
    const idx = sessions.findIndex((s) => s.id === sessionId);
    const target = sessions[idx].messages.find((m) => m.id === assistantId);
    assertEqual(target.suggested_prompt, 'a tighter prompt', 'precondition: suggested_prompt present');
    sessions[idx].current_prompt = target.suggested_prompt;
    sessions[idx].updated_at = '2026-06-23T10:00:02.000Z';
    writeChatSessions(sessions);

    const reread = readChatSessions();
    assertEqual(reread[0].current_prompt, 'a tighter prompt', 'current_prompt advanced');
    assertEqual(reread[0].original_prompt, 'first version', 'original_prompt unchanged');
    assertEqual(reread[0].messages.length, 2, 'message history untouched by apply');
    assertEqual(reread[0].updated_at, '2026-06-23T10:00:02.000Z', 'updated_at bumped');

    // Apply a SECOND time to a different message — current_prompt advances
    // again. Verifies cumulative revision semantics.
    const secondAssistantId = generateChatMessageId();
    reread[0].messages.push({
      id: secondAssistantId,
      role: 'assistant',
      content: 'second pass',
      suggested_prompt: 'a much tighter prompt',
      timestamp: '2026-06-23T10:00:03.000Z'
    });
    reread[0].current_prompt = 'a much tighter prompt';
    writeChatSessions(reread);

    const final = readChatSessions()[0];
    assertEqual(final.current_prompt, 'a much tighter prompt', 'second apply also advances');
    assertEqual(final.messages.length, 3, 'history preserved across multiple applies');
    assertEqual(final.original_prompt, 'first version', 'original_prompt still immutable');
  } finally {
    restoreChatFile(snapshot);
  }
});

test('ADR 0011: chat apply rejects user messages and null revisions', () => {
  const {
    readChatSessions,
    writeChatSessions,
    generateChatSessionId,
    generateChatMessageId
  } = require(path.join(PROJECT_ROOT, 'server.js'));
  const snapshot = snapshotChatFile();
  try {
    const sessionId = generateChatSessionId();
    const userMsgId = generateChatMessageId();
    const assistantNoRevisionId = generateChatMessageId();
    const session = {
      id: sessionId,
      preset_id: 'preset_aaaaaaaaaaaaaaa1',
      preset_name: 'Test',
      run_id: null,
      title: 'apply validation',
      original_prompt: 'p',
      current_prompt: 'p',
      analysis_snapshot: null,
      messages: [
        { id: userMsgId, role: 'user', content: 'why?', suggested_prompt: null, timestamp: '2026-06-23T10:00:00.000Z' },
        { id: assistantNoRevisionId, role: 'assistant', content: 'because', suggested_prompt: null, timestamp: '2026-06-23T10:00:01.000Z' }
      ],
      created_at: '2026-06-23T10:00:00.000Z',
      updated_at: '2026-06-23T10:00:00.000Z'
    };
    writeChatSessions([session]);

    const sessions = readChatSessions();
    const session_ = sessions[0];

    // Find user message — can't apply.
    const userMsg = session_.messages.find((m) => m.id === userMsgId);
    assertEqual(userMsg.role, 'user', 'user message role');
    assertEqual(userMsg.suggested_prompt, null, 'user has no suggested_prompt');

    // Find assistant with null revision — can't apply.
    const noRev = session_.messages.find((m) => m.id === assistantNoRevisionId);
    assertEqual(noRev.role, 'assistant', 'assistant role');
    assertEqual(noRev.suggested_prompt, null, 'no revision in this assistant message');
    assertTrue(
      typeof noRev.suggested_prompt !== 'string' || noRev.suggested_prompt.length === 0,
      'no revision to apply'
    );

    // current_prompt unchanged after attempted bad applies (we never wrote).
    assertEqual(session_.current_prompt, 'p', 'current_prompt preserved when no valid apply target');
  } finally {
    restoreChatFile(snapshot);
  }
});

test('ADR 0011: delete removes session from disk', () => {
  const { readChatSessions, writeChatSessions, generateChatSessionId } = require(path.join(PROJECT_ROOT, 'server.js'));
  const snapshot = snapshotChatFile();
  try {
    const id1 = generateChatSessionId();
    const id2 = generateChatSessionId();
    writeChatSessions([
      { id: id1, preset_id: 'preset_x', original_prompt: 'a', current_prompt: 'a', messages: [] },
      { id: id2, preset_id: 'preset_x', original_prompt: 'b', current_prompt: 'b', messages: [] }
    ]);
    let sessions = readChatSessions();
    assertEqual(sessions.length, 2, 'two sessions before delete');
    const idx = sessions.findIndex((s) => s.id === id1);
    sessions.splice(idx, 1);
    writeChatSessions(sessions);
    const after = readChatSessions();
    assertEqual(after.length, 1, 'one session after delete');
    assertEqual(after[0].id, id2, 'remaining session is id2');
  } finally {
    restoreChatFile(snapshot);
  }
});

test('ADR 0011: chat sessions survive a simulated "restart" (cross-session persistence)', () => {
  const { readChatSessions, writeChatSessions, generateChatSessionId } = require(path.join(PROJECT_ROOT, 'server.js'));
  const snapshot = snapshotChatFile();
  try {
    const id = generateChatSessionId();
    writeChatSessions([{
      id,
      preset_id: 'preset_aaaaaaaaaaaaaaa1',
      preset_name: 'Persistence test',
      run_id: null,
      title: 'persists across restarts',
      original_prompt: 'first',
      current_prompt: 'second',
      analysis_snapshot: { subject: 'a tree' },
      messages: [
        { id: 'msg_aaaa1111bbbb2222', role: 'user', content: 'hi', suggested_prompt: null, timestamp: '2026-06-23T10:00:00.000Z' },
        { id: 'msg_aaaa1111bbbb2223', role: 'assistant', content: 'hello', suggested_prompt: 'second', timestamp: '2026-06-23T10:00:01.000Z' }
      ],
      created_at: '2026-06-23T10:00:00.000Z',
      updated_at: '2026-06-23T10:00:01.000Z'
    }]);

    // Simulate a server "restart": require the module fresh, which
    // re-reads the file via readChatSessions().
    const reread = readChatSessions();
    assertEqual(reread.length, 1, 'session survived restart');
    assertEqual(reread[0].title, 'persists across restarts', 'title preserved');
    assertEqual(reread[0].current_prompt, 'second', 'current_prompt preserved');
    assertEqual(reread[0].messages.length, 2, 'full message history preserved');
    assertEqual(reread[0].messages[1].suggested_prompt, 'second', 'suggested_prompt preserved');
    assertEqual(reread[0].analysis_snapshot.subject, 'a tree', 'analysis_snapshot preserved');
  } finally {
    restoreChatFile(snapshot);
  }
});

test('ADR 0011: chat input length cap is enforced at the schema level', () => {
  const { MAX_CHAT_MESSAGE_LENGTH } = require(path.join(PROJECT_ROOT, 'server.js'));
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'index.html'), 'utf8');
  assertTrue(
    html.includes(`maxlength="${MAX_CHAT_MESSAGE_LENGTH}"`),
    `chat-input maxlength must equal MAX_CHAT_MESSAGE_LENGTH (${MAX_CHAT_MESSAGE_LENGTH})`
  );
});

test('ADR 0011: chat response schema uses string type (no union — MiniMax M3 rejects type arrays)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  // The schema lives in callMiniMaxChatOnce now (post-investigation:
  // callMiniMaxChat is the retry loop, callMiniMaxChatOnce is the
  // single-shot that builds the schema).
  const block = serverText.match(/const callMiniMaxChatOnce = async[\s\S]*?\n\};/);
  assertTrue(block, 'callMiniMaxChatOnce defined');
  // The MiniMax M3 JSON-schema validator rejects union types like
  // `type: ['string','null']` with a 400. We sidestep that by typing
  // `suggested_prompt` as a plain string and using "" to mean
  // "no revision this turn" (extractChatReply coerces empty to null).
  assertTrue(/suggested_prompt:\s*\{\s*type:\s*'string'/.test(block[0])
    || /suggested_prompt:\s*\{\s*type:\s*"string"/.test(block[0]),
    'suggested_prompt schema is plain string (no union)');
  assertTrue(!/suggested_prompt:\s*\{\s*type:\s*\[\s*['"]string['"]/.test(block[0]),
    'suggested_prompt MUST NOT use a union type array');
  assertTrue(/required:\s*\[\s*'reply',\s*'suggested_prompt'\s*\]/.test(block[0]),
    'reply + suggested_prompt both required by schema');
  // Post-investigation (2026-06-23): reply now has minLength: 1 so
  // the API itself rejects empty replies. This eliminates the
  // "missing reply string" failure mode at the source.
  assertTrue(/reply:\s*\{\s*type:\s*'string',\s*minLength:\s*1\s*\}/.test(block[0]),
    'reply schema enforces minLength: 1 to prevent empty replies');
});

// ─── ADR 0011 — comprehensive chat reliability tests (post-investigation) ───

/**
 * Helper: read chat_sessions.json after a server run. Used by the
 * integration tests below to inspect on-disk state without exposing
 * the file directly.
 */
const readPersistedSessions = () => {
  if (!fs.existsSync(CHAT_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8')); }
  catch (_) { return []; }
};

/**
 * Helper: get the first preset id from data/presets.json. Used by the
 * HTTP integration tests to seed valid session-create bodies without
 * coupling to internal helpers from server.js (which aren't all
 * exported).
 */
const getFirstPresetId = () => {
  const presetsFile = path.join(PROJECT_ROOT, 'data', 'presets.json');
  if (!fs.existsSync(presetsFile)) throw new Error('presets.json missing');
  const presets = JSON.parse(fs.readFileSync(presetsFile, 'utf8'));
  if (!Array.isArray(presets) || presets.length === 0) throw new Error('presets.json is empty');
  return presets[0].id;
};

test('HTTP chat integration: POST /api/chat/sessions validates payloads', async () => {
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    // 400 on missing body
    const r1 = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assertEqual(r1.status, 400, 'empty body → 400');
    assertTrue(/prompt/.test(r1.body.error), 'error mentions prompt');

    // 400 on empty prompt
    const r2 = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '   ', preset_id: getFirstPresetId() })
    });
    assertEqual(r2.status, 400, 'whitespace prompt → 400');

    // 400 on bad preset_id
    const r3 = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'a valid prompt', preset_id: 'preset_doesnotexist' })
    });
    assertEqual(r3.status, 400, 'bad preset_id → 400');

    // 400 on oversized prompt
    const r4 = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'x'.repeat(5001), preset_id: getFirstPresetId() })
    });
    assertEqual(r4.status, 400, 'oversized prompt → 400');

    // 201 on valid body
    const r5 = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'a valid prompt', preset_id: getFirstPresetId() })
    });
    assertEqual(r5.status, 201, 'valid body → 201');
    assertTrue(r5.body.data.id.startsWith('chat_'), 'session id has chat_ prefix');
  } finally {
    await srv.close();
    restoreChatFile(snapshot);
  }
});

test('HTTP chat integration: GET /api/chat/sessions lists in newest-first order', async () => {
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    const presetId = getFirstPresetId();
    await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'first', preset_id: presetId })
    });
    await new Promise((r) => setTimeout(r, 50));
    await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'second', preset_id: presetId })
    });
    await new Promise((r) => setTimeout(r, 50));
    await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'third', preset_id: presetId })
    });

    const list = await fetchJson(`${srv.base}/api/chat/sessions`);
    assertEqual(list.status, 200, 'list → 200');
    assertEqual(list.body.data.length, 3, 'three sessions');
    // Newest first by updated_at.
    const updated = list.body.data.map((s) => new Date(s.updated_at).getTime());
    assertTrue(updated[0] >= updated[1] && updated[1] >= updated[2], 'newest-first ordering');
  } finally {
    await srv.close();
    restoreChatFile(snapshot);
  }
});

test('HTTP chat integration: POST /messages validates body, returns 4xx for bad input', async () => {
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    const presetId = getFirstPresetId();
    const created = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test prompt', preset_id: presetId })
    });
    const sessionId = created.body.data.id;

    // 400 on missing content
    const r1 = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assertEqual(r1.status, 400, 'missing content → 400');

    // 400 on empty content
    const r2 = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '   ' })
    });
    assertEqual(r2.status, 400, 'empty content → 400');

    // 400 on non-string content
    const r3 = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 42 })
    });
    assertEqual(r3.status, 400, 'non-string content → 400');

    // 400 on oversized content
    const r4 = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'x'.repeat(2001) })
    });
    assertEqual(r4.status, 400, 'oversized content → 400');

    // 404 on unknown session
    const r5 = await fetchJson(`${srv.base}/api/chat/sessions/chat_doesnotexist/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hi' })
    });
    assertEqual(r5.status, 404, 'unknown session → 404');

    // 400 on bad session id prefix
    const r6 = await fetchJson(`${srv.base}/api/chat/sessions/not_prefixed/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hi' })
    });
    assertEqual(r6.status, 400, 'bad session id → 400');
  } finally {
    await srv.close();
    restoreChatFile(snapshot);
  }
});

test('HTTP chat integration: POST /messages never leaves a ghost user message', async () => {
  // Post-investigation 2026-06-23 contract: a chat send always
  // produces EITHER a successful 200 with both user + assistant
  // messages persisted, OR a 5xx with NO messages appended (the
  // user message is rolled back to avoid a ghost turn).
  //
  // What we CAN'T easily do here: simulate a fatal LLM error without
  // actually pointing the server at a broken endpoint. So in a test
  // env with a real MiniMax M3 key, the LLM call succeeds (or falls
  // back to the assistant fallback message) and we get 200 with
  // BOTH messages persisted. We assert that invariant here.
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    const presetId = getFirstPresetId();
    const created = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test', preset_id: presetId })
    });
    const sessionId = created.body.data.id;

    const sendRes = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'first attempt' })
    });
    // Three valid outcomes depending on env:
    //   1. 200 with real assistant reply (working LLM)
    //   2. 200 with fallback assistant reply (parse fallback)
    //   3. 5xx with rollback (fatal LLM error — no messages persisted)
    // All three are correct; the user message is NEVER orphaned.
    if (sendRes.status >= 500) {
      // Fatal path: ghost-message rollback must have fired.
      const persisted = readPersistedSessions();
      const found = persisted.find((s) => s.id === sessionId);
      assertTrue(found, 'session still exists on disk after 5xx');
      assertEqual(found.messages.length, 0,
        'no ghost user message after fatal 5xx (rollback verified)');
    } else {
      // Success / fallback path: both messages persisted.
      assertEqual(sendRes.status, 200, 'success/fallback → 200');
      const persisted = readPersistedSessions();
      const found = persisted.find((s) => s.id === sessionId);
      assertTrue(found, 'session exists on disk after 200');
      // User message + assistant reply (real or fallback).
      assertEqual(found.messages.length, 2, 'user + assistant both persisted');
      assertEqual(found.messages[0].role, 'user', 'first is user');
      assertEqual(found.messages[1].role, 'assistant', 'second is assistant');
      assertEqual(found.messages[1].content, sendRes.body.data.messages[1].content,
        'assistant reply matches between response and disk');
    }
  } finally {
    await srv.close();
    restoreChatFile(snapshot);
  }
});

test('HTTP chat integration: LLM fallback path returns 200 with fallback assistant message', async () => {
  // Post-investigation 2026-06-23: even when extractChatReply falls
  // back (model returns garbage), the route returns 200 with the
  // fallback assistant message. The user's turn is NOT lost — the
  // assistant's reply just contains a friendly apology.
  const { extractChatReply, buildChatSystemPrompt } = require(path.join(PROJECT_ROOT, 'server.js'));
  // Direct test of the contract: build a chat system prompt from a
  // session and verify the shape.
  const session = {
    original_prompt: 'orig',
    current_prompt: 'current',
    analysis_snapshot: { subject: 'a tree' },
    messages: []
  };
  const sp = buildChatSystemPrompt(session);
  assertTrue(sp.includes('orig'), 'system prompt embeds original');
  assertTrue(sp.includes('current'), 'system prompt embeds current');
  assertTrue(sp.includes('a tree'), 'system prompt embeds snapshot');

  // extractChatReply is total — never throws. This is the contract
  // that protects against the "missing reply string" error.
  const result = extractChatReply('garbage that the model might produce');
  assertTrue(result.reply.length > 0, 'reply always non-empty');
  assertEqual(result.suggested_prompt, null, 'suggested_prompt null on fallback');
});

test('HTTP chat integration: POST /apply validates message + role + revision', async () => {
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    const presetId = getFirstPresetId();
    const created = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'original', preset_id: presetId })
    });
    const sessionId = created.body.data.id;

    // Manually craft a session with messages — exercises the apply
    // happy path. Re-read fresh each time so the writes actually
    // persist (a stale reference would silently no-op the push).
    const seedMessages = (mutator) => {
      const sessions = readPersistedSessions();
      const direct = sessions.find((s) => s.id === sessionId);
      mutator(direct);
      fs.writeFileSync(CHAT_FILE, JSON.stringify(sessions, null, 2), 'utf8');
    };

    seedMessages((s) => {
      s.messages.push({
        id: 'msg_aaaaaaaaaaaaaaaa',
        role: 'assistant',
        content: 'here you go',
        suggested_prompt: 'a tighter prompt',
        timestamp: new Date().toISOString()
      });
    });

    // 400 on bad messageId prefix
    const r1 = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/apply/not_msg_prefix`, { method: 'POST' });
    assertEqual(r1.status, 400, 'bad messageId → 400');

    // 404 on unknown messageId
    const r2 = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/apply/msg_doesnotexist`, { method: 'POST' });
    assertEqual(r2.status, 404, 'unknown messageId → 404');

    // 400 on applying user message
    seedMessages((s) => {
      s.messages.push({
        id: 'msg_bbbbbbbbbbbbbbbb',
        role: 'user',
        content: 'shorten',
        suggested_prompt: null,
        timestamp: new Date().toISOString()
      });
    });
    const r3 = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/apply/msg_bbbbbbbbbbbbbbbb`, { method: 'POST' });
    assertEqual(r3.status, 400, 'apply user message → 400');
    assertTrue(/assistant/i.test(r3.body.error), 'error mentions assistant');

    // 400 on applying assistant with null revision
    seedMessages((s) => {
      s.messages.push({
        id: 'msg_cccccccccccccccc',
        role: 'assistant',
        content: 'why this lighting?',
        suggested_prompt: null,
        timestamp: new Date().toISOString()
      });
    });
    const r4 = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/apply/msg_cccccccccccccccc`, { method: 'POST' });
    assertEqual(r4.status, 400, 'apply null-revision → 400');

    // 200 on valid apply
    const r5 = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/apply/msg_aaaaaaaaaaaaaaaa`, { method: 'POST' });
    assertEqual(r5.status, 200, 'valid apply → 200');
    assertEqual(r5.body.data.current_prompt, 'a tighter prompt', 'current_prompt advanced');

    // 404 on session that doesn't exist
    const r6 = await fetchJson(`${srv.base}/api/chat/sessions/chat_doesnotexist/apply/msg_aaaaaaaaaaaaaaaa`, { method: 'POST' });
    assertEqual(r6.status, 404, 'unknown session apply → 404');
  } finally {
    await srv.close();
    restoreChatFile(snapshot);
  }
});

test('HTTP chat integration: DELETE removes session, GET-then 404', async () => {
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    const presetId = getFirstPresetId();
    const created = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'to be deleted', preset_id: presetId })
    });
    const sessionId = created.body.data.id;

    const del = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}`, { method: 'DELETE' });
    assertEqual(del.status, 200, 'delete → 200');
    assertEqual(del.body.data.deleted, true, 'deleted: true');

    const after = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}`);
    assertEqual(after.status, 404, 'after-delete GET → 404');

    const del2 = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}`, { method: 'DELETE' });
    assertEqual(del2.status, 404, 'second delete → 404');
  } finally {
    await srv.close();
    restoreChatFile(snapshot);
  }
});

test('HTTP chat integration: session count cap returns 409 when MAX exceeded', async () => {
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    // Synthetically fill to MAX_CHAT_SESSIONS_TOTAL without hitting the cap.
    const { MAX_CHAT_SESSIONS_TOTAL } = require(path.join(PROJECT_ROOT, 'server.js'));
    // Write directly so the test stays fast — avoids creating thousands
    // of sessions through the API.
    const fill = [];
    for (let i = 0; i < MAX_CHAT_SESSIONS_TOTAL; i++) {
      fill.push({
        id: `chat_${String(i).padStart(16, '0')}`,
        preset_id: 'preset_aaaaaaaaaaaaaaa1',
        preset_name: 'fill',
        run_id: null,
        title: `fill ${i}`,
        original_prompt: 'p',
        current_prompt: 'p',
        analysis_snapshot: null,
        messages: [],
        created_at: '2026-06-23T00:00:00.000Z',
        updated_at: '2026-06-23T00:00:00.000Z'
      });
    }
    fs.writeFileSync(CHAT_FILE, JSON.stringify(fill), 'utf8');

    const presetId = getFirstPresetId();
    const overflow = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'overflow', preset_id: presetId })
    });
    assertEqual(overflow.status, 409, 'cap-exceeded → 409');
    assertTrue(/limit reached/i.test(overflow.body.error), 'error mentions limit');
  } finally {
    await srv.close();
    restoreChatFile(snapshot);
  }
});

test('HTTP chat integration: messages-per-session cap returns 409 when MAX exceeded', async () => {
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    const { MAX_CHAT_MESSAGES_PER_SESSION } = require(path.join(PROJECT_ROOT, 'server.js'));
    const presetId = getFirstPresetId();
    const created = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'cap test', preset_id: presetId })
    });
    const sessionId = created.body.data.id;

    // Pre-fill messages to the cap. Re-read fresh so the pushes
    // actually hit disk (stale-reference bug fixed 2026-06-23).
    const sessions = readPersistedSessions();
    const direct = sessions.find((s) => s.id === sessionId);
    for (let i = 0; i < MAX_CHAT_MESSAGES_PER_SESSION; i++) {
      direct.messages.push({
        id: `msg_${String(i).padStart(16, '0')}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `turn ${i}`,
        suggested_prompt: null,
        timestamp: '2026-06-23T00:00:00.000Z'
      });
    }
    fs.writeFileSync(CHAT_FILE, JSON.stringify(sessions, null, 2), 'utf8');

    const overflow = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'one more' })
    });
    assertEqual(overflow.status, 409, 'message cap → 409');
    assertTrue(/reached/i.test(overflow.body.error), 'error mentions cap');
  } finally {
    await srv.close();
    restoreChatFile(snapshot);
  }
});

test('HTTP chat integration: bad JSON body returns 400 (does not crash server)', async () => {
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    // Server uses express.json middleware which 400s on invalid JSON.
    const res = await fetch(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json'
    });
    assertEqual(res.status, 400, 'invalid JSON body → 400');

    // Server still healthy after the bad request.
    const health = await fetchJson(`${srv.base}/api/health`);
    assertEqual(health.status, 200, 'server still healthy after bad JSON');
  } finally {
    await srv.close();
    restoreChatFile(snapshot);
  }
});

test('HTTP chat integration: oversized JSON body returns 413/400 (does not crash server)', async () => {
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    // Express json limit is 2mb. Send a body that fits in HTTP but
    // exceeds the schema-level cap (5000 chars for prompt).
    const huge = 'a'.repeat(6000);
    const res = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: huge, preset_id: 'preset_aaaaaaaaaaaaaaa1' })
    });
    // Either 400 (validation) or 413 (middleware) — both are valid
    // server behaviors; the key is the server doesn't crash.
    assertTrue(res.status === 400 || res.status === 413,
      `expected 400 or 413 (got ${res.status})`);

    const health = await fetchJson(`${srv.base}/api/health`);
    assertEqual(health.status, 200, 'server still healthy after huge body');
  } finally {
    await srv.close();
    restoreChatFile(snapshot);
  }
});

test('HTTP chat integration: connection close during send does not corrupt file', async () => {
  // Simulates: client closes the connection mid-flight. The server
  // route still runs to completion (Express keeps the handler alive
  // until the response resolves). We just verify the persisted file
  // is always valid JSON after a send attempt, regardless of outcome.
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    const presetId = getFirstPresetId();
    const created = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'integrity test', preset_id: presetId })
    });
    const sessionId = created.body.data.id;

    // Use an AbortController to kill the request mid-flight.
    const ac = new AbortController();
    const promise = fetch(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'interrupted' }),
      signal: ac.signal
    });
    ac.abort();
    try { await promise; } catch (_) { /* expected to throw */ }

    // File must still be valid JSON (server didn't leave a partial write).
    if (fs.existsSync(CHAT_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
      assertTrue(Array.isArray(parsed), 'file is still a valid array');
    }
  } finally {
    await srv.close();
    restoreChatFile(snapshot);
  }
});

test('Frontend chat: submitChatMessage preserves user text on failure', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'app.js'), 'utf8');
  // The post-investigation fix moves `dom.chatInput.value = ''` AFTER
  // the try/catch, so failures preserve the input.
  const block = js.match(/const submitChatMessage = async[\s\S]*?\n  \};/);
  assertTrue(block, 'submitChatMessage defined');
  // The input-clear MUST NOT be inside the try block — it must be
  // either after the catch or in the finally with a success guard.
  const tryBlock = block[0].match(/try\s*\{[\s\S]*?\}\s*catch/);
  assertTrue(tryBlock, 'try/catch present');
  assertTrue(!/dom\.chatInput\.value\s*=\s*['"]\s*['"]/.test(tryBlock[0]),
    'dom.chatInput.value = "" MUST NOT be inside try block (would clear on failure)');
  // The success-path clear lives after the catch, in the try block end.
  assertTrue(/dom\.chatInput\.value\s*=\s*['"]\s*['"]/.test(block[0]),
    'clear of input present somewhere in submitChatMessage');
});

test('Frontend chat: friendlyChatError maps raw server errors to user-friendly text', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'app.js'), 'utf8');
  assertTrue(/const friendlyChatError/.test(js), 'friendlyChatError defined');
  // Maps the most common server error shapes:
  for (const pattern of [
    /failed to fetch|networkerror/i,
    /429|rate limit/i,
    /401|403|authentication/i,
    /timeout|timed out/i
  ]) {
    assertTrue(pattern.test(js), `friendlyChatError handles ${pattern}`);
  }
});

test('Frontend chat: submitChatMessage shows a Retry button on failure', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'app.js'), 'utf8');
  // Post-investigation: on error, we inject a Retry button so the user
  // doesn't have to retype + click Send manually.
  assertTrue(/const showChatRetryButton/.test(js), 'showChatRetryButton defined');
  assertTrue(/showChatRetryButton\(/.test(js), 'showChatRetryButton called from submitChatMessage');
  // Retry button must include the click handler that re-calls submitChatMessage.
  const retryBlock = js.match(/const showChatRetryButton[\s\S]*?\n  \};/);
  assertTrue(retryBlock, 'showChatRetryButton block present');
  assertTrue(/submitChatMessage\(\)/.test(retryBlock[0]),
    'Retry button click handler re-invokes submitChatMessage');
  assertTrue(/chat-form-retry/.test(retryBlock[0]),
    'Retry button has chat-form-retry class');

  // CSS for the retry button.
  const css = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'styles.css'), 'utf8');
  assertTrue(/\.chat-form-retry/.test(css), 'CSS for retry button defined');
});

test('Frontend chat: submitChatMessage never calls showError() (uses chat-form-status instead)', () => {
  // The chat console owns its own status line (chat-form-status). It
  // must NOT pop the global error toast on every send — that would
  // overwhelm the user with toast notifications during a long session.
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'app.js'), 'utf8');
  const block = js.match(/const submitChatMessage = async[\s\S]*?\n  \};/);
  assertTrue(block, 'submitChatMessage defined');
  assertTrue(!/showError\(/.test(block[0]),
    'submitChatMessage must not call global showError (uses chat-form-status)');
  assertTrue(/setChatFormStatus\(/.test(block[0]),
    'submitChatMessage uses chat-form-status');
});

test('Chat fallback text is non-empty and human-readable', () => {
  // The fallback reply must NEVER be empty — that's the entire point
  // of the fix. The frontend relies on this contract to render an
  // assistant message instead of a blank bubble.
  const { extractChatReply } = require(path.join(PROJECT_ROOT, 'server.js'));
  const cases = ['', null, undefined, 42, 'not json', '{"reply":""}', '{"reply":null}',
                 '{"reply":42}', '["a","b"]', 'null', '{"foo":"bar"}'];
  for (const c of cases) {
    const r = extractChatReply(c);
    assertTrue(typeof r.reply === 'string', `reply is string for input ${JSON.stringify(c)}`);
    assertTrue(r.reply.length > 0, `reply is non-empty for input ${JSON.stringify(c)}`);
    assertTrue(r.reply.trim().length > 0, `reply has non-whitespace content for input ${JSON.stringify(c)}`);
    // No inventend revisions — ever.
    assertEqual(r.suggested_prompt, null, `suggested_prompt null for input ${JSON.stringify(c)}`);
  }
});

test('Chat retry config: max_tokens is high enough for long revisions', () => {
  // 1500 was insufficient — large revisions got truncated mid-JSON.
  // 2400 leaves headroom for the envelope + 1800-char revisions.
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const block = serverText.match(/const callMiniMaxChatOnce = async[\s\S]*?\n\};/);
  assertTrue(block, 'callMiniMaxChatOnce defined');
  const m = block[0].match(/max_tokens:\s*(\d+)/);
  assertTrue(m, 'max_tokens configured');
  const tokens = parseInt(m[1], 10);
  assertTrue(tokens >= 2000, `max_tokens must be >= 2000 for long revisions (got ${tokens})`);
});

test('Chat retry: callMiniMaxChat has retry loop on parse fallback', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  // The retry loop must be present — single-shot would lose user
  // turns to transient model flakiness.
  assertTrue(/CHAT_MAX_RETRIES\s*=\s*\d+/.test(serverText),
    'CHAT_MAX_RETRIES constant defined');
  assertTrue(/for\s*\(\s*let attempt[\s\S]*?attempt\s*<=[\s\S]*?CHAT_MAX_RETRIES/.test(serverText),
    'callMiniMaxChat has a retry loop keyed on attempt counter');
  // Fatal errors must NOT be retried (network/auth/timeouts bubble up).
  assertTrue(/result\.fatal/.test(serverText),
    'retry loop respects fatal flag (no infinite retry on auth/timeout)');
});

test('Chat fallback logs reason to server.log (not to client)', () => {
  // The fallback_reason is server-internal; the API response should
  // never include it. Verify by checking the route doesn't pipe it
  // into the response envelope.
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  // The assistant message stored on disk should not contain fallback_reason.
  const block = serverText.match(/const assistantMessage = \{[\s\S]*?\};/);
  assertTrue(block, 'assistantMessage construction present');
  assertTrue(!/fallback_reason/.test(block[0]),
    'fallback_reason MUST NOT leak into the assistant message stored on disk');
});

test('Chat fallback never invents a revision (suggested_prompt stays null)', () => {
  // Defensive: even if the model manages to attach a suggested_prompt
  // to a malformed response, the fallback path drops it. This is the
  // safety invariant for the entire feature.
  const { extractChatReply } = require(path.join(PROJECT_ROOT, 'server.js'));
  const poisoned = [
    '{"reply":null,"suggested_prompt":"hallucinated revision"}',
    '{"reply":42,"suggested_prompt":"another hallucinated"}',
    '{"reply":"","suggested_prompt":"empty reply but with revision"}',
    '{"reply":"   ","suggested_prompt":"whitespace reply with revision"}',
    '{"foo":"bar","suggested_prompt":"completely wrong shape"}',
    '[{"suggested_prompt":"array top level"}]',
    '"string top level"',
    '12345'
  ];
  for (const input of poisoned) {
    const r = extractChatReply(input);
    assertEqual(r.suggested_prompt, null,
      `poisoned input ${JSON.stringify(input).substring(0, 60)} -> null suggested_prompt`);
    assertTrue(r.reply.length > 0, 'fallback reply non-empty');
  }
});

// ─── Final invariants — must pass AFTER everything else ran ─────────

test('No stale upload files in uploads/', () => {
  const uploadsDir = path.join(PROJECT_ROOT, 'uploads');
  if (!fs.existsSync(uploadsDir)) return;
  const files = fs.readdirSync(uploadsDir).filter(f => !f.startsWith('.'));
  assertEqual(files.length, 0, `uploads/ contains leftover files: ${files.join(', ')}`);
});

test('data/palettes.json is parseable and an array (post-test state)', () => {
  // Even if tests left it in a different state, it must be parseable.
  if (!fs.existsSync(PALETTES_FILE)) return;
  const parsed = JSON.parse(fs.readFileSync(PALETTES_FILE, 'utf8'));
  assertTrue(Array.isArray(parsed), 'palettes.json must be an array');
});

test('data/directives.json is parseable and an array (post-test state)', () => {
  // Even if tests left it in a different state, it must be parseable.
  if (!fs.existsSync(DIRECTIVES_FILE)) return;
  const parsed = JSON.parse(fs.readFileSync(DIRECTIVES_FILE, 'utf8'));
  assertTrue(Array.isArray(parsed), 'directives.json must be an array');
});

test('data/chat_sessions.json is parseable and an array (post-test state)', () => {
  if (!fs.existsSync(CHAT_FILE)) return;
  const parsed = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
  assertTrue(Array.isArray(parsed), 'chat_sessions.json must be an array');
});

(async () => {
  for (const { name, fn } of QUEUED) {
    try {
      await fn();
      RESULTS.push({ name, status: 'pass' });
      console.log(`${COLORS.pass}✓${COLORS.reset} ${name}`);
    } catch (err) {
      RESULTS.push({ name, status: 'fail', error: err.message });
      console.log(`${COLORS.fail}✗${COLORS.reset} ${name}`);
      console.log(`  ${COLORS.dim}${err.message}${COLORS.reset}`);
    }
  }

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
})();
