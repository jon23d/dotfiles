HISTFILE="$HOME/.zsh_history"
HISTSIZE=50000
SAVEHIST=50000
setopt APPEND_HISTORY
setopt INC_APPEND_HISTORY
setopt SHARE_HISTORY
setopt HIST_IGNORE_DUPS
setopt HIST_IGNORE_SPACE

[ -f "$HOME/.config/shell/aliases.sh" ] && source "$HOME/.config/shell/aliases.sh"
[ -f "$HOME/.config/secrets.env" ] && source "$HOME/.config/secrets.env"
[ -f "$HOME/.config/configs.env" ] && source "$HOME/.config/configs.env"

# Mattermost bot identity is one account per host (see gitops:
# platform/mattermost) -- secrets.env holds MATTERMOST_TOKEN_<HOSTNAME> per
# bot; resolve this shell's own host to the right one so every harness
# (Claude Code, opencode, ...) can just reference the generic
# MATTERMOST_MCP_TOKEN without knowing which host it's on.
export MATTERMOST_MCP_TOKEN="$(eval echo \$MATTERMOST_TOKEN_$(hostname | tr '[:lower:]-' '[:upper:]_'))"

for _p in \
    /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh \
    /usr/local/share/zsh-autosuggestions/zsh-autosuggestions.zsh \
    /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh
do
    [ -f "$_p" ] && source "$_p" && break
done

# zsh-syntax-highlighting must be sourced last among the plugins
for _p in \
    /opt/homebrew/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh \
    /usr/local/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh \
    /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
do
    [ -f "$_p" ] && source "$_p" && break
done
unset _p

# override zsh-syntax-highlighting's default glob-character color (dark blue
# by default, hard to read on dark terminal backgrounds)
ZSH_HIGHLIGHT_STYLES[globbing]='fg=cyan,bold'

# prompt.zsh registers a precmd hook; source it last so it has the final
# say over $PROMPT regardless of what the plugins' own precmd hooks do
[ -f "$HOME/.config/zsh/prompt.zsh" ] && source "$HOME/.config/zsh/prompt.zsh"

# Add opencode binary
export PATH=/home/jon23d/.opencode/bin:$PATH
