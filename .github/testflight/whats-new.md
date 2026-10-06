# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

What's new
• Fixed: with more than one agent, after a community turns down a request, tapping the other agent in the switcher now works. My Agent refreshes itself when you open it (pull-down-to-refresh is gone).
• Fixed: Approve and Decline, and adding, renaming or removing a device, now work with agents on 0.53 and 0.54. When your agent refuses something, Keyring says so, with the reason under Details.
• Fixed: after your agent restarts, Keyring reconnects on the next request instead of going unanswered until you force-quit.
• Keyring won't link to a community's own agent: "This is a community's agent. Link Keyring to your personal agent instead."
• Scanning another agent's code on a linked phone adds it beside the current one, instead of "already linked".
• Devices: "device" instead of "phone"; add a device by scanning or entering its code; name it when you add it, and rename it later. My devices no longer spins forever.
• After a successful scan Keyring goes straight on; one clear main button; Copy/Share next to codes.
• Each community card can show the identity code the community sees for you ("Show the code they see"); vetting screens show it too.
• With two agents, Keyring signs in as the current agent's identity.
• "Community identity" in My QR code; the attest button's text fits; the agent switcher reads its name to screen readers.

Please test
• Two agents: after a community turns down a request, tap the other agent in the switcher.
• My devices: add a device by scanning its code, name it, rename it.
• Approve and Decline a request from your agent.
• On a community card, "Show the code they see".

Known issues
• If a community takes more than about 30 seconds to answer a join request, Join can stay on "hasn't answered yet". Your request isn't lost: open My Agent and use Check now on that community.
• Approving a request doesn't ask for Face ID yet.
• Keyring can't take part in hidden (zero-knowledge) vetting yet; it joins the ordinary way. A terminal-app vetter enrolled for hidden vetting can't vet a Keyring applicant.
• Keyring doesn't yet take over identities another app (pnm/openvtc) created on an agent you add.
• Community admins don't get push notifications for join requests yet.
• Notifications need your agent's policy enforcement on and an approval rule naming your phone.
• Update over your current version; your memberships carry over.
