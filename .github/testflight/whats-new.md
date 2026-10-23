# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

• Keeps working with agents and communities as they move to TSP 1.0: until Keyring speaks it, it talks to them over DIDComm instead. Keyring-to-Keyring is unchanged.
• Strengthen a relationship you already have: on a contact, "Add to this relationship" → "Sign again" asks the other person to sign again, and shows the secure-hardware shield if their phone signs with it. "Add a witness" does the same in front of a witness, when you're together. It stays one contact.
• Relationship links opened later: if the other phone is closed, Keyring says "Waiting for {name} to answer." instead of saying the exchange failed. Tapping the notification brings you back to the exchange, and a request left unanswered when the app closed is asked again the next time you open it.
• An exchange that ends without completing no longer shows as confirmed.
• My Agent and the agent home no longer flash "Link your agent" or the wrong state while they load, and they tell "waiting" from "something's wrong". Two buttons that did nothing are gone.
• If your agent removes this phone, My Agent says so straight away, and so does a community you're already in, with how to link again.
• No agent yet? My Agent now has "Don't have an agent yet?", saying where one comes from.
• Also includes everything in build 268.
