#!/bin/bash
# Linking and My devices (Android, push-off build).
#  #306: a fresh phone must refuse to link to a community's own agent.
#  Then a fresh phone links to the main runner, sets a device PIN, and run-release-235.mjs checks My devices
#  (IN-124 loads or says why; a new device's name, ACL label and rename) and #310's scan-beside (another agent's
#  code is offered beside, not refused).
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL RUNNER_A_DID COMMUNITY_AGENT_SLUG COMMUNITY_AGENT_DID PNM_BIN
APK=$APK_OFF
leg_begin devices "$(shasum -a 256 "$APK" | cut -c1-12)" "$APK"
T0=$(stamp); E=emulator-5572
fin() {
  adb -s $E shell locksettings clear --old 1234 >/dev/null 2>&1; adb -s $E uninstall $BID >/dev/null 2>&1; emu_stop
  echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"; keys_since "$COMMUNITY_AGENT_SLUG" "$T0"
}
LEG_CLEANUP=fin
emu_start 5572
for pkg in $BID $BID.pushtest; do adb -s $E uninstall "$pkg" >/dev/null 2>&1; done
cd "$E2E"
L() { E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4762 ENROL_PORT=8197 \
  E2E_RELEASE=1 LINK_MODE=manual PNM_BIN=$PNM_BIN "$@"; }

if selected community-agent-refused; then
  L env RUNNER_VTA=$COMMUNITY_AGENT_SLUG RUNNER_VTA_DID=$COMMUNITY_AGENT_DID EXPECT_REFUSAL=communityAgent \
    perl -e 'alarm 1200; exec @ARGV' node run-vta-link.js > "$LEG_DIR/community-agent.out" 2>&1; rc=$?
  said=$(grep -oE 'refused as a community.s agent: .*' "$LEG_DIR/community-agent.out" | head -1 | cut -c1-140)
  if [ $rc -eq 0 ]; then row community-agent-refused PASS "${said:-refused}"; else row community-agent-refused FAIL "rc=$rc $(grep -E '❌' "$LEG_DIR/community-agent.out" | tail -1 | cut -c1-120)"; fi
  adb -s $E uninstall $BID >/dev/null 2>&1
fi

L env RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL E2E_KEEP_APP=1 \
  perl -e 'alarm 1800; exec @ARGV' node run-vta-link.js > "$LEG_DIR/link.out" 2>&1 || broken "link: $(grep -E '✅|❌' "$LEG_DIR/link.out" | tail -1 | cut -c1-120)"
adb -s $E shell locksettings set-pin 1234 >/dev/null 2>&1; sleep 8   # a key made in the 5 s after a lock is set does not prompt yet
E2E_APP_ID=$BID UDID=$E ANDROID_UDID=$E ANDROID_SERIAL=$E APPIUM_PORT=4762 RUNNER_VTA=$RUNNER_MAIN_SLUG PNM_BIN=$PNM_BIN DEVICE_PIN=1234 \
  OTHER_AGENT_DID=$RUNNER_A_DID ROWS="in124 devices scanbeside" perl -e 'alarm 1500; exec @ARGV' node run-release-235.mjs > "$LEG_DIR/rows.out" 2>&1; drc=$?
grep -E '^\[e2e\] [0-9]|^DEVICES-REOPEN' "$LEG_DIR/rows.out" | cut -c1-200
take_rows "$LEG_DIR/rows.out"
driver_rc devices-driver "$drc" "$LEG_DIR/rows.out"
