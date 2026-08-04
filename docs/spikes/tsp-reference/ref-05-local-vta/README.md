# ref-05-local-vta — our own VTA, and the capability ladder read from it

Second rung of Phase C ([plan §6](../../tsp-openvtc-integration-plan.md)). A
Verifiable Trust Agent running on this machine, serving **its own
`did:webvh`** — the trust anchor everything else in the stack resolves.

## What it proves

- **A one-command local VTA is possible.** The VTA hosts and serves its own
  DID document (serverless webvh), so a local stack needs **no separate
  DID-hosting service**. This is the fact that makes the whole thing
  tractable, and it isn't called out in the upstream setup guides.
- **The DID document is the capability advertisement.** Its `service` entries
  are exactly what a client reads to choose an envelope format:
  `TSPTransport` > `DIDCommMessaging` > `VTARest`. Our VTA advertises
  `TSPTransport` (endpoint = a **mediator DID**, not a URL — the same
  indirection ref-04 exercised) and `VTARest`.
- **Capability changes without key rotation.** Enabling TSP appends a new
  version to the hash-chained log with **byte-identical verification
  methods**. A client that re-resolved only on key rotation would never see a
  peer turn TSP on. Bounded-staleness (TTL) caching is the only correct
  policy — this rung is the live evidence behind that design rule.
- **Nothing is readable anonymously.** Even `/health/details` returns 401.

## Run it

Native (what this rung was developed against):

```sh
cd ../../../../external/verifiable-trust-infrastructure
cargo build -p vta-service --features tsp,setup -p pnm-cli      # needs Rust ≥ 1.95
./target/debug/vta setup --from ../../docs/spikes/tsp-reference/ref-05-local-vta/vta-setup.toml
./target/debug/vta --config /tmp/ref05-vta/config.toml &
# optional — advertise TSP (stop the daemon first; offline writes need the store lock)
./target/debug/vta --config /tmp/ref05-vta/config.toml services tsp enable --mediator-did <mediator-did>
```

Docker (the contribution — see below):

```sh
docker compose up --build
```

Then, from this directory:

```sh
npm start          # 12 checks
npm run check      # quiet pass/fail
VTA_URL=http://host:8100 npm start
```

## Notes on the recipe

`vta-setup.toml` chooses: **plaintext** seed backend (dev only — containers
have no OS keyring; the documented sealed/CI alternative is `config_seed`),
serverless `create_webvh` on `localhost:8100`, `messaging = skip` (no mediator
at boot), and `data_dir_exists = "delete"` + `overwrite_config` so it re-runs
cleanly. The container entrypoint uses `"reuse"` instead, so a mounted volume
survives restarts.

## Upstream contribution #2

`docker-compose.yml` + `Dockerfile` + `docker/entrypoint.sh` are the seed of
the compose stack and the `local-dev.md` the upstream repo is missing (its
`sysop/local-dev.md` is a two-line "to be documented" stub, and nothing in the
org ships a compose file). Staging follows the agreed workflow — fork branch,
community rationale, no-breakage evidence, internal review before any PR.

**Known gap: the mediator is not in the compose file yet.** The production
mediator cannot mint its own DID (a VTA mints it and hands it over as a sealed
bundle), so it is not a drop-in container. The tractable path is the
`affinidi-messaging-test-mediator` harness crate the VTI e2e tests use — it
binds an ephemeral port, mints its own `did:peer:2`, and needs no Valkey or
TLS. Until then ref-04 points at the public dev mediator.

Fixture: `fixtures/vta-did-log.jsonl` is the two-entry log from a VTA
provisioned by this recipe (before/after TSP enable), so the rung's assertions
about the ladder and the no-rotation property run even with no VTA up.

Built against VTI `02f10b3f` (`vta 0.14.3`) — see [../PINS.json](../PINS.json).
