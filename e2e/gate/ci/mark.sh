#!/bin/bash
# A wall-clock mark for the CI smoke's timing table: `mark.sh <step-name>` appends "<name>\t<epoch seconds>" to
# $CI_MARKS. summary.mjs reads the marks in order and reports each step as the time to the next mark, so a
# `uses:` step is timed by a mark before it and whatever mark follows. The last mark should be "end".
set -u
: "${CI_MARKS:?CI_MARKS (the marks file)}"
printf '%s\t%s\n' "${1:?step name}" "$(date +%s)" >> "$CI_MARKS"
echo "[mark] $(date -u +%H:%M:%SZ) $1"
