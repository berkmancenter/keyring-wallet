# card-verify

Runs the VTI SDK's own `verify_card` on a Vetting Card. That is the check an
openvtc vetter applies to the card an applicant sends
(`vta-sdk/src/vetting/card.rs`, built from the pinned
`external/verifiable-trust-infrastructure`).

It exists because Keyring's cards passed Keyring's own checks and failed
openvtc's. On 2026-09-24 an openvtc vetter refused every card because the
identity commitment hashed an extra member (keyring-bifold#108). Keyring's own
vetters never recompute the commitment, so nothing in our harness noticed.

## The gate step

```sh
scripts/openvtc/card-verify/check-keyring-card.sh
```

1. It checks that the VTI clone is at the pin in `scripts/openvtc/PINS.json`
   and has no local changes.
2. It runs bifold's `cardConformance.test.ts` with `CARD_OUT`. That test runs
   the shipping `VtiApplicant.sendCard` with a `did:key` persona whose Ed25519
   key really signs the card.
3. It verifies the card with `card-verify`. It prints `OK: card accepted …` and
   exits 0, or prints the SDK's refusal and exits non-zero.

No simulator and no network are needed.

## Building

A cargo build against the pinned vta-sdk (`vetting` feature). It reuses the
VTI clone's `target/`, so after the first build it's incremental. It's still a
compile, so declare it first:

```sh
CARD_VERIFY_BUILD=1 scripts/openvtc/card-verify/check-keyring-card.sh
```

## By hand

```sh
card-verify <card.json> <expect.json>
```

`expect.json` holds what the vetter knows from its own session:

- `audience`, `publisher`, `community`, `challenge`, `domain`, `requiredClaims`;
- optionally `now` (RFC 3339). It defaults to one second after the card's
  `issuedAt`.

How the publisher's key is found depends on its DID:

- a `did:key` publisher is verified offline;
- any other DID is resolved over the network (public hosts only).

Measured at VTI `a96fe02f`, 2026-09-24:

- a card from the fixed code is accepted;
- the same producer on the old commitment code is refused with *"identity
  commitment does not recompute from the card"*.
