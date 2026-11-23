#!/usr/bin/env bash
# Regenerates the throw-away certificates pasted into signingTime.test.ts (APP_ATTEST_LEAF,
# GENERALIZED_TIME_CERT) and prints them. Test-only EC P-256 keys, never used for anything else.
# Validity windows are absolute so the tests stay deterministic. APPLE_APP_ATTESTATION_ROOT is the
# real root, copied from packages/react-native-attestation/ios/Attestation.mm.
set -euo pipefail
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
cat > "$work/ca.cnf" <<CNF
[ca]
default_ca = c
[c]
database = $work/index.txt
new_certs_dir = $work
serial = $work/serial
default_md = sha256
policy = p
unique_subject = no
[p]
commonName = optional
[v3_leaf]
basicConstraints = CA:FALSE
CNF
# mk <name> <start> <end>: a self-signed certificate with that validity window.
mk() {
  : > "$work/index.txt"; echo 1000 > "$work/serial"
  openssl ecparam -name prime256v1 -genkey -noout -out "$work/$1.key"
  openssl req -new -key "$work/$1.key" -subj "/CN=$1" -out "$work/$1.csr"
  openssl ca -batch -config "$work/ca.cnf" -selfsign -keyfile "$work/$1.key" -in "$work/$1.csr" \
    -startdate "$2" -enddate "$3" -extensions v3_leaf -notext -out "$work/$1.pem" 2>/dev/null
  echo "== $1"; openssl x509 -in "$work/$1.pem"
}
# An App Attest-like leaf: 72 hours.
mk appattest_leaf 20261020100000Z 20261023100000Z
# notBefore before 2050 (UTCTime) and notAfter after it (GeneralizedTime, RFC 5280 4.1.2.5).
mk generalized_time 20491231000000Z 20510101123456Z
