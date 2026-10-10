# Peer message notifications — one notification per message from a relationship peer

**Scope.** After two people exchange a VRC, they can message each other in Keyring (Bifold's
chat over the DIDComm connection the exchange made). This plan covers how the recipient's phone
shows a notification for each such message while Keyring is in the background or closed: which
component rings the phone, what the notification says, and why it does not merge with the
notifications before it. Approval and step-up wakes from the person's own agent are covered by
the [push notifications plan](./push-notifications-plan.md) and are unchanged here.

**Relation to other work.**
- [`push-notifications-plan.md`](./push-notifications-plan.md) — the gateway, its identity, the
  phone's registration (`push/register`, `device/set-wake`) and the locked-wallet rule (§2). This
  plan reuses all of it and adds a second trigger.
- [`message-protection-plan.md`](./message-protection-plan.md) — the mediator's queue and pickup
  contract; a woken phone collects the message through it.
- [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) — the VRC recast. Peer messages
  stay on today's DIDComm v1 connection (§7, carriage row 1) until the recast moves them; §5
  says what changes then.
- The VTI findings source (v2.13): VTI-Q40, VTI-Q47 and VTI-Q52 (an agent waking its owner's
  devices for something a counterparty sends) and VTI-Q51 (the gateway's handle cap).

**Reviews.** See [`peer-message-notifications-plan/`](./peer-message-notifications-plan/):

| Companion | Contents |
|---|---|
| [2026-10-10-al.md](./peer-message-notifications-plan/2026-10-10-al.md) | The first draft's findings: where a peer message travels today, why the 242 test's later wakes were silent, the four options and the evidence behind each disposition |

---

## 1. Where a peer message travels, and who can ring the phone

A peer message does not pass through either person's agent (VTA). It goes from the sender's
phone, over the DIDComm v1 connection the exchange created, to the **recipient's mediator** —
the production Keyring mediator (`credo-mediator.asml.berkmancenter.org`, a
`didcomm-mediator-credo` deployment the team operates) — which queues it until the recipient's
phone picks it up (Bifold `packages/core/src/hooks/chat-messages.tsx`; the carriage is row 1 of
the integration plan's §7 table).

The push gateway delivers a wake only when it is signed by a **trigger** on the handle's
allowlist. The allowlist is set by the phone's own agent from its own DID plus the triggers the
phone suggests (vta-service `operations/device.rs` `set_wake_device`), and the gateway names the
two expected triggers: `push/wake/0.2` is sent by "trigger (mediator/VTA)", and its provisioning
example allows `did:webvh:…:mediator` and `did:webvh:…:vta` (vti-push-gateway `e542a9d7`
`README.md`:110, :212). So two components can ring a phone without anything new at the gateway:

- the person's **agent**, which today rings only for its own consent and step-up requests
  (VTI-Q47's reading: `consent_request.rs:168,248` → `step_up.rs:1014` → `:1060-1061`);
- the person's **mediator**, once it is on the allowlist and knows the handle. Nothing rings from
  the mediator today: the Keyring mediator has no wake code and the phone suggests no triggers
  (wallet `app/src/push/pushWake.ts` sends only `pushPlatform` with `set-wake`).

A sender cannot ring the recipient's phone directly, and must not be able to: the wake would
need the recipient's handle, and the gateway would have to trust the sender (VTI-Q52 records the
same limit for agents).

## 2. Why later wakes are silent today

Every wake carries the same collapse identifiers. The gateway's visible-alert patch (Keyring's
patch 0001 on vti-push-gateway, `04d7330`) sets one configured value as the APNs
`apns-collapse-id` and `thread-id` and the FCM `collapse_key` and `notification.tag`
(`src/sender.rs:86-89`, `:189`), and production configures `keyring-wake`
(infra `variables.tf` `alert_collapse_id`). A wake that arrives while an earlier notification is
still shown replaces it instead of adding one, so the person sees one notification for any number
of wakes. That matches the 242 test (MR3C-MY4H): the first wake was seen and tapped, the four
after it produced nothing visible. Collapsing was chosen for approvals, where a second
notification adds nothing; for messages it hides every message after the first. §4 step 1 makes
it a per-wake choice.

The notification text is one fixed, neutral line for every wake (decision #39, 2026-09-29: the
gateway sends a visible alert with a fixed localisation key and no content, and Keyring does not
ship a notification service extension). §3 keeps that rule.

## 3. The design

**The recipient's mediator rings the recipient's phone, once per message that arrives while the
phone is not connected, with a notification of its own and no content.** In order:

1. **One notification per message wake.** A message wake carries a collapse identifier unique to
   that wake, so each one is shown separately; approval wakes keep the shared identifier, so a
   repeated approval still shows once.
2. **The phone's mediator is a trigger.** When the phone sets its wake channel it names its
   mediator in `suggestedTriggers`; the agent adds it to the handle's allowlist and provisions
   the gateway as it does today. The phone also tells its mediator its handle and the gateway's
   DID, so the mediator can address a wake.
3. **The mediator rings only for a phone that is away.** It sends `push/wake/0.2` when it queues
   a message for a recipient with no live connection, at most once per recipient per
   `MESSAGE_WAKE_MIN_INTERVAL` (proposed 30 s), so a burst becomes one notification per interval
   rather than a storm, and a message to an open app rings nothing.
4. **The notification says only that a message is waiting.** The text is fixed and neutral. A
   tap opens Keyring; after unlocking, the person lands on their chats.

**Why the mediator and not the agent.** The message reaches the mediator and never the agent
(§1), so only the mediator knows a message is waiting. Making the agent ring would need the
sender, or the sender's software, to send the recipient's agent a separate notice for every
message: a second message per message, a task the agent does not offer to non-administrators
today (VTI-Q52), and the sender learning which agent serves the recipient. The agent path stays
the right one for things the agent itself learns (VTI-Q40, VTI-Q47); see §5.

**Why the text says nothing about the sender or the content.** Showing either needs one of:
- **content in the push**, which hands the sender's name or words to Apple, Google and the
  gateway. The push design rules this out by construction: wakes are contentless
  (`binding/push/0.1`, which the gateway implements) and the push plan's premise is that a wake
  tells Apple and Google nothing;
- **a notification service extension** (iPhone) or an equivalent background handler (Android)
  that fetches the message and decrypts it before the person unlocks. That needs a key usable
  while the wallet is locked — the second way into the wallet that the push plan's §2 rules out —
  and it reverses decision #39. It is the only route to named, per-message text, and it is a
  decision for the product owner, not a step of this plan (§6).

**What the mediator can and cannot tell.** It cannot read a message, so it cannot tell a chat
message from protocol traffic (an R-Card update, a witness step, an acknowledgement). Rule 3
bounds the effect: exchanges run with both apps open, so their traffic finds the recipient
connected and rings nothing, and the rate limit caps what is left.

## 4. Steps and acceptance criteria

| # | Step | Owner | Done when |
|---|---|---|---|
| 1 | **Repro, then per-wake collapse.** First reproduce the merge on a test build: five wakes to a backgrounded phone show one notification. Then change the gateway patch so a wake may carry its own collapse identifier (a field on the trigger's request, defaulting to the configured shared one), redeploy | Push lane (patch); the infrastructure maintainer (redeploy) | Before: the repro shows 1 notification for 5 wakes, with the device log. After: 5 wakes marked per-wake show 5 notifications on an iPhone and an Android phone, and 5 approval wakes still show 1. Patch tests cover both, and the change is recorded as an upstream contribution candidate |
| 2 | **Phone names its mediator as a trigger and hands it the wake target.** `set-wake` sends `suggestedTriggers: [<mediator DID>]`; a new message from phone to mediator carries the handle and gateway DID, and is re-sent whenever the handle changes | Keyring (wallet + bifold) | The agent's `set-wake` answer lists the mediator DID in `allowedTriggers`; the mediator holds the handle for that phone; turning notifications off clears both (the agent channel as today, and the mediator's copy) |
| 3 | **The mediator rings.** In the Keyring mediator: hold each recipient's wake target, and on queueing a message for a recipient with no live connection, sign and send `push/wake/0.2` to the gateway with a per-wake collapse identifier, rate-limited per recipient. The mediator needs a DID the gateway can resolve and a DIDComm v2 or TSP client to reach it | Keyring (the mediator is ours) | With the recipient's app backgrounded, a message from a peer produces one notification within 10 s; with the app open, none; 10 messages in 5 s produce one notification per `MESSAGE_WAKE_MIN_INTERVAL`; the gateway's `wake delivered` counter moves by the same count. Measured on an iPhone and an Android phone |
| 4 | **Tap lands on chats.** A message wake's tap opens Keyring at the chats list after unlock (the approval wake's handler already does this for Requests) | Keyring (bifold + wallet) | Cold start and background: tap → unlock → chats list, on both platforms |

Steps 2–4 depend on step 1 only for being visible; they can be built in parallel. Nothing here
needs a VTI or Credo change.

## 5. When peer messages move to the agents

The integration plan moves the VRC exchange onto Trust Tasks, and later onto TSP between agents.
If peer messages then arrive at the recipient's **agent**, the agent is the component that knows
a message is waiting, and this design moves with them: the agent rings through its existing
wake path, and the mediator trigger of steps 2–3 is retired. That needs the agent hook VTI-Q52
asks for (a counterparty-sent notice that wakes the owner's devices under the owner's policy),
which also answers VTI-Q40 and VTI-Q47. Until then the mediator is the only component that sees
the message.

## 6. Decisions, open questions, and what is upstream

**Decided here.** Contentless, one notification per message wake, rung by the recipient's
mediator, rate-limited, only when the phone is away.

**For the product owner.**
- **Named notifications ("Alex: …") need decision #39 reopened** (a notification service
  extension and a key usable while locked). Without that, the text stays generic.
- **Whether a message wake and an approval wake show different text.** Different text needs the
  trigger to choose a localisation key per wake (a gateway patch, like step 1), and it tells
  Apple and Google which kind of event happened. The default is one shared line.
- **`MESSAGE_WAKE_MIN_INTERVAL`.** 30 s is proposed; shorter is closer to one notification per
  message, longer is quieter.

**Upstream (VTI / gateway), none blocking.** The per-wake collapse field (step 1) is a candidate
contribution to vti-push-gateway, like patch 0001. VTI-Q52 (the agent hook) is needed only for
§5. VTI-Q51 (the gateway's 4-handles-per-token cap) is unaffected: the mediator uses the phone's
existing handle and registers none.

**Ours.** Steps 1–4: the gateway patch (our patch set), the phone, and the Keyring mediator.

**Open question.** Whether a mediator-sent wake is accepted by the gateway with the mediator's
current DID method; the gateway resolves the trigger's DID to check the proof. Step 3 answers it
on the first send.

Sources read: vti-push-gateway `e542a9d7` (README) and Keyring's patched tree at `0856939`
(`src/sender.rs`, `src/main.rs`); VTI findings source v2.13; wallet `main` at `1dfef22`; bifold
`main`; the infra repository's `variables.tf`.
