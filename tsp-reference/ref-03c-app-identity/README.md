# ref-03c — the noble HPKE backend inside the real Keyring app

**Question this rung answers:** ref-03b proved byte-identity on the Hermes VM
binary with the RN Babel transform applied by hand — but does the noble HPKE
backend produce the same bytes inside the **actual Keyring app**, built by
Xcode, bundled by Metro, launched on an iOS simulator, with all of the app's
own polyfills loaded?

**Answer: yes.** All 9 checks pass in-app, and the transcript hash matches
ref-03b's Node and bare-Hermes runs exactly:

```
# transcript-sha256: c73ea5add50b0fc4d922e12db0de20021616e020b4f32761f66b1b598eec11e8
```

Four runtimes, one hash: Node 20, bare Hermes VM (ref-03b), the Keyring app on
the iOS simulator (this rung) — all matching the official CFRG RFC 9180 vector,
which the WebCrypto path and Rust `affinidi-tsp` also match (ref-03).

## The bonus finding: our own app is the partial-subtle case

The probe reports the runtime's WebCrypto surface. Inside Keyring:

```
# webcrypto surface: subtle=object digest=function importKey=undefined deriveBits=undefined
```

`app/index.js` polyfills `crypto.subtle` with **digest only** (js-sha256, for
JSON-LD signatures). So in our own wallet, `crypto.subtle` *exists* but cannot
run hpke-js — a live specimen of the "partial subtle" environment. PR #1's
detection survives this only because it probes `importKey` specifically; any
naive `if (crypto.subtle)` check would have selected the WebCrypto backend and
crashed at runtime. This is direct evidence for the meeting's decision
(Glenn/Brendan, 2026-08) to **drop environment detection entirely and use the
noble implementation everywhere**: environment sniffing is fragile precisely
because real apps manufacture partial crypto surfaces like this one.

## Method

1. `probe.mts` (shared with ref-03b, plus a reporting hook) is bundled with
   esbuild to one es2020 file and dropped into `app/` as
   `probe-hermes-identity.js`.
2. A temporary `require('./probe-hermes-identity')` is added at the end of
   `app/index.js` — after `react-native-get-random-values` and the app's
   `crypto.subtle.digest` polyfill, so the probe sees the production crypto
   surface. Metro applies its own RN Babel transform (no hand-lowering).
3. `yarn ios` builds and launches the app on an iOS simulator (iPhone 17 Pro,
   iOS 26.3, RN 0.81 debug, Hermes).
4. RN ≥0.79 no longer forwards `console.log` to the Metro terminal, so the
   probe POSTs its transcript to `http://localhost:8971/ref-03c` on the host
   (`listener.mjs`), which writes `out-app.txt`.
5. The injection is reverted; nothing probe-related ships in the app.

## Reproduce

```sh
node listener.mjs &                       # capture server → out-app.txt
# bundle the probe into the app (from external/vta-browser-plugin):
NODE_PATH="$PLUGIN/packages/tsp-js/node_modules:$PLUGIN/node_modules" \
  $PLUGIN/node_modules/.bin/esbuild probe.mts --bundle --format=iife \
  --target=es2020 --outfile=../../app/probe-hermes-identity.js
# add `require('./probe-hermes-identity')` at the end of app/index.js, then:
cd ../../app && yarn ios
# out-app.txt appears when the app boots; revert index.js and delete the probe file.
```

## Honest limits

- Simulator, not a physical device — but engine identity is a JS-engine
  property, and the simulator runs the same Hermes build Metro targets on
  device. (Hardware attestation is the only Keyring feature that genuinely
  needs physical devices; HPKE math is not device-dependent.)
- Deterministic keys only (see ref-03b): production randomness comes from
  `react-native-get-random-values`, which the app installs first thing.

## Files

- `probe.mts` — probe source (same checks as ref-03b + in-app POST reporting)
- `listener.mjs` — the capture server
- `out-app.txt` — the transcript as received from the app on the simulator
