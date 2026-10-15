#!/bin/bash
# PNM_BIN on a CI gate job (gate-ci.yml): every pnm call, the gate library's and the drivers' alike, goes through
# scripts/openvtc/pnm-locked, which runs "$PNM_BIN --vta <slug> …". This guard sits there, so no caller can reach past it:
#  - only the agents the CI configuration names (CI_ALLOWED_SLUGS: its runners and the community agent), and never a
#    person's agent (the slugs e2e/lib/aclCleanup.js refuses), even if the configuration named one;
#  - only the commands the CI legs use (CI_COMMANDS; acl create is the enrolment page granting the test phone its key,
#    which D-8 covers): the identity is a super admin on the test runners (D-10: a
#    phone's entry is an unrestricted admin, which only a super admin may delete), so this list, not the VTA, is
#    what keeps it to cleanup, the approval-rule set-up and tear-down of linkfail and the sweep, and reads;
#  - never verbose or debug output: Actions masks only exact secret strings, not what pnm derives from them;
#  - the CI identity's sessions only: PNM_HOME is forced to CI_PNM_HOME (mktemp under RUNNER_TEMP, mode 700).
# The real binary is PNM_REAL (the pnm-linux.yml build, file session store, VTI_SECURE_STORE=file).
set -u
[ "${1:-}" = --vta ] && [ -n "${2:-}" ] || { echo "pnm-ci: expected --vta <slug> first" >&2; exit 2; }
slug=$2
# Every --vta in the call, not just the first, and never the --vta=<slug> form.
prev=""
for a in "$@"; do
  case "$a" in --vta=*) echo "pnm-ci: refused: $a (give --vta <slug>)" >&2; exit 2 ;; esac
  if [ "$prev" = --vta ] && [ "$a" != "$slug" ]; then echo "pnm-ci: refused: a second --vta ($a)" >&2; exit 2; fi
  prev=$a
done
case " alice alberto3 alberto-push-vta-2 farm " in *" $slug "*) echo "pnm-ci: refused: $slug is a person's agent" >&2; exit 2 ;; esac
case " ${CI_ALLOWED_SLUGS:-} " in *" $slug "*) ;; *) echo "pnm-ci: refused: $slug is not one of the CI configuration's agents" >&2; exit 2 ;; esac
# -V/--verbose is pnm's verbose flag; -v is its short --vta (a second agent through the back door): both refused.
for a in "$@"; do case "$a" in -V|-VV|-v|-vv|--verbose|--debug|--trace) echo "pnm-ci: refused: $a (verbose output, or a second agent)" >&2; exit 2 ;; esac; done
: "${PNM_REAL:?the CI pnm binary}" "${CI_PNM_HOME:?the session directory of the CI identity}"
[ "$(stat -c %a "$CI_PNM_HOME" 2>/dev/null || stat -f %Lp "$CI_PNM_HOME")" = 700 ] || { echo "pnm-ci: $CI_PNM_HOME must be mode 700" >&2; exit 2; }
# The command, as "<command> <subcommand>": the two words after --vta <slug>.
CI_COMMANDS="acl:list acl:get acl:create acl:delete policy:list policy:get policy:upsert policy:delete approvals:list approvals:approvers approvals:remove approvals:require did-mgmt:dids contexts:list contexts:get cred-vault:query keys:list vta:qr"
cmd=${3:-}; sub=${4:-}; case "$sub" in -*) sub="" ;; esac
case " $CI_COMMANDS " in
  *" $cmd:$sub "*|*" $cmd: "*) ;;
  *) echo "pnm-ci: refused: \"$cmd $sub\" is not a command the CI legs use" >&2; exit 2 ;;
esac
# acl create is bounded to the gate's phone grant (an extension of D-8, coordinator 10-14): exactly --did <did:key or
# did:peer> --role admin --label keyring-phone|keyring-admin --expires <N>s|m|h of 24 h or less, no contexts, no
# approve, handoff or step-up flags. Every key it makes carries one of the two labels keys_since cleans, and an expiry.
if [ "$cmd:$sub" = acl:create ]; then
  did=""; role=""; label=""; exp=""; set -- "${@:5}"
  while [ $# -gt 0 ]; do
    case "$1" in
      --did) did=${2:-}; shift 2 ;;
      --role) role=${2:-}; shift 2 ;;
      --label) label=${2:-}; shift 2 ;;
      --expires) exp=${2:-}; shift 2 ;;
      *) echo "pnm-ci: refused: acl create with $1 (only --did --role --label --expires)" >&2; exit 2 ;;
    esac
  done
  case "$did" in did:key:z*|did:peer:*) ;; *) echo "pnm-ci: refused: acl create for a subject that is not a phone key" >&2; exit 2 ;; esac
  [ "$role" = admin ] || { echo "pnm-ci: refused: acl create --role $role (phone grants are admin)" >&2; exit 2; }
  case "$label" in keyring-phone|keyring-admin) ;; *) echo "pnm-ci: refused: acl create --label $label (only keyring-phone, keyring-admin)" >&2; exit 2 ;; esac
  if [[ $exp =~ ^([0-9]+)([smh])$ ]]; then
    n=${BASH_REMATCH[1]}; case ${BASH_REMATCH[2]} in s) secs=$n ;; m) secs=$((n * 60)) ;; h) secs=$((n * 3600)) ;; esac
    [ "$secs" -ge 1 ] && [ "$secs" -le 86400 ] || { echo "pnm-ci: refused: acl create --expires $exp (1 s to 24 h)" >&2; exit 2; }
  else
    echo "pnm-ci: refused: acl create needs --expires <N>s|m|h (the CI identity expires, and so must what it grants)" >&2; exit 2
  fi
  set -- --vta "$slug" acl create --did "$did" --role admin --label "$label" --expires "$exp"
fi
# No verbose output through the environment either.
# The leg's own calls go over the runner's REST service, never the mediator socket. On 15 October every TSP call of
# the linkfail rerun (38806968457) answered "Error receiving frame: RecvError" for 90 minutes: the rules the leg set and
# removed were unreadable, a case ran without its policy, and the leg hung to the job's limit before its cleanup. REST
# is the harness's control path, not what the legs test (the phone's link, DIDComm and TSP are untouched), so it is a
# fair fallback, and pnm's REST recovery path exists for exactly an unreachable mediator. The wrapper sets it, so a
# caller's own --transport is refused. The flag goes last: it belongs to the leaf command (`acl list`, `did-mgmt dids
# get`), not to pnm itself.
for a in "$@"; do case "$a" in --transport|--transport=*) echo "pnm-ci: refused: $a (the wrapper sets the transport: REST, see above)" >&2; exit 2 ;; esac; done
set -- "$@" --transport rest
unset RUST_LOG RUST_BACKTRACE PNM_VTA
PNM_HOME=$CI_PNM_HOME VTI_SECURE_STORE=file RUST_LOG=warn exec "$PNM_REAL" "$@"
