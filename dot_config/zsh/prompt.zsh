. "$HOME/.config/shell/prompt_common.sh"

__build_prompt() {
    local sep=''

    local mbg mfg
    read -r mbg mfg <<< "$(__prompt_machine_colors)"

    local ubg=99  ufg=255   # user:  purple bg, white fg
    local pbg=238 pfg=252   # path:  dark gray bg, light gray fg
    local gbg=61  gfg=255   # git:   slate blue bg, white fg
    local gdirty_fg=220     # git dirty: yellow text

    local git_text
    git_text=$(__prompt_git)

    local micon
    micon=$(__prompt_machine_icon)

    local prompt=""

    # Machine
    prompt+="%F{${mfg}}%K{${mbg}} ${micon} %m "
    # Arrow: machine -> user
    prompt+="%F{${mbg}}%K{${ubg}}${sep}"
    # User
    prompt+="%F{${ufg}} %n "
    # Arrow: user -> path
    prompt+="%F{${ubg}}%K{${pbg}}${sep}"
    # Path
    prompt+="%F{${pfg}} %~ "

    if [ -n "$git_text" ]; then
        # Arrow: path -> git
        prompt+="%F{${pbg}}%K{${gbg}}${sep}"
        # Git (yellow if dirty)
        if [[ "$git_text" == *"✱"* ]]; then
            prompt+="%F{${gdirty_fg}}${git_text}"
        else
            prompt+="%F{${gfg}}${git_text}"
        fi
        prompt+="%f%k%F{${gbg}}${sep}%f%k"
    else
        prompt+="%f%k%F{${pbg}}${sep}%f%k"
    fi

    prompt+=" "
    printf '%s' "$prompt"
}

setopt PROMPT_SUBST
PROMPT='$(__build_prompt)'
