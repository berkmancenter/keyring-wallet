#!/bin/sh
# Stop, agent-connect step 0.3(f): the turn is over; clear the marker so held owner events go out.
ST="${PROBE_STATE:-$(dirname "$0")/state}"
mkdir -p "$ST"
cat > /dev/null
echo "$(date -u +%FT%T) stop marker=$(cat "$ST/turn-trust" 2>/dev/null || echo none)" >> "$ST/gate.log"
rm -f "$ST/turn-trust"
exit 0
