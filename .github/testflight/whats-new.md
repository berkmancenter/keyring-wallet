# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

• Confirm it's you (behind its Developer switch): the "Confirm with …" sheet in a chat now opens clean, with the hint, the note and Send, and no record of the last answer. A request still waiting shows, with Cancel. Earlier answers stay on the chat cards and the contact page.
• Answers in the chat are short cards of one or two lines: "… confirmed · Face ID · time", "… says it wasn't them · May be a scam. Don't act on it.", "No answer · Ask again", or "You cancelled the request". Tap a card for the note you sent and the details, and Hide to fold it back. The "wasn't them" card stays red, and screen readers announce it as an alert.
• What to do now after "wasn't them" says: contact them using details you already have. Don't use details the request gave you.
