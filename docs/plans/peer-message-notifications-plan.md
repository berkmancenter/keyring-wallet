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
| [2026-10-11-al.md](./peer-message-notifications-plan/2026-10-11-al.md) | The mediator already has a webhook for undelivered messages, so the mediator needs configuration, not code; the gateway rings as its own trigger; the build steps for 241 |

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
- the person's **mediator**, which already reports every message it queues for a recipient it
  could not deliver to directly. The Keyring mediator is a deployment of the OpenWallet
  Foundation's `didcomm-mediator-credo` at `375518d` (identical to its `main`), which includes the
  push notifications module (#85): with `pushNotifications.webhookUrl` set, "a webhook will be sent
  to the `webhookUrl` for all messages that are queued and could not be delivered directly … If an
  FCM device token is known for the connection, it will be included in the webhook body"
  (`README.md`, Push Notifications; `apps/mediator/src/push-notifications/sendNotification.ts`).
  The token is whatever the phone registered with Aries RFC 0734 `set-device-info`. Today the
  webhook is not configured, and the phone registers no token and suggests no triggers (wallet
  `app/src/push/pushWake.ts` sends only `pushPlatform` with `set-wake`).

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

**The recipient's mediator reports each message it queues for the phone; the gateway turns that
report into a wake of its own, with a notification that does not merge.** No mediator code, no new
service, no new key:

1. **The phone gives its mediator its wake handle.** After `set-wake`, the phone sends its mediator
   an RFC 0734 `set-device-info` over the mediation connection, with the gateway wake handle as the
   device token. It sends it again whenever the handle changes, and clears it when notifications
   are turned off. The handle is opaque: useless to anyone but the gateway, and only for a trigger
   the person's agent allowed.
2. **The phone names the gateway itself as a trigger.** `set-wake` sends `suggestedTriggers:
   [<gateway DID>]`; the agent adds it to the handle's allowlist and provisions the gateway as it
   does today. So the gateway may ring this handle for a message, and nobody else gains that right.
3. **The mediator calls the gateway.** The mediator's operator sets `pushNotifications.webhookUrl`
   to a webhook endpoint on the gateway, with a secret in the URL. For each message queued for a
   phone that is not connected, the mediator posts `{connectionId, fcmToken: <handle>}`.
4. **The gateway rings, once per interval, with its own notification.** A Keyring gateway patch adds
   the webhook endpoint: it checks the secret, ignores a body without a token, rate-limits per
   handle (`MESSAGE_WAKE_MIN_INTERVAL`, proposed 30 s), and wakes the handle as its own trigger,
   checked against the handle's allowlist like any other. A wake from any trigger other than the
   handle's controller agent gets a collapse identifier of its own with a message prefix
   (`keyring-msg-…`), so it shows as a separate notification; the agent's approval wakes keep the
   shared identifier.
5. **The notification says only that something is waiting** (the existing fixed line). A tap on a
   notification whose thread or tag carries the message prefix opens the Messages tab after
   unlocking; any other opens Requests, as today.

**Why the mediator and not the agent.** The message reaches the mediator and never the agent
(§1), so only the mediator knows a message is waiting. Making the agent ring would need the
sender, or the sender's software, to send the recipient's agent a separate notice for every
message: a second message per message, a task the agent does not offer to non-administrators
today (VTI-Q52), and the sender learning which agent serves the recipient. The agent path stays
the right one for things the agent itself learns (VTI-Q40, VTI-Q47); see §5.

**Why the gateway rings rather than a separate relay.** The gateway already holds the handles, its
own DID and key, the senders and the rate limits; a separate relay would need its own DID, key,
allowlist entry and deployment, to do what one endpoint does inside the gateway. The cost is a
second Keyring patch on the gateway, kept apart from patch 0001 like 0002.

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

**What the mediator can and cannot tell.** It cannot read a message, so it reports protocol traffic
(an R-Card update, a witness step, an acknowledgement) like a chat message. The rate limit bounds
that, and exchanges run with both apps open. With pickup by polling, a message for an open app is
also queued and reported; the open app shows no banner for a wake (the approval wakes already
behave so), so the cost is a wake the person does not see.

**What the gateway learns.** The mediator's connection id for the phone and the times messages are
queued for it. The gateway already sees every wake's time; the connection id is the mediator's,
meaningless outside it.

## 4. Steps and acceptance criteria

| # | Step | Size | Owner | Done when |
|---|---|---|---|---|
| 1 | **Repro the merged wakes** on the Android emulator (FCM): five wakes to a backgrounded push-test build on a test agent | ½ day | Push lane, emulator slot | `dumpsys notification` shows 1 Keyring notification after 5 wakes delivered by the gateway (its counter moves by 5), recorded with heads |
| 2 | **Gateway patch 0003**: the mediator webhook endpoint (secret, token required, per-handle rate limit, the gateway as trigger against the allowlist) and per-wake `keyring-msg-…` collapse ids for non-controller triggers; image `-p3` | 2 days | Push lane | Patch tests: webhook without secret refused; without token ignored; rate limit; allowlist enforced; message wakes get distinct ids, controller wakes keep the shared one. Image builds |
| 3 | **Infra**: bump `GATEWAY_IMAGE_TAG` to `-p3`, add the webhook secret to the secrets, apply | ½ day | Push lane (PR); hosting collaborator (apply) | `/healthz` answers on the new image; a webhook with the secret and an unknown token returns cleanly |
| 4 | **Mediator configuration**: set `PUSH_NOTIFICATIONS__WEBHOOK_URL` (the gateway URL with the secret) on the production mediator and restart | ¼ day | Mediator operator (the infrastructure maintainer) | The mediator logs `Sending notification to <connectionId>` for a message queued for an offline test phone |
| 5 | **Phone**: `set-device-info` with the handle (and clear on off); `suggestedTriggers: [<gateway DID>]`; tap routing by the message prefix | 2–3 days | Push lane (wallet + bifold); UI lane reviews the tap | Unit tests; on the emulator, the agent's `set-wake` answer lists the gateway DID; the mediator holds the token for the phone's connection |
| 6 | **End to end** on the emulator, then on a real iPhone and Android phone with an internal build | 1 day | Push lane; the product owner's phones for the real-device row | Backgrounded: a peer message gives one notification within 10 s; 10 messages in 5 s give one per interval; two messages 40 s apart give two separate notifications; tap → Messages. Approvals unchanged (one shared notification) |

Steps 2 and 5 can run in parallel; step 4 needs step 3 deployed first (else the mediator posts to a
missing endpoint, which it only logs). Nothing needs a VTI, Credo or mediator code change.

## 5. When peer messages move to the agents

The integration plan moves the VRC exchange onto Trust Tasks, and later onto TSP between agents.
If peer messages then arrive at the recipient's **agent**, the agent is the component that knows
a message is waiting, and this design moves with them: the agent rings through its existing
wake path, and the mediator trigger of steps 2–3 is retired. That needs the agent hook VTI-Q52
asks for (a counterparty-sent notice that wakes the owner's devices under the owner's policy),
which also answers VTI-Q40 and VTI-Q47. Until then the mediator is the only component that sees
the message.

## 6. Decisions, open questions, and what is upstream

**Decided here.** Contentless, one notification per message wake (rate-limited), reported by the
recipient's mediator through its existing webhook, rung by the gateway as its own trigger.

**For the product owner.**
- **Merging this plan**, and the mediator configuration change on the production mediator every
  tester uses (the webhook fires for all its connections; the gateway ignores those without a
  token).
- **Named notifications ("Alex: …") need decision #39 reopened** (a notification service
  extension and a key usable while locked). Without that, the text stays generic.
- **Whether a message wake and an approval wake show different text.** Different text tells Apple
  and Google which kind of event happened. The default is one shared line; only the tap differs.
- **`MESSAGE_WAKE_MIN_INTERVAL`.** 30 s is proposed; shorter is closer to one notification per
  message, longer is quieter.

**For the hosting collaborator.** Applying the gateway image and secret (step 3); the mediator's
webhook setting and restart (step 4).

**Upstream (VTI, OWF), none blocking.** No upstream change is needed: the mediator's webhook and
RFC 0734 exist, and the gateway change is a Keyring patch. Patch 0003 is a candidate contribution
to vti-push-gateway, like 0001. VTI-Q52 (the agent hook) is needed only for §5. VTI-Q51 (the
4-handles-per-token cap) is unaffected: no new handle is registered.

**Open questions.**
- Whether Keyring's Credo 0.7.1 can use `@credo-ts/didcomm-push-notifications` (built for Credo
  0.6.x) or sends RFC 0734's `set-device-info` itself; either works for the mediator. Step 5
  settles it.
- Whether the gateway's allowlist check accepts the gateway's own DID as a trigger without other
  change; step 2's tests settle it.

Sources read: vti-push-gateway `e542a9d7` (README) and Keyring's patched tree at `0856939`
(`src/sender.rs`, `src/main.rs`); `didcomm-mediator-credo` `375518d` (README, `sendNotification.ts`,
`packages/push-notifications`); VTI findings source v2.13; wallet `main` at `1dfef22`; bifold
`main`; the infra repository's `variables.tf`.
