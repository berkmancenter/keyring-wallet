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
| 3. …with Cypress VTA/VTI (affinidi mediator, webvh hosting) | ✅ **closed by measurement** — the literal form (v1 through the affinidi mediator) is impossible **by design**, permanently (v2-only, measured 404); the step's intent splits: webvh + VTA REST serve a v1 wallet directly ([`ref-06x`](./ref-06x-cypress-stack/)), and the mediator leg is the dual-stack's v2 half ([`ref-04`](./ref-04-mediator/), `vti-didcomm-js`) — never DIDComm 1 | [`ref-06x`](./ref-06x-cypress-stack/), [`ref-04`](./ref-04-mediator/), [`ref-05`](./ref-05-local-vta/) |
| 4. Fallback to pinned version if needed | ✅ standing | [`scripts/openvtc/PINS.json`](../scripts/openvtc/PINS.json) + `sync-external.mjs` — pins are the fallback; advances are logged decisions ([`SYNC_LOG.md`](../scripts/openvtc/SYNC_LOG.md)) |

The **locality line** (`ref-06p*`) sits on top of the witnessed exchange and
belongs to [`docs/plans/locality-plan.md`](../docs/plans/locality-plan.md):
[`ref-06p`](./ref-06p-locality-binding/) is the binding algebra (no radios,
green); [`ref-06p2`](./ref-06p2-ble-observation/) is the same binding over a
real BLE radio pair (discrimination against real ambient noise, honest RTT
measured — median ≈180ms, p95 ≈224ms over 35 trials against a real phone);
[`ref-06p3`](./ref-06p3-third-party-verify/) is the §7.3 third-party
verifier (seven mechanical steps, each independently forgeable and caught);
[`ref-06p4`](./ref-06p4-relay-trial/) is a staged relay measuring where
§5.5's timing bound starts rejecting it (100ms, against a 224.7ms bound —
5–20ms stays indistinguishable from honest, matching the plan's own claim);
[`ref-06p5`](./ref-06p5-attestation-binding/) verifies a real App-Attest
attestation object against Apple's real public root, offline — Play
Integrity is shape-only, since its tokens have no offline-verifiable form
at all, with a separate live script parked for when real access exists.
**The locality reference ladder (`ref-06p` through `ref-06p5`) is
complete.**

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
| [`ref-06p-locality-binding`](./ref-06p-locality-binding/) | the locality evidence algebra with no radios: the EID that **locates** vs the signed GATT transcript that **binds**, four forgeries each rejected by a named check, `ext` on all four witness documents through the published §7.2 pipeline, and the canonicalization split — Trust Task documents are `eddsa-jcs-2022` (every member covered) while the VWC is `eddsa-rdfc-2022` (**only defined JSON-LD terms are signed**; today's shipped `LocalityEvidence` members have none). 1,927 bytes/session, measured | nothing |
| [`ref-06p2-ble-observation`](./ref-06p2-ble-observation/) | the same EID/transcript scheme over a **real BLE radio pair**: discrimination against real ambient noise (8–11 genuine BLE devices per scan, correctly ignored), a full connect→discover→write→read round trip against a real phone's GATT server, and the honest RTT distribution measured (not asserted) — median ≈180ms, p95 ≈224ms over 35 trials. Runs over BlueZ's D-Bus interface (`node-ble`), not a raw HCI socket — a raw-socket attempt (`@abandonware/noble`) silently saw nothing, contending with `bluetoothd` for scan state | two BLE radios |
| [`ref-06p3-third-party-verify`](./ref-06p3-third-party-verify/) | the §7.3 verification algorithm run cold, as a third party would: given only the VWC + retained session doc + retained submit#response (+ the raw transcript, opened only if the tier-3 check is requested), seven mechanical steps each independently forgeable and each caught at the step that should catch it — plus the two-mode step 6 (trust the credential's predicate vs. open the artifact and check the key directly), and a verdict that always names a step/reason/residual set, never a bare boolean | nothing |
| [`ref-06p4-relay-trial`](./ref-06p4-relay-trial/) | a relay staged for real — one process doing the genuine BLE round trip against a phone, a second bridging it over a socket with injected latency, swept from 5ms to 1000ms — measuring where a bound set at the honest p95 (224.7ms) starts rejecting it (100ms) and confirming the plan's own claim that a 5–20ms local-relay-scale delay stays indistinguishable from honest. The false-rejection rate is checked against a second, independent honest sample rather than the one the bound was set from | two BLE radios (one leg — see README) |
| [`ref-06p5-attestation-binding`](./ref-06p5-attestation-binding/) | a real, Apple-signed App Attest object (vendored, MIT) verified offline against Apple's real public root; four independent forgeries each caught by a different check; the locality transcript's binding shown to wire correctly into App Attest's `challenge` parameter (mutating any bound field changes the resulting hash); the `absent`/`present-unverified`/`verified` states never inferred. Play Integrity is shape-only — its tokens have no offline-verifiable form at all — with a separate live script parked for real Play Console/Google Cloud access | platform test credentials (App Attest: real, vendored; Play Integrity: none possible offline) |
| [`ref-06x-cypress-stack`](./ref-06x-cypress-stack/) | the stack composed joint-by-joint at the **Cypress release**: local release-binary VTA + webvh at the wallet (Credo can't resolve it natively — measured; 20-line workaround proven) + the mediator dialect (v1 refused, 404 — measured) + the witnessed exchange end-to-end on binding 0.2 × trust-tasks 0.9.0 | a local VTA; network for the mediator act |
| [`ref-07-dtg-edge-semantics`](./ref-07-dtg-edge-semantics/) | the DTG cred-spec edge-verifiability semantics tested from Keyring-shaped fixtures: the #21 glossary-vs-body contradiction reproduced (opposite answers on the same edge; the spec's own example fails its own glossary; condition (b) unsatisfiable as written), the #22 declared-scope model yielding one deterministic rule set (uniqueness becomes a check, not prose), and the #23 asymmetric edge unnameable under four types but computable under scope (effective disclosure = max of halves). Fixtures are real: one edge captured from the actual Credo exchange (verified by Keyring's verifier at capture), the rest signed eddsa-jcs-2022 and verified in-run | nothing |

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
