# ref-09 — `tsp-core`'s SigningKey/KeyAgreement ports

Resolves the design question `ref-07-credo-adapter` (parent plan §4.4, Phase
D) hit before any Credo/Askar code was written: `@openvtc/vti-tsp-js`'s
`pack`/`unpack`, and the crypto layer underneath it, all require a raw
private key handed over directly, with no entry point that accepts a
pre-computed Diffie-Hellman result instead. Askar's `Key.fromKeyExchange`
exposes exactly a raw X25519 ECDH shared secret and nothing more — the
private key never leaves Askar — so it cannot drive either as-is. Full
investigation, including a correction worth reading (an earlier pass in this
same investigation checked a stale local clone and misattributed which
library enforces this): `docs/plans/openvtc-integration-plan/2026-09-02-bam.md`.

**This rung's real destination is [`PR-CANDIDATE.md`](./PR-CANDIDATE.md)** —
an additive patch proposed against `vta-browser-plugin`'s actual pinned
source (`packages/tsp-js/src/crypto/{hpke-noble,sign}.ts`), not a permanent
fork living only here. The files below are the local, dependency-free proof
that the patch is correct, mirroring `ref-03-noble-crypto`'s own precedent
(a rung plus a `PR-CANDIDATE.md`) — this repo has no writable fork of
`vta-browser-plugin` to build the real `.ts` patch against directly.

## What this proves

1. **The port refactor is still RFC 9180-correct.** `hpke-ports.mjs` runs the
   same official CFRG HPKE-Auth test vector `ref-03-noble-crypto` validates
   against (`../ref-03-noble-crypto/vectors/cfrg-auth-x25519-chacha.json`,
   shared, not duplicated) — `AuthEncap`, `AuthDecap`, `seal`, and `open` all
   reproduce the vector's `enc`, `shared_secret`, and ciphertext exactly.
2. **The refactor changed no behavior for the raw-key case.** With the same
   static keys and a fixed ephemeral key, `ref-03-noble-crypto/hpke-noble.mjs`
   (imported directly, unmodified) and this rung's ported `seal`/`open`
   produce byte-identical `enc` and ciphertext. This is a refactor of an
   already vector- and interop-verified implementation (`ref-03`,
   `ref-03b`/`ref-03c` — 4 runtimes, one transcript hash), not a new one.
3. **A full round trip and both failure modes still work through the port**
   — a tampered ciphertext and a wrong recipient key are both rejected,
   exactly as the unported implementation rejects them.
4. **The port needs no further change to accept a real custody-boundary
   backend.** An `agree()` implementation whose private key lives only in a
   closure (unreachable from the caller) and whose one operation is forced
   through a real async boundary (`queueMicrotask`, not a synchronous
   return — the shape an out-of-process Askar RPC call would have)
   satisfies `seal`/`open` with no protocol change. This is the strongest
   evidence available without an actual Askar instance: the interface is
   exercised exactly the way a real KMS-backed adapter would exercise it.

## Why `@noble`, and why this is a small addition, not new crypto

Production `@openvtc/vti-tsp-js` (pinned commit `89d70c4`, `vti-tsp-js`
0.2.0) **already runs entirely on `@noble/curves`/`@noble/hashes`/
`@noble/ciphers`** — `crypto/hpke.ts` is a thin re-export over
`crypto/hpke-noble.ts`, and `hpke-js` survives only as a dev-dependency for
the test suite's byte-identity cross-check, never called at runtime. That
noble implementation is, in substance, this same effort's own earlier
contribution (`ref-03-noble-crypto`, merged as `vta-browser-plugin#116`) —
built for React Native, whose Hermes engine has no `crypto.subtle` at all,
and already vector- and interop-verified across four runtimes.

`ref-03-noble-crypto/hpke-noble.mjs` (this repo's local copy of that same
construction) is this rung's starting point. The only change
`hpke-ports.mjs` makes is *where* the two static-key DH calls happen:
`hpke-noble.mjs` computes `dh(staticSk, peerPk)` directly; `hpke-ports.mjs`
asks a `KeyAgreement` port to do it (`keyAgreement.agree(peerPk)`) instead.
Everything downstream — `kemContext`, `LabeledExtract`/`LabeledExpand`, the
key schedule, the AEAD — is pure symmetric crypto over public inputs and
needed no change at all. The ephemeral half of the DH (`skE`/`enc`) is never
custody-sensitive (minted fresh per message, discarded after) and stays a
plain local variable, exactly as in `hpke-noble.mjs`. Because the real
upstream file this patches is one we already got merged, proposing this as a
follow-up PR is lower-friction than a cold-start contribution — see
`PR-CANDIDATE.md`.

## Files

- `ports.mjs` — the two port shapes (`SigningKey`, `KeyAgreement`), as JSDoc
  typedefs. No dependencies, no crypto — just the interface.
- `raw-key-adapter.mjs` — the reference adapter: wraps an in-memory raw
  private key in the port shape. Changes nothing about the crypto, only
  where the private key sits relative to the call — this *is* "the reference
  adapter" the parent plan's §4.4 names.
- `hpke-ports.mjs` — HPKE-Auth (`AuthEncap`/`AuthDecap`/`seal`/`open`) and the
  outer Ed25519 `sign`, built on the ports instead of raw keys.
- `run.mjs` — the four levels of proof above.
- `PR-CANDIDATE.md` — the actual patch proposed against `vta-browser-plugin`'s
  real, current source, with the same content as the `.mjs` files above
  translated to the upstream file's TypeScript shape.

## What's still needed for `ref-07-credo-adapter` itself

This rung is the crypto-design half of "extract the ports," proven against
the raw-key case only. Still open, in roughly this order:

- ~~A real Askar-backed `KeyAgreement`/`SigningKey` adapter~~ — **done**, see
  [`ref-10-credo-askar-adapter`](../ref-10-credo-askar-adapter/): two real
  `@credo-ts/node` 0.6.3 agents, real Askar wallets, this same `run.mjs`-shaped
  fixture suite (all four levels, level 4 now real rather than simulated).
  One correction to this entry's own prediction: `Key.fromKeyExchange`'s
  `algorithm` param names the *output* key type, not the DH curve — `x25519`
  itself is rejected ("Unsupported algorithm for key exchange"); a symmetric
  tag like `c20p` is required and is inert packaging only (measured
  byte-identical against `a256gcm`).
- **A `VidResolver` port** — resolving a VID string to the keys/DID document
  it names. A simpler concern than the crypto above (no custody boundary
  involved), not attempted here to keep this rung to one question. Still
  open as of 2026-09-02.
- ~~The `eddsa-jcs-2022` signer for `auth/authenticate` (§4.5) and the Credo
  trust-task client for `bindings/didcomm-v1/0.1` (§7.9)~~ — **already ship**,
  checked against production code rather than assumed: `@bifold/trust-tasks`'s
  `documentProof.ts` (`signDocumentProof`/`verifyDocumentProof`, proven
  against a real `vta-service` verifier by `ref-08-credential-exchange`) and
  `@bifold/core`'s `DidCommV1Carriage.ts` + `ceremony.ts`, live-proven on
  attended devices. This list was written before anyone checked whether
  `@bifold/trust-tasks` already covered them. See
  [`2026-09-02-bam.md`](../../docs/plans/openvtc-integration-plan/2026-09-02-bam.md).
- **`direct.ts`'s `pack`/`unpack` CESR-framing port** — needs the `VidResolver`
  above (to resolve a peer's keys) plus production-grade `SigningKey`/
  `KeyAgreement` beyond this rung's proof script. The actual remaining gap
  for `ref-07-credo-adapter`, along with assembling the `credo-tsp-adapter`
  package itself.
- Renumbering: this rung claimed `ref-09` because `ref-07` and `ref-08` are
  both already taken on disk by unrelated rungs (`ref-07-dtg-edge-semantics`,
  `ref-08-credential-exchange`) — the parent plan's ladder table predates
  both and is stale on numbering; `tsp-reference/README.md` is the
  authoritative index.

## Running it

```sh
npm install && npm start   # verbose walk-through
npm run check               # quiet pass/fail only
```

Needs `ref-03-noble-crypto`'s own `npm install` to have been run once too
(this rung imports its `hpke-noble.mjs` and reuses its `vectors/` fixture
directly, rather than duplicating either).
