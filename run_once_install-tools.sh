#!/bin/bash
set -e

# Only run on Linux
if [ "$(uname)" != "Linux" ]; then
  exit 0
fi

# Bash prompt
grep -qF 'bash/prompt.sh' ~/.bashrc || echo '[ -f ~/.config/bash/prompt.sh ] && source ~/.config/bash/prompt.sh' >> ~/.bashrc
