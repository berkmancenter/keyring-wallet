#!/bin/sh
# Run a command in a terminal-like environment: none of a parent Claude Code session's
# CLAUDE_* markers (a session started from another one is marked as its child and, for one,
# saves no transcript), and a PATH that still finds claude and node.
CLAUDE_DIR=$(dirname "$(command -v claude)")
NODE_DIR=$(dirname "$(command -v node)")
exec env -i HOME="$HOME" USER="$USER" LOGNAME="$USER" SHELL=/bin/zsh LANG=en_US.UTF-8 TERM=xterm-256color \
  PATH="$CLAUDE_DIR:$NODE_DIR:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  TMPDIR="${TMPDIR:-/tmp}" "$@"
