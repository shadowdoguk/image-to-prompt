#!/usr/bin/env node
/**
 * Phase 2 — comparing what the chat route sends vs. what works directly.
 *
 * Imports buildChatRequestContext from server.js, builds the EXACT
 * messages that the chat route would send, then sends that body
 * directly to Kilo Code (bypassing the chat route) to see whether
 * the upstream rejects the full payload (proving the messages-array
 * shape is the problem) or accepts it (proving the bug is elsewhere).
 *
 * The chat route sends:
 *   - system: buildChatSystemPrompt (very long)
 *   - history: buildBoundedChatHistory with last user rebuilt via
 *     buildUserMessageWithAttachments → content ARRAY
 *
 * Hypothesis to test: does MiniMax's chatcompletion_v2 endpoint
 * accept the full session-context payload? Or does it choke on
 * something in it (long system prompt? content array? specific
 * shape of the assistant messages)?
 */

const path = require('path');
const fs = require('fs');

// Best-effort .env loader
function loadDotenv() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotenv();

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const {
  buildChatRequestContext,
  CHAT_JSON_SCHEMA,
  buildKiloChatBody
} = require(path.join(PROJECT_ROOT, 'server.js'));

const KILO_BASE_URL = process.env.KILO_BASE_URL || 'https://api.kilo.ai/api/gateway';
const KILO_API_KEY = process.env.KILO_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'minimax/minimax-m3';

const sessions = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'chat_sessions.json'), 'utf8'));
const userSession = sessions
  .slice()
  .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())[0];

// Synthesize attachment on disk + add a synthetic attachment id to the
// session's last user message so buildUserMessageWithAttachments sees it.
const ATT_DIR = path.join(PROJECT_ROOT, 'data', 'chat_attachments', userSession.id);
fs.mkdirSync(ATT_DIR, { recursive: true });
const ATT_PATH = path.join(ATT_DIR, 'snapshot.png');
fs.writeFileSync(
  ATT_PATH,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAAAAAAAAAAAATklEQVR4nGNgYGD4z0AEYBxVSF6F' +
    'iFlAxKOjAyMcGP////7////h////hxn////7////hxn////7////hxn////7////hxn/' +
    '///7////hxn////7////hxn////7////hxn////7////hxn////7////hxn/' +
    '///7////hxn////7////hxn////7////hxn////7////hxn/' +
    '///7////hxn////7////hxn////7////hxn////7////hxn/' +
    '///7////hxn////7////hxn////7////hxn////7////hxn/' +
    'AAGGA0F8eHEAAAAASUVORK5CYII=',
    'base64'
  )
);

// Append a synthetic user message with the attachment id (mimics the
// user's last message in the screenshot).
userSession.messages.push({
  id: 'msg_snapshot_user',
  role: 'user',
  content: "Here is the resulting image so you can see where you're going wrong with the prompt.",
  suggested_prompt: null,
  timestamp: new Date().toISOString(),
  attachment_ids: ['att_snapshot']
});

// Patch manifest with the synthetic attachment id
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'data', 'chat_attachments', '_manifest.json');
const backup = fs.existsSync(MANIFEST_PATH) ? fs.readFileSync(MANIFEST_PATH, 'utf8') : '[]';
const existing = JSON.parse(backup);
existing.push({
  id: 'att_snapshot',
  session_id: userSession.id,
  filename: 'snapshot.png',
  mime: 'image/png',
  size: fs.statSync(ATT_PATH).size,
  path: ATT_PATH,
  created_at: new Date().toISOString()
});
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(existing, null, 2));

(async () => {
  const context = await buildChatRequestContext(userSession, LLM_MODEL);
  // Restore manifest
  fs.writeFileSync(MANIFEST_PATH, backup);

  console.log('System prompt length:', context.systemPrompt.length, 'chars');
  console.log('Messages count:', context.messages.length);
  for (let i = 0; i < context.messages.length; i++) {
    const m = context.messages[i];
    const contentShape = Array.isArray(m.content) ? `array[${m.content.length}]` : `string(${m.content.length})`;
    console.log(`  [${i}] ${m.role} ${contentShape}`);
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        console.log(`        - ${p.type}${p.image_url ? `(url len=${p.image_url.url.length})` : `(text len=${p.text?.length || 0})`}`);
      }
    } else {
      console.log(`        - "${m.content.substring(0, 80)}"`);
    }
  }

  const wireBody = buildKiloChatBody(
    [
      { role: 'system', content: context.systemPrompt },
      ...context.messages
    ],
    LLM_MODEL,
    true  // useSchema
  );

  console.log('\n--- wire body summary ---');
  console.log('model:', wireBody.model);
  console.log('max_tokens:', wireBody.max_tokens);
  console.log('temperature:', wireBody.temperature);
  console.log('messages:', wireBody.messages.length);
  console.log('response_format:', JSON.stringify(wireBody.response_format?.type));
  console.log('total body size:', JSON.stringify(wireBody).length, 'bytes');

  // Send to Kilo Code (bypassing the chat route)
  console.log('\n--- sending to Kilo Code ---');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(`${KILO_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KILO_API_KEY}` },
      signal: ctrl.signal,
      body: JSON.stringify(wireBody)
    });
    clearTimeout(t);
    const text = await res.text();
    console.log('HTTP', res.status);
    console.log(text.substring(0, 1200));
    if (res.status === 400 && /messages must not be empty/i.test(text)) {
      console.log('\n[RED-CAPABLE] Bug reproduced at the wire — Kilo Code rejected the full session payload with MiniMax 2013.');
      process.exit(0);
    } else if (res.ok) {
      console.log('\n[INFO] Upstream accepted the full payload — bug may be triggered by something else.');
      process.exit(2);
    } else {
      console.log('\n[OTHER] Different error — inspect body.');
      process.exit(2);
    }
  } catch (err) {
    clearTimeout(t);
    console.error('Network error:', err.message);
    process.exit(2);
  }
})();
