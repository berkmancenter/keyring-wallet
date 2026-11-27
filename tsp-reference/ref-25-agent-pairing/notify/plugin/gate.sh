#!/bin/sh
# PreToolUse, agent-connect step 0.3(f): while the turn-trust marker says "other", deny every tool
# but the plugin's own reply. A stand-in for the plugin's hook of plan §3.13 item 1.
ST="${PROBE_STATE:-$(dirname "$0")/state}"
mkdir -p "$ST"
in=$(cat)
field() { printf '%s' "$in" | /usr/bin/python3 -c "import sys,json;print(json.load(sys.stdin).get('$1',''))"; }
tool=$(field tool_name)
mode=$(field permission_mode)
marker=$(cat "$ST/turn-trust" 2>/dev/null)
if [ "$marker" = other ] && [ "$tool" != mcp__plugin_probeplug_probe__reply ]; then
  echo "$(date -u +%FT%T) deny $tool mode=$mode" >> "$ST/gate.log"
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"A message from someone other than the owner: only the reply tool is allowed on this turn."}}'
  exit 0
fi
echo "$(date -u +%FT%T) pass $tool marker=${marker:-none} mode=$mode" >> "$ST/gate.log"
exit 0
