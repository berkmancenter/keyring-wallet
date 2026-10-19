#!/bin/bash
# Member sign-in (auth/oob), end to end, on an iOS simulator with Face ID enrolled: the same driver as `signin`
# (e2e/run-signin-member.mjs; the portal half is e2e/openvtc/signinPortal.js). It runs on iOS because the Android
# emulator's software keystore refuses a biometric-gated keychain secret after a successful fingerprint
# (UserNotAuthenticatedException, Signin_API_33, 10-19), while the iOS simulator's keychain honours biometry.
# The simulator is its own (SIGNIN_SIM_UDID, "iPhone 17 Signin": Face ID enrolled with simctl notifyutil); Face ID is
# answered by posting a match for the whole leg (biometric.log), and the proof of a biometric approval is the portal's
# redeem ("uv" in amr). The community defaults to keyring-hv-lab1 (HV_C_*), as in `signin`.
. "$(dirname "$0")/../lib.sh"; gate_env
SIGNIN_ROWS="signin-member-joined signin-claimed signin-version signin-approved signin-phone-done"
leg_begin signin-ios "$(shasum -a 256 "$CAND_APP/main.jsbundle" | cut -c1-12)" "$CAND_APP"
SIGNIN_C_DID=${SIGNIN_C_DID:-${HV_C_DID:-}}; SIGNIN_C_REST=${SIGNIN_C_REST:-${HV_C_REST:-}}; SIGNIN_C_ADMIN_CRED=${SIGNIN_C_ADMIN_CRED:-${HV_C_ADMIN_CRED:-}}
SIGNIN_PORTAL=${SIGNIN_PORTAL:-${SIGNIN_C_REST:+$(node -e 'console.log(new URL(process.argv[1]).origin + "/members/")' "$SIGNIN_C_REST")}}
if [ -z "$SIGNIN_C_DID" ] || [ -z "$SIGNIN_C_REST" ] || [ -z "$SIGNIN_C_ADMIN_CRED" ] || [ -z "${SIGNIN_SIM_UDID:-}" ]; then
  for r in $SIGNIN_ROWS; do row "$r" SKIP "no sign-in community or simulator configured (SIGNIN_C_* or HV_C_*, SIGNIN_SIM_UDID)"; done
  exit 0
fi
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN IOS_VERSION
T0=$(stamp); T0S=$(date +%s); U=$SIGNIN_SIM_UDID; NAME=${SIGNIN_SIM_NAME:-iPhone 17 Signin}; FW=
fin() {
  [ -n "$FW" ] && kill "$FW" 2>/dev/null
  ios_log_save "$U" "$LEG_DIR/ios.log" "$T0S"
  xcrun simctl uninstall "$U" "$BID" 2>/dev/null; sim_down "$U"
  echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"; gate_sweep_runner "$RUNNER_MAIN_SLUG"
}
LEG_CLEANUP=fin
sim_boot "$U"; xcrun simctl uninstall "$U" "$BID" 2>/dev/null
xcrun simctl spawn "$U" notifyutil -s com.apple.BiometricKit.enrollmentChanged 1 >/dev/null 2>&1
xcrun simctl spawn "$U" notifyutil -p com.apple.BiometricKit.enrollmentChanged >/dev/null 2>&1
( while :; do xcrun simctl spawn "$U" notifyutil -p com.apple.BiometricKit_Sim.pearl.match >/dev/null 2>&1 && echo "FACEID match $(date -u +%H:%M:%SZ)"; sleep 3; done ) >> "$LEG_DIR/biometric.log" 2>&1 & FW=$!
cd "$E2E"
E2E_APP_ID=$BID PLATFORM=ios IOS_APP=$CAND_APP UDID=$U IOS_DEVICE_NAME="$NAME" IOS_PLATFORM_VERSION=$IOS_VERSION APPIUM_PORT=4775 ENROL_PORT=8189 E2E_RELEASE=1 \
  LINK_MODE=manual RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN=$PNM_BIN E2E_KEEP_APP=1 \
  galarm 1800 node run-vta-link.js > "$LEG_DIR/link.out" 2>&1 || broken "link: $(grep -E '✅|❌' "$LEG_DIR/link.out" | tail -1 | cut -c1-120)"
row signin-link PASS "linked to $RUNNER_MAIN_SLUG"
E2E_APP_ID=$BID PLATFORM=ios UDID=$U IOS_DEVICE_NAME="$NAME" IOS_PLATFORM_VERSION=$IOS_VERSION APPIUM_PORT=4775 \
  SIGNIN_C_DID=$SIGNIN_C_DID SIGNIN_C_REST=$SIGNIN_C_REST SIGNIN_C_ADMIN_CRED=$SIGNIN_C_ADMIN_CRED SIGNIN_PORTAL=$SIGNIN_PORTAL \
  galarm 1200 node run-signin-member.mjs > "$LEG_DIR/signin.out" 2>&1; rc=$?
take_rows "$LEG_DIR/signin.out"
[ $rc -eq 0 ] || row signin-driver FAIL "rc=$rc $(grep -E 'BROKEN|❌' "$LEG_DIR/signin.out" | tail -1 | cut -c1-160)"
