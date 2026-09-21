# Worked example: "Find Your Group"

**This is a proposed design, not a feature in this repo.** It exists to show
what applying this skill's guidance to one concrete idea actually looks
like, at the level of specific files and classes — a template for the kind
of specificity a real game design should reach, not a report of code
sitting somewhere for you to go read. If you want to actually build this
game, this is exactly the shape to start from.

## What the game is

Find Your Group is a party/mixer game for an event where everyone already
has (or installs) the Keyring app.

One person — the host — runs the "gamemaster": a laptop showing a control
page with a QR code. Everyone else connects to it, the same way they'd
connect to any Keyring witness at any other event.

Once enough people have joined, the host picks how many groups to split into
and clicks one button. Behind the scenes, everyone gets randomly assigned to
a group — but **nobody is told who else is in their group.** You only ever
learn your own group number, in private.

From there, it plays like a structured icebreaker: you go around the room
making ordinary Keyring connections with people near you, the same way you'd
exchange a card with anyone. The instant you connect with someone, your app
tells you — right on their trading card — whether they're in your group
("🎉 TEAMMATE") or not ("NOT YOUR GROUP"). You don't find out any other way;
there's no list, no reveal, no shortcut.

**The goal:** be the first group where everyone has found their way to
everyone else — directly, or through a chain of teammates who've each found
each other. The moment a group finishes, every member of that group gets a
"you found your group!" notification, right there on their phone.

It turns "make a few connections" — the thing the underlying demo already
does — into a reason to actually walk around and talk to strangers, with a
payoff (the badge, the win moment) that shows up immediately rather than
after the event.

## How you'd build it

Nothing about the underlying Keyring connection or credential exchange needs
to change. Everything below is new code layered on top, split across the two
halves of the system: the witness (which the host runs) and the wallet (the
app everyone else uses).

### The witness side (the host's laptop)

- **`bifold/packages/witness-server/src/GameSession.ts`** (new) — the
  game-state class this skill's "gamemaster recipe" describes: who's
  joined, the private group assignments, and which pairs have found each
  other so far. In-memory only (restarting the witness resets the game —
  deliberate, since a game only makes sense for one running event). Also
  does the win check: a group "wins" once its members form one connected
  chain of matches, not necessarily every possible pair.
- **`WitnessService.ts`** (extend) — two additions: a handler for a
  `game-join` message a wallet sends to enter the lobby, and a small hook at
  the existing point where a witnessed exchange between two people
  completes — right there, additionally check whether a game is running and
  whether the two people are in the same group, and message both of them
  the result. If that match makes a group fully connected, separately
  message everyone in that group that they won.
- **`WebServer.ts` + a new `page-game.ts`** — a `/game` page on the
  witness's existing web dashboard: an explainer, a box for how many groups,
  and Open Lobby / Divide into Groups buttons, plus a live view of how many
  people have joined and each group's progress (counts only — never names,
  keeping the grouping actually private). A few new `/api/game/*` routes
  back the buttons.
- **`web-renderer.ts`** (extend) — one-line addition wiring the new page
  into the dashboard's existing page registry.

### The wallet side (everyone else's phone)

- **`bifold/packages/core/src/modules/vrc/vrc-manager.ts`** (extend) — the
  wallet already listens for messages from a witness; add four new kinds it
  understands: "a lobby just opened," "you're in group N," "that attempt
  matched/didn't," and "your group won." Each updates a small bit of local
  state and hands off to whatever's listening for it.
- **`bifold/packages/core/src/types/navigators.ts`** (extend) — one new
  optional fact a contact card can know about a person: whether they're
  confirmed to be in your game group.
- **`ListContacts.tsx`** (extend) — fill in that new fact for each contact,
  the same way it already fills in "was this witnessed," "was
  hardware-verified," etc.
- **`app/src/demo-profiles/trading-card/TradingCard.tsx`** (extend) — the
  actual visible change: a small badge on the card reading either
  "🎉 TEAMMATE" or "NOT YOUR GROUP," shown only once you've actually tried
  connecting with that person.
- **`app/src/demo-profiles/witness-game/`** (new) — the game's own small
  add-on: a popup that appears when a lobby opens (explains the rules, has a
  Join button) and toast notifications for "you're in group N" and "you
  won." Registered the same way the trading-card and approver demos are —
  as an independent, switchable add-on, not a change to the core app. This
  is exactly where the extension-point collision check matters: this
  add-on needs an app-wide reaction, which means `COMPONENT_APP_GLOBAL_LISTENER`
  — a token `approver/` already claims today. The honest move is to say so
  explicitly in this profile's own file (which other profile it collides
  with, what's lost, why that's acceptable for a first pass), not to
  silently let "last one wins" decide.
- **`demo-profiles/index.ts`** (extend) — one line adding the new add-on to
  the list of demos this build carries.

### Tests

Each piece of logic above deserves its own test, written alongside it, not
after: the group-assignment and win-detection logic, the four new message
types, the card's new badge, and the join/toast popup component. See this
skill's "Testing — required, not optional" section for the patterns those
tests should follow.
