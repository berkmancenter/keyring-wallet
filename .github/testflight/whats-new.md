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
• Fixed: with two agents, an identity on the agent you're not using signs in again after the app restarts (no more "not found in backend 'ephemeral'").
• Fixed: tapping Add on the agent chips and going back returns to your agent instead of the unlinked screen.
• A simpler unlinked screen: "Scan your agent's code", or "No code? Use your agent's address".
• Join uses the agent you're on, and shows "Your persona ID". Buttons scroll with the page, so nothing hides behind them.
• "Choose how to join" on a community's screen; if vetting finishes over a plain request, you can replace it.
• Your agent: sections in a clear order with dividers; the header icons and agent chips fit the screen; "Join another community" replaces the header menu.
• When linking fails, Keyring says whether your agent held it for approval or refused it.
• Request cards describe tasks in plain words ("look at its contexts"), with the technical name behind a toggle.

Please test
• With two agents, restart the app and use a community from the agent you're not on.
• Tap Add on the agent chips, then go back.
• Join a community and check "Your persona ID".

Known issues
• Beside a single agent, the "Add" chip can run past the right edge (the strip scrolls). Fixed next.
• Linking by address needs a screen lock on the phone. A fallback is next.
• If your agent is busy, some errors say "doesn't know why". Clearer wording is next.
• Keyring can't take part in hidden (zero-knowledge) vetting yet; it joins the ordinary way.
• Community admins don't get push notifications for join requests yet.
• Update over your current version; your memberships carry over.
