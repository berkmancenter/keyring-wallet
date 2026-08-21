# ref-06p4 — a staged relay, for real

[`ref-06p2`](../ref-06p2-ble-observation/) measured the honest round trip
over real BLE. This rung stages the attack the timing bound
([`docs/plans/locality-plan.md`](../../docs/plans/locality-plan.md) §5.5)
exists to price: a relay, bridging the GATT exchange over a socket, with
injected latency swept from near-zero up through continental-hop
magnitudes. The question is not "can a relay work" — of course it can,
nothing in BLE prevents forwarding bytes — it's *at what added delay does a
bound set from the honest distribution actually start catching it, and what
does that bound cost the honest majority*.

**Two real runs recorded, 5 checks each.**

## The topology, and its one honest simplification

`device-leg.mjs` is the only process that touches BLE: it scans for the
exact target EID [`ref-06p2`](../ref-06p2-ble-observation/) uses (a phone
already configured for that rung's `--setup` needs no changes), connects,
and exposes a tiny newline-JSON socket server that performs the real
write-then-read round trip on request. `sensor-leg.mjs` is the relay's other
end — what a real sensor's central connection would experience if routed
through a relay instead of straight to the device — and it's the one that
injects the delay, split evenly across the outbound and inbound hops around
the real round trip.

**Only one leg is a real radio.** A genuine two-hop relay needs a third
radio (an attacker's device near the phone, a second near the sensor); this
box + one phone is two radios, already spoken for as sensor↔device directly.
The injected delay stands in for the missing physical hop — honestly, not
silently. What this setup proves is the empirical question §5.5 asks
(*how much added latency is detectable, and at what cost to honest devices*)
using a real round trip as the base measurement; what it does not prove is
that carrying that latency over an actual second BLE link introduces no
*other* artifact (packet loss, jitter shape) a genuinely staged two-radio
relay might show. See "What it does NOT prove" below.

## What it proves — measured, not asserted

Two real runs, each: a 20-trial honest baseline through this rung's own
apparatus, a sweep across `[5, 10, 20, 50, 100, 150, 200, 300, 500, 1000]`ms
of injected delay (8 trials each), and a second independent honest sample
to check the bound against.

- **The relay succeeds, unconditionally.** Every swept delay — including
  1000ms — completed with a correct echo. Nothing about BLE, GATT, or the
  connection itself rejects a relayed round trip. Only an explicit timing
  check, layered on top, can.
- **§5.5's claim, measured:** a candidate bound set at the honest sample's
  p95 (**224.7ms**, both runs) is **not** reliably exceeded by 5–20ms of
  injected delay — median total round trip at 20ms injected delay was
  180.1ms, barely distinguishable from the 179.9ms honest baseline. This is
  the plan's own claim (*"sub-10ms local relays are achievable, and no
  bound compatible with real BLE connection intervals... will separate
  them from an honest device"*) checked against a real measurement, not
  restated from the design doc.
- **Where it starts to bite:** the swept delay was first *fully* caught
  (even its fastest trial exceeded the bound) at **100ms** injected delay —
  well past a same-room relay, in the range a real cross-building or
  longer-haul relay would add.
- **The false-rejection rate is stated, not skipped.** A bound set from one
  honest sample's p95 is, by construction, close to a 1-in-20 miss rate on
  *that* sample. The rung checks it against a **second, independent** honest
  sample rather than re-testing the same numbers against themselves (which
  would trivially read "correct"): the second sample's own p95 landed at
  224.9ms — 0.2ms over the first sample's 224.7ms bound. That the two
  independent measurements landed within a quarter of a millisecond of each
  other is itself informative: this bound is measuring a real, stable
  percentile of the physical round trip, not sampling noise.
- **Both runs agree.** Baseline median/p95 were 179.9/224.7ms and
  179.9/224.9ms across the two recorded runs — the same distribution
  `ref-06p2` measured independently (median ≈180ms, p95 ≈224ms), which is
  exactly what should happen when both rungs measure the same physical
  round trip through different code paths.

## What it does NOT prove

- **Not a genuine two-radio relay.** As above — only one leg is real BLE.
  A relay staged with an actual second radio (a second phone, say) could
  show different behavior at very short injected delays if the physical
  relay hardware itself adds jitter this socket-hop simulation can't. If a
  future rung stages that for real, treat this one's numbers as the
  software-only lower bound on what's detectable, not the final word.
- **No adversarial optimization.** This is a straightforward socket relay
  with a fixed delay; it doesn't try to hide, jitter its timing to blend
  with the honest distribution, or otherwise adapt. A real attacker's relay
  might do better than "add exactly the network's latency and nothing
  else" — this rung doesn't model that.
- **The bound itself is not a recommendation.** 224.7ms is what THIS
  adapter/phone pairing measured, not a value to ship. Plan §5.5 says the
  bound must come from p95-honest and relay-detection together, on the
  hardware production actually uses — this rung is the *method*, run once,
  not the final calibration.
- **No collusion scenario.** Nothing here bears on two parties agreeing in
  advance to fake a meeting (plan §9.2) — a relay needs an accomplice
  physically present regardless of latency, and that residual stays open
  regardless of where the bound is set.

## Fixtures

- `fixtures/relay-sweep.jsonl` — one JSON record per run, appended: the
  bound, both honest samples, the full delay sweep, and the first delay
  fully caught. Not a frozen fixture (real radios don't reproduce a
  byte-identical number run to run) — a measured, dated log, the same
  convention `ref-06p2` uses.
