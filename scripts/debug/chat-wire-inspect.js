#!/usr/bin/env node
/**
 * Debug harness: inspect the staged system-prompt lengths and the
 * exact wire context for a given chat session.
 *
 * Usage: node scripts/debug/chat-wire-inspect.js [sessionId]
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

const sessionId = process.argv[2] || null;
const sessions = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'chat_sessions.json'), 'utf8')
);
const s = sessionId
  ? sessions.find((x) => x.id === sessionId)
  : sessions.slice().sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))[0];

console.log('session:', s.id);
console.log('messages:', s.messages.length, '| last role:', s.messages[s.messages.length - 1].role);

(async () => {
  const ctx = await mod.buildChatRequestContext(s, 'minimax/minimax-m3');
  console.log('--- buildChatRequestContext ---');
  console.log('systemPrompt.length:', ctx.systemPrompt.length, '(budget:', mod.CHAT_CONTEXT_CHAR_BUDGET + ')');
  console.log('messages.length:', ctx.messages.length);
  for (const m of ctx.messages) {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    console.log(`  ${m.role} | len=${content.length} | ${JSON.stringify(content.slice(0, 200))}`);
  }
  console.log('retrievalIds:', ctx.retrievalIds.length);

  // Breakdown of the system prompt
  const sysLen = mod.buildChatSystemPrompt(s).length;
  console.log('--- breakdown ---');
  console.log('buildChatSystemPrompt (no RAG):', sysLen);
  console.log('RAG block:', ctx.systemPrompt.length - sysLen);
})().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
