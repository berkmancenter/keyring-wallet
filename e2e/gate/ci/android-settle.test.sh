#!/bin/bash
# bash e2e/gate/ci/android-settle.test.sh: settling ends within its limit even when an ANR dialog never goes away
# (gate-ci run 38501730502 looped 87 min), says "ANR still up", and reports ready on a clean emulator. A hung launcher
# is restarted, not waited out (runs 40982883110 and 40990403361); System UI's and the wallet's dialogs are never
# force-stopped; Wait is tapped from the hierarchy dump; "ready" needs the launcher to answer a HOME start.
set -u
here=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; fails=0
ok() { echo "ok   $*"; }; bad() { echo "FAIL $*"; fails=$((fails + 1)); }
cat > "$T/adb" <<'SH'
#!/bin/bash
# A fake adb: -s <serial> shell <cmd…>, every command appended to $FAKE_DIR/log. $FAKE_DIR/anr names the package
# whose ANR window has the focus (empty: none). FAKE_STICKY=1 keeps it whatever is done; otherwise a force-stop of
# that package or a tap on Wait closes it. FAKE_LOAD is the one-minute load; FAKE_HUNG=1 gives a HOME start no status.
shift 2; [ "${1:-}" = shell ] && shift
c="$*"; echo "$c" >> "$FAKE_DIR/log"; anr=$(cat "$FAKE_DIR/anr" 2>/dev/null)
case "$*" in
  "getprop sys.boot_completed") echo 1 ;;
  nproc) echo 2 ;;
  "cat /proc/loadavg") echo "${FAKE_LOAD:-0.50} 0.40 0.30 1/100 1" ;;
  "dumpsys window")
    if [ -n "$anr" ]; then echo "  mCurrentFocus=Window{1 u0 Application Not Responding: $anr}"
    else echo "  mCurrentFocus=Window{1 u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity}"; fi ;;
  "am force-stop "*) [ "${FAKE_STICKY:-0}" = 1 ] || [ "${c#am force-stop }" != "$anr" ] || : > "$FAKE_DIR/anr" ;;
  *uiautomator*) echo '<node resource-id="android:id/aerr_wait" class="android.widget.Button" bounds="[100,200][300,260]" />' ;;
  "input tap 200 230") [ "${FAKE_STICKY:-0}" = 1 ] || : > "$FAKE_DIR/anr" ;;
  "am start -W "*) [ "${FAKE_HUNG:-0}" = 1 ] || printf 'Status: ok\r\nLaunchState: UNKNOWN (0)\r\nWaitTime: 12\r\nComplete\r\n' ;;
  *) : ;;
esac
exit 0
SH
chmod +x "$T/adb"
# fake <anr package or ""> <command…>: runs it against a fresh fake emulator.
fake() { local a=$1; shift; rm -rf "$T/d"; mkdir "$T/d"; printf '%s' "$a" > "$T/d/anr"; PATH="$T:$PATH" FAKE_DIR="$T/d" timeout 60 "$@" 2>&1; }
L=com.google.android.apps.nexuslauncher
t=$(date +%s); out=$(FAKE_STICKY=1 fake $L bash "$here/android-settle.sh" emulator-5570 3); rc=$?; el=$(( $(date +%s) - t ))
[ $rc = 0 ] && [ $el -lt 30 ] && echo "$out" | grep -q 'settle: time up after 3 s.*ANR still up' && ok "a persistent ANR ends at the limit (${el} s) with 'ANR still up'" || bad "persistent ANR: rc=$rc after ${el} s; $(echo "$out" | tail -2)"
out=$(fake "" bash "$here/android-settle.sh" emulator-5570 30); rc=$?
[ $rc = 0 ] && echo "$out" | grep -q 'settle: ready after.*home=12ms' && ! echo "$out" | grep -q 'ANR still up' && ok "a clean emulator is ready, the launcher answering" || bad "clean: rc=$rc; $out"
out=$(fake $L bash "$here/android-settle.sh" emulator-5570 30); rc=$?
[ $rc = 0 ] && echo "$out" | grep -q 'settle: ready after.*dismissed 1' && grep -qx "am force-stop $L" "$T/d/log" && ! grep -q '^input keyevent 4' "$T/d/log" \
  && ok "a hung launcher's ANR: force-stopped, then ready" || bad "launcher ANR: rc=$rc; $out; $(tr '\n' '|' < "$T/d/log")"
out=$(FAKE_HUNG=1 fake "" bash "$here/android-settle.sh" emulator-5570 8); rc=$?
[ $rc = 0 ] && echo "$out" | grep -q 'settle: time up after 8 s.*home=none' && ok "a launcher that never answers is not ready" || bad "hung launcher: rc=$rc; $out"
out=$(FAKE_LOAD=11.75 fake "" bash "$here/android-settle.sh" emulator-5570 8); rc=$?
echo "$out" | grep -q 'settle: time up after 8 s' && ok "load mode waits out a high load" || bad "load mode at 11.75: $out"
out=$(FAKE_LOAD=11.75 fake "" bash "$here/android-settle.sh" emulator-5570 30 responsive); rc=$?
[ $rc = 0 ] && echo "$out" | grep -q 'settle: ready after' && [ "$(grep -c '^am start -W' "$T/d/log")" = 2 ] && ok "responsive mode: ready after two answers at a load of 11.75" || bad "responsive: rc=$rc; $out"
for p in com.android.systemui asml.bkc.harvard.wallet; do
  out=$(FAKE_STICKY=1 fake $p bash "$here/android-anr.sh" emulator-5570); rc=$?
  [ $rc = 1 ] && ! grep -q 'force-stop' "$T/d/log" && ok "$p's ANR is never force-stopped (exit 1, still up)" || bad "$p: rc=$rc; $out; $(tr '\n' '|' < "$T/d/log")"
done
out=$(fake com.android.systemui bash "$here/android-anr.sh" emulator-5570); rc=$?
[ $rc = 2 ] && echo "$out" | grep -q 'tapped Wait at 200,230' && ok "System UI's ANR: Wait tapped from the hierarchy dump" || bad "Wait tap: rc=$rc; $out"
exit $fails
