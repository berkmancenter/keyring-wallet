# ref-06v1c — the task layer, for real

Rungs 06v1/06v1b proved the **envelope** (a Trust Task document rides Credo's
DIDComm v1 unharmed). This rung proves the **task layer on top of it**: a real
registry specification — [`vtc/relationships/request/0.1`](https://trusttasks.org/spec/vtc/relationships/request/0.1),
the spec upstream migrated its own VRC exchange onto — processed end-to-end by
the official [`@openvtc/trust-tasks`](https://www.npmjs.com/package/@openvtc/trust-tasks)
0.6.0 library (generated types + the §7.2 `consumeInbound` consumer pipeline),
between two Credo 0.6.3 agents. 13 checks in five acts.

Run: `npm install && npm start` (`npm run check` for quiet pass/fail).

## What each act teaches

**Act 1 — the qualifying profile is enforced by machinery, not prose.**
`vtc/relationships/request` declares `proof: REQUIRED` (per-variant — it is the
registry's first such spec). Send a request without a proof and the pipeline
rejects it with `proofRequired` *before any business code runs*. This is the
same declaration the cred-spec's "qualifying specification" profile requires of
our future `witness/*` specs — here it is, working.

**Act 2 — the DTG exchange idiom on our stack, both directions.**
Bob requests, Alice's `consumeInbound` runs §7.2 items 4–8 (expiry, recipient,
identity cross-check, proof policy, spec policy), her handler issues, and
`respondWith` derives the `#response` type, swaps the parties, and continues
the thread per §4.9's fallback. Then the part #173 flagged as having "no named
path": **Bob consumes the retained `#response` through the same pipeline**, by
passing `RESPONSE_SPEC` instead of `SPEC`. Finding: it simply works — what is
missing upstream is guidance for *third parties* (a verifier who was never in
the exchange), not code. That experience feeds Glenn's ask #5.

**Act 3 — a decline is not a bespoke message.**
The registry idiom: refusal is a `trust-task-error` carrying the slug-namespaced
code `vtc/relationships/request:declined` and — the load-bearing #173 fix —
**`inResponseTo`** naming the request's `id` and `typeUri`, so a retained
decline means something to a party that never saw the request. Note the member
is spelled `typeUri`, not `type`. This is the model for our witness spec's
failure branch (subtask B5: the error branch is diagnostic, and now at least
self-describing).

**Act 4 — identity is checked, and silence is a rule.**
The transport seam (`StaticTransport`) is the binding's §3 made literal: we
hand the pipeline `{ issuer: connection.theirDid }` and §4.8.1 does the rest.
An in-band `issuer` contradicting the transport-authenticated sender is
`identityMismatch`, the handler never runs, and the error is deliberately NOT
addressed to the contested identity. And §8.1's strangest rule holds: a
contested identity on a channel that authenticated **no sender** produces *no
response at all* (`suppressed`) — answering would be an oracle. Constructing
that case taught us its precondition: a mismatch needs both values present, so
the unauthenticated variant only arises recipient-side.

**Act 5 — Credo's answer to the binding's "case 2".**
The binding's §3 distinguishes *authenticated-but-unknown* (a verkey bound to
no known DID — usually a missing connection record on your side) from
*unauthenticated* (nobody signed). We deleted Alice's connection record and
sent again: Credo fails processing with **"No connection associated with
incoming message …"** — a distinct, operational-fault-shaped error, not a
generic rejection. So Credo does surface case 2 distinguishably; the binding's
requirement to log the two cases differently is implementable on our stack.
(In-process, the failure propagates back to the sender; over a real mediator
the receiver logs it and the sender sees silence.)

## What this rung does NOT prove

- **No cryptographic proof verification.** The documents carry a structurally
  complete but non-verifying `DataIntegrityProof` stub, consumed under
  `proofPolicy: acceptUnverified`. Wiring real `eddsa-*` verification is the
  DI-suite integration (Phase D) — claiming it here would be dishonest.
- **Not our specs yet.** `vtc/relationships/request` is upstream's community
  exchange; our `vrc/*`/`witness/*` specs (the joint appendix) are the next
  rung's material. This rung proves the machinery they will run on.
- Same standing limits as the family: in-process transport (network proven by
  06v1b), Node only (Hermes is ref-08).

Pinned against: `@openvtc/trust-tasks` **0.6.0** (npm; matches `trust-tasks-ts`
in the `dtgwg-trust-tasks-tf` clone @ `fbe196a`), `@credo-ts/*` 0.6.3.
