#!/bin/bash
# bash e2e/gate/ci/android-settle.test.sh: settling ends within its limit even when an ANR dialog never goes away
# (gate-ci run 38501730502 looped 87 min), says "ANR still up", and reports ready on a clean emulator.
set -u
here=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; fails=0
ok() { echo "ok   $*"; }; bad() { echo "FAIL $*"; fails=$((fails + 1)); }
cat > "$T/adb" <<'SH'
#!/bin/bash
# A fake adb: -s <serial> shell <cmd…>. FAKE_ANR=1 keeps the launcher's ANR window focused for ever.
shift 2; [ "${1:-}" = shell ] && shift
case "$*" in
  "getprop sys.boot_completed") echo 1 ;;
  nproc) echo 2 ;;
  "cat /proc/loadavg") echo "0.50 0.40 0.30 1/100 1" ;;
  "dumpsys window")
    if [ "${FAKE_ANR:-0}" = 1 ]; then echo "  mCurrentFocus=Window{1 u0 Application Not Responding: com.google.android.apps.nexuslauncher}"
    else echo "  mCurrentFocus=Window{1 u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity}"; fi ;;
  *) : ;;
esac
exit 0
SH
chmod +x "$T/adb"
t=$(date +%s); out=$(PATH="$T:$PATH" FAKE_ANR=1 timeout 60 bash "$here/android-settle.sh" emulator-5570 3 2>&1); rc=$?; el=$(( $(date +%s) - t ))
[ $rc = 0 ] && [ $el -lt 30 ] && echo "$out" | grep -q 'settle: time up after 3 s.*ANR still up' && ok "a persistent ANR ends at the limit (${el} s) with 'ANR still up'" || bad "persistent ANR: rc=$rc after ${el} s; $(echo "$out" | tail -2)"
out=$(PATH="$T:$PATH" FAKE_ANR=0 timeout 60 bash "$here/android-settle.sh" emulator-5570 30 2>&1); rc=$?
[ $rc = 0 ] && echo "$out" | grep -q 'settle: ready after' && ! echo "$out" | grep -q 'ANR still up' && ok "a clean emulator is ready" || bad "clean: rc=$rc; $out"
exit $fails
