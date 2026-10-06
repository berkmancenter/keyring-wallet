#!/bin/bash
# "Ask me before…" and a test request approved from the phone itself (#317 owner check, task-consent decision):
# a fresh Android phone (push-on build) links to the main runner, sets a device PIN, switches a rule on, sends
# itself a test request, approves it, and switches the rule off. Rows come from run-askme.mjs.
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN
APK=${APK_ON:-}; [ -f "$APK" ] || APK=$APK_OFF
leg_begin testreq "$(shasum -a 256 "$APK" | cut -c1-12)"
T0=$(stamp); E=emulator-5572
fin() {
  adb -s $E shell locksettings clear --old 1234 >/dev/null 2>&1
  adb -s $E uninstall $BID >/dev/null 2>&1; { [ -n "${LC:-}" ] && kill "$LC" 2>/dev/null; }; emu_stop
  echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"; rules_clear "$RUNNER_MAIN_SLUG"
}
LEG_CLEANUP=fin
emu_start 5572
adb -s $E uninstall $BID >/dev/null 2>&1
cd "$E2E"
t=$(date +%s)
E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4762 ENROL_PORT=8197 E2E_RELEASE=1 \
  LINK_MODE=manual RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN=$PNM_BIN E2E_KEEP_APP=1 \
  perl -e 'alarm 1800; exec @ARGV' node run-vta-link.js > "$LEG_DIR/link.out" 2>&1 || broken "link: $(grep -E '✅|❌' "$LEG_DIR/link.out" | tail -1 | cut -c1-120)"
row testreq-link PASS "$(( $(date +%s) - t ))s"
adb -s $E logcat -c; adb -s $E logcat -v time > "$LEG_DIR/logcat.log" 2>/dev/null & LC=$!
DECIDE=approve DEVICE_PIN=1234 E2E_APP_ID=$BID UDID=$E ANDROID_UDID=$E ANDROID_SERIAL=$E APPIUM_PORT=4762 RUNNER_VTA=$RUNNER_MAIN_SLUG PNM_BIN=$PNM_BIN \
  perl -e 'alarm 900; exec @ARGV' node run-askme.mjs > "$LEG_DIR/askme.out" 2>&1
grep -E '^\[e2e\] [0-9]' "$LEG_DIR/askme.out" | cut -c1-200
take_rows "$LEG_DIR/askme.out"
