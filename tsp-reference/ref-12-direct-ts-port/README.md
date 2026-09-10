# ref-12 — `direct.ts`'s `pack`/`unpack`, ported onto `tsp-core`'s three ports

Closes the item ref-09/ref-10/ref-11 all named as the natural next increment:
`direct.ts`'s `pack`/`unpack` (CESR framing + HPKE-Auth seal/sign) still took
raw `PackKeys`/`UnpackKeys` directly, with no injection point for an opaque
signer/key-agreement/resolver. This rung reimplements the orchestration on
`SigningKey`/`KeyAgreement` (ref-09/ref-10) and `VidResolver` (ref-11)
instead. Full background:
`docs/plans/openvtc-integration-plan/2026-09-02-bam.md`.

## The framing is reused, not retyped

The CESR wire primitives and the envelope frame
(`encodePayloadFrame`/`decodePayloadFrame`/`encodeSignatureFrame`/
`decodeSignatureFrame` in `direct-port.mjs`) are rebuilt on top of the
**real, published `@openvtc/vti-tsp-js` package's own exported `cesr`
(`wire.ts`) and `encodeEnvelope`/`decodeEnvelope` (`envelope.ts`)** — pure
byte/VID framing with no keys involved, confirmed byte-identical between the
published `0.1.0` and the pinned `89d70c4` clone (only `crypto/hpke.ts`'s
backend changed between those, not the framing; diffed directly, not
assumed). Reusing the real exports instead of hand-transcribing them removes
an entire class of transcription bugs from the one thing that has to be
byte-exact for wire interop — this rung's own orchestration logic is the only
new code, and it's checked against the real package directly (see level 1
below), not just against itself.

## What this proves

Two levels, each "real" in a different way:

1. **Interop with the real, published `@openvtc/vti-tsp-js`, both
   directions.** Our ported `pack()` (raw keys wrapped in ref-09's raw-key
   ports + a fixture `VidResolver`) is unpacked correctly by the real
   package's own `unpack()`; the real package's `pack()` is unpacked
   correctly by our ported `unpack()`. Payload, sender/receiver VIDs, and
   thread digest all match in both directions. This is not a
   self-consistency check — if this rung's rebuilt framing or port-based
   orchestration diverged from the real implementation's wire format at all,
   one direction would fail. Both failure modes (tampered wire bytes, wrong
   recipient) are checked on our `unpack()`.
2. **A real end-to-end round trip over Credo/Askar, both directions.** Two
   real `@credo-ts/node` + Askar identities (alice, bob), each a single
   Ed25519 key minted inside Askar and never exported, exposed as both a
   `SigningKey` port and — via Askar's own `Key.convertkey({algorithm:
   "x25519"})`, not an independently-generated key (see below) — a
   `KeyAgreement` port, each with a did:key VID. A real Credo `VidResolver`
   (ref-11) resolves each side's counterparty keys with no network and no
   prior relationship (did:key is self-certifying). Full envelope round trip
   both directions: CESR framing, HPKE-Auth, outer signature, VID
   resolution, all driven by real custody. Both failure modes checked
   (tampered message, wrong recipient).

14/14 checks green.

## A real mistake, caught and fixed: derived vs. independent keyAgreement keys

The first version of this rung's Askar identity minted an INDEPENDENT X25519
key via `kms.createKey` for `KeyAgreement` — the same pattern ref-10 used.
Level 2 failed outright with `invalid tag` (AEAD authentication failure).
Cause: `did:key`'s resolved `keyAgreement` verification method is **always**
derived from the identity's Ed25519 key via the standard Edwards→Montgomery
birational map (`@credo-ts/core`'s `keyDidDocument.mjs`,
`convertPublicKeyToX25519`) — never an independent key. So the real
`VidResolver` correctly resolved the DERIVED key, while this identity's own
`agree()` used a completely different, independently-generated keypair —
two different DH problems, silently. The fix:
`local-credo-identity.mjs`'s `keyAgreementFromEd25519AskarKey` derives the
`KeyAgreement` from the SAME Ed25519 Askar key via `Key.convertkey
({algorithm: "x25519"})` (the private-key-side analogue of the public-key
conversion `did:key` performs, staying inside Askar throughout), so what
`agree()` uses and what `VidResolver` resolves are provably the same key —
checked, not assumed, by computing the expected public key independently
with `@stablelib/ed25519`'s `convertPublicKeyToX25519` and asserting it
against `keyAgreement.publicKey` before ever calling `agree()`.

## A real cross-package DI hazard, same one ref-11 hit

`local-credo-identity.mjs` is a deliberate, documented DUPLICATE of ref-10's
`askar-adapter.mjs` and ref-11's `credo-adapter.mjs` — not imported directly,
for the identical reason ref-11's README documents: a file physically living
in another rung's directory resolves its own bare `@credo-ts/core` import
against THAT rung's `node_modules`, a different object identity than the
copy this rung's own `Agent` is built from, and `tsyringe`'s DI container
keys its metadata off the exact class reference. `ref-09`'s pure
`hpke-ports.mjs` has no such problem and is imported directly, as ref-10/
ref-11 already established.

## Files

- `direct-port.mjs` — the ported `pack`/`packWithHops`/`unpack`.
- `local-credo-identity.mjs` — `createAskarIdentity` (a real Askar-backed
  `SigningKey` + derived `KeyAgreement`, with a did:key VID) and
  `createCredoVidResolver` (unchanged copy of ref-11's, for the DI-identity
  reason above).
- `run.mjs` — the two levels of proof above.

## What's still needed for `ref-07-credo-adapter` itself

Every port ref-09/ref-10/ref-11 named, and now the envelope layer built on
them, are proven. Still open:

- **Assembling the actual `credo-tsp-adapter` package (§5.2)** — everything
  across ref-09 through ref-12 is `tsp-reference` proof, not the production
  Credo Module. This rung's `local-credo-identity.mjs` and `direct-port.mjs`
  are close to that package's actual shape, not just a proof of concept.
- **A production `TspCarriage`** implementing `@bifold/trust-tasks`'s
  `Carriage` port on top of this rung's `pack`/`unpack`, physically delivered
  over the existing DIDComm-v1 connection (see the parent plan's §5.4
  wallet-to-wallet scope correction — this does not need `vta-service`).
- The Credo trust-task client for `bindings/didcomm-v1/0.1` and the
  `eddsa-jcs-2022` signer for `auth/authenticate` **already ship** — not this
  rung's concern, noted so nobody re-derives it as open again.

## Running it

```sh
npm install && npm start   # verbose walk-through
npm run check              # quiet pass/fail only
```

Needs `ref-09-tsp-core-ports`'s pure `.mjs` files (imported directly, not
duplicated) and `@openvtc/vti-tsp-js` (the real published package) — no
separate install needed for the former.
