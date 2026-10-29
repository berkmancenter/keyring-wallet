#!/usr/bin/env bash
# Fails if a JS bundle carries rooms' sample data. Bifold's sample module
# (modules/rooms/sample/sampleRooms) uses the marker ROOMS_SAMPLE_DATA at runtime;
# a store or CI build resolves that module to app/metro/roomsSampleStub.ts
# (ROOMS_SAMPLE unset), so the marker must be absent from every bundle this
# script is given. It inspects the build's output, independent of the store
# workflow's refusal of the ROOMS_SAMPLE switch itself.
#
#   scripts/ci/check-no-rooms-sample.sh <bundle-file> [<label>]
set -euo pipefail
bundle="${1:?usage: check-no-rooms-sample.sh <bundle-file> [label]}"
label="${2:-$bundle}"
if [[ ! -s "$bundle" ]]; then
  echo "::error::no bundle to check at ${bundle}" >&2
  exit 2
fi
if grep -q 'ROOMS_SAMPLE_DATA' "$bundle"; then
  echo "::error::${label}: rooms sample data is in this bundle (ROOMS_SAMPLE_DATA found). A store or CI build must not carry it." >&2
  exit 1
fi
echo "${label}: no rooms sample data"
