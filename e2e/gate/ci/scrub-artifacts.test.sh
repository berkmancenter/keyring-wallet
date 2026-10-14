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
# The file backend's shape (vta-sdk session.rs Session), one record per slug, stored as a JSON string in the map.
mkdir -p "$T/home"
rec='{"client_did":"did:key:z6MkPlantedClientDid","private_key":"zPlantedPrivateKeyMultibase0123","vta_did":"did:webvh:planted-runner-did","access_token":"planted-access-token-0123456789","access_expires_at":1,"token_origin":"https://planted.example.invalid","needs_rotation":false}'
jq -n --arg r "$rec" '{"keyring-ci-gate-farm3-runner-test": $r}' > "$T/home/sessions.json"
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
# 3. a session's access token in a binary fails; its private key in a text file fails
mkdir -p "$T/c"; printf 'x\0planted-access-token-0123456789\0' > "$T/c/dump.bin"
"$here/scrub-artifacts.sh" "$T/c" "$T/ci.env" "$T/home" >/dev/null; rc=$?
[ $rc = 1 ] && ok "session token in a binary: exit 1" || bad "session token in a binary: exit $rc"
mkdir -p "$T/d"; echo "key zPlantedPrivateKeyMultibase0123" > "$T/d/x.log"
out=$("$here/scrub-artifacts.sh" "$T/d" "$T/ci.env" "$T/home"); rc=$?
[ $rc = 1 ] && echo "$out" | grep -q 'PNM_SESSION.private_key' && ok "session private key: exit 1, named by field" || bad "session private key: exit $rc ($out)"
# 4. the session's public fields are identifiers: redacted, never a failure (the run-38493411138 false positive)
mkdir -p "$T/e"; echo "acl: did:key:z6MkPlantedClientDid on https://planted.example.invalid" > "$T/e/link.out"
out=$("$here/scrub-artifacts.sh" "$T/e" "$T/ci.env" "$T/home"); rc=$?
[ $rc = 0 ] && ! grep -q Planted "$T/e/link.out" && ok "client_did and token_origin redacted: $(cat "$T/e/link.out")" || bad "session identifiers: exit $rc, $(cat "$T/e/link.out")"
exit $fails
