---
name: writing-tickets
description: Use when writing, reviewing, or improving software tickets, user stories, or issue descriptions that need clear requirements, acceptance criteria, and scope boundaries.
---

# Writing Tickets

## Overview

A good ticket communicates who needs what and why, defines "done" precisely so any developer can pick it up cold, and explicitly states what is out of scope to prevent assumption-driven expansion.

## User Story

Format: **As a [persona], when I [context/trigger], I want to [action] so that [benefit].**

- **Persona** — a specific role, not a generic "user." Use the actual actor: `admin`, `new customer`, `mobile user on a slow connection`.
- **Context/trigger** — the situation that prompts the need. Grounds the story in a real scenario.
- **Action** — what the persona wants to do. One action per ticket.
- **Benefit** — the outcome or business value. If you can't state a benefit, the ticket may not be worth doing.

Bad: _As a user, I want a button so that things work._
Good: _As a checkout customer, when I've filled out my cart, I want to apply a discount code so that I pay the promotional price without contacting support._

## Acceptance Criteria

Use **Given / When / Then** for each criterion:

- **Given** [precondition or state]
- **When** [action taken]
- **Then** [observable, verifiable outcome]

Rules:

- Every criterion must be testable — a QA engineer or developer must be able to check it off definitively.
- Cover the happy path first, then key edge cases (empty state, invalid input, permission boundaries).
- Avoid opinions: "should look nice" or "should be fast" are not criteria. Use measurable thresholds: "loads in under 2 seconds on a 3G connection."
- Aim for 3–6 criteria. Fewer may mean the ticket is underspecified; many more may mean it should be split.

## Out of Scope

Every ticket must include an explicit Out of Scope section. This prevents reviewers, developers, and stakeholders from assuming adjacent work is included.

- List related features or edge cases that were intentionally excluded.
- List follow-on work that will be handled in a separate ticket.
- If something is genuinely undecided, flag it as a question rather than leaving it implicit.

## Sizing

A ticket should be completable within a single sprint. If writing the acceptance criteria reveals more than ~6 criteria covering very different concerns, split the ticket. Link the child tickets to a parent epic or story.

## Common Mistakes

**Vague persona** — "As a user…" gives no context about permissions, goals, or constraints. Name the role.

**Missing benefit** — Dropping "so that…" removes the business justification. If the benefit is obvious, write it anyway — it prevents gold-plating.

**Untestable criteria** — "The UI should be intuitive" cannot be checked off. Rewrite as observable behavior.

**No Out of Scope section** — Without it, developers fill gaps with assumptions. Gaps become scope creep.

**One giant ticket** — If a ticket takes more than one sprint, it's an epic. Break it down.

**Implementation detail in disguise** — Acceptance criteria that mention database fields, API endpoints, component names, or architectural choices are implementation specs, not behavioural specs. If a criterion could only be written by someone who has already designed the solution, rewrite it from the user's point of view. The test: could a QA engineer verify this criterion without reading the code? If not, reframe it as observable behaviour.

## Example

---

**Title:** Apply discount code at checkout

**User Story:**
As a checkout customer, when I have items in my cart and am on the payment step, I want to enter a discount code so that the discount is applied to my total before I complete my purchase.

**Acceptance Criteria:**

- Given I am on the payment step with items in my cart, when I enter a valid discount code and click "Apply," then the order total updates immediately to reflect the discount and a success message displays.
- Given I enter an expired discount code, when I click "Apply," then an inline error message reads "This code has expired" and the total does not change.
- Given I enter an unrecognized code, when I click "Apply," then an inline error message reads "Invalid code" and the total does not change.
- Given a discount has been applied, when I remove it by clicking "Remove," then the order total returns to the original amount.
- Given I complete the purchase with a valid discount applied, when the order is confirmed, then the discounted amount is reflected in the order confirmation email and the order record.

**Out of Scope:**

- Creating, managing, or expiring discount codes (handled by the admin coupon management ticket #412)
- Stacking multiple discount codes in a single order
- Discount codes applied at the cart step (not the payment step) — deferred to future iteration
- Loyalty points or store credit redemption
