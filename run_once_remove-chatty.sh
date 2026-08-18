#!/bin/sh
set -eu

# One-time cleanup for the Mattermost control-plane daemon ("chatty"), which
# this repo no longer provisions. Stops and disables its systemd *user* unit,
# deletes the unit file, and removes its code/config/checkout where present.
#
# Linux-only (systemd lives only there), and every step is a guarded no-op when
# the daemon was never installed on a node — safe to run on clean machines too.
# This is a `run_once_` script because, once the daemon is gone, it's gone;
# nothing here needs to re-run on later `chezmoi apply`s.

# Linux only, and refuse an empty $HOME before any rm -rf.
[ "$(uname)" = "Linux" ] || exit 0
[ -n "${HOME:-}" ] || exit 0
command -v systemctl >/dev/null 2>&1 || exit 0

unit="control-plane-daemon.service"

# Stop + disable are no-ops (via `|| true`) when the unit doesn't exist or the
# user systemd bus isn't reachable from this shell; removing the unit file is
# what makes the removal durable across reboot/login.
systemctl --user stop "$unit" 2>/dev/null || true
systemctl --user disable "$unit" 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/$unit"
systemctl --user daemon-reload 2>/dev/null || true

# Daemon code + its env file (holds a MATTERMOST_MCP_TOKEN) + the KAN-19-era
# chatty checkout, if this node was migrated to that layout.
rm -rf "$HOME/.local/share/control-plane-daemon"
rm -rf "$HOME/.config/control-plane-daemon"
rm -rf "$HOME/code/chatty"

echo "remove-chatty: control-plane daemon cleanup complete (no-op if not installed)"
