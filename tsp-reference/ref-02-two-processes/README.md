# ref-02-two-processes — the pipe is dumb, the envelope is everything

Third rung, closing Phase A ([plan §6](../../tsp-openvtc-integration-plan.md)).
Alice and Bob become **separate OS processes**; between them sits a relay
process containing **zero TSP code** — an HTTP mailbox that stores and
forwards blobs it cannot read (`relay.mjs` imports nothing from vti-tsp-js).

What it teaches:

- **Transport-agnosticism, made physical.** ref-01's in-process function
  calls became HTTP requests and *nothing about the crypto changed* — same
  pack/unpack, same keys, same bytes. Any pipe works: HTTP here, WebSocket
  at the mediator (ref-04), a QR code, a carrier pigeon.
- **The out-of-band step is real.** The orchestrator hands each process its
  own private keys and the peer's *public* keys via env — that's the
  QR/invitation moment TSP itself cannot bootstrap (Level 1 of the layer
  map). Neither party could talk without it.
- **The relay's honest confession**: it logs every blob as "contents: no
  idea, it's sealed". It could decode the cleartext envelope labels if it
  wanted (ref-01 proved that) — but it needs none of it to do its job.

Run:

```sh
npm install
npm start          # watch three processes talk
npm run check      # quiet pass/fail
```

Pinned against: `@openvtc/vti-tsp-js` 0.1.0 — see [../PINS.json](../PINS.json).
