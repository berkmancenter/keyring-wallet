#!/bin/bash
# bash e2e/gate/ci/turns.test.sh: two gate machines on the same runners never gate at once (lib.sh turn_lock). The
# turn is taken and released on the turn host; a live owner on this machine, or one on a machine this one cannot see,
# is a refusal; a gone owner is taken over; an unreachable turn host is a refusal; no GATE_TURN_HOST, no turn. The
# "remote" turn host is a fake ssh that runs the command here. No network.
set -u
here=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); fails=0
sleeper=""; trap '[ -n "$sleeper" ] && kill "$sleeper" 2>/dev/null; rm -rf "$T"' EXIT
ok() { echo "ok   $*"; }; bad() { echo "FAIL $*"; fails=$((fails + 1)); }
printf '#!/bin/bash\nshift; bash -c "$1"\n' > "$T/fakessh"; chmod +x "$T/fakessh"
D=$T/turn.lock.d; me=$(hostname -s)
# Runs a snippet with lib.sh loaded and the turn settings given; prints its output, then "rc=<exit>".
with_turn() {
  local host=$1 snippet=$2
  ( export GATE_HOME=$T/home GATE_TURN_DIR=$D GATE_TURN_SSH="$T/fakessh"; [ -z "$host" ] || export GATE_TURN_HOST=$host
    . "$here/../lib.sh" >/dev/null 2>&1; eval "$snippet" ) 2>&1; echo "rc=$?"
}
out=$(with_turn "" 'turn_lock; turn_release')
case $out in *rc=0) [ ! -e "$D" ] && ok "no GATE_TURN_HOST: no turn is taken" || bad "a turn appeared without GATE_TURN_HOST";; *) bad "no GATE_TURN_HOST failed: $out";; esac
out=$(with_turn local 'turn_lock; cut -d" " -f1 "$GATE_TURN_DIR/owner"; turn_release; if [ -e "$GATE_TURN_DIR" ]; then echo STILL-THERE; fi')
case $out in *"$me"*rc=0) case $out in *STILL-THERE*) bad "the turn was not released";; *) ok "local turn host: taken with this machine as owner, then released";; esac;; *) bad "local turn: $out";; esac
out=$(with_turn mini 'turn_lock; turn_release; if [ -e "$GATE_TURN_DIR" ]; then echo STILL-THERE; fi')
case $out in *"gate turn taken on mini"*rc=0) case $out in *STILL-THERE*) bad "the remote turn was not released";; *) ok "remote turn host (over ssh): taken and released";; esac;; *) bad "remote turn: $out";; esac
sleep 300 & sleeper=$!
mkdir -p "$D"; echo "$me $sleeper 2026-10-21T00:00:00Z" > "$D/owner"
out=$(with_turn local 'turn_lock')
case $out in *"holds the gate turn"*rc=1) ok "a live owner on this machine: refused";; *) bad "live local owner not refused: $out";; esac
[ "$(cut -d' ' -f2 "$D/owner")" = "$sleeper" ] && ok "the live owner's turn is left alone" || bad "the live owner's turn was changed"
echo "other-mac 4242 2026-10-21T00:00:00Z" > "$D/owner"
out=$(with_turn mini 'turn_lock')
case $out in *"holds the gate turn (other-mac"*rc=1) ok "an owner on a machine this one cannot see: refused, and named";; *) bad "unseen owner not refused: $out";; esac
kill "$sleeper" 2>/dev/null; wait "$sleeper" 2>/dev/null; dead=$sleeper; sleeper=""
echo "$me $dead 2026-10-21T00:00:00Z" > "$D/owner"
out=$(with_turn local 'turn_lock; cut -d" " -f2 "$GATE_TURN_DIR/owner"; turn_release')
case $out in *"stale gate turn"*"gate turn taken"*rc=0) ok "a gone owner's turn is taken over";; *) bad "stale turn not taken over: $out";; esac
rm -rf "$D"
out=$( ( export GATE_HOME=$T/home GATE_TURN_DIR=$D GATE_TURN_HOST=mini GATE_TURN_SSH=false; . "$here/../lib.sh" >/dev/null 2>&1; turn_lock ) 2>&1; echo "rc=$?")
case $out in *"did not answer"*rc=1) ok "an unreachable turn host: refused, not passed";; *) bad "unreachable turn host: $out";; esac
[ ! -e "$D" ] && ok "a refusal leaves no turn behind" || bad "a refusal left $D"
[ $fails = 0 ] && echo "turns: all passed" || { echo "turns: $fails failed"; exit 1; }
