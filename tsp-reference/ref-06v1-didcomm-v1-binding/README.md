# ref-06v1 — Credo speaks the drafted DIDComm v1 Trust Tasks binding

Sibling rung to ref-06 ([plan §6](../../docs/plans/openvtc-integration-plan.md)).
ref-06 proves the task layer over the DIDComm-v2/TSP legs; this rung proves the
**DIDComm v1 leg** — the one Keyring's Credo 0.6.3 stack actually speaks — against
the binding the framework editor drafted and handed to the DTG Core Credentials
task force *(us)* to take over and amend
([`bindings/didcomm-v1/0.1`](https://github.com/trustoverip/dtgwg-trust-tasks-tf/tree/main/bindings/didcomm-v1),
discussion [#173](https://github.com/trustoverip/dtgwg-trust-tasks-tf/issues/173)).

Two parts, 12 checks:

1. **Shape conformance** — the binding's basic-message (+ reserved `trust-task`
   `~attach`) built with Credo's own message classes, compared against
   [`fixtures/reference-basic-message.json`](./fixtures/reference-basic-message.json),
   which is **emitted by the upstream reference implementation** (the
   `trust-tasks-didcomm-v1` Rust crate at the [PINS.json](../../scripts/openvtc/PINS.json)
   pin — regenerate with a scratch cargo bin on a pin advance).
2. **Live carriage** — two in-process Credo agents connect (real did:peer +
   v1 authcrypt; only the socket is elided) and the document rides
   connection-encrypted end to end, recovered byte-identically from `~attach`.

Run:

```sh
npm install
npm start          # walk-through
npm run check      # quiet pass/fail
```

## What it proves

- The `~attach` carriage **works against Credo unmodified**: the decorator
  survives authcrypt pack/unpack, the document round-trips byte-identically,
  `content` stays the human-readable summary (what a chat UI shows), and the
  connection's `theirDid` supplies the transport-authenticated sender for the
  SPEC §4.8.1 cross-check.
- The `threadId→thid` / `parentThreadId→pthid` mapping round-trips.
- The binding's `@type` equivalence rule (`did:sov:…` vs `https://didcomm.org/…`)
  is load-bearing — the reference impl emits the former, Credo the latter.
- **One real incompatibility, asserted as a passing check so it stays visible**:
  Credo validates `~thread` ids against Aries RFC 0008's shape
  (`[-_./A-Za-z0-9]{8,64}` or a DID) and therefore **refuses the `urn:uuid:` ids
  every framework example uses** (colons are excluded). Bare UUIDs pass. This
  and the other findings are logged in
  [UPSTREAM-FEEDBACK.md](./UPSTREAM-FEEDBACK.md) — **approval-gated; nothing
  goes upstream without review**.

## What it does NOT prove

- **No mediator, no network socket** — the envelope work is real but delivery is
  in-process. The mediator's feature-flagged DIDComm v1 handling (affinidi-tdk)
  is untested here; that is full-stack territory and waits for Cypress RC-1.
- **Node only** — Hermes/RN is ref-08's job, same as every rung.
- **Producer path uses internals** — Credo's public `basicMessages.sendMessage`
  API cannot attach documents (finding 2), so the probe resolves
  `DidCommMessageSender` directly. Fine for a reference probe; the app-facing
  answer is a small module (ref-07/ref-09 territory).
- Nothing about the v2.1 binding, proofs on documents, or task semantics —
  this is carriage only.

## Environment gotchas (both are recorded findings)

- `@openwallet-foundation/askar-nodejs` **must be imported before any
  `@credo-ts/*` module** — askar-shared snapshots its `askar` export for ESM
  importers at first evaluation, so the native binding has to register first.
- `package.json` carries an npm override forcing `askar-shared` to 0.6.0 —
  `@credo-ts/askar@0.6.3` declares `^0.4.3`, which otherwise yields two copies
  and an unregistered native handle. This mirrors the app's own root
  `resolutions` entry, so the rung runs the configuration Keyring ships.

Pinned against: `dtgwg-trust-tasks-tf` @ `fbe196a` (crate `trust-tasks-didcomm-v1`
0.4.0, binding spec draft 0.1 targeting framework 0.3) and `@credo-ts/*` 0.6.3 —
the same Credo the app ships. See [../../scripts/openvtc/PINS.json](../../scripts/openvtc/PINS.json).
