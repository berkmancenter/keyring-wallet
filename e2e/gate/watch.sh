#!/bin/bash
# Start the gate when a pin PR merges and its builds are green. Runs in the foreground, so either:
#   nohup e2e/gate/watch.sh <pr> &                     (from a shell; its own session, so it survives that shell)
#   launchctl load ~/Library/LaunchAgents/<label>.plist (gate.plist.example: survives sessions; the Mac owner's call)
# Never start it as an agent tool's background job: one of those was stopped by its 2-hour limit mid-gate (236).
set -u
PR=${1:?usage: watch.sh <pin-pr-number>}
GATE_HOME=${GATE_HOME:-$HOME/.keyring-fleet/gate}; mkdir -p "$GATE_HOME"
LOG=$GATE_HOME/watch-$PR.log
echo "watch #$PR started $(date -u +%T)Z (pid $$)" >> "$LOG"
# In its own session (setsid): a process group shared with whatever started it can be stopped with it. On 10-06
# a tool's stop of an unrelated job took a detached gate down mid-leg, before its cleanup.
exec perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV' "$(dirname "$0")/gate.sh" watch --pr "$PR" >> "$LOG" 2>&1
