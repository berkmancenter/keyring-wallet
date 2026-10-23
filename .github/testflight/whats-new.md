# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

• Same person, two rows? On a contact that shares a name with another, "Same person?" merges them into one contact. It shows "Merged by you" until the other person's phone confirms: "Ask {name}'s phone to confirm" sends them the question. "Separate" undoes a merge, and nothing is deleted.
• Removing a merged contact says how many relationships it removes, and offers to separate them first.
• Opening a community you belong to shows "member" straight away instead of waiting. If Keyring can't read where you stand, it says so, with "Check again".
• A community you're a member of no longer flashes its "How to join" page while it loads.
• Also includes everything in build 269.
