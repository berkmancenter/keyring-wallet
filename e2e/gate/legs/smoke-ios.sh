#!/bin/bash
# Startup smoke, iOS, on the push-off build (the testers' configuration): a fresh install launched with no Appium
# attached (crash, permission prompt, Firebase/FCM traffic), then onboarding and a link to the main runner, then
# the push-off probe. Ported from the 290 built-app check.
. "$(dirname "$0")/../lib.sh"; gate_env
need RUNNER_MAIN_SLUG RUNNER_MAIN_DID RUNNER_MAIN_URL PNM_BIN SMOKE_SIM_UDID SMOKE_SIM_NAME IOS_VERSION
APP=$CAND_APP; APK=$APK_OFF
leg_begin smoke-ios "$(shasum -a 256 "$APP/main.jsbundle" | cut -c1-12)"
T0=$(stamp)
fin() { echo "== cleanup $(utc)"; keys_since "$RUNNER_MAIN_SLUG" "$T0"; }
LEG_CLEANUP=fin
export RUNNER_VTA=$RUNNER_MAIN_SLUG RUNNER_VTA_DID=$RUNNER_MAIN_DID RUNNER_VTA_URL=$RUNNER_MAIN_URL PNM_BIN E2E_RELEASE=1 LINK_MODE=manual
SIM=$SMOKE_SIM_UDID; NAME=$SMOKE_SIM_NAME
wda_stop(){ local p; for p in $(ps -axo pid,command | grep -E "xcodebuild.*WebDriverAgent" | grep "$SIM" | grep -v grep | awk '{print $1}'); do kill $p; done; }
echo "SMOKE iOS start $(date -u +%T)Z · $(grep -E '^(wallet|bifold)=' $(dirname $APP)/manifest.txt | tr '\n' ' ')· bundle $(shasum -a 256 $APP/main.jsbundle | cut -c1-12) · GoogleService-Info project $(/usr/libexec/PlistBuddy -c 'Print :PROJECT_ID' $APP/GoogleService-Info.plist 2>/dev/null || echo '(no plist in the app)') · sim $NAME $SIM"
xcrun simctl boot $SIM 2>/dev/null; perl -e 'alarm 180; exec @ARGV' xcrun simctl bootstatus $SIM >/dev/null 2>&1; xcrun simctl uninstall $SIM $BID 2>/dev/null
L0=$(date +%s); xcrun simctl install $SIM $APP && P=$(xcrun simctl launch $SIM $BID | awk '{print $2}'); echo "plain launch pid $P $(date -u +%T)Z"
sleep 20; xcrun simctl io $SIM screenshot $LEG_DIR/ios-plain-20s.png >/dev/null 2>&1; a1=$(ps -p $P >/dev/null 2>&1 && echo alive || echo GONE)
sleep 25; xcrun simctl io $SIM screenshot $LEG_DIR/ios-plain-45s.png >/dev/null 2>&1; a2=$(ps -p $P >/dev/null 2>&1 && echo alive || echo GONE)
CR=$(find ~/Library/Logs/DiagnosticReports -name 'KeyRing*' -newermt "@$L0" 2>/dev/null | wc -l | tr -d ' ')
xcrun simctl spawn $SIM log show --last 2m --style compact --info --debug --predicate 'process == "KeyRing" AND (eventMessage CONTAINS[c] "firebase" OR eventMessage CONTAINS[c] "FIRApp" OR eventMessage CONTAINS[c] "RemoteNotification" OR eventMessage CONTAINS[c] "aps-environment" OR subsystem BEGINSWITH "com.google.firebase")' 2>/dev/null | grep -v "^Timestamp" | cut -c1-260 > $LEG_DIR/ios-firebase-log.txt
REG=$(grep -cE "didFailToRegisterForRemoteNotifications|didRegisterForRemoteNotifications|aps-environment" $LEG_DIR/ios-firebase-log.txt); FCM=$(grep -c "I-FCM" $LEG_DIR/ios-firebase-log.txt); TOKN=$(grep -E "FirebaseMessaging|FirebaseInstallations|I-FCM|I-FIS" $LEG_DIR/ios-firebase-log.txt | grep -ciE "token|apns|installation")
NET=$(grep -oE "hostname=[a-z0-9.-]*(firebaseinstallations|fcmtoken|fcm|firebaselogging|app-measurement|firebase)[a-z0-9.-]*" $LEG_DIR/ios-firebase-log.txt | sort | uniq -c | tr '\n' ' ')
echo "ROW ios-no-firebase-installations-or-fcm-host-at-launch $(echo "$NET" | grep -qE "firebaseinstallations|fcmtoken|fcm\." && echo FAIL || echo PASS) — Firebase hosts the app resolved in the first 2 minutes: ${NET:-none}"
echo "ROW ios-no-fcm-token-activity-at-launch $([ $TOKN = 0 ] && echo PASS || echo FAIL) — FirebaseMessaging/FirebaseInstallations lines about a token, APNs or an installation: $TOKN"; grep -E "FirebaseMessaging|FirebaseInstallations|I-FCM|I-FIS" $LEG_DIR/ios-firebase-log.txt | grep -iE "token|apns|installation" | cut -c1-200 | head -3
echo "ROW ios-no-remote-notification-registration-at-launch $([ $REG = 0 ] && echo PASS || echo FAIL) — FirebaseMessaging / remote-notification registration lines in the launch log: $REG; other FirebaseMessaging (I-FCM) lines: $FCM (all Firebase lines: $(wc -l < $LEG_DIR/ios-firebase-log.txt | tr -d ' '), kept in ios-firebase-log.txt)"; grep -E "didFailToRegisterForRemoteNotifications|aps-environment|I-FCM" $LEG_DIR/ios-firebase-log.txt | cut -c1-200 | head -4
echo "ROW ios-cold-launch-no-crash $([ $a1 = alive ] && [ $a2 = alive ] && [ $CR = 0 ] && echo PASS || echo FAIL) — process at 20 s $a1, at 45 s $a2, crash reports since launch $CR; firebase log lines $(wc -l < $LEG_DIR/ios-firebase-log.txt | tr -d ' ') (screenshots ios-plain-20s.png, ios-plain-45s.png: read by eye for a permission prompt)"
xcrun simctl terminate $SIM $BID 2>/dev/null
( export PLATFORM=ios IOS_APP=$APP UDID=$SIM IOS_DEVICE_NAME="$NAME" IOS_PLATFORM_VERSION=$IOS_VERSION APPIUM_PORT=4768 WDA_LOCAL_PORT=8167 MJPEG_PORT=9167 ENROL_PORT=8198
# The welcome slides (wallet #339) on the fresh install, before onboarding: link, agent words, icon size.
(cd $E2E; perl -e 'alarm 300; exec @ARGV' node run-welcome.mjs > $LEG_DIR/ios-welcome.out 2>&1; grep -E '^(ROW|LEG)' $LEG_DIR/ios-welcome.out)
cd $E2E; t=$(date +%s); E2E_KEEP_APP=1 perl -e 'alarm 1500; exec @ARGV' node run-vta-link.js > $LEG_DIR/ios-link.out 2>&1; rc=$?
echo "ROW ios-onboarding-home $([ $rc -eq 0 ] && echo PASS || echo FAIL) — link run rc=$rc $(( $(date +%s)-t ))s $(grep -E '✅|❌' $LEG_DIR/ios-link.out | tail -1 | cut -c1-110); push steps in the transcript: $(grep -c 'PushNotificationContinue' $LEG_DIR/ios-link.out)"
ic=$(grep -m1 '^INTRO-CENTRE' $LEG_DIR/ios-link.out); [ -z "$ic" ] || echo "ROW agent-intro-centred-ios $(case $ic in "INTRO-CENTRE ok"*) echo PASS ;; *) echo FAIL ;; esac) — above/below: ${ic#INTRO-CENTRE } (#340)"
[ $rc -eq 0 ] && { cd $E2E; EXPECT=${PROBE_EXPECT:-off} perl -e 'alarm 600; exec @ARGV' node run-push-off-probe.mjs > $LEG_DIR/ios-push-off.out 2>&1; prc=$?; echo "ROW ios-push-${PROBE_EXPECT:-off} $([ $prc -eq 0 ] && echo PASS || echo FAIL) — $(grep -E "^PUSH_O" $LEG_DIR/ios-push-off.out | cut -c1-140)"; } )
# Your agent's header, Join menu and chips (#329/#330/#331), measured on the linked phone.
(cd $E2E && PLATFORM=ios UDID=$SIM IOS_DEVICE_NAME="$NAME" IOS_PLATFORM_VERSION=$IOS_VERSION APPIUM_PORT=4768 WDA_LOCAL_PORT=8167 MJPEG_PORT=9167 \
  perl -e 'alarm 600; exec @ARGV' node run-agent-header.mjs > $LEG_DIR/ios-header.out 2>&1; grep -E '^(ROW|LEG)' $LEG_DIR/ios-header.out)
wda_stop; xcrun simctl shutdown $SIM 2>/dev/null; echo "SMOKE iOS done $(date -u +%T)Z";
