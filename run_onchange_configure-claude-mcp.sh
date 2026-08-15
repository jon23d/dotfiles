#!/bin/sh
set -e

# Mirrors the MCP servers declared in ~/.config/opencode/opencode.jsonc so
# every Claude Code session (any project) has the same tool access.
# Secrets are NOT embedded here: Claude Code expands ${VAR} at connection
# time from the shell environment, same as opencode's {env:VAR} syntax.
# chezmoi re-runs this script whenever its contents change, so add a new
# server by editing a block below, not by running `claude mcp add` by hand.

command -v claude >/dev/null 2>&1 || exit 0

add_server() {
  name="$1"
  json="$2"
  claude mcp remove "$name" --scope user >/dev/null 2>&1 || true
  claude mcp add-json "$name" "$json" --scope user
}

# mcp-atlassian is launched via `uvx`; install uv if it's missing.
command -v uvx >/dev/null 2>&1 || curl -LsSf https://astral.sh/uv/install.sh | sh

add_server gitea-mcp '{
  "type": "stdio",
  "command": "gitea-mcp",
  "args": ["-t", "stdio", "-H", "${GITEA_URL}", "-T", "${GITEA_MCP_TOKEN}"]
}'

add_server outline '{
  "type": "http",
  "url": "https://wiki.jon23d.cc/mcp",
  "headers": {
    "Authorization": "Bearer ${OUTLINE_API_KEY}"
  }
}'

add_server basic-memory '{
  "type": "http",
  "url": "https://memory.jon23d.cc/mcp"
}'

add_server context7 '{
  "type": "http",
  "url": "https://mcp.context7.com/mcp",
  "headers": {
    "Authorization": "Bearer ${CONTEXT7_API_TOKEN}"
  }
}'

# mcp-atlassian>=0.23.0 pins atlassian-python-api>=4.0.0 with no upper bound,
# so uvx resolves the 5.x rewrite, which removed methods (e.g. get_page_by_id)
# that mcp-atlassian's code still calls. Pin below 5.0 until upstream catches up.
add_server mcp-atlassian '{
  "type": "stdio",
  "command": "uvx",
  "args": ["--with", "atlassian-python-api<5.0.0", "mcp-atlassian"],
  "env": {
    "JIRA_URL": "${JIRA_URL}",
    "JIRA_USERNAME": "${JIRA_USERNAME}",
    "JIRA_API_TOKEN": "${JIRA_API_TOKEN}"
  }
}'

# One bot account per host (platform/mattermost in gitops); MATTERMOST_MCP_TOKEN
# is resolved per-hostname in zsh/rc.sh from MATTERMOST_TOKEN_<HOSTNAME> in
# secrets.env, so this block itself is identical on every machine.
add_server mattermost '{
  "type": "http",
  "url": "${MATTERMOST_MCP_URL}",
  "headers": {
    "Authorization": "Bearer ${MATTERMOST_MCP_TOKEN}"
  }
}'
