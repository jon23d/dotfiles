. "$HOME/.config/shell/prompt_common.sh"

__build_ps1() {
    local sep=''
    local reset='\[\e[0m\]'
    read -r mbg mfg <<< "$(__prompt_machine_colors)"

    local ubg=99  ufg=255   # user:  purple bg, white fg
    local pbg=238 pfg=252   # path:  dark gray bg, light gray fg
    local gbg=61  gfg=255   # git:   slate blue bg, white fg    
    local gdirty_fg=220     # git dirty: yellow text

    local git_text
    git_text=$(__prompt_git)

    local micon
    micon=$(__prompt_machine_icon)

    local ps1=""

    # Machine
    ps1+="\[\e[38;5;${mfg}m\]\[\e[48;5;${mbg}m\] ${micon} \h "
    # Arrow: machine -> user
    ps1+="\[\e[38;5;${mbg}m\]\[\e[48;5;${ubg}m\]${sep}"
    # User
    ps1+="\[\e[38;5;${ufg}m\] \u "
    # Arrow: user -> path
    ps1+="\[\e[38;5;${ubg}m\]\[\e[48;5;${pbg}m\]${sep}"
    # Path
    ps1+="\[\e[38;5;${pfg}m\] \w "

    if [ -n "$git_text" ]; then
        # Arrow: path -> git
        ps1+="\[\e[38;5;${pbg}m\]\[\e[48;5;${gbg}m\]${sep}"
        # Git (yellow if dirty)
        if [[ "$git_text" == *"✱"* ]]; then
            ps1+="\[\e[38;5;${gdirty_fg}m\]${git_text}"
        else
            ps1+="\[\e[38;5;${gfg}m\]${git_text}"
        fi
        ps1+="${reset}\[\e[38;5;${gbg}m\]${sep}${reset}"
    else
        ps1+="${reset}\[\e[38;5;${pbg}m\]${sep}${reset}"
    fi

    ps1+=" "
    PS1="$ps1"
}

PROMPT_COMMAND="__build_ps1${PROMPT_COMMAND:+; $PROMPT_COMMAND}"

