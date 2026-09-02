# PR candidate — pluggable `KeyAgreement`/`SigningKey` for `@openvtc/vti-tsp-js`

*Status: **staged as a draft PR for internal review**:
[`Mickens-Lab/vta-browser-plugin#1`](https://github.com/Mickens-Lab/vta-browser-plugin/pull/1)
(2026-09-02), `feat/pluggable-key-agreement` → that fork's own `main` —
not against `OpenVTC/vta-browser-plugin`, and not yet requested for
official upstream review; Alberto flagged for a look. Base: `main` at
`3c15d6e` (2026-09-01), confirmed identical to the pinned `89d70c4` for
every file this patch touches (`gh api .../compare/89d70c4...3c15d6e` —
zero changes under `packages/tsp-js/src/crypto/`). Target:
`packages/tsp-js/src/crypto/{hpke-noble,sign}.ts`. The community-value
framing below was corrected before staging — see
`docs/plans/openvtc-integration-plan/2026-09-02-bam.md`'s closing
section for the evidence and the reasoning behind scoping this as the
first of two increments. Standalone proof this candidate is built from:
[`ports.mjs`](./ports.mjs) + [`hpke-ports.mjs`](./hpke-ports.mjs) +
[`run.mjs`](./run.mjs) in this rung (13 checks) plus
[`ref-10-credo-askar-adapter`](../ref-10-credo-askar-adapter/) (17
checks, a real Askar-backed adapter, not simulated) — the actual `.ts`
diff staged in the PR mirrors this file's code blocks below, verified
against the real package's own build + 51-test suite (all passing,
unchanged) before pushing.*

## Why this is a natural follow-up, not a cold-start proposal

`packages/tsp-js/src/crypto/hpke-noble.ts` **is**, in substance, the PR this
same effort already got merged (`albertoleon7794/vta-browser-plugin#1` → #116,
`vti-tsp-js` 0.2.0, per `scripts/openvtc/PINS.json`'s pin note) — the file
proposed below is not a foreign patch to someone else's code, it's a small
addition to a file this repo already has standing on. `hpke.ts` production
callers already run entirely on `@noble/{curves,hashes,ciphers}`; `hpke-js`
is a dev-dependency only, kept for the test suite's byte-identity check.

## The gap this closes

`vti-tsp-js`'s `pack`/`unpack` (`message/direct.ts`) and the crypto layer
underneath (`crypto/hpke-noble.ts`, `crypto/sign.ts`) all take a **raw
private key** directly — `PackKeys.senderSigningKey: Uint8Array`,
`authEncap(recipientPk, senderSk: Uint8Array, ...)`, `sign(data,
privateKey: Uint8Array)`. Any custody boundary that never exports a private
key — an HSM, a secure enclave, or (the concrete case motivating this)
Credo's Askar KMS, whose `Key.fromKeyExchange` exposes only the raw X25519
ECDH shared secret and whose `signMessage` exposes only the signature —
cannot call any of these functions today. `bindings/didcomm-v1/0.1`'s Credo
client (`ref-07-credo-adapter`, this plan's Phase D) needs exactly this.

## The change proposed (additive, no existing signature touched)

Two new exported types plus two new functions per file — everything
existing keeps its current signature and behavior unchanged, matching the
"no API change for existing consumers" principle `ref-03`'s own merged PR
already established for this file.

### `crypto/hpke-noble.ts`

```ts
/**
 * A capability that can compute the raw X25519 Diffie-Hellman shared secret
 * with a peer's public key, without ever exposing the private key itself —
 * e.g. Askar's `Key.fromKeyExchange`. `publicKey` is the identity's own
 * public key; `agree` returns the RAW ECDH output, no KDF applied.
 */
export interface KeyAgreement {
  publicKey: Uint8Array;
  agree(peerPublicKey: Uint8Array): Promise<Uint8Array>;
}

/**
 * `authEncap`, ported to a `KeyAgreement` capability instead of a raw
 * private key. The ephemeral half of the DH is still minted here directly
 * (never custody-sensitive — freshly generated per call, discarded after);
 * only the static-key half goes through `senderKeyAgreement.agree(...)`.
 * Identical output to `authEncap(recipientPk, senderSk, unsafe)` when
 * `senderKeyAgreement` wraps `senderSk` directly (see this rung's `run.mjs`
 * for the byte-identity proof).
 */
export async function authEncapWithKeyAgreement(
  recipientPk: Uint8Array,
  senderKeyAgreement: KeyAgreement,
  unsafe?: UnsafeFixedEphemeral,
): Promise<{ sharedSecret: Uint8Array; enc: Uint8Array }> {
  const skE = unsafe?.__unsafeFixedEphemeralSk ?? x25519.utils.randomSecretKey();
  const enc = x25519.getPublicKey(skE);
  const staticDh = await senderKeyAgreement.agree(recipientPk);
  const dhBytes = cat(dh(skE, recipientPk), staticDh);
  const kemContext = cat(enc, recipientPk, senderKeyAgreement.publicKey);
  return { sharedSecret: extractAndExpand(dhBytes, kemContext), enc };
}

/**
 * `authDecap`, ported to a `KeyAgreement` capability. Both DH terms are the
 * recipient's static key against a different peer public key each time, so
 * both go through the capability — there is no non-custodial half here.
 */
export async function authDecapWithKeyAgreement(
  enc: Uint8Array,
  recipientKeyAgreement: KeyAgreement,
  senderPk: Uint8Array,
): Promise<Uint8Array> {
  const dhWithEnc = await recipientKeyAgreement.agree(enc);
  const dhWithSender = await recipientKeyAgreement.agree(senderPk);
  const kemContext = cat(enc, recipientKeyAgreement.publicKey, senderPk);
  return extractAndExpand(cat(dhWithEnc, dhWithSender), kemContext);
}

/** `seal`, ported — same contract as `seal`, minus the raw sender key. */
export async function sealWithKeyAgreement(
  plaintext: Uint8Array,
  aad: Uint8Array,
  senderKeyAgreement: KeyAgreement,
  recipientPk: Uint8Array,
  info: Uint8Array,
  unsafe?: UnsafeFixedEphemeral,
): Promise<SealResult> {
  const { sharedSecret, enc } = await authEncapWithKeyAgreement(recipientPk, senderKeyAgreement, unsafe);
  const { key, baseNonce } = keySchedule(MODE_AUTH, sharedSecret, info);
  return { enc, ciphertext: chacha20poly1305(key, baseNonce, aad).encrypt(plaintext) };
}

/** `open`, ported. */
export async function openWithKeyAgreement(
  ciphertext: Uint8Array,
  aad: Uint8Array,
  enc: Uint8Array,
  recipientKeyAgreement: KeyAgreement,
  senderPk: Uint8Array,
  info: Uint8Array,
): Promise<Uint8Array> {
  const sharedSecret = await authDecapWithKeyAgreement(enc, recipientKeyAgreement, senderPk);
  const { key, baseNonce } = keySchedule(MODE_AUTH, sharedSecret, info);
  return chacha20poly1305(key, baseNonce, aad).decrypt(ciphertext);
}
```

`mode_base` (`encap`/`decap`/`sealBase`/`openBase`, for anonymous-sender VTA
sealed bundles) is untouched — `bindings/didcomm-v1/0.1` only ever needs
Auth mode, and this candidate doesn't propose changing a code path it hasn't
tested.

### `crypto/sign.ts`

```ts
/** A capability that can produce an Ed25519 signature without exposing the
 *  private key — e.g. Askar's `signMessage`. */
export interface SigningKey {
  publicKey: Uint8Array;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

/** `sign`, ported to a `SigningKey` capability — a direct passthrough, since
 *  there is no DH-style custody problem here: `signMessage` already returns
 *  just the signature, never the key. */
export async function signWithSigningKey(data: Uint8Array, signingKey: SigningKey): Promise<Uint8Array> {
  return signingKey.sign(data);
}
```

## Why this serves the community, not just our use case

- **Not hypothetical — the same wall exists, independently, in this
  ecosystem's own Rust reference implementation.**
  `verifiable-trust-infrastructure/vta-mobile-core/src/keys.rs` defines a
  `Signer` trait explicitly so a private key can live in the Secure
  Enclave (iOS) / StrongBox / Android Keystore and never cross the FFI
  boundary — used throughout consent, session, step-up, and push. But
  `vta-mobile-core/src/tsp.rs`'s `TspMediatorSession::connect` — the
  TSP-transport connect path, the direct analogue of what this PR
  addresses — still takes a raw Ed25519 seed
  (`holder_signing_private_ed25519: Vec<u8>`), because the layer
  underneath (`vta-sdk::session::TspSession::connect`, wrapping
  `affinidi_tdk::messaging`) has no `Signer`-shaped alternative either.
  Its own doc comment reads as an acknowledged compromise: "It stays in
  the engine; only derived TSP secrets reach the client." Two
  independent language ports of the TSP client (Rust and TS), same gap.
  (Checked, not assumed — no GitHub issue or PR anywhere in the
  `OpenVTC`/`trustoverip` orgs currently names this; the evidence is
  structural, in the pinned source itself.)
- **No behavioral fork, proven.** `ref-09-tsp-core-ports`'s `run.mjs`
  reproduces the official CFRG vector through the ported call sites, and
  proves the ported `seal`/`open` byte-identical to the existing
  `authEncap`/`authDecap`/`seal`/`open` for the same keys —
  `ref-10-credo-askar-adapter` repeats the same proof against a real
  Askar-backed identity, not a raw key. This is a pure refactor of the DH
  call sites, not a new implementation or protocol variant.
- **Additive only.** Every existing export keeps its exact current
  signature; the new functions are opt-in.

## How this was found (worth recording — a real process failure)

The investigation that produced this candidate initially read `hpke.ts` from
a **stale local clone** of `vta-browser-plugin` (checked out to `68b4d6c`,
2026-07-19 — not an ancestor of the pinned `89d70c4`, 2026-08-17) and
concluded production code still ran through `hpke-js`'s `CipherSuite`. That
was true of the commit read, not of what's actually pinned and shipped — at
`89d70c4`, `hpke.ts` is already a thin wrapper over `hpke-noble.ts`, and
`hpke-js` is dev-only. The underlying gap (raw-key-only interface blocks
Askar) held at the correct commit too, so the technical conclusion survived,
but the attribution didn't, and it should have been checked against the pin
before any conclusion was drawn. Full account:
`docs/plans/openvtc-integration-plan/2026-09-02-bam.md`'s correction section.
**Practical fix applied going forward**: check `git merge-base --is-ancestor
<pin> <local-HEAD>` (or just `git fetch` + `git show <pin>:<path>`) before
reading a pinned external clone as ground truth — a local clone updated on
its own schedule can silently drift behind (or diverge from) the pin
`scripts/openvtc/PINS.json` records.

## Not done

- **No official PR opened against `OpenVTC/vta-browser-plugin`.** Per this
  repo's own contribution workflow (`openvtc-integration-plan.md` §7's
  "Contribution review workflow"), staging happens on an internal fork
  first, reviewed before any official PR — done, as of 2026-09-02:
  [`Mickens-Lab/vta-browser-plugin#1`](https://github.com/Mickens-Lab/vta-browser-plugin/pull/1),
  draft, Alberto flagged. Opening an official PR upstream is a later,
  separate decision, not this session's to make unilaterally.
- `message/direct.ts`'s `pack`/`unpack` themselves are not ported in this
  candidate — only the crypto layer underneath. A `packWithKeys`/
  `unpackWithKeys` pair (or an overload) accepting `KeyAgreement`/
  `SigningKey` instead of `PackKeys`/`UnpackKeys` is the natural next
  increment, once this layer is reviewed — **deliberately not bundled into
  the staged PR**: it doesn't exist yet (no proof, no ref-NN rung), and
  the crypto-layer half is fully proven and reviewable on its own. See the
  2026-09-02 companion for the full reasoning behind the split.
- `mode_base` (VTA sealed bundles) is not ported — not needed for
  `bindings/didcomm-v1/0.1`, and this candidate stays to what's tested.
