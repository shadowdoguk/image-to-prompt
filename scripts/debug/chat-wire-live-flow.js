#!/usr/bin/env node
/**
 * Simulate the exact live route flow for the failing session:
 *   1. push the new user message (like the route does)
 *   2. buildChatRequestContext
 *   3. print the wire body (system + messages) that the model sees
 * Usage: node scripts/debug/chat-wire-live-flow.js <sessionId> "<message>"
 */
const path = require('path');
const fs = require('fs');
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
const mod = require(path.join(PROJECT_ROOT, 'server.js'));

const sessionId = process.argv[2];
const message = process.argv[3] || 'Please refine the mist treatment around the figure.';
const sessions = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'chat_sessions.json'), 'utf8'));
const s = sessions.find((x) => x.id === sessionId);
if (!s) { console.error('session not found'); process.exit(1); }

// mimic the route: push the user message first
s.messages.push({
  id: 'msg_debug_flow_user',
  role: 'user',
  content: message,
  suggested_prompt: null,
  timestamp: new Date().toISOString(),
  attachment_ids: []
});

(async () => {
  const ctx = await mod.buildChatRequestContext(s, 'minimax/minimax-m3');
  console.log('systemPrompt length:', ctx.systemPrompt.length, '/ budget', mod.CHAT_CONTEXT_CHAR_BUDGET);
  console.log('messages:', ctx.messages.length);
  ctx.messages.forEach((m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    console.log(`  ${m.role} (len ${content.length}): ${JSON.stringify(content.slice(0, 300))}`);
  });
  const totalChars = ctx.systemPrompt.length + ctx.messages.reduce((t, m) => t + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0);
  console.log('total wire chars:', totalChars);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
