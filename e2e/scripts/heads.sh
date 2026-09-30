#!/usr/bin/env bash
# The heads a build is made from, and a check that they agree.
#
# Every device, simulator or Farm result states both heads; a result without
# them is not evidence (2026-09-22: an afternoon of Farm rungs ran against a
# bifold worktree that predated two merged PRs, and the screens under test
# were old). Run this before building and paste its line into the result.
#
# When the checkout is not the pinned commit it also prints WHAT the build is
# missing, because "unpinned" alone does not scope a result — and it ends with
# a single ready-to-paste SUMMARY line, so stating it correctly is a copy
# rather than a transcription. Transcription is where the gap goes missing.
#
#   e2e/scripts/heads.sh            # print, and fail if bifold ≠ the pinned commit
#   ALLOW_UNPINNED=1 …              # print the gap and warn instead of failing
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
wallet=$(git -C "$ROOT" rev-parse HEAD)
pinned=$(git -C "$ROOT" ls-tree HEAD bifold | awk '{print $3}')
bifold=$(git -C "$ROOT/bifold" rev-parse HEAD)

dirty=""
[ -n "$(git -C "$ROOT" status --porcelain -- . ':(exclude)bifold' 2>/dev/null)" ] && dirty=" (wallet tree dirty)"
[ -n "$(git -C "$ROOT/bifold" status --porcelain 2>/dev/null)" ] && dirty="$dirty (bifold tree dirty)"
echo "heads: wallet ${wallet:0:8} · bifold ${bifold:0:8}${dirty}"

# One-line description of where the build sits relative to the pin, built once
# and reused for the SUMMARY so the two can never disagree.
scope="at pin"
status=0

if [ "$bifold" != "$pinned" ]; then
  echo "heads: bifold is ${bifold:0:8}, but this wallet tree pins ${pinned:0:8}" >&2
  # Naming the gap matters as much as naming the heads. Knowing a build is
  # unpinned says nothing about what it is missing, and that difference is the
  # meaning of the result: on 2026-09-23 a fresh-vetter pass was reported as
  # covering two changes when the build was the pin minus one of them, and the
  # wider claim had already been written down. So print what is absent.
  if git -C "$ROOT/bifold" cat-file -e "$pinned^{commit}" 2>/dev/null; then
    behind=$(git -C "$ROOT/bifold" rev-list --count "$bifold".."$pinned" 2>/dev/null || echo 0)
    ahead=$(git -C "$ROOT/bifold" rev-list --count "$pinned".."$bifold" 2>/dev/null || echo 0)
    if [ "$behind" != "0" ]; then
      echo "heads: the build is missing $behind commit(s) the pin has:" >&2
      git -C "$ROOT/bifold" log --oneline "$bifold".."$pinned" 2>/dev/null | sed 's/^/heads:   - /' >&2
      # Truncate the SUBJECT, not the composed string: cutting the whole thing
      # eats the closing quote and reads as corruption rather than elision.
      fsha=$(git -C "$ROOT/bifold" log -1 --format='%h' "$pinned" 2>/dev/null)
      fsub=$(git -C "$ROOT/bifold" log -1 --format='%s' "$pinned" 2>/dev/null)
      [ "${#fsub}" -gt 56 ] && fsub="${fsub:0:55}…"
      first="$fsha \"$fsub\""
      if [ "$behind" = "1" ]; then
        scope="pin ${pinned:0:8}, minus $first"
      else
        scope="pin ${pinned:0:8}, minus $behind commits incl. $first"
      fi
    fi
    if [ "$ahead" != "0" ]; then
      echo "heads: the build also carries $ahead commit(s) the pin does not" >&2
      [ "$behind" = "0" ] && scope="pin ${pinned:0:8}, plus $ahead commit(s) not in the pin" \
                          || scope="$scope, plus $ahead not in the pin"
    fi
    if [ "$behind" = "0" ] && [ "$ahead" = "0" ]; then
      echo "heads: same content, different commit" >&2
      scope="pin ${pinned:0:8}, same content, different commit"
    fi
  else
    echo "heads: cannot describe the gap — ${pinned:0:8} is not in the bifold clone (fetch it)" >&2
    scope="pin ${pinned:0:8}, gap UNKNOWN — pin not fetched"
  fi
  if [ "${ALLOW_UNPINNED:-}" = "1" ]; then
    echo "heads: continuing anyway (ALLOW_UNPINNED=1) — paste the SUMMARY line below," >&2
    echo "heads: which carries the gap; the heads alone do not scope the result" >&2
  else
    echo "heads: check out the pinned commit, or set ALLOW_UNPINNED=1 deliberately" >&2
    status=1
  fi
fi

# The line to paste into a result, a PR body or a message. Emitted in every
# case, including the clean one, so there is never a reason to retype it.
echo "heads: SUMMARY wallet ${wallet:0:8} · bifold ${bifold:0:8} (${scope})${dirty}"
exit $status
