#!/bin/bash
# IN-350 (bifold #454, #455): this phone's own agent refuses it. A fresh Android phone links to the main runner and joins
# community C (the harness admin approves); then the harness removes this phone's own grant from the runner, the
# entries its link record names (run-vta-link.js last-link.json; lib/aclCleanup.js linkedPhoneEntries, the selection
# keys_since makes at the end of every leg: the harness's own phone grant, never another leg's or a person's entry).
# Rows come from e2e/run-agent-refused.mjs: refused-member-joined, refused-before (the control: no notice while the
# grant stands), refused-no-toast (a verdict only with the refusal in the phone's log), refused-link-removed and
# refused-community-notice. A build without PersonaAgentNotice (before bifold #455) SKIPs every row.
. "$(dirname "$0")/../lib.sh"; gate_env
REFUSED_ROWS="refused-link refused-member-joined refused-before refused-no-toast refused-link-removed refused-community-notice"
for r in $REFUSED_ROWS; do case $r in refused-link) ;; *) REFUSED_ROWS="$REFUSED_ROWS ${r/refused-/refused-heartbeat-}";; esac; done
APK=$APK_OFF
leg_begin refused "$(shasum -a 256 "$APK" | cut -c1-12)" "$APK"
if ! unzip -p "$APK" assets/index.android.bundle 2>/dev/null | grep -aq PersonaAgentNotice; then
  for r in $REFUSED_ROWS; do row "$r" SKIP "the build lacks PersonaAgentNotice (before bifold #455)"; done; exit 0
fi
# bifold #473: a revoked phone's community says the agent no longer accepts it (JoinAgentRefused) on the Join route.
# A build without it still asks to link first, and the community row expects that (pre-fix).
JOIN_REFUSED=0; unzip -p "$APK" assets/index.android.bundle 2>/dev/null | grep -aq JoinAgentRefused && JOIN_REFUSED=1
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN C_DID C_REST C_ADMIN_CRED
T0=$(stamp); E=emulator-5572
# The phone's log so far into $LEG_DIR/logcat-$1.log, then cleared. Per path, since one dump at the end held only the
# relaunch path: the driver clears the log at each removal (run-agent-refused.mjs), so the relaunch path's removal
# wiped the heartbeat window, and 1022-1726 had no app line to read for it.
# Only with the emulator there: adb waits for a missing device forever (1022-0149: a 53 min hang after a swap-guard broken).
dump_logcat() {
  adb devices | grep -q "^$E[[:space:]]" || return 0
  adb -s $E logcat -d -v time > "$LEG_DIR/logcat-$1.log" 2>/dev/null; adb -s $E logcat -c >/dev/null 2>&1
}
fin() {
  dump_logcat end
  adb -s $E uninstall $BID >/dev/null 2>&1; emu_stop
  echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"; gate_sweep_runner "$RUNNER_MAIN_SLUG"
}
LEG_CLEANUP=fin
emu_start 5572
adb -s $E uninstall $BID >/dev/null 2>&1
adb -s $E logcat -G 16M >/dev/null 2>&1
cd "$E2E"
# Two paths, each on a fresh install and link (a link removed once is not removed again): heartbeat (stay open past
# AgentPresence's 5 min tick) and relaunch (reopen, so the persona inbox asks the agent). run-agent-refused.mjs.
# REFUSED_PATHS runs some of them only (a rerun of one path); a path not run leaves its rows out, never PASS.
for path in ${REFUSED_PATHS:-heartbeat relaunch}; do
  case $path in heartbeat|relaunch) ;; *) broken "REFUSED_PATHS: no path \"$path\" (heartbeat, relaunch)";; esac
  adb -s $E uninstall $BID >/dev/null 2>&1; rm -f "$LEG_DIR/last-link.json"   # each path's own record, never the last one's
  t=$(date +%s)
  E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4765 ENROL_PORT=8196 E2E_RELEASE=1 \
    LINK_MODE=manual RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN=$PNM_BIN E2E_KEEP_APP=1 \
    galarm 1800 node run-vta-link.js > "$LEG_DIR/link-$path.out" 2>&1 || broken "link ($path): $(grep -E '✅|❌' "$LEG_DIR/link-$path.out" | tail -1 | cut -c1-120)"
  [ -f "$LEG_DIR/last-link.json" ] || broken "the $path link left no record (last-link.json): nothing names this phone's grant"
  mv "$LEG_DIR/last-link.json" "$LEG_DIR/last-link-$path.json"
  [ $path = relaunch ] && row refused-link PASS "$(( $(date +%s) - t ))s"
  # The whole window, streamed: the driver clears the log at the removal, and a dump at the end can lose lines to the ring.
  adb -s $E logcat -v time > "$LEG_DIR/logcat-stream-$path.log" 2>/dev/null & lc=$!
  # heartbeat stays open two presence ticks (the driver's REFUSED_HEARTBEAT_S, 660 s) on top of the join.
  E2E_APP_ID=$BID UDID=$E ANDROID_UDID=$E ANDROID_SERIAL=$E APPIUM_PORT=4765 C_DID=$C_DID C_REST=$C_REST C_ADMIN_CRED=$C_ADMIN_CRED \
    LINK_FILE="$LEG_DIR/last-link-$path.json" PNM_BIN=$PNM_BIN REFUSED_PATH=$path REFUSED_JOIN_LINE=$JOIN_REFUSED galarm $([ $path = heartbeat ] && echo 2100 || echo 1500) node run-agent-refused.mjs > "$LEG_DIR/refused-$path.out" 2>&1; drc=$?
  kill $lc 2>/dev/null; wait $lc 2>/dev/null
  grep -E '^\[e2e\] link status' "$LEG_DIR/refused-$path.out"
  grep -E '^\[e2e\] removed|^\[cleanup\]' "$LEG_DIR/refused-$path.out" | cut -c1-200
  dump_logcat $path
  take_rows "$LEG_DIR/refused-$path.out"
  driver_rc refused-$path-driver "$drc" "$LEG_DIR/refused-$path.out"
done
