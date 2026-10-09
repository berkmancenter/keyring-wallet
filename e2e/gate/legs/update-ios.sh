#!/bin/bash
# Update over the previous release, iOS: what a tester gets from TestFlight. The previous release's app is
# installed fresh and linked to the main runner; then the candidate is installed over it (no uninstall, the
# container kept, as an update does) and Your agent must still be linked. The device log from the first launch
# after the update is kept, and any "not found in backend" line is reported with the lines around it.
# GATE_PREV_PIN: the previous release's wallet commit (default: $GATE_HOME/golden).
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN SMOKE_SIM_UDID SMOKE_SIM_NAME IOS_VERSION
NEW_APP=$CAND_APP; NEW_W=$CAND_WALLET; NEW_B=$CAND_BIFOLD
PREV=${GATE_PREV_PIN:-$(cat "$GATE_HOME/golden")}
use_build "$PREV" >/dev/null; PREV_APP=$CAND_APP; PREV_W=$CAND_WALLET
CAND_APP=$NEW_APP; CAND_WALLET=$NEW_W; CAND_BIFOLD=$NEW_B
leg_begin update-ios "$(shasum -a 256 "$PREV_APP/main.jsbundle" | cut -c1-12)→$(shasum -a 256 "$NEW_APP/main.jsbundle" | cut -c1-12)"
T0=$(stamp); SIM=$SMOKE_SIM_UDID; LS=
wda_stop() { local p; for p in $(ps -axo pid,command | grep -E "xcodebuild.*WebDriverAgent" | grep "$SIM" | grep -v grep | awk '{print $1}'); do kill "$p"; done; }
fin() { [ -n "$LS" ] && kill "$LS" 2>/dev/null; wda_stop; sim_down "$SIM"; echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"; }
LEG_CLEANUP=fin
export PLATFORM=ios UDID=$SIM IOS_DEVICE_NAME=$SMOKE_SIM_NAME IOS_PLATFORM_VERSION=$IOS_VERSION APPIUM_PORT=4768 WDA_LOCAL_PORT=8167 MJPEG_PORT=9167 ENROL_PORT=8198
export RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN E2E_RELEASE=1 LINK_MODE=manual
echo "previous ${PREV_W:0:8} → candidate ${CAND_WALLET:0:8}"
sim_boot "$SIM"; xcrun simctl uninstall "$SIM" "$BID" 2>/dev/null
xcrun simctl install "$SIM" "$PREV_APP" || broken "the previous build did not install"
cd "$E2E"
IOS_APP=$PREV_APP E2E_KEEP_APP=1 perl -e 'alarm 1500; exec @ARGV' node run-vta-link.js > "$LEG_DIR/link-prev.out" 2>&1 \
  || broken "link on the previous build: $(grep -E '✅|❌' "$LEG_DIR/link-prev.out" | tail -1 | cut -c1-120)"
row update-prev-linked PASS "previous build ${PREV_W:0:8} linked to the main runner"
wda_stop; xcrun simctl terminate "$SIM" "$BID" 2>/dev/null
# The update: the candidate over the installed app, container kept.
xcrun simctl spawn "$SIM" log stream --style compact --level debug --predicate 'process == "KeyRing"' > "$LEG_DIR/device-after-update.log" 2>&1 & LS=$!
xcrun simctl install "$SIM" "$NEW_APP" || broken "the candidate did not install over the previous build"
echo "installed over: $(shasum -a 256 "$(xcrun simctl get_app_container "$SIM" "$BID")/main.jsbundle" | cut -c1-12)"
C_DID= perl -e 'alarm 600; exec @ARGV' node run-after-update.mjs > "$LEG_DIR/after.out" 2>&1   # no join on iOS here: no community to check
grep -E '^AFTER-UPDATE' "$LEG_DIR/after.out" | cut -c1-240
take_rows "$LEG_DIR/after.out"
sleep 3; kill "$LS" 2>/dev/null; LS=
n=$(grep -c "not found in backend" "$LEG_DIR/device-after-update.log")
if [ "$n" -eq 0 ]; then row update-no-missing-key PASS "no \"not found in backend\" in the device log after the update ($(wc -l < "$LEG_DIR/device-after-update.log" | tr -d ' ') lines)"
else row update-no-missing-key FAIL "$n \"not found in backend\" line(s); first: $(grep -m1 'not found in backend' "$LEG_DIR/device-after-update.log" | cut -c1-200)"
  grep -n -B5 -A5 -m3 "not found in backend" "$LEG_DIR/device-after-update.log" | cut -c1-260; fi
