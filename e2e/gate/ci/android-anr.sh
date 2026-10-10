#!/bin/bash
# An "isn't responding" dialog on the emulator, found and dismissed: `android-anr.sh <serial>`.
# Exit 0 when no such window is up, 2 when one was up and was dismissed (what it did on stdout), 1 when one is up
# and would not go. The dialog is a system window titled "Application Not Responding: <package>" (dumpsys window);
# its buttons are android:id/aerr_wait and android:id/aerr_close. "Wait" keeps the process (System UI on a cold
# 2-vCPU runner: run 38045665103's dialog sat over the app from before the launch to the welcome driver); the
# back key is the fallback when the hierarchy dump stalls.
set -u
S=${1:?emulator serial}
adb_() { adb -s "$S" "$@"; }
anr_window() { adb_ shell dumpsys window windows 2>/dev/null | tr -d '\r' | grep -oE 'Application Not Responding: [A-Za-z0-9._]+' | head -1; }
w=$(anr_window)
[ -n "$w" ] || exit 0
echo "ANR dialog up: $w"
# Tap Wait by its bounds from the accessibility hierarchy (resource-id precedes bounds in the dump's attribute order).
b=$(timeout 25 adb_ shell 'uiautomator dump /sdcard/anr.xml >/dev/null 2>&1 && cat /sdcard/anr.xml' 2>/dev/null | tr -d '\r' \
  | grep -oE 'resource-id="android:id/aerr_wait"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1)
if [ -n "$b" ]; then
  c=$(echo "$b" | sed 's/\]\[/,/; s/[][]//g'); x=$(echo "$c" | awk -F, '{print int(($1+$3)/2)}'); y=$(echo "$c" | awk -F, '{print int(($2+$4)/2)}')
  adb_ shell input tap "$x" "$y"; echo "tapped Wait at $x,$y"
else
  adb_ shell input keyevent 4; echo "no Wait button in the hierarchy dump; sent BACK"
fi
sleep 2
w2=$(anr_window)
if [ -z "$w2" ]; then echo "dismissed"; exit 2; fi
adb_ shell input keyevent 4; sleep 2
w3=$(anr_window)
if [ -z "$w3" ]; then echo "dismissed (BACK)"; exit 2; fi
echo "still up: $w3"; exit 1
