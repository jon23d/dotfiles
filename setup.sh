#!/bin/sh
# Bootstrap a new machine with dotfiles
sh -c "$(curl -fsLS get.chezmoi.io)" -- init --apply git@github.com:jon23d/dotfiles.git
