# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

What's new
• Fixed: if you first installed Keyring in mid-September or earlier, a recent update could stop it starting, showing "Something went wrong" each time it opened. Keyring now switches to the current messaging service by itself and starts normally, with no reinstall needed.
• Onboarding now offers notifications: "Turn on notifications", or "Not now" and turn them on later in Settings → Notifications.
• Turning notifications on works the first time on iPhone. On 232/235 it sometimes needed switching off and on once.
• On Android, tapping a notification when Keyring was closed opens the request, not My Agent.
• Messages for each community you're in can now arrive, not just for the one you last chose. If one doesn't arrive, closing and reopening Keyring picks it up.
• You can join a second community, or accept its invitation, while already a member of another.
• If a community offers no vetting, the Join screen says so, and every way in stays visible on small phones.
• Setting up an agent through your agent host shows each step as it happens.
• "Your agent" shows "Member of …" and a next step when something needs you, after your first membership.
• A community without a name shows a short ID instead of "a community".
• "<Community> turned down your request" appears once if a request is refused.
• A link that opens Join or Requests now has a way back to Your agent.
• New notifications picture and screen title in Keyring's style; bottom messages no longer cover the tab bar.

Please test
• Fresh install: onboarding's notifications step, both "Turn on notifications" and "Not now".
• Join a second community while already a member, by invitation and by vetting.
• With Keyring closed, tap a notification: it should open the request.

Known issues
• Messages for a community other than the one you last chose are best-effort in this build: if Keyring couldn't listen for it at start-up, it may wait until you close and reopen the app.
• Notifications only arrive if your agent has policy enforcement on and an approval rule naming your phone (see the how-to in the group).
• If you block Keyring's notifications in your phone's settings, your agent still thinks the phone is reachable until you next open the app.
• Notifications cover approval requests only; a membership change shows while the app is open.
• Keyring can't present a credential you already hold to join a community yet.
• A vetter using the openvtc terminal app needs v0.3.1 or later.
• If you installed before mid-September: contacts or connections set up through the old messaging service may need setting up again.
• Update over your current version; your memberships carry over.
