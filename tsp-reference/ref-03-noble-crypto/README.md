# ref-03-noble-crypto — HPKE-Auth without WebCrypto (the upstream PR candidate)

Phase B ([plan §6](../../tsp-openvtc-integration-plan.md)). `vti-tsp-js`'s
crypto layer runs on hpke-js, which needs `crypto.subtle` for HKDF and X25519.
**React Native's Hermes engine has no WebCrypto**, so TSP cannot run on a
phone today. [`hpke-noble.mjs`](./hpke-noble.mjs) is RFC 9180 HPKE-Auth
(single-shot) implemented on `@noble/{curves,hashes,ciphers}` only — same
suite, same wire bytes, zero native code, runs anywhere JS runs.

## The proof (what `npm start` checks — 16 assertions)

1. **Official CFRG test vectors** — the vector for our exact suite
   (`mode_auth` / DHKEM-X25519-HKDF-SHA256 / HKDF-SHA256 / ChaCha20Poly1305)
   extracted from [cfrg/draft-irtf-cfrg-hpke](https://github.com/cfrg/draft-irtf-cfrg-hpke):
   `AuthEncap` reproduces the published `enc` and `shared_secret`, `AuthDecap`
   derives the same secret from the receiver's side, and a full seal
   reproduces the published ciphertext **byte for byte**. This validates the
   KEM, key schedule and AEAD against the standard, not against another
   implementation.
2. **Two-way interop with hpke-js** — noble opens what hpke-js sealed, and
   hpke-js opens what noble sealed.
3. **Wire-shape equality** — enc 32B, ciphertext = plaintext + 16B tag.
4. **Full stack** — ref-01's *frozen TSP wire fixtures* (real messages:
   direct, nested, routed legs) are opened by the noble HPKE using the
   library's own CESR framing and `-E` envelope as HPKE `info`. Real wires,
   new crypto.

## Run

```sh
npm install
npm start          # verbose, 16 checks
npm run check      # quiet pass/fail
npm run vectors    # re-extract CFRG vectors (only when refreshing)
```

`vectors/cfrg-auth-x25519-chacha.json` is committed so the rung runs offline.

## Upstream contribution

This is the substance of contribution #1 ([plan §7](../../tsp-openvtc-integration-plan.md)).
Staging follows the agreed workflow: a branch on a shared fork + PR
description reviewed internally (Alberto + colleague) before any official PR —
see [`PR-CANDIDATE.md`](./PR-CANDIDATE.md) for the proposed patch shape,
community rationale, and no-breakage argument. The ladder does not block on
that review: later rungs consume this module locally.

Pinned against: `@openvtc/vti-tsp-js` 0.1.0 — see [../PINS.json](../PINS.json).
