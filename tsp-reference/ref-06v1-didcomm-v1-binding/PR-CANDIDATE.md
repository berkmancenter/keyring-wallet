# PR candidate — `fix(bindings): didcomm-v1 thread correlators must be transport-representable`

*Staging target: `Mickens-Lab/dtgwg-trust-tasks-tf` (internal fork), branch
`didcomm-v1-credo-findings`, base `main` (synced to upstream `fbe196a`).
Commit `a475923`, DCO-signed. **Blocked on push access** — `albertoleon7794`
currently has read-only on the fork. The official upstream PR to
`trustoverip/dtgwg-trust-tasks-tf` comes later, after review.*

---

## PR title

`fix(bindings): didcomm-v1 thread correlators must be transport-representable`

## PR body (verbatim, ready for `gh pr create`)

The draft binding was implemented against Credo 0.6.3 — the stack the binding
names as its reason to exist ("Credo — and therefore essentially every
Aries-lineage wallet, speaks v1 and only v1"). Two probes: the carriage
agent-to-agent over real v1 authcrypt, and the same carriage through a
production Aries mediator (store-and-forward + implicit pickup). Shape was
verified against a fixture emitted by `trust-tasks-didcomm-v1` itself.

**The good news first: the `~attach` carriage works against Credo unmodified,
in both topologies.** The reserved attachment survives authcrypt pack/unpack
and mediator forwarding, the document round-trips byte-identically, `content`
renders as chat text, and the connection's `theirDid` supplies the §4.8.1
transport-authenticated sender. The ⚠ open §2 question can close in favor of
`~attach` as far as this evidence goes.

**One thing cannot ship as drafted: the verbatim `threadId → thid` mapping.**
Credo validates every `~thread` field against RFC 0008's id shape —
`MessageIdRegExp = /[-_./a-zA-Z0-9]{8,64}/` in `BaseDidCommMessage`, applied
via `Matches()` — and refuses to pack a message whose `thid` is a `urn:uuid:`
URI (the id form every framework example uses; colons are outside the
alphabet):

```
MessageSendingError: Message is undeliverable to connection …
  - property thread.threadId has failed the following constraints:
    threadId must match /^([-_./A-Za-z0-9]{8,64}|did:…)$/
```

The refusal is client-side, before the envelope exists, so no mediator or
infrastructure change can absorb it.

### The amendment

Keeps the layering the binding already asserts (in-band members authoritative,
decorator derived):

1. **§3.1 Representability** — a producer MUST NOT emit a non-conformant
   `~thread` field; where a `threadId`/`parentThreadId` is not representable
   the producer MUST **omit** the field, never truncate or rewrite it (a
   rewritten value disagrees with the in-band member, which §3.1's own
   comparison rule makes `malformedRequest`); and documents intended for this
   binding SHOULD use RFC 0008-conformant ids — a bare UUID satisfies both the
   framework's §4.3 uniqueness obligation and the transport shape. Nothing the
   framework relies on is lost: `threadId` carries no normative validation
   semantics (§4.9).
2. **§2 decorator tolerance** — consumers MUST ignore unrecognized decorators
   and MUST NOT require `sent_time`; producers SHOULD set it. (Observed:
   Credo adds `sent_time`, `~transport`, `~timing`, `~please_ack`, `~l10n`;
   the reference implementation emits the minimal message and omits
   `sent_time`. Nothing broke in either direction — the rule makes that
   guaranteed rather than lucky.)
3. **§2.2 implementation notes** — two things every Aries implementer will
   hit: the high-level basic-message APIs are content-only, so producing takes
   the framework's message layer (in Credo, `DidCommBasicMessage` +
   `appendedAttachments` through the message sender); and the persisted
   basic-message record may keep `content` only, so consumers MUST obtain the
   document from the received message, not transport storage.
4. The §2 example's `thid` becomes a bare UUID, matching rule 1.

### Evidence

Runnable probes with frozen fixtures (19 checks total, all green; the
incompatibility is itself asserted as a named check so a Credo release that
lifts the constraint is noticed):

- `tsp-reference/ref-06v1-didcomm-v1-binding/` — shape conformance against the
  reference-crate fixture + live agent-to-agent carriage (12 checks)
- `tsp-reference/ref-06v1b-mediated/` — the same carriage through a production
  Aries mediator (7 checks)

in `berkmancenter/keyring-wallet`, branch `doc/tsp-plan`.

### Out of scope, flagged for follow-up

- Aligning `trust-tasks-didcomm-v1` (the reference crate) with the omit-rule —
  today it maps verbatim and would emit non-conformant `thid`s; its
  affinidi-messaging peer does not enforce RFC 0008, which is exactly why this
  surfaced only on first Aries contact.
- `targetFrameworkVersion` is still `0.3`; bumping to 0.4 deserves its own
  audit and PR.

---

## Community rationale (why upstream wants this)

The binding's stated purpose is reaching Aries-lineage wallets; the dominant
Aries framework rejects the binding's own examples. Every implementer after us
hits the same wall, minus the diagnosis. The amendment costs producers nothing
(bare UUIDs are already legal framework ids) and closes the binding's biggest
⚠ open question (`~attach`) with cross-implementation evidence in its favor.

## Evidence it breaks nothing

- Spec-only change under `bindings/` — no `specs/` folder touched, so no
  codegen, no library version bumps, no registry rebuild obligations.
- The reference crate's 9 unit tests are unaffected (verified at the pin).
- The stricter rules describe what shipping implementations already do
  (Credo's refusal) or already tolerate (decorator asymmetry observed live in
  both directions).
