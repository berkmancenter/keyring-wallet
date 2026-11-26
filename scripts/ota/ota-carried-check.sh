#!/bin/bash
# Before a store cut: everything an OTA shipped since the last store build must reach the new one, or testers who
# had it lose it. For each commit an OTA branch carries beyond main, it looks for a commit with the same patch-id on
# the wallet target. The framework is part of this repository, at packages/ since its move (Phase 2 of
# docs/plans/single-codebase-plan.md): a framework change is a wallet commit touching packages/… paths, checked like
# any other. A commit from before the move (it touches bifold/…: the folded tree, or the submodule's gitlink) cannot
# be followed onto a target where the framework lives at packages/ (its patch names the old paths, so neither patch-id
# nor content can find it): such a row says so and the run exits 2, for a person to check by hand, as a pin bump did
# against the folded tree. Otherwise a commit is docs only (ships no code), replaced by a commit on the target
# (ota-carried-replacements.txt), or MISSING. An open PR's commit is MISSING: it has to merge before the cut. Merge
# commits carry no change of their own and are skipped. Exit 0 only when nothing is MISSING (docs/RELEASE_GATE.md §1);
# exit 2 when it cannot check (a commit it needs is not in the local repository, or a commit or the target predates
# the move).
#
#   ota-carried-check.sh --wallet hotfix/272-ota-1,hotfix/272-ota-2 [--target origin/main]
#
# Branches are read from the remote, fetched first. For tests: --no-fetch, --remote '' (local branches),
# --replacements <file>. --bifold and --bifold-dir named the submodule's branches and clone before the fold; there is
# no second repository now, so they are refused: a framework change is on a wallet branch, named with --wallet.
set -uo pipefail
# The fold's graft (refs/replace/* on the commit that folded bifold in) is honoured by git by default where present;
# this script walks history (merge-base, rev-list), so it reads the real objects, as CI does.
export GIT_NO_REPLACE_OBJECTS=1

here=$(cd "$(dirname "$0")" && pwd)
root=$(git -C "$here" rev-parse --show-toplevel)
wallet_branches='' target='' remote=origin fetch=1
replacements="$here/ota-carried-replacements.txt"
while [ $# -gt 0 ]; do
  case $1 in
    --wallet) wallet_branches=${2//,/ }; shift 2 ;;
    --target) target=$2; shift 2 ;;
    --remote) remote=$2; shift 2 ;;
    --no-fetch) fetch=0; shift ;;
    --replacements) replacements=$2; shift 2 ;;
    --bifold|--bifold-dir) echo "ota-carried-check: $1 named the bifold submodule's branches or clone; the framework is this repository's packages/ since the move, so its changes are wallet commits: name their branches with --wallet" >&2; exit 2 ;;
    *) echo "ota-carried-check: unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$wallet_branches" ] || { echo "ota-carried-check: name the OTA branches (--wallet)" >&2; exit 2; }
ref() { if [ -n "$remote" ]; then echo "$remote/$1"; else echo "$1"; fi; }
[ -n "$target" ] || target=$(ref main)

if [ "$fetch" = 1 ]; then
  git -C "$root" fetch -q "$remote" main $wallet_branches || exit 2
fi
# What the target carries as the framework: the tree at packages/ (since the move). A target with bifold at all (the
# folded tree, or the submodule's gitlink) predates the move, and this script cannot read it: the script of that
# target's own commit can. The kind is the tree entry's (ls-tree), not `cat-file -t`: a gitlink's commit is not in
# this repository.
old=$(git -C "$root" ls-tree "$target" bifold | awk '{print $2}')
if [ -n "$old" ]; then
  echo "ota-carried-check: $target carries bifold as a $old (from before the move of the framework into packages/): this script reads a target with the framework at packages/; run the ota-carried-check.sh of $target's own commit against it" >&2
  exit 2
fi
# --verify --quiet: a plain rev-parse would echo "<target>:packages" back on stdout and pass a target with none.
tree=$(git -C "$root" rev-parse --verify --quiet "$target:packages") || { echo "ota-carried-check: $target has no packages/ tree: not a wallet commit since the move" >&2; exit 2; }

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
# The bifold rows are from before the fold (the submodule's own commits) and stay for the record; only wallet rows
# can match a commit this script checks.
replaced() { # repo dir commit
  [ -f "$replacements" ] || return 0
  grep -v '^#' "$replacements" | while read -r repo c by why; do
    [ "$repo" = "$1" ] || continue
    case $(git -C "$2" rev-parse "$c" 2>/dev/null) in "$3"*) ;; *) continue ;; esac
    if git -C "$root" merge-base --is-ancestor "$by" "$target" 2>/dev/null; then echo "replaced by $by ($why)"
    else echo "NOT REPLACED: $by is not on $target"; fi
  done
}

missing=0 premove=0
row() { printf '%-7s %-22.22s %-9s %-55.55s %s\n' "$@"; }
row REPO BRANCH COMMIT SUBJECT STATUS
check() { # repo dir label tip target-commit: the commits tip carries beyond its repository's main
  local repo=$1 dir=$2 label=$3 tip=$4 into=$5 base carried fork ids ids0 c subj files pid pid0 hit hit0 status
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
    elif echo "$files" | grep -qE '^bifold(/|$)'; then
      # From before the move (the framework under bifold/, or the gitlink it was before the fold): its patch names
      # paths the target no longer has, so neither patch-id nor content can find it there. Said, not waved through.
      status="touches bifold/ (from before the move of the framework into packages/): cannot be followed onto $target, check it by hand"
      premove=1
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
echo
echo "target $(git -C "$root" rev-parse --short "$target"), its framework tree ${tree:0:8} (packages/, one codebase)"
if [ "$premove" = 1 ]; then
  echo "ota-carried-check: an OTA branch carries a commit from before the move of the framework into packages/ (rows above): it cannot be followed here, check it by hand" >&2
  exit 2
fi
[ "$missing" = 0 ] && echo "ota-carried-check: everything shipped by OTA reaches the target" ||
  echo "ota-carried-check: MISSING rows above: merge them (or name a replacement) before the cut"
exit $missing
