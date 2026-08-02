---
name: writing-skills
description: Use when creating a new skill, editing an existing skill, writing a SKILL.md, or verifying a skill works before deployment.
---

# Writing Skills

A skill is a directory containing a `SKILL.md` file plus optional reference files and scripts. Skills give agents reusable domain-specific context, workflows, and tools.

**Core insight:** Writing skills is tdd applied to process documentation. Establish baseline behavior first (RED), write the skill (GREEN), then close loopholes (REFACTOR).

## When to create a skill

Create when:

- The technique wasn't intuitively obvious
- You'd reference it again across different projects
- Others would benefit

Don't create for:

- One-off solutions
- Standard practices well-documented elsewhere
- Project-specific conventions (put those in a project config file)
- Things enforceable by automation — save skills for judgment calls

## Skill types

- **Technique** — concrete method with steps (e.g. condition-based-waiting)
- **Pattern** — way of thinking about a class of problems (e.g. flatten-with-flags)
- **Reference** — docs, syntax guides, API reference (e.g. bigquery-schemas)

## SKILL.md structure

```
---
name: skill-name-with-hyphens
description: Use when [specific triggering conditions and symptoms]
---

# Skill Name

## Overview
Core principle in 1-2 sentences.

## When to use
Symptoms, contexts, triggers. When NOT to use.

## Core pattern / Quick reference
Steps or code.

## Common mistakes
What goes wrong + fixes.
```

Frontmatter rules:

- Only `name` and `description` fields are supported
- `name`: letters, numbers, hyphens only (no parentheses or special chars)
- `description`: max 1024 chars; see below for critical rules

## Descriptions: triggers only, never workflow summaries

The description is how the agent decides whether to load your skill. It must describe only _when_ to use the skill — never summarize what the skill does or how it works.

Summarizing the workflow in the description causes agents to follow the description as a shortcut and skip reading the full skill body.

```yaml
# Bad: summarizes workflow — agent may follow this instead of reading the skill
description: Use when executing plans — dispatches subagent per task with code review between tasks

# Bad: first person
description: I can help you process Excel files

# Good: triggering conditions only, third person
description: Use when executing implementation plans with independent tasks

# Good: specific symptoms, no workflow
description: Use when tests have race conditions, timing dependencies, or pass/fail inconsistently
```

Rules:

- Start with "Use when..."
- Write in third person (injected into system prompt)
- Include concrete symptoms, situations, file types, contexts
- Describe the _problem_, not language-specific symptoms unless the skill is language-specific

## Formatting

Use structured text, not diagrams or tables:

- Diagrams (flowcharts, graphs) are token-expensive and rarely worth the cost — use numbered steps or nested bullets instead
- Markdown tables add formatting overhead — use bulleted lists instead
- Prefer short, scannable prose and bullets over visual structure

## File structure

Use progressive disclosure: SKILL.md is the table of contents; details live in linked files loaded only when needed.

```
my-skill/
├── SKILL.md          # Overview + links (required)
├── reference.md      # Heavy reference: API docs, schemas (100+ lines)
├── examples.md       # Input/output pairs
└── scripts/
    └── validate.py   # Reusable utility scripts
```

- Keep references one level deep from SKILL.md — avoid chains (SKILL.md → a.md → b.md)
- Keep inline: principles, concepts, code patterns under ~50 lines
- Split to separate files: heavy reference (100+ lines), reusable scripts/tools
- Name files descriptively: `form_validation_rules.md` not `doc2.md`
- For reference files >100 lines, add a table of contents at the top
- Use forward slashes in all paths — never backslashes

## Token efficiency

Skills load into every conversation. Every token counts.

Targets:

- Frequently-loaded skills: under 200 words
- Other skills: under 500 words

Techniques:

- Reference `--help` instead of documenting all flags inline
- Cross-reference other skills instead of repeating their content
- One excellent example beats several mediocre ones
- Remove anything the agent already knows

## Keyword coverage for discoverability

Use terms agents would search for when encountering a problem:

- Error messages: `"Hook timed out"`, `"ENOTEMPTY"`, `"race condition"`
- Symptoms: `"flaky"`, `"hanging"`, `"zombie"`, `"pollution"`
- Synonyms: `"timeout/hang/freeze"`, `"cleanup/teardown/afterEach"`
- Tool names, library names, file types

## Workflow and checklist pattern

For multi-step tasks, give the agent a copyable progress checklist:

```
Task Progress:
- [ ] Step 1: ...
- [ ] Step 2: ...
- [ ] Step 3: ...
```

Then describe each step. Include feedback loops: run validator → fix errors → repeat.

## Examples pattern

For output quality that depends on style, provide input/output pairs:

```
**Example 1:**
Input: <user request>
Output:
<desired output>
```

One excellent, complete, well-commented example is better than many thin ones.

## Testing skills (RED-GREEN-REFACTOR)

**Never deploy a skill you haven't tested. No exceptions.**

**RED — establish baseline:**
Run the target scenario with a fresh agent session _without_ the skill. Document what choices the agent made, what rationalizations it used (verbatim), and which pressures triggered failures.

**GREEN — write minimal skill:**
Write a skill that addresses those specific failures. Don't add content for hypothetical cases. Re-run with the skill and verify compliance.

**REFACTOR — close loopholes:**
If the agent finds a new rationalization, add an explicit counter. Re-test until bulletproof.

Testing approaches by skill type:

- **Discipline-enforcing**: pressure scenarios (time pressure, sunk cost, authority) — success = agent complies under maximum pressure
- **Technique**: application and variation scenarios — success = agent applies technique correctly to new cases
- **Pattern**: recognition and counter-example scenarios — success = agent knows when and when not to apply
- **Reference**: retrieval and application scenarios — success = agent finds and correctly uses the right information

## Using code while testing skills

If the agent needs to write code to test a skill, use `test/<skill-name>/` within the current working directory. For example, when testing the `pull-requests` skill, write test code to `test/pull-requests/`. Clean up the directory after testing is complete.

## Bulletproofing discipline-enforcing skills

Skills that enforce rules need to actively resist rationalization. Agents will find loopholes under pressure.

Close every loophole explicitly — state the rule, then forbid specific workarounds:

```markdown
Write code before test? Delete it. Start over.

No exceptions:

- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Delete means delete
```

Add a rationalization list built from your baseline testing:

- "Too simple to test" → Simple things break. Test takes 30 seconds.
- "I'll add tests after" → Tests after prove what code does, not what it should do.

Add a red flags list so agents can self-check:

```markdown
## Red flags — stop and reassess

- Thinking "this is too simple to need a test"
- Thinking "I'll test it after"
- Thinking "this situation is different because..."
```

## Skill creation checklist

RED — baseline first:

- [ ] Run target scenario without the skill
- [ ] Document exact agent behavior and rationalizations verbatim
- [ ] Identify patterns in failures

GREEN — write minimal skill:

- [ ] `name` uses only letters, numbers, hyphens
- [ ] `description` starts with "Use when...", third person, triggers only (no workflow summary)
- [ ] Body addresses the specific failures from baseline testing
- [ ] Keywords present for discoverability
- [ ] No diagrams; no markdown tables; use bullets and prose
- [ ] One strong example (not multi-language)
- [ ] Run scenarios with skill _by copying the skill in your prompt to the agent_ — verify compliance

REFACTOR — close loopholes:

- [ ] New rationalizations? Add explicit counters
- [ ] Rationalization list built from test iterations (for discipline skills)
- [ ] Red flags list present (for discipline skills)
- [ ] Re-tested until bulletproof

Quality checks:

- [ ] Body under 500 lines; frequently-loaded skills under 200 words
- [ ] No workflow summary in description
- [ ] No narrative storytelling ("in session X we found...")
- [ ] Supporting files only for heavy reference or reusable tools
- [ ] All file paths use forward slashes

## Anti-patterns

- Workflow summary in description — agents shortcut the full skill body
- Diagrams and flowcharts — token-expensive; use structured text instead
- Markdown tables — use bulleted lists instead
- Narrative examples ("in session X...") — too specific, not reusable
- Multi-language examples — diluted quality, maintenance burden
- Deeply nested references — agents may partially read and miss content
- Vague names: "Helper", "Utils" — not discoverable
- Magic numbers in scripts without justification — agent can't reason about them
- Windows-style paths (`scripts\file.py`) — breaks on Unix systems
- Time-sensitive information ("before August 2025...") — becomes wrong silently
