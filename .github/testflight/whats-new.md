# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

• Set up a new agent with one scan. On your agent host's page, choose to set up with Keyring and scan the code. Keyring shows the address the code says it's from (marked "Unverified" until you continue), you match the six characters on both screens, and the agent is linked as yours. No address or owner code to copy.
• Website sign-in works with communities on the newest server version. It no longer ends in "the community's answer couldn't be checked". If your agent doesn't support website sign-in yet, Keyring now says "Your agent needs an update" instead of a general error.
• The sign-in screen shows the community's full address and says it hasn't been checked yet, and it shows the community's name (or short handle) instead of a long code.
• After a wrong PIN, the field clears so you can type it again straight away.
• If your agent removed this phone, "Link again" lets you scan your agent's code and link it again.
• Backing out of a link that is waiting for an approval no longer lets it finish later on its own.
• While you wait for your agent host during setup, the app no longer locks itself and loses your place.
• Agents that don't publish a web address can be linked by scanning their code.
• After reinstalling Keyring, role cards such as "vetter" come back from your agent with your membership cards, and a membership card's details show your role.
• If Keyring can't check a card's status, it says so and offers Try again.
• When a community admits you, Keyring sends your half of the membership record back to the community.
• On Android, Keyring's notifications use their own "Requests and messages" channel, so approval requests show as a banner.
• Hardware-attested exchanges are checked more strictly against exactly what you see.
• Profile and name fields are a little taller, and a new community identity is kept in your agent's main space.
