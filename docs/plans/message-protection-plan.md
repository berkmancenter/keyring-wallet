# Message protection — the client half of the Life of a Message

**Parent and siblings.** This plan is independent of, but sequenced against,
[`keyring-on-the-vta-farm.md`](./keyring-on-the-vta-farm.md) (its F0 pin advance
puts us on the mediator this contract describes) and that plan's
[`tsp_rev3_subtask.md`](./keyring-on-the-vta-farm/tsp_rev3_subtask.md) (the TSP
bridge is one of the three transport paths the gates now run on). Findings raised
against upstream live in [`../VTI_UPSTREAM_FINDINGS.md`](../VTI_UPSTREAM_FINDINGS.md).

**Reviews that shaped it** — each records its own reasoning and disposition;
this plan states only the current position:

| Rev | Review |
|---|---|
| 1 (09-20) | [`2026-09-20-al.md`](./message-protection-plan/2026-09-20-al.md) — Alberto. Why this is a plan rather than a backlog item, the measured state of our client against the seven stages, and why the ack gap outranks the backoff gap |

## 1. What this plan is for

Upstream has spent a release series turning message delivery from a best-effort
queue into a stated contract with seven stages, published as *The Life of a
Message* (`docs.fpp.storm.ws/message-protection.html`). Fourteen merged PRs
implement it — `affinidi-tdk-rs` #828–#842 — and six of them cite Keyring
findings by number.

The contract is mostly server-side, and that is the trap. **A mediator that
protects messages harder refuses more, and a client that cannot hear a refusal
is worse off than before**, because the failures move from "a message was lost"
to "a sender is silently refused everything". Two of our own findings are
exactly that shape: VTI-29 (a sender blocked by recipients who never collect)
and VTI-31 (a queue that never drains because acks were discarded).

So this plan covers what Keyring must do to be a well-behaved participant in
that contract, on both sides — as a recipient collecting and releasing
messages, and as a sender that can be refused.

**This is not a security plan.** The document's name invites the reading, and
it is wrong: there is no encryption, key management or authentication content in
it. Message confidentiality and integrity are TSP's and DIDComm's, and they are
covered elsewhere. "Protection" here means protection against loss, stranding
and starvation.

## 2. The contract, as stated

Citations are to *The Life of a Message* as published at
`docs.fpp.storm.ws/message-protection.html`, read 2026-09-20. **Before any of
this is quoted to upstream, the page is re-read directly for exact wording** —
what follows was read through a summarising fetch, which is adequate to plan
against and not adequate to quote.

| Stage | What the mediator now does | What it asks of a client |
|---|---|---|
| Acceptance | Per-relationship depth gate, default `queued_send_messages_per_peer` 50 | Nothing directly; a sender must expect refusal |
| Refusal | A queue-full refusal carries `Retry-After: 30` and a typed gate (`Peer`, `Sender`, `Recipient`) | Pace on the hint; do not exponentially back off a message that did nothing wrong |
| Queued | Depth, age, bytes and saturation are observable per folder | — |
| Handover | Records `first_delivered_at_ms` and `attempts` | — |
| Release | Undeliverable acks are parked and retried, same-transport only | **"An ack is a delete at the mediator"** — a recipient that does not acknowledge blocks that sender |
| Collection | Round-robin pickup interleaves senders fairly; a per-socket floor stops a congested client choosing the cadence | Collect regularly; page with `start_id` where order matters (**"A caller paging with `start_id` always gets stream order"**) |
| Expiry | `message_expiry_seconds` default 604800 (7 days); `delivered_expiry_seconds` is **off by default** and shortens the clock once a message has been handed over | If an operator enables it, a client's worst restart window must be shorter than it |

Two behaviours matter more than the rest and are called out here because they
are the ones a client gets wrong silently:

**A dropped live notification now announces itself.** Upstream's #830 raises a
resync flag and "the socket sends a message-pickup `status` once it is moving
again". That status is *unsolicited* — it is not an answer to a request the
client made.

**An acknowledgement is a delete, not a receipt.** A message collected and never
acknowledged stays queued against its *sender* and counts toward that sender's
limits. This is the mechanism behind VTI-29 and VTI-31, and it means a
recipient's sloppiness is paid for by somebody else.

## 3. Where Keyring stands, measured

Measured on `feat/prague-farm-membership` at `858c2fe`, 2026-09-20.

**We poll, deliberately, and that covers most of it.** `configureMessagePickup`
([`app/src/hooks/useBCAgentSetup.ts`](../../app/src/hooks/useBCAgentSetup.ts))
runs Pickup V2 on a 1-second interval, chosen because a live socket that dies
silently leaves the wallet deaf while the mediator pushes into it and the
message is lost outright. `VtiMediatorSession` does the same on its own
transport: live delivery plus a periodic delivery-request as a backstop.

Polling is the reason none of the seven stages has hurt us yet. It is also why
three gaps are latent rather than visible, and one is a real defect today.

### 3.1 We ignore the resync signal (defect, latent)

`VtiMediatorSession.startLiveDelivery` documents its backstop poll with "an
empty queue answers with a `status`, which `handleFrame` ignores." That is
exactly the frame #830 now uses to say *you missed a live push, resync*. We
discard it.

Today the 1-second poll collects the message a beat later, so the signal is
redundant. It stops being redundant the moment the poll interval is raised — and
raising it is already under discussion for low-end devices and battery. **The
mitigation and the gap are the same decision**, which is why this is in a plan
rather than a backlog.

### 3.2 We cannot tell a queue-full refusal from any other failure

`RetryingHttpOutboundTransport` retries exactly one symptom — a `CredoError`
whose cause is `Network request failed`, thrown before any response — and
rethrows everything else. That narrowness is correct and it means **we do not
hot-loop against a 503**, which is the failure #835 exists to prevent.

But we also do not *read* the refusal: a queue-full 503 surfaces as a generic
send failure, with no `Retry-After` honoured and no distinction between "this
one peer is backed up" and "everything you send is refused until your own queue
drains". A user sees a failed action and retries by hand, immediately.

### 3.3 Our ack discipline is untested at depth

We acknowledge, and `ceremony`-level tests cover the happy path. What is not
tested is the case the contract cares about: a message we collect and then fail
to process. If any path drops a message without acking it, we are VTI-31 seen
from the recipient's side — and the cost lands on the community's queue, not
ours, so nothing in our own instrumentation would show it.

### 3.4 We do not page with `start_id`

We request delivery with a limit and take what arrives. Under round-robin
pickup (#842) that is fine and arguably better. It is stated here so that the
day someone needs stream order — reconstructing a sequence, debugging a gap —
they know the parameter exists and that we do not use it.

## 4. Phases

Sequenced so that the thing which is a defect today comes first and the thing
that is merely unmeasured comes last.

### M0 — Measure ourselves against the contract on a current mediator

**Blocked on:** nothing. **Precondition for every later phase**, because our lab
is era D (mediator 0.28.0, the #829 branch tip) and every behaviour above landed
in #830–#842, which we have never run.

Advance the lab's `affinidi-tdk-rs` checkout to upstream main (0.28.9), rebuild,
re-provision and re-run the two-device vetting ceremony.

*Acceptance:* the ceremony passes on 0.28.9; VTI-31 is re-measured and either
confirmed fixed by #834 or reopened with fresh evidence; the fixture's raised
`queued_send_messages_per_peer` is dropped and the run repeated, which either
retires our one declared fixture deviation or proves it is still needed.

### M1 — Hear the resync signal

**Blocked on:** M0.

Handle an unsolicited message-pickup `status` in `VtiMediatorSession.handleFrame`
as a trigger to request delivery, rather than discarding it. The same frame
arriving as an answer to our own request keeps its current meaning.

*Acceptance:* a unit test drives an unsolicited `status` into `handleFrame` and
asserts a delivery-request goes out; a second asserts the solicited case is
unchanged. On the stack, a message delivered while the live socket is
interrupted is collected without waiting for the backstop poll.

### M2 — Read a refusal

**Blocked on:** M0.

Distinguish a queue-full refusal from a transport failure at the point a send
fails, carry the gate (`Peer` / `Sender` / `Recipient`) and `Retry-After` into
the error, and surface it as something a person can act on — a peer that is
backed up is a different sentence from an account that is over its own ceiling.

*Acceptance:* a refusal is recognised from the problem-report code suffix, not
from the 503 alone and not by substring-searching the body (upstream tests that
distinction deliberately; a body that merely quotes a gate name must not
trigger); tests cover each gate and the false-positive case; a refused send
reports the wait rather than a generic failure.

**Conditional.** This assumes our client sees the problem report at all. Credo's
outbound path may flatten a 503 before we reach it — unverified, and M0 is where
it gets checked.

### M3 — Prove the ack discipline, and decide the poll interval

**Blocked on:** M1 and M2, and on the low-end poll-interval decision that is
already stashed.

Establish that every path which collects a message either processes and
acknowledges it or acknowledges it and drops it deliberately, and that no path
drops it silently. Then revisit the 1-second interval with the resync signal in
place, since M1 is what makes a longer interval safe.

*Acceptance:* a test asserts that a handler throwing still results in an
acknowledgement; the vetting ceremony passes at the chosen longer interval; the
mediator's queue for our DID returns to zero after a run, checked rather than
assumed.

## 5. Standing rationale

**We are not moving to live-only delivery.** A live socket that dies silently
leaves the wallet deaf while the mediator pushes into a dead socket, and the
message is lost outright — measured 2026-08-18, with the mediator reporting
`message_count: 0` after such a window. #830 makes a *dropped notification*
recoverable; it does not make a *dead socket* detectable. Polling stays as the
floor under both.

**We do not exponentially back off a queue-full refusal.** The message is fine
and the wire is fine; nothing succeeds until the recipient collects. Backing off
the message punishes it for a condition it did not cause, and the server's
`Retry-After` is the better clock because only the mediator knows what it is
holding.

**We do not ack on receipt, before processing.** It would make our queue
numbers look perfect and would lose messages on a crash between the ack and the
handler. The contract asks that an ack mean "stop holding this for me", which a
terminal drop satisfies honestly; it does not ask us to lie about work not yet
done.

**`delivered_expiry_seconds` is not something we ask an operator to enable.**
It shortens durability for messages already handed over, and a client's worst
restart window is exactly what it destroys. Upstream ships it off by default and
says so; we have no reason to want it on, and a farm operator turning it on is a
risk to us rather than a feature.
