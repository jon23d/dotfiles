#!/usr/bin/env bash
#
# Fleet status hook — auto-POSTs agent state transitions to
# $AGENT_STATUS_SERVICE_URL so the dashboard stays accurate without relying
# on the model remembering to POST manually before every blocking call.
#
# Wired into ~/.claude/settings.json for SessionStart, UserPromptSubmit,
# PreToolUse (AskUserQuestion|ExitPlanMode), and Stop. Reads the hook's JSON
# payload from stdin (see https://code.claude.com/docs/en/hooks for the
# schema).
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
# Set only by the Stop heuristic below: re-check the dashboard's current
# state before writing, and skip if it's already "waiting" — a real
# AskUserQuestion/ExitPlanMode call already reported a precise reason via
# PreToolUse, and this guess (plain-text question, no tool call) must never
# clobber it with a vaguer one or spam a duplicate row.
skip_if_waiting=0

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
  Stop)
    # Backstop for agents that ask a question in plain response text instead
    # of calling AskUserQuestion — invisible to the PreToolUse trigger above.
    # Heuristic: the final assistant message of this turn ends in "?" (Stop
    # only fires when there's no pending tool call, so a trailing "?" here is
    # very likely a question sitting unanswered).
    transcript_path="$(printf '%s' "$payload" | jq -r '.transcript_path // empty' 2>/dev/null)"
    last_text=""
    if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
      last_text="$(tail -n 50 "$transcript_path" 2>/dev/null | jq -rs '
        map(select(.type == "assistant" and .message.content))
        | last
        | (.message.content // [])
        | map(select(.type == "text") | .text)
        | join("\n")
      ' 2>/dev/null)"
    fi
    trimmed="$(printf '%s' "$last_text" | sed -e 's/[[:space:]]*$//')"
    case "$trimmed" in
      *\?)
        state="waiting"
        description="waiting (heuristic): $(printf '%s' "$trimmed" | tail -c 80)"
        skip_if_waiting=1
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
  if [ "$skip_if_waiting" = "1" ]; then
    current_state="$(curl -s --max-time 3 "${AGENT_STATUS_SERVICE_URL%/}/agents" 2>/dev/null \
      | jq -r --arg id "$identifier" '.data[]? | select(.identifier == $id) | .state' 2>/dev/null)"
    if [ "$current_state" = "waiting" ]; then
      exit 0
    fi
  fi
  curl -s -X POST "${AGENT_STATUS_SERVICE_URL%/}/agents" \
    -H "Content-Type: application/json" \
    -d "$body" \
    --max-time 5 -o /dev/null 2>/dev/null
) &
disown 2>/dev/null || true

exit 0
