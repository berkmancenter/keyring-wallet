#!/bin/sh
# Build the throwaway projects of agent-connect step 0.3 under <dir>, which must be outside this
# repository (a session started there loads that folder's .mcp.json and .claude/settings.json).
# Nothing is installed and no user setting is written; each session is started with
# --setting-sources project,local, so only these files apply. README.md has the runs.
set -eu
[ $# -eq 1 ] || { echo "usage: setup.sh <dir outside the repo>" >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$1"; D=$(cd "$1" && pwd)
case "$D" in "$(git -C "$HERE" rev-parse --show-toplevel)"*) echo "setup.sh: $D is inside the repository" >&2; exit 2;; esac
NODE=$(command -v node)
[ -d "$HERE/node_modules/@modelcontextprotocol/sdk" ] || (cd "$HERE" && npm ci --silent)

# (a), (b): the one-way channel with a reply tool, as a project server (server:probe)
mkdir -p "$D/proj-a/.claude"
cat > "$D/proj-a/.mcp.json" <<J
{"mcpServers":{"probe":{"command":"$NODE","args":["$HERE/channel.mjs"],"env":{"PROBE_PORT":"8791","PROBE_LOG":"$D/proj-a/probe.log"}}}}
J
echo '{"permissions":{"allow":["mcp__probe__reply"]},"enabledMcpjsonServers":["probe"]}' > "$D/proj-a/.claude/settings.json"

# (d): a SessionStart hook with asyncRewake that exits 2 after 45 s
mkdir -p "$D/proj-d/.claude"
cat > "$D/proj-d/.claude/settings.json" <<J
{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"$HERE/rewake.sh $D/proj-d/rewake.log","asyncRewake":true,"timeout":120}]}]}}
J

# (e): the Monitor fallback: a skill that arms Monitor on inbox.sh --follow and re-arms it
mkdir -p "$D/proj-e/.claude/skills/inbox"
cp "$HERE/inbox.sh" "$D/proj-e/inbox.sh"; : > "$D/proj-e/inbox.txt"
cat > "$D/proj-e/.claude/skills/inbox/SKILL.md" <<'J'
---
name: inbox
description: Watch the owner's inbox for new messages. Use at the start of every session and whenever an inbox monitor expires.
---
Arm the Monitor tool with command `./inbox.sh --follow`, description "owner inbox", and timeout_ms 60000.
For each event line, run `echo "ACK <the line>" >> acks.log` with Bash, and nothing else.
When the monitor expires, re-arm it at once, exactly as above, and run `echo "REARM" >> acks.log`.
J
echo '{"permissions":{"allow":["Bash(echo *)","Bash(./inbox.sh *)","Monitor(./inbox.sh *)"]}}' > "$D/proj-e/.claude/settings.json"

# (f): the plugin (passed with --plugin-dir) plus a vta-mcp stand-in, its tools and the usual ones pre-allowed
mkdir -p "$D/proj-f/.claude"
cat > "$D/proj-f/.mcp.json" <<J
{"mcpServers":{"vtamcp":{"command":"$NODE","args":["$HERE/vtamcp.mjs"],"env":{"VTAMCP_LOG":"$D/proj-f/vtamcp.log"}}}}
J
echo '{"enabledMcpjsonServers":["vtamcp"],"permissions":{"allow":["mcp__vtamcp__*","mcp__plugin_probeplug_probe__*","Bash","Write","Edit","WebFetch"]}}' > "$D/proj-f/.claude/settings.json"
echo "built $D/proj-a, proj-d, proj-e, proj-f"
