# ref-01-modes — nested + routed, the onion hop by hop

Second rung ([plan §6](../../tsp-openvtc-integration-plan.md)). Builds on
ref-00's direct mode with the two composition modes, walked in one process:

- **Nested**: a complete sealed message carried opaquely inside another one;
  the inner uses **pairwise VIDs** so its (cleartext!) envelope labels are
  unlinkable to the parties' long-term identities.
- **Routed**: Alice seals the core to Bob first, then wraps it for Relay1
  with the itinerary riding *inside* the sealed layer. Each relay does an
  **ordinary unpack** with its own keys, learns only the next hop
  (`nextHop()`), re-wraps under its own identity, forwards. There is no
  special onion machinery — routing *is* pack/unpack called repeatedly.
- **The who-saw-what scorecard**: no observer or relay ever sees Alice and
  Bob in the same place — and the deliberately-demonstrated **leak** (a core
  packed under long-term VIDs exposes both endpoints in cleartext to any
  relay holding it) shows exactly why the pairwise-VID rule exists.
- This mirrors production shape: wallet → mediator → VTA is `pack` (direct,
  E2E) + `packRouted` to the mediator with `route = [vtaVid]` — straight from
  the library's own doc comment.

**Fixtures** (`fixtures/fixtures.json`): first run freezes keys + wire bytes;
every later run re-unpacks the frozen wires and asserts sender/receiver/
type/hops/payload. Unpack is deterministic, so an upstream byte-format change
turns this rung red — the corpus's first regression net.

Run:

```sh
npm install
npm start          # walk-through; writes fixtures on first run
npm start          # second run verifies against frozen bytes
npm run check      # quiet pass/fail
```

Pinned against: `@openvtc/vti-tsp-js` 0.1.0 — see [../PINS.json](../PINS.json).
