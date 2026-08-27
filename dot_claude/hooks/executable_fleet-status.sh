#!/usr/bin/env bash
#
# Fleet status hook — auto-POSTs agent state transitions to
# $AGENT_STATUS_SERVICE_URL so the dashboard stays accurate without relying
# on the model remembering to POST manually before every blocking call.
#
# Wired into ~/.claude/settings.json for SessionStart, UserPromptSubmit, and
# PreToolUse (AskUserQuestion|ExitPlanMode). Reads the hook's JSON payload
# from stdin (see https://code.claude.com/docs/en/hooks for the schema).
#
# Best-effort only: no-ops silently if AGENT_STATUS_SERVICE_URL isn't set,
# and never blocks the actual tool call / turn — the status POST always runs
# in the background and this script always exits 0.

if [ -z "${AGENT_STATUS_SERVICE_URL:-}" ]; then
  exit 0
fi

payload="$(cat)"
event="$(printf '%s' "$payload" | jq -r '.hook_event_name // empty' 2>/dev/null)"
identifier="$(hostname)"

state=""
description=""

case "$event" in
  SessionStart)
    state="stopped"
    description="idle"
    ;;
  UserPromptSubmit)
    state="working"
    description="resumed"
    ;;
  PreToolUse)
    tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)"
    case "$tool" in
      AskUserQuestion)
        state="waiting"
        description="$(printf '%s' "$payload" | jq -r \
          '.tool_input.questions[0].header // .tool_input.questions[0].question // "user input"' \
          2>/dev/null | cut -c1-80)"
        description="waiting: ${description}"
        ;;
      ExitPlanMode)
        state="waiting"
        description="plan approval"
        ;;
      *)
        exit 0
        ;;
    esac
    ;;
  *)
    exit 0
    ;;
esac

body="$(jq -n --arg id "$identifier" --arg state "$state" --arg desc "$description" \
  '{identifier: $id, state: $state, description: $desc}' 2>/dev/null)"

if [ -z "$body" ]; then
  exit 0
fi

# Fire-and-forget: a slow or dead status endpoint must never add latency to
# a real tool call or turn.
(
  curl -s -X POST "${AGENT_STATUS_SERVICE_URL%/}/agents" \
    -H "Content-Type: application/json" \
    -d "$body" \
    --max-time 5 -o /dev/null 2>/dev/null
) &
disown 2>/dev/null || true

exit 0
