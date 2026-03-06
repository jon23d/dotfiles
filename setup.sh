#!/bin/sh

# opencode
curl -fsSL https://opencode.ai/install | bash

# uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# node
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
\. "$HOME/.nvm/nvm.sh"
nvm install 24
