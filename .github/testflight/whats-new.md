# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

• Scan any agent's or community's QR code, from a community's web page, pnm or the browser plugin: an agent opens linking with its address filled in, a community opens joining by its name.
• A code Keyring can't use now says why, such as "No agent or community has this code".
• The QR Code tab says what you can scan, and "My QR code" can show your contact card or your identity for a community.
• Long identity codes are hidden on every screen; tap "Details" to see them.
• Your agent is shown by its name instead of its web address.
• When you join, you choose whether to be listed in the community's public member directory. It's off unless you turn it on.
• After you're admitted, the screen says "You're a member of …".
• Retrying a failed identity creation no longer risks making a second, unused identity.
• Known issue: on the current Farm, creating your identity may need a second tap on Continue.
