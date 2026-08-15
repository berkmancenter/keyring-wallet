# ref-03b — Hermes engine identity for the noble HPKE backend

**Question this rung answers:** does the pure-JS noble HPKE backend
(vta-browser-plugin PR #1, `packages/tsp-js/src/crypto/hpke-noble.ts`) produce
**byte-identical cryptography on React Native's engine (Hermes) and on Node** —
measured, not inferred from "it's pure JS"?

**Answer: yes.** The identical bundled file, run under Node 20 and under the
Hermes VM binary shipped in the app's own iOS Pods
(`app/ios/Pods/hermes-engine/destroot/bin/hermes`), passes all 9 checks on both
engines and produces the same transcript hash:

```
# transcript-sha256: c73ea5add50b0fc4d922e12db0de20021616e020b4f32761f66b1b598eec11e8   (node)
# transcript-sha256: c73ea5add50b0fc4d922e12db0de20021616e020b4f32761f66b1b598eec11e8   (hermes)
```

`diff out-node.txt out-hermes.txt` differs only in the engine banner and the
runtime's reported WebCrypto surface — every cryptographic byte is identical.

## What the probe checks

Two parts, both deterministic (no randomness — see "fixed keys" below):

1. **The official CFRG RFC 9180 test vector** for the exact TSP suite
   (mode_auth 0x02, DHKEM(X25519,HKDF-SHA256) 0x0020, HKDF-SHA256 0x0001,
   ChaCha20-Poly1305 0x0003), from
   `tsp-reference/ref-03-noble-crypto/vectors/cfrg-auth-x25519-chacha.json`:
   AuthEncap `enc` + `shared_secret`, AuthDecap, seal reproducing the vector's
   seq-0 ciphertext, open recovering its plaintext. Because the vector fixes
   every key including the ephemeral one, the *correct* bytes are known in
   advance — matching them proves correctness, not just self-consistency.
2. **A TSP-shaped seal/open** with fixed keys and a fixed ephemeral: no
   published expected value — the point is that both engines emit the same
   `enc`/ciphertext bytes and round-trip each other's output.

The probe also reports the runtime's WebCrypto surface. Bare Hermes:
`subtle=undefined` — there is nothing to detect, `hpke-js` cannot run at all.

## Why this transitively covers everything

Both engines match the **official CFRG vector** — the same vector the
hpke-js/WebCrypto path and Rust `affinidi-tsp` are held to (ref-03). So:

```
Hermes-noble = Node-noble = Node-webcrypto (ref-03 / PR tests) = Rust (interop vector)
```

## Reproduce

```sh
./run.sh
```

The pipeline mirrors production React Native exactly: esbuild bundles the PR
branch's TypeScript (`external/vta-browser-plugin` @ `feat/pure-js-crypto-backend`)
to one es2020 file, then **React Native's own Babel preset**
(`@react-native/babel-preset`, from `app/node_modules`) lowers it for Hermes —
the same transform Metro applies when building the app. Hermes has no native
class syntax and esbuild alone cannot lower classes without breaking noble's
BigInt (its es5 target rejects BigInt literals); Babel-with-RN-preset is the
production answer to exactly this, which is itself a finding worth keeping.

## Performance (bench.mts, same pipeline, 2026-08-15)

| Engine | seal | open | Notes |
|---|---|---|---|
| Node 20 | ~450 ops/s (2.2 ms/op) | ~590 ops/s (1.7 ms/op) | payload-size-independent 64B→16KB |
| Hermes VM | ~30 ops/s (33 ms/op) | ~39 ops/s (26 ms/op) | ~15× slower — Hermes has no JIT; cost is the X25519 BigInt math (KEM), not the AEAD |

Reading: cost is per-*message*, not per-byte (KEM-dominated, as RFC 9180
predicts). 33 ms of CPU per sealed message on-device is imperceptible for
human-speed wallet messaging; the throughput ceiling (~30 msg/s on Hermes)
only matters for bulk/relay workloads, which run on Node where the number is
~450/s. This closes Glenn's "watch TS perf" caution with data: fine for the
wallet and the plugin, benchmark again before putting noble on a hot relay
path.

## Honest limits

- This is the Hermes VM binary + the RN Babel transform — the app's engine and
  syntax pipeline, but not a full Metro build on a device. **ref-03c** closes
  that gap by running the same probe inside the real Keyring app on a simulator.
- No randomness is exercised (vectors fix the ephemeral key). Production RN
  still needs `getRandomValues` — Keyring's `app/index.js` already installs
  `react-native-get-random-values` before anything else.

## Files

- `probe.mts` — the probe source (imports the PR branch's `hpke-noble.ts` directly)
- `run.sh` — bundle (esbuild) → lower (RN Babel preset) → run (node + hermes) → diff
- `out-node.txt`, `out-hermes.txt` — captured transcripts, all 9 checks PASS
