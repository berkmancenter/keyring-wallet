# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

• Who approves, redesigned (behind the trusted-approvers Developer switch). The list shows one row per person, with their initials and a status. Tap a person to open their page, laid out in sections: their state card in one line (Details shows everything Keyring checked), what they approve as short tags, and, while a request is waiting on them, the code to read out.
• People you approve for: sending your Guardian card is now an on/off switch in its own section. Stepping down is a separate red button under "Your role", so the two can't be confused.
• Stepping down now asks the other person to remove you. Until they do, you are still their approver and their requests still show. Your page says "You asked to stop", and your card stops going to them.
• After someone steps down, their contact page shows "Ask [name] again" in place of Change, so you can invite them back. If they accept, they're a full approver again.
