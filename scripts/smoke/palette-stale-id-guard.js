'use strict';

// Regression smoke for: "Analysis failed: Palette <id> not found."
// when state.selectedPaletteId holds an id that no longer exists in
// state.palettes (e.g. palette deleted via API/file while tab open).
//
// Bug class: runtime / ux
// Fix: src/app.js — analyze handler revalidates selectedPaletteId
// against state.palettes before appending to the FormData payload.
//
// This smoke is a static-source check (no server boot, no LLM call)
// because the fix is pure client logic. It confirms:
//   1. The analyze handler contains the revalidation guard.
//   2. The guard BOTH skips appending the stale id AND clears the
//      stale state (self-heal).
//   3. The happy path (selectedPaletteId in state.palettes) still
//      forwards paletteId to the FormData.
//
// Re-run after any change to src/app.js analyze handler.

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

// Pull out the analyze handler block — from "fd.append('image'" until
// the next "try {" that opens the apiCall('/api/analyze'). This keeps
// the regex specific to the actual analyze path.
const analyzeBlock = src.match(/fd\.append\('image'[\s\S]*?(?=\n\s*try\s*\{[\s\S]*?apiCall\('\/api\/analyze')/);
if (!analyzeBlock) {
  console.error('  [FAIL] Could not locate analyze-handler FormData block in src/app.js');
  process.exit(1);
}
const block = analyzeBlock[0];

// 1. Guard must reference state.palettes (revalidation source).
record(
  'analyze handler revalidates against state.palettes',
  /state\.palettes\.some\(\s*\(p\)\s*=>\s*p\.id\s*===\s*state\.selectedPaletteId\s*\)/.test(block),
  'expected: state.palettes.some((p) => p.id === state.selectedPaletteId)'
);

// 2. Guard must clear the stale id (self-heal).
record(
  'analyze handler clears stale selectedPaletteId',
  /state\.selectedPaletteId\s*=\s*null/.test(block),
  'expected: state.selectedPaletteId = null inside the stale branch'
);

// 3. Happy path must still forward paletteId when the id is valid.
record(
  'analyze handler still appends paletteId for valid ids',
  /fd\.append\('paletteId',\s*state\.selectedPaletteId\)/.test(block),
  'expected: fd.append("paletteId", state.selectedPaletteId)'
);

// 4. Defensive comment explaining WHY the guard exists (regression
// armor — makes the intent obvious to future maintainers).
record(
  'analyze handler has an explanatory comment',
  /stale|revalidat|self-heal/i.test(block),
  'expected: a comment mentioning stale/revalidate/self-heal'
);

console.log('');
if (failures === 0) {
  console.log(`${COLORS.pass}palette-stale-id-guard: all checks passed${COLORS.reset}`);
  process.exit(0);
} else {
  console.log(`${COLORS.fail}palette-stale-id-guard: ${failures} check(s) failed${COLORS.reset}`);
  process.exit(1);
}