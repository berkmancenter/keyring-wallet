# ref-03d — BLS12-381 on Hermes, measured

**Question this rung answers:** does BLS12-381 — the curve under `bbs-2023`
selective disclosure and the proof-of-personhood constructions (ePrint
2026/333) — run on React Native's engine, and at what cost? This is
dtgwg-cred-tf discussion #39 question 9 ("has anyone run BLS12-381 on a mobile
JS runtime without WebCrypto?"), answered the same way ref-03b answered it for
HPKE: measured on the app's own Hermes binary, not inferred.

**Answer: yes.** `@noble/curves` 2.3.0's `bls12_381` (pure JS, BigInt-based,
no WebCrypto dependency) produces **byte-identical output** on Node 20 and on
the Hermes VM shipped in the app's iOS Pods
(`app/ios/Pods/hermes-engine/destroot/bin/hermes`, "hermes for RN 0.81.5"):

```
# transcript-sha256: 24a48d800e482bf49a37e78cf3d395629d6041c0031bc8b6dc32000f72d40cce   (node)
# transcript-sha256: 24a48d800e482bf49a37e78cf3d395629d6041c0031bc8b6dc32000f72d40cce   (hermes)
```

`diff out-node.txt out-hermes.txt` differs only in the engine banner, the
reported WebCrypto surface (`subtle=undefined` on bare Hermes, as ref-03b
established), and the timing lines.

## What the probe checks

Deterministic (fixed secret keys, no randomness source needed):

1. **Short-signature scheme** (pk ∈ G2, sig ∈ G1 — the shape BBS uses):
   `getPublicKey`, hash-to-curve into G1 (RFC 9380 SSWU, the standard BLS sig
   DST), deterministic sign, verify true, verify-under-wrong-key false.
2. **Pairing bilinearity**: e(aP, Q) = e(P, aQ) in Fp12 — exercises the Miller
   loop + final exponentiation independently of the signature layer.
3. A SHA-256 transcript over every printed crypto byte, compared across engines.

## Timings (single core, laptop-hosted Hermes VM)

| op | Node 20 | Hermes (RN 0.81.5) | ratio |
|---|---|---|---|
| G1 scalar mul | 0.3 ms | 4.6 ms | ~15× |
| G2 scalar mul | 0.5 ms | 8.0 ms | ~16× |
| hash-to-G1 | 1.5 ms | 22.6 ms | ~15× |
| BLS sign | 2.0 ms | 36.4 ms | ~18× |
| pairing | 6.2 ms | 96.7 ms | ~16× |
| BLS verify (2 pairings) | 8.8 ms | 146.0 ms | ~17× |

The ~15× Hermes/Node ratio matches the X25519 finding from ref-03/ref-03b
(33 ms/seal on Hermes ≈ 30× Node) — Hermes BigInt limb math is the whole cost.
On-device hardware is slower than this laptop VM, but even ×3–5 headroom keeps
a **BBS derived-proof presentation in the low seconds** and a plain BLS/BBS
verify **well under a second** — interactive-tolerable, and far from the
"can't run" outcome the `crypto.subtle` gap caused for hpke-js.

## What this does NOT prove

- Not a BBS(+) implementation — `bbs-2023` needs multi-message commitments and
  proof derivation on top of these primitives (e.g. `@digitalbazaar/bbs-signatures`
  pure-JS path, or the TDK's `affinidi-bbs`). This rung proves the **curve
  layer** those libraries stand on runs correctly and affordably on Hermes.
- Not an on-device measurement — same caveat and same follow-up shape as
  ref-03c (run inside the app on a phone) if exact device numbers matter.

## Run it

```sh
tsp-reference/ref-03d-bls12-381-hermes/run.sh
```

Requires `external/vta-browser-plugin` node_modules (noble 2.x + esbuild), app
node_modules (RN Babel preset), and app pods (the Hermes binary) — the same
prerequisites as ref-03b.
