#!/bin/sh
# Re-run the whole track in order. Reads hcp-spec/, tt-drift/ and tt/ (git show pr1381) only; writes out/.
set -e
cd "$(dirname "$0")"
node extract-hcp-examples.mjs > out/hcp-examples.log
node dump-unchecked.mjs
node compare.mjs > out/compare-summary.txt
node classify.mjs
node unchecked-coverage.mjs > out/unchecked-coverage.txt
node vectors-hcp-to-tt.mjs > /dev/null
node vectors-tt-to-hcp.mjs > /dev/null
node vectors-edge.mjs > /dev/null
node vectors-mcp.mjs > /dev/null
node report-tables.mjs
