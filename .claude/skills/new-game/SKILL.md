---
name: new-game
description: Use when someone wants to design or build a NEW game or interactive group activity on top of Keyring — a party game, networking icebreaker, scavenger hunt, team-forming game, tournament, or any "everyone connects to a host, then does something together" idea. One skill for whatever type of game you want to make, not a per-game-type skill. Not for reskinning the existing trading-card demo (see customizing-trading-card for that). Covers the building blocks a witness already gives you, the demo-profile extension points and their single-slot collision risk, and a fully worked example design (find-your-group-example.md).
---

# Building a new game on Keyring

A witness is not just a credential-issuing bystander — it is a **many-to-one
hub with a live connection graph, a control surface for a human, and a way to
message any connected wallet at any time.** Most "party game" or "networking
activity" ideas are a thin layer over those three things, not new
infrastructure.

This skill's own directory carries one fully worked-through example —
[`find-your-group-example.md`](./find-your-group-example.md), a game where a
witness secretly splits everyone into groups and the goal is to be the first
group to find each other. **It is a proposed design, illustrating how to
apply everything below to one concrete idea — not a feature that ships in
this repo.** Read it as a template for the level of specificity a real game
design should reach, not as a changelog of something already built. Point at
it, and at the general guidance below, the same way regardless of what kind
of game someone actually wants.

## The building blocks

| Primitive | What it gives you | Where it lives |
| --- | --- | --- |
| Reusable witness invitation | One QR code, many wallets connect to the same witness — "everyone joins a gamemaster" is not new plumbing | `WitnessService.createReusableInvitation()` |
| The reporting graph | A live, persistent map of who's connected (`connectionId → reportingDid`) and who's exchanged with whom (edges keyed by sorted DID pair) | `ReportingGraph.ts` |
| The web dashboard | A real HTTP+WebSocket surface built for "a human watches this happen" — the natural home for a gamemaster console | `WebServer.ts`, `NetworkBroadcaster.ts`, `page-*.ts` |
| Unsolicited push | The witness can message any connected wallet at any time, delivered via ordinary DIDComm mediator pickup — no push-notification service needed | `WitnessService.sendMessage(connectionId, message)` |
| Generic message dispatch | The wallet already branches on a message's `type` field for witness protocol messages; a new type is an additive case | `vrc-manager.ts`'s BasicMessage handler |
| The witnessed exchange | The "interaction" primitive for anything whose core loop is "find/connect with the right person" — QR-scan/deep-link triggered, not proximity-auto-triggered; BLE only layers on as a co-presence *attestation* after a session is already open | `WitnessConnectionProvider.tsx`, `WitnessService`'s session-request/submit-presentation flow |
| Trust Tasks | The peer-to-peer payload channel for anything exchanged *between two matched players* riding an already-open VRC relationship (a fact, a mini-game move, a signed decision) — NOT the same surface the witness's own protocol uses internally | `bifold/packages/trust-tasks`, `app/src/demo-profiles/approver/` (working precedent) |
| Card-rendering-from-stored-facts | `ContactCredentialDetails` flags (`hasWitnessCredentials`, `hasHardwareAttestation`, `hasLocalityConfirmed`) are computed once in `ListContacts.tsx` from data already stored on the wallet — never fetched live per render. A game that needs a new fact adds a new optional flag the same way | `bifold/packages/core/src/types/navigators.ts`, `ListContacts.tsx` |
| Demo profiles | The isolation boundary — a game ships as its own `app/src/demo-profiles/<name>/`, touching `bifold/core` only at established seams, never shipping in a plain Keyring build | `app/src/demo-profiles/*/`, `demo-profiles/index.ts` |

**The hard constraint that shapes every design:** a wallet's UI can only
reflect what the witness has actually *told that specific wallet*, as a
message it stored, never what the witness merely knows server-side. If a
game idea needs a card, a screen, or a toast to change, trace the exact
message that has to arrive on the wallet to make that true — don't design
the visual first and assume the data will show up.

## Map the ask to the pieces

| What the idea needs | Rests on |
| --- | --- |
| "Everyone in one place connects to a host first" | Reusable invitation — this is just connecting to a witness |
| "The host controls/starts/configures something" | A new dashboard page + API routes on the witness's web server (see the example's gamemaster console) |
| "Track who's done what" (met whom, completed a task, scored a point) | A new state class on the witness — see "The gamemaster recipe" below and the example's `GameSession`-shaped class |
| "Tell me something I don't already know" (my group, my score, a round changed, I won) | An unsolicited `sendMessage` + a new `type` case in `vrc-manager.ts`'s dispatch |
| "Show something different about a specific contact" (teammate, rank, task complete) | A new optional flag on `ContactCredentialDetails`, populated in `ListContacts.tsx`, read by whichever card is registered |
| "Exchange something between two matched people" (a fact, a move, a vote) | A Trust Task, not a witness-server change — see `approver/` |
| "This should only exist in a demo build" | A new `DemoProfile`, not changes to `bifold/core`'s always-on behavior |

## The gamemaster recipe (witness-server side)

This shape covers most game ideas — reach for it before inventing a new one:

1. **A state class**, in-memory unless the game genuinely needs to survive a
   server restart (most party games don't need `ReportingGraph`'s
   `PersistentJsonStore` durability). Hold: participants (keyed by
   `reportingDid`, not the pseudonymous identity's connectionId alone — see
   "Identifier discipline" below), whatever state machine the game needs
   (lobby/active/complete, or your own), and a pure method per state
   transition that returns what changed rather than reaching out to send
   messages itself — keep the class testable without a DIDComm agent.
2. **A dashboard page + API routes**, added as direct routes in `WebServer.ts`
   rather than through `handleApiRequest`, since a game console needs easy
   access to `witnessService`'s game state and `sendMessage`. A polling page
   (`fetch` every couple seconds) is a legitimate simplification for one
   host on one laptop; only wire into `NetworkBroadcaster`'s WebSocket feed
   if the console needs to support multiple simultaneous viewers.
3. **An inbound message handler**, added as a new `if (parsedMessage.type
   === '...')` branch alongside the existing ones in `WitnessService.ts` —
   never a new top-level protocol.
4. **A hook at an EXISTING completion point**, not a new one. The natural
   seam is where a witnessed exchange already completes and the reporting
   edge already gets recorded — game logic can run as an additive branch
   right there, keyed on the same two `reportingDid`s, rather than
   inventing a parallel completion signal.
5. **Outbound `sendMessage` calls** for anything the game needs to tell a
   wallet. Never send a full roster or another participant's identity in a
   *private* message (a group assignment, a personal result) — only that
   one wallet's own fact. A *broadcast* (e.g. "a lobby just opened") to
   every registered connection is fine precisely because it carries nothing
   sensitive.

## Identifier discipline (a trap worth anticipating)

The witness's internal notion of "who" is the pseudonymous `reportingDid` —
deliberately fresh per witness, unlinkable across witnesses. The wallet's
notion of "who" for anything UI-facing is the real VRC-issuer DID
(`ContactCredentialDetails.issuer.id`). These are NOT the same identifier,
and a message that tells a wallet "here's a fact about contact X" must name
X using the identifier the wallet's card-rendering code actually keys on —
not whichever identifier is more convenient to compute on the witness. For
example, a message telling a wallet the result of a match against a specific
person needs to carry that person's real VRC-issuer DID (extractable from
the session's VRC presentation, the same way VWC issuance already does it),
not the `reportingDid` the rest of the game logic runs on. Any new
per-contact fact needs this same translation step — check it explicitly,
don't assume the identifier you're already holding is the right one to send.

## Extension-point collisions — check this BEFORE registering anything

Every `TOKENS.COMPONENT_*` value in `bifold/packages/core/src/container-api.ts`
(`COMPONENT_CONTACT_CARD`, `COMPONENT_APP_GLOBAL_LISTENER`,
`COMPONENT_HOME_HEADER`, `COMPONENT_CONTACT_DETAILS_FOOTER`,
`COMPONENT_CRED_LIST_FOOTER`, and every other one) is a **single slot**: one
`React.FC` gets resolved and rendered, and `app/src/demo-profiles/README.md`
states the consequence plainly — *"two profiles registering the same token
means the last one wins."* This is not hypothetical: `approverProfile`
already registers `COMPONENT_APP_GLOBAL_LISTENER` today, for its own
app-wide toast. Any new game that also wants an app-wide reaction (a toast, a
modal) and reaches for that same token will collide with it — decided purely
by array order in `installedDemoProfiles`, not by anything either profile
can control on its own.

**Before adding any `container.registerInstance(TOKENS.COMPONENT_X, ...)` to
a new game's profile:**

1. Grep every installed profile (`app/src/demo-profiles/*/`) for the same
   token. `demo-profiles/index.ts`'s own comment block is required reading —
   it names exactly which token each installed profile claims and is
   supposed to be kept current; treat a stale entry there as a bug to fix,
   not a signal the check doesn't matter.
2. If the token is already claimed by an installed profile, you have three
   honest options — pick one out loud, don't silently let "last one wins"
   decide for you:
   - **Don't need it exclusively?** Route around it. A per-contact need
     (a footer, a card flag) usually has a narrower home than "global."
   - **Genuinely need it to coexist with another profile's use?** That's a
     core-level fix, not something your demo profile can route around: the
     token needs to become an **additive registry**, not a single slot.
     Copy the pattern that already solved this correctly in this codebase —
     `trustTaskRegistry`/`trustTaskDisplayRegistry`
     (`bifold/packages/core/src/modules/trust-tasks/registry.ts`), each a
     `Map<key, registration>` with an ADD method, keyed by something unique
     to the registration (there, `typeUri`) — not `registerInstance`
     overwriting a single value. Say explicitly that this is what's needed
     and get it agreed before touching `container-api.ts`; it's shared
     plumbing, not a demo-local change.
   - **Can't justify the core change right now?** Accept "last one wins,"
     but document it in the new profile's own file — name the other profile
     it collides with, what's lost, and why that's acceptable for now — the
     way `find-your-group-example.md` proposes doing for its own
     `COMPONENT_APP_GLOBAL_LISTENER` use against `approver/`.
3. Never assume a token is safe because "nothing uses it today" without
   actually grepping — `installedDemoProfiles` grows over time, and the
   check costs one grep.

## Testing — required, not optional

Every new piece of a game needs a test alongside it, written in the same
change, not after:

- **A state class**: pure unit tests, no DIDComm agent needed if you kept it
  pure per the recipe above — test the state machine's edge cases explicitly
  (what happens with 0 or 1 members in a group, a double-attempt after
  already winning, a "divide into groups" call happening twice).
- **Message dispatch**: if the handler lives inline in a large DIDComm event
  callback (like `vrc-manager.ts`'s `onBasicMessageStateChanged`), extract
  the actual type-checking/state-update logic into its own exported pure
  function first — testing the inline version would mean standing up a full
  Credo agent for no reason. This is worth doing even though the *existing*
  `witness-announcement` handling in that same file wasn't extracted this
  way; don't let precedent stop you from making new code testable.
- **React components mocking `@bifold/core`**: mock the hook as `jest.fn()`
  in the `jest.mock()` factory, then set its return value with
  `.mockReturnValue()` inside `beforeEach` — do NOT reference a `const`
  declared elsewhere in the test file from inside the `jest.mock()` factory
  itself. Jest hoists `jest.mock()` calls above regular `const`/`let`
  declarations, so the factory can silently close over an uninitialized
  value; the failure shows up as a wrong runtime value, not a compile error,
  which makes it a genuine trip-up rather than an obvious mistake. Babel's
  jest-hoist plugin only special-cases variable names prefixed `mock`, and
  even that convention doesn't fix a factory that captures an *object* built
  from other consts — the safe pattern is always "mock as `jest.fn()`,
  configure the return value in `beforeEach`."
- **A card visual branch**: a pure function (mirroring `rarityFor` in
  `TradingCard.tsx`) tested directly, plus a render test asserting the new
  visual's presence/absence/testID the same way `TradingCardProfile.test.tsx`
  already tests `rarityFor`'s output (`getByText('COMMON')` and friends).

## Planning the e2e test — required for every game

A game's whole point is what happens across multiple phones at once — a unit
test proves the state machine is correct, but only a real multi-device run
proves the actual game plays. **Every new game gets an e2e test. That part
is not optional.** Whether that test can actually *run* on the machine
building it is a separate question, answered below — but the test itself
gets written either way.

### 1. Work out the minimum player count *with the person you're building this for*

Don't decide this alone. Talk it through with them: what is the smallest
total number of participants — host plus players — that actually exercises
the game's real mechanic, not just the smallest number that completes a
connection? "Two phones talk to each other" proves the plumbing works;
it rarely proves the *game* works. `find-your-group-example.md`'s own
mechanic (splitting a pool into groups) needs at least one host plus three
players to prove a pool actually splits into two or more groups — one host
plus one player would only prove a single connection, which every other
demo in this repo already covers.

Write the number down in the test file's own header comment, with the
one-line reasoning, the same way you'd write down any other design decision
— the next person reading the test needs to know *why* it's four devices
and not two, not just that it is.

### 2. Check whether this machine can actually run that many devices

```sh
yarn e2e:check-device-budget --android <N>        # or --ios <N>, or both
```

This is a static, conservative rule-of-thumb check (`e2e/lib/multiDevice.js`
— read the comment above `BUDGET` there for the reasoning), not a promise —
it exists because this repo has real prior history of emulators OOM-killing
each other when too many run at once. It tells you, in plain numbers, how
much room this specific machine has and whether your player count fits.
Run it *before* writing the test, so a too-large player count is a two-line
message here rather than a confusing timeout an hour later.

### 3. Write the test regardless of what step 2 said

Use `e2e/lib/multiDevice.js`'s `createDevices({ android: [...roles] })` (or
`ios: [...]`) to boot one session per role — `['host', 'player1', 'player2',
'player3']`, not `['device1', 'device2', ...]`; name devices by what they
*are* in the game, because that's what the test's assertions will read like.
Model the actual flow (connect, dispatch messages, assert state) on the
closest existing pattern — `e2e/run-vrc-exchange-witnessed-android-only-devices.js`
is the nearest relative for "witness-mediated, multi-party, Android-only."
Call `screenshotAll(devices, '<meaningful-label>')` (same file) at each
meaningful beat of the game (connected, mid-game, resolved) — not only at
the end — and `teardownAll(devices)` when done, success or failure.

### 4. If step 2 said it's feasible: actually run it, don't just write it

Run the test as part of implementing the game, not as a follow-up someone
else does later. When it finishes, tell the person you're building this for,
plainly:

- **Where the screenshots are**: `e2e/artifacts/<label>-<role>-<platform>-<timestamp>.png`
  — one per role per beat you screenshotted. List the actual filenames from
  this run, don't just describe the pattern.
- **The exact command to run it again themselves** — copy-pasteable, with
  every env var it needs already filled in for this game (which AVDs/UDIDs
  map to which role), not left as an exercise.
- **How to watch it happen live**, not just read the screenshots after the
  fact: the emulators must be visible windows, not headless — if you booted
  them yourself as part of this run, say so and say they can just watch;
  if they're booting emulators themselves to re-run it, the instruction is
  "don't add `-no-window` (or any headless flag) when starting the AVD" —
  say that in exactly those words, because someone who isn't a mobile
  developer won't know which flag that is otherwise.

### 5. If step 2 said it's NOT feasible: say so plainly, then hand them a manual runbook

Don't fail silently and don't bury this in a wall of output — lead with it:
*"This game needs `<N>` devices at once; this machine has room for at most
`<M>`, so I can't run the automated test here. The test itself is written
and will run on a machine that does have room — here's how to try it
yourself with real people instead."*

Then copy [`manual-test-runbook-template.md`](./manual-test-runbook-template.md)
to a real file (e.g. `docs/DEMO_RUNBOOK_<GAME_NAME>.md`, matching
`docs/DEMO_RUNBOOK_WITNESSED_EXCHANGE.md`'s naming) and fill in every
placeholder for this specific game. Write it for someone who has never used
Appium, never heard of an emulator, and doesn't know what a testID is —
because that's exactly who ends up running a manual demo. Plain steps, one
per person, one row per step, exactly what they'll see on screen at each
point, and a troubleshooting table for what a normal hiccup looks like
versus an actual bug. `docs/DEMO_RUNBOOK_WITNESSED_EXCHANGE.md` is a real,
filled-in example of this same shape — read it, don't just read the
template.

## Seeing it on screen

Identical loop to `customizing-trading-card`'s "Seeing it on screen" section
— read that first. The one addition for a game: the witness-server itself
needs to be running with its web port reachable — `cd
bifold/packages/witness-server && yarn dev` (auto-restarts on save) or
`yarn start` — so the gamemaster console is visible in a browser, separately
from the mediator that `customizing-trading-card`'s loop already starts. A
physical device needs the mediator in tunnel mode (plain `yarn mediator`,
no `--endpoint`) rather than `--endpoint http://10.0.2.2:3010`, which is
emulator-only and silently unreachable from a real phone.

## Verify

```sh
# Witness-server changes
cd bifold/packages/witness-server && yarn test

# Core changes (vrc-manager, ContactCredentialDetails, ListContacts)
cd bifold/packages/core && yarn test

# App-side demo profile + card changes
cd app && yarn test __tests__/demo-profiles/ && yarn lint && yarn typecheck
```

## Scope discipline

A game demo profile should touch `bifold/core` at exactly the seams this
skill names — a new optional `ContactCredentialDetails` flag, a new message
`type` case in the existing dispatch, a new token if (and only if) none of
the existing ones fit and the collision check above came back clean. If a
game idea seems to need something else from core protocol internals
(a new credential type, a new DIDComm protocol, changing how VWCs are
issued), that's a bigger conversation than "add a demo profile" — say so
rather than reaching into `bifold/packages/core/src/modules/vrc/` uninvited,
the same discipline `customizing-trading-card` already asks for.
