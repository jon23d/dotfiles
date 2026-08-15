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

# atlassian-python-api is pinned below 4: 4.x restructured the Confluence
# client so Confluence.factory() returns a Cloud object without get_page_by_id,
# cql or get_all_pages_from_space_raw, which mcp-atlassian still calls. Every
# Confluence tool then fails with "'Cloud' object has no attribute ...", while
# Jira tools keep working because the Jira client was not restructured. Do not
# drop the pin without checking that mcp-atlassian supports 4.x.
add_server mcp-atlassian '{
  "type": "stdio",
  "command": "uvx",
  "args": ["--with", "atlassian-python-api<4", "mcp-atlassian"],
  "env": {
    "JIRA_URL": "${JIRA_URL}",
    "JIRA_USERNAME": "${JIRA_USERNAME}",
    "JIRA_API_TOKEN": "${JIRA_API_TOKEN}"
  }
}'
