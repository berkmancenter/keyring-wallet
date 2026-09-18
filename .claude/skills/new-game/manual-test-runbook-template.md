# Demo runbook — <GAME NAME>

*Fill in every `<…>` placeholder for the specific game before handing this to
anyone. Modeled on `docs/DEMO_RUNBOOK_WITNESSED_EXCHANGE.md` — read that one
too if you want a filled-in example of this same shape.*

**Who this is for:** people running this by hand because the automated e2e
test couldn't run on this machine (see the "not enough room" note the skill
gave you). Nobody reading this needs to know anything about mobile
development, Appium, or emulators — just how to tap through the app on their
own phone. Write every step assuming that.

**What you need before starting:**

- **`<N>` phones**, each with the Keyring app installed — one **host** phone
  and `<N-1>` **player** phones. (Say plainly here whether these can be
  emulators too, or must be real phones — e.g. if the game needs Bluetooth
  or camera-based locality, real phones are required.)
- Everyone in the same room, or able to see/hear each other (for reading a
  code aloud, comparing screens, etc. — say what's actually needed).
- <Any other setup: a witness server running, a specific developer setting
  turned on, network requirements — copy the relevant rows from
  `docs/DEMO_RUNBOOK_WITNESSED_EXCHANGE.md`'s "Before the day" table and
  adjust for this game.>

## Before you start

| Check | Why it bites |
|---|---|
| <e.g. "Everyone's screen lock is off or set to 5+ minutes"> | <e.g. "The wallet locks after 5 minutes idle, which pauses mid-game"> |
| <e.g. "The witness server is running and reachable"> | <e.g. "Without it the game can't start — say what the host will see if it's not reachable"> |
| <add one row per real gotcha specific to this game> | |

## The flow, with what everyone sees

Fill in one row per step. Use a column per role if there are only 2-3 (like
the witnessed-exchange runbook), or a single "Who does what" column
listing the role by name if there are more than 3 — a wide table with one
column per player stops being readable past 3-4 people.

| # | Who | What they do | What everyone sees |
|---|---|---|---|
| 1 | Host | <e.g. "Opens the game, taps 'Start'"> | <e.g. "A QR code appears on the host's screen"> |
| 2 | Each player | <e.g. "Scans the host's QR code"> | <e.g. "Their screen shows 'Connected — waiting for others'"> |
| 3 | … | … | … |

State plainly, in words a non-developer would use, what marks *success* —
the specific screen, badge, or message that means the game worked. Don't
assume "it just works" is obvious from the flow table alone.

## If something looks off

| Symptom | Meaning | Do |
|---|---|---|
| <a real failure mode for this specific game> | <why it happens, in plain terms> | <the fix, in plain terms — "wait 15 seconds", "restart the app", not "check the logcat buffer"> |
| Nothing happens for a while | Most likely a network/mediator delay, not a bug | Wait ~30 seconds before assuming something's wrong |

## Timing to expect

<How long the whole thing takes end to end, and which part is the slow part
(usually mediator/network transit, not the game logic itself) — sets
expectations so nobody assumes it's broken just because it's not instant.>
