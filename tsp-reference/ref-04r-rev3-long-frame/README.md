# ref-04r-rev3-long-frame — a Rev 3 message past the short-form limit, through a real mediator

Closes the one R7 item of [`tsp_rev3_subtask.md`](../../docs/plans/keyring-on-the-vta-farm/tsp_rev3_subtask.md)
that the two-device ceremony cannot reach: *"a message above 12,285 bytes
survives the mediator"* (§3.3).

```sh
npm install
node run.mjs            # against the lab mediator in ~/vti-stack/stack.env
MEDIATOR_DID=… node run.mjs
```

Two `did:key` parties attach to the mediator and exchange Rev 3 messages of
3 KB, 12 KB, 20 KB and 60 KB, Direct and Routed. Each is checked for the form
it was framed in (`0xF8` short, `0xFB` long), delivered byte-identical, and
unpacked and verified by the receiver. The rung fails unless each mode sends
at least one long-form frame.

Measured 2026-09-21 on era H (mediator 0.28.11, `--features tsp`):

```
── direct ──
    3000B payload →   3327B on the wire (short) → delivered 3327B, byte-identical, unpacked and verified
   12000B payload →  12327B on the wire (short) → delivered 12327B, byte-identical, unpacked and verified
   20000B payload →  20343B on the wire (long) → delivered 20343B, byte-identical, unpacked and verified
   60000B payload →  60342B on the wire (long) → delivered 60342B, byte-identical, unpacked and verified
── routed ──
    3000B payload →   4158B on the wire (short, inner 3327B short) → delivered 3327B, …
   12000B payload →  13167B on the wire (long, inner 12327B short) → delivered 12327B, …
   20000B payload →  21183B on the wire (long, inner 20343B long) → delivered 20343B, …
   60000B payload →  61182B on the wire (long, inner 60342B long) → delivered 60342B, …
```

Two things this settles:

- **The mediator is not the obstacle.** It accepts, stores and delivers
  long-form frames, and opens a long-form routed wrapper to forward the inner
  one unchanged.
- **The switch point is on the wire, not at 12,285 bytes of frame.** The count
  does not cover the whole frame, so a 12,327-byte frame is still short-form.

The receiving side needs a classifier that knows both prefixes.
`vti-didcomm-js` 0.7.0 routes only `-E` to its TSP callback (upstream fixed it
in 0.10.0), so the rung puts the `--` case in front of it — the same two
prefixes Keyring's `VtiMediatorSession` accepts, which its own tests assert.
