# Global instructions

Applies across all repos and projects, in both Claude Code and opencode.

## Load working memory at task/ticket intake — every time

Before planning, refining, or debugging any ticket or task in a repo that has
a `memory.manifest.yaml`, load the `working-memory` skill and search it
**first** — before writing code, writing tickets, or forming a plan. Do this
even if:
- the request doesn't mention memory,
- another skill (e.g. `project-management`) is already being invoked for the
  same task,
- the task looks small or exploratory.

The `working-memory` skill's own description already says to trigger "on
every ticket," but that line lives inside the skill listing, which is easy to
read past under load. This file exists to make it a hard requirement instead
of an easy-to-skip suggestion — if a session touches a repo with
`memory.manifest.yaml`, `working-memory` gets loaded, full stop.
