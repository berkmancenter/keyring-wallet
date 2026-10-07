#!/bin/bash
# Several agents on one phone (Android, push-on build): A and B are two runner agents, C the community.
# Rows (run-several-agents.mjs): R1 add a second agent and switch; R2 Join on B suggests A; R7 C opened on B says
# it is A's (#320); R5 a refusal on Your agent; R4 unlink one, then the last. AGENT_ROWS picks some.
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_A_SLUG RUNNER_A_DID RUNNER_A_URL RUNNER_A_NAME RUNNER_B_SLUG RUNNER_B_DID RUNNER_B_URL RUNNER_B_NAME C_DID C_NAME C_REST C_ADMIN_CRED PNM_BIN
APK=${APK_ON:-}; [ -f "$APK" ] || APK=$APK_OFF
leg_begin agents "$(shasum -a 256 "$APK" | cut -c1-12)"
T0=$(stamp); E=emulator-5572
fin() {
  adb -s $E shell locksettings clear --old 1234 >/dev/null 2>&1
  { [ -n "${LC:-}" ] && kill "$LC" 2>/dev/null; }; adb -s $E uninstall $BID >/dev/null 2>&1; emu_stop
  echo "== cleanup $(utc)"
  local s m c
  for s in "$RUNNER_A_SLUG" "$RUNNER_B_SLUG"; do
    keys_since "$s" "$T0"; rules_clear "$s"
    for c in $(pnm "$s" contexts list | grep -oE 'agents-r3-[0-9]+' | sort -u); do echo "  $s context $c: $(pnm "$s" contexts delete -y "$c" | tail -1 | cut -c1-50)"; done
  done
  for m in $(grep -oE '^(R2_MEMBER|R6_MEMBER) did:[^ ]+' "$LEG_DIR/agents.out" 2>/dev/null | awk '{print $2}' | sort -u); do
    echo "  C member …${m: -24}: $(c_admin member-remove "$m" "gate cleanup" | grep -oE -- '-> [0-9]+' | tail -1)"
  done
}
LEG_CLEANUP=fin
emu_start 5572
for pkg in $BID $BID.pushtest; do adb -s $E uninstall "$pkg" >/dev/null 2>&1; done
adb -s $E logcat -c; adb -s $E logcat -v time > "$LEG_DIR/logcat.log" 2>/dev/null & LC=$!
cd "$E2E"
t=$(date +%s)
RUNNER_VTA=$RUNNER_A_SLUG RUNNER_VTA_DID=$RUNNER_A_DID RUNNER_VTA_URL=$RUNNER_A_URL E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E \
  ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4762 ENROL_PORT=8197 E2E_RELEASE=1 LINK_MODE=manual PNM_BIN=$PNM_BIN E2E_KEEP_APP=1 \
  perl -e 'alarm 1800; exec @ARGV' node run-vta-link.js > "$LEG_DIR/link-a.out" 2>&1 || broken "link A: $(grep -E '✅|❌' "$LEG_DIR/link-a.out" | tail -1 | cut -c1-120)"
row agents-link-a PASS "$(( $(date +%s) - t ))s"
ROWS="${AGENT_ROWS:-R1 R8 R2 R7 R5 R4}" A_SLUG=$RUNNER_A_SLUG A_DID=$RUNNER_A_DID A_NAME=$RUNNER_A_NAME B_SLUG=$RUNNER_B_SLUG B_DID=$RUNNER_B_DID \
  B_NAME=$RUNNER_B_NAME C_DID=$C_DID C_NAME=$C_NAME C_ADMIN="$C_REST $C_DID $C_ADMIN_CRED" DEVICE_PIN=1234 LOGCAT=$LEG_DIR/logcat.log E2E_APP_ID=$BID \
  UDID=$E ANDROID_UDID=$E ANDROID_SERIAL=$E APPIUM_PORT=4762 PNM_BIN=$PNM_BIN perl -e 'alarm 3000; exec @ARGV' node run-several-agents.mjs > "$LEG_DIR/agents.out" 2>&1; drc=$?
grep -E '^\[e2e\] [0-9]|^FINDING' "$LEG_DIR/agents.out" | cut -c1-200
take_rows "$LEG_DIR/agents.out"
driver_rc agents-driver "$drc" "$LEG_DIR/agents.out"
