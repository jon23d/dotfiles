#!/bin/bash
set -e

# Only run on Linux
if [ "$(uname)" != "Linux" ]; then
  exit 0
fi

# opencode
curl -fsSL https://opencode.ai/install | bash

# uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# node via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
. "$HOME/.nvm/nvm.sh"
nvm install 24

# VS Code CLI
mkdir -p /tmp/vscode_install
cd /tmp/vscode_install
wget -O vscode_cli.tar.gz "https://update.code.visualstudio.com/latest/cli-linux-x64/stable"
tar -xzf vscode_cli.tar.gz
sudo mv code /usr/local/bin/
cd /
rm -rf /tmp/vscode_install

# Aliases
grep -qF 'alias vscode=' ~/.bashrc || echo 'alias vscode="code serve-web --host 0.0.0.0 --port 8080 --without-connection-token"' >> ~/.bashrc
grep -qF 'alias openserve=' ~/.bashrc || echo 'alias openserve="opencode web --hostname 0.0.0.0"' >> ~/.bashrc
grep -qF 'alias co=' ~/.bashrc || echo 'alias co="git checkout"' >> ~/.bashrc

# Utilities
sudo apt-get install -y tree tmux tmuxinator

# Bash prompt
grep -qF 'bash/prompt.sh' ~/.bashrc || echo '[ -f ~/.config/bash/prompt.sh ] && source ~/.config/bash/prompt.sh' >> ~/.bashrc
