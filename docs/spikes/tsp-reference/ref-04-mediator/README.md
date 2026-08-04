# ref-04-mediator — TSP through a real mediator

First rung of Phase C ([plan §6](../../tsp-openvtc-integration-plan.md)) and the
first with real infrastructure. Alice and Bob attach to a **mediator** — the
piece a phone genuinely cannot do without, since phones can't accept inbound
connections — and exchange TSP messages through it.

## What it proves

- **Both send styles, live.** *Routed* (what the Rust SDK and iOS agent do):
  seal end-to-end to Bob, then wrap a routing hop for the mediator; the
  mediator opens only its own layer, reads the next hop, and forwards the
  inner **byte-unchanged**. *Direct* (what the browser wallet does): no
  routing layer — the mediator routes on the cleartext envelope's receiver
  VID. Plus a reply, proving the leg is bidirectional.
- **One socket per DID.** TSP does not get its own connection: it rides the
  DIDComm message-pickup WebSocket. A second socket for the same DID is
  evicted upstream as `duplicate-channel`. This is the constraint our RN
  client inherits — transport is one connection; TSP and DIDComm are two
  *envelope formats* on it.
- **Demultiplexing by content.** DIDComm arrives as JSON text; TSP arrives
  base64url-encoded starting `-E` (CESR magic `0xF8`) and is handed to
  `onTspFrame` as raw bytes. Outbound TSP is a raw binary WS frame.
- **Correlation without a thread id.** TSP carries none at this layer; the
  delivered message's **thread digest** matches what the sender packed.
- **No DID publishing.** Both parties are `did:key`s that resolve *offline*
  to their signing and agreement keys (`identity.mjs`) — one Ed25519 seed
  yields the signing pair, the X25519 pair, and the identifier.

## Network note

By default this rung talks to the ecosystem's **public dev mediator**
(`webvh.storm.ws`, the same default the browser plugin and mobile core ship).
Payloads are end-to-end encrypted and the identities are throwaway `did:key`s
minted per run, so the mediator sees only routing metadata. Override with:

```sh
MEDIATOR_DID=did:...              # a different mediator
MEDIATOR_ALLOW_INSECURE=1         # permit http:// / ws:// (local mediators)
```

ref-05 points this at a local stack.

## Run

```sh
npm install
npm start          # verbose walk-through
npm run check      # quiet pass/fail
```

Requires network. Node 20 has **no global `WebSocket`**, so the rung injects
`ws@8` — a real consideration for any Node-side client (and a reminder that RN
supplies its own).

Pinned against: `@openvtc/vti-tsp-js` 0.1.0, `@openvtc/vti-didcomm-js` 0.6.2 —
see [../PINS.json](../PINS.json).
