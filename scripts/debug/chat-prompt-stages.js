#!/usr/bin/env node
/**
 * Instrument buildChatSystemPromptVariant stages for a session.
 * (buildChatSystemPromptVariant is not exported, so we load it by
 *  reading server.js source and evaluating just that function with
 *  its free variables resolved from the module's exports.)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
function loadDotenv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
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

const mod = require(path.join(PROJECT_ROOT, 'server.js'));
const src = fs.readFileSync(path.join(PROJECT_ROOT, 'server.js'), 'utf8');

// Extract function source: buildChatSystemPromptVariant
const startMarker = 'const buildChatSystemPromptVariant = (';
const endMarker = 'const buildChatSystemPrompt = (session)';
const fnSrc = src.slice(src.indexOf(startMarker), src.indexOf(endMarker)).replace(/;\s*$/, '');

// Free variables needed (all exported from server.js):
const truncateChatPrompt = (prompt) => {
  if (prompt.length <= 2000) return prompt;
  return `${prompt.slice(0, 2000)} [truncated after first 2000 characters]`;
};
const freeVars = {
  DEFAULT_CHAT_SYSTEM_PROMPT: mod.DEFAULT_CHAT_SYSTEM_PROMPT,
  ZIMAGE_CHAT_CONSTRAINTS_BLOCK: mod.ZIMAGE_CHAT_CONSTRAINTS_BLOCK,
  ANIMA_CHAT_CONSTRAINTS_BLOCK: mod.ANIMA_CHAT_CONSTRAINTS_BLOCK,
  truncateChatPrompt,
  CHAT_CURRENT_PROMPT_TRIM_LENGTH: 2000,
  CHAT_PROMPT_TRUNCATION_MARKER: ' [truncated after first 2000 characters]',
};
const sandbox = { ...freeVars };
vm.createContext(sandbox);
vm.runInContext(`${fnSrc}\n;globalThis.__variant = buildChatSystemPromptVariant;`, sandbox);
const buildVariant = sandbox.__variant;

const sessionId = process.argv[2];
const sessions = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'chat_sessions.json'), 'utf8'));
const s = sessionId ? sessions.find((x) => x.id === sessionId) : sessions[0];

const original = typeof s.original_prompt === 'string' ? s.original_prompt : '';
const current = typeof s.current_prompt === 'string' ? s.current_prompt : original;
const hasPending = typeof s.pending_prompt === 'string' && s.pending_prompt.trim().length > 0;
const pending = hasPending ? s.pending_prompt : '';
const ca = mod.compactChatAnalysisSnapshot(s.analysis_snapshot);
const analysis = ca ? JSON.stringify(ca) : '(no analysis snapshot was captured for this session)';
const isZImageSession = typeof s.preset_id === 'string' && mod.ZIMAGE_PRESET_IDS.has(s.preset_id);
const isAnimaSession = typeof s.model === 'string' && s.model === 'anima';

const stages = [
  ['S1 full (analysis, no trim)', { includeAnalysis: true, trimWorking: false, trimOriginal: false }],
  ['S2 no analysis', { includeAnalysis: false, trimWorking: false, trimOriginal: false }],
  ['S3 no analysis + trim working', { includeAnalysis: false, trimWorking: true, trimOriginal: false }],
  ['S4 no analysis + trim both', { includeAnalysis: false, trimWorking: true, trimOriginal: true }],
];
console.log('session:', s.id);
console.log('original_prompt len:', original.length);
console.log('current_prompt len:', current.length);
console.log('analysis JSON len:', analysis.length);
console.log('isZImageSession:', isZImageSession, '| isAnimaSession:', isAnimaSession);
console.log('DEFAULT_CHAT_SYSTEM_PROMPT len:', mod.DEFAULT_CHAT_SYSTEM_PROMPT.length);
console.log('ZIMAGE constraints len:', mod.ZIMAGE_CHAT_CONSTRAINTS_BLOCK.length);
for (const [name, o] of stages) {
  const p = buildVariant({ original, current, pending, hasPending, analysis, isZImageSession, isAnimaSession, ...o });
  const flag = p.length <= mod.CHAT_CONTEXT_CHAR_BUDGET ? '<=20k' : '>20k OVER';
  console.log(`${name}: ${p.length}  (${flag})`);
}
