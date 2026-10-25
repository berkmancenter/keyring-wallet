#!/usr/bin/env bash
# bash e2e/gate/ci/ci-env-check.test.sh: the CI lane's configuration check (ci-env-check.sh) accepts the one-runner
# shape and refuses a second runner slug, the community admin credential, a missing main slug, a missing FARM_VERSIONS,
# and linkfail without an approver DID; it never prints a value. Fake values only; no secrets, no network.
set -u
here=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fails=0
ok() { echo "ok   $*"; }
bad() { echo "FAIL $*"; fails=$((fails + 1)); }
check() { bash "$here/ci-env-check.sh" "$@" 2>&1; }

good() {
  cat > "$T/good.env" <<'EOF'
# the CI lane's configuration, fake values
RUNNER_MAIN_SLUG=farm3-runner-fake
RUNNER_MAIN_DID="did:webvh:QmFake:dids.example:keyring-runner-fake-vta"
RUNNER_MAIN_URL=https://vta-keyring-runner-fake.example
RUNNER_A_DID="did:webvh:QmOther:dids.example:keyring-runner-other-vta"
RUNNER_MEDIATOR_HOST=mediator.example
C_DID=did:webvh:QmCommunity:dids.example:community-vtc
C_NAME="Fake Community"
FARM_VERSIONS="vta-service 0.60.0 (openapi 0123456789ab, keyring-runner-fake) · checked 2026-10-15"
EOF
}

good
out=$(check "$T/good.env" smoke-android linkfail); rc=$?
[ "$rc" = 0 ] && [ -z "$out" ] && ok "the one-runner shape, with linkfail's approver DID, passes silently" || bad "good shape: rc=$rc out=$out"

good; echo 'RUNNER_A_SLUG=farm3-runner-other' >> "$T/good.env"
out=$(check "$T/good.env" smoke-android); rc=$?
[ "$rc" = 1 ] && echo "$out" | grep -q '^ENV GATE_CI_ENV names RUNNER_A_SLUG' && ok "a second runner slug is refused" || bad "second slug: rc=$rc out=$out"
echo "$out" | grep -q 'farm3-runner-other' && bad "a value was printed: $out" || ok "no value printed for the refused slug"

good; echo 'RUNNER_B_SLUG=' >> "$T/good.env"
out=$(check "$T/good.env" smoke-android); rc=$?
[ "$rc" = 1 ] && echo "$out" | grep -q 'RUNNER_B_SLUG' && ok "an empty second slug is refused too (the key must be absent)" || bad "empty B slug: rc=$rc out=$out"

good; echo 'C_ADMIN_CRED="{\"fake\":true}"' >> "$T/good.env"
out=$(check "$T/good.env" smoke-android); rc=$?
[ "$rc" = 1 ] && echo "$out" | grep -q 'C_ADMIN_CRED' && ! echo "$out" | grep -q 'fake' && ok "the community admin credential is refused, its value unprinted" || bad "C_ADMIN_CRED: rc=$rc out=$out"

good; echo 'AVD=Pixel_6_API_33' >> "$T/good.env"
out=$(check "$T/good.env" smoke-android); rc=$?
[ "$rc" = 1 ] && echo "$out" | grep -q '^ENV GATE_CI_ENV names AVD' && ok "an AVD in the configuration is refused (CI reads it from the emulator)" || bad "AVD: rc=$rc out=$out"

good; sed -i.bak '/^RUNNER_A_DID=/d' "$T/good.env"
out=$(check "$T/good.env" smoke-android linkfail); rc=$?
[ "$rc" = 1 ] && echo "$out" | grep -q '^ENV linkfail needs RUNNER_A_DID' && ok "linkfail without an approver DID is refused" || bad "linkfail no A DID: rc=$rc out=$out"
out=$(check "$T/good.env" smoke-android testreq); rc=$?
[ "$rc" = 0 ] && ok "the other legs do not need the approver DID" || bad "no linkfail: rc=$rc out=$out"

good; sed -i.bak '/^RUNNER_MAIN_SLUG=/d' "$T/good.env"
out=$(check "$T/good.env" smoke-android); rc=$?
[ "$rc" = 1 ] && echo "$out" | grep -q 'no RUNNER_MAIN_SLUG' && ok "a missing main slug is refused" || bad "no main: rc=$rc out=$out"

good; sed -i.bak '/^FARM_VERSIONS=/d' "$T/good.env"
out=$(check "$T/good.env" smoke-android); rc=$?
[ "$rc" = 1 ] && echo "$out" | grep -q 'no FARM_VERSIONS' && ok "a missing FARM_VERSIONS is refused" || bad "no FARM_VERSIONS: rc=$rc out=$out"

out=$(check "$T/missing.env" smoke-android); rc=$?
[ "$rc" = 1 ] && echo "$out" | grep -q 'no configuration file' && ok "a missing file is refused" || bad "missing file: rc=$rc out=$out"

exit $fails
