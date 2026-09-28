# ref-07h-vsc-credo-suites

A `dtg:witnessed` VSC (plan §3's D1–D4, D7 shape) signed and verified through
**Credo 0.7's real proof-suite path** — not a bespoke JCS helper — under
**both suites Keyring actually ships**: `Ed25519Signature2018` and
`DataIntegrityProof`/`eddsa-rdfc-2022`. D6 (the subject–issuer binding) is
checked against a credential Credo itself verified, not one this rung signed
and verified with the same code.

```sh
npm install && node run.mjs   # verbose
npm run -s check              # quiet pass/fail — the CI gate
```

Every existing rung's cross-implementation work (`ref-07e`) is pure JCS
string work against `dtg-credentials` 0.7.0. Under the plan as originally
written, the first time a VSC would meet Credo's real sign-and-verify path
was V4's `yarn e2e:vrc` — after issuance had already changed. This rung
closes that gap before V3/V4, not after.

## What it proves

- A `dtg:witnessed` VSC built from a **real captured VRC**
  (`ref-07-dtg-edge-semantics`'s fixture) signs and verifies cleanly under
  both shipped suites, through Credo's actual `w3cCredentials.signCredential`
  / `verifyCredential` API — including a real Askar-backed agent, a real
  `did:peer` DID, and the repo's own patched `@credo-ts/core` (verified by
  `run.mjs` refusing to proceed against stock Credo — see `ensurePatchedCore`).
- **D6 holds under Credo's real path.** Both the digest check
  (`object.digestMultibase == taskDigestMultibase(vrc)`) and the subject
  check (`credentialSubject.id == vrc.issuer`) pass on a credential Credo
  itself verified, for both suites.
- **D6 correctly rejects what it should.** A validly-signed VSC whose
  `credentialSubject.id` is *not* the referenced VRC's issuer still passes
  Credo's signature verification (the signature is genuine) but fails D6 —
  proving D6 catches a case a signature check alone cannot, for both suites.
- **Tamper detection holds.** Any change to a signed `object.digestMultibase`
  breaks Credo's real proof verification, for both suites.

## What it does not prove

- The DIDComm/TSP carriage a real witness ceremony travels over — see
  `ref-07i-vsc-over-carriages`.
- Anything about the witness-server's own issuance code
  (`buildWitnessCredentialJson`) — this rung builds the VSC by hand, matching
  the plan's D1–D4/D7 table, not by calling production's builder.
- The real, final DTG `@context` or predicate namespace. `DTG_NS`/
  `DTG_CONTEXT` here are the plan's `firstperson.network` placeholder — the
  real namespace question (plan §9 Q6, a real registry now exists at
  `registry.trustoverip.org`) is orthogonal to what this rung proves and is
  not resolved here.
- `#58`'s outcome (whether `taskContext`/`taskDigestMultibase` stay on the
  credential or move to a detached citation) — this rung signs them inline,
  matching the plan's current D4. If `#58` lands, this rung's VSC shape needs
  revisiting, not just V4's.

## Three real findings, not just plumbing

Wiring a document loader for Credo's real JSON-LD signing path surfaced three
things a bespoke test harness (like `ref-07e`'s) would never hit, because it
never goes through Credo's actual suite implementations.

### 1. `safe: true` makes an untermed member fatal, not silently zero-quads — and it's baked into the shipped libraries, not a Credo setting

`ref-07c` measured *"an untermed member contributes zero quads"* using plain
`jsonld.expand()`/`canonize()`, no safe mode. **That is not what actually
signs a VSC.** `@digitalcredentials/eddsa-rdfc-2022-cryptosuite`'s
`canonize.js` and `@digitalcredentials/jsonld-signatures`' `LinkedDataSignature`
(the base class behind Credo's own `Ed25519Signature2018`) both hard-code
`safe: true` unconditionally — confirmed by grep across the installed
packages, and confirmed by this rung failing on **`Ed25519Signature2018`
first**, not only the custom `eddsa-rdfc-2022` suite. Under `safe: true`, a
property that cannot expand to an absolute IRI throws
(`jsonld.ValidationError`, `"Safe mode validation error"`) instead of the
`"Dropping property"` warning plain mode logs.

**Practical consequence for V2/V4:** you cannot stage an untermed member
through the real signing path at all. `document-loader.mjs`'s `DTG_CONTEXT_DOCUMENT`
had to define real terms for every member this rung emits —
`predicate` (`@type: @id`), `object` (as a term; `object.digestMultibase`
itself is **not** redefined — see below), `taskContext`, `witnessContext.event`/
`sessionId`/`method` — and even the `type` array's own `DTGCredential`/
`StatementCredential`, which also throw as *"relative @type reference"* if
untermed. This is stricter than plan §3.7's framing assumed ("terms land
before members" as an ordering *should*): under the suites actually shipped,
it is *must, or nothing signs* — every emitted member needs its term
**simultaneously**, not eventually. Arguably safer than the alternative
(fails loudly at sign time, not silently at verify time), but a real
tightening of the plan's V2/V4 sequencing discipline, worth folding back in.

`object.digestMultibase` is the one member deliberately **not** termed here:
it is already defined and `@protected` by the base `credentials/v2` context
(`security#digestMultibase`), and redefining a protected term is itself a
fatal JSON-LD error (plan §3.7, Alberto's review finding A2). Confirmed
directly by this rung: adding a term for it breaks; leaving it out works.

### 2. `Ed25519Signature2018` verification requires the dereferenced key document to carry its own `@context`

Signing succeeds without it; **verification** fails with
`"The '@context' of the verification method (key) MUST contain the context
url \"https://w3id.org/security/suites/ed25519-2018/v1\""`, thrown from
`Ed25519Signature2018.assertVerificationMethod` when the suite dereferences
the signer's key to check it. Production's `createVrcDocumentLoader.ts`
already handles this — a `VERIFICATION_METHOD_CONTEXTS` map keyed on
verification-method type, injecting `@context` only for
`Ed25519VerificationKey2018` — and this rung's document loader was missing
it entirely (a hand-written inline object literal, not a port of the real
function). Ported `toPlainVerificationMethod` verbatim rather than
re-deriving it. Worth knowing: this is invisible until you verify through
Credo's real suite class, which is exactly why `ref-07e`'s hand-rolled
verifier never found it.

### 3. A signed credential re-hydrates as a different class than an unsigned one

`agent.w3cCredentials.verifyCredential({ credential })` rejects a `credential`
built via `JsonTransformer.fromJSON(json, W3cCredential, …)` outright —
*"Credential must be either a W3cJsonLdVerifiableCredential or a
W3cJwtVerifiableCredential"* — even when the JSON is a genuinely signed
credential (carries a `proof`). `W3cCredential` is the pre-signature
construction type; a signed JSON must be re-hydrated as
`W3cJsonLdVerifiableCredential` before verification. Caught in the tamper
test, which round-trips a signed credential's JSON, mutates one field, and
re-parses it — the earlier steps in this rung either use the object
`signCredential` already returns directly, or never re-parse signed JSON, so
they never hit this.
