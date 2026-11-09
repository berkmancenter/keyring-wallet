#!/bin/bash
# An "isn't responding" dialog on the emulator, found and dismissed: `android-anr.sh <serial>`.
# Exit 0 when no such window is up, 2 when one was up and was dismissed (what it did on stdout), 1 when one is up
# and would not go. The dialog is a system window titled "Application Not Responding: <package>" (dumpsys window);
# its buttons are android:id/aerr_wait and android:id/aerr_close. "Wait" keeps the process (System UI on a cold
# 2-vCPU runner: run 38045665103's dialog sat over the app from before the launch to the welcome driver); the
# back key is the fallback when the hierarchy dump stalls.
# A launcher's dialog is not waited out: the launcher is force-stopped and HOME starts it again. On runs 40982883110
# and 40990403361 (first attempts) Pixel Launcher hung on the cold boot, BACK never closed its dialog (twelve tries
# each, settle ran out with it up), and after the welcome driver tapped Wait it came straight back and the slides
# never moved (agent-slide-words FAIL on both tries). Only a launcher: an ANR of System UI or the wallet is left as
# it is, since stopping the wallet would hide its own ANR.
set -u
S=${1:?emulator serial}
adb_() { adb -s "$S" "$@"; }
anr_window() { adb_ shell dumpsys window 2>/dev/null | tr -d '\r' | grep -oE 'Application Not Responding: [A-Za-z0-9._]+' | head -1; }
w=$(anr_window)
[ -n "$w" ] || exit 0
echo "ANR dialog up: $w"
pkg=${w#Application Not Responding: }
case $pkg in
*launcher*)
  adb_ shell am force-stop "$pkg"; adb_ shell am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null 2>&1
  echo "force-stopped $pkg (a launcher) and sent HOME"; sleep 3
  w2=$(anr_window)
  if [ -z "$w2" ]; then echo "dismissed (launcher restarted)"; exit 2; fi
  echo "still up: $w2"; exit 1 ;;
esac
# Tap Wait by its bounds from the accessibility hierarchy (resource-id precedes bounds in the dump's attribute order).
# `timeout` runs adb itself: given the adb_ function it could not run it (exit 127), so before this the dump never
# ran and every dialog got BACK.
b=$(timeout 25 adb -s "$S" shell 'uiautomator dump /sdcard/anr.xml >/dev/null 2>&1 && cat /sdcard/anr.xml' 2>/dev/null | tr -d '\r' \
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
