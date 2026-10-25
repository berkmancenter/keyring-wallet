#!/bin/sh
# The gateway treats a variable that is *set* as configured, even when empty
# (an empty GATEWAY_IDENTITY_FILE is a path it fails to read). Compose always
# sets every variable it lists, so unset the empty GATEWAY_* ones and let the
# gateway see only what .env actually filled in.
set -eu
for name in $(env | sed -n 's/^\(GATEWAY_[A-Z0-9_]*\)=$/\1/p'); do
  unset "$name"
done
exec "$@"
