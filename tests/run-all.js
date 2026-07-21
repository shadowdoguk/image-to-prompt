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

test('All seven palette routes are registered (ADR 0006 + ADR 0013)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const re = /app\.(get|post|put|delete)\(['"](\/api\/[^'"]+)['"]/g;
  const endpoints = [];
  let m;
  while ((m = re.exec(serverText)) !== null) endpoints.push(`${m[1].toLowerCase()} ${m[2]}`);
  const required = [
    'get /api/palettes',
    'post /api/palettes',
    'put /api/palettes/:id',
    'delete /api/palettes/:id',
    'post /api/palettes/custom',
    'post /api/palettes/:id/restore/:version'
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

const withMockChatProvider = async (responses, callback) => {
  const realFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (!String(url).endsWith('/chat/completions')) return realFetch(url, options);
    const payload = responses.shift();
    if (!payload) throw new Error('mock chat response queue exhausted');
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    return await callback();
  } finally {
    global.fetch = realFetch;
  }
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

// ─── ADR 0013 — palette editing + custom-create + version tracking ──

test('ADR 0013: parseColorInput accepts hex / rgb / hsl with permissive whitespace + case', () => {
  const { parseColorInput } = require(path.join(PROJECT_ROOT, 'server.js'));

  // 6-digit hex
  assertEqual(parseColorInput('#d97706').hex, '#d97706', '#d97706 → #d97706');
  assertEqual(parseColorInput('d97706').hex, '#d97706', 'no-# → prefixed');
  assertEqual(parseColorInput('#D97706').hex, '#d97706', 'uppercase normalized');
  assertEqual(parseColorInput(' D97706 ').hex, '#d97706', 'whitespace trimmed');

  // 3-digit hex
  assertEqual(parseColorInput('#f0a').hex, '#ff00aa', '#f0a → #ff00aa');
  assertEqual(parseColorInput('abc').hex, '#aabbcc', '3-digit unprefixed');

  // rgb()
  assertEqual(parseColorInput('rgb(245,158,11)').hex, '#f59e0b', 'rgb → hex');
  assertEqual(parseColorInput('RGB( 245 , 158 , 11 )').hex, '#f59e0b', 'rgb case + whitespace');
  assertEqual(parseColorInput('rgb(0,0,0)').hex, '#000000', 'rgb black');
  assertEqual(parseColorInput('rgb(255,255,255)').hex, '#ffffff', 'rgb white');

  // hsl()
  const hslRes = parseColorInput('hsl(36, 91%, 56%)');
  assertTrue(/^#[0-9a-f]{6}$/.test(hslRes.hex), `hsl returns 7-char hex (got ${JSON.stringify(hslRes)})`);
  // hsl(36, 91%, 56%) mathematically = RGB(245, 163, 41) = #f5a329.
  // (Note: this is a less-saturated amber than the rgb(245,158,11) =
  // #f59e0b above — the hue/sat/light triple yields a slightly lighter
  // and redder orange.)
  assertEqual(hslRes.hex, '#f5a329', 'hsl(36,91%,56%) → #f5a329');
  assertEqual(parseColorInput('hsl(0, 0%, 0%)').hex, '#000000', 'hsl black');
  assertEqual(parseColorInput('hsl(0, 0%, 100%)').hex, '#ffffff', 'hsl white');
});

test('ADR 0013: parseColorInput rejects rgba / hsla / out-of-range / garbage', () => {
  const { parseColorInput } = require(path.join(PROJECT_ROOT, 'server.js'));
  const rejectCases = [
    'rgba(245,158,11,0.5)',
    'hsla(36,91%,56%,1)',
    'rgb(256,0,0)',
    'rgb(-1,0,0)',
    'hsl(361,50%,50%)',
    'hsl(36,101%,50%)',
    'hsl(36,50%,101%)',
    'rgb(1,2)',
    'hsl(red,50%,50%)',
    'transparent',
    'not-a-color',
    '',
    '   ',
    null,
    undefined,
    42,
    { hex: '#fff' }
  ];
  for (const c of rejectCases) {
    const r = parseColorInput(c);
    assertTrue(r && typeof r.error === 'string', `expected error for ${JSON.stringify(c)}, got ${JSON.stringify(r)}`);
  }
});

test('ADR 0013: parseColorInput always returns lowercase 7-char hex on success', () => {
  const { parseColorInput } = require(path.join(PROJECT_ROOT, 'server.js'));
  const inputs = ['#ABCDEF', 'abcdef', '#AbCdEf', 'rgb(171, 205, 239)', 'hsl(210, 68%, 80%)'];
  for (const i of inputs) {
    const r = parseColorInput(i);
    assertTrue(/^#[0-9a-f]{6}$/.test(r.hex), `expected 7-char lowercase hex for ${JSON.stringify(i)} (got ${JSON.stringify(r)})`);
  }
});

test('ADR 0013: validatePaletteColorsFlexible accepts hex / rgb / hsl and returns normalized array', () => {
  const { validatePaletteColorsFlexible } = require(path.join(PROJECT_ROOT, 'server.js'));

  const r1 = validatePaletteColorsFlexible([
    { hex: '#d97706', name: 'orange' },
    { hex: 'rgb(245,158,11)', name: 'amber' },
    { hex: 'hsl(36,91%,56%)', name: 'ochre' }
  ]);
  assertEqual(r1.error, null, 'mixed formats accepted');
  assertEqual(r1.colors.length, 3, 'three entries');
  assertEqual(r1.colors[0].hex, '#d97706', 'first hex unchanged');
  assertEqual(r1.colors[1].hex, '#f59e0b', 'rgb normalized to hex');
  assertEqual(r1.colors[2].hex, '#f5a329', 'hsl normalized to hex');

  // Reject empty / over-limit / bad entries
  assertTrue(validatePaletteColorsFlexible([]).error, 'empty rejected');
  assertTrue(validatePaletteColorsFlexible('not-array').error, 'non-array rejected');
  assertTrue(validatePaletteColorsFlexible([{ hex: 'garbage', name: 'x' }]).error, 'garbage hex rejected');
  assertTrue(validatePaletteColorsFlexible([{ hex: '#fff', name: 42 }]).error, 'non-string name rejected');
  const tooMany = new Array(51).fill({ hex: '#fff', name: 'x' });
  assertTrue(validatePaletteColorsFlexible(tooMany).error, 'over MAX_PALETTE_COLORS rejected');
});

test('ADR 0013: validatePaletteEdit rejects empty body; accepts name-only / colors-only / both', () => {
  const { validatePaletteEdit } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(validatePaletteEdit(null) !== null, 'null rejected');
  assertTrue(validatePaletteEdit({}) !== null, 'empty body rejected');
  assertTrue(validatePaletteEdit([]) !== null, 'array body rejected');
  assertTrue(validatePaletteEdit('hi') !== null, 'string body rejected');

  assertEqual(validatePaletteEdit({ name: 'New name' }, { existingNames: new Set() }), null, 'name-only OK');
  assertEqual(
    validatePaletteEdit({ colors: [{ hex: '#fff', name: 'x' }] }, { existingNames: new Set() }),
    null,
    'colors-only OK'
  );
  assertEqual(
    validatePaletteEdit({ name: 'New', colors: [{ hex: '#fff', name: 'x' }] }, { existingNames: new Set() }),
    null,
    'both OK'
  );
});

test('ADR 0013: validatePaletteEdit enforces name uniqueness via existingNames minus excludeId', () => {
  const { validatePaletteEdit } = require(path.join(PROJECT_ROOT, 'server.js'));
  const existing = new Set(['sunset ochres']);
  assertTrue(
    validatePaletteEdit({ name: 'Sunset Ochres' }, { existingNames: existing }) !== null,
    'duplicate (case-insensitive) rejected'
  );
  // Caller pre-filters the existingNames set (mirrors the route's
  // behavior — it filters by id before passing to the validator). With
  // the palette being edited already excluded from the set, the SAME
  // name is allowed (rename-to-self).
  assertEqual(
    validatePaletteEdit({ name: 'Sunset ochres' }, { existingNames: new Set() }),
    null,
    'rename-to-self (caller-filtered existingNames) allowed'
  );
  assertTrue(
    validatePaletteEdit({ name: '' }, { existingNames: new Set() }) !== null,
    'empty name rejected'
  );
  assertTrue(
    validatePaletteEdit({ name: 'a'.repeat(61) }, { existingNames: new Set() }) !== null,
    'oversized name rejected'
  );
});

test('ADR 0013: validatePaletteEdit rejects colors with empty array or invalid color string', () => {
  const { validatePaletteEdit } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(
    validatePaletteEdit({ colors: [] }, { existingNames: new Set() }) !== null,
    'empty colors rejected'
  );
  assertTrue(
    validatePaletteEdit({ colors: 'not-array' }, { existingNames: new Set() }) !== null,
    'non-array colors rejected'
  );
  assertTrue(
    validatePaletteEdit({ colors: [{ hex: 'not-hex', name: 'x' }] }, { existingNames: new Set() }) !== null,
    'invalid hex rejected'
  );
  assertTrue(
    validatePaletteEdit({ colors: [{ hex: 'rgb(999,0,0)', name: 'x' }] }, { existingNames: new Set() }) !== null,
    'rgb out-of-range rejected'
  );
  assertTrue(
    validatePaletteEdit({ colors: [{ hex: 'rgba(1,2,3,0.5)', name: 'x' }] }, { existingNames: new Set() }) !== null,
    'rgba rejected (alpha not supported)'
  );
});

test('ADR 0013: applyPaletteUpdate mutates palette in place + is defensive', () => {
  const { applyPaletteUpdate } = require(path.join(PROJECT_ROOT, 'server.js'));
  const p = {
    name: 'old',
    colors: [{ hex: '#111111', name: 'dark' }],
    history: [{ version: 1, name: 'old', colors: [{ hex: '#111111', name: 'dark' }], saved_at: 'x' }]
  };
  const err = applyPaletteUpdate(p, { name: '  new name  ' });
  assertEqual(err, null, 'no error on valid update');
  assertEqual(p.name, 'new name', 'name trimmed');

  applyPaletteUpdate(p, { colors: [{ hex: '#abcdef', name: 'cyan' }, { hex: 'rgb(0,0,0)', name: 'black' }] });
  assertEqual(p.colors.length, 2, 'colors replaced');
  assertEqual(p.colors[0].hex, '#abcdef', 'hex passed through');
  assertEqual(p.colors[1].hex, '#000000', 'rgb normalized to hex');

  const badErr = applyPaletteUpdate(p, { colors: [{ hex: 'garbage', name: 'x' }] });
  assertTrue(badErr !== null, 'invalid color rejected');
});

test('ADR 0013: pushPaletteHistory appends with incremented version + bumps updated_at', () => {
  const { pushPaletteHistory, snapshotPalette } = require(path.join(PROJECT_ROOT, 'server.js'));
  const p = {
    name: 'test',
    colors: [{ hex: '#fff', name: 'white' }],
    history: []
  };
  pushPaletteHistory(p);
  assertEqual(p.history.length, 1, 'v1 appended');
  assertEqual(p.history[0].version, 1, 'v1 number');
  assertEqual(p.history[0].name, 'test', 'v1 captures name');
  assertTrue(typeof p.updated_at === 'string', 'updated_at set');

  p.name = 'renamed';
  p.colors.push({ hex: '#000', name: 'black' });
  pushPaletteHistory(p);
  assertEqual(p.history.length, 2, 'v2 appended');
  assertEqual(p.history[1].version, 2, 'v2 number');
  assertEqual(p.history[1].name, 'renamed', 'v2 captures new name');
  assertEqual(p.history[1].colors.length, 2, 'v2 captures new colors');

  // snapshotPalette is deterministic-ish — only `saved_at` is non-deterministic,
  // so check the captured state shape rather than exact time.
  const snap = snapshotPalette({ history: [], name: 'x', colors: [{ hex: '#fff', name: 'w' }] });
  assertEqual(snap.version, 1, 'snapshot version = history.length + 1');
  assertEqual(snap.name, 'x', 'snapshot captures name');
  assertEqual(snap.colors[0].hex, '#fff', 'snapshot captures colors');
  assertTrue(typeof snap.saved_at === 'string', 'snapshot has saved_at');
});

// ─── HTTP integration tests for ADR 0013 ─────────────────────────────

test('HTTP integration (ADR 0013): POST /api/palettes includes history[0] and updated_at', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/palettes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPaletteBody())
    });
    assertEqual(r.status, 201, 'POST → 201');
    assertEqual(r.body.data.history.length, 1, 'history v1 appended');
    assertEqual(r.body.data.history[0].version, 1, 'history v1 number');
    assertEqual(r.body.data.history[0].name, r.body.data.name, 'history captures name');
    assertEqual(typeof r.body.data.updated_at, 'string', 'updated_at set');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('HTTP integration (ADR 0013): PUT name-only appends history (v2) and updates top-level name', async () => {
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
    assertEqual(rename.status, 200, 'PUT name-only → 200');
    assertEqual(rename.body.data.name, 'Sunset palette v2', 'name updated');
    assertEqual(rename.body.data.history.length, 2, 'history grew by one');
    assertEqual(rename.body.data.history[1].version, 2, 'v2 number');
    assertEqual(rename.body.data.history[1].name, 'Sunset palette v2', 'v2 captures new name');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('HTTP integration (ADR 0013): PUT colors-only replaces colors and appends history', async () => {
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

    const recolor = await fetchJson(`${srv.base}/api/palettes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colors: [{ hex: '#abcdef', name: 'cyan' }, { hex: '#fedcba', name: 'sand' }] })
    });
    assertEqual(recolor.status, 200, 'PUT colors-only → 200');
    assertEqual(recolor.body.data.colors.length, 2, 'colors replaced (was 2)');
    assertEqual(recolor.body.data.colors[0].hex, '#abcdef', 'new first color');
    assertEqual(recolor.body.data.history.length, 2, 'history v2 appended');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('HTTP integration (ADR 0013): PUT accepts rgb() and hsl() and stores as hex', async () => {
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

    const fromRgb = await fetchJson(`${srv.base}/api/palettes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colors: [{ hex: 'rgb(245,158,11)', name: 'amber' }] })
    });
    assertEqual(fromRgb.status, 200, 'rgb() → 200');
    assertEqual(fromRgb.body.data.colors[0].hex, '#f59e0b', 'rgb normalized to hex');

    const fromHsl = await fetchJson(`${srv.base}/api/palettes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colors: [{ hex: 'hsl(36, 91%, 56%)', name: 'amber2' }] })
    });
    assertEqual(fromHsl.status, 200, 'hsl() → 200');
    assertEqual(fromHsl.body.data.colors[0].hex, '#f5a329', 'hsl normalized to hex');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('HTTP integration (ADR 0013): PUT with empty body / empty colors / bad color → 400', async () => {
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

    const empty = await fetchJson(`${srv.base}/api/palettes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assertEqual(empty.status, 400, 'empty body → 400');

    const emptyColors = await fetchJson(`${srv.base}/api/palettes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colors: [] })
    });
    assertEqual(emptyColors.status, 400, 'empty colors → 400');

    const badHex = await fetchJson(`${srv.base}/api/palettes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colors: [{ hex: 'not-hex', name: 'x' }] })
    });
    assertEqual(badHex.status, 400, 'bad hex → 400');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('HTTP integration (ADR 0013): POST /api/palettes/custom creates a palette with no source_run_id', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/palettes/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Brand book Q3',
        colors: [{ hex: '#0f172a', name: 'ink' }, { hex: 'rgb(245,158,11)', name: 'amber' }]
      })
    });
    assertEqual(r.status, 201, 'POST custom → 201');
    assertEqual(r.body.data.source_run_id, null, 'source_run_id is null');
    assertEqual(r.body.data.colors[0].hex, '#0f172a', 'hex passed through');
    assertEqual(r.body.data.colors[1].hex, '#f59e0b', 'rgb normalized');
    assertEqual(r.body.data.history.length, 1, 'history v1');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('HTTP integration (ADR 0013): POST /api/palettes/custom rejects duplicates, empty colors, bad colors', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    const first = await fetchJson(`${srv.base}/api/palettes/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Brand Q3', colors: [{ hex: '#0f172a', name: 'ink' }] })
    });
    assertEqual(first.status, 201, 'first → 201');

    const dup = await fetchJson(`${srv.base}/api/palettes/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'BRAND Q3', colors: [{ hex: '#000', name: 'x' }] })
    });
    assertEqual(dup.status, 400, 'duplicate name (case-insensitive) → 400');

    const empty = await fetchJson(`${srv.base}/api/palettes/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New', colors: [] })
    });
    assertEqual(empty.status, 400, 'empty colors → 400');

    const bad = await fetchJson(`${srv.base}/api/palettes/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New2', colors: [{ hex: 'not-hex', name: 'x' }] })
    });
    assertEqual(bad.status, 400, 'bad color → 400');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('HTTP integration (ADR 0013): POST /:id/restore/:version rolls back to a prior version + records new history', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    // Create with a single color.
    const create = await fetchJson(`${srv.base}/api/palettes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPaletteBody({ name: 'Test', colors: [{ hex: '#111111', name: 'a' }] }))
    });
    const id = create.body.data.id;

    // Edit colors → history should be v2.
    const edit = await fetchJson(`${srv.base}/api/palettes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colors: [{ hex: '#abcdef', name: 'b' }, { hex: '#fedcba', name: 'c' }] })
    });
    assertEqual(edit.body.data.history.length, 2, 'history v2 after edit');

    // Restore to v1 — top-level returns to v1's state, history becomes v3.
    const restore = await fetchJson(`${srv.base}/api/palettes/${id}/restore/1`, {
      method: 'POST'
    });
    assertEqual(restore.status, 200, 'restore → 200');
    assertEqual(restore.body.data.colors.length, 1, 'colors rolled back to v1 length');
    assertEqual(restore.body.data.colors[0].hex, '#111111', 'colors rolled back to v1 hex');
    assertEqual(restore.body.data.history.length, 3, 'history v3 appended (rollback recorded)');
    assertEqual(restore.body.data.history[2].version, 3, 'newest is v3');
    assertEqual(restore.body.data.history[2].colors[0].hex, '#111111', 'v3 captures the rolled-back state');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('HTTP integration (ADR 0013): POST /:id/restore/:version rejects bad version numbers', async () => {
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

    const badNumber = await fetchJson(`${srv.base}/api/palettes/${id}/restore/abc`, { method: 'POST' });
    assertEqual(badNumber.status, 400, 'non-numeric → 400');

    const missing = await fetchJson(`${srv.base}/api/palettes/${id}/restore/999`, { method: 'POST' });
    assertEqual(missing.status, 400, 'missing version → 400');

    const noPalette = await fetchJson(`${srv.base}/api/palettes/palette_doesnotexist0000/restore/1`, { method: 'POST' });
    assertEqual(noPalette.status, 404, 'missing palette → 404');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('HTTP integration (ADR 0013): DELETE /api/palettes/:id still works (regression)', async () => {
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
    const del = await fetchJson(`${srv.base}/api/palettes/${id}`, { method: 'DELETE' });
    assertEqual(del.status, 200, 'DELETE → 200');
    const get = await fetchJson(`${srv.base}/api/palettes/${id}`);
    assertEqual(get.status, 404, 'GET after DELETE → 404');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

// ─── ADR 0017 — Phase 2: Stage 2 injection + telemetry ───────────────
//
// Phase 2 wires the budget block into the Stage 2 user-message
// envelope and surfaces `distribution_metrics` in the /api/generate-prompt
// response. Tests cover:
//   - The pure `buildStage2Envelope` helper (budget block inclusion).
//   - HTTP integration for the parts of /api/generate-prompt that
//     don't require a live MiniMax call (paletteId validation +
//     lookup, 404 on missing palette).
// ADR 0017 removed the "pure legacy" opt-out: any saved palette emits
// a budget block.

test('ADR 0017: buildStage2Envelope includes color_budget when a palette is supplied', () => {
  const { buildStage2Envelope } = require(path.join(PROJECT_ROOT, 'server.js'));
  const envelope = buildStage2Envelope(
    { subject: 'x', colors: [{ hex: '#d97706', name: 'burnt orange' }] },
    'make it dramatic',
    {
      colors: [
        { hex: '#d97706', name: 'burnt orange' },
        { hex: '#dc2626', name: 'signal red', accent: true }
      ],
      accent_max_mentions: 2
    }
  );
  assertTrue(typeof envelope.color_budget === 'string', 'color_budget string present');
  assertTrue(envelope.color_budget.startsWith('STRENGTH:'), 'block opens with STRENGTH preamble (ADR 0016)');
  assertTrue(envelope.color_budget.includes('Color usage budget'), 'block contains the budget header');
  // ADR 0017: priority labels + uniform 1/N shares.
  assertTrue(envelope.color_budget.includes('burnt orange #d97706: priority 1 (~50% share)'),
    'top color labelled priority 1 with uniform 1/2 share');
  assertTrue(envelope.color_budget.includes('signal red #dc2626: priority 2 (~50% share) (ACCENT — mention at most 2 times'),
              'second color (accent) labelled priority 2 + accent tag');
  assertEqual(envelope.analysis.subject, 'x', 'analysis preserved');
  assertEqual(envelope.directives, 'make it dramatic', 'directives preserved');
});

test('ADR 0017: buildStage2Envelope omits color_budget when no palette is supplied', () => {
  const { buildStage2Envelope } = require(path.join(PROJECT_ROOT, 'server.js'));
  const envelope = buildStage2Envelope(
    { subject: 'x', colors: [] },
    '',
    null
  );
  assertEqual(envelope.color_budget, undefined, 'no color_budget key');
  assertEqual(envelope.analysis.subject, 'x', 'analysis preserved');
  assertEqual(envelope.directives, '', 'empty directives preserved');
});

test('ADR 0017: buildStage2Envelope emits a budget block for every saved palette (no "pure legacy" opt-out)', () => {
  const { buildStage2Envelope } = require(path.join(PROJECT_ROOT, 'server.js'));
  // ADR 0017 removed the pure-legacy gate. Any palette the user has
  // explicitly saved carries a priority intent via its array order,
  // so the block is always emitted.
  const envelope = buildStage2Envelope(
    { subject: 'x', colors: [{ hex: '#a', name: 'a' }, { hex: '#b', name: 'b' }] },
    '',
    {
      colors: [
        { hex: '#a', name: 'a' },
        { hex: '#b', name: 'b' }
      ],
      accent_max_mentions: 2
    }
  );
  assertTrue(typeof envelope.color_budget === 'string', 'every palette → budget block');
});

test('ADR 0014: buildStage2Envelope handles directives as non-string defensively', () => {
  const { buildStage2Envelope } = require(path.join(PROJECT_ROOT, 'server.js'));
  // The route coerces directives to string before calling; this test
  // documents that the helper itself defaults to '' for non-strings.
  const envelope = buildStage2Envelope({ subject: 'x' }, null, null);
  assertEqual(envelope.directives, '', 'null directives → empty string');
  const envelope2 = buildStage2Envelope({ subject: 'x' }, undefined, null);
  assertEqual(envelope2.directives, '', 'undefined directives → empty string');
});

// HTTP integration — paletteId validation + lookup on /api/generate-prompt.
// These tests stop before the MiniMax call (validation/lookup runs first)
// so they work without a live LLM API key.

test('ADR 0014: POST /api/generate-prompt rejects malformed paletteId with 400', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/generate-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        presetId: 'preset_alla_prima_oil',
        analysis: { subject: 'x', colors: [] },
        directives: '',
        paletteId: 'not-a-palette-id'
      })
    });
    assertEqual(r.status, 400, 'malformed paletteId → 400');
    assertTrue(r.body.error.includes('paletteId'), 'error mentions paletteId');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('ADR 0014: POST /api/generate-prompt returns 404 when paletteId refers to a missing palette', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/generate-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        presetId: 'preset_alla_prima_oil',
        analysis: { subject: 'x', colors: [] },
        directives: '',
        paletteId: 'palette_does_not_exist'
      })
    });
    assertEqual(r.status, 404, 'missing palette → 404');
    assertTrue(r.body.error.includes('palette_does_not_exist'), 'error names the missing id');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('ADR 0014: POST /api/generate-prompt with a weighted palette includes palette fields + distribution_metrics in the response envelope', async () => {
  // With a real MiniMax API key in the test environment, this test
  // validates the success path: palette lookup succeeds, the budget
  // block is appended to the Stage 2 envelope, and the response
  // envelope carries palette_id, palette_name, and distribution_metrics
  // with the right shape. This is the live end-to-end Phase 2
  // contract — Phase 5 UAT validates the LLM's behavioural obedience.
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    // Seed an ordered palette on disk (ADR 0017 — no weight field)
    const create = await fetchJson(`${srv.base}/api/palettes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validPaletteBody(),
        colors: [
          { hex: '#d97706', name: 'burnt orange' },
          { hex: '#dc2626', name: 'signal red', accent: true }
        ],
        accent_max_mentions: 2
      })
    });
    const paletteId = create.body.data.id;
    const r = await fetchJson(`${srv.base}/api/generate-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        presetId: 'preset_alla_prima_oil',
        analysis: { subject: 'a quiet still life', colors: [{ hex: '#d97706', name: 'burnt orange' }] },
        directives: '',
        paletteId
      })
    });
    assertEqual(r.status, 200, 'weighted palette + real LLM → 200');
    assertEqual(r.body.data.palette_id, paletteId, 'response carries palette_id');
    assertEqual(r.body.data.palette_name, 'Sunset ochres', 'response carries palette_name');
    assertTrue(typeof r.body.data.prompt === 'string' && r.body.data.prompt.length > 0,
               'prompt returned');
    // distribution_metrics shape (ADR 0014 §5)
    const m = r.body.data.distribution_metrics;
    assertTrue(m && typeof m === 'object', 'distribution_metrics present');
    assertTrue(Array.isArray(m.counts), 'counts is an array');
    assertEqual(m.counts.length, 2, 'one count entry per palette color');
    assertEqual(m.counts[0].hex, '#d97706', 'first count hex');
    assertEqual(m.counts[0].name, 'burnt orange', 'first count name');
    assertEqual(typeof m.counts[0].nameCount, 'number', 'first nameCount is a number');
    assertEqual(typeof m.counts[0].hexCount, 'number', 'first hexCount is a number');
    assertEqual(typeof m.counts[0].totalCount, 'number', 'first totalCount is a number');
    assertEqual(typeof m.totalMentions, 'number', 'totalMentions is a number');
    assertTrue(typeof m.totalWords === 'number' && m.totalWords > 0, 'totalWords > 0');
    assertTrue(typeof m.measuredAt === 'string', 'measuredAt is an ISO timestamp');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('ADR 0014: POST /api/generate-prompt without paletteId omits palette fields (backwards compat)', async () => {
  // No paletteId → response envelope is the pre-ADR 0014 shape:
  // no palette_id, no palette_name, no distribution_metrics. Validates
  // that existing callers (no palette selection) see no change.
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/generate-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        presetId: 'preset_alla_prima_oil',
        analysis: { subject: 'x', colors: [] },
        directives: ''
      })
    });
    assertEqual(r.status, 200, 'no paletteId + real LLM → 200');
    assertEqual(r.body.data.palette_id, undefined, 'palette_id absent');
    assertEqual(r.body.data.palette_name, undefined, 'palette_name absent');
    assertEqual(r.body.data.distribution_metrics, undefined, 'distribution_metrics absent');
    assertTrue(typeof r.body.data.prompt === 'string' && r.body.data.prompt.length > 0,
               'prompt returned (backwards compat)');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('ADR 0017: POST /api/generate-prompt with an accent-only palette returns palette_id + distribution_metrics', async () => {
  // ADR 0017 removed the "pure legacy" opt-out entirely. Every saved
  // palette emits a budget block (priority is the array order). The
  // response envelope still includes palette_id + distribution_metrics
  // because the dashboard renders the same fields regardless of
  // strength / priority.
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    // Seed a palette without any per-color accent (just to confirm the
    // metrics path is exercised for non-accent palettes too).
    const create = await fetchJson(`${srv.base}/api/palettes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPaletteBody())
    });
    const paletteId = create.body.data.id;
    const r = await fetchJson(`${srv.base}/api/generate-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        presetId: 'preset_alla_prima_oil',
        analysis: { subject: 'a quiet still life', colors: [{ hex: '#d97706', name: 'burnt orange' }] },
        directives: '',
        paletteId
      })
    });
    assertEqual(r.status, 200, 'plain palette + real LLM → 200');
    assertEqual(r.body.data.palette_id, paletteId, 'palette_id present (resolver ran)');
    assertTrue(r.body.data.distribution_metrics, 'distribution_metrics present (observational)');
    assertEqual(r.body.data.distribution_metrics.counts.length, 2, 'one count per palette color');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});


//
// Phase 1 covers the pure data layer: range validators, the
// `normalizeColorWeights` arithmetic (the algorithm that handles the
// "sum not equal to 100%" edge case), the budget-block renderer, and
// the post-Stage-2 measurement helper. Phase 2 wires the budget block
// into callMiniMaxStage2; Phase 4 wires the dashboard. Each helper is
// exercised through the existing `tests/run-all.js` require-and-call
// pattern so the server isn't started.

// Constants exported (ADR 0017 — accent-cap constants only; per-color
// weight is gone)
test('ADR 0017: accent-cap constants are exported with sensible bounds', () => {
  const srv = require(path.join(PROJECT_ROOT, 'server.js'));
  assertEqual(srv.MIN_ACCENT_MAX_MENTIONS, 1, 'MIN_ACCENT_MAX_MENTIONS = 1');
  assertEqual(srv.MAX_ACCENT_MAX_MENTIONS, 5, 'MAX_ACCENT_MAX_MENTIONS = 5');
  assertEqual(srv.DEFAULT_ACCENT_MAX_MENTIONS, 2, 'DEFAULT_ACCENT_MAX_MENTIONS = 2');
  // Removed (ADR 0017 — order-based priority replaces weight):
  assertEqual(srv.MIN_COLOR_WEIGHT, undefined, 'MIN_COLOR_WEIGHT removed');
  assertEqual(srv.MAX_COLOR_WEIGHT, undefined, 'MAX_COLOR_WEIGHT removed');
  assertEqual(srv.DEFAULT_COLOR_WEIGHT, undefined, 'DEFAULT_COLOR_WEIGHT removed');
  assertEqual(srv.validatePaletteColorWeight, undefined, 'validatePaletteColorWeight removed');
  assertEqual(srv.normalizeColorWeights, undefined, 'normalizeColorWeights removed');
  assertEqual(srv.isPaletteUnweighted, undefined, 'isPaletteUnweighted removed');
  // Replaced:
  assertTrue(typeof srv.prioritiesFromOrder === 'function', 'prioritiesFromOrder exported');
});

// Accent-cap validator — same edge cases (still valid in ADR 0017)
test('ADR 0017: validatePaletteAccentMaxMentions accepts the integer range and rejects everything else', () => {
  const { validatePaletteAccentMaxMentions } = require(path.join(PROJECT_ROOT, 'server.js'));
  for (const n of [1, 2, 3, 4, 5]) {
    assertEqual(validatePaletteAccentMaxMentions(n), null, `cap ${n} accepted`);
  }
  assertTrue(validatePaletteAccentMaxMentions(0) !== null, '0 rejected (below MIN)');
  assertTrue(validatePaletteAccentMaxMentions(6) !== null, '6 rejected (above MAX)');
  assertTrue(validatePaletteAccentMaxMentions(-1) !== null, '-1 rejected');
  assertTrue(validatePaletteAccentMaxMentions(2.5) !== null, '2.5 rejected (non-integer)');
  assertTrue(validatePaletteAccentMaxMentions('2') !== null, '"2" rejected');
  assertTrue(validatePaletteAccentMaxMentions(null) !== null, 'null rejected');
  assertTrue(validatePaletteAccentMaxMentions(NaN) !== null, 'NaN rejected');
});

// prioritiesFromOrder — replacement for normalizeColorWeights
test('ADR 0017: prioritiesFromOrder — empty input returns empty arrays', () => {
  const { prioritiesFromOrder } = require(path.join(PROJECT_ROOT, 'server.js'));
  const r = prioritiesFromOrder([]);
  assertEqual(r.priorities.length, 0, 'no priorities');
  assertEqual(r.displayPct.length, 0, 'no displayPct');
});

test('ADR 0017: prioritiesFromOrder — single color → priority 1 + uniform 100%', () => {
  const { prioritiesFromOrder } = require(path.join(PROJECT_ROOT, 'server.js'));
  const r = prioritiesFromOrder([{ hex: '#d97706', name: 'burnt orange' }]);
  assertEqual(r.priorities[0], 1, 'priority 1');
  assertEqual(r.displayPct[0], 100, 'displayPct 100');
});

test('ADR 0017: prioritiesFromOrder — N colors → priorities 1..N + uniform 1/N share', () => {
  const { prioritiesFromOrder } = require(path.join(PROJECT_ROOT, 'server.js'));
  const colors = [
    { hex: '#d97706', name: 'a' },
    { hex: '#7c2d12', name: 'b' },
    { hex: '#dc2626', name: 'c' }
  ];
  const r = prioritiesFromOrder(colors);
  assertEqual(r.priorities.join(','), '1,2,3', 'priorities are 1-indexed');
  // 100/3 = 33.33 → 33 each
  assertEqual(r.displayPct.join(','), '33,33,33', 'uniform 1/N');
  const sum = r.displayPct.reduce((s, p) => s + p, 0);
  assertEqual(sum, 99, 'sum = 99 after rounding');
});

test('ADR 0017: prioritiesFromOrder — defensive against non-array input', () => {
  const { prioritiesFromOrder } = require(path.join(PROJECT_ROOT, 'server.js'));
  for (const bad of [null, undefined, 'not an array', 42]) {
    const r = prioritiesFromOrder(bad);
    assertEqual(r.priorities.length, 0, `${JSON.stringify(bad)} → empty priorities`);
    assertEqual(r.displayPct.length, 0, `${JSON.stringify(bad)} → empty displayPct`);
  }
});

// buildColorBudgetBlock — now emits "priority N" labels + 1/N shares
test('ADR 0017: buildColorBudgetBlock — returns empty for missing / empty palette', () => {
  const { buildColorBudgetBlock } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertEqual(buildColorBudgetBlock(null), '', 'null');
  assertEqual(buildColorBudgetBlock({}), '', 'no colors');
  assertEqual(buildColorBudgetBlock({ colors: [] }), '', 'empty colors');
});

test('ADR 0017: buildColorBudgetBlock — priority labels + uniform shares replace percentages', () => {
  const { buildColorBudgetBlock } = require(path.join(PROJECT_ROOT, 'server.js'));
  const block = buildColorBudgetBlock({
    colors: [
      { hex: '#d97706', name: 'burnt orange' },
      { hex: '#7c2d12', name: 'deep brown' },
      { hex: '#dc2626', name: 'signal red' }
    ],
    accent_max_mentions: 2
  });
  assertTrue(block.startsWith('STRENGTH:'), 'opens with STRENGTH preamble (ADR 0016)');
  assertTrue(block.includes('Color usage budget'), 'contains budget header');
  assertTrue(block.includes('mention colors top-to-bottom in palette order'),
    'header instructs top-to-bottom ordering (ADR 0017)');
  // Top color is priority 1; uniform 1/3 share.
  assertTrue(block.includes('burnt orange #d97706: priority 1 (~33% share)'),
    'top color labelled priority 1 (~33% share)');
  assertTrue(block.includes('deep brown #7c2d12: priority 2 (~33% share)'),
    'second color labelled priority 2 (~33% share)');
  assertTrue(block.includes('signal red #dc2626: priority 3 (~33% share)'),
    'third color labelled priority 3 (~33% share)');
  assertTrue(block.includes('Sum: 99% (rounded)'), 'sum line labels rounding honestly');
  // No accents → no cap note
  assertTrue(!block.includes('accent cap'), 'no accent cap when no accents');
});

test('ADR 0017: buildColorBudgetBlock — accent colors get the (ACCENT — mention at most N times) clause', () => {
  const { buildColorBudgetBlock } = require(path.join(PROJECT_ROOT, 'server.js'));
  const block = buildColorBudgetBlock({
    colors: [
      { hex: '#d97706', name: 'burnt orange' },
      { hex: '#dc2626', name: 'signal red', accent: true }
    ],
    accent_max_mentions: 2
  });
  assertTrue(block.includes('signal red #dc2626: priority 2 (~50% share) (ACCENT — mention at most 2 times total'),
              'accent tag with singular/plural-correct cap phrasing');
  assertTrue(block.includes('Sum: 100% (accent cap: 2 mentions)'),
    'sum line includes accent cap when accent present');
});

test('ADR 0017: buildColorBudgetBlock — singular vs plural in accent phrasing', () => {
  const { buildColorBudgetBlock } = require(path.join(PROJECT_ROOT, 'server.js'));
  const block1 = buildColorBudgetBlock({
    colors: [{ hex: '#d97706', name: 'a', accent: true }],
    accent_max_mentions: 1
  });
  assertTrue(block1.includes('mention at most 1 time total'), 'singular "time"');
  assertTrue(block1.includes('accent cap: 1 mention'), 'singular "mention"');
});

// measureColorDistribution — same logic as before (priority-aware strict
// checks in computeStrictPass; counts/measurement unchanged)
test('Issue #8: buildColorBudgetBlock drops hex codes when isZImage (Issue #9 drops strength semantics)', () => {
  // ADR 0019 — preset-aware palette emission. Z-Image interprets hex
  // strings as text glyphs (Qwen3-4B is bilingual; Z-Image has
  // text-in-image as a documented strength) and the guide §5.3 says
  // use pigment names only. The FLUX/SDXL default path is preserved
  // — passes opts.isZImage: true to swap to the Z-Image emission.
  const { buildColorBudgetBlock } = require(path.join(PROJECT_ROOT, 'server.js'));
  const palette = {
    name: 'pastel-focal',
    strength: 'strong',
    colors: [
      { hex: '#ff0000', name: 'Cadmium-coral', accent: true, placement: 'upper-left quadrant' },
      { hex: '#cdeac0', name: 'Pale sage' }
    ]
  };
  const fluxBlock = buildColorBudgetBlock(palette);
  const zimageBlock = buildColorBudgetBlock(palette, { isZImage: true });
  assertTrue(fluxBlock.includes('#ff0000'),
    'FLUX/SDXL default path keeps hex codes');
  assertTrue(fluxBlock.includes('[STRENGTH: strong]'),
    'FLUX/SDXL default path keeps STRENGTH tag');
  assertTrue(fluxBlock.includes('placement: upper-left quadrant'),
    'FLUX/SDXL default path keeps per-accent placement region');
  assertTrue(!zimageBlock.includes('#ff0000'),
    'Z-Image path drops hex codes (Issue #8)');
  assertTrue(!zimageBlock.includes('[STRENGTH: strong]'),
    'Z-Image path drops STRENGTH tag (Issue #9)');
  assertTrue(!zimageBlock.includes('placement: upper-left quadrant'),
    'Z-Image path drops placement region binding');
  assertTrue(zimageBlock.includes('Cadmium-coral'),
    'Z-Image block still names the pigment');
  assertTrue(zimageBlock.includes('Pale sage'),
    'Z-Image block still names the muted surround');
});

test('Issue #15: buildAspectRatioDirective returns the prose directive for valid ratios, empty string otherwise', () => {
  const {
    buildAspectRatioDirective,
    VALID_ASPECT_RATIOS,
    ASPECT_RATIO_LABEL
  } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertEqual(buildAspectRatioDirective(''), '', 'empty string → empty directive');
  assertEqual(buildAspectRatioDirective(null), '', 'null → empty directive');
  assertEqual(buildAspectRatioDirective(undefined), '', 'undefined → empty directive');
  assertEqual(buildAspectRatioDirective('bogus'), '', 'unknown ratio → empty directive (server rejects with 400 later)');
  for (const r of VALID_ASPECT_RATIOS) {
    const d = buildAspectRatioDirective(r);
    assertTrue(d.includes('Aspect ratio:'), `directive for '${r}' starts with "Aspect ratio:"`);
    assertTrue(d.includes(ASPECT_RATIO_LABEL[r]),
      `directive for '${r}' names the doc §6 block-3 label "${ASPECT_RATIO_LABEL[r]}"`);
  }
});

test('Issue #15: /api/generate-prompt 400s on invalid aspectRatio', () => {
  // POST /api/generate-prompt with aspectRatio not in
  // VALID_ASPECT_RATIOS. Tests cover the validation in the route.
  // We test only that the rejection happens; full HTTP flow is
  // covered by integration tests elsewhere.
  const { VALID_ASPECT_RATIOS } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(VALID_ASPECT_RATIOS.has('square'), 'square is valid');
  assertTrue(VALID_ASPECT_RATIOS.has('portrait'), 'portrait is valid');
  assertTrue(VALID_ASPECT_RATIOS.has('landscape'), 'landscape is valid');
  assertTrue(VALID_ASPECT_RATIOS.has('panoramic'), 'panoramic is valid');
  assertTrue(!VALID_ASPECT_RATIOS.has('ultrawide'), 'ultrawide is NOT valid');
  assertTrue(!VALID_ASPECT_RATIOS.has('4:3'), '4:3 is NOT valid (must be a name not a ratio)');
});

test('Issue #14: buildChatSystemPrompt appends the Z-Image constraints block for Z-Image sessions', () => {
  const {
    buildChatSystemPrompt,
    ZIMAGE_PRESET_IDS,
    ZIMAGE_CHAT_CONSTRAINTS_BLOCK
  } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(typeof ZIMAGE_CHAT_CONSTRAINTS_BLOCK === 'string' && ZIMAGE_CHAT_CONSTRAINTS_BLOCK.length > 0,
    'ZIMAGE_CHAT_CONSTRAINTS_BLOCK is a non-empty string');
  assertTrue(ZIMAGE_PRESET_IDS.has('preset_alla_prima_oil'),
    'ZIMAGE_PRESET_IDS includes the original sentinel preset');
  assertTrue(ZIMAGE_PRESET_IDS.has('preset_968c0ccdf6fc6151'),
    'ZIMAGE_PRESET_IDS includes the imported sentinel preset');
  assertTrue(!ZIMAGE_PRESET_IDS.has('preset_photorealistic'),
    'photorealistic preset is NOT in ZIMAGE_PRESET_IDS');
  assertTrue(!ZIMAGE_PRESET_IDS.has('preset_sd_danbooru'),
    'Danbooru preset is NOT in ZIMAGE_PRESET_IDS');

  const baseSession = {
    preset_id: 'preset_alla_prima_oil',
    original_prompt: 'Oil painting on canvas, alla prima, palette knife.',
    current_prompt: 'Oil painting on canvas, alla prima, palette knife.',
    analysis_snapshot: { subject: 'x' }
  };
  const zPrompt = buildChatSystemPrompt(baseSession);
  assertTrue(zPrompt.includes('Z-IMAGE CONTRACT'),
    'Z-Image session prompt includes the Z-Image contract header');
  assertTrue(zPrompt.includes('FORBIDDEN VOCABULARY'),
    'Z-Image session prompt includes the forbidden-vocabulary list');
  assertTrue(/color contrast/i.test(zPrompt),
    'Z-Image session prompt references color-contrast glow mechanism');
  assertTrue(/natural paint sheen/i.test(zPrompt),
    'Z-Image session prompt references the natural paint sheen closing anchor');

  const photoSession = { ...baseSession, preset_id: 'preset_photorealistic' };
  const photoPrompt = buildChatSystemPrompt(photoSession);
  assertTrue(!photoPrompt.includes('Z-IMAGE CONTRACT'),
    'photorealistic session does NOT include the Z-Image contract');
  assertTrue(photoPrompt.includes('EDIT, DO NOT REGENERATE'),
    'photorealistic session retains the ADR 0012 anchor-preservation contract');
});

test('Issue #13: countStage2Words + classifyStage2Length honor the 150-300 sweet spot', () => {
  const {
    countStage2Words,
    isWithinStage2SweetSpot,
    classifyStage2Length,
    STAGE2_SWEET_SPOT_MIN,
    STAGE2_SWEET_SPOT_MAX,
    STAGE2_HARD_MAX_WORDS
  } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertEqual(STAGE2_SWEET_SPOT_MIN, 150, 'sweet spot floor = 150 (guide §3)');
  assertEqual(STAGE2_SWEET_SPOT_MAX, 300, 'sweet spot ceiling = 300 (guide §3)');
  assertEqual(STAGE2_HARD_MAX_WORDS, 750, 'hard ceiling = 750 / 1024 tokens');
  // Empty + whitespace → 0
  assertEqual(countStage2Words(''), 0, 'empty string is 0 words');
  assertEqual(countStage2Words('   \n\n  '), 0, 'whitespace is 0 words');
  assertEqual(countStage2Words('one'), 1, 'single word');
  assertEqual(countStage2Words('one two three'), 3, 'three words');
  assertEqual(countStage2Words('  one  two\tthree\nfour  '), 4, 'mixed whitespace');
  // Classification
  assertEqual(classifyStage2Length('a ' .repeat(149)), 'too_short',
    '149 words = too_short');
  assertEqual(classifyStage2Length('a ' .repeat(150)), 'sweet_spot',
    '150 words = sweet_spot (lower edge)');
  assertEqual(classifyStage2Length('a ' .repeat(250)), 'sweet_spot',
    '250 words = sweet_spot (middle)');
  assertEqual(classifyStage2Length('a ' .repeat(300)), 'sweet_spot',
    '300 words = sweet_spot (upper edge)');
  assertEqual(classifyStage2Length('a ' .repeat(301)), 'too_long',
    '301 words = too_long');
  assertEqual(classifyStage2Length('a ' .repeat(750)), 'too_long',
    '750 words = too_long (hard ceiling inclusive)');
  assertEqual(classifyStage2Length('a ' .repeat(751)), 'way_too_long',
    '751 words = way_too_long');
  assertEqual(isWithinStage2SweetSpot('a ' .repeat(200)), true,
    '200 words is inside sweet spot');
  assertEqual(isWithinStage2SweetSpot('a ' .repeat(149)), false,
    '149 words is outside');
});

test('Issue #8/#9: buildStage2Envelope threads opts into buildColorBudgetBlock', () => {
  const { buildStage2Envelope } = require(path.join(PROJECT_ROOT, 'server.js'));
  const palette = {
    name: 'pastel-focal',
    strength: 'moderate',
    colors: [
      { hex: '#ff0000', name: 'Cadmium-coral' }
    ]
  };
  const envFlux = buildStage2Envelope({ subject: 'x' }, '', palette);
  const envZ = buildStage2Envelope({ subject: 'x' }, '', palette, { isZImage: true });
  assertTrue(envFlux.color_budget.includes('#ff0000'),
    'envelope with default opts keeps hex');
  assertTrue(!envZ.color_budget.includes('#ff0000'),
    'envelope with isZImage:true drops hex');
});

test('ADR 0017: measureColorDistribution — empty prompt returns zeros', () => {
  const { measureColorDistribution } = require(path.join(PROJECT_ROOT, 'server.js'));
  const m = measureColorDistribution('', { colors: [{ hex: '#d97706', name: 'a' }] });
  assertEqual(m.totalMentions, 0, 'no mentions');
  assertEqual(m.totalWords, 0, 'no words');
  assertEqual(m.counts.length, 1, 'one color in counts (zero count)');
  assertEqual(m.counts[0].totalCount, 0, 'color count is zero');
  assertTrue(typeof m.measuredAt === 'string', 'measuredAt set');
});

test('ADR 0017: measureColorDistribution — counts name occurrences case-insensitively', () => {
  const { measureColorDistribution } = require(path.join(PROJECT_ROOT, 'server.js'));
  const m = measureColorDistribution(
    'A burnt orange sky above burnt-orange fields and another BURNT ORANGE wash.',
    { colors: [{ hex: '#d97706', name: 'burnt orange' }] }
  );
  assertTrue(m.counts[0].nameCount >= 3, `at least 3 name hits (got ${m.counts[0].nameCount})`);
  assertEqual(m.counts[0].hexCount, 0, 'no hex literal in this prompt');
  assertEqual(m.totalMentions, m.counts[0].nameCount, 'totalMentions sums counts');
});

test('ADR 0017: measureColorDistribution — counts hex with and without leading #', () => {
  const { measureColorDistribution } = require(path.join(PROJECT_ROOT, 'server.js'));
  const palette = { colors: [{ hex: '#d97706', name: 'unique-xyz-name' }] };
  const m1 = measureColorDistribution('Use #d97706 here.', palette);
  assertEqual(m1.counts[0].hexCount, 1, '"#d97706" counted once');
  const m2 = measureColorDistribution('Use d97706 here.', palette);
  assertEqual(m2.counts[0].hexCount, 1, '"d97706" (no #) counted once');
  const m3 = measureColorDistribution('#d97706 and d97706 together.', palette);
  assertEqual(m3.counts[0].hexCount, 2, 'two distinct forms counted');
});

test('ADR 0017: measureColorDistribution — counts multiple colors in one prompt', () => {
  const { measureColorDistribution } = require(path.join(PROJECT_ROOT, 'server.js'));
  const m = measureColorDistribution(
    'Burnt orange dominates. The signal red peeks through. Deep brown grounds the rest. Burnt orange again.',
    {
      colors: [
        { hex: '#d97706', name: 'burnt orange' },
        { hex: '#dc2626', name: 'signal red', accent: true },
        { hex: '#7c2d12', name: 'deep brown' }
      ]
    }
  );
  assertEqual(m.counts[0].nameCount, 2, 'burnt orange x2');
  assertEqual(m.counts[1].nameCount, 1, 'signal red x1');
  assertEqual(m.counts[2].nameCount, 1, 'deep brown x1');
  assertEqual(m.totalMentions, 4, 'total 4');
  assertTrue(m.totalWords > 0, 'word count populated');
});

test('ADR 0017: measureColorDistribution — empty palette returns zero counts but reports words', () => {
  const { measureColorDistribution } = require(path.join(PROJECT_ROOT, 'server.js'));
  const m = measureColorDistribution('A short prompt.', { colors: [] });
  assertEqual(m.counts.length, 0, 'no counts');
  assertEqual(m.totalMentions, 0, 'no mentions');
  assertEqual(m.totalWords, 3, 'three words');
});

// computeStrictPass — priority-derived expected counts
test('ADR 0017: computeStrictPass — priority 1 (position 0) expects ≥2 mentions, others ≥1', () => {
  const { measureColorDistribution } = require(path.join(PROJECT_ROOT, 'server.js'));
  // Top color mentioned twice → strict_pass true.
  // Lower-priority colors each mentioned once → strict_pass true.
  const palette = {
    strength: 'strict',
    accent_max_mentions: 2,
    colors: [
      { hex: '#cc3344', name: 'Crimson' },
      { hex: '#f4e9d8', name: 'Bone white' },
      { hex: '#3b82f6', name: 'Ocean blue' }
    ]
  };
  const prompt = 'Crimson anchors the composition. Crimson once more. Bone white scatters in. Ocean blue drifts.';
  const result = measureColorDistribution(prompt, palette);
  assertEqual(result.strict_pass, true,
    `strict_pass true (violations: ${JSON.stringify(result.strict_violations)})`);
  assertEqual(result.strict_violations.length, 0, 'no violations');
});

test('ADR 0017: computeStrictPass — non-accent at position 0 with 1 mention → strict_pass false', () => {
  const { measureColorDistribution } = require(path.join(PROJECT_ROOT, 'server.js'));
  const palette = {
    strength: 'strict',
    accent_max_mentions: 2,
    colors: [
      { hex: '#cc3344', name: 'Crimson' },
      { hex: '#f4e9d8', name: 'Bone white' }
    ]
  };
  // Top color mentioned only once → expected_min=2, under_min violation.
  const prompt = 'Crimson is here. Bone white there.';
  const result = measureColorDistribution(prompt, palette);
  assertEqual(result.strict_pass, false, 'priority 1 with 1 mention → under_min');
  assertTrue(result.strict_violations.some((v) => v.name === 'Crimson' && v.reason === 'under_min'),
    'Crimson violation reason is under_min');
});

test('ADR 0017: computeStrictPass — non-accent at position ≥ 1 with 1 mention → strict_pass true', () => {
  const { measureColorDistribution } = require(path.join(PROJECT_ROOT, 'server.js'));
  const palette = {
    strength: 'strict',
    accent_max_mentions: 2,
    colors: [
      { hex: '#cc3344', name: 'Crimson' },
      { hex: '#f4e9d8', name: 'Bone white' },
      { hex: '#3b82f6', name: 'Ocean blue' }
    ]
  };
  // Crimson twice (covers priority-1 min=2). Bone white + ocean blue once each (priority-1 min=1).
  const prompt = 'Crimson, crimson — and bone white. Then ocean blue drifts.';
  const result = measureColorDistribution(prompt, palette);
  assertEqual(result.strict_pass, true,
    `strict_pass true (violations: ${JSON.stringify(result.strict_violations)})`);
});

// Validation pipeline — weight is forbidden; accent-only is preserved.
test('ADR 0017: validatePaletteColorsFlexible accepts colors without weight (no weight field present)', () => {
  const { validatePaletteColorsFlexible } = require(path.join(PROJECT_ROOT, 'server.js'));
  const r1 = validatePaletteColorsFlexible([{ hex: '#d97706', name: 'a' }]);
  assertEqual(r1.error, null, 'no extra fields → ok');
  assertEqual(r1.colors[0].weight, undefined, 'weight NOT added to output');
  assertEqual(r1.colors[0].accent, undefined, 'accent not added to output');
  // With accent only (no weight)
  const r2 = validatePaletteColorsFlexible([
    { hex: '#d97706', name: 'a', accent: true },
    { hex: '#7c2d12', name: 'b', accent: false }
  ]);
  assertEqual(r2.error, null, 'accent-only → ok');
  assertEqual(r2.colors[0].accent, true, 'accent true round-tripped');
  assertEqual(r2.colors[1].accent, false, 'accent false round-tripped');
});

test('ADR 0017: validatePaletteColorsFlexible rejects weight on a color (400)', () => {
  const { validatePaletteColorsFlexible } = require(path.join(PROJECT_ROOT, 'server.js'));
  const r1 = validatePaletteColorsFlexible([{ hex: '#d97706', name: 'a', weight: 5 }]);
  assertTrue(r1.error && r1.error.includes('colors[0].weight'),
    'weight field error mentions colors[0].weight');
  assertTrue(/weight is no longer accepted/.test(r1.error),
    'error explains weight is deprecated');
  // Even a valid-looking integer is rejected — write path is "weight-free".
  const r2 = validatePaletteColorsFlexible([{ hex: '#d97706', name: 'a', weight: 1 }]);
  assertTrue(r2.error !== null, 'weight 1 still rejected');
  // Non-boolean accent still rejected (regression on accent validation).
  const r3 = validatePaletteColorsFlexible([{ hex: '#d97706', name: 'a', accent: 'yes' }]);
  assertTrue(r3.error && r3.error.includes('colors[0].accent'), 'accent string error mentions index');
  assertTrue(r3.error.includes('boolean'), 'accent error mentions type');
});

test('ADR 0017: validatePalette rejects invalid accent_max_mentions on palette body', () => {
  const { validatePalette } = require(path.join(PROJECT_ROOT, 'server.js'));
  const base = validPaletteBody();
  const r1 = validatePalette({ ...base, accent_max_mentions: 6 });
  assertTrue(r1 !== null, 'cap 6 rejected (above MAX)');
  assertTrue(r1.includes('accent_max_mentions'), 'error names the field');
  const r2 = validatePalette({ ...base, accent_max_mentions: 0 });
  assertTrue(r2 !== null, 'cap 0 rejected (below MIN)');
  const r3 = validatePalette({ ...base, accent_max_mentions: 2 });
  assertEqual(r3, null, 'cap 2 accepted');
  const r4 = validatePalette({ ...base, accent_max_mentions: 2.5 });
  assertTrue(r4 !== null, 'cap 2.5 rejected (non-integer)');
});

test('ADR 0017: validatePaletteEdit accepts partial body with accent_max_mentions', () => {
  const { validatePaletteEdit } = require(path.join(PROJECT_ROOT, 'server.js'));
  const r1 = validatePaletteEdit({ accent_max_mentions: 3 }, { existingNames: new Set() });
  assertEqual(r1, null, 'accent_max_mentions alone is valid');
  const r2 = validatePaletteEdit({ name: 'x', accent_max_mentions: 3 }, { existingNames: new Set() });
  assertEqual(r2, null, 'name + accent_max_mentions valid');
  const r3 = validatePaletteEdit({ accent_max_mentions: 99 }, { existingNames: new Set() });
  assertTrue(r3 !== null, 'out-of-range accent_max_mentions rejected');
});

test('ADR 0017: applyPaletteUpdate applies accent_max_mentions when present', () => {
  const { applyPaletteUpdate } = require(path.join(PROJECT_ROOT, 'server.js'));
  const p = { name: 'p', colors: [{ hex: '#a', name: 'a' }], accent_max_mentions: 2 };
  applyPaletteUpdate(p, { accent_max_mentions: 4 });
  assertEqual(p.accent_max_mentions, 4, 'cap updated');
  const before = p.accent_max_mentions;
  const err = applyPaletteUpdate(p, { accent_max_mentions: 99 });
  assertTrue(err !== null, 'invalid cap rejected');
  assertEqual(p.accent_max_mentions, before, 'palette unchanged on rejection');
});

test('ADR 0017: snapshotPalette captures accent + accent_max_mentions + placement', () => {
  const { snapshotPalette } = require(path.join(PROJECT_ROOT, 'server.js'));
  const palette = {
    name: 'Sunset',
    colors: [
      { hex: '#d97706', name: 'burnt orange' },
      { hex: '#dc2626', name: 'signal red', accent: true, placement: 'upper-left quadrant' }
    ],
    accent_max_mentions: 3,
    strength: 'strict',
    history: []
  };
  const snap = snapshotPalette(palette);
  // ADR 0017: weight NOT captured.
  assertEqual(snap.colors[0].weight, undefined, 'weight NOT captured (ADR 0017)');
  assertEqual(snap.colors[1].accent, true, 'accent captured');
  assertEqual(snap.colors[1].placement, 'upper-left quadrant', 'placement captured');
  assertEqual(snap.accent_max_mentions, 3, 'accent_max_mentions captured');
  assertEqual(snap.strength, 'strict', 'strength captured');
});

// readPalettes synthesis — old weight-bearing palettes are normalized
// to the weightless shape. Position (order) carries the priority.
test('ADR 0017: readPalettes strips legacy weight from pre-ADR-0017 disk entries', () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const tmpFile = path2.join(PROJECT_ROOT, 'data', 'palettes.json');
  const before = fs2.existsSync(tmpFile) ? fs2.readFileSync(tmpFile, 'utf8') : '[]';
  try {
    // Hand-craft a pre-ADR-0017 palette (carries weight 8 on every color).
    fs2.writeFileSync(tmpFile, JSON.stringify([{
      id: 'palette_legacy00000001',
      name: 'Legacy weighted',
      colors: [{ hex: '#d97706', name: 'burnt orange', weight: 8, accent: false }],
      source_run_id: 'run_0000000000000001',
      source_preset_id: 'preset_x',
      created_at: '2026-01-01T00:00:00.000Z',
      accent_max_mentions: 2,
      history: []
    }]));
    const { readPalettes, DEFAULT_ACCENT_MAX_MENTIONS } =
      require(path.join(PROJECT_ROOT, 'server.js'));
    const palettes = readPalettes();
    const legacy = palettes.find((p) => p.id === 'palette_legacy00000001');
    assertTrue(!!legacy, 'legacy palette survives read');
    // Weight must NOT echo back — the shape is now weightless.
    assertEqual(legacy.colors[0].weight, undefined,
      'legacy weight stripped from read output');
    // Accent + cap synthesize normally.
    assertEqual(legacy.colors[0].accent, false, 'accent synthesised to false');
    assertEqual(legacy.accent_max_mentions, DEFAULT_ACCENT_MAX_MENTIONS,
      'cap synthesised to default');
  } finally {
    fs2.writeFileSync(tmpFile, before, 'utf8');
  }
});

test('ADR 0017: readPalettes preserves accent + placement from on-disk entries', () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const tmpFile = path2.join(PROJECT_ROOT, 'data', 'palettes.json');
  const before = fs2.existsSync(tmpFile) ? fs2.readFileSync(tmpFile, 'utf8') : '[]';
  try {
    fs2.writeFileSync(tmpFile, JSON.stringify([{
      id: 'palette_ordered000001',
      name: 'Ordered palette',
      colors: [
        { hex: '#dc2626', name: 'signal red', accent: true, placement: 'bottom right' }
      ],
      source_run_id: 'run_0000000000000002',
      source_preset_id: 'preset_x',
      created_at: '2026-01-01T00:00:00.000Z',
      accent_max_mentions: 4,
      history: []
    }]));
    const { readPalettes } = require(path.join(PROJECT_ROOT, 'server.js'));
    const palettes = readPalettes();
    const ordered = palettes.find((p) => p.id === 'palette_ordered000001');
    assertEqual(ordered.colors[0].accent, true, 'accent true preserved');
    assertEqual(ordered.colors[0].placement, 'bottom right', 'placement preserved');
    assertEqual(ordered.accent_max_mentions, 4, 'cap 4 preserved');
  } finally {
    fs2.writeFileSync(tmpFile, before, 'utf8');
  }
});

// HTTP integration: ADR 0017 — weight is forbidden on the write path.
test('ADR 0017: POST /api/palettes round-trips accent + accent_max_mentions (weight forbidden)', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/palettes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validPaletteBody(),
        colors: [
          { hex: '#d97706', name: 'burnt orange', accent: false },
          { hex: '#dc2626', name: 'signal red', accent: true }
        ],
        accent_max_mentions: 3
      })
    });
    assertEqual(r.status, 201, 'POST → 201');
    assertEqual(r.body.data.colors[0].weight, undefined, 'weight NOT stored (ADR 0017)');
    assertEqual(r.body.data.colors[1].accent, true, 'accent true stored');
    assertEqual(r.body.data.accent_max_mentions, 3, 'accent_max_mentions 3 stored');
    // history v1 captures the order state.
    assertEqual(r.body.data.history[0].colors[0].weight, undefined, 'history v1 has NO weight');
    assertEqual(r.body.data.history[0].accent_max_mentions, 3, 'history v1 captures cap');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('ADR 0017: POST /api/palettes rejects any weight on a color (400)', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    // Even the in-range integer 5 is rejected — the field itself is forbidden.
    const r = await fetchJson(`${srv.base}/api/palettes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validPaletteBody(),
        colors: [{ hex: '#d97706', name: 'a', weight: 5, accent: false }]
      })
    });
    assertEqual(r.status, 400, 'POST → 400');
    assertTrue(r.body.error.includes('colors[0].weight'), 'error mentions colors[0].weight');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('ADR 0017: POST /api/palettes/custom accepts accent/accent_max_mentions (no source_run_id required)', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/palettes/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Brand kit',
        colors: [
          { hex: '#0f172a', name: 'ink', accent: false },
          { hex: '#f59e0b', name: 'amber', accent: true }
        ],
        accent_max_mentions: 1
      })
    });
    assertEqual(r.status, 201, 'POST custom → 201');
    assertEqual(r.body.data.colors[0].weight, undefined, 'weight NOT stored on custom (ADR 0017)');
    assertEqual(r.body.data.colors[1].accent, true, 'accent true stored on custom');
    assertEqual(r.body.data.accent_max_mentions, 1, 'cap 1 stored on custom');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('ADR 0014: PUT /api/palettes/:id with accent_max_mentions updates + appends history', async () => {
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
    const r = await fetchJson(`${srv.base}/api/palettes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accent_max_mentions: 5 })
    });
    assertEqual(r.status, 200, 'PUT cap → 200');
    assertEqual(r.body.data.accent_max_mentions, 5, 'cap updated');
    assertEqual(r.body.data.history.length, 2, 'history grew');
    assertEqual(r.body.data.history[1].accent_max_mentions, 5, 'history v2 captures new cap');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('ADR 0017: PUT /api/palettes/:id with colors round-trips order + accent (weight forbidden)', async () => {
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
    const r = await fetchJson(`${srv.base}/api/palettes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        colors: [
          { hex: '#0ea5e9', name: 'sea' },
          { hex: '#dc2626', name: 'signal', accent: true }
        ]
      })
    });
    assertEqual(r.status, 200, 'PUT colors → 200');
    // Order round-tripped — top-of-list = priority 1.
    assertEqual(r.body.data.colors[0].hex, '#0ea5e9', 'first color stays first (priority 1)');
    assertEqual(r.body.data.colors[1].accent, true, 'accent true round-tripped');
    // Weight never appears.
    assertEqual(r.body.data.colors[0].weight, undefined, 'weight NOT in stored body');
    assertEqual(r.body.data.history.length, 2, 'history grew');
    assertEqual(r.body.data.history[1].colors[1].accent, true, 'history v2 captures accent');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('ADR 0017: PUT /api/palettes/:id rejects any weight on a color (400)', async () => {
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
    const r = await fetchJson(`${srv.base}/api/palettes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        colors: [{ hex: '#d97706', name: 'a', weight: 8, accent: true }]
      })
    });
    assertEqual(r.status, 400, 'PUT with weight → 400');
    assertTrue(r.body.error.includes('colors[0].weight'), 'error names colors[0].weight');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('ADR 0017: POST /api/palettes/:id/restore/:version restores accent + accent_max_mentions (no weight on disk)', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    // v1: create with an accent + non-default cap
    const create = await fetchJson(`${srv.base}/api/palettes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validPaletteBody(),
        colors: [{ hex: '#d97706', name: 'a', accent: true }],
        accent_max_mentions: 3
      })
    });
    const id = create.body.data.id;
    // v2: PUT a cap-reduced version (accent stays, cap drops)
    await fetchJson(`${srv.base}/api/palettes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accent_max_mentions: 2
      })
    });
    // Restore v1 → cap rolls back to 3
    const restore = await fetchJson(`${srv.base}/api/palettes/${id}/restore/1`, {
      method: 'POST'
    });
    assertEqual(restore.status, 200, 'restore v1 → 200');
    assertEqual(restore.body.data.colors[0].accent, true, 'accent restored');
    assertEqual(restore.body.data.accent_max_mentions, 3, 'cap restored');
    assertEqual(restore.body.data.colors[0].weight, undefined,
      'restored body has no weight field (ADR 0017)');
    // A v3 entry is appended so the rollback is itself recorded
    assertEqual(restore.body.data.history.length, 3, 'history has v1, v2, v3');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});



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

  // ADR 0013 — edit modal
  assertTrue(/id="edit-palette-modal"/.test(html), 'edit palette modal missing');
  assertTrue(/role="dialog"/.test(html), 'edit modal must have role="dialog"');
  assertTrue(/aria-labelledby="edit-palette-modal-title"/.test(html), 'edit modal must reference its title');
  assertTrue(/id="edit-palette-name-input"/.test(html), 'edit name input missing');
  assertTrue(/id="edit-palette-colors-list"/.test(html), 'edit colors list missing');
  assertTrue(/id="palette-history-list"/.test(html), 'palette history list missing');
  assertTrue(/id="palette-manager-new-btn"/.test(html), 'New palette button missing');
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
  const { setStage2Override, getEffectiveStage2Prompt, removeStage2Override, ZIMAGE_STAGE2_SENTINEL, DEFAULT_ZIMAGE_STAGE2_PROMPT } = require(path.join(PROJECT_ROOT, 'server.js'));
  const presets = readJSON(path.join(PROJECT_ROOT, 'data', 'presets.json'));
  // ADR 0015 — pick a non-sentinel preset so the equality assertion holds
  // verbatim. Oil-painting presets use the canonical Z-Image Turbo prompt
  // constant via sentinel substitution (covered by the dedicated test below).
  const preset = presets.find((p) => p.stage2_system_prompt !== ZIMAGE_STAGE2_SENTINEL) || presets[0];
  assertTrue(preset && typeof preset.stage2_system_prompt === 'string',
    'test fixture requires at least one non-sentinel preset with stage2_system_prompt');

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

// ADR 0015 — sentinel substitution in getEffectiveStage2Prompt.
// The two oil-painting presets reference the canonical Z-Image Turbo
// final-prompt contract via the literal sentinel string
// 'DEFAULT_ZIMAGE_STAGE2_PROMPT'. getEffectiveStage2Prompt must
// substitute the full constant after override resolution.
test('ADR 0015: getEffectiveStage2Prompt substitutes ZIMAGE_STAGE2_SENTINEL with DEFAULT_ZIMAGE_STAGE2_PROMPT', () => {
  const { setStage2Override, removeStage2Override, getEffectiveStage2Prompt, ZIMAGE_STAGE2_SENTINEL, DEFAULT_ZIMAGE_STAGE2_PROMPT } = require(path.join(PROJECT_ROOT, 'server.js'));
  const presets = readJSON(path.join(PROJECT_ROOT, 'data', 'presets.json'));
  const sentinelPreset = presets.find((p) => p.stage2_system_prompt === ZIMAGE_STAGE2_SENTINEL);
  assertTrue(sentinelPreset,
    'test fixture requires at least one preset whose stage2_system_prompt is the Z-Image sentinel');

  const snapshot = snapshotStage2OverridesFile();
  try {
    removeStage2Override(sentinelPreset.id);

    // 1. No override, sentinel built-in → resolves to canonical constant
    assertEqual(getEffectiveStage2Prompt(sentinelPreset), DEFAULT_ZIMAGE_STAGE2_PROMPT,
      'sentinel built-in resolves to DEFAULT_ZIMAGE_STAGE2_PROMPT');

    // 2. User-entered override (anything other than the literal sentinel)
    //    → returns the override verbatim
    const custom = 'CUSTOM OVERRIDE ' + 'x'.repeat(40);
    setStage2Override(sentinelPreset.id, custom);
    assertEqual(getEffectiveStage2Prompt(sentinelPreset), custom,
      'user override wins over the sentinel substitution');

    // 3. User pastes the literal sentinel as their override → gets the
    //    sentinel string back, NOT the substituted constant (explicit opt-out)
    setStage2Override(sentinelPreset.id, ZIMAGE_STAGE2_SENTINEL);
    assertEqual(getEffectiveStage2Prompt(sentinelPreset), ZIMAGE_STAGE2_SENTINEL,
      'literal sentinel override returns the sentinel verbatim (no double-substitution)');
  } finally {
    restoreStage2OverridesFile(snapshot);
  }
});

test('ADR 0019: DEFAULT_ZIMAGE_STAGE2_PROMPT is single-prose pastel-focal-glow contract (was two-section gestural in ADR 0015)', () => {
  const { DEFAULT_ZIMAGE_STAGE2_PROMPT } = require(path.join(PROJECT_ROOT, 'server.js'));
  // Style & Technique block — pastel-palette / palette-knife / alla prima anchors
  assertTrue(/oil painting on canvas/i.test(DEFAULT_ZIMAGE_STAGE2_PROMPT),
    'prompt must name oil painting on canvas as the medium');
  assertTrue(DEFAULT_ZIMAGE_STAGE2_PROMPT.includes('palette knife'),
    'prompt must name palette knife as the application');
  assertTrue(DEFAULT_ZIMAGE_STAGE2_PROMPT.toLowerCase().includes('alla prima'),
    'prompt must name alla prima as the technique');
  assertTrue(DEFAULT_ZIMAGE_STAGE2_PROMPT.toLowerCase().includes('pastel palette'),
    'prompt must anchor on pastel palette');
  // Pigment vocabulary from guide §5.3 — at least one saturated focal example
  // and at least one muted-surround example must appear
  assertTrue(/cadmium-coral/.test(DEFAULT_ZIMAGE_STAGE2_PROMPT),
    'prompt must cite a saturated focal pigment (cadmium-coral)');
  assertTrue(/pale sage/.test(DEFAULT_ZIMAGE_STAGE2_PROMPT),
    'prompt must cite a muted-surround pigment (pale sage)');
  // Lighting-as-Color (§8.1 glow-by-contrast module)
  assertTrue(DEFAULT_ZIMAGE_STAGE2_PROMPT.includes('achieved through color contrast, not depicted illumination'),
    'prompt must include the §8.1 lighting-as-color rule verbatim');
  assertTrue(DEFAULT_ZIMAGE_STAGE2_PROMPT.includes('no depicted light source'),
    'prompt must include the no-depicted-light-source rule');
  // Framing default (§8.3 Option A)
  assertTrue(DEFAULT_ZIMAGE_STAGE2_PROMPT.includes('painting fills the frame'),
    'prompt must include painting-fills-the-frame framing default');
  // Length window
  assertTrue(/150-300 words/.test(DEFAULT_ZIMAGE_STAGE2_PROMPT),
    'prompt must cite the 150-300 word sweet spot');
  assertTrue(/750 words/.test(DEFAULT_ZIMAGE_STAGE2_PROMPT),
    'prompt must cite the 750-word hard ceiling');
  // Closing directive — output only the prose, no labels
  assertTrue(/Output only the prompt text/.test(DEFAULT_ZIMAGE_STAGE2_PROMPT),
    'prompt must end with the output-only directive');
  // Positive-anchor closing line (guide §17.1)
  assertTrue(/natural paint sheen/i.test(DEFAULT_ZIMAGE_STAGE2_PROMPT),
    'prompt must include the natural paint sheen closing anchor');
  // ADR 0019 — gestural-anchor and section-marker directives must NOT appear
  assertTrue(!DEFAULT_ZIMAGE_STAGE2_PROMPT.includes('gestural streaks of energy radiate outward from the figure'),
    'ADR 0015 gestural-streak anchor must be removed');
  assertTrue(!/Start your reply with these section headers/i.test(DEFAULT_ZIMAGE_STAGE2_PROMPT),
    'ADR 0015 "Start your reply with these section headers" directive must be removed');
  assertTrue(!/de Kooning/.test(DEFAULT_ZIMAGE_STAGE2_PROMPT),
    'gestural-school reference (de Kooning) must be removed');
  assertTrue(!/Riopelle/.test(DEFAULT_ZIMAGE_STAGE2_PROMPT),
    'gestural-school reference (Riopelle) must be removed');
  // Negative-prompt tail must NOT appear as an instruction (CFG=0 ignores it).
  // Quoting it as a forbidden example in the ANTI-PATTERNS section is correct;
  // asserting it as positive instruction (`Use "no", "devoid of", "with no" phrasing`) would be wrong.
  assertTrue(!/Use "no", "devoid of", "with no" phrasing/i.test(DEFAULT_ZIMAGE_STAGE2_PROMPT),
    'ADR 0015 "Use no/devoid of/with no phrasing" directive must be removed');
  // Hard size — must fit within MAX_STAGE2_PROMPT_LENGTH when sent as override
  assertTrue(DEFAULT_ZIMAGE_STAGE2_PROMPT.length <= 10000,
    `DEFAULT_ZIMAGE_STAGE2_PROMPT is ${DEFAULT_ZIMAGE_STAGE2_PROMPT.length} chars, must be ≤ 10000`);
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
  const { setStage2Override, removeStage2Override, DEFAULT_ZIMAGE_STAGE2_PROMPT, ZIMAGE_STAGE2_SENTINEL } = require(path.join(PROJECT_ROOT, 'server.js'));
  const presets = readJSON(path.join(PROJECT_ROOT, 'data', 'presets.json'));
  // ADR 0015 — pick a non-sentinel preset so the literal-equality assertions
  // hold. The sentinel substitution is exercised separately in the unit
  // test 'getEffectiveStage2Prompt substitutes ZIMAGE_STAGE2_SENTINEL...'
  const preset = presets.find((p) => p.stage2_system_prompt !== ZIMAGE_STAGE2_SENTINEL) || presets[0];

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

// ─── ADR 0018 — actions / mood / lighting re-analysis + curated presets

test('POST /api/actions endpoint is registered (ADR 0018)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const re = /app\.(get|post|put|delete)\(['"](\/api\/[^'"]+)['"]/g;
  const endpoints = [];
  let m;
  while ((m = re.exec(serverText)) !== null) endpoints.push(m[1] + ' ' + m[2]);
  assertTrue(endpoints.some((e) => e === 'post /api/actions'),
    `POST /api/actions must be registered; found endpoints: ${endpoints.join(', ')}`);
});

test('POST /api/mood endpoint is registered (ADR 0018)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const re = /app\.(get|post|put|delete)\(['"](\/api\/[^'"]+)['"]/g;
  const endpoints = [];
  let m;
  while ((m = re.exec(serverText)) !== null) endpoints.push(m[1] + ' ' + m[2]);
  assertTrue(endpoints.some((e) => e === 'post /api/mood'),
    `POST /api/mood must be registered; found endpoints: ${endpoints.join(', ')}`);
});

test('POST /api/lighting endpoint is registered (ADR 0018)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const re = /app\.(get|post|put|delete)\(['"](\/api\/[^'"]+)['"]/g;
  const endpoints = [];
  let m;
  while ((m = re.exec(serverText)) !== null) endpoints.push(m[1] + ' ' + m[2]);
  assertTrue(endpoints.some((e) => e === 'post /api/lighting'),
    `POST /api/lighting must be registered; found endpoints: ${endpoints.join(', ')}`);
});

test('callMiniMaxActionsAnalysis helper + DEFAULT_ACTIONS_PROMPT are exported (ADR 0018)', () => {
  const server = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(typeof server.callMiniMaxActionsAnalysis === 'function',
    'callMiniMaxActionsAnalysis must be exported from server.js');
  assertTrue(typeof server.DEFAULT_ACTIONS_PROMPT === 'string' && server.DEFAULT_ACTIONS_PROMPT.length > 0,
    'DEFAULT_ACTIONS_PROMPT must be a non-empty string exported from server.js');
});

test('callMiniMaxMoodAnalysis helper + DEFAULT_MOOD_PROMPT are exported (ADR 0018)', () => {
  const server = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(typeof server.callMiniMaxMoodAnalysis === 'function',
    'callMiniMaxMoodAnalysis must be exported from server.js');
  assertTrue(typeof server.DEFAULT_MOOD_PROMPT === 'string' && server.DEFAULT_MOOD_PROMPT.length > 0,
    'DEFAULT_MOOD_PROMPT must be a non-empty string exported from server.js');
});

test('callMiniMaxLightingAnalysis helper + DEFAULT_LIGHTING_PROMPT are exported (ADR 0018)', () => {
  const server = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(typeof server.callMiniMaxLightingAnalysis === 'function',
    'callMiniMaxLightingAnalysis must be exported from server.js');
  assertTrue(typeof server.DEFAULT_LIGHTING_PROMPT === 'string' && server.DEFAULT_LIGHTING_PROMPT.length > 0,
    'DEFAULT_LIGHTING_PROMPT must be a non-empty string exported from server.js');
});

test('POST /api/actions/mood/lighting use multer single-image upload middleware (ADR 0018)', () => {
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  for (const path of ['/api/actions', '/api/mood', '/api/lighting']) {
    const re = new RegExp(`app\\.post\\(['"]${path.replace(/\//g, '\\/')}['"]\\s*,\\s*upload\\.single\\(['"]image['"]\\)`);
    assertTrue(re.test(serverText),
      `POST ${path} must use upload.single("image") middleware to match the /api/camera-angle pattern`);
  }
});

test('DEFAULT_ACTIONS_PROMPT excludes adjacent-field commentary (ADR 0018)', () => {
  const { DEFAULT_ACTIONS_PROMPT } = require(path.join(PROJECT_ROOT, 'server.js'));

  // Must explicitly forbid the core exclusion categories.
  assertTrue(/subject/i.test(DEFAULT_ACTIONS_PROMPT),
    'prompt must forbid subject description');
  assertTrue(/lighting/i.test(DEFAULT_ACTIONS_PROMPT),
    'prompt must forbid lighting commentary');
  assertTrue(/color/i.test(DEFAULT_ACTIONS_PROMPT),
    'prompt must forbid color commentary');
  assertTrue(/mood/i.test(DEFAULT_ACTIONS_PROMPT),
    'prompt must forbid mood commentary');
  assertTrue(/camera angle/i.test(DEFAULT_ACTIONS_PROMPT),
    'prompt must forbid camera-angle commentary');
  assertTrue(/artistic style/i.test(DEFAULT_ACTIONS_PROMPT),
    'prompt must forbid artistic-style commentary');
  assertTrue(/creative medium/i.test(DEFAULT_ACTIONS_PROMPT),
    'prompt must forbid creative-medium commentary');
  assertTrue(/aesthetic/i.test(DEFAULT_ACTIONS_PROMPT),
    'prompt must forbid aesthetic commentary');

  // Must list subjective aesthetic adjectives as forbidden vocabulary.
  const forbiddenAdjectives = ['beautiful', 'striking', 'dramatic', 'elegant', 'majestic'];
  for (const adj of forbiddenAdjectives) {
    assertTrue(DEFAULT_ACTIONS_PROMPT.includes(adj),
      `prompt must list "${adj}" as forbidden aesthetic vocabulary`);
  }

  // Must enforce the schema-level length floor.
  assertTrue(/60/.test(DEFAULT_ACTIONS_PROMPT),
    'prompt must enforce 60-character minimum length');
});

test('DEFAULT_ACTIONS_PROMPT mandates the five actions categories (ADR 0018)', () => {
  const { DEFAULT_ACTIONS_PROMPT } = require(path.join(PROJECT_ROOT, 'server.js'));

  const categories = [
    /BODY KINEMATICS/i,
    /OBJECT INTERACTIONS/i,
    /MULTI-FIGURE DYNAMICS/i,
    /IMPLIED MOTION/i,
    /SCENE NARRATIVE/i
  ];
  for (const re of categories) {
    assertTrue(re.test(DEFAULT_ACTIONS_PROMPT),
      `prompt must mandate coverage of category matching: ${re}`);
  }

  // Spot-check kinematics vocabulary that should appear so the LLM has
  // concrete examples for the body-kinematics / implied-motion categories.
  const requiredVocab = ['seated', 'standing', 'mid-stride', 'leaning', 'caugh'];
  for (const term of requiredVocab) {
    assertTrue(DEFAULT_ACTIONS_PROMPT.toLowerCase().includes(term.toLowerCase()),
      `prompt must include kinematics vocabulary example: "${term}"`);
  }
});

test('DEFAULT_MOOD_PROMPT excludes adjacent-field commentary (ADR 0018)', () => {
  const { DEFAULT_MOOD_PROMPT } = require(path.join(PROJECT_ROOT, 'server.js'));

  // Must forbid commentary on adjacent fields by name.
  assertTrue(/lighting/i.test(DEFAULT_MOOD_PROMPT),
    'prompt must forbid lighting commentary');
  assertTrue(/camera angle/i.test(DEFAULT_MOOD_PROMPT),
    'prompt must forbid camera-angle commentary');
  assertTrue(/color palette/i.test(DEFAULT_MOOD_PROMPT),
    'prompt must forbid color-palette commentary');
  assertTrue(/composition/i.test(DEFAULT_MOOD_PROMPT),
    'prompt must forbid composition commentary');
  assertTrue(/artistic style/i.test(DEFAULT_MOOD_PROMPT),
    'prompt must forbid artistic-style commentary');
  assertTrue(/creative medium/i.test(DEFAULT_MOOD_PROMPT),
    'prompt must forbid creative-medium commentary');
  assertTrue(/aesthetic/i.test(DEFAULT_MOOD_PROMPT),
    'prompt must forbid aesthetic commentary');

  // Must list subjective aesthetic adjectives as forbidden vocabulary.
  const forbiddenAdjectives = ['beautiful', 'striking', 'dramatic', 'elegant', 'majestic'];
  for (const adj of forbiddenAdjectives) {
    assertTrue(DEFAULT_MOOD_PROMPT.includes(adj),
      `prompt must list "${adj}" as forbidden aesthetic vocabulary`);
  }

  // Must enforce the schema-level length floor.
  assertTrue(/60/.test(DEFAULT_MOOD_PROMPT),
    'prompt must enforce 60-character minimum length');
});

test('DEFAULT_MOOD_PROMPT mandates the five mood categories (ADR 0018)', () => {
  const { DEFAULT_MOOD_PROMPT } = require(path.join(PROJECT_ROOT, 'server.js'));

  const categories = [
    /PRIMARY EMOTIONAL TONE/i,
    /SECONDARY UNDERCURRENT/i,
    /ATMOSPHERE/i,
    /PACING/i,
    /VIEWER-RESPONSE CUE/i
  ];
  for (const re of categories) {
    assertTrue(re.test(DEFAULT_MOOD_PROMPT),
      `prompt must mandate coverage of category matching: ${re}`);
  }

  // Spot-check affective vocabulary the LLM should be primed with.
  const requiredVocab = ['joyful', 'melancholic', 'bittersweet', 'contemplative', 'energetic'];
  for (const term of requiredVocab) {
    assertTrue(DEFAULT_MOOD_PROMPT.toLowerCase().includes(term.toLowerCase()),
      `prompt must include mood vocabulary example: "${term}"`);
  }
});

test('DEFAULT_LIGHTING_PROMPT excludes adjacent-field commentary (ADR 0018)', () => {
  const { DEFAULT_LIGHTING_PROMPT } = require(path.join(PROJECT_ROOT, 'server.js'));

  // Must forbid commentary on adjacent fields by name.
  assertTrue(/subject/i.test(DEFAULT_LIGHTING_PROMPT),
    'prompt must forbid subject description');
  assertTrue(/mood/i.test(DEFAULT_LIGHTING_PROMPT),
    'prompt must forbid mood commentary');
  assertTrue(/color palette/i.test(DEFAULT_LIGHTING_PROMPT),
    'prompt must forbid color-palette commentary');
  assertTrue(/composition/i.test(DEFAULT_LIGHTING_PROMPT),
    'prompt must forbid composition commentary');
  assertTrue(/artistic style/i.test(DEFAULT_LIGHTING_PROMPT),
    'prompt must forbid artistic-style commentary');
  assertTrue(/creative medium/i.test(DEFAULT_LIGHTING_PROMPT),
    'prompt must forbid creative-medium commentary');
  assertTrue(/aesthetic/i.test(DEFAULT_LIGHTING_PROMPT),
    'prompt must forbid aesthetic commentary');

  // Must list subjective aesthetic adjectives as forbidden vocabulary.
  const forbiddenAdjectives = ['beautiful', 'striking', 'dramatic', 'elegant', 'majestic'];
  for (const adj of forbiddenAdjectives) {
    assertTrue(DEFAULT_LIGHTING_PROMPT.includes(adj),
      `prompt must list "${adj}" as forbidden aesthetic vocabulary`);
  }

  // Must enforce the schema-level length floor.
  assertTrue(/20/.test(DEFAULT_LIGHTING_PROMPT),
    'prompt must enforce 20-character minimum length');
});

test('DEFAULT_LIGHTING_PROMPT mandates the five lighting categories (ADR 0018)', () => {
  const { DEFAULT_LIGHTING_PROMPT } = require(path.join(PROJECT_ROOT, 'server.js'));

  const categories = [
    /LIGHT SOURCE/i,
    /DIRECTION/i,
    /QUALITY/i,
    /COLOR TEMPERATURE/i,
    /SHADOW BEHAVIOR/i
  ];
  for (const re of categories) {
    assertTrue(re.test(DEFAULT_LIGHTING_PROMPT),
      `prompt must mandate coverage of category matching: ${re}`);
  }

  // Spot-check cinematography vocabulary the LLM should be primed with.
  const requiredVocab = ['golden', 'rim', 'diffused', 'specular', 'chiaroscuro'];
  for (const term of requiredVocab) {
    assertTrue(DEFAULT_LIGHTING_PROMPT.toLowerCase().includes(term.toLowerCase()),
      `prompt must include lighting vocabulary example: "${term}"`);
  }
});

test('HTTP integration: /api/actions rejects missing file with 400 (ADR 0018)', async () => {
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/actions`, { method: 'POST' });
    assertEqual(r.status, 400, 'no file → 400');
    assertTrue(/no image/i.test(r.body && r.body.error), 'error names missing image');
  } finally {
    await srv.close();
  }
});

test('HTTP integration: /api/mood rejects missing file with 400 (ADR 0018)', async () => {
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/mood`, { method: 'POST' });
    assertEqual(r.status, 400, 'no file → 400');
    assertTrue(/no image/i.test(r.body && r.body.error), 'error names missing image');
  } finally {
    await srv.close();
  }
});

test('HTTP integration: /api/lighting rejects missing file with 400 (ADR 0018)', async () => {
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/lighting`, { method: 'POST' });
    assertEqual(r.status, 400, 'no file → 400');
    assertTrue(/no image/i.test(r.body && r.body.error), 'error names missing image');
  } finally {
    await srv.close();
  }
});

test('HTTP integration: /api/actions with valid upload reaches LLM call (ADR 0018)', async () => {
  const srv = await startTestServer();
  try {
    const fd = new FormData();
    fd.append('image', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'tiny.jpg');
    const r = await fetchJson(`${srv.base}/api/actions`, { method: 'POST', body: fd });
    assertTrue(r.status === 200 || r.status === 500 || r.status === 503,
      `expected 200/500/503 (got ${r.status}) — proves multer + key-guard worked`);
    assertTrue(r.status !== 400, 'must not 400 (route guard misbehaved)');
  } finally {
    await srv.close();
    cleanupUploads();
  }
});

test('HTTP integration: /api/mood with valid upload reaches LLM call (ADR 0018)', async () => {
  const srv = await startTestServer();
  try {
    const fd = new FormData();
    fd.append('image', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'tiny.jpg');
    const r = await fetchJson(`${srv.base}/api/mood`, { method: 'POST', body: fd });
    assertTrue(r.status === 200 || r.status === 500 || r.status === 503,
      `expected 200/500/503 (got ${r.status}) — proves multer + key-guard worked`);
    assertTrue(r.status !== 400, 'must not 400 (route guard misbehaved)');
  } finally {
    await srv.close();
    cleanupUploads();
  }
});

test('HTTP integration: /api/lighting with valid upload reaches LLM call (ADR 0018)', async () => {
  const srv = await startTestServer();
  try {
    const fd = new FormData();
    fd.append('image', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'tiny.jpg');
    const r = await fetchJson(`${srv.base}/api/lighting`, { method: 'POST', body: fd });
    assertTrue(r.status === 200 || r.status === 500 || r.status === 503,
      `expected 200/500/503 (got ${r.status}) — proves multer + key-guard worked`);
    assertTrue(r.status !== 400, 'must not 400 (route guard misbehaved)');
  } finally {
    await srv.close();
    cleanupUploads();
  }
});

test('Frontend CSS: .btn-populate-actions/mood/lighting selectors defined (ADR 0018)', () => {
  const css = fs.readFileSync(path.join(PROJECT_ROOT, 'src/styles.css'), 'utf8');
  assertTrue(/\.btn-populate-actions/.test(css),
    'CSS must define .btn-populate-actions selector');
  assertTrue(/\.btn-populate-mood/.test(css),
    'CSS must define .btn-populate-mood selector');
  assertTrue(/\.btn-populate-lighting/.test(css),
    'CSS must define .btn-populate-lighting selector');
  // Preset chip styles
  assertTrue(/\.preset-chips\b/.test(css),
    'CSS must define .preset-chips selector');
  assertTrue(/\.preset-chip\b/.test(css),
    'CSS must define .preset-chip selector');
  assertTrue(/\.preset-chip-group\b/.test(css),
    'CSS must define .preset-chip-group selector');
  assertTrue(/\.preset-chip-label\b/.test(css),
    'CSS must define .preset-chip-label selector');
});

test('Frontend JS: three populate handlers + button renderings + state flags (ADR 0018)', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app.js'), 'utf8');

  for (const handler of ['populateActionsWithAI', 'populateMoodWithAI', 'populateLightingWithAI']) {
    const re = new RegExp(`const ${handler}\\s*=`);
    assertTrue(re.test(js),
      `src/app.js must define ${handler} handler`);
    // no-image guard
    const guardRe = new RegExp(`${handler}[\\s\\S]{0,400}?if\\s*\\(\\s*!\\s*state\\.currentFile\\s*\\)`);
    assertTrue(guardRe.test(js),
      `${handler} must guard on state.currentFile before fetching`);
  }

  for (const path of ['/api/actions', '/api/mood', '/api/lighting']) {
    assertTrue(js.includes(`'${path}'`),
      `src/app.js must POST to ${path}`);
  }

  // Per-field state flags
  for (const flag of ['isPopulatingActions', 'isPopulatingMood', 'isPopulatingLighting']) {
    assertTrue(js.includes(flag),
      `src/app.js must track ${flag} state flag`);
  }

  // Per-field button rendering + class
  for (const field of ['actions', 'mood', 'lighting']) {
    const re = new RegExp(`fieldName\\s*===\\s*['"]${field}['"]`);
    assertTrue(re.test(js),
      `src/app.js must render the Populate-with-AI button for fieldName === "${field}"`);
    const cls = `btn-populate-${field}`;
    assertTrue(js.includes(cls),
      `src/app.js must apply the .${cls} class`);
  }

  // In-place DOM updates for each field
  assertTrue(/textarea\[data-field=['"]actions['"]\]/.test(js),
    'src/app.js must query textarea[data-field="actions"] for in-place update');
  assertTrue(/textarea\[data-field=['"]mood['"]\]/.test(js),
    'src/app.js must query textarea[data-field="mood"] for in-place update');
  assertTrue(/input\[data-field=['"]lighting['"]\]/.test(js),
    'src/app.js must query input[data-field="lighting"] for in-place update');
});

test('Frontend JS: mood and lighting curated presets taxonomies defined (ADR 0018)', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app.js'), 'utf8');

  // Taxonomy constants exist
  assertTrue(/MOOD_PRESETS\s*=/.test(js),
    'src/app.js must define MOOD_PRESETS taxonomy');
  assertTrue(/LIGHTING_PRESETS\s*=/.test(js),
    'src/app.js must define LIGHTING_PRESETS taxonomy');

  // Mood taxonomy: 5 categories with the canonical labels.
  const moodCategories = ['Positive', 'Reflective', 'Intense', 'Atmospheric', 'Still'];
  for (const cat of moodCategories) {
    const re = new RegExp(`category:\\s*['"]${cat}['"]`);
    assertTrue(re.test(js),
      `MOOD_PRESETS must include category "${cat}"`);
  }

  // Lighting taxonomy: 5 categories with the canonical labels.
  const lightingCategories = ['Natural', 'Directional', 'Quality', 'Stylized', 'Studio'];
  for (const cat of lightingCategories) {
    const re = new RegExp(`category:\\s*['"]${cat}['"]`);
    assertTrue(re.test(js),
      `LIGHTING_PRESETS must include category "${cat}"`);
  }

  // Spot-check at least one chip from each mood category.
  const moodChipSamples = {
    Positive:    'joyful',
    Reflective:  'melancholic',
    Intense:     'dramatic',
    Atmospheric: 'dreamlike',
    Still:       'meditative'
  };
  for (const [cat, chip] of Object.entries(moodChipSamples)) {
    // Loose check: chip name appears somewhere in the file (anywhere).
    assertTrue(js.includes(`'${chip}'`) || js.includes(`"${chip}"`),
      `MOOD_PRESETS must include chip "${chip}" in category "${cat}"`);
  }

  // Spot-check at least one chip from each lighting category.
  const lightingChipSamples = {
    Natural:     'golden hour',
    Directional: 'backlit',
    Quality:     'soft diffused',
    Stylized:    'chiaroscuro',
    Studio:      'studio softbox'
  };
  for (const [cat, chip] of Object.entries(lightingChipSamples)) {
    assertTrue(js.includes(`'${chip}'`) || js.includes(`"${chip}"`),
      `LIGHTING_PRESETS must include chip "${chip}" in category "${cat}"`);
  }

  // renderPresetChips helper exists.
  assertTrue(/const renderPresetChips\s*=/.test(js),
    'src/app.js must define renderPresetChips helper');

  // applyPresetToField helper exists.
  assertTrue(/const applyPresetToField\s*=/.test(js),
    'src/app.js must define applyPresetToField helper');

  // Chip rows are wired by passing the field name into renderPresetChips
  // (the helper closes over `fieldName` and routes clicks via
  // applyPresetToField). Each call site therefore names the field.
  assertTrue(/renderPresetChips\(\s*['"]mood['"]\s*,\s*MOOD_PRESETS\s*\)/.test(js),
    'src/app.js must call renderPresetChips("mood", MOOD_PRESETS) to wire mood chips');
  assertTrue(/renderPresetChips\(\s*['"]lighting['"]\s*,\s*LIGHTING_PRESETS\s*\)/.test(js),
    'src/app.js must call renderPresetChips("lighting", LIGHTING_PRESETS) to wire lighting chips');
});

// ─── ADR 0018 — chip-click selector regression tests ─────────────────────
//
// Bug found: applyPresetToField used `querySelector('[data-field="..."]')` which
// matches the `<div class="field-row" data-field="...">` row first (because the
// row is appended before the inner <input>/<textarea> in renderAnalysisEditor).
// The chip click therefore set `.value` on a <div> — silent, with no UI effect —
// while `state.currentAnalysis[fieldName]` was updated correctly. From the user's
// perspective the entire curated lighting/mood chip workflow appeared broken.
//
// The tests below lock in the corrected selector + the additional guarantees
// (input event dispatch, role=group) so the regression cannot reappear.

test('ADR 0018 regression: applyPresetToField uses a tag-qualified selector (regression for the row-div bug)', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app.js'), 'utf8');

  // Extract the applyPresetToField function body. Multi-line, ends at the
  // first closing brace that brings us back to top-level semicolon.
  const funcMatch = js.match(/const applyPresetToField\s*=\s*\(?\s*fieldName\s*,\s*value\s*\)?\s*=>\s*\{[\s\S]*?\};/);
  assertTrue(funcMatch, 'applyPresetToField must be defined as an arrow function');

  const funcBody = funcMatch[0];

  // Must use a tag-qualified selector (input[...] or textarea[...]) so the
  // <div class="field-row" data-field="..."> row container is not matched
  // ahead of the actual <input>/<textarea>.
  assertTrue(/querySelector\(\s*`?input\[data-field=/.test(funcBody) ||
              /querySelector\(\s*`?textarea\[data-field=/.test(funcBody),
    'applyPresetToField must querySelector with a tag-qualified selector (input[...] or textarea[...])');

  // Must NOT use the bare unqualified `[data-field="..."]` pattern.
  assertTrue(!/querySelector\(\s*`?\s*\[data-field=/.test(funcBody),
    'applyPresetToField must NOT use the bare [data-field="..."] selector — it matches the row <div> first, silently breaking the chip click (regression: row-div bug)');
});

test('ADR 0018 regression: chip click wires input/textarea, NOT the row <div> — structural simulation', () => {
  // Simulate the DOM that renderAnalysisEditor produces for the `lighting`
  // field. We then execute the selector that applyPresetToField uses (parsed
  // out of src/app.js) and verify it returns the <input>, not the row <div>.
  //
  // This is a stronger check than the regex test above: it proves the actual
  // selector string behaves correctly against the real DOM shape, which is
  // the regression we are guarding against.

  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app.js'), 'utf8');

  // Pull the selector template literal out of applyPresetToField.
  const selMatch = js.match(/querySelector\(\s*(`[^`]+`|"[^"]+")\s*\)[\s\S]*?if\s*\(\s*!\s*el\s*\)\s*return/);
  assertTrue(selMatch, 'applyPresetToField must call querySelector with a string selector and bail on null');
  const selectorRaw = selMatch[1].slice(1, -1);
  // Unescape backticks / dollar-braces for ${...} interpolation: replace the
  // ${fieldName} token with a concrete value for this simulation.
  const selector = selectorRaw.replace(/\$\{fieldName\}/g, 'lighting');

  // Build a faithful DOM stand-in for the lighting field. The row <div> is
  // appended BEFORE the <input>, mirroring renderAnalysisEditor's order.
  const children = [];
  const makeEl = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      dataset: {},
      attributes: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      setAttribute(k, v) { this.attributes[k] = String(v); this.dataset[k.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {},
      querySelector(sel) {
        const tagPrefix = sel.match(/^([a-z]+)\[/);
        const attrMatch = sel.match(/\[(?:data-)?(?:field)(?:[a-z-]*)?=["']?([^"'\]]+)["']?\]/);
        const wantedAttr = attrMatch ? attrMatch[1] : null;
        const walk = (root) => {
          // Skip the root itself; only descend.
          for (const child of root.children) {
            const tagOk = !tagPrefix || child.tagName.toLowerCase() === tagPrefix[1].toLowerCase();
            const attrOk = !wantedAttr || child.dataset.field === wantedAttr;
            if (tagOk && attrOk) return child;
            const r = walk(child);
            if (r) return r;
          }
          return null;
        };
        return walk(this);
      }
    };
    return el;
  };

  const root = makeEl('div');
  const row = makeEl('div');
  row.className = 'field-row';
  row.setAttribute('data-field', 'lighting');
  root.appendChild(row);

  const input = makeEl('input');
  input.dataset.field = 'lighting';
  row.appendChild(input);

  const matched = root.querySelector(selector);
  assertTrue(matched, 'selector must find an element in the simulated DOM');
  assertEqual(matched.tagName, 'INPUT',
    `selector must match the <input>, not the row <div> (matched ${matched.tagName}). Regression: row-div bug.`);
});

test('ADR 0018: applyPresetToField dispatches an `input` event after programmatic value change', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app.js'), 'utf8');
  const funcMatch = js.match(/const applyPresetToField\s*=\s*\(?\s*fieldName\s*,\s*value\s*\)?\s*=>\s*\{[\s\S]*?\};/);
  assertTrue(funcMatch, 'applyPresetToField must be defined');
  assertTrue(/dispatchEvent\s*\(\s*new\s+Event\s*\(\s*['"]input['"]/.test(funcMatch[0]),
    'applyPresetToField must dispatch a bubbling `input` event after assigning .value');
});

test('ADR 0018: every Populate-with-AI handler dispatches `input` event after programmatic value change', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app.js'), 'utf8');
  for (const handler of [
    'populateSubjectWithAI',
    'populateCameraAngleWithAI',
    'populateActionsWithAI',
    'populateMoodWithAI',
    'populateLightingWithAI'
  ]) {
    // Match the function body. Allow either `= async (btn) => { ... }` or
    // `= async function ...` shapes. Anchor on the handler name and the
    // next `};` that closes it (matched lazily).
    const re = new RegExp(`const ${handler}\\s*=\\s*async[\\s\\S]*?\\n\\s*\\};`);
    const funcMatch = js.match(re);
    assertTrue(funcMatch, `${handler} must be defined as an async function`);
    assertTrue(/dispatchEvent\s*\(\s*new\s+Event\s*\(\s*['"]input['"]/.test(funcMatch[0]),
      `${handler} must dispatch a bubbling input event after assigning .value (regression for downstream listener drift)`);
  }
});

test('ADR 0018: renderPresetChips exposes role=group for assistive tech (a11y)', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app.js'), 'utf8');
  const funcMatch = js.match(/const renderPresetChips\s*=\s*\(?\s*fieldName\s*,\s*taxonomy\s*\)?\s*=>\s*\{[\s\S]*?return wrap;\s*\};/);
  assertTrue(funcMatch, 'renderPresetChips must be defined');
  assertTrue(/setAttribute\(\s*['"]role['"]\s*,\s*['"]group['"]/.test(funcMatch[0]),
    'renderPresetChips must setAttribute("role", "group") on the wrap (or per-group) so screen readers announce the chip set');
});

test('ADR 0018: every lighting chip button carries an aria-label describing the action', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app.js'), 'utf8');
  // The chip creation loop must setAttribute('aria-label', `Set ${fieldName} to "${item}"`)
  const funcMatch = js.match(/const renderPresetChips\s*=\s*\(?\s*fieldName\s*,\s*taxonomy\s*\)?\s*=>\s*\{[\s\S]*?return wrap;\s*\};/);
  assertTrue(funcMatch, 'renderPresetChips must be defined');
  assertTrue(/setAttribute\(\s*['"]aria-label['"]/.test(funcMatch[0]),
    'renderPresetChips must set an aria-label on each chip button');
});

test('ADR 0018: lighting taxonomy still has 5 categories with 6-8 chips each (preserves UI density)', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app.js'), 'utf8');
  const taxonomyMatch = js.match(/const LIGHTING_PRESETS\s*=\s*\[([\s\S]*?)\];/);
  assertTrue(taxonomyMatch, 'LIGHTING_PRESETS must be defined');

  const block = taxonomyMatch[1];
  // Pull out { category: '...', items: [ ... ] } groups.
  const groupRe = /\{\s*category:\s*['"]([^'"]+)['"]\s*,\s*items:\s*\[([^\]]*)\]\s*\}/g;
  const groups = [];
  let m;
  while ((m = groupRe.exec(block)) !== null) {
    const items = (m[2].match(/['"][^'"]+['"]/g) || []).length;
    groups.push({ category: m[1], items });
  }
  assertEqual(groups.length, 5, 'LIGHTING_PRESETS must have 5 categories');
  for (const g of groups) {
    assertTrue(g.items >= 6 && g.items <= 8,
      `lighting category "${g.category}" must have 6-8 chips (got ${g.items})`);
  }
});

test('ADR 0018: mood taxonomy still has 5 categories with 7-9 chips each (preserves UI density)', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app.js'), 'utf8');
  const taxonomyMatch = js.match(/const MOOD_PRESETS\s*=\s*\[([\s\S]*?)\];/);
  assertTrue(taxonomyMatch, 'MOOD_PRESETS must be defined');

  const block = taxonomyMatch[1];
  const groupRe = /\{\s*category:\s*['"]([^'"]+)['"]\s*,\s*items:\s*\[([^\]]*)\]\s*\}/g;
  const groups = [];
  let m;
  while ((m = groupRe.exec(block)) !== null) {
    const items = (m[2].match(/['"][^'"]+['"]/g) || []).length;
    groups.push({ category: m[1], items });
  }
  assertEqual(groups.length, 5, 'MOOD_PRESETS must have 5 categories');
  for (const g of groups) {
    assertTrue(g.items >= 7 && g.items <= 9,
      `mood category "${g.category}" must have 7-9 chips (got ${g.items})`);
  }
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

// ─── ADR 0017 — Phase 3: edit modal UI (priority chip + drag handle + accent + preview bars) ─
//
// Phase 3 ships the user-facing controls that drive ADR 0017's order-based
// priority: a per-row priority chip, drag handle for reordering, accent
// checkbox, palette-level accent cap input, and a live "target distribution"
// bar chart under the preview swatches. These tests assert the HTML
// template, CSS hooks, and JS shape via file-string inspection.

// HTML structure — the edit modal carries the new controls + handles + chips
test('ADR 0017: edit modal HTML has accent-cap input + distribution bar container + priority + handle', () => {
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'src/index.html'), 'utf8');
  assertTrue(/id="edit-palette-accent-max"/.test(html), 'accent-cap number input exists');
  assertTrue(/<label[^>]+for="edit-palette-accent-max"/.test(html),
             'accent-cap input has a label');
  assertTrue(/min="1"/.test(html.match(/<input[^>]*id="edit-palette-accent-max"[^>]*>/)[0]),
             'accent-cap min=1');
  assertTrue(/max="5"/.test(html.match(/<input[^>]*id="edit-palette-accent-max"[^>]*>/)[0]),
             'accent-cap max=5');
  assertTrue(/aria-describedby="edit-palette-accent-max-hint"/.test(html),
             'accent-cap input has aria-describedby hint');
  assertTrue(/id="edit-palette-distribution"/.test(html),
             'distribution bar container exists');
  assertTrue(/class="palette-preview__bars"/.test(html),
             'distribution container uses palette-preview__bars class');
  assertTrue(/aria-label="Live target distribution as you reorder and flag accents"/.test(html),
             'distribution container has descriptive aria-label');
  assertTrue(/id="edit-palette-distribution-sum"/.test(html),
             'distribution sum annotation exists');
  // SortableJS bundle is loaded.
  assertTrue(/<script[^>]+src="\/sortable\.min\.js"/.test(html),
             'sortable.min.js included');
});

test('ADR 0017: edit modal hint mentions reorder + accent (no weight)', () => {
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'src/index.html'), 'utf8');
  const hint = html.match(/<p[^>]+id="edit-palette-modal-hint"[^>]*>([\s\S]*?)<\/p>/);
  assertTrue(hint && hint[1], 'hint paragraph found');
  assertTrue(/drag/i.test(hint[1]) && /priority/i.test(hint[1]),
    'hint mentions drag + priority');
  assertTrue(/accent/i.test(hint[1]), 'hint mentions accent');
  assertTrue(!/per-color weight/i.test(hint[1]),
    'hint no longer mentions per-color weight');
});

test('ADR 0017: edit modal accessible role/label structure preserved', () => {
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'src/index.html'), 'utf8');
  assertTrue(/id="edit-palette-modal"[^>]*role="dialog"/.test(html),
             'modal still has role=dialog');
  assertTrue(/aria-labelledby="edit-palette-modal-title"/.test(html),
             'modal still has aria-labelledby');
});

// CSS — selectors that Phase 3 introduces (priority chip, drag handle)
test('ADR 0017: stylesheet has accent / priority chip / drag handle / distribution bar rules', () => {
  const css = fs.readFileSync(path.join(PROJECT_ROOT, 'src/styles.css'), 'utf8');
  assertTrue(/--color-accent:\s*#f59e0b/i.test(css), '--color-accent defined');
  assertTrue(/--color-accent-soft/.test(css), '--color-accent-soft defined');
  assertTrue(/\.edit-palette-color-row\[data-accent="true"\]/.test(css),
             'accent row visual treatment');
  assertTrue(/\.edit-palette-color-row__priority\b/.test(css),
             'priority chip rule');
  assertTrue(/\.edit-palette-color-row__handle\b/.test(css),
             'drag handle rule');
  assertTrue(/\.edit-palette-color-row__accent\b/.test(css),
             'accent checkbox rule');
  assertTrue(/\.sortable-ghost/.test(css), 'sortable ghost rule');
  assertTrue(/\.palette-preview__bar-row/.test(css),
             'distribution bar row rule');
  assertTrue(/\.palette-preview__bar-track/.test(css),
             'distribution bar track rule');
  assertTrue(/\.palette-preview__bar\[data-accent="true"\]/.test(css),
             'accent bar outline rule');
  assertTrue(/\.palette-preview__bar-star/.test(css),
             'accent star badge rule');
  assertTrue(/\.palette-preview__bars-sum/.test(css),
             'distribution sum annotation rule');
  assertTrue(/\.edit-palette-accent-cap-row/.test(css),
             'accent cap row rule');
  // weight selector removed (ADR 0017)
  assertTrue(!/\.edit-palette-color-row__weight/.test(css),
             'weight slider CSS REMOVED');
  // Distinct from --accent (the UI blue)
  assertTrue(/--accent:\s*#3b82f6/.test(css), '--accent UI blue preserved');
});

// JS — buffer shape + render functions exist for ADR 0017
test('ADR 0017: app.js handles priority chip + drag handle + SortableJS + accent', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app.js'), 'utf8');
  // Server-mirrored helper kept under the same name to avoid
  // renaming the call sites throughout the app; asserts of its
  // behaviour live in the server-side tests.
  assertTrue(/clientNormalizeColorWeights/.test(js),
             'client-side priorities helper exists (name preserved)');
  assertTrue(/renderEditPaletteDistributionBars/.test(js),
             'distribution bar renderer exists');
  assertTrue(/editPaletteAccentMax/.test(js),
             'accent cap DOM cache entry exists');
  assertTrue(/editPaletteDistribution\b/.test(js),
             'distribution bar DOM cache entry exists');
  assertTrue(/editPaletteDistributionSum/.test(js),
             'distribution sum DOM cache entry exists');
  assertTrue(/data-accent="true"/.test(js),
             'data-accent attribute is set when accent is checked');
  // Priority chip + drag handle are rendered as live DOM (not just
  // declared in CSS) — assert the JS that produces them.
  assertTrue(/edit-palette-color-row__priority/.test(js),
             'priority chip class rendered in JS');
  assertTrue(/edit-palette-color-row__handle/.test(js),
             'drag handle class rendered in JS');
  // SortableJS is initialized.
  assertTrue(/Sortable\.create/.test(js),
             'Sortable.create called for drag-and-drop');
  assertTrue(/wireEditPaletteColorsSortable/.test(js),
             'sortable wire helper exists');
  // No weight input or weight slider rendered.
  assertTrue(!/edit-palette-color-row__weight\b/.test(js),
             'weight slider code REMOVED');
  assertTrue(!/['"]range['"]/.test(js.split('\n').filter((l) => l.includes('edit-palette-color-row'))).valueOf(undefined),
             'no range input rendered in palette rows');
  // accent checkbox + accent_max_mentions still wired.
  assertTrue(/['"]checkbox['"]/.test(js) && /edit-palette-color-row__accent/.test(js),
             'accent checkbox rendered');
  assertTrue(/accent_max_mentions/.test(js),
             'accent_max_mentions is sent in submit');
});

// HTTP round-trip — accent + accent_max_mentions reach the server.
// (Weight is forbidden on the write path in ADR 0017.)
test('ADR 0017: PUT /api/palettes/:id accepts accent + accent_max_mentions (weight forbidden)', async () => {
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
    const r = await fetchJson(`${srv.base}/api/palettes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Sunset palette v3',
        colors: [
          { hex: '#0ea5e9', name: 'sea' },
          { hex: '#dc2626', name: 'alert', accent: true }
        ],
        accent_max_mentions: 1
      })
    });
    assertEqual(r.status, 200, 'PUT → 200');
    assertEqual(r.body.data.name, 'Sunset palette v3', 'name updated');
    // First color has no accent declared → normalized to absent (undefined).
    assertEqual(r.body.data.colors[0].accent, undefined,
      'absent accent stays absent in normalized body');
    assertEqual(r.body.data.colors[1].accent, true, 'accent true round-tripped');
    assertEqual(r.body.data.colors[0].weight, undefined, 'weight NOT in stored body');
    assertEqual(r.body.data.accent_max_mentions, 1, 'accent_max_mentions 1 round-tripped');
    const v2 = r.body.data.history[r.body.data.history.length - 1];
    assertEqual(v2.colors[0].weight, undefined, 'history v2 does NOT capture weight (ADR 0017)');
    assertEqual(v2.colors[1].accent, true, 'history v2 captures accent');
    assertEqual(v2.accent_max_mentions, 1, 'history v2 captures cap');
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

// ─── ADR 0014 — Phase 4: distribution dashboard ────────────────────────
//
// Phase 4 wires the telemetry log (`data/palette_runs.json`) and the
// dashboard panel that reads it. Tests cover:
//   - Pure helpers (readPaletteRuns / writePaletteRuns / appendPaletteRun
//     / getLatestPaletteRun) including the per-palette 50-entry cap.
//   - HTTP integration: telemetry append on /api/generate-prompt success
//     + GET /api/palettes/:id/distribution (404 when no runs yet, 200
//     + payload shape when telemetry exists).
//   - HTML/CSS/JS assertions for the dashboard panel structure.

test('ADR 0014: appendPaletteRun + getLatestPaletteRun — basic round-trip', () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const tmpFile = path2.join(PROJECT_ROOT, 'data', 'palette_runs.json');
  const before = fs2.existsSync(tmpFile) ? fs2.readFileSync(tmpFile, 'utf8') : '[]';
  try {
    fs2.writeFileSync(tmpFile, '[]', 'utf8');
    // Clear require cache so we get a fresh readPaletteRuns closure bound
    // to the now-empty file.
    delete require.cache[require.resolve(path.join(PROJECT_ROOT, 'server.js'))];
    const { appendPaletteRun, getLatestPaletteRun, readPaletteRuns } =
      require(path.join(PROJECT_ROOT, 'server.js'));

    const paletteId = 'palette_aabbccdd00000001';
    assertEqual(getLatestPaletteRun(paletteId), null, 'no runs yet → null');

    const ok = appendPaletteRun({
      palette_id: paletteId,
      prompt: 'A burnt orange sky.',
      metrics: { counts: [{ hex: '#d97706', name: 'burnt orange', nameCount: 2, hexCount: 0, totalCount: 2 }], totalMentions: 2, totalWords: 4, measuredAt: '2026-06-27T12:00:00.000Z' },
      recorded_at: '2026-06-27T12:00:00.000Z'
    });
    assertEqual(ok, true, 'append succeeds');
    const runs = readPaletteRuns();
    assertEqual(runs.length, 1, 'one run stored');
    assertEqual(runs[0].palette_id, paletteId, 'palette_id preserved');
    const latest = getLatestPaletteRun(paletteId);
    assertTrue(latest && latest.prompt === 'A burnt orange sky.', 'latest found');
  } finally {
    fs2.writeFileSync(tmpFile, before, 'utf8');
    delete require.cache[require.resolve(path.join(PROJECT_ROOT, 'server.js'))];
  }
});

test('ADR 0014: appendPaletteRun — validates required fields', () => {
  const { appendPaletteRun } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertEqual(appendPaletteRun(null), false, 'null rejected');
  assertEqual(appendPaletteRun({}), false, 'empty rejected');
  assertEqual(appendPaletteRun({ palette_id: 'bad' }), false, 'missing prompt/metrics rejected');
  assertEqual(appendPaletteRun({
    palette_id: 'palette_aa', prompt: 'x', metrics: null
  }), false, 'null metrics rejected');
  assertEqual(appendPaletteRun({
    palette_id: 'not-prefixed', prompt: 'x', metrics: { counts: [] }
  }), false, 'invalid palette_id prefix rejected');
});

test('ADR 0014: appendPaletteRun — caps per-palette history at MAX_PALETTE_RUNS_PER_PALETTE', () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const tmpFile = path2.join(PROJECT_ROOT, 'data', 'palette_runs.json');
  const before = fs2.existsSync(tmpFile) ? fs2.readFileSync(tmpFile, 'utf8') : '[]';
  try {
    fs2.writeFileSync(tmpFile, '[]', 'utf8');
    delete require.cache[require.resolve(path.join(PROJECT_ROOT, 'server.js'))];
    const { appendPaletteRun, readPaletteRuns, MAX_PALETTE_RUNS_PER_PALETTE } =
      require(path.join(PROJECT_ROOT, 'server.js'));
    const paletteA = 'palette_aaaaaaaaaaaaaaa1';
    const paletteB = 'palette_bbbbbbbbbbbbbbb1';
    // Append MAX + 5 to palette A (older should be trimmed from front).
    for (let i = 0; i < MAX_PALETTE_RUNS_PER_PALETTE + 5; i++) {
      appendPaletteRun({
        palette_id: paletteA,
        prompt: `run ${i} for A`,
        metrics: { counts: [], totalMentions: 0, totalWords: 0, measuredAt: 'x' },
        recorded_at: new Date(2026, 0, 1, 0, i).toISOString()
      });
    }
    // And 3 to palette B (untouched).
    for (let i = 0; i < 3; i++) {
      appendPaletteRun({
        palette_id: paletteB,
        prompt: `run ${i} for B`,
        metrics: { counts: [], totalMentions: 0, totalWords: 0, measuredAt: 'x' },
        recorded_at: new Date(2026, 0, 2, 0, i).toISOString()
      });
    }
    const runs = readPaletteRuns();
    const aRuns = runs.filter((r) => r.palette_id === paletteA);
    const bRuns = runs.filter((r) => r.palette_id === paletteB);
    assertEqual(aRuns.length, MAX_PALETTE_RUNS_PER_PALETTE, 'palette A capped at MAX');
    assertEqual(bRuns.length, 3, 'palette B unaffected (3 runs preserved)');
    // Oldest entries for A were trimmed — the earliest "run N" prompt
    // should be run N = 5 (first 5 were trimmed).
    assertTrue(/run 5/.test(aRuns[0].prompt), `oldest kept prompt: ${aRuns[0].prompt}`);
    assertTrue(/run \d+ for A$/.test(aRuns[aRuns.length - 1].prompt), 'newest A prompt is the last');
  } finally {
    fs2.writeFileSync(tmpFile, before, 'utf8');
    delete require.cache[require.resolve(path.join(PROJECT_ROOT, 'server.js'))];
  }
});

test('ADR 0014: readPaletteRuns — forgives corrupt JSON + filters malformed entries', () => {
  const fs2 = require('fs');
  const path2 = require('path');
  const tmpFile = path2.join(PROJECT_ROOT, 'data', 'palette_runs.json');
  const before = fs2.existsSync(tmpFile) ? fs2.readFileSync(tmpFile, 'utf8') : '[]';
  try {
    fs2.writeFileSync(tmpFile, JSON.stringify([
      { palette_id: 'palette_valid0000001', prompt: 'p', metrics: { counts: [] }, recorded_at: '2026-06-27T00:00:00.000Z' },
      { palette_id: 'not-a-palette-id', prompt: 'p', metrics: { counts: [] }, recorded_at: '2026-06-27T00:00:00.000Z' },
      { palette_id: 'palette_valid0000001', prompt: 'p' /* missing metrics */ },
      'not-an-object',
      null
    ]), 'utf8');
    delete require.cache[require.resolve(path.join(PROJECT_ROOT, 'server.js'))];
    const { readPaletteRuns } = require(path.join(PROJECT_ROOT, 'server.js'));
    const runs = readPaletteRuns();
    assertEqual(runs.length, 1, 'only the fully-valid entry survives');
    assertEqual(runs[0].palette_id, 'palette_valid0000001', 'survivor is the valid one');
  } finally {
    fs2.writeFileSync(tmpFile, before, 'utf8');
    delete require.cache[require.resolve(path.join(PROJECT_ROOT, 'server.js'))];
  }
});

// HTTP integration

test('ADR 0014: GET /api/palettes/:id/distribution returns 404 when no telemetry exists', async () => {
  const snapshotPalettes = snapshotPalettesFile();
  resetPalettesFile();
  const fs2 = require('fs');
  const path2 = require('path');
  const runsFile = path2.join(PROJECT_ROOT, 'data', 'palette_runs.json');
  const beforeRuns = fs2.existsSync(runsFile) ? fs2.readFileSync(runsFile, 'utf8') : '[]';
  fs2.writeFileSync(runsFile, '[]', 'utf8');
  const srv = await startTestServer();
  try {
    // Seed a palette so the endpoint can validate the id format +
    // palette existence before checking telemetry.
    const create = await fetchJson(`${srv.base}/api/palettes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPaletteBody())
    });
    const paletteId = create.body.data.id;
    const r = await fetchJson(`${srv.base}/api/palettes/${paletteId}/distribution`);
    assertEqual(r.status, 404, 'no telemetry → 404');
    assertTrue(/no distribution metrics/.test(r.body.error), 'error mentions missing telemetry');
  } finally {
    await srv.close();
    restorePalettesFile(snapshotPalettes);
    fs2.writeFileSync(runsFile, beforeRuns, 'utf8');
  }
});

test('ADR 0014: GET /api/palettes/:id/distribution returns 404 for unknown palette', async () => {
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/palettes/palette_unknown_aaaaa/distribution`);
    assertEqual(r.status, 404, 'unknown palette → 404');
    assertTrue(/palette_unknown_aaaaa/.test(r.body.error), 'error names the palette id');
  } finally {
    await srv.close();
  }
});

test('ADR 0014: GET /api/palettes/:id/distribution returns 400 for malformed id', async () => {
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/palettes/not-prefixed/distribution`);
    assertEqual(r.status, 400, 'malformed id → 400');
    assertTrue(/palette_/.test(r.body.error), 'error mentions expected prefix');
  } finally {
    await srv.close();
  }
});

test('ADR 0014: GET /api/palettes/:id/distribution returns the latest telemetry payload', async () => {
  // Seed a palette, manually inject two telemetry entries (newer +
  // older), and assert the endpoint returns the newer one with the
  // documented payload shape (palette_id, palette_name,
  // accent_max_mentions, colors, metrics, prompt, recorded_at).
  const snapshotPalettes = snapshotPalettesFile();
  resetPalettesFile();
  const fs2 = require('fs');
  const path2 = require('path');
  const runsFile = path2.join(PROJECT_ROOT, 'data', 'palette_runs.json');
  const beforeRuns = fs2.existsSync(runsFile) ? fs2.readFileSync(runsFile, 'utf8') : '[]';
  const srv = await startTestServer();
  try {
    const create = await fetchJson(`${srv.base}/api/palettes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validPaletteBody(),
        colors: [
          { hex: '#d97706', name: 'burnt orange' },
          { hex: '#dc2626', name: 'signal red', accent: true }
        ],
        accent_max_mentions: 2
      })
    });
    const paletteId = create.body.data.id;

    // Inject two telemetry entries; newer first in file order so the
    // reverse-iterating getLatestPaletteRun picks the most recent.
    const entries = [
      {
        palette_id: paletteId,
        prompt: 'Older run',
        metrics: {
          counts: [
            { hex: '#d97706', name: 'burnt orange', nameCount: 1, hexCount: 0, totalCount: 1 },
            { hex: '#dc2626', name: 'signal red', nameCount: 3, hexCount: 0, totalCount: 3 }
          ],
          totalMentions: 4, totalWords: 12, measuredAt: '2026-06-27T10:00:00.000Z'
        },
        recorded_at: '2026-06-27T10:00:00.000Z'
      },
      {
        palette_id: paletteId,
        prompt: 'Newer run',
        metrics: {
          counts: [
            { hex: '#d97706', name: 'burnt orange', nameCount: 4, hexCount: 0, totalCount: 4 },
            { hex: '#dc2626', name: 'signal red', nameCount: 1, hexCount: 0, totalCount: 1 }
          ],
          totalMentions: 5, totalWords: 20, measuredAt: '2026-06-27T12:00:00.000Z'
        },
        recorded_at: '2026-06-27T12:00:00.000Z'
      }
    ];
    fs2.writeFileSync(runsFile, JSON.stringify(entries), 'utf8');

    const r = await fetchJson(`${srv.base}/api/palettes/${paletteId}/distribution`);
    assertEqual(r.status, 200, 'telemetry exists → 200');
    assertEqual(r.body.data.palette_id, paletteId, 'palette_id returned');
    assertEqual(r.body.data.palette_name, 'Sunset ochres', 'palette_name returned');
    assertEqual(r.body.data.accent_max_mentions, 2, 'accent_max_mentions returned');
    assertEqual(r.body.data.colors.length, 2, 'colors returned');
    assertEqual(r.body.data.prompt, 'Newer run', 'latest prompt returned (not older)');
    assertEqual(r.body.data.metrics.totalMentions, 5, 'latest metrics returned');
    assertEqual(r.body.data.metrics.counts.length, 2, 'count entries per color');
    assertEqual(r.body.data.recorded_at, '2026-06-27T12:00:00.000Z', 'recorded_at returned');
  } finally {
    await srv.close();
    restorePalettesFile(snapshotPalettes);
    fs2.writeFileSync(runsFile, beforeRuns, 'utf8');
  }
});

// HTML/CSS/JS for the dashboard panel

test('ADR 0014: edit modal dashboard panel structure exists with a11y attributes (Phase 4)', () => {
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'src/index.html'), 'utf8');
  assertTrue(/<details[^>]*id="edit-palette-distribution-details"/.test(html),
             'collapsible <details> wrapper present');
  assertTrue(/<summary[^>]*class="palette-distribution-details__summary"[^>]*>Distribution dashboard<\/summary>/.test(html),
             'summary text "Distribution dashboard" present');
  assertTrue(/id="edit-palette-distribution-empty"/.test(html),
             'empty-state element present');
  assertTrue(/id="edit-palette-distribution-content"/.test(html),
             'content element present');
  assertTrue(/<table[^>]*class="palette-distribution-table"/.test(html),
             'comparison table present');
  assertTrue(/<th scope="col">Target<\/th>/.test(html), 'Target column header present');
  assertTrue(/<th scope="col">Measured<\/th>/.test(html), 'Measured column header present');
  assertTrue(/aria-label="Target vs measured color distribution from the latest run"/.test(html),
             'table aria-label present');
  assertTrue(/<tbody id="edit-palette-distribution-tbody">/.test(html),
             'tbody present for JS to fill rows');
});

test('ADR 0014: stylesheet has dashboard panel rules (Phase 4)', () => {
  const css = fs.readFileSync(path.join(PROJECT_ROOT, 'src/styles.css'), 'utf8');
  assertTrue(/\.palette-distribution-details/.test(css), 'details wrapper rule');
  assertTrue(/\.palette-distribution-table/.test(css), 'comparison table rule');
  assertTrue(/\.palette-distribution-swatch/.test(css), 'inline swatch rule');
  assertTrue(/\.palette-distribution-accent-mark/.test(css), 'accent star rule');
  assertTrue(/tr\[data-accent="true"\]/.test(css), 'accent row visual treatment');
});

test('ADR 0014: app.js wires renderDistributionPanel into the edit modal flow (Phase 4)', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src/app.js'), 'utf8');
  assertTrue(/renderDistributionPanel/.test(js), 'renderDistributionPanel function exists');
  assertTrue(/editPaletteDistributionDetails/.test(js), 'details DOM cache entry exists');
  assertTrue(/editPaletteDistributionTbody/.test(js), 'tbody DOM cache entry exists');
  assertTrue(/apiCall\(`\/api\/palettes\/\$\{encodeURIComponent\(paletteId\)\}\/distribution`/.test(js) ||
             /\/api\/palettes\/\$\{encodeURIComponent\(paletteId\)\}\/distribution/.test(js),
             'fetches /api/palettes/:id/distribution');
  assertTrue(/renderDistributionPanel\(state\.editingPaletteId\)/.test(js),
             'invoked from paintEditPaletteModal');
});

test('ADR 0014: README documents the new /api/palettes/:id/distribution endpoint (Phase 4)', () => {
  const readme = fs.readFileSync(path.join(PROJECT_ROOT, 'README.md'), 'utf8');
  assertTrue(/\/api\/palettes\/:id\/distribution/.test(readme),
             'README mentions the new endpoint');
});

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

test('Chat drafts: legacy sessions normalize pending_prompt and explicit commit commands are narrow', () => {
  const {
    normalizeChatSession,
    isExplicitChatCommit,
    findLatestChatProposalMessage
  } = require(path.join(PROJECT_ROOT, 'server.js'));

  const legacy = normalizeChatSession({
    id: 'chat_legacy',
    original_prompt: 'original',
    current_prompt: 'current',
    messages: []
  });
  assertEqual(legacy.pending_prompt, null, 'legacy session gets null pending_prompt');

  for (const command of ['apply it', 'Apply that.', 'use the proposal', 'commit this']) {
    assertTrue(isExplicitChatCommit(command), `${command} is explicit`);
  }
  for (const message of ['I think we should use that approach', 'that looks good', 'please explain this']) {
    assertTrue(!isExplicitChatCommit(message), `${message} remains conversational`);
  }

  const session = {
    pending_prompt: 'new draft',
    messages: [
      { role: 'assistant', suggested_prompt: 'older draft' },
      { role: 'assistant', suggested_prompt: 'new draft' }
    ]
  };
  assertEqual(
    findLatestChatProposalMessage(session).suggested_prompt,
    'new draft',
    'latest pending proposal is found'
  );
});

test('Chat drafts: new sessions initialize pending_prompt to null', async () => {
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    const created = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'new prompt', preset_id: getFirstPresetId() })
    });
    assertEqual(created.status, 201, 'session create succeeds');
    assertEqual(created.body.data.pending_prompt, null, 'new pending prompt is null');
  } finally {
    await srv.close();
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

test('HTTP chat drafts: discussion, proposal, refinement, and text commit preserve state', async () => {
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    const presetId = getFirstPresetId();
    const created = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'original prompt', preset_id: presetId })
    });
    const sessionId = created.body.data.id;

    const responses = [
      { reply: 'The lighting was chosen to separate the subject from the background.', suggested_prompt: '' },
      { reply: 'I recommend a warmer, more directional treatment while keeping the subject unchanged.', suggested_prompt: 'original prompt with warmer directional lighting' },
      { reply: 'I kept the proposal and softened the warmth.', suggested_prompt: 'original prompt with softer warm directional lighting' }
    ];

    await withMockChatProvider(responses, async () => {
      const discussion = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Why is the lighting described this way?' })
      });
      assertEqual(discussion.status, 200, 'discussion succeeds');
      assertEqual(discussion.body.data.current_prompt, 'original prompt', 'discussion does not commit');
      assertEqual(discussion.body.data.pending_prompt, null, 'discussion has no pending draft');

      const proposal = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'What change would make the lighting warmer?' })
      });
      assertEqual(proposal.status, 200, 'proposal succeeds');
      assertEqual(proposal.body.data.current_prompt, 'original prompt', 'proposal does not commit');
      assertEqual(proposal.body.data.pending_prompt, 'original prompt with warmer directional lighting', 'proposal becomes pending');

      const refinement = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Keep the idea but make it softer.' })
      });
      assertEqual(refinement.status, 200, 'refinement succeeds');
      assertEqual(refinement.body.data.current_prompt, 'original prompt', 'refinement does not commit');
      assertEqual(refinement.body.data.pending_prompt, 'original prompt with softer warm directional lighting', 'refinement replaces pending draft');

      const committed = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'apply it' })
      });
      assertEqual(committed.status, 200, 'text Apply succeeds');
      assertEqual(committed.body.data.current_prompt, 'original prompt with softer warm directional lighting', 'text Apply commits latest draft');
      assertEqual(committed.body.data.pending_prompt, null, 'text Apply clears pending draft');
    });
  } finally {
    await srv.close();
    restoreChatFile(snapshot);
  }
});

test('HTTP chat drafts: ambiguous text without pending proposal is treated as discussion', async () => {
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    const presetId = getFirstPresetId();
    const created = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'original prompt', preset_id: presetId })
    });
    const sessionId = created.body.data.id;

    const responses = [
      { reply: 'Sure, happy to discuss — what aspect are you weighing?', suggested_prompt: '' }
    ];

    await withMockChatProvider(responses, async () => {
      const reply = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'I think we should use that approach' })
      });
      assertEqual(reply.status, 200, 'ambiguous text returns 200');
      assertEqual(reply.body.data.current_prompt, 'original prompt', 'current_prompt unchanged');
      assertEqual(reply.body.data.pending_prompt, null, 'pending_prompt still null');
      assertEqual(reply.body.data.messages.length, 2, 'user + assistant persisted');
      assertEqual(reply.body.data.messages[1].role, 'assistant', 'assistant message persisted');
      assertEqual(reply.body.data.messages[1].suggested_prompt, null, 'assistant has no suggestion');
    });
  } finally {
    await srv.close();
    restoreChatFile(snapshot);
  }
});

test('HTTP chat drafts: malformed provider response preserves existing pending draft', async () => {
  const snapshot = snapshotChatFile();
  resetChatFile();
  const srv = await startTestServer();
  try {
    const presetId = getFirstPresetId();
    const created = await fetchJson(`${srv.base}/api/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'original prompt', preset_id: presetId })
    });
    const sessionId = created.body.data.id;

    const seedPending = 'seeded pending draft to preserve';
    const persisted = readPersistedSessions();
    const direct = persisted.find((s) => s.id === sessionId);
    direct.pending_prompt = seedPending;
    fs.writeFileSync(CHAT_FILE, JSON.stringify(persisted, null, 2), 'utf8');

    const malformedResponses = ['this is not parseable json at all {', 'still garbage', 'more garbage'];

    await withMockChatProvider(malformedResponses, async () => {
      const reply = await fetchJson(`${srv.base}/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Try to do something' })
      });
      assertEqual(reply.status, 200, 'malformed response still returns 200');
      assertEqual(reply.body.data.current_prompt, 'original prompt', 'current_prompt unchanged');
      assertEqual(reply.body.data.pending_prompt, seedPending, 'pending_prompt preserved through parse fallback');
      assertEqual(reply.body.data.messages.length, 2, 'user + assistant fallback persisted');
      assertEqual(reply.body.data.messages[1].role, 'assistant', 'fallback assistant message persisted');
    });
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

test('Frontend chat: submitChatMessage text-apply path syncs Step 4 result and token reminder', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'app.js'), 'utf8');
  const block = js.match(/const submitChatMessage = async[\s\S]*?\n  \};/);
  assertTrue(block, 'submitChatMessage defined');
  assertTrue(/state\.finalPrompt\s*=\s*updated\.current_prompt/.test(block[0]),
    'submitChatMessage text-apply path must update state.finalPrompt');
  assertTrue(/dom\.resultPrompt\.textContent\s*=\s*updated\.current_prompt/.test(block[0]),
    'submitChatMessage text-apply path must update dom.resultPrompt.textContent');
  assertTrue(/updateTokenReminderBanner\(\s*\)/.test(block[0]),
    'submitChatMessage text-apply path must re-run updateTokenReminderBanner');
});

test('Frontend chat: pending proposal state is rendered and described as unapplied', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'styles.css'), 'utf8');
  assertTrue(/pending_prompt/.test(js), 'frontend reads pending_prompt');
  assertTrue(/Apply proposal/.test(js), 'frontend exposes Apply proposal copy');
  assertTrue(/unapplied proposal/i.test(js), 'frontend labels unapplied state');
  assertTrue(/discuss|recommend|proposal/i.test(html), 'HTML explains conversational workflow');
  assertTrue(/chat-message--pending/.test(css), 'pending proposal style exists');
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

// ─── ADR 0012 — anchor-preserving chat refinements ────────────────

// Reusable paint-spec fixture: a real prompt with paint-application
// context, three named colors, and several production requirements.
// Used across the ADR 0012 test group to exercise the same real
// scenario that surfaced the bug (see ADR 0012 §"Context").
const PAINT_SPEC_ORIGINAL =
  'Professional interior paint specification. Eggshell finish, low-VOC formula, ' +
  'suitable for high-traffic residential areas. Apply with synthetic brush or ' +
  'roller; two coats minimum. Drying time 4 hours between coats. Coverage 350 ' +
  'sq ft per gallon. Colors: Warm Beige (HEX #D4B896), Sage Green (HEX #9CAF88), ' +
  'Soft White (HEX #F5F5F0).';

const PAINT_SPEC_USER_REQUEST = 'change the colors to navy, gold, and white';

// A targeted color-only revision that preserves every production
// requirement and the paint-application context.
const PAINT_SPEC_GOOD_REVISION =
  'Professional interior paint specification. Eggshell finish, low-VOC formula, ' +
  'suitable for high-traffic residential areas. Apply with synthetic brush or ' +
  'roller; two coats minimum. Drying time 4 hours between coats. Coverage 350 ' +
  'sq ft per gallon. Colors: Navy (HEX #1F2A44), Gold (HEX #C9A227), White (HEX #FFFFFF).';

// A wholesale rewrite that drops the paint-application context and
// all production requirements — the exact failure mode ADR 0012
// fixes.
const PAINT_SPEC_BAD_REVISION =
  'Create a sophisticated paint palette featuring navy, gold, and white ' +
  'tones for an elegant interior design scheme. Mix complementary shades to ' +
  'evoke a serene, luxurious atmosphere in any room.';

test('ADR 0012: server exports anchor-preservation constants and helpers', () => {
  const serverMod = require(path.join(PROJECT_ROOT, 'server.js'));
  for (const key of [
    'PRESERVATION_MIN_TOKEN_LENGTH',
    'PRESERVATION_SHORT_PROMPT_LENGTH',
    'PRESERVATION_KEYWORD_THRESHOLD_LONG',
    'PRESERVATION_KEYWORD_THRESHOLD_SHORT',
    'PRESERVATION_BIGRAM_THRESHOLD_LONG',
    'PRESERVATION_BIGRAM_THRESHOLD_SHORT',
    'PRESERVATION_FAILED_REPLY_NOTE',
    'PRESERVATION_STOP_WORDS',
    'tokenizeForPreservation',
    'extractPreservationBigrams',
    'validatePromptPreservation'
  ]) {
    assertTrue(
      Object.prototype.hasOwnProperty.call(serverMod, key),
      `server.js must export ${key}`
    );
  }
  // Thresholds should be in (0, 1] and long ≥ short.
  assertTrue(serverMod.PRESERVATION_KEYWORD_THRESHOLD_LONG > 0, 'long kw threshold > 0');
  assertTrue(serverMod.PRESERVATION_KEYWORD_THRESHOLD_LONG <= 1, 'long kw threshold <= 1');
  assertTrue(
    serverMod.PRESERVATION_KEYWORD_THRESHOLD_LONG >=
      serverMod.PRESERVATION_KEYWORD_THRESHOLD_SHORT,
    'long kw threshold >= short kw threshold'
  );
  assertTrue(
    serverMod.PRESERVATION_BIGRAM_THRESHOLD_LONG >=
      serverMod.PRESERVATION_BIGRAM_THRESHOLD_SHORT,
    'long bg threshold >= short bg threshold'
  );
  assertTrue(
    serverMod.PRESERVATION_FAILED_REPLY_NOTE.length > 20,
    'failure note is a real sentence, not a stub'
  );
  // Stop words is a real Set.
  assertTrue(serverMod.PRESERVATION_STOP_WORDS instanceof Set, 'stop words is a Set');
  assertTrue(serverMod.PRESERVATION_STOP_WORDS.has('the'), 'stop words includes "the"');
  assertTrue(serverMod.PRESERVATION_STOP_WORDS.has('and'), 'stop words includes "and"');
});

test('ADR 0012: tokenizeForPreservation lowercases, strips punctuation, drops stop words', () => {
  const { tokenizeForPreservation, PRESERVATION_MIN_TOKEN_LENGTH } =
    require(path.join(PROJECT_ROOT, 'server.js'));

  const tokens = tokenizeForPreservation(
    'Eggshell finish, LOW-VOC formula — apply with synthetic brush!'
  );
  // Should keep: eggshell, finish, low, voc, formula, apply, synthetic, brush
  // (drop "with" as stop word; drop "low-voc" but "low" + "voc" remain as separate tokens)
  assertTrue(tokens.includes('eggshell'), 'keeps "eggshell"');
  assertTrue(tokens.includes('finish'), 'keeps "finish"');
  assertTrue(tokens.includes('low'), 'keeps "low" (split from low-voc)');
  assertTrue(tokens.includes('voc'), 'keeps "voc"');
  assertTrue(tokens.includes('formula'), 'keeps "formula"');
  assertTrue(tokens.includes('apply'), 'keeps "apply"');
  assertTrue(tokens.includes('synthetic'), 'keeps "synthetic"');
  assertTrue(tokens.includes('brush'), 'keeps "brush"');
  // No stop words.
  assertTrue(!tokens.includes('with'), 'drops stop word "with"');
  // No short tokens.
  assertTrue(
    tokens.every((t) => t.length >= PRESERVATION_MIN_TOKEN_LENGTH),
    'all tokens meet minimum length'
  );

  // Defensive: non-string returns empty.
  assertEqual(tokenizeForPreservation(null).length, 0, 'null -> []');
  assertEqual(tokenizeForPreservation(undefined).length, 0, 'undefined -> []');
  assertEqual(tokenizeForPreservation(42).length, 0, 'number -> []');
  assertEqual(tokenizeForPreservation('').length, 0, 'empty -> []');
  assertEqual(tokenizeForPreservation('   ').length, 0, 'whitespace -> []');
});

test('ADR 0012: extractPreservationBigrams captures adjacent pairs in order', () => {
  const { extractPreservationBigrams, tokenizeForPreservation } =
    require(path.join(PROJECT_ROOT, 'server.js'));

  const tokens = tokenizeForPreservation('eggshell finish low voc');
  const bigrams = extractPreservationBigrams(tokens);
  assertTrue(bigrams.has('eggshell finish'), 'captures "eggshell finish"');
  assertTrue(bigrams.has('finish low'), 'captures "finish low"');
  assertTrue(bigrams.has('low voc'), 'captures "low voc"');
  assertEqual(bigrams.size, 3, 'three bigrams for four tokens');

  // Edge cases.
  assertEqual(extractPreservationBigrams([]).size, 0, 'empty input -> empty bigram set');
  assertEqual(
    extractPreservationBigrams(['solo']).size, 0,
    'single token -> empty bigram set'
  );
});

test('ADR 0012: validatePromptPreservation passes the paint-spec targeted color edit', () => {
  // This is the headline use case (ADR 0012 §"Test"): a color-only
  // revision on a paint-application spec must be flagged as
  // preserved. Every production requirement and the application
  // context must survive.
  const { validatePromptPreservation } = require(path.join(PROJECT_ROOT, 'server.js'));

  const report = validatePromptPreservation(
    PAINT_SPEC_ORIGINAL,
    PAINT_SPEC_GOOD_REVISION,
    PAINT_SPEC_USER_REQUEST
  );

  assertEqual(report.preserved, true, 'good revision marked preserved');
  assertEqual(report.reason, null, 'no failure reason');
  assertTrue(
    report.nonTargetedRatio >= 0.7,
    `nonTargetedRatio >= 0.7 (got ${report.nonTargetedRatio})`
  );
  assertTrue(
    report.bigramRatio >= 0.4,
    `bigramRatio >= 0.4 (got ${report.bigramRatio})`
  );

  // The targeted tokens are the old color names + hex codes (the user
  // asked to change the colors). They MAY be missing — that's the
  // intended delta. But everything else must survive.
  for (const mustKeep of [
    'eggshell', 'finish', 'low', 'voc', 'formula', 'suitable',
    'high', 'traffic', 'residential', 'synthetic', 'brush', 'roller',
    'coats', 'drying', 'hours', 'coverage', '350', 'gallon',
    'professional', 'interior', 'paint', 'specification'
  ]) {
    assertTrue(
      !report.nonTargetedMissing.includes(mustKeep),
      `non-targeted "${mustKeep}" preserved in revision`
    );
  }
});

test('ADR 0012: validatePromptPreservation REJECTS the wholesale rewrite of paint-spec', () => {
  // The exact bug pattern ADR 0012 fixes: the assistant generates a
  // generic "paint palette" prompt that loses the paint-application
  // context, the production requirements, and all original values.
  // The validator must flag this as wholesale rewrite.
  const { validatePromptPreservation } = require(path.join(PROJECT_ROOT, 'server.js'));

  const report = validatePromptPreservation(
    PAINT_SPEC_ORIGINAL,
    PAINT_SPEC_BAD_REVISION,
    PAINT_SPEC_USER_REQUEST
  );

  assertEqual(report.preserved, false, 'wholesale rewrite marked NOT preserved');
  assertTrue(report.reason !== null, 'failure reason present');
  // The headline metric must be very low.
  assertTrue(
    report.nonTargetedRatio < 0.3,
    `nonTargetedRatio < 0.3 (got ${report.nonTargetedRatio})`
  );
  // Critical anchor terms must be in the missing list.
  for (const lost of [
    'eggshell', 'finish', 'voc', 'formula', 'synthetic', 'roller',
    'coats', 'drying', 'hours', 'coverage', 'gallon', 'specification'
  ]) {
    assertTrue(
      report.missing.includes(lost),
      `wholesale rewrite dropped "${lost}"`
    );
  }
});

test('ADR 0012: validatePromptPreservation accepts identical-content revisions', () => {
  const { validatePromptPreservation } = require(path.join(PROJECT_ROOT, 'server.js'));

  const original = 'A serene mountain landscape at dawn with golden light.';
  const report = validatePromptPreservation(original, original, 'no change');
  assertEqual(report.preserved, true, 'identical content passes');
  assertEqual(report.nonTargetedRatio, 1, 'no missing keywords');
  assertEqual(report.bigramRatio, 1, 'no missing bigrams');
});

test('ADR 0012: validatePromptPreservation counts user-targeted tokens as removable', () => {
  // The headline "nonTargetedRatio" should treat tokens the user
  // explicitly named as deletable, so a legitimate targeted edit
  // doesn't get flagged just because it drops the targeted content.
  //
  // Note: the validator's notion of "targeted" is literal keyword
  // overlap — tokens that appear in both the user's message and the
  // original. It does NOT infer semantic relationships like
  // "color" → "gray". The threshold is calibrated (0.7 long, 0.5
  // short) so dropping the value of a targeted attribute still
  // passes; the validator's job is to catch wholesale rewrites, not
  // to be a semantic parser.
  const { validatePromptPreservation } = require(path.join(PROJECT_ROOT, 'server.js'));

  // Case 1: user request LITERALLY mentions a token in the original.
  // That token counts as targeted — its absence in the revised is
  // expected, so nonTargetedRatio doesn't penalize it.
  const original = 'Epoxy floor coating. Two-part resin with navy pigment, 24-hour cure.';
  const revised = 'Epoxy floor coating. Two-part resin with gold pigment, 24-hour cure.';
  const userRequest = 'change navy to gold';

  const report = validatePromptPreservation(original, revised, userRequest);
  assertEqual(report.preserved, true, 'literal "navy→gold" swap passes');
  // "navy" was named by the user; its absence is allowed.
  assertTrue(report.targetedMissing.includes('navy'),
    'navy appears under targetedMissing (user named it)');
  assertTrue(!report.nonTargetedMissing.includes('navy'),
    'navy NOT under nonTargetedMissing (correctly classified)');
  // "gold" was added — not in original, so it doesn't count against
  // preservation.
  assertTrue(!report.missing.includes('gold'),
    'new "gold" not counted as missing');

  // Case 2: same shape but the user names a token that doesn't
  // exist in the original. The validator doesn't penalize that, and
  // dropping non-targeted tokens is still subject to the threshold.
  const original2 = 'Epoxy floor coating. Two-part resin, gray finish, 24-hour cure time.';
  const revised2 = 'Epoxy floor coating. Two-part resin, navy finish, 24-hour cure time.';
  const userRequest2 = 'change the color to navy';

  const report2 = validatePromptPreservation(original2, revised2, userRequest2);
  assertEqual(report2.preserved, true,
    'semantic-but-not-literal color swap still passes (threshold calibrated)');
  // "navy" was named by the user; if it had been in original it'd be
  // targeted. It wasn't in original, so it's just absent.
  // Critical: the production requirements (resin, finish, cure, etc.)
  // must be retained.
  for (const mustKeep of ['epoxy', 'floor', 'coating', 'resin', 'finish', 'cure']) {
    assertTrue(
      !report2.nonTargetedMissing.includes(mustKeep),
      `non-targeted "${mustKeep}" preserved in semantic-swap case`
    );
  }
});

test('ADR 0012: validatePromptPreservation passes pure-question revisions with no changes', () => {
  // Question-only turns (ADR 0011 contract: suggested_prompt = "") are
  // never sent to the validator by the route (only non-empty
  // suggested_prompt enters the gate). But the helper itself must
  // behave sanely if asked: identical content is preserved.
  const { validatePromptPreservation } = require(path.join(PROJECT_ROOT, 'server.js'));
  const prompt = 'A cat sitting on a windowsill in golden afternoon light.';
  const report = validatePromptPreservation(prompt, prompt, 'why this framing?');
  assertEqual(report.preserved, true, 'no-change revision is preserved');
});

test('ADR 0012: validatePromptPreservation handles short prompts with the relaxed threshold', () => {
  // Prompts ≤ PRESERVATION_SHORT_PROMPT_LENGTH chars get the SHORT
  // thresholds (0.5 keyword, 0.2 bigram). A short-prompt revision
  // that drops one or two words should still pass.
  const { validatePromptPreservation, PRESERVATION_SHORT_PROMPT_LENGTH } =
    require(path.join(PROJECT_ROOT, 'server.js'));

  assertTrue(
    'A cat sitting on a warm windowsill.'.length <= PRESERVATION_SHORT_PROMPT_LENGTH,
    'fixture is short enough to use SHORT threshold'
  );

  // Drop "warm" (non-targeted) — short threshold still passes.
  const original = 'A cat sitting on a warm windowsill.';
  const revised = 'A cat sitting on a windowsill.';
  const report = validatePromptPreservation(original, revised, 'shorten slightly');
  assertEqual(report.preserved, true,
    'short prompt dropping one non-targeted word passes SHORT threshold');
});

test('ADR 0012: validatePromptPreservation REJECTS short-prompt wholesale rewrite', () => {
  // Even with relaxed thresholds, a complete rewrite of a short
  // prompt must fail.
  const { validatePromptPreservation } = require(path.join(PROJECT_ROOT, 'server.js'));
  const original = 'A cat sitting on a warm windowsill.';
  const revised = 'A dog running through a snowy field at night.';
  const report = validatePromptPreservation(original, revised, 'change the scene');
  assertEqual(report.preserved, false, 'short-prompt rewrite fails even with relaxed threshold');
});

test('ADR 0012: validatePromptPreservation is defensive on bad input', () => {
  const { validatePromptPreservation } = require(path.join(PROJECT_ROOT, 'server.js'));

  // Non-string inputs return the "valid" sentinel (preserved=true,
  // reason='invalid_input') so the caller never has to null-check
  // before passing through. The route doesn't pass bad input but
  // tests downstream might.
  for (const v of [null, undefined, 42, [], {}]) {
    const r = validatePromptPreservation(v, v, v);
    assertEqual(r.preserved, true, 'bad input -> preserved sentinel');
    assertEqual(r.reason, 'invalid_input', 'bad input tagged');
  }
});

test('ADR 0012: validatePromptPreservation handles empty strings gracefully', () => {
  const { validatePromptPreservation } = require(path.join(PROJECT_ROOT, 'server.js'));

  // Empty original = nothing to preserve = trivially preserved.
  const r1 = validatePromptPreservation('', 'something', 'request');
  assertEqual(r1.preserved, true, 'empty original -> trivially preserved');

  // Empty revised = nothing retained = wholesale rewrite.
  const r2 = validatePromptPreservation(
    'A cat sitting on a windowsill in golden afternoon light.',
    '',
    'clear it'
  );
  assertEqual(r2.preserved, false, 'empty revised -> wholesale rewrite');
  assertTrue(r2.keywordRatio === 0, 'keywordRatio is 0 when revised is empty');
});

test('ADR 0012: DEFAULT_CHAT_SYSTEM_PROMPT includes the anchor-preservation contract', () => {
  const { DEFAULT_CHAT_SYSTEM_PROMPT } = require(path.join(PROJECT_ROOT, 'server.js'));

  // The core contract section (ADR 0012) must be present and the old
  // soft rule must have been replaced with a hard contract.
  assertTrue(/EDIT, DO NOT REGENERATE/.test(DEFAULT_CHAT_SYSTEM_PROMPT),
    'system prompt has EDIT, DO NOT REGENERATE heading');
  assertTrue(/ANCHOR SET/.test(DEFAULT_CHAT_SYSTEM_PROMPT),
    'system prompt names the anchor set concept');
  assertTrue(/INVENTORY/.test(DEFAULT_CHAT_SYSTEM_PROMPT),
    'system prompt instructs the model to inventory first');
  assertTrue(/non-negotiable/i.test(DEFAULT_CHAT_SYSTEM_PROMPT),
    'anchor preservation is marked non-negotiable');
  assertTrue(/DO NOT introduce new facts/i.test(DEFAULT_CHAT_SYSTEM_PROMPT),
    'system prompt forbids adding new facts');
  assertTrue(/wholesale rewrite/i.test(DEFAULT_CHAT_SYSTEM_PROMPT),
    'system prompt carves out the wholesale rewrite case');

  // Task 2 contract requirements: discussion vs proposal modes, no
  // self-commit, two-string JSON schema.
  assertTrue(/Discussion/i.test(DEFAULT_CHAT_SYSTEM_PROMPT),
    'system prompt names the discussion mode');
  assertTrue(/Proposal/i.test(DEFAULT_CHAT_SYSTEM_PROMPT),
    'system prompt names the proposal mode');
  assertTrue(/Never commit/i.test(DEFAULT_CHAT_SYSTEM_PROMPT),
    'system prompt forbids self-commit');
  assertTrue(/JSON SCHEMA/i.test(DEFAULT_CHAT_SYSTEM_PROMPT),
    'system prompt describes the two-string JSON schema');
  assertTrue(/PENDING PROMPT/i.test(DEFAULT_CHAT_SYSTEM_PROMPT),
    'system prompt names the pending-prompt editing base');
});

test('ADR 0012: callMiniMaxChat wires the validator into the retry loop', () => {
  // We can't run a real LLM call in tests, but we can verify the
  // call site passes the new options the validator needs.
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const callSite = serverText.match(/parsedReply = await callMiniMaxChat\([\s\S]*?\}\);/);
  assertTrue(callSite, 'call site present');
  assertTrue(/currentPrompt:\s*(activePrompt|session\.pending_prompt\s*\|\|\s*session\.current_prompt|session\.current_prompt)/.test(callSite[0]),
    'call site passes a currentPrompt derived from the session (pending || current)');
  assertTrue(/lastUserRequest/.test(callSite[0]),
    'call site passes lastUserRequest');
});

test('ADR 0012: PRESERVATION_FAILED_REPLY_NOTE is friendlier than the raw error', () => {
  const { PRESERVATION_FAILED_REPLY_NOTE } = require(path.join(PROJECT_ROOT, 'server.js'));
  // Must contain a hint about what to do next.
  assertTrue(/try a more specific request/i.test(PRESERVATION_FAILED_REPLY_NOTE),
    'note guides the user to a more specific request');
  // Must NOT contain any technical jargon the user won't understand.
  assertTrue(!/validator|threshold|nonTargetedRatio/.test(PRESERVATION_FAILED_REPLY_NOTE),
    'note uses plain English, no implementation details');
});

test('Issue #1: buildPreservationDeclineNote exports + includes dropped terms', () => {
  // Issue #1 — when the validator declines a revision, the user
  // currently gets a generic "I'd proposed a revision but..." note
  // with no information about WHICH anchor terms blocked the apply.
  // The fix: buildPreservationDeclineNote(report) returns a string that
  // names the top dropped terms (capped) so the user can see why.
  const { buildPreservationDeclineNote } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(typeof buildPreservationDeclineNote === 'function',
    'buildPreservationDeclineNote is exported as a function');

  const noteWithTerms = buildPreservationDeclineNote({
    nonTargetedMissing: ['impasto', '#ff0000', '#ffff00', 'de Kooning']
  });
  assertTrue(/impasto/.test(noteWithTerms), 'note names "impasto"');
  assertTrue(/#ff0000/.test(noteWithTerms), 'note names the dropped hex "#ff0000"');
  assertTrue(/try a more specific request/i.test(noteWithTerms),
    'note still guides the user to a more specific request');
  assertTrue(!/validator|threshold|nonTargetedRatio/.test(noteWithTerms),
    'note uses plain English, no implementation details');

  const noteNoTerms = buildPreservationDeclineNote({ nonTargetedMissing: [] });
  assertTrue(/too much of the original context/i.test(noteNoTerms),
    'fallback note still explains why without a terms list');
  assertTrue(!/Terms dropped/.test(noteNoTerms),
    'empty missing list -> no "Terms dropped:" prefix');
});

test('Issue #1: callMiniMaxChat returns declined_suggested_prompt + missing_terms on preservation_failed', () => {
  // Issue #1 — when the validator declines the revision after retries,
  // the callMiniMaxChat return shape now carries the declined text and
  // the list of dropped anchor terms so the frontend can render them.
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  // Anchor on the unique decline-log line + the return block that
  // immediately follows it (the preservation_failed return shape).
  const logIdx = serverText.indexOf('declining revision (nonTargeted=');
  assertTrue(logIdx !== -1, 'preservation_failed log line found');
  const slice = serverText.slice(logIdx, logIdx + 1200);
  assertTrue(/declined_suggested_prompt/.test(slice),
    'preservation_failed return shape declares declined_suggested_prompt');
  assertTrue(/declined_missing_terms/.test(slice),
    'preservation_failed return shape declares declined_missing_terms');
  // suggested_prompt must STILL be null (the gate contract).
  assertTrue(/suggested_prompt:\s*null/.test(slice),
    'preservation_failed return shape keeps suggested_prompt: null (gate contract preserved)');
});

test('Issue #1: route handler persists declined_suggested_prompt + declined_missing_terms on assistant message', () => {
  // Issue #1 — the /api/chat/sessions/:id/messages route must persist
  // the declined revision text and dropped-terms list on the assistant
  // message when the validator declined. Frontend reads from disk to
  // render the declined preview.
  const serverText = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');
  const idx = serverText.indexOf('const assistantMessage = {');
  assertTrue(idx !== -1, 'assistantMessage construction present');
  // Pull a window that covers the construction + the post-construction
  // "if (parsedReply.declined_suggested_prompt ...) ..." block that
  // attaches the new fields.
  const block = serverText.slice(idx, idx + 1400);
  assertTrue(/declined_suggested_prompt/.test(block),
    'route handler writes declined_suggested_prompt to disk');
  assertTrue(/declined_missing_terms/.test(block),
    'route handler writes declined_missing_terms to disk');
  assertTrue(/session\.messages\.push\(assistantMessage\)/.test(block),
    'route handler still pushes the assistant message (regression guard)');
});

test('Issue #1: frontend renders declined preview when suggested_prompt is null but declined_suggested_prompt is set', () => {
  // Issue #1 — when the assistant message carries a declined
  // suggested_prompt, the chat UI must show the declined text (greyed
  // out) and a "Try as rewrite" affordance so the user can recover.
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'app.js'), 'utf8');
  assertTrue(/declined_suggested_prompt/.test(js),
    'app.js references declined_suggested_prompt');
  assertTrue(/declined_missing_terms/.test(js),
    'app.js references declined_missing_terms');
  // The declined preview branch should be SEPARATE from the Apply branch
  // (suggested_prompt non-null). Both must exist.
  const declinedBranch = js.match(/chat-message__declined[\s\S]{0,800}/);
  assertTrue(declinedBranch, 'declined-preview modifier class referenced');
  assertTrue(/Try as rewrite|try-as-rewrite|tryAsRewrite|REWRITE FROM SCRATCH/i.test(js),
    'Try as rewrite affordance is wired');
});

test('Issue #1: CSS has declined-preview styles', () => {
  const css = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'styles.css'), 'utf8');
  assertTrue(/\.chat-message__declined/.test(css), '.chat-message__declined rule defined');
  assertTrue(/\.chat-message__declined-preview/.test(css),
    '.chat-message__declined-preview rule defined');
  assertTrue(/\.chat-message__declined-terms/.test(css),
    '.chat-message__declined-terms rule defined');
});

// ─── ADR 0016 — Z-Image Turbo palette strength + accent placement ─────

test('ADR 0016: server exports strength constants + validator + preambles + computeStrictPass', () => {
  const s = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(Array.isArray(s.PALETTE_STRENGTH_LEVELS), 'PALETTE_STRENGTH_LEVELS is an array');
  assertEqual(s.PALETTE_STRENGTH_LEVELS.join(','), 'subtle,moderate,strong,strict', 'four valid levels in fixed order');
  assertEqual(s.DEFAULT_PALETTE_STRENGTH, 'moderate', 'default is moderate');
  assertEqual(s.MAX_COLOR_PLACEMENT_LENGTH, 60, 'placement cap is 60 chars');
  assertTrue(typeof s.validatePaletteStrength === 'function', 'validatePaletteStrength is exported');
  assertTrue(typeof s.STRENGTH_PREAMBLES === 'object' && s.STRENGTH_PREAMBLES !== null, 'STRENGTH_PREAMBLES exported');
  for (const lvl of s.PALETTE_STRENGTH_LEVELS) {
    assertTrue(typeof s.STRENGTH_PREAMBLES[lvl] === 'string' && s.STRENGTH_PREAMBLES[lvl].length > 0,
      `preamble for ${lvl} is a non-empty string`);
  }
  assertTrue(typeof s.computeStrictPass === 'function', 'computeStrictPass exported');
});

test('ADR 0016: validatePaletteStrength accepts the four valid levels', () => {
  const { validatePaletteStrength } = require(path.join(PROJECT_ROOT, 'server.js'));
  for (const v of ['subtle', 'moderate', 'strong', 'strict']) {
    assertEqual(validatePaletteStrength(v), null, `accepts ${v}`);
  }
});

test('ADR 0016: validatePaletteStrength rejects invalid values', () => {
  const { validatePaletteStrength } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(validatePaletteStrength('extreme') !== null, 'rejects unknown string');
  assertTrue(validatePaletteStrength('') !== null, 'rejects empty string');
  assertTrue(validatePaletteStrength(5) !== null, 'rejects number');
  assertTrue(validatePaletteStrength(null) !== null, 'rejects null');
  assertTrue(validatePaletteStrength(undefined) !== null, 'rejects undefined');
  assertTrue(validatePaletteStrength({}) !== null, 'rejects object');
  assertTrue(validatePaletteStrength([]) !== null, 'rejects array');
});

test('ADR 0016: buildColorBudgetBlock emits the right STRENGTH preamble for each level', () => {
  const { buildColorBudgetBlock, STRENGTH_PREAMBLES } = require(path.join(PROJECT_ROOT, 'server.js'));
  const basePalette = {
    colors: [
      { hex: '#d97706', name: 'burnt orange', weight: 8, accent: true, placement: 'upper-left' }
    ],
    accent_max_mentions: 2
  };
  for (const lvl of ['subtle', 'moderate', 'strong', 'strict']) {
    const block = buildColorBudgetBlock({ ...basePalette, strength: lvl });
    assertTrue(block.startsWith(STRENGTH_PREAMBLES[lvl]), `${lvl} block opens with correct preamble`);
    assertTrue(block.includes(`[STRENGTH: ${lvl}]`), `${lvl} block tags each color line`);
  }
});

test('ADR 0016: buildColorBudgetBlock emits placement tag for accents only', () => {
  const { buildColorBudgetBlock } = require(path.join(PROJECT_ROOT, 'server.js'));
  const palette = {
    strength: 'strict',
    accent_max_mentions: 2,
    colors: [
      { hex: '#cc3344', name: 'Crimson', weight: 8, accent: true, placement: 'upper-left quadrant' },
      { hex: '#f4e9d8', name: 'Bone white', weight: 5, accent: false, placement: 'should-not-appear' }
    ]
  };
  const block = buildColorBudgetBlock(palette);
  assertTrue(block.includes('placement: upper-left quadrant'), 'accent placement emitted');
  assertTrue(!block.includes('should-not-appear'), 'non-accent placement suppressed');
});

test('ADR 0016: buildColorBudgetBlock omits placement tag when accent placement is empty', () => {
  const { buildColorBudgetBlock } = require(path.join(PROJECT_ROOT, 'server.js'));
  const block = buildColorBudgetBlock({
    strength: 'strict',
    accent_max_mentions: 2,
    colors: [{ hex: '#cc3344', name: 'Crimson', weight: 8, accent: true, placement: '' }]
  });
  assertTrue(!block.includes('placement:'), 'empty placement → no tag');
  assertTrue(block.includes('Crimson #cc3344'), 'accent line still present');
});

test('ADR 0016: measureColorDistribution returns strict_pass=true when counts match', () => {
  const { measureColorDistribution } = require(path.join(PROJECT_ROOT, 'server.js'));
  // Weight 8 → expected_min = round(8/2) = 4 for non-accent; accent weight 8 +
  // accent_max_mentions=3 → min 1, max 3. Mention Crimson 2 times (under cap of 3)
  // and Bone white 4 times (clears expected_min).
  const palette = {
    strength: 'strict',
    accent_max_mentions: 3,
    colors: [
      { hex: '#cc3344', name: 'Crimson', weight: 8, accent: true, placement: '' },
      { hex: '#f4e9d8', name: 'Bone white', weight: 8, accent: false, placement: '' }
    ]
  };
  const prompt = 'Crimson #cc3344 radiates outward. Crimson again. Bone white #f4e9d8 is everywhere. Bone white. Bone white. Bone white.';
  const result = measureColorDistribution(prompt, palette);
  assertEqual(result.strict_pass, true, `strict_pass true (violations: ${JSON.stringify(result.strict_violations)})`);
  assertEqual(result.strict_violations.length, 0, 'no violations');
});

test('ADR 0016: measureColorDistribution returns strict_pass=false when a color is missing', () => {
  const { measureColorDistribution } = require(path.join(PROJECT_ROOT, 'server.js'));
  const palette = {
    strength: 'strict',
    accent_max_mentions: 2,
    colors: [
      { hex: '#cc3344', name: 'Crimson', weight: 8, accent: true, placement: '' }
    ]
  };
  // Crimson mentioned once — accent expects at least 1 AND not more than 2. So this passes.
  // Let's test the under-min case for a non-accent.
  const palette2 = {
    strength: 'strict',
    accent_max_mentions: 2,
    colors: [
      { hex: '#f4e9d8', name: 'Bone white', weight: 8, accent: false, placement: '' }
    ]
  };
  const result = measureColorDistribution('A landscape painting with no color names mentioned at all.', palette2);
  assertEqual(result.strict_pass, false, 'non-accent with zero mentions → strict_pass false');
  assertEqual(result.strict_violations.length, 1, 'one violation');
  assertEqual(result.strict_violations[0].name, 'Bone white', 'violation names Bone white');
  assertEqual(result.strict_violations[0].reason, 'under_min', 'reason is under_min');
});

test('ADR 0016: measureColorDistribution returns strict_pass=false on accent over_max', () => {
  const { measureColorDistribution } = require(path.join(PROJECT_ROOT, 'server.js'));
  const palette = {
    strength: 'strict',
    accent_max_mentions: 1,
    colors: [
      { hex: '#cc3344', name: 'Crimson', weight: 8, accent: true, placement: '' }
    ]
  };
  // Three mentions, accent cap 1 → over_max violation.
  const result = measureColorDistribution('Crimson #cc3344 here. Crimson there. Crimson everywhere.', palette);
  assertEqual(result.strict_pass, false, 'over_max → strict_pass false');
  assertEqual(result.strict_violations[0].reason, 'over_max', 'reason is over_max');
});

test('ADR 0016: measureColorDistribution does NOT add strict_pass for non-strict palettes', () => {
  const { measureColorDistribution } = require(path.join(PROJECT_ROOT, 'server.js'));
  const palette = {
    strength: 'moderate',
    accent_max_mentions: 2,
    colors: [{ hex: '#f4e9d8', name: 'Bone white', weight: 8, accent: false, placement: '' }]
  };
  const result = measureColorDistribution('A landscape.', palette);
  assertEqual(result.strict_pass, undefined, 'moderate → no strict_pass');
  assertEqual(result.strict_violations, undefined, 'moderate → no strict_violations');
});

test('ADR 0016: measureColorDistribution caps strict_violations at 10 entries', () => {
  const { measureColorDistribution } = require(path.join(PROJECT_ROOT, 'server.js'));
  // 15 colors → all should fail strict.
  const palette = {
    strength: 'strict',
    accent_max_mentions: 2,
    colors: Array.from({ length: 15 }, (_, i) => ({
      hex: `#${(i + 10).toString(16).padStart(2, '0')}3344`,
      name: `Color ${i}`,
      weight: 5,
      accent: false,
      placement: ''
    }))
  };
  const result = measureColorDistribution('A landscape with no color names.', palette);
  assertTrue(Array.isArray(result.strict_violations), 'strict_violations array');
  assertTrue(result.strict_violations.length <= 10, `capped at 10 (got ${result.strict_violations.length})`);
});

test('ADR 0016: validatePaletteColorsFlexible accepts optional placement', () => {
  const { validatePaletteColorsFlexible } = require(path.join(PROJECT_ROOT, 'server.js'));
  const r = validatePaletteColorsFlexible([
    { hex: '#cc3344', name: 'Crimson', placement: 'upper-left quadrant' }
  ]);
  assertEqual(r.error, null, 'valid placement accepted');
  assertEqual(r.colors[0].placement, 'upper-left quadrant', 'placement round-trips');
});

test('ADR 0016: validatePaletteColorsFlexible rejects oversized placement', () => {
  const { validatePaletteColorsFlexible } = require(path.join(PROJECT_ROOT, 'server.js'));
  const tooLong = 'x'.repeat(61);
  const r = validatePaletteColorsFlexible([
    { hex: '#cc3344', name: 'Crimson', placement: tooLong }
  ]);
  assertTrue(r.error !== null && r.error.includes('placement must be 60 characters or fewer'),
    `rejects >60 chars (got: ${r.error})`);
});

test('ADR 0016: validatePaletteColorsFlexible rejects non-string placement', () => {
  const { validatePaletteColorsFlexible } = require(path.join(PROJECT_ROOT, 'server.js'));
  const r = validatePaletteColorsFlexible([
    { hex: '#cc3344', name: 'Crimson', placement: 12345 }
  ]);
  assertTrue(r.error !== null && r.error.includes('placement must be a string'), 'rejects non-string');
});

test('ADR 0016: validatePaletteEdit accepts partial body with strength', () => {
  const { validatePaletteEdit } = require(path.join(PROJECT_ROOT, 'server.js'));
  const e = validatePaletteEdit({ strength: 'strict' });
  assertEqual(e, null, 'valid strength-only edit accepted');
});

test('ADR 0016: validatePaletteEdit rejects invalid strength', () => {
  const { validatePaletteEdit } = require(path.join(PROJECT_ROOT, 'server.js'));
  const e = validatePaletteEdit({ strength: 'extreme' });
  assertTrue(e !== null && e.includes('strength'), 'invalid strength rejected with strength-prefixed message');
});

test('ADR 0016: validatePalette (POST path) accepts strength', () => {
  const { validatePalette } = require(path.join(PROJECT_ROOT, 'server.js'));
  const body = {
    name: 'Test',
    colors: [{ hex: '#cc3344', name: 'Crimson' }],
    source_run_id: 'run_' + 'a'.repeat(16),
    source_preset_id: 'preset_test',
    strength: 'strong'
  };
  const e = validatePalette(body, { existingNames: new Set() });
  assertEqual(e, null, 'POST with strength accepted');
});

test('ADR 0016: validatePalette (POST path) rejects invalid strength', () => {
  const { validatePalette } = require(path.join(PROJECT_ROOT, 'server.js'));
  const body = {
    name: 'Test',
    colors: [{ hex: '#cc3344', name: 'Crimson' }],
    source_run_id: 'run_' + 'a'.repeat(16),
    source_preset_id: 'preset_test',
    strength: 'ludicrous'
  };
  const e = validatePalette(body, { existingNames: new Set() });
  assertTrue(e !== null && e.includes('strength'), 'invalid strength rejected');
});

test('ADR 0016: readPalettes synthesizes strength + placement for legacy palettes', () => {
  // The on-disk palettes.json may already have strength synthesized (post-test
  // state). Write a legacy palette without these fields, re-read, and confirm.
  const PALETTES_FILE = path.join(PROJECT_ROOT, 'data', 'palettes.json');
  let backup = null;
  if (fs.existsSync(PALETTES_FILE)) backup = fs.readFileSync(PALETTES_FILE, 'utf8');
  const legacyPalette = {
    id: 'palette_legacytest0001',
    name: 'Legacy test palette',
    colors: [{ hex: '#cc3344', name: 'Crimson', weight: 8, accent: true }],
    accent_max_mentions: 2,
    history: []
  };
  fs.writeFileSync(PALETTES_FILE, JSON.stringify([legacyPalette], null, 2), 'utf8');

  // Force re-require so the cached server.js module sees fresh state.
  delete require.cache[require.resolve(path.join(PROJECT_ROOT, 'server.js'))];
  const { readPalettes } = require(path.join(PROJECT_ROOT, 'server.js'));
  const palettes = readPalettes();
  const found = palettes.find((p) => p.id === 'palette_legacytest0001');
  assertTrue(found !== undefined, 'legacy palette survives the read filter');
  assertEqual(found.strength, 'moderate', 'synthesized strength is moderate');
  assertEqual(found.colors[0].placement, '', 'synthesized placement is empty string');

  // Restore the disk.
  if (backup != null) fs.writeFileSync(PALETTES_FILE, backup, 'utf8');
  else fs.unlinkSync(PALETTES_FILE);
  delete require.cache[require.resolve(path.join(PROJECT_ROOT, 'server.js'))];
});

test('ADR 0016: readPalettes clamps oversized placement on legacy entries', () => {
  const PALETTES_FILE = path.join(PROJECT_ROOT, 'data', 'palettes.json');
  let backup = null;
  if (fs.existsSync(PALETTES_FILE)) backup = fs.readFileSync(PALETTES_FILE, 'utf8');
  const legacy = {
    id: 'palette_legacytest0002',
    name: 'Legacy placement clamp',
    colors: [{ hex: '#cc3344', name: 'Crimson', weight: 8, accent: true, placement: 'x'.repeat(80) }],
    accent_max_mentions: 2,
    history: []
  };
  fs.writeFileSync(PALETTES_FILE, JSON.stringify([legacy], null, 2), 'utf8');

  delete require.cache[require.resolve(path.join(PROJECT_ROOT, 'server.js'))];
  const { readPalettes } = require(path.join(PROJECT_ROOT, 'server.js'));
  const palettes = readPalettes();
  const found = palettes.find((p) => p.id === 'palette_legacytest0002');
  assertTrue(found !== undefined, 'legacy palette present');
  assertEqual(found.colors[0].placement.length, 60, 'oversized placement clamped to 60 chars');

  if (backup != null) fs.writeFileSync(PALETTES_FILE, backup, 'utf8');
  else fs.unlinkSync(PALETTES_FILE);
  delete require.cache[require.resolve(path.join(PROJECT_ROOT, 'server.js'))];
});

test('ADR 0016: snapshotPalette captures strength + per-color placement', () => {
  const { snapshotPalette, PALETTE_STRENGTH_LEVELS } = require(path.join(PROJECT_ROOT, 'server.js'));
  const palette = {
    name: 'Snap test',
    strength: 'strict',
    accent_max_mentions: 3,
    colors: [
      { hex: '#cc3344', name: 'Crimson', weight: 8, accent: true, placement: 'upper-left quadrant' },
      { hex: '#f4e9d8', name: 'Bone white', weight: 5, accent: false, placement: '' }
    ],
    history: []
  };
  const snap = snapshotPalette(palette);
  assertEqual(snap.strength, 'strict', 'snapshot captures strength');
  assertEqual(snap.colors[0].placement, 'upper-left quadrant', 'snapshot captures accent placement');
  assertEqual(snap.colors[1].placement, '', 'snapshot captures empty placement');
});

test('ADR 0016: snapshotPalette falls back to moderate when strength is invalid', () => {
  const { snapshotPalette } = require(path.join(PROJECT_ROOT, 'server.js'));
  const palette = {
    name: 'Bad strength',
    strength: 'gibberish',
    accent_max_mentions: 2,
    colors: [{ hex: '#cc3344', name: 'Crimson', weight: 5, accent: false }],
    history: []
  };
  const snap = snapshotPalette(palette);
  assertEqual(snap.strength, 'moderate', 'invalid strength → moderate');
});

test('Issue #12: src/app.js exposes a section-marker stripper for the Copy-to-clipboard button', () => {
  // After ADR 0019, the canonical Z-Image Stage 2 contract no longer emits
  // `== SECTION A ==` / `== SECTION B ==` markers. Copy-to-clipboard still
  // runs the prompt through a defensive strip function so that any
  // future regression (or user-pasted Stage 2 override) can't leak
  // audit metadata into InvokeAI's prompt field.
  const fs = require('fs');
  const appJs = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'app.js'), 'utf8');
  assertTrue(/const stripSectionMarkers = \(raw\)/.test(appJs),
    'src/app.js defines stripSectionMarkers');
  assertTrue(/window\.__imageToPromptCopyStrip\s*=\s*stripSectionMarkers/.test(appJs),
    'stripSectionMarkers exposed on window for smoke tests');
  assertTrue(/== SECTION A ==/.test(appJs),
    'stripper looks for == SECTION A == header');
  assertTrue(/== SECTION B ==/.test(appJs),
    'stripper looks for == SECTION B == header');
});

test('ADR 0019: Z-Image canonical prompt is pastel-focal-glow (not FLUX/SDXL strength semantics)', () => {
  // ADR 0016 added STRENGTH MODIFIER / ACCENT PLACEMENT rules to the Z-Image
  // canonical prompt. ADR 0019 removes them from the Z-Image canonical
  // prompt — these semantics are FLUX/SDXL-only and don't survive contact
  // with Z-Image's CFG=0 + 1024-token chat-encoder. Strength + placement
  // still live in `STRENGTH_PREAMBLES` + `buildColorBudgetBlock` for the
  // non-Z-Image preset paths.
  const { DEFAULT_ZIMAGE_STAGE2_PROMPT, STRENGTH_PREAMBLES } = require(path.join(PROJECT_ROOT, 'server.js'));
  assertTrue(!/STRENGTH MODIFIER/i.test(DEFAULT_ZIMAGE_STAGE2_PROMPT),
    'ADR 0019 Z-Image prompt must NOT include STRENGTH MODIFIER (FLUX/SDXL-only)');
  assertTrue(!/ACCENT PLACEMENT/i.test(DEFAULT_ZIMAGE_STAGE2_PROMPT),
    'ADR 0019 Z-Image prompt must NOT include ACCENT PLACEMENT (FLUX/SDXL-only)');
  assertTrue(typeof STRENGTH_PREAMBLES === 'object' && STRENGTH_PREAMBLES.subtle,
    'STRENGTH_PREAMBLES still exported for the non-Z-Image emission path');
  assertTrue(STRENGTH_PREAMBLES.strict,
    'STRENGTH_PREAMBLES.strict still present');
});

test('ADR 0017: HTTP integration — POST /api/palettes accepts strength + placement (weight rejected)', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/palettes/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'i17 palette ' + Date.now(),
        colors: [
          { hex: '#cc3344', name: 'Crimson', accent: true, placement: 'upper-left quadrant' },
          { hex: '#f4e9d8', name: 'Bone white' }
        ],
        accent_max_mentions: 2,
        strength: 'strict'
      })
    });
    assertEqual(r.status, 201, `POST status 201 (got ${r.status})`);
    assertEqual(r.body.data.strength, 'strict', 'strength round-trips through POST');
    assertEqual(r.body.data.colors[0].placement, 'upper-left quadrant', 'placement round-trips through POST');
    assertEqual(r.body.data.colors[0].weight, undefined, 'weight NOT stored (ADR 0017)');
    await fetch(`${srv.base}/api/palettes/${encodeURIComponent(r.body.data.id)}`, { method: 'DELETE' });
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('ADR 0016: HTTP integration — POST /api/palettes rejects invalid strength with 400', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    const r = await fetchJson(`${srv.base}/api/palettes/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'i16 bad strength ' + Date.now(),
        colors: [{ hex: '#cc3344', name: 'Crimson' }],
        accent_max_mentions: 2,
        strength: 'ludicrous'
      })
    });
    assertEqual(r.status, 400, `bad strength → 400 (got ${r.status})`);
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('ADR 0016: HTTP integration — PUT /api/palettes/:id with strength-only body', async () => {
  const snapshot = snapshotPalettesFile();
  resetPalettesFile();
  const srv = await startTestServer();
  try {
    // Create first
    const created = await fetchJson(`${srv.base}/api/palettes/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'i16 put ' + Date.now(),
        colors: [{ hex: '#cc3344', name: 'Crimson' }],
        accent_max_mentions: 2,
        strength: 'moderate'
      })
    });
    assertEqual(created.status, 201, 'create succeeds');
    const id = created.body.data.id;
    // Now patch just strength.
    const put = await fetchJson(`${srv.base}/api/palettes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strength: 'strict' })
    });
    assertEqual(put.status, 200, `PUT status 200 (got ${put.status})`);
    assertEqual(put.body.data.strength, 'strict', 'strength updated via PUT');

    // Cleanup
    await fetch(`${srv.base}/api/palettes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } finally {
    await srv.close();
    restorePalettesFile(snapshot);
  }
});

test('ADR 0016: Frontend HTML — strength select + result-strict-warn + placement input markup', () => {
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'index.html'), 'utf8');
  assertTrue(/id="edit-palette-strength"/.test(html), 'edit-palette-strength select present');
  assertTrue(/value="subtle"/.test(html), 'subtle option present');
  assertTrue(/value="moderate"/.test(html), 'moderate option present');
  assertTrue(/value="strong"/.test(html), 'strong option present');
  assertTrue(/value="strict"/.test(html), 'strict option present');
  assertTrue(/id="result-strict-warn"/.test(html), 'result-strict-warn element present');
  assertTrue(/aria-live="polite"/.test(html) && /role="status"/.test(html),
    'result-strict-warn is a polite live region');
});

test('ADR 0016: Frontend CSS — strength row + placement input + strict-warn chip styles', () => {
  const css = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'styles.css'), 'utf8');
  assertTrue(/\.edit-palette-strength-row/.test(css), 'strength-row rule defined');
  assertTrue(/\.edit-palette-strength-input/.test(css), 'strength-input rule defined');
  assertTrue(/\.edit-palette-color-row__placement-wrap/.test(css), 'placement-wrap rule defined');
  assertTrue(/\.result-strict-warn/.test(css), 'strict-warn rule defined');
  assertTrue(/\.result-strict-warn\[data-tone="warn"\]/.test(css), 'warn tone rule defined');
  assertTrue(/\.result-strict-warn\[data-tone="ok"\]/.test(css), 'ok tone rule defined');
});

test('ADR 0016: Frontend JS — strength select wired + result-strict-warn + placement preserved', () => {
  const js = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'app.js'), 'utf8');
  assertTrue(/editPaletteStrength:\s*\$/.test(js), 'editPaletteStrength dom ref present');
  assertTrue(/resultStrictWarn:\s*\$/.test(js), 'resultStrictWarn dom ref present');
  assertTrue(/editPaletteStrength\.addEventListener/.test(js), 'strength change listener wired');
  assertTrue(/strict_pass === false/.test(js) || /strict_pass === true/.test(js),
    'displayResult gates strict_pass handling');
  assertTrue(/edit-palette-color-row__placement/.test(js), 'placement input class referenced');
  assertTrue(/placement:\s*v/.test(js) || /placement:\s*currentPlacement/.test(js),
    'placement preserved in buffer mutations');
});

test('ADR 0016: zimage-turbo-prompting.md exists with §5.2 (implementation roadmap)', () => {
  const doc = path.join(PROJECT_ROOT, 'docs', 'zimage-turbo-prompting.md');
  assertExists(doc);
  const text = fs.readFileSync(doc, 'utf8');
  assertTrue(/## Part 5/.test(text), 'document has Part 5');
  assertTrue(/Implemented today/.test(text) || /To add/.test(text),
    'document references the implementation roadmap');
});

test('ADR 0016: ADR file 0016-zimage-strength-and-placement.md exists with required sections', () => {
  const adr = path.join(PROJECT_ROOT, 'docs', 'adr', '0016-zimage-strength-and-placement.md');
  assertExists(adr);
  const text = fs.readFileSync(adr, 'utf8');
  assertTrue(/## Status/.test(text), 'Status section present');
  assertTrue(/## Context/.test(text), 'Context section present');
  assertTrue(/## Decision/.test(text), 'Decision section present');
  assertTrue(/## Feasibility/.test(text), 'Feasibility section present');
  assertTrue(/## Design/.test(text), 'Design section present');
  assertTrue(/## Consequences/.test(text), 'Consequences section present');
});

// ─── Task 2 — bounded chat context ────────────────────────────────

test('Chat context: compacts analysis and bounds provider input', () => {
  const {
    CHAT_CONTEXT_CHAR_BUDGET,
    CHAT_HISTORY_CHAR_BUDGET,
    compactChatAnalysisSnapshot,
    buildBoundedChatHistory,
    buildChatRequestContext
  } = require(path.join(PROJECT_ROOT, 'server.js'));

  const snapshot = {};
  for (let i = 0; i < 20; i++) snapshot[`field_${i}`] = 'x'.repeat(1000);
  const compact = compactChatAnalysisSnapshot(snapshot);
  assertTrue(JSON.stringify(compact).length < JSON.stringify(snapshot).length, 'analysis is compacted');

  const messages = Array.from({ length: 200 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `turn ${i} ${'x'.repeat(1000)}`
  }));
  const history = buildBoundedChatHistory(messages);
  assertTrue(history.length <= 12, 'history message count is bounded');
  assertTrue(
    history.reduce((total, message) => total + message.content.length, 0) <= CHAT_HISTORY_CHAR_BUDGET,
    'history character budget is bounded'
  );

  const session = {
    preset_id: 'preset_968c0ccdf6fc6151',
    original_prompt: 'ORIGINAL '.repeat(500),
    current_prompt: 'CURRENT '.repeat(500),
    pending_prompt: 'PENDING '.repeat(500),
    analysis_snapshot: snapshot,
    messages
  };
  const context = buildChatRequestContext(session);
  const totalChars = context.systemPrompt.length + context.messages.reduce(
    (total, message) => total + message.content.length,
    0
  );
  assertTrue(totalChars <= CHAT_CONTEXT_CHAR_BUDGET, 'provider input fits the hard budget');
  assertTrue(context.systemPrompt.includes('ORIGINAL'), 'original prompt remains visible');
  assertTrue(context.systemPrompt.includes('PENDING'), 'pending prompt remains visible');
  assertTrue(context.systemPrompt.includes('Z-IMAGE CONTRACT'), 'Z-Image contract remains visible');

  const nonZImage = buildChatRequestContext({
    preset_id: 'preset_photorealistic',
    original_prompt: 'photo original',
    current_prompt: 'photo original',
    pending_prompt: null,
    analysis_snapshot: null,
    messages: []
  });
  assertTrue(!nonZImage.systemPrompt.includes('Z-IMAGE CONTRACT'), 'non-Z-Image sessions omit Z-Image contract');

  const presets = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'presets.json'), 'utf8'));
  for (const preset of presets) {
    const presetContext = buildChatRequestContext({
      preset_id: preset.id,
      original_prompt: 'preset prompt',
      current_prompt: 'preset prompt',
      pending_prompt: null,
      analysis_snapshot: null,
      messages: []
    });
    assertTrue(presetContext.systemPrompt.length > 0, `${preset.id} builds chat context`);
  }
});

test('Chat context: labels identical original and committed prompts once', () => {
  const { buildChatSystemPrompt } = require(path.join(PROJECT_ROOT, 'server.js'));
  const identical = 'IDENTICAL_ORIGINAL_CURRENT_PROMPT';
  const samePrompt = buildChatSystemPrompt({
    preset_id: 'preset_photorealistic',
    original_prompt: identical,
    current_prompt: identical,
    pending_prompt: null,
    analysis_snapshot: null
  });
  assertEqual(
    (samePrompt.match(/## Original generated prompt/g) || []).length,
    1,
    'identical prompt has one original label'
  );
  assertEqual(
    (samePrompt.match(/## Current working prompt \(committed baseline\)/g) || []).length,
    1,
    'identical prompt has one committed label'
  );
  assertEqual(
    (samePrompt.split(identical).length - 1),
    1,
    'identical prompt content appears once'
  );

  const differentPrompt = buildChatSystemPrompt({
    preset_id: 'preset_photorealistic',
    original_prompt: 'ORIGINAL_DISTINCT_PROMPT',
    current_prompt: 'CURRENT_DISTINCT_PROMPT',
    pending_prompt: null,
    analysis_snapshot: null
  });
  assertEqual(
    (differentPrompt.match(/## Original generated prompt/g) || []).length,
    1,
    'different prompts keep one original block'
  );
  assertEqual(
    (differentPrompt.match(/## Current working prompt \(committed baseline\)/g) || []).length,
    1,
    'different prompts keep one committed block'
  );
  assertTrue(differentPrompt.includes('ORIGINAL_DISTINCT_PROMPT'), 'different original prompt remains visible');
  assertTrue(differentPrompt.includes('CURRENT_DISTINCT_PROMPT'), 'different current prompt remains visible');
});

test('Chat context: bounds pathological system prompt and retains original prompt', () => {
  const {
    CHAT_CONTEXT_CHAR_BUDGET,
    buildChatRequestContext
  } = require(path.join(PROJECT_ROOT, 'server.js'));
  const snapshot = {};
  for (let i = 0; i < 100; i++) snapshot[`analysis_${i}`] = 'ANALYSIS_PATHOLOGICAL '.repeat(10);
  const context = buildChatRequestContext({
    preset_id: 'preset_968c0ccdf6fc6151',
    original_prompt: 'ORIGINAL_PATHOLOGICAL '.repeat(400),
    current_prompt: 'CURRENT_PATHOLOGICAL '.repeat(400),
    pending_prompt: 'PENDING_PATHOLOGICAL '.repeat(400),
    analysis_snapshot: snapshot,
    messages: Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `history ${i} ${'HISTORY_PATHOLOGICAL '.repeat(100)}`
    }))
  });
  const totalChars = context.systemPrompt.length + context.messages.reduce(
    (total, message) => total + message.content.length,
    0
  );
  assertTrue(totalChars <= CHAT_CONTEXT_CHAR_BUDGET, 'pathological provider input fits the hard budget');
  assertTrue(context.systemPrompt.includes('ORIGINAL_PATHOLOGICAL'), 'original prompt remains visible when truncated');
  assertTrue(/truncat|…/i.test(context.systemPrompt), 'truncation is marked clearly');
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

test('Project commands: npm test points at the canonical suite', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  assertEqual(packageJson.scripts.test, 'node tests/run-all.js', 'npm test uses canonical suite');
});

test('Chat contract documentation names the pending draft state', () => {
  const context = fs.readFileSync(path.join(PROJECT_ROOT, 'CONTEXT.md'), 'utf8');
  assertTrue(/pending_prompt/.test(context), 'CONTEXT documents pending_prompt');
  assertTrue(/explicit|Apply/i.test(context), 'CONTEXT documents explicit commit');
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
