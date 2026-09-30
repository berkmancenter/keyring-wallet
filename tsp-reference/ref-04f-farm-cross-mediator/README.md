# ref-04f-farm-cross-mediator — a community on another operator's mediator

The lab puts every party on one mediator, so a reply never crosses operators.
The Farm does not: a Farm client's inbox is on `mediator.ic3.dev`, while the
ecosystem's first community (`first-vtc`) names the storm mediator
(`mediator.vtc.storm.ws`) in its `DIDCommMessaging` and `TSPTransport`
services. This rung asks `first-vtc` the first question a phone would — the
read-only `vtc/join-requests/manifest/0.2` — from a fresh client on the Farm
mediator, and records whether it arrives, whether the answer comes back
storm → Farm, how long it takes, and whether it is delivered live.

```sh
npm install && SENDERS=peer node run.mjs     # public endpoints only
```

| Variable | Meaning |
| --- | --- |
| `SENDERS` | `key` (bare `did:key`), `peer` (`did:peer:2` naming the Farm mediator), or both |
| `ROUTES` | DIDComm routes, default `A,B,C`: **A** forward via the Farm, `next` = first-vtc; **B** authcrypt forward POSTed to storm's `/inbound`; **C** forward via the Farm, `next` = storm, wrapping a forward to first-vtc |
| `ONLY` | `didcomm` or `tsp` |
| `TSP_ATTEMPTS` | `0` direct frame to the Farm, `1` routed via Farm → storm, `2` direct frame POSTed to storm |
| `WAIT_MS` | per-leg reply window (default 30000) |

Read-only: nothing is submitted or administered, the identity is minted fresh
per run, and an XRFD ends any relationship an XRFI forms. Each leg opens its
own socket — the mediator allows one per DID, and a second terminates the
first (`w.websocket.duplicate-channel`).

Measured 2026-09-22 (Farm mediator 0.28.23, storm 0.28.26, `first-vtc` log v4):

```
DIDComm A via Farm, next = first-vtc, sender did:peer:2: answered in 1097 ms (live) — manifest: 1 criteria
DIDComm B direct to storm, sender did:peer:2:          answered in 809 ms (live)
DIDComm C via Farm, double forward, sender did:peer:2: answered in 363 ms (live)
DIDComm, sender did:key (any route):                   no answer — a did:key has no service to reply to
TSP XRFI routed via Farm → storm:                      no answer within 90 s
TSP XRFI POSTed to storm:                              Stored for first-vtc, no XRFA within 90 s
```

Recorded in `docs/VTI_UPSTREAM_FINDINGS.md` under *Farm cross-mediator round
trip* and VTI-Q15.
