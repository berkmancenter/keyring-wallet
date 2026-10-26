#!/bin/bash
# Before a store cut: everything an OTA shipped since the last store build must reach the new one, or testers who
# had it lose it. For each commit an OTA branch carries beyond main, it looks for a commit with the same patch-id on
# the wallet target, or in the bifold commit that target PINS (what the store build ships; the pin can lag bifold
# main). A commit with no match is a pin bump (main's pin covers it: see the bifold rows), docs only (ships no code),
# replaced by a commit on the target (ota-carried-replacements.txt), or MISSING. An open PR's commit is MISSING: it
# has to merge before the cut. Exit 0 only when nothing is MISSING (docs/RELEASE_GATE.md §1).
#
#   ota-carried-check.sh --wallet hotfix/272-ota-1,hotfix/272-ota-2 --bifold ota/272-1,ota/272-2b [--target origin/main]
#
# Branches are read from the remote (fetched first). For tests: --no-fetch, --remote '' (local branches),
# --bifold-dir <dir>, --replacements <file>.
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(git -C "$here" rev-parse --show-toplevel)
wallet_branches='' bifold_branches='' target='' remote=origin fetch=1
bifold_dir="$root/bifold" replacements="$here/ota-carried-replacements.txt"
while [ $# -gt 0 ]; do
  case $1 in
    --wallet) wallet_branches=${2//,/ }; shift 2 ;;
    --bifold) bifold_branches=${2//,/ }; shift 2 ;;
    --target) target=$2; shift 2 ;;
    --remote) remote=$2; shift 2 ;;
    --no-fetch) fetch=0; shift ;;
    --bifold-dir) bifold_dir=$2; shift 2 ;;
    --replacements) replacements=$2; shift 2 ;;
    *) echo "ota-carried-check: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$wallet_branches$bifold_branches" ] || { echo "ota-carried-check: name the OTA branches (--wallet, --bifold)" >&2; exit 2; }
ref() { if [ -n "$remote" ]; then echo "$remote/$1"; else echo "$1"; fi; }
[ -n "$target" ] || target=$(ref main)

if [ "$fetch" = 1 ]; then
  git -C "$root" fetch -q "$remote" main $wallet_branches || exit 2
  [ -z "$bifold_branches" ] || git -C "$bifold_dir" fetch -q "$remote" main $bifold_branches || exit 2
fi
pin=$(git -C "$root" ls-tree "$target" bifold | awk '{print $3}')
[ -z "$bifold_branches" ] || [ -n "$pin" ] || { echo "ota-carried-check: $target pins no bifold" >&2; exit 2; }

# A replacement: "<wallet|bifold> <commit> <replacing wallet commit> <why>". The replacing commit must be on the target.
replaced() { # repo dir commit
  [ -f "$replacements" ] || return 0
  grep -v '^#' "$replacements" | while read -r repo c by why; do
    [ "$repo" = "$1" ] || continue
    case $(git -C "$2" rev-parse "$c" 2>/dev/null) in "$3"*) ;; *) continue ;; esac
    if git -C "$root" merge-base --is-ancestor "$by" "$target" 2>/dev/null; then echo "replaced by $by ($why)"
    else echo "NOT REPLACED: $by is not on $target"; fi
  done
}

missing=0
row() { printf '%-7s %-17s %-9s %-60.60s %s\n' "$@"; }
row REPO BRANCH COMMIT SUBJECT STATUS
check() { # repo dir branch target-commit
  local repo=$1 dir=$2 branch=$3 into=$4 base ids c subj files pid hit status
  base=$(git -C "$dir" merge-base "$(ref "$branch")" "$(ref main)") || { echo "ota-carried-check: no $branch in $dir" >&2; exit 2; }
  ids=$(git -C "$dir" log --format=%H "$base..$into" | while read -r m; do git -C "$dir" show "$m" | git patch-id --stable; done)
  for c in $(git -C "$dir" log --reverse --format=%H "$base..$(ref "$branch")"); do
    subj=$(git -C "$dir" log -1 --format=%s "$c")
    files=$(git -C "$dir" show --format= --name-only "$c")
    pid=$(git -C "$dir" show "$c" | git patch-id --stable | cut -d' ' -f1)
    hit=$(echo "$ids" | grep "^$pid " | head -1 | cut -d' ' -f2 | cut -c1-8)
    if [ -n "$hit" ]; then status="on the target as $hit (same patch-id)"
    elif [ "$repo" = wallet ] && [ "$files" = bifold ]; then status="pin bump: the target pins ${pin:0:8} (bifold rows)"
    elif ! echo "$files" | grep -qvE '^(docs/.*|.*\.md)$'; then status="docs only: ships no code"
    else
      status=$(replaced "$repo" "$dir" "$c")
      [ -n "$status" ] && [ "${status#NOT}" = "$status" ] || { status=${status:-MISSING}; missing=1; }
    fi
    row "$repo" "$branch" "${c:0:8}" "$subj" "$status"
  done
}
for b in $wallet_branches; do check wallet "$root" "$b" "$target"; done
for b in $bifold_branches; do check bifold "$bifold_dir" "$b" "$pin"; done
echo
echo "target $(git -C "$root" rev-parse --short "$target")${pin:+, its bifold pin ${pin:0:8}}"
[ "$missing" = 0 ] && echo "ota-carried-check: everything shipped by OTA reaches the target" ||
  echo "ota-carried-check: MISSING rows above: merge them (or name a replacement) before the cut"
exit $missing
