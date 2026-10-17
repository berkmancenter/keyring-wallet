# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

• Build 263: after a private vouch arrives, the applicant's screen moves on to Apply, so the private proof and joining can run (on 262 it stayed on "the vetter is checking"). A vetter whose agent has never vouched privately can enrol, draw tokens and vouch privately. Vetters are not asked how they know the person (it is sent as "none", as in ordinary vetting), and tokens are drawn on the community's schedule. If an earlier build enrolled your agent as a private vetter under a different identity, the desk says that enrolment can't be changed and that you need a different agent to vouch privately in that community.
• Private vetting. Communities that use private vetting now work in Keyring, both when you apply and when you vouch for someone. It uses the same vetting steps as before, with a "Private vetting" mark where it applies: your vetters stay private, and the community learns that enough members vouched for you, not who. It needs your agent on version 0.60 or later.
• Vouching privately: when you open the vetting desk in such a community, Keyring enrols you and draws your vouching tokens by itself, and shows how many people you can vouch for now. Open Keyring at least every few days to keep vouching. When you vouch, Keyring asks how you know the person.
• Relationship and witness records now use the new DTG credential formats. Your existing contacts keep working.
• After an update, a community identity whose key was held only in the app gets it back from your agent, or Keyring asks you to reconnect your agent, instead of failing to sign in.
• A vetter opening the vetting screen no longer briefly sees the applicant's steps.

