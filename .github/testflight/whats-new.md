# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

Linking a second phone
• Link a new phone by scanning between the two phones: the first shows a code, the new one scans it and shows its own, and the first scans that back.
• Fixed: a cut-off QR code, pasted codes not being recognised, and a spinner that never stopped.
• Every way of linking now ends on "Your agent".
• A phone you remove from another one now says "This phone is no longer linked to your agent" at its next check-in, with options to erase its copy or link again.

Approvals and "prove it's you"
• An approval request shows what it would change, with a short code that matches the one on the requesting side.
• When your agent asks you to prove it's you, it says why before the owner check. Declining says your agent didn't do it.
• Expiry times and other dates now show in your phone's own time zone.
• The approvals banner clears once you've decided.

More reliable
• Invitations and vetter roles from a community now arrive within seconds.
• Creating your identity for a community can take up to a minute or two the first time; the screen now says so instead of failing.
• Messages come back within seconds after you unlock the phone.
• If your agent can't be found for a while, "Your agent" says so and offers a way to link a new one.
• Unlink signs this phone out of your agent completely.

Known issues
• Some cards say "On this phone only": your agent can't keep a copy of them yet, so "Get your cards from your agent" can't bring those back.
• A community that moves to the new credential formats will refuse this build's vetting. Communities on the current release work.
• Identities created before this build may get community messages up to about an hour late.
• Notifications are built in but switched off in this build.
• Update over your current version; there's no need to reinstall.
