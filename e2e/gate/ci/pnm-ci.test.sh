#!/bin/bash
# bash e2e/gate/ci/pnm-ci.test.sh: the CI pnm guard refuses what it must and passes a runner call through.
set -u
here=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
printf '#!/bin/bash\necho "real PNM_HOME=$PNM_HOME store=$VTI_SECURE_STORE log=$RUST_LOG $*"\n' > "$T/pnm"; chmod +x "$T/pnm"
mkdir -m 700 "$T/home"; fails=0
check() { local want=$1; shift; local out rc; out=$(RUST_LOG=debug CI_ALLOWED_SLUGS="runner-main runner-a alice" PNM_REAL=$T/pnm CI_PNM_HOME=$T/home PNM_HOME=/elsewhere "$here/pnm-ci.sh" "$@" 2>&1); rc=$?
  if [ "$want" = ok ] && [ $rc = 0 ] && [[ $out == "real PNM_HOME=$T/home store=file log=warn --vta "* ]]; then echo "ok   $*"
  elif [ "$want" = refuse ] && [ $rc = 2 ] && [[ $out == pnm-ci:* ]]; then echo "ok   refused $*"
  else echo "FAIL $want $* -> rc=$rc $out"; fails=$((fails + 1)); fi; }
check ok --vta runner-main acl list --json
check ok --vta runner-a acl list
check refuse --vta farm3-runner-prague acl list
check refuse --vta alice acl list
check refuse --vta alberto3 acl list
check refuse --vta farm acl list
check refuse --vta bob acl list
check refuse --vta runner-main --verbose acl list
check refuse acl list
check refuse --vta runner-main acl create --did did:key:x --role admin
check refuse --vta runner-main contexts create --id x
check refuse --vta runner-main keys rotate
check ok --vta runner-main approvals approvers remove gate-set did:key:x
check ok --vta runner-main policy upsert --file p.json
check refuse --vta runner-main health
check refuse --vta runner-main approvals explain acl/grant
check refuse --vta runner-main --json acl list
check refuse --vta runner-main -V acl list
check refuse --vta runner-main acl list -v alice
check refuse --vta runner-main acl list --vta alice
check refuse --vta runner-main --vta=alice acl list
chmod 755 "$T/home"; check refuse --vta runner-main acl list
exit $fails
