#!/bin/bash
# Startup smoke on a GitHub-hosted runner (stage A: no Farm, no secrets). The plain-launch rows of smoke-ios.sh
# and smoke-android.sh exactly as those legs do them, then the welcome slides through Appium (run-welcome.mjs).
# The parts that need a Farm runner (run-vta-link.js, the push probe, run-agent-header.mjs) print SKIP rows.
#
#   LEG_DIR=<dir> smoke-ci.sh ios     <KeyRing.app> <simulator udid> [<device name> <runtime version>]
#   LEG_DIR=<dir> smoke-ci.sh android <apk>         <emulator serial>
#
# Reads nothing private: no GATE_ENV, no runner slug. The build's manifest.txt (next to the app or APK) gives
# the wallet and bifold commits for the HEADS line. Every step's wall-clock goes to $LEG_DIR/steps.tsv
# (name, start epoch, seconds) and to the log as "STEP <name> <seconds>s".
#
# A separate leg rather than a GATE_CI=1 branch in the two smoke legs: those legs begin with gate_env (which
# stops without the private env file) and `need` the Farm values, and their cleanup deletes runner keys. A
# CI run has none of that, and a branch in each would have to skip the first line, the cleanup and half the
# body; the shared rows here are the same lines, with the Farm parts replaced by SKIP rows.
PLATFORM=${1:?ios|android} BUILD=${2:?app or apk path} DEV=${3:?simulator udid or emulator serial}; DEVNAME=${4:-}; DEVVER=${5:-}
: "${LEG_DIR:?LEG_DIR (where screenshots, logs and steps.tsv go)}"; mkdir -p "$LEG_DIR"
# lib.sh points ANDROID_HOME at the Mac's SDK; on a Linux runner the emulator action has set it already.
_ah=${ANDROID_HOME:-}; _asr=${ANDROID_SDK_ROOT:-}; _path=$PATH
. "$(dirname "$0")/../lib.sh"
[ -z "$_ah" ] || export ANDROID_HOME=$_ah; [ -z "$_asr" ] || export ANDROID_SDK_ROOT=$_asr; export PATH=$_path:$PATH
export E2E_RUN_DIR=$LEG_DIR
STEPS=$LEG_DIR/steps.tsv
step() { local n=$1 t0=$2 s; s=$(( $(date +%s) - t0 )); printf '%s\t%s\t%s\n' "$n" "$t0" "$s" >> "$STEPS"; echo "STEP $n ${s}s"; }
step_at() { printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$STEPS"; echo "STEP $1 $3s"; }
MANIFEST=$(dirname "$BUILD")/manifest.txt
CAND_WALLET=$(grep '^wallet=' "$MANIFEST" 2>/dev/null | cut -d= -f2); CAND_BIFOLD=$(grep '^bifold=' "$MANIFEST" 2>/dev/null | cut -d= -f2)
export CAND_WALLET CAND_BIFOLD FARM_VERSIONS="none (CI stage A)"
skip() { row "$1" SKIP "no Farm in CI (stage A): $2"; }
# The rows the Farm-dependent drivers would print, as SKIP, so a report shows what stage A does not cover.
farm_rows() {
  local p=$1
  skip "$p-onboarding-home" "run-vta-link.js links a Farm runner"
  skip "agent-intro-centred-$p" "measured on the linked phone (#340)"
  skip "$p-push-off" "run-push-off-probe.mjs needs the linked agent"
  local r; for r in header-corners join-way-in chip-row-fits chip-strip-edges home-sections add-then-back settings-section-rules; do
    skip "$r-$p" "run-agent-header.mjs needs the linked agent"
  done
}
# The welcome driver's own lines (ROW/LEG), folded in; the timing it prints becomes two steps.
welcome() {
  local t0; t0=$(date +%s)
  (cd "$E2E" && perl -e 'alarm 1200; exec @ARGV' node run-welcome.mjs > "$LEG_DIR/$PLATFORM-welcome.out" 2>&1); local rc=$?
  grep -E '^(ROW|LEG)' "$LEG_DIR/$PLATFORM-welcome.out"
  local a s; a=$(grep -oE '^\[welcome\] appium ready [0-9]+' "$LEG_DIR/$PLATFORM-welcome.out" | grep -oE '[0-9]+$'); s=$(grep -oE '^\[welcome\] session ready [0-9]+' "$LEG_DIR/$PLATFORM-welcome.out" | grep -oE '[0-9]+$')
  [ -z "$a" ] || step_at appium-start "$t0" "$a"
  [ -z "$s" ] || step_at appium-session "$((t0 + ${a:-0}))" "$s"
  step welcome-driver "$t0"
  driver_rc "welcome-driver-$PLATFORM" "$rc" "$LEG_DIR/$PLATFORM-welcome.out"
}

case $PLATFORM in
ios)
  APP=$BUILD; SIM=$DEV; NAME=${DEVNAME:-iPhone}
  LEG_HEADS_EXTRA="device=\"$NAME\" runtime=${DEVVER:-?}"
  leg_begin smoke-ci-ios "$(shasum -a 256 "$APP/main.jsbundle" | cut -c1-12)"
  echo "SMOKE iOS (CI) start $(date -u +%T)Z · $(grep -E '^(wallet|bifold)=' "$MANIFEST" | tr '\n' ' ')· bundle $(shasum -a 256 "$APP/main.jsbundle" | cut -c1-12) · GoogleService-Info project $(/usr/libexec/PlistBuddy -c 'Print :PROJECT_ID' "$APP/GoogleService-Info.plist" 2>/dev/null || echo '(no plist in the app)') · sim $NAME $SIM ${DEVVER:-}"
  t=$(date +%s); xcrun simctl boot "$SIM" 2>/dev/null; perl -e 'alarm 180; exec @ARGV' xcrun simctl bootstatus "$SIM" >/dev/null 2>&1; xcrun simctl uninstall "$SIM" $BID 2>/dev/null; step sim-bootstatus "$t"
  t=$(date +%s); L0=$t; xcrun simctl install "$SIM" "$APP"; step install-app "$t"
  t=$(date +%s); P=$(xcrun simctl launch "$SIM" $BID | awk '{print $2}'); echo "plain launch pid $P $(date -u +%T)Z"
  sleep 20; xcrun simctl io "$SIM" screenshot "$LEG_DIR/ios-plain-20s.png" >/dev/null 2>&1; a1=$(ps -p "$P" >/dev/null 2>&1 && echo alive || echo GONE)
  sleep 25; xcrun simctl io "$SIM" screenshot "$LEG_DIR/ios-plain-45s.png" >/dev/null 2>&1; a2=$(ps -p "$P" >/dev/null 2>&1 && echo alive || echo GONE); step plain-launch-45s "$t"
  t=$(date +%s)
  CR=$(find ~/Library/Logs/DiagnosticReports -name 'KeyRing*' -newermt "@$L0" 2>/dev/null | wc -l | tr -d ' ')
  xcrun simctl spawn "$SIM" log show --last 2m --style compact --info --debug --predicate 'process == "KeyRing" AND (eventMessage CONTAINS[c] "firebase" OR eventMessage CONTAINS[c] "FIRApp" OR eventMessage CONTAINS[c] "RemoteNotification" OR eventMessage CONTAINS[c] "aps-environment" OR subsystem BEGINSWITH "com.google.firebase")' 2>/dev/null | grep -v "^Timestamp" | cut -c1-260 > "$LEG_DIR/ios-firebase-log.txt"
  REG=$(grep -cE "didFailToRegisterForRemoteNotifications|didRegisterForRemoteNotifications|aps-environment" "$LEG_DIR/ios-firebase-log.txt"); FCM=$(grep -c "I-FCM" "$LEG_DIR/ios-firebase-log.txt"); TOKN=$(grep -E "FirebaseMessaging|FirebaseInstallations|I-FCM|I-FIS" "$LEG_DIR/ios-firebase-log.txt" | grep -ciE "token|apns|installation")
  NET=$(grep -oE "hostname=[a-z0-9.-]*(firebaseinstallations|fcmtoken|fcm|firebaselogging|app-measurement|firebase)[a-z0-9.-]*" "$LEG_DIR/ios-firebase-log.txt" | sort | uniq -c | tr '\n' ' ')
  echo "ROW ios-no-firebase-installations-or-fcm-host-at-launch $(echo "$NET" | grep -qE "firebaseinstallations|fcmtoken|fcm\." && echo FAIL || echo PASS) — Firebase hosts the app resolved in the first 2 minutes: ${NET:-none}"
  echo "ROW ios-no-fcm-token-activity-at-launch $([ "$TOKN" = 0 ] && echo PASS || echo FAIL) — FirebaseMessaging/FirebaseInstallations lines about a token, APNs or an installation: $TOKN"; grep -E "FirebaseMessaging|FirebaseInstallations|I-FCM|I-FIS" "$LEG_DIR/ios-firebase-log.txt" | grep -iE "token|apns|installation" | cut -c1-200 | head -3
  echo "ROW ios-no-remote-notification-registration-at-launch $([ "$REG" = 0 ] && echo PASS || echo FAIL) — FirebaseMessaging / remote-notification registration lines in the launch log: $REG; other FirebaseMessaging (I-FCM) lines: $FCM (all Firebase lines: $(wc -l < "$LEG_DIR/ios-firebase-log.txt" | tr -d ' '), kept in ios-firebase-log.txt)"; grep -E "didFailToRegisterForRemoteNotifications|aps-environment|I-FCM" "$LEG_DIR/ios-firebase-log.txt" | cut -c1-200 | head -4
  echo "ROW ios-cold-launch-no-crash $([ "$a1" = alive ] && [ "$a2" = alive ] && [ "$CR" = 0 ] && echo PASS || echo FAIL) — process at 20 s $a1, at 45 s $a2, crash reports since launch $CR; firebase log lines $(wc -l < "$LEG_DIR/ios-firebase-log.txt" | tr -d ' ') (screenshots ios-plain-20s.png, ios-plain-45s.png: read by eye for a permission prompt)"
  step log-rows "$t"
  xcrun simctl terminate "$SIM" $BID 2>/dev/null
  # The welcome slides (wallet #339) on the fresh install, before onboarding: link, agent words, icon size.
  export PLATFORM=ios IOS_APP=$APP UDID=$SIM IOS_DEVICE_NAME="$NAME" IOS_PLATFORM_VERSION=${DEVVER:-26.3} APPIUM_PORT=${APPIUM_PORT:-4723} WDA_LOCAL_PORT=${WDA_LOCAL_PORT:-8100} E2E_RELEASE=1
  welcome
  farm_rows ios
  echo "SMOKE iOS (CI) done $(date -u +%T)Z"
  ;;
android)
  APK=$BUILD; E=$DEV
  LEG_HEADS_EXTRA="device=\"${DEVNAME:-$E}\" runtime=${DEVVER:-$(adb -s "$E" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r')}"
  leg_begin smoke-ci-android "$(shasum -a 256 "$APK" | cut -c1-12)"
  echo "SMOKE Android (CI) start $(date -u +%T)Z · $(grep -E '^(wallet|bifold)=' "$MANIFEST" | tr '\n' ' ')· APK $(shasum -a 256 "$APK" | cut -c1-12) · $E $(adb -s "$E" shell getprop ro.product.model 2>/dev/null | tr -d '\r') API $(adb -s "$E" shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r')"
  t=$(date +%s); adb -s "$E" uninstall $BID >/dev/null 2>&1; adb -s "$E" install -r "$APK" 2>&1 | tail -1; step install-app "$t"
  t=$(date +%s); adb -s "$E" logcat -c; adb -s "$E" logcat -v time > "$LEG_DIR/android-logcat-all.txt" 2>/dev/null & LC=$!; adb -s "$E" shell monkey -p $BID -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; echo "plain launch $(date -u +%T)Z"
  sleep 25; adb -s "$E" exec-out screencap -p > "$LEG_DIR/android-plain-25s.png"; p1=$(adb -s "$E" shell pidof $BID | tr -d '\r'); f1=$(adb -s "$E" shell dumpsys window | grep -E "mCurrentFocus" | head -1 | tr -d '\r' | sed 's/^ *//')
  sleep 20; adb -s "$E" exec-out screencap -p > "$LEG_DIR/android-plain-45s.png"; p2=$(adb -s "$E" shell pidof $BID | tr -d '\r'); f2=$(adb -s "$E" shell dumpsys window | grep -E "mCurrentFocus" | head -1 | tr -d '\r' | sed 's/^ *//'); step plain-launch-45s "$t"
  t=$(date +%s)
  FC=$(adb -s "$E" logcat -d | grep -cE "FATAL EXCEPTION|Process: $BID"); adb -s "$E" logcat -d | grep -iE "FirebaseApp|FirebaseInitProvider" | cut -c1-200 | tail -5 > "$LEG_DIR/android-firebase-log.txt"
  echo "ROW android-install-cold-launch $([ -n "$p1" ] && [ "$p1" = "$p2" ] && [ "$FC" = 0 ] && echo PASS || echo FAIL) — pid at 25 s ${p1:-none}, at 45 s ${p2:-none}, fatal lines $FC; focus at 25 s [$f1], at 45 s [$f2]; firebase log lines $(wc -l < "$LEG_DIR/android-firebase-log.txt" | tr -d ' ')"
  case "$f1$f2" in *GrantPermissions*|*permissioncontroller*) echo "ROW android-no-notification-prompt FAIL — a permission dialog had focus";; *) echo "ROW android-no-notification-prompt PASS — no permission dialog had focus at 25 s or 45 s (screenshots android-plain-25s.png, android-plain-45s.png)";; esac
  TOK='firebaseinstallations\.googleapis|fcmtoken\.googleapis|fcm\.googleapis|FirebaseMessaging|FirebaseInstallations|FirebaseInstanceId|FirebaseIid|Firebase-Installations|\bFCM\b|\bGCM\b|\bc2dm\b|registration token'
  # Only the wallet's lines (its pid, or its package named by another process). A fresh AVD, which every CI run
  # is, registers Play Services itself with GCM in these same seconds (GCM-GMS, FirebaseInstanceId, BugleNetwork
  # under Play Services' own pids): 15 such lines on run 38044225803, none from the wallet. The gate's smoke-android.sh
  # counts every line, which holds on its persistent AVD and would fail the same way on a re-created one.
  WALLET='\( *'"${p1:-0}"'\)|'"$BID"
  grep -E "$TOK" "$LEG_DIR/android-logcat-all.txt" | grep -E "$WALLET" | grep -v "GCM.*Unexpected forwarded intent.*PACKAGE_ADDED" | cut -c1-200 > "$LEG_DIR/android-token-lines-plain.txt"; P1=$(grep -c . "$LEG_DIR/android-token-lines-plain.txt")
  echo "ROW android-no-token-activity-plain-launch $([ "$P1" = 0 ] && echo PASS || echo FAIL) — FirebaseMessaging / FirebaseInstallations / token lines from the wallet process (pid ${p1:-none} or $BID) in logcat during the plain launch (45 s): $P1 (android-token-lines-plain.txt; Play Services' own GMS registration on the fresh AVD is not counted)"; head -3 "$LEG_DIR/android-token-lines-plain.txt"
  step log-rows "$t"
  adb -s "$E" shell am force-stop $BID
  # The welcome slides on the fresh install (the same driver as iOS; its icon row is iOS-only and says so).
  export PLATFORM=android APPIUM_PORT=${APPIUM_PORT:-4723} ANDROID_APK=$APK ANDROID_UDID=$E ANDROID_SERIAL=$E UDID=$E E2E_RELEASE=1
  welcome
  farm_rows android
  skip android-no-token-activity-through-onboarding "counted through onboarding and the probe"
  sleep 2; kill $LC 2>/dev/null
  echo "SMOKE Android (CI) done $(date -u +%T)Z"
  ;;
*) echo "LEG smoke-ci BROKEN — platform $PLATFORM is not ios or android"; exit 1 ;;
esac
