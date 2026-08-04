# TSP reference ladder

Small runnable programs, each proving one layer of the OpenVTC/TSP stack. They
are the executable evidence behind
[`docs/plans/openvtc-integration-plan.md`](../docs/plans/openvtc-integration-plan.md):
where the plan makes a claim about how the protocol behaves, there is usually a
rung here you can run to check it.

Three jobs at once: a worked reference for how our stack talks TSP, a
regression net against upstream churn (frozen fixtures — known keys in,
expected bytes out), and the source material for the eventual production
module.

**Status: early, and deliberately so.** Phases A and B are complete; Phase C is
in progress. The corpus graduates to `bifold/packages/tsp-reference` once it
stabilises into a CI conformance suite.

## The rungs

| Rung | Proves | Needs |
|---|---|---|
| [`ref-00-hello-direct`](./ref-00-hello-direct/) | pack/unpack, the wire anatomy, and three failure modes (tamper → outer signature; wrong recipient → HPKE; **wrong claimed sender** → HPKE-Auth) | nothing |
| [`ref-01-modes`](./ref-01-modes/) | nested + routed ("the onion") through two in-process relays; the **pairwise-VID leak** a long-term VID would cause; first frozen fixtures | nothing |
| [`ref-02-two-processes`](./ref-02-two-processes/) | transport-agnosticism: three OS processes, an HTTP relay containing zero TSP code | nothing |
| [`ref-03-noble-crypto`](./ref-03-noble-crypto/) | HPKE-Auth with **no WebCrypto** (React Native's engine has none): official CFRG vectors reproduced byte-exact, two-way interop with hpke-js. Also the staged upstream contribution — see its `PR-CANDIDATE.md` | nothing |
| [`ref-04-mediator`](./ref-04-mediator/) | TSP through a real mediator: one socket per DID, TSP demuxed off the DIDComm pickup stream, routed **and** direct sends, bidirectional | network (a mediator) |
| [`ref-05-local-vta`](./ref-05-local-vta/) | a local VTA serving **its own** `did:webvh`; service entries as the transport ladder; **capability change without key rotation** | a local VTA (native or its `docker compose`) |

## Running them

```sh
cd ref-00-hello-direct && npm install && npm start   # verbose walk-through
npm run check                                        # quiet pass/fail
```

Bottom-up, which is what you want after advancing a pin — the first red rung
names the layer that changed:

```sh
for d in ref-*/; do (cd "$d" && npm run -s check); done
```

Set up the upstream clones first: see
[`scripts/openvtc/README.md`](../scripts/openvtc/README.md).

## What is *not* proven yet

Worth stating plainly, since the point of the corpus is honest evidence:

- **A local VTA actually speaking TSP end to end.** ref-04 used a public
  mediator; ref-05's VTA runs with no mediator attached, so it is REST-only.
  Closing that seam needs a local mediator — the tractable path is the
  `affinidi-messaging-test-mediator` harness the VTI's own e2e tests use.
- **Trust Tasks** over any transport (next rung; needs `eddsa-jcs-2022`
  signing for the authentication document).
- **Credo integration** — nothing here touches Credo yet.
- ref-05's `docker-compose.yml` brings up the VTA only, and its recipe uses a
  plaintext seed backend: fine for disposable local testing, never for
  anything real.
