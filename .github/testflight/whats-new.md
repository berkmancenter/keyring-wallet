# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

What's new
• Several agents in one Keyring: link more than one agent, switch between them, see every agent's requests in one place, and unlink one. Wallet cards say which agent holds them.
• My Agent is reorganised: your communities and what your agent holds come first, a "Join" button sits in the corner, and Manage, Status, "Ask me before…" and "Restore cards from your agent" are under Agent settings.
• "Ask me before…": choose what your agent asks this phone about before it acts.
• Approval rules keep asking this phone after its linking key is replaced.
• If an approval rule covers turning notifications on or off, Settings says so within seconds, and the switch shows what your agent really has.
• Turn Keyring's notifications off in your phone's settings, and your agent learns it the next time you open Keyring.
• A second community's messages keep arriving even if listening for it failed at start-up.
• My Agent learns that a request was turned down without you opening Join.
• When a community's way in can't be used yet, Join says why in plain words, and says when nothing is wrong on your side.
• Vetting: a vetter's ticket you scanned is kept until it's used, even after a relaunch, and scanning goes straight on. The legal-name step offers your profile name but never fills it in by itself.
• One Wallet card per membership; a plain "member" role no longer shows a second card.
• A community with no published name reads "<short ID> (no name published yet)".
• "Get your cards" is now "Restore cards from your agent", with a line saying when to use it.
• Onboarding has a slide about your own agent, and the biometrics step says why it's recommended.
• Smaller fixes: the Wallet's empty message is centred, the R-Card name sits under the photo, a phone's removal shows once, and notification text stays visible on short phones.

Please test
• Link a second agent, switch between them, and unlink one.
• My Agent's new layout: Join in the corner, then Agent settings → Manage, Status, Ask me before…, Restore cards.
• Vetting with a scanned ticket: open Menu during the application and come back. The ticket should still be there.

Known issues
• With more than one agent, after a community turns down a request, tapping the other agent in the switcher may do nothing. Leave My Agent (for example, open Contacts) and come back, then try again.
• Communities set up before October whose ways in still ask for a credential show those ways as "can't be used yet". The community's admin needs to update them.
• Notifications only arrive if your agent has policy enforcement on and an approval rule naming your phone.
• Keyring can't take part in hidden (zero-knowledge) vetting yet. On a community that offers it, Keyring still joins the ordinary way, and a terminal-app vetter who has enrolled for hidden vetting can't vet a Keyring applicant.
• Keyring can't present a credential you already hold to join a community yet.
• Update over your current version; your memberships carry over.
