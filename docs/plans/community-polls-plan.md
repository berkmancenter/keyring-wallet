# Community polls in Keyring

**Status:** proposed. P1 in progress; P0's environment is pending. P0 needs an agent at VTA 0.69 or
newer and a community with voting on, and neither exists for us yet (see
[P0's environment](#p0s-environment)). Until then P1
builds what needs no environment: task types, the cast state machine, screens and their tests.
P1's "Done when" waits on P0.

**Parent:** [openvtc-integration-plan.md](openvtc-integration-plan.md). Polls add task types on
the carriage that plan already built; they add no carriage of their own (see
[How the app reaches each party](#how-the-app-reaches-each-party)).

**Reviews that shaped it:**

| Revision | Driven by |
|---|---|
| 1 (11-02) | [2026-11-02-al.md](community-polls-plan/2026-11-02-al.md), Part 1: upstream research |
| 2 (11-02) | [2026-11-02-al.md](community-polls-plan/2026-11-02-al.md), Part 2: response to a maintainer's review on wallet #825 |

## Goal

A member of a community can vote in that community's polls and elections from the Keyring app,
with their vote kept apart from their identity.

Keyring is the voter only. Administrators create and run polls in the VTC admin console or with
the `cnm` command-line tool. Trustee steps stay in the `pnm` command-line tool. Neither moves into
the app.

## Background

Upstream OpenVTC already has the voting system. This plan adds a mobile voter to it.

- **VTC:** the community's service. For voting it acts as the registrar: it decides who may vote.
- **VTA:** the member's own agent. It holds their keys and does the voting cryptography. The phone
  asks it to act and holds no voting key itself. Its version matters: see Requirements.
- **Ballot box:** a separate service, `vti-voting-service`, run apart from the community. It accepts
  votes, keeps the public or private board of them, and counts.
- **Ticket:** the community gives each eligible member one blind ticket per poll. It signs a request
  it can't read, so it can't recognise the ticket when it's used. This uses the Predicate
  Credential System (PCS), the same system as hidden vetting.
- **Cast:** the vote as sent to the ballot box, signed by a key made for that one vote.
- **Trustees:** named people who hold shares of an election key. Only sealed and totals-only polls
  use them.

Upstream's guides:
[the voting service](https://github.com/OpenVTC/verifiable-trust-infrastructure/blob/3139e00ec202351dc253d89b5b4f9885d7ae071e/docs/07-voting/README.md)
and
[community elections](https://github.com/OpenVTC/verifiable-trust-infrastructure/blob/3139e00ec202351dc253d89b5b4f9885d7ae071e/docs/03-vtc/elections.md).
Requirement numbers such as VTI-VOT-090 are upstream's; the ones this plan relies on are quoted
under [What upstream requires](#what-upstream-requires). The VTA Wallet browser plugin already does
all of this for a browser
([vta-browser-plugin #404](https://github.com/OpenVTC/vta-browser-plugin/commit/a649b100),
[#406](https://github.com/OpenVTC/vta-browser-plugin/commit/f89796b1)), and it's the client we follow.

## What upstream requires

Quoted from upstream at
[3139e00e](https://github.com/OpenVTC/verifiable-trust-infrastructure/tree/3139e00ec202351dc253d89b5b4f9885d7ae071e).
Upstream's register of VTI-VOT requirements is not in that repository; these are upstream's own
statements of them.

- **VTI-VOT-004, the cast door.** The `ballot-box` DID template's description
  (`vta-sdk/templates/ballot-box.json`): "a cast MUST be accepted over a binding whose sender holds
  no persistent identifier and no session (VTI-VOT-004)". The voting service's guide
  (`docs/07-voting/README.md`, *What it is*) names HTTPS as "the door a cast is always accepted on
  (VTI-VOT-004)".
- **VTI-VOT-090, who runs the ballot box.** `docs/03-vtc/elections.md`, *Turning it on*:
  "`operator` and `same_operator` are shown to every member before they take a ticket
  (`Disclosure`, VTI-VOT-090): the separation above is only as good as the two operators'
  independence, so members are told when one party runs both."
- **Ticket and vote apart in time.** `docs/03-vtc/elections.md`, *From the command line, as a
  member*: "the community knows when it issued a ticket and the ballot box when a cast arrived, so
  a cast sent straight after its ticket can be paired by time."
- **A resend is answered, not counted again.** `vti-voting/src/service/mod.rs`, `open_cast`: "A
  resend of a cast already on the board: its first receipt, unverified again (VTI-VOT-042)."
- **Unaudited cryptography.** `docs/07-voting/README.md`, status note: "The ballot cryptography is
  unaudited protocol code over audited group operations: fine for polls and surveys; have it
  reviewed before a binding election."

## Who sees what

| Party | Sees | Never sees |
|---|---|---|
| Community | Who took a ticket, and when; on an `open` poll it can also read the ballots | Which ballot is whose |
| Ballot box | Every ballot or its encryption, and the IP address and time of each vote | Which member cast it |
| The member's own agent | The member's choice, because it builds the vote | Nothing is hidden from it. If a provider hosts the agent, that provider can see the choice too |
| Trustees (sealed and totals-only polls) | Their share of the election key | Any voter's identity |

Linking a voter to a ballot takes the community and the ballot box together. The community knows
who took a ticket and when; the ballot box knows when each vote arrived and from which address. So
the protection is only as good as the two operators' independence. That is why upstream shows
every member who runs the ballot box, and whether the community runs it too, before they take a
ticket (VTI-VOT-090).

A poll's board is either public, readable by anyone, or private, readable by the community and its
auditors. The ballot screen says which.

**Every poll uses private tickets.** The secrecy level only decides who can read the ballots:

| Level | Ballots | Needs |
|---|---|---|
| `open` | On the board in the clear, linked to no one | Nothing extra |
| `sealed` | Encrypted, opened after the poll closes | At least 2 trustees, threshold at least 2, neither the community nor the ballot box |
| `tallied-encrypted` | Only the totals are ever decrypted | As `sealed`, and choice questions only |

## What the member does

The Trust Task each step uses is named so this can be checked against upstream.

1. **Find a poll.** The app lists the community's polls (`vtc/elections/list/0.3`, `show/0.2`) over
   its community session, as the member's identity, like every other community read. The browser
   plugin asks the agent to sign these (`vta/pcs/voter/read/0.2`) because a browser holds no key of
   the member's identity; the phone's session signs as that identity itself.
2. **See who runs it.** The app shows the ballot box's operator, and whether the community runs it
   too (VTI-VOT-090), before the member takes a ticket.
3. **Take a ticket.** The app records the poll on the phone first (see
   [One vote per membership](#one-vote-per-membership)), then `vta/pcs/voter/register/0.2`,
   `vtc/elections/tickets/issue/0.1` and `vta/pcs/voter/accept/0.1`.
4. **Vote, later.** The member fills in the ballot on the phone. The ballot screen says that
   whoever hosts the member's agent can see the choice (see
   [The ballot screen](#the-ballot-screen)). The agent checks the ballot and returns a complete
   vote: `vta/pcs/vote/0.2` for `open`, `vta/pcs/vote-encrypted/0.3` for the other levels.
5. **Send it.** The phone keeps the built vote, then posts it straight to the ballot box over HTTPS
   (`voting/ballot/cast` or `cast-encrypted`) once its send-after time has passed. It never passes
   through the community. See [Sending a vote](#sending-a-vote).
6. **Check the receipt.** The app accepts it only if the ballot box signed it, then hands it to the
   agent (`vta/pcs/voter/receipt/0.1`).
7. **Remember.** Once the agent has kept the receipt, the phone keeps only that the member voted,
   and when. It keeps no receipt, no board entry and no choice.
8. **See the result.** The certified result from `vtc/elections/show/0.2`, because `voting/result/show`
   refuses a voter on a private board.

## The ballot screen

The ballot screen must say, in plain words:

- **Whoever hosts the member's agent can see the choice.** The agent builds the vote from the
  ballot, so its host can read it. The screen never implies that no one but the member sees the
  choice. When the member runs their own agent, the host is them.
- **The ballot box sees the phone's IP address** (Decision 3).
- **Whether the board is public or private**, and who runs the ballot box (VTI-VOT-090).
- **"Can be paired"** while the poll is opened within an hour of the ticket (see
  [Privacy rules](#privacy-rules)).
- On a `binding` poll, the warning from Decision 2 and "This community counts memberships, not
  people."

The wording is the project lead's call, approved as mocks first. The requirement is what it must
say.

## Sending a vote

The cast is a state machine the phone persists, in the wallet's encrypted store:

```
ticket held → cast built (with its send-after time) → sent → receipt kept → done
```

Each step is written before the next one starts. Only the stored cast is ever sent.

**Why the phone keeps the built cast.** The agent's `vta/pcs/vote` builds a fresh cast on every
call: new randomness and a new one-time key, while the tag comes from the ticket
(`vta-service/src/operations/pcs_voter.rs`, `vote` and `sign_as_one_time_key`, at 3139e00e). A
second build is a different document. Whether the ballot box refuses it, counts it as a
replacement, or answers it depends on the poll's revote rule. Resending the same bytes is the one
retry that is always safe: the ballot box answers a resend with the first receipt (VTI-VOT-042,
quoted above).

The built cast carries the choice in the clear on an `open` poll. So the phone holds it only between
build and receipt, encrypted, and drops it as soon as the receipt is kept. It then holds the receipt
only until the agent keeps it (`vta/pcs/voter/receipt/0.1`).

| What happens | What the app does |
|---|---|
| Killed or backgrounded during the pause | The cast waits in its stored state. It goes the next time the app runs after its send-after time. The poll shows "Sending your vote" until the receipt is kept. |
| Sent, answer lost | Resend the same stored bytes. Never build a new cast for it. |
| Killed after building, before the cast was stored | Nothing went out, so build a new one. |
| Receipt kept, agent not reached | Hold the receipt, not the cast, and give it to the agent next time. |
| Killed between recording the poll and holding the ticket | Run the ticket steps again. `register` returns the same request until the ticket is held, then refuses with `TicketHeld` (`pcs_voter.rs`, `register`); the community answers a resend of the same request from its record (`vtc-service/src/elections/ops.rs`, `issue_ticket`, item 1). Neither hands out a second ticket. |
| The poll closes before the cast is sent | Tell the member the vote was not counted. Delete the stored cast. |

When the cast goes is set by its send-after time: upstream's random pause of 0 to 20 seconds (the
browser plugin's `MAX_CAST_DELAY_MS`, "the same bound `pnm elections vote` uses"). Decision 6
keeps that for now. Any option named there for the revisit only changes how the send-after time
is chosen, so a change is a number, not a new design.

## Privacy rules

- **Keep the ticket and the vote apart in time.** The community knows when it issued a ticket, and
  the ballot box knows when a vote arrived, so a vote sent right after its ticket can be paired. The
  ballot says so if it's opened within an hour of the ticket.
- **What the pause does, and doesn't.** The random pause blurs the order in which votes sent close
  together arrive. It does nothing against pairing the ticket's issue time with the vote's arrival
  time when few members vote in that window. It does nothing against the ballot box seeing the
  phone's IP address. Decision 6 keeps the pause and the warning for now, and names what a
  revisit would add.
- **The choice appears nowhere else.** Not in logs, problem reports, notifications or stored
  records. The one exception is the built cast, held encrypted between build and receipt (see
  [Sending a vote](#sending-a-vote)).
- **The vote goes on its own connection,** with no session and no identity attached (VTI-VOT-004).
- **No portable proof of a vote.** The phone keeps no receipt and no board entry after a vote (see
  [Coercion and vote-selling](#coercion-and-vote-selling)).
- **An unknown poll and a poll the member can't see look the same,** so a member learns nothing about
  polls that aren't theirs.

## Coercion and vote-selling

On an `open` poll the board holds each ballot in the clear. A receipt names its entry on the board.
A member who keeps both can show anyone how they voted, and so can be made to. The app therefore
keeps neither: after a vote the phone holds only "voted at". The same rule holds at every secrecy
level, so there is one rule to test.

Letting a member check their vote on the board is out of scope for now, for the same reason. It
would put that proof on the phone.

**The limit.** The phone not keeping the receipt doesn't remove it from the member's agent.
Upstream's VTA keeps the cast's board hash and its receipt, wrapped, until `RECEIPT_RETENTION`
(30 days) after voting closes (`vta-service/src/operations/pcs_voter.rs`, module header and
`RECEIPT_RETENTION`, at 3139e00e). Anyone who controls the agent in that window holds that
evidence. Nothing in the app can prevent someone watching the screen while the member votes. Where
a poll lets a later vote replace an earlier one, the member can replace a vote made under
pressure.

## Requirements

- **Member's agent:** VTA 0.69.0 or newer. VTA 0.67 serves no voter tasks. An older agent gets a plain
  "your agent needs an update" before the member starts.
- **The phone's access level on the agent:** the role the phone was given when it was linked must
  be `admin` or `initiator`. Those roles act as the member, and both carry the `pcsVoter` capability
  every voter task checks. A limited role such as `application` carries it only if granted by name
  (`vti-common/src/acl/mod.rs`, `derived_capabilities_for_role`, at 3139e00e). A phone without it
  gets its own message. This is the same rule hidden vetting already applies to `pcs-applicant`.
- **Community:** a VTC built with the optional `voting` feature, which names a trusted ballot box in
  its configuration. VTC 0.17.1 has the newest voting work; 0.17.0 lacks parts of it.
- **Ballot box:** a running `vti-voting-service` that lists the community as allowed.

## Where each claim is tested

Two environments, as in the `vti-lab-and-field` skill.

- **The lab:** `scripts/openvtc/local-vti-stack/`, plus a local VTC built with `--features voting`
  and a local `vti-voting-service`. The stack builds neither today; adding them is P0 work. We run
  every party, so we control the roll, the poll and both logs.
- **The field:** First VTC, with a member's agent on the VTA Farm. We don't run them (see
  [P0's environment](#p0s-environment)).

| Claim | Where |
|---|---|
| Payloads and ballot rules are correct; the cast state machine recovers | Unit tests, no stack |
| Two phones vote and the counts match | Lab, then confirmed on the field |
| Refusals: not eligible, not open, ticket already held, agent too old, limited phone, unknown poll looks like an unseen one | Lab only: they need a community and poll we control |
| The community's log and the board link no vote to a member | Lab only: we can read the community's log only where we run it |
| The task versions the app sends are the ones real servers serve | Field. The lab agrees only if its versions match |
| The ballot box is run apart from the community | Field only. On the lab we run both, so `same_operator` is our own setting and proves nothing |

**Fixture deviations are declared.** Any change to the lab made to get a green run is said in the
same commit: for example, a voting window of minutes, a shortened "first hour", `allow_any` on the
ballot box, or a value we chose for `same_operator`. A result measured across one names it. If the
result becomes an upstream finding, the deviation goes in the *Stack under test* section of
[`docs/VTI_UPSTREAM_FINDINGS.md`](../VTI_UPSTREAM_FINDINGS.md).

## Phases

### P0's environment

- **The agent:** a VTA on the VTA Farm, at 0.69 or newer, created by the project lead.
- **The community:** First VTC, if its maintainer confirms that its build has the `voting` feature
  and names a ballot box it trusts that will allow a test community. This is conditional on those
  answers (see [Open questions](#open-questions)).
- **The backup:** the lab: a local VTC 0.17.1 built with `--features voting`, and a local
  `vti-voting-service` that allows it. A run on the backup supports only the lab's claims in the
  table above, and says so.

### The phases

**P0, prove the route. No app code ships.**

1. Vote end to end with upstream's own `pnm elections` on a community that has voting on.
2. Send one signed read and one ticket request over a real Keyring session. This uses a local
   probe: worktrees of bifold and wallet main, one dev-only file that sends the two requests, run
   in a Debug simulator build. It is never pushed and never becomes a Test build. Nothing is built
   for testers, so it sits outside the room-files gate. If that reading of the gate is too wide, the
   session proof moves to ring 0 in P1's first update instead.

*Blocked on:* the Farm VTA (the project lead), and First VTC's answers (its maintainer) or the
local backup being built.
*Done when:* one poll is created, voted in, closed and certified; we've read its board; the
session carried both requests; and the result says which environment it ran on, with any fixture
deviation named.

**P1, vote in `open` polls.** Task types, list and detail, ballot, the cast state machine, sending,
receipt, "You voted", results, and the "needs an update" message.

Automated coverage P1 carries:

- **Conformance tests.** Every payload the app builds validates against upstream's schemas,
  vendored at a pinned commit. The app's ballot rules give the same answers as the browser
  plugin's and as upstream's `check_ballot` on the same cases.
- **Unit tests of the cast state machine,** across a kill, a background and a lost receipt at each
  step: the same bytes are resent, a new cast is never built for a stored one, and the stored cast
  is gone once the receipt is kept.
- **A two-device e2e,** in the style of `e2e:vrc`, once an environment exists.

*Done when:*

- Unit: the conformance and state-machine tests pass; a test shows no logger call carries a
  ballot.
- Lab: two phones vote; the counts match; a problem report from each holds no choice; neither the
  community's log nor the board links a vote to a member; resending after a lost answer counts
  once; each refusal in the table above shows its message.
- Field: the same two phones vote on First VTC with Farm agents, and the counts match. If First
  VTC can't host voting, this line stays open and the result is stated as lab only.
- The poll record is out of backups on both platforms. Android has `allowBackup="false"`. On iOS,
  `AppDelegate.mm` excludes `Documents/.afj`, where the wallet store lives; P1 confirms that on a
  device rather than from the code alone.
- The ballot screen says each line in [The ballot screen](#the-ballot-screen), seen in screenshots
  at real text size on both platforms.

**P2, `sealed` and `tallied-encrypted`.** `vote-encrypted/0.3`, and what the app says while trustees
form the key.
*Done when:* on the lab, one sealed and one totals-only poll run with two trustees using `pnm`, and
the counts match. The field run follows if the field community can take trustees; if not, the
result is stated as lab only.

**P3, polish.** A notice of a new poll, and "change my vote" where the poll allows it. Checking a
vote on the board is out of scope (see [Coercion and vote-selling](#coercion-and-vote-selling)).
*Done when:* a member gets a notice of a new poll that names the community and the closing date and
nothing else; on a poll whose revote rule replaces, a changed vote replaces the first, the count
holds it once, and the phone keeps only the new "voted at"; on a poll that refuses revotes, the app
offers no change.

**Before P1 widens,** the full release test runs again, to prove that joining, hidden vetting and
sign-in still work.

## How it ships

The app work is JavaScript plus calls to the agent, with no native code. So it should ship as an
over-the-air update, not a store build. We confirm that on the real change.

Each update goes first to ring 0, the installs that opted in under Developer settings
([how OTA rings work](release-cadence-and-testing-strategy/2026-10-21-al.md)). The project lead
checks it on their own phones, and it widens only on their word. Screen designs get the same
approval first, as mocks.

## Decisions

The project lead decides product questions. Upstream maintainers answer questions about the
environment.

1. **First secrecy level.** *Decided* by the project lead, with the design approval on 2026-11-02.
   `open`, then the two encrypted levels straight after.
   *Not chosen:* starting with `sealed`. It needs two trustees and a key ceremony before any vote
   can be tested; `open` proves the whole route first.
2. **Binding elections.** *Decided*, as above. Upstream calls the ballot cryptography unaudited
   (quoted above). The app shows `binding` polls with a plain warning and a separate check step
   before the vote is sent.
   *Not chosen:* refusing `binding` polls in the app. The community decides what a poll is for; the
   app tells the member what upstream says.
3. **The phone's IP address.** *Decided*, as above. Accepted. The ballot screen says the ballot box
   sees it, and the app uses upstream's random pause.
   *The alternative:* a relay that forwards the cast, such as an anonymising relay, or the agent's
   host. Not chosen for now: it adds a party that sees timing, and it needs infrastructure no
   community runs today. The agent's host also already knows who the member is, so forwarding
   through it puts the member and the vote's arrival side by side.
4. **When the ticket is taken.** *Decided*, as above. When the member taps Get my ticket, after
   seeing who runs the poll. The disclosure has to come first (VTI-VOT-090). The ballot comes
   later, with the "can be paired" line during the first hour.
   *Not chosen:* taking the ticket as soon as a poll appears. It would spread ticket and vote
   further apart, but before the member has seen who runs the ballot box.
5. **Where to test.** *Decided* by the project lead, conditional on First VTC's answers, which its
   maintainer gives. First VTC as the community, a Farm VTA as the agent, and the lab (a local VTC
   0.17.1 with `voting` and a local `vti-voting-service`) as the backup. See
   [P0's environment](#p0s-environment). The lab comes first for the claims only it supports (see
   [Where each claim is tested](#where-each-claim-is-tested)).
   *Not chosen:* the lab alone. It can't show that real servers serve the task versions the app
   sends, or that the ballot box is run apart from the community.
6. **How far apart the ticket and the vote are.** *Decided for now* by the project lead, who will
   revisit it. Upstream's random pause of 0 to 20 seconds, plus the "can be paired" warning while
   the poll is opened within an hour of the ticket.
   *Options for the revisit:* a minimum gap after the ticket; or "vote later" by default, sending at
   a random time within a window, with a "Send now" button. The cast's send-after time carries
   each one, so a change is only a number.

## One vote per membership

Upstream counts memberships, not people. A ticket is one per signing DID per poll, and the roll
checks that exact DID. So someone with two active memberships under two agents can take two tickets
and vote twice. Blind tickets under separate agents share nothing the app can see, so the app can't
prevent this.

The app does what it can on one phone:

- It records the poll on the phone, across agents, before asking for a ticket, and refuses a second
  ticket once a vote is recorded or a linked agent holds one.
- If the phone holds two live memberships, the app asks once per community which identity votes. Only that
  identity reads polls and takes a ticket, so the community isn't shown a link between the two.
- It uses one voter context per agent.
- It says "one vote per membership", never "one person, one vote". A `binding` poll adds "This
  community counts memberships, not people."

**Where the poll record lives.** In the wallet's encrypted store on the phone. It holds the
community, the poll, which identity votes, and the cast's state. It never holds the choice, except
the built cast while it waits for its receipt. It is never logged, and it stays out of backups
(P1's "Done when" covers both platforms).

The real fix is upstream. It goes into
[`docs/VTI_UPSTREAM_FINDINGS.md`](../VTI_UPSTREAM_FINDINGS.md) as a question once P0 has measured
it on a real community; it isn't recorded there yet. A community that needs it today can use
`roll.rule: "listed"` with one DID per person.

## How the app reaches each party

- **The community.** Reads and the ticket request go over Keyring's existing community session, in
  bifold's `trust-tasks` module (`vtiAgent.ts`), as the member's identity. The reads are signed by
  that session; the ticket request is a document the member's agent signs as the member
  (`vta/pcs/voter/register/0.2`), sent unchanged. No election task is limited by
  transport, and the VTC's HTTPS address would hand the community the phone's IP address beside
  the ticket.
- **The ballot box.** The cast goes over plain HTTPS to the ballot box's `TrustTaskHTTPS` door,
  found by type in its verified DID document. This is how room files already reach a host's door
  (`modules/rooms/real/files/door.ts`). No session, no cookie, no identity goes with it.

So polls use the carriage the parent plan built, and add only task types. P0 proves the community
leg; so far it's read from the code.

## Where polls appear

The Community screen is the home for polls. Messages shows a card only when a poll needs the member,
in the same Waiting for you stack as room offers: soonest deadline first, at most two cards, then a
count of the rest. The card names the community and the closing date, and never the question or the
member's identity. It goes once they've voted, or when the poll closes. "Not now" hides it, and it
returns once, at a random time before the close, so it doesn't prompt a vote at a time that could be
paired with the ticket.

Designs: [Community Polls mock](https://claude.ai/artifact/2D539CbjAzLb5gWg5JwbLR), shared with
reviewers on request.

## Open questions

- Does First VTC's build have the `voting` feature, which ballot box does it trust, and will that
  ballot box allow a test community? Its console shows the first two; nobody has checked yet. First
  VTC's maintainer answers these, and P0's community depends on them.
- Is the poll record excluded from iOS backups on a device, as the code reads? Checked in P1.
