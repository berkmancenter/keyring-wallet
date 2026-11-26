#!/usr/bin/env bash
# Fetch the proposal and HCP's spec at the commits this rung was written against, and build the
# proposal's TypeScript libraries. Everything lands in .upstream/ (git-ignored). Read-only use:
# nothing here is pushed anywhere.
set -euo pipefail
cd "$(dirname "$0")"
TT_REPO=https://github.com/trustoverip/dtgwg-trust-tasks-tf.git
TT_PR=1382                                   # the demos PR; it contains the suite (#1380)
TT_SHA=e163cac1d                             # its head on 2026-11-25
HCP_REPO=https://github.com/loyalagents/hcp-spec.git
HCP_SHA=b790561                              # the commit the proposal cites
mkdir -p .upstream
if [ ! -d .upstream/tt/.git ]; then git clone -q --filter=blob:none --no-checkout "$TT_REPO" .upstream/tt; fi
git -C .upstream/tt fetch -q origin "refs/pull/$TT_PR/head"
git -C .upstream/tt checkout -q "$TT_SHA"
if [ ! -d .upstream/hcp-spec/.git ]; then git clone -q "$HCP_REPO" .upstream/hcp-spec; fi
git -C .upstream/hcp-spec checkout -q "$HCP_SHA"
for lib in trust-tasks-ts trust-tasks-ts-proof trust-tasks-ts-tsp; do
  (cd ".upstream/tt/$lib" && npm install --no-audit --no-fund --silent && npm run -s build)
done
echo "upstream ready: trust-tasks-tf $(git -C .upstream/tt rev-parse --short HEAD), hcp-spec $(git -C .upstream/hcp-spec rev-parse --short HEAD)"
