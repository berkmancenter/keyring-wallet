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
export PNM_BIN="${PNM_BIN:-$HOME/vti-stack/bin/pnm}"   # signed, stable (sign-lab-tool.sh)
PNM="$HERE/../pnm-locked"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fails=0
bad() { echo "  ✗ $*"; fails=$((fails + 1)); }
ok() { echo "  ✓ $*"; }

vta() { # slug expect_host(yes|no)
  local slug="$1" want="$2"
  echo "== VTA $slug"
  local h; h=$("$PNM" --vta "$slug" health 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
  # pnm from VTI main prints a JSON report ({"checks":[{section,name,ok}],"healthy"}); count
  # the checks themselves, so an empty or unreadable report fails instead of passing.
  local r; r=$(python3 -c '
import json,sys
t=sys.stdin.read(); i=t.find("{\n")
try: d=json.loads(t[i:]) if i>=0 else None
except Exception: d=None
if not d or not d.get("checks"): print("unreadable"); sys.exit()
bad=[c["section"]+"/"+c["name"] for c in d["checks"] if not c.get("ok")]
print(("ok %d" % len(d["checks"])) if d.get("healthy") and not bad else "bad "+" ".join(bad or ["healthy=false"]))' <<<"$h")
  local ver; ver=$(grep -m1 -oE "Version +[0-9.]+" <<<"$h" | awk '{print $2}')
  case "$r" in
    ok*) ok "pnm health: ${r#ok } checks ok, healthy (VTA ${ver:-?})" ;;
    *) bad "pnm health: ${r} — $(tr -s ' ' <<<"$h" | tail -3 | tr '\n' ' ' | cut -c1-160)" ;;
  esac
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

# The Farm was wiped and rebuilt on 2026-09-29/30: the farm3-* runners. keyring-test-vtc and farm-runner-nohost did not
# survive it, and keyring-test-vtc's host no longer resolves (2026-10-26). The test communities since 2026-10-26 are
# keyring-community-a and keyring-community-b, each with its own runner VTA (pnm slugs farm3-runner-a and -b).
vta farm3-runner-prague yes
vta farm3-runner-uiux yes
vta farm3-runner-openvtc yes
vta farm3-runner-b yes
vtc keyring-community-b https://vtc-keyring-community-b.ic3.dev did:webvh:QmRES31bePU3yAsCgs7HKY81i6ihNvxpFCVRNXkFGqvYee:dids-keyring-runner-b.ic3.dev:keyring-community-b-vtc
# Community A (keyring-community-a, pnm slug farm3-runner-a) is being created; its vta and vtc lines go here once it is up.
# A runner without a DID host, for the no-host case, is still to be recreated: vta <nohost slug> no
echo; [ "$fails" -eq 0 ] && echo "farm-health: all good" || echo "farm-health: $fails problem(s)"
exit "$fails"
