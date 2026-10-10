#!/bin/bash
# Startup smoke, Android, on the push-off build (the testers' configuration): a fresh install launched with no Appium
# attached (crash, permission prompt, Firebase/FCM traffic), then onboarding and a link to the main runner, then
# the push-off probe. Ported from the 290 built-app check.
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN
APP=$CAND_APP; APK=$APK_OFF
leg_begin smoke-android "$(shasum -a 256 "$APK" | cut -c1-12)" "$APK"
T0=$(stamp)
fin() { echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"; }
LEG_CLEANUP=fin
export RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN E2E_RELEASE=1 LINK_MODE=manual
E=emulator-5570
echo "SMOKE Android start $(date -u +%T)Z · $(grep -E '^(wallet|bifold)=' $(dirname $APK)/manifest.txt | tr '\n' ' ')· APK $(shasum -a 256 $APK | cut -c1-12) · $E $AVD"
emu_start 5570
adb -s $E uninstall $BID >/dev/null 2>&1; adb -s $E install -r "$APK" 2>&1 | tail -1
adb -s $E logcat -c; adb -s $E logcat -v time > $LEG_DIR/android-logcat-all.txt 2>/dev/null & LC=$!; adb -s $E shell monkey -p $BID -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; echo "plain launch $(date -u +%T)Z"
sleep 25; adb -s $E exec-out screencap -p > $LEG_DIR/android-plain-25s.png; p1=$(adb -s $E shell pidof $BID | tr -d '\r'); f1=$(adb -s $E shell dumpsys window | grep -E "mCurrentFocus" | head -1 | tr -d '\r' | sed 's/^ *//')
sleep 20; adb -s $E exec-out screencap -p > $LEG_DIR/android-plain-45s.png; p2=$(adb -s $E shell pidof $BID | tr -d '\r'); f2=$(adb -s $E shell dumpsys window | grep -E "mCurrentFocus" | head -1 | tr -d '\r' | sed 's/^ *//')
FC=$(adb -s $E logcat -d | grep -cE "FATAL EXCEPTION|Process: $BID"); adb -s $E logcat -d | grep -iE "FirebaseApp|FirebaseInitProvider" | cut -c1-200 | tail -5 > $LEG_DIR/android-firebase-log.txt
echo "ROW android-install-cold-launch $([ -n "$p1" ] && [ "$p1" = "$p2" ] && [ $FC = 0 ] && echo PASS || echo FAIL) — pid at 25 s ${p1:-none}, at 45 s ${p2:-none}, fatal lines $FC; focus at 25 s [$f1], at 45 s [$f2]; firebase log lines $(wc -l < $LEG_DIR/android-firebase-log.txt | tr -d ' ')"
case "$f1$f2" in *GrantPermissions*|*permissioncontroller*) echo "ROW android-no-notification-prompt FAIL — a permission dialog had focus";; *) echo "ROW android-no-notification-prompt PASS — no permission dialog had focus at 25 s or 45 s (screenshots android-plain-25s.png, android-plain-45s.png)";; esac
TOK='firebaseinstallations\.googleapis|fcmtoken\.googleapis|fcm\.googleapis|FirebaseMessaging|FirebaseInstallations|FirebaseInstanceId|FirebaseIid|Firebase-Installations|\bFCM\b|\bGCM\b|\bc2dm\b|registration token'
grep -E "$TOK" $LEG_DIR/android-logcat-all.txt | grep -v "GCM.*Unexpected forwarded intent.*PACKAGE_ADDED" | cut -c1-200 > $LEG_DIR/android-token-lines-plain.txt; P1=$(grep -c . $LEG_DIR/android-token-lines-plain.txt)
echo "ROW android-no-token-activity-plain-launch $([ $P1 = 0 ] && echo PASS || echo FAIL) — FirebaseMessaging / FirebaseInstallations / token lines in logcat during the plain launch (45 s): $P1 (android-token-lines-plain.txt)"; head -3 $LEG_DIR/android-token-lines-plain.txt
adb -s $E shell am force-stop $BID
( export PLATFORM=android APPIUM_PORT=4760 ENROL_PORT=8196 ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E ANDROID_AVD=$AVD UDID=$E
cd $E2E; t=$(date +%s); E2E_KEEP_APP=1 perl -e 'alarm 1800; exec @ARGV' node run-vta-link.js > $LEG_DIR/android-link.out 2>&1; rc=$?
echo "ROW android-onboarding-home $([ $rc -eq 0 ] && echo PASS || echo FAIL) — link run rc=$rc $(( $(date +%s)-t ))s $(grep -E '✅|❌' $LEG_DIR/android-link.out | tail -1 | cut -c1-110); push steps in the transcript: $(grep -c 'PushNotificationContinue' $LEG_DIR/android-link.out)"
ic=$(grep -m1 '^INTRO-CENTRE' $LEG_DIR/android-link.out); if [ -n "$ic" ]; then st=FAIL; [[ $ic == "INTRO-CENTRE ok"* ]] && st=PASS; echo "ROW agent-intro-centred-android $st — above/below: ${ic#INTRO-CENTRE } (#340)"; fi
# The probe's own row, android-push-<expect> (run-push-off-probe.mjs); a probe that stopped early is a FAIL row of its own.
[ $rc -eq 0 ] && { cd $E2E; EXPECT=${PROBE_EXPECT:-off} perl -e 'alarm 600; exec @ARGV' node run-push-off-probe.mjs > $LEG_DIR/android-push-off.out 2>&1; prc=$?; take_rows $LEG_DIR/android-push-off.out; driver_rc android-push-driver "$prc" $LEG_DIR/android-push-off.out; } )
(cd $E2E && PLATFORM=android UDID=$E APPIUM_PORT=4760 perl -e 'alarm 600; exec @ARGV' node run-agent-header.mjs > $LEG_DIR/android-header.out 2>&1; hrc=$?; take_rows $LEG_DIR/android-header.out; driver_rc android-header-driver "$hrc" $LEG_DIR/android-header.out)
sleep 2; kill $LC 2>/dev/null; grep -E "$TOK" $LEG_DIR/android-logcat-all.txt | grep -v "GCM.*Unexpected forwarded intent.*PACKAGE_ADDED" | cut -c1-200 > $LEG_DIR/android-token-lines-all.txt; P2=$(grep -c . $LEG_DIR/android-token-lines-all.txt)
echo "ROW android-no-token-activity-through-onboarding $([ $P2 = 0 ] && echo PASS || echo FAIL) — the same lines through the plain launch, onboarding and the probe: $P2 of $(wc -l < $LEG_DIR/android-logcat-all.txt | tr -d ' ') logcat lines (android-token-lines-all.txt)"; grep -vE "$BID|^$" $LEG_DIR/android-token-lines-all.txt | head -0; sed -n '1,4p' $LEG_DIR/android-token-lines-all.txt
emu_stop; echo "SMOKE Android done $(date -u +%T)Z";
