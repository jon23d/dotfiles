__prompt_machine_colors() {
    local user
    user=$(id -un)
    local host
    host=$(hostname -s 2>/dev/null || uname -n)

    if [ "${EUID:-$(id -u)}" = "0" ] || [ "$user" = "root" ]; then
        echo "160 226"   # red bg, yellow fg
        return
    fi

    case "$host" in
        MacBookPro)  echo "28 255"; return ;;   # forest green bg, white fg (home)
        hal)         echo "53 255"; return ;;   # deep purple bg, white fg (server)
        jdeason-MAC) echo "24 255"; return ;;   # dark teal bg, white fg (work)
    esac

    if [ "$(uname)" = "Darwin" ]; then
        echo "119 22"    # light green bg, dark green fg
    elif [ "$user" = "ubuntu" ]; then
        echo "33 255"    # blue bg, white fg
    else
        echo "220 94"    # golden yellow bg, dark amber fg
    fi
}

__prompt_machine_icon() {
    local host
    host=$(hostname -s 2>/dev/null || uname -n)
    case "$host" in
        MacBookPro)  printf '%s' '' ;;   # home mac
        hal)         printf '%s' '' ;;   # mac server
        jdeason-MAC) printf '%s' '' ;;   # work mac
        *)
            if [ "$(uname)" = "Darwin" ]; then
                printf '%s' ''          # unlisted mac
            else
                printf '%s' ''          # vm / other linux
            fi
            ;;
    esac
}

__prompt_git() {
    local branch
    branch=$(git symbolic-ref --short HEAD 2>/dev/null) || return
    local dirty=""
    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
        dirty=" ✱"
    fi
    printf " %s%s " "$branch" "$dirty"
}
