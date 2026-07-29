# PROJECT-README.md — image-to-prompt

**Workflow:** existing (continue mode)
**Created:** 2026-07-29 (methodology bootstrapped via `goose-review`)
**Bootstrapped from:** pre-existing project, mid-life, active development

---

## What this is (one paragraph)

An AI-powered web application that transforms uploaded images into refined, detailed text prompts optimized for AI image generation models (Stable Diffusion, Midjourney, DALL-E, Flux). Powered by MiniMax M3 (`MiniMax-Text-01`). Single-page vanilla-JS frontend, Express backend, JSON-file state, 44 API endpoints, 22 ADRs of design history.

## Why it exists (the problem it solves)

AI artists iterating on prompts need structured output, not freeform prose. Manually composing subject/style/mood/lighting/etc. into a coherent prompt is tedious and inconsistent across image generators. This app extracts a 14-field structured analysis from any uploaded image and assembles the final prompt.

## Who it's for (the primary user)

An AI artist using SD / Midjourney / DALL-E / Flux who:
- Wants structured prompts (14 named fields) not prose
- Iterates on saved palettes, directives, presets
- Wants the same image analyzed multiple ways quickly

## The ONE thing it does well

**Upload an image, get a refined 14-field structured prompt in under 30 seconds.**

If this project succeeds, this is the single capability it nails.

## Current status

| Field | Value |
|---|---|
| Phase | Phase B complete (Synthesis done). Phase C next — pick the first slice. |
| Server | Running on http://localhost:3100 (was up at bootstrap time) |
| Last completed slice | n/a — methodology is brand new to this project; no slices yet |
| Frontier | empty — no slice plan yet |
| Open questions | 3 (see Phase C proposal below) |
| Kill criteria status | n/a — set at Gate G2 when first spec lands |
| Session count | 1 (this is the bootstrap session) |

## Where to start reading

**Cold start (60 seconds):**

1. **You are here.** ✓
2. `AGENTS.md` — how to work in this project (merged: project-runtime + App Build methodology).
3. `CONTEXT.md` — the project glossary (sharp domain terms, 20K of real content).
4. `docs/SESSION-STATE.md` — current state, frontier, mood.
5. If new ADRs since you last looked, read those in `docs/adr/NNNN-*.md`.

**Cold start (5 minutes):**

6. `docs/RECON.md` — the inventory.
7. `docs/SYNTHESIS.md` — the mental model.
8. `docs/PRINCIPLES.md` — methodology reference (read-only).
9. The most recent 2–3 ADRs in `docs/adr/` (recent design context).
10. `README.md` (34K — feature overview).

## In scope (current project, as observed)

- Express server + vanilla-JS frontend (no build step)
- 14-field structured prompt analysis via MiniMax M3 vision
- Saved palettes, directives, presets (with versioning + import/export)
- Per-field AI buttons for actions / mood / lighting (ADR 0018)
- Subject + Stage 2 prompt templates (editable, persistable)
- Cross-browser dnd + chip interaction tests

## Out of scope (current project, as observed)

- Social login / multi-user accounts
- Database (state is JSON files in `data/`)
- Mobile app
- Build step / bundler
- TypeScript
- CI / CD pipeline
- Server.js split into multiple files (would be a wide refactor)

## Stack (one-line per layer)

| Layer | Choice |
|---|---|
| Language | JavaScript (CommonJS) |
| Runtime | Node.js >= 18 |
| Framework | Express 4.21 |
| View layer | Vanilla HTML/CSS/JS (no build) |
| File upload | Multer 1.4.5-lts |
| Drag-and-drop | SortableJS 1.15 |
| External API | MiniMax M3 (`MiniMax-Text-01`) |
| Config | dotenv 16 |
| Tests | Bespoke Node scripts (no framework) |

## Slices (current plan)

**No slice plan yet.** The methodology just landed; the next step (Phase C) is to pick what to work on next.

## Pointers

- **Methodology reference:** `docs/PRINCIPLES.md` (read-only)
- **Existing-project discipline:** `docs/EXISTING-PROJECT-WORKFLOW.md`
- **Background on the methodology:** `docs/COMPARISON-MATTPOCOCK.md`
- **Project inventory:** `docs/RECON.md`
- **Project mental model:** `docs/SYNTHESIS.md`
- **Project glossary:** `CONTEXT.md` (= `docs/CONTEXT.md` via symlink)
- **ADRs:** `docs/adr/NNNN-*.md` (22 and counting; this project's home for design decisions)
- **Project-runtime agent workflows:** `docs/agents/*` (session-init, triage, drift-prevention)
- **Worked example (methodology in motion):** `~/.goose/methodology/examples/reading-list/README.md`

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Initial overview | `goose-review` bootstrap |
| 2026-07-29 | Methodology reconciled with project: CONTEXT.md symlinked, DECISIONS.md removed, AGENTS.md merged | Phase A reconciliation per user decision |