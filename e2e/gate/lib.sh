# Shared by gate.sh and every leg. Source it; never run it.
# Everything private (runner slugs and DIDs, the community admin credential) comes from $GATE_ENV, never from here.
set -u
unset PNM_HOME

GATE_SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$GATE_SRC/../.." && pwd)
E2E=$REPO/e2e
GATE_HOME=${GATE_HOME:-$HOME/.keyring-fleet/gate}
GATE_ENV=${GATE_ENV:-$GATE_HOME/env/farm.env}
EMU_SH=$REPO/scripts/emu.sh
VTC_ADMIN=$REPO/tsp-reference/ref-20-local-vetting/vtc-admin.mjs
BID=asml.bkc.harvard.wallet
GH_REPO=berkmancenter/keyring-wallet

# GATE_TARGET=ci: a leg run by .github/workflows/gate-ci.yml on a GitHub-hosted runner, one leg per job. The runner
# brings its own Android SDK and the emulator (the workflow's emulator step), pnm is the CI build (pnm-linux.yml) with
# a CI-only identity, and the private configuration is a file the workflow writes from its protected environment.
is_ci() { [ "${GATE_TARGET:-}" = ci ]; }
# ios_log_save <sim udid> <file> <since>: the app's own log from a booted simulator, read back with `log show`
# (smoke-ios's way, which finds the app's lines). <since> is an epoch second (the log from then on: a window that
# starts at the step it checks, however long the leg took) or a span such as 30m. A `log stream` attached through
# simctl spawn caught nothing but its header on every run checked (update-ios 1012-2223: 3 lines), so rows that
# grepped it passed without looking.
ios_log_save() {
  local when=(--last "$3")
  [[ $3 =~ ^[0-9]{9,}$ ]] && when=(--start "$(date -r "$3" '+%Y-%m-%d %H:%M:%S')")
  xcrun simctl spawn "$1" log show "${when[@]}" --style compact --info --debug \
    --predicate 'process == "KeyRing" OR subsystem == "com.facebook.react.log"' > "$2" 2>&1
}
# The app's lines in a saved log: not the header `log show` prints, nor its own complaints.
ios_log_app_lines() { local n; n=$(grep -cE ' KeyRing\[|com\.facebook\.react\.log' "$1" 2>/dev/null); echo "${n:-0}"; }
# galarm <seconds> <command…>: the command in its own process group, the whole group killed past <seconds>. A plain
# `perl -e 'alarm N; exec @ARGV'` killed only the driver: its Appium (and anything else it started) lived on, and on
# 1013-1753 an orphaned Appium on :4762 broke the next leg.
# Exits: 142 = the alarm fired (128 + SIGALRM 14), the group killed; 143/130/129 = a stop (TERM/INT/HUP) reached the
# wrapper, which passes it to the group, waits up to 10 s for it to end, then kills what is left; otherwise the
# command's own status. Each group is listed in $GATE_HOME/galarm-groups ("<pgid> <leg> <epoch> <leader start> <command>", tab-separated), so a group
# whose wrapper was killed with the leg (a SIGKILL of the leg's whole group) is still found: leg_end reaps its own
# leg's, and gate_sweep, at the start of every run, all of them (galarm_reap).
GALARM_GROUPS=$GATE_HOME/galarm-groups
galarm() {
  local t=$1; shift
  GALARM_LEG=${LEG_NAME:-gate} GALARM_GROUPS=$GALARM_GROUPS perl -e '
    use POSIX ":sys_wait_h";
    my $t = shift; my $p = fork; die "galarm: fork: $!" unless defined $p;
    if (!$p) { setpgrp(0, 0); exec @ARGV; exit 127 }
    setpgrp($p, $p);
    # The start time of the leader (ps lstart, fixed at fork, kept across exec) names this group beyond its number:
    # numbers are reused, and a reap must never kill a stranger that got the same one.
    my $ls = `ps -o lstart= -p $p`; $ls =~ s/^\s+|\s+$//g;
    if (open(my $g, ">>", $ENV{GALARM_GROUPS})) { print $g join("\t", $p, $ENV{GALARM_LEG}, time(), $ls, $ARGV[0]) . "\n"; close $g }
    sub stop { my ($sig, $code) = @_; kill $sig, -$p;
      for (1 .. 100) { last if waitpid($p, WNOHANG) > 0; select(undef, undef, undef, 0.1) }
      kill "KILL", -$p; waitpid($p, WNOHANG); exit $code }
    $SIG{TERM} = sub { stop("TERM", 143) }; $SIG{INT} = sub { stop("INT", 130) }; $SIG{HUP} = sub { stop("HUP", 129) };
    $SIG{ALRM} = sub { kill "KILL", -$p; waitpid($p, 0); exit 142 };
    alarm $t; waitpid($p, 0);
    exit($? & 127 ? 128 + ($? & 127) : $? >> 8);
  ' "$t" "$@"
}
# galarm_reap [leg]: kill every listed group still alive (that leg's, or all) whose leader is still the very process
# galarm started (same PID and start time), and drop every other line. Says what it killed, and any orphan members
# of a group whose leader has gone (never killed by number: the number may be reused).
galarm_reap() {
  local only=${1:-} pg leg ep ls cmd now leader keep=""
  [ -f "$GALARM_GROUPS" ] || return 0
  while IFS=$'\t' read -r pg leg ep ls cmd; do
    [ -n "$pg" ] || continue
    if ! kill -0 "$pg" 2>/dev/null; then
      # The leader is gone: the number may already be someone else's group. Never kill by it; say if members live.
      kill -0 -- "-$pg" 2>/dev/null && echo "  galarm: orphan members of group $pg ($leg, $cmd), leader gone, not killed"
      continue
    fi
    now=$(ps -o lstart= -p "$pg" 2>/dev/null | sed 's/^ *//; s/ *$//')
    # Start times resolve to a second; the leader's command (the one galarm ran) must match too.
    leader=$(ps -o comm= -p "$pg" 2>/dev/null); leader=${leader##*/}
    if [ "$now" != "$ls" ] || [ "$leader" != "${cmd##*/}" ]; then continue; fi   # another process now: not ours, dropped
    if [ -n "$only" ] && [ "$leg" != "$only" ]; then keep+="$pg"$'\t'"$leg"$'\t'"$ep"$'\t'"$ls"$'\t'"$cmd"$'\n'; continue; fi
    kill -KILL -- "-$pg" 2>/dev/null && echo "  galarm: killed a leftover group $pg ($leg, $cmd, started $ls)"
  done < "$GALARM_GROUPS"
  printf '%s' "$keep" > "$GALARM_GROUPS"
}
if ! is_ci; then
  export PATH=$HOME/Library/Android/sdk/platform-tools:$HOME/Library/Android/sdk/emulator:$PATH
  export ANDROID_HOME=$HOME/Library/Android/sdk ANDROID_SDK_ROOT=$HOME/Library/Android/sdk
fi

utc() { date -u +%H:%M:%SZ; }
stamp() { date -u +%Y-%m-%dT%H:%M:%S; }
say() { echo "[gate] $(utc) $*"; }
die() { echo "[gate] $(utc) STOP: $*" >&2; exit 1; }

# The private configuration. A leg names what it needs; a missing value stops it before any device boots.
gate_env() {
  [ -f "$GATE_ENV" ] || die "no $GATE_ENV (copy e2e/gate/env.example there and fill it in)"
  set -a; . "$GATE_ENV"; set +a
  : "${GATE_PARALLEL_MIN_GB:=15}" "${GATE_MEM_MIN_GB:=3}" "${AVD:=Pixel_6_API_33}"
  # Which infrastructure the run tests against: the Farm, or the local fallback stack (decided 10-11). From the env
  # file itself, else its name (farm.env -> farm, local.env -> local). Written to meta, the report and every HEADS
  # line, so a local pass is never read as a Farm pass.
  : "${GATE_TARGET:=$(basename "$GATE_ENV" .env)}"
  export GATE_TARGET
}
need() { local v; for v in "$@"; do [ -n "${!v:-}" ] || die "$GATE_ENV: $v is empty"; done; }

# The machine-share rules: free+inactive memory and pressure, and free disk.
mem_ok() {
  local pg fi pf
  pg=$(vm_stat | awk '/page size of/ {print $8}')
  fi=$(vm_stat | awk -v p="$pg" '/Pages free|Pages inactive/ {gsub("\\.","",$NF); s+=$NF} END {printf "%d", s*p/1073741824}')
  pf=$(memory_pressure 2>/dev/null | awk -F': ' '/free percentage/ {gsub("%","",$2); print $2}')
  say "memory: free+inactive ${fi} GB, pressure-free ${pf:-?}%"
  [ "$fi" -ge "$GATE_MEM_MIN_GB" ] && [ "${pf:-0}" -ge 25 ]
}
disk_free_gb() { df -g / | awk 'NR==2 {print $4}'; }

# pnm on a runner, through the repo's per-slug lock. Prints what it said whatever its exit status.
# Never on the caller's stdin: the sweep and rules_clear call pnm inside a `| while read` loop over a list, and a pnm
# that read stdin (a prompt, a TTY check) would swallow the rest of that list, one removal per sweep. sweep.test.mjs.
# On CI the identity is a CI-only runner admin: it reaches only the configuration's own agents (CI_ALLOWED_SLUGS) and
# never a person's (the same refused slugs as e2e/lib/aclCleanup.js), and pnm never runs verbose there (derived tokens
# are not masked). e2e/gate/ci/pnm-ci.sh enforces the same for the drivers' calls.
CI_REFUSED_SLUGS="alice alberto3 alberto-push-vta-2 farm"
pnm() {
  local slug=$1; shift
  if is_ci; then
    case " $CI_REFUSED_SLUGS " in *" $slug "*) echo "pnm: refused on CI: $slug is a person's agent, never the CI identity's" >&2; return 2 ;; esac
    case " ${CI_ALLOWED_SLUGS:-} " in *" $slug "*) ;; *) echo "pnm: refused on CI: $slug is not one of the CI configuration's agents" >&2; return 2 ;; esac
  fi
  PNM_BIN=$PNM_BIN "$REPO/scripts/openvtc/pnm-locked" --vta "$slug" "$@" </dev/null 2>&1
}

# The community's admin calls (decide join requests, list and remove members).
c_admin() { galarm 90 node "$VTC_ADMIN" "$C_REST" "$C_DID" "$C_ADMIN_CRED" "$@" 2>&1; }

# ---- builds: one download per (wallet, bifold) pair, reused by every later run ----

# dispatch_build <sha> on|off: the newest green dispatched test build of <sha> with that push setting, told apart by
# its artifacts' names (a push-on build's end in -push-on; a push-off build has the iOS simulator app and the APK, so
# dispatch it with platform=both: an Android-only push-off build is never picked, a full gate needs both).
# Taking "the newest green dispatch" as push-on picked a push-off build whenever a commit had both (release/240).
dispatch_build() {
  local sha=$1 want=$2 id names
  for id in $(gh run list -R $GH_REPO --workflow test-builds.yml --commit "$sha" --event workflow_dispatch --json databaseId,conclusion \
      --jq '.[]|select(.conclusion=="success")|.databaseId'); do
    # Expired artifacts are still listed: a newer build whose download would fail must not hide an older good one.
    names=$(gh api "repos/$GH_REPO/actions/runs/$id/artifacts" --jq '.artifacts[]|select(.expired|not)|.name' 2>/dev/null)
    case $want in
      on) grep -q -- '-push-on$' <<<"$names" && { echo "$id"; return; } ;;
      off) grep -q -- '-push-on$' <<<"$names" && continue
           grep -q '^keyring-ios-sim-' <<<"$names" && grep -q '^keyring-android-' <<<"$names" && { echo "$id"; return; } ;;
    esac
  done
}

# The CI test builds of one wallet commit: the push build (push off, both platforms) and a push-on Android
# build. Prints "<push-off run id> <push-on run id or ->".
build_runs() {
  local sha=$1 off on
  # A commit whose builds came another way (main's push build cancelled; the push-off build dispatched on a cut
  # branch, 238): $GATE_HOME/build-override-<sha8> holds "<push-off run> <push-on run>".
  if [ -f "$GATE_HOME/build-override-${sha:0:8}" ]; then cat "$GATE_HOME/build-override-${sha:0:8}"; return; fi
  off=$(gh run list -R $GH_REPO --workflow test-builds.yml --commit "$sha" --event push --json databaseId,conclusion \
    --jq '[.[]|select(.conclusion=="success")][0].databaseId // empty')
  # A release branch gets no push build: its push-off build is dispatched (push=off), so take that one.
  [ -n "$off" ] || off=$(dispatch_build "$sha" off)
  # GATE_PUSH_ON_SHA: the commit whose push-on build stands for this one (main's HEAD, when nothing between them
  # changes the app: samebuild.mjs). Set by the watcher; unset, it is this commit's own.
  on=$(dispatch_build "${GATE_PUSH_ON_SHA:-$sha}" on)
  echo "${off:--} ${on:--}"
}

# Download a run's artifacts into $2 once: a folder that already holds them is kept as it is.
fetch_run() {
  local run=$1 dir=$2 try
  if ls "$dir"/keyring-* >/dev/null 2>&1; then return 0; fi
  mkdir -p "$dir"
  # Five tries a minute apart: the 239 auto-start lost its gate to two "check your internet connection" failures.
  for try in 1 2 3 4 5; do
    gh run download "$run" -R $GH_REPO -D "$dir.part" >> "$dir.log" 2>&1 && { mv "$dir.part"/* "$dir"/ && rmdir "$dir.part"; break; }
    say "download $run try $try failed: $(tail -1 "$dir.log" | cut -c1-100)"; rm -rf "${dir:?}.part"; sleep 60
  done
  local z; for z in "$dir"/keyring-ios-sim-*/keyring-sim.zip; do [ -f "$z" ] && (cd "$(dirname "$z")" && [ -d KeyRing.app ] || unzip -q -o keyring-sim.zip); done
  ls "$dir"/keyring-* >/dev/null 2>&1
}

# Resolve, download and export one candidate: CAND_WALLET, CAND_BIFOLD, CAND_APP (iOS sim), APK_OFF, APK_ON.
use_build() {
  local sha=$1 runs off on dir
  runs=$(build_runs "$sha"); off=${runs% *}; on=${runs#* }
  [ "$off" != - ] || die "no green push build of $sha"
  dir=$GATE_HOME/builds/${sha:0:8}
  fetch_run "$off" "$dir/off" || die "push-off build $off did not download"
  [ "$on" = - ] || fetch_run "$on" "$dir/on" || say "push-on build $on did not download: push legs will be skipped"
  BUILDS_NOTE="$off $on"
  if [ -f "$GATE_HOME/build-override-${sha:0:8}" ]; then BUILDS_NOTE="$BUILDS_NOTE (build-override-${sha:0:8})"
  elif [ -z "$(gh run list -R $GH_REPO --workflow test-builds.yml --commit "$sha" --event push --json databaseId,conclusion --jq '[.[]|select(.conclusion=="success")][0].databaseId // empty')" ]; then
    BUILDS_NOTE="$BUILDS_NOTE (push-off build dispatched: no push build of ${sha:0:8})"
  fi
  PUSH_ON_NOTE=
  if [ "$on" != - ] && [ -n "${GATE_PUSH_ON_SHA:-}" ] && [ "$GATE_PUSH_ON_SHA" != "$sha" ]; then
    PUSH_ON_NOTE="$on of ${GATE_PUSH_ON_SHA:0:8} (no app change since ${sha:0:8})"
    say "push-on build $PUSH_ON_NOTE"
  fi
  CAND_APP=$(ls -d "$dir"/off/keyring-ios-sim-*/KeyRing.app 2>/dev/null | head -1)
  APK_OFF=$(ls "$dir"/off/keyring-android-*/*.apk 2>/dev/null | head -1)
  APK_ON=$(ls "$dir"/on/keyring-android-*/*.apk 2>/dev/null | head -1)
  local m; m=$(dirname "$CAND_APP")/manifest.txt
  CAND_WALLET=$(grep '^wallet=' "$m" | cut -d= -f2); CAND_BIFOLD=$(grep '^bifold=' "$m" | cut -d= -f2)
  local want got; want=$(grep '^main.jsbundle.sha256=' "$m" | cut -d= -f2); got=$(shasum -a 256 "$CAND_APP/main.jsbundle" | cut -c1-12)
  [ -z "$want" ] || [ "$want" = "$got" ] || die "iOS bundle $got does not match its manifest ($want)"
  export CAND_WALLET CAND_BIFOLD CAND_APP APK_OFF APK_ON PUSH_ON_NOTE BUILDS_NOTE
  say "build ${CAND_WALLET:0:8} / bifold ${CAND_BIFOLD:0:8}: app $got · APK off $(shasum -a 256 "$APK_OFF" | cut -c1-12) · APK on $([ -f "$APK_ON" ] && shasum -a 256 "$APK_ON" | cut -c1-12 || echo none)"
}

# ---- devices ----

# emu.sh refuses to start (memory short, swap too high, another emulator up) or gives up on a boot with a non-zero
# exit. Piped through tail, that status was lost and the leg went on to wait for a device that never came
# (1010-2354: smoke-android sat 17 min in adb wait-for-device after "swap used 9 GB > 8 GB"). Now the leg breaks at
# once, with emu.sh's own reason: setup, not a verdict on the app, and --only-failed reruns the whole leg.
emu_start() {
  local port=$1 out rc why
  if is_ci; then
    # The workflow's emulator step boots one emulator on this leg's port (read from the leg's E=emulator-NNNN).
    galarm 120 adb -s "emulator-$port" wait-for-device 2>/dev/null \
      && [ "$(adb -s "emulator-$port" get-state 2>/dev/null)" = device ] && { echo "emulator-$port up (CI)"; return 0; }
    broken "no emulator on port $port (CI): the workflow's emulator step must use -port $port"
  fi
  "$EMU_SH" status >/dev/null || die "emu.sh status not ok"
  out=$("$EMU_SH" start "$AVD" --port "$port" -- -no-audio -no-boot-anim 2>&1); rc=$?
  echo "$out" | tail -1
  [ "$rc" = 0 ] && return 0
  why=$(echo "$out" | grep -E '^emu\.sh: |not booted' | tail -1 | sed 's/^emu\.sh: //')
  broken "no emulator on port $port: ${why:-emu.sh start exited $rc}"
}
emu_stop() { is_ci && return 0; "$EMU_SH" stop 2>&1 | tail -1; }
sim_boot() { xcrun simctl boot "$1" 2>/dev/null; galarm 180 xcrun simctl bootstatus "$1" >/dev/null 2>&1; }
sim_down() { xcrun simctl shutdown "$1" 2>/dev/null; }

# gate_sweep: before any leg, take off every runner what a gate leg creates and may have left there, and nothing
# else. A leg cleans up after itself, and a stop runs that cleanup (leg_begin's trap), but a run killed outright
# cannot: 1009-1608 was killed in linkfail and left an acl/swap-key consent rule on the main runner for a day, so the
# next run's links were held with auth:consent_required. Runner A is also used by hand (the UI/UX lane's approvals
# screens), so the sweep is limited to the gate's own: the task types in GATE_RULE_TASKS, the members of approver sets
# named gate-* or e2e-approvals (or $APPROVER_SET), and policies whose id starts "gate-". Anything else is logged as
# "foreign … left in place", visible but not destroyed. Called by run and rerun right after the run lock, so it never
# sweeps under a running gate. A runner named twice is swept once.
GATE_RULE_TASKS="https://trusttasks.org/spec/acl/swap-key/0.1 https://trusttasks.org/spec/vta/contexts/get/1.0"
gate_sweep() {
  local slug seen=" "
  galarm_reap
  for slug in "${RUNNER_MAIN_SLUG:-}" "${RUNNER_A_SLUG:-}" "${RUNNER_B_SLUG:-}"; do
    [ -n "$slug" ] && [[ "$seen" != *" $slug "* ]] || continue; seen="$seen$slug "
    gate_sweep_runner "$slug"
  done
}
# gate_sweep_runner <slug>: the sweep for one runner (also a leg's end-of-leg cleanup, e.g. agents.sh). A runner whose
# approvals cannot be read (network, keychain) is said so, never taken for a clean one.
gate_sweep_runner() {
  local slug=$1 json pol kind a b
  say "sweep $slug"
  json=$(pnm "$slug" approvals list --json 2>&1)
  if [[ "$json" != *"{"* ]]; then say "  sweep $slug: could not read approvals ($(echo "$json" | tail -1 | cut -c1-100))"; return 0; fi
  printf '%s' "$json" | GATE_RULE_TASKS="$GATE_RULE_TASKS" GATE_SETS_EXTRA="${APPROVER_SET:-}" python3 -c "
import os,sys,json
t=sys.stdin.read(); j=json.loads(t[t.index('{'):]) if '{' in t else {}
tasks=set(os.environ['GATE_RULE_TASKS'].split())
extra=os.environ.get('GATE_SETS_EXTRA') or ''
ours=lambda n: n.startswith('gate-') or n=='e2e-approvals' or (extra and n==extra)
for r in j.get('rules',[]):
    tt=r.get('taskType','')
    print(('rule' if tt in tasks else 'foreign-rule'), tt, r.get('approverSet') or r.get('set') or '-')
for n,ms in (j.get('approverSets') or {}).items():
    if ours(n):
        for m in ms: print('member', n, m)
    else: print('foreign-set', n, len(ms))
" | while read -r kind a b; do
    case $kind in
      rule) pnm "$slug" approvals remove "$a" >/dev/null; say "  $slug rule removed: $a"; sleep 2 ;;
      member) pnm "$slug" approvals approvers remove "$a" "$b" >/dev/null; say "  $slug approver removed from $a"; sleep 2 ;;
      foreign-rule) say "  $slug foreign rule left in place: $a (set $b)" ;;
      foreign-set) say "  $slug foreign approver set left in place: $a ($b members)" ;;
    esac
  done
  for pol in $(pnm "$slug" policy list 2>/dev/null | grep -oE 'gate-[A-Za-z0-9_-]+' | sort -u); do
    say "  $slug policy removed: $pol ($(pnm "$slug" policy delete "$pol" | tail -1 | cut -c1-60))"
  done
}

# ---- runner cleanup: what a leg made on a runner since it started ----

# Delete the phone grants (label keyring-admin, or keyring-phone from the enrolment page) made on $1 since $2, retrying a busy or rate-limited runner.
# A grant made before the leg began (a seated vetter's, a person's) is never touched.
# Whether CI's pinned pnm (pnm-linux.yml) still matches the Farm's vta-service version: one line for the run's meta,
# and a loud line on the terminal when it has drifted (farm-drift.mjs).
farm_drift() {
  local line; line=$(node "$GATE_SRC/farm-drift.mjs" --farm "${FARM_VERSIONS:-}" 2>&1 | tail -1)
  case "$line" in DRIFT*) echo "!! $line" >&2 ;; esac
  echo "$line"
}

keys_since() {
  local slug=$1 t0=$2 k r i
  # t0 is compared as a string with each entry's ISO createdAt: anything else (epoch seconds, empty) sorts below
  # every date and would take every phone key on the runner (a seated vetter's, on 237's gate).
  [[ $t0 =~ ^20[0-9][0-9]-[01][0-9]-[0-3][0-9]T ]] || { echo "  $slug keys: NOT cleaned, start time \"$t0\" is not an ISO stamp"; return 1; }
  # Side by side, every leg's phone grant looks alike (the runner's admin made it, label keyring-admin or keyring-phone): one
  # leg's cleanup would take another's live key. gate.sh then cleans each runner once, after both platforms.
  if [ "${GATE_DEFER_KEYS:-}" = 1 ]; then echo "  $slug keys: deferred to the run's end"; echo "$slug" >> "$RUN_DIR/defer-keys"; return; fi
  local list; list=$(for i in 1 2 3 4; do pnm "$slug" acl list --json | python3 -c "
import sys,json
t=sys.stdin.read()
if '[' not in t: sys.exit(1)
for e in json.loads(t[t.index('['):]):
    if e.get('label') in ('keyring-admin','keyring-phone') and str(e.get('createdAt',''))>='$t0': print(e['subject'])
" && break; sleep 15; done)
  for k in $list; do
    for i in 1 2 3 4; do r=$(pnm "$slug" acl delete "$k" | tail -1); echo "$r" | grep -q deleted && break; sleep 15; done
    echo "  $slug key ${k:0:28}…: $(echo "$r" | cut -c1-40)"; sleep 3
  done
}

# Remove every approval rule and approver-set member on $1. Only for runners the gate owns: a leg sets rules
# for its run, and a rule left on a runner holds every later run's requests.
rules_clear() {
  local slug=$1
  pnm "$slug" approvals list --json | python3 -c "
import sys,json
t=sys.stdin.read(); j=json.loads(t[t.index('{'):]) if '{' in t else {}
for r in j.get('rules',[]): print('rule', r.get('taskType'))
for n,ms in (j.get('approverSets') or {}).items():
    for m in ms: print('member', n, m)
" | while read -r kind a b; do
    case $kind in
      rule) pnm "$slug" approvals remove "$a" >/dev/null; echo "  $slug rule removed: $a" ;;
      member) pnm "$slug" approvals approvers remove "$a" "$b" >/dev/null; echo "  $slug approver removed from $a" ;;
    esac
    sleep 2
  done
  echo "  $slug after: $(pnm "$slug" approvals list | tr -d ' \n' | grep -oE '\{"approverSets.*' | cut -c1-80)"
}

# ---- build capabilities: does the build's JS bundle hold a testID key? (e2e/lib/buildHas.js) ----

# The cached answers, one file per build, under the gate's home.
export BUILDHAS_CACHE_DIR=${BUILDHAS_CACHE_DIR:-$GATE_HOME/buildhas}
# build_has <key> [apk | .app]: exit 0 when the build holds the key, 1 when it lacks it, 2 when no build is known.
# Without a file it reads what the leg exported (ANDROID_APK or APK_OFF; IOS_APP or CAND_APP), so name the file.
build_has() { node "$E2E/lib/buildHas.js" has "$1" ${2:+--build "$2"} >/dev/null 2>&1; }
# build_caps [apk | .app]: how many of the manifests' keys the build holds, "<present>/<total>", or "-".
build_caps() { local c; c=$(node "$E2E/lib/buildHas.js" caps ${1:+--build "$1"} 2>/dev/null); echo "${c:--}"; }

# ---- rows ----

# One leg's rows from its log, as "<status>\t<name>\t<detail>".
leg_rows() { grep -E '^ROW ' "$1" | sed -E 's/^ROW (.*) (PASS|FAIL|SKIP) — (.*)$/\2\t\1\t\3/'; }

# ---- a leg's own lines (the same contract as e2e/lib/rows.js) ----

LEG_NAME=""; LEG_T0=0; LEG_FAILS=0; LEG_PASS=0; LEG_SKIP=0; LEG_BROKEN=""
# leg_begin <leg> <build sha> [apk | .app]: the HEADS line; with the build file, caps=<n> is how many of the
# manifests' testID keys that build holds (build_caps), "-" without one. LEG_HEADS_EXTRA, when a leg sets it, is
# appended after caps (the CI leg names its device there).
leg_begin() {
  LEG_NAME=$1; LEG_T0=$(date +%s); LEG_START=$(stamp)
  local caps=-; [ -n "${3:-}" ] && caps=$(build_caps "$3" | cut -d/ -f1)
  echo "HEADS $LEG_NAME wallet=${CAND_WALLET:0:8} bifold=${CAND_BIFOLD:0:8} build=${2:-} harness=$(git -C "$REPO" rev-parse --short=8 HEAD) target=${GATE_TARGET:-?} farm=\"${FARM_VERSIONS:-unrecorded}\" openvtc=${OPENVTC_VERSION:-?}@$( [ -f "${OPENVTC_BIN:-}" ] && shasum -a 256 "$OPENVTC_BIN" | cut -c1-8 || echo -) caps=$caps${LEG_HEADS_EXTRA:+ $LEG_HEADS_EXTRA}"
  trap leg_end EXIT
  # A stop (the watcher booted out, a ctrl-C, gate.sh forwarding a TERM) becomes a normal exit, so leg_end and the
  # leg's cleanup still run. Only SIGKILL or a power loss skip it; the start-of-gate sweep (gate_sweep) covers those.
  trap 'exit 143' TERM INT HUP
}
# row <name> PASS|FAIL|SKIP <detail>; a name not in E2E_ONLY_ROWS (when set) is reported as not selected.
row() {
  local name=$1 st=$2; shift 2
  echo "ROW $name $st — $*"
  case $st in PASS) LEG_PASS=$((LEG_PASS + 1)) ;; FAIL) LEG_FAILS=$((LEG_FAILS + 1)) ;; *) LEG_SKIP=$((LEG_SKIP + 1)) ;; esac
}
selected() { [ -z "${E2E_ONLY_ROWS:-}" ] || [[ ",$E2E_ONLY_ROWS," == *",$1,"* ]]; }
broken() { LEG_BROKEN=$*; echo "LEG $LEG_NAME BROKEN — $*"; exit 1; }
# Fold a driver's own ROW lines (rows.js, or the older drivers' ROW lines) into this leg's counts.
take_rows() {
  local st name detail
  while IFS=$'\t' read -r st name detail; do
    case $st in PASS) LEG_PASS=$((LEG_PASS + 1)) ;; FAIL) LEG_FAILS=$((LEG_FAILS + 1)) ;; SKIP) LEG_SKIP=$((LEG_SKIP + 1)) ;; esac
    echo "ROW $name $st — $detail"
  done < <(leg_rows "$1")
}
leg_end() {
  local rc=$?
  trap '' TERM INT HUP
  [ -n "${LEG_CLEANUP:-}" ] && { $LEG_CLEANUP || true; }
  galarm_reap "${LEG_NAME:-gate}"
  # Count from the leg's own log when there is one: a ROW line printed in a subshell, or by a driver, counts too.
  if [ -f "${LEG_DIR:-}/leg.log" ]; then
    LEG_PASS=$(grep -cE '^ROW .* PASS — ' "$LEG_DIR/leg.log"); LEG_FAILS=$(grep -cE '^ROW .* FAIL — ' "$LEG_DIR/leg.log"); LEG_SKIP=$(grep -cE '^ROW .* SKIP — ' "$LEG_DIR/leg.log")
  fi
  if [ -n "$LEG_BROKEN" ] || { [ "$rc" -ne 0 ] && [ "$rc" -ne 3 ]; }; then rc=1; elif [ "$LEG_FAILS" -gt 0 ]; then rc=3; else rc=0; fi
  echo "LEG $LEG_NAME DONE $rc pass=$LEG_PASS fail=$LEG_FAILS skip=$LEG_SKIP $(( $(date +%s) - LEG_T0 ))s"
  exit $rc
}

# A driver that stopped early prints fewer rows, and the rows it did print may all pass: its exit code says so.
# driver_rc <row-name> <exit code> <its output file>: a FAIL row unless it exited 0 or 3 (3: a row of its own failed).
driver_rc() {
  local name=$1 rc=$2 out=$3
  case $rc in 0|3) ;; *) row "$name" FAIL "the driver stopped (rc=$rc): $(grep -aE 'error: |Error:|❌' "$out" 2>/dev/null | grep -v webdriver | grep -v stacktrace | tail -1 | cut -c1-160)" ;; esac
}
