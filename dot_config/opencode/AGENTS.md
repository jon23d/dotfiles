# AGENTS.md (global)

Personal rules applied on top of whatever project-level `AGENTS.md` exists
for the current repo — this file is not project-specific and isn't affected
by, or a substitute for, any repo's own `AGENTS.md`.

---

## Always load: working-memory

Load the `working-memory` skill at the start of every session, before
reading any files or forming a plan — unconditionally. This applies to every
agent, orchestrator and subagent alike, not only a primary/orchestrator role,
and regardless of whether the current repo's own `AGENTS.md` or an
orchestrating agent mentions it.

This is a standing exception to any project rule along the lines of "load
only the skills your invoker specifies" — working-memory is loaded on your
own initiative, the same way you'd check your own notes before starting
work, not something an orchestrator has to remember to delegate.

See the skill itself
(`~/.config/opencode/skills/working-memory/SKILL.md`) for the read/write
protocol, scope taxonomy, and write-timing rules. If the current repo has no
`memory.manifest.yaml`, follow the skill's own **Bootstrapping a new repo**
section before anything else.

## Always write learnings before concluding

Before reporting completion, write any durable learnings — failures with root
causes, non-obvious procedures, architecture surprises, or dependency gotchas
— to working-memory. Use `basic-memory_search_notes` first to avoid
duplicates; use `basic-memory_write_note` (or `basic-memory_edit_note` to
refine an existing entry). Do not store anything already documented in code,
tests, repo docs, or Outline. This is a mandatory checkpoint, not optional —
the same way loading at the start is mandatory.
