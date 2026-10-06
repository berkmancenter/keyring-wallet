# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

• Claim your agent: take ownership of your existing agent from your phone, no computer needed. It connects by itself. Add a backup phone or remove a lost one under My devices.
• "Your agent" is reorganised into Communities, Manage and Status. Each community gets a card showing where you stand and one clear next step, and a banner shows when an approval is waiting for you.
• Invitations from a community's admin console now work: sent to your phone, scanned in the app, or opened with the phone's Camera.
• Joining and vetting screens update by themselves and show one clear next step. After vetting you see "You're a member", and the vetter's desk keeps its place if the app is closed.
• Leaving a community that's slow to answer checks back and finishes, or offers Try again.
• Each community appears once and keeps its name after a restart. Duplicate memberships from an interrupted join are cleaned up.
• Errors are in plain words, with the technical detail behind "Details". Paste now says what it read.
• Screens stay above the keyboard when you type or paste a code.
• The demo collector card and approval demo are gone; contacts show the regular list.
• Known issues: the add-a-device screens are still titled "Claim your agent", and the vetting desk opens on your last finished request (tap "Clear finished requests" to start a new one).
• Update over your current version; there's no need to reinstall.
What's new
• Approving a request now asks for Face ID, a fingerprint or your passcode. Decline doesn't ask.
• Request cards say what is being asked and who is asking, and show the full request code. Approve and Decline are the same size.
• My Agent home is redesigned around your requests, and you can name your agent.
• Fixed: Join no longer stays on "hasn't answered yet" when a community answers slowly.
• The Join screen shows the identity code the community will see for you.
• With several agents, a membership held by another agent shows correctly.
• If your agent stops answering, Keyring stops waiting after two tries and says "Your agent is catching up".
• Notifications: every linked agent can wake your phone, and turning notifications off and on no longer uses up the limit.
• New vetters see a confirmation, the vetter screen has its own header, and vetting no longer scrolls under the tab bar.
• The agent screen's header has a Join icon.

Please test
• Approve a request: Face ID should appear; cancel it and the request should still be waiting.
• Join a community that answers slowly.
• With two agents linked, check that a request on either one wakes the phone.

Known issues
• Some request cards still show the technical task name (for example "vta/contexts/get/1.0"). Plain words are next.
• Keyring can't take part in hidden (zero-knowledge) vetting yet; it joins the ordinary way.
• Keyring doesn't yet take over identities another app (pnm/openvtc) created on an agent you add.
• Community admins don't get push notifications for join requests yet.
• Notifications need your agent's policy enforcement on and an approval rule naming your phone.
• Update over your current version; your memberships carry over.
