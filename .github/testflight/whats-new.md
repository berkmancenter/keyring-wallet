# "What to Test" for the next TestFlight build.
#
# Write the release's notes here as plain-words bullets, the same ones that go
# on the build's card in the command center. The staging pipeline uses this
# file only when it changed since the previous release; otherwise it falls back
# to summarising the feat/fix commits. Lines starting with # are ignored.
# App Store Connect allows at most 4000 characters.

• Android: linking your agent no longer gives up early on a slow phone or network. If it still says your agent didn't answer, tap Try again and Keyring picks up the answer that came in late. (Fixes the known issue in the last Android build.)
• When you paste a vetter's ticket, the field, its message and "Use this link" stay above the keyboard on iPhone and Android.
• On the screen for linking your agent, the buttons no longer hide behind the keyboard on Android.
• If joining by invitation can't make your identity (for example, your agent has nowhere to publish it), the message now shows right above Continue, not at the bottom of the page.
