---
name: external-chat
description: Use when the user wants an ongoing, live conversation with you over Mattermost instead of only in this terminal session — e.g. "keep talking to me in chat", "watch for my replies while I'm away", "let's continue over Mattermost".
---

# External Chat

## Overview

Lets you hold a live, two-way conversation with the operator over Mattermost
for the rest of this session: you watch a channel for new messages and reply
as they arrive, instead of only responding inside this terminal.

## When to use

- The user wants to be reachable over Mattermost, or wants to keep talking
  while they step away.
- Not for something that outlives this session (a service managing coding
  sessions on its own, reachable with none running) — different
  architecture, not this skill. Say so if that's what's being asked for.

## Setup

**If `$CONTROL_PLANE_DAEMON` is set** (this session was spawned by the
control-plane daemon, not started directly): everything is already resolved —
use it, don't re-derive or create anything.
- Operator id: `$MATTERMOST_OPERATOR_USER_ID`.
- Your channel: `source ./.control-plane-session-env` in your working
  directory, then use `$MATTERMOST_SESSION_CHANNEL_ID`. This is the session's
  own dedicated channel — never create or resolve a different one.

**Otherwise** (a plain interactive session): resolve via the `mattermost` MCP
server if available, else the raw REST API.
- Your own user id — `GET /api/v4/users/me`.
- The operator's user id — `GET /api/v4/users/email/<email>` (default
  `$OPERATOR_EMAIL`, before asking).
- A dedicated channel for *this* unit of work — `POST /api/v4/channels`
  (`type: "P"`), then add the operator. Fresh one per task, not one reused
  indefinitely — avoids accumulating unrelated history across unrelated work.

**Both paths**: host/token — derive the REST host from `$MATTERMOST_MCP_URL`
(strip the MCP-specific path, keep scheme+host); reuse `$MATTERMOST_MCP_TOKEN`
as the Bearer token. As of KAN-12, daemon-spawned sessions get both the same
way any interactive shell does: the daemon spawns its shared `opencode serve`
process through `zsh -ic`, which sources `~/.config/configs.env` (and
`secrets.env`) into it, so `$MATTERMOST_MCP_URL` and the `mattermost` MCP
server work there too — no separate resolution path needed.

**Start the watcher** via the `Monitor` tool (not plain `Bash
run_in_background`), so new messages surface as events instead of something
you poll for:
```
MM_HOST=<resolved host> MM_TOKEN=$MATTERMOST_MCP_TOKEN \
MM_CHANNEL=<your channel id> MM_USER_ID=<operator's user id> \
/path/to/scripts/watch.sh
```

**Reply** via `create_post`, not `dm` — your channel is never a DM once it's
dedicated to a unit of work. Also needs `channel_display_name`/
`team_display_name` (via `get_channel_info` if not already known).

## Known gotchas

Confirmed the hard way — detail and fixes are in `scripts/watch.sh`'s
comments; this is just the index:

- Naive millisecond timestamps aren't portable across `date` builds.
- `/bin/sh`'s `echo` can silently corrupt JSON containing `\n` — use `printf`.
- Swallowing connection/HTTP errors is indistinguishable from working —
  always surface failures as visible lines.
- Mattermost's `since` filter is exclusive; naive dedupe drops
  same-millisecond sibling messages.

## Ending the conversation

**Daemon-spawned**: not your call — the daemon decides via `stop`, not you.
Don't stop the `Monitor` task yourself based on how the conversation reads.
Unverified whether `stop` also reaps your watcher process; if it doesn't,
your watcher may keep running after `stop` — that's a known gap, not
something to work around by self-terminating.

**Interactive**: stop the `Monitor` task when the conversation wraps up or
the session ends — session-scoped, not persistent.
