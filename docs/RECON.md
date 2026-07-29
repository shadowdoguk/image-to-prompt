# RECON.md — image-to-prompt

**Recon by:** Goose
**Date:** 2026-07-29
**Recon path:** `/home/david/shadowdog-dev/projects/image-to-prompt`

---

## 1. Identification

| Field | Value |
|---|---|
| Project name | image-to-prompt |
| One-line description | AI-powered web app that transforms uploaded images into refined, detailed text prompts optimized for SD / Midjourney / DALL-E / Flux, powered by MiniMax M3. |
| Primary surface | Web app (Express server + vanilla HTML/CSS/JS frontend, no build step) |
| License | MIT |
| Latest activity | server.js, CONTEXT.md, AGENTS.md updated Jul 21; node_modules pinned Jun 29 |
| Maturity | Mid-life — active development, 22 ADRs filed, README references ADR 0018 (recent feature work) |

## 2. Stack (observed)

| Layer | Choice | Evidence |
|---|---|---|
| Language | JavaScript (CommonJS) | `package.json` `"type": "commonjs"` |
| Runtime | Node.js >= 18 | `package.json` `engines.node` |
| Framework | Express ^4.21.0 | `dependencies.express` |
| View layer | Vanilla HTML/CSS/JS, no build step | `src/index.html`, `src/app.js`, `src/styles.css` |
| File upload | Multer ^1.4.5-lts.1 | `dependencies.multer` |
| Drag-and-drop | SortableJS ^1.15.7 | `dependencies.sortablejs` |
| External API | MiniMax M3 (`MiniMax-Text-01`) | `.env.example` + README |
| Config | dotenv ^16.4.5 | `dependencies.dotenv` |
| Process model | Single Node process, `node server.js` | `package.json` scripts |
| Tests | Bespoke Node scripts, no framework | `tests/run-all.js` orchestrator |

**Notable:** No TypeScript. No build step. No ORM or database.

## 3. Dependencies (5 total)

| Package | Version | Role | Notes |
|---|---|---|---|
| express | ^4.21.0 | HTTP server | Standard |
| multer | ^1.4.5-lts.1 | multipart upload | Standard |
| dotenv | ^16.4.5 | env config | Standard |
| sortablejs | ^1.15.7 | UI drag-and-drop | Used for chip reordering per README |
| — | — | (no devDependencies) | Tests are bespoke Node scripts |

## 4. File / folder layout (top 2 levels)

```
image-to-prompt/
├── AGENTS.md             ← merged: project-runtime + App Build methodology v2
├── CONTEXT.md            ← 20K, project glossary (canonical)
├── README.md             ← 34K, thorough
├── package.json
├── server.js             ← 287K — single fat entrypoint
├── src/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── scripts/
│   ├── make-icon.py
│   ├── session-init.js
│   ├── smoke/            ← (presumably smoke-test scripts)
│   └── start-detached.sh
├── tests/
│   ├── dnd-cross-browser.js
│   ├── lighting-chips-cross-browser.js
│   └── run-all.js
├── data/                 ← JSON state files (no DB)
│   ├── chat_sessions.json
│   ├── directives.json
│   ├── palette_runs.json
│   ├── palettes.json
│   ├── presets.json
│   ├── stage2_overrides.json
│   └── subject_prompt.json
├── .data/                ← logs (start.log)
├── uploads/              ← uploaded image artifacts
├── docs/                 ← (after bootstrap) contains pre-existing adr/, agents/, reports/, superpowers/ + methodology templates
├── .opencode/            ← state dir for opencode agent runtime
├── .superpowers/         ← (private) agent runtime
├── .tmp/                 ← temp files
└── node_modules/
```

**Surprises:**

- `server.js` is **287KB** — single-file backend is unusually large; likely grew by accretion. Strong candidate for a future expand-contract refactor.
- `CONTEXT.md` already exists at root (20K, substantive). It's the project's actual glossary. We symlinked `docs/CONTEXT.md` → `../CONTEXT.md` so both paths work.
- 22 ADRs already filed in `docs/adr/NNNN-*.md` (more than the README's reference to ADR 0018 implied). Our `docs/DECISIONS.md` template was redundant and removed.
- Pre-existing `docs/agents/` directory with session-init, issue-tracker, drift-prevention, success-criteria docs — this project's own agent-runtime system, separate from our methodology.
- Pre-existing `docs/reports/` — likely operational reports.
- Pre-existing `docs/superpowers/` — possibly skill snapshots.

## 5. Commands

| Action | Command | Source |
|---|---|---|
| Install | `npm install` | README |
| Start (prod) | `npm start` → `node server.js` | package.json |
| Dev (auto-reload) | `npm run dev` → `node --watch server.js` | package.json |
| Test | `npm test` → `node tests/run-all.js` | package.json |
| Session init | `npm run session:init` → `node scripts/session-init.js` | package.json + AGENTS.md §1 |
| Start detached | `bash scripts/start-detached.sh` | scripts/ |
| Smoke | `scripts/smoke` (assumed) | scripts/ |

## 6. Environment

| Variable | Required | Purpose | Source of truth |
|---|---|---|---|
| `MINIMAX_API_KEY` | yes | MiniMax M3 vision API key | `.env.example` |
| `MINIMAX_BASE_URL` | yes | API base URL (default `https://api.minimaxi.chat/v1`) | `.env.example` |
| `MINIMAX_MODEL` | yes | Model name (default `MiniMax-Text-01`) | `.env.example` |
| `PORT` | no (defaults 3100) | Server port | `.env.example` |
| `NODE_ENV` | no | Env mode | `.env.example` |
| `MAX_FILE_SIZE_BYTES` | no (defaults 10MB) | Upload limit | `.env.example` |

## 7. Data stores

**No database.** State lives in JSON files in `data/`:

- `chat_sessions.json`
- `directives.json`
- `palette_runs.json`
- `palettes.json`
- `presets.json`
- `stage2_overrides.json`
- `subject_prompt.json`

Single-process state model. **No migrations, no schema.** Reads/writes are direct JSON file I/O. Concurrency = whatever Node's fs + single-process model gives you.

## 8. External services

| Service | Purpose | Auth |
|---|---|---|
| MiniMax M3 (`MiniMax-Text-01`) | Vision + text-prompt generation | API key in env (`MINIMAX_API_KEY`) |

## 9. Tests (observed)

| Type | Count | Location |
|---|---|---|
| Orchestrator | 1 | `tests/run-all.js` |
| Cross-browser scripts | 2 | `tests/dnd-cross-browser.js`, `tests/lighting-chips-cross-browser.js` |
| Framework | None — bespoke Node scripts | n/a |

## 10. Smoke test result

**Deferred — pending user sign-off before booting.** Booting `npm start` would hit the MiniMax API and could mutate state under `data/`. **Stop and ask** before running.

## 11. Known TODOs / FIXMEs (rough scan)

Not yet grepped; will capture during SYNTHESIS.md build.

## 12. Smells / red flags

- **`server.js` at 287KB.** Single file with likely-accreted routes, handlers, and helpers. **Strong candidate** for an expand-contract refactor (PRINCIPLES.md §6.3) once a slice needs to modify it — not now.
- **JSON-file state with no migration story.** Schema changes to `data/*.json` could break existing files. **Risk area** for the colour-palette / directive / preset features.
- **Three docs systems** (now reconciled): pre-existing `AGENTS.md` + `CONTEXT.md` + `docs/adr/` + `docs/agents/`, plus the App Build methodology template set. Two are now symlinked/merged; the others live side-by-side.
- **`docs/superpowers/` directory** — I don't know what this is yet. May be a snapshot of installed skills. Note as a smell until inspected.
- **No CI config observed** (no `.github/workflows/`, no `.gitlab-ci.yml`). Tests run manually via `npm test`. Worth noting as either a gap or an explicit choice.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Initial recon | Phase A of `goose-review` |