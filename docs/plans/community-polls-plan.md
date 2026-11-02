# Community polls in Keyring

**Status:** proposed. Implementation starts after the room files work
([keyring-bifold #877](https://github.com/berkmancenter/keyring-bifold/pull/877),
[#879](https://github.com/berkmancenter/keyring-bifold/pull/879),
[#780](https://github.com/berkmancenter/keyring-bifold/pull/780)). The open decisions are at the end.

Research behind this plan: [community-polls-plan/2026-11-02-al.md](community-polls-plan/2026-11-02-al.md).

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
Requirement numbers such as VTI-VOT-090 are upstream's. The VTA Wallet browser plugin already does
all of this for a browser
([vta-browser-plugin #404](https://github.com/OpenVTC/vta-browser-plugin/commit/a649b100),
[#406](https://github.com/OpenVTC/vta-browser-plugin/commit/f89796b1)), and it's the client we follow.

## Who sees what

| Party | Sees | Never sees |
|---|---|---|
| Community | Who took a ticket, and when | Any ballot |
| Ballot box | Every ballot or its encryption, and the IP address and time of each vote | Any member's identity |
| The member's own agent | The member's choice, because it builds the vote | Nothing is hidden from it |
| Trustees (sealed and totals-only polls) | Their share of the election key | Any voter's identity |

Linking a voter to a ballot needs the community and the ballot box to collude. That is why upstream
tells members who runs each one, and whether it's the same operator.

**Every poll uses private tickets.** The secrecy level only decides who can read the ballots:

| Level | Ballots | Needs |
|---|---|---|
| `open` | On the board in the clear, linked to no one | Nothing extra |
| `sealed` | Encrypted, opened after the poll closes | At least 2 trustees, threshold at least 2, neither the community nor the ballot box |
| `tallied-encrypted` | Only the totals are ever decrypted | As `sealed`, and choice questions only |

## What the member does

The Trust Task each step uses is named so this can be checked against upstream.

1. **Find a poll.** The app lists the community's polls (`vtc/elections/list/0.3`, `show/0.2`). The
   agent signs these reads as the member (`vta/pcs/voter/read/0.2`).
2. **See who runs it.** The app shows the ballot box's operator, and whether the community runs it
   too (VTI-VOT-090), before the member takes a ticket.
3. **Take a ticket.** `vta/pcs/voter/register/0.2`, then `vtc/elections/tickets/issue/0.1`, then
   `vta/pcs/voter/accept/0.1`.
4. **Vote, later.** The member fills in the ballot on the phone. The agent checks it and returns a
   complete vote: `vta/pcs/vote/0.2` for `open`, `vta/pcs/vote-encrypted/0.3` for the other levels.
5. **Send it.** After a random pause of up to 20 seconds, the phone posts it straight to the ballot
   box over HTTPS (`voting/ballot/cast` or `cast-encrypted`). It never passes through the community.
6. **Check the receipt.** The app accepts it only if the ballot box signed it, then hands it to the
   agent (`vta/pcs/voter/receipt/0.1`).
7. **Remember.** The phone keeps that the member voted, when, and the board entry, never the choice.
   "Change my vote" appears only where the poll allows it.
8. **See the result.** `voting/result/show/0.1`.

## Privacy rules

- **Keep the ticket and the vote apart in time.** The community knows when it issued a ticket, and
  the ballot box knows when a vote arrived, so a vote sent right after its ticket can be paired. The
  ballot says so if it's opened within an hour of the ticket.
- **The choice appears nowhere else.** Not in logs, problem reports, notifications or stored records.
- **The vote goes on its own connection,** with no session and no identity attached (VTI-VOT-004).
- **An unknown poll and a poll the member can't see look the same,** so a member learns nothing about
  polls that aren't theirs.

## Requirements

- **Member's agent:** VTA 0.69.0 or newer. VTA 0.67 serves no voter tasks. An older agent gets a plain
  "your agent needs an update" before the member starts.
- **Community:** a VTC built with the optional `voting` feature, which names a trusted ballot box in
  its configuration. VTC 0.17.1 has the newest voting work; 0.17.0 lacks parts of it.
- **Ballot box:** a running `vti-voting-service` that lists the community as allowed.

## Phases

**P0, prove the route, no app code.** Vote end to end with upstream's own `pnm elections` on a
community that has voting on.
*Done when:* one poll is created, voted in, closed and certified, and we've read its board.

**P1, vote in `open` polls.** Task types, list and detail, ballot, sending, receipt, "You voted",
results, and the "needs an update" message.
*Done when:* two phones vote; the counts match; a problem report from each holds no choice; neither
the community's log nor the board links a vote to a member; resending after a lost answer counts once.

**P2, `sealed` and `tallied-encrypted`.** `vote-encrypted/0.3`, and what the app says while trustees
form the key.
*Done when:* one sealed and one totals-only poll run with two trustees using `pnm`.

**P3, polish.** A notice of a new poll, change my vote, and letting a member check their vote is on
the board.

**Before P1 widens,** the full release test runs again, to prove that joining, hidden vetting and
sign-in still work.

## How it ships

The app work is JavaScript plus calls to the agent, with no native code. So it should ship as an
over-the-air update, not a store build. We confirm that on the real change.

Each update goes first to ring 0, the installs that opted in under Developer settings
([how OTA rings work](release-cadence-and-testing-strategy/2026-10-21-al.md)). The project lead
checks it on their own phones, and it widens only on their word. Screen designs get the same
approval first, as mocks.

## Decisions needed

1. **Which secrecy level first.** Recommended: `open`, then the two encrypted levels straight after.
2. **Binding elections.** Upstream calls the ballot cryptography unaudited: "fine for polls and
   surveys; have it reviewed before a binding election". Recommended: show `binding` polls with a
   plain warning.
3. **The phone's IP address.** The ballot box sees it when a vote arrives. Recommended: accept it, say
   so on the ballot screen, and use upstream's random pause.
4. **When the ticket is taken.** Recommended: when the member opens the poll, with the ballot available
   after that and the "can be paired" line during the first hour.
5. **Where to test.** Recommended: First VTC, whose maintainer has offered it, or their voting service
   for a test community.

## Open questions

- Does First VTC's build have the `voting` feature, and which ballot box does it trust? Its console
  shows this; nobody has checked yet.
- Can Keyring's existing community session carry the signed reads, or do they need the VTC's HTTPS
  address, as the browser plugin uses? P0 and P1 settle it.
