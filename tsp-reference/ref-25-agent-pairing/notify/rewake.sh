#!/bin/sh
# asyncRewake probe, agent-connect step 0.3(d): wait while the session idles, then wake it with exit 2.
LOG=${1:-/dev/null}
echo "$(date -u +%FT%TZ) start" >> "$LOG"
sleep 45
echo "$(date -u +%FT%TZ) exit2" >> "$LOG"
echo "Probe d: an asyncRewake hook woke you. Answer with the text PONG-D and nothing else." >&2
exit 2
