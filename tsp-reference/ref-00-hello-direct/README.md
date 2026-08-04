# ref-00-hello-direct — the simplest possible TSP exchange

First rung of the TSP reference ladder ([plan §6](../../tsp-openvtc-integration-plan.md)).
One Node process, zero infrastructure: Alice mints her keys, Bob mints his,
Alice `pack()`s "hello bob", Bob `unpack()`s it — then three failure modes
prove the security properties (tamper → outer signature; wrong receiver key →
HPKE; wrong *claimed sender* → HPKE-**Auth**, the second authentication).

What it teaches:

- The **5 keys**: each party's Ed25519 (sign) + X25519 (encrypt) pairs, plus
  the per-message ephemeral key you can see sitting in the wire bytes.
- The **wire layout**: cleartext `-E` envelope (address label), ciphertext ‖
  tag ‖ ephemeral pub, Ed25519 signature over everything — verifiable by a
  relay *without* decrypting.
- **Double authentication**: the outer seal (anyone can check) and HPKE-Auth
  (successful decryption itself proves the sender) — demonstrated separately
  by failure modes 1 and 3.
- VIDs are **opaque labels** at this layer — `vti-tsp-js` is wire-only; key
  resolution (Level 1/3 of the TSP layer map) is the caller's job. Here the
  script is the phonebook; later rungs replace it with DID resolution.

Run:

```sh
npm install
npm start          # verbose walk-through with hex dumps
npm run check      # quiet pass/fail (what the ladder re-run uses)
```

Pinned against: `@openvtc/vti-tsp-js` 0.1.0 (npm) — see [../PINS.json](../PINS.json).
