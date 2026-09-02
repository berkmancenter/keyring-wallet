# ref-09 — `tsp-core`'s SigningKey/KeyAgreement ports

Resolves the design question `ref-07-credo-adapter` (parent plan §4.4, Phase
D) hit before any Credo/Askar code was written: `vti-tsp-js`'s `pack`/`unpack`
and `hpke-js`'s `CipherSuite` both require a raw private key handed over
directly, with no entry point that accepts a pre-computed Diffie-Hellman
result instead. Askar's `Key.fromKeyExchange` exposes exactly a raw X25519
ECDH shared secret and nothing more — the private key never leaves Askar —
so neither library can be driven by an Askar-backed identity as-is. Full
investigation: `docs/plans/openvtc-integration-plan/2026-09-02-bam.md`.

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

## Why `@noble` and not `hpke-js`

`hpke-js`'s own `CipherSuite.createSenderContext` imports the raw private key
into its KEM internally (`s.kem.importKey("raw", ...)`) — it has the same
gap as `vti-tsp-js`, one layer down, and is itself backed by WebCrypto, not
`@noble`. `ref-03-noble-crypto/hpke-noble.mjs` already reimplements RFC
9180's `AuthEncap`/`AuthDecap`/`KeySchedule` from `@noble/curves`,
`@noble/hashes`, and `@noble/ciphers` alone (built for React Native, whose
Hermes engine has no `crypto.subtle` at all) — vector-verified and
interop-verified against `hpke-js` across four runtimes. This rung's only
change to that implementation is *where* the two static-key DH calls happen:
`hpke-noble.mjs` computes `dh(staticSk, peerPk)` directly;
`hpke-ports.mjs` asks a `KeyAgreement` port to do it
(`keyAgreement.agree(peerPk)`) instead. Everything downstream — `kemContext`,
`LabeledExtract`/`LabeledExpand`, the key schedule, the AEAD — is pure
symmetric crypto over public inputs and needed no change at all. The
ephemeral half of the DH (`skE`/`enc`) is never custody-sensitive (minted
fresh per message, discarded after) and stays a plain local variable, exactly
as in `hpke-noble.mjs`.

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

## What's still needed for `ref-07-credo-adapter` itself

This rung is the crypto-design half of "extract the ports," proven against
the raw-key case only. Still open, in roughly this order:

- **A real Askar-backed `KeyAgreement`/`SigningKey` adapter** — `Key.
  fromKeyExchange` for `agree()`, `signMessage` for `sign()`, on two
  `@credo-ts/node` 0.6.3 agents, run through this same `run.mjs`-shaped
  fixture suite (levels 1–3 at minimum; level 4 becomes real rather than
  simulated).
- **A `VidResolver` port** — resolving a VID string to the keys/DID document
  it names. A simpler concern than the crypto above (no custody boundary
  involved), not attempted here to keep this rung to one question.
- **The `eddsa-jcs-2022` signer for `auth/authenticate`** (§4.5) and **the
  Credo trust-task client for `bindings/didcomm-v1/0.1`** (§7.9) — the parent
  plan's remaining `ref-07-credo-adapter` scope, both downstream of the ports
  above existing.
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
