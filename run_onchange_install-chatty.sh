#!/bin/bash
set -e

# Keep ~/code/chatty cloned/updated, and delegate to its own install script.
#
# The KAN-2 control-plane daemon used to live in this repo
# (dot_local/share/control-plane-daemon) and this script hashed its source
# tree so chezmoi would re-run the installer whenever any of it changed
# (see dotfiles memory: "control-plane-daemon install script: chezmoi
# run_onchange hash-list coverage gap"). As of KAN-19 that daemon is its
# own repo, https://github.com/jon23d/chatty, with its own install script
# (scripts/install.sh) and its own restart policy (it always restarts on
# every invocation -- see that script's own comment for why). This script's
# job is now much simpler: keep the checkout current and hand off.
#
# No file-hash comment block is needed here (unlike the old script): this
# script no longer depends on any content outside its own body -- chatty's
# source isn't part of this repo anymore, so there's nothing external to
# hash. chezmoi's own run_onchange_ mechanism already re-runs this script
# whenever ITS OWN content changes (i.e. whenever this file itself is
# edited), which is now sufficient on its own. It also no longer needs the
# `.tmpl` suffix -- there's nothing left in it for chezmoi to template,
# matching the convention this repo's other non-templated run_onchange_
# scripts already use (e.g. run_onchange_configure-claude-mcp.sh).
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
