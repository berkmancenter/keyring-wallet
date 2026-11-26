#!/usr/bin/env bash
# Regenerates the openssl certificate chains used by GoogleAttestationChainValidatorTest.
# Test-only material: throw-away EC P-256 keys, never used for anything else.
# Validity windows are absolute so the tests can pass an explicit "now"
# (2026-09-30T00:00:00Z) and stay deterministic.
set -euo pipefail
cd "$(dirname "$0")"
out=chains
rm -rf "$out"; mkdir -p "$out"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT

# mk <name> <root-subject> <root-start> <root-end> <int-start> <int-end> <leaf-start> <leaf-end>
mk() {
  local n=$1 rsub=$2 rs=$3 re=$4 is=$5 ie=$6 ls=$7 le=$8
  local d="$work/$n"; mkdir -p "$d"; : > "$d/index.txt"; echo 1000 > "$d/serial"
  cat > "$d/ca.cnf" <<CNF
[ca]
default_ca = c
[c]
database = $d/index.txt
new_certs_dir = $d
serial = $d/serial
default_md = sha256
policy = p
unique_subject = no
copy_extensions = none
[p]
commonName = optional
serialNumber = optional
[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
[v3_leaf]
basicConstraints = CA:FALSE
CNF
  for k in root int leaf; do openssl ecparam -name prime256v1 -genkey -noout -out "$d/$k.key"; done
  openssl req -new -key "$d/root.key" -subj "$rsub" -out "$d/root.csr"
  openssl ca -batch -config "$d/ca.cnf" -selfsign -keyfile "$d/root.key" -in "$d/root.csr" \
    -startdate "$rs" -enddate "$re" -extensions v3_ca -notext -out "$d/root.pem" 2>/dev/null
  openssl req -new -key "$d/int.key" -subj "/CN=$n intermediate" -out "$d/int.csr"
  openssl x509 -in "$d/root.pem" -out "$d/root.pem"
  openssl ca -batch -config "$d/ca.cnf" -cert "$d/root.pem" -keyfile "$d/root.key" -in "$d/int.csr" \
    -startdate "$is" -enddate "$ie" -extensions v3_ca -notext -out "$d/int.pem" 2>/dev/null
  openssl req -new -key "$d/leaf.key" -subj "/CN=$n leaf" -out "$d/leaf.csr"
  # Leaf signed by the intermediate.
  cp "$d/index.txt" "$d/index.root"; : > "$d/index.txt"
  openssl ca -batch -config "$d/ca.cnf" -cert "$d/int.pem" -keyfile "$d/int.key" -in "$d/leaf.csr" \
    -startdate "$ls" -enddate "$le" -extensions v3_leaf -notext -out "$d/leaf.pem" 2>/dev/null
  for c in root int leaf; do openssl x509 -in "$d/$c.pem" -out "$out/$n.$c.pem"; done
}

FACTORY="/serialNumber=f92009e853b6b045"
RKP="/CN=Key Attestation CA1/OU=Android/O=Google LLC/C=US"

# Factory chain, everything expired (legacy root lapsed 2026-05-24, leaf and intermediate older still).
mk factory_expired "$FACTORY" 20160526164552Z 20260524164552Z 20190101000000Z 20250101000000Z 20240101000000Z 20250101000000Z
# Factory chain, currently valid (re-signed style root).
mk factory_valid "$FACTORY" 20220320180748Z 20420315180748Z 20240101000000Z 20360101000000Z 20260101000000Z 20270101000000Z
# Factory chain whose intermediate is not yet valid.
mk factory_not_yet_valid "$FACTORY" 20220320180748Z 20420315180748Z 20990101000000Z 21000101000000Z 20260101000000Z 20270101000000Z
# RKP chain: valid root and intermediate, expired leaf (leaf validity is never checked).
mk rkp_valid "$RKP" 20250717223218Z 20350715223218Z 20250801000000Z 20300101000000Z 20250801000000Z 20250901000000Z
# RKP chain whose intermediate has expired (enforced for RKP).
mk rkp_expired_intermediate "$RKP" 20250717223218Z 20350715223218Z 20250801000000Z 20260101000000Z 20250801000000Z 20250901000000Z
# RKP chain whose root has expired (enforced for RKP).
mk rkp_expired_root "$RKP" 20150717223218Z 20260101000000Z 20250801000000Z 20250901000000Z 20250801000000Z 20250901000000Z
# Imposter: same factory subject, different key. Must never match the valid factory root.
mk imposter "$FACTORY" 20220320180748Z 20420315180748Z 20240101000000Z 20360101000000Z 20260101000000Z 20270101000000Z
ls "$out"
