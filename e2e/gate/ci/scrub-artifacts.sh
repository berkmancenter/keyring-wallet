#!/bin/bash
# Before a CI gate leg's folder is uploaded (artifacts are never masked):
#   scrub-artifacts.sh <leg dir> <CI configuration file> [<pnm session dir>]
# 1. Credentials anywhere, text or binary: the values of *_CRED, *_TOKEN, *_SECRET, *_KEY and *PASSWORD* lines, and the
#    fields of the pnm sessions (vta-sdk session.rs Session) other than the three known public ones: private_key and
#    access_token, and ANY field not known to be public (fail closed). One hit fails (exit 1) and nothing may be uploaded;
#    the report names files and fields, never values. The public fields (client_did, vta_did, token_origin) are
#    identifiers: redacted, like below.
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
# The pnm home, fail closed throughout: every file is read, and whatever cannot be read or is not recognised blocks.
#  - sessions.json: the records above; it must parse and hold at least one client_did, or nothing is uploaded.
#  - config.toml: `key = "value"` lines; name, vta_did, url and default_vta are identifiers, any other key a credential.
#  - any other file: every string of 20+ characters is a credential (a key file, a store a future vta-sdk adds).
if [ -n "$home" ] && [ -d "$home" ]; then
  while IFS= read -r -d '' f; do
    case "$(basename "$f")" in
      sessions.json)
        command -v jq >/dev/null || { echo "scrub: cannot read the pnm sessions (no jq): nothing is uploaded"; exit 1; }
        jq empty "$f" 2>/dev/null || { echo "scrub: cannot read the pnm sessions (not JSON): nothing is uploaded"; exit 1; }
        n=$(session_fields "$f" | awk -F'\t' '$1 == "client_did"' | wc -l | tr -d ' ')
        [ "${n:-0}" -ge 1 ] || { echo "scrub: cannot read the pnm sessions (no record with a client_did): nothing is uploaded"; exit 1; }
        session_fields "$f" | while IFS=$'\t' read -r k v; do
          # Only the three known public fields are identifiers; every other string field, known secret or not yet
          # known, is a credential: a new field in a future vta-sdk blocks the upload until someone classifies it.
          case "$k" in client_did|vta_did|token_origin) printf 'PNM_SESSION.%s\t%s\n' "$k" "$v" >> "$ids" ;;
            *) printf 'PNM_SESSION.%s\t%s\n' "$k" "$v" >> "$creds" ;; esac
        done ;;
      config.toml)
        grep -vE '^[[:space:]]*(#|\[|$)' "$f" | while IFS= read -r l; do
          if [[ $l =~ ^[[:space:]]*([A-Za-z0-9_]+)[[:space:]]*=[[:space:]]*\"(.*)\"[[:space:]]*$ ]]; then
            k=${BASH_REMATCH[1]}; v=${BASH_REMATCH[2]}
            [ ${#v} -ge 6 ] || continue
            case "$k" in name|vta_did|url|default_vta) printf 'PNM_CONFIG.%s\t%s\n' "$k" "$v" >> "$ids" ;;
              *) printf 'PNM_CONFIG.%s\t%s\n' "$k" "$v" >> "$creds" ;; esac
          else
            printf '%s' "$l" | LC_ALL=C grep -aoE '[^"[:space:][:cntrl:]=]{20,}' | sed 's/^/PNM_CONFIG.unparsed\t/' >> "$creds"
          fi
        done ;;
      *)
        LC_ALL=C grep -aoE '[^"[:space:][:cntrl:]]{20,}' "$f" | sort -u | sed "s|^|PNM_HOME.$(basename "$f")\t|" >> "$creds" ;;
    esac
  done < <(find "$home" -type f -print0)
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
