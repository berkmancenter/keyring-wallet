#!/usr/bin/env bash
# ci-env-check.sh <gate-ci.env> <legs…>: is the CI lane's configuration the shape the CI identity may use?
#
# The CI identity is a 30-day runner admin on the CI lane's own runner, nothing else (gate-efficiency item 11). Its
# configuration (the GATE_CI_ENV secret, written to a file by gate-ci.yml) therefore names exactly ONE runner: a
# RUNNER_MAIN_SLUG, and no RUNNER_A_SLUG or RUNNER_B_SLUG. CI_ALLOWED_SLUGS and the sweep (lib.sh) take their runners
# from these three, so a second slug here would point the CI identity at the Mac lane's runners, where two identities
# collide on one ACL and one rate limit. The one leg that names a second runner, linkfail, needs RUNNER_A_DID as a DID
# in its approver set only, never as an agent pnm reaches: that DID must be present when linkfail runs, so the leg
# stops here as ENV rather than at its first rule. The community admin credential never travels (D-8).
#
# Prints one "ENV …" line per problem, key names only (never a value), and exits 1; exits 0 when the shape is right.
set -u
file=${1:-}; shift || true
[ -n "$file" ] && [ -r "$file" ] || { echo "ENV ci-env-check: no configuration file"; exit 1; }
legs=" $* "
has() { grep -qE "^$1=\"?[^\"[:space:]]" "$file"; }   # the key, with a non-empty value
set_at_all() { grep -qE "^$1=" "$file"; }
bad=0
say() { echo "ENV $*"; bad=1; }
has RUNNER_MAIN_SLUG || say "GATE_CI_ENV names no RUNNER_MAIN_SLUG: the CI lane's runner"
for k in RUNNER_A_SLUG RUNNER_B_SLUG; do
  set_at_all "$k" && say "GATE_CI_ENV names $k: the CI identity is admin on one runner only (item 11), so a second slug would point it at another lane's runner"
done
set_at_all C_ADMIN_CRED && say "GATE_CI_ENV holds C_ADMIN_CRED: the community admin credential is not part of the CI identity (D-8)"
case "$legs" in *" linkfail "*) has RUNNER_A_DID || say "linkfail needs RUNNER_A_DID (a DID for its approver set, no slug), which GATE_CI_ENV lacks" ;; esac
has FARM_VERSIONS || say "GATE_CI_ENV names no FARM_VERSIONS: the drift guard has nothing to compare"
exit $bad
