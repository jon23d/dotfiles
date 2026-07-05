[ -f "$HOME/.config/shell/aliases.sh" ] && source "$HOME/.config/shell/aliases.sh"

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
