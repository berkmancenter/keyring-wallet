# ref-06v1d — the carrier question, measured

> **Status (2026-08-15): answered upstream.** This rung's measurement carried
> the decision — `bindings/didcomm-v1/0.2` (#216) moved the carriage to the
> dedicated `@type`, citing these results in its §2.1. Kept as the evidence
> record; the living carriage tests are ref-06v1e (type shape) and ref-06v1c
> (0.2 carriage + §2.3 migration).

The drafted `bindings/didcomm-v1/0.1` rides Aries **basic-message** with the
document in `~attach`. The framework editor's ⚠ open question — flagged
time-sensitive in [#173](https://github.com/trustoverip/dtgwg-trust-tasks-tf/issues/173):
*"Is `basic-message` the right carrier at all? … a dedicated `@type` would
route just as well."* This rung answers with measurements instead of opinion:
the identical Trust Task exchange built **both ways** between Credo 0.6.3
agents, plus a third, Trust-Task-**unaware** agent receiving each. 6 checks.

Run: `npm install && npm start` (`npm run check` for quiet).

## The measurements

**1. Implementation cost of a dedicated type: ~25 lines.**
The complete "dedicated carrier" in Credo is one message class (extending
`DidCommMessage`, with a `document` member and a registered `@type` of
`https://trusttasks.org/didcomm-v1/1.0/task`) plus one handler registration —
fenced off in `run.mjs` so the cost is visible at a glance. No decorators, no
module framework, no schema machinery. The "basic-message is easier" intuition
does not survive contact: the basic-message path *also* needs a custom send
path (the chat API is content-only — rung 06v1c) *and* must dispatch from the
live event because the chat store drops attachments. Between aware agents the
dedicated type is **less** code, not more.

**2. Chat pollution: basic-message pollutes the receiver's chat store; the
dedicated type leaves it untouched.**
After one exchange per carriage between the same two agents: dedicated type —
0 chat records anywhere; basic-message — 1 record in the receiver's chat store
(and a real client sending through the chat API would pollute the sender's
too). For Keyring, whose chat is a genuine user surface, basic-message means
either protocol noise in every conversation or filtering logic in the UI,
forever.

**3. Graceful degradation — the one thing basic-message wins, exactly once.**
An unaware wallet receiving the **basic-message** carriage: delivered cleanly,
appears as one harmless line — `"Trust Task: https://trusttasks.org/spec/acl/grant/0.1"` —
no error to anyone. The same wallet receiving the **dedicated type**: the
message dies unprocessed (in-process, the failure propagated to the sender;
over a real mediator the receiver logs it and the sender sees silence), and
the user sees nothing at all. So: basic-message degrades *visibly and
harmlessly*; the dedicated type degrades *invisibly*. Which of those is
"better" is precisely the migration-policy question, not a technical one.

## What this feeds

The reply to the editor's ask #1. The shape of the argument the data supports:
between Trust-Task-aware wallets the dedicated `@type` is cleaner on every
axis (less code, zero chat pollution, no pretending a protocol document is a
chat message); the *only* surviving argument for basic-message is the visible
mixed-fleet degradation — which for a chat-centric wallet is simultaneously
its drawback. If capability negotiation (announce/discovery) gates when a peer
starts speaking Trust Tasks — which our migration plan needs anyway — the
reach argument does no remaining work. Keyring's evidence therefore leans
**dedicated type**, with basic-message's `~attach` design kept as the
attachment convention *within* it. The call belongs to the binding review with
Brendan and the editor; this rung supplies the numbers.

## The mediated confirmation

`run-mediated.mjs` (`npm run start:mediated`) completes the picture: the
dedicated `@type` crosses the **production Keyring mediator** — mediation
granted, store-and-forward, implicit pickup — with the chat store still empty
end-to-end. As theory predicts (the `@type` is inside the encrypted envelope,
invisible to the mediator), but proven rather than assumed. Both carriages now
have identical mediated-path evidence.

## What it does NOT prove
- The dedicated `@type` used here (`trusttasks.org/didcomm-v1/1.0/task`) is a
  strawman URI for measurement, not a proposal for the registry.
- Same standing limits as the family otherwise: Node only (Hermes is ref-08); the comparison acts (1–3) run in-process, with the mediated path covered by the confirmation above.

Pinned against: `@credo-ts/*` 0.6.3; carriage conventions from
`bindings/didcomm-v1/0.1` @ `dtgwg-trust-tasks-tf` `fbe196a`.
