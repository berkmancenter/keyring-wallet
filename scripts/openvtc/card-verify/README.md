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

## Conformance modes

Two more modes, each running upstream's own function at the pin:

```sh
card-verify digest <value.json>
card-verify verify-statement <statement.json> <card.json> <expect.json>
```

- **`digest`** prints DTG Credentials' `digestMultibase`: JCS without the top-level `proof`, sha-256 multihash, base58btc (`dtg_credentials::digest_multibase_json`, the function vta-sdk's `vetting::digest` calls). A golden vector for a fixture comes from this, never from Keyring's own code (keyring-bifold `openvtcVetterStatement.test.ts`).
- **`verify-statement`** verifies the card, then runs vta-sdk's `verify_statement` and `check_against_card` on the statement. That is what an openvtc applicant runs on a statement it receives (openvtc-core `vetting/applicant.rs:1068`, at `ed13d29`). `expect.json` may add `statementNow`, which defaults to one second after the statement's `validFrom`.

`check-keyring-card.sh` runs both directions: the card Keyring's applicant sends, and the statement Keyring's vetter makes over it. `BIFOLD_DIR` points it at a bifold checkout other than the submodule.

Measured on 2026-09-25: on bifold main (`eaa563d3`), Keyring's statement was refused with `Binding("cardDigestMultibase")`, because Keyring hashed the card with its proof. keyring-bifold#116 fixes that, and both directions then pass.
