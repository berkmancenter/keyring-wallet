#!/bin/bash
# bash e2e/gate/ci/keys-since.test.sh: a phone key granted through the CI guard (pnm-ci.sh acl create), and the key the
# phone rotates onto, are found and deleted by the leg cleanup (lib.sh keys_since), and nothing else is: not the CI
# identity's own entry, not an older key, not another label. The fake VTA keeps a real ACL in a JSON file, in the
# shape the Farm's runners answer with (10-14): every grant and rotated key labelled keyring-admin and created by the
# runner's admin, times as +00:00, and pnm's coloured warning ahead of the list (CI run 38512195471 lost every
# cleanup to the "[" of an ANSI escape). Then an unreadable list: said, nothing deleted.
set -u
here=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; fails=0
ok() { echo "ok   $*"; }; bad() { echo "FAIL $*"; fails=$((fails + 1)); }
cat > "$T/vta" <<'PY'
#!/usr/bin/env python3
import json, sys, os, datetime
store = os.environ['FAKE_ACL']; a = sys.argv[1:]
acl = json.load(open(store))
def now(): return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+00:00')
i = a.index('acl')
cmd = a[i + 1]
if cmd == 'list':
    sys.stderr.write('\x1b[38;5;214mWARN\x1b[0m session cache is old\n'); sys.stderr.flush()
    print('{"broken": [' if os.environ.get('FAKE_GARBLE') else json.dumps(acl, indent=2))
elif cmd == 'create':
    o = dict(zip(a[i + 2::2], a[i + 3::2]))
    acl.append({'subject': o['--did'], 'role': o['--role'], 'label': o['--label'], 'createdBy': 'did:key:zRunnerAdmin', 'createdAt': now()}); print('created')
elif cmd == 'delete':
    acl = [e for e in acl if e['subject'] != a[i + 2]]; print('ACL entry deleted: ' + a[i + 2])
json.dump(acl, open(store, 'w'))
with open(store + '.calls', 'a') as f: f.write(' '.join(a[i:]) + '\n')
PY
chmod +x "$T/vta"
echo '[{"subject":"did:key:zOld","label":"keyring-admin","createdBy":"did:key:zRunnerAdmin","createdAt":"2026-01-01T00:00:00+00:00"},{"subject":"did:key:zCi","label":"keyring-ci-gate","createdBy":"did:key:zRunnerAdmin","createdAt":"2026-01-01T00:00:00+00:00"}]' > "$T/acl.json"
mkdir -m 700 "$T/home"; mkdir -p "$T/gate"
export FAKE_ACL=$T/acl.json PNM_REAL=$T/vta CI_PNM_HOME=$T/home CI_ALLOWED_SLUGS="runner-main" GATE_TARGET=ci \
  GATE_HOME=$T/gate PNM_BIN=$here/pnm-ci.sh PNM_LOCK_DIR=$T/locks RUN_DIR=$T/gate
out=$(bash -c '
  . "'"$here"'/../lib.sh"
  sleep() { :; }
  T0=$(stamp)
  "$PNM_BIN" --vta runner-main acl create --did did:key:zPhoneA --role admin --label keyring-phone --expires 1h >/dev/null
  "$PNM_BIN" --vta runner-main acl create --did did:key:zPhoneB --role admin --label keyring-admin --expires 6h >/dev/null
  # The phone rotates onto its long-term key: a did:peer the runner admin labels keyring-admin.
  python3 - "$FAKE_ACL" <<PY2
import json,sys,datetime
p=sys.argv[1]; acl=json.load(open(p))
acl.append({"subject":"did:peer:2.zRotatedB","label":"keyring-admin","createdBy":"did:key:zRunnerAdmin","createdAt":datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")})
json.dump(acl,open(p,"w"))
PY2
  keys_since runner-main "$T0"; echo "rc=$?"
' 2>&1)
left=$(python3 -c "import json;print(' '.join(sorted(e['subject'] for e in json.load(open('$T/acl.json')))))")
[ "$left" = "did:key:zCi did:key:zOld" ] && ok "with pnm's coloured warning ahead of the list: both CI grants and the rotated key deleted; the CI entry and the older key kept ($left)" || bad "left: $left; output: $out"
grep -q 'acl delete did:peer:2.zRotatedB' "$T/acl.json.calls" && ok "the phone's rotated key (did:peer, keyring-admin) was deleted" || bad "rotated key not deleted: $(cat "$T/acl.json.calls")"
grep -q 'acl delete did:key:zPhoneA' "$T/acl.json.calls" && grep -q 'acl delete did:key:zPhoneB' "$T/acl.json.calls" && ok "deletes went through the CI guard" || bad "calls: $(cat "$T/acl.json.calls")"
! grep -qE 'acl delete did:key:z(Ci|Old)' "$T/acl.json.calls" && ok "never asked to delete the CI identity or an older key" || bad "deleted something it should not"
echo "$out" | grep -q '^rc=0' && ! echo "$out" | grep -qE 'Traceback|JSONDecodeError|CLEANUP-FAILED' && ok "no parse error, no CLEANUP-FAILED, rc 0" || bad "output: $out"
# An ACL list that cannot be read: said on a CLEANUP-FAILED line, nothing deleted, keys_since fails.
echo '[{"subject":"did:key:zOld","label":"keyring-admin","createdBy":"did:key:zRunnerAdmin","createdAt":"2026-01-01T00:00:00+00:00"}]' > "$T/acl.json"; : > "$T/acl.json.calls"
out2=$(FAKE_GARBLE=1 bash -c '
  . "'"$here"'/../lib.sh"
  sleep() { :; }
  keys_since runner-main "$(stamp)"; echo "rc=$?"
' 2>&1)
echo "$out2" | grep -q '^CLEANUP-FAILED runner-main keys: the ACL list could not be read in 4 tries' && echo "$out2" | grep -q '^rc=1' && ok "an unreadable list is said on a CLEANUP-FAILED line, and keys_since fails" || bad "unreadable list: $out2"
! grep -q 'acl delete' "$T/acl.json.calls" && ok "nothing deleted from an unreadable list" || bad "deleted from an unreadable list"
exit $fails
