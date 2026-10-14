#!/bin/bash
# Before a CI gate leg's folder is uploaded (artifacts are never masked):
#   scrub-artifacts.sh <leg dir> <CI configuration file> [<pnm session dir>]
# 1. Credentials anywhere, text or binary: the values of *_CRED, *_TOKEN, *_SECRET, *_KEY and *PASSWORD* lines, and the
#    secret fields of the pnm sessions (vta-sdk session.rs Session: private_key, access_token; any *key*/*token*/*secret*
#    field, to be safe). One hit fails (exit 1) and nothing may be uploaded; the report names files and fields, never
#    values. The sessions' public fields (client_did, vta_did, token_origin) are identifiers: redacted, like below.
# 2. Identifiers the legs print as a matter of course (the values of *_SLUG, *_DID, *_URL, *_REST, *_HOST, *_NAME lines)
#    are replaced with [redacted:<KEY>] in text files; a binary file holding one (a screenshot, a page source with a DID)
#    is removed, and listed.
set -u
dir=${1:?leg dir}; envf=${2:?configuration file}; home=${3:-}
[ -d "$dir" ] || exit 0
val() { sed -E 's/^[A-Za-z0-9_]+=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'; }
creds=$(mktemp); ids=$(mktemp); trap 'rm -f "$creds" "$ids"' EXIT
grep -E '^[A-Za-z0-9_]*(_CRED|_TOKEN|_SECRET|_KEY|PASSWORD[A-Za-z0-9_]*)=' "$envf" | while IFS= read -r l; do printf '%s\t%s\n' "${l%%=*}" "$(printf '%s' "$l" | val)"; done > "$creds"
# Every session record, whether stored as an object or as a JSON string inside the map (the file backend keeps a
# slug -> value map). Secret-shaped field names go to creds, the rest of the string fields to ids.
session_fields() {
  [ -f "$1" ] || return 0
  jq -r 'def recs: if type == "string" then (try (fromjson | recs) catch empty) elif type == "object" or type == "array" then (., (.[] | recs)) else empty end;
    [recs | objects | to_entries[] | select(.value | type == "string") | select((.value | length) >= 6)] | .[] | "\(.key)\t\(.value)"' "$1" 2>/dev/null
}
if [ -n "$home" ] && [ -d "$home" ]; then
  for f in "$home"/sessions.json; do
    session_fields "$f" | while IFS=$'\t' read -r k v; do
      case "$k" in client_did|vta_did|token_origin) printf 'PNM_SESSION.%s\t%s\n' "$k" "$v" >> "$ids" ;;
        *[Kk]ey*|*[Tt]oken*|*[Ss]ecret*|*seed*) printf 'PNM_SESSION.%s\t%s\n' "$k" "$v" >> "$creds" ;; *) printf 'PNM_SESSION.%s\t%s\n' "$k" "$v" >> "$ids" ;; esac
    done
  done
fi
grep -E '^[A-Za-z0-9_]*(_SLUG|_DID|_URL|_REST|_HOST|_NAME)=' "$envf" | while IFS= read -r l; do printf '%s\t%s\n' "${l%%=*}" "$(printf '%s' "$l" | val)"; done >> "$ids"
hit=0
while IFS=$'\t' read -r key v; do
  [ ${#v} -ge 6 ] || continue
  files=$(grep -rlaF -- "$v" "$dir" 2>/dev/null)
  [ -z "$files" ] || { echo "SECRET $key found in: $(echo "$files" | sed "s|^$dir/||" | tr '\n' ' ')"; hit=1; }
done < "$creds"
[ $hit = 0 ] || { echo "scrub: a credential is in the leg's files: nothing is uploaded"; exit 1; }
while IFS=$'\t' read -r key v; do
  [ ${#v} -ge 6 ] || continue
  grep -rlaF -- "$v" "$dir" 2>/dev/null | while IFS= read -r f; do
    if grep -Iq . "$f" 2>/dev/null; then
      V="$v" K="$key" perl -pi -e 's/\Q$ENV{V}\E/[redacted:$ENV{K}]/g' "$f"
    else
      rm -f "$f"; echo "scrub: removed binary ${f#$dir/} (it held $key)"
    fi
  done
done < "$ids"
echo "scrub: no credential found; identifiers redacted"
