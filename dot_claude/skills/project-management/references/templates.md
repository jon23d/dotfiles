# Templates

Use these as starting structure, not rigid forms — trim or extend sections to fit the actual content. Fill in every bracketed placeholder; don't leave template scaffolding in a published doc.

## Spike doc (Confluence page, lives under `spikes/<status>`)

```markdown
# Spike: [Title]

**Jira ticket:** [KEY-123]
**Status:** Open
**Owner (human):** [name]
**Started:** [date]

## Objective
[What question(s) this spike is trying to answer, refined with the human. 2-4 sentences.]

## Scope
**In scope:** [...]
**Out of scope:** [...]

## Research / Findings
[The actual investigation. Options considered, evidence, tradeoffs, prototypes, links to relevant code or external docs. This is the meat of the doc.]

## Options Considered
| Option | Pros | Cons |
|---|---|---|
| [A] | | |
| [B] | | |

## Recommendation
[What the agent recommends, and why. This is a recommendation, not a ratified decision — that happens when a human moves the page to Needs Decision / Complete.]

## Decision
<!-- Filled in by the human at the same time they move this page out of Open —
     e.g. into Needs Decision, Complete, or Rejected. This is the point-in-time
     record of what was actually decided; it may differ from the Recommendation
     above (modified, rejected outright, or sent back for more research). Not
     every decision needs an ADR — only fill in the ADR line below if this one
     is significant/binding enough to warrant one. -->
**Outcome:** Adopted | Modified | Rejected | Deferred
**Decided by:** [name]
**Date:** [date]

[1-3 sentences on what was actually decided, especially if it differs from the Recommendation.]

**ADR:** [link to `docs/adr/NNNN-title.md`, if applicable — this is the only place a human browsing Confluence will find the in-repo decision, so don't skip it once the ADR exists]

## Resulting Work
<!-- Populated via Jira macro once accepted — see references/confluence-conventions.md.
     Do not hand-maintain this list. -->
```

## RFC (Confluence page, or in-repo `docs/rfcs/` if the team prefers version-controlled RFCs — confirm which per repo)

```markdown
# RFC: [Title]

**Status:** Draft | In Review | Accepted | Rejected | Superseded
**Author:** [agent/human]
**Jira ticket:** [KEY-123]
**Date:** [date]

## Summary
[One paragraph: what is being proposed.]

## Motivation
[Why this is needed. What problem it solves. What happens if we don't do it.]

## Detailed Design
[The actual proposal. Concrete enough that someone could implement it from this section alone.]

## Alternatives Considered
[What else was considered and why it was rejected.]

## Drawbacks / Risks
[Honest downsides, migration cost, blast radius.]

## Open Questions
[Anything not yet resolved — flag these explicitly rather than glossing over them.]
```

## ADR (in-repo, `docs/adr/NNNN-title.md`)

In-repo ADRs are the **binding, terse** record — the thing an agent should be able to read cold, with no Jira/Confluence access, and know what constraint it must respect. Keep it short. Link out for the "why" narrative instead of restating it.

```markdown
# NNNN. [Title]

**Status:** Accepted | Superseded by NNNN | Deprecated
**Date:** [date]
**Confluence:** [link to the spike/RFC page with full discussion]
**Jira:** [epic/feature key this decision is tracked under]

## Context
[1-3 sentences: the situation that forced this decision. Not the full research — that's in Confluence.]

## Decision
[The actual decision, stated as an imperative rule. "We will X." Concrete and unambiguous — this is what future agents must follow.]

## Consequences
[What this makes easier, what it makes harder, what it forecloses. Include anything a future agent needs to know before proposing to violate this decision.]
```

Number ADRs sequentially (`0001-`, `0002-`, ...) within `docs/adr/`; check the highest existing number before assigning a new one rather than guessing.
