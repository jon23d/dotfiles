---
name: code-review
description: >-
  Review committed code against its plan and the repo's constraints, and record
  findings as JSON at `.agent/review-{slice}-{round}.json`. USE THIS FOR EVERY
  COMPLETED IMPLEMENTATION. Defines severity levels, what does and does not
  count as a finding, the write-back fields an implementer fills in, and how a
  later round reads an earlier one.
---

# Code review

When reviewing on someone else's behalf, file every defect — including ones you
fix yourself.

## Out of scope

The verification gate owns formatting, lint, type errors, and test failures. Do
not report them.

Report what a gate cannot detect: correctness under untested conditions, drift
from the plan, violated constraints, defects invisible to a passing suite.

## Severity

**`critical`** — merging causes harm. Data loss or corruption. Security or
tenant-isolation hole. Break in behavior existing callers depend on. Defect on
the primary path the tests miss. Secrets in the diff.

**`major`** — works, but violates something stated. Departs from the approved
plan without saying so. Breaks a constraint in `AGENTS.md` or repo convention.
Wrong under a realistic untested condition — empty result, concurrent write,
failed dependency. Missing error handling on a path that can fail. A test
asserting the implementation rather than the behavior.

**`minor`** — naming, structure, clearer approach, missing comment where intent
is unclear.

Major versus minor: **could this be wrong in production?** Yes → major. Only
about how the code reads → minor.

## Not a finding

- Anything the gate covers.
- A different valid approach.
- Work the plan deferred or excluded from scope.
- Anything unconfirmed against the code.
- Anything without a specific `file:line`.

Implementation faithful but the plan wrong → file at its real severity and set
`plan_conflict: true`.

## Output

Write `.agent/review-{slice}-{round}.json`. Return **only** the path and the
count at each severity.

```json
{
  "slice": "checkout",
  "round": 1,
  "reviewed_sha": "a1b2c3d",
  "summary": { "critical": 0, "major": 2, "minor": 3 },
  "findings": [
    {
      "id": "F1",
      "severity": "major",
      "location": "src/checkout/session.ts:88",
      "finding": "Session lookup assumes exactly one open session per guest; a second concurrent checkout resolves to the wrong session rather than failing.",
      "evidence": "No uniqueness constraint on (guest_id, status); no test for the two-session case.",
      "expected": "Constrain in the schema, or handle multiple matches explicitly.",
      "plan_conflict": false,
      "status": null,
      "note": null
    }
  ]
}
```

- `reviewed_sha` — `git rev-parse HEAD` at review time.
- `id` — stable within the file; later rounds refer back to it.
- `location` — `file:line`. Required.
- `finding` — the defect and its consequence, not a description of the code.
- `evidence` — what confirmed it: what you read, or what you could not find.
- `expected` — what would resolve it, not a patch.
- `plan_conflict` — `true` only when the implementation is faithful and the plan
  is wrong.
- `status`, `note` — leave null.

## Write-back

The implementer sets `status` to `addressed` or `disputed` and writes `note`.
`disputed` means it holds the finding factually wrong.

Never set these yourself. Never edit a previous round's file.

## Later rounds

Read the previous round's file first. Review the new commits for regressions,
not the whole slice again.

- `addressed` → verify. Resolved: drop it. Not resolved: re-file with a new id
  referencing the old.
- `disputed` → re-check against the code. Implementer correct: do not re-file;
  record the id under `resolved_disputes`. Still wrong: re-file at the same
  severity, stating what the note failed to address.

## Method

1. Read the plan, the ticket, and `AGENTS.md` constraints before the code.
   Also load `security-review` — always, regardless of what the diff looks
   like; security issues hide in changes that don't look security-relevant,
   so this isn't gated. Also load `observability` if the diff touches
   logging, routes, services, or infra config. File findings from whichever
   of these apply together with your own, in the same output — not as
   separate delegations.
2. Get the diff in two steps — never a bare `git diff main...HEAD`; unbounded
   output overflows context and hangs the review.
   - `git diff main...HEAD --stat` and `git status --short` first, to see
     which files changed and how much. Read any untracked new files directly.
   - `git diff main...HEAD | head -c 100000` for the actual diff. If it's
     truncated, note that in your summary and focus on what's visible — don't
     retry without the cap.
3. Read the surrounding code the diff touches, including call sites.
4. Read the tests: what they assert, what condition they leave uncovered.
5. File each finding as you confirm it, with a location.
6. Write the file. Return the path and the counts.

Zero findings is a valid result.
