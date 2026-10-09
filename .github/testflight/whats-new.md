# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

• A link left part-way picks back up with the same key; a refused link isn't retried on its own.
• Linking keeps working while Keyring locks, and an expired host code is flagged before anything is sent.
• A swap held for approval keeps its key for Try again; a failed add returns you to your previous agent.
• Keyring refuses an agent this phone already has, on every way of adding one.
• Done after setting up an agent opens the agent's page.
• Wallet hides cards that came through an agent you've unlinked.
• Communities that run hidden vetting show their vetting option again.
• A member can open Join for a different community; a vetter's ticket for another community is refused only while a join is under way.
• Vetting writes the DTG v1 "vetted" statement.
