# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

What's new
• Joining works with communities on the new join format, and still works with communities on the earlier one. Builds 229 and 230 can't join a community that has moved to the new format; this build can.
• The Join screen shows each way into a community and what follows it: with some ways you're admitted straight away, with others an administrator reviews your request and decides.
• Where a community offers both, the Join screen gives you "Meet a vetter" to get vetted and "Ask to join" to ask an administrator.
• "Ask to join" sends your request from the Join screen. While it waits, the screen says an administrator will review it, and shows the answer there.
• If a community isn't accepting applications, the Join screen says so.
• Includes the 230 fix: scanning your hosting service's code from My Agent → Set up a new agent opens the "Connect this phone to your agent?" screen.

Please test
• Join a community, by invitation and by asking to join.
• Get vetted, as a vetter and as an applicant.

Known issues
• Keyring can't present a credential you already hold to join a community yet, so a community's "membership credential" way isn't available from Keyring. Asking to join still works.
• A vetter using the openvtc terminal app needs a build of that app from its current main branch; its latest release predates the fixes.
• Some cards say "On this phone only": your agent can't keep a copy of them yet.
• Notifications are built in but switched off in this build.
• Update over your current version; your memberships carry over, with no need to re-join.
