#!/usr/bin/env bash
# Brings the e2e harness's testID manifests up to date with a bifold checkout.
#
#   e2e/scripts/sync-testids.sh <path-to-bifold-checkout>
#   e2e/scripts/sync-testids.sh bifold          # the folded bifold/ directory of this repository, the usual case
#
# Writes
#   e2e/lib/testids.json      bifold's packages/core/testids.json: for the
#                             wallet's own bifold/, the file as it stands (since
#                             the fold bifold/ is a directory of this repository;
#                             while it was a submodule, the manifest at the pinned
#                             commit, the gitlink, as check-testids reads it,
#                             whatever its working tree holds); for another
#                             checkout, copied as it stands, or generated with
#                             packages/core/scripts/gen-testids.mjs when it has
#                             the generator but not the file
#   e2e/lib/testids.app.json  the same extraction over the wallet's app/src,
#                             made with that generator (gen-app-testids.mjs)
# then runs check-testids.mjs, so an id a driver names that the app no longer
# has shows up here, before CI. Commit both json files with the driver change.
#
# check-testids.mjs also fails when e2e/lib/testids.json is not bifold's (ids
# added or dropped in bifold/packages/core), so a PR that changes bifold's ids
# runs `e2e/scripts/sync-testids.sh bifold` and commits the result.
#
# The bifold checkout needs its dependencies installed (the generator imports
# `typescript` from there). A checkout from before the generator landed has
# neither file: this script says so and leaves the manifests as they are.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
e2e="$(cd "$here/.." && pwd -P)"
wallet="$(cd "$e2e/.." && pwd -P)"

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <path-to-bifold-checkout>" >&2
  exit 2
fi
# Physical paths: a symlinked parent (macOS /tmp, /var) must not make the wallet's own bifold/ look like another checkout.
bifold="$(cd "$1" && pwd -P)"
core="$bifold/packages/core"
generator="$core/scripts/gen-testids.mjs"
manifest="$core/testids.json"

mkdir -p "$e2e/lib"

# The wallet's own bifold/. Since the fold it is a directory of this repository (`:bifold` is a tree): its manifest is
# the working file, copied below as any checkout's is, and check-testids compares against that same file. While it
# was a submodule (`:bifold` a gitlink): its manifest at the commit the wallet pins, the bytes check-testids compares
# against, never its working tree, which sits elsewhere right after a pin bump until `git submodule update` (or on
# another branch entirely). Another path is a checkout someone chose, and is copied as it stands.
# The gitlink is read from the index, not HEAD: a pin bump staged with `git add bifold` and not yet committed is
# the pin being made, and resyncing against HEAD's would copy the previous pin's manifest and look fine. In CI, and
# with nothing staged, the index and HEAD agree.
pin=""
if [[ "$bifold" == "$wallet/bifold" ]]; then
  # The index's first entry under bifold: `160000 <pin> 0 bifold` for the submodule, a file of the folded tree
  # otherwise. Not `rev-parse :bifold` (a directory has no index entry) and not `cat-file -t` (a gitlink's commit is
  # not in this repository).
  # awk, not head: head closing the pipe early gives git a SIGPIPE, which pipefail turns into exit 141 under set -e.
  entry="$(git -C "$wallet" ls-files -s -- bifold 2>/dev/null | awk 'NR == 1')"
  [[ -n "$entry" ]] || { echo "no bifold in $wallet: neither a pinned submodule nor the folded bifold/ tree" >&2; exit 1; }
  [[ "${entry:0:6}" != 160000 ]] || pin="$(echo "$entry" | awk '{print $2}')"
fi
if [[ -n "$pin" ]]; then
  tmp="$(mktemp)"
  if ! git -C "$bifold" show "$pin:packages/core/testids.json" > "$tmp" 2>/dev/null; then
    rm -f "$tmp"
    echo "bifold ${pin:0:8} (the pin) has no packages/core/testids.json here: fetch it first (git submodule update --init bifold)" >&2
    exit 1
  fi
  mv "$tmp" "$e2e/lib/testids.json"
  echo "copied bifold ${pin:0:8} (the pin):packages/core/testids.json -> e2e/lib/testids.json"
  head="$(git -C "$bifold" rev-parse HEAD 2>/dev/null || true)"
  [[ "$head" == "$pin" ]] || echo "note: bifold's working tree is at ${head:0:8}, not the pin ${pin:0:8}; testids.app.json is made with that tree's generator" >&2
elif [[ ! -d "$core/src" ]]; then
  echo "not a bifold checkout: $bifold (no packages/core/src)" >&2
  exit 1
elif [[ -f "$manifest" ]]; then
  cp "$manifest" "$e2e/lib/testids.json"
  echo "copied $manifest -> e2e/lib/testids.json"
elif [[ -f "$generator" ]]; then
  node "$generator" --out "$e2e/lib/testids.json"
else
  echo "$bifold has neither packages/core/testids.json nor the generator; e2e/lib/testids.json left as is" >&2
  exit 1
fi

if [[ -f "$generator" ]]; then
  node "$here/gen-app-testids.mjs" --generator "$generator" --root "$wallet/app" --out "$e2e/lib/testids.app.json"
else
  echo "$bifold has no generator; e2e/lib/testids.app.json left as is" >&2
fi

node "$here/check-testids.mjs"
