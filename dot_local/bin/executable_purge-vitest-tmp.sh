#!/usr/bin/env bash
# Purge orphaned Vitest SSR transform caches from $TMPDIR.
#
# Vitest 4 allocates join(tmpdir(), nanoid()) per Vitest instance and writes its
# SSR module cache there (~20MB/run). That directory is only removed on a
# graceful close, so any run killed by SIGKILL/OOM/pane-crash leaks it forever.
#
# On distros where /tmp is tmpfs this leaks RAM rather than disk, and
# systemd-tmpfiles only reaps /tmp at 10d -- far too slow when a busy agent VM
# leaks ~700MB/day. Left alone it becomes self-reinforcing: less free RAM ->
# OOM kill -> the crashed run leaks another dir.
#
# Removal requires ALL of: 21-char nanoid name, an ssr/ subdir, older than
# AGE_MIN, and referenced by no live process.
set -euo pipefail

[ "$(uname)" = "Linux" ] || exit 0   # /proc scanning is Linux-only

TMP="${TMPDIR:-/tmp}"
TMP="${TMP%/}"
AGE_MIN="${AGE_MIN:-720}"   # 12h; well beyond any active run's idle window
DRY_RUN="${DRY_RUN:-0}"     # DRY_RUN=1 lists what would go, deletes nothing

# Paths currently referenced by a live process (cwd or open fd) -- never remove.
mapfile -t LIVE < <(
  { ls -l /proc/[0-9]*/cwd /proc/[0-9]*/fd/* 2>/dev/null || true; } \
    | grep -oE "${TMP}/[A-Za-z0-9_-]{21}" | sort -u
)

reclaimed=0
while IFS= read -r dir; do
  [ -d "$dir/ssr" ] || continue                        # only Vitest SSR caches
  for l in ${LIVE+"${LIVE[@]}"}; do [ "$dir" = "$l" ] && continue 2; done
  sz=$(du -sm "$dir" 2>/dev/null | cut -f1) || continue
  if [ "$DRY_RUN" = "1" ]; then
    echo "  would remove ${dir} (${sz}MB, $(date -r "$dir" '+%Y-%m-%d %H:%M'))"
    reclaimed=$(( reclaimed + sz ))
  else
    rm -rf -- "$dir" && reclaimed=$(( reclaimed + sz ))
  fi
done < <(find "$TMP" -maxdepth 1 -type d -user "$(id -u)" -mmin "+${AGE_MIN}" \
           -regextype posix-extended -regex "${TMP}/[A-Za-z0-9_-]{21}" 2>/dev/null)

if [ "$DRY_RUN" = "1" ]; then
  echo "purge-vitest-tmp: would reclaim ${reclaimed}MB from ${TMP} (dry run)"
else
  echo "purge-vitest-tmp: reclaimed ${reclaimed}MB from ${TMP}"
fi
