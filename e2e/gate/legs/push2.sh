#!/bin/bash
# Push off, then on, with two agents (wallet #330, one confirmed wake handle per agent): a fresh Android phone on
# the push-on build links to the main runner declining notifications at onboarding (PUSH_STEP=notnow), adds a
# second agent (B), then turns push on in Settings. Each agent must then hold exactly one device record for this
# phone, and it must be push-capable. (That a request on B wakes the phone needs a real push delivery: not here.)
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL RUNNER_MAIN_NAME RUNNER_B_SLUG RUNNER_B_DID RUNNER_B_NAME PNM_BIN
APK=${APK_ON:-}; [ -f "$APK" ] || broken "no push-on build for this candidate"
leg_begin push2 "$(shasum -a 256 "$APK" | cut -c1-12)"
T0=$(stamp); E=emulator-5572
fin() { adb -s $E shell locksettings clear --old 1234 >/dev/null 2>&1; adb -s $E uninstall $BID >/dev/null 2>&1; emu_stop
  echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"; keys_since "$RUNNER_B_SLUG" "$T0"; }
LEG_CLEANUP=fin
# This phone's device records on a runner, registered since T0: "<count> <pushCapable values>".
devices() { pnm "$1" device list --json | python3 -c "
import sys,json; t=sys.stdin.read(); d=json.loads(t[t.index('{'):]) if '{' in t else {}
rows=[r for r in (d.get('devices') or []) if str(r.get('registeredAt',''))>='$T0' and r.get('platform')=='android']
print(len(rows), ','.join(str(r.get('pushCapable')).lower() for r in rows) or '-')"; }
emu_start 5572
for pkg in $BID $BID.pushtest; do adb -s $E uninstall "$pkg" >/dev/null 2>&1; done
cd "$E2E"
PUSH_STEP=notnow E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4762 ENROL_PORT=8197 \
  E2E_RELEASE=1 LINK_MODE=manual RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN=$PNM_BIN E2E_KEEP_APP=1 \
  perl -e 'alarm 1800; exec @ARGV' node run-vta-link.js > "$LEG_DIR/link.out" 2>&1 || broken "link: $(grep -E '✅|❌' "$LEG_DIR/link.out" | tail -1 | cut -c1-120)"
grep -q 'tapped PushNotificationNotNow' "$LEG_DIR/link.out" && row push2-declined-at-onboarding PASS "Not now at onboarding" || row push2-declined-at-onboarding FAIL "no notifications step declined in the link run"
adb -s $E shell locksettings set-pin 1234 >/dev/null 2>&1; sleep 8
ROWS="R1" A_SLUG=$RUNNER_MAIN_SLUG A_DID=$RUNNER_MAIN_DID A_NAME=$RUNNER_MAIN_NAME B_SLUG=$RUNNER_B_SLUG B_DID=$RUNNER_B_DID B_NAME=$RUNNER_B_NAME \
  C_DID=${C_DID:-} C_ADMIN="${C_REST:-} ${C_DID:-} ${C_ADMIN_CRED:-}" DEVICE_PIN=1234 E2E_APP_ID=$BID UDID=$E ANDROID_UDID=$E ANDROID_SERIAL=$E APPIUM_PORT=4762 \
  PNM_BIN=$PNM_BIN perl -e 'alarm 1500; exec @ARGV' node run-several-agents.mjs > "$LEG_DIR/second-agent.out" 2>&1
grep -q '^ROW R1 add + keep PASS' "$LEG_DIR/second-agent.out" || broken "the second agent was not added: $(grep -E '^ROW R1' "$LEG_DIR/second-agent.out" | head -1 | cut -c1-120)"
a0=$(devices "$RUNNER_MAIN_SLUG"); sleep 5; b0=$(devices "$RUNNER_B_SLUG")
echo "before: A $a0 · B $b0"
PLATFORM=android UDID=$E APPIUM_PORT=4762 DEVICE_PIN=1234 perl -e 'alarm 600; exec @ARGV' node run-push-switch-on.mjs > "$LEG_DIR/switch-on.out" 2>&1
grep -E '^PUSH300|^\[e2e\] [0-9]' "$LEG_DIR/switch-on.out" | cut -c1-160
ok=0; for i in 1 2 3 4 5 6; do sleep 15; a1=$(devices "$RUNNER_MAIN_SLUG"); sleep 3; b1=$(devices "$RUNNER_B_SLUG")
  [ "$a1" = "1 true" ] && [ "$b1" = "1 true" ] && { ok=1; break; }; done
echo "after: A $a1 · B $b1"
row push2-off-before "$([ "${a0#* }" != true ] && [ "${b0#* }" != true ] && echo PASS || echo FAIL)" "before the switch: A $a0 · B $b0 (count, pushCapable)"
row push2-on-both-agents "$([ $ok = 1 ] && echo PASS || echo FAIL)" "after the switch: A $a1 · B $b1 (want \"1 true\" on each: one confirmed handle per agent)"
row push2-wake-on-b SKIP "a request on B waking the phone needs a real push delivery check, not this leg"
