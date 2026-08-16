---
name: external-chat
description: Use when the user wants an ongoing, live conversation with you over Mattermost instead of only in this terminal session — e.g. "keep talking to me in chat", "watch for my replies while I'm away", "let's continue over Mattermost".
---

# External Chat

## Overview

Lets you hold a live, two-way conversation with the operator over a Mattermost
DM for the rest of this session: you watch their channel for new messages and
reply as they arrive, instead of only responding inside this terminal. 

## When to use

- The user asks to be reachable/reached over Mattermost instead of only this
  terminal, or to keep a conversation going while they step away.
- Not for something that needs to outlive this session (a service that starts
  and manages coding sessions on its own, reachable even when no interactive
  session is running) — that's a different architecture entirely, not this
  skill. Say so if the user's ask sounds like that instead.

## Setup

1. **Resolve identities and the channel** via the `mattermost` MCP server if
   available, else the raw REST API:
   - Your own user id — `GET /api/v4/users/me`.
   - The operator's user id *and* username — `GET /api/v4/users/email/<email>`
     (default to `$OPERATOR_EMAIL`, same variable/default the control-plane
     daemon uses, before asking the user). One response, both fields — grab
     `username` here too, step 3 needs it and it's easy to miss otherwise.
   - The channel id — `POST /api/v4/channels/direct` with `[yourId, theirId]`.
     Idempotent, safe to call every time. (Exactly one DM per pair of users —
     no such thing as a second one.)
   - Host and bot token: derive the REST host from `$MATTERMOST_MCP_URL`
     (strip the MCP-specific path, keep scheme+host); reuse
     `$MATTERMOST_MCP_TOKEN` as the Bearer token — valid for the plain
     REST/WebSocket API too, not just the MCP endpoint.
2. **Start the watcher** via the `Monitor` tool (not plain `Bash
   run_in_background`), so new messages surface as events instead of
   something you poll for:
   ```
   MM_HOST=<resolved host> MM_TOKEN=$MATTERMOST_MCP_TOKEN \
   MM_CHANNEL=<channel id> MM_USER_ID=<operator's user id> \
   /path/to/scripts/watch.sh
   ```
3. **Reply** with the `mattermost` MCP server's `dm` tool, `username` always
   set explicitly to the operator's username from step 1 — omitted, it
   defaults to sending to *yourself*, which silently posts to the wrong
   identity.

## Known gotchas

Confirmed the hard way, not theoretical — full detail and the fix for each
lives as comments in `scripts/watch.sh`; this is just the index:

- Naive millisecond timestamps aren't portable across `date` builds.
- `/bin/sh`'s `echo` can silently corrupt JSON containing `\n` — use `printf`.
- A watcher that swallows connection/HTTP errors is indistinguishable from
  one that's working — surface failures as visible lines, always.
- Mattermost's `since` filter is exclusive; naive dedupe drops
  same-millisecond sibling messages.

## Ending the conversation

Stop the `Monitor` task when the conversation naturally wraps up or the
session ends — this is session-scoped, not a persistent service. If the user
wants something that survives across sessions and can be reached even when no
interactive agent is running, that's a fundamentally different thing to
build, not a variant of this skill.
