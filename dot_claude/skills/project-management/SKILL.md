---
name: project-management
description: Governs how agents interact with the Jira/Confluence/repo project-management workflow — refining spikes/tickets/epics with a human, writing spikes, RFCs, and ADRs, moving tickets through the board (assignment, "Agent VM" field, In Review), and deciding where a piece of information belongs (Jira ticket vs Confluence page vs in-repo ADR vs working-memory). Use this skill whenever the user asks to pick up a ticket, refine a spike, write an RFC or ADR, create or link an epic/feature, start or finish work on a ticket, set up Confluence spike documentation, or asks "where should this go" about a decision, gotcha, or piece of documentation. This skill governs process and location, not code — pair it with your ticket-writing or implementation skill for content.
compatibility: >-
  Requires Jira and Confluence MCP connectors, and a `.project-management.yml`
  at the repo root (see Step 0). Distinct from, but coexists with, the
  `working-memory` skill's `memory.manifest.yaml` — the two config files cover
  different concerns and shouldn't be merged.
---

# Project Management

Cross-harness skill (Claude Code, OpenCode, Cowork, etc.) for working inside a Jira + Confluence + git-repo project-management setup. This skill answers two questions: **what's the next step in the process**, and **where does this piece of information belong**. It does not tell you how to write good acceptance criteria or how to implement a ticket — that's the job of other skills.

## Golden rules

1. **Never skip human refinement.** A ticket/spike only moves to Todo, and work only starts, after a human has refined it with the agent. Don't self-promote backlog items.
2. **Never invent field/macro/status names — and never re-derive them by hand each time.** Jira custom fields (like "Agent VM"), workflow status names, and the epic-link mechanism vary per instance. These are resolved once via MCP introspection and then **committed to `.project-management.yml`** (see Step 0) so future sessions read them instead of re-discovering them. If the config is missing a mapping you need, introspect via MCP, then update the config — don't just use the discovered value once and let it go unrecorded.
3. **Always link bidirectionally.** Every Confluence doc that exists because of a ticket links back to that ticket, and every ticket that has a Confluence doc links to it. Never let one exist without the other.
4. **Decisions that constrain future work live in two places, not one.** The narrative (why, alternatives considered, discussion) lives in Confluence. The terse, binding rule agents must obey lives in-repo as an ADR file. See "Where does this belong" below.
5. **Don't guess the repo's Jira project / Confluence space.** Resolve it first (see next section) — never assume based on repo name.

## Step 0: Resolve the repo's project-management config

Every repo maps to exactly one Jira project and one Confluence space, plus a handful of instance-specific field/status/macro mappings that would otherwise require an MCP round-trip to rediscover every session. All of it lives in one file, resolved once and reused.

1. Look for `.project-management.yml` (or `.yaml`) at the repo root. Full expected shape — treat any section as optional/growable, not a fixed schema:
   ```yaml
   jira:
     project_key: ABC
     fields:
       agent_vm: customfield_10087       # the "Agent VM" field's real field key
       epic_link: customfield_10014      # or null/omit if this project uses parent-links instead
     statuses:
       todo: "Todo"
       in_progress: "In Progress"
       in_review: "In Review"
     epic_link_mode: epic_link           # epic_link | parent | label
     grouping_label_prefix: spike-       # used when epic_link_mode is label
   confluence:
     space_key: ABCDOC
     spikes_root_page_id: 123456
   ```
2. If the file is missing entirely, that means this repo hasn't been onboarded to this skill yet — go to step 3 to resolve values and create it. Don't check working memory for this; `.project-management.yml` is a committed repo file, so once it exists it's the single source of truth. Mirroring it into working memory would just create a second copy that can drift out of sync — the `working-memory` skill's own rule is to link to things already in the repo, not duplicate them.
3. If a value this skill needs isn't in the file yet (new repo, or a field/status you haven't used before), **introspect it via MCP** (list fields, list statuses, list spaces/pages), confirm with the human only if it's ambiguous (e.g. multiple candidate "Agent VM"-ish fields), then **write the resolved value back into `.project-management.yml`** — propose it as a normal file change, don't force-commit. Do this the moment you discover it, not at the end of the session.
4. Never re-run MCP introspection for a mapping that's already present in the config — read it and use it. Only re-introspect if a Jira/Confluence call fails in a way that suggests the stored value is stale (field no longer exists, status renamed), and when that happens, correct the config immediately rather than working around the stale value.

Note: `.project-management.yml` is a separate file from the `working-memory` skill's `memory.manifest.yaml`. They can both exist at the repo root — `.project-management.yml` covers Jira/Confluence mappings, `memory.manifest.yaml` covers memory scope/dependencies/edges. Don't merge them or infer one from the other. If `memory.manifest.yaml` doesn't exist yet, that's the `working-memory` skill's bootstrapping job, not this skill's — don't create it from here.

Do this resolution once per session and reuse it; don't re-derive it per ticket.

## Where does this belong?

Before creating any artifact, route it:

| Kind of content | Home | Notes |
|---|---|---|
| Objective, acceptance criteria, status, assignment, work tracking | **Jira ticket** (issue/epic/feature) | Source of truth for "what" and "who" and "state" |
| Human-readable product narrative, spike research, RFC discussion, decision history/alternatives | **Confluence page** | Source of truth for "why," written for humans |
| Binding architectural/technical decisions that constrain how agents must build going forward — regardless of whether a spike produced them | **In-repo ADR** (`docs/adr/NNNN-title.md`) | Terse, imperative, versioned with the code. Cross-links to the Confluence page and Jira ticket that produced it (if any). This is what an agent should actually read before touching related code — it must not require Jira/Confluence access to be useful. For decisions significant enough that every agent working in the repo needs to know them unprompted, also add a one-line pointer from `AGENTS.md` to the ADR — `AGENTS.md` is what's auto-loaded, the ADR file is the detail. |
| Transient discoveries, environment gotchas, "this broke because X," non-obvious procedures, decisions-with-rationale that constrain future work | **Working memory** (the `working-memory` skill / `basic-memory` MCP) | Defer entirely to that skill's own rules — don't duplicate its logic here. In particular: it only stores confirmed facts (never speculation), never duplicates anything already in code/tests/AGENTS.md/Outline (link instead), and scopes are domain-prefixed (`<domain>/project/<repo>`, `<domain>/dep/<name>`, `<domain>/edge/<a>--<b>`), not bare. Authority order on conflict is running code > repo/tests > product docs > memory. |

**What makes something ADR-worthy** isn't "it came out of a spike" — plenty of spike outcomes are just findings, not decisions ("the API doesn't support batch writes" is a fact, not a decision), and plenty of ADR-worthy decisions never touch a spike at all (an RFC with no prior research phase, or a human telling an agent mid-implementation "do it that way from now on"). The bar is: is this significant, hard to reverse, and would someone otherwise end up re-arguing it later? If yes, write the ADR regardless of what process produced it.

If something starts as a working-memory gotcha and later hardens into a real constraint, promote it to an in-repo ADR (and update or `#stale`-flag the memory entry per that skill's conflict rules) — don't leave load-bearing decisions stuck in memory-only notes.

See `references/templates.md` for the RFC/ADR/spike-doc templates, and `references/confluence-conventions.md` for page structure and the Jira-macro embedding pattern.

## Refinement

There are two entry paths. Detect which one applies by looking at the ticket type/label (spike vs. story/task/feature) — ask the human if it's ambiguous.

### Path A: Spike-based

Use when the human created a **spike** ticket outlining a broad objective that needs research/exploration before real work can be scoped.

1. **Human creates the spike ticket** with a broad objective. (Human step — don't do this yourself unless explicitly asked to draft one for them to review.)
2. **Refine with the human.** Pick up the spike, ask clarifying questions until the objective, scope boundaries, and "what would let us close this out" are clear. Capture the refined objective back onto the ticket (description or a comment — whichever your ticket-writing skill/team convention uses).
3. **Do the research, and open a Confluence page.**
   - The page lives under the space's spike hierarchy: `<space root> / spikes / <status>`, where `<status>` is one of `Open`, `Needs Decision`, `In Progress`, `Complete`, `Rejected`. These are parent pages (create them once per space if they don't exist yet — check first).
   - A brand-new spike's doc is created as a child page under `spikes/Open`.
   - **Link it to the ticket both ways**: add the Confluence URL to the Jira ticket (link field or a comment, per your MCP tool's capability), and add a Jira link/macro on the Confluence page back to the ticket (see `references/confluence-conventions.md`).
   - Use the spike doc template in `references/templates.md`.
   - **Moving the page between status folders (Open → Needs Decision → ... → Complete/Rejected) is a human decision.** Don't move it yourself unless the human explicitly tells you to — you manage creation and content, they manage lifecycle state, exactly as with the ticket board.
   - **Filling in the page's `## Decision` section happens at that same moment.** It's a point-in-time record of what was actually decided — which may differ from your `## Recommendation` (modified, rejected outright, sent back for more research) — not just a status change. If the decision doesn't rise to ADR-worthy (see "What makes something ADR-worthy" above), the `## Decision` section is the complete record on its own. If it does, its ADR link gets added here once the ADR exists (step 4) — this is what lets a human starting from Confluence find the in-repo decision without already knowing to go looking in the repo.
4. **If the decision is ADR-worthy** (per the definition above — not every resolved spike produces one):
   - Write the in-repo ADR (`docs/adr/NNNN-title.md`) capturing the binding decision, using the ADR template.
   - **Add the ADR's link to the spike page's `## Decision` section.** This is the reverse-link — without it, a human starting from Confluence has no way to find the in-repo file short of guessing.
   - Create the implementation ticket(s) in Jira.
   - **Group them under a common epic or feature** — create one if one doesn't already exist for this initiative; don't scatter tickets under unrelated parents.
   - **Link them in the Confluence doc automatically, not by hand.** Add a Jira Issues macro (JQL-backed) to the spike page scoped to the epic/feature, built using whichever mechanism `.project-management.yml`'s `jira.epic_link_mode` specifies (`epic_link`, `parent`, or `label` — resolve and record this once per Step 0 if it isn't set yet, rather than guessing per spike). Because it's JQL-driven, any ticket added under that epic later shows up on the page without editing it. See `references/confluence-conventions.md` for the exact macro snippet and verification steps.
   - Add a link from the epic/feature description back to the Confluence spike page too, so navigation works both directions.

### Path B: Feature/ticket-based

Use when the human created a ticket (or a small group of tickets) with a broad-but-already-fairly-concrete objective — no open-ended research phase needed.

1. **Human creates the ticket(s)**, optionally grouped under an epic/feature, outlining the objective.
2. **Refine with the human** the same way as step 2 in Path A — clarify scope and acceptance criteria, capture it on the ticket.

This path skips the spike/Confluence-research phase entirely. If mid-refinement it turns out real research or a design decision is needed, don't force it through Path B — tell the human it warrants a spike and offer to convert it (create the spike ticket, link it, follow Path A from step 3).

That said, a Path B ticket — or even an ad hoc decision made mid-implementation with no refinement process at all — can still be ADR-worthy on its own. ADR creation isn't gated on having gone through a spike (see "What makes something ADR-worthy" above). When it happens outside Path A, there's no spike page to hold a `## Decision` section, so record the decision's context and rationale directly in the ADR's own `## Context` section instead, and link the ADR from the ticket it came from.

## Post-refinement (board workflow)

Applies once a ticket has been refined, regardless of which path it came from. A human will initiate this process.

1. A human moves the refined ticket into the **Todo** column. Agents don't self-promote tickets out of backlog/refinement — wait for this.
2. An agent picks up the **next** ticket from Todo (respect priority/order as set on the board; don't cherry-pick unless told to).
3. **Assign the ticket** to the agent's identity (or the operator's, per your team's convention — verify which before assuming).
4. **Set the `Agent VM` field** to the hostname of the machine the agent is working from (`hostname` on Linux/macOS), using the field key from `jira.fields.agent_vm` in `.project-management.yml`. If that key is missing from the config, resolve it via MCP once and write it back (see Step 0) rather than guessing or skipping it; if the field genuinely doesn't exist on this project, tell the human.
5. Transition the ticket to the status in `jira.statuses.in_progress` from the config (defaulting to resolving-and-recording it per Step 0 if that key isn't set yet) -- don't assume it's literally called 'In Progress'.
6. **Name the branch with the ticket identifier**: `<type>/<TICKET-ID>-<kebab-slug>`, e.g. `feature/ABC-15-update-map-view`. The `<type>/` prefix (`feature/`, `fix/`, `chore/`, etc.) and slug wording follow whatever convention the repo already uses — the ticket-ID-in-branch-name part is this skill's requirement, non-negotiable regardless of repo convention.
7. Do the work. (Governed by your other skills — implementation, testing, PR review process, etc. Not this skill's job.)
8. **Open the PR with the ticket identifier at the start of the title**: `<TICKET-ID>: <summary>`, e.g. `ABC-15: Add live color to map view`. This holds regardless of whatever other title/description conventions your other skills specify — the ticket ID prefix is never optional.
9. When work is complete, **move the ticket to the status in `jira.statuses.in_review`** from the config (defaulting to resolving-and-recording it per Step 0 if that key isn't set yet) — don't assume it's literally called "In Review".

## Notes on MCP tool usage

- Before creating/editing anything, list the available Jira/Confluence MCP tools and their parameters rather than assuming a fixed tool surface — different Atlassian MCP servers expose different tool names.
- Prefer JQL-scoped queries over manual issue lists wherever Jira supports it (search, epic-link filtering, the Confluence Jira macro) — anything JQL-driven stays correct as tickets get added later; anything hand-typed goes stale.
- If an MCP call fails with an auth/permission error, surface that to the human plainly — don't silently fall back to guessing or fabricating ticket/page content.
