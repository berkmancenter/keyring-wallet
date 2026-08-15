# ref-06w4 — the witnessed exchange on the published package

**Question this rung answers:** ref-06w proved the flow against our
hand-authored draft specs because the real ones didn't exist upstream. Now
they do — #213 merged the four specifications (revised) and
`@openvtc/trust-tasks` 0.7.0 ships their generated modules. Does the full
witnessed exchange run **consuming only the published artifact** — and do the
#213 design calls behave as specified?

**Answer: yes — the exchange runs end-to-end on the package as published
(15/15 checks), the three design calls behave as merged, and the run surfaced
one significant upstream finding.** `npm install && node run.mjs`.

## What passes

- **The whole flow on package truth**: propose → accept (witnessed *answered*
  on the response — design call 3), two bilateral witness sessions with
  distinct challenges (design call 1), proofed submit → VWC + `vwcDigestMultibase`
  (Lever D as merged), issue → digest-bearing receipt (design call 2).
- **Policy enforcement works**: an unproofed `submit` is rejected with
  `proofRequired` before the handler; an unproofed `session` request is
  accepted (its request proof is OPTIONAL) — the per-variant proof
  declarations behave exactly as the specs state.
- **The TS `Payload`-alias generator bug is FIXED in 0.7.0** (#215) — zero
  mis-aliased modules; our four modules export their real payload interfaces.

## THE FINDING — the TS runtime validates no payload schemas

The generated runtime spec objects expose exactly four members:

```
{ typeUri, isBearer, isProofRequired, isRecipientRequired }
```

No payload schema. Consequences, each demonstrated as a named check:

1. A `propose` request whose payload matches **nothing** in the schema
   (`{ wrongMember: true }`) is **handled**.
2. A `submit#response` missing its REQUIRED `vwcDigestMultibase` is
   **accepted** by the consuming party.
3. An `issue` receipt missing its REQUIRED `vrcDigestMultibase` is
   **accepted** — the very member #213 made REQUIRED *as the correlator*
   is unenforced at the consumer.

The schemas ship in the package — but only as TypeScript types and
`payload.schema.json` files, which impose nothing at runtime. §7.2's
schema-validation step silently does not happen in the reference TS consumer.
(The Rust side may differ — untested here.) Policy checks (proof, recipient,
error routing) all work; it is specifically payload-schema validation that is
absent.

Also noted, minor: `consumeInbound` crashes with a bare `TypeError` when a
handler returns `undefined` (fire-and-forget consumption) — `isErrorResponse`
reads `.type` unguarded. Present since 0.6.0.

## Why this matters for the taskContext work

The receipt digest and `vwcDigestMultibase` are load-bearing in #213's design
— they are the correlator and the evidence binding. A consumer that never
validates them treats them as optional in practice, whatever the schema says.
Same class as the qualifying-profile concern: a rule without an enforcement
point is a suggestion.

## Files

- `run.mjs` — 15 checks; no Credo (transport identity stubbed via
  `StaticTransport` — the carriage is proven separately in ref-06v1/v1b/v1d)
