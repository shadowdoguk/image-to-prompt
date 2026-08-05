'use strict';

// Regression smoke for: "Analysis failed: model is not defined" returned
// from /api/analyze (and 7 sibling routes: subject, camera-angle,
// actions, mood, lighting, texture, anima).
//
// Bug class: runtime
// Root cause: Slice 3 (ADR 0022 — kilo-code provider migration) renamed
// the route-handler variable from `model` to `llmModel` to avoid
// collision with `state.model` (output contract). Eight response-payload
// lines were left referencing the old `model` name. `model` is not
// defined anywhere, so any successful response from those routes
// threw `ReferenceError: model is not defined`.
//
// Fix: server.js — rename `model: model` → `model: llmModel` in the
// response payload of all 8 routes. `llmModel` is in scope via
// `const llmModel = resolveModel(req.body)` higher in each handler.
//
// This smoke is a static-source check (no server boot, no LLM call)
// because the fix is a 1-token rename in a known set of routes. It
// confirms:
//   1. None of the 8 affected route handlers reference `model: model`
//      in their response payload.
//   2. All 8 reference `model: llmModel` (the actual binding in scope).
//   3. The `callKilo*` internal fetch calls (which are correct as
//      `model: model` since `model` is a parameter) are untouched.
//
// Re-run after any change to server.js.

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

// The 8 route handlers whose response payload was buggy.
const AFFECTED_ROUTES = [
  '/api/analyze',
  '/api/subject',
  '/api/camera-angle',
  '/api/actions',
  '/api/mood',
  '/api/lighting',
  '/api/texture',
  '/api/anima',
];

console.log('Regression smoke: route model-binding guard (Server.js #24)');
console.log('Bug: "Analysis failed: model is not defined" in 8 routes');
console.log('Fix: rename `model: model` → `model: llmModel` in response payloads');
console.log();

// For each affected route, extract the response payload block and
// assert NO `model: model` reference appears at the response-shape
// indentation level (6 or 8 leading spaces).
function findResponsePayloadBlock(src, routePath) {
  // Locate the route handler declaration.
  const routeDecl = `app.post('${routePath}'`;
  const idx = src.indexOf(routeDecl);
  if (idx === -1) return null;
  // Find the next `res.json({` after this declaration, then capture
  // the next ~12 lines.
  const jsonIdx = src.indexOf('res.json({', idx);
  if (jsonIdx === -1) return null;
  const block = src.slice(jsonIdx, jsonIdx + 600);
  return block;
}

let payloadBlocksFound = 0;

for (const route of AFFECTED_ROUTES) {
  // The /api/analyze handler uses a separate `responseData` object
  // multi-line, then `res.json({ success: true, data: responseData })`
  // on one line. Other routes use multi-line `res.json({...})` directly.
  // For /api/analyze specifically, look at the `responseData = {`
  // block instead.
  let block;
  if (route === '/api/analyze') {
    const idx = src.indexOf(`app.post('${route}'`);
    const rdIdx = src.indexOf('const responseData = {', idx);
    block = src.slice(rdIdx, rdIdx + 600);
  } else {
    block = findResponsePayloadBlock(src, route);
  }
  if (!block) {
    record(`Route ${route} response payload block found`, false, 'could not locate payload in handler');
    continue;
  }
  payloadBlocksFound += 1;
  // The payload must contain `model:` somewhere.
  const hasModelField = /model:\s*[a-zA-Z_$][a-zA-Z0-9_$]*/.test(block);
  record(`Route ${route} declares a model field in response payload`, hasModelField,
    hasModelField ? '' : 'no `model:` line in response payload');
  // The payload must NOT contain the buggy `model: model` reference.
  const hasBuggyRef = /model:\s*model\b/.test(block);
  record(`Route ${route} response payload does NOT reference undefined \`model\``,
    !hasBuggyRef, hasBuggyRef ? 'still references `model: model` (the bug)' : 'clean');
  // The payload MUST reference `model: llmModel` (the actual binding).
  const hasCorrectRef = /model:\s*llmModel\b/.test(block);
  record(`Route ${route} response payload references in-scope \`llmModel\``,
    hasCorrectRef, hasCorrectRef ? '' : 'missing `model: llmModel`');
}

// Spot check: the internal callKilo* fetch calls (which use `model: model`
// because `model` is a parameter there) must be untouched. Count them.
const internalModelRefs = (src.match(/^(\s{8,12})model:\s*model,/gm) || []).length;
record(`Internal callKilo* fetch calls still use parameter \`model\` (no regression)`,
  internalModelRefs >= 5, `found ${internalModelRefs} internal references (should be ≥ 5)`);

console.log();
if (failures === 0) {
  console.log(`${COLORS.pass}All checks passed.${COLORS.reset} ${payloadBlocksFound}/${AFFECTED_ROUTES.length} routes verified.`);
  process.exit(0);
} else {
  console.log(`${COLORS.fail}${failures} check(s) failed.${COLORS.reset}`);
  process.exit(1);
}
