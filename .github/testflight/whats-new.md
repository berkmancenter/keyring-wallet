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
• Linking by address is one path. A phone without a screen lock links as a device, and every failure says what went wrong.
• Join: "How to join" shows only the ways you can use. After you ask, "Request sent" shows your persona ID ("See full persona ID"), and once an admin accepts, a success screen takes you back to Your agent with the community highlighted.
• If a join request never reached the community, Keyring says so and offers "Send it again".
• If your agent is busy, Keyring says "Your agent is busy right now. Wait a minute and try again".
• Your agent: the introduction is centred, Agent settings has section dividers, no flash when you tap Add, the Add chip fits, and "Which community?" is centred.
• Onboarding: the agent card says "Not that kind of agent", with a larger icon, and the welcome link points to the Applied Technology Lab page.

Please test
• Link by your agent's address, with and without a screen lock.
• Join a community and watch "Request sent", then the success screen when you're accepted.
• With two agents, tap Add, then choose "Keep using" your first agent.

Known issues
• After adding a second agent, the "Keep using" choice shows only once you open Your agent. Fixed next.
• If the phone sleeps while your agent host is still setting up, linking may not recover; make a new code. Fixed next.
• Keyring can't take part in hidden (zero-knowledge) vetting yet; it joins the ordinary way.
• Community admins don't get push notifications for join requests yet.
• Update over your current version; your memberships carry over.
