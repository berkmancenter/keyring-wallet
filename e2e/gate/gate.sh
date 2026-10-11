#!/bin/bash
# The release gate runner. See README.md beside it.
#
#   gate.sh run --pin <wallet-sha> [--legs a,b] [--serial]   every leg (or some), on that commit's CI builds
#   gate.sh rerun <run-id> --only-failed                      the rows that failed or never ran, same builds
#   gate.sh dry --golden [--legs a,b]                         the drivers on the shipped build ($GATE_HOME/golden)
#   gate.sh watch --pr <n>                                    run when that pin PR merges and its builds are green
#   gate.sh watch --main                                      a gate for every new green push build of main, for ever
#   gate.sh report <run-id>                                   rows per leg, with wall-clock
# Lead our own process group, so a stop passed to "the group" (stop_forward's kill -TERM 0) reaches the gate and
# nothing else: a gate started from a shell without job control (an agent's command, a script) would otherwise share
# that shell's group with whatever else it started. A terminal already makes each job a group leader, so ctrl-C still
# works there. setpgrp, not setsid: the terminal session is kept.
if [ -z "${GATE_PGRP:-}" ] && [ "$(ps -o pgid= -p $$ | tr -d ' ')" != "$$" ]; then
  GATE_PGRP=1 exec perl -e 'setpgrp(0, 0); exec @ARGV' /bin/bash "$0" "$@"
fi
. "$(dirname "$0")/lib.sh"

# Legs in the order they run on one platform, and which device each needs.
LEGS_IOS="kk smoke-ios update-ios"
LEGS_ANDROID="p1 testreq agents waiting lostreq linkresume smoke-android devices update-android relaunch-android linkwait"
# push2 (push off, then on, with two agents) is out of the default legs until push is fully integrated (Alberto, 10-07); run it with --legs push2.
# Legs that change a shared runner for every phone (a swap-key rule or policy): run alone, after both platforms.
LEGS_SOLO="linkfail"
# iOS legs that link under load: their links failed only while the Android legs ran beside them (237 gate, 10-07),
# so they run first, with nothing beside them; the rest of iOS then runs beside Android.
LEGS_IOS_ALONE="kk smoke-ios"
# Mostly waiting (IN-135's slow cases, about 35 min) on the emulator, so it runs beside the iOS-alone legs, where the
# emulator is otherwise idle; both sides then defer their key cleanup to the end of that phase.
LEGS_BESIDE_IOS_ALONE="linkwait"

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

# ---- one leg ----

# run_leg <run-dir> <leg> [only-rows]: the leg's own folder holds its log and every screenshot and page dump.
run_leg() {
  local rd=$1 leg=$2 only=${3:-} dir=$1/$2 s e rc
  mkdir -p "$dir"
  mem_ok || { say "$leg: not started (memory)"; printf '%s\t%s\t%s\t%s\n' "$leg" 1 "$(date +%s)" "$(date +%s)" >> "$rd/legs.tsv"; return; }
  say "$leg: start${only:+ (only: $only)}"
  s=$(date +%s)
  # In the background with wait (not a foreground child), so a stop reaches this shell at once: stop_forward then
  # passes it on and waits for the leg's cleanup.
  E2E_RUN_DIR=$dir E2E_ONLY_ROWS=$only LEG_DIR=$dir RUN_DIR=$rd bash "$GATE_SRC/legs/$leg.sh" > "$dir/leg.log" 2>&1 &
  wait $!; rc=$?; e=$(date +%s)
  printf '%s\t%s\t%s\t%s\n' "$leg" "$rc" "$s" "$e" >> "$rd/legs.tsv"
  # A sleep inside the leg (pmset's log) makes its rows no verdict on the app (1009-1608: a 682 s clamshell sleep
  # ended both kk iOS sessions by Appium's newCommandTimeout). Marked, not hidden: the rows stay as they ran.
  local slept; slept=$(node "$GATE_SRC/sleeps.mjs" --from "$s" --to "$e" 2>/dev/null)
  if [ -n "$slept" ]; then echo "$slept" | sed 's/^/ENV /' >> "$dir/leg.log"; say "$leg: ENV — $(echo "$slept" | paste -sd';' -)"; fi
  say "$leg: exit $rc in $(( (e - s) / 60 )) min · $(leg_rows "$dir/leg.log" | cut -f1 | sort | uniq -c | tr -s ' ' | tr '\n' ' ')"
}

# run_group <run-dir> <legs...> one after another (one platform's devices).
run_group() { local rd=$1 leg; shift; for leg in "$@"; do run_leg "$rd" "$leg"; done; }

# Split the wanted legs by platform, and run the two platforms side by side when the disk allows.
run_legs() {
  local rd=$1 want=$2 serial=$3 ios=() android=() solo=() l return_solo=0
  for l in $LEGS_SOLO; do [[ ",$want," == *",$l,"* || $want == all ]] && solo+=("$l"); done
  for l in $LEGS_IOS; do [[ ",$want," == *",$l,"* || $want == all ]] && ios+=("$l"); done
  for l in $LEGS_ANDROID; do [[ ",$want," == *",$l,"* || $want == all ]] && android+=("$l"); done
  local free; free=$(disk_free_gb)
  if [ "$serial" = 0 ] && [ ${#ios[@]} -gt 0 ] && [ ${#android[@]} -gt 0 ] && [ "$free" -ge "$GATE_PARALLEL_MIN_GB" ]; then
    local alone=() rest=() l2
    for l2 in "${ios[@]}"; do [[ " $LEGS_IOS_ALONE " == *" $l2 "* ]] && alone+=("$l2") || rest+=("$l2"); done
    local beside=() arest=()
    for l2 in "${android[@]}"; do [[ " $LEGS_BESIDE_IOS_ALONE " == *" $l2 "* ]] && beside+=("$l2") || arest+=("$l2"); done
    if [ ${#alone[@]} -gt 0 ] && [ ${#beside[@]} -gt 0 ]; then
      say "first: ${alone[*]} (iOS), beside them ${beside[*]} (Android, mostly waiting)"
      local tb; tb=$(stamp)
      ( export GATE_DEFER_KEYS=1; run_group "$rd" "${alone[@]}" ) & local pa=$!
      ( export GATE_DEFER_KEYS=1; run_group "$rd" "${beside[@]}" ) & local pb=$!
      wait $pa $pb
      local sl; for sl in $(sort -u "$rd/defer-keys" 2>/dev/null); do say "cleanup $sl (phone grants since $tb)"; keys_since "$sl" "$tb"; done
      : > "$rd/defer-keys" 2>/dev/null
      android=(${arest[@]+"${arest[@]}"})
    else
      [ ${#alone[@]} -eq 0 ] || { say "first, alone: ${alone[*]}"; run_group "$rd" "${alone[@]}"; }
    fi
    ios=(${rest[@]+"${rest[@]}"})
    if [ ${#ios[@]} -eq 0 ]; then run_group "$rd" "${android[@]}"; return_solo=1; fi
  fi
  if [ "$return_solo" = 1 ]; then :
  elif [ "$serial" = 0 ] && [ ${#ios[@]} -gt 0 ] && [ ${#android[@]} -gt 0 ] && [ "$free" -ge "$GATE_PARALLEL_MIN_GB" ]; then
    say "iOS (${ios[*]}) and Android (${android[*]}) side by side: ${free} GB free"
    local t0; t0=$(stamp)
    ( export GATE_DEFER_KEYS=1; run_group "$rd" "${ios[@]}" ) & local p1=$!
    ( export GATE_DEFER_KEYS=1; run_group "$rd" "${android[@]}" ) & local p2=$!
    wait $p1 $p2
    local slug; for slug in $(sort -u "$rd/defer-keys" 2>/dev/null); do say "cleanup $slug (phone grants since $t0)"; keys_since "$slug" "$t0"; done
  else
    [ "$serial" = 1 ] || [ "$free" -ge "$GATE_PARALLEL_MIN_GB" ] || say "one platform at a time: ${free} GB free, under GATE_PARALLEL_MIN_GB=$GATE_PARALLEL_MIN_GB"
    run_group "$rd" ${ios[@]+"${ios[@]}"} ${android[@]+"${android[@]}"}
  fi
  [ ${#solo[@]} -eq 0 ] || { say "alone, after the others: ${solo[*]}"; run_group "$rd" "${solo[@]}"; }
}

new_run() {
  local pin=$1 kind=$2 rd
  rd=$GATE_HOME/runs/$(date -u +%m%d-%H%M)-${pin:0:8}-$kind
  mkdir -p "$rd"
  { echo "pin=$pin"; echo "kind=$kind"; echo "harness=$(git -C "$REPO" rev-parse --short HEAD)"; echo "started=$(stamp)Z"; } > "$rd/meta"
  echo "$rd"
}

cmd_run() {
  local pin="" legs=all serial=0 kind=gate
  while [ $# -gt 0 ]; do case $1 in
    --pin) pin=$2; shift 2 ;; --legs) legs=$2; shift 2 ;; --serial) serial=1; shift ;; --kind) kind=$2; shift 2 ;; *) usage ;;
  esac; done
  [ -n "$pin" ] || usage
  gate_env
  mac_stable || die "not started (GATE_ALLOW_UNSTABLE=1 to start anyway)"
  use_build "$pin"
  run_lock
  gate_sweep
  # Another lane's heavy job (a device build) asks the gate to wait by creating $GATE_HOME/hold-start.
  local held=0; while [ -f "$GATE_HOME/hold-start" ]; do [ $held = 0 ] && say "held: $GATE_HOME/hold-start exists ($(head -c 120 "$GATE_HOME/hold-start"))"; held=1; sleep 30; done
  [ $held = 1 ] && say "hold released"
  local rd; rd=$(new_run "$pin" "$kind")
  { echo "wallet=$CAND_WALLET"; echo "bifold=$CAND_BIFOLD"; echo "farm=${FARM_VERSIONS:-unrecorded}"; echo "openvtc=${OPENVTC_VERSION:-?}"; } >> "$rd/meta"
  [ -z "${PUSH_ON_NOTE:-}" ] || echo "push-on=$PUSH_ON_NOTE" >> "$rd/meta"
  say "run $(basename "$rd"): wallet ${CAND_WALLET:0:8} bifold ${CAND_BIFOLD:0:8} harness $(git -C "$REPO" rev-parse --short HEAD) · legs $legs"
  run_legs "$rd" "$legs" "$serial"
  echo "ended=$(stamp)Z" >> "$rd/meta"
  cmd_report "$(basename "$rd")"
}

# The rows of a run that failed, or never ran because something they needed failed; and the legs that broke.
cmd_rerun() {
  local id=$1 only=${2:-}
  [ "$only" = --only-failed ] || usage
  local old=$GATE_HOME/runs/$id; [ -d "$old" ] || die "no run $id"
  local pin; pin=$(grep '^pin=' "$old/meta" | cut -d= -f2)
  gate_env
  mac_stable || die "not started (GATE_ALLOW_UNSTABLE=1 to start anyway)"
  use_build "$pin"
  run_lock
  gate_sweep
  local rd; rd=$(new_run "$pin" "rerun")
  echo "rerun-of=$id" >> "$rd/meta"
  local leg rc s e names
  while IFS=$'\t' read -r leg rc s e; do
    case $rc in
      0) ;;
      1) run_leg "$rd" "$leg" ;;
      *) names=$(leg_rows "$old/$leg/leg.log" | awk -F'\t' '$1=="FAIL" || ($1=="SKIP" && $3 ~ /which was FAIL|did not run/) {print $2}' | paste -sd, -)
         run_leg "$rd" "$leg" "$names" ;;
    esac
  done < "$old/legs.tsv"
  echo "ended=$(stamp)Z" >> "$rd/meta"
  cmd_report "$(basename "$rd")"
}

# The drivers against the build testers already have: a FAIL here is the driver's, found before a candidate.
cmd_dry() {
  [ "${1:-}" = --golden ] || usage; shift
  local golden; golden=$(cat "$GATE_HOME/golden" 2>/dev/null) || die "no $GATE_HOME/golden (the shipped release's wallet commit)"
  cmd_run --pin "$golden" --kind dry "$@"
}

# One gate at a time on this Mac, whoever started it. The lock is a directory holding the owner's pid. The pid is
# the shell that runs the gate (sh -c 'echo $PPID': in a subshell, $$ is still the parent's, and bash 3.2 has no
# BASHPID), so a run killed hard leaves a dead owner, and a lock with a dead owner is taken over. The takeover is
# an atomic rename, so two waiters cannot both remove it; a lock with no pid yet is live for its first minute.
lock_live() {
  local d=$1 p now m; p=$(cat "$d/pid" 2>/dev/null)
  if [ -n "$p" ]; then kill -0 "$p" 2>/dev/null; return; fi
  now=$(date +%s); m=$(stat -f %m "$d" 2>/dev/null || echo "$now"); [ $((now - m)) -lt 60 ]
}
run_lock() {
  local d=$GATE_HOME/run.lock.d tag=$$.$RANDOM
  while ! mkdir "$d" 2>/dev/null; do
    if lock_live "$d"; then say "another gate is running (pid $(cat "$d/pid" 2>/dev/null || echo ?)); waiting"; sleep 60
    elif mv "$d" "$d.stale.$tag" 2>/dev/null; then say "stale run lock (pid $(cat "$d.stale.$tag/pid" 2>/dev/null || echo ?)) taken over"; rm -rf "$d.stale.$tag"
    else sleep 5; fi
  done
  # The running shell's pid, written by a child through a plain redirection. Not $(sh -c 'echo $PPID'): a command
  # substitution forks first, so that pid is a shell that is already gone, and the lock would read as stale at once.
  sh -c 'echo $PPID' > "$d/pid"
  trap 'rm -rf "$GATE_HOME/run.lock.d"' EXIT
  trap stop_forward TERM INT HUP
}

# A stop (launchctl bootout, a ctrl-C, a kill) reaches this shell: pass it to the whole process group (the legs, their
# drivers, Appium), so each leg's trap runs its cleanup, then wait up to GATE_STOP_WAIT seconds (default 150) for the
# group to empty before exiting. The run lock goes with the EXIT trap. The watcher's plist gives it ExitTimeOut 180.
stop_forward() {
  trap '' TERM INT HUP
  say "stopping: passing the stop to the legs and waiting for their cleanup"
  kill -TERM 0 2>/dev/null
  local pg i left f="${TMPDIR:-/tmp}/gate-stop.$$"; pg=$(ps -o pgid= -p $$ | tr -d ' ')
  for i in $(seq 1 "${GATE_STOP_WAIT:-150}"); do
    # pgrep straight into a file, not inside $( ): a command substitution is itself a process in this group, and
    # would keep the group looking busy for the whole wait.
    pgrep -g "$pg" > "$f" 2>/dev/null; left=$(grep -cvx "$$" "$f")
    [ "$left" = 0 ] && break
    sleep 1
  done
  rm -f "$f"
  say "stopped"
  exit 143
}

# The Mac is shared: a build, a test run, an emulator or a booted simulator that belongs to someone else means
# "not now". Executable names, plus one fixed token for the Gradle wrapper client (never a pattern that could match a
# waiter's own command line: concurrent waiters deadlocked that way on 10-08). Simulator.app being open is not a
# signal; a booted simulator is.
mac_busy() {
  ps -axo comm= | awk '$0 ~ /(xcodebuild|cargo|rustc|docker-buildx|qemu-system|emulator)$/ {n++} END {exit !n}' && return 0
  # A Gradle build: the wrapper client lives only while a build runs; idle daemons stay up for hours and do not count.
  ps -axo args= | grep -q '[G]radleWrapperMain' && return 0
  xcrun simctl list devices booted 2>/dev/null | grep -q '(Booted)'
}

# A laptop in a bag is not a gate machine: a closed lid with no display behind it sleeps the Mac, and every leg
# stalls with it (239 gate, 10-09: three hours). stable.mjs holds the rule and its two detectors, tested on captured
# outputs: stable when the lid is open or an external display is online; a Mac with no lid and no battery is a
# desktop and is stable (said once, so the log shows it); no lid key but a battery is unknown, and unknown does not
# start a gate. There is no power-adapter condition: dropped, 10-10. GATE_ALLOW_UNSTABLE=1 starts anyway, with a
# warning. A sleep inside a leg is a separate matter: sleeps.mjs marks that leg ENV (wallet #361).
mac_stable() {
  local out; out=$(node "$GATE_SRC/stable.mjs" --stable 2>&1)
  case ${out%%:*} in
    stable) case $out in *'desktop:'*) say "${out#*: }" ;; esac; return 0 ;;
  esac
  if [ "${GATE_ALLOW_UNSTABLE:-0}" = 1 ]; then say "WARNING: the Mac is not stable ($out), but GATE_ALLOW_UNSTABLE=1: running anyway"; return 0; fi
  say "the Mac is not stable ($out): not running"; return 1
}

# The watcher's checkout is its own (never a lane's working checkout): on main, clean, fast-forwarded before a
# run. Anything else and the cycle is skipped, so a report never reads as a main gate when the harness was not main's.
watch_checkout_ready() {
  local b; b=$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null)
  [ "$b" = main ] || { say "checkout $REPO is on $b, not main: not running"; return 1; }
  [ -z "$(git -C "$REPO" status --porcelain --untracked-files=no)" ] || { say "checkout $REPO has local changes: not running"; return 1; }
  git -C "$REPO" fetch -q origin main && git -C "$REPO" merge -q --ff-only origin/main || { say "fast-forward of $REPO failed: not running"; return 1; }
}

cmd_watch_main() {
  gate_env
  # A bootout reaches this loop first: stop_forward passes it to the run in progress (its legs clean up) and waits.
  trap stop_forward TERM INT HUP
  local interval=${GATE_WATCH_INTERVAL:-300} pair sha run req i head on_sha same
  say "watching main: a gate for every new green push build, every $((interval / 60)) min, from $REPO"
  while :; do
    pair=$(node "$GATE_SRC/green.mjs" --newest-main 2>/dev/null) || pair=
    if [ -n "$pair" ] && [ "$pair" != none ]; then
      sha=${pair%% *}; run=${pair##* }
      if ls "$GATE_HOME"/runs/*-"${sha:0:8}"-gate >/dev/null 2>&1; then :
      elif { [ -d "$GATE_HOME/run.lock.d" ] && lock_live "$GATE_HOME/run.lock.d"; } || mac_busy; then say "main build ${sha:0:8} is new, but the Mac is busy: next cycle"
      elif ! mac_stable; then :
      elif ! watch_checkout_ready; then :
      else
        say "new green main build ${sha:0:8} (run $run)"
        # The push-on build is dispatched on main, so it is of main's HEAD. When main has moved past this commit with
        # changes the CI build ignores (e2e, docs: test-builds.yml's paths-ignore, read by samebuild.mjs), HEAD's
        # push-on build is the same app and stands for this one. When the app changed, no push-on build of this
        # commit can be made: say so and go on without waiting (1011's first auto-run waited 60 min for one).
        head=$(git -C "$REPO" rev-parse origin/main); on_sha=$sha
        if [ "$head" != "$sha" ]; then
          same=$(node "$GATE_SRC/samebuild.mjs" "$REPO" "$sha" "$head" 2>&1)
          case $same in
            same) on_sha=$head; say "main is at ${head:0:8}, past ${sha:0:8} with no app change: its push-on build stands for this one" ;;
            *) on_sha=; say "main is at ${head:0:8}, past ${sha:0:8} ($same): no push-on build of this commit can be made; push legs will be skipped" ;;
          esac
        fi
        if [ -n "$on_sha" ]; then
          req=$GATE_HOME/watch-requested-${on_sha:0:8}
          if [ ! -f "$req" ]; then
            if gh workflow run test-builds.yml -R $GH_REPO --ref main -f platform=android -f push=on >/dev/null 2>&1; then touch "$req"
            else say "push-on build not requested: push legs will be skipped"; fi
          fi
          for i in $(seq 1 60); do [ "$(GATE_PUSH_ON_SHA=$on_sha build_runs "$sha" | cut -d' ' -f2)" != - ] && break; sleep 60 & wait $!; done
        fi
        ( GATE_PUSH_ON_SHA=$on_sha cmd_run --pin "$sha" ) & wait $! || say "gate for ${sha:0:8} ended with status $?"
      fi
    fi
    sleep "$interval" & wait $!
  done
}

# Wait for the pin PR to merge, ask for a push-on Android build of the merge commit, wait for both builds, then run.
# Runs in the foreground: start it with nohup (or the launchd plist), never as an agent tool's background job.
cmd_watch() {
  [ "${1:-}" = --main ] && { cmd_watch_main; return; }
  [ "${1:-}" = --pr ] && [ -n "${2:-}" ] || usage
  local pr=$2 st m i runs
  gate_env
  for i in $(seq 1 720); do
    st=$(gh pr view "$pr" -R $GH_REPO --json state,mergeCommit --jq '.state+" "+(.mergeCommit.oid//"")' 2>/dev/null)
    case $st in MERGED*) break ;; CLOSED*) die "#$pr closed without merging" ;; esac
    sleep 60
  done
  m=${st#MERGED }; [ -n "$m" ] || die "#$pr did not merge in 12 h"
  say "#$pr merged as ${m:0:8}; asking for a push-on Android build"
  gh workflow run test-builds.yml -R $GH_REPO --ref main -f platform=android -f push=on || say "push-on build not requested: push legs will be skipped"
  for i in $(seq 1 180); do
    runs=$(build_runs "$m"); [ "${runs%% *}" != - ] && [ "${runs##* }" != - ] && break
    sleep 60
  done
  say "builds ready: $runs"
  cmd_run --pin "$m"
}

# Rows per leg, and the wall-clock from the first leg's start to the last leg's end.
cmd_report() {
  local rd=$GATE_HOME/runs/$1; [ -f "$rd/legs.tsv" ] || die "no legs in $1"
  echo "== $1 · $(grep -E '^(wallet|bifold|harness)=' "$rd/meta" | tr '\n' ' ')"
  local leg rc s e first= last=0
  while IFS=$'\t' read -r leg rc s e; do
    [ -z "$first" ] || [ "$s" -lt "$first" ] && first=$s
    [ "$e" -gt "$last" ] && last=$e
    printf '%-14s exit %s  %4s min  %s\n' "$leg" "$rc" "$(( (e - s) / 60 ))" "$(leg_rows "$rd/$leg/leg.log" | cut -f1 | sort | uniq -c | awk '{printf "%s %s  ", $2, $1}')"
    grep -E '^ENV ' "$rd/$leg/leg.log" 2>/dev/null | sed 's/^ENV /    ENV /; s/$/: a sleep inside the leg, its rows are no verdict on the app/'
    leg_rows "$rd/$leg/leg.log" | awk -F'\t' '$1!="PASS" {printf "    %s %s — %s\n", $1, $2, substr($3,1,140)}'
  done < "$rd/legs.tsv"
  echo "wall-clock: $(( (last - first) / 60 )) min (first leg start to last leg end)"
}

case ${1:-} in
  run) shift; cmd_run "$@" ;;
  rerun) shift; cmd_rerun "$@" ;;
  dry) shift; cmd_dry "$@" ;;
  watch) shift; cmd_watch "$@" ;;
  report) shift; cmd_report "$@" ;;
  *) usage ;;
esac
