# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

What's new
• Vetting uses the new community credential formats. When a community asks for them, a vetter's statement is written in the new format; elsewhere it uses the old one.
• Connect this phone to a new agent by scanning a code: when you create an agent with your hosting service, choose the automatic mobile connection, then tap Scan in Keyring under My Agent → Set up a new agent.
• You can now Share the phone's code, not just copy it: send it by Messages or AirDrop, or save it to Files.
• While Keyring waits for your agent to add this phone, it shows a calm "Waiting…" line instead of a red warning that came and went.
• A message no longer hangs when your agent's sign-in at the mediator has just expired.

Please test
• Join a community and get vetted, as a vetter and as an applicant.
• Set up a new agent with the scan option.

Known issues
• A vetter using the openvtc terminal app can't vet yet (fixed upstream; waiting for that app to pick up the fix). Vetting between two Keyring users works.
• Some cards say "On this phone only": your agent can't keep a copy of them yet.
• Notifications are built in but switched off in this build.
• Vetters: please update to this build. A vetting done from the previous build no longer counts in a community that uses the new formats.
• Update over your current version; your memberships carry over, with no need to re-join.
