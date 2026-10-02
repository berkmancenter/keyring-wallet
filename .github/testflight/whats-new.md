# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

The 229 fix
• Scanning your hosting service's code from My Agent → Set up a new agent now opens the "Connect this phone to your agent?" screen. On 229 it could drop you on the Contacts tab with nothing linked.
• Nothing else changes from 229.

Please test
• Set up a new agent with the scan option, starting from My Agent → Set up a new agent → Scan.

Known issues (unchanged from 229)
• A vetter using the openvtc terminal app can't vet until that app picks up a fix that is already merged upstream. Vetting between two Keyring users works.
• Some cards say "On this phone only": your agent can't keep a copy of them yet.
• Notifications are built in but switched off in this build.
• Update over your current version; your memberships carry over, with no need to re-join.
