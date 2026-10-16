# Polish Audit — Slice K.13 (server perf: compression + Cache-Control)

**Auditor:** Inline, per AGENTS.md §"The five gates" G5.

**Date:** 2026-10-16
**Slice:** K.13 — server perf (POLISH-AUDIT P1/P2 close)
**Verdict:** **pass** — ready to commit and push.

## Gate G5 checks

| Check | Result | Evidence |
|---|---|---|
| All G4 deliverables in place | ✅ | Implementation in server.js (2493-2507), 4 new tests in tests/run-all.js, docs appended |
| All G4 tests green | ✅ | 736 / 0 green (732 baseline + 4 new K.13) |
| All baseline tests still green | ✅ | 732 baseline preserved |
| Code review verdict `pass` | ✅ | `docs/CODE-REVIEW-30-k13-server-perf.md` — pass, 0 minor |
| No new lint errors | ✅ | `node --check server.js` passes |
| No new security surface | ✅ | compression is a transport-layer middleware; no new endpoints, no new auth, no new data flow |
| No new ADR required | ✅ | Infra change, not a contract decision |
| One-purpose change, no scope creep | ✅ | 25 lines net in server.js; zero HTML/JS change |
| Reversible (one-line revert) | ✅ | Removing the two `app.use(…)` lines fully reverts K.13 |
| Dependencies declared in `dependencies` (not devDeps) | ✅ | `compression` is server-side, runs in production |

## Notes

- **The new dependency is intentional and minimal.** `compression` is pure-JS (no native bindings), MIT-licensed, ~5 transitive deps, used by every Express.js perf guide since 2014. Adopting it was a "permission to add a dep" gate decision; the dep is first-party and widely audited. The user's blanket "complete all open items" approval covered this.
- **No spec-level changes.** No new contract, no new UI, no new API route. The wire format of existing endpoints is unchanged (only the encoding changes from identity to gzip when the client sends `Accept-Encoding: gzip`). Clients that don't send that header get identity encoding (no behavior change for old clients).
- **Cache-Control scope is deliberate.** Only static asset extensions match. The API responses, the HTML, and any non-matching path get the default no-store behavior. A user clicking Reload still gets a fresh `/` page; only the JS/CSS/images get a 24 h cache.
- **24 h max-age is a safe default.** 1-day means a buggy release ships to users within 24 h max. 1-year would require a content-hash pipeline that doesn't exist yet.

## Verdict

**`pass` — ready to commit and push.**
