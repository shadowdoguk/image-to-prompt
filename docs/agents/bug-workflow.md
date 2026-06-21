# Bug Resolution Workflow

Operational protocol for the AI when a new bug is reported (by user, by smoke
test, by validation check, by `session-init.js`, or by runtime log signal).

## 1. Triage steps (do all, in order)

### 1.1 Reproduce
- Identify the minimum input that triggers the bug.
- If the bug surfaced from `session-init.js`, the report JSON includes the
  scanner, area, and detail — start there.
- If the bug surfaced from `server.log`, capture the full line and timestamp.
- If the user reports it, ask for: (a) input image characteristics (size,
  format, content), (b) preset ID, (c) browser/Node version, (d) full
  server response body or `curl` invocation.

### 1.2 Classify
Use the **bug class** vocabulary below to assign exactly one. The class
determines the workflow branch.

| Class | Definition | Examples |
|---|---|---|
| `config` | Wrong env var, missing file, bad path | `MINIMAX_API_KEY` not set; `data/` not writable |
| `data` | Corrupt or malformed persistent data | `presets.json` not valid JSON; preset missing required field |
| `drift` | Code, docs, and contracts disagree | README endpoint doesn't match server; package.json references missing dir |
| `runtime` | Crash, hang, or wrong output during execution | Stage 1 returns short fields; Stage 2 returns empty |
| `security` | Key/token/secret exposure, auth bypass | API key leaked into client bundle; sanitization regex missed |
| `ux` | Confusing behavior, broken affordance | Drag-drop silently rejects; regenerate button missing feedback |

### 1.3 Label
- Apply the matching triage label via `gh issue edit N --add-label "<label>"`.
- Allowed: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` (per `docs/agents/triage-labels.md`).
- New bug → `needs-triage`.
- After you classify and start work → `ready-for-agent`.
- If you need more info from the user → `needs-info` (do not start work).
- If you cannot reproduce → `needs-info` with the minimum repro request.

### 1.4 File the issue
Use `gh issue create` with this body template (include all sections; use
"Not applicable" if irrelevant, never leave blank):

```markdown
## Summary
<one sentence>

## Class
<config | data | drift | runtime | security | ux>

## Repro steps
1.
2.
3.

## Expected
<what should happen>

## Actual
<what happens>

## Environment
- Node version:
- OS:
- `MINIMAX_MODEL`:
- `MINIMAX_BASE_URL`:
- preset ID (if applicable):

## Logs / error output
```
<paste>
```

## Suggested fix area
<file(s) + function(s)>

## Acceptance criteria
- [ ] Repro steps no longer trigger the bug
- [ ] `node scripts/session-init.js` V-checks still pass
- [ ] If runtime class: `server.log` no longer contains the trigger pattern
- [ ] If drift class: README/server.js/CHANGELOG updated to match
- [ ] If config class: `.env.example` updated to document the required var
```

## 2. Priority assessment

| Priority | Trigger | SLA |
|---|---|---|
| `P0` | Production broken; security exposure; data loss | Same session — fix before any other work |
| `P1` | Core flow broken for some inputs (e.g., Stage 1 fails on real images) | Same day |
| `P2` | Edge case, best-effort field underperforms, length validation fires | This week |
| `P3` | Cosmetic, doc typo, code smell | Backlog |

If unsure, choose the higher priority and explain why in the issue.

## 3. Documentation requirements

### Always required
- Issue body populated with the template above.
- For `drift` class: cross-link the file pairs (e.g., `README.md:90` ↔
  `server.js:898`).
- For `runtime` class: paste the exact log line + 2 lines of context.
- For `security` class: include a redacted repro (no secrets) and a description
  of impact (which data leaks, who can exploit, what an attacker gains).

### When closing
- Add `Closes #N` to the closing commit message.
- Update the affected ADR if the fix changes an architectural decision.
- Update `CONTEXT.md` "Known gaps" if the gap is now closed.
- If the fix introduces a new constraint (e.g., new env var), update
  `.env.example` AND `README.md` AND `CONTEXT.md`.

## 4. Resolution workflow

1. **Reproduce in isolation.** A standalone script or curl invocation is
   better than relying on the UI.
2. **Diagnose.** Use the diagnose skill workflow (`/skill diagnose`):
   reproduce → minimise → hypothesise → instrument → fix → regression-test.
3. **Fix.** Smallest diff that resolves the bug. Do not refactor unrelated code.
4. **Regression-test.** Add a check:
   - For `runtime` class: a smoke-test snippet in `scripts/smoke/` (or, if
     `tests/` is created, a real test).
   - For `drift` class: a new V-check in `scripts/session-init.js`.
   - For `config` class: update `.env.example` and reference it from the issue.
5. **Verify with session-init.** Re-run `node scripts/session-init.js` and
   confirm validation pass rate does not regress and the specific V-check now
   passes.
6. **Close.** `gh issue close N --comment "..."` with a one-paragraph
   summary that includes the file paths changed.

## 5. Escalation rules

- **Bug class `security` + severity `P0`:** Stop all other work. Notify the
  user immediately with the impact description, the redacted repro, and a
  proposed mitigation. Do not commit a fix until the user approves the
  mitigation approach.
- **Bug class `drift` whose fix touches README.md:** Also update `CONTEXT.md`
  in the same commit.
- **Bug that requires a new ADR:** File the issue with `needs-triage`, write
  the ADR as `docs/adr/NNNN-title.md` with status `Proposed`, link them in
  both directions, wait for user approval before implementing.
