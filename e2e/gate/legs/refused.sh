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
APK=$APK_OFF
leg_begin refused "$(shasum -a 256 "$APK" | cut -c1-12)" "$APK"
if ! unzip -p "$APK" assets/index.android.bundle 2>/dev/null | grep -aq PersonaAgentNotice; then
  for r in $REFUSED_ROWS; do row "$r" SKIP "the build lacks PersonaAgentNotice (before bifold #455)"; done; exit 0
fi
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN C_DID C_REST C_ADMIN_CRED
T0=$(stamp); E=emulator-5572
fin() {
  adb -s $E logcat -d -v time > "$LEG_DIR/logcat.log" 2>/dev/null
  adb -s $E uninstall $BID >/dev/null 2>&1; emu_stop
  echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"; gate_sweep_runner "$RUNNER_MAIN_SLUG"
}
LEG_CLEANUP=fin
emu_start 5572
adb -s $E uninstall $BID >/dev/null 2>&1
adb -s $E logcat -G 16M >/dev/null 2>&1
cd "$E2E"
t=$(date +%s)
E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4765 ENROL_PORT=8196 E2E_RELEASE=1 \
  LINK_MODE=manual RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN=$PNM_BIN E2E_KEEP_APP=1 \
  galarm 1800 node run-vta-link.js > "$LEG_DIR/link.out" 2>&1 || broken "link: $(grep -E '✅|❌' "$LEG_DIR/link.out" | tail -1 | cut -c1-120)"
[ -f "$LEG_DIR/last-link.json" ] || broken "the link left no record (last-link.json): nothing names this phone's grant"
row refused-link PASS "$(( $(date +%s) - t ))s"
E2E_APP_ID=$BID UDID=$E ANDROID_UDID=$E ANDROID_SERIAL=$E APPIUM_PORT=4765 C_DID=$C_DID C_REST=$C_REST C_ADMIN_CRED=$C_ADMIN_CRED \
  LINK_FILE="$LEG_DIR/last-link.json" PNM_BIN=$PNM_BIN galarm 1200 node run-agent-refused.mjs > "$LEG_DIR/refused.out" 2>&1; drc=$?
grep -E '^\[e2e\] removed|^\[cleanup\]' "$LEG_DIR/refused.out" | cut -c1-200
take_rows "$LEG_DIR/refused.out"
driver_rc refused-driver "$drc" "$LEG_DIR/refused.out"
