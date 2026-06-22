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

/**
 * Per-field overrides applied on top of the global `FIELD_INPUT_MIN_LENGTH` and
 * the JSON Schema. Keys must be valid `FIELD_PALETTE` names. Each hint may set:
 *   - `minLength` (chars, replaces the input-type default for this field)
 *   - `description` (injected into the JSON Schema so MiniMax M3 includes it in
 *     the system prompt the LLM sees — this is the documented mechanism for
 *     nudging the model to produce longer/more-exhaustive content for a specific
 *     field, since `strict: true` schemas are otherwise silent on tone)
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

const ensureDataFileExists = () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PRESETS_FILE)) fs.writeFileSync(PRESETS_FILE, '[]', 'utf8');
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
 * v1 rules (per ADR 0002):
 *   - object of { [fieldName]: string }
 *   - keys must be valid FIELD_PALETTE names
 *   - values only allowed on `text` fields (not `textarea`, not `colors`)
 *   - values must be non-empty strings meeting FIELD_INPUT_MIN_LENGTH for the field type
 */
const validateFieldDefaults = (defaults) => {
  if (defaults === undefined || defaults === null) return null;
  if (typeof defaults !== 'object' || Array.isArray(defaults)) {
    return 'field_defaults must be an object';
  }
  for (const [key, value] of Object.entries(defaults)) {
    const def = FIELD_PALETTE[key];
    if (!def) return `field_defaults contains invalid field name: ${key}`;
    if (def.input !== 'text') {
      return `field_defaults.${key}: only text fields are supported in v1 (field type is '${def.input}')`;
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
 * `FIELD_FORMAT_HINTS` (ADR 0003) take precedence over the input-type default
 * and inject a `description` that the LLM sees via the schema.
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
      if (hint?.description) prop.description = hint.description;
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
  const attemptPromptSuffix = (violations) => {
    const lines = violations.map((v) => `- ${v.field}: ${v.actual} chars (need ≥${v.required})`);
    return `\n\n# CRITICAL: REJECTED FOR BEING TOO SHORT\n\nYour previous attempt returned values that are too short. You MUST expand each of the following fields to meet the minimum length requirement. Pad with adjacent observable detail — describe surroundings, lighting effect on the subject, micro-details, implied narrative.\n\n${lines.join('\n')}\n\nRespond with the FULL expanded JSON object (not a partial fix).`;
  };

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

  // Attempt 1
  let parsed = await performCall(stage1SystemPrompt);
  let violations = validateAnalysisLengths(parsed, fieldNames);

  // Attempt 2 (only if attempt 1 had length violations)
  if (violations.length > 0) {
    const suffix = attemptPromptSuffix(violations);
    console.warn(`Stage 1 attempt 1 failed length validation on ${violations.length} field(s); retrying with strengthened prompt`);
    parsed = await performCall(stage1SystemPrompt + suffix);
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
        max_tokens: 800,
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
    const analysis = await callMiniMaxStage1(imageDataUri, preset.stage1_system_prompt, preset.stage1_fields);

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

    res.json({
      success: true,
      data: {
        preset_id: preset.id,
        preset_name: preset.name,
        analysis,
        requested_fields: preset.stage1_fields,
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

    const finalPrompt = await callMiniMaxStage2(analysis, directives || '', preset.stage2_system_prompt);

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

app.listen(PORT, () => {
  ensureDataFileExists();
  console.log(`Image-to-Prompt server running on http://localhost:${PORT}`);
  console.log(`MiniMax M3 configured: ${minimaxConfigured}`);
  if (!minimaxConfigured) console.log('  ⚠️  Set MINIMAX_API_KEY in .env to enable generation.');
});

module.exports = app;