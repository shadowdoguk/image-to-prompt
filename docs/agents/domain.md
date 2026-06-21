# Domain Docs

Single-context layout.

## Files

- `CONTEXT.md` — domain language, concepts, and entities for this project.
- `docs/adr/NNNN-title.md` — architectural decision records.

## Consumer rules

- Skills read `CONTEXT.md` first to learn the project's domain language.
- Skills read `docs/adr/` to understand past architectural decisions before proposing changes.
- When a skill needs both, it reads `CONTEXT.md` first, then the most recent ADRs.