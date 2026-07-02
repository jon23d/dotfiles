[ -f "$HOME/.config/zsh/prompt.zsh" ] && source "$HOME/.config/zsh/prompt.zsh"
[ -f "$HOME/.config/shell/aliases.sh" ] && source "$HOME/.config/shell/aliases.sh"

for _p in \
    /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh \
    /usr/local/share/zsh-autosuggestions/zsh-autosuggestions.zsh \
    /usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh
do
    [ -f "$_p" ] && source "$_p" && break
done

# zsh-syntax-highlighting must be sourced last
for _p in \
    /opt/homebrew/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh \
    /usr/local/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh \
    /usr/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
do
    [ -f "$_p" ] && source "$_p" && break
done
unset _p
