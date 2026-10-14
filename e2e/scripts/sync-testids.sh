#!/usr/bin/env bash
# Brings the e2e harness's testID manifests up to date with a bifold checkout.
#
#   e2e/scripts/sync-testids.sh <path-to-bifold-checkout>
#   e2e/scripts/sync-testids.sh bifold          # the submodule, the usual case
#
# Writes
#   e2e/lib/testids.json      bifold's packages/core/testids.json (copied; or
#                             generated with packages/core/scripts/gen-testids.mjs
#                             when the checkout has the generator but not the file)
#   e2e/lib/testids.app.json  the same extraction over the wallet's app/src,
#                             made with that generator (gen-app-testids.mjs)
# then runs check-testids.mjs, so an id a driver names that the app no longer
# has shows up here, before CI. Commit both json files with the driver change.
#
# The bifold checkout needs its dependencies installed (the generator imports
# `typescript` from there). A checkout from before the generator landed has
# neither file: this script says so and leaves the manifests as they are.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
e2e="$(cd "$here/.." && pwd)"
wallet="$(cd "$e2e/.." && pwd)"

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <path-to-bifold-checkout>" >&2
  exit 2
fi
bifold="$(cd "$1" && pwd)"
core="$bifold/packages/core"
generator="$core/scripts/gen-testids.mjs"
manifest="$core/testids.json"

if [[ ! -d "$core/src" ]]; then
  echo "not a bifold checkout: $bifold (no packages/core/src)" >&2
  exit 1
fi

mkdir -p "$e2e/lib"

if [[ -f "$manifest" ]]; then
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
