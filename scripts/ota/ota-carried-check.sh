#!/bin/bash
# Before a store cut: everything an OTA shipped since the last store build must reach the new one, or testers who
# had it lose it. For each commit an OTA branch carries beyond main, it looks for a commit with the same patch-id on
# the wallet target, or in the bifold commit that target PINS (what the store build ships; the pin can lag bifold
# main). A wallet commit that moves the bifold pin is checked through the bifold commit it pins: every bifold commit
# that one carries beyond bifold main gets a row of its own. Otherwise a commit is docs only (ships no code), replaced
# by a commit on the target (ota-carried-replacements.txt), or MISSING. An open PR's commit is MISSING: it has to merge
# before the cut. Merge commits carry no change of their own and are skipped. Exit 0 only when nothing is MISSING
# (docs/RELEASE_GATE.md §1); exit 2 when it cannot check (a commit it needs is not in the local repositories).
#
#   ota-carried-check.sh --wallet hotfix/272-ota-1,hotfix/272-ota-2 [--bifold ota/272-1,ota/272-2b] [--target origin/main]
#
# --bifold adds bifold branches beyond those the wallet branches pin. Branches are read from the remote, fetched first.
# For tests: --no-fetch, --remote '' (local branches), --bifold-dir <dir>, --replacements <file>.
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
[ -n "$wallet_branches$bifold_branches" ] || { echo "ota-carried-check: name the OTA branches (--wallet)" >&2; exit 2; }
ref() { if [ -n "$remote" ]; then echo "$remote/$1"; else echo "$1"; fi; }
[ -n "$target" ] || target=$(ref main)
need() { # dir commit what: the commit must be in the repository, or nothing about it can be checked
  git -C "$1" cat-file -e "$2^{commit}" 2>/dev/null && return
  echo "ota-carried-check: $3 ($2) is not in $1; fetch it (or check out the bifold submodule) and run again" >&2
  exit 2
}

if [ "$fetch" = 1 ]; then
  git -C "$root" fetch -q "$remote" main $wallet_branches || exit 2
  git -C "$bifold_dir" fetch -q "$remote" main $bifold_branches || exit 2
fi
pin=$(git -C "$root" ls-tree "$target" bifold | awk '{print $3}')
[ -n "$pin" ] || { echo "ota-carried-check: $target pins no bifold" >&2; exit 2; }
need "$bifold_dir" "$pin" "the bifold commit $target pins"

# Whether a commit's change is in a tree when no single commit there has its changed lines (a squash of several
# commits). Its patch reverses cleanly onto the tree when every line it added is there as it added it. Checked in
# a throwaway index, so nothing is checked out or written. Lines changed again since read as absent: MISSING, for a
# person to look at.
in_tree() { # dir commit tree
  local index rc
  index=$(mktemp)
  GIT_INDEX_FILE=$index git -C "$1" read-tree "$3" &&
    git -C "$1" diff "$2^" "$2" | GIT_INDEX_FILE=$index git -C "$1" apply --cached --reverse --check 2>/dev/null
  rc=$?
  rm -f "$index"
  return $rc
}

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

missing=0 pinned='' checked=''
row() { printf '%-7s %-22.22s %-9s %-55.55s %s\n' "$@"; }
row REPO BRANCH COMMIT SUBJECT STATUS
check() { # repo dir label tip target-commit: the commits tip carries beyond its repository's main
  local repo=$1 dir=$2 label=$3 tip=$4 into=$5 base carried fork ids ids0 c subj files pid pid0 hit hit0 status to
  base=$(git -C "$dir" merge-base "$tip" "$(ref main)") || { echo "ota-carried-check: no merge base for $label" >&2; exit 2; }
  carried=$(git -C "$dir" log --reverse --no-merges --format=%H "$base..$tip")
  [ -n "$carried" ] || return 0
  # Searched from where the branch first left the target, not from today's merge base: once main is merged into an
  # OTA branch, the merge base moves up past the main-side twins of its earlier commits.
  fork=$(git -C "$dir" merge-base "$(echo "$carried" | head -1)" "$into")
  ids=$(git -C "$dir" log --format=%H "$fork..$into" | while read -r m; do git -C "$dir" show "$m" | git patch-id --stable; done)
  # The same, without context: a squash over a conflict resolution keeps the changed lines and changes their context.
  ids0=$(git -C "$dir" log --format=%H "$fork..$into" | while read -r m; do git -C "$dir" show -U0 "$m" | git patch-id --stable; done)
  for c in $carried; do
    subj=$(git -C "$dir" log -1 --format=%s "$c")
    files=$(git -C "$dir" show --format= --name-only "$c")
    pid=$(git -C "$dir" show "$c" | git patch-id --stable | cut -d' ' -f1)
    hit=$(echo "$ids" | grep "^$pid " | head -1 | cut -d' ' -f2 | cut -c1-8)
    pid0=$(git -C "$dir" show -U0 "$c" | git patch-id --stable | cut -d' ' -f1)
    hit0=$(echo "$ids0" | grep "^$pid0 " | head -1 | cut -d' ' -f2 | cut -c1-8)
    if [ -n "$hit" ]; then status="on the target as $hit (same patch-id)"
    elif [ -n "$hit0" ]; then status="on the target as $hit0 (the same changed lines, in new context)"
    elif [ "$repo" = wallet ] && [ "$files" = bifold ]; then
      to=$(git -C "$dir" ls-tree "$c" bifold | awk '{print $3}')
      status="pin bump to ${to:0:8}: its bifold commits are checked below"
      case " $pinned " in *" $to "*) ;; *) pinned="$pinned $to" ;; esac
    elif ! echo "$files" | grep -qvE '^(docs/.*|.*\.md)$'; then status="docs only: ships no code"
    elif in_tree "$dir" "$c" "$into"; then status="on the target by content (the patch reverses cleanly onto it)"
    else
      status=$(replaced "$repo" "$dir" "$c")
      [ -n "$status" ] && [ "${status#NOT}" = "$status" ] || { status=${status:-MISSING}; missing=1; }
    fi
    row "$repo" "$label" "${c:0:8}" "$subj" "$status"
  done
}
for b in $wallet_branches; do check wallet "$root" "$b" "$(ref "$b")" "$target"; done
# Every bifold commit an OTA pinned, then any named bifold branch whose tip was not already checked that way.
for to in $pinned; do
  need "$bifold_dir" "$to" "a bifold commit an OTA branch pins"
  check bifold "$bifold_dir" "pinned ${to:0:8}" "$to" "$pin"; checked="$checked $to"
done
for b in $bifold_branches; do
  tip=$(git -C "$bifold_dir" rev-parse "$(ref "$b")" 2>/dev/null) || { echo "ota-carried-check: no $b in $bifold_dir" >&2; exit 2; }
  case " $checked " in *" $tip "*) continue ;; esac
  check bifold "$bifold_dir" "$b" "$tip" "$pin"
done
echo
echo "target $(git -C "$root" rev-parse --short "$target"), its bifold pin ${pin:0:8}"
[ "$missing" = 0 ] && echo "ota-carried-check: everything shipped by OTA reaches the target" ||
  echo "ota-carried-check: MISSING rows above: merge them (or name a replacement) before the cut"
exit $missing
