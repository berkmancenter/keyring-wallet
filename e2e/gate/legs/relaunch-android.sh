#!/bin/bash
# A plain relaunch, Android (bifold #336's case, Alberto's 239 report without the update): the candidate links to
# the main runner, joins C (so a persona under that agent exists) and adds a second agent (B, then current); then
# the app is killed and relaunched, and C is opened from its Wallet card, which uses the persona the
# NON-current agent holds. Pass: no "not found in backend" in logcat, and (with #336) a line that the persona's
# keys were fetched through its agent on use.
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL RUNNER_MAIN_NAME RUNNER_B_SLUG RUNNER_B_DID RUNNER_B_NAME C_DID C_NAME C_REST C_ADMIN_CRED PNM_BIN
NEW_APK=$APK_OFF; NEW_W=$CAND_WALLET; NEW_B=$CAND_BIFOLD
PREV_APK=$NEW_APK; PREV_W=$NEW_W
leg_begin relaunch-android "$(shasum -a 256 "$NEW_APK" | cut -c1-12)"
T0=$(stamp); E=emulator-5572
fin() {
  adb -s $E shell locksettings clear --old 1234 >/dev/null 2>&1; { [ -n "${LC:-}" ] && kill "$LC" 2>/dev/null; }; adb -s $E uninstall $BID >/dev/null 2>&1; emu_stop
  echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"; keys_since "$RUNNER_B_SLUG" "$T0"
  local m; for m in $(grep -hoE '^JOIN_MEMBER did:[^ ]+' "$LEG_DIR"/*.out 2>/dev/null | awk '{print $2}' | sort -u); do
    echo "  C member …${m: -24}: $(c_admin member-remove "$m" "gate: update leg member" | grep -oE -- '-> [0-9]+' | tail -1)"; done
}
LEG_CLEANUP=fin
echo "candidate ${CAND_WALLET:0:8}: link, join, second agent, then kill and relaunch"
emu_start 5572
for pkg in $BID $BID.pushtest; do adb -s $E uninstall "$pkg" >/dev/null 2>&1; done
cd "$E2E"
E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$PREV_APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4762 ENROL_PORT=8197 E2E_RELEASE=1 \
  LINK_MODE=manual RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN=$PNM_BIN E2E_KEEP_APP=1 \
  perl -e 'alarm 1800; exec @ARGV' node run-vta-link.js > "$LEG_DIR/link-prev.out" 2>&1 || broken "link on the previous build: $(grep -E '✅|❌' "$LEG_DIR/link-prev.out" | tail -1 | cut -c1-120)"
row relaunch-linked PASS "linked to the main runner"
E2E_APP_ID=$BID UDID=$E ANDROID_UDID=$E ANDROID_SERIAL=$E APPIUM_PORT=4762 C_DID=$C_DID C_NAME=$C_NAME JOIN_APPROVE=1 C_ADMIN="$C_REST $C_DID $C_ADMIN_CRED" \
  PERSONA_SHOTS=$LEG_DIR/persona-did perl -e 'alarm 900; exec @ARGV' node run-join-waiting.mjs > "$LEG_DIR/join-prev.out" 2>&1
member=$(grep -c '^ROW join-approved-card PASS' "$LEG_DIR/join-prev.out")
row relaunch-member "$([ "$member" -gt 0 ] && echo PASS || echo FAIL)" "joined C: $(grep -E '^ROW join-approved-card' "$LEG_DIR/join-prev.out" | cut -c1-120)"
adb -s $E shell locksettings set-pin 1234 >/dev/null 2>&1; sleep 8
MAIN_NAME=$(grep -oE 'home now "[^"]+"' "$LEG_DIR/link-prev.out" | tail -1 | cut -d'"' -f2)
ROWS="R1" A_SLUG=$RUNNER_MAIN_SLUG A_DID=$RUNNER_MAIN_DID A_NAME=${MAIN_NAME:-$RUNNER_MAIN_NAME} B_SLUG=$RUNNER_B_SLUG B_DID=$RUNNER_B_DID B_NAME=$RUNNER_B_NAME \
  C_DID=$C_DID C_ADMIN="$C_REST $C_DID $C_ADMIN_CRED" DEVICE_PIN=1234 E2E_APP_ID=$BID UDID=$E ANDROID_UDID=$E ANDROID_SERIAL=$E APPIUM_PORT=4762 PNM_BIN=$PNM_BIN \
  perl -e 'alarm 1500; exec @ARGV' node run-several-agents.mjs > "$LEG_DIR/second-agent.out" 2>&1
two=$(grep -c '^ROW R1 add + keep PASS' "$LEG_DIR/second-agent.out")
row relaunch-two-agents "$([ "$two" -gt 0 ] && echo PASS || echo FAIL)" "$(grep -E '^ROW R1 add' "$LEG_DIR/second-agent.out" | cut -c1-140)"
# The relaunch: the process ends (as an update, a crash or the system does) and the app starts again.
adb -s $E logcat -c; adb -s $E logcat -v time > "$LEG_DIR/logcat-after-update.log" 2>/dev/null & LC=$!
adb -s $E shell am force-stop $BID; sleep 2
USE_PERSONA=1 C_NAME=$C_NAME PLATFORM=android UDID=$E APPIUM_PORT=4762 C_DID= EXPECT_AGENTS=$([ "$two" -gt 0 ] && echo 2 || echo 1) \
  perl -e 'alarm 600; exec @ARGV' node run-after-update.mjs > "$LEG_DIR/after.out" 2>&1
grep -E '^AFTER-UPDATE' "$LEG_DIR/after.out" | cut -c1-240
take_rows "$LEG_DIR/after.out"
sleep 3; kill "$LC" 2>/dev/null; LC=
n=$(grep -c "not found in backend" "$LEG_DIR/logcat-after-update.log")
fetched=$(grep -cE "fetched .*keys through its agent.*on use" "$LEG_DIR/logcat-after-update.log")
row relaunch-keys-fetched-on-use "$([ "$fetched" -gt 0 ] && echo PASS || echo FAIL)" "$fetched \"fetched … keys through its agent … on use\" line(s) (bifold #336)"
if [ "$n" -eq 0 ]; then row update-no-missing-key PASS "no \"not found in backend\" in logcat after the relaunch ($(wc -l < "$LEG_DIR/logcat-after-update.log" | tr -d ' ') lines)"
else row update-no-missing-key FAIL "$n \"not found in backend\" line(s); first: $(grep -m1 'not found in backend' "$LEG_DIR/logcat-after-update.log" | cut -c1-200)"
  grep -n -B5 -A5 -m3 "not found in backend" "$LEG_DIR/logcat-after-update.log" | cut -c1-260; fi
