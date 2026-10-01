#!/usr/bin/env bash
# QA lanes: a private loopback network per agent, so several agents can run the
# Firebase emulators, Vite and browsers on this repo's fixed ports (9099, 8080,
# 5001, 5193, ...) at the same time, with no port or config changes. Linux only;
# needs unprivileged user namespaces, not root. See AGENTS.md "Running locally".
#
#   scripts/qa-lane.sh up <lane>              create the lane (idempotent)
#   scripts/qa-lane.sh exec <lane> -- <cmd>   run <cmd> inside it, from any shell
#   scripts/qa-lane.sh down <lane>            stop everything in it, then remove it
#   scripts/qa-lane.sh list                   show lanes, process counts and ports
#
# A lane is a user and network namespace kept open by a `sleep` process. It has
# loopback only: no internet, so install and download outside it. Inside, your
# processes appear as root (files stay yours), so Chrome needs its sandbox off
# there. `down` stops only processes in the lane's namespaces. Lock and log
# files go in $NFCT_QA_LANE_STATE (default ${XDG_RUNTIME_DIR:-/tmp}/nfct-qa-lanes-<uid>).
set -Eeuo pipefail

prog=scripts/qa-lane.sh
trap 'echo "$prog: failed at line $LINENO: $BASH_COMMAND" >&2' ERR

usage() {
  cat >&2 <<EOF
usage: $prog up <lane>
       $prog exec <lane> -- <command> [args...]
       $prog down <lane>
       $prog list
EOF
  exit 2
}

die() {
  echo "$prog: $*" >&2
  exit 1
}

[ "$(uname -s)" = Linux ] ||
  die "lanes need Linux network namespaces; on $(uname -s), run emulator-backed work one at a time."
for tool in unshare nsenter setsid pgrep flock ip; do
  command -v "$tool" >/dev/null 2>&1 || die "'$tool' is missing (util-linux, procps or iproute2)."
done

uid=$(id -u)
state=${NFCT_QA_LANE_STATE:-${XDG_RUNTIME_DIR:-/tmp}/nfct-qa-lanes-$uid}

check_name() {
  [[ ${1:-} =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$ ]] ||
    die "invalid lane name '${1:-}': use up to 40 letters, digits, '-' or '_'."
}

# Prints the pid of the lane's holder process; fails when the lane is not up.
holder() {
  local pids
  pids=$(pgrep -u "$uid" -xf "nfct-qa-lane:$1 infinity") || return 1
  echo "${pids%%$'\n'*}"
}

ns_of() {
  readlink "/proc/$1/ns/$2" 2>/dev/null || true
}

# Prints our processes in the lane's network or user namespace, except the holder.
lane_pids() {
  {
    pgrep -u "$uid" --ns "$1" --nslist net || true
    pgrep -u "$uid" --ns "$1" --nslist user || true
  } | awk -v holder="$1" '$0 != holder' | sort -un
}

# Serializes up and down; the lock is released when the script exits.
lock() {
  mkdir -p "$state"
  chmod 700 "$state"
  exec 9>"$state/.lock"
  flock -w 60 9 || die "timed out waiting for another $prog up/down."
}

cmd_up() {
  local name=$1 hpid="" err
  lock
  if hpid=$(holder "$name"); then
    echo "lane $name is up (holder pid $hpid)"
    return
  fi
  if ! err=$(unshare --user --map-root-user --net -- ip link set lo up 2>&1); then
    die "unprivileged user and network namespaces are unavailable: ${err:-unknown error}
  An admin can enable them: sysctl user.max_user_namespaces must be > 0,
  kernel.unprivileged_userns_clone = 1 where it exists, and on Ubuntu 23.10+
  kernel.apparmor_restrict_unprivileged_userns = 0 (or an AppArmor profile
  allowing unshare). Without lanes, run emulator-backed work one at a time."
  fi
  # 9>&- keeps the lock fd out of the long-lived holder.
  setsid unshare --user --map-root-user --net -- \
    bash -c 'ip link set lo up && exec -a "$0" sleep infinity' "nfct-qa-lane:$name" \
    </dev/null >"$state/$name.log" 2>&1 9>&- &
  for _ in $(seq 1 50); do
    hpid=$(holder "$name") && break
    sleep 0.1
  done
  [ -n "$hpid" ] || die "lane $name did not start: $(cat "$state/$name.log")"
  [ "$(ns_of "$hpid" net)" != "$(ns_of $$ net)" ] || die "lane $name has no private network."
  rm -f "$state/$name.log"
  echo "lane $name is up (holder pid $hpid)"
}

cmd_exec() {
  local name=$1 hpid
  shift
  [ "${1:-}" = "--" ] && shift
  [ $# -gt 0 ] || usage
  hpid=$(holder "$name") || die "lane $name is not up; run: $prog up $name"
  if [ "$(ns_of "$hpid" net)" = "$(ns_of $$ net)" ]; then
    exec env NFCT_QA_LANE="$name" "$@" # already inside this lane
  fi
  exec nsenter --target "$hpid" --user --net --preserve-credentials -- \
    env NFCT_QA_LANE="$name" "$@"
}

cmd_down() {
  local name=$1 hpid pids count=0
  lock
  if ! hpid=$(holder "$name"); then
    echo "lane $name is not up"
    return
  fi
  [ "$(ns_of "$hpid" net)" != "$(ns_of $$ net)" ] ||
    die "run '$prog down $name' from outside the lane."
  pids=$(lane_pids "$hpid")
  if [ -n "$pids" ]; then
    count=$(wc -l <<<"$pids")
    # shellcheck disable=SC2086 # one pid per word
    kill -TERM $pids 2>/dev/null || true
    for _ in $(seq 1 20); do
      pids=$(lane_pids "$hpid")
      [ -z "$pids" ] && break
      sleep 0.5
    done
    # shellcheck disable=SC2086
    [ -z "$pids" ] || kill -KILL $pids 2>/dev/null || true
  fi
  kill -TERM "$hpid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    holder "$name" >/dev/null || break
    sleep 0.1
  done
  ! holder "$name" >/dev/null || die "lane $name holder $hpid did not stop."
  rm -f "$state/$name.log"
  echo "lane $name is down (stopped $count process(es))"
}

cmd_list() {
  local hpid title name count ports any=""
  while read -r hpid title _; do
    [ -n "$hpid" ] || continue
    any=1
    name=${title#nfct-qa-lane:}
    count=$(lane_pids "$hpid" | wc -l)
    ports=$(nsenter --target "$hpid" --user --net --preserve-credentials -- ss -Hltn 2>/dev/null |
      awk '{ n = split($4, a, ":"); print a[n] }' | sort -un | paste -sd, - || true)
    echo "$name  holder=$hpid  processes=$count  listening=${ports:-none}"
  done < <(pgrep -u "$uid" -af '^nfct-qa-lane:[A-Za-z0-9_-]+ infinity$' || true)
  [ -n "$any" ] || echo "no lanes"
}

case "${1:-}" in
up | exec | down)
  [ $# -ge 2 ] || usage
  check_name "$2"
  cmd="cmd_$1"
  name=$2
  shift 2
  "$cmd" "$name" "$@"
  ;;
list) cmd_list ;;
*) usage ;;
esac
