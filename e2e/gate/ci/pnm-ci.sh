#!/bin/bash
# PNM_BIN on a CI gate job (gate-ci.yml): every pnm call, the gate library's and the drivers' alike, goes through
# scripts/openvtc/pnm-locked, which runs "$PNM_BIN --vta <slug> …". This guard sits there, so no caller can reach past it:
#  - only the agents the CI configuration names (CI_ALLOWED_SLUGS: its runners and the community agent), and never a
#    person's agent (the slugs e2e/lib/aclCleanup.js refuses), even if the configuration named one;
#  - never verbose or debug output: Actions masks only exact secret strings, not what pnm derives from them;
#  - the CI identity's sessions only: PNM_HOME is forced to CI_PNM_HOME (mktemp under RUNNER_TEMP, mode 700).
# The real binary is PNM_REAL (the pnm-linux.yml build, file session store, VTI_SECURE_STORE=file).
set -u
[ "${1:-}" = --vta ] && [ -n "${2:-}" ] || { echo "pnm-ci: expected --vta <slug> first" >&2; exit 2; }
slug=$2
case " alice alberto3 alberto-push-vta-2 farm " in *" $slug "*) echo "pnm-ci: refused: $slug is a person's agent" >&2; exit 2 ;; esac
case " ${CI_ALLOWED_SLUGS:-} " in *" $slug "*) ;; *) echo "pnm-ci: refused: $slug is not one of the CI configuration's agents" >&2; exit 2 ;; esac
for a in "$@"; do case "$a" in -v|-vv|-vvv|--verbose|--debug|--trace) echo "pnm-ci: refused: $a (pnm's verbose output is not masked)" >&2; exit 2 ;; esac; done
: "${PNM_REAL:?the CI pnm binary}" "${CI_PNM_HOME:?the session directory of the CI identity}"
[ "$(stat -c %a "$CI_PNM_HOME" 2>/dev/null || stat -f %Lp "$CI_PNM_HOME")" = 700 ] || { echo "pnm-ci: $CI_PNM_HOME must be mode 700" >&2; exit 2; }
PNM_HOME=$CI_PNM_HOME VTI_SECURE_STORE=file exec "$PNM_REAL" "$@"
