# Community polls in Keyring

A member votes in a community's polls and elections from the phone. Companion, with the
research and evidence: [community-polls-plan/2026-11-02-al.md](community-polls-plan/2026-11-02-al.md).

**State:** proposed, waiting on the decisions at the end. It starts after room files.

## What this is

Keyring is the voter only. A community's administrators create and run polls in the console
or with `cnm`. Trustee steps stay with `pnm`. Neither moves into the app.

Upstream cites below are VTI at main 3139e00e and vta-browser-plugin at f89796b1.

## Parties, and who sees what

| Party | Sees | Never sees |
|---|---|---|
| Community (registrar) | Who took a ticket, and when | Any ballot |
| Ballot box (`vti-voting-service`) | Every ballot or its encryption, the board, and the address and timing of each cast | Any member DID |
| The member's own agent | The member's choice: `vta/pcs/vote` is handed the ballot | Nothing is hidden from it |
| The trustees (sealed and totals-only polls) | Their share of the election key | A voter's identity |

Linking a voter to a ballot needs the community and the ballot box to collude
(`docs/03-vtc/elections.md`, opening section).

**Every poll uses PCS.** The ticket is blind and each cast is signed by a key made for that
cast, at every secrecy level. The levels decide who can read the ballots:

| Level | Ballots | Needs |
|---|---|---|
| `open` | On the board in the clear, linked to no one | Nothing extra |
| `sealed` | Encrypted to the election key, opened after close | At least 2 trustees, threshold at least 2, neither the community nor the ballot box |
| `tallied-encrypted` | Only the totals are ever decrypted | As `sealed`, and choice questions only |

## The member's flow

Each step names the task. The phone holds no voting key: the agent derives one per election.

1. **Find:** `vtc/elections/list/0.3` and `show/0.2`, signed by the agent with
   `vta/pcs/voter/read/0.2` and sent to the community unchanged.
2. **Show who runs it:** the disclosure of `operator` and `same_operator` (VTI-VOT-090), before
   the member takes a ticket.
3. **Ticket:** `vta/pcs/voter/register/0.2`, then `vtc/elections/tickets/issue/0.1`, then
   `vta/pcs/voter/accept/0.1`.
4. **Later, vote:** the ballot is filled on the phone and checked against the manifest. Then
   `vta/pcs/vote/0.2` (`open`) or `vta/pcs/vote-encrypted/0.3` (`sealed`, `tallied-encrypted`)
   returns a complete cast.
5. **Cast:** after a random pause of up to 20 s, the phone posts `voting/ballot/cast` or
   `cast-encrypted` to the ballot box's `TrustTaskHTTPS` door. It never goes through the community.
6. **Receipt:** the receipt is accepted only as the ballot box's signed answer, then
   `vta/pcs/voter/receipt/0.1`.
7. **Remember:** the phone keeps that it voted, when, the outcome and the board entry, and
   never the choice. "Change my vote" appears only where the manifest allows it.
8. **Result:** `voting/result/show/0.1` and the certified result.

## Rules that aren't optional

- **Ticket and vote apart in time.** The community knows when it issued a ticket and the ballot
  box when a cast arrived, so a cast right after its ticket can be paired. Voting with no
  ticket takes one and stops. A ballot opened within an hour of the ticket says it can be paired.
- **No choice in logs, reports, notifications or stored records.** Report logs are the risk here,
  as with room files.
- **The cast goes direct, on its own connection,** with no session, no mediator and no identity
  attached (VTI-VOT-004). A member's session must never carry it.
- **`pendingRegistration` and unknown elections read the same as nothing there**
  (`electionUnknown`).

## Phases

**P0, prove the route (no app code).** Upstream's own `pnm elections` votes in a poll on First VTC
through an agent at VTA 0.69 or newer, end to end, with the audit of what's logged.
*Done when:* one poll is created, voted, closed and certified, and we've seen the board.

**P1, vote in an `open` poll.** Task types, the voter module, list and detail, ballot, cast,
receipt, "You voted", results. An agent older than 0.69 gets a plain "your agent needs an
update", from discovery and never from a failed vote.
*Done when:* two phones vote on First VTC; the counts match; a report from each holds no choice;
the community's log and board link neither vote to a member; a control shows the old paths
unchanged; a resend after a lost answer casts once.

**P2, `sealed` and `tallied-encrypted`.** `vote-encrypted/0.3`, plus what the app says while
trustees are forming the key.
*Done when:* one sealed and one totals-only poll run with two trustees using `pnm`.

**P3, polish.** Notice of a new poll, change my vote, a board check by inclusion proof.

## How it ships

Everything is JS and agent calls, with no native code, so it should be an OTA. That's a
prediction: `verdict(files, {added})` decides on the real diff.

Each update goes to **ring 0 first**: `to_ring=ring0`, on the devices that used Join ring 0 in
Developer settings. The project lead looks at it on their own phones, and only their word widens it.
`OTA_PROMOTE_SOAK_HOURS` is 0, so widening needs no wait. It touches key handling and consent, so
their word on the finished diff applies through the merge lane whatever the tier says.

## Decisions waiting

1. **Secrecy for the first release.** Recommended: P1 `open`, then P2 straight after. Every level
   has PCS tickets; P2 is what hides ballots from the ballot box.
2. **Binding elections.** Upstream calls the cryptography unaudited, "fine for polls and surveys".
   Recommended: the app shows `binding: true` polls with a plain warning, and doesn't call them
   private beyond what's true.
3. **The address at cast.** The ballot box sees the phone's address. Recommended: accept it, with
   the upstream pause, and say so on the ballot screen.
4. **Ticket timing.** Recommended: take the ticket when the member opens the poll, and make the
   ballot available later, with the "can be paired" line inside the first hour.
5. **Lab poll.** Recommended: test on First VTC, as its maintainer offered, and leave the lab stack
   out unless we need destructive tests.

## Blocked on

- **Decided, waiting on someone else:** which ballot box First VTC trusts and whether its build has
  the `voting` feature. The project lead can read that in First VTC's console.
- **Not decided:** the five above.
