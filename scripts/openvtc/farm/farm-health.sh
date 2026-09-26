#!/usr/bin/env bash
# Read-only health of the Farm test resources (d3, 2026-09-23). Changes nothing.
#   farm-health.sh                 # every resource below
# Per runner VTA: pnm health (resolve, auth, mediator, DIDComm + TSP ping), and
# whether a DID host is registered. Per VTC: /health version, REST manifest
# (criteria, name), and — vti #1698 — whether GET /v1/community/did-qr.svg is a
# QR that decodes to exactly the VTC's DID.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# pnm through the slug's lock, so this never drops a gate's pnm call (one slug =
# one admin DID = one mediator socket; see ../pnm-locked).
export PNM_BIN="${PNM_BIN:-$HOME/Documents/vti-main/target/debug/pnm}"
PNM="$HERE/../pnm-locked"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fails=0
bad() { echo "  ✗ $*"; fails=$((fails + 1)); }
ok() { echo "  ✓ $*"; }

vta() { # slug expect_host(yes|no)
  local slug="$1" want="$2"
  echo "== VTA $slug"
  local h; h=$("$PNM" --vta "$slug" health 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
  local x; x=$(grep -c "✗" <<<"$h")
  [ "$x" -eq 0 ] && ok "pnm health all ✓ ($(grep -c '✓' <<<"$h") checks)" || bad "pnm health: $x ✗ — $(grep '✗' <<<"$h" | head -2 | tr -s ' ')"
  local s; s=$("$PNM" --vta "$slug" did-mgmt servers list 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | grep -oE "WebVH Servers \([0-9]+\)" | grep -oE "[0-9]+")
  s="${s:-0}"
  if [ "$want" = yes ]; then [ "$s" -ge 1 ] && ok "DID host registered ($s)" || bad "no DID host registered"
  else [ "$s" -eq 0 ] && ok "no DID host, as intended" || bad "has $s DID host(s); this one should have none"; fi
}

vtc() { # name base did
  local name="$1" base="$2" did="$3"
  echo "== VTC $name"
  local health; health=$(curl -s -m 15 "$base/health")
  local ver; ver=$(python3 -c 'import sys,json; print(json.loads(sys.argv[1]).get("version","?"))' "$health" 2>/dev/null)
  [ -n "$ver" ] && [ "$ver" != "?" ] && ok "/health version $ver" || bad "/health unreadable: ${health:0:80}"
  local m; m=$(curl -s -m 20 -X POST "$base/v1/trust-tasks" -H 'content-type: application/json' \
    -d "{\"id\":\"urn:uuid:$(uuidgen)\",\"type\":\"https://trusttasks.org/spec/vtc/join-requests/manifest/0.2\",\"threadId\":\"urn:uuid:$(uuidgen)\",\"payload\":{},\"issuer\":\"$did\",\"recipient\":\"$did\",\"issuedAt\":\"$(date -u +%FT%TZ)\"}")
  python3 -c 'import sys,json; d=json.loads(sys.argv[1]); p=d.get("payload",{}); print("  ✓ manifest: criteria", [c["id"] for c in p.get("criteria",[])], "name", (p.get("branding") or {}).get("displayName"))' "$m" 2>/dev/null || bad "manifest unreadable: ${m:0:80}"
  local code; code=$(curl -s -m 15 -o "$TMP/qr.svg" -w "%{http_code} %{content_type}" "$base/v1/community/did-qr.svg")
  if [[ "$code" == 200*svg* ]]; then
    rsvg-convert -w 600 -b white "$TMP/qr.svg" -o "$TMP/qr.png" 2>/dev/null
    local got; got=$(swift "$HERE/qr.swift" decode "$TMP/qr.png" 2>/dev/null)
    [ "$got" = "$did" ] && ok "did-qr.svg decodes to exactly the VTC DID (vti #1698)" || bad "did-qr.svg decodes to '${got:0:80}', not the VTC DID"
  else
    echo "  – did-qr.svg not served ($code): a VTC before vti #1698"
  fi
}

vta farm-runner yes
vta farm-runner-prague yes
vta farm-runner-uiux yes
vta farm-runner-openvtc yes
vtc keyring-test-vtc https://vtc-keyring-test.ic3.dev \
  did:webvh:QmdervYcngPtJnKGuZSzH2tvDe8q274cty8324G4finFnV:dids-keyring-stack.ic3.dev:keyring-test-vtc
vta farm-runner-nohost no
# Added when it exists: vtc keyring-vetting-vtc <base> <did>

echo; [ "$fails" -eq 0 ] && echo "farm-health: all good" || echo "farm-health: $fails problem(s)"
exit "$fails"
