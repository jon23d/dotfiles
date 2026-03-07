#!/bin/sh

# opencode
curl -fsSL https://opencode.ai/install | bash

# uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# node
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
\. "$HOME/.nvm/nvm.sh"
nvm install 24

# vs code
mkdir tmp
cd tmp
wget -O vscode_cli.tar.gz "https://update.code.visualstudio.com/latest/cli-linux-x64/stable"
gunzip vscode_cli.tar.gz
tar -xvf vscode_cli.tar
sudo mv code /usr/local/bin/
rm vscode_cli.tar.gz
cd ..
rm -fR tmp


echo "alias vscode=\"code serve-web --host 0.0.0.0 --port 8080 --without-connection-token\"" >> ~/.bashrc
echo "alias openserve=\"opencode web --hostname 0.0.0.0\"" >> ~/.bashrc
