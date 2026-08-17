#!/bin/bash
set -e

# Keep ~/code/chatty cloned/updated, and delegate to its own install script.
#
# The KAN-2 control-plane daemon used to live in this repo
# (dot_local/share/control-plane-daemon) and its old install hook
# (run_onchange_install-control-plane-daemon.sh.tmpl) hashed its source
# tree into a template comment so chezmoi would re-run the installer
# whenever any of it changed (see dotfiles memory: "control-plane-daemon
# install script: chezmoi run_onchange hash-list coverage gap"). As of
# KAN-19 that daemon is its own repo, https://github.com/jon23d/chatty,
# with its own install script (scripts/install.sh) and its own restart
# policy (it always restarts on every invocation -- see that script's own
# comment for why). This script's job is now much simpler: keep the
# checkout current and hand off.
#
# This is a plain `run_` script, NOT `run_onchange_`. chezmoi's
# run_onchange_ mechanism only re-runs a script when the SHA256 hash of
# ITS OWN rendered content changes -- it cannot detect "chatty has new
# upstream commits" since that state lives in a different git repo
# entirely, outside anything chezmoi hashes. A run_onchange_ variant of
# this script (once it dropped the old daemon's file-hash comment block,
# having nothing left in this repo to hash) would only ever run once, on
# the first apply after this file itself was last edited, and then never
# again -- silently defeating the "keep chatty current" goal. Plain
# `run_` scripts instead run on EVERY `chezmoi apply`, unconditionally
# (https://www.chezmoi.io/user-guide/use-scripts-to-perform-actions/:
# "These scripts are executed every time you run `chezmoi apply`."),
# which is exactly the "run every apply, cheaply and idempotently"
# behavior this needs. That's safe here because both steps this script
# drives are already idempotent no-ops when nothing changed: `git pull
# --ff-only` on an up-to-date checkout, and chatty's own
# scripts/install.sh, which is designed to always restart the daemon on
# every invocation regardless of whether anything actually changed (see
# that script's own comment). It also no longer needs the `.tmpl`
# suffix -- there's nothing left in it for chezmoi to template, matching
# the convention this repo's other non-templated run_ scripts already use
# (e.g. run_onchange_configure-claude-mcp.sh, run_once_install-tools.sh).
#
# This script deliberately does NOT let a chatty-side failure (network
# down, repo unreachable, chatty's own install.sh erroring) fail this
# script's own exit code -- a chatty problem must never block the rest of
# `chezmoi apply` from finishing. Failures here are echoed loudly instead.

[ "$(uname)" = "Linux" ] || exit 0
command -v systemctl >/dev/null 2>&1 || exit 0

chatty_dir="$HOME/code/chatty"
chatty_repo="git@github.com:jon23d/chatty.git"

# Everything chatty-related happens inside this function so a failure
# anywhere in it can be caught by the `if` below without triggering this
# script's own `set -e` exit -- `set -e` is suspended while a command list
# is being evaluated as an `if`/`while` condition, including every command
# a called function runs as part of that condition. Each step below is
# still explicitly chained with `|| return 1` so a failure partway through
# stops the rest of the function instead of plowing ahead regardless.
install_chatty() {
  if ! command -v git >/dev/null 2>&1; then
    echo "install-chatty: no git on PATH, cannot clone/update chatty."
    return 1
  fi

  if [ -d "$chatty_dir/.git" ]; then
    echo "install-chatty: updating existing checkout at $chatty_dir"
    git -C "$chatty_dir" pull --ff-only || return 1
  else
    echo "install-chatty: cloning $chatty_repo to $chatty_dir"
    mkdir -p "$(dirname "$chatty_dir")" || return 1
    git clone "$chatty_repo" "$chatty_dir" || return 1
  fi

  if [ ! -x "$chatty_dir/scripts/install.sh" ]; then
    echo "install-chatty: $chatty_dir/scripts/install.sh missing or not executable"
    return 1
  fi

  echo "install-chatty: running $chatty_dir/scripts/install.sh"
  "$chatty_dir/scripts/install.sh" || return 1
}

if install_chatty; then
  echo "install-chatty: chatty installed/updated successfully"
else
  echo "install-chatty: FAILED -- see messages above."
  echo "install-chatty: chatty was not (re)installed; the daemon may be stale, not running, or unaffected, depending on where this failed."
  echo "install-chatty: this does not fail dotfiles' own chezmoi apply -- fix the issue and re-run 'chezmoi apply' to retry."
fi
