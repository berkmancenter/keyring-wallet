# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

What's new
• Notifications. Turn them on in Settings or when the app asks. When your agent needs your approval, your phone shows "Something is waiting for you in Keyring." Tapping it opens the request.
• A Requests screen lists what's waiting, with Approve and Decline. A request that expires says so.
• A count on the My Agent tab shows how many requests wait. It goes when each is decided or expires.
• While the app is open, it tells you when you become a member: "You're now a member of …".
• On the Join screen each button sits under the way it belongs to, so "Ask to join" always has its explanation right above it.
• If someone removed by a community comes back, "Join again" offers "Meet a vetter" and "Ask to join" again, under a new identity.
• A link that arrives while the app is locked opens after you unlock.
• Keyring no longer contacts Google's notification service before you turn notifications on.

Please test
• Turn notifications on, ask your agent for something that needs your approval, and check the notification arrives: with the app in the background, closed, and open.
• Turn notifications off and check nothing arrives.

Known issues
• iPhone: notifications arrive once our notification service's update for the store app lands. Until then you can turn them on, but nothing arrives. Android isn't affected.
• You only get a notification if your agent enforces its approval rules (policy enforcement on). With it off, rules are not applied and nothing is asked of you.
• If your agent has an approval rule on turning notifications on or off, the switch in Keyring waits for an approval that can't come. Don't put a rule on that operation.
• Notifications cover approval requests only. A change in your membership shows while the app is open, not as a notification.
• No count on the app icon yet; the count is on the My Agent tab.
• Some pop-ups at the bottom of the screen still sit over the tab bar.
• Keyring can't present a credential you already hold to join a community yet.
• A vetter using the openvtc terminal app needs a build of that app from its current main branch.
• Update over your current version; your memberships carry over.
