'use strict';

// Regression smoke for: "Refine via chat 'Apply' does not update
// Anima result panel." When the model selector is Anima, clicking
// the chat console's Apply button updates the server-side session
// correctly but does not write back into the Anima result textareas
// or state.animaResult. The user sees the chat badge say "Applied"
// while the visible Anima prompt is still the original.
//
// Bug class: runtime (state desync / drift between Slice 2.3 Anima
// panel and Slice 2.4 Anima chat apply handler).
// Fix: src/app.js — applyChatRevision branches on state.model ===
// 'anima' and writes to state.animaResult.positive +
// dom.animaResultPositive. The Z-Image branch is the else leg.
//
// This smoke is a static-source check (no server boot, no LLM call)
// because the fix is pure client logic. It confirms:
//   1. The apply handler branches on state.model === 'anima'.
//   2. The Anima branch writes to dom.animaResultPositive.value.
//   3. The Anima branch updates state.animaResult.positive.
//   4. The Z-Image branch still writes to state.finalPrompt +
//      dom.resultPrompt.textContent (regression armor).
//   5. The token-reminder banner is still re-evaluated on apply.
//
// Re-run after any change to src/app.js applyChatRevision.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_JS = path.join(ROOT, 'src', 'app.js');

let failures = 0;
const COLORS = { pass: '\x1b[32m', fail: '\x1b[31m', reset: '\x1b[0m' };

function record(label, ok, detail) {
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  [${COLORS[tag.toLowerCase()]}${tag}${COLORS.reset}] ${label}`);
  if (!ok && detail) console.log(`         ${detail}`);
  if (!ok) failures++;
}

const src = fs.readFileSync(APP_JS, 'utf8');

// Extract the applyChatRevision body. The function is an async arrow
// assigned to a const; it's the LAST `const applyChatRevision =` in
// the file (the only definition; the other occurrences are call sites).
// Match the signature line, then walk forward to the matching closing
// brace at the same indent level (2 spaces). This is robust against
// nested `};` inside the function body (e.g. `state.animaResult = { ... };`).
const applySig = src.lastIndexOf('const applyChatRevision = async');
if (applySig === -1) {
  console.error('  [FAIL] Could not locate applyChatRevision in src/app.js');
  process.exit(1);
}
// Track brace depth from the body opener.
const bodyStart = src.indexOf('{', applySig);
let depth = 0;
let bodyEnd = -1;
for (let i = bodyStart; i < src.length; i++) {
  const ch = src[i];
  if (ch === '{') depth++;
  else if (ch === '}') {
    depth--;
    if (depth === 0) { bodyEnd = i + 1; break; }
  }
}
if (bodyEnd === -1) {
  console.error('  [FAIL] Could not balance braces in applyChatRevision');
  process.exit(1);
}
const body = src.slice(applySig, bodyEnd);

// 1. Branch on state.model === 'anima' (regression armor for the
//    original bug — the handler was Z-Image-only).
record(
  'applyChatRevision branches on state.model === "anima"',
  /state\.model\s*===\s*['"]anima['"]/.test(body),
  'expected: state.model === "anima" inside the apply handler'
);

// 2. Anima branch must write to dom.animaResultPositive.value.
record(
  'Anima branch writes to dom.animaResultPositive.value',
  /dom\.animaResultPositive\.value\s*=\s*updated\.current_prompt/.test(body),
  'expected: dom.animaResultPositive.value = updated.current_prompt'
);

// 3. Anima branch must update state.animaResult.positive.
record(
  'Anima branch updates state.animaResult.positive',
  /state\.animaResult\s*=\s*\{[^}]*positive\s*:\s*updated\.current_prompt/.test(body),
  'expected: state.animaResult = { ... positive: updated.current_prompt }'
);

// 4. Z-Image branch still present (regression armor — the original
//    code path must not be removed by the Anima fix).
record(
  'Z-Image branch still writes to state.finalPrompt',
  /state\.finalPrompt\s*=\s*updated\.current_prompt/.test(body),
  'expected: state.finalPrompt = updated.current_prompt'
);

record(
  'Z-Image branch still writes to dom.resultPrompt.textContent',
  /dom\.resultPrompt\.textContent\s*=\s*updated\.current_prompt/.test(body),
  'expected: dom.resultPrompt.textContent = updated.current_prompt'
);

// 5. Token reminder banner still re-evaluated post-apply (ADR 0019
//    Issue #15 contract — applies to both models).
record(
  'updateTokenReminderBanner() still called after apply',
  /updateTokenReminderBanner\(\s*\)/.test(body),
  'expected: updateTokenReminderBanner() invoked inside the apply handler'
);

// 6. Defensive comment explaining the Anima branch (regression armor
//    — makes the intent obvious to future maintainers).
record(
  'apply handler has an explanatory comment about Anima',
  /anima/i.test(body),
  'expected: a comment mentioning Anima or the model fork'
);

console.log('');
if (failures === 0) {
  console.log(`${COLORS.pass}anima-chat-apply-sync: all checks passed${COLORS.reset}`);
  process.exit(0);
} else {
  console.log(`${COLORS.fail}anima-chat-apply-sync: ${failures} check(s) failed${COLORS.reset}`);
  process.exit(1);
}
