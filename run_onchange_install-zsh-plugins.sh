#!/bin/sh
set -e

if [ "$(uname)" = "Darwin" ]; then
    brew install zsh-autosuggestions zsh-syntax-highlighting
elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y zsh-autosuggestions zsh-syntax-highlighting
fi
