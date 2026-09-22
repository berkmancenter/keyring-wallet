#!/usr/bin/env bash
# The heads a build is made from, and a check that they agree.
#
# Every device, simulator or Farm result states both heads; a result without
# them is not evidence (2026-09-22: an afternoon of Farm rungs ran against a
# bifold worktree that predated two merged PRs, and the screens under test
# were old). Run this before building and paste its line into the result.
#
#   e2e/scripts/heads.sh            # print, and fail if bifold ≠ the pinned commit
#   ALLOW_UNPINNED=1 …              # print and warn instead of failing
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
wallet=$(git -C "$ROOT" rev-parse HEAD)
pinned=$(git -C "$ROOT" ls-tree HEAD bifold | awk '{print $3}')
bifold=$(git -C "$ROOT/bifold" rev-parse HEAD)
dirty=""
[ -n "$(git -C "$ROOT" status --porcelain -- . ':(exclude)bifold' 2>/dev/null)" ] && dirty=" (wallet tree dirty)"
[ -n "$(git -C "$ROOT/bifold" status --porcelain 2>/dev/null)" ] && dirty="$dirty (bifold tree dirty)"
echo "heads: wallet ${wallet:0:8} · bifold ${bifold:0:8}${dirty}"
if [ "$bifold" != "$pinned" ]; then
  echo "heads: bifold is ${bifold:0:8}, but this wallet tree pins ${pinned:0:8}" >&2
  if [ "${ALLOW_UNPINNED:-}" = "1" ]; then
    echo "heads: continuing anyway (ALLOW_UNPINNED=1) — say so in the result" >&2
  else
    echo "heads: check out the pinned commit, or set ALLOW_UNPINNED=1 deliberately" >&2
    exit 1
  fi
fi
