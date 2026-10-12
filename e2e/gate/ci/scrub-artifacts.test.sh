#!/bin/bash
# bash e2e/gate/ci/scrub-artifacts.test.sh: planted values are caught (credentials) or redacted (identifiers).
set -u
here=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; fails=0
ok() { echo "ok   $*"; }; bad() { echo "FAIL $*"; fails=$((fails + 1)); }
cat > "$T/ci.env" <<'E'
RUNNER_MAIN_SLUG="farm3-runner-test"
RUNNER_MAIN_DID="did:webvh:planted-runner-did"
RUNNER_MAIN_URL="https://planted.example.invalid/vta"
C_ADMIN_CRED="planted-admin-credential-value"
FARM_VERSIONS="vta-service 0.56.0"
E
mkdir -p "$T/home" && echo '{"token":"planted-session-token-0123456789"}' > "$T/home/s.json"
# 1. identifiers only: redacted in text, binary removed, exit 0
mkdir -p "$T/a"; echo "linked farm3-runner-test at https://planted.example.invalid/vta (did:webvh:planted-runner-did)" > "$T/a/leg.log"
printf 'PNG\0\0did:webvh:planted-runner-did\0' > "$T/a/shot.png"
out=$("$here/scrub-artifacts.sh" "$T/a" "$T/ci.env" "$T/home"); rc=$?
[ $rc = 0 ] && ok "identifiers only: exit 0" || bad "identifiers only: exit $rc"
grep -q 'planted' "$T/a/leg.log" && bad "an identifier survived: $(cat "$T/a/leg.log")" || ok "identifiers redacted: $(cat "$T/a/leg.log")"
[ ! -e "$T/a/shot.png" ] && ok "binary holding a DID removed" || bad "binary kept"
# 2. a credential in a text file fails, without printing it
mkdir -p "$T/b"; echo "admin cred planted-admin-credential-value" > "$T/b/driver.out"
out=$("$here/scrub-artifacts.sh" "$T/b" "$T/ci.env" "$T/home"); rc=$?
[ $rc = 1 ] && ok "credential in a log: exit 1" || bad "credential in a log: exit $rc"
echo "$out" | grep -q 'planted-admin' && bad "the report printed the value" || ok "report names the key only: $(echo "$out" | head -1)"
# 3. a pnm session string in a binary fails
mkdir -p "$T/c"; printf 'x\0planted-session-token-0123456789\0' > "$T/c/dump.bin"
"$here/scrub-artifacts.sh" "$T/c" "$T/ci.env" "$T/home" >/dev/null; rc=$?
[ $rc = 1 ] && ok "session token in a binary: exit 1" || bad "session token in a binary: exit $rc"
exit $fails
