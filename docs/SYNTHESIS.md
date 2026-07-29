# SYNTHESIS.md — image-to-prompt

**Date:** 2026-07-29
**Built on:** `docs/RECON.md`

---

## 1. The elevator pitch

An image-to-prompt generator for AI artists. You upload a JPG/PNG/WebP, optionally type a base intent, and the app returns a refined, detailed text prompt — structured into 14 fields (subject, orientation, actions, style, mood, colors, lighting, composition, era, camera angle, texture, medium, depth of field, contrast) — that's optimised for downstream image generators (Stable Diffusion, Midjourney, DALL-E, Flux). The whole thing runs against MiniMax M3 (`MiniMax-Text-01`) for vision + text completion, behind a single-page vanilla-JS frontend.

A stranger hearing this should immediately understand: *what it does, who it's for, why it exists*.

## 2. The primary user

An AI artist iterating on image generation prompts. They likely:
- Generate images with multiple backends (SD/MJ/DALL-E/Flux) and want prompts that translate well.
- Care about structured prompts (subject, style, mood, lighting, etc.) rather than freeform prose.
- May run the same image through analysis multiple times, tweaking fields and palettes.
- Value reusability: saved palettes, saved directives, presets per field.

Their life before this app: manually write prose prompts, copy-paste into MJ or SD, iterate blind. Their life after: upload image → review structured fields → tweak → save → ship.

## 3. The primary surface

**What the user touches:** the web frontend (`src/index.html` + `src/app.js` + `src/styles.css`). Drag-and-drop or click-to-upload, real-time image preview, structured field editor, copy-to-clipboard, palette/directive/preset management modals.

**Main loop:** upload image → analyze → review 14 structured fields → tweak (optionally using AI buttons per field) → generate final prompt → copy to clipboard.

**The one thing they do repeatedly:** upload + analyze. Everything else (palette management, directive CRUD, presets) is around that core loop.

## 4. Observable behaviors (verifiable via the running server)

| # | Behavior | How to verify | Works? |
|---|---|---|---|
| 1 | Frontend serves at `/` | `curl /` → HTML | ✅ 200 (37,947 bytes) |
| 2 | Static assets served | `curl /styles.css`, `/app.js` | ✅ 200 (53K + 198K) |
| 3 | `/api/health` reports provider + field palette | `curl /api/health` | ✅ returns full schema of 14 fields |
| 4 | `/api/presets` lists field presets | `curl /api/presets` | ✅ 200 (34K) — heavy payload, lots of presets |
| 5 | `/api/palettes` lists saved color palettes | `curl /api/palettes` | ✅ 200 (4K) |
| 6 | `/api/directives` lists saved Stage-2 directives | `curl /api/directives` | ✅ 200 (1K) |
| 7 | `/api/subject-prompt` returns current subject template | `curl /api/subject-prompt` | ✅ 200 (13K) |
| 8 | `/api/analyze` returns 14-field structured analysis | (POST with image, deferred — would hit MiniMax) | ⏸ deferred (no MiniMax hit) |
| 9 | Per-field AI buttons (`/api/actions`, `/api/mood`, `/api/lighting`) | (POST, deferred) | ⏸ deferred |
| 10 | `/api/generate-prompt` returns the final prompt text | (POST, deferred) | ⏸ deferred |

**All observable behaviors that don't require the MiniMax API are working.** The ones that do (analysis + final-prompt generation) are deferred — they're the *behavior-defining* calls, but verifying them is the smoke test we agreed to defer.

**Response envelope:** every API response uses `{ success: bool, data: ... }`. Consistent across all GETs probed.

**Field schema (from `/api/health`):** 14 fields with explicit `type`, `label`, `input`. Six are `textarea` (subject, orientation, actions, mood, composition, texture), five are `text` (style, lighting, era, camera_angle, artistic_medium, depth_of_field, contrast), one is `colors` (array of `{hex, name}`).

## 5. Seams (where the code can be cut)

The route table is **44 endpoints** in a single 287KB `server.js`. The natural seams are visible in the route paths:

| Seam | Where | What it does | Testable? |
|---|---|---|---|
| `/api/presets/*` | server.js lines ~3569–3780 | CRUD + import/export of per-field presets | ✅ fully testable (no MiniMax) |
| `/api/palettes/*` | server.js lines ~4434–4740 | CRUD + versioning + distribution of color palettes | ✅ fully testable (no MiniMax) |
| `/api/directives/*` | (presumably near palettes) | CRUD + versioning + import/export of Stage-2 directives | ✅ fully testable |
| `/api/subject-prompt`, `/api/stage2-prompt` | lines ~4125–4290 | Stage templates with GET/PUT/DELETE | ✅ fully testable |
| `/api/analyze`, `/api/subject`, `/api/camera-angle`, `/api/actions`, `/api/mood`, `/api/lighting` | lines ~3799–4120 | MiniMax vision calls — one per field | ⏸ needs MiniMax |
| `/api/generate-prompt` | line ~4286 | Final prompt composition | ⏸ needs MiniMax |

**Implication for refactors:** if a future slice needs to modify a *non-vision* seam (presets, palettes, directives, prompts), it can be tested independently of MiniMax. **If it modifies a vision seam, it needs the API or a mock.**

**`server.js` at 287KB:** the per-feature route groups above are the natural *external seams*; the next-deepening opportunity is to split each group into its own module behind `require('./routes/<feature>')`. **Wide refactor** (PRINCIPLES.md §6.3): expand → migrate batches → contract. Not for this slice unless a slice needs to touch multiple feature groups.

## 6. Invariants (rules the code assumes to be true)

| Invariant | Where enforced | What breaks it |
|---|---|---|
| Every API response uses `{ success, data }` envelope | Implicit (every route hand-coded) | Adding a new endpoint without the envelope breaks the frontend's response parser |
| `data/*.json` files are valid JSON at all times | Implicit — direct file I/O in routes | A malformed write corrupts state; no migration story |
| `data/<feature>.json` schemas are stable | Implicit — no migration | Adding a field to a palette/directive/preset object breaks reads of old files |
| MiniMax API key is configured server-side | `.env` + server.js startup check | Boot fails fast if missing (good) |
| Subject prompt has a current value | `data/subject_prompt.json` | Stage 2 prompt generation likely fails without it |
| One file per uploaded image in `uploads/` | multer config | Cleanup of stale uploads is undefined (likely manual) |

The JSON-state invariants are the **fragile points** in this codebase. Any future slice that changes a schema should be paired with a one-time migration script (park as ADR-worthy).

## 7. Unknowns / surprises / smells

| Item | What I see | Why it's a worry |
|---|---|---|
| 22 ADRs in `docs/adr/` | Real, varied design history | Need to skim recent ones before suggesting changes that contradict them |
| `docs/superpowers/` directory | Present, contents uninspected | Could be skill snapshots or stale scaffolding |
| `server.js` at 287KB, 44 routes | Single fat entrypoint | Refactor candidate, but not until a slice needs it |
| `data/*.json` direct I/O | No migration story | Risk for any schema change |
| `uploads/` directory | No cleanup policy observed | Disk will grow |
| No CI config | Tests run manually | Either a gap or an explicit choice |
| `_tmp/` and `.tmp/` both exist | Looks like temp file leakage | Minor smell |
| `start.log` in `.data/` | Plain-text log, presumably unbounded | Could grow forever |

## 8. Drift

| Where | What it says | What the code does |
|---|---|---|
| AGENTS.md (now merged) | Suggests `docs/agents/` for runtime workflows | Now coexists with `docs/PRINCIPLES.md` for methodology. Both valid; merged AGENTS.md reconciles them. |
| `CONTEXT.md` (20K, root) | Project glossary | Authoritative; symlinked from `docs/CONTEXT.md`. |
| `docs/agents/` | Project-runtime workflows | Untouched by us; project-native. |
| `docs/adr/` | ADRs | Untouched by us; project-native. |
| `docs/superpowers/` | ??? | Untouched. Inspect during Phase C. |

**No critical drift detected** — the project is internally consistent; we just added a parallel methodology system alongside the existing one.

## 9. Where the risk lives

If I had to bet where the next bug will come from:

1. **JSON-file state migrations.** Any future slice that changes a palette / directive / preset schema hits this first. Mitigation: add a "migration step" entry to the slice plan; never modify `data/*.json` shape silently.
2. **MiniMax API contract changes.** The model behind `/api/analyze` etc. could change field names or response shape. Mitigation: type-check the MiniMax response and surface 502 if it doesn't match.
3. **`server.js` accretion.** The single file grows by ~1KB per route. Eventually a slice needs to touch multiple route groups and the file becomes unmaintainable. Mitigation: trigger an expand-contract refactor when a slice needs to touch ≥3 feature groups, OR when the file crosses ~400KB.
4. **Test coverage gaps.** Only 3 test files observed; feature groups (presets, palettes, directives) likely undertested given their CRUD-heavy nature. Worth a coverage audit as a separate housekeeping task.

## 10. One-line verdict

> A mature, mid-life single-process Node/Express app with a clean vanilla-JS frontend, 22 ADRs of disciplined history, one fat `server.js` (287K, 44 routes) that needs splitting eventually but not yet, JSON-file state with no migration story, and an external MiniMax M3 dependency for the vision/generation core. **Active, healthy, low-drift. Continue mode, not heal mode.**

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-29 | Initial synthesis | Phase B of `goose-review` |