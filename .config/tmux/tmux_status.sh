#!/usr/bin/env bash

# 1. CPU Usage (using top: summing user + system CPU)
CPU_PCT=$(top -bn1 | grep -i "cpu(s)" | awk '{print $2 + $4}' | cut -d. -f1)
CPU_PCT=${CPU_PCT:-0} # Fallback to 0 if empty

# 2. Disk Usage (using df on the root partition /)
read D_USED D_TOT D_PCT <<< $(df -k / | awk 'NR==2 {printf "%.0f %.0f %s", $3/1024/1024, $2/1024/1024, $5}' | tr -d '%')

# 3. Memory Usage (using free)
read M_USED M_TOT M_PCT <<< $(free -m | awk 'NR==2 {printf "%.1f %.0f %.0f", $3/1024, $2/1024, ($3/$2)*100}')

# 4. Color Logic (turns red at 80% or higher)
[ "$CPU_PCT" -ge 80 ] && C_CPU="#[fg=red,bold]" || C_CPU="#[fg=white]"
[ "$D_PCT" -ge 80 ]   && C_DSK="#[fg=red,bold]" || C_DSK="#[fg=white]"
[ "$M_PCT" -ge 80 ]   && C_MEM="#[fg=red,bold]" || C_MEM="#[fg=white]"

BULLET="#[fg=colour244] • "

# Print the formatted tmux string
echo "${C_CPU}CPU ${CPU_PCT}%${BULLET}${C_DSK}Disk ${D_USED}G (${D_PCT}%) of ${D_TOT}G${BULLET}${C_MEM}MEM ${M_USED}G (${M_PCT}%) of ${M_TOT}G"
