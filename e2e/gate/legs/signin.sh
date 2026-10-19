#!/bin/bash
# Member sign-in (auth/oob), end to end: a fresh Keyring, linked to the main runner, joins a community by its review way
# (the harness admin approves), then signs in to that community's member website: the driver plays the portal
# (e2e/openvtc/signinPortal.js), the phone claims its code, types the two digits, and approves with a fingerprint
# (e2e/run-signin-member.mjs). The community defaults to keyring-hv-lab1 (HV_C_*): keyring-test's VTC predates member
# sign-in (no SignInPortal service, no /v1/member/sign-in/config). SIGNIN_C_* and SIGNIN_PORTAL point it elsewhere.
# The phone boots its own AVD (Signin_API_33: device PIN 1234 and fingerprint 1 enrolled, ~/.keyring-fleet/gate/AVDS.md).
# On the emulator every owner/UV prompt is answered with the device PIN (SIGNIN_UV=pin, the default): its fingerprint HAL
# gives a token keystore calls expired 1 ms after it is added (runs 1019-1416 and 1019-1459), while the PIN passes the
# same 5 s auth-validity key. SIGNIN_UV=finger keeps the sensor path, for a fingerprint that works; a real phone still
# has to prove it.
. "$(dirname "$0")/../lib.sh"; gate_env
SIGNIN_ROWS="signin-member-joined signin-claimed signin-version signin-approved signin-phone-done"
APK=$APK_OFF
leg_begin signin "$(shasum -a 256 "$APK" | cut -c1-12)" "$APK"
SIGNIN_C_DID=${SIGNIN_C_DID:-${HV_C_DID:-}}; SIGNIN_C_REST=${SIGNIN_C_REST:-${HV_C_REST:-}}; SIGNIN_C_ADMIN_CRED=${SIGNIN_C_ADMIN_CRED:-${HV_C_ADMIN_CRED:-}}
SIGNIN_PORTAL=${SIGNIN_PORTAL:-${SIGNIN_C_REST:+$(node -e 'console.log(new URL(process.argv[1]).origin + "/members/")' "$SIGNIN_C_REST")}}
if [ -z "$SIGNIN_C_DID" ] || [ -z "$SIGNIN_C_REST" ] || [ -z "$SIGNIN_C_ADMIN_CRED" ]; then
  for r in $SIGNIN_ROWS; do row "$r" SKIP "no sign-in community configured (SIGNIN_C_* or HV_C_*)"; done
  exit 0
fi
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN
T0=$(stamp); E=emulator-5574
BW=
fin() {
  [ -n "$BW" ] && kill "$BW" 2>/dev/null
  # The app's log on every exit, a broken link included (its biometric errors are only there).
  adb -s $E logcat -d > "$LEG_DIR/logcat-all.log" 2>/dev/null; adb -s $E shell dumpsys fingerprint > "$LEG_DIR/fingerprint.txt" 2>/dev/null
  adb -s $E uninstall $BID >/dev/null 2>&1; emu_stop
  echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"; gate_sweep_runner "$RUNNER_MAIN_SLUG"
}
LEG_CLEANUP=fin
AVD=${SIGNIN_AVD:-Signin_API_33}
emu_start 5574; adb -s $E uninstall $BID >/dev/null 2>&1
# This AVD has a device PIN (the fingerprint needs one), so it boots to a locked keyguard, behind which Appium's
# settings helper never starts ("Appium Settings app is not running", first run 1019-1350). Unlock with the PIN and keep
# the screen on for the leg, so it cannot relock mid-run.
adb -s $E shell svc power stayon true >/dev/null 2>&1; adb -s $E shell settings put system screen_off_timeout 1800000 >/dev/null 2>&1
adb -s $E shell input keyevent 224 >/dev/null 2>&1; sleep 1; adb -s $E shell wm dismiss-keyguard >/dev/null 2>&1; sleep 2
adb -s $E shell input text 1234 >/dev/null 2>&1; adb -s $E shell input keyevent 66 >/dev/null 2>&1; sleep 3
adb -s $E shell dumpsys window 2>/dev/null | grep -qE 'mDreamingLockscreen=true|isKeyguardShowing=true|mShowingLockscreen=true' && broken "the $AVD keyguard is still locked after the PIN"
adb -s $E logcat -G 16M >/dev/null 2>&1
# With a secure lock, Keyring's keystore asks for biometrics wherever it reads a secret ("Authenticate to retrieve
# secret", second run 1019-1354: the link's agent creation stopped on it), not only at a sign-in's Approve. A person
# touches the sensor each time; this answers every system biometric prompt for the whole leg with fingerprint 1, and
# logs each touch (biometric.log). The sign-in's own proof of a biometric approval is the redeem's amr ("uv").
( while :; do
    if adb -s $E shell dumpsys window windows 2>/dev/null | grep -qE 'BiometricPrompt|AuthContainer|biometric_scrollview'; then
      # The prompt's window exists before it has animated in, and a touch then is dropped: "Keyring couldn't confirm
      # it's you" (fourth run 1019-1407, touched 1 s after the window showed). Wait it in, touch, then lift.
      sleep 2.5
      # Which prompt is this? A screenshot of each (prompt-<time>.png) and its words: the owner confirm offers "Use PIN"
      # (ownerConfirm.ts, biometry or passcode); the UV key's is biometric-only (uvKey.ts) and offers none (a5, 10-19).
      ts=$(date -u +%H%M%S); adb -s $E exec-out screencap -p > "$LEG_DIR/prompt-$ts.png" 2>/dev/null
      adb -s $E shell uiautomator dump /sdcard/uv.xml >/dev/null 2>&1; x=$(adb -s $E shell cat /sdcard/uv.xml 2>/dev/null)
      title=$(echo "$x" | grep -oE 'resource-id="com.android.systemui:id/title"[^>]*' | grep -oE 'text="[^"]*"' | head -1)
      [ -n "$title" ] || title=$(echo "$x" | grep -oE 'text="[^"]{3,60}"' | head -1)
      b=$(echo "$x" | grep -oE 'resource-id="com.android.systemui:id/button_use_credential"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | tr '[],' '   ')
      if [ -z "$x" ]; then kind="unread (dump failed)"; elif [ -n "$b" ]; then kind="offers Use PIN"; else kind="biometric only (no Use PIN)"; fi
      if [ "${SIGNIN_UV:-pin}" = pin ] && [ "$kind" != "biometric only (no Use PIN)" ]; then
        # The device PIN through "Use PIN" (its place on this AVD when the screen could not be read: [32,2179][263,2305]).
        set -- $b; if [ $# -eq 4 ]; then adb -s $E shell input tap $(( ($1+$3)/2 )) $(( ($2+$4)/2 )) >/dev/null 2>&1; else adb -s $E shell input tap 147 2242 >/dev/null 2>&1; fi; sleep 2
        adb -s $E shell input text 1234 >/dev/null 2>&1; adb -s $E shell input keyevent 66 >/dev/null 2>&1
        echo "PROMPT $(date -u +%H:%M:%SZ) ${title:-?} · $kind · answered with the device PIN · prompt-$ts.png"; sleep 3
      else
        adb -s $E emu finger touch 1 >/dev/null 2>&1; sleep 1; adb -s $E emu finger remove 1 >/dev/null 2>&1
        echo "PROMPT $(date -u +%H:%M:%SZ) ${title:-?} · $kind · answered with fingerprint 1 · prompt-$ts.png"; sleep 3
      fi
    fi
    sleep 1
  done ) >> "$LEG_DIR/biometric.log" 2>&1 & BW=$!
cd "$E2E"
E2E_APP_ID=$BID PLATFORM=android ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E APPIUM_PORT=4764 ENROL_PORT=8199 E2E_RELEASE=1 \
  LINK_MODE=manual RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN=$PNM_BIN E2E_KEEP_APP=1 \
  galarm 1800 node run-vta-link.js > "$LEG_DIR/link.out" 2>&1 || broken "link: $(grep -E '✅|❌' "$LEG_DIR/link.out" | tail -1 | cut -c1-120)"
row signin-link PASS "linked to $RUNNER_MAIN_SLUG"
E2E_APP_ID=$BID UDID=$E APPIUM_PORT=4764 SIGNIN_UV=${SIGNIN_UV:-pin} SIGNIN_C_DID=$SIGNIN_C_DID SIGNIN_C_REST=$SIGNIN_C_REST SIGNIN_C_ADMIN_CRED=$SIGNIN_C_ADMIN_CRED SIGNIN_PORTAL=$SIGNIN_PORTAL \
  galarm 1200 node run-signin-member.mjs > "$LEG_DIR/signin.out" 2>&1; rc=$?
adb -s $E logcat -d > "$LEG_DIR/signin-logcat.log" 2>/dev/null
take_rows "$LEG_DIR/signin.out"
[ $rc -eq 0 ] || row signin-driver FAIL "rc=$rc $(grep -E 'BROKEN|❌' "$LEG_DIR/signin.out" | tail -1 | cut -c1-160)"
