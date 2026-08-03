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

// ADR 0019 Issue #15 — aspect-ratio picker. The frontend lets the user
// pick the canvas proportion that Z-Image should target. Server-side
// validation accepts only the four values documented in
// `docs/Z-IMAGE-TURBO-AGENT-PROMPT-GUIDE.md` §6 Block 3 + §12.1:
//   - 'square'     → 1:1   (InvokeAI 1024×1024)
//   - 'portrait'   → 4:5   (InvokeAI 832×1280)
//   - 'landscape'  → 16:9  (InvokeAI 1280×832)
//   - 'panoramic'  → 21:9  (InvokeAI 1536×640)
const VALID_ASPECT_RATIOS = new Set(['square', 'portrait', 'landscape', 'panoramic']);

const ASPECT_RATIO_LABEL = {
  square:    'square 1:1',
  portrait:  'portrait 4:5',
  landscape: 'landscape 16:9',
  panoramic: 'panoramic 21:9'
};

/**
 * Build the aspect-ratio directive prefix that's prepended to the
 * Stage 2 user directives when the user has chosen a target canvas
 * proportion. Pure / no side effects. Returns the empty string when
 * no aspect ratio is supplied (default).
 */
const buildAspectRatioDirective = (aspectRatio) => {
  if (typeof aspectRatio !== 'string' || !VALID_ASPECT_RATIOS.has(aspectRatio)) {
    return '';
  }
  return `Aspect ratio: the intended canvas proportion is ${ASPECT_RATIO_LABEL[aspectRatio]}.\n`;
};
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
const CHAT_CONTEXT_CHAR_BUDGET = 20000;
const CHAT_HISTORY_CHAR_BUDGET = 6000;
const CHAT_HISTORY_MAX_MESSAGES = 12;

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

/**
 * Cap on how many dropped anchor terms we surface to the user in the
 * decline note and on the assistant message. Keeps the chat bubble
 * readable; the full list is still on disk via `declined_missing_terms`.
 */
const PRESERVATION_DECLINE_TERMS_DISPLAY_LIMIT = 8;

/**
 * Build the user-facing decline note for a preservation-failed
 * revision. The note names up to N dropped anchor terms so the user
 * understands WHICH constraints blocked the apply (e.g. "Terms dropped:
 * #ff0000, #ffff00, impasto, de Kooning"), and always closes with the
 * same hint as the static `PRESERVATION_FAILED_REPLY_NOTE`.
 *
 * Pure: input is a validator report, output is a string starting with
 * " (Note: ..." so callers can concatenate onto the model's reply.
 *
 * Issue #1 — the original constant note didn't tell the user anything
 * actionable. Surfacing the top-N dropped terms turns a silent fail
 * into a readable one.
 *
 * @param {{nonTargetedMissing?: string[]}} report — validator report
 * @returns {string}
 */
const buildPreservationDeclineNote = (report) => {
  const missing = Array.isArray(report && report.nonTargetedMissing)
    ? report.nonTargetedMissing
    : [];
  const display = missing.slice(0, PRESERVATION_DECLINE_TERMS_DISPLAY_LIMIT);
  const termsClause = display.length > 0
    ? ` Terms dropped: ${display.join(', ')}.`
    : '';
  return (
    " (Note: I'd proposed a revision but it would have dropped too much " +
    "of the original context." +
    termsClause +
    " Try a more specific request, e.g. \"only change the colors to " +
    "navy, gold, white; keep everything else exactly as is.\")"
  );
};

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

// ADR 0019 — Z-Image Turbo prompt-length contract. Per
// docs/Z-IMAGE-TURBO-AGENT-PROMPT-GUIDE.md §3 + §10: sweet spot
// 150-300 words, hard ceiling 750 words / 1024 tokens, minimum
// effective 80 words. Below 80 the output goes generic; above ~400
// diminishing returns kick in. Used by `measureStage2Length` + the
// length-check + retry orchestration in `callMiniMaxStage2`.
const STAGE2_SWEET_SPOT_MIN = 150;
const STAGE2_SWEET_SPOT_MAX = 300;
const STAGE2_HARD_MAX_WORDS = 750;
const STAGE2_MIN_WORDS = 80;

/**
 * Count words in a string. Splits on whitespace and filters out empty
 * tokens. Pure / no side effects. Used by the length-check at the
 * end of Stage 2 to decide whether to retry.
 */
const countStage2Words = (text) => {
  if (typeof text !== 'string' || text.trim().length === 0) return 0;
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
};

/**
 * Decide whether a Stage 2 output is inside the sweet spot (true)
 * or outside (false). Pure.
 */
const isWithinStage2SweetSpot = (text) => {
  const n = countStage2Words(text);
  return n >= STAGE2_SWEET_SPOT_MIN && n <= STAGE2_SWEET_SPOT_MAX;
};

/**
 * Classify a Stage 2 output by word count against the guide
 * contract. Returns one of:
 *   - 'sweet_spot'        — 150-300 words
 *   - 'too_short'         — < 150 words (LLM was terse)
 *   - 'too_long'          — > 300 words (still acceptable up to 750)
 *   - 'way_too_long'      — > 750 words (will be truncated at 1024 tokens)
 *
 * Pure.
 */
const classifyStage2Length = (text) => {
  const n = countStage2Words(text);
  if (n >= STAGE2_SWEET_SPOT_MIN && n <= STAGE2_SWEET_SPOT_MAX) return 'sweet_spot';
  if (n < STAGE2_SWEET_SPOT_MIN) return 'too_short';
  if (n > STAGE2_HARD_MAX_WORDS) return 'way_too_long';
  return 'too_long';
};

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
const PALETTE_RUNS_FILE = path.join(DATA_DIR, 'palette_runs.json');

const ensureDataFileExists = () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PRESETS_FILE)) fs.writeFileSync(PRESETS_FILE, '[]', 'utf8');
  if (!fs.existsSync(PALETTES_FILE)) fs.writeFileSync(PALETTES_FILE, '[]', 'utf8');
  if (!fs.existsSync(DIRECTIVES_FILE)) fs.writeFileSync(DIRECTIVES_FILE, '[]', 'utf8');
  if (!fs.existsSync(CHAT_SESSIONS_FILE)) fs.writeFileSync(CHAT_SESSIONS_FILE, '[]', 'utf8');
  if (!fs.existsSync(PALETTE_RUNS_FILE)) fs.writeFileSync(PALETTE_RUNS_FILE, '[]', 'utf8');
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
 * ADR 0015 — sentinel value used by presets whose Stage 2 system prompt
 * is the canonical Z-Image Turbo final-prompt contract (heavy impasto /
 * gestural painting with two-section structured output). When a preset's
 * `stage2_system_prompt` field equals this sentinel, the server
 * substitutes the full `DEFAULT_ZIMAGE_STAGE2_PROMPT` constant below.
 *
 * Why a sentinel: the full prompt is ~6000 characters, well over the
 * 5000-char `MAX_PROMPT_LENGTH` cap on preset JSON values. Putting the
 * full text in code keeps it the single source of truth while keeping
 * `data/presets.json` small and schema-valid.
 */
const ZIMAGE_STAGE2_SENTINEL = 'DEFAULT_ZIMAGE_STAGE2_PROMPT';

/**
 * ADR 0019 — canonical Stage 2 system prompt for the "Gestural alla
 * prima oil painting" preset family. Drives the final Z-Image Turbo
 * prompt format: a single flowing-prose paragraph (or 2-3 short
 * paragraphs) of 150-300 words, woven from six blocks (Subject,
 * Scene/Ground, Composition, Lighting, Style & Technique,
 * Constraints). Anchored on the pastel-palette / saturated-focal-
 * glow tradition (guide §1, §5.3, §8.1, §8.3, §17.1): oil on canvas,
 * alla prima, palette knife, thick pasto at the focal, thinly scraped
 * field, glow achieved through chroma contrast against the muted
 * surround — never through a depicted lamp, sun, or backlight.
 *
 * Supersedes the gestural-anchor two-section contract that ADR 0015
 * originally locked. Kept as a code constant (not a preset value) so
 * the on-disk `MAX_PROMPT_LENGTH` cap stays clean.
 */
const DEFAULT_ZIMAGE_STAGE2_PROMPT = `Your job: take a source image's extracted data and produce a precise, compositionally-accurate text prompt for the Z-Image Turbo image generator running locally in InvokeAI (Qwen3-4B encoder, 8 NFE, CFG=0, max_sequence_length = 1024 tokens ≈ 750 English words).

# TARGET MODEL FACTS

- CFG = 0, so negative-prompt language has no effect on the model. Never write "no text", "no watermark", "no logos", "no thin photographic detail", or any "no X" trailing constraint. Use positive anchors only.
- Qwen3-4B is a chat-style English encoder; write flowing prose, not SDXL-style tag lists, and never use weight syntax "(keyword:1.3)" or Midjourney parameters ("--ar", "--s", "--v", "--niji").
- Sweet-spot length: 150-300 words. Hard ceiling: 750 words / 1024 tokens. Minimum effective: 80 words.
- Z-Image Turbo defaults to photorealism; the Style & Technique block must repeatedly anchor "oil painting", "palette knife", "alla prima" — without it the model produces a photograph.
- Z-Image Turbo defaults to depicted light sources; the Lighting block must override with the §8.1 glow-by-contrast module below.

# OPTIONAL INPUTS

You may receive:
- analysis: structured fields (subject, scene, lighting, style, composition, etc.) — use them as authority on what is in the painting.
- directives: free-form user instructions; may be empty.
- color_budget: an ordered list of pigment names (e.g. "pale sage", "cadmium-coral", "weathered bone"). Pigment names only; never invent hex codes and never translate a pigment to a color not on the palette.

# OUTPUT CONTRACT

Write ONLY the prompt text. No preamble, no explanation, no labels, no headings, no markdown, no commentary, no "Here's the prompt:" lead-in, no section markers of any kind.

The output is one flowing prose paragraph (or 2-3 short paragraphs if complex), 150-300 words, woven from these SIX blocks in this order:

1. SUBJECT (40-80 words) — what the painting depicts. Figures: age, pose, expression, clothing, gesture, gaze, action. Landscapes: terrain, time of day, weather, season, scale. Still life: each object, material, arrangement, the surface it sits on. Abstract: dominant shapes, rhythm, central motif. Be specific — "a 34-year-old woman in a long charcoal wool coat, in profile, looking left", never "a woman".

2. SCENE / GROUND (15-40 words) — the contextual field around the subject. Background colour and treatment. Whether the ground is gestural, flat, atmospheric, or constructed. Relationship of subject to ground: floating, embedded, emerging, isolated.

3. COMPOSITION (20-40 words) — how the painting is framed. Shot type: full-figure, three-quarter, close-up, panoramic, square. Subject placement: rule of thirds, centred, asymmetric, off-axis. Foreground/background relationship. Negative space and breathing room. Include the intended canvas proportions: square 1:1, portrait 4:5, landscape 16:9, or panoramic 21:9. Default framing: "the painting fills the frame edge to edge, the painted surface itself the image, lit by even diffused gallery light that reveals the impasto surface".

4. LIGHTING (20-40 words) — the most important block. For this style the radiance MUST come from color contrast against the muted surround, never from a depicted lamp, sun, halo, backlight, or rim light. Concretely: name the muted surround (e.g. pale sage and bone-grey) and the saturated focal (e.g. saturated cadmium-coral). Required phrasing: "the radiant focal area is achieved through color contrast, not depicted illumination" and "no depicted light source; the glow emerges from chroma and temperature juxtaposition alone". Forbid these phrases anywhere in the prompt: "soft light from the left", "illuminated by", "backlit", "rim light", "glowing with hidden light", "halo of light", "rays of light".

5. STYLE & TECHNIQUE (60-120 words) — the longest block. Oil painting on canvas (or oil on raw linen when the weave should read). Palette-knife application. Pastel palette: chalky, low-chroma dominant tones (chalky pale greens, dusty putty, soft creams, weathered bone, muted lavender-grays, bone, dove grey) with ONE highly saturated accent — cadmium-coral, cobalt blue, vermillion, cadmium yellow, viridian, fuchsia-magenta — anchored to a specific element of the subject (the woman's cheek, the central pear, the horizon band, the scarf). The saturated accent is the complement or near-complement of the dominant muted field; that chroma pair is what makes the focal read as glowing. Thick pasto / impasto ridges in the focal area, paint standing a millimeter proud of the canvas, peaks catching the light. The surrounding field is rendered in thinly scraped, dragged, and smeared washes where the canvas (or linen) weave shows through. Chromatic vibration from juxtaposed warm and cool near-complementaries. Loose, painterly, gestural, economical mark-making, knife-edge marks visible, no brush hairs. Alla prima — wet-on-wet, single session, paint still pliable, soft wet-into-wet blending at the edges of strokes. Some passages show the ghost of the knife edge — a thin ridge of paint dragged across the surface. Visible canvas weave in the thinly painted passages.

6. CONSTRAINTS (15-30 words, inlined as positive anchors at the end of the prose). A real oil painting, not a photograph, not a 3D render. Natural paint sheen — matte in thick passages, slight gloss in scraped areas — no plastic gloss, no digital airbrush finish, no CGI look. Visible paint surface texture throughout. Even diffused gallery lighting revealing the impasto paint surface, no harsh shadows.

# WHEN THE USER SPECIFIES A FOCAL AREA

Anchor the saturated accent to a specific subject element in three places: Subject block, Lighting block, Style block. The focal element is the only place where paint is applied thick and chroma is high; everything else exists to make this core vibrate.

# WHEN THE PALETTE INCLUDES A PIGMENT NAME

Treat the pigment name as authority: write "the [region] is [pigment name]". Never invent hex codes, never translate a pigment to a color not on the palette, never quote "#rrggbb" inside the prompt body.

# ANTI-PATTERNS (rejected silently)

- Negative-prompt tail ("no text, no watermark, no logos" — ignored by CFG=0)
- "masterpiece, 8K, ultra detailed, best quality, award winning" tag-list suffix
- SDXL / FLUX-style tag lists ("1girl, solo, long hair, bokeh, …")
- Weight syntax "(keyword:1.3)"
- Midjourney parameters ("--ar 4:5", "--s 250", "--v 6", "--niji")
- Hex codes ("#cc3344") inside the prompt body
- Depicted-light vocabulary ("soft light from the left", "illuminated by", "backlit", "rim light", "glowing with hidden light", "halo of light", "rays of light")
- Any section markers ("== SECTION A ==", "== SECTION B =="), labels, bullets, lists, YAML, JSON, or markup in the output

Output only the prompt text.`;

/**
 * Resolve the effective Stage 2 system prompt for a preset: override if
 * one exists, otherwise the preset's built-in `stage2_system_prompt`.
 * If the BUILT-IN equals `ZIMAGE_STAGE2_SENTINEL` (and no user override
 * is in force), substitute the canonical `DEFAULT_ZIMAGE_STAGE2_PROMPT`
 * constant (ADR 0015).
 *
 * Why subs-on-builtIn-not-resolved: a user who pastes the literal
 * sentinel into the override modal opts out of the canonical contract —
 * they get the sentinel string back verbatim, not the substituted
 * constant. This keeps the opt-out cheap and obvious.
 *
 * Read fresh on every call (no cache) so edits via the modal take effect
 * immediately, mirroring ADR 0005's `readSubjectPrompt` pattern.
 */
const getEffectiveStage2Prompt = (preset) => {
  if (!preset || typeof preset !== 'object') return '';
  const override = getStage2Override(preset.id);
  if (override != null) return override;
  if (preset.stage2_system_prompt === ZIMAGE_STAGE2_SENTINEL) return DEFAULT_ZIMAGE_STAGE2_PROMPT;
  return preset.stage2_system_prompt || '';
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
    // ADR 0017 — per-color `weight` is no longer used. We strip it
    // silently on read so any pre-ADR-0017 palette on disk
    // (handcrafted or imported) loads cleanly without the field
    // echoing back to clients. Priority is the array index; we don't
    // synthesize anything here — readPalettes is just normalisation.
    // Per-accent placement (ADR 0016) is preserved + clamped.
    p.colors = p.colors.map((c) => {
      if (!c || typeof c !== 'object') return c;
      const out = { hex: c.hex, name: c.name };
      if (typeof c.accent === 'boolean') out.accent = c.accent;
      if (typeof c.placement === 'string') {
        out.placement = c.placement.length > MAX_COLOR_PLACEMENT_LENGTH
          ? c.placement.slice(0, MAX_COLOR_PLACEMENT_LENGTH)
          : c.placement;
      } else {
        out.placement = '';
      }
      return out;
    });
    if (typeof p.accent_max_mentions !== 'number' ||
        !Number.isInteger(p.accent_max_mentions) ||
        p.accent_max_mentions < MIN_ACCENT_MAX_MENTIONS ||
        p.accent_max_mentions > MAX_ACCENT_MAX_MENTIONS) {
      p.accent_max_mentions = DEFAULT_ACCENT_MAX_MENTIONS;
    }
    // ADR 0016 — synthesize `strength` for palettes missing the field.
    if (typeof p.strength !== 'string' ||
        !PALETTE_STRENGTH_LEVELS.includes(p.strength)) {
      p.strength = DEFAULT_PALETTE_STRENGTH;
    }
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

  // ADR 0014 — optional palette-level accent_max_mentions. Only
  // validated when present so callers that don't supply it keep working
  // (readPalettes will synthesize the default on the next read).
  if (body.accent_max_mentions !== undefined) {
    const amErr = validatePaletteAccentMaxMentions(body.accent_max_mentions);
    if (amErr) return `accent_max_mentions: ${amErr}`;
  }

  // ADR 0016 — optional palette-level `strength`. Same partial-body
  // pattern as accent_max_mentions: validated only when present.
  if (body.strength !== undefined) {
    const sErr = validatePaletteStrength(body.strength);
    if (sErr) return `strength: ${sErr}`;
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

// ─── ADR 0017 — order-based color priority ─────────────────────────────────
//
// Priority is derived from each color's index in `palette.colors[]`:
// index 0 = priority 1 (highest), index N-1 = priority N. There is no
// per-color `weight` field anymore. Each color still carries an
// optional boolean `accent` (default false). The palette as a whole
// carries an optional integer `accent_max_mentions` (1–5, default 2)
// that caps how often the LLM is told to mention an accent color.

const MIN_ACCENT_MAX_MENTIONS = 1;
const MAX_ACCENT_MAX_MENTIONS = 5;
const DEFAULT_ACCENT_MAX_MENTIONS = 2;

// ADR 0016 — palette strength (qualitative) + per-accent placement region.
const PALETTE_STRENGTH_LEVELS = ['subtle', 'moderate', 'strong', 'strict'];
const DEFAULT_PALETTE_STRENGTH = 'moderate';
const MAX_COLOR_PLACEMENT_LENGTH = 60;

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
    // ADR 0017 — per-color `weight` is no longer accepted on the
    // write path. Priority is derived from array index. Reject loudly
    // (400) so older clients built against ADR 0014 don't silently
    // send data the server will ignore.
    if (c.weight !== undefined) {
      return { colors: null, error: `colors[${i}].weight: weight is no longer accepted; reorder colors instead to change priority` };
    }
    const entry = { hex: parsed.hex, name: c.name };
    if (c.accent !== undefined) {
      if (typeof c.accent !== 'boolean') {
        return { colors: null, error: `colors[${i}].accent must be a boolean (got ${typeof c.accent})` };
      }
      entry.accent = c.accent;
    }
    // ADR 0016 — optional per-color `placement`. Only honored when the
    // caller supplies it; empty/missing → no placement directive.
    if (c.placement !== undefined) {
      if (typeof c.placement !== 'string') {
        return { colors: null, error: `colors[${i}].placement must be a string (got ${typeof c.placement})` };
      }
      if (c.placement.length > MAX_COLOR_PLACEMENT_LENGTH) {
        return { colors: null, error: `colors[${i}].placement must be ${MAX_COLOR_PLACEMENT_LENGTH} characters or fewer (got ${c.placement.length})` };
      }
      entry.placement = c.placement;
    }
    out.push(entry);
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
  // ADR 0014 — accent_max_mentions is also a valid partial-body field.
  // A user with a palette that only needs the cap adjusted shouldn't
  // be forced to resend name+colors.
  const hasAccentMax = body.accent_max_mentions !== undefined;
  // ADR 0016 — palette-level `strength` is also a valid partial-body
  // field (the user may want to flip from moderate → strict without
  // touching anything else).
  const hasStrength = body.strength !== undefined;
  if (!hasName && !hasColors && !hasAccentMax && !hasStrength) {
    return 'At least one of "name", "colors", "accent_max_mentions", or "strength" must be provided.';
  }
  if (hasName) {
    const nameError = validatePaletteName({ name: body.name }, { existingNames, excludeId });
    if (nameError) return nameError;
  }
  if (hasColors) {
    const r = validatePaletteColorsFlexible(body.colors);
    if (r.error) return r.error;
  }
  // ADR 0014 — optional palette-level accent_max_mentions. Same
  // partial-body pattern as name/colors: validated only when present.
  if (body.accent_max_mentions !== undefined) {
    const amErr = validatePaletteAccentMaxMentions(body.accent_max_mentions);
    if (amErr) return `accent_max_mentions: ${amErr}`;
  }
  // ADR 0016 — palette-level `strength`. Only validated when present.
  if (body.strength !== undefined) {
    const sErr = validatePaletteStrength(body.strength);
    if (sErr) return `strength: ${sErr}`;
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
  // ADR 0014 — palette-level accent_max_mentions. Only applied when
  // explicitly provided; readPalettes has already synthesized the
  // default on the in-memory palette, so an absent field means "leave
  // the synthesized default alone" (consistent with how missing name/
  // colors is handled).
  if (body.accent_max_mentions !== undefined) {
    const amErr = validatePaletteAccentMaxMentions(body.accent_max_mentions);
    if (amErr) return `accent_max_mentions: ${amErr}`;
    palette.accent_max_mentions = body.accent_max_mentions;
  }
  // ADR 0016 — palette-level `strength`. Only applied when explicitly
  // provided; absent means leave the synthesized default in place.
  if (body.strength !== undefined) {
    const sErr = validatePaletteStrength(body.strength);
    if (sErr) return `strength: ${sErr}`;
    palette.strength = body.strength;
  }
  return null;
};

/**
 * Build a fresh history entry from the current top-level state of a
 * palette. Captures `name`, `colors`, `accent_max_mentions`, and
 * `strength` so a rollback via POST /:id/restore/:version faithfully
 * restores the priority order, accent states, and accent placement
 * too. Caller has already mutated `palette` to its new state; we
 * capture the snapshot for history. The per-color `weight` field
 * from ADR 0014 is intentionally NOT captured — priority is the
 * array index.
 */
const snapshotPalette = (palette) => ({
  version: (Array.isArray(palette.history) ? palette.history.length : 0) + 1,
  name: palette.name,
  colors: palette.colors.map((c) => {
    const snap = { hex: c.hex, name: c.name };
    if (typeof c.accent === 'boolean') snap.accent = c.accent;
    // ADR 0016 — preserve per-color placement so a restore rolls back
    // accent placement regions too. Empty string is the "no placement"
    // sentinel; we copy it as-is.
    if (typeof c.placement === 'string') snap.placement = c.placement;
    return snap;
  }),
  accent_max_mentions: typeof palette.accent_max_mentions === 'number'
    ? palette.accent_max_mentions
    : DEFAULT_ACCENT_MAX_MENTIONS,
  // ADR 0016 — palette-level strength rolls back too.
  strength: typeof palette.strength === 'string' &&
    PALETTE_STRENGTH_LEVELS.includes(palette.strength)
    ? palette.strength
    : DEFAULT_PALETTE_STRENGTH,
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

// ─── ADR 0014 Phase 4 — palette run telemetry (data/palette_runs.json) ───
//
// Append-only log of Stage 2 runs that used a saved palette, capped at
// MAX_PALETTE_RUNS_PER_PALETTE entries per palette (oldest trimmed).
// Mirrors the data/presets.json / data/palettes.json pattern: atomic
// tmp+rename write, forgiving read on parse failure.

const MAX_PALETTE_RUNS_PER_PALETTE = 50;

/**
 * Read all palette runs from disk. Seeds `[]` on first read. Returns
 * an empty array on parse failure (with a console warning) so a
 * corrupt file doesn't break Stage 2 telemetry.
 *
 * @returns {Array<object>}
 */
const readPaletteRuns = () => {
  ensureDataFileExists();
  let raw;
  try {
    raw = fs.readFileSync(PALETTE_RUNS_FILE, 'utf8');
  } catch (e) {
    console.error('Failed to read palette runs file:', e.message);
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('Palette runs file is corrupt JSON; returning empty list:', e.message);
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.warn('Palette runs file is not an array; returning empty list');
    return [];
  }
  return parsed.filter((r) => {
    if (!r || typeof r !== 'object') return false;
    if (typeof r.palette_id !== 'string' || !r.palette_id.startsWith('palette_')) return false;
    if (typeof r.recorded_at !== 'string') return false;
    if (!r.metrics || typeof r.metrics !== 'object') return false;
    return true;
  });
};

/**
 * Atomic-ish write (tmp + rename) for the palette runs file.
 */
const writePaletteRuns = (runs) => {
  ensureDataFileExists();
  const tmpFile = `${PALETTE_RUNS_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(runs, null, 2), 'utf8');
  fs.renameSync(tmpFile, PALETTE_RUNS_FILE);
};

/**
 * Append a Stage 2 run entry to the telemetry log. Trims the oldest
 * entries for THIS palette (FIFO from the front) so a single palette
 * used heavily doesn't grow the file without bound. Per-palette cap is
 * MAX_PALETTE_RUNS_PER_PALETTE; other palettes' entries are untouched.
 *
 * @param {object} entry - { palette_id, run_id?, prompt, metrics, recorded_at }
 * @returns {boolean} true on success, false on validation failure
 */
const appendPaletteRun = (entry) => {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.palette_id !== 'string' || !entry.palette_id.startsWith('palette_')) return false;
  if (typeof entry.prompt !== 'string') return false;
  if (!entry.metrics || typeof entry.metrics !== 'object') return false;
  if (typeof entry.recorded_at !== 'string') entry.recorded_at = new Date().toISOString();

  const runs = readPaletteRuns();
  runs.push(entry);

  // Trim oldest entries for THIS palette only. We keep at most
  // MAX_PALETTE_RUNS_PER_PALETTE entries with this palette_id, removing
  // from the front (FIFO). Other palettes' entries are preserved.
  const samePalette = runs
    .map((r, idx) => ({ r, idx }))
    .filter((e) => e.r.palette_id === entry.palette_id);
  if (samePalette.length > MAX_PALETTE_RUNS_PER_PALETTE) {
    const toRemove = samePalette
      .slice(0, samePalette.length - MAX_PALETTE_RUNS_PER_PALETTE)
      .map((e) => e.idx)
      .sort((a, b) => b - a);
    for (const idx of toRemove) runs.splice(idx, 1);
  }

  writePaletteRuns(runs);
  return true;
};

/**
 * Get the most recent run entry for a given palette. Returns null when
 * no telemetry exists for the palette (caller → 404).
 *
 * @param {string} paletteId
 * @returns {object|null}
 */
const getLatestPaletteRun = (paletteId) => {
  if (typeof paletteId !== 'string') return null;
  const runs = readPaletteRuns();
  // Reverse-iterate to find the newest match.
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].palette_id === paletteId) return runs[i];
  }
  return null;
};

// ─── ADR 0017 — order-based color priority (data layer) ────────────────────
//
// The helpers below implement the pure data layer for ADR 0017:
//   - validatePaletteAccentMaxMentions: integer range check for the
//     palette-level accent cap. (The per-color `weight` validator from
//     ADR 0014 is gone — weight is no longer accepted on the write
//     path.)
//   - prioritiesFromOrder: single source of truth for priority
//     arithmetic. Returns { priorities } where priorities[i] = i + 1;
//     returns uniform { displayPct } = Math.round(100/N) each for the
//     preview bar (mirrored in the client by clientPrioritiesFromOrder).
//   - buildColorBudgetBlock: deterministic string appended to the Stage 2
//     user message. Each color line carries a "priority N" label and a
//     uniform 1/N percent share (the proportional control surface lives
//     in the existing `strength` level).
//   - measureColorDistribution: tokenizes the LLM output for the
//     dashboard. Read-only — never mutates the prompt.
//   - computeStrictPass: priority-derived expected_min (2 for position 0,
//     1 for positions ≥ 1; accents use the palette-level cap).
// The pure helpers are all exported so tests/run-all.js can cover the
// edge-case matrix without spinning up the server.

/**
 * Validate a palette-level `accent_max_mentions` value. Returns an
 * error string or null. Strict integer range check.
 */
const validatePaletteAccentMaxMentions = (n) => {
  if (typeof n !== 'number') return `must be a number (got ${typeof n})`;
  if (!Number.isFinite(n)) return `must be a finite number (got ${n})`;
  if (!Number.isInteger(n)) return `must be an integer (got ${n})`;
  if (n < MIN_ACCENT_MAX_MENTIONS) return `must be ${MIN_ACCENT_MAX_MENTIONS} or greater (got ${n})`;
  if (n > MAX_ACCENT_MAX_MENTIONS) return `must be ${MAX_ACCENT_MAX_MENTIONS} or less (got ${n})`;
  return null;
};

/**
 * Validate a palette-level `strength` value (ADR 0016). Returns an
 * error string or null. The four valid levels are listed in
 * PALETTE_STRENGTH_LEVELS; any other value (including non-strings,
 * null, undefined) is rejected with a 400.
 */
const validatePaletteStrength = (value) => {
  if (typeof value !== 'string') return `must be a string (got ${typeof value})`;
  if (!PALETTE_STRENGTH_LEVELS.includes(value)) {
    return `must be one of: ${PALETTE_STRENGTH_LEVELS.join(', ')} (got ${JSON.stringify(value)})`;
  }
  return null;
};

/**
 * Single source of truth for priority arithmetic (ADR 0017). Priority
 * is the array index: index 0 is priority 1 (highest), index N-1 is
 * priority N. The budget block uses uniform 1/N percent shares — the
 * proportional control surface lives in the `strength` level, not in
 * a per-color knob.
 *
 * Takes an array of palette colors (already through readPalettes
 * synthesis) and returns:
 *   - priorities[i]: 1-based priority (i + 1)
 *   - displayPct[i]: integer percent share (rounded); may not sum to
 *     100 due to rounding — UI labels this honestly
 *   - colors[i]: normalized color object (hex / name / accent /
 *     placement normalised to safe defaults)
 *
 * Edge cases (all return valid output — never throws):
 *   - Empty array → empty priorities + displayPct
 *   - Single color → priority 1, displayPct 100
 *   - Multi color → uniform 1/N shares
 *
 * The per-color `weight` field is intentionally NOT consulted — it
 * is stripped on read (see readPalettes) and forbidden on write
 * (see validatePaletteColorsFlexible). Any pre-ADR-0017 disk palette
 * that still carries weight on disk flows through here as if it had
 * no weight at all.
 */
const prioritiesFromOrder = (colors) => {
  if (!Array.isArray(colors) || colors.length === 0) {
    return { priorities: [], displayPct: [] };
  }
  const priorities = colors.map((_, i) => i + 1);
  // Uniform share: each color gets Math.round(100 / N). When N doesn't
  // divide 100 cleanly, the sum is N or 99 or 101; UI labels this
  // honestly ("Sum: N% (rounded)").
  const equalPct = Math.round(100 / colors.length);
  const displayPct = colors.map(() => equalPct);
  return { priorities, displayPct };
};

/**
 * Render the deterministic color-budget block that gets appended to
 * the Stage 2 user message. Returns a plain string (no trailing
 * newline — the caller decides how to join). Returns '' when:
 *   - palette is missing / has no colors
 *
 * The block format is documented in ADR 0017. Order follows
 * palette.colors order (matches the chip order in the UI and the
 * drag-and-drop order in the edit modal). Each color line carries a
 * "priority N" label and a uniform 1/N percent share. Accent colors
 * get the explicit "(ACCENT — mention at most N times total; place
 * where it adds focus)" clause. Per-accent placement text is
 * rendered as ", placement: <region>" only when accent + non-empty.
 *
 * ADR 0019 — preset-aware emission. When `opts.isZImage === true`
 * (the calling preset is one of the Z-Image sentinel presets), drop:
 *   - the per-line hex emission (Z-Image interprets hex strings as
 *     text glyphs; the guide specifies pigment names only)
 *   - the strength preamble + per-line [STRENGTH: <level>] tag
 *     (strength/placement are FLUX/SDXL semantics; Z-Image interprets
 *     prose naturally)
 * When isZImage is false (default), the original behaviour is
 * preserved unchanged for the FLUX/SDXL/photorealistic/Danbooru paths.
 */
const buildColorBudgetBlock = (palette, opts = {}) => {
  const isZImage = opts.isZImage === true;
  if (!palette || !Array.isArray(palette.colors) || palette.colors.length === 0) return '';

  const norm = prioritiesFromOrder(palette.colors);
  const accentMax = typeof palette.accent_max_mentions === 'number'
    ? palette.accent_max_mentions
    : DEFAULT_ACCENT_MAX_MENTIONS;
  const accentCount = palette.colors.filter((c) => c.accent === true).length;
  // ADR 0016 — strength preamble + per-line tag. Strength defaults to
  // 'moderate' (mirrors the synthesis path in readPalettes).
  // ADR 0019 — strength is FLUX/SDXL-only; skipped when isZImage.
  const strength = (typeof palette.strength === 'string' &&
    PALETTE_STRENGTH_LEVELS.includes(palette.strength))
    ? palette.strength
    : DEFAULT_PALETTE_STRENGTH;
  const strengthPreamble = !isZImage ? STRENGTH_PREAMBLES[strength] : null;

  const lines = [];
  if (strengthPreamble) lines.push(strengthPreamble);
  lines.push('Color usage budget (mention colors top-to-bottom in palette order; do not invent colors not on this list):');
  for (let i = 0; i < palette.colors.length; i++) {
    const c = palette.colors[i];
    const priority = norm.priorities[i];
    const pct = norm.displayPct[i];
    const accentTag = c.accent === true
      ? ` (ACCENT — mention at most ${accentMax} time${accentMax === 1 ? '' : 's'} total; place where it adds focus)`
      : '';
    // ADR 0016 — accent placement region binding. Emitted only when the
    // color is an accent AND has a non-empty placement string. Keeps
    // the budget block terse for palettes that don't use placement.
    // ADR 0019 — placement region is FLUX/SDXL-only; skipped when isZImage
    // because Z-Image interprets prose naturally and per-region binding
    // conflicts with the §6 Block 3 composition rules.
    const placementRaw = (c && typeof c.placement === 'string') ? c.placement.trim() : '';
    const placementTag = (!isZImage && c.accent === true && placementRaw.length > 0)
      ? `, placement: ${placementRaw}`
      : '';
    // ADR 0019 — Z-Image emitters get pigment name only; FLUX/SDXL emitters
    // keep the original `Name #hexcode` form.
    const label = isZImage ? `${c.name}` : `${c.name} ${c.hex}`;
    // ADR 0019 — strength tag is FLUX/SDXL-only.
    const strengthTag = isZImage ? '' : ` [STRENGTH: ${strength}]`;
    lines.push(`  - ${label}: priority ${priority} (~${pct}% share)${accentTag}${placementTag}${strengthTag}`);
  }
  const sum = norm.displayPct.reduce((s, p) => s + p, 0);
  const sumNote = sum === 100 ? 'Sum: 100%' : `Sum: ${sum}% (rounded)`;
  const capNote = accentCount > 0 ? ` (accent cap: ${accentMax} mention${accentMax === 1 ? '' : 's'})` : '';
  // ADR 0019 — sum/cap notes are FLUX/SDXL telemetry; Z-Image reads the
  // priority order itself, no need to spell out cumulative share.
  if (!isZImage) lines.push(`${sumNote}${capNote}`);
  return lines.join('\n');
};

// ADR 0016 / ADR 0017 — strength preamble lines for
// `buildColorBudgetBlock`. The opening one-liner primes the LLM with
// the qualitative contract before the per-color lines arrive.
// Subtle → moderate → strong → strict in order of increasing
// enforcement.
const STRENGTH_PREAMBLES = {
  subtle: 'STRENGTH: subtle — use these as gentle reference colors; feel free to introduce complementary tones that fit the subject.',
  moderate: 'STRENGTH: moderate — honor the palette closely; deviations allowed only for natural shadows and skin tones.',
  strong: 'STRENGTH: strong — every named color must appear at least once in the prompt; the highest-priority color (top of the palette list) should appear most often; no off-palette introductions.',
  strict: 'STRENGTH: strict — every named color must appear the priority-derived number of times (priority 1 expects ≥2, others ≥1; no substitutions). The output will be validated post-hoc.'
};

/**
 * Tokenize an LLM output and count occurrences of each color's name
 * and hex. Read-only — never mutates the prompt. Used by the Phase 4
 * dashboard to show observed distribution next to the target budget.
 *
 * Matching rules (case-insensitive, whole-word for names, substring for
 * hex with and without leading '#'):
 *   - Name: \b<name>\b in lowercase, ignoring hyphen/space boundaries
 *     (so "burnt-orange" matches "burnt orange" and vice versa)
 *   - Hex: both "#rrggbb" and "rrggbb" forms; we lowercase and compare
 *
 * Returns:
 *   - counts[i]: { hex, name, nameCount, hexCount, totalCount } — one
 *     entry per palette color, in palette order. Zero-count entries
 *     are returned for empty/missing prompts so the dashboard can
 *     iterate `palette.colors` and always find a matching measurement.
 *   - totalMentions: sum of totalCount across colors
 *   - totalWords: rough word count of the prompt (split on whitespace)
 *   - measuredAt: ISO timestamp
 *
 * Empty palette → empty counts array (no colors to measure).
 */
const measureColorDistribution = (prompt, palette) => {
  const measuredAt = new Date().toISOString();
  const totalWords = (typeof prompt === 'string' && prompt.trim().length > 0)
    ? prompt.trim().split(/\s+/).length
    : 0;
  if (!palette || !Array.isArray(palette.colors) || palette.colors.length === 0) {
    return { counts: [], totalMentions: 0, totalWords, measuredAt };
  }
  if (typeof prompt !== 'string' || prompt.length === 0) {
    // Return one zero-count entry per palette color so the dashboard
    // can iterate over palette.colors and always find a matching
    // measurement, regardless of whether the prompt was non-empty.
    const emptyCounts = palette.colors.map((c) => ({
      hex: c.hex, name: c.name, nameCount: 0, hexCount: 0, totalCount: 0
    }));
    return computeStrictPass(emptyCounts, palette, { counts: emptyCounts, totalMentions: 0, totalWords, measuredAt });
  }
  const lower = prompt.toLowerCase();

  const escapeForRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const counts = palette.colors.map((c) => {
    const nameLower = (c.name || '').toLowerCase().trim();
    const hexLower = (c.hex || '').toLowerCase();
    const hexBare = hexLower.startsWith('#') ? hexLower.slice(1) : hexLower;

    let nameCount = 0;
    if (nameLower.length > 0) {
      // Normalize whitespace and hyphens to a single \s+ in the matcher
      // so "burnt orange" still matches "burnt-orange" or "burnt  orange"
      const pattern = nameLower.split(/\s+/).map(escapeForRegex).join('[\\s-]+');
      const re = new RegExp(`\\b${pattern}\\b`, 'g');
      const m = lower.match(re);
      nameCount = m ? m.length : 0;
    }

    let hexCount = 0;
    if (/^#[0-9a-f]{6}$/.test(hexLower)) {
      const reHashed = new RegExp(escapeForRegex(hexLower), 'g');
      const m1 = lower.match(reHashed);
      const reBare = new RegExp(`(?<![0-9a-f])${escapeForRegex(hexBare)}(?![0-9a-f])`, 'g');
      const m2 = lower.match(reBare);
      // Subtract the bare matches that are also part of a # match to
      // avoid double-counting "#d97706 and d97706" when only one is
      // present. Simplest: count distinct occurrences of each form
      // independently, then subtract overlap (rare in practice).
      const hashHits = m1 ? m1.length : 0;
      const bareHits = m2 ? m2.length : 0;
      // Overlap = number of times the bare hex appears immediately
      // preceded by '#'
      const overlapRe = new RegExp(escapeForRegex('#' + hexBare), 'g');
      const overlapMatches = lower.match(overlapRe);
      const overlap = overlapMatches ? overlapMatches.length : 0;
      hexCount = hashHits + Math.max(0, bareHits - overlap);
    }
    return { hex: c.hex, name: c.name, nameCount, hexCount, totalCount: nameCount + hexCount };
  });

  const totalMentions = counts.reduce((s, c) => s + c.totalCount, 0);
  return computeStrictPass(counts, palette, { counts, totalMentions, totalWords, measuredAt });
};

/**
 * ADR 0017 — append `strict_pass` + `strict_violations` to a
 * distribution result when the palette's strength is "strict". For
 * any other strength (or absent), returns the result unchanged. Per-
 * color expectation (priority-driven, ADR 0017 §5):
 *   - accent colors: must appear at least 1 time AND not more than
 *     `palette.accent_max_mentions`.
 *   - non-accent colors at position 0 (priority 1, highest): must
 *     appear at least 2 times — the "dominant" bias.
 *   - non-accent colors at position ≥ 1: must appear at least 1 time.
 * The first 10 violations are reported; `strict_pass` is the boolean
 * sum.
 */
const computeStrictPass = (counts, palette, result) => {
  const strength = (palette && typeof palette.strength === 'string' &&
    PALETTE_STRENGTH_LEVELS.includes(palette.strength))
    ? palette.strength
    : DEFAULT_PALETTE_STRENGTH;
  if (strength !== 'strict') return result;
  if (!Array.isArray(palette.colors)) return result;

  const accentMax = typeof palette.accent_max_mentions === 'number'
    ? palette.accent_max_mentions
    : DEFAULT_ACCENT_MAX_MENTIONS;
  const violations = [];
  for (let i = 0; i < counts.length; i++) {
    const c = palette.colors[i];
    const m = counts[i];
    if (!c || !m) continue;
    const expected_min = c.accent === true ? 1 : (i === 0 ? 2 : 1);
    const expected_max = c.accent === true ? accentMax : Infinity;
    if (m.totalCount < expected_min) {
      violations.push({ name: c.name, hex: c.hex, expected_min, expected_max, measured: m.totalCount, reason: 'under_min' });
    } else if (m.totalCount > expected_max) {
      violations.push({ name: c.name, hex: c.hex, expected_min, expected_max, measured: m.totalCount, reason: 'over_max' });
    }
  }
  result.strict_pass = violations.length === 0;
  result.strict_violations = violations.slice(0, 10);
  return result;
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
// ADR 0017 — serve the SortableJS UMD bundle from node_modules so the
// edit-palette modal can use drag-and-drop reordering without copying
// the file under version control.
app.use('/sortable.min.js', express.static(path.join(__dirname, 'node_modules/sortablejs/Sortable.min.js')));
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

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1.A / 1.M / 1.L — actions, mood, lighting re-analysis (ADR 0018)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default system prompt shipped for the dedicated actions-only analysis
 * exposed by `POST /api/actions` (ADR 0018). The contract mirrors ADR 0004
 * (subject) and ADR 0008 (camera-angle): a focused, field-only call that
 * excludes adjacent fields (subject identity, camera angle, lighting,
 * mood, style, medium) so the LLM cannot slip into describing them, and
 * mandates five categorical coverage sections that match how a Stage 1
 * prompt budgets the textarea-field attention.
 *
 * Why a dedicated prompt: live testing showed the Stage 1 14-field schema
 * compresses `actions` into a single-clause description ("sitting
 * cross-legged, smiling") because the LLM balances it against twelve
 * other fields and satisfies the 30-word textarea floor with a flat
 * one-clause response. A focused call gives the actions contract the
 * full prompt-attention window for one question.
 *
 * Length floor: 60 chars schema-level (≈ 12 words at English average),
 * excludes single-clause responses that satisfy the generic 30-word floor
 * but add no real signal. Target: 50–120 words, 2-5 sentences.
 */
const DEFAULT_ACTIONS_PROMPT = `You are an expert visual analyst producing a focused description of ONLY the actions, events, and ongoing activities visible in the supplied image. You respond with a single JSON object whose only key is "actions" and whose value is a precise paragraph describing the kinematics, object interactions, and apparent moment-narrative.

# CRITICAL RULES

- The "actions" value MUST be grounded EXCLUSIVELY in what is optically present in the image.
- NEVER describe who the subject is (people, identity, personality, background) — that is the job of separate fields.
- NEVER describe what the subject looks like (clothing, hair, face, body) — those are separate fields.
- NEVER comment on lighting, color, mood, camera angle, composition, artistic style, creative medium, or aesthetic qualities — those are separate fields.
- NEVER use subjective aesthetic words such as: "beautiful", "striking", "vibrant", "dramatic", "elegant", "imposing", "stunning", "dynamic", "luminous", "ethereal", "serene", "majestic", "exquisite", "captivating", "mesmerizing", "bold", "sublime", "evocative". These are forbidden as judgments about the image.
- NEVER make meta-references to the medium — do not say "the painting", "the photograph", "the image", "the artwork", "the illustration", "the portrait", or any equivalent framing.
- If an action category is genuinely ambiguous from the image, say so explicitly ("no object interaction is visible", "no implied motion is determinable") rather than guessing.

# MANDATORY COVERAGE — five actions categories

The "actions" value MUST comprehensively address every one of the following five categories. If a category has no determinable content, state so explicitly ("no object interaction is visible", "no implied motion is determinable").

## 1. BODY KINEMATICS
- Posture: "seated upright", "reclining", "leaning forward", "lying prone", "crouched", "kneeling", "standing relaxed", "standing rigid".
- Limb positions: "arms folded across the chest", "hands resting in lap", "one hand raised", "legs crossed at the ankle", "weight shifted to the left foot".
- Head and face: "head tilted slightly down", "chin lifted", "facing the viewer", "gaze directed off-frame to the right", "lips parted as if mid-speech", "eyes closed", "jaw set".
- Facial expression (action, not emotion): "brow furrowed", "lips drawn back", "eyes narrowed", "nostrils flared".

## 2. OBJECT INTERACTIONS
- Hands holding, gripping, touching, or manipulating objects: "fingers curled around a coffee cup handle", "hand resting on a tabletop", "gripping a brush mid-stroke".
- Tools in use: "pen touching paper", "chisel pressed into wood", "needle pulled through fabric".
- Objects being moved: "a book being lifted from a shelf", "a curtain being drawn aside".

## 3. MULTI-FIGURE DYNAMICS
- Who is doing what relative to whom: "one figure leans toward another", "two figures stand back-to-back", "a child reaches up to take an adult's hand".
- Group activity: "the group walks in single file", "everyone looks in the same direction", "figures cluster around a central object".
- Conversation / interaction cue: "mouths open as if in mid-conversation", "one figure gestures toward another".

## 4. IMPLIED MOTION
- Static: "the subject is still, no implied motion is present in the frame".
- Mid-action: "mid-stride, weight transferred to the forward foot", "caught mid-swing", "caught mid-turn".
- Motion direction: "moving toward the camera", "moving away into the background", "moving laterally from left to right".
- Energy: "the body is tensed, energy stored for an imminent movement", "the posture is relaxed, no kinetic energy implied".

## 5. SCENE NARRATIVE
- Apparent context: "appears to be at work", "at rest", "in transit", "in performance", "in conversation", "in contemplation", "in celebration", "in distress".
- Temporal moment: "the moment just before a movement begins", "the peak of an action", "the rest between beats", "an ongoing sustained activity".

# LENGTH AND STRUCTURE

- Write the description as ONE cohesive paragraph (2-5 sentences).
- Minimum 60 characters schema-level floor; target 50-120 words.
- Lead with body kinematics, then object interactions / multi-figure dynamics, then implied motion, then scene narrative.
- Use precise kinematic vocabulary ("mid-stride", "caught mid-turn", "leaning forward with weight on the forearms").
- Respond ONLY with the JSON object — no preamble, no labels, no markdown, no surrounding commentary.`;

/**
 * Default system prompt shipped for the dedicated mood-only analysis
 * exposed by `POST /api/mood` (ADR 0018). The contract is the inverse of
 * Stage 1's: the LLM must focus EXCLUSIVELY on the affective register
 * and atmospheric tone of the image and MUST NOT describe the subject,
 * actions, lighting, color, camera angle, style, or medium.
 *
 * Length floor (60 chars schema-level, 30-80 words target) mirrors the
 * actions contract: enough to express a layered mood but excluding
 * single-adjective labels like "cheerful" that are the symptom being
 * fixed by the dedicated re-analysis.
 */
const DEFAULT_MOOD_PROMPT = `You are an expert emotional and atmospheric analyst producing a focused description of ONLY the mood of the supplied image. You respond with a single JSON object whose only key is "mood" and whose value is a precise paragraph describing the dominant emotional tone, secondary undercurrent, ambient atmosphere, pacing, and viewer-response cue.

# CRITICAL RULES

- The "mood" value MUST be grounded EXCLUSIVELY in what is optically present in the image — mood is read from body language, lighting, color temperature, scene energy, and viewer-facing cues, not asserted from context.
- NEVER describe who the subject is, what they look like, or what they are doing — those are separate fields.
- NEVER describe the camera angle, lighting setup, color palette, composition, artistic style, or creative medium — those are separate fields.
- NEVER use subjective aesthetic words such as: "beautiful", "striking", "vibrant", "dramatic", "elegant", "imposing", "stunning", "dynamic", "luminous", "ethereal", "serene", "majestic", "exquisite", "captivating", "mesmerizing", "bold", "sublime", "evocative". Mood is described in plain affective vocabulary, not aesthetic judgments.
- NEVER make meta-references to the medium — do not say "the painting", "the photograph", "the image", "the artwork", "the illustration", "the portrait", or any equivalent framing.
- If a mood category is genuinely ambiguous, say so explicitly ("the secondary undercurrent is not determinable") rather than guessing.

# MANDATORY COVERAGE — five mood categories

The "mood" value MUST comprehensively address every one of the following five categories. If a category has no determinable content, state so explicitly ("no secondary undercurrent is determinable").

## 1. PRIMARY EMOTIONAL TONE
- Uplifting registers: "joyful", "hopeful", "playful", "triumphant", "whimsical".
- Somber registers: "melancholic", "wistful", "somber", "lonely", "brooding".
- Tense registers: "dramatic", "anxious", "ominous", "urgent", "defiant".
- Quiet registers: "contemplative", "pensive", "introspective", "meditative", "intimate".

## 2. SECONDARY UNDERCURRENT
- Layering signal that complicates the primary tone: "bittersweet", "quietly defiant", "triumphant but exhausted", "playful but nervous", "tender but uneasy", "celebratory with a hint of loss".
- If no layering is present, say so: "the primary tone is unlayered".

## 3. ATMOSPHERE
- Ambient temperature: "warm", "cold", "temperate", "stifling", "crisp".
- Spatial feel: "intimate and enclosed", "vast and exposed", "compressed and claustrophobic", "open and airy".
- Air quality cue: "still air", "implied wind", "heavy atmosphere", "thin atmosphere".

## 4. PACING
- Kinetic registers: "energetic", "urgent", "restless", "driven".
- Static registers: "languid", "frozen", "suspended", "patient", "measured".
- If pacing is not determinable: "the pacing is not determinable from a single frame".

## 5. VIEWER-RESPONSE CUE
- The reaction the image invites: "invites contemplation", "demands attention", "disarms", "unsettles", "reassures", "provokes", "soothes", "challenges", "draws the viewer in".

# LENGTH AND STRUCTURE

- Write the description as ONE cohesive paragraph (2-4 sentences).
- Minimum 60 characters schema-level floor; target 30-80 words.
- Lead with the primary emotional tone, then secondary undercurrent, then atmosphere and pacing, then the viewer-response cue.
- Use plain affective vocabulary ("contemplative", "wistful", "intimate") — not aesthetic judgments.
- Respond ONLY with the JSON object — no preamble, no labels, no markdown, no surrounding commentary.`;

/**
 * Default system prompt shipped for the dedicated lighting-only analysis
 * exposed by `POST /api/lighting` (ADR 0018). The contract mirrors ADR
 * 0008 (camera-angle): a focused `text`-field-only call that excludes
 * adjacent fields (subject, actions, mood, color palette, style, medium)
 * and mandates five categorical coverage sections.
 *
 * Length floor (20 chars schema-level, 25-80 words target) mirrors ADR
 * 0008's camera-angle floor: enough for a one-line descriptor like "soft
 * golden hour light from camera-left" but excluding single-word labels
 * like "overcast" that are the symptom being fixed.
 */
const DEFAULT_LIGHTING_PROMPT = `You are an expert cinematographer and lighting designer analysing ONLY the lighting of the supplied image. You respond with a single JSON object whose only key is "lighting" and whose value is a precise phrase or single sentence describing the light source, direction, quality, color temperature, and shadow behavior.

# CRITICAL RULES

- The "lighting" value MUST be grounded EXCLUSIVELY in what is optically present in the image.
- NEVER describe the subject itself, what they are doing, or how they feel — those are separate fields.
- NEVER comment on artistic style, creative medium, aesthetic qualities, mood, emotional tone, or composition — those are separate fields.
- NEVER use subjective aesthetic words such as: "beautiful", "striking", "vibrant", "dramatic", "elegant", "imposing", "stunning", "dynamic", "luminous", "ethereal", "serene", "majestic", "exquisite", "captivating", "mesmerizing", "bold", "sublime", "evocative". These are forbidden as judgments about the image.
- NEVER make meta-references to the medium — do not say "the painting", "the photograph", "the image", "the artwork", "the illustration", "the portrait", or any equivalent framing.
- NEVER describe the color palette as a list — the colors field is the source of truth for palette; only reference color temperature of the light itself (warm / cool / neutral).
- If a lighting category is genuinely ambiguous from the image, say so explicitly ("the light direction is not determinable from this frame") rather than guessing.

# MANDATORY COVERAGE — five lighting categories

The "lighting" value MUST comprehensively address every one of the following five categories. If a category has no determinable content, state so explicitly ("no specular highlights are determinable", "the light source is not determinable").

## 1. LIGHT SOURCE / TYPE
- Natural: "direct sunlight", "diffuse skylight", "overcast daylight", "dappled sunlight through foliage", "moonlight", "twilight ambient".
- Artificial: "tungsten", "fluorescent", "LED", "neon", "studio strobe", "continuous studio light".
- Stylized: "candlelight", "firelight", "oil lamp", "lantern", "flashlight beam", "screen glow", "chiaroscuro", "low-key", "high-key".
- If the source is not directly visible but its effect is: "the light source is not visible, but the effect is consistent with a north-facing window".

## 2. DIRECTION
- Front, side, back, top, under, ambient/diffuse, multi-source.
- Specific phrasing: "key light from camera-left at roughly 45 degrees", "rim light from behind and above", "overhead top-down light", "underlit from below", "broad frontal wash".

## 3. QUALITY
- Hard vs soft: "hard light with crisp shadow edges", "soft diffused light with no defined shadows", "buttery soft wraparound".
- Contrast: "high contrast with deep shadows", "low-contrast flat light", "moderate contrast with mid-tone separation".
- Specular highlights: "specular highlights visible on skin and metallic surfaces", "no specular highlights, all surfaces matte".

## 4. COLOR TEMPERATURE
- Warm: "warm tungsten at roughly 3200K", "golden hour at roughly 3000K", "amber candlelight", "firelight orange".
- Cool: "cool overcast at roughly 6500K", "blue hour at roughly 8000K", "moonlight blue".
- Neutral: "neutral daylight at roughly 5500K", "balanced white-balanced light".
- Mixed: "mixed warm key and cool fill", "competing color temperatures from multiple sources".

## 5. SHADOW BEHAVIOR
- Present / absent: "no visible shadows, light is fully diffuse", "shadows present throughout the frame".
- Quality: "hard-edged shadows", "soft-edged shadows", "penumbra-rich shadows".
- Geometry: "long shadows raking across the floor", "short shadows directly beneath the subject", "multiple shadow directions indicating multi-source light", "single dominant shadow direction".

# LENGTH AND STRUCTURE

- Write the description as ONE concise phrase or single sentence (or 2-3 sentences for complex multi-source setups).
- Minimum 20 characters schema-level floor; target 25-80 words.
- Lead with the source / type, then direction and quality, then color temperature, then shadow behavior.
- Use precise lighting vocabulary ("key light", "rim light", "fill", "specular highlight", "diffused", "directional", "ambient").
- Respond ONLY with the JSON object — no preamble, no labels, no markdown, no surrounding commentary.`;

/**
 * Stage 1.T — dedicated texture-only re-analysis.
 * Runs ONLY for `POST /api/texture` (Slice 1 — App Build methodology,
 * pattern-mirrors ADR 0018). Independent of the active preset.
 * Single-attempt, schema builder inline, 60-second timeout, 60-char
 * schema floor (textarea — same as actions/mood).
 *
 * Texture is image-specific (no canonical chip taxonomy); the
 * `texture` field gets the AI button only, no curated chips (mirror
 * ADR 0018 §1 reasoning for `actions`).
 */
const DEFAULT_TEXTURE_PROMPT = `You are an expert surface-and-material analyst producing a focused description of ONLY the texture of the supplied image. You respond with a single JSON object whose only key is "texture" and whose value is a precise paragraph describing the surface quality, mark-making, material identification, pigment interaction, and tactile cues visible in the frame.

# CRITICAL RULES

- The "texture" value MUST be grounded EXCLUSIVELY in what is optically present in the image.
- NEVER describe the subject itself, what they are doing, how they feel, their mood, or where they are — those are separate fields.
- NEVER comment on overall artistic style, color palette, lighting, composition, mood, or aesthetic qualities — those are separate fields.
- NEVER use subjective aesthetic words such as: "beautiful", "striking", "vibrant", "dramatic", "elegant", "majestic", "imposing", "ethereal", "luminous", "bold". These are forbidden as judgments about the image.
- NEVER make meta-references to the medium — do not say "the painting", "the photograph", "the image", "the artwork", "the illustration", or any equivalent framing.
- NEVER describe color as a list — the colors field is the source of truth for palette; texture may reference whether the surface is warm-toned, cool-toned, or neutral only insofar as it bears on the material.
- If a texture category is genuinely ambiguous from the image, say so explicitly ("the pigment thickness is not determinable from this frame") rather than guessing.

# MANDATORY COVERAGE — five texture categories

The "texture" value MUST comprehensively address every one of the following five categories. If a category has no determinable content, state so explicitly ("no mark-making is determinable", "the material cannot be identified").

## 1. SURFACE QUALITY
- Smooth, rough, pitted, polished, matte, glossy, scratched, worn, weathered.
- Specific phrasing: "smooth lacquered finish", "rough pitted concrete", "polished marble with reflective highlights", "matte chalky surface absorbing light".

## 2. MARK-MAKING / TOOL TRACES
- Visible brushstrokes (bristle direction, length, density), palette-knife slabs (loaded edges, sharp ridges, flat sweeps, chunky peaks), pen hatching, pencil grain, photographic grain, digital artifacts (banding, noise, pixelation), printmaking textures (engraving lines, screen dots, lithographic grain).

## 3. MATERIAL IDENTIFICATION
- Paint (oil / acrylic / watercolor / gouache / tempera / encaustic), drawing media (graphite / charcoal / ink / conté), paper (cold-press / hot-press / rough / smooth / handmade / machine-made), canvas (cotton / linen / primed / unprimed), photographic emulsion (film grain / digital sensor noise / daguerreotype plate), 3D render (raytraced / rasterised / NPR), mixed media.
- If mixed: name each layer and how they interact.

## 4. PIGMENT INTERACTION
- Impasto ridges, glazing (transparent layering), scumbling (broken opaque layer over dry underlayer), wet-in-wet bleeds, drybrush, washes, sgraffito (scratching through to lower layer), scraping, palette-knife texturing.

## 5. TACTILE CUES
- What the surface feels like to touch: chunky, slick, fibrous, velvety, sticky, gritty, papery, glassy, waxy, powdery.
- Specific phrasing: "the surface reads as chunky and ridged under the eye", "the skin of the paint feels slick and enameled", "the paper grain is fibrous and absorbs the ink visibly".

# LENGTH AND STRUCTURE

- Write the description as ONE cohesive paragraph (2-4 sentences).
- Minimum 60 characters schema-level floor (textarea contract; target 50-120 words).
- Lead with the surface quality, then mark-making, then material identification, then pigment interaction, then tactile cues.
- Use precise surface vocabulary ("impasto", "glaze", "scumble", "drybrush", "hatching", "stippling", "sgraffito", "grain", "tooth").
- Respond ONLY with the JSON object — no preamble, no labels, no markdown, no surrounding commentary.`;

/**
 * Slice 2.2 — ADR 0021 — Anima prompt contract.
 *
 * The Anima contract is the prompt-generation sibling to the Z-Image
 * pastel-focal-glow contract. Where the Z-Image contract emits a single
 * flowing-paragraph prose prompt, the Anima contract emits TWO comma-
 * separated tag-style prompts — a positive prompt and a negative prompt
 * — tuned for an Anima checkpoint (Base / Aesthetic / Turbo).
 *
 * Contract source of truth: docs/ANIMA-PROMPTING-MANUAL.md §5, §7, §14.
 *
 * The contract is parametrised by the "variant" argument:
 *   - "base"       — full prefix, score_7, score_1/2/3 in negative
 *   - "aesthetic"  — full prefix without score_7, drop score_1/2/3 in negative
 *   - "turbo"      — same as "base" (prompt is the same; CFG/steps differ)
 *
 * The system prompt is the same for all variants; the LLM is told how
 * to handle each variant inside the prompt itself. This keeps the
 * shape all three variants stable.
 *
 * TWO output fields (positive + negative) — different from the per-field
 * pattern (which has a single output). The schema enforces:
 *   - positive: minLength 60 (the manual's full-character example is ~50 tags)
 *   - negative: minLength 20 (the recommended negative is ~10 items)
 */
const DEFAULT_ANIMA_PROMPT = `You are an expert prompt engineer for the Anima text-to-image model (CircleStone Labs, 2B parameters, Qwen-3 text encoder, anime / illustration specialist). You transform visual analysis into the Anima tag-style prompt contract.

You respond with a SINGLE JSON object with exactly two keys: "positive" and "negative". Both values are comma-separated tag lists (no prose paragraphs in either side).

# POSITIVE PROMPT RULES

- Use LOWERCASE tags. Use COMMAS to separate tags. Use SPACES (not underscores) inside tags. The ONLY tags that keep underscores are "score_1" through "score_9" and "1girl" / "1boy" / "1other" and "2girls" / "3girls" counters.
- Tag order: [quality/meta/year/safety] [count] [character] [series] [artist] [general tags]. Within each section, tag order is arbitrary. The section order is NOT arbitrary.
- The "artist" section tags MUST be prefixed with "@" (e.g. "@big chungus"). The effect is weak without the @.
- Quality tags: lead with "masterpiece, best quality, score_7, safe, " for Base / Turbo. For Aesthetic, drop "score_7" but keep "masterpiece, best quality, safe, ".
- Time-period tags: either "year 2025" / "year 2024" or period (newest / recent / mid / early / old).
- Meta tags: "highres", "absurdres", "anime screenshot", etc.
- Safety tags: "safe" / "sensitive" / "nsfw" / "explicit" — exactly one.
- Multi-character: each character gets a cluster of name + hair + eyes + outfit. Name the character, then describe their appearance.
- If the image is NON-ANIME (e.g. an oil painting, a digital render, a photograph), start the positive prompt with a dataset tag on line 1: "ye-pop" (LAION-POP non-anime artistic) or "deviantart" (DeviantArt non-anime artistic). Line 2 is the alt-text (ye-pop) or title (deviantart). Line 3+ is the caption.
- For non-anime: do NOT use anime-specific tags (1girl, score_*, masterpiece). Use generic style vocabulary (oil painting, digital render, abstract, etc.) and the dataset tag.

# NEGATIVE PROMPT RULES

- Lowercase, comma-separated, same as positive.
- Base / Turbo: "worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration"
- Aesthetic: drop "score_1, score_2, score_3" — keep "worst quality, low quality, artist name, blurry, jpeg artifacts, chromatic aberration"
- The "artist name" entry suppresses bleed from other artists when "@artist" is in the positive.

# VARIANT RULES

- VARIANT = "base": full prefix "masterpiece, best quality, score_7, safe, " then content. Negative uses score_1/2/3.
- VARIANT = "aesthetic": drop "score_7" from positive; drop "score_1, score_2, score_3" from negative. The model is fine-tuned on high-quality images so the score tags push it into slop.
- VARIANT = "turbo": same as "base" — the prompt is identical; what differs is the sampling config (CFG 1, 8-12 steps). The score tags still help under the turbo CFG.

# FORBIDDEN VOCABULARY (across both positive and negative)

NEVER use: "beautiful", "striking", "vibrant", "dramatic", "elegant", "majestic", "imposing", "ethereal", "luminous", "bold".
NEVER make meta-references to the medium — do not say "the painting", "the photograph", "the image", "the artwork", "the illustration".
NEVER ask for photorealism — Anima is anime / illustration / art focused.
NEVER ask for multi-word text rendering — single words sometimes work, short phrases rarely, long sentences won't render.

# LENGTH AND STRUCTURE

- "positive": minimum 60 characters (typical: 50-200 tags).
- "negative": minimum 20 characters (typical: 8-15 items).
- Both sides are tag lists. NEVER write prose paragraphs.
- Respond ONLY with the JSON object — no preamble, no labels, no markdown, no surrounding commentary.

# STYLE (when the subject is non-anime)

- Use natural-language style vocabulary for non-anime subjects ("oil painting", "digital render", "abstract", "impressionist", "muted palette", "soft brushwork", "gallery lighting").
- The dataset tag is on line 1, then the alt-text / title on line 2, then the caption on line 3+.

# STYLE (when the subject is anime)

- Use Danbooru-style tags. Default to single-character scenes unless the image clearly shows multiple.
- Use the recommended positive prefix on all variants (with the variant-specific score_7 / score_1/2/3 differences).
- The character can be a known Danbooru IP (e.g. "oomuro sakurako", "yuru yuri") or an original character described in tags.
- The artist tag, if used, must be "@" prefixed.`;

/**
 * Slice 2.2 — callMiniMaxAnimaAnalysis.
 * Returns { positive, negative } (the Anima contract, two-output shape).
 *
 * Mirrors the per-field pattern (callMiniMaxTextureAnalysis et al):
 *  - single-attempt LLM call
 *  - 60-second AbortController timeout
 *  - schema builder inline, length floors enforced
 *  - 429 / 401-403 / 5xx / empty / invalid-JSON / missing-field / AbortError paths
 *  - multer file cleanup handled by the route wrapper
 *
 * The variant argument is one of "base" / "aesthetic" / "turbo". It
 * controls how the LLM shapes the prompt — see DEFAULT_ANIMA_PROMPT
 * "VARIANT RULES" section.
 */
const callMiniMaxAnimaAnalysis = async (imageDataUri, variant) => {
  if (!minimaxConfigured) {
    throw new Error('MiniMax M3 API is not configured. Set MINIMAX_API_KEY in your .env file.');
  }

  const allowedVariants = ['base', 'aesthetic', 'turbo'];
  const variantPrompt = allowedVariants.includes(variant) ? variant : 'base';

  const systemPrompt = DEFAULT_ANIMA_PROMPT;
  const userPrompt = `Analyse the image and respond with the JSON object containing only "positive" and "negative" — both lowercase comma-separated tag lists for the Anima model. VARIANT = ${variantPrompt}.`;

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
        max_tokens: 1000,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image_url', image_url: { url: imageDataUri } }
            ]
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'anima_prompt_contract',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                positive: { type: 'string', minLength: 60 },
                negative: { type: 'string', minLength: 20 }
              },
              required: ['positive', 'negative']
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
      throw new Error(`MiniMax M3 anima analysis error (${response.status}): ${errorText.substring(0, 200)}`);
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
          catch (e3) { throw new Error(`Anima analysis response was not valid JSON: ${e3.message}`); }
        } else {
          throw new Error('Anima analysis response contained no JSON object.');
        }
      }
    }

    const schemaName = 'anima_prompt_contract';
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed[schemaName] && typeof parsed[schemaName] === 'object') {
      parsed = parsed[schemaName];
    }

    if (typeof parsed?.positive !== 'string' || parsed.positive.length < 60) {
      throw new Error('Anima analysis response did not contain a "positive" string of at least 60 characters.');
    }
    if (typeof parsed?.negative !== 'string' || parsed.negative.length < 20) {
      throw new Error('Anima analysis response did not contain a "negative" string of at least 20 characters.');
    }

    return { positive: parsed.positive, negative: parsed.negative };
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') throw new Error('Anima analysis request timed out after 60 seconds.');
    throw error;
  }
};

/**
 * Stage 1.A — dedicated actions-only re-analysis.
 * Runs ONLY for `POST /api/actions` (ADR 0018). Independent of the active
 * preset. Mirrors `callMiniMaxCameraAngleAnalysis` (ADR 0008): single-
 * attempt, schema builder inline, 60-second timeout, file-path cleanup
 * on both success and error paths (handled by the route wrapper).
 */
const callMiniMaxActionsAnalysis = async (imageDataUri) => {
  if (!minimaxConfigured) {
    throw new Error('MiniMax M3 API is not configured. Set MINIMAX_API_KEY in your .env file.');
  }

  const systemPrompt = DEFAULT_ACTIONS_PROMPT;

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
              { type: 'text', text: 'Analyse the image and respond with the JSON object containing only the "actions" field — a precise paragraph describing the kinematics, object interactions, multi-figure dynamics, implied motion, and scene narrative visible in the frame.' },
              { type: 'image_url', image_url: { url: imageDataUri } }
            ]
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'actions_factual_analysis',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                actions: { type: 'string', minLength: 60 }
              },
              required: ['actions']
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
      throw new Error(`MiniMax M3 actions analysis error (${response.status}): ${errorText.substring(0, 200)}`);
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
          catch (e3) { throw new Error(`Actions analysis response was not valid JSON: ${e3.message}`); }
        } else {
          throw new Error('Actions analysis response contained no JSON object.');
        }
      }
    }

    const schemaName = 'actions_factual_analysis';
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed[schemaName] && typeof parsed[schemaName] === 'object') {
      parsed = parsed[schemaName];
    }

    if (typeof parsed?.actions !== 'string' || parsed.actions.length === 0) {
      throw new Error('Actions analysis response did not contain an "actions" string.');
    }

    return parsed.actions;
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') throw new Error('Actions analysis request timed out after 60 seconds.');
    throw error;
  }
};

/**
 * Stage 1.M — dedicated mood-only re-analysis.
 * Runs ONLY for `POST /api/mood` (ADR 0018). Independent of the active
 * preset. Mirrors `callMiniMaxActionsAnalysis` — single-attempt, schema
 * builder inline, 60-second timeout.
 */
const callMiniMaxMoodAnalysis = async (imageDataUri) => {
  if (!minimaxConfigured) {
    throw new Error('MiniMax M3 API is not configured. Set MINIMAX_API_KEY in your .env file.');
  }

  const systemPrompt = DEFAULT_MOOD_PROMPT;

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
              { type: 'text', text: 'Analyse the image and respond with the JSON object containing only the "mood" field — a precise paragraph describing the primary emotional tone, secondary undercurrent, atmosphere, pacing, and viewer-response cue of the frame.' },
              { type: 'image_url', image_url: { url: imageDataUri } }
            ]
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'mood_factual_analysis',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                mood: { type: 'string', minLength: 60 }
              },
              required: ['mood']
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
      throw new Error(`MiniMax M3 mood analysis error (${response.status}): ${errorText.substring(0, 200)}`);
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
          catch (e3) { throw new Error(`Mood analysis response was not valid JSON: ${e3.message}`); }
        } else {
          throw new Error('Mood analysis response contained no JSON object.');
        }
      }
    }

    const schemaName = 'mood_factual_analysis';
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed[schemaName] && typeof parsed[schemaName] === 'object') {
      parsed = parsed[schemaName];
    }

    if (typeof parsed?.mood !== 'string' || parsed.mood.length === 0) {
      throw new Error('Mood analysis response did not contain a "mood" string.');
    }

    return parsed.mood;
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') throw new Error('Mood analysis request timed out after 60 seconds.');
    throw error;
  }
};

/**
 * Stage 1.L — dedicated lighting-only re-analysis.
 * Runs ONLY for `POST /api/lighting` (ADR 0018). Independent of the
 * active preset. Mirrors `callMiniMaxCameraAngleAnalysis` (ADR 0008):
 * single-attempt, schema builder inline, 60-second timeout, 20-char
 * schema floor (above the generic 15-char `text` floor).
 */
const callMiniMaxLightingAnalysis = async (imageDataUri) => {
  if (!minimaxConfigured) {
    throw new Error('MiniMax M3 API is not configured. Set MINIMAX_API_KEY in your .env file.');
  }

  const systemPrompt = DEFAULT_LIGHTING_PROMPT;

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
              { type: 'text', text: 'Analyse the image and respond with the JSON object containing only the "lighting" field — a precise phrase or single sentence describing the light source, direction, quality, color temperature, and shadow behavior of the frame.' },
              { type: 'image_url', image_url: { url: imageDataUri } }
            ]
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'lighting_factual_analysis',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                lighting: { type: 'string', minLength: 20 }
              },
              required: ['lighting']
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
      throw new Error(`MiniMax M3 lighting analysis error (${response.status}): ${errorText.substring(0, 200)}`);
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
          catch (e3) { throw new Error(`Lighting analysis response was not valid JSON: ${e3.message}`); }
        } else {
          throw new Error('Lighting analysis response contained no JSON object.');
        }
      }
    }

    const schemaName = 'lighting_factual_analysis';
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed[schemaName] && typeof parsed[schemaName] === 'object') {
      parsed = parsed[schemaName];
    }

    if (typeof parsed?.lighting !== 'string' || parsed.lighting.length === 0) {
      throw new Error('Lighting analysis response did not contain a "lighting" string.');
    }

    return parsed.lighting;
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') throw new Error('Lighting analysis request timed out after 60 seconds.');
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
/**
 * Stage 1.T — dedicated texture-only re-analysis.
 * Runs ONLY for `POST /api/texture` (Slice 1 — App Build methodology,
 * pattern-mirrors ADR 0018). Independent of the active preset.
 * Single-attempt, schema builder inline, 60-second timeout, 60-char
 * schema floor (textarea — same as actions/mood).
 *
 * Texture is image-specific (no canonical chip taxonomy); the
 * `texture` field gets the AI button only, no curated chips (mirror
 * ADR 0018 §1 reasoning for `actions`).
 */
const callMiniMaxTextureAnalysis = async (imageDataUri) => {
  if (!minimaxConfigured) {
    throw new Error('MiniMax M3 API is not configured. Set MINIMAX_API_KEY in your .env file.');
  }

  const systemPrompt = DEFAULT_TEXTURE_PROMPT;

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
              { type: 'text', text: 'Analyse the image and respond with the JSON object containing only the "texture" field — a precise paragraph describing the surface quality, mark-making, material identification, pigment interaction, and tactile cues visible in the frame.' },
              { type: 'image_url', image_url: { url: imageDataUri } }
            ]
          }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'texture_factual_analysis',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                texture: { type: 'string', minLength: 60 }
              },
              required: ['texture']
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
      throw new Error(`MiniMax M3 texture analysis error (${response.status}): ${errorText.substring(0, 200)}`);
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
          catch (e3) { throw new Error(`Texture analysis response was not valid JSON: ${e3.message}`); }
        } else {
          throw new Error('Texture analysis response contained no JSON object.');
        }
      }
    }

    const schemaName = 'texture_factual_analysis';
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed[schemaName] && typeof parsed[schemaName] === 'object') {
      parsed = parsed[schemaName];
    }

    if (typeof parsed?.texture !== 'string' || parsed.texture.length === 0) {
      throw new Error('Texture analysis response did not contain a "texture" string.');
    }

    return parsed.texture;
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') throw new Error('Texture analysis request timed out after 60 seconds.');
    throw error;
  }
};

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

/**
 * Pure helper: assemble the user-message envelope sent to the Stage 2
 * LLM. Extracted from callMiniMaxStage2 so the ADR 0017 budget-block
 * inclusion logic is unit-testable without spinning up the server or
 * mocking the MiniMax HTTP call.
 *
 * Shape: `{ analysis, directives, color_budget? }`. `color_budget` is
 * included whenever a palette with at least one color is supplied —
 * priority is implicit in the array order, so any saved palette gets
 * a deterministic budget block. ADR 0017 removed the "pure legacy"
 * opt-out: there is no longer a way for a saved palette to carry
 * "no user-customized weighting", because the act of saving it IS
 * the customization signal.
 *
 * ADR 0019 — preset-aware emission. Pass `opts.isZImage: true` when
 * the calling preset is one of the Z-Image sentinel presets; the
 * budget block then drops hex codes + strength semantics + placement
 * region tags (Z-Image interprets prose naturally and uses pigment
 * names; the guide §5.3 says use named pigments only).
 *
 * @param {object} analysis - the Stage 1 analysis (palette colors live in analysis.colors)
 * @param {string} directives - free-form user directives (Stage 2 input)
 * @param {object|null} palette - applied palette (ADR 0017)
 * @param {object} opts - optional flags; { isZImage: boolean }
 * @returns {object} the envelope object (callMiniMaxStage2 JSON-stringifies it)
 */
const buildStage2Envelope = (analysis, directives, palette = null, opts = {}) => {
  const envelope = { analysis, directives: directives || '' };
  // ADR 0017 — when a palette is in play, append a deterministic
  // color-budget block so the LLM has explicit priorities +
  // uniform-share labels + an accent cap to follow. The block lives
  // inside the envelope JSON so it's part of the structured user
  // message and travels through chat-refinement / re-runs unchanged.
  // ADR 0019 — preset-aware emission threads `opts` into the block.
  if (palette) {
    const block = buildColorBudgetBlock(palette, opts);
    if (block) {
      envelope.color_budget = block;
    }
  }
  return envelope;
};

const callMiniMaxStage2 = async (analysis, directives, stage2SystemPrompt, palette = null, opts = {}) => {
  if (!minimaxConfigured) {
    throw new Error('MiniMax M3 API is not configured. Set MINIMAX_API_KEY in your .env file.');
  }

  const envelope = buildStage2Envelope(analysis, directives, palette, opts);

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

/**
 * ADR 0019 — Stage 2 orchestrator with retry-and-warn for length.
 *
 * Wraps `callMiniMaxStage2` with the guide §3 + §10 length contract:
 *   - sweet spot 150-300 words
 *   - hard ceiling 750 words (1024 tokens at the encoder)
 *   - minimum effective 80 words
 *
 * On the first miss (output outside the sweet spot) the orchestrator
 * retries once with a reinforcement directive appended. If the second
 * attempt also misses, the result still ships but carries a
 * `length_check` descriptor in the response so the frontend can show
 * a non-blocking warning chip.
 *
 * The retry is opt-in (default OFF) because retrying adds another 60s
 * Stage 2 call to the critical path. The /api/generate-prompt route
 * opts in for Z-Image presets only — the FLUX/SDXL/Danbooru/photo
 * presets are not bound to the guide's word-count contract.
 *
 * @returns { prompt: string, length_check: { wordCount, classification, retried, secondClassification? } }
 */
const generateStage2WithLengthCheck = async (analysis, directives, stage2SystemPrompt, palette = null, opts = {}) => {
  const enableLengthRetry = opts.enableLengthRetry === true;
  const first = await callMiniMaxStage2(analysis, directives, stage2SystemPrompt, palette, opts);
  const firstWordCount = countStage2Words(first);
  const firstClass = classifyStage2Length(first);
  if (!enableLengthRetry || firstClass === 'sweet_spot') {
    return {
      prompt: first,
      length_check: { wordCount: firstWordCount, classification: firstClass, retried: false }
    };
  }

  // First miss — try once with a reinforcement directive.
  const reinforcementSuffix = (() => {
    if (firstClass === 'too_short') {
      return 'Your previous reply was ' + firstWordCount + ' words. The Z-Image model performs best at 150-300 words. Please rewrite your reply to that target — richer detail on the subject, the palette, and the focal element — without adding labels or markers.';
    }
    if (firstClass === 'too_long') {
      return 'Your previous reply was ' + firstWordCount + ' words — over the 300-word sweet spot. Please rewrite, trimming redundant adjectives while keeping all six blocks intact. Target 150-300 words.';
    }
    return 'Your previous reply was ' + firstWordCount + ' words — over the 750-word hard ceiling (1024 tokens at the encoder). Please rewrite, condensing to 150-300 words while keeping all six blocks intact.';
  })();
  const retryDirectives = (directives ? directives + '\n\n' : '') + reinforcementSuffix;
  const second = await callMiniMaxStage2(analysis, retryDirectives, stage2SystemPrompt, palette, opts);
  const secondWordCount = countStage2Words(second);
  const secondClass = classifyStage2Length(second);
  return {
    prompt: second,
    length_check: {
      wordCount: secondWordCount,
      classification: secondClass,
      retried: true,
      firstWordCount,
      firstClassification: firstClass,
      secondWordCount
    }
  };
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
// Routes — Actions / Mood / Lighting re-analysis (ADR 0018)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `POST /api/actions` — re-analyse the uploaded image with an actions-only
 * system prompt and return a single `actions` field. Independent of the
 * active preset (ADR 0018 §1). Powers the "Populate with AI" button beneath
 * the actions textarea in the analysis editor.
 *
 * Response envelope mirrors `/api/camera-angle` (ADR 0008) for symmetry:
 * `{ success, data: { actions, model } }`.
 */
app.post('/api/actions', upload.single('image'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No image file provided.' });
    filePath = req.file.path;

    if (!minimaxConfigured) {
      fs.unlinkSync(filePath);
      return res.status(503).json({ success: false, error: 'MiniMax M3 API key not configured.' });
    }

    const imageDataUri = fileToBase64DataUri(filePath, req.file.mimetype);
    const actions = await callMiniMaxActionsAnalysis(imageDataUri);

    fs.unlinkSync(filePath);
    filePath = null;

    res.json({
      success: true,
      data: {
        actions,
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

/**
 * `POST /api/mood` — re-analyse the uploaded image with a mood-only system
 * prompt and return a single `mood` field. Independent of the active
 * preset (ADR 0018 §1). Powers the "Populate with AI" button beneath the
 * mood textarea in the analysis editor, complementing the curated mood
 * preset chips.
 *
 * Response envelope mirrors `/api/camera-angle` (ADR 0008) for symmetry:
 * `{ success, data: { mood, model } }`.
 */
app.post('/api/mood', upload.single('image'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No image file provided.' });
    filePath = req.file.path;

    if (!minimaxConfigured) {
      fs.unlinkSync(filePath);
      return res.status(503).json({ success: false, error: 'MiniMax M3 API key not configured.' });
    }

    const imageDataUri = fileToBase64DataUri(filePath, req.file.mimetype);
    const mood = await callMiniMaxMoodAnalysis(imageDataUri);

    fs.unlinkSync(filePath);
    filePath = null;

    res.json({
      success: true,
      data: {
        mood,
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

/**
 * `POST /api/lighting` — re-analyse the uploaded image with a lighting-only
 * system prompt and return a single `lighting` field. Independent of the
 * active preset (ADR 0018 §1). Powers the "Populate with AI" button beneath
 * the lighting input in the analysis editor, complementing the curated
 * lighting preset chips.
 *
 * Response envelope mirrors `/api/camera-angle` (ADR 0008) for symmetry:
 * `{ success, data: { lighting, model } }`.
 */
app.post('/api/lighting', upload.single('image'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No image file provided.' });
    filePath = req.file.path;

    if (!minimaxConfigured) {
      fs.unlinkSync(filePath);
      return res.status(503).json({ success: false, error: 'MiniMax M3 API key not configured.' });
    }

    const imageDataUri = fileToBase64DataUri(filePath, req.file.mimetype);
    const lighting = await callMiniMaxLightingAnalysis(imageDataUri);

    fs.unlinkSync(filePath);
    filePath = null;

    res.json({
      success: true,
      data: {
        lighting,
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

/**
 * `POST /api/texture` — re-analyse the uploaded image with a texture-only
 * system prompt and return a single `texture` field. Independent of the
 * active preset (Slice 1 — App Build methodology, pattern-mirrors
 * ADR 0018 §1). Powers the "Populate with AI" button beneath the
 * texture textarea in the analysis editor.
 *
 * Response envelope mirrors `/api/actions` (ADR 0018) for symmetry:
 * `{ success, data: { texture, model } }`.
 */
app.post('/api/texture', upload.single('image'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No image file provided.' });
    filePath = req.file.path;

    if (!minimaxConfigured) {
      fs.unlinkSync(filePath);
      return res.status(503).json({ success: false, error: 'MiniMax M3 API key not configured.' });
    }

    const imageDataUri = fileToBase64DataUri(filePath, req.file.mimetype);
    const texture = await callMiniMaxTextureAnalysis(imageDataUri);

    fs.unlinkSync(filePath);
    filePath = null;

    res.json({
      success: true,
      data: {
        texture,
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
// Routes — Anima prompt contract (Slice 2.2 — ADR 0021)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `POST /api/anima` — re-analyse the uploaded image with the Anima
 * prompt contract and return { positive, negative, variant }.
 *
 * Independent of the active preset (the Anima contract is its own
 * document, set by ADR 0021). Powers the Anima branch of the
 * pre-Generate model picker that landed in Slice 2.1.
 *
 * Variant comes from the multipart field "variant" (one of
 * "base" / "aesthetic" / "turbo"). Default is "base" — the README
 * recommendation: "LoRAs should be trained using this version."
 *
 * Response envelope mirrors the per-field pattern (ADR 0018):
 * `{ success, data: { positive, negative, variant, model } }`.
 * The two-output shape (positive + negative) is the Anima contract.
 */
app.post('/api/anima', upload.single('image'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No image file provided.' });
    filePath = req.file.path;

    if (!minimaxConfigured) {
      fs.unlinkSync(filePath);
      return res.status(503).json({ success: false, error: 'MiniMax M3 API key not configured.' });
    }

    const variant = (req.body && typeof req.body.variant === 'string') ? req.body.variant : 'base';
    const allowedVariants = ['base', 'aesthetic', 'turbo'];
    const variantPrompt = allowedVariants.includes(variant) ? variant : 'base';

    const imageDataUri = fileToBase64DataUri(filePath, req.file.mimetype);
    const result = await callMiniMaxAnimaAnalysis(imageDataUri, variantPrompt);

    fs.unlinkSync(filePath);
    filePath = null;

    res.json({
      success: true,
      data: {
        positive: result.positive,
        negative: result.negative,
        variant: variantPrompt,
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
 * preset's built-in `stage2_system_prompt`), plus `default_prompt` and
 * an `is_default` flag (mirrors the ADR 0005 subject-prompt payload
 * shape).
 *
 * ADR 0015 — `is_default` means "no user-entered override is in force",
 * regardless of whether the resolved prompt equals the on-disk sentinel.
 * `default_prompt` is the on-disk literal value (the sentinel, if the
 * preset uses one) — the UI uses this to show "this preset uses the
 * canonical Z-Image Turbo prompt" in the Edit modal.
 */
app.get('/api/stage2-prompt', (req, res) => {
  try {
    const preset = resolveStage2PromptPreset(req.query.presetId, res);
    if (!preset) return;

    const hasOverride = getStage2Override(preset.id) != null;
    const effectivePrompt = getEffectiveStage2Prompt(preset);
    res.json({
      success: true,
      data: {
        prompt: effectivePrompt,
        default_prompt: preset.stage2_system_prompt,
        is_default: !hasOverride
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
 *
 * ADR 0015 — `is_default` reflects "no override in force" after the PUT
 * (which is always `false` here — a PUT writes an override).
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
        is_default: false
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
    const { presetId, analysis, directives, aspectRatio } = body;

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
    // ADR 0019 Issue #15 — optional aspect-ratio body field. When present,
    // server prepends a structured directive instructing the LLM to
    // include the canvas proportion in Block 3 of the Stage 2 output.
    // When absent, no directive is prepended (the LLM picks one or
    // follows the prompt's existing Block-3 instruction).
    let aspectRatioDirective = '';
    if (aspectRatio !== undefined && aspectRatio !== null && aspectRatio !== '') {
      if (typeof aspectRatio !== 'string' || !VALID_ASPECT_RATIOS.has(aspectRatio)) {
        return res.status(400).json({
          success: false,
          error: `aspectRatio must be one of: ${Array.from(VALID_ASPECT_RATIOS).join(', ')} (got ${JSON.stringify(aspectRatio)}).`
        });
      }
      aspectRatioDirective = buildAspectRatioDirective(aspectRatio);
    }

    // ADR 0014 — optional paletteId in the request body. When provided,
    // the server looks up the palette (404 if missing) and passes it
    // into callMiniMaxStage2 so a deterministic color-budget block can
    // be appended to the LLM user message. After Stage 2 returns, the
    // server measures the LLM output against the palette and surfaces
    // `distribution_metrics` in the response envelope so the Phase 4
    // dashboard can render observed vs target bars. Backwards
    // compatible: a missing paletteId leaves both the budget block and
    // the metrics field absent (existing callers see no change).
    let appliedPalette = null;
    if (body.paletteId !== undefined && body.paletteId !== null && body.paletteId !== '') {
      if (typeof body.paletteId !== 'string' || !body.paletteId.startsWith('palette_')) {
        return res.status(400).json({ success: false, error: 'paletteId must be a string starting with "palette_".' });
      }
      const palettes = readPalettes();
      const palette = palettes.find((p) => p.id === body.paletteId);
      if (!palette) {
        return res.status(404).json({ success: false, error: `Palette "${body.paletteId}" not found.` });
      }
      appliedPalette = palette;
    }

    const presets = readPresets();
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return res.status(404).json({ success: false, error: `Preset "${presetId}" not found.` });

    if (!minimaxConfigured) {
      return res.status(503).json({ success: false, error: 'MiniMax M3 API key not configured.' });
    }

    // ADR 0019 — preset-aware palette emission + length-check retry.
    // When the active preset's effective Stage 2 prompt is the canonical
    // Z-Image contract, drop hex codes + strength/placement semantics
    // from the color-budget block (Z-Image interprets prose naturally
    // and uses pigment names; guide §5.3). For FLUX/SDXL/photorealistic
    // /Danbooru presets the original behaviour is preserved.
    //
    // The Z-Image path additionally opts into the length-check
    // orchestrator (one retry with a reinforcement directive if the
    // first response lands outside the 150-300 word sweet spot) so
    // generated prompts stay inside the guide's contract range.
    const effectivePrompt = getEffectiveStage2Prompt(preset);
    const isZImagePreset = effectivePrompt === DEFAULT_ZIMAGE_STAGE2_PROMPT;
    // ADR 0019 Issue #15 — prepend the aspect-ratio directive so the
    // Stage 2 LLM anchors Block 3 on the user's chosen canvas
    // proportion. The user-typed directives remain authoritative; we
    // prepend only when aspectRatio is set.
    const composedDirectives = aspectRatioDirective + (directives || '');
    const stage2Result = await generateStage2WithLengthCheck(
      analysis,
      composedDirectives,
      effectivePrompt,
      appliedPalette,
      { isZImagePreset, enableLengthRetry: isZImagePreset }
    );
    const finalPrompt = stage2Result.prompt;
    const lengthCheck = stage2Result.length_check;

    // ADR 0014 — compute distribution metrics against the applied
    // palette. Pure function, fast (single pass over the prompt), and
    // safe to run on every successful run. When no palette is applied,
    // we omit the field entirely so existing consumers see no change.
    const distribution_metrics = appliedPalette
      ? measureColorDistribution(finalPrompt, appliedPalette)
      : null;

    const responseData = {
      preset_id: preset.id,
      preset_name: preset.name,
      prompt: finalPrompt,
      model: MINIMAX_MODEL
    };
    if (appliedPalette) {
      responseData.palette_id = appliedPalette.id;
      responseData.palette_name = appliedPalette.name;
      responseData.distribution_metrics = distribution_metrics;
      // ADR 0014 Phase 4 — append telemetry to data/palette_runs.json
      // so the Phase 4 dashboard has a target-vs-measured comparison
      // surface for this palette. The append is best-effort: a write
      // failure must NOT break the response (the user already got
      // their prompt). Trim is handled inside appendPaletteRun.
      try {
        appendPaletteRun({
          palette_id: appliedPalette.id,
          prompt: finalPrompt,
          metrics: distribution_metrics,
          recorded_at: new Date().toISOString()
        });
      } catch (e) {
        console.error('Failed to append palette run telemetry:', e.message);
      }
    }

    // ADR 0019 Issue #13 — surface the length-check descriptor to the
    // frontend. Only present when the orchestrator ran (Z-Image presets
    // only; FLUX/SDXL/Danbooru/photo presets skip the retry entirely).
    // `outside_sweet_spot: true` is the signal the result panel uses to
    // render a non-blocking warning chip (mirror of `result-strict-warn`).
    if (isZImagePreset && lengthCheck) {
      responseData.length_check = lengthCheck;
    }

    res.json({ success: true, data: responseData });
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
 * `GET /api/palettes/:id/distribution` — return the latest distribution
 * telemetry for a palette (Phase 4 dashboard data source). Returns
 * the most recent Stage 2 run entry's metrics, prompt, and timestamp
 * so the frontend can render target vs measured bars. 404 when the
 * palette has no recorded runs yet.
 *
 * ADR 0014 §4 — the response shape mirrors `distribution_metrics` from
 * /api/generate-prompt so the dashboard can render the same fields
 * without shape translation. `palette` is also returned so the
 * dashboard can show accent cap + per-color weighting alongside the
 * measurement.
 */
app.get('/api/palettes/:id/distribution', (req, res) => {
  try {
    const paletteId = req.params.id;
    if (typeof paletteId !== 'string' || !paletteId.startsWith('palette_')) {
      return res.status(400).json({ success: false, error: 'palette id must start with "palette_".' });
    }
    const palettes = readPalettes();
    const palette = palettes.find((p) => p.id === paletteId);
    if (!palette) return res.status(404).json({ success: false, error: `Palette "${paletteId}" not found.` });

    const latest = getLatestPaletteRun(paletteId);
    if (!latest) {
      return res.status(404).json({
        success: false,
        error: `no distribution metrics recorded yet for palette "${paletteId}".`
      });
    }
    res.json({
      success: true,
      data: {
        palette_id: paletteId,
        palette_name: palette.name,
        accent_max_mentions: palette.accent_max_mentions,
        colors: palette.colors,
        metrics: latest.metrics,
        prompt: latest.prompt,
        recorded_at: latest.recorded_at
      }
    });
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
      // ADR 0014 — palette-level accent cap. Falls back to the default
      // when the client didn't supply one (consistent with how missing
      // per-color weight/accent is handled by the read-side synthesis).
      accent_max_mentions: typeof body.accent_max_mentions === 'number'
        ? body.accent_max_mentions
        : DEFAULT_ACCENT_MAX_MENTIONS,
      // ADR 0016 — palette-level strength. Same default behaviour as
      // accent_max_mentions (fall back to 'moderate' when absent).
      strength: (typeof body.strength === 'string' &&
        PALETTE_STRENGTH_LEVELS.includes(body.strength))
        ? body.strength
        : DEFAULT_PALETTE_STRENGTH,
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
    // ADR 0016 — palette-level strength. Validate when present so a
    // bad value gets a 400 instead of being silently defaulted.
    if (body.strength !== undefined) {
      const sErr = validatePaletteStrength(body.strength);
      if (sErr) return res.status(400).json({ success: false, error: `strength: ${sErr}` });
    }

    const now = new Date().toISOString();
    const newPalette = {
      id: generatePaletteId(),
      name: body.name.trim(),
      colors: colorsResult.colors,
      source_run_id: null,
      source_preset_id: typeof body.source_preset_id === 'string' ? body.source_preset_id : null,
      // ADR 0014 — palette-level accent cap (same default behaviour
      // as POST /api/palettes above).
      accent_max_mentions: typeof body.accent_max_mentions === 'number'
        ? body.accent_max_mentions
        : DEFAULT_ACCENT_MAX_MENTIONS,
      // ADR 0016 — palette-level strength (same default behaviour as
      // accent_max_mentions: fall back to 'moderate' when absent).
      strength: (typeof body.strength === 'string' &&
        PALETTE_STRENGTH_LEVELS.includes(body.strength))
        ? body.strength
        : DEFAULT_PALETTE_STRENGTH,
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
    palettes[idx].colors = (target.colors || []).map((c) => {
      // ADR 0017 — restore preserves accent + placement but the
      // per-color `weight` field is intentionally not captured.
      const out = { hex: c.hex, name: c.name };
      if (typeof c.accent === 'boolean') out.accent = c.accent;
      if (typeof c.placement === 'string') out.placement = c.placement;
      return out;
    });
    // ADR 0014 / 0017 — restore palette-level accent_max_mentions +
    // strength (older snapshots may not carry strength; default keeps
    // the palette valid).
    palettes[idx].accent_max_mentions = typeof target.accent_max_mentions === 'number'
      ? target.accent_max_mentions
      : DEFAULT_ACCENT_MAX_MENTIONS;
    palettes[idx].strength = typeof target.strength === 'string' &&
      PALETTE_STRENGTH_LEVELS.includes(target.strength)
      ? target.strength
      : DEFAULT_PALETTE_STRENGTH;
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
const DEFAULT_CHAT_SYSTEM_PROMPT = `You are a focused prompt-refinement assistant iterating with a user on an image prompt.

# MODES
- Discussion (default): answer in \`reply\`; emit \`suggested_prompt: ""\`.
- Proposal (recommended or requested change): emit the FULL revised prompt in \`suggested_prompt\`.
- Never commit from your output — the user clicks Apply.

# EDIT BASE
- A PENDING PROMPT, when present, is the editing base.
- Otherwise the current working prompt is the editing base.
- Preserve every concrete fact the user did NOT explicitly ask to change (application context, hex codes, dimensions, named values, technical parameters, production requirements).
- Preserve the original / current / pending distinction.

# CORE CONTRACT — EDIT, DO NOT REGENERATE

INVENTORY the current working prompt. CLASSIFY each item against the user's request:
- DELTA: items the user explicitly mentioned. These you may change.
- ANCHOR SET: items the user did NOT mention. Non-negotiable.

APPLY only the delta to the anchor set. The revised prompt is the anchor set verbatim (or paraphrastic equivalence preserving meaning) PLUS the user's requested change. Do NOT introduce new facts the user did not ask for. Do NOT drop anchor-set items.

If the user explicitly asks for a wholesale rewrite, the anchor set is empty by their request. Otherwise anchor preservation is non-negotiable.

# JSON SCHEMA (strict)

Respond with EXACTLY one JSON object — no markdown fences, no prose. Two string fields:
- \`reply\`: 1-3 sentences. Address what the user asked. NEVER empty.
- \`suggested_prompt\`: a string. NEVER null, NEVER omitted. Use \`""\` for discussion. Use the FULL revised prompt when proposing a revision.

# RULES

- \`reply\` is mandatory and non-empty.
- A revision must be a complete self-contained prompt — never a fragment or diff.
- Keep \`reply\` under 200 words.
- Don't comment on style/aesthetic quality.
- Don't ask clarifying questions — propose the most natural interpretation.`;

/**
 * Generate a fresh chat session id (`chat_<16 hex>`).
 */
const generateChatSessionId = () => `chat_${crypto.randomBytes(8).toString('hex')}`;

/**
 * Generate a fresh chat message id (`msg_<16 hex>`).
 */
const generateChatMessageId = () => `msg_${crypto.randomBytes(8).toString('hex')}`;

const normalizeChatSession = (session) => {
  if (!session || typeof session !== 'object') return session;
  if (!Object.prototype.hasOwnProperty.call(session, 'pending_prompt')) {
    session.pending_prompt = null;
  }
  if (typeof session.pending_prompt !== 'string' || session.pending_prompt.trim().length === 0) {
    session.pending_prompt = null;
  }
  return session;
};

const isExplicitChatCommit = (content) => {
  if (typeof content !== 'string') return false;
  const normalized = content.trim().toLowerCase().replace(/[.!?]+$/g, '');
  return new Set([
    'apply it',
    'apply that',
    'apply the proposal',
    'use it',
    'use that',
    'use the proposal',
    'commit this',
    'commit that',
    'commit the proposal'
  ]).has(normalized);
};

const findLatestChatProposalMessage = (session) => {
  const pending = typeof session?.pending_prompt === 'string'
    ? session.pending_prompt
    : '';
  if (!pending || !Array.isArray(session?.messages)) return null;
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i];
    if (message?.role === 'assistant' && message.suggested_prompt === pending) {
      return message;
    }
  }
  return null;
};

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
  }).map(normalizeChatSession);
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

const CHAT_PARSE_CORRECTION_INSTRUCTION = 'Your previous response was empty or malformed. Reply with exactly one JSON object containing a non-empty reply string and a suggested_prompt string. Use an empty suggested_prompt for discussion only. Do not include markdown or explanation outside the JSON object.';

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
          // note so the user knows why no Apply button appears. Issue
          // #1: ALSO persist the declined revision text and the list of
          // dropped anchor terms so the frontend can show the user what
          // would have been applied (greyed-out preview + a "Try as
          // rewrite" affordance) instead of silently dropping the
          // revision.
          console.warn(
            `Chat preservation failed after ${CHAT_MAX_RETRIES + 1} attempts; ` +
            `declining revision (nonTargeted=${report.nonTargetedRatio}, ` +
            `bigram=${report.bigramRatio})`
          );
          return {
            reply: (result.value.reply || '') + buildPreservationDeclineNote(report),
            suggested_prompt: null,
            fallback_reason: 'preservation_failed',
            declined_suggested_prompt: suggested,
            declined_missing_terms: Array.isArray(report.nonTargetedMissing)
              ? report.nonTargetedMissing.slice(0, PRESERVATION_DECLINE_TERMS_DISPLAY_LIMIT)
              : []
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
      openaiMessages = [
        ...baseOpenaiMessages,
        { role: 'user', content: CHAT_PARSE_CORRECTION_INSTRUCTION }
      ];
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
 *
 * ADR 0019 — when the session is anchored to one of the Z-Image
 * sentinel presets (`preset_alla_prima_oil` or
 * `preset_968c0ccdf6fc6151`), append the Z-Image constraints block
 * so the chat assistant refuses to introduce depicted-light
 * vocabulary, hex codes in the prompt body, or section markers,
 * and preserves the pastel-palette / saturated-accent focal
 * contract if Style or Lighting is touched. The chat assistant
 * stays a strict editor (ADR 0011/0012); this block layers the
 * domain model vocabulary on top.
 */
const ZIMAGE_PRESET_IDS = new Set(['preset_alla_prima_oil', 'preset_968c0ccdf6fc6151']);

/**
 * The Z-Image-aware constraints block layered onto the chat system
 * prompt for sessions anchored to Z-Image presets. Pure string —
 * composed into the prompt by `buildChatSystemPrompt` when the
 * session.preset_id is in ZIMAGE_PRESET_IDS.
 */
const ZIMAGE_CHAT_CONSTRAINTS_BLOCK = `

# Z-IMAGE CONTRACT — DOMAIN CONSTRAINTS

The current working prompt is destined for Z-Image Turbo (Qwen3-4B encoder, 8 NFE, CFG=0, max 1024 tokens). Apply on top of the anchor-preservation contract above.

## FORBIDDEN VOCABULARY

- "no X" trailing constraints (CFG=0 ignores them).
- Depicted-light vocabulary: "soft light", "illuminated by", "backlit", "rim light", "halo of light", "rays of light", "highlight from". The radiance comes from color contrast against the muted surround, not a depicted lamp.
- Quality-tag suffix: "masterpiece", "8K", "ultra detailed", "best quality", "award winning", "highly detailed".
- SDXL/FLUX tag-list vocabulary: "1girl", "solo", "long_hair", "bokeh", "score_9". Z-Image interprets prose; tag lists dilute focus.
- Weight syntax "(keyword:1.3)" or Midjourney parameters ("--ar", "--s", "--v", "--niji").
- Hex codes inside the prompt body. Pigment names only.
- Section markers, bullets, lists, YAML, JSON, markup.

## REQUIRED VOCABULARY

When Style, Lighting, Color, or Subject is touched, preserve or strengthen:
- Medium: "oil painting on canvas" (or "oil on raw linen").
- Application: "palette knife" — never "brushwork" or "brush hairs".
- Technique: "alla prima" — wet-in-wet, single session.
- Palette: pastel / low-chroma dominant tones with ONE highly saturated accent (cadmium-coral, vermillion, cobalt blue, cadmium yellow, viridian, fuchsia-magenta) anchored to a specific element of the subject.
- Glow mechanism: achieved through color contrast, not depicted illumination.
- Closing anchor: natural paint sheen — matte in thick passages, slight gloss in scraped areas — no plastic gloss, no digital airbrush finish, no CGI look.

## LENGTH
150-300 words sweet spot. Hard ceiling: 750 words / 1024 tokens. Below 80 words = generic output.

## STYLE-SCHOOL ANCHOR
Pastel-palette-with-saturated-focal tradition. Do NOT introduce gestural-expressionist vocabulary as a focal feature — energy is optical (saturated colour against muted surround), not kinetic.`;

/**
 * Build the chat system prompt for a given session at a given turn.
 * Interpolation of the three context blocks (original prompt, current
 * prompt, analysis snapshot) happens here so the constant
 * `DEFAULT_CHAT_SYSTEM_PROMPT` stays free of per-session data.
 *
 * ADR 0019 — when the session is anchored to a Z-Image preset, the
 * Z-Image constraints block is appended after the SESSION CONTEXT
 * block. The plain anchor-preservation contract is unaffected.
 */
const compactChatAnalysisSnapshot = (snapshot, maxFieldLength = 240) => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const compact = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === null || value === undefined || value === '') continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (!text) continue;
    compact[key] = text.length > maxFieldLength
      ? `${text.slice(0, maxFieldLength - 1)}…`
      : text;
  }
  return compact;
};

const buildBoundedChatHistory = (messages, maxChars = CHAT_HISTORY_CHAR_BUDGET) => {
  if (!Array.isArray(messages)) return [];
  const selected = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0 && selected.length < CHAT_HISTORY_MAX_MESSAGES; i--) {
    const message = messages[i];
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue;
    if (typeof message.content !== 'string' || message.content.length === 0) continue;
    if (chars + message.content.length > maxChars) break;
    selected.unshift({ role: message.role, content: message.content });
    chars += message.content.length;
  }
  return selected;
};

const CHAT_CURRENT_PROMPT_TRIM_LENGTH = 2000;
const CHAT_PROMPT_TRUNCATION_MARKER = ' [truncated after first 2000 characters]';

const truncateChatPrompt = (prompt) => {
  if (prompt.length <= CHAT_CURRENT_PROMPT_TRIM_LENGTH) return prompt;
  return `${prompt.slice(0, CHAT_CURRENT_PROMPT_TRIM_LENGTH)}${CHAT_PROMPT_TRUNCATION_MARKER}`;
};

const buildChatSystemPromptVariant = ({
  original,
  current,
  pending,
  hasPending,
  analysis,
  isZImageSession,
  includeAnalysis,
  trimWorking,
  trimOriginal
}) => {
  const sameOriginalAndCurrent = original === current;
  const displayedOriginal = trimOriginal ? truncateChatPrompt(original) : original;
  const displayedCurrent = trimWorking ? truncateChatPrompt(current) : current;
  const displayedPending = trimWorking ? truncateChatPrompt(pending) : pending;
  const displayedShared = trimWorking || trimOriginal
    ? truncateChatPrompt(original)
    : original;
  const promptBlocks = sameOriginalAndCurrent
    ? `

## Original generated prompt
## Current working prompt (committed baseline)
"""
${displayedShared}
"""`
    : `

## Original generated prompt
"""
${displayedOriginal}
"""

## Current working prompt (committed baseline)
"""
${displayedCurrent}
"""`;
  const pendingBlock = hasPending
    ? `

## Pending prompt (editing base)
"""
${displayedPending}
"""`
    : '';
  const analysisBlock = includeAnalysis
    ? `

## Analysis snapshot
${analysis}`
    : '';

  return `${DEFAULT_CHAT_SYSTEM_PROMPT}

# SESSION CONTEXT${promptBlocks}${pendingBlock}${analysisBlock}${isZImageSession ? ZIMAGE_CHAT_CONSTRAINTS_BLOCK : ''}`;
};

const buildChatSystemPrompt = (session) => {
  const sessionObj = session || {};
  const original = typeof sessionObj.original_prompt === 'string' ? sessionObj.original_prompt : '';
  const current = typeof sessionObj.current_prompt === 'string' ? sessionObj.current_prompt : original;
  const hasPending = typeof sessionObj.pending_prompt === 'string'
    && sessionObj.pending_prompt.trim().length > 0;
  const pending = hasPending ? sessionObj.pending_prompt : '';
  const compactAnalysis = compactChatAnalysisSnapshot(sessionObj.analysis_snapshot);
  const analysis = compactAnalysis
    ? JSON.stringify(compactAnalysis)
    : '(no analysis snapshot was captured for this session)';
  const isZImageSession = sessionObj && typeof sessionObj.preset_id === 'string'
    && ZIMAGE_PRESET_IDS.has(sessionObj.preset_id);
  const build = (options) => buildChatSystemPromptVariant({
    original,
    current,
    pending,
    hasPending,
    analysis,
    isZImageSession,
    ...options
  });

  let systemPrompt = build({
    includeAnalysis: true,
    trimWorking: false,
    trimOriginal: false
  });
  if (systemPrompt.length <= CHAT_CONTEXT_CHAR_BUDGET) return systemPrompt;

  systemPrompt = build({
    includeAnalysis: false,
    trimWorking: false,
    trimOriginal: false
  });
  if (systemPrompt.length <= CHAT_CONTEXT_CHAR_BUDGET) return systemPrompt;

  systemPrompt = build({
    includeAnalysis: false,
    trimWorking: true,
    trimOriginal: false
  });
  if (systemPrompt.length <= CHAT_CONTEXT_CHAR_BUDGET) return systemPrompt;

  return build({
    includeAnalysis: false,
    trimWorking: true,
    trimOriginal: true
  });
};

const buildChatRequestContext = (session) => {
  const sessionObj = session || {};
  const systemPrompt = buildChatSystemPrompt(sessionObj);
  const remaining = Math.max(0, CHAT_CONTEXT_CHAR_BUDGET - systemPrompt.length);
  const messages = buildBoundedChatHistory(sessionObj.messages, remaining);
  return { systemPrompt, messages };
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
      pending_prompt: null,
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
    normalizeChatSession(session);

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

    if (isExplicitChatCommit(userMessage.content) && session.pending_prompt) {
      const proposal = findLatestChatProposalMessage(session);
      if (!proposal) {
        session.messages.pop();
        session.updated_at = now;
        writeChatSessions(sessions);
        return res.status(409).json({ success: false, error: 'The pending proposal is no longer available. Ask the assistant for a new proposal.' });
      }
      session.current_prompt = session.pending_prompt;
      session.pending_prompt = null;
      session.messages.push({
        id: generateChatMessageId(),
        role: 'assistant',
        content: 'Applied the latest proposal to the working prompt.',
        suggested_prompt: null,
        timestamp: new Date().toISOString()
      });
      session.updated_at = new Date().toISOString();
      writeChatSessions(sessions);
      return res.json({ success: true, data: session });
    }

    const context = buildChatRequestContext(session);
    const activePrompt = session.pending_prompt || session.current_prompt;
    let parsedReply;
    try {
      parsedReply = await callMiniMaxChat(context.systemPrompt, context.messages, {
        currentPrompt: activePrompt,
        lastUserRequest: userMessage.content
      });
    } catch (err) {
      // Roll back the user message so the failed attempt doesn't leave
      // a "ghost" turn in the history.
      session.messages.pop();
      session.updated_at = now;
      writeChatSessions(sessions);
      return res.status(500).json({ success: false, error: sanitizeError(err.message) });
    }

    if (typeof parsedReply.suggested_prompt === 'string' && parsedReply.suggested_prompt.length > 0) {
      session.pending_prompt = parsedReply.suggested_prompt;
    }

    const assistantMessage = {
      id: generateChatMessageId(),
      role: 'assistant',
      content: parsedReply.reply,
      suggested_prompt: parsedReply.suggested_prompt,
      timestamp: new Date().toISOString()
    };
    // Issue #1: when the validator declined a revision, persist the
    // declined text and dropped anchor terms on the assistant message
    // so the frontend can render the declined preview + "Try as
    // rewrite" affordance. Both fields are absent on every other
    // assistant message (success / parse-fallback / question-only),
    // so existing sessions are unaffected.
    if (typeof parsedReply.declined_suggested_prompt === 'string'
        && parsedReply.declined_suggested_prompt.length > 0) {
      assistantMessage.declined_suggested_prompt = parsedReply.declined_suggested_prompt;
      if (Array.isArray(parsedReply.declined_missing_terms)) {
        assistantMessage.declined_missing_terms = parsedReply.declined_missing_terms;
      }
    }
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
    session.pending_prompt = null;
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
  // ADR 0019 Issue #15 — aspect-ratio picker
  VALID_ASPECT_RATIOS,
  ASPECT_RATIO_LABEL,
  buildAspectRatioDirective,
  FIELD_PALETTE,
  VALID_FIELD_NAMES,
  FIELD_INPUT_MIN_LENGTH,
  FIELD_FORMAT_HINTS,
  DEFAULT_SUBJECT_PROMPT,
  MAX_SUBJECT_PROMPT_LENGTH,
  DEFAULT_CAMERA_ANGLE_PROMPT,
  // ADR 0018 — actions / mood / lighting re-analysis
  DEFAULT_ACTIONS_PROMPT,
  DEFAULT_MOOD_PROMPT,
  DEFAULT_LIGHTING_PROMPT,
  // Slice 1 — texture re-analysis (App Build methodology, pattern-mirrors ADR 0018)
  DEFAULT_TEXTURE_PROMPT,
  // Slice 2.2 — ADR 0021 — Anima prompt contract (two-output: positive + negative)
  DEFAULT_ANIMA_PROMPT,
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
  // ADR 0018 — actions / mood / lighting re-analysis helpers
  callMiniMaxActionsAnalysis,
  callMiniMaxMoodAnalysis,
  callMiniMaxLightingAnalysis,
  // Slice 1 — texture re-analysis helper (App Build methodology, pattern-mirrors ADR 0018)
  callMiniMaxTextureAnalysis,
  // Slice 2.2 — ADR 0021 — Anima prompt contract helper (two-output)
  callMiniMaxAnimaAnalysis,
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
  // ADR 0017 — order-based color priority (replaces ADR 0014 weight)
  MIN_ACCENT_MAX_MENTIONS,
  MAX_ACCENT_MAX_MENTIONS,
  DEFAULT_ACCENT_MAX_MENTIONS,
  validatePaletteAccentMaxMentions,
  prioritiesFromOrder,
  buildColorBudgetBlock,
  buildStage2Envelope,
  measureColorDistribution,
  // ADR 0016 — palette strength + accent placement
  PALETTE_STRENGTH_LEVELS,
  DEFAULT_PALETTE_STRENGTH,
  MAX_COLOR_PLACEMENT_LENGTH,
  validatePaletteStrength,
  STRENGTH_PREAMBLES,
  computeStrictPass,
  // ADR 0014 Phase 4 — palette run telemetry
  MAX_PALETTE_RUNS_PER_PALETTE,
  readPaletteRuns,
  writePaletteRuns,
  appendPaletteRun,
  getLatestPaletteRun,
  readStage2Overrides,
  writeStage2Overrides,
  getStage2Override,
  setStage2Override,
  removeStage2Override,
  getEffectiveStage2Prompt,
  validateStage2Prompt,
  MAX_STAGE2_PROMPT_LENGTH,
  ZIMAGE_STAGE2_SENTINEL,
  DEFAULT_ZIMAGE_STAGE2_PROMPT,
  // ADR 0019 — length-check + retry orchestrator
  STAGE2_SWEET_SPOT_MIN,
  STAGE2_SWEET_SPOT_MAX,
  STAGE2_HARD_MAX_WORDS,
  STAGE2_MIN_WORDS,
  countStage2Words,
  isWithinStage2SweetSpot,
  classifyStage2Length,
  generateStage2WithLengthCheck,
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
  ZIMAGE_PRESET_IDS,
  ZIMAGE_CHAT_CONSTRAINTS_BLOCK,
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_CHAT_MESSAGES_PER_SESSION,
  MAX_CHAT_SESSIONS_TOTAL,
  CHAT_SESSION_ID_PREFIX,
  CHAT_MESSAGE_ID_PREFIX,
  CHAT_TITLE_MAX_LENGTH,
  CHAT_CONTEXT_CHAR_BUDGET,
  CHAT_HISTORY_CHAR_BUDGET,
  CHAT_HISTORY_MAX_MESSAGES,
  DEFAULT_CHAT_SYSTEM_PROMPT,
  generateChatSessionId,
  generateChatMessageId,
  normalizeChatSession,
  isExplicitChatCommit,
  findLatestChatProposalMessage,
  readChatSessions,
  writeChatSessions,
  buildChatTitle,
  buildChatSystemPrompt,
  buildChatRequestContext,
  compactChatAnalysisSnapshot,
  buildBoundedChatHistory,
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
  PRESERVATION_DECLINE_TERMS_DISPLAY_LIMIT,
  buildPreservationDeclineNote,
  PRESERVATION_STOP_WORDS,
  tokenizeForPreservation,
  extractPreservationBigrams,
  validatePromptPreservation
};