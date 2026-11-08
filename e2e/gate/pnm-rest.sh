#!/bin/bash
# PNM_BIN for the Mac gates (IN-560: Alberto's "yes" to REST, 11-08). Every pnm call of the gate library and the
# drivers, through pnm-locked or not (the enrolment page, run-askme, run-release-235 run $PNM_BIN directly), goes to the
# runner over REST: HTTPS with pnm's cached token, so no TSP relationship (session.relate) and no mediator socket per
# call, the Farm operator's top two asks. The CI lane does the same (ci/pnm-ci.sh). One read on prague, 11-08: REST
# 3.9 s, the default transport 6.4 s, the same answer.
#
#   PNM_INNER   the real pnm this wraps: the gate's per-runner wrapper (~/vti-stack/pins/gate-pnm3 or gate-pnm2), which
#               picks pnm 0.46 or 0.47 per runner; both have --transport rest.
#   PNM_TRANSPORT=auto   a leg that tests pnm's own DIDComm or TSP path exports it: no transport is added.
#   A caller that names --transport itself keeps it, unchanged.
#
# Per runner, by value (never a roster): when REST fails at the transport level for a slug (no REST route, refused,
# not resolved, a TLS failure), that call is made again with the default transport, and the slug stays on the default
# for GATE_PNM_REST_RETRY_S (24 h) in $GATE_PNM_TRANSPORT_DIR/<slug>, said on stderr. A timeout is ambiguous (a write may
# have landed), so only a read is retried after one. Any other failure is pnm's answer, returned as it is.
set -u
INNER=${PNM_INNER:?pnm-rest: PNM_INNER names the pnm this wraps}
[ "${1:-}" = --vta ] && [ -n "${2:-}" ] || exec "$INNER" "$@"
slug=$2
for a in "$@"; do case "$a" in --transport | --transport=*) exec "$INNER" "$@" ;; esac; done
[ "${PNM_TRANSPORT:-rest}" = rest ] || exec "$INNER" "$@"
DIR=${GATE_PNM_TRANSPORT_DIR:-${GATE_HOME:-$HOME/.keyring-fleet/gate}/pnm-transport}
mark=$DIR/$slug
if [ -f "$mark" ] && [ $(( $(date +%s) - $(stat -f %m "$mark" 2>/dev/null || stat -c %Y "$mark") )) -lt "${GATE_PNM_REST_RETRY_S:-86400}" ]; then
  exec "$INNER" "$@"
fi
cmd=${3:-}; sub=${4:-}
out=$(mktemp); err=$(mktemp); trap 'rm -f "$out" "$err"' EXIT
"$INNER" "$@" --transport rest > "$out" 2> "$err"; rc=$?
if [ $rc -eq 0 ]; then cat "$out"; cat "$err" >&2; exit 0; fi
# pnm's own error lines only (stderr), never its output: a record's content ("certificate", "not resolve") must not
# switch REST off for the slug (ac on #877).
both=$(cat "$err")
# Never reached the runner: safe to make again, write or read. A 404 means the server answered, so it is not here: a
# record pnm cannot find is its own "Not found", and a runner with no REST says so ("no REST", "does not advertise").
pre='connection refused|Connection refused|error sending request|dns error|failed to lookup|not resolve|no REST|VTARest|does not advertise|REST (endpoint|transport) (is )?(not|un)|certificate|tls handshake'
# Reached it or may have: only a read is made again.
amb='timed out|deadline has elapsed|operation timed out'
read_cmd=0; case "$cmd:$sub" in *:list | *:get | *:info | health:* | did-mgmt:dids) read_cmd=1 ;; esac
[ "$cmd:$sub" = did-mgmt:dids ] && case "${5:-}" in list | get | get-log) ;; *) read_cmd=0 ;; esac
if printf '%s' "$both" | grep -q -E "$pre" || { [ $read_cmd = 1 ] && printf '%s' "$both" | grep -q -E "$amb"; }; then
  why=$(printf '%s' "$both" | grep -m1 -E "$pre|$amb" | cut -c1-140)
  mkdir -p "$DIR" && printf '%s\t%s\n' "$(date -u +%FT%TZ)" "$why" > "$mark"
  echo "[pnm-rest] $slug: REST failed ($why): this call again with the default transport, and $slug stays on it for $(( ${GATE_PNM_REST_RETRY_S:-86400} / 3600 )) h" >&2
  exec "$INNER" "$@"
fi
cat "$out"; cat "$err" >&2; exit $rc
