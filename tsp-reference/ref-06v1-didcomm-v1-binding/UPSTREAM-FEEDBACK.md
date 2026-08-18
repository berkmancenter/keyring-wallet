# Feedback for `bindings/didcomm-v1/0.1` — from the first Credo implementation

*Status: **DRAFT — internal only.** Nothing here goes to an issue, PR, or
comment until Alberto approves it, and it may land in our repo (as part of the
binding take-over) rather than as upstream feedback. Evidence for every item is
a check in [`run.mjs`](./run.mjs); reproduce with `npm run check`.*

*Context: the binding spec is explicitly "offered to the DTG Core Credentials
task force … to take over and amend". This file is the amendment queue. Verified
against `dtgwg-trust-tasks-tf` @ `fbe196a`, `@credo-ts/*` 0.6.3 (the version
Keyring ships), 2026-08-10.*

---

## 1. `urn:uuid:` ids fail Aries thread-id validation — the binding's ⚠ open carriage question is not the only open one

**Severity: interop-breaking for the binding as drafted.**

The binding maps `threadId→thid` / `parentThreadId→pthid` verbatim, and every
example in the framework and the reference implementation uses `urn:uuid:…` ids.
Credo validates `~thread` fields against Aries RFC 0008's shape —
`[-_./A-Za-z0-9]{8,64}` or a DID — which **excludes colons**, so a conformant
Credo agent throws `MessageSendingError` before packing. Every Aries-lineage
wallet on Credo inherits this. Bare UUIDs (36 chars, charset-clean) pass.

Options for the spec, in our preference order:

1. The v1 binding RECOMMENDS transport-representable correlators (e.g. the bare
   UUID) in `~thread`, and states the in-band members are authoritative when the
   two differ in *representation* (the existing "compare only where both are
   present" rule already almost says this — it needs a representability note).
2. Producers omit `~thread` when the framework member is not representable
   (weaker correlation; consistent with `threadId` being non-normative).
3. Asking Aries stacks to relax validation — not realistic, and the regex is
   normative in the RFC.

This composes with the editor's own position (Trust Task ids are authoritative;
transport thread ids are correlation) and with framework §4.9.1.

## 2. Credo's public API cannot produce the binding

`basicMessages.sendMessage(connectionId, message)` takes a **string** — there is
no attachment parameter, so the reserved `trust-task` attachment cannot be
produced through the high-level API at all. Our probe resolves
`DidCommMessageSender` and builds a `DidCommOutboundMessageContext` directly.

- *For the spec:* a short implementation note ("Aries frameworks' basic-message
  convenience APIs are content-only; producers should expect to construct the
  message at the framework's message layer") would save every implementer the
  same discovery.
- *For us:* the ref-07 Credo trust-task client is a small module with its own
  send path, not a wrapper over `basicMessages`.

## 3. Decorator asymmetry between Credo and the reference implementation

Credo decorates outbound basic-messages with `sent_time`, `~l10n`, `~transport`
(return-route), `~timing`, `~please_ack`; the reference implementation emits the
minimal message and — worth noting — **omits RFC 0095's `sent_time`**. Nothing
broke in either direction (Aries consumers tolerate unknown decorators), but the
spec could state explicitly that consumers MUST ignore decorators they do not
recognize and MUST NOT require `sent_time`.

## 4. Persistence: the attachment exists only in the live message

Credo's `BasicMessageRecord` persists `content` only — the `~attach` decorator
is reachable **solely on the in-flight message event**. A consumer that
dispatches from storage instead of at receive time silently loses every
document. Implementation-guidance material for the binding; a design constraint
for our `vti-client` (persist the *document*, not the transport record).

## 5. The `@type` equivalence rule is load-bearing — keep it

The reference implementation emits the `did:sov:BzCbsNYhMrjHiqZDTUASHg;spec/…`
form; Credo emits `https://didcomm.org/basicmessage/1.0/message`. The spec's
MUST-treat-as-equivalent / MUST-NOT-string-compare rule is exercised by our
conformance check and is exactly right; flagging only so it survives any
redraft.

## 6. (Environment, not spec) askar-shared single-instance hazard

First contact with the Node askar stack hit a duplicated
`@openwallet-foundation/askar-shared` (credo wants `^0.4.3`, askar-nodejs 0.6
bundles 0.6.0) plus an ESM snapshot ordering hazard (the native binding must be
imported before any `@credo-ts/*` module). Not binding feedback — but any
Credo-side reference implementation upstream publishes will hit both, so worth a
line in that future README.
