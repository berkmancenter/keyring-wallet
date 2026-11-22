#!/usr/bin/env bash
# Regenerates the throw-away Android-style leaf certificates pasted into keyDescription.test.ts and prints them.
# Each carries a key-description extension (OID 1.3.6.1.4.1.11129.2.1.17) built by hand below, in one of the shapes the
# verifier must tell apart. Test-only EC P-256 keys, never used for anything else.
set -euo pipefail
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
python3 - "$work" <<'PY'
import sys, os
out = sys.argv[1]

def length(n):
    if n < 0x80: return bytes([n])
    b = n.to_bytes((n.bit_length() + 7) // 8, 'big')
    return bytes([0x80 | len(b)]) + b
def tlv(tag, body): return bytes(tag) + length(len(body)) + body
def integer(v): return tlv([0x02], v.to_bytes(max(1, (v.bit_length() + 8) // 8), 'big'))
def enum(v): return tlv([0x0A], bytes([v]))
def octets(b): return tlv([0x04], b)
def seq(*items): return tlv([0x30], b''.join(items))
def setof(*items): return tlv([0x31], b''.join(items))
def ctx(n, body):
    # [n] EXPLICIT, context-specific constructed; high tag numbers in base 128.
    if n < 31: return tlv([0xA0 | n], body)
    digits = []
    while True:
        digits.insert(0, n & 0x7F); n >>= 7
        if not n: break
    tag = [0xBF] + [d | 0x80 for d in digits[:-1]] + [digits[-1]]
    return tlv(tag, body)
NULL = bytes([0x05, 0x00])
PURPOSE = ctx(1, setof(integer(2)))
ALGORITHM = ctx(2, integer(3))
def key_description(software, tee, level=1):
    # attestationSecurityLevel and keymasterSecurityLevel: 0 Software, 1 TrustedEnvironment, 2 StrongBox.
    return seq(integer(3), enum(level), integer(4), enum(level), octets(b'challenge'), octets(b''), seq(*software), seq(*tee))
shapes = {
  'auth_required': key_description([], [PURPOSE, ALGORITHM, ctx(504, integer(2)), ctx(505, integer(0))]),
  'auth_required_strongbox': key_description([], [PURPOSE, ALGORITHM, ctx(504, integer(2)), ctx(505, integer(0))], 2),
  'software_level': key_description([], [PURPOSE, ALGORITHM, ctx(504, integer(2)), ctx(505, integer(0))], 0),
  'no_auth_required': key_description([], [PURPOSE, ALGORITHM, ctx(503, NULL)]),
  'no_auth_required_in_software': key_description([ctx(503, NULL)], [PURPOSE, ALGORITHM, ctx(504, integer(2))]),
  'user_auth_missing': key_description([], [PURPOSE, ALGORITHM]),
  'user_auth_zero': key_description([], [PURPOSE, ALGORITHM, ctx(504, integer(0))]),
  'user_auth_enumerated': key_description([], [PURPOSE, ALGORITHM, ctx(504, enum(2)), ctx(505, integer(0))]),
  'user_auth_wrong_type': key_description([], [PURPOSE, ALGORITHM, ctx(504, octets(bytes([2])))]),
  'user_auth_software_only': key_description([ctx(504, integer(2))], [PURPOSE, ALGORITHM]),
}
for name, der in shapes.items():
    open(os.path.join(out, name + '.hex'), 'w').write(der.hex())
PY
for f in "$work"/*.hex; do
  name=$(basename "$f" .hex)
  openssl ecparam -name prime256v1 -genkey -noout -out "$work/$name.key"
  openssl req -new -x509 -key "$work/$name.key" -subj "/CN=Android Keystore Key" -days 3650 \
    -addext "1.3.6.1.4.1.11129.2.1.17=DER:$(cat "$f")" -out "$work/$name.pem" 2>/dev/null
  echo "== $name"; cat "$work/$name.pem"
done
openssl ecparam -name prime256v1 -genkey -noout -out "$work/plain.key"
openssl req -new -x509 -key "$work/plain.key" -subj "/CN=No Key Description" -days 3650 -out "$work/plain.pem" 2>/dev/null
echo "== no_extension"; cat "$work/plain.pem"
