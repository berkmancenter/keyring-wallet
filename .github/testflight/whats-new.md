# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

• Vetting with a vetter who uses the openvtc app now works: Keyring accepts their statement instead of silently ignoring it. If a vetter already sent you a statement that never arrived, ask them to send it again.
• Your Keyring can now vet someone who uses the openvtc app, all the way to their membership.
• Fixes an occasional failure (about 1 or 2 in 1,000 requests) that could show as a failed link, a "doesn't know why" error, or a vetting step that never moved on.
• After you ask to join, Keyring shows where your request stands (joined, waiting for vetting, or pending) instead of saying the community didn't answer, and you can withdraw a waiting request.
• Linking your agent recovers on its own if an answer is lost or the connection stalls, and a failed link now says why under Details.
• When Keyring refuses something a vetter or community sent, it says why in plain words.
• Tapping a vetter's ticket link (for example in Signal) opens it in Keyring.
• Problem reports now keep about an hour of history instead of a few minutes.
• Known issue: once you've asked a vetter, you can't cancel that request from your phone yet; the vetter can decline it.
