# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

The 227 fix
• Invitations, vetter roles and removal notices that a community sends while Keyring is closed now arrive when you next open the app. On 227 they could be missed, which is why we suggested keeping the app open. That's no longer needed.
• Nothing else changes from 227.

Known issues (unchanged from 227)
• Some cards say "On this phone only": your agent can't keep a copy of them yet, so "Get your cards from your agent" can't bring those back.
• A community that moves to the new credential formats will refuse this build's vetting. Communities on the current release work.
• Identities created before 227 may get community messages up to about an hour late.
• Notifications are built in but switched off in this build.
• Update over your current version; there's no need to reinstall.
