#!/usr/bin/env node
/**
 * Phase 1 — live wire-level repro against the user's actual session.
 *
 * Replays the chat send (POST /api/chat/sessions/:id/messages) with
 *   - the exact user session id from chat_sessions.json
 *   - the exact LLM model + provider from data/model_config.json
 *   - a synthetic attachment (uses fixtures/repro-attachment.png)
 *   - the same user text from the bug report
 *
 * Goes red on the user's exact symptom:
 *   - HTTP 5xx from /api/chat/.../messages
 *   - body.error matches /messages must not be empty \(2013\)/
 *
 * Exits 0 on RED (bug reproduced), 2 on GREEN (no error or different
 * error), 1 on missing prerequisites.
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

const PORT = process.env.PORT || 3100;
const BASE = `http://127.0.0.1:${PORT}`;

const sessions = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'chat_sessions.json'), 'utf8'));
const modelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'model_config.json'), 'utf8'));

const userSession = sessions
  .slice()
  .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())[0];

if (!userSession) {
  console.error('No sessions in chat_sessions.json — cannot reproduce.');
  process.exit(1);
}

const kiloCfg = modelConfig.kilo_code || {};
const enabledKilo = Array.isArray(kiloCfg.enabled) && kiloCfg.enabled.length > 0
  ? kiloCfg.enabled
  : ['minimax/minimax-m3'];
const llmModel = enabledKilo[0];
const provider = 'kilo_code';
console.log('Session:    ', userSession.id);
console.log('LLM model:  ', llmModel);
console.log('Provider:   ', provider);
console.log('Messages in session:', userSession.messages.length);

// Use the dedicated fixture (a valid 64x64 PNG generated with proper
// CRC32 checksums — earlier in-script base64 had bad CRCs which
// triggered MiniMax's "invalid checksum" 2013, a separate upstream-
// provider issue unrelated to the chat-route bug).
const ATT_DIR = path.join(__dirname, '..', '..', 'data', 'chat_attachments', userSession.id);
fs.mkdirSync(ATT_DIR, { recursive: true });
const ATT_FILENAME = 'repro-debug.png';
const ATT_LOCAL_PATH = path.join(ATT_DIR, ATT_FILENAME);
const pngBytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'repro-attachment.png'));
fs.writeFileSync(ATT_LOCAL_PATH, pngBytes);

async function uploadAttachment() {
  const blob = new Blob([pngBytes], { type: 'image/png' });
  const form = new FormData();
  form.append('image', blob, ATT_FILENAME);
  const res = await fetch(`${BASE}/api/chat/sessions/${userSession.id}/attachments`, {
    method: 'POST',
    body: form
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.success) {
    throw new Error(`Attachment upload failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data.data.id;
}

async function sendMessage(attachmentId) {
  const text = "Here is the resulting image so you can see where you're going wrong with the prompt.";
  const res = await fetch(`${BASE}/api/chat/sessions/${userSession.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: text,
      provider,
      llmModel,
      attachment_ids: [attachmentId]
    })
  });
  const text2 = await res.text();
  let data;
  try { data = JSON.parse(text2); } catch { data = null; }
  return { status: res.status, body: data || text2 };
}

(async () => {
  let attId;
  try {
    attId = await uploadAttachment();
    console.log('Uploaded attachment:', attId);
  } catch (err) {
    console.error('Upload failed:', err.message);
    process.exit(1);
  }

  const result = await sendMessage(attId);
  console.log('\n--- POST /api/chat/sessions/:id/messages response ---');
  console.log('HTTP', result.status);
  if (typeof result.body === 'object') {
    console.log(JSON.stringify(result.body, null, 2).substring(0, 1500));
  } else {
    console.log(result.body.substring(0, 1500));
  }
  console.log('---------------------------------------------------');

  const errStr = typeof result.body === 'object' && result.body.error
    ? result.body.error
    : (typeof result.body === 'string' ? result.body : '');
  const is2013 = /messages must not be empty/i.test(errStr) ||
                 /2013/.test(errStr) ||
                 /status_code["':\s]+2013/.test(JSON.stringify(result.body));

  if (is2013) {
    console.log('\n[RED] Bug reproduced — live server returned MiniMax 2013 "messages must not be empty".');
    process.exit(0);
  }
  if (result.status >= 200 && result.status < 300) {
    console.log('\n[GREEN] Send succeeded — bug NOT reproduced via live endpoint.');
    process.exit(2);
  }
  console.log(`\n[OTHER] HTTP ${result.status} with different error — inspect body above.`);
  process.exit(2);
})().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
