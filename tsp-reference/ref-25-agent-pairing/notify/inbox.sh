#!/bin/sh
# stand-in for `vta-agent-memory inbox --follow`: one line per accepted message
cd "$(dirname "$0")"
echo "$(date -u +%FT%TZ) follow-start pid $$" >> follow.log
exec tail -n 0 -F inbox.txt
