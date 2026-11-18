# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

• Rooms are much faster. Messages shows your rooms from last time as soon as you open Keyring, a room you reopen shows its last messages at once, new posts and unread counts arrive while the app is open on any screen, and accepting an invitation is quicker. To show your rooms at once, Keyring keeps room and community names and last-activity times in your encrypted wallet on the phone, never message text.
• Room chat: in rooms set up for it you can reply, react, and edit or withdraw your own messages. Press and hold a message. Your own changes show at once, and "Sending" appears only if a message is still on its way after a moment.
• Several communities: each identity signs in on its own connection, so one slow community no longer holds up the others, and room and poll lists no longer stall or come up empty right after you open the app.
• Joining: communities whose address starts with did:webs (such as the SEDI community) can be scanned, joined and signed in to. Keyring checks for the answer on its own, and if you were approved but your membership card didn't arrive, it asks for it. A vetting that takes too long can be restarted or stopped.
• Badges (new): in a community that has badges turned on, an admin can offer you a badge. It appears on the community's page under Badges, where you accept or decline it; tap a badge to see what it was given for. Badges can also show on members' cards in the community. Badges no longer appear in the Wallet.
• Polls open and list faster.
• Linked devices: My devices, renaming or removing a device, adding a backup device and moving to a new phone work again.
• Face ID: the switch is easy to see when off, a spinner shows while Face ID confirms, and the screen says what to do if Keyring isn't allowed to use Face ID.
• Chats: tapping the photo and name at the top opens the contact's page.
• Locking the app and coming back is steadier: message pickup is no longer restarted while the agent is shutting down.
• Demos (Settings > Developer > Demos, all off by default): Confirm it's you, Who approves with trusted approvers, and the Guardian and state card demos.
Please check: open Keyring fresh and see that your rooms appear, each community signs in, and a message sends.
