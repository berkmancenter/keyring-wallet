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

## Trust Task documents

Two modes check the Trust Task documents Keyring signs. They run what a VTA or a VTC runs on each task it receives:

```sh
card-verify verify-task <task.json> <expected-signer-did> [<expected-type>]
card-verify verify-tasks <tasks.json> <dir>
```

**`verify-task`** refuses a document unless every check below passes:

1. **The proof verifies.** It runs vta-sdk's `verify_trust_task_proof_with`, and the proven signer must be `<expected-signer-did>`.
2. **The signer is the issuer.** The proven signer must equal the document's own `issuer`. SPEC §4.7 binds the proof to the issuer, and vtc-service refuses a valid proof by any other DID (`vtc-service/src/trust_tasks/mod.rs:326-349`, VTI `ed672fff`).
3. **The type matches.** When `<expected-type>` is given, the document's `type` must equal it.
4. **The payload matches its type's spec** in trust-tasks-rs 0.22.3. A request is checked against the spec's `Payload` and a `#response` against its `Response`, in three steps:
   - the specification's consumer policy (`SpecPolicy::enforce`, as vtc-service runs it at `trust_tasks/mod.rs:302`);
   - the published JSON Schema that the crate inlines (`validate::ValidatedPayload::validate_value`), which refuses unknown members wherever the schema sets `additionalProperties: false`;
   - a serde parse into the typed payload, as openvtc's `vetting/wire.rs` `open::<P>` does.

   A type that `card-verify` does not map, but for which upstream publishes a schema (`schema_index::schema_for`), is checked against that schema alone. A type with neither is accepted with `payload: no typed schema upstream`.

**`verify-tasks`** runs `verify-task` on every `{ file, type, signer }` entry of the `tasks.json` that bifold's `cardConformance.test.ts` writes, with `file` relative to `<dir>`. For each document it prints one line: `OK`, `PAYLOAD-UNCHECKED` or `REFUSED` with the reason. Then it prints a count. It exits non-zero if any document is refused or the list is empty.

```sh
cd bifold/packages/core && CARD_OUT=/some/dir TZ=GMT npx jest src/modules/trust-tasks/__tests__/cardConformance.test.ts
card-verify verify-tasks /some/dir/tasks.json /some/dir
```

Measured on 2026-09-25 against keyring-bifold#128 (`c39d5a3a`), 22 documents: 20 OK, 1 payload-unchecked, 1 refused.

- **Payload unchecked:** `trust-task-error/0.3`. The crate models only 0.5, as `ErrorPayload`, which has no schema. The `0.5` URI is parsed into `ErrorPayload`.
- **Refused:** `task-consent/decision/0.1`. Its `payloadDigest` is `"zQm"`, but the schema's DigestMultibase needs at least 16 characters. The test feeds that value in, and Keyring echoes the approval's digest without checking it.

Tampered copies are refused:

- an issuer changed in place (the proof fails);
- a valid proof by a key other than the issuer's;
- a different expected type;
- a type changed and re-signed (the payload fails the new type's schema);
- a payload enum value broken, or an unknown payload member added, then re-signed.
