# Track: signing, canonicalization, digests, encodings, envelope (HCP suite vs Keyring and VTA)

Reviewer notes, 2026-11-25. Read-only review; nothing posted.

Sources read (all local):

- PR view: `keyring-worktrees/d3-hcp-review/tt` on `pr1382` (head `e163cac1d`). `pr1380` (`94ed4200c`) and `pr1382` carry
  the same `SPEC.md`, `specs/_framework`, `specs/hcp` and proof libraries (`git diff --stat pr1380 pr1382` on those paths is
  empty), and the proof libraries equal `origin/main` (the PR does not touch them).
- Framework at our pin `2a66a0351`: `keyring-wallet/external/dtgwg-trust-tasks-tf`.
- VTI at the pin `f7b78e29d`: `keyring-wallet/external/verifiable-trust-infrastructure` (only this clone).
- VTI design PR #2823: `d3-hcp-review/vti2823/docs/05-design-notes/{hcp.md,hcp-plan.md,hcp-tasks.md}`
  (`tasks/hcp-demo-plan.md` is not in that checkout).
- Keyring: `keyring-worktrees/d3-fast-send` (head `5daeba0d0`).
- Our plan: `d3-plan-canvas/docs/plans/agent-connect-plan.md` and `agent-connect-plan/2026-11-25-bam.md`.

Scripts I wrote (scratch, not part of any repo):
`<scratch>/sf/`
`crosscheck.mjs` (proof reproduction), `nullable.py` (required-and-nullable census), `instants.py` (request-side
instants), `ajvfmt.cjs` (Keyring's Ajv behaviour).

---

## Summary

- **The bytes agree.** Keyring's own signing recipe (`canonicalize@1.0.8` + `@noble`, as `documentProof.ts` does it)
  verifies the PR demo's Management Client request and, signing the same document with the same key and `created`,
  reproduces the PR's `proofValue` **byte for byte**. Controls fail as they should.
- **proofPurpose:** every verifier involved (PR TS/Rust/Go/Dart, the VTA at `f7b78e29d`) accepts either
  `authentication` or `assertionMethod` as long as the key is listed under that relationship. Nothing would refuse a
  Keyring `assertionMethod` proof from a VTA-minted DID. But the 47 example proofs in the hcp specs all say
  `assertionMethod`, which goes against framework §4.7.3 (SHOULD `authentication`) and against the PR's own libraries,
  its demo and the VTA signer (all `authentication`). Worth a raise.
- **As received:** the "verify over the document as received" rule is already in the framework at our pin (§4.7, same
  text) and the VTA ingress at `f7b78e29d` already does it (`bind_document_to_sender` →
  `verify_trust_task_proof_value`). Keyring's `wireTimestamp` is still harmless but no longer needed for that VTA. Its
  comment is out of date.
- **Digests:** `accessTokenDigest` (`u`, base64url) is a provider-side record that never goes on the wire. It does not
  clash with Keyring's `z` digests. `DigestMultibase` accepts `z` and `u` at both the pin and the PR, with base58btc
  RECOMMENDED.
- **Framework version:** 0.6.0 is **older** than the text at our pin. The pin's `SPEC.md` already describes 0.7.0. The
  `_framework` schemas are identical. Between the pin and the PR, `SPEC.md` changes only in the new §4.13 (Trust
  Ceremonies) and some ceremony wording. Nothing changes in the envelope or the proof rules.
- **Real asks:**
  - (a) The regenerated Go and Dart types drop a required-nullable `null`, so they emit documents the PR's own schemas
    refuse (fix branches exist, but not in #1380).
  - (b) VTI V0 and our plan (D2) have Keyring send governance tasks with **no token**, but every Management Client
    request schema REQUIRES `accessToken` and is closed.
  - (c) The example proofs use the wrong purpose (see the proofPurpose point above).
- **Keyring-side gaps (ours, not the PR's):**
  - `VtaClient` casts VTA reply payloads without schema validation and only logs the proof verdict.
  - `verifyTrustTaskProof` does not bind the key to its relationship, which the pin's vta-sdk now does.
  - `verifyDocumentProof`'s default (`assertionMethod`) would refuse every VTA- or PR-signed hcp document.
  - Keyring's Ajv ignores `format` (`date-time`, `uri`).
  - JS `undefined` silently turns a required `null` into an absent member.

---

## Q1. Proofs

### What an hcp/* request needs

- All 28 specs declare `proofRequirement.request: REQUIRED` and `issuedAtRequirement: REQUIRED` (census of the front
  matter). Responses: 12 REQUIRED (audit/read, delegations/list, disclosures/summary, entries/confirm, entries/create,
  entries/get, entries/query, entries/restrict-purposes, entries/revise, entries/set-categories, export,
  grants/request), 16 RECOMMENDED.
- The token binding: "Every request that carries `accessToken` carries a `proof` … the provider **MUST** refuse with
  `permissionDenied` a token issued to a client other than the one the `issuer` VID identifies"
  (`tt/specs/hcp/entries/query/0.1/spec.md:331`). 26 of 28 request schemas require `accessToken`. The two that do not
  are `grants/request` (no token yet) and `grants/revoked` (provider → client notice).
- Cryptosuite: no hcp spec requires one (no `cryptosuite` statement in any front matter or prose). The framework baseline
  applies: every consumer MUST verify `eddsa-jcs-2022` (`tt/SPEC.md:314`, "A conforming *consumer* **MUST** be able to
  verify a `proof` whose `cryptosuite` is `eddsa-jcs-2022`"), and SHOULD verify `ecdsa-jcs-2019` P-256
  (`tt/SPEC.md:322`).
- What is signed (eddsa-jcs-2022, as every implementation here does it): `sha256(JCS(proof config)) ||
  sha256(JCS(document minus top-level proof))`, Ed25519 over those 64 bytes, and `proofValue` = `z` + base58btc. The proof
  config is the `proof` object minus `proofValue`.
  - PR TS: `tt/trust-tasks-ts-proof/src/sign.ts:79-100`.
  - PR TS verifier, config "exactly as received": `tt/trust-tasks-ts-proof/src/verifier.ts:184-191`.
  - Keyring: `d3-fast-send/packages/trust-tasks/src/documentProof.ts:285-303` (sign), `:577-583` (verify).
- "Verified over the document as received": `tt/SPEC.md:310`, "A *consumer* **MUST** verify a `proof` over the document
  **as received** … It **MUST NOT** verify over a re-serialization of a typed representation". The **same paragraph is at
  our pin** (`external/dtgwg-trust-tasks-tf/SPEC.md:309`). The hcp specs repeat it for retained copies: "The provider
  verifies the request's `proof` over the document as received, at receipt, before it removes anything"
  (`tt/specs/hcp/grants/revoke/0.1/spec.md:229`, and the same in each spec that takes a token).
- verificationMethod form:
  - PR TS verifier: its DID part must equal `issuer` exactly (`verifier.ts:155-158`), and it handles **did:key only**
    (`verifier.ts:66-69` "did:key only — no network, no resolver"; README:70).
  - VTA: it must be an absolute DID URL with a fragment (`vta-sdk/src/trust_task_proof/purpose.rs:227-236`
    `split_vm`), and signer == `issuer` == transport sender (`vta-service/src/trust_tasks/mod.rs:1288-1320`
    `bind_document_to_sender`).
  - Keyring always writes it absolute (`documentProof.ts:271-277`).

### proofPurpose

- **Framework:** "A *producer* **SHOULD** sign a *Trust Task document* with `proofPurpose` `authentication` … **SHOULD
  NOT** sign … with `assertionMethod` unless the governing *Trust Task specification* defines the document's proof as
  such an attestation" (`tt/SPEC.md:374`; identical at the pin, `:373`). A consumer checks the relationship the proof names
  (§4.7.3 items 1–3). A spec MAY require a purpose.
- **hcp specs:** none states a purpose requirement. All 47 example proofs in the 28 `spec.md` files say
  `"proofPurpose": "assertionMethod"` and none says `authentication`. Examples:
  `tt/specs/hcp/grants/revoke/0.1/spec.md:139`, `tt/specs/hcp/entries/query/0.1/spec.md:171` (request) and `:250`
  (response). None declares its proof an attestation under §7.3 item 8.
- **PR libraries and demo** default to `authentication`:
  - TS: `sign.ts:79`, `options.proofPurpose ?? "authentication"`.
  - Go: `trust-tasks-go/proof/sign.go:148`.
  - Every proof in `transcript.golden.txt` says `"proofPurpose": "authentication"`.
  - They accept all four signing purposes: TS `verifier.ts:47-52`, Go `verifier.go:322`, Rust
    `trust-tasks-proof/src/affinidi/purpose.rs:63-75`.
- **VTA at f7b78e29d:**
  - It signs every document that is not an attestation-slug request with `authentication` (`vta-sdk/src/trust_task_sign.rs:254`
    → `purpose_for_document_type`, `purpose.rs:129-150`; `ATTESTATION_SLUGS` = step-up approve-response,
    task-consent/decision, confirm/response, auth/oob/grant). So it would sign hcp/* responses with `authentication`.
  - It verifies whatever purpose the proof declares, bound to that relationship in the DID document
    (`verify.rs:313-316`, `PurposeBound::for_proof`; refuses keyAgreement and unknown values, `purpose.rs:81-94`).
  - Approval decisions must be `assertionMethod` (`verify.rs:336-391`).
- **Would anything refuse Keyring's `assertionMethod` proof?** No, provided the key is listed under `assertionMethod`.
  - VTA-minted DIDs list `#key-0` under both relationships (`vta-service/src/operations/did_webvh/document.rs:335-369`).
    A did:key has all four implicitly.
  - In any case, Keyring's `VtaClient` signs with `purposeForDocumentType(type)`
    (`packages/core/src/modules/trust-tasks/module/VtaClient.ts:1919-1933`; `proofPurpose.ts:25-29`), which gives
    `authentication` for every hcp/* slug. So Keyring's hcp requests would match the PR demo and the VTA.
  - The bare `signDocumentProof` default is `assertionMethod` (`documentProof.ts:265`). Only a caller that forgets to
    pass a purpose gets it.
- **Hazard on the Keyring side:** `verifyDocumentProof` requires `assertionMethod` unless told otherwise
  (`documentProof.ts:453`, `if (p.proofPurpose !== (requiredPurpose ?? 'assertionMethod')) return false`). Pointed at a
  VTA- or PR-signed hcp document, it returns false. The VTA reply path uses `verifyTrustTaskProof` (any purpose) through
  `checkVtaReply` (`vtaReplyProof.ts:27-41`), so today this is only a trap for new code.
- **Keyring's VTA reply verifier is weaker than the spec and the pin.** `verifyTrustTaskProof`'s doc says it
  deliberately does not check the purpose "as upstream does not … `VerifyOptions::new()` names none"
  (`documentProof.ts:532-536`). It looks the method up in `verificationMethod` + `authentication` + `assertionMethod`
  without the relationship named by `proofPurpose` (`:568-573`), and it would accept `proofPurpose: "keyAgreement"`
  (it only checks that the value is non-empty, `:550`).
  - The pin's vta-sdk now binds the purpose (VTI-KEY-022, `verify.rs:313-316`).
  - Framework §4.7.3 makes the binding a MUST.
  - On top of that, `VtaClient` only logs the verdict and "refuses nothing yet" (`VtaClient.ts:2090-2104`). So an
    unsigned or badly signed response to one of the 12 REQUIRED-response hcp specs would be used anyway (SPEC §7.2
    item 7 says reject with `proofRequired` / `proofInvalid`).

### Byte-level cross-check (CONFIRMED by running it)

Input: the Management Client's revoke request, `transcript.golden.txt:325-345`, with the redacted token restored to
`MANAGEMENT_TOKEN = "hcp_mt_demo_management"` (`examples/hcp-demo-ts/src/demo.ts:111`). The demo key is 32 bytes of 0x31
(`demo.ts:94-97,162`).

Result of `crosscheck.mjs`:

```
did:key from seed 0x31 matches issuer: true
1. Keyring recipe VERIFIES the PR demo proof: true
2. Keyring recipe, authentication, reproduces PR proofValue byte-for-byte: true
3. assertionMethod proof differs from PR proofValue: true
   assertionMethod proof verifies under the same key: true
4. Control: transcript as printed (token redacted) verifies: false
5. Control: issuedAt rewritten to .000Z verifies: false
```

What this shows:

- Keyring's JCS and proof-config hashing are byte-compatible with the PR's TS signer.
- The printed transcript is not the signed bytes, because the token is redacted (`demo.ts:492-499`).
- The timestamp spelling is part of what is signed.

### JS vs Rust canonical bytes

- **Key order:** both sort by UTF-16 code unit.
  - JS `canonicalize`: `Object.keys().sort()`.
  - PR TS jcs: `jcs.ts:23-26`.
  - Rust `serde_json_canonicalizer` 0.3.2 (the version affinidi-data-integrity 0.8.0 uses): `src/jcs.rs:27`
    `.encode_utf16()`.
  - They agree.
- **Doubles:** JS `JSON.stringify` vs Rust `ryu-js` (`serde_json_canonicalizer-0.3.2/src/jcs.rs:205-210`). Both use
  ECMAScript formatting, so they agree. The hcp schemas declare **no** `number` member (only integers; `confidence` is
  an enum string, `context-entry.schema.json` `Assertion.confidence`).
- **Integers above 2^53:** a Rust producer writes them exactly. `JSON.parse` in Keyring rounds them, so Keyring's
  canonical bytes would differ and a Rust-signed document would fail Keyring's verification. Only the open members
  could carry such values (VC `credential`, audit `data`, `narrowedTo`, `metadata`). JS-signed → Rust-verified is fine,
  because Rust reads the digits JS wrote. Not seen in any hcp example. (Library behaviour CONFIRMED; occurrence in
  practice UNVERIFIED.)
- **Unicode:** JCS does no normalization, so both sides keep strings verbatim. A lone surrogate (`"\ud800"`) is accepted
  by JS and refused by the Rust parser. Edge case: a provider would refuse such a document as malformed, not as a bad
  proof. UNVERIFIED in practice.
- **Null vs absent:** both keep `null`. In JS, `undefined` members are dropped by `canonicalize` and by
  `JSON.stringify` alike, so the signed bytes equal the sent bytes. But a required `null` written as `undefined`
  becomes absent (see Q4).
- **Timestamps:**
  - The VTA at the pin verifies the received JSON (`vta-sdk/src/trust_task_proof/verify.rs:200-238`
    `verify_trust_task_proof_value`). Network ingress uses it (`vta-service/src/trust_tasks/mod.rs:1288-1320`, the call at `:1313`;
    `received.rs:1-24` "the spine records the received JSON"). The typed `_with` form is kept "for documents this
    process built" (`verify.rs:170-185`).
  - The proof's `created` is kept as a string (`affinidi-data-integrity-0.8.0/src/lib.rs:124-125`,
    `created: Option<String>`). `parse_proof` refuses proof members the verifier cannot hash (`verify.rs:271-295`), so
    `expires`, `challenge` or a string `@context` would be refused. Keyring sends none of those.
  - So at `f7b78e29d`, `.000Z`, `+00:00` or a fraction verify. Keyring's `wireTimestamp` (`documentProof.ts:201-216`)
    is now belt-and-braces, and its comment ("vta-sdk verifies a Trust Task proof over a RE-SERIALISATION", citing
    `verify.rs:144-161` at `ed672fff`) is out of date for the pin. Older deployed VTAs may still verify typed (UNVERIFIED
    which Farm build does).
- **Do hcp payloads carry instants a Rust verifier would re-serialize?** Yes, if it verified typed. The generated Rust
  hcp types model `Instant` as `chrono::DateTime<Utc>` (`tt/trust-tasks-rs/src/specs/hcp/entries/query/v0_1.rs:62`
  `valid_until: Option<chrono::DateTime<Utc>>`; `grants/request/v0_1.rs:395`).
  - Request-side instants (`instants.py`): audit/read `from`, `to`; disclosures/summary `from`, `to`;
    entries/create and entries/revise `assertion.validUntil`, `evidence[].verification.at`,
    `record.provenance.assertedAt`; grants/revoked `revokedAt`; shares/report `sharedAt`; import `export.exportedAt`
    plus every audit, delegation, directive and rule instant in the export.
  - Keyring's `withWireTimestamps` normalizes only top-level `issuedAt`, `expiresAt`, `validFrom` and `validUntil`
    (`documentProof.ts:218-231`), not payload instants.
  - This is safe at a verifier that follows the rule. For symmetry, Keyring should write payload instants with
    `wireTimestamp` too.

---

## Q2. Digests and encodings

- **`accessTokenDigest`** is "the SHA-256 multihash of the token's UTF-8 bytes, multibase-encoded as base64url without
  padding (prefix `u`)" (`tt/specs/hcp/grants/revoke/0.1/spec.md:229`; same in 27 spec.md files).
  - It is what a **provider** records in a request copy it **retains**. It appears in no schema (`grep accessTokenDigest
    specs/hcp/**/*.json` → nothing).
  - Keyring never computes or receives it, so there is **no conflict** with Keyring's `digestMultibase` (base58btc,
    `documentProof.ts:55-58`).
  - The spec calls it "the framework's `DigestMultibase` form", while that definition RECOMMENDS base58btc. Minor:
    a clarity ask at most.
- **Framework `DigestMultibase`**, identical at the pin and the PR (`diff -r specs/_framework` between them is empty):
  - `"pattern": "^(z[1-9A-HJ-NP-Za-km-z]+|u[A-Za-z0-9_-]+)$"`, `minLength` 16, with the description "Restricted to
    the two multibase headers … `z` (base58btc) and `u` (base64url-no-pad) … base58btc is RECOMMENDED"
    (`specs/_framework/0.4/framework.schema.json` `$defs.DigestMultibase`; 0.3 the same).
  - SPEC §4.9.3 is the same at both: compare **decoded** multihash bytes, because "`DigestMultibase` admits more than
    one base encoding" (`tt/SPEC.md:558`).
- **task-consent `payloadDigest`** `$ref`s `_framework/0.3 … DigestMultibase`
  (`external/dtgwg-trust-tasks-tf/specs/task-consent/request/0.1/payload.schema.json`, `properties.payloadDigest`), so
  it accepts both.
  - Keyring's `digestBytesEqual` decodes both `z` and `u`/`U` (`documentProof.ts:104-130`).
  - **Gap:** `consentMatchCode` decodes with credo's `MultiBaseEncoder` (`consentCheck.ts:26-38`), which knows only `z`
    (`@credo-ts/core/build/utils/MultiBaseEncoder.mjs`: `multibaseDecodingMap = { z: … }`). A `u` payloadDigest would
    show no match code. Display only. I did not check which base the VTA's HCP consent producer will use.
- **Other encodings in the hcp schemas** (`specs/hcp/_shared/0.1/common.schema.json` `$defs`):
  - **Identifiers:** `Urn` = `urn:uuid:` plus a UUID of either case. Keyring mints `urn:uuid:${utils.uuid()}`, which
    fits.
  - **URIs and codes:** `Uri` and `PurposeCode` are absolute URIs matching `^[a-zA-Z][a-zA-Z0-9+.-]*:\S+$`, at most
    2048 characters, `format: uri`. `Category` is a snake slug or an absolute URI.
  - **Instants:** `Instant` is `format: date-time` (RFC 3339 with an offset; HCP 1.10 says the same, `hcp-spec …
    specification.md:149-151`).
  - **Durations** are integer seconds: grants/request `expiresIn` has `maximum: 86400`; next-step `hint.retryAfter` in
    the transcript is 1.
  - **Cursors** are opaque strings with a maxLength. `nextCursor` is "Absent, never null, when the result set is
    exhausted … a departure from HCP 9.5's null" (`disclosures/summary/0.1/payload.schema.json:61-65`).
  - **Base64:** no base64 member and no `contentEncoding` in any hcp schema (census found only `format`: 6 `date-time`,
    2 `uri`).
  - **Size bounds** (`maxDocumentBytes`): import request 16,777,216 bytes; export response 14,680,064; query response
    12,582,912; others are 512 KiB to 5 MiB.
    - The VTA's REST trust-task route caps a body at 1 MiB (`vta-service/src/routes/mod.rs:82-84`
      `MAX_BODY_SIZE`). hcp/* is refused over REST in V0 anyway (`vti2823 … hcp.md:161`).
    - The VTA's agent-memory value cap is 64 KiB (`operations/app_state.rs:94`), against a 512 KiB entries/create
      request bound. That matters only if HCP entries were stored as `vta/memory` values (UNVERIFIED design choice).
    - TSP and DIDComm carriage limits for 12–16 MiB documents: not checked in this track.
- **VC evidence securing (HCP itself):** "A credential that is an entry's content MUST be secured by one of" `eddsa-rdfc-2022`
  (MUST verify), `ecdsa-sd-2023` (SHOULD), VC-JOSE-COSE (MAY) (`hcp-spec … specification.md:3113-3121`).
  `eddsa-jcs-2022` is not in that list.
  - Keyring's VRC v3 uses `eddsa-rdfc-2022` (`packages/core/src/modules/vrc/vrc-manager.ts:499-539`), which is fine.
  - The shared-connect credential uses `eddsa-jcs-2022` (`trust-tasks/module/sharedConnectCredential.ts:20`). As an
    entry's content credential it would be `credential-invalid`.

---

## Q3. Envelope and versions

- **Envelope:**
  - hcp documents use the framework envelope unchanged. The 0.6.0 envelope schema
    (`specs/_framework/0.6/trust-task.schema.json`) has `id`, `threadId`, `parentThreadId`, `ceremony`, `type`,
    `issuer`, `recipient`, `issuedAt`, `expiresAt`, `payload`, `@context` and `proof`. It requires `id`, `type` and
    `payload`, and has `additionalProperties: true`. 0.5 and 0.6 differ only in `$id`, title and description.
  - The hcp parties make `issuer` and `recipient` REQUIRED (each spec's `parties`).
  - The demo uses `type` with an explicit `#request` (`transcript.golden.txt:88`). §4.4.1 rule 1 makes that
    equivalent to no fragment (`tt/SPEC.md:209`).
- **What Keyring sends** (`VtaClient.ts:1919-1933`): `id` (`urn:uuid`), `type`, `threadId` (a fresh `urn:uuid`, not equal
  to `id`; allowed by §4.9), `payload`, `issuer`, `recipient` (the VTA DID), `issuedAt`, any `documentExtras`
  (top-level, covered by the proof), and a `proof` with an absolute VM and `purposeForDocumentType`. **Compatible.** No
  `expiresAt`; the hcp specs require only `issuedAt`.
  - The provider matches a grants/request resubmission "by its `threadId` **and** its `issuer`"
    (`specs/hcp/grants/request/0.1/spec.md:175`). That is the Context Client's concern. `VtaClient` mints a new
    `threadId` per send, so any reuse for HCP resubmits needs care (UNVERIFIED whether the plugin reuses `VtaClient`).
- **Versions:** `targetFrameworkVersion: "0.6.0"` (each hcp front matter, e.g. `entries/query/0.1/spec.md:7`). Our pin
  is **not older**:
  - The pin's `SPEC.md` has changelog B.1 "Framework version 0.7.0" (`external/dtgwg-trust-tasks-tf/SPEC.md:2016`).
  - Its `specs/_framework` already has `0.6/trust-task.schema.json`, identical to the PR's.
  - `git diff 2a66a0351 HEAD -- SPEC.md` (127 insertions, 8 deletions) adds §4.13 *Trust Ceremonies* (stage gates,
    verdicts → replies), rewords the ceremony definitions, adds a producer rule that evidence answering a held
    next-step must identify the held exchange (`tt/SPEC.md:1122`), and re-states decline handling in §8.6.
  - No change to §4.2 members, §4.7 proof, §4.7.1 suites, §4.7.3 purpose or §4.9.3 digests.
  - 0.6 is the newest framework envelope schema published; 0.7's is still owed (B.1, last bullet). That is why the
    specs target 0.6.0.
- **Unknown `ext` namespaces:**
  - `ext["vnd.trusttasks.hcp-carriage"]` appears only in the **hcp/import response** (`specs/hcp/import/0.1/spec.md:345`;
    `payload.schema.json:54,209-213`). Its shape check is an uncheckedRule in #1381, not a schema check.
  - The response's `ext` is `$ref` → framework `Ext` (any reverse-DNS key, `additionalProperties: true`), so Keyring's
    Ajv passes it. `VtaClient` casts the payload and ignores it. Framework rule 5 says ignore it.
  - Request schemas are closed (`additionalProperties: false` on every request I checked: grants/revoke, audit/read,
    disclosures/summary, entries/create, grants/list, import, export, entries/restrict-purposes), so Keyring cannot add
    `ext` to a request.
  - The `vnd.trusttasks.` prefix has registry precedent (`specs/did-management/_shared/0.1/CONVENTIONS.md:59`).

---

## Q4. Null vs absent

- **Does Keyring validate inbound payloads (SPEC §7.2 item 2)?**
  - **Peer documents over the Trust Task carriage: yes.** `TrustTasksService.consume` runs the framework pipeline with
    `payloadPolicy: { kind: 'validate', validate: trustTaskPayloadValidator }`
    (`packages/core/src/modules/trust-tasks/services/TrustTasksService.ts:101-114`), using Ajv 2020 with
    `strict: false` (`packages/trust-tasks/src/validator.ts:13-25`).
  - **VTA replies: no.** `VtaClient.sendTask` returns `(body?.payload ?? body) as T` (`VtaClient.ts:2110`), a cast, and
    the proof verdict is only logged (`:2090-2104`). Vetting documents get schema checks by hand (`vettingShape.ts`).
  - **Keyring's Ajv ignores `format`.** Run against that Ajv (8.20.0): `"unknown format "date-time" ignored"`, and
    `{t:'not-a-date', u:'no scheme here'}` passes. Required-nullable is enforced: absent → invalid, `null` → valid
    (`ajvfmt.cjs`).
- **Required-and-nullable hcp members** (`nullable.py`, all `type: [X, "null"]` and listed in `required`):

  | Schema | Member | Meaning of `null` |
  |---|---|---|
  | `_shared/0.1/audit-event` `AuditEvent` | `entryId`, `relatedEntryId`, `purpose`, `purposeDescription`, `grantId` | none applies or redacted (question 42) |
  | `_shared/0.1/delegation` `DelegationTerm` | `endsAt` | no end known |
  | `_shared/0.1/grant` `Grant` | `expiresAt` | persistent grant (`grant.schema.json:10,57-58`) |
  | `disclosures/summary` `ClientSummary` | `usableUntil` | HCP does not say |
  | `entries/get` and `entries/query` `Response` | `directives` | requester is not a Context Client (a Management Client), question 5 |
  | `entries/restrict-purposes` **request** | `permittedPurposes` | "Null removes the Authorizing Principal's narrowing" (sent **by Keyring**) |

  Optional-and-nullable (absent and `null` both allowed): `EntrySubject.relationship`, `Content.language`,
  `Assertion.confidence`, `Assertion.validUntil`, `Classification.dimension`, `WriteClassification.dimension`,
  `RevisionAssertion.confidence`, `RevisionAssertion.validUntil`, and import `ImportedAuditEvent.*` (5).
- **Keyring pitfalls:**
  - `JSON.stringify({ p: undefined })` gives `{}`, so a restrict-purposes request built with `permittedPurposes:
    undefined` is refused (`required`). Write `null` explicitly.
  - On the reading side, Keyring gets `directives: null` on its own queries and `expiresAt: null` on persistent
    grants. Code that tests `=== undefined` would misread them.
  - `nextCursor` uses absent-not-null, the reverse of HCP HTTP.
- **Libraries in the PR:**
  - Rust keeps `null`: `Option` without `skip_serializing_if` (`trust-tasks-rs/src/specs/hcp/grants/request/v0_1.rs:393-395`;
    `entries/query/v0_1.rs:4596`; `entries/restrict_purposes/v0_1.rs:1600-1606`).
  - **Go drops it:** `ExpiresAt *string \`json:"expiresAt,omitempty"\``
    (`trust-tasks-go/specs/hcp/grants/request/v0_1/payload.go:177`) and `Directives *[]Directive
    \`json:"directives,omitempty"\`` (`entries/query/v0_1/payload.go:41`).
  - **Dart drops it:** `if (expiresAt != null) 'expiresAt': expiresAt!`
    (`trust-tasks-dart/lib/specs/hcp/grants/request/v0_1/payload.dart:716`).
  - So a Go or Dart provider emits a persistent grant, or a Management Client query response, that the PR's own schema
    refuses. Fix branches exist (`origin/fix/go-required-nullable` `21f75e283`, `origin/fix/dart-required-nullable`
    `43f7a00a2`) but are not in #1380's generated code.

---

## Q5. One real signed Management Client request

From `examples/hcp-demo-ts/transcript.golden.txt:325-345` ("4. Revoke … from the Management Client"). Here
`accessToken` is restored to the value actually signed, `MANAGEMENT_TOKEN` from `src/demo.ts:111`. The transcript prints
`"hcp_mt…"`, and with that value the proof does **not** verify. Key: 32 bytes of 0x31 (demo only).

```json
{
  "id": "urn:uuid:00000000-0000-4000-8000-00000000000b",
  "issuedAt": "2026-11-25T10:00:10Z",
  "issuer": "did:key:z6MkjJRuJtMxfTErK55eWeV7FQLLxpsvzSUQ3AC6DmdNPFja",
  "payload": {
    "accessToken": "hcp_mt_demo_management",
    "grantId": "urn:uuid:00000000-0000-4000-8000-000000000006"
  },
  "proof": {
    "created": "2026-11-25T10:00:10Z",
    "cryptosuite": "eddsa-jcs-2022",
    "proofPurpose": "authentication",
    "proofValue": "z2Q3HYiNtXPbSn3kPPYD2WUd2s9GmmgXpDRwG1fD7cYdUe7ft8LHePqKhSfSXjqD5NwZmAwmibDF4fp7Eb8m8MrQa",
    "type": "DataIntegrityProof",
    "verificationMethod": "did:key:z6MkjJRuJtMxfTErK55eWeV7FQLLxpsvzSUQ3AC6DmdNPFja#z6MkjJRuJtMxfTErK55eWeV7FQLLxpsvzSUQ3AC6DmdNPFja"
  },
  "recipient": "did:key:z6MktULudTtAsAhRegYPiZ6631RV3viv12qd4GQF8z1xB22S",
  "threadId": "urn:uuid:00000000-0000-4000-8000-00000000000b",
  "type": "https://trusttasks.org/spec/hcp/grants/revoke/0.1#request"
}
```

The canonical bytes that were hashed (from `crosscheck.mjs`):

- JCS(document minus proof):
  `{"id":"urn:uuid:00000000-0000-4000-8000-00000000000b","issuedAt":"2026-11-25T10:00:10Z","issuer":"did:key:z6MkjJRuJtMxfTErK55eWeV7FQLLxpsvzSUQ3AC6DmdNPFja","payload":{"accessToken":"hcp_mt_demo_management","grantId":"urn:uuid:00000000-0000-4000-8000-000000000006"},"recipient":"did:key:z6MktULudTtAsAhRegYPiZ6631RV3viv12qd4GQF8z1xB22S","threadId":"urn:uuid:00000000-0000-4000-8000-00000000000b","type":"https://trusttasks.org/spec/hcp/grants/revoke/0.1#request"}`
- JCS(proof config):
  `{"created":"2026-11-25T10:00:10Z","cryptosuite":"eddsa-jcs-2022","proofPurpose":"authentication","type":"DataIntegrityProof","verificationMethod":"did:key:z6MkjJRuJtMxfTErK55eWeV7FQLLxpsvzSUQ3AC6DmdNPFja#z6MkjJRuJtMxfTErK55eWeV7FQLLxpsvzSUQ3AC6DmdNPFja"}`

---

## Cross-track item found on the way: V0 "no token" vs the required `accessToken`

- The VTI design says Keyring's governance tasks carry no token in V0: "Keyring → VTA | DIDComm authcrypt from the admin
  DID, a required document proof by that DID, the ACL admin role; no token (§4.4)" (`vti2823 … hcp.md:158`). §4.4 says
  the same: "in V0 the governance tasks (`hcp/grants/revoke`, `hcp/audit/read`, `hcp/disclosures/summary`,
  `hcp/entries/create`) authenticate the **admin DID**" (`hcp.md:230-239`).
- Our plan's companion records the same: "D2 … Keyring has no VTA session token … recorded as a declared demo
  divergence" (`agent-connect-plan/2026-11-25-bam.md:450`).
- But each of those request schemas REQUIRES `accessToken` (`type string, minLength 1, maxLength 8192`) and is closed
  (`additionalProperties: false`). This holds for grants/revoke `required ["grantId","accessToken"]`, audit/read,
  disclosures/summary, entries/create, and also grants/list, export, import and restrict-purposes.
- So a Keyring document without a token fails SPEC §7.2 item 2 at any validating consumer, the VTA's spine included.
  Neither design says what goes in `accessToken` in V0.

## Asides (not findings)

- Keyring's `ATTESTATION_SLUGS` (`proofPurpose.ts:10`) lists 3 slugs. The pin's vta-sdk lists 4: it adds
  `auth/oob/grant` (`purpose.rs:122-127`). Nothing to do with hcp, and the sign-in code passes its purpose explicitly
  (`signInSteps.ts:452`), but the mirror has drifted.
- Keyring verifies only `eddsa-jcs-2022` (`documentProof.ts:549`). Framework 0.7.0 says SHOULD also verify `ecdsa-jcs-2019`
  P-256. The VTA signs with Ed25519, so there is no hcp impact.
- The PR's TS signer copies the document's `@context` into the proof by default (`sign.ts:91-98`). Keyring does so only
  with `carryContext`. hcp documents carry no `@context`, so there is no difference here.
- The Rust validator in trust-tasks-rs compiles with `jsonschema` 0.63 Draft 2020-12 defaults (`trust-tasks-rs/src/validate.rs:98-105`).
  Whether it enforces `format` is UNVERIFIED (crate source not on disk).
