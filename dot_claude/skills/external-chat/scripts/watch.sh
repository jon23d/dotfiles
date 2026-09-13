#!/bin/sh
# Polls a Mattermost DM channel for new messages from the operator and prints
# one "<label> replied: <message>" line per message to stdout, for consumption
# by Claude Code's Monitor tool (each stdout line becomes a conversation
# event).
#
# Every quirk fixed in this script was hit and debugged the hard way in a real
# session before this skill existed -- see SKILL.md's "Known gotchas" section
# for the story behind each one. Don't simplify this back to something that
# looks more obvious; the obvious version is the version that was already
# tried and was broken.
#
# Requires GNU coreutils' `date` (for `%N` nanosecond precision) -- this is
# fine on Linux, but plain BSD/macOS `date` treats `%N` as a literal and will
# break the arithmetic below. Not addressed here; note it if porting.
#
# Required env vars (set before invoking, or export in your shell first):
#   MM_HOST      e.g. https://mattermost.example.com
#   MM_TOKEN     bot Personal Access Token (also valid as a Bearer token for
#                the plain REST/WebSocket API, not just the MCP endpoint)
#   MM_CHANNEL   the channel id to watch (resolve once via setup, see
#                SKILL.md -- may be a DM or a private channel)
#   MM_USER_ID   the operator's Mattermost user id (not the bot's own id --
#                this filters OUT the bot's own posts so it never replies to
#                itself in a loop)
# Optional:
#   MM_LABEL     name to print in each output line (default: "Operator")
set -u

: "${MM_HOST:?set MM_HOST}"
: "${MM_TOKEN:?set MM_TOKEN}"
: "${MM_CHANNEL:?set MM_CHANNEL}"
: "${MM_USER_ID:?set MM_USER_ID}"
: "${MM_LABEL:=Operator}"

# Gotcha 1: `date +%s%3N` does not reliably give millisecond precision --
# some `date` builds ignore the width specifier and emit full nanosecond
# precision instead, silently setting the poll cursor decades in the future
# (the watcher then looks alive forever while never finding anything new).
# This is the only correct way to get a real epoch-millisecond integer:
last_ts=$(( $(date +%s%N) / 1000000 ))
last_ids='[]'    # JSON array of every post id at the current watermark timestamp
have_watermark=""
last_err=""

while true; do
  # Gotcha 4 (query side): Mattermost's `since` param is a strict *exclusive*
  # boundary server-side (WHERE UpdateAt > ?, not >=). Querying at exactly
  # the last-seen timestamp would silently drop a sibling post that shares
  # that same millisecond -- the server excludes it before this script's own
  # dedupe ever runs. Query one ms *below* the watermark instead, and rely on
  # the id-based dedupe below (not the timestamp) to skip the already-seen
  # post(s) that come back as a result of doing this.
  query_since=$([ -n "$have_watermark" ] && echo $((last_ts - 1)) || echo "$last_ts")

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
    # `$seen` (a JSON array, may hold more than one id -- see the watermark
    # comment below) excludes post(s) already processed last cycle: they
    # come back from the server because we deliberately query one ms below
    # the watermark (Gotcha 4 above).
    jqerr=$(mktemp)
    # Sorted oldest-first: Mattermost's `order` array is newest-first, and
    # printing in that order would surface 2+ same-cycle messages to the
    # agent out of chronological sequence.
    posts=$(jq -c --arg user "$MM_USER_ID" --argjson seen "$last_ids" '
      (.order // []) as $order
      | [$order[] as $id | .posts[$id] | select(.user_id == $user and .delete_at == 0 and (.id as $i | $seen | index($i) | not))]
      | sort_by(.create_at)
      | .[]
    ' < "$tmp" 2>"$jqerr")

    if [ -s "$jqerr" ]; then
      echo "Watcher error: failed to parse Mattermost response, retrying"
    fi
    rm -f "$jqerr"

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
        printf '%s replied: %s\n' "$MM_LABEL" "$msg"
      done

      # Advance the watermark to the newest post actually seen this cycle.
      # Track *every* id sharing that max timestamp, not just one -- a tied
      # sibling whose id isn't remembered would still match `since` next
      # cycle (Gotcha 4) and get reprinted as a spurious duplicate.
      watermark=$(printf '%s\n' "$posts" | jq -c -s '
        (map(.create_at) | max) as $t
        | {ts: $t, ids: [.[] | select(.create_at == $t) | .id]}
      ')
      new_ts=$(printf '%s' "$watermark" | jq -r '.ts')
      if [ -n "$new_ts" ] && [ "$new_ts" != "null" ]; then
        last_ts=$new_ts
        last_ids=$(printf '%s' "$watermark" | jq -c '.ids')
        have_watermark=1
      fi
    fi
  fi

  rm -f "$tmp"
  sleep 2
done
