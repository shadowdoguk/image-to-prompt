# Existing-Project Workflow

**Purpose:** A controlled path for working on projects that already exist. Different from greenfield — the first half is **understanding** before changing anything.

---

## Why a separate workflow

Greenfield has zero risk of breaking existing behavior — there's no behavior. Existing projects have users, deployed state, and unspoken assumptions baked into the code. The biggest AI-failure mode here is **confident rewriting of code we didn't understand**.

So: **read first, propose second, change third.**

---

## Phases

```
Ingest → Recon → Synthesize → Spec (delta) → Plan slices → Execute → Polish → Hand off
```

### Phase A — Ingest

**Goal:** Bring the codebase into the methodology's doc framework without changing any code.

**Steps:**
1. Create `/docs/` directory at the project root.
2. Create `docs/RECON.md` from the template.
3. Inventory the project: stack, structure, dependencies, scripts, env vars, data stores.
4. Identify run commands: dev, build, test, lint.
5. Verify the project actually runs (or document why it doesn't).

**Exit signal:** `RECON.md` is filled in and the project boots.

**No code changes allowed in this phase.**

### Phase B — Synthesize

**Goal:** Build a mental model of *what the project is for* by reading, not asking.

**Steps:**
1. Read README, top-level docs, top comments in main files.
2. Identify the one-line description (if it's not in README, write one).
3. Identify primary user, primary use case, primary surface (web app / CLI / API / library).
4. List observable behaviors you can verify by running the app.
5. Identify seams (where you can cut the code into testable units).
6. Note unknowns / surprises / smells.

**Exit signal:** You can describe the project to a stranger in 3 sentences and you'd both understand.

**No code changes allowed.**

### Phase C — Spec (delta)

**Goal:** Figure out *what's changing* before we change it.

Two modes:

| Mode | When | Output |
|---|---|---|
| **Continue** | Adding features to a working project | `docs/SPEC.md` for the *next* slice, cross-referenced to existing code |
| **Heal** | Project is broken / drifted | `docs/SPEC.md` for "make it work again" + audit of what's broken |

**Steps:**
1. Identify the delta — what's the user trying to accomplish?
2. Run Sync gate (G1): reflect back the ask, get confirmation.
3. Run Spec gate (G2): write slice plan, set kill criteria.
4. Use `docs/SPEC.md` for the slice. Reference existing code (paths + line numbers).

**No code changes yet.**

### Phase D — Plan slices

**Goal:** Run gate G3 (Architecture) for the *delta*, not the whole project. We're not re-architecting — we're fitting the change into the existing shape.

**Steps:**
1. Identify which seams the change touches.
2. Identify which tests already cover those seams.
3. Write slice plan: behavior + acceptance test + DoD, per slice.
4. Pre-mortem: top 3 ways this change fails.
5. Update ARCHITECTURE.md with the delta (don't rewrite the whole thing).

### Phase E — Execute

Identical to greenfield Phase 3: vertical slices, tests-first, demo gate, sequential, no speculative features.

### Phase F — Polish

Same as greenfield Phase 4. Particularly important on existing projects because drift has likely accumulated.

### Phase G — Hand off

If you're not the only contributor (or this project will be revisited by you in 6 months):

1. Update SESSION-STATE.md.
2. Update README if anything user-facing changed.
3. Commit in clean slices.

---

## What you can NEVER skip

- **Ingest + Synthesize.** AI agents that skip reconnaissance rewrite working code.
- **Demo gate (G4).** Even on existing projects. "I edited the right file" is not a demo; running the project is.
- **Reconcile test coverage.** If you're changing seam X and there are no tests at seam X, write them before changing.

---

## Anti-patterns specific to existing projects

| Pattern | Why it's bad |
|---|---|
| "Let me just refactor this while I'm in here" | Scope creep; you don't know what depended on the current shape |
| "I'll just rewrite this module, it's simpler" | Often true in the small, breaks invariants in the large |
| "I'll skip tests, they're flaky anyway" | Flaky tests are a *signal*, not a reason to ignore them |
| "The README is wrong, ignore it" | README may be wrong, but if so it's a sign of drift to fix |
| "I'll trust my reading of the code" | Run it. Verify. Then trust. |
| "Let me just `git reset --hard` to start over" | You don't remember what's working |

---

## When to use this workflow vs. greenfield

| Situation | Use |
|---|---|
| Brand new project, no code | Greenfield (skip Ingest, go straight to Sync) |
| Project exists, want to add features | Existing (full path) |
| Project exists, want to understand it before deciding what to do | Existing, stop after Synthesize |
| Project exists, want to fix bugs only | Existing but condensed: Ingest → Recon → bug → fix → Polish |
| Project exists but is broken / you don't understand it | Existing, "Heal" mode for Spec |
| Multi-repo or system of services | Existing + per-service slice plan |

---

## Templates added for this workflow

- `templates/RECON.md` — fills the Ingest phase
- `templates/SYNTHESIS.md` — fills the Synthesize phase
- (Other existing templates apply)