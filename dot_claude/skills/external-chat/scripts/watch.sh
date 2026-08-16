#!/bin/sh
# Polls a Mattermost DM channel for new messages from the operator and prints
# one "Jon replied: <message>" line per message to stdout, for consumption by
# Claude Code's Monitor tool (each stdout line becomes a conversation event).
#
# Every quirk fixed in this script was hit and debugged the hard way in a real
# session before this skill existed -- see SKILL.md's "Known gotchas" section
# for the story behind each one. Don't simplify this back to something that
# looks more obvious; the obvious version is the version that was already
# tried and was broken.
#
# Required env vars (set before invoking, or export in your shell first):
#   MM_HOST      e.g. https://mattermost.example.com
#   MM_TOKEN     bot Personal Access Token (also valid as a Bearer token for
#                the plain REST/WebSocket API, not just the MCP endpoint)
#   MM_CHANNEL   the DM channel id (resolve once via setup, see SKILL.md)
#   MM_USER_ID   the operator's Mattermost user id (not the bot's own id --
#                this filters OUT the bot's own posts so it never replies to
#                itself in a loop)
set -u

: "${MM_HOST:?set MM_HOST}"
: "${MM_TOKEN:?set MM_TOKEN}"
: "${MM_CHANNEL:?set MM_CHANNEL}"
: "${MM_USER_ID:?set MM_USER_ID}"

# Gotcha 1: `date +%s%3N` does not reliably give millisecond precision --
# some `date` builds ignore the width specifier and emit full nanosecond
# precision instead, silently setting the poll cursor decades in the future
# (the watcher then looks alive forever while never finding anything new).
# This is the only correct way to get a real epoch-millisecond integer:
last_ts=$(( $(date +%s%N) / 1000000 ))
last_id=""
last_err=""

while true; do
  # Gotcha 4 (query side): Mattermost's `since` param is a strict *exclusive*
  # boundary server-side (WHERE UpdateAt > ?, not >=). Querying at exactly
  # the last-seen timestamp would silently drop a sibling post that shares
  # that same millisecond -- the server excludes it before this script's own
  # dedupe ever runs. Query one ms *below* the watermark instead, and rely on
  # the id-based dedupe below (not the timestamp) to skip the already-seen
  # post that comes back as a result of doing this.
  query_since=$([ -n "$last_id" ] && echo $((last_ts - 1)) || echo "$last_ts")

  tmp=$(mktemp)
  code=$(curl -s --max-time 10 -o "$tmp" -w '%{http_code}' \
    "$MM_HOST/api/v4/channels/$MM_CHANNEL/posts?since=$query_since" \
    -H "Authorization: Bearer $MM_TOKEN")
  curl_status=$?

  # Gotcha 2: never swallow a failure silently. A watcher that retries
  # quietly on error looks identical to one that's working -- the exact
  # failure mode that let a poll cursor sit broken for an entire session
  # undetected. Always emit a visible line on failure, deduped so it
  # doesn't spam on a sustained outage.
  if [ "$curl_status" -ne 0 ]; then
    if [ "$last_err" != "curl:$curl_status" ]; then
      echo "Watcher error: curl failed with status $curl_status (will keep retrying)"
      last_err="curl:$curl_status"
    fi
  elif [ "$code" != "200" ]; then
    if [ "$last_err" != "http:$code" ]; then
      echo "Watcher error: Mattermost API returned HTTP $code (will keep retrying)"
      last_err="http:$code"
    fi
  else
    last_err=""

    # One compact (single-line) JSON object per matching post. Compact mode
    # escapes any embedded newline inside .message as \n *within* the JSON
    # string, so each shell line is guaranteed to be exactly one post --
    # this matters because operators send multi-line messages routinely.
    # `$seen` excludes the post already processed last cycle (see Gotcha 4
    # above -- it comes back from the server because we query one ms below
    # the watermark on purpose).
    posts=$(jq -c --arg user "$MM_USER_ID" --arg seen "$last_id" '
      (.order // []) as $order
      | $order[] as $id
      | .posts[$id]
      | select(.user_id == $user and .delete_at == 0 and .id != $seen)
    ' < "$tmp" 2>/tmp/watch_jq_err.$$)

    if [ -s /tmp/watch_jq_err.$$ ]; then
      echo "Watcher error: failed to parse Mattermost response, retrying"
    fi
    rm -f /tmp/watch_jq_err.$$

    if [ -n "$posts" ]; then
      # Gotcha 3: /bin/sh's `echo` (dash, and some other POSIX shells) by
      # default interprets backslash escapes -- including the literal `\n`
      # inside a JSON string pulled straight from the API response -- which
      # silently converts one valid single-line JSON record into several
      # invalid fragments before jq ever sees it. `printf '%s\n'` never does
      # this; `echo` must not be used on anything that could contain API
      # response content.
      printf '%s\n' "$posts" | while IFS= read -r post; do
        msg=$(printf '%s' "$post" | jq -r '.message')
        printf 'Jon replied: %s\n' "$msg"
      done

      # Advance the watermark to the newest post actually seen this cycle,
      # tracking its id (not just its timestamp) so next cycle's dedupe
      # (above) can tell "the post I already handled" apart from "a new
      # post that happens to share its millisecond."
      newest=$(printf '%s\n' "$posts" | jq -c -s 'max_by(.create_at)')
      new_ts=$(printf '%s' "$newest" | jq -r '.create_at')
      new_id=$(printf '%s' "$newest" | jq -r '.id')
      if [ -n "$new_ts" ] && [ "$new_ts" != "null" ]; then
        last_ts=$new_ts
        last_id=$new_id
      fi
    fi
  fi

  rm -f "$tmp"
  sleep 2
done
