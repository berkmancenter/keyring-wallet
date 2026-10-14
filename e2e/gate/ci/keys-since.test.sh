#!/bin/bash
# bash e2e/gate/ci/keys-since.test.sh: a phone key granted through the CI guard (pnm-ci.sh acl create) is found and
# deleted by the leg cleanup (lib.sh keys_since), and nothing else is: not the CI identity's own entry, not an older
# key, not another label. A fake VTA (PNM_REAL) keeps a real ACL in a JSON file.
set -u
here=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; fails=0
ok() { echo "ok   $*"; }; bad() { echo "FAIL $*"; fails=$((fails + 1)); }
cat > "$T/vta" <<'PY'
#!/usr/bin/env python3
import json, sys, os, datetime
store = os.environ['FAKE_ACL']; a = sys.argv[1:]
acl = json.load(open(store))
def now(): return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')
i = a.index('acl')
cmd = a[i + 1]
if cmd == 'list': print(json.dumps(acl))
elif cmd == 'create':
    o = dict(zip(a[i + 2::2], a[i + 3::2]))
    acl.append({'subject': o['--did'], 'role': o['--role'], 'label': o['--label'], 'createdAt': now()}); print('created')
elif cmd == 'delete':
    acl = [e for e in acl if e['subject'] != a[i + 2]]; print('deleted')
json.dump(acl, open(store, 'w'))
with open(store + '.calls', 'a') as f: f.write(' '.join(a[i:]) + '\n')
PY
chmod +x "$T/vta"
echo '[{"subject":"did:key:zOld","label":"keyring-admin","createdAt":"2026-01-01T00:00:00Z"},{"subject":"did:key:zCi","label":"keyring-ci-gate","createdAt":"2026-01-01T00:00:00Z"}]' > "$T/acl.json"
mkdir -m 700 "$T/home"; mkdir -p "$T/gate"
export FAKE_ACL=$T/acl.json PNM_REAL=$T/vta CI_PNM_HOME=$T/home CI_ALLOWED_SLUGS="runner-main" GATE_TARGET=ci \
  GATE_HOME=$T/gate PNM_BIN=$here/pnm-ci.sh PNM_LOCK_DIR=$T/locks RUN_DIR=$T/gate
out=$(bash -c '
  . "'"$here"'/../lib.sh"
  sleep() { :; }
  T0=$(stamp)
  "$PNM_BIN" --vta runner-main acl create --did did:key:zPhoneA --role admin --label keyring-phone --expires 1h >/dev/null
  "$PNM_BIN" --vta runner-main acl create --did did:key:zPhoneB --role admin --label keyring-admin --expires 6h >/dev/null
  # The phone rotates onto its long-term key (labelled with the device name, created by the grant), as a link does,
  # and the link driver keeps it; beside it, a key some other client made during the leg, and an older key that
  # zPhoneB once created (before the leg: never this leg'"'"'s).
  python3 - "$FAKE_ACL" "$T0" <<PY2
import json,sys
p,t0=sys.argv[1],sys.argv[2]; acl=json.load(open(p))
acl.append({"subject":"did:peer:2.zHeirB","label":"Computer","createdBy":"did:key:zPhoneB","createdAt":t0[:19]+".999999Z"})
acl.append({"subject":"did:key:zElse","label":"Someone else","createdBy":"did:key:zCi","createdAt":t0[:19]+".999999Z"})
acl.append({"subject":"did:peer:2.zOldHeir","label":"Computer","createdBy":"did:key:zPhoneB","createdAt":"2026-01-02T00:00:00Z"})
json.dump(acl,open(p,"w"))
PY2
  keys_since runner-main "$T0"
' 2>&1)
left=$(python3 -c "import json;print(' '.join(sorted(e['subject'] for e in json.load(open('$T/acl.json')))))")
[ "$left" = "did:key:zCi did:key:zElse did:key:zOld did:peer:2.zOldHeir" ] && ok "cleanup deleted both CI-granted phone keys and the key the phone rotated onto; kept the CI entry, another client's key and the older keys ($left)" || bad "left: $left; output: $out"
grep -q 'acl delete did:peer:2.zHeirB' "$T/acl.json.calls" && ok "the kept phone key (created by this leg's grant) was deleted" || bad "the kept phone key was not deleted: $(cat "$T/acl.json.calls")"
grep -q 'acl delete did:key:zPhoneA' "$T/acl.json.calls" && grep -q 'acl delete did:key:zPhoneB' "$T/acl.json.calls" && ok "deletes went through the CI guard" || bad "calls: $(cat "$T/acl.json.calls")"
! grep -qE 'acl delete (did:key:z(Ci|Old|Else)|did:peer:2.zOldHeir)' "$T/acl.json.calls" && ok "never asked to delete the CI identity, another client's key or an older key" || bad "deleted something it should not"
exit $fails
