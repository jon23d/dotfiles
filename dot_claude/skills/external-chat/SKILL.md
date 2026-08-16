---
name: external-chat
description: Use when the user wants an ongoing, live conversation with you over Mattermost instead of only in this terminal session — e.g. "keep talking to me in chat", "watch for my replies while I'm away", "let's continue over Mattermost". Not for one-off completion/blocked notifications (use telegram-notification for that) and not for a persistent, always-on service outliving this session (see the KAN-1-style control-plane-daemon pattern for that).
---

# External Chat

## Overview

Lets you hold a live, two-way conversation with the operator over a Mattermost
DM for the rest of this session: you watch their channel for new messages and
reply as they arrive, instead of only responding inside this terminal. This
formalizes a pattern that was previously hand-rolled from scratch and had to
have three separate bugs found and fixed the hard way before this skill
existed — see `scripts/watch.sh`'s comments for the story behind each one.
Don't rebuild this from first principles; the naive version is the version
that was already tried and broken.

## When to use

- The user asks to be reachable/reached over Mattermost instead of only this
  terminal, or to keep a conversation going while they step away.
- Not for a single "task done" / "task blocked" ping — that's
  `telegram-notification`, a one-shot fire-and-forget.
- Not for something that needs to outlive this session (a service that starts
  and manages coding sessions on its own, reachable even when no interactive
  session is running) — that's a different architecture entirely, not this
  skill. Say so if the user's ask sounds like that instead.

## Setup

1. **Resolve identities and the channel**, using the `mattermost` MCP server
   if available, or the raw REST API otherwise:
   - Your own user id — `GET /api/v4/users/me`.
   - The operator's user id — `GET /api/v4/users/email/<their email>`. Ask
     for their email if you don't have it; don't guess.
   - The DM channel id — `POST /api/v4/channels/direct` with
     `[yourId, theirId]`. Idempotent: safe to call every time, returns the
     existing channel if one's already there. (Mattermost allows exactly one
     DM channel per pair of users — there is no such thing as a second one.)
   - Host and bot token: derive the REST host from `$MATTERMOST_MCP_URL`
     (strip the `/plugins/...` MCP-specific path, keep the scheme+host), and
     reuse `$MATTERMOST_MCP_TOKEN` — it's a real Personal Access Token, valid
     for the plain REST/WebSocket API too, not just the MCP endpoint.
2. **Start the watcher** via the `Monitor` tool (not plain `Bash
   run_in_background`) so each new message surfaces as an event in your
   conversation instead of something you have to poll for yourself:
   ```
   MM_HOST=<resolved host> MM_TOKEN=$MATTERMOST_MCP_TOKEN \
   MM_CHANNEL=<channel id> MM_USER_ID=<operator's user id> \
   /path/to/scripts/watch.sh
   ```
   Copy `scripts/watch.sh` somewhere runnable first if it's not already
   on disk where you can execute it.
3. **Reply** with the `mattermost` MCP server's `dm` tool. Always pass
   `username` explicitly set to the operator — the tool defaults to sending
   to *yourself* when it's omitted, which silently posts to the wrong
   identity and looks like nothing happened.

## Known gotchas

All confirmed the hard way in a real session, not theoretical. Full detail
and the actual fix for each lives as comments in `scripts/watch.sh` — this is
just the index:

- Naive `date +%s%3N` millisecond timestamps aren't portable — some `date`
  builds silently give nanosecond precision instead, breaking the poll
  cursor in a way that looks like the watcher is fine.
- `/bin/sh`'s `echo` can silently corrupt JSON containing `\n` — use `printf`.
- A watcher that swallows connection/HTTP errors looks identical to one
  that's working. Surface failures as visible lines, always.
- Mattermost's `since` filter is a strict exclusive boundary; naive
  timestamp-based deduping silently drops same-millisecond sibling messages.

## Ending the conversation

Stop the `Monitor` task when the conversation naturally wraps up or the
session ends — this is session-scoped, not a persistent service. If the user
wants something that survives across sessions and can be reached even when no
interactive agent is running, that's a fundamentally different thing to
build, not a variant of this skill.
