# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

• Nothing is built in any more: link your own agent, then join any community by pasting or scanning its code.
• Scanning or pasting a community's code opens it by name, instead of "Invalid QR code".
• "I was invited" starts by asking which community invited you.
• You can pick a different community at any step while joining.
• A community's name shows on your first visit.
• Your agent is one screen once your phone is linked; the old second panel is gone.
• Joining uses communities' newer request format, so Keyring keeps working when the Farm upgrades.
• Fewer long identity codes on the joining screens and the fingerprint prompt.
• Link errors now say what went wrong, such as "This link has expired".
• If your phone joined a test community on an earlier build, it may still suggest it: choose "A different community".
