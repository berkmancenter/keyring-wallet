# ref-07i-vsc-over-carriages

[`docs/plans/vsc-migration-plan.md`](../../docs/plans/vsc-migration-plan.md) §5
asks for a witnessed exchange, with a VSC, run over DIDComm v1, DIDComm v2 and
the TSP envelope, with outcome evidence retained and verified — no existing
rung runs a witnessed exchange over any carriage at all. This rung answers
that for the two carriages it can, and documents precisely why the third is
deferred rather than faked.

```sh
npm install && node run.mjs        # verbose
npm run -s check                   # quiet pass/fail
```

No network. Two real `@credo-ts/node` 0.7.1 agents (this branch's patched
Credo-0.7 line — the same one `bifold/packages/core` builds against, referenced
here via `file:` links into `bifold/node_modules` rather than a fresh install,
so the same patches apply), real Askar wallets, real DIDComm v1 authcrypt,
real signing and verification throughout.

## What is real here

| Input | Source |
|---|---|
| `fixtures/captured-vrc.json` | A real captured VRC, extracted from `../ref-07-dtg-edge-semantics/fixtures/edge-witnessed-captured.json` |
| Message shapes (`witness/session/0.1`, `witness/session/submit/0.1`, their `#response`s) | The real type URIs from `@openvtc/trust-tasks`, matching `bifold/packages/core/src/modules/trust-tasks/witnessCeremony.ts` exactly |
| `digestMultibase`, `taskDigestMultibase`, `digestBytesEqual`, `signDocumentProof`, `verifyDocumentProof` | `@bifold/trust-tasks/build/documentProof.js` — the same platform-neutral primitives the wallet and witness-server both call, not reimplemented |
| `checkV2ThreadCorrelation`, `TrustTaskEnvelopeV2Message` | `@bifold/trust-tasks`'s real binding-0.2 implementation (deep imports — see Act 2) |
| Two Credo 0.7.1 agents, real Askar wallets, real DIDComm v1 connection (`did:peer:4`) | This rung, in-process transport |

**Authored by this rung:** the VSC itself. `buildWitnessCredentialJson`
(`bifold/packages/witness-server`) still emits the WD02 `WitnessCredential`
shape — V4 of the migration plan hasn't landed — so this rung builds the
`dtg:witnessed` VSC per plan §3's D1-D8 table by hand: `taskContext`/
`taskDigestMultibase` at the top level (D4), `credentialSubject.predicate`
(D2), `credentialSubject.object.digestMultibase` (D3). The predicate IRI used
(`https://registry.trustoverip.org/dtg/vsc/witnessed/1`) is the real namespace
`dtgwg-cred-spec#64`/`#65` record (opened this session, unmerged) — not
load-bearing to any check here, since this rung is about the exchange, not
which namespace wins.

## What it proves

**Act 1 — the witnessed exchange, over real DIDComm v1.** Two agents connect
with real v1 authcrypt (mutually authenticated `did:peer:4` DIDs). The full
ceremony runs — `witness/session` (unsigned, per its spec's
`isProofRequired: false`) → signed `#response` carrying the challenge →
signed `witness/session/submit` → signed `#response` delivering the VSC —
with every signed document verified through real Credo-backed
`verifyDocumentProof`, not asserted.

Against the **delivered** document (not one this rung assembled and checked
against itself):

- **D6** (plan §3, §3.2 — nothing in the codebase implements this today):
  `credentialSubject.id` equals the referenced VRC's real `issuer`, and
  `object.digestMultibase` reproduces over the real VRC via
  `digestBytesEqual`. A negative case (subject rewritten to a DID that is not
  the VRC's issuer) is caught.
- **Outcome-evidence pairing** (cred-spec, Outcome Interpretability),
  adapted for the VSC's top-level `taskContext`/`taskDigestMultibase`
  placement rather than WD02's `credentialSubject`-nested one (plan finding
  A5 — `outcomeEvidence.ts` and `witnessCeremony.ts` both still read the old
  location, a standing conformance gap independent of this migration): the
  initiating document's id equals `taskContext`, the digest reproduces over
  it, the terminal document threads correctly and carries a verified proof.
  A negative case (mismatched initiating document) is caught.

**Act 3 — the same delivered document, over DIDComm v2's thread-correlation
rule.** No live v2 connection — matching `didCommV2Carriage.test.ts`'s own
documented pattern ("the Credo agent is faked at the container boundary...
the message class itself is the real one"). A real `TrustTaskEnvelopeV2Message`
carries the Act 1 submit#response; the real, exported `checkV2ThreadCorrelation`
(binding 0.2 §3.1) runs over it. Proves the rule holds for a VSC-shaped
document specifically: it reads `document.threadId`/`document.parentThreadId`,
so moving `taskContext` to the top level (D4) never touched what this check
looks at — worth confirming rather than assuming, since D4 changes the
document these rules run against.

## What it does not prove — Act 2 (TSP), deferred

Not attempted, not faked. Two real findings from this session:

1. **`@openvtc/vti-tsp-js`'s `package.json` `exports` map defines only an
   `"import"` condition, no `"require"`.** `@bifold/trust-tasks`'s own
   compiled output is CommonJS. Reproduce:
   `cd node_modules/@bifold/trust-tasks && node -e "require('.')"` →
   `ERR_PACKAGE_PATH_NOT_EXPORTED`. This rung's Acts 1 and 3 work at all only
   because they deep-import `documentProof.js`/`v2Binding.js`/
   `TrustTaskEnvelopeV2Message.js` directly, never the package root — which
   is exactly why they can't reach the `tsp/` module a real TSP double-wrap
   needs.
2. **`tsp-reference/ref-16` through `ref-19` do not exist on disk.**
   `bifold/packages/core/src/modules/trust-tasks/module/DidCommV2Carriage.ts`'s
   own module comment cites `ref-16` ("measured on the snapshot... 16
   checks") and `ref-17` ("through a v2 mediator") as where this was proven.
   Checked this session (`ls tsp-reference/ref-1[6-9]*` — nothing; only
   `ref-20-local-vetting`, unrelated). There is no existing rung to build a
   live TSP-over-v1 transport from.

Building the TSP transport plumbing from nothing is its own task. Fixing (1)
is a real upstream packaging bug worth reporting regardless of whether
someone picks up (2).

**Also not proven:** hardware attestation or locality on real radios (stays
`e2e:vrc:devices` and the `ref-06p*` line, per the root `CLAUDE.md`'s standing
note that emulators cannot do attestation); both shipped proof suites
(`Ed25519Signature2018` and `eddsa-rdfc-2022`) — this rung signs with
whichever `signDocumentProof` produces by default (`DataIntegrityProof`/
`eddsa-jcs-2022`, the Trust Task document proof, not the VC proof suite); that
split is `ref-07h-vsc-credo-suites`'s job, not this rung's; a live Credo
`w3cCredentials.signCredential`/`verifyCredential` pass over the VSC itself,
as opposed to the Trust Task envelope documents that carry it — also
`ref-07h`'s job.
