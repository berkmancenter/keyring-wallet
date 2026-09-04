# ref-11 — the `VidResolver` port for `tsp-core`

Closes the one item both `ref-09-tsp-core-ports` and `ref-10-credo-askar-
adapter` named as still open: *"A `VidResolver` port — resolving a VID string
to the keys/DID document it names... not attempted here, a simpler concern
than the crypto above (no custody boundary involved)."* No custody boundary
is exactly why this rung, unlike ref-09/ref-10, needs no split between a
port-design rung and an Askar-backed rung — both adapters land together.
Full background: `docs/plans/openvtc-integration-plan/2026-09-02-bam.md`.

## What this proves

Four levels, adapted from ref-09/ref-10's structure to a lookup port rather
than a crypto operation — level 3 is the one that actually grounds this in
real cryptography, by feeding the resolver's output through ref-09's ported
HPKE-Auth:

1. **Fixture adapter correctness** — the raw-key/in-memory adapter round-trips
   registered keys exactly and rejects an unregistered VID rather than
   returning `undefined`.
2. **Credo-backed adapter, known key, independent cross-check** — a real
   `@credo-ts/node` + Askar agent creates a `did:key` DID from a KNOWN,
   externally-held Ed25519 seed (imported, not opaquely generated, so this
   rung can check the answer). The resolved `signingPublicKey` matches the
   known Ed25519 public key exactly; the resolved `encryptionPublicKey`
   matches an **independently computed** Ed25519→X25519 conversion
   (`@stablelib/ed25519`'s `convertPublicKeyToX25519` — the same library
   Credo's own did:key document builder uses internally, called here from
   *outside* Credo's code path) — proving Credo's resolution and this rung's
   own math agree, not just that the code runs without error.
3. **A real HPKE-Auth round trip using ONLY resolver output** — the strongest
   check, and the one that matters: a sender (`ref-09`'s plain raw-key
   `KeyAgreement` — Askar-to-Askar agreement is already exhaustively proven in
   `ref-10` and isn't this rung's concern) seals a message to the recipient's
   `encryptionPublicKey` **exactly as returned by the Credo `VidResolver`**,
   nothing else about the recipient's key handed over by hand. The recipient
   side is driven by an X25519 private key derived independently from the
   known seed (`convertSecretKeyToX25519`, never touched by
   `createCredoVidResolver` at all) and opens it correctly. If the resolver
   had returned the wrong bytes, this `open()` would fail outright — it is
   not a self-consistency check.
4. **Failure modes** — an unregistered fixture VID and a syntactically
   unresolvable `did:key` both reject with a clear error rather than a
   partial or `undefined` result.

9/9 checks green.

## A real cross-package hazard, worth keeping in view

Level 3 deliberately does **not** import `ref-10`'s `createAskarKeyAgreement`
for the sender side, even though it would have been the more "real" choice on
paper. Doing so pulls in a *second*, separately `npm install`-ed copy of
`@credo-ts/core` from `ref-10-credo-askar-adapter/node_modules` (Node resolves
a bare specifier relative to the importing *file's* own directory, not the
entry script's) — a different object identity than the copy this rung's own
`Agent` is built from. `tsyringe`'s DI container keys its metadata off the
exact class reference, so `agent.dependencyManager.resolve(Kms.
KeyManagementApi)` inside the borrowed file throws `TypeInfo not known for
"KeyManagementApi"` even though the version numbers match exactly — measured,
not assumed (that was the first thing tried). `ref-09`'s pure, `@noble/*`-only
files (`ports.mjs`, `hpke-ports.mjs`, `raw-key-adapter.mjs`) don't have this
problem — plain functions don't care which physical copy of a pure-math
package they came from — which is why every rung so far has imported those
freely across directory boundaries and only this rung hit the issue: it's the
first to need a *second* independent Credo DI-container-backed file. The fix
is the one above: keep the sender on `ref-09`'s raw-key port instead.

## Files

- `ports.mjs` — the `VidResolver` typedef.
- `raw-key-adapter.mjs` — the reference adapter: an in-memory VID→keys
  registry.
- `credo-adapter.mjs` — `createCredoVidResolver(agent)`: resolves a VID via
  `agent.dids.resolveDidDocument` (the same public Credo API
  `@bifold/trust-tasks`'s `documentProof.ts` already calls in production) and
  extracts the signing key (assertionMethod/authentication/
  verificationMethod, same fallback order as `documentProof.ts`'s
  `firstSigningVerificationMethod`) and the keyAgreement key.
- `run.mjs` — the four levels of proof above.

## What's still needed for `ref-07-credo-adapter` itself

This closes the `VidResolver` half of what ref-09/ref-10's READMEs left open.
Still open:

- ~~`direct.ts`'s `pack`/`unpack` CESR-framing port~~ — **done**, see
  [`ref-12-direct-ts-port`](../ref-12-direct-ts-port/) — which also found a
  real bug in the naive way to combine this rung with ref-10's: a
  `KeyAgreement` derived from an independent X25519 key (ref-10's own
  pattern) resolves to the WRONG public key once a real `VidResolver` is in
  the loop, because a `did:key`'s keyAgreement entry is always derived from
  the identity's Ed25519 key, never independent.
- Assembling the actual `credo-tsp-adapter` package (§5.2) — everything so
  far, across ref-09/ref-10/ref-11, is `tsp-reference` proof, not the
  production Credo Module.
- The Credo trust-task client for `bindings/didcomm-v1/0.1` (§7.9) and the
  `eddsa-jcs-2022` signer for `auth/authenticate` (§4.5) **already ship** —
  `@bifold/core`'s `DidCommV1Carriage.ts`/`ceremony.ts` and
  `@bifold/trust-tasks`'s `documentProof.ts` respectively. Not this rung's
  concern; noted so nobody re-derives it as open again.

## Running it

```sh
npm install && npm start   # verbose walk-through
npm run check              # quiet pass/fail only
```

Needs `ref-09-tsp-core-ports`'s pure `.mjs` files (imported directly, not
duplicated) — no separate install needed for those.
