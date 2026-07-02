#!/bin/sh
set -e

grep -qF '.config/zsh/rc.sh' ~/.zshrc 2>/dev/null || echo '[ -f "$HOME/.config/zsh/rc.sh" ] && source "$HOME/.config/zsh/rc.sh"' >> ~/.zshrc
