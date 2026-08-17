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

## The build-up phasing, mapped (for reviewers)

The agreed build-up/testing strategy (Brendan's phasing doc) and where each
step lives — every step is one `node run.mjs` away:

| Phasing step | Status | Rung(s) |
|---|---|---|
| 1. Alice+Bob, DIDComm 1 (Credo-ts) | ✅ | [`ref-06v1`](./ref-06v1-didcomm-v1-binding/) — plus [`ref-06v1c`](./ref-06v1c-task-layer/) (task layer over it), [`ref-06v1d`](./ref-06v1d-carrier/) (carrier decision), [`ref-06v1e`](./ref-06v1e-type-shape/) (binding-0.2 @type) |
| 2. …with credo mediator | ✅ | [`ref-06v1b`](./ref-06v1b-mediated/) (production Keyring mediator) |
| 3. …with Cypress VTA/VTI (affinidi mediator, webvh hosting) | ✅ composed, with measured gaps | [`ref-06x`](./ref-06x-cypress-stack/) — components separately: [`ref-04`](./ref-04-mediator/) (mediator), [`ref-05`](./ref-05-local-vta/) (VTA + webvh) |
| 4. Fallback to pinned version if needed | ✅ standing | [`scripts/openvtc/PINS.json`](../scripts/openvtc/PINS.json) + `sync-external.mjs` — pins are the fallback; advances are logged decisions ([`SYNC_LOG.md`](../scripts/openvtc/SYNC_LOG.md)) |

The witnessed-exchange evidence line (`ref-06w*`) sits on top of step 1:
[`ref-06w4`](./ref-06w4-package-truth/) is the living exchange on the published
`@openvtc/trust-tasks` package; [`ref-06w3`](./ref-06w3-taskcontext-binding/)
is the forge trial behind the §4.9.3 task digest; [`ref-06w`](./ref-06w-witnessed-exchange/)
and [`ref-06v1d`](./ref-06v1d-carrier/) are kept as historical records of
proposals since adopted upstream.

## The rungs

| Rung | Proves | Needs |
|---|---|---|
| [`ref-00-hello-direct`](./ref-00-hello-direct/) | pack/unpack, the wire anatomy, and three failure modes (tamper → outer signature; wrong recipient → HPKE; **wrong claimed sender** → HPKE-Auth) | nothing |
| [`ref-01-modes`](./ref-01-modes/) | nested + routed ("the onion") through two in-process relays; the **pairwise-VID leak** a long-term VID would cause; first frozen fixtures | nothing |
| [`ref-02-two-processes`](./ref-02-two-processes/) | transport-agnosticism: three OS processes, an HTTP relay containing zero TSP code | nothing |
| [`ref-03-noble-crypto`](./ref-03-noble-crypto/) | HPKE-Auth with **no WebCrypto** (React Native's engine has none): official CFRG vectors reproduced byte-exact, two-way interop with hpke-js. Also the staged upstream contribution — see its `PR-CANDIDATE.md` | nothing |
| [`ref-04-mediator`](./ref-04-mediator/) | TSP through a real mediator: one socket per DID, TSP demuxed off the DIDComm pickup stream, routed **and** direct sends, bidirectional | network (a mediator) |
| [`ref-05-local-vta`](./ref-05-local-vta/) | a local VTA serving **its own** `did:webvh`; service entries as the transport ladder; **capability change without key rotation** | a local VTA (native or its `docker compose`) |
| `ref-06v1…w4` (nine rungs) | the DIDComm-v1 binding, task layer, carrier, witnessed exchange, taskContext binding, package truth — see the phasing map above | varies (see each README) |
| [`ref-06x-cypress-stack`](./ref-06x-cypress-stack/) | the stack composed joint-by-joint at the **Cypress release**: local release-binary VTA + webvh at the wallet (Credo can't resolve it natively — measured; 20-line workaround proven) + the mediator dialect (v1 refused, 404 — measured) + the witnessed exchange end-to-end on binding 0.2 × trust-tasks 0.9.0 | a local VTA; network for the mediator act |

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
