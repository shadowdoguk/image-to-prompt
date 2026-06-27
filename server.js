/**
 * Image-to-Prompt Backend Server
 *
 * Two-stage pipeline:
 *   Stage 1 (Vision LLM):  image + preset.stage1_system_prompt → structured JSON
 *   [User edits JSON + adds directives in the UI]
 *   Stage 2 (Text LLM):    edited JSON + directives + preset.stage2_system_prompt → final image-gen prompt
 *
 * Presets are stored in data/presets.json and exportable/importable as .i2p.json files.
 */

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3100;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_BYTES || '10485760', 10);

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.chat/v1';
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'MiniMax-Text-01';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

const minimaxConfigured = Boolean(
  MINIMAX_API_KEY &&
  MINIMAX_API_KEY !== 'your-minimax-api-key-here' &&
  MINIMAX_API_KEY.startsWith('sk-')
);

// ─────────────────────────────────────────────────────────────────────────────
// Field palette (single source of truth for Stage 1 schema + edit UI)
// ─────────────────────────────────────────────────────────────────────────────

const FIELD_PALETTE = {
  subject:             { type: 'string', label: 'Subject',             input: 'textarea' },
  subject_orientation: { type: 'string', label: 'Subject orientation', input: 'textarea' },
  actions:             { type: 'string', label: 'Actions / events',    input: 'textarea' },
  style:               { type: 'string', label: 'Style',               input: 'text' },
  mood:                { type: 'string', label: 'Mood',                input: 'textarea' },
  colors:              { type: 'array',  label: 'Colors',              input: 'colors', itemShape: { hex: 'string', name: 'string' } },
  lighting:            { type: 'string', label: 'Lighting',            input: 'text' },
  composition:         { type: 'string', label: 'Composition',         input: 'textarea' },
  era:                 { type: 'string', label: 'Era',                 input: 'text' },
  camera_angle:        { type: 'string', label: 'Camera angle',        input: 'text' },
  texture:             { type: 'string', label: 'Texture',             input: 'textarea' },
  artistic_medium:     { type: 'string', label: 'Artistic medium',     input: 'text' },
  depth_of_field:      { type: 'string', label: 'Depth of field',      input: 'text' },
  contrast:            { type: 'string', label: 'Contrast',            input: 'text' }
};

const VALID_FIELD_NAMES = Object.keys(FIELD_PALETTE);
const MAX_PROMPT_LENGTH = 5000;
const MAX_DIRECTIVES_LENGTH = 1000;
const PRESET_FILE_FORMAT = 'image-to-prompt-preset';
const PRESET_FILE_VERSION = 1;

// ─── Saved directives (ADR 0009) ─────────────────────────────────

const MAX_DIRECTIVE_NAME_LENGTH = 60;
const MAX_DIRECTIVE_CONTENT_LENGTH = 1000;
const MAX_DIRECTIVE_TAGS = 8;
const MAX_DIRECTIVE_TAG_LENGTH = 24;
const DIRECTIVE_FILE_FORMAT = 'image-to-prompt-directives';
const DIRECTIVE_FILE_VERSION = 1;
const DIRECTIVE_TAG_REGEX = /^[a-z0-9][a-z0-9-]*$/;

// ─── Post-generation chat (ADR 0011) ──────────────────────────────

const CHAT_SESSION_ID_PREFIX = 'chat_';
const CHAT_MESSAGE_ID_PREFIX = 'msg_';
const MAX_FINAL_PROMPT_LENGTH = 5000;
const MAX_CHAT_MESSAGE_LENGTH = 2000;
const MAX_CHAT_MESSAGES_PER_SESSION = 200;
const MAX_CHAT_SESSIONS_TOTAL = 200;
const CHAT_TITLE_MAX_LENGTH = 80;

// ─── Anchor-preserving chat refinements (ADR 0012) ────────────────
// Wholesale-rewrite prevention: the validator below scores how much
// of the current working prompt survives in the assistant's revision.
// These thresholds were chosen empirically against the paint-spec use
// case (see ADR 0012 §"Server-side validation") and other real
// prompts. Short prompts get a more permissive bar because the
// absolute number of unique content words is small and a 1-word miss
// swings the ratio.
const PRESERVATION_MIN_TOKEN_LENGTH = 3;
const PRESERVATION_SHORT_PROMPT_LENGTH = 200;
const PRESERVATION_KEYWORD_THRESHOLD_LONG = 0.70;
const PRESERVATION_KEYWORD_THRESHOLD_SHORT = 0.50;
const PRESERVATION_BIGRAM_THRESHOLD_LONG = 0.40;
const PRESERVATION_BIGRAM_THRESHOLD_SHORT = 0.20;
const PRESERVATION_FAILED_REPLY_NOTE =
  " (Note: I'd proposed a revision but it would have dropped too much of the original context — paint application, the original values, and the production requirements. Try a more specific request, e.g. \"only change the colors to navy, gold, white; keep everything else exactly as is.\")";

// Common English stop words plus chat noise ("hi", "ok", "thanks"). The
// validator works on content words only; including these would inflate
// both sides and mask the real signal.
const PRESERVATION_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
  'has', 'have', 'he', 'her', 'his', 'i', 'in', 'is', 'it', 'its', 'me',
  'my', 'of', 'on', 'or', 'our', 'she', 'so', 'that', 'the', 'their',
  'them', 'they', 'this', 'to', 'was', 'we', 'were', 'what', 'when',
  'where', 'which', 'who', 'why', 'will', 'with', 'you', 'your',
  'hi', 'hey', 'hello', 'ok', 'okay', 'thanks', 'thank', 'please',
  'just', 'only', 'also', 'can', 'could', 'would', 'should', 'may',
  'might', 'must', 'shall', 'do', 'does', 'did', 'doing', 'done',
  'have', 'having', 'had', 'get', 'got', 'getting', 'make', 'made',
  'making', 'keep', 'kept', 'keeping', 'change', 'changed', 'changes',
  'changing', 'use', 'used', 'using', 'want', 'wanted', 'wanting',
  'need', 'needed', 'needing', 'like', 'liked', 'liking', 'now',
  'then', 'than', 'very', 'really', 'much', 'more', 'less', 'most',
  'least', 'some', 'any', 'all', 'each', 'every', 'no', 'not', 'yes'
]);

// Cap on Stage 2 output tokens. Raised from 800 → 960 (+20%) so the
// final image-generation prompt has room for richer detail without
// truncating mid-sentence. The LLM is free to use less if the analysis
// doesn't warrant it; this only widens the ceiling.
const MAX_STAGE2_TOKENS = 960;

/**
 * Per-field overrides applied on top of the global `FIELD_INPUT_MIN_LENGTH` and
 * the JSON Schema. Keys must be valid `FIELD_PALETTE` names. Each hint may set:
 *   - `minLength` (chars, replaces the input-type default for this field)
 *   - `description` (appended to the Stage 1 system prompt via
 *     `buildFieldFormatOverridePrompt` so the LLM sees the per-field contract
 *     for every field that has a hint. This text is NOT sent in the JSON Schema
 *     because the MiniMax M3 API rejects schema `description` strings over
 *     200 characters with error code 2013 — verified live 2026-06-22.)
 *
 * ADR 0003: `subject` is the canonical case — the rest of the palette uses the
 * generic input-type floor.
 */
const FIELD_FORMAT_HINTS = {
  subject: {
    minLength: 600,
    description: 'Exhaustive paragraph-length description of the image. Cover EVERY visible element: every person, figure, object, and significant feature in the image. Include precise spatial positioning (left/right/center, top/bottom, foreground/midground/background, relative to other elements); clothing, accessories, and appearance for figures; primary facial expression and visible body language; hand/arm positions and any visible actions; major objects and props, named specifically; notable environment and background details. Write as ONE cohesive paragraph, 120-200 words, 4-8 sentences. NEVER shorter than 100 words. NEVER invent details not visible in the image.'
  }
};

/**
 * Build a per-field format override block to append to the Stage 1 system prompt.
 * Only fields in `fieldNames` that have a `FIELD_FORMAT_HINTS` entry are listed.
 * Returns an empty string if no hints apply (so the caller can always concatenate
 * without a conditional).
 *
 * Append (not prepend) so the per-preset specialty focus and description-first
 * contract remain in the LLM's primary attention window. The override block
 * then explicitly states "these rules override the FIELD FORMAT block above where
 * they conflict" so the LLM doesn't treat the override as additive guidance.
 */
const buildFieldFormatOverridePrompt = (fieldNames) => {
  const applicable = fieldNames
    .map((name) => ({ name, hint: FIELD_FORMAT_HINTS[name] }))
    .filter((x) => x.hint?.description);
  if (applicable.length === 0) return '';

  const lines = applicable.map(({ name, hint }) =>
    `- \`${name}\` (min ${hint.minLength} chars): ${hint.description}`
  );

  return `\n\n# PER-FIELD OVERRIDES (override the FIELD FORMAT block above where they conflict)\n\nThe following fields have stricter length and content rules than the generic format block above. These are enforced at the schema level — values that don't meet them will be rejected.\n\n${lines.join('\n\n')}\n`;
};

/**
 * Build the strengthened-prompt suffix appended to a Stage 1 retry call
 * (ADR 0001's 2-attempt loop).
 *
 * For every violation the field name and actual/required char counts are
 * listed. If the failing field has an entry in FIELD_FORMAT_HINTS, the FULL
 * per-field contract description is RE-STATED in the retry so the LLM does
 * not have to remember it from earlier in the (now ~4800-char) system prompt.
 *
 * Why this matters: ADR 0003 moved the per-field contract text into the system
 * prompt via `buildFieldFormatOverridePrompt` (schema `description` was
 * rejected by the API with code 2013 for >200 chars). That text is appended
 * at the END of the preset's stage1_system_prompt, so attention to it is
 * diluted by the preset's specialty focus, the description-first contract,
 * and the field-format block. When Stage 1 attempt 1 returns short values,
 * the previous retry only re-listed field names + counts, expecting the LLM
 * to recall the contract from earlier in the prompt. Live data in server.log
 * showed this recall failing: attempt 2 still had 10 length violations,
 * including `subject` at <100 chars against a 600-char requirement.
 *
 * Re-stating the contract in the retry puts the strongest possible
 * instruction right where the LLM is about to act, eliminating the recall
 * burden. For fields without a hint, the fallback is the existing
 * "field: actual chars (need ≥required)" format — backward compatible with
 * any field that might be added to the palette without a hint.
 *
 * Capped at 1 retry by the caller (ADR 0001). Best-effort result is returned
 * if the retry also fails; that outcome is logged but does not block the
 * response.
 */
const buildStage1RetrySuffix = (violations) => {
  const lines = violations.map((v) => {
    const hint = FIELD_FORMAT_HINTS[v.field];
    if (hint?.description) {
      return `- \`${v.field}\` (currently ${v.actual} chars; need ≥${v.required}): ${hint.description}`;
    }
    return `- ${v.field}: ${v.actual} chars (need ≥${v.required})`;
  });

  return `\n\n# CRITICAL: REJECTED FOR BEING TOO SHORT\n\nYour previous attempt returned values that are too short. You MUST expand each of the following fields to meet the minimum length requirement. The contract for each field is RE-STATED IN FULL below — comply with it exactly. Do NOT respond with a one-sentence stub or a placeholder.\n\n${lines.join('\n\n')}\n\nRespond with the FULL expanded JSON object (not a partial fix).`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Uploads directory + multer config
// ─────────────────────────────────────────────────────────────────────────────

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype) && ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: JPG, PNG, WebP (max ${MAX_FILE_SIZE / 1024 / 1024}MB).`));
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Data files
// ─────────────────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, 'data');
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json');
const PALETTES_FILE = path.join(DATA_DIR, 'palettes.json');
const DIRECTIVES_FILE = path.join(DATA_DIR, 'directives.json');
const CHAT_SESSIONS_FILE = path.join(DATA_DIR, 'chat_sessions.json');

const ensureDataFileExists = () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PRESETS_FILE)) fs.writeFileSync(PRESETS_FILE, '[]', 'utf8');
  if (!fs.existsSync(PALETTES_FILE)) fs.writeFileSync(PALETTES_FILE, '[]', 'utf8');
  if (!fs.existsSync(DIRECTIVES_FILE)) fs.writeFileSync(DIRECTIVES_FILE, '[]', 'utf8');
  if (!fs.existsSync(CHAT_SESSIONS_FILE)) fs.writeFileSync(CHAT_SESSIONS_FILE, '[]', 'utf8');
};

const readPresets = () => {
  ensureDataFileExists();
  try {
    return JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to read presets:', e.message);
    return [];
  }
};

const writePresets = (presets) => {
  ensureDataFileExists();
  fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2), 'utf8');
};

// ─────────────────────────────────────────────────────────────────────────────
// Subject-extraction prompt (ADR 0005) — persisted to disk, editable from UI
// ─────────────────────────────────────────────────────────────────────────────

const SUBJECT_PROMPT_FILE = path.join(DATA_DIR, 'subject_prompt.json');
const MAX_SUBJECT_PROMPT_LENGTH = 10000;

/**
 * Read the active subject-extraction prompt from `data/subject_prompt.json`.
 * On first read (file missing), seeds the file with the shipped default.
 * On a corrupt file, logs a warning and returns the default so the UI never
 * gets stuck without a usable prompt.
 */
const readSubjectPrompt = () => {
  ensureDataFileExists();
  if (!fs.existsSync(SUBJECT_PROMPT_FILE)) {
    try {
      fs.writeFileSync(
        SUBJECT_PROMPT_FILE,
        JSON.stringify({ prompt: DEFAULT_SUBJECT_PROMPT }, null, 2),
        'utf8'
      );
    } catch (e) {
      console.error('Failed to seed subject prompt file:', e.message);
      return DEFAULT_SUBJECT_PROMPT;
    }
    return DEFAULT_SUBJECT_PROMPT;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(SUBJECT_PROMPT_FILE, 'utf8'));
    if (parsed && typeof parsed.prompt === 'string' && parsed.prompt.length > 0) {
      return parsed.prompt;
    }
    console.warn('Subject prompt file has invalid shape; falling back to default');
    return DEFAULT_SUBJECT_PROMPT;
  } catch (e) {
    console.error('Failed to read subject prompt:', e.message);
    return DEFAULT_SUBJECT_PROMPT;
  }
};

/**
 * Write the active subject-extraction prompt to `data/subject_prompt.json`.
 * Caller is responsible for validation (see `validateSubjectPrompt`).
 */
const writeSubjectPrompt = (prompt) => {
  ensureDataFileExists();
  fs.writeFileSync(SUBJECT_PROMPT_FILE, JSON.stringify({ prompt }, null, 2), 'utf8');
};

/**
 * Validate an incoming subject-prompt body for `PUT /api/subject-prompt`.
 * Returns an error string, or null when valid.
 */
const validateSubjectPrompt = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object with a "prompt" string.';
  }
  if (typeof body.prompt !== 'string') {
    return '"prompt" must be a string.';
  }
  if (body.prompt.trim().length === 0) {
    return '"prompt" must not be empty.';
  }
  if (body.prompt.length > MAX_SUBJECT_PROMPT_LENGTH) {
    return `"prompt" must be ${MAX_SUBJECT_PROMPT_LENGTH} characters or fewer (got ${body.prompt.length}).`;
  }
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 prompt overrides (ADR 0007) — per-preset, persisted to disk
// ─────────────────────────────────────────────────────────────────────────────

const STAGE2_OVERRIDES_FILE = path.join(DATA_DIR, 'stage2_overrides.json');
const MAX_STAGE2_PROMPT_LENGTH = 10000;

/**
 * Read the per-preset Stage 2 system-prompt overrides map from disk.
 * Seeds the file with `{}` on first read. Drops malformed entries with a
 * console warning so a single corrupt row doesn't break reads of the
 * rest of the map.
 *
 * Shape: { [presetId: string]: string }
 *
 * @returns {Object<string, string>}
 */
const readStage2Overrides = () => {
  ensureDataFileExists();
  if (!fs.existsSync(STAGE2_OVERRIDES_FILE)) {
    try {
      fs.writeFileSync(STAGE2_OVERRIDES_FILE, '{}', 'utf8');
    } catch (e) {
      console.error('Failed to seed stage2 overrides file:', e.message);
      return {};
    }
  }
  let raw;
  try {
    raw = fs.readFileSync(STAGE2_OVERRIDES_FILE, 'utf8');
  } catch (e) {
    console.error('Failed to read stage2 overrides:', e.message);
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('Stage 2 overrides file is corrupt JSON; returning empty map:', e.message);
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.warn('Stage 2 overrides file is not an object; returning empty map');
    return {};
  }
  const clean = {};
  for (const [presetId, value] of Object.entries(parsed)) {
    if (typeof presetId !== 'string' || !presetId.startsWith(PRESET_ID_PREFIX)) continue;
    if (typeof value !== 'string' || value.length === 0) continue;
    clean[presetId] = value;
  }
  return clean;
};

/**
 * Atomic-ish write: write to a sibling temp file, then rename over the
 * target. POSIX rename is atomic on the same filesystem. Mirrors the
 * `writePalettes` pattern (ADR 0006).
 */
const writeStage2Overrides = (overrides) => {
  ensureDataFileExists();
  const tmpFile = `${STAGE2_OVERRIDES_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(overrides, null, 2), 'utf8');
  fs.renameSync(tmpFile, STAGE2_OVERRIDES_FILE);
};

/**
 * Get the override for a specific preset, or `null` if no override exists.
 * Single-entry read so a "Use preset default" action can cheaply check
 * whether an override is currently in force.
 */
const getStage2Override = (presetId) => {
  if (!presetId || typeof presetId !== 'string') return null;
  const overrides = readStage2Overrides();
  return Object.prototype.hasOwnProperty.call(overrides, presetId)
    ? overrides[presetId]
    : null;
};

/**
 * Write or overwrite the override for a specific preset.
 * Caller is responsible for validation (see `validateStage2Prompt`).
 */
const setStage2Override = (presetId, prompt) => {
  const overrides = readStage2Overrides();
  overrides[presetId] = prompt;
  writeStage2Overrides(overrides);
};

/**
 * Remove the override for a specific preset. No-op if no override exists.
 * Returns `true` when an entry was actually removed, `false` otherwise.
 */
const removeStage2Override = (presetId) => {
  if (!presetId || typeof presetId !== 'string') return false;
  const overrides = readStage2Overrides();
  if (!Object.prototype.hasOwnProperty.call(overrides, presetId)) return false;
  delete overrides[presetId];
  writeStage2Overrides(overrides);
  return true;
};

/**
 * Resolve the effective Stage 2 system prompt for a preset: override if
 * one exists, otherwise the preset's built-in `stage2_system_prompt`.
 * Read fresh on every call (no cache) so edits via the modal take effect
 * immediately, mirroring ADR 0005's `readSubjectPrompt` pattern.
 */
const getEffectiveStage2Prompt = (preset) => {
  if (!preset || typeof preset !== 'object') return '';
  const override = getStage2Override(preset.id);
  return override != null ? override : (preset.stage2_system_prompt || '');
};

/**
 * Validate an incoming `PUT /api/stage2-prompt` body. Returns an error
 * string, or null when valid. Same shape / emptiness / length rules as
 * `validateSubjectPrompt` (ADR 0005).
 */
const validateStage2Prompt = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object with a "prompt" string.';
  }
  if (typeof body.prompt !== 'string') {
    return '"prompt" must be a string.';
  }
  if (body.prompt.trim().length === 0) {
    return '"prompt" must not be empty.';
  }
  if (body.prompt.length > MAX_STAGE2_PROMPT_LENGTH) {
    return `"prompt" must be ${MAX_STAGE2_PROMPT_LENGTH} characters or fewer (got ${body.prompt.length}).`;
  }
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Saved color palettes (ADR 0006) — persistent file + CRUD helpers
// ─────────────────────────────────────────────────────────────────────────────

const MAX_PALETTE_NAME_LENGTH = 60;
const MAX_PALETTE_COLORS = 50;
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const RUN_ID_REGEX = /^run_[0-9a-f]{16}$/;
const PRESET_ID_PREFIX = 'preset_';

const generatePaletteId = () => `palette_${crypto.randomBytes(8).toString('hex')}`;

const generateRunId = () => `run_${crypto.randomBytes(8).toString('hex')}`;

/**
 * Read all saved palettes from disk. Seeds the file with `[]` on first read.
 * Drops malformed entries with a console warning so a single corrupt row
 * doesn't brick the whole list — the picker still renders the rest.
 *
 * @returns {Array<object>} array of palette objects
 */
const readPalettes = () => {
  ensureDataFileExists();
  let raw;
  try {
    raw = fs.readFileSync(PALETTES_FILE, 'utf8');
  } catch (e) {
    console.error('Failed to read palettes file:', e.message);
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('Palettes file is corrupt JSON; returning empty list:', e.message);
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.warn('Palettes file is not an array; returning empty list');
    return [];
  }
  return parsed.filter((p) => {
    if (!p || typeof p !== 'object') return false;
    if (typeof p.id !== 'string' || !p.id.startsWith('palette_')) return false;
    if (typeof p.name !== 'string' || p.name.trim().length === 0) return false;
    if (!Array.isArray(p.colors)) return false;
    // history[] is required by ADR 0013, but we tolerate legacy entries
    // that pre-date the field. They get a synthesized empty array here;
    // the first PUT on such an entry pushes v1 to history. Keeping them
    // visible avoids forcing the user to re-save existing palettes.
    if (!Array.isArray(p.history)) p.history = [];
    return true;
  });
};

/**
 * Atomic-ish write: write to a sibling temp file, then rename over the
 * target. POSIX rename is atomic on the same filesystem. Guards against
 * half-written files on crash.
 */
const writePalettes = (palettes) => {
  ensureDataFileExists();
  const tmpFile = `${PALETTES_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(palettes, null, 2), 'utf8');
  fs.renameSync(tmpFile, PALETTES_FILE);
};

/**
 * Validate the `colors` array on an incoming palette body. Returns
 * an error string or null. Reused by validatePalette and by the PUT
 * rename path (which doesn't allow colors to change but does need
 * to validate them if included for some reason — currently not).
 *
 * @param {*} colors
 * @returns {string|null}
 */
const validatePaletteColors = (colors) => {
  if (!Array.isArray(colors)) return 'colors must be an array';
  if (colors.length === 0) return 'colors must contain at least one entry';
  if (colors.length > MAX_PALETTE_COLORS) {
    return `colors must contain ${MAX_PALETTE_COLORS} or fewer entries (got ${colors.length})`;
  }
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      return `colors[${i}] must be an object`;
    }
    if (typeof c.hex !== 'string' || !HEX_COLOR_REGEX.test(c.hex)) {
      return `colors[${i}].hex must match #RRGGBB (got ${JSON.stringify(c.hex)})`;
    }
    if (typeof c.name !== 'string') {
      return `colors[${i}].name must be a string`;
    }
  }
  return null;
};

/**
 * Validate an incoming palette body. `existingNames` is the
 * lower-cased set of names already in storage — used for the
 * uniqueness check. Pass the SAME palette being updated under
 * PUT so a rename-to-same-name is allowed.
 *
 * @param {*} body - request body
 * @param {object} opts
 * @param {Set<string>} opts.existingNames - lower-cased names of existing palettes
 * @param {string} [opts.excludeId] - palette id to exclude from uniqueness check
 * @returns {string|null}
 */
const validatePalette = (body, { existingNames, excludeId } = {}) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object.';
  }

  // name
  if (typeof body.name !== 'string') {
    return 'name must be a string';
  }
  const trimmedName = body.name.trim();
  if (trimmedName.length === 0) {
    return 'name must not be empty';
  }
  if (trimmedName.length > MAX_PALETTE_NAME_LENGTH) {
    return `name must be ${MAX_PALETTE_NAME_LENGTH} characters or fewer (got ${trimmedName.length})`;
  }
  const lower = trimmedName.toLowerCase();
  if (existingNames && existingNames.has(lower)) {
    return `name "${trimmedName}" is already in use by another saved palette`;
  }

  // colors
  const colorsError = validatePaletteColors(body.colors);
  if (colorsError) return colorsError;

  // source_run_id
  if (typeof body.source_run_id !== 'string' || !RUN_ID_REGEX.test(body.source_run_id)) {
    return `source_run_id must match /^run_[0-9a-f]{16}$/ (got ${JSON.stringify(body.source_run_id)})`;
  }

  // source_preset_id
  if (typeof body.source_preset_id !== 'string' || !body.source_preset_id.startsWith(PRESET_ID_PREFIX)) {
    return `source_preset_id must be a string starting with "${PRESET_ID_PREFIX}" (got ${JSON.stringify(body.source_preset_id)})`;
  }

  return null;
};

/**
 * Validate a rename body (PUT /api/palettes/:id). Only `name` is
 * mutable. Returns an error string or null.
 */
const validatePaletteName = (body, { existingNames, excludeId } = {}) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object with a "name" string.';
  }
  if (typeof body.name !== 'string') {
    return 'name must be a string';
  }
  const trimmed = body.name.trim();
  if (trimmed.length === 0) return 'name must not be empty';
  if (trimmed.length > MAX_PALETTE_NAME_LENGTH) {
    return `name must be ${MAX_PALETTE_NAME_LENGTH} characters or fewer (got ${trimmed.length})`;
  }
  if (existingNames && existingNames.has(trimmed.toLowerCase())) {
    return `name "${trimmed}" is already in use by another saved palette`;
  }
  return null;
};

/**
 * Pure function: apply a saved palette to a Stage 1 analysis result.
 * Replaces the analysis's `colors` field with the palette's colors
 * and (defensively) returns the same object reference mutated. Used
 * by /api/analyze after the LLM call returns, when a paletteId was
 * supplied in the form.
 *
 * Separated from the route so it can be unit-tested without spinning
 * up the server or mocking the LLM.
 *
 * @param {object} analysis - parsed Stage 1 result
 * @param {object} palette - saved palette object { colors: [...] }
 * @returns {object} the same analysis object, with colors replaced
 */
const applyPaletteToAnalysis = (analysis, palette) => {
  if (!analysis || typeof analysis !== 'object') return analysis;
  if (!palette || !Array.isArray(palette.colors)) return analysis;
  analysis.colors = palette.colors.map((c) => ({
    hex: typeof c.hex === 'string' ? c.hex.toLowerCase() : c.hex,
    name: typeof c.name === 'string' ? c.name : ''
  }));
  return analysis;
};

// ─── ADR 0013 — palette editing, custom-create, version tracking ────────
//
// The existing palette helpers above (validatePalette, writePalettes,
// etc.) are reused. The helpers below add:
//   - color parsing in hex / rgb / hsl (ADR 0013 §2)
//   - partial edit validation (ADR 0013 §3)
//   - per-palette history push (ADR 0013 §1)

const MAX_PALETTE_HISTORY = 200;

/**
 * Parse a single user-entered color string into canonical hex form.
 * Accepts:
 *   - `#rrggbb`, `#rgb` (with or without the leading `#`)
 *   - `rgb(r, g, b)` / `rgb(r,g,b)` (case-insensitive, whitespace-tolerant)
 *   - `hsl(h, s%, l%)` (same tolerance rules)
 * Rejects `rgba(...)`, `hsla(...)`, out-of-range channels, and anything
 * that doesn't match the three accepted shapes. Returns `{ hex }` on
 * success or `{ error }` on failure. `hex` is always lowercase and 7
 * characters (`#rrggbb`).
 *
 * @param {*} raw
 * @returns {{ hex: string } | { error: string }}
 */
const parseColorInput = (raw) => {
  if (typeof raw !== 'string') {
    return { error: 'color value must be a string' };
  }
  const s = raw.trim().toLowerCase();
  if (s.length === 0) {
    return { error: 'color value must not be empty' };
  }

  // Hex form (3 or 6 hex chars, optional leading `#`).
  if (/^#?[0-9a-f]{3}$/.test(s)) {
    const digits = s.replace(/^#/, '');
    const expanded = digits[0] + digits[0] + digits[1] + digits[1] + digits[2] + digits[2];
    return { hex: `#${expanded}` };
  }
  if (/^#?[0-9a-f]{6}$/.test(s)) {
    return { hex: `#${s.replace(/^#/, '')}` };
  }

  // rgb(r, g, b)
  const rgbMatch = s.match(/^rgba?\(\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*\)$/);
  if (rgbMatch) {
    if (s.startsWith('rgba(')) {
      return { error: 'rgba() is not supported (alpha channel not implemented yet)' };
    }
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    if ([r, g, b].some((v) => !Number.isInteger(v) || v < 0 || v > 255)) {
      return { error: `rgb() channels must be integers in 0..255 (got rgb(${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]}))` };
    }
    const toHex = (n) => n.toString(16).padStart(2, '0');
    return { hex: `#${toHex(r)}${toHex(g)}${toHex(b)}` };
  }

  // hsl(h, s%, l%)
  const hslMatch = s.match(/^hsla?\(\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)%\s*,\s*([+-]?[\d.]+)%\s*\)$/);
  if (hslMatch) {
    if (s.startsWith('hsla(')) {
      return { error: 'hsla() is not supported (alpha channel not implemented yet)' };
    }
    const h = parseFloat(hslMatch[1]);
    const sPct = parseFloat(hslMatch[2]);
    const lPct = parseFloat(hslMatch[3]);
    if (!Number.isFinite(h) || h < 0 || h > 360) {
      return { error: `hsl() hue must be in 0..360 (got ${hslMatch[1]})` };
    }
    if (!Number.isFinite(sPct) || sPct < 0 || sPct > 100) {
      return { error: `hsl() saturation must be 0..100% (got ${hslMatch[2]}%)` };
    }
    if (!Number.isFinite(lPct) || lPct < 0 || lPct > 100) {
      return { error: `hsl() lightness must be 0..100% (got ${hslMatch[3]}%)` };
    }
    const sNorm = sPct / 100;
    const lNorm = lPct / 100;
    const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
    const hh = h / 60;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    let r1 = 0, g1 = 0, b1 = 0;
    if (hh < 1) [r1, g1, b1] = [c, x, 0];
    else if (hh < 2) [r1, g1, b1] = [x, c, 0];
    else if (hh < 3) [r1, g1, b1] = [0, c, x];
    else if (hh < 4) [r1, g1, b1] = [0, x, c];
    else if (hh < 5) [r1, g1, b1] = [x, 0, c];
    else [r1, g1, b1] = [c, 0, x];
    const m = lNorm - c / 2;
    const r = Math.round((r1 + m) * 255);
    const g = Math.round((g1 + m) * 255);
    const b = Math.round((b1 + m) * 255);
    const clamp = (n) => Math.max(0, Math.min(255, n));
    const toHex = (n) => clamp(n).toString(16).padStart(2, '0');
    return { hex: `#${toHex(r)}${toHex(g)}${toHex(b)}` };
  }

  return { error: `unsupported color format: ${JSON.stringify(raw)} (expected #RRGGBB, rgb(r,g,b), or hsl(h,s%,l%))` };
};

/**
 * Validate + normalize the `colors` array on an incoming palette body,
 * accepting any of the three input formats (hex / rgb / hsl). Returns
 * `{ colors, error }` — on success `colors` is the canonicalized
 * `[{ hex, name }]` array ready to persist. On failure `colors` is
 * null. Mirrors `validatePaletteColors` but with the parser inside.
 *
 * @param {*} colors
 * @returns {{ colors: Array<object>|null, error: string|null }}
 */
const validatePaletteColorsFlexible = (colors) => {
  if (!Array.isArray(colors)) return { colors: null, error: 'colors must be an array' };
  if (colors.length === 0) return { colors: null, error: 'colors must contain at least one entry' };
  if (colors.length > MAX_PALETTE_COLORS) {
    return { colors: null, error: `colors must contain ${MAX_PALETTE_COLORS} or fewer entries (got ${colors.length})` };
  }
  const out = [];
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      return { colors: null, error: `colors[${i}] must be an object` };
    }
    const parsed = parseColorInput(c.hex);
    if (parsed.error) {
      return { colors: null, error: `colors[${i}].hex: ${parsed.error}` };
    }
    if (typeof c.name !== 'string') {
      return { colors: null, error: `colors[${i}].name must be a string` };
    }
    out.push({ hex: parsed.hex, name: c.name });
  }
  return { colors: out, error: null };
};

/**
 * Validate a partial edit body for `PUT /api/palettes/:id` (ADR 0013
 * §3). Empty body → 400. Each present field is validated; name
 * uniqueness is checked against `existingNames` minus the palette
 * being edited (passed via `excludeId`).
 *
 * Returns an error string, or null when valid. The caller is expected
 * to use `applyPaletteUpdate` to mutate the palette in place.
 *
 * @param {*} body
 * @param {object} opts
 * @param {Set<string>} [opts.existingNames]
 * @param {string} [opts.excludeId]
 * @returns {string|null}
 */
const validatePaletteEdit = (body, { existingNames, excludeId } = {}) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object.';
  }
  const hasName = body.name !== undefined;
  const hasColors = body.colors !== undefined;
  if (!hasName && !hasColors) {
    return 'At least one of "name" or "colors" must be provided.';
  }
  if (hasName) {
    const nameError = validatePaletteName({ name: body.name }, { existingNames, excludeId });
    if (nameError) return nameError;
  }
  if (hasColors) {
    const r = validatePaletteColorsFlexible(body.colors);
    if (r.error) return r.error;
  }
  return null;
};

/**
 * Pure helper: apply validated edit fields to an existing palette in
 * place. Caller has already validated `body` via `validatePaletteEdit`
 * and ensured the colors are normalized (use
 * `validatePaletteColorsFlexible(...).colors`). Returns null on success
 * or an error string. Caller is responsible for pushing the history
 * entry AFTER this function returns (so the history captures the NEW
 * state, not the pre-update state).
 *
 * @param {object} palette
 * @param {object} body
 * @returns {string|null}
 */
const applyPaletteUpdate = (palette, body) => {
  if (body.name !== undefined) {
    palette.name = body.name.trim();
  }
  if (body.colors !== undefined) {
    // body.colors should already be the normalized array from
    // validatePaletteColorsFlexible, but we re-normalize defensively in
    // case the caller skipped that path.
    const r = validatePaletteColorsFlexible(body.colors);
    if (r.error) return r.error;
    palette.colors = r.colors;
  }
  return null;
};

/**
 * Build a fresh history entry from the current top-level state of a
 * palette. Captures `name` + `colors` (the only mutable top-level
 * fields). Caller has already mutated `palette` to its new state; we
 * capture the snapshot for history.
 */
const snapshotPalette = (palette) => ({
  version: (Array.isArray(palette.history) ? palette.history.length : 0) + 1,
  name: palette.name,
  colors: palette.colors.map((c) => ({ hex: c.hex, name: c.name })),
  saved_at: new Date().toISOString()
});

/**
 * Append a new history entry to a palette using its CURRENT top-level
 * values, then bump `updated_at`. Used both on initial POST and on
 * PUT/restore — every write that produces a new user-visible state
 * records it in history. Caps history length at MAX_PALETTE_HISTORY
 * (FIFO from the front) so a heavily-edited palette doesn't grow
 * without bound.
 */
const pushPaletteHistory = (palette) => {
  if (!Array.isArray(palette.history)) palette.history = [];
  palette.history.push(snapshotPalette(palette));
  while (palette.history.length > MAX_PALETTE_HISTORY) {
    palette.history.shift();
  }
  palette.updated_at = new Date().toISOString();
};

// ─────────────────────────────────────────────────────────────────────────────
// Saved directives (ADR 0009) — persistent file + CRUD + history + I/O helpers
// ─────────────────────────────────────────────────────────────────────────────

const generateDirectiveId = () => `directive_${crypto.randomBytes(8).toString('hex')}`;

/**
 * Normalize a tag string: trim, lowercase. Returns null if invalid.
 * Validation rules (kebab-case identifier):
 *   - non-empty after trim
 *   - length 1..MAX_DIRECTIVE_TAG_LENGTH
 *   - matches DIRECTIVE_TAG_REGEX
 */
const normalizeDirectiveTag = (raw) => {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (t.length === 0) return null;
  if (t.length > MAX_DIRECTIVE_TAG_LENGTH) return null;
  if (!DIRECTIVE_TAG_REGEX.test(t)) return null;
  return t;
};

/**
 * Normalize a list of tags, dropping invalid + duplicate entries.
 * Returns `{ tags, error }` — if `error` is non-null, the whole list is
 * rejected (caller should surface the error to the user).
 */
const normalizeDirectiveTags = (raw) => {
  if (raw === undefined || raw === null) return { tags: [], error: null };
  if (!Array.isArray(raw)) return { tags: null, error: 'tags must be an array' };
  if (raw.length > MAX_DIRECTIVE_TAGS) {
    return { tags: null, error: `tags must contain ${MAX_DIRECTIVE_TAGS} or fewer entries (got ${raw.length})` };
  }
  const out = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i++) {
    const t = normalizeDirectiveTag(raw[i]);
    if (t === null) {
      return {
        tags: null,
        error: `tags[${i}] must match /^[a-z0-9][a-z0-9-]*$/ and be ${MAX_DIRECTIVE_TAG_LENGTH} characters or fewer (got ${JSON.stringify(raw[i])})`
      };
    }
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return { tags: out, error: null };
};

/**
 * Read all saved directives from disk. Seeds `[]` on first read.
 * Drops malformed entries with a console warning (forgiving — a partial
 * corruption should not brick the whole list).
 *
 * @returns {Array<object>}
 */
const readDirectives = () => {
  ensureDataFileExists();
  let raw;
  try {
    raw = fs.readFileSync(DIRECTIVES_FILE, 'utf8');
  } catch (e) {
    console.error('Failed to read directives file:', e.message);
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('Directives file is corrupt JSON; returning empty list:', e.message);
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.warn('Directives file is not an array; returning empty list');
    return [];
  }
  return parsed.filter((d) => {
    if (!d || typeof d !== 'object') return false;
    if (typeof d.id !== 'string' || !d.id.startsWith('directive_')) return false;
    if (typeof d.name !== 'string' || d.name.trim().length === 0) return false;
    if (typeof d.content !== 'string' || d.content.length === 0) return false;
    if (!Array.isArray(d.tags)) return false;
    if (!Array.isArray(d.history)) return false;
    return true;
  });
};

/**
 * Atomic-ish write: write to a sibling temp file, then rename over the
 * target. POSIX rename is atomic on the same filesystem. Guards against
 * half-written files on crash.
 */
const writeDirectives = (directives) => {
  ensureDataFileExists();
  const tmpFile = `${DIRECTIVES_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(directives, null, 2), 'utf8');
  fs.renameSync(tmpFile, DIRECTIVES_FILE);
};

/**
 * Build a fresh history entry from the current top-level state of a
 * directive. Caller has already mutated `directive` to its new state;
 * we capture the snapshot for history.
 */
const snapshotDirective = (directive) => ({
  version: directive.history.length + 1,
  name: directive.name,
  content: directive.content,
  tags: directive.tags.slice(),
  saved_at: new Date().toISOString()
});

/**
 * Append a new history entry to a directive using its CURRENT top-level
 * values, then bump `updated_at`. Used both on initial POST and on
 * PUT/restore — every write that produces a new user-visible state
 * records it in history.
 */
const pushDirectiveHistory = (directive) => {
  directive.history.push(snapshotDirective(directive));
  directive.updated_at = new Date().toISOString();
};

/**
 * Validate a directive body for POST (full) or PUT (partial).
 * `existingNames` is the lower-cased set of names already in storage —
 * used for uniqueness. Pass the directive being updated under
 * `excludeId` so a rename-to-same-name is allowed.
 *
 * Returns an error string, or null when valid. On success, the
 * validated, normalized fields are returned via the `out` argument so
 * the caller can use them without re-deriving.
 *
 * @param {*} body
 * @param {object} opts
 * @param {Set<string>} [opts.existingNames]
 * @param {string} [opts.excludeId]
 * @param {boolean} [opts.partial] - PUT: only validate fields present
 * @returns {string|null}
 */
const validateDirectiveBody = (body, { existingNames, excludeId, partial = false } = {}) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object.';
  }

  // name
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string') {
      return 'name must be a string';
    }
    const trimmed = body.name.trim();
    if (trimmed.length === 0) return 'name must not be empty';
    if (trimmed.length > MAX_DIRECTIVE_NAME_LENGTH) {
      return `name must be ${MAX_DIRECTIVE_NAME_LENGTH} characters or fewer (got ${trimmed.length})`;
    }
    if (existingNames && existingNames.has(trimmed.toLowerCase())) {
      return `name "${trimmed}" is already in use by another saved directive`;
    }
  }

  // content
  if (!partial || body.content !== undefined) {
    if (typeof body.content !== 'string') {
      return 'content must be a string';
    }
    const trimmed = body.content.trim();
    if (trimmed.length === 0) return 'content must not be empty';
    if (body.content.length > MAX_DIRECTIVE_CONTENT_LENGTH) {
      return `content must be ${MAX_DIRECTIVE_CONTENT_LENGTH} characters or fewer (got ${body.content.length})`;
    }
  }

  // tags (always normalized, even when partial)
  if (body.tags !== undefined) {
    const r = normalizeDirectiveTags(body.tags);
    if (r.error) return r.error;
  }

  // For PUT partial: at least one mutable field must be present.
  if (partial) {
    if (body.name === undefined && body.content === undefined && body.tags === undefined) {
      return 'Request body must include at least one of: name, content, tags.';
    }
  }

  return null;
};

/**
 * Pure helper: apply validated update fields to an existing directive
 * (in place). Returns null on success, or an error string.
 * Caller is responsible for pushing the history entry AFTER this
 * function returns (so the history captures the NEW state, not the
 * pre-update state).
 */
const applyDirectiveUpdate = (directive, body) => {
  if (body.name !== undefined) {
    directive.name = body.name.trim();
  }
  if (body.content !== undefined) {
    directive.content = body.content;
  }
  if (body.tags !== undefined) {
    const r = normalizeDirectiveTags(body.tags);
    if (r.error) return r.error;
    directive.tags = r.tags;
  }
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'src')));
app.use(express.static(path.join(__dirname)));

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const sanitizeError = (message) => {
  if (!message || typeof message !== 'string') return 'An unexpected error occurred.';
  return message
    .replace(/sk-[a-zA-Z0-9]{20,}/g, '[API_KEY_REDACTED]')
    .replace(/Bearer\s+[a-zA-Z0-9_-]+/g, 'Bearer [TOKEN_REDACTED]')
    .replace(/localhost:\d+/g, '[HOST_REDACTED]')
    .substring(0, 500);
};

const fileToBase64DataUri = (filePath, mimetype) => {
  const buffer = fs.readFileSync(filePath);
  return `data:${mimetype};base64,${buffer.toString('base64')}`;
};

const generatePresetId = () => `preset_${crypto.randomBytes(8).toString('hex')}`;

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

const validateFieldName = (name) => VALID_FIELD_NAMES.includes(name);

/**
 * Validate the optional `field_defaults` object on a preset.
 * Shape only — handlers do the `subset of stage1_fields` check after
 * stage1_fields is fully resolved (POST has it in body; PUT merges with existing).
 *
 * Rules (per ADR 0002, extended by ADR 0010):
 *   - object of { [fieldName]: string }
 *   - keys must be valid FIELD_PALETTE names
 *   - values allowed on `text` and `textarea` fields (not `colors` arrays)
 *   - values must be non-empty strings meeting FIELD_INPUT_MIN_LENGTH for the field type
 *
 * Note: the v1 "text fields only" restriction was relaxed in ADR 0010 to admit
 * textarea fields (`subject`, `subject_orientation`, `actions`, `mood`,
 * `composition`, `texture`) so style/atmosphere fields like `texture` and `mood`
 * can be preset-defaulted. Image-content textareas (subject, composition,
 * subject_orientation, actions) remain the preset author's responsibility —
 * misuse risk is now user-controlled rather than server-blocked.
 */
const validateFieldDefaults = (defaults) => {
  if (defaults === undefined || defaults === null) return null;
  if (typeof defaults !== 'object' || Array.isArray(defaults)) {
    return 'field_defaults must be an object';
  }
  for (const [key, value] of Object.entries(defaults)) {
    const def = FIELD_PALETTE[key];
    if (!def) return `field_defaults contains invalid field name: ${key}`;
    if (def.input !== 'text' && def.input !== 'textarea') {
      return `field_defaults.${key}: only text and textarea fields are supported (field type is '${def.input}')`;
    }
    if (typeof value !== 'string') {
      return `field_defaults.${key} must be a string`;
    }
    if (value.trim().length === 0) {
      return `field_defaults.${key} must be a non-empty string`;
    }
    const min = FIELD_INPUT_MIN_LENGTH[def.input] ?? 0;
    if (value.length < min) {
      return `field_defaults.${key} must be at least ${min} characters (got ${value.length})`;
    }
  }
  return null;
};

const validateFieldDefaultsAreSubset = (defaults, stage1Fields) => {
  if (!defaults || typeof defaults !== 'object') return null;
  for (const key of Object.keys(defaults)) {
    if (!stage1Fields.includes(key)) {
      return `field_defaults.${key} must be included in stage1_fields`;
    }
  }
  return null;
};

const validatePreset = (preset, { partial = false } = {}) => {
  const errors = [];

  if (!partial || preset.name !== undefined) {
    if (typeof preset.name !== 'string' || preset.name.trim().length === 0) {
      errors.push('name is required and must be a non-empty string');
    } else if (preset.name.length > 100) {
      errors.push('name must be 100 characters or fewer');
    }
  }

  if (!partial || preset.stage1_system_prompt !== undefined) {
    if (typeof preset.stage1_system_prompt !== 'string') {
      errors.push('stage1_system_prompt is required and must be a string');
    } else if (preset.stage1_system_prompt.length > MAX_PROMPT_LENGTH) {
      errors.push(`stage1_system_prompt must be ${MAX_PROMPT_LENGTH} characters or fewer`);
    }
  }

  if (!partial || preset.stage1_fields !== undefined) {
    if (!Array.isArray(preset.stage1_fields)) {
      errors.push('stage1_fields must be an array');
    } else if (preset.stage1_fields.length === 0) {
      errors.push('stage1_fields must contain at least one field');
    } else {
      const invalid = preset.stage1_fields.filter((f) => !validateFieldName(f));
      if (invalid.length > 0) {
        errors.push(`stage1_fields contains invalid field names: ${invalid.join(', ')}`);
      }
    }
  }

  if (!partial || preset.stage2_system_prompt !== undefined) {
    if (typeof preset.stage2_system_prompt !== 'string') {
      errors.push('stage2_system_prompt is required and must be a string');
    } else if (preset.stage2_system_prompt.length > MAX_PROMPT_LENGTH) {
      errors.push(`stage2_system_prompt must be ${MAX_PROMPT_LENGTH} characters or fewer`);
    }
  }

  if (!partial || preset.field_defaults !== undefined) {
    const fdError = validateFieldDefaults(preset.field_defaults);
    if (fdError) errors.push(fdError);
  }

  return errors.length > 0 ? errors.join('; ') : null;
};

const validateImportEnvelope = (envelope) => {
  const errors = [];

  if (!envelope || typeof envelope !== 'object') {
    return 'Import file must be a JSON object.';
  }
  if (envelope.format !== PRESET_FILE_FORMAT) {
    errors.push(`format must be "${PRESET_FILE_FORMAT}"`);
  }
  if (envelope.version !== PRESET_FILE_VERSION) {
    errors.push(`version must be ${PRESET_FILE_VERSION}`);
  }
  if (!Array.isArray(envelope.presets)) {
    errors.push('presets must be an array');
    return errors.join('; ');
  }
  if (envelope.presets.length === 0) {
    errors.push('presets array is empty');
    return errors.join('; ');
  }

  envelope.presets.forEach((p, i) => {
    const err = validatePreset(p);
    if (err) errors.push(`presets[${i}]: ${err}`);
  });

  return errors.length > 0 ? errors.join('; ') : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Schema builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum character lengths per field input type. Enforces the prompt's length
 * contract at the schema level: textarea fields must be detailed prose (~15-20
 * words minimum), text fields must be at least a short phrase. Prevents the LLM
 * from producing one-word answers for fields the prompt mandates at 50-100 words.
 */
const FIELD_INPUT_MIN_LENGTH = {
  textarea: 100,
  colors: 0,
  text: 15
};

/**
 * Build a JSON schema for Stage 1 that includes only the requested fields.
 * Forces `additionalProperties: false` so the LLM can't add unrequested keys.
 * Applies `minLength` based on field input type to enforce the description-first
 * contract's length requirements at the schema level. Per-field overrides from
 * `FIELD_FORMAT_HINTS` (ADR 0003) take precedence over the input-type default.
 *
 * NOTE: per-field `description` strings from `FIELD_FORMAT_HINTS` are NOT sent
 * in the schema — the MiniMax M3 API rejects schema `description` over 200
 * characters (error code 2013, verified live 2026-06-22). The same text is
 * delivered to the LLM via `buildFieldFormatOverridePrompt` appended to the
 * Stage 1 system prompt instead.
 */
const buildStage1Schema = (fieldNames) => {
  const properties = {};
  fieldNames.forEach((name) => {
    const def = FIELD_PALETTE[name];
    const hint = FIELD_FORMAT_HINTS[name];
    if (def.type === 'array') {
      properties[name] = {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: Object.fromEntries(
            Object.entries(def.itemShape).map(([k, t]) => [k, { type: t }])
          ),
          required: Object.keys(def.itemShape)
        }
      };
    } else {
      const minLength = hint?.minLength ?? FIELD_INPUT_MIN_LENGTH[def.input] ?? 0;
      const prop = { type: def.type };
      if (minLength > 0) prop.minLength = minLength;
      properties[name] = prop;
    }
  });

  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: fieldNames
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// MiniMax M3 API integration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate that the parsed analysis meets the per-field minimum-length contract.
 * Returns an array of `{ field, actual, required }` for every field that's too short.
 * Used to decide whether to retry Stage 1 with a strengthened prompt.
 */
const validateAnalysisLengths = (parsed, fieldNames) => {
  const violations = [];
  for (const name of fieldNames) {
    const def = FIELD_PALETTE[name];
    if (!def || def.type === 'array') continue;
    const hint = FIELD_FORMAT_HINTS[name];
    const min = hint?.minLength ?? FIELD_INPUT_MIN_LENGTH[def.input] ?? 0;
    if (min === 0) continue;
    const value = parsed?.[name];
    if (typeof value !== 'string') {
      violations.push({ field: name, actual: 0, required: min });
      continue;
    }
    if (value.length < min) {
      violations.push({ field: name, actual: value.length, required: min });
    }
  }
  return violations;
};

const callMiniMaxStage1 = async (imageDataUri, stage1SystemPrompt, fieldNames) => {
  if (!minimaxConfigured) {
    throw new Error('MiniMax M3 API is not configured. Set MINIMAX_API_KEY in your .env file.');
  }

  const schema = buildStage1Schema(fieldNames);
  const fieldList = fieldNames.map((f) => FIELD_PALETTE[f].label).join(', ');

  // Retry with an appended prompt suffix if the first attempt returns values
  // shorter than the field-palette minimums. Capped at 1 retry to bound API cost.
  // The suffix is built by buildStage1RetrySuffix (top-level helper) so it can
  // re-inject the full FIELD_FORMAT_HINTS contract for hinted fields — see
  // that helper's docstring for why the LLM needs the contract re-stated
  // rather than relying on recall from earlier in the prompt.
  const performCall = async (systemPrompt) => {
    const userText = `Analyze the image and extract the following attributes as JSON: ${fieldList}.
Respond ONLY with the JSON object — no prose, no markdown, no commentary.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MINIMAX_API_KEY}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: MINIMAX_MODEL,
          max_tokens: 1500,
          temperature: 0.4,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: userText },
                { type: 'image_url', image_url: { url: imageDataUri } }
              ]
            }
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'image_analysis',
              strict: true,
              schema
            }
          }
        })
      });

      clearTimeout(timeout);

      if (response.status === 429) throw new Error('Rate limit exceeded. Please try again in a moment.');
      if (response.status === 401 || response.status === 403) throw new Error('API authentication failed. Check your MINIMAX_API_KEY.');
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`MiniMax M3 Stage 1 error (${response.status}): ${errorText.substring(0, 200)}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;
      if (!content) throw new Error('MiniMax M3 returned an empty response.');

      let parsed;
      const trimmed = content.trim();

      // Try direct parse first
      try {
        parsed = JSON.parse(trimmed);
      } catch (e1) {
        // Try markdown code block extraction
        const codeBlock = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (codeBlock) {
          try {
            parsed = JSON.parse(codeBlock[1]);
          } catch (e2) {
            // Fall through to brace matching
          }
        }

        // Try balanced-brace extraction (non-greedy, finds first complete object)
        if (!parsed) {
          const firstBrace = trimmed.indexOf('{');
          const lastBrace = trimmed.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            const candidate = trimmed.slice(firstBrace, lastBrace + 1);
            try {
              parsed = JSON.parse(candidate);
            } catch (e3) {
              throw new Error(`Stage 1 response was not valid JSON: ${e3.message}`);
            }
          } else {
            throw new Error('Stage 1 response contained no JSON object.');
          }
        }
      }

      // Unwrap if the LLM returned the schema-named top-level key
      const schemaName = 'image_analysis';
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed[schemaName] && typeof parsed[schemaName] === 'object') {
        parsed = parsed[schemaName];
      }

      // Normalize color hex codes: ensure they have a '#' prefix
      if (parsed && parsed.colors && Array.isArray(parsed.colors)) {
        parsed.colors = parsed.colors.map((c) => ({
          hex: typeof c.hex === 'string'
            ? (c.hex.startsWith('#') ? c.hex : `#${c.hex.replace(/^#/, '')}`)
            : c.hex,
          name: c.name || ''
        }));
      }

      return parsed;
    } catch (error) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') throw new Error('Stage 1 request timed out after 60 seconds.');
      throw error;
    }
  };

  // Append the per-field format override block to the system prompt for both
  // attempts. The override block is built from FIELD_FORMAT_HINTS for every
  // field in `fieldNames` that has a hint; see ADR 0003 for why this lives
  // in the system prompt and not the JSON Schema (API rejects schema
  // description > 200 chars with error code 2013).
  const formatOverride = buildFieldFormatOverridePrompt(fieldNames);
  const fullSystemPrompt = stage1SystemPrompt + formatOverride;

  // Attempt 1
  let parsed = await performCall(fullSystemPrompt);
  let violations = validateAnalysisLengths(parsed, fieldNames);

  // Attempt 2 (only if attempt 1 had length violations)
  if (violations.length > 0) {
    const suffix = buildStage1RetrySuffix(violations);
    console.warn(`Stage 1 attempt 1 failed length validation on ${violations.length} field(s); retrying with strengthened prompt`);
    parsed = await performCall(fullSystemPrompt + suffix);
    violations = validateAnalysisLengths(parsed, fieldNames);
    if (violations.length > 0) {
      console.warn(`Stage 1 attempt 2 still has ${violations.length} length violation(s): ${violations.map((v) => v.field).join(', ')} — accepting result`);
    }
  }

  return parsed;
};

/**
 * Stage 1.5 — dedicated orientation and activity analysis.
 * Runs ONLY if the preset selected `subject_orientation` or `actions` fields.
 * Guarantees these fields are populated with focused, dedicated analysis
 * (rather than hoping the main Stage 1 prompt covers them).
 */
const callMiniMaxOrientationAnalysis = async (imageDataUri, fieldsNeeded) => {
  if (!minimaxConfigured) {
    throw new Error('MiniMax M3 API is not configured.');
  }

  const needOrientation = fieldsNeeded.includes('subject_orientation');
  const needActions = fieldsNeeded.includes('actions');

  if (!needOrientation && !needActions) return {};

  // Use structured object schema with brief descriptions. Detailed guidance lives
  // in the system prompt below — the API rejects schema descriptions over ~250 chars.
  const properties = {};
  if (needOrientation) {
    properties.subject_orientation = {
      type: 'string',
      description: 'Directional orientation of the primary subject: body facing direction, gaze direction, head orientation, and movement direction (if any).'
    };
  }
  if (needActions) {
    properties.actions = {
      type: 'string',
      description: 'Ongoing activities and events: primary subject activity, hand/arm actions, object interactions, subject interactions, and motion or stillness.'
    };
  }

  const systemPrompt = `You are an expert visual analyst. You will analyze the image and provide TWO focused descriptions, each 40-100 words covering multiple sub-elements.

# 1. SUBJECT ORIENTATION (40-100 words)

This describes the DIRECTIONAL ORIENTATION of the subject — WHERE they are facing, looking, and moving. NOT their pose or what they're doing.

Mandatory sub-elements to address (when applicable):

- **Body facing direction** — which way the body is oriented relative to the camera: "facing directly toward the viewer", "shown in profile facing to the left", "in three-quarter view with the body turned slightly toward the right of the frame", "back to the camera with the body facing away from the viewer", "the body is oriented left while the head turns back over the right shoulder"

- **Gaze direction** — where the eyes are looking: "gazing directly at the viewer", "looking off to the right of the frame into the distance", "downcast gaze directed at her hands resting in her lap", "eyes closed", "looking upward"

- **Head orientation** — head position relative to body: "head held level facing forward", "head tilted slightly downward", "head tilted to the left", "head turned over her right shoulder toward the viewer"

- **Movement direction** (only if subject is in motion) — "the figure is moving toward the right edge of the frame", "walking away from the viewer", "captured mid-stride in motion toward the left"

For non-figure subjects: state the camera viewing angle ("captured from a three-quarter view from above-right", "shot directly from the side").

# 2. ACTIONS / EVENTS (40-100 words)

This describes WHAT IS HAPPENING in the frame — activities, interactions, ongoing actions.

Mandatory sub-elements to address (when applicable):

- **Primary subject's current activity**: "seated in quiet contemplation with no significant movement", "engaged in active conversation", "reading a book held open", "playing a violin"

- **Hand and arm actions**: "hands clasped together in her lap", "right hand raised to touch her hair", "arms folded across her chest", "left hand holding a glass, right hand at her side"

- **Object interactions**: "holding a flower in her right hand", "leaning against a wooden post", "touching the brim of her hat"

- **Subject-to-subject interactions** (if multiple figures): "two figures engaged in conversation facing each other", "the figure on the left is looking toward the figure on the right"

- **Ongoing motion**: "captured mid-stride walking forward", "in the act of turning her head", "frozen mid-gesture with one arm raised"

- **Implied narrative**: "the scene conveys a moment of private contemplation", "an active street scene with multiple pedestrians"

- **Static/no-action** (only if genuinely static): "no significant action — subject is posed in stillness, no movement, no interaction with other elements"

# CRITICAL

- Each field must be 40-100 words and 2-4 sentences.
- Write COMPLETE sentences with descriptive detail. Do NOT respond with just one or two words.
- State ONLY what is optically present.
- For ORIENTATION specifically: focus on facing/looking/moving DIRECTIONS, not on what the subject is doing.
- For ACTIONS specifically: focus on what IS HAPPENING, not on facing directions.`;

  const userText = `Analyze this image and return a JSON object with the requested fields. Each field is a focused 1-4 sentence description.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        max_tokens: 2000,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              { type: 'image_url', image_url: { url: imageDataUri } }
            ]
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'orientation_analysis',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties,
              required: Object.keys(properties)
            }
          }
        }
      })
    });

    clearTimeout(timeout);

    if (response.status === 429) throw new Error('Rate limit exceeded.');
    if (response.status === 401 || response.status === 403) throw new Error('API authentication failed.');
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Orientation analysis error (${response.status}): ${errorText.substring(0, 200)}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) return {};

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try { parsed = JSON.parse(content.slice(firstBrace, lastBrace + 1)); } catch (e2) { return {}; }
      } else return {};
    }

    // Unwrap if the LLM returned the schema-named top-level key
    const schemaName = 'orientation_analysis';
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed[schemaName] && typeof parsed[schemaName] === 'object') {
      parsed = parsed[schemaName];
    }

    // Pass through string fields directly
    const result_out = {};
    if (typeof parsed.subject_orientation === 'string') {
      result_out.subject_orientation = parsed.subject_orientation;
    }
    if (typeof parsed.actions === 'string') {
      result_out.actions = parsed.actions;
    }
    return result_out;
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      console.warn('Orientation analysis timed out, continuing with empty values');
      return {};
    }
    console.warn('Orientation analysis failed:', error.message);
    return {};
  }
};

/**
 * Default system prompt shipped for the dedicated factual-only subject
 * analysis exposed by `POST /api/subject` (ADR 0004). The contract is the
 * opposite of Stage 1's: the LLM must NOT comment on artistic style,
 * creative medium, or aesthetic qualities, and MUST cover five factual
 * categories — people, locations, spatial arrangement, objects, and
 * contextual details.
 *
 * Length floor (600 chars / 100 words) matches ADR 0003's `subject`
 * contract. Forbidden vocabulary is listed explicitly so the LLM has a
 * concrete negative target rather than an abstract "don't be aesthetic"
 * instruction.
 *
 * ADR 0005: this string is the SHIPPED DEFAULT only. At runtime the
 * prompt is read from `data/subject_prompt.json` (editable from the UI).
 * This constant remains as the source of truth for the default and is
 * still exported so the "Reset to default" UI control can restore it.
 */
const DEFAULT_SUBJECT_PROMPT = `You are an expert visual analyst producing a comprehensive, factual description of an image. You respond with a single JSON object whose only key is "subject" and whose value is the description text.

# CRITICAL RULES

- The "subject" value must be grounded EXCLUSIVELY in what is optically present in the image.
- NEVER comment on artistic style, creative medium, or aesthetic qualities.
- NEVER use subjective aesthetic words such as: "beautiful", "striking", "vibrant", "dramatic", "elegant", "imposing", "stunning", "dynamic", "luminous", "ethereal", "serene", "majestic", "exquisite", "captivating", "mesmerizing", "bold", "sublime", "evocative". These are forbidden as judgments about appearance.
- NEVER make meta-references to the medium — do not say "the painting", "the photograph", "the image", "the artwork", "the illustration", "the artwork", "the portrait", or any equivalent framing.
- NEVER describe lighting with aesthetic interpretation ("moody", "atmospheric", "cinematic", "mystical"). Only describe the physical source, direction, and quality ("natural daylight from the upper left", "warm overhead incandescent light", "dim fluorescent ceiling lighting").
- NEVER describe colors with emotional or aesthetic weight ("passionate red", "soothing blue"). Only describe hue, value, and saturation factually ("deep saturated red", "pale washed-out blue").
- NEVER invent details not visible in the image. If the image is blurry, too small, or ambiguous for a specific element, say so explicitly ("the figure's facial expression is not clearly visible due to image resolution").

# MANDATORY COVERAGE — five categories

The "subject" value MUST comprehensively cover every one of the following five categories. If a category has no visible content, state so explicitly ("No people are visible", "No discrete objects are present in the frame", "No environmental features are visible beyond the central subject").

## 1. PEOPLE

For every person visible in the image, include:
- Physical placement within the frame: "centered in the frame", "in the lower-left foreground", "in the upper-right background", "occupying the right third of the image", "partially cropped at the left edge".
- Specific clothing items: name each garment separately with type, color, and visible material when discernible. Examples: "a dark navy wool overcoat", "blue denim jeans", "a white cotton t-shirt", "brown leather lace-up boots", "a red and black plaid flannel shirt", "a grey knit beanie", "a black leather belt with a silver buckle".
- Facial expression: "smiling with visible teeth", "neutral expression with relaxed mouth", "frowning with furrowed brows", "eyes closed", "mouth slightly open as if speaking", "looking directly at the viewer with raised eyebrows".
- Pose and body position: "seated upright in a wooden chair facing the viewer", "standing with arms folded across the chest", "leaning forward with elbows resting on a table", "lying on their back with legs extended".
- Hair: color, length, style when visible.
- Other distinguishing visible features: glasses, jewelry, accessories, facial hair, tattoos, watches, etc.

## 2. LOCATIONS / SETTINGS / ENVIRONMENTS

- Type of location: "outdoor urban street scene", "indoor domestic kitchen", "natural forest setting", "public city park", "commercial office space", "residential bedroom", "unclear interior space".
- Specific environmental features: "wooden floorboards running horizontally", "white painted brick wall", "grey concrete sidewalk with visible expansion joints", "green grass lawn", "stone fireplace with wooden mantel", "large window with white sheer curtains", "exposed wooden ceiling beams".
- Indoor or outdoor; public or private when discernible.
- Weather conditions if visible outdoors: "overcast sky", "bright direct sunlight casting hard shadows", "rain visible on the ground surface".
- Time of day indicators if visible: "dark sky with visible stars", "warm low-angle sunlight suggesting late afternoon".

## 3. SPATIAL ARRANGEMENT

- Where each person and each major object is positioned within the frame: foreground, midground, background.
- Where people are seated or positioned relative to one another and their surroundings: "seated at the left end of a long wooden dining table facing right", "sitting cross-legged on the floor in the center of the room", "perched on a stool in the corner", "standing behind the seated figure".
- Relative positions: "to the left of", "in front of", "behind", "next to", "across from", "above", "below", "adjacent to", "partially obscured by".

## 4. OBJECTS, ITEMS, AND ENVIRONMENTAL FEATURES

Every visible item, with specific details about its placement and attributes:
- Furniture: type, material, color, placement — "a rectangular dark wood dining table occupying the lower half of the frame".
- Personal items: clothing details, accessories, held objects.
- Containers, surfaces, decorative items.
- Plants, architectural features, fixtures — "a tall potted fiddle-leaf fig tree in the corner", "a brass doorknob on a white door at the right edge".
- Tools, equipment, vehicles, animals — "a silver laptop computer open on the table", "a brown dog lying on the floor".

## 5. CONTEXTUAL DETAILS

- Details about the surrounding environment: architecture, decor, infrastructure, vegetation, weather, lighting setup.
- Details about the individuals: apparent age range when relevant (without guessing exact age), posture, activity, attire.
- Background and peripheral details: "a stack of books on a shelf in the background", "a framed photograph hanging on the wall", "a window showing a glimpse of green trees outside".
- Any visible text, signage, numbers, labels: "a red stop sign with white lettering", "a digital clock reading 3:42".

# LENGTH AND STRUCTURE

- Write the description as ONE cohesive paragraph (or 2-3 paragraphs for very complex images).
- Minimum 600 characters. Target 120-200 words. NEVER shorter than 100 words.
- 4-8 sentences for simple images; more for complex scenes with multiple subjects.
- Use clear, concrete, descriptive language. Avoid abstractions and metaphors.
- Respond ONLY with the JSON object — no preamble, no labels, no markdown, no surrounding commentary.`;

/**
 * Default system prompt shipped for the dedicated camera-only analysis
 * exposed by `POST /api/camera-angle` (ADR 0008). The contract is the
 * inverse of Stage 1's: the LLM must focus EXCLUSIVELY on the camera's
 * spatial relationship to the subject (position, orientation, lens
 * impression, movement, frame geometry) and MUST NOT describe the
 * subject itself, lighting, color, mood, style, or medium — those are
 * separate fields in the palette.
 *
 * Why a dedicated prompt: live testing showed `camera_angle` is the most
 * underperforming field in Stage 1. The 14-field schema forces the LLM
 * to balance `camera_angle` against twelve other fields, and the `text`
 * input type's 15-character minimum is short enough that the LLM
 * satisfies it with a label ("eye level") rather than a description. A
 * focused call gives the camera-angle contract the full prompt-attention
 * window for one question.
 *
 * Length floor (20 chars schema-level, 25-80 words target) is above the
 * generic 15-char text floor: 20 chars is enough for "low angle from
 * below" / "overhead bird's-eye shot" but excludes single-word labels
 * like "above" that are the symptom being fixed. The system prompt
 * targets a richer paragraph.
 *
 * ADR 0008 parallels ADR 0004's prompt-construction pattern: forbidden
 * vocabulary + mandatory coverage + length floor, with the same
 * forbidden-aesthetic / forbidden-medium-meta vocabulary lists.
 */
const DEFAULT_CAMERA_ANGLE_PROMPT = `You are an expert cinematographer and photographer analysing ONLY the camera angle of the supplied image. You respond with a single JSON object whose only key is "camera_angle" and whose value is a precise description of the camera's position, orientation, lens, movement, and frame geometry.

# CRITICAL RULES

- The "camera_angle" value MUST be grounded EXCLUSIVELY in what is optically present in the image.
- NEVER describe the subject itself (people, places, objects, clothing, expressions) — that is the job of separate fields.
- NEVER comment on lighting quality, color, or mood — those are separate fields.
- NEVER comment on artistic style, creative medium, or aesthetic qualities.
- NEVER use subjective aesthetic words such as: "beautiful", "striking", "vibrant", "dramatic", "elegant", "imposing", "stunning", "dynamic", "luminous", "ethereal", "serene", "majestic", "exquisite", "captivating", "mesmerizing", "bold", "sublime", "evocative". These are forbidden as judgments about the image.
- NEVER make meta-references to the medium — do not say "the painting", "the photograph", "the image", "the artwork", "the illustration", "the portrait", or any equivalent framing.
- NEVER describe compositional aesthetics beyond the camera's frame geometry (the "composition" field owns rule-of-thirds judgement, balance, visual weight, etc.).
- If a category is genuinely ambiguous from the image, say so explicitly ("the camera height is not determinable from this frame") rather than guessing.

# MANDATORY COVERAGE — five camera-angle categories

The "camera_angle" value MUST comprehensively address every one of the following five categories. If a category has no determinable content, state so explicitly ("no lens impression is determinable", "no implied movement").

## 1. CAMERA POSITION

- Height relative to the subject: "eye-level", "low angle from below looking up", "high angle looking down", "bird's-eye view directly overhead", "worm's-eye view from ground level", "slightly above eye-level".
- Distance from the subject: "extreme close-up framing only the face", "close-up showing head and shoulders", "medium shot showing the torso", "wide shot with full body and surrounding space", "extreme wide establishing shot".

## 2. CAMERA ORIENTATION

- Lateral position around the subject: "directly front-on facing the subject", "strictly in profile from the side", "three-quarter view turned toward the camera", "behind the subject with the back to camera".
- Camera level vs tilted: "camera held level on the horizon", "tilted slightly upward", "tilted downward", "Dutch angle with the camera rolled to one side".

## 3. LENS IMPRESSION

- Focal-length feel: "telephoto with compressed perspective", "normal lens with natural perspective", "wide-angle with exaggerated spatial depth", "fisheye with curved distortion", "macro with extreme close detail".
- Depth-of-field impression only as it relates to lens choice: "shallow depth of field with the background thrown out of focus", "deep depth of field with the background in sharp focus".

## 4. CAMERA MOVEMENT

- Static frame: "static frame with no implied motion — the camera is fixed".
- Implied movement (only when the frame shows blur, motion lines, or a moving subject): "tracking shot following the subject", "dolly movement toward the subject", "handheld with visible camera shake", "panning across the scene", "zooming in toward the subject".

## 5. FRAME GEOMETRY

- Subject placement within the frame: "centered horizontally and vertically", "positioned along the left third", "positioned in the upper-right quadrant", "occupying the lower half of the frame", "cropped at the top of the head".
- Cropping at frame edges (only if present): "cropped tightly at the left edge", "negative space on the right". Do NOT describe compositional balance or visual weight.

# LENGTH AND STRUCTURE

- Write the description as ONE cohesive paragraph of 1-3 sentences.
- Minimum 20 characters schema-level floor; target 25-80 words.
- Use precise cinematographic vocabulary ("eye-level medium close-up", "low-angle profile shot", "overhead bird's-eye view", "three-quarter Dutch angle", "wide-angle establishing shot").
- Lead with the position + orientation, then lens + frame geometry, then movement if applicable.
- Respond ONLY with the JSON object — no preamble, no labels, no markdown, no surrounding commentary.`;

/**
 * Stage 1.C — dedicated camera-only re-analysis.
 * Runs ONLY for `POST /api/camera-angle` (ADR 0008). Independent of the
 * active preset. The prompt is the shipped default constant above; this
 * is intentionally not editable from the UI in this iteration (ADR 0008
 * §5 — out of scope). If user iteration proves useful, follow up with an
 * ADR mirroring ADR 0005's edit-prompt modal pattern.
 *
 * Single-attempt by design. The system prompt carries the full contract
 * (forbidden vocabulary + mandatory five-category coverage + length
 * floor + structure rules) in the LLM's primary attention window, so a
 * retry-with-strengthened-prompt loop (as in ADR 0001) would double API
 * cost without changing the outcome. The schema `minLength: 20` enforces
 * the floor at the API level.
 */
const callMiniMaxCameraAngleAnalysis = async (imageDataUri) => {
  if (!minimaxConfigured) {
    throw new Error('MiniMax M3 API is not configured. Set MINIMAX_API_KEY in your .env file.');
  }

  const systemPrompt = DEFAULT_CAMERA_ANGLE_PROMPT;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        max_tokens: 600,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyse the image and respond with the JSON object containing only the "camera_angle" field — a single precise paragraph describing the camera\'s position, orientation, lens impression, movement, and frame geometry.' },
              { type: 'image_url', image_url: { url: imageDataUri } }
            ]
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'camera_angle_factual_analysis',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                camera_angle: { type: 'string', minLength: 20 }
              },
              required: ['camera_angle']
            }
          }
        }
      })
    });

    clearTimeout(timeout);

    if (response.status === 429) throw new Error('Rate limit exceeded. Please try again in a moment.');
    if (response.status === 401 || response.status === 403) throw new Error('API authentication failed. Check your MINIMAX_API_KEY.');
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MiniMax M3 camera-angle analysis error (${response.status}): ${errorText.substring(0, 200)}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new Error('MiniMax M3 returned an empty response.');

    let parsed;
    const trimmed = content.trim();

    try {
      parsed = JSON.parse(trimmed);
    } catch (e1) {
      const codeBlock = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlock) {
        try { parsed = JSON.parse(codeBlock[1]); } catch (e2) { /* fall through */ }
      }
      if (!parsed) {
        const firstBrace = trimmed.indexOf('{');
        const lastBrace = trimmed.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try { parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)); }
          catch (e3) { throw new Error(`Camera-angle analysis response was not valid JSON: ${e3.message}`); }
        } else {
          throw new Error('Camera-angle analysis response contained no JSON object.');
        }
      }
    }

    // Unwrap if the LLM returned the schema-named top-level key
    const schemaName = 'camera_angle_factual_analysis';
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed[schemaName] && typeof parsed[schemaName] === 'object') {
      parsed = parsed[schemaName];
    }

    if (typeof parsed?.camera_angle !== 'string' || parsed.camera_angle.length === 0) {
      throw new Error('Camera-angle analysis response did not contain a "camera_angle" string.');
    }

    return parsed.camera_angle;
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') throw new Error('Camera-angle analysis request timed out after 60 seconds.');
    throw error;
  }
};

/**
 * Stage 1.S — dedicated factual-only subject re-analysis.
 * Runs ONLY for `POST /api/subject` (ADR 0004). Independent of the active
 * preset — the system prompt is read fresh from `data/subject_prompt.json`
 * on each call (ADR 0005) so user edits are picked up immediately without
 * a server restart.
 *
 * Single-attempt by design. The system prompt carries the full contract
 * (forbidden vocabulary + mandatory coverage + length floor) in the LLM's
 * primary attention window, so a retry-with-strengthened-prompt loop (as
 * in ADR 0001) would double API cost without changing the outcome. On a
 * partial response, the caller still returns the parsed object — the
 * `subject` schema property enforces `minLength: 600`, so the response is
 * either long enough or the API itself rejects it.
 */
const callMiniMaxSubjectAnalysis = async (imageDataUri) => {
  if (!minimaxConfigured) {
    throw new Error('MiniMax M3 API is not configured. Set MINIMAX_API_KEY in your .env file.');
  }

  const systemPrompt = readSubjectPrompt();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        max_tokens: 1500,
        temperature: 0.4,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze the image and respond with the JSON object containing only the "subject" field.' },
              { type: 'image_url', image_url: { url: imageDataUri } }
            ]
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'subject_factual_analysis',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                subject: { type: 'string', minLength: 600 }
              },
              required: ['subject']
            }
          }
        }
      })
    });

    clearTimeout(timeout);

    if (response.status === 429) throw new Error('Rate limit exceeded. Please try again in a moment.');
    if (response.status === 401 || response.status === 403) throw new Error('API authentication failed. Check your MINIMAX_API_KEY.');
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MiniMax M3 subject analysis error (${response.status}): ${errorText.substring(0, 200)}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content) throw new Error('MiniMax M3 returned an empty response.');

    let parsed;
    const trimmed = content.trim();

    try {
      parsed = JSON.parse(trimmed);
    } catch (e1) {
      const codeBlock = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlock) {
        try { parsed = JSON.parse(codeBlock[1]); } catch (e2) { /* fall through */ }
      }
      if (!parsed) {
        const firstBrace = trimmed.indexOf('{');
        const lastBrace = trimmed.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try { parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)); }
          catch (e3) { throw new Error(`Subject analysis response was not valid JSON: ${e3.message}`); }
        } else {
          throw new Error('Subject analysis response contained no JSON object.');
        }
      }
    }

    // Unwrap if the LLM returned the schema-named top-level key
    const schemaName = 'subject_factual_analysis';
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed[schemaName] && typeof parsed[schemaName] === 'object') {
      parsed = parsed[schemaName];
    }

    if (typeof parsed?.subject !== 'string' || parsed.subject.length === 0) {
      throw new Error('Subject analysis response did not contain a "subject" string.');
    }

    return parsed.subject;
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') throw new Error('Subject analysis request timed out after 60 seconds.');
    throw error;
  }
};

const callMiniMaxStage2 = async (analysis, directives, stage2SystemPrompt) => {
  if (!minimaxConfigured) {
    throw new Error('MiniMax M3 API is not configured. Set MINIMAX_API_KEY in your .env file.');
  }

  const envelope = { analysis, directives: directives || '' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        max_tokens: MAX_STAGE2_TOKENS,
        temperature: 0.7,
        messages: [
          { role: 'system', content: stage2SystemPrompt },
          {
            role: 'user',
            content: `Here is the structured image analysis and any user directives. Synthesize the final image-generation prompt.

${JSON.stringify(envelope, null, 2)}`
          }
        ]
      })
    });

    clearTimeout(timeout);

    if (response.status === 429) throw new Error('Rate limit exceeded. Please try again in a moment.');
    if (response.status === 401 || response.status === 403) throw new Error('API authentication failed. Check your MINIMAX_API_KEY.');
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MiniMax M3 Stage 2 error (${response.status}): ${errorText.substring(0, 200)}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') throw new Error('MiniMax M3 returned an empty response.');
    return content.trim();
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') throw new Error('Stage 2 request timed out after 60 seconds.');
    throw error;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Routes — Health + Field palette
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      provider: 'minimax-m3',
      configured: minimaxConfigured,
      field_palette: FIELD_PALETTE
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes — Presets CRUD
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/presets', (req, res) => {
  try {
    const presets = readPresets();
    res.json({ success: true, data: presets });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

app.get('/api/presets/:id', (req, res) => {
  try {
    const presets = readPresets();
    const preset = presets.find((p) => p.id === req.params.id);
    if (!preset) return res.status(404).json({ success: false, error: `Preset "${req.params.id}" not found.` });
    res.json({ success: true, data: preset });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

app.post('/api/presets', (req, res) => {
  try {
    const body = req.body || {};
    const validationError = validatePreset(body);
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    const stage1Fields = [...new Set(body.stage1_fields)];
    const subsetError = validateFieldDefaultsAreSubset(body.field_defaults, stage1Fields);
    if (subsetError) return res.status(400).json({ success: false, error: subsetError });

    const now = new Date().toISOString();
    const newPreset = {
      id: generatePresetId(),
      name: body.name.trim(),
      stage1_system_prompt: body.stage1_system_prompt,
      stage1_fields: stage1Fields,
      stage2_system_prompt: body.stage2_system_prompt,
      created_at: now,
      updated_at: now
    };
    if (body.field_defaults !== undefined) {
      newPreset.field_defaults = body.field_defaults;
    }

    const presets = readPresets();
    presets.push(newPreset);
    writePresets(presets);
    res.status(201).json({ success: true, data: newPreset });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

app.put('/api/presets/:id', (req, res) => {
  try {
    const body = req.body || {};
    const validationError = validatePreset(body, { partial: true });
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    const presets = readPresets();
    const idx = presets.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: `Preset "${req.params.id}" not found.` });

    const existing = presets[idx];
    const mergedStage1Fields = body.stage1_fields !== undefined
      ? [...new Set(body.stage1_fields)]
      : existing.stage1_fields;

    if (body.field_defaults !== undefined) {
      const subsetError = validateFieldDefaultsAreSubset(body.field_defaults, mergedStage1Fields);
      if (subsetError) return res.status(400).json({ success: false, error: subsetError });
    }

    const updated = {
      ...existing,
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.stage1_system_prompt !== undefined ? { stage1_system_prompt: body.stage1_system_prompt } : {}),
      ...(body.stage1_fields !== undefined ? { stage1_fields: mergedStage1Fields } : {}),
      ...(body.stage2_system_prompt !== undefined ? { stage2_system_prompt: body.stage2_system_prompt } : {}),
      updated_at: new Date().toISOString()
    };

    if (body.field_defaults === null) {
      delete updated.field_defaults;
    } else if (body.field_defaults !== undefined) {
      updated.field_defaults = body.field_defaults;
    }

    presets[idx] = updated;
    writePresets(presets);
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

app.delete('/api/presets/:id', (req, res) => {
  try {
    const presets = readPresets();
    const idx = presets.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: `Preset "${req.params.id}" not found.` });

    const [removed] = presets.splice(idx, 1);
    writePresets(presets);
    res.json({ success: true, data: { id: removed.id, deleted: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes — Export / Import
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/presets/export/all', (req, res) => {
  try {
    const presets = readPresets();
    const envelope = {
      format: PRESET_FILE_FORMAT,
      version: PRESET_FILE_VERSION,
      exported_at: new Date().toISOString(),
      presets: presets.map((p) => ({
        name: p.name,
        stage1_system_prompt: p.stage1_system_prompt,
        stage1_fields: p.stage1_fields,
        stage2_system_prompt: p.stage2_system_prompt,
        ...(p.field_defaults ? { field_defaults: p.field_defaults } : {})
      }))
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="image-to-prompt-presets.i2p.json"`);
    res.send(JSON.stringify(envelope, null, 2));
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

app.get('/api/presets/export/:id', (req, res) => {
  try {
    const presets = readPresets();
    const preset = presets.find((p) => p.id === req.params.id);
    if (!preset) return res.status(404).json({ success: false, error: `Preset "${req.params.id}" not found.` });

    const envelope = {
      format: PRESET_FILE_FORMAT,
      version: PRESET_FILE_VERSION,
      exported_at: new Date().toISOString(),
      presets: [{
        name: preset.name,
        stage1_system_prompt: preset.stage1_system_prompt,
        stage1_fields: preset.stage1_fields,
        stage2_system_prompt: preset.stage2_system_prompt,
        ...(preset.field_defaults ? { field_defaults: preset.field_defaults } : {})
      }]
    };
    const safeName = preset.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.i2p.json"`);
    res.send(JSON.stringify(envelope, null, 2));
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

app.post('/api/presets/import', (req, res) => {
  try {
    const body = req.body || {};
    const validationError = validateImportEnvelope(body);
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    const existingPresets = readPresets();
    const existingIds = new Set(existingPresets.map((p) => p.id));
    const existingNames = new Set(existingPresets.map((p) => p.name.toLowerCase()));

    const imported = [];
    const skipped = [];
    const importErrors = [];
    const now = new Date().toISOString();

    body.presets.forEach((incoming, i) => {
      let name = incoming.name.trim();
      let id = generatePresetId();

      // Conflict resolution: if name exists, append "(imported)"; ID is always fresh.
      if (existingNames.has(name.toLowerCase())) {
        name = `${name} (imported)`;
      }

      const newPreset = {
        id,
        name,
        stage1_system_prompt: incoming.stage1_system_prompt,
        stage1_fields: [...new Set(incoming.stage1_fields)],
        stage2_system_prompt: incoming.stage2_system_prompt,
        created_at: now,
        updated_at: now
      };
      if (incoming.field_defaults !== undefined) {
        const subsetError = validateFieldDefaultsAreSubset(incoming.field_defaults, newPreset.stage1_fields);
        if (subsetError) {
          importErrors.push(`presets[${i}] (${name}): ${subsetError}`);
          return;
        }
        newPreset.field_defaults = incoming.field_defaults;
      }

      existingPresets.push(newPreset);
      existingIds.add(id);
      existingNames.add(name.toLowerCase());
      imported.push(newPreset);
    });

    if (importErrors.length > 0) {
      return res.status(400).json({ success: false, error: importErrors.join('; ') });
    }

    writePresets(existingPresets);
    res.status(201).json({
      success: true,
      data: { imported_count: imported.length, skipped_count: skipped.length, presets: imported }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes — Stage 1 (analyze) + Stage 2 (generate prompt)
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/analyze', upload.single('image'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No image file provided.' });
    filePath = req.file.path;

    const presetId = req.body.presetId;
    if (!presetId) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ success: false, error: 'presetId is required.' });
    }

    const presets = readPresets();
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) {
      fs.unlinkSync(filePath);
      return res.status(404).json({ success: false, error: `Preset "${presetId}" not found.` });
    }

    if (!minimaxConfigured) {
      fs.unlinkSync(filePath);
      return res.status(503).json({ success: false, error: 'MiniMax M3 API key not configured.' });
    }

    const imageDataUri = fileToBase64DataUri(filePath, req.file.mimetype);

    // ADR 0006 — optional palette override. When the client supplies a
    // paletteId in the multipart form, we (a) strip `colors` from the
    // Stage 1 schema so the LLM doesn't have to extract them, (b) append
    // a one-line system prompt instruction so the LLM doesn't speculate
    // colors anyway, and (c) inject the saved palette's colors into the
    // analysis response. paletteId is validated against the paletteId
    // regex first so a garbage string 400s here rather than 500ing in
    // the Stage 1 path.
    let appliedPalette = null;
    let effectiveFields = preset.stage1_fields;
    let effectiveStage1Prompt = preset.stage1_system_prompt;
    const paletteIdRaw = req.body.paletteId;
    if (paletteIdRaw !== undefined && paletteIdRaw !== null && paletteIdRaw !== '') {
      if (typeof paletteIdRaw !== 'string' || !paletteIdRaw.startsWith('palette_')) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ success: false, error: 'paletteId must be a string starting with "palette_".' });
      }
      const palettes = readPalettes();
      const palette = palettes.find((p) => p.id === paletteIdRaw);
      if (!palette) {
        fs.unlinkSync(filePath);
        return res.status(404).json({ success: false, error: `Palette "${paletteIdRaw}" not found.` });
      }
      appliedPalette = palette;
      effectiveFields = preset.stage1_fields.filter((f) => f !== 'colors');
      effectiveStage1Prompt =
        preset.stage1_system_prompt +
        '\n\nA saved palette override is active. Do NOT extract colors — they will be supplied externally. Leave colors out of the response.';
    }

    const analysis = await callMiniMaxStage1(imageDataUri, effectiveStage1Prompt, effectiveFields);

    if (appliedPalette) {
      applyPaletteToAnalysis(analysis, appliedPalette);
    }

    // Stage 1.5: dedicated orientation/activity analysis (runs only if those fields selected)
    const orientationFields = ['subject_orientation', 'actions'].filter((f) => preset.stage1_fields.includes(f));
    if (orientationFields.length > 0) {
      const orientationResult = await callMiniMaxOrientationAnalysis(imageDataUri, orientationFields);
      if (orientationResult.subject_orientation) {
        analysis.subject_orientation = orientationResult.subject_orientation;
      }
      if (orientationResult.actions) {
        analysis.actions = orientationResult.actions;
      }
    }

    fs.unlinkSync(filePath);
    filePath = null;

    const responseData = {
      run_id: generateRunId(),
      preset_id: preset.id,
      preset_name: preset.name,
      analysis,
      requested_fields: preset.stage1_fields,
      model: MINIMAX_MODEL
    };
    if (appliedPalette) {
      responseData.palette_id = appliedPalette.id;
      responseData.palette_name = appliedPalette.name;
    }

    res.json({ success: true, data: responseData });
  } catch (error) {
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes — Subject factual re-analysis (ADR 0004)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `POST /api/subject` — re-analyze the uploaded image with a factual-only
 * system prompt and return a single `subject` field. Independent of the
 * active preset. See ADR 0004 for the contract (categories, exclusions,
 * length floor).
 */
app.post('/api/subject', upload.single('image'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No image file provided.' });
    filePath = req.file.path;

    if (!minimaxConfigured) {
      fs.unlinkSync(filePath);
      return res.status(503).json({ success: false, error: 'MiniMax M3 API key not configured.' });
    }

    const imageDataUri = fileToBase64DataUri(filePath, req.file.mimetype);
    const subject = await callMiniMaxSubjectAnalysis(imageDataUri);

    fs.unlinkSync(filePath);
    filePath = null;

    res.json({
      success: true,
      data: {
        subject,
        model: MINIMAX_MODEL
      }
    });
  } catch (error) {
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes — Camera-angle re-analysis (ADR 0008)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `POST /api/camera-angle` — re-analyse the uploaded image with a
 * camera-only system prompt and return a single `camera_angle` field.
 * Independent of the active preset (ADR 0008 §1). Powers the "Populate
 * with AI" button beneath the camera_angle input in the analysis editor.
 *
 * Response envelope mirrors `/api/subject` (ADR 0004) for symmetry:
 * `{ success, data: { camera_angle, model } }`.
 */
app.post('/api/camera-angle', upload.single('image'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No image file provided.' });
    filePath = req.file.path;

    if (!minimaxConfigured) {
      fs.unlinkSync(filePath);
      return res.status(503).json({ success: false, error: 'MiniMax M3 API key not configured.' });
    }

    const imageDataUri = fileToBase64DataUri(filePath, req.file.mimetype);
    const cameraAngle = await callMiniMaxCameraAngleAnalysis(imageDataUri);

    fs.unlinkSync(filePath);
    filePath = null;

    res.json({
      success: true,
      data: {
        camera_angle: cameraAngle,
        model: MINIMAX_MODEL
      }
    });
  } catch (error) {
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes — Subject prompt CRUD (ADR 0005)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `GET /api/subject-prompt` — return the active subject-extraction prompt
 * plus an `is_default` boolean (true when the on-disk content is byte-
 * identical to the shipped default) plus the `default_prompt` itself so
 * the UI's "Reset to default" control can restore it without a special
 * endpoint or hardcoded client copy.
 */
app.get('/api/subject-prompt', (req, res) => {
  try {
    const prompt = readSubjectPrompt();
    res.json({
      success: true,
      data: {
        prompt,
        default_prompt: DEFAULT_SUBJECT_PROMPT,
        is_default: prompt === DEFAULT_SUBJECT_PROMPT
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `PUT /api/subject-prompt` — overwrite the on-disk subject-extraction
 * prompt. Validates shape / emptiness / length; the prompt CONTENT is
 * unfiltered (the entire point of ADR 0005 is user ownership of the
 * prompt).
 */
app.put('/api/subject-prompt', (req, res) => {
  try {
    const validationError = validateSubjectPrompt(req.body);
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    writeSubjectPrompt(req.body.prompt);
    res.json({
      success: true,
      data: {
        prompt: req.body.prompt,
        is_default: req.body.prompt === DEFAULT_SUBJECT_PROMPT
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes — Stage 2 prompt overrides (ADR 0007) — per-preset
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper: resolve a preset by id from the registry and verify it has a
 * usable `stage2_system_prompt`. Returns the preset or sends a 4xx
 * response and returns null. Used by all three stage2-prompt routes so
 * the "preset doesn't exist" path is shared.
 */
const resolveStage2PromptPreset = (presetIdRaw, res) => {
  if (!presetIdRaw || typeof presetIdRaw !== 'string') {
    res.status(400).json({ success: false, error: 'presetId query parameter is required.' });
    return null;
  }
  const presets = readPresets();
  const preset = presets.find((p) => p.id === presetIdRaw);
  if (!preset) {
    res.status(404).json({ success: false, error: `Preset "${presetIdRaw}" not found.` });
    return null;
  }
  if (typeof preset.stage2_system_prompt !== 'string') {
    res.status(500).json({
      success: false,
      error: `Preset "${presetIdRaw}" has no usable stage2_system_prompt.`
    });
    return null;
  }
  return preset;
};

/**
 * `GET /api/stage2-prompt?presetId=...` — return the effective Stage 2
 * system prompt for a preset (override if one exists, otherwise the
 * preset's built-in `stage2_system_prompt`), plus `default_prompt` and a
 * content-based `is_default` flag (mirrors the ADR 0005 subject-prompt
 * payload shape).
 */
app.get('/api/stage2-prompt', (req, res) => {
  try {
    const preset = resolveStage2PromptPreset(req.query.presetId, res);
    if (!preset) return;

    const effectivePrompt = getEffectiveStage2Prompt(preset);
    res.json({
      success: true,
      data: {
        prompt: effectivePrompt,
        default_prompt: preset.stage2_system_prompt,
        is_default: effectivePrompt === preset.stage2_system_prompt
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `PUT /api/stage2-prompt?presetId=...` — write (or overwrite) the
 * override for a single preset. Body: `{ prompt: string }`. Validates
 * shape / emptiness / length; prompt content is unfiltered.
 */
app.put('/api/stage2-prompt', (req, res) => {
  try {
    const preset = resolveStage2PromptPreset(req.query.presetId, res);
    if (!preset) return;

    const validationError = validateStage2Prompt(req.body);
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    setStage2Override(preset.id, req.body.prompt);
    res.json({
      success: true,
      data: {
        prompt: req.body.prompt,
        default_prompt: preset.stage2_system_prompt,
        is_default: req.body.prompt === preset.stage2_system_prompt
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `DELETE /api/stage2-prompt?presetId=...` — remove the override for a
 * preset so subsequent Stage 2 calls fall back to the preset's built-in
 * `stage2_system_prompt`. Idempotent: deleting when no override exists
 * returns 200 with `removed: false` rather than 404.
 */
app.delete('/api/stage2-prompt', (req, res) => {
  try {
    const preset = resolveStage2PromptPreset(req.query.presetId, res);
    if (!preset) return;

    const removed = removeStage2Override(preset.id);
    res.json({
      success: true,
      data: {
        preset_id: preset.id,
        removed,
        prompt: preset.stage2_system_prompt,
        default_prompt: preset.stage2_system_prompt,
        is_default: true
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

app.post('/api/generate-prompt', async (req, res) => {
  try {
    const body = req.body || {};
    const { presetId, analysis, directives } = body;

    if (!presetId) return res.status(400).json({ success: false, error: 'presetId is required.' });
    if (!analysis || typeof analysis !== 'object') {
      return res.status(400).json({ success: false, error: 'analysis is required and must be an object.' });
    }
    if (directives && (typeof directives !== 'string' || directives.length > MAX_DIRECTIVES_LENGTH)) {
      return res.status(400).json({
        success: false,
        error: `directives must be a string up to ${MAX_DIRECTIVES_LENGTH} characters.`
      });
    }

    const presets = readPresets();
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return res.status(404).json({ success: false, error: `Preset "${presetId}" not found.` });

    if (!minimaxConfigured) {
      return res.status(503).json({ success: false, error: 'MiniMax M3 API key not configured.' });
    }

    const finalPrompt = await callMiniMaxStage2(analysis, directives || '', getEffectiveStage2Prompt(preset));

    res.json({
      success: true,
      data: {
        preset_id: preset.id,
        preset_name: preset.name,
        prompt: finalPrompt,
        model: MINIMAX_MODEL
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes — Saved color palettes (ADR 0006)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `GET /api/palettes` — list all saved palettes. Each entry contains
 * the full shape: id, name, colors, source_run_id, source_preset_id,
 * created_at. The picker and manager modal both consume this.
 */
app.get('/api/palettes', (req, res) => {
  try {
    const palettes = readPalettes();
    res.json({ success: true, data: palettes });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `GET /api/palettes/:id` — get one palette. Used by the picker
 * refresh path after a save and by /api/analyze's paletteId lookup.
 */
app.get('/api/palettes/:id', (req, res) => {
  try {
    const palettes = readPalettes();
    const palette = palettes.find((p) => p.id === req.params.id);
    if (!palette) return res.status(404).json({ success: false, error: `Palette "${req.params.id}" not found.` });
    res.json({ success: true, data: palette });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `POST /api/palettes` — save a new palette from a finished run.
 * Validates name uniqueness, colors shape, source ids.
 * Body shape: `{ name, colors, source_run_id, source_preset_id }`.
 * The colors field accepts hex / rgb / hsl (ADR 0013 §2); the stored
 * format is always hex. Initial save pushes v1 to history.
 */
app.post('/api/palettes', (req, res) => {
  try {
    const body = req.body || {};
    const palettes = readPalettes();
    const existingNames = new Set(palettes.map((p) => p.name.toLowerCase()));
    const validationError = validatePalette(body, { existingNames });
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    const colorsResult = validatePaletteColorsFlexible(body.colors);
    if (colorsResult.error) return res.status(400).json({ success: false, error: colorsResult.error });

    const now = new Date().toISOString();
    const newPalette = {
      id: generatePaletteId(),
      name: body.name.trim(),
      colors: colorsResult.colors,
      source_run_id: body.source_run_id,
      source_preset_id: body.source_preset_id,
      created_at: now,
      updated_at: now,
      history: []
    };
    pushPaletteHistory(newPalette);

    palettes.push(newPalette);
    writePalettes(palettes);
    res.status(201).json({ success: true, data: newPalette });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `POST /api/palettes/custom` — create a palette from scratch with no
 * `source_run_id`. Body: `{ name, colors, source_preset_id? }`. The
 * palette is otherwise identical to one saved from a run: same shape,
 * same name/colors validation, history starts at v1.
 *
 * Why a separate endpoint (ADR 0013 §4): the original POST is
 * "save from a run" — `source_run_id` is the whole point. A
 * custom-created palette has no run. Two endpoints with disjoint
 * contracts is clearer than one endpoint with a "is this from a run?"
 * boolean.
 */
app.post('/api/palettes/custom', (req, res) => {
  try {
    const body = req.body || {};
    const palettes = readPalettes();
    const existingNames = new Set(palettes.map((p) => p.name.toLowerCase()));

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ success: false, error: 'Request body must be a JSON object.' });
    }

    const nameError = validatePaletteName({ name: body.name }, { existingNames });
    if (nameError) return res.status(400).json({ success: false, error: nameError });

    const colorsResult = validatePaletteColorsFlexible(body.colors);
    if (colorsResult.error) return res.status(400).json({ success: false, error: colorsResult.error });

    if (body.source_preset_id !== undefined && body.source_preset_id !== null && body.source_preset_id !== '') {
      if (typeof body.source_preset_id !== 'string' || !body.source_preset_id.startsWith(PRESET_ID_PREFIX)) {
        return res.status(400).json({ success: false, error: `source_preset_id must be a string starting with "${PRESET_ID_PREFIX}" (got ${JSON.stringify(body.source_preset_id)})` });
      }
    }

    const now = new Date().toISOString();
    const newPalette = {
      id: generatePaletteId(),
      name: body.name.trim(),
      colors: colorsResult.colors,
      source_run_id: null,
      source_preset_id: typeof body.source_preset_id === 'string' ? body.source_preset_id : null,
      created_at: now,
      updated_at: now,
      history: []
    };
    pushPaletteHistory(newPalette);

    palettes.push(newPalette);
    writePalettes(palettes);
    res.status(201).json({ success: true, data: newPalette });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `PUT /api/palettes/:id` — partial edit. Body shape (ADR 0013 §3):
 * `{ name?, colors? }`. At least one field is required. Each present
 * field is validated; name uniqueness is enforced against other
 * palettes (excluding self). A successful edit pushes a new history
 * entry so the rollback path has something to restore to.
 *
 * The original rename-only behavior is preserved — `PUT { name: "x" }`
 * still works exactly as before, with the addition of a v2 history
 * entry.
 */
app.put('/api/palettes/:id', (req, res) => {
  try {
    const body = req.body || {};
    const palettes = readPalettes();
    const idx = palettes.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: `Palette "${req.params.id}" not found.` });

    const existingNames = new Set(
      palettes.filter((p) => p.id !== req.params.id).map((p) => p.name.toLowerCase())
    );

    const validationError = validatePaletteEdit(body, { existingNames });
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    const applyError = applyPaletteUpdate(palettes[idx], body);
    if (applyError) return res.status(400).json({ success: false, error: applyError });

    pushPaletteHistory(palettes[idx]);
    writePalettes(palettes);
    res.json({ success: true, data: palettes[idx] });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `POST /api/palettes/:id/restore/:version` — rollback to a specific
 * history version. The named version's `name` + `colors` become the
 * new top-level values; a NEW history entry is appended (version =
 * `current + 1`) so the rollback is itself a recorded edit. Original
 * versions are preserved in history.
 */
app.post('/api/palettes/:id/restore/:version', (req, res) => {
  try {
    const version = parseInt(req.params.version, 10);
    if (!Number.isInteger(version) || version < 1) {
      return res.status(400).json({ success: false, error: `version must be a positive integer (got ${JSON.stringify(req.params.version)})` });
    }
    const palettes = readPalettes();
    const idx = palettes.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: `Palette "${req.params.id}" not found.` });

    if (!Array.isArray(palettes[idx].history)) palettes[idx].history = [];
    const target = palettes[idx].history.find((h) => h && h.version === version);
    if (!target) {
      return res.status(400).json({ success: false, error: `version ${version} not found in history (has ${palettes[idx].history.length} version${palettes[idx].history.length === 1 ? '' : 's'})` });
    }

    palettes[idx].name = target.name;
    palettes[idx].colors = (target.colors || []).map((c) => ({ hex: c.hex, name: c.name }));
    pushPaletteHistory(palettes[idx]);
    writePalettes(palettes);
    res.json({ success: true, data: palettes[idx] });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `DELETE /api/palettes/:id` — hard-delete a palette. If the deleted
 * palette was selected in the picker on a running client, the next
 * /api/analyze will 404 (the palette is gone) and the client must
 * clear the picker.
 */
app.delete('/api/palettes/:id', (req, res) => {
  try {
    const palettes = readPalettes();
    const idx = palettes.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: `Palette "${req.params.id}" not found.` });

    const [removed] = palettes.splice(idx, 1);
    writePalettes(palettes);
    res.json({ success: true, data: { id: removed.id, deleted: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes — Saved directives (ADR 0009)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `GET /api/directives` — list all saved directives. The full
 * history is included so the manager modal can render the version
 * timeline without a second round-trip.
 */
app.get('/api/directives', (req, res) => {
  try {
    res.json({ success: true, data: readDirectives() });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `GET /api/directives/:id` — get one saved directive (with history).
 */
app.get('/api/directives/:id', (req, res) => {
  try {
    const directives = readDirectives();
    const directive = directives.find((d) => d.id === req.params.id);
    if (!directive) {
      return res.status(404).json({ success: false, error: `Directive "${req.params.id}" not found.` });
    }
    res.json({ success: true, data: directive });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `POST /api/directives` — save a new directive. Body shape:
 * `{ name, content, tags? }`. Validates name uniqueness,
 * content length, tag shape.
 */
app.post('/api/directives', (req, res) => {
  try {
    const body = req.body || {};
    const directives = readDirectives();
    const existingNames = new Set(directives.map((d) => d.name.toLowerCase()));

    const validationError = validateDirectiveBody(body, { existingNames });
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    const tagsResult = normalizeDirectiveTags(body.tags);
    if (tagsResult.error) return res.status(400).json({ success: false, error: tagsResult.error });

    const now = new Date().toISOString();
    const newDirective = {
      id: generateDirectiveId(),
      name: body.name.trim(),
      content: body.content,
      tags: tagsResult.tags,
      created_at: now,
      updated_at: now,
      last_used_at: null,
      usage_count: 0,
      history: []
    };
    pushDirectiveHistory(newDirective);

    directives.push(newDirective);
    writeDirectives(directives);
    res.status(201).json({ success: true, data: newDirective });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `PUT /api/directives/:id` — update an existing directive. Body
 * shape (partial): `{ name?, content?, tags? }`. Each field present
 * is validated, and the resulting merged state is recorded as a
 * new history entry. A PUT with no fields is a 400.
 */
app.put('/api/directives/:id', (req, res) => {
  try {
    const body = req.body || {};
    const directives = readDirectives();
    const idx = directives.findIndex((d) => d.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: `Directive "${req.params.id}" not found.` });
    }

    const existingNames = new Set(
      directives.filter((d) => d.id !== req.params.id).map((d) => d.name.toLowerCase())
    );

    const validationError = validateDirectiveBody(body, { existingNames, partial: true });
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    const applyError = applyDirectiveUpdate(directives[idx], body);
    if (applyError) return res.status(400).json({ success: false, error: applyError });

    pushDirectiveHistory(directives[idx]);
    writeDirectives(directives);
    res.json({ success: true, data: directives[idx] });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `DELETE /api/directives/:id` — hard-delete a directive and its full
 * history.
 */
app.delete('/api/directives/:id', (req, res) => {
  try {
    const directives = readDirectives();
    const idx = directives.findIndex((d) => d.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: `Directive "${req.params.id}" not found.` });
    }
    const [removed] = directives.splice(idx, 1);
    writeDirectives(directives);
    res.json({ success: true, data: { id: removed.id, deleted: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `POST /api/directives/:id/apply` — record that a directive was
 * applied. Increments `usage_count` and stamps `last_used_at`.
 * Does NOT touch `content` / `history` — the user may edit the
 * loaded content in the textarea before generating, which is
 * intentional.
 */
app.post('/api/directives/:id/apply', (req, res) => {
  try {
    const directives = readDirectives();
    const idx = directives.findIndex((d) => d.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: `Directive "${req.params.id}" not found.` });
    }
    directives[idx].usage_count = (directives[idx].usage_count || 0) + 1;
    directives[idx].last_used_at = new Date().toISOString();
    writeDirectives(directives);
    res.json({ success: true, data: directives[idx] });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `POST /api/directives/:id/restore/:version` — rollback to a
 * specific history version. The named version's content / name / tags
 * become the new top-level values, and a NEW history entry is
 * appended (version = current + 1) so the rollback is itself a
 * recorded edit. Original version is preserved in history.
 */
app.post('/api/directives/:id/restore/:version', (req, res) => {
  try {
    const version = parseInt(req.params.version, 10);
    if (!Number.isInteger(version) || version < 1) {
      return res.status(400).json({ success: false, error: `version must be a positive integer (got ${JSON.stringify(req.params.version)})` });
    }
    const directives = readDirectives();
    const idx = directives.findIndex((d) => d.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: `Directive "${req.params.id}" not found.` });
    }
    const target = directives[idx].history.find((h) => h.version === version);
    if (!target) {
      return res.status(400).json({ success: false, error: `version ${version} not found in history (has ${directives[idx].history.length} versions)` });
    }
    directives[idx].name = target.name;
    directives[idx].content = target.content;
    directives[idx].tags = Array.isArray(target.tags) ? target.tags.slice() : [];
    pushDirectiveHistory(directives[idx]);
    writeDirectives(directives);
    res.json({ success: true, data: directives[idx] });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `GET /api/directives/export/all` — download all directives as an
 * `.i2p.json` envelope for sharing or backup.
 */
app.get('/api/directives/export/all', (req, res) => {
  try {
    const envelope = {
      format: DIRECTIVE_FILE_FORMAT,
      version: DIRECTIVE_FILE_VERSION,
      exported_at: new Date().toISOString(),
      directives: readDirectives()
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="directives.i2p.json"');
    res.json(envelope);
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `POST /api/directives/import` — import a directive envelope. Body
 * is the parsed envelope (not a multipart upload). Validates format /
 * version, validates every directive in the batch, mints fresh ids
 * (so imports never collide with existing local directives), preserves
 * the imported `history`, and resets `usage_count` / `last_used_at`.
 * The import is atomic — if any directive is invalid, none are
 * written and the original file is untouched.
 */
app.post('/api/directives/import', (req, res) => {
  try {
    const body = req.body || {};
    if (typeof body !== 'object' || Array.isArray(body) || body === null) {
      return res.status(400).json({ success: false, error: 'Request body must be a JSON object (the export envelope).' });
    }
    if (body.format !== DIRECTIVE_FILE_FORMAT) {
      return res.status(400).json({ success: false, error: `format must be "${DIRECTIVE_FILE_FORMAT}" (got ${JSON.stringify(body.format)})` });
    }
    if (body.version !== DIRECTIVE_FILE_VERSION) {
      return res.status(400).json({ success: false, error: `version must be ${DIRECTIVE_FILE_VERSION} (got ${JSON.stringify(body.version)})` });
    }
    if (!Array.isArray(body.directives)) {
      return res.status(400).json({ success: false, error: 'envelope.directives must be an array' });
    }

    const existing = readDirectives();
    const batchNames = new Set(existing.map((d) => d.name.toLowerCase()));

    // Validate all directives first, collecting them with fresh ids.
    const toAdd = [];
    for (let i = 0; i < body.directives.length; i++) {
      const raw = body.directives[i];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return res.status(400).json({ success: false, error: `directives[${i}] must be a JSON object` });
      }

      const validationError = validateDirectiveBody(raw, { existingNames: batchNames });
      if (validationError) {
        return res.status(400).json({ success: false, error: `directives[${i}]: ${validationError}` });
      }

      const tagsResult = normalizeDirectiveTags(raw.tags);
      if (tagsResult.error) {
        return res.status(400).json({ success: false, error: `directives[${i}]: ${tagsResult.error}` });
      }

      // Preserve imported history, but normalize each entry's shape
      // (defensive — drop non-conforming entries rather than fail the
      // whole import). If the imported history is missing or invalid,
      // synthesize a single entry from the imported current state.
      let history = [];
      if (Array.isArray(raw.history)) {
        history = raw.history
          .filter((h) => h && typeof h === 'object' && typeof h.content === 'string' && typeof h.name === 'string' && Number.isInteger(h.version))
          .map((h) => ({
            version: h.version,
            name: h.name,
            content: h.content,
            tags: Array.isArray(h.tags) ? h.tags.filter((t) => typeof t === 'string') : [],
            saved_at: typeof h.saved_at === 'string' ? h.saved_at : new Date().toISOString()
          }));
      }
      if (history.length === 0) {
        history.push({
          version: 1,
          name: raw.name.trim(),
          content: raw.content,
          tags: tagsResult.tags.slice(),
          saved_at: new Date().toISOString()
        });
      }

      const freshId = generateDirectiveId();
      toAdd.push({
        id: freshId,
        name: raw.name.trim(),
        content: raw.content,
        tags: tagsResult.tags,
        created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_used_at: null,
        usage_count: 0,
        history
      });
      batchNames.add(raw.name.trim().toLowerCase());
    }

    // Atomic: write all in one go.
    const merged = existing.concat(toAdd);
    writeDirectives(merged);
    res.status(201).json({ success: true, data: { imported: toAdd.length, total: merged.length } });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Routes — Post-generation chat (ADR 0011)
// ─────────────────────────────────────────────────────────────────────────────

// ─── Anchor-preservation helpers (ADR 0012) ────────────────────────

/**
 * Tokenize a prompt for anchor-preservation analysis. Lowercase,
 * strip non-alphanumeric characters, drop tokens shorter than
 * `PRESERVATION_MIN_TOKEN_LENGTH`, drop stop words. Returns a flat
 * array of content tokens in original order. Used by both the
 * keyword-retention and bigram-retention passes of
 * `validatePromptPreservation`.
 *
 * Defensive: non-string input returns []. Whitespace-only returns
 * []. Numbers are kept (hex codes, dimensions, sq-ft, etc. are
 * content).
 *
 * @param {string} text
 * @returns {string[]}
 */
const tokenizeForPreservation = (text) => {
  if (typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) =>
      w.length >= PRESERVATION_MIN_TOKEN_LENGTH &&
      !PRESERVATION_STOP_WORDS.has(w)
    );
};

/**
 * Extract a Set of bigrams (2-grams) from a tokenized array. Used to
 * catch multi-word phrases — "interior wall", "eggshell finish",
 * "low VOC" — that keyword overlap alone would miss when a rewrite
 * keeps some of the words but reorders or drops the phrase.
 *
 * @param {string[]} tokens
 * @returns {Set<string>}
 */
const extractPreservationBigrams = (tokens) => {
  const out = new Set();
  for (let i = 0; i < tokens.length - 1; i++) {
    out.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
};

/**
 * Round a number to 3 decimal places for human-readable ratios in the
 * structured report. Avoids the noise of floating-point dust
 * (0.6999999...).
 */
const roundPreservationRatio = (n) => Math.round(n * 1000) / 1000;

/**
 * Score how much of `original` survives in `revised`, with special
 * consideration for what the user actually asked to change. Returns a
 * structured report; callers decide what to do based on `preserved`.
 *
 * Algorithm (ADR 0012 §"Server-side validation"):
 *  1. Tokenize both prompts (drop stop words, short tokens).
 *  2. Compute keyword retention (unique content words in original
 *     that appear in revised, divided by total unique).
 *  3. Compute bigram retention (catches multi-word phrases).
 *  4. Identify user-targeted tokens (tokens in the user's message that
 *     also appear in the original — these are the parts the user
 *     is allowed to drop).
 *  5. Compute non-targeted retention (the headline metric: among
 *     content words the user did NOT name, what fraction survived).
 *  6. Pass criteria: nonTargetedRatio and bigramRatio both above
 *     thresholds (long-prompt vs short-prompt thresholds differ).
 *
 * @param {string} original — the current working prompt (text the user is iterating on)
 * @param {string} revised — the assistant's `suggested_prompt`
 * @param {string} userRequest — the user's chat message that triggered the revision
 * @returns {{preserved: boolean, keywordRatio: number, nonTargetedRatio: number, bigramRatio: number, missing: string[], nonTargetedMissing: string[], targetedMissing: string[], reason: string|null}}
 */
const validatePromptPreservation = (original, revised, userRequest) => {
  if (typeof original !== 'string' || typeof revised !== 'string') {
    return {
      preserved: true,
      keywordRatio: 1,
      nonTargetedRatio: 1,
      bigramRatio: 1,
      missing: [],
      nonTargetedMissing: [],
      targetedMissing: [],
      reason: 'invalid_input'
    };
  }

  const origTokens = tokenizeForPreservation(original);
  const revTokens = new Set(tokenizeForPreservation(revised));
  const userTokens = new Set(tokenizeForPreservation(userRequest || ''));

  const origUnique = Array.from(new Set(origTokens));
  const missing = origUnique.filter((w) => !revTokens.has(w));

  const keywordRatio = origUnique.length === 0
    ? 1
    : (origUnique.length - missing.length) / origUnique.length;

  const origBigrams = extractPreservationBigrams(origTokens);
  const revBigrams = extractPreservationBigrams(Array.from(revTokens));
  let bigramMatched = 0;
  for (const bg of origBigrams) {
    if (revBigrams.has(bg)) bigramMatched++;
  }
  const bigramRatio = origBigrams.size === 0
    ? 1
    : bigramMatched / origBigrams.size;

  const nonTargetedMissing = missing.filter((w) => !userTokens.has(w));
  const targetedMissing = missing.filter((w) => userTokens.has(w));
  const nonTargetedOrig = origUnique.filter((w) => !userTokens.has(w)).length;
  const nonTargetedRatio = nonTargetedOrig === 0
    ? 1
    : (nonTargetedOrig - nonTargetedMissing.length) / nonTargetedOrig;

  const isLong = original.length > PRESERVATION_SHORT_PROMPT_LENGTH;
  const keywordThreshold = isLong
    ? PRESERVATION_KEYWORD_THRESHOLD_LONG
    : PRESERVATION_KEYWORD_THRESHOLD_SHORT;
  const bigramThreshold = isLong
    ? PRESERVATION_BIGRAM_THRESHOLD_LONG
    : PRESERVATION_BIGRAM_THRESHOLD_SHORT;

  const preserved = nonTargetedRatio >= keywordThreshold &&
                    bigramRatio >= bigramThreshold;

  return {
    preserved,
    keywordRatio: roundPreservationRatio(keywordRatio),
    nonTargetedRatio: roundPreservationRatio(nonTargetedRatio),
    bigramRatio: roundPreservationRatio(bigramRatio),
    missing,
    nonTargetedMissing,
    targetedMissing,
    reason: preserved
      ? null
      : (nonTargetedRatio < keywordThreshold ? 'non_targeted_loss' : 'bigram_loss')
  };
};

/**
 * Default system prompt shipped for the post-generation chat console.
 * Mirrors the pattern of `DEFAULT_SUBJECT_PROMPT` (ADR 0004) and
 * `DEFAULT_CAMERA_ANGLE_PROMPT` (ADR 0008): a code constant that the
 * route injects verbatim at runtime, so server restart picks up
 * prompt edits without ceremony.
 *
 * Updated 2026-06-24 (ADR 0012) with the anchor-preservation
 * contract: the model is told to TREAT the current working prompt as
 * an EDIT BASE, not a topic to write about, and to identify what the
 * user asked to change vs what should be preserved before
 * generating. The companion server-side validator
 * (`validatePromptPreservation`) catches wholesale rewrites that
 * slip through and declines them.
 */
const DEFAULT_CHAT_SYSTEM_PROMPT = `You are a focused prompt-refinement assistant. The user has just generated an image-generation prompt through a two-stage pipeline. Your job is to converse with them about that prompt and propose concrete revisions when they ask for changes.

# CONTEXT (carried with every turn)

## Original generated prompt
The text Stage 2 produced when the user clicked "Generate prompt". This is the user's starting point.

## Current working prompt
The latest applied revision. Starts equal to the original; advances whenever the user clicks "Apply" on one of your revisions.

## Analysis snapshot
The structured JSON Stage 1 returned (subject, style, lighting, etc.). Treat this as the source of truth for what facts the prompt is grounded in. Even if the user later edits the live analysis editor, the snapshot preserves the context Stage 2 actually used.

# CORE CONTRACT — EDIT, DO NOT REGENERATE

The current working prompt is an EDIT BASE, not a topic to write about. Before you generate any revision, mentally perform three steps:

1. INVENTORY the current working prompt. List every concrete fact it contains: application or use case (e.g. "paint specification", "product packaging", "architectural rendering"), pre-defined values (hex codes, dimensions, named colors, quantities, technical parameters), and production requirements (low-VOC, food-safe, royalty-free, ADA-compliant, color-space, durability specs, etc.).
2. CLASSIFY each item in that inventory against the user's request. Items the user explicitly mentioned are the DELTA — those are what you are allowed to change. Items the user did NOT mention are the ANCHOR SET — those are immutable for this revision.
3. APPLY only the delta to the anchor set. The revised prompt is the anchor set verbatim (or with paraphrastic equivalence that preserves meaning) PLUS the user's requested change. Do NOT add new facts the user did not ask for. Do NOT drop anchor-set items. Do NOT introduce a different medium, application, or style direction unless the user asked for one.

If the user explicitly asks for a wholesale rewrite ("rewrite the whole prompt in a punchier voice", "start fresh with a different angle"), the anchor set is empty by their request — produce a fresh prompt. Otherwise the anchor set is non-empty and you MUST preserve it.

# RULES

- Every reply MUST be a JSON object with EXACTLY two string fields:
    - \`reply\`: short, conversational acknowledgement of the user's message (1-3 sentences). Address what they asked. NEVER empty. NEVER omitted.
    - \`suggested_prompt\`: a string. NEVER null, NEVER an array, NEVER an object, NEVER omitted. Use empty string \`""\` for question-only replies.
- \`reply\` is MANDATORY and NON-EMPTY. The API rejects responses with an empty or missing \`reply\`. Always include it, even for "I can't help with that" answers.
- Set \`suggested_prompt\` to the FULL revised prompt text (a non-empty string) when the user is asking for a change: "make the lighting more dramatic", "shorten the subject", "use second-person voice", "add a film-grain mention", "rewrite in comma-separated tags", "change the colors to navy, gold, white", etc.
- Set \`suggested_prompt\` to an empty string \`""\` when the user is asking a question, requesting explanation, or just chatting: "why this lighting?", "what does chiaroscuro mean here?", "thanks", "what's the mood?".
- When you DO propose a revision, the new text must be a complete, self-contained image-generation prompt — never a fragment or a diff. The user will see ONLY the revised text; they will not see your reply outside the chat.
- ANCHOR PRESERVATION (non-negotiable for any non-wholesale request): every pre-defined value, technical parameter, application context, named constraint, hex code, dimension, or production requirement that the user did NOT explicitly ask to change MUST still appear in the revised prompt. Removing or substituting anchor-set content is a wholesale rewrite and will be rejected by the server-side validator.
- DO NOT introduce new facts the user did not ask for. A revision that names a different medium, application, style direction, or use case than the original is a rewrite. New adjectives, synonyms, or stylistic flourishes on the EXISTING content are fine; introducing a new direction is not.
- Keep \`reply\` under 200 words. Keep revisions proportional: don't shrink a 600-word prompt to 50 words unless the user asked for terse output.
- Do NOT comment on style, aesthetic quality, or medium — your job is editing, not critiquing.
- Do NOT ask clarifying questions in \`reply\`; if a request is ambiguous, propose the most natural interpretation and let the user redirect.
- Respond with ONLY the JSON object — no markdown fences, no prose around it.

# EXAMPLES

Example A — TARGETED EDIT (the user's request names one parameter; everything else must survive). The user message is "Change the colors to navy, gold, and white" and the current working prompt is a paint-application specification. The anchor set is: paint specification context, eggshell finish, low-VOC formula, brush/roller application method, two-coat minimum, 4-hour drying time, 350 sq ft coverage. The delta is: the three named colors and their hex codes. A correct reply:
\`\`\`json
{"reply":"I've swapped the three colors to navy, gold, and white while keeping the paint specification, eggshell finish, low-VOC formula, application method, drying time, and coverage unchanged.","suggested_prompt":"Professional interior paint specification. Eggshell finish, low-VOC formula, suitable for high-traffic residential areas. Apply with synthetic brush or roller; two coats minimum. Drying time 4 hours between coats. Coverage 350 sq ft per gallon. Colors: Navy (HEX #1F2A44), Gold (HEX #C9A227), White (HEX #FFFFFF)."}
\`\`\`

Example B — WHOLESALE REWRITE (explicitly requested by the user; the anchor set is empty by their request). The user message is "Rewrite the whole prompt from scratch with a more cinematic feel". A correct reply:
\`\`\`json
{"reply":"Here's a fresh take with cinematic framing and a moodier palette.","suggested_prompt":"A cinematic wide shot of a rain-soaked alley at night, neon signs bleeding pink and teal across wet asphalt, a lone figure under a black umbrella, shallow depth of field, anamorphic lens flare, 35mm film grain, Roger Deakins lighting."}
\`\`\`

Example C — QUESTION (no revision this turn). The user message is "why did you pick this framing?". A correct reply:
\`\`\`json
{"reply":"I chose the three-quarter view because it shows both the figure's face and their gesture toward the canvas, giving the viewer spatial context that a straight profile would lose.","suggested_prompt":""}
\`\`\`

Both fields are ALWAYS present and ALWAYS strings. Never omit either field.`;

/**
 * Generate a fresh chat session id (`chat_<16 hex>`).
 */
const generateChatSessionId = () => `chat_${crypto.randomBytes(8).toString('hex')}`;

/**
 * Generate a fresh chat message id (`msg_<16 hex>`).
 */
const generateChatMessageId = () => `msg_${crypto.randomBytes(8).toString('hex')}`;

/**
 * Read all chat sessions from disk. Seeds the file with `[]` on first
 * read. Drops malformed entries with a console warning so a partial
 * corruption doesn't brick the whole list — same forgiving pattern
 * as the palettes (ADR 0006) and directives (ADR 0009) helpers.
 *
 * @returns {Array<object>}
 */
const readChatSessions = () => {
  ensureDataFileExists();
  let raw;
  try {
    raw = fs.readFileSync(CHAT_SESSIONS_FILE, 'utf8');
  } catch (e) {
    console.error('Failed to read chat_sessions file:', e.message);
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('chat_sessions file is corrupt JSON; returning empty list:', e.message);
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.warn('chat_sessions file is not an array; returning empty list');
    return [];
  }
  return parsed.filter((s) => {
    if (!s || typeof s !== 'object') return false;
    if (typeof s.id !== 'string' || !s.id.startsWith(CHAT_SESSION_ID_PREFIX)) return false;
    if (typeof s.preset_id !== 'string') return false;
    if (typeof s.original_prompt !== 'string') return false;
    if (typeof s.current_prompt !== 'string') return false;
    if (!Array.isArray(s.messages)) return false;
    return true;
  });
};

/**
 * Atomic-ish write: write to a sibling temp file, then `fs.renameSync`
 * over the real file. POSIX rename is atomic on the same filesystem.
 * Mirrors `writePalettes` (ADR 0006) and `writeDirectives` (ADR 0009).
 */
const writeChatSessions = (sessions) => {
  ensureDataFileExists();
  const tmpFile = `${CHAT_SESSIONS_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(sessions, null, 2), 'utf8');
  fs.renameSync(tmpFile, CHAT_SESSIONS_FILE);
};

/**
 * Truncate a chat session title to a readable length. Mirrors the
 * directive-name trim rules (ADR 0009): single-line, no surrounding
 * whitespace, capped at CHAT_TITLE_MAX_LENGTH.
 */
const buildChatTitle = (prompt) => {
  if (typeof prompt !== 'string') return '';
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  if (oneLine.length === 0) return '';
  return oneLine.length > CHAT_TITLE_MAX_LENGTH
    ? `${oneLine.slice(0, CHAT_TITLE_MAX_LENGTH - 1)}…`
    : oneLine;
};

/**
 * Validate a `POST /api/chat/sessions` body. Returns an error string
 * or null. Fields:
 *   - `prompt`: required, non-empty string, ≤ MAX_FINAL_PROMPT_LENGTH.
 *   - `preset_id`: required, must start with `preset_` and resolve to
 *     a known preset (caller passes the readPresets() list).
 *   - `preset_name`: optional, string ≤ 200 chars. Defaults to '' if
 *     missing.
 *   - `run_id`: optional, string matching `run_<16 hex>` if present.
 *   - `analysis_snapshot`: optional, plain object (any shape; we
 *     trust the field palette to have constrained what the editor
 *     can send).
 *
 * Validation of the *user message* body for
 * `POST /api/chat/sessions/:id/messages` lives in
 * `validateChatMessage`.
 */
const validateChatSessionCreate = (body, { presets } = {}) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object.';
  }

  if (typeof body.prompt !== 'string') {
    return 'prompt is required and must be a string.';
  }
  const trimmedPrompt = body.prompt.trim();
  if (trimmedPrompt.length === 0) {
    return 'prompt must not be empty.';
  }
  if (body.prompt.length > MAX_FINAL_PROMPT_LENGTH) {
    return `prompt must be ${MAX_FINAL_PROMPT_LENGTH} characters or fewer (got ${body.prompt.length}).`;
  }

  if (typeof body.preset_id !== 'string' || !body.preset_id.startsWith(PRESET_ID_PREFIX)) {
    return `preset_id must be a string starting with "${PRESET_ID_PREFIX}" (got ${JSON.stringify(body.preset_id)}).`;
  }
  if (Array.isArray(presets) && !presets.some((p) => p.id === body.preset_id)) {
    return `preset_id "${body.preset_id}" does not match any known preset.`;
  }

  if (body.preset_name !== undefined && body.preset_name !== null) {
    if (typeof body.preset_name !== 'string') return 'preset_name must be a string when provided.';
    if (body.preset_name.length > 200) return `preset_name must be 200 characters or fewer (got ${body.preset_name.length}).`;
  }

  if (body.run_id !== undefined && body.run_id !== null && body.run_id !== '') {
    if (typeof body.run_id !== 'string' || !RUN_ID_REGEX.test(body.run_id)) {
      return `run_id must match ${RUN_ID_REGEX} when provided (got ${JSON.stringify(body.run_id)}).`;
    }
  }

  if (body.analysis_snapshot !== undefined && body.analysis_snapshot !== null) {
    if (typeof body.analysis_snapshot !== 'object' || Array.isArray(body.analysis_snapshot)) {
      return 'analysis_snapshot must be a plain object when provided.';
    }
  }

  return null;
};

/**
 * Validate a user message body. Returns an error string or null.
 * Rules:
 *   - body must be an object
 *   - content is required, non-empty string (after trim), ≤
 *     MAX_CHAT_MESSAGE_LENGTH chars.
 *
 * Mirrors the shape of `validateDirectiveBody` and `validateSubjectPrompt`
 * so the project's validation surface stays consistent.
 */
const validateChatMessage = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object with a "content" string.';
  }
  if (typeof body.content !== 'string') {
    return 'content is required and must be a string.';
  }
  if (body.content.trim().length === 0) {
    return 'content must not be empty.';
  }
  if (body.content.length > MAX_CHAT_MESSAGE_LENGTH) {
    return `content must be ${MAX_CHAT_MESSAGE_LENGTH} characters or fewer (got ${body.content.length}).`;
  }
  return null;
};

/**
 * Pure helper: extract a `{ reply, suggested_prompt }` object from the
 * raw model output. Mirrors the Stage 1 JSON extraction logic in
 * `callMiniMaxStage1`: tries direct parse first, then a markdown
 * fenced block, then balanced-brace extraction.
 *
 * TOTAL function: always returns a valid `{ reply, suggested_prompt }`
 * pair. Never throws. Defensive fallbacks are applied when the model
 * output is malformed, missing required fields, or has the wrong
 * shape — the chat console must always render *something* so the user
 * sees a reply instead of a hard error. The original raw output and
 * any parse failure are surfaced via the third return element
 * `fallback_reason` so the caller can log diagnostic info without
 * breaking the UI.
 *
 * Fallback policy:
 *   - `reply` is ALWAYS a non-empty string. Missing / non-string /
 *     empty / whitespace → fallback text. Synthesized text is short,
 *     honest about the failure, and never contains an invented
 *     suggested_prompt.
 *   - `suggested_prompt` is ALWAYS `null` on any parse fallback. We
 *     never invent a revision; that would risk the user applying
 *     hallucinated content to their prompt.
 *   - `fallback_reason` is a short tag (`missing_reply`, `empty_reply`,
 *     `not_object`, `no_json`, etc.) for server logs; the UI never
 *     displays it.
 *
 * @param {string} raw
 * @returns {{ reply: string, suggested_prompt: null, fallback_reason: string|null }}
 */
const CHAT_FALLBACK_REPLY = "Sorry — I couldn't generate a response for that message. Please try again or rephrase your request.";

const extractChatReply = (raw) => {
  const successResult = (reply, suggestedPrompt) => ({
    reply,
    suggested_prompt: suggestedPrompt,
    fallback_reason: null
  });

  const fallbackResult = (reason) => ({
    reply: CHAT_FALLBACK_REPLY,
    suggested_prompt: null,
    fallback_reason: reason
  });

  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return fallbackResult('empty_content');
  }
  const trimmed = raw.trim();

  let parsed = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_) {
    const codeBlock = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlock) {
      try {
        parsed = JSON.parse(codeBlock[1]);
      } catch (_) { /* fall through */ }
    }
    if (!parsed) {
      const first = trimmed.indexOf('{');
      const last = trimmed.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last > first) {
        try {
          parsed = JSON.parse(trimmed.slice(first, last + 1));
        } catch (_) {
          // Genuinely unparseable — fall back rather than throw.
          return fallbackResult('unparseable_json');
        }
      } else {
        return fallbackResult('no_json');
      }
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fallbackResult('not_object');
  }

  // Unwrap the schema-name wrapper if the model returned its response
  // nested under the json_schema name key. The MiniMax M3 model
  // commonly does this (verified live 2026-06-23 — Stage 1 already
  // has the same unwrap; chat was missing it). Mirrors the logic in
  // `callMiniMaxStage1` and `callMiniMaxSubjectAnalysis`.
  if (parsed.chat_reply && typeof parsed.chat_reply === 'object' && !Array.isArray(parsed.chat_reply)) {
    parsed = parsed.chat_reply;
  }

  // After unwrap, re-check it's an object.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fallbackResult('not_object');
  }

  // `reply` — must be a non-empty string. Any other shape falls back.
  if (typeof parsed.reply !== 'string' || parsed.reply.trim().length === 0) {
    if (parsed.reply === undefined || !Object.prototype.hasOwnProperty.call(parsed, 'reply')) {
      return fallbackResult('missing_reply');
    }
    if (parsed.reply === null) {
      return fallbackResult('null_reply');
    }
    if (typeof parsed.reply !== 'string') {
      return fallbackResult('wrong_type_reply');
    }
    return fallbackResult('empty_reply');
  }

  // `suggested_prompt` — tolerate missing / wrong type by coercing to
  // null (no revision). Never invent a revision; never throw.
  let suggestedPrompt = null;
  if (Object.prototype.hasOwnProperty.call(parsed, 'suggested_prompt')) {
    if (parsed.suggested_prompt === null) {
      suggestedPrompt = null;
    } else if (typeof parsed.suggested_prompt === 'string') {
      // Empty string → null per the "no revision" convention.
      suggestedPrompt = parsed.suggested_prompt.trim().length > 0 ? parsed.suggested_prompt : null;
    } else {
      // Wrong type (array, object, number, boolean). Don't trust it.
      suggestedPrompt = null;
    }
  }

  return successResult(parsed.reply, suggestedPrompt);
};

/**
 * Call MiniMax M3 with the chat system prompt + conversation history
 * and return the parsed `{ reply, suggested_prompt }`. JSON-schema
 * enforced at the API level: `suggested_prompt` is always a string
 * (empty string "" means "no revision this turn" — `extractChatReply`
 * coerces empty to null).
 *
 * Why a plain string instead of `type: ["string", "null"]`: the
 * MiniMax M3 JSON-schema validator rejects union-typed properties
 * with error 400 "Mismatch type string with value array at index
 * 11233" (verified live 2026-06-23). Using a single string type with
 * the convention "empty == no revision" sidesteps the validator and
 * matches the LLM's native tendency to emit `""` over `null`.
 *
 * Retry policy: a transient bad generation (empty `reply`, truncated
 * output, missing field, wrong shape) is retried up to `MAX_RETRIES`
 * times before the fallback fires. Each retry is a fresh request —
 * there's no incremental prompt strengthening because the system
 * prompt is already explicit about the required shape. Retries are
 * spaced by a small delay so a flapping model has time to recover.
 * Network-level errors (timeout, 5xx, 429) are NOT retried here — the
 * caller surfaces them as 500/503 and the user retries manually.
 *
 * max_tokens rationale: 1500 was tight for revisions where the user
 * asks for a "complete rewrite" or "expand every section". Raised to
 * 2400 so the revised prompt (often 1200-1800 chars) plus the JSON
 * envelope always fits without truncation. Output truncation mid-JSON
 * was a known cause of "missing reply" before this fix.
 *
 * Mirrors the structure of `callMiniMaxSubjectAnalysis` but with the
 * chat system prompt and a different schema.
 */
const CHAT_MAX_RETRIES = 2;
const CHAT_RETRY_DELAY_MS = 400;

/**
 * Reinforcement message appended to the conversation when a
 * previous revision failed the anchor-preservation validator.
 * Names the specific missing terms so the model knows what to put
 * back. Built per-attempt from the validator's `missing` list (ADR
 * 0012 §"Retry behaviour").
 */
const buildPreservationReinforcement = (original, revised, userRequest) => {
  const report = validatePromptPreservation(original, revised, userRequest);
  const missingSample = report.nonTargetedMissing.slice(0, 20);
  return (
    "Your previous revision did not preserve enough of the original " +
    "context. The following terms from the current working prompt are " +
    "missing and must appear in your next `suggested_prompt`: " +
    missingSample.join(', ') +
    ". Re-issue `suggested_prompt` as the FULL revised prompt text " +
    "with every missing term restored. Do not change any element of " +
    "the original that the user did not explicitly ask to change."
  );
};

const callMiniMaxChat = async (systemPrompt, messages, options = {}) => {
  if (!minimaxConfigured) {
    throw new Error('MiniMax M3 API is not configured. Set MINIMAX_API_KEY in your .env file.');
  }

  const { currentPrompt, lastUserRequest } = options;
  const baseOpenaiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }))
  ];

  let openaiMessages = baseOpenaiMessages;
  let lastReason = null;
  for (let attempt = 0; attempt <= CHAT_MAX_RETRIES; attempt++) {
    const result = await callMiniMaxChatOnce(openaiMessages);
    if (result.ok) {
      // Anchor-preservation gate (ADR 0012). When the model produced a
      // non-empty `suggested_prompt`, run the deterministic validator
      // against the current working prompt. If it fails AND we still
      // have retry budget, append a reinforcement and re-call. If
      // we're out of retries, decline the revision.
      const suggested = result.value?.suggested_prompt;
      if (
        typeof currentPrompt === 'string' && currentPrompt.length > 0 &&
        typeof suggested === 'string' && suggested.length > 0
      ) {
        const report = validatePromptPreservation(currentPrompt, suggested, lastUserRequest || '');
        if (!report.preserved) {
          lastReason = 'preservation_failed';
          if (attempt < CHAT_MAX_RETRIES) {
            console.warn(
              `Chat preservation failed (nonTargeted=${report.nonTargetedRatio}, ` +
              `bigram=${report.bigramRatio}); retrying with reinforcement ` +
              `(attempt ${attempt + 1}/${CHAT_MAX_RETRIES})`
            );
            const reinforcement = buildPreservationReinforcement(
              currentPrompt, suggested, lastUserRequest || ''
            );
            openaiMessages = [
              ...baseOpenaiMessages,
              { role: 'user', content: reinforcement }
            ];
            await new Promise((r) => setTimeout(r, CHAT_RETRY_DELAY_MS * (attempt + 1)));
            continue;
          }
          // Out of retries — decline the revision. Surface a friendly
          // note so the user knows why no Apply button appears.
          console.warn(
            `Chat preservation failed after ${CHAT_MAX_RETRIES + 1} attempts; ` +
            `declining revision (nonTargeted=${report.nonTargetedRatio}, ` +
            `bigram=${report.bigramRatio})`
          );
          return {
            reply: (result.value.reply || '') + PRESERVATION_FAILED_REPLY_NOTE,
            suggested_prompt: null,
            fallback_reason: 'preservation_failed'
          };
        }
      }
      return result.value;
    }
    // Network / auth / API-level failure — don't retry, bubble up.
    if (result.fatal) {
      throw result.error;
    }
    // Parse-level fallback fired. Retry up to CHAT_MAX_RETRIES times.
    lastReason = result.value?.fallback_reason || 'unknown';
    if (attempt < CHAT_MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, CHAT_RETRY_DELAY_MS * (attempt + 1)));
    }
  }

  // Exhausted retries — log the fallback reason and return the
  // fallback so the user sees a real reply instead of a 500.
  console.warn(`Chat fallback after ${CHAT_MAX_RETRIES + 1} attempts (reason: ${lastReason})`);
  return extractChatReply('');
};

/**
 * Single-shot chat call. Returns one of:
 *   - { ok: true, value: { reply, suggested_prompt, fallback_reason } }
 *   - { ok: false, fatal: true, error: Error }      — network / auth / API failure
 *   - { ok: false, fatal: false, value: { fallback_reason, ... } }  — parse fallback
 *
 * Separated from the retry loop so the loop can call it cleanly and
 * the per-attempt logic is testable on its own.
 */
const callMiniMaxChatOnce = async (openaiMessages) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MINIMAX_API_KEY}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        max_tokens: 2400,
        temperature: 0.5,
        messages: openaiMessages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'chat_reply',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                reply: { type: 'string', minLength: 1 },
                suggested_prompt: { type: 'string', minLength: 0 }
              },
              required: ['reply', 'suggested_prompt']
            }
          }
        }
      })
    });

    clearTimeout(timeout);

    if (response.status === 429) {
      return { ok: false, fatal: true, error: new Error('Rate limit exceeded. Please try again in a moment.') };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, fatal: true, error: new Error('API authentication failed. Check your MINIMAX_API_KEY.') };
    }
    if (!response.ok) {
      const errorText = await response.text();
      return { ok: false, fatal: true, error: new Error(`MiniMax M3 chat error (${response.status}): ${errorText.substring(0, 200)}`) };
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      // Empty content from the API itself — treat as parse-level
      // fallback (retriable) rather than fatal so the retry loop can
      // try again.
      return { ok: false, fatal: false, value: { fallback_reason: 'empty_content' } };
    }

    const parsed = extractChatReply(content);
    if (parsed.fallback_reason) {
      return { ok: false, fatal: false, value: parsed };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      return { ok: false, fatal: true, error: new Error('Chat request timed out after 60 seconds.') };
    }
    return { ok: false, fatal: true, error };
  }
};

/**
 * Build the chat system prompt for a given session at a given turn.
 * Interpolation of the three context blocks (original prompt, current
 * prompt, analysis snapshot) happens here so the constant
 * `DEFAULT_CHAT_SYSTEM_PROMPT` stays free of per-session data.
 */
const buildChatSystemPrompt = (session) => {
  const original = typeof session.original_prompt === 'string' ? session.original_prompt : '';
  const current = typeof session.current_prompt === 'string' ? session.current_prompt : original;
  const analysis = session.analysis_snapshot && typeof session.analysis_snapshot === 'object'
    ? JSON.stringify(session.analysis_snapshot, null, 2)
    : '(no analysis snapshot was captured for this session)';

  return `${DEFAULT_CHAT_SYSTEM_PROMPT}

# SESSION CONTEXT (live values)

## Original generated prompt
"""
${original}
"""

## Current working prompt (anchors your revisions)
"""
${current}
"""

## Analysis snapshot (JSON Stage 1 returned)
\`\`\`json
${analysis}
\`\`\`

Treat the CURRENT WORKING PROMPT as the authoritative text the user is iterating on. When you propose a revision, base it on the CURRENT WORKING PROMPT — not the ORIGINAL — so subsequent revisions are additive.`;
};

// ─── Routes ───────────────────────────────────────────────────────

/**
 * `POST /api/chat/sessions` — create a new chat session anchored to a
 * freshly-generated prompt. Called by the client immediately after
 * Stage 2 returns. The session is stored on disk so the user can
 * resume the conversation across browser reloads.
 */
app.post('/api/chat/sessions', (req, res) => {
  try {
    const body = req.body || {};
    const presets = readPresets();
    const validationError = validateChatSessionCreate(body, { presets });
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    // Cap total sessions: refuse creation if the store is full. Avoids
    // unbounded disk growth from rapid generation runs.
    const existing = readChatSessions();
    if (existing.length >= MAX_CHAT_SESSIONS_TOTAL) {
      return res.status(409).json({
        success: false,
        error: `Chat session limit reached (${MAX_CHAT_SESSIONS_TOTAL}). Delete older sessions before creating new ones.`
      });
    }

    const now = new Date().toISOString();
    const session = {
      id: generateChatSessionId(),
      preset_id: body.preset_id,
      preset_name: typeof body.preset_name === 'string' ? body.preset_name : '',
      run_id: typeof body.run_id === 'string' ? body.run_id : null,
      title: buildChatTitle(body.prompt),
      original_prompt: body.prompt,
      current_prompt: body.prompt,
      analysis_snapshot: body.analysis_snapshot && typeof body.analysis_snapshot === 'object'
        ? body.analysis_snapshot
        : null,
      messages: [],
      created_at: now,
      updated_at: now
    };

    existing.push(session);
    writeChatSessions(existing);
    res.status(201).json({ success: true, data: session });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `GET /api/chat/sessions` — list all sessions. Returned in newest-first
 * order. The full messages array is included so the UI can render
 * straight from the response without an extra round-trip per session.
 */
app.get('/api/chat/sessions', (req, res) => {
  try {
    const sessions = readChatSessions().slice().sort((a, b) => {
      const at = new Date(a.updated_at || a.created_at || 0).getTime();
      const bt = new Date(b.updated_at || b.created_at || 0).getTime();
      return bt - at;
    });
    res.json({ success: true, data: sessions });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `GET /api/chat/sessions/:id` — fetch one session with its full
 * message history.
 */
app.get('/api/chat/sessions/:id', (req, res) => {
  try {
    if (typeof req.params.id !== 'string' || !req.params.id.startsWith(CHAT_SESSION_ID_PREFIX)) {
      return res.status(400).json({ success: false, error: `id must start with "${CHAT_SESSION_ID_PREFIX}".` });
    }
    const session = readChatSessions().find((s) => s.id === req.params.id);
    if (!session) {
      return res.status(404).json({ success: false, error: `Chat session "${req.params.id}" not found.` });
    }
    res.json({ success: true, data: session });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `POST /api/chat/sessions/:id/messages` — append a user message to a
 * session, call MiniMax M3 with the full history, append the assistant
 * reply, persist. Returns the updated session.
 */
app.post('/api/chat/sessions/:id/messages', async (req, res) => {
  try {
    if (typeof req.params.id !== 'string' || !req.params.id.startsWith(CHAT_SESSION_ID_PREFIX)) {
      return res.status(400).json({ success: false, error: `id must start with "${CHAT_SESSION_ID_PREFIX}".` });
    }
    const validationError = validateChatMessage(req.body);
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    if (!minimaxConfigured) {
      return res.status(503).json({ success: false, error: 'MiniMax M3 API key not configured.' });
    }

    const sessions = readChatSessions();
    const idx = sessions.findIndex((s) => s.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: `Chat session "${req.params.id}" not found.` });
    }
    const session = sessions[idx];

    if (session.messages.length >= MAX_CHAT_MESSAGES_PER_SESSION) {
      return res.status(409).json({
        success: false,
        error: `This chat session has reached its ${MAX_CHAT_MESSAGES_PER_SESSION}-message cap. Start a new session to continue.`
      });
    }

    const now = new Date().toISOString();
    const userMessage = {
      id: generateChatMessageId(),
      role: 'user',
      content: req.body.content,
      suggested_prompt: null,
      timestamp: now
    };
    session.messages.push(userMessage);

    // Call the model with the FULL message history (including the just-
    // appended user message). The system prompt is rebuilt per turn so
    // `current_prompt` reflects the latest applied revision. The current
    // prompt + last user request are also passed so the server-side
    // anchor-preservation validator (ADR 0012) can score the revision
    // and trigger a retry if it's a wholesale rewrite.
    const systemPrompt = buildChatSystemPrompt(session);
    const apiMessages = session.messages.map((m) => ({ role: m.role, content: m.content }));
    const lastUserRequest = userMessage.content;
    let parsedReply;
    try {
      parsedReply = await callMiniMaxChat(systemPrompt, apiMessages, {
        currentPrompt: session.current_prompt,
        lastUserRequest
      });
    } catch (err) {
      // Roll back the user message so the failed attempt doesn't leave
      // a "ghost" turn in the history.
      session.messages.pop();
      session.updated_at = now;
      writeChatSessions(sessions);
      return res.status(500).json({ success: false, error: sanitizeError(err.message) });
    }

    const assistantMessage = {
      id: generateChatMessageId(),
      role: 'assistant',
      content: parsedReply.reply,
      suggested_prompt: parsedReply.suggested_prompt,
      timestamp: new Date().toISOString()
    };
    session.messages.push(assistantMessage);
    session.updated_at = assistantMessage.timestamp;
    writeChatSessions(sessions);

    res.json({ success: true, data: session });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `POST /api/chat/sessions/:id/apply/:messageId` — promote an
 * assistant's `suggested_prompt` to the session's `current_prompt`.
 * 404 if the session or message is missing; 400 if the message isn't
 * an assistant message with a non-null suggested_prompt.
 */
app.post('/api/chat/sessions/:id/apply/:messageId', (req, res) => {
  try {
    if (typeof req.params.id !== 'string' || !req.params.id.startsWith(CHAT_SESSION_ID_PREFIX)) {
      return res.status(400).json({ success: false, error: `id must start with "${CHAT_SESSION_ID_PREFIX}".` });
    }
    if (typeof req.params.messageId !== 'string' || !req.params.messageId.startsWith(CHAT_MESSAGE_ID_PREFIX)) {
      return res.status(400).json({ success: false, error: `messageId must start with "${CHAT_MESSAGE_ID_PREFIX}".` });
    }

    const sessions = readChatSessions();
    const idx = sessions.findIndex((s) => s.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: `Chat session "${req.params.id}" not found.` });
    }
    const session = sessions[idx];
    const message = session.messages.find((m) => m.id === req.params.messageId);
    if (!message) {
      return res.status(404).json({ success: false, error: `Message "${req.params.messageId}" not found on session "${req.params.id}".` });
    }
    if (message.role !== 'assistant') {
      return res.status(400).json({ success: false, error: 'Only assistant messages can be applied.' });
    }
    if (typeof message.suggested_prompt !== 'string' || message.suggested_prompt.length === 0) {
      return res.status(400).json({ success: false, error: 'This message has no suggested_prompt to apply.' });
    }

    session.current_prompt = message.suggested_prompt;
    session.updated_at = new Date().toISOString();
    writeChatSessions(sessions);
    res.json({ success: true, data: session });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

/**
 * `DELETE /api/chat/sessions/:id` — hard-delete a session and its
 * full message history.
 */
app.delete('/api/chat/sessions/:id', (req, res) => {
  try {
    if (typeof req.params.id !== 'string' || !req.params.id.startsWith(CHAT_SESSION_ID_PREFIX)) {
      return res.status(400).json({ success: false, error: `id must start with "${CHAT_SESSION_ID_PREFIX}".` });
    }
    const sessions = readChatSessions();
    const idx = sessions.findIndex((s) => s.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: `Chat session "${req.params.id}" not found.` });
    }
    const [removed] = sessions.splice(idx, 1);
    writeChatSessions(sessions);
    res.json({ success: true, data: { id: removed.id, deleted: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Error handlers
// ─────────────────────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`
      });
    }
    return res.status(400).json({ success: false, error: sanitizeError(err.message) });
  }
  next(err);
});

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ success: false, error: sanitizeError(err.message) || 'Internal Server Error' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not Found' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    ensureDataFileExists();
    console.log(`Image-to-Prompt server running on http://localhost:${PORT}`);
    console.log(`MiniMax M3 configured: ${minimaxConfigured}`);
    if (!minimaxConfigured) console.log('  ⚠️  Set MINIMAX_API_KEY in .env to enable generation.');
  });
}

module.exports = {
  app,
  FIELD_PALETTE,
  VALID_FIELD_NAMES,
  FIELD_INPUT_MIN_LENGTH,
  FIELD_FORMAT_HINTS,
  DEFAULT_SUBJECT_PROMPT,
  MAX_SUBJECT_PROMPT_LENGTH,
  DEFAULT_CAMERA_ANGLE_PROMPT,
  MAX_PALETTE_NAME_LENGTH,
  MAX_PALETTE_COLORS,
  HEX_COLOR_REGEX,
  RUN_ID_REGEX,
  buildFieldFormatOverridePrompt,
  buildStage1RetrySuffix,
  buildStage1Schema,
  validateAnalysisLengths,
  readSubjectPrompt,
  writeSubjectPrompt,
  validateSubjectPrompt,
  callMiniMaxSubjectAnalysis,
  callMiniMaxCameraAngleAnalysis,
  generatePaletteId,
  generateRunId,
  readPalettes,
  writePalettes,
  validatePalette,
  validatePaletteName,
  validatePaletteColors,
  validatePaletteColorsFlexible,
  validatePaletteEdit,
  applyPaletteUpdate,
  parseColorInput,
  snapshotPalette,
  pushPaletteHistory,
  MAX_PALETTE_HISTORY,
  applyPaletteToAnalysis,
  readStage2Overrides,
  writeStage2Overrides,
  getStage2Override,
  setStage2Override,
  removeStage2Override,
  getEffectiveStage2Prompt,
  validateStage2Prompt,
  MAX_STAGE2_PROMPT_LENGTH,
  // Saved directives (ADR 0009)
  MAX_DIRECTIVE_NAME_LENGTH,
  MAX_DIRECTIVE_CONTENT_LENGTH,
  MAX_DIRECTIVE_TAGS,
  MAX_DIRECTIVE_TAG_LENGTH,
  DIRECTIVE_FILE_FORMAT,
  DIRECTIVE_FILE_VERSION,
  DIRECTIVE_TAG_REGEX,
  generateDirectiveId,
  readDirectives,
  writeDirectives,
  validateDirectiveBody,
  normalizeDirectiveTags,
  normalizeDirectiveTag,
  pushDirectiveHistory,
  snapshotDirective,
  applyDirectiveUpdate,
  // Chat sessions (ADR 0011)
  MAX_FINAL_PROMPT_LENGTH,
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_CHAT_MESSAGES_PER_SESSION,
  MAX_CHAT_SESSIONS_TOTAL,
  CHAT_SESSION_ID_PREFIX,
  CHAT_MESSAGE_ID_PREFIX,
  CHAT_TITLE_MAX_LENGTH,
  DEFAULT_CHAT_SYSTEM_PROMPT,
  generateChatSessionId,
  generateChatMessageId,
  readChatSessions,
  writeChatSessions,
  buildChatTitle,
  buildChatSystemPrompt,
  validateChatSessionCreate,
  validateChatMessage,
  extractChatReply,
  // Anchor-preservation (ADR 0012)
  PRESERVATION_MIN_TOKEN_LENGTH,
  PRESERVATION_SHORT_PROMPT_LENGTH,
  PRESERVATION_KEYWORD_THRESHOLD_LONG,
  PRESERVATION_KEYWORD_THRESHOLD_SHORT,
  PRESERVATION_BIGRAM_THRESHOLD_LONG,
  PRESERVATION_BIGRAM_THRESHOLD_SHORT,
  PRESERVATION_FAILED_REPLY_NOTE,
  PRESERVATION_STOP_WORDS,
  tokenizeForPreservation,
  extractPreservationBigrams,
  validatePromptPreservation
};