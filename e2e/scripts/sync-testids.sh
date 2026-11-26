#!/usr/bin/env bash
# Brings the e2e harness's testID manifests up to date with the framework's.
#
#   e2e/scripts/sync-testids.sh                 # this repository's packages/core, the usual case
#   e2e/scripts/sync-testids.sh <path-to-another-checkout>   # a checkout whose packages/core/ to read instead
#
# Writes
#   e2e/lib/testids.json      packages/core/testids.json: for this repository,
#                             the file as it stands (since the fold the
#                             framework is a directory of this repository; while
#                             it was the bifold submodule, the manifest at the
#                             pinned commit, as check-testids read it); for
#                             another checkout, copied as it stands, or generated
#                             with its packages/core/scripts/gen-testids.mjs when
#                             it has the generator but not the file
#   e2e/lib/testids.app.json  the same extraction over the wallet's app/src,
#                             made with that generator (gen-app-testids.mjs)
# then runs check-testids.mjs, so an id a driver names that the app no longer
# has shows up here, before CI. Commit both json files with the driver change.
#
# check-testids.mjs also fails when e2e/lib/testids.json is not the framework's
# (ids added or dropped in packages/core), so a PR that changes the framework's
# ids runs `e2e/scripts/sync-testids.sh` and commits the result.
#
# The checkout needs its dependencies installed (the generator imports
# `typescript` from there). A checkout from before the generator landed has
# neither file: this script says so and leaves the manifests as they are.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
e2e="$(cd "$here/.." && pwd -P)"
wallet="$(cd "$e2e/.." && pwd -P)"

if [[ $# -gt 1 ]]; then
  echo "usage: $0 [<path-to-another-checkout>]" >&2
  exit 2
fi
# Physical paths: a symlinked parent (macOS /tmp, /var) must not make this repository look like another checkout.
# No argument: this repository. `bifold` (the pre-fold spelling) and `.` name it too.
if [[ $# -eq 0 || "$1" == "bifold" || "$1" == "." ]]; then
  checkout="$wallet"
else
  checkout="$(cd "$1" && pwd -P)"
fi
core="$checkout/packages/core"
generator="$core/scripts/gen-testids.mjs"
manifest="$core/testids.json"

mkdir -p "$e2e/lib"

# This repository's packages/core: its manifest is the working file, copied as any checkout's is, and check-testids
# compares against that same file (since the fold the framework is a directory of this repository; while it was the
# bifold submodule this script read the manifest at the pinned commit, from the index, never the submodule's working
# tree, which could sit elsewhere). Another path is a checkout someone chose, copied as it stands.
if [[ ! -d "$core/src" ]]; then
  echo "not a Keyring checkout: $checkout (no packages/core/src)" >&2
  exit 1
elif [[ -f "$manifest" ]]; then
  cp "$manifest" "$e2e/lib/testids.json"
  echo "copied $manifest -> e2e/lib/testids.json"
elif [[ -f "$generator" ]]; then
  node "$generator" --out "$e2e/lib/testids.json"
else
  echo "$checkout has neither packages/core/testids.json nor the generator; e2e/lib/testids.json left as is" >&2
  exit 1
fi

if [[ -f "$generator" ]]; then
  node "$here/gen-app-testids.mjs" --generator "$generator" --root "$wallet/app" --out "$e2e/lib/testids.app.json"
else
  echo "$checkout has no generator; e2e/lib/testids.app.json left as is" >&2
fi

node "$here/check-testids.mjs"
