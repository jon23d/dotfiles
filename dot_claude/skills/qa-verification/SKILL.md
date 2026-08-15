---
name: qa-verification
description: Use to verify a running application's actual behavior against its OpenAPI spec — checking documented endpoints against the live API. Load alongside `code-review` when a slice changed endpoints; contributes findings to the same review file, not a separate report.
---

# QA Verification

Static review reads code. This is the opposite: run the application and check
whether the live API matches what's documented.

## Spec-vs-live verification — when endpoints changed

Follow `openapi-codegen`'s "Spec Verification (QA)" section exactly: locate
the spec, start the dev server, resolve an auth token, and check each changed
endpoint's request shape, response shape, status codes, and auth requirements
against what's documented. Missing endpoint documentation is `major`;
request/response mismatches are `major`; undocumented status codes are
`major`. Also check the docs UI is reachable and consistent with the raw
spec.

## Output

Do not produce a separate report. File every finding using `code-review`'s
format and severity scale into the same `.agent/review-{slice}-{round}.json`
this delegation is already writing — use `dimension` value `openapi-spec` to
distinguish these from `code-review`'s own findings.

## Cleanup

Stop any dev server you started before returning.
