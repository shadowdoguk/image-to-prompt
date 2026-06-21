# Issue Tracker — GitHub

Issues for this repo live in **GitHub Issues**.

## CLI

Use the [`gh`](https://cli.github.com/) CLI to read and write issues.

## Common commands

- List open issues: `gh issue list`
- View issue N: `gh issue view N`
- Create issue: `gh issue create --title "..." --body "..." --label "..."`
- Apply label: `gh issue edit N --add-label "<label>"`
- Close issue: `gh issue close N`

## Conventions

- One issue per concern (bug, feature, task).
- Apply a triage label when creating if the state is known.
- Reference issues in commits with `#N`.