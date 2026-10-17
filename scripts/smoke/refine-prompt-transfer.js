'use strict';

/**
 * Smoke test for issue #26 — "Refine in chat → fails to transfer the
 * generated prompt between pages."
 *
 * Bug class: runtime / ux
 * Fix: server.js validateChatSessionCreate accepts original_prompt /
 *      current_prompt as aliases for prompt and adds 'krea2' to the
 *      model allowlist; src/app.js activateKrea2ChatForResult sends
 *      the canonical body shape (prompt + preset_krea2_internal +
 *      model:'krea2'); runChatActivationSession surfaces non-cap
 *      failures as a warning toast; K.14 click handler validates
 *      payload + re-checks state.chatSessionId post-await.
 *
 * Scope: static-source regression armor (no server boot, no LLM call).
 * The end-to-end behaviour is covered by the curl probes called out
 * in the issue #26 acceptance criteria and by tests/run-all.js
 * Slice #26 block; this smoke locks the *source contracts* so a
 * future refactor that quietly re-introduces the broken shape is
 * caught without booting the server.
 *
 * Five contracts locked:
 *   1. validator: prompt aliases (prompt / original_prompt / current_prompt)
 *   2. validator: model allowlist includes 'krea2'
 *   3. validator: Krea-2 placeholder bypass (mirrors the Anima bypass)
 *   4. frontend: activateKrea2ChatForResult sends canonical body
 *   5. frontend: K.14 click-time guards present
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER_JS = path.join(ROOT, 'server.js');
const APP_JS = path.join(ROOT, 'src', 'app.js');

let failures = 0;
const COLORS = { pass: '\x1b[32m', fail: '\x1b[31m', reset: '\x1b[0m' };

function record(label, ok, detail) {
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  [${COLORS[tag.toLowerCase()]}${tag}${COLORS.reset}] ${label}`);
  if (!ok && detail) console.log(`         ${detail}`);
  if (!ok) failures++;
}

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s+\/\/.*$/gm, '');

const serverText = fs.readFileSync(SERVER_JS, 'utf8');
const appText = fs.readFileSync(APP_JS, 'utf8');

// ─── 1. Server validator — prompt alias resolution ──────────────────────
const fnStart = serverText.indexOf('const validateChatSessionCreate = (body,');
const fnWindow = fnStart > 0 ? serverText.slice(fnStart, fnStart + 5000) : '';
record(
  '1. validateChatSessionCreate resolves canonicalPrompt from any of prompt / original_prompt / current_prompt (#26)',
  /canonicalPrompt/.test(fnWindow) &&
    /body\.prompt/.test(fnWindow) &&
    /body\.original_prompt/.test(fnWindow) &&
    /body\.current_prompt/.test(fnWindow),
  fnStart === -1
    ? 'validateChatSessionCreate not found'
    : 'one or more prompt aliases not inspected in the validator (was: prompt only pre-fix)'
);
record(
  '  error string mentions the aliases so the user knows the contract (#26)',
  /prompt is required and must be a string \(or be supplied as original_prompt \/ current_prompt\)/.test(fnWindow),
  'canonical alias-error message not found — was the short "prompt is required and must be a string" pre-fix'
);

// ─── 2. Server validator — Krea-2 in model allowlist ────────────────────
record(
  '2. model allowlist includes "krea2" alongside "zimage_turbo" and "anima" (#26)',
  /\[\s*['"]zimage_turbo['"]\s*,\s*['"]anima['"]\s*,\s*['"]krea2['"]\s*\]/.test(fnWindow),
  'krea2 missing from the model allowlist — pre-fix it was [zimage_turbo, anima]'
);

// ─── 3. Server validator — Krea-2 placeholder bypass ────────────────────
record(
  '3. preset-existence check is bypassed for preset_krea2_internal (#26)',
  /isKrea2Create/.test(fnWindow) &&
    /preset_krea2_internal/.test(fnWindow) &&
    /!isPlaceholderCreate/.test(fnWindow),
  'isKrea2Create branch not wired up (or !isPlaceholderCreate not the bypass condition)'
);
record(
  '  the legacy isAnimaCreate placeholder branch is preserved (#26 regression guard for ADR 0021)',
  /isAnimaCreate/.test(fnWindow) && /preset_anima_internal/.test(fnWindow),
  'isAnimaCreate branch regressed — the Anima chat path will break'
);

// ─── 4. Frontend — canonical Krea-2 body ────────────────────────────────
const fnAppStart = appText.indexOf('const activateKrea2ChatForResult');
const fnAppEnd = appText.indexOf('\n  const ', fnAppStart + 200);
const fnAppBody = appText.slice(fnAppStart, fnAppEnd === -1 ? fnAppStart + 4000 : fnAppEnd);
const fnAppCode = stripComments(fnAppBody);

record(
  '4. activateKrea2ChatForResult sends canonical `prompt: data.prompt` field (#26 — was original_prompt pre-fix)',
  /prompt:\s*data\.prompt/.test(fnAppCode),
  'Krea-2 chat-activation body still uses the broken original_prompt envelope'
);
record(
  '  uses preset_krea2_internal placeholder (mirrors preset_anima_internal convention)',
  /preset_id:\s*['"]preset_krea2_internal['"]/.test(fnAppCode),
  'preset_krea2_internal placeholder missing — would fail the validator and regress to the K.4 silent-failure bug'
);
record(
  '  sets model: "krea2" so the chat system prompt dispatches to the Krea-2 block',
  /model:\s*['"]krea2['"]/.test(fnAppCode),
  'model field missing or wrong — Krea-2 chat sessions would land in the Z-Image chat system prompt'
);
record(
  '  must NOT regress to preset_id: null (the pre-fix shape)',
  !/preset_id\s*:\s*null\b/.test(fnAppCode),
  'preset_id: null re-introduced — the broken envelope shape would re-trigger the validator 400'
);

// ─── 5. Frontend — K.14 click-time guards ───────────────────────────────
record(
  '5. wireRefineInChatLink defines a validateRefineBodyPayload helper (#26 click-time guard #1)',
  /const validateRefineBodyPayload = \(body,\s*modelName\) =>/.test(appText),
  'validateRefineBodyPayload missing — empty / oversized prompts would send invalid bodies to the server'
);
record(
  '  validateRefineBodyPayload enforces MAX_PROMPT_CHARS = 5000 (matches server MAX_FINAL_PROMPT_LENGTH)',
  /MAX_PROMPT_CHARS\s*=\s*5000/.test(appText) && /trimmed\.length > MAX_PROMPT_CHARS/.test(appText),
  'MAX_PROMPT_CHARS constant missing or > server boundary — silent oversized-prompt failures'
);
record(
  '  K.14 wiring uses linkEl.dataset.refining for the doubled-click guard (#26 click-time guard #2)',
  /linkEl\.dataset\.refining/.test(appText),
  'doubled-click guard missing — rapid clicks would create duplicate chat sessions and burn 200-cap slots'
);
record(
  '  K.14 wiring re-checks state.chatSessionId === session.id after the await (#26 click-time guard #3)',
  /state\.chatSessionId\s*===\s*session\.id/.test(appText),
  'post-await re-check missing — silent activation failures would still trigger the #/chat redirect (the dead-end UX)'
);

if (failures > 0) {
  console.log(`\n${COLORS.fail}SMOKE FAILED: ${failures} assertion(s) failed${COLORS.reset}`);
  process.exit(1);
}
console.log(`\n${COLORS.pass}SMOKE PASSED: all assertions hold${COLORS.reset}`);
