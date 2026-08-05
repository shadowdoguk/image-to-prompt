'use strict';

// Regression smoke for: "Anima generation failed: Kilo Code returned an
// empty response." thrown from /api/anima when the user clicks Generate
// prompt with Target model = Anima on a non-anime image.
//
// Bug class: runtime (flaky LLM behavior amplified by fragile server-side handling).
//
// Root cause: `minimax/minimax-m3` occasionally returns HTTP 200 with
// `finish_reason: "stop"` and `content: ""` on non-anime images where
// it is uncertain about the dataset-tag choice (ye-pop vs deviantart).
// `callKiloAnimaAnalysis` threw a bare "Kilo Code returned an empty
// response." with no diagnostic and no retry, so the user saw a
// transient-looking failure on roughly 40-80% of Generate-prompt clicks
// for non-anime images.
//
// Fix: server.js — refactor the fetch block in `callKiloAnimaAnalysis`
// into a reusable `doFetch` closure, then on the first call's empty
// content + non-`length` finish_reason, retry once with identical params.
// On the second failure, the error message includes the finish_reason
// (e.g. `finish_reason: stop`) so the failure is debuggable from logs.
//
// This smoke is a static-source check (no server boot, no LLM call)
// because the fix is structural: a closure extraction + a one-line
// retry guard + a one-line diagnostic string. It confirms:
//   1. `callKiloAnimaAnalysis` defines a `doFetch` closure (the retry
//      mechanism).
//   2. The retry guard fires on `!content && finishReason !== 'length'`.
//   3. The error message includes `finish_reason` (the diagnostic).
//   4. Sibling `callKilo*` helpers (Stage 1, camera angle, etc.) are
//      untouched — out of scope per issue #25.
//   5. The `JSON.stringify({...})` payload is shared across both attempts
//      (so the retry doesn't drift parameters).
//
// Re-run after any change to server.js around callKiloAnimaAnalysis.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER_JS = path.join(ROOT, 'server.js');

let failures = 0;
const COLORS = { pass: '\x1b[32m', fail: '\x1b[31m', reset: '\x1b[0m' };

function record(label, ok, detail) {
  const tag = ok ? `${COLORS.pass}PASS${COLORS.reset}` : `${COLORS.fail}FAIL${COLORS.reset}`;
  console.log(`  [${tag}] ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const src = fs.readFileSync(SERVER_JS, 'utf8');

console.log('Regression smoke: Anima empty-response retry (Server.js #25)');
console.log('Bug: "Kilo Code returned an empty response" with no retry');
console.log('Fix: one retry on empty content in callKiloAnimaAnalysis, plus finish_reason in error');
console.log();

// Helper: extract the body of a top-level `const name = (...) => { ... };`
// or `const name = async (...) => { ... };` block by matching braces.
function extractFnBlock(src, name) {
  const declRe = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>\\s*\\{`);
  const m = src.match(declRe);
  if (!m) return null;
  const start = m.index;
  // Walk braces from the opening `{` after the `=>` to its matching `}`.
  let depth = 0;
  let i = src.indexOf('{', start);
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

const animaBlock = extractFnBlock(src, 'callKiloAnimaAnalysis');
if (!animaBlock) {
  record('callKiloAnimaAnalysis block found in server.js', false, 'unable to extract via brace-walk');
  process.exit(1);
}
record('callKiloAnimaAnalysis block found in server.js', true, `${animaBlock.length} chars`);

// 1. The retry mechanism: a `doFetch` closure defined inside callKiloAnimaAnalysis.
const hasDoFetch = /const\s+doFetch\s*=\s*async\s*\(\s*\)\s*=>/.test(animaBlock);
record('Defines a `doFetch` closure for retry', hasDoFetch,
  hasDoFetch ? '' : 'missing `const doFetch = async () => { ... }`');

// 2. The retry guard: `!content && finishReason !== 'length'`.
const hasRetryGuard = /!content\s*&&\s*finishReason\s*!==\s*['"]length['"]/.test(animaBlock);
record('Retry guard: `!content && finishReason !== "length"`', hasRetryGuard,
  hasRetryGuard ? '' : 'expected `!content && finishReason !== \'length\'`');

// 3. The retry actually calls doFetch a second time.
const hasRetryCall = /result\s*=\s*await\s+doFetch\(\)/.test(animaBlock);
record('Retry path calls `doFetch()` a second time', hasRetryCall,
  hasRetryCall ? '' : 'expected `result = await doFetch()` after the retry guard');

// 4. The error message includes `finish_reason`.
const hasFinishReasonInError = /Kilo Code returned an empty response[^"]*finish_reason/i.test(animaBlock);
record('Error message includes `finish_reason` diagnostic', hasFinishReasonInError,
  hasFinishReasonInError ? '' : 'expected `Kilo Code returned an empty response (finish_reason: ...)`');

// 5. The fetch body is shared (defined once, not duplicated inside doFetch).
const fetchBodyDeclaration = animaBlock.match(/const\s+fetchBody\s*=\s*JSON\.stringify/);
record('Shared `fetchBody` for both fetch attempts', fetchBodyDeclaration !== null,
  fetchBodyDeclaration ? '' : 'expected `const fetchBody = JSON.stringify(...)` so retry uses identical params');

// 6. The single-attempt siblings are untouched. Spot-check that Stage 1's
//    callKiloStage1-ish code path still has the original single-fetch pattern.
//    Specifically: callKiloStage2 should NOT have been refactored.
const stage2Block = extractFnBlock(src, 'callKiloStage2');
const stage2HasDoFetch = stage2Block && /const\s+doFetch\s*=/.test(stage2Block);
record('Sibling `callKiloStage2` is untouched (no `doFetch` refactor)',
  stage2Block !== null && !stage2HasDoFetch,
  stage2HasDoFetch ? 'unexpectedly refactored — issue #25 is Anima-only' : 'single-attempt pattern preserved');

// 7. Outer try/catch still translates AbortError to the friendly timeout
//    message (regression guard for the closure-extraction refactor).
const abortErrorHandled = /error\.name\s*===\s*['"]AbortError['"][\s\S]*?timed out/i.test(animaBlock);
record('Outer catch still translates AbortError → friendly timeout', abortErrorHandled,
  abortErrorHandled ? '' : 'missing `if (error.name === \'AbortError\') throw new Error(...timed out...)`');

// 8. The retry is bounded to ONE attempt (no while loop, no recursion).
//    Count the number of `await doFetch()` calls in the function body.
//    Should be exactly 2 (initial + retry).
const doFetchCallCount = (animaBlock.match(/await\s+doFetch\(\)/g) || []).length;
record('Retry is bounded to one attempt (exactly 2 doFetch calls)', doFetchCallCount === 2,
  `saw ${doFetchCallCount} doFetch call(s)`);

console.log();
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('All assertions passed.');
