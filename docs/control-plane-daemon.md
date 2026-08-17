# Control-plane daemon: operating guide

This is the operator's manual for the Mattermost control-plane daemon —
install it, run it, verify it, and fix it when something's wrong. It covers
the daemon itself (`dot_local/share/control-plane-daemon`) and the pieces it
depends on: the systemd unit, the environment/config files it and its spawned
sessions read, and the `opencode` harness it drives.

## What this is

The daemon lets you start, list, and stop coding-agent sessions on a VM from
a Mattermost DM, instead of needing a terminal open on that machine. You DM
the daemon's bot user `start opencode /path/to/project`, it spawns an
`opencode` session rooted at that folder and opens a dedicated private
channel for it (`#<n> : <hostname>`), and from then on anything you post in
that channel goes straight to the agent. `stop` and `list` round out the
remote-control surface. This is the KAN-1 epic's whole point: treat a coding
agent like a service you can start/stop/monitor from chat, not a `tmux`
session you have to SSH in to babysit.

One daemon runs per VM, one Mattermost bot account per VM, and (for the
`opencode` harness, the only one implemented so far) one shared `opencode
serve` process per VM shared by every session on that machine.

## Installing / deploying

The daemon ships as part of this dotfiles repo and installs itself via a
chezmoi `run_onchange_` script — there's no separate install step beyond
`chezmoi apply`.

### Fresh install on a new VM

1. **Give the VM its own Mattermost bot account and token.** Bot identity is
   one account per host (see `dot_config/zsh/rc.sh`'s comment on this). Add
   the token to `~/.config/secrets.env` as `MATTERMOST_TOKEN_<HOSTNAME>`
   (hostname uppercased, `-` becomes `_` — e.g. `devSix` →
   `MATTERMOST_TOKEN_DEVSIX`). See the main `README.md`'s "Secrets" section
   for how to edit and re-encrypt `secrets.env`.
2. **Run chezmoi.** `chezmoi init --apply jon23d` (first-ever machine setup)
   or `chezmoi apply` (chezmoi already initialized). This triggers
   `run_onchange_install-control-plane-daemon.sh.tmpl`, which:
   - runs `npm install --omit=dev` in
     `~/.local/share/control-plane-daemon`;
   - resolves this host's `MATTERMOST_TOKEN_<HOSTNAME>` out of
     `secrets.env` and writes it as `MATTERMOST_MCP_TOKEN` into
     `~/.config/control-plane-daemon/env` (mode `600`) — this becomes the
     systemd unit's `EnvironmentFile`;
   - runs `systemctl --user daemon-reload`, `enable`, and `restart` on
     `control-plane-daemon.service`;
   - enables `loginctl linger` for your user if passwordless `sudo` is
     available, so the daemon keeps running after you log out.
3. **Confirm it's alive** — see "Verifying it's working" below.

If `secrets.env` doesn't exist yet, or the host's token isn't in it, the
script says so and installs everything except the token; the daemon then
fails loudly at startup (a validation error, not a silent hang) until you
add the token and re-run `chezmoi apply`.

### Updating an existing install

Any change to `dot_local/share/control-plane-daemon/src/**`,
`package.json`, `package-lock.json`, or the systemd unit file
(`dot_config/systemd/user/control-plane-daemon.service`) changes what the
install script's own rendered output hashes, so a plain `chezmoi apply` on
the target VM re-runs the installer and restarts the service with the new
code. As of KAN-12, the whole `src/` tree is hashed automatically (a glob,
not a hand-maintained file list) — you no longer need to touch the install
script when you add a new source file.

On a VM that already has the daemon installed:

```
chezmoi update      # pulls the latest source and applies it
```

or, equivalently, `git pull` inside `chezmoi source-path` followed by
`chezmoi apply`.

**A restart drops every running session on that VM.** `SessionStore` is
in-memory only by design, so a restarted daemon starts back up knowing about
zero sessions. The systemd unit doesn't override `KillMode`, so systemd's
default (kill the whole cgroup on stop/restart) should also take the shared
`opencode serve` child down with the daemon. Either way, redeploying is not
something to do mid-session without warning whoever's using it — nothing
currently reconciles "what the daemon remembers" against "what's actually
still running" after a restart.

### Rolling out to additional VMs

Test on one VM first (this doc assumes that's `devSix`) before rolling out
elsewhere — the daemon's behavior depends on host-specific state (its own
bot token, its own PATH, its own `opencode` install) that's worth confirming
works before repeating the setup. To add a second VM once `devSix` is
verified:

1. Repeat the "Fresh install" steps above on the new VM: its own bot
   account/token in `secrets.env`, then `chezmoi apply` there.
2. Run through "Verifying it's working" on that VM specifically — a working
   `devSix` install says nothing about whether the new VM has `zsh`,
   `opencode`, and `~/.opencode/bin` on PATH in the same state.
3. Each VM's sessions and daemon are fully independent — there's no
   coordination between VMs (a `stop` on one host can't affect a session on
   another), so rolling out to VM #2 carries zero risk to VM #1.

## The operator command surface

Commands aren't shell commands — they're chat messages you DM to the
daemon's bot user. The daemon only reacts to messages from you (the
resolved `OPERATOR_EMAIL`) in that one DM channel; everything else is
ignored. Send `help` with no arguments for the live list, or `help
<command>` for one command's detail — the reply is generated straight from
the same registry this section describes, so it can't drift out of sync
with what's actually implemented.

| Command                              | What it does                                                             |
|---------------------------------------|-----------------------------------------------------------------------------|
| `help [command]`                     | Lists every command, or shows detailed usage for one.                   |
| `list`                                | Lists every known session, running ones first, with harness and folder. |
| `start <harness> <folder> [--force]` | Starts a new session using `<harness>` at `<folder>`.                   |
| `stop <identifier>`                   | Stops the session matching `<identifier>` exactly as `list` shows it.   |

Examples:

```
start opencode /home/jon/my-project
list
stop #4 : devsix
```

Notes on `start`:

- Only `opencode` is implemented as a harness today; `claude-code` is a
  recognized name (so a typo gets a clear "not implemented yet" reply
  instead of an "unknown harness" one) but has no working adapter.
- Only one session runs per VM at a time by default. If one's already
  running, `start` refuses and names it — add `--force` (anywhere in the
  arguments) to start a second one anyway.
- A session's default identifier is `#<n> : <hostname>`, where `<n>`
  increments per VM. The in-session agent can rename its own chat later
  (e.g. to a ticket id like `KAN-4`) by setting its own opencode session
  title — the daemon watches for that and renames the Mattermost channel to
  match.
- `start` opens a new private channel and adds you to it before the session
  is considered live; if any step fails partway, the daemon stops the
  session and archives the channel rather than leaving a half-created mess
  behind.

Once a session's channel exists, anything you post there goes straight to
that session as a prompt — you don't send it through the daemon DM.

## The environment and configuration model

This is the part KAN-12 changed, so it's worth being explicit about which
values come from where.

**What the daemon's own process needs** (validated at startup via `env.ts`;
missing/invalid values crash the daemon loudly rather than let it limp
along):

| Variable                   | Required? | Default                                                    |
|----------------------------|-----------|-------------------------------------------------------------|
| `MATTERMOST_MCP_TOKEN`     | yes       | none — the per-host bot PAT                                |
| `MATTERMOST_URL`           | no        | `https://mattermost.jon23d.cc`                             |
| `OPERATOR_EMAIL`           | no        | `jon23d@gmail.com`                                         |
| `STATE_FILE_PATH`          | no        | `~/.local/state/control-plane-daemon/state.json`           |
| `SESSION_NUMBER_FILE_PATH` | no        | `~/.local/state/control-plane-daemon/session-number.json`  |
| `LOG_LEVEL`                | no        | `info`                                                      |

In production these come from the systemd `EnvironmentFile`
(`~/.config/control-plane-daemon/env`), written by the install script from
`secrets.env`. There's deliberately no `MATTERMOST_MCP_URL` entry here —
see below.

**What a spawned `opencode serve` session needs, and how it gets it.**
Before KAN-12, the daemon spawned the `opencode` binary directly as a child
of its own systemd-user-service process, which never sources `~/.zshrc` /
`dot_config/zsh/rc.sh` / `~/.config/configs.env` the way a real login/
interactive shell does. Anything that only an interactive shell provides —
`MATTERMOST_MCP_URL` (needed by `opencode.jsonc`'s `mattermost` MCP server)
today, whatever `configs.env` grows tomorrow — was invisible to every
spawned session, silently breaking that MCP server. It also meant the
daemon's own PATH (which doesn't include `~/.opencode/bin` under systemd)
had to somehow already resolve `opencode`, which it very likely never
reliably did.

As of KAN-12, `spawnSharedServer` (`opencodeHarness.ts`) spawns the shared
process as `zsh -ic 'exec opencode serve --port <port> --hostname
127.0.0.1'` instead of invoking `opencode` directly. The child now inherits
whatever an ordinary interactive `zsh` login shell picks up, by
construction — `configs.env`, `secrets.env`, PATH additions, all of it —
instead of the daemon hand-forwarding one variable at a time. This is also
why `opencode` resolution now works: PATH resolution happens inside the
exec'd shell, which does get `~/.opencode/bin` added (`rc.sh`'s own `export
PATH=...` line).

**`zsh` is now a hard runtime dependency for the shared `opencode serve`
process** — not just your interactive login shell. There's deliberately no
code check for this (zsh is assumed always present on these VMs); if a VM
somehow lacks `zsh`, session spawning fails at the `zsh -ic` step. Verify
`zsh` is installed as part of any new-VM rollout.

**Two vars stay daemon-injected, not sourced from any rc file**, because
they're genuinely daemon-only facts no shell config could produce:
`CONTROL_PLANE_DAEMON=1` (lets an in-session agent tell it's running under
this daemon) and `MATTERMOST_OPERATOR_USER_ID` (who to treat as the
operator). Both are set directly on the spawned process's environment,
exactly like before KAN-12 — only the command/args passed to `spawnProcess`
changed.

**`configs.env` vs `secrets.env` vs the daemon's own `EnvironmentFile`** —
three different files, one shared source of truth for the token:

- `~/.config/configs.env` (this repo, `dot_config/configs.env`): general,
  non-secret config every interactive shell sources — currently just
  `TOOLSETS` and `MATTERMOST_MCP_URL` (Mattermost's embedded Agents-plugin
  MCP server URL).
- `~/.config/secrets.env`: per-host secrets, including
  `MATTERMOST_TOKEN_<HOSTNAME>` for every VM's bot account. `rc.sh` resolves
  the current host's token from this into `MATTERMOST_MCP_TOKEN` for every
  interactive shell.
- `~/.config/control-plane-daemon/env`: the daemon's own systemd
  `EnvironmentFile`, written once at install time by resolving the same
  `MATTERMOST_TOKEN_<HOSTNAME>` value — kept as its own narrowly-scoped file
  (rather than having the daemon inherit all of `secrets.env`) so the
  daemon's process, and now every session it spawns via `zsh -ic`, only ever
  sees this one secret and not everything else `secrets.env` holds.

The upshot: `MATTERMOST_MCP_TOKEN` ends up in three places (the daemon's own
process, every interactive shell, every spawned session) resolved from one
source; `MATTERMOST_MCP_URL` only ever needs to reach spawned sessions via
`configs.env`, never the daemon's own process — adding it to `env.ts` would
be the wrong layer and was deliberately not done.

## Verifying it's working

**Service health:**

```
systemctl --user status control-plane-daemon
journalctl --user -u control-plane-daemon -f
```

Look for `control plane daemon started`. On the first `start` command (or
any `start` after the shared process died), also look for `shared opencode
serve process is ready`, `confirmed opencode has the "Orchestrator" agent
available`, and the absence of any warning/error naming
`MATTERMOST_MCP_URL` — that message means the KAN-12 environment-parity
check found the spawned child missing it, and it names `configs.env` and
`rc.sh` as where to look.

**Command surface:** DM the bot `help` — a live command list back confirms
the daemon is connected to Mattermost and routing correctly.

**MCP connectivity — the direct way.** opencode itself exposes `GET /mcp`
(`operationId: mcp.status`) on the shared server's `baseUrl`, returning each
configured MCP server's live connection state — `{"status":"connected"}` on
success, or `"failed"` / `"disabled"` / `"needs-auth"` /
`"needs-client-registration"` otherwise. The port is logged at spawn time
(`shared opencode serve process is ready`, `{ port }`), so from the VM:

```
curl -s http://127.0.0.1:<port>/mcp | jq .
```

Look for `"mattermost": {"status": "connected"}`. This is a plain read-only
HTTP call — prefer it over reading `/proc/<pid>/environ` by hand, or
spending a live chat turn on a session just to sanity-check connectivity.

## Known operational risks

**Resolved: the Orchestrator agent's severe compaction loop (KAN-13).**
Earlier operation of this daemon saw the Orchestrator agent get stuck in an
unbounded compaction loop — one incident ran unattended for 160+ minutes,
~2.1M input tokens, sustained high CPU on the shared `opencode serve`
process, triggered by nothing more than an off-task prompt like "who are
you." Root cause: `opencode.jsonc` declared several `litellm` models but
pinned no default, so opencode's own default-model resolution silently
picked `small-model` (a 4096-token-context model) for every fresh session.
The Orchestrator agent's system prompt plus its MCP tool schemas cost far
more than 4096 tokens on their own, so the very first turn overflowed;
opencode's compaction/auto-continue handler can only shrink conversation
history, not the fixed prompt/tool-schema overhead that was actually
oversized, so every retry overflowed again identically, forever. Full
root-cause writeup: `.agent/research-kan13.md`.

Fixed by pinning explicit models in `opencode.jsonc`: a top-level `"model"`
key (`litellm/deepseek-v4-pro`, 1M-token context) as the default for every
session, and a `"small_model"` key (`litellm/small-model`) so opencode's own
cheap utility calls (e.g. title generation) use the small model on purpose
rather than by silent accident. `opencodeHarness.ts` also now sends an
explicit `model` field on every `createSession`/`sendPrompt` call as
defense-in-depth, so a future mistake in `opencode.jsonc` can't as easily
reintroduce this failure mode. **If you see anything that looks like this
loop again** (a session stuck, CPU pegged on the shared `opencode serve`
process, no reply) — suspect model configuration first: confirm
`opencode.jsonc`'s `model` still names a real, large-context model for the
configured `litellm` provider (`GET {LITELLM_URL}/models` and
`/model/info` confirm what's actually available) before assuming it's a new
bug.

**New: session errors post into the session's own Mattermost channel
(KAN-13).** When opencode reports a `session.error` event for a session (a
provider/model rejection, auth failure, or similar mid-conversation
failure), the daemon now posts a visible notice into that session's own
channel instead of the error only ever reaching the daemon's structured
log — see `HarnessSessionHandle.onError` (`src/harness.ts`) and its use in
`src/startCommand.ts`. This is the mechanism that would surface a
recurrence of the compaction-loop bug above, or any other model/provider
failure, directly in chat rather than requiring someone to go looking in
`journalctl`.

**Known limitation of that notice (KAN-14, open, not fixed here):** it
depends on the same `/event` SSE stream that KAN-7's rename detection uses,
which does not reconnect once it drops — `opencodeHarness.ts`'s event-stream
handling deliberately treats a dropped stream as a one-time terminal
condition rather than retrying (see its KAN-7 comments). If that stream
ever drops, the `onError` notice mechanism goes silently stale along with
rename detection: no more error notices, no more rename-driven channel
renames, and nothing surfaces that either has stopped working. This is a
known, disclosed gap tracked separately as KAN-14 — the loud-failure
mechanism above is real, but it can itself fail quietly over a long enough
uptime.

**New: `sendPrompt` verifies the pinned model actually took effect (KAN-13
follow-up).** Live-diagnosed on the real daemon, after the fix above was
already deployed: opencode can accept `prompt_async`'s explicit `model` pin
with a `204` and silently resolve the message under a *different* model
anyway (observed: `small-model` instead of the pinned `deepseek-v4-pro`) —
no error, no `session.error` event, nothing that the KAN-13 notice above
would ever catch. This reproduces the exact unbounded-compaction-loop
symptom from a completely silent starting point; two real sessions on this
host each spiraled into 300-900+ message loops this way with zero real
responses ever produced. `sendPrompt` now re-reads the message it just sent
(polling briefly — live-measured: not yet visible immediately after a
freshly-spawned server's `204`, reliably visible within ~300ms) and, on a
confirmed mismatch, aborts the session immediately and rejects loudly, which
surfaces through the *existing* delivery-failure path
(`forwardToSessionIfApplicable`'s catch in `daemon.ts`) as a real,
operator-visible chat notice — the same mechanism a `404` from `prompt_async`
itself already used. See `verifyPromptResolvedPinnedModel` in
`opencodeHarness.ts`.

**New: the Orchestrator agent now knows to reply via Mattermost for
daemon-driven sessions.** Before this, nothing in `orchestrator.md`
referenced `MATTERMOST_SESSION_CHANNEL_ID` or the daemon at all beyond the
KAN-7 rename step — a daemon-forwarded message reached the session exactly
like a normal prompt, so the agent just answered in-session, same as any
plain interactive session, and the operator (watching Mattermost, since the
daemon never relays replies itself) saw nothing. Live-confirmed the first
fix attempt wasn't forceful enough on its own: the model treated "reply via
Mattermost" as a judgment call similar to deciding whether to load the
`external-chat` skill, and skipped it for a message it judged "casual."
`orchestrator.md` now states this as a mandatory, unconditional first check
of every turn (`$CONTROL_PLANE_DAEMON` set → every reply also goes to
Mattermost, no exceptions), explicitly distinguished from `external-chat`
(opt-in, for plain interactive sessions) and `telegram-notification`
(one notification at task end) — verified live end-to-end afterward: a real
session, real prompt, real `mattermost_create_post` tool call, real message
landing in a real channel.

**Known, disclosed gap (KAN-13 follow-up, open, not fixed here): session/
channel routing does not survive a daemon restart.** `sessionStore.ts` and
the live `sessionRuntime` handle registry are in-memory only by design (see
that file's own doc comment) — a restart forgets every session it was
tracking, including which Mattermost channel routes to which live handle.
Live-reproduced on this host: a real operator message landed in a real,
just-created session's channel seconds before an unrelated daemon restart
(deploying an unrelated fix); the *next* message into that same channel was
silently dropped — `forwardToSessionIfApplicable`'s `sessionStore.findByChannelId`
lookup simply came back empty, and that branch returns without posting
anything, indistinguishable from "not a channel this daemon manages." Fixed
just enough to stop this being *invisible*: that branch now logs a `warn`
line (`daemon.ts`) naming the channel and post, so it is at least
discoverable via `journalctl` instead of leaving zero trace. The full fix —
persisting session/channel state and reconciling live opencode sessions on
restart — needs a new `HarnessAdapter` capability to *reattach* to an
existing opencode session rather than only ever creating one, which is a
separate, larger piece of work, not attempted here.

## Troubleshooting

**Daemon won't start / restarts in a loop.** Check
`journalctl --user -u control-plane-daemon` for `Invalid environment
variables` — almost always a missing or unresolved `MATTERMOST_MCP_TOKEN`.
Confirm `~/.config/control-plane-daemon/env` exists and has a real value;
re-run the install step if `MATTERMOST_TOKEN_<HOSTNAME>` was added to
`secrets.env` after the last `chezmoi apply`.

**`start` refuses with "a session is already running".** Expected (KAN-8):
either `stop` the running one first, or add `--force`.

**`start` fails with "the bot doesn't belong to any Mattermost team".** The
bot account needs to be added to at least one team before it can create
session channels.

**A spawned session can't reach the `mattermost` MCP server.** Check `GET
/mcp` (above) first. If it shows anything other than `connected`, check the
daemon's own logs for the KAN-12 environment-parity error/warning, then
confirm `~/.config/configs.env` exists on that VM and defines
`MATTERMOST_MCP_URL`, and that `dot_config/zsh/rc.sh` is still sourcing it.

**A code change doesn't seem to have deployed after `chezmoi apply`.**
Confirm the changed file is actually under
`dot_local/share/control-plane-daemon/src/**`, or is `package.json`,
`package-lock.json`, or the systemd unit — those are the only things the
install script's redeploy-trigger hashes. (Before KAN-12's third commit,
this hash list was hand-maintained and had drifted out of date; it's now a
glob over the whole `src/` tree, so this specific failure mode shouldn't
recur.)

**A session seems completely unresponsive and won't `stop`.** Check
`GET {LITELLM_URL}/models` and `opencode.jsonc`'s `model` key first — a
session stuck with the shared `opencode serve` process pegged at high CPU
matches the resolved Orchestrator compaction-loop bug (KAN-13, see "Known
operational risks" above) and usually means the pinned default model has
stopped resolving. If that checks out fine, `systemctl --user restart
control-plane-daemon` is the escape hatch, at the cost of every session on
that VM.

**Local development.** `cd dot_local/share/control-plane-daemon`, copy
`.env.example` to `.env`, fill in a real `MATTERMOST_MCP_TOKEN`, then `npm
run start` (or `npm test` / `npm run typecheck` — the project's only
verification gates, run manually, not wired into any CI). A real `opencode`
binary on PATH inside an interactive `zsh` shell is needed for `start` to
actually create sessions locally too, same as in production.
