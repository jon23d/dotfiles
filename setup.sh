#!/bin/sh
# Bootstrap a new machine with dotfiles
sh -c "$(curl -fsLS get.chezmoi.io)" -- init --apply jon23d
