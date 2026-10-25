# card-verify-v047

The VTI SDK at the 0.47 pin judges what Keyring writes in **DTG Credentials v1**.
It's the check an openvtc applicant on VTI 0.47 (vta-sdk 0.58, dtg-credentials
0.12.0) runs on a vetting statement:

1. `verify_statement`, a strict DTG parse:
   - the registry v1 context, second and exact;
   - one concrete subtype;
   - `issuerScope`;
   - the vetted/1 predicate, with a strict `object.value`;
   - one `assertionMethod` proof by the issuer.
2. `check_against_card`: the statement is about the Vetting Card that was sent.
3. `check_against_session`: `taskContext` and `taskDigestMultibase` bind the
   session document.

It sits beside [`../card-verify`](../card-verify), which stays on the main VTI pin
and judges the shapes Keyring writes by default. This one is built from a
**second, separate** clone: `PINS.json` entry `verifiable-trust-infrastructure-v047`,
which `setup-external` checks out at `external/verifiable-trust-infrastructure-v047`.
The main pin and its clone don't move.

## Usage

```sh
card-verify-v047 <card.json> <expect.json>
card-verify-v047 verify-statement <statement.json> <card.json> <session.json> <expect.json>
```

`expect.json` is the one `card-verify` reads (`audience`, `publisher`, `community`,
`challenge`, `domain`, `requiredClaims`, optional `now` / `statementNow`). It prints
one `OK: …` line and exits 0, or prints `REFUSED (<check>): <upstream's error>` and
exits non-zero.

bifold's `cardConformance.test.ts` writes the inputs with `CARD_OUT`:
`statement-v1.json` is the statement Keyring's vetter desk writes with
`setDtgV1WritingEnabled(true)`, and `session.json` is the session document it
cites. bifold's `vti-conformance` workflow runs this checker on them.

## Building

```sh
node scripts/openvtc/setup-external.mjs        # clones the -v047 pin beside the others
cd scripts/openvtc/card-verify-v047 && cargo build --release --locked
```

The dependency versions are the ones VTI's `Cargo.lock` pins at the 0.47 commit.
