#!/bin/bash
# pnm-locked's PNM_CALL_TIMEOUT: a pnm call that hangs (a dying transport) is killed at the cap and says so, a quick
# one keeps its own exit code, the lock wait is not counted, and without the variable nothing changes. A fake pnm; no
# network, no secrets.
set -u
here=$(cd "$(dirname "$0")" && pwd); L=$here/../../../scripts/openvtc/pnm-locked
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fails=0; ok() { echo "ok   $*"; }; bad() { echo "FAIL $*"; fails=$((fails + 1)); }
cat > "$T/pnm" <<'SH'
#!/bin/bash
# --vta <slug> <cmd>: "quick" answers at once with rc 3; "hang" sleeps far past any cap (and starts a child, as pnm's
# helpers would, which must die with it).
case "${3:-}" in
  quick) echo answered; exit 3 ;;
  hang) sleep 300 & sleep 300 ;;
esac
SH
chmod +x "$T/pnm"
export PNM_BIN=$T/pnm PNM_LOCK_DIR=$T/locks

out=$(PNM_CALL_TIMEOUT=5 bash "$L" --vta runner quick 2>&1); rc=$?
[ "$rc" = 3 ] && echo "$out" | grep -q answered && ok "a quick call under the cap keeps its output and exit code ($rc)" || bad "quick: rc=$rc out=$out"

t0=$(date +%s); out=$(PNM_CALL_TIMEOUT=2 bash "$L" --vta runner hang 2>&1); rc=$?; t=$(( $(date +%s) - t0 ))
[ "$rc" = 124 ] && [ "$t" -le 8 ] && echo "$out" | grep -q 'did not finish within 2s' && ok "a hung call is killed at the cap: rc 124 in ${t}s, said so" || bad "hang: rc=$rc in ${t}s out=$out"
sleep 1; ! pgrep -f "$T/pnm" >/dev/null && ok "nothing the hung call started is left running" || { bad "left running: $(pgrep -fl "$T/pnm")"; kill $(pgrep -f "$T/pnm") 2>/dev/null; }

out=$(bash "$L" --vta runner quick 2>&1); rc=$?
[ "$rc" = 3 ] && ok "without PNM_CALL_TIMEOUT it behaves as before (exec, rc $rc)" || bad "uncapped: rc=$rc"

# The lock wait is not counted: another holder keeps the slug's lock for 3 s; a 2 s cap still lets the quick call run.
perl -MFcntl=:flock -e 'open(my $f, "+>>", $ARGV[0]) or die; flock($f, LOCK_EX); sleep 3' "$T/locks/runner.lock" & h=$!
sleep 0.5
out=$(PNM_CALL_TIMEOUT=2 bash "$L" --vta runner quick 2>&1); rc=$?
wait $h
[ "$rc" = 3 ] && echo "$out" | grep -q 'waiting for another pnm call' && ok "3 s queued behind another call, then answered: the lock wait is outside the 2 s cap" || bad "lock wait counted: rc=$rc out=$out"

# Stopping pnm-locked stops pnm: a hung call under a 60 s cap, TERM to pnm-locked after 1 s. The fake pnm and what it
# started must be gone within a few seconds, and the slug's lock free again, so the next call answers at once.
PNM_CALL_TIMEOUT=60 bash "$L" --vta runner2 hang >/dev/null 2>&1 & lp=$!   # pnm-locked execs perl: $! is the parent
sleep 1
kill -TERM "$lp" 2>/dev/null; wait "$lp" 2>/dev/null; rc=$?
gone=no; for i in 1 2 3 4 5 6; do pgrep -f "$T/pnm --vta runner2" >/dev/null || { gone=yes; break; }; sleep 1; done
[ "$gone" = yes ] && [ "$rc" = 143 ] && ok "TERM to pnm-locked stops the hung pnm too (rc $rc, gone within ${i}s)" || { bad "after TERM: rc=$rc, still running: $(pgrep -fl "$T/pnm --vta runner2")"; kill $(pgrep -f "$T/pnm --vta runner2") 2>/dev/null; }
out=$(PNM_LOCK_WAIT=3 PNM_CALL_TIMEOUT=5 bash "$L" --vta runner2 quick 2>&1); rc=$?
[ "$rc" = 3 ] && ok "the slug's lock is free again: the next call answers at once" || bad "lock still held after the stop: rc=$rc out=$out"

exit $fails
