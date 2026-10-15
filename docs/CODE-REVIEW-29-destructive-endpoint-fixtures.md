# CODE-REVIEW-29-destructive-endpoint-fixtures

**Slice:** H1 — destructive-endpoint test fixtures (BACKLOG "Test fixtures for destructive endpoints")
**Date:** 2026-10-15
**Verdict:** pass

## Two-axis verdict summary

| Axis | Verdict | Note |
|---|---|---|
| Standards | pass | Helper is single-purpose, sync, opt-in. Legacy pattern retained. New helper uses the project's `assertTrue` primitive (not Node's `assert`). Doc comments explain the contract. |
| Spec | pass | All 5 SPEC §29 explicit behaviours exercised; one static-source anchor; no regression in 672 baseline. |

## Reviewer

Inline review (goose direct). Same precedent as Slice 1, Slice 27, IR-1…IR-7: this environment does not register the `general-purpose` sub-agent for the methodology's "Standards + Spec" reviewer pair. Output shape mirrors what the sub-agent would have produced per `docs/PRINCIPLES.md` §6.5.

## Standards axis — findings

### S1 — Helper is single-purpose

The new helper does one thing: snapshot a file at entry, run `body()`, restore (or remove) at exit. There is no interaction with `server.js`, the network, the test runner, or anything else. Single-purpose. **Pass.**

### S2 — Helper coexists with the legacy trio rather than superseding

Initial plan A was to migrate the 30+ existing chat-snapshot call sites to the new helper. A regex-driven migration attempt failed because (a) some sites are inside async test bodies (`await startTestServer()`) where the sync helper is a poor fit, and (b) some bodies contain nested try/finally patterns that a simple regex can't safely rewrite. Rather than ship a broken migration, the slice keeps the legacy `snapshotChatFile` / `restoreChatFile` / `resetChatFile` trio alongside the new helper. The legacy helpers are unchanged in behaviour. A follow-up slice can do the careful migration. **Pass** — decision documented inline in the helper's docstring and in SPEC §29.

### S3 — Uses the project's own assertion primitives

The original draft called `assert(...)` (Node 18's built-in). `node tests/run-all.js` failed with "assert is not defined" — the test file's scope didn't get Node's `assert` global. Fix: use `assertTrue(...)` (the project's primitive) for the non-reentrant guard. **Pass** post-fix.

### S4 — Sync API matches sync test bodies

The new helper is synchronous. Sync test bodies are the dominant pattern in this codebase. The async test bodies (`await startTestServer()`) continue to use the legacy `snapshotChatFile` pattern. API surface is appropriately scoped to its primary use case. **Pass.**

### S5 — No new dependencies

The helper uses `path`, `fs`, and the project's own `assertTrue`. No new `package.json` entries. **Pass** — explicitly required by PRE-MORTEM §29 R-3 mitigation.

### S6 — Error-then-restore ordering is correct

If `body()` throws, the helper:
1. Calls `onError(err)` if provided (catch block).
2. Re-throws (catch block fall-through).
3. Restores the file (finally block).

Both the onError and the re-throw happen BEFORE the finally restores. The finally is unconditional. **Pass** — verified by SPEC §29 test #2 ("helper restores the file even when body throws").

### S7 — Docstring points future destructive tests at the helper

The helper's doc comment says "new destructive-endpoint tests should adopt `withDataFileSnapshotted` directly." A second reference appears in the helper section of the file: "see SPEC §29 scope note above." **Pass** — anchors the migration story for future slices.

## Spec axis — findings

### Sp1 — All five SPEC §29.4 / §29.5 behaviours tested

| SPEC §29.4 / §29.5 behaviour | Test |
|---|---|
| Normal-exit restore | "helper restores the file on a normal exit (no throw)" |
| Throw-exit restore | "helper restores the file even when body throws" |
| Pre-absent-file case | "helper removes the file if it was absent before body ran" |
| Helper return value | "helper returns whatever body returns" |
| Non-reentrant contract | "helper is non-reentrant (nesting is rejected)" |
| Static-source anchor | "withDataFileSnapshotted is exported and references SPEC §29" |

**Pass** — 6/6 behaviours covered; 678/678 tests green (was 672; +6 net new).

### Sp2 — `restoreChatFile` / `snapshotChatFile` baseline untouched

All 30+ existing chat-snapshot call sites continue to compile and pass. The two legacy helpers (and `resetChatFile`) are restored verbatim from the source-grep of the original file. **Pass** — verified by the chat ADR 0011 + 0011a + IR test suites all remaining green.

### Sp3 — No regressions in the 672 baseline

`grep -E '\[31m✗' node tests/run-all.js` returns zero failures. Specifically:
- Chat tests: 100+ tests across ADR 0011 / 0011a / 0012 / 0014 / 0019 / 0021 / 0029 / Slice 2 / Slice 26 / Slice 27 / IR-1…IR-7 — all green.
- Non-chat tests: untouched.

**Pass** — full test surface is 678/678.

### Sp4 — File-name contract is explicit

The helper takes `fileRel` (relative) and resolves against `PROJECT_ROOT/data`. The doc comment says "gitignored files under `data/` only." Future destructive tests can identify candidates by checking `.gitignore` for their target filename. A static-source anchor in the helper says this explicitly. **Pass.**

### Sp5 — `onError` hook gives the caller observation without altering re-throw

The helper's catch block routes the error through `onError(err)` if the caller supplies one, then re-throws. Tested in "helper restores the file even when body throws" (asserts `onError` received the throw, asserts the re-throw happened at the wrapper's outer try, asserts the file was restored). **Pass.**

### Sp6 — Edge case: helper removes only just-created file, not pre-existing

Test "helper removes the file if it was absent before body ran" seeds no file, the body creates one, and the helper removes the post-exit file. Symmetric: if the file pre-existed, the helper writes back the original contents (test #1). **Pass.**

## Pass+minor

S8 — *Minor:* The helper does not enforce the "gitignored files only" contract programmatically. A future migration / direct usage on a tracked file would silently corrupt that file. Mitigation: doc comment + project-wide pattern recognition (every gitignored file under data/ is in `.gitignore` already). If a regression occurs, a follow-up PR can add a `.gitignore`-intersect check. Not blocking.

## Final verdict

**pass** (Standards + Spec). Slice H1 is ready for G5 (POLISH-AUDIT).

## Files reviewed

- `tests/run-all.js` — new helper + 6 new tests (was 672; now 678 / 0)
- `docs/SPEC.md` — §29 added with explicit scope (helper only; migration deferred)
- `docs/ARCHITECTURE.md` — §29 added (A1–A4)
- `docs/PRE-MORTEM.md` — §29 pre-mortem (R-1 to R-4; P-1 to P-3; K-1)
