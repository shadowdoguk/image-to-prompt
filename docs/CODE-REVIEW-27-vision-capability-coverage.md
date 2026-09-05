# docs/CODE-REVIEW-27-vision-capability-coverage.md

**Slice:** Slice 26 — Chat-attachment vision-capability data model
**Class:** CR-fix per `docs/agents/bug-workflow.md`
**Verdict:** pass
**Reviewer:** goose (inline review; the `general-purpose` sub-agent source is not registered in this goose installation, output shape mirrors what the sub-agent would have produced per docs/PRINCIPLES.md §6.5)
**Date:** 2026-09-05

## Summary

Two-axis review (Standards + Spec) over the files touched by Slice 26 (`server.js`, `tests/run-all.js`, `docs/adr/0026-…`, plus the four doc appends). Verdict: **pass**.

## Axis 1 — Standards (project conventions)

- [x] `server.js` change is module-local and respects the existing layout (Set colocated with `ALLOWED_LLM_MODELS_BY_PROVIDER`).
- [x] `tests/run-all.js` follows the existing `test(...)` + `assertTrue/Equal` + `fs.readFileSync(path.join(PROJECT_ROOT, …))` pattern.
- [x] ADR 0026 mirrors the structure of ADR 0025 (Status / Date / Origin / Context / Decision / Rejected alternatives / Consequences / Verification / References).
- [x] SPEC §21 matches the established slice-style headings.
- [x] ARCHITECTURE §26.A1–A5 appendix mirrors the CR-A1…CR-A6 appendix style.
- [x] PRE-MORTEM §26 entry mirrors the CR-series entry style.
- [x] All edited files parse cleanly under `node --check`.
- [x] No new dependencies, no `package.json` change.
- [x] No style or rename of a shared symbol — `VISION_CAPABLE_MODELS` is brand-new, not a rename.

## Axis 2 — Spec (does it do what §21 says it should)

- [x] Regex is removed (no more `ALLOWED_CHAT_ATTACHMENT_VISION_MODELS` anywhere in the source).
- [x] `VISION_CAPABLE_MODELS = new Set([...])` is colocated with `ALLOWED_LLM_MODELS_BY_PROVIDER`.
- [x] Consumer `buildUserMessageWithAttachments` uses `VISION_CAPABLE_MODELS.has(...)` (not the legacy `.test(...)`).
- [x] Set covers the three previously-failing Kilo Code models (`openai/gpt-5.6-luna`, `x-ai/grok-4.3`, `nvidia/nemotron-3-ultra-550b-a55b`).
- [x] Set correctly excludes the lone text-only Alibaba model `qwen3-max`.
- [x] All five regression tests are static-parse based (no server boot, <10 ms each).
- [x] Update rule documented inline in server.js (Set comment block) + ADR 0026 §3.

## Open observations (none blocking)

- The Set is module-local. A future capability-table refactor (ADR 0026 §2 rejected alternative) could replace it with `metadata.has(provider, model, 'vision')` without reshaping the consumer. Out of CR-26 scope.
- The orchestrator's `image_url` forwarding for vision-capable models across providers is already exercised by the existing `orchestrateEndpoint(stage1, minimax)` test at `tests/run-all.js:9621+`. A live browser demo would consume one MiniMax/Kilo credit; not required for CR-fix track per docs/agents/bug-workflow.md.
- UI capability badges (SPEC §15.7 "Model capability metadata") remain parked in BACKLOG.

## Verdict

**pass.** Slice 26 lands cleanly. The 5 regression tests lock the contract. No follow-up code action required.
