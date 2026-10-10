#!/bin/bash
# bifold #347: a join request that never reached C. A fresh Android phone (push-off build) linked to the main runner
# asks to join C with its network off, then reopens Join with it back on: JoinRequestLost, then JoinSendAgain sends a
# fresh request C lists (run-join-lost.mjs). That request is declined at the end. A build without #347 is SKIP.
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN C_DID C_NAME C_REST C_ADMIN_CRED
APK=$APK_OFF
leg_begin lostreq "$(shasum -a 256 "$APK" | cut -c1-12)" "$APK"
if ! unzip -p "$APK" assets/index.android.bundle 2>/dev/null | grep -q JoinRequestLost; then
  row join-lost-request SKIP "this build has no JoinRequestLost (bifold #347)"; exit 0
fi
T0=$(stamp); E=emulator-5572
fin() {
  adb -s $E shell cmd connectivity airplane-mode disable >/dev/null 2>&1
  [ -n "${C_MEDIATOR_HOST:-}" ] && for t in iptables ip6tables; do adb -s $E shell $t -D OUTPUT -d "$C_MEDIATOR_HOST" -j REJECT >/dev/null 2>&1; done
  adb -s $E uninstall $BID >/dev/null 2>&1; emu_stop; echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"
  local r; for r in $(grep -oE '^LOST_REQ [^ ]+' "$LEG_DIR/lost.out" 2>/dev/null | awk '{print $2}' | sort -u); do
    echo "  decline $r: $(JOIN_DECIDE_REASON='gate: a lost-request test, declined after the leg' c_admin join-decide "$r" rejected | grep -oE -- '-> [0-9]+' | tail -1)"
  done
}
LEG_CLEANUP=fin
emu_start 5572
for pkg in $BID $BID.pushtest; do adb -s $E uninstall "$pkg" >/dev/null 2>&1; done
cd "$E2E"
E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4762 ENROL_PORT=8197 E2E_RELEASE=1 \
  LINK_MODE=manual RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN=$PNM_BIN E2E_KEEP_APP=1 \
  perl -e 'alarm 1800; exec @ARGV' node run-vta-link.js > "$LEG_DIR/link.out" 2>&1 || broken "link: $(grep -E '✅|❌' "$LEG_DIR/link.out" | tail -1 | cut -c1-120)"
# 239: lose the request by blocking only the community's messaging host (needs root: google_apis image).
if [ -n "${C_MEDIATOR_HOST:-}" ]; then adb -s $E root >/dev/null 2>&1; sleep 3; adb -s $E wait-for-device; echo "adb root: $(adb -s $E shell id -u)"; fi
E2E_APP_ID=$BID UDID=$E APPIUM_PORT=4762 BLOCK_HOST=${C_MEDIATOR_HOST:-} C_DID=$C_DID C_NAME=$C_NAME C_ADMIN="$C_REST $C_DID $C_ADMIN_CRED" \
  perl -e 'alarm 900; exec @ARGV' node run-join-lost.mjs > "$LEG_DIR/lost.out" 2>&1; drc=$?
grep -E '^\[e2e\] [0-9]' "$LEG_DIR/lost.out" | cut -c1-220
take_rows "$LEG_DIR/lost.out"
driver_rc lostreq-driver "$drc" "$LEG_DIR/lost.out"
