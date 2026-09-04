# ref-07-dtg-edge-semantics

Six checks against the DTG credential spec's edge-verifiability semantics, run
over **real Keyring credentials** — an independent second-implementation test of
the claims in Glenn's [conformance review](https://docs.fpp.storm.ws/dtg-conformance-infographic.html)
and cred-spec issues [#21](https://github.com/trustoverip/dtgwg-cred-spec/issues/21),
[#22](https://github.com/trustoverip/dtgwg-cred-spec/issues/22),
[#23](https://github.com/trustoverip/dtgwg-cred-spec/issues/23) — plus an audit
of our own witnessed artifacts against the same bar, and a cross-spec scope
divergence found against Trust Tasks framework 0.5.0.

```sh
npm install && node run.mjs
```

No network. Fixtures are frozen; the run is deterministic.

## The fixtures are real

- **`edge-pairwise-captured.json`** is an **actual Keyring edge**: minted by the
  real Credo-TS DIDComm exchange in `bifold/packages/vrc-reference`
  (`__tests__/integration/captureEdge.local-al.test.ts`, untracked local
  capture tool), both halves cryptographically verified at capture time by
  `agent.w3cCredentials.verifyCredential` — Keyring's own verifier — with the
  receipt frozen in `captureMeta`. Shape note: the wallet already emits VC 2.0
  context + `validFrom`, but signs with `Ed25519Signature2018` (JWS) rather
  than the `DataIntegrityProof`/`eddsa-jcs-2022` that #17 / PR #18 recommend —
  a divergence worth tracking in its own right.
- **The synthetic fixtures** (M-DID bootstrap, asymmetric, reused-pairwise —
  cases the wallet *cannot* produce, which is the point) carry **real Ed25519
  signatures**: `sign-fixtures.mjs` signs them with `eddsa-jcs-2022`
  (JCS per RFC 8785 + W3C vc-di-eddsa hashing, implemented in
  `lib/eddsa-jcs-2022.mjs`) over deterministic test keys, and **Check 0**
  verifies every proof at run time — including a tamper probe showing the
  verification can fail.

## Sources

All spec text is taken verbatim from the pinned clone
`external/dtgwg-cred-spec` @ **fc2276b** (2026-08-17):

- Glossary conditions a–d: `spec/terms-definitions/verifiable_relationship_credential.md`
- Body rules: `spec/body.md:197` (two VRCs = one edge), `:224` (R-DIDs RECOMMENDED),
  `:237` (unique R-DID MUST), `:274` (membership not a precondition), `:575-576`
  (Privacy Considerations 1–2)

The fixture shape is what the Keyring wallet emits —
`["VerifiableCredential", "DTGCredential", "RelationshipCredential"]` over
pairwise peer DIDs, self-issued halves
(`bifold/packages/core/src/modules/vrc/credentialTypes.ts`) — which is also the
shape of the spec's **own** §VRC example (`spec/body.md:209-222`), and the
captured fixture is that output literally (see above).

## What it proves

**Check 0.** The fixtures' proofs are real: every synthetic half's
`eddsa-jcs-2022` signature verifies in-run (and a tampered copy fails), and the
captured edge carries Credo's own verification receipt from capture time.

**Check A (#21, decisions D1–D4).** Two verifiers built from the same
document — one implementing the glossary's conditions a–d, one implementing the
body's rules — give **opposite answers on the same edge**. The construction the
body RECOMMENDS (pairwise R-DID edges) is the one the glossary rejects; the
spec's own §VRC example fails the spec's own glossary. Bonus finding: glossary
condition (b) ("both peers have signed the VRC") is unsatisfiable over the
normative single-`proof` schema for *any* credential — even the glossary's
favorite M-DID edge passes only after the verifier silently rewrites (b) as
"each half signed by its own issuer". A conforming verifier cannot exist
without choosing sides.

**Check B (#22, decisions D5–D6).** The same fixtures re-judged under the
declared-correlation-scope model (roles from credential types, scope from a
holder declaration): one rule set, one deterministic answer for every edge —
pairwise, community, and asymmetric alike. And the `MUST generate a new, unique
R-DID` prose becomes a *checkable property*: an identifier declared `pairwise`
but observed with two counterparties fails by definition, no normative sentence
required.

**Check D — the witnessed edge, and our own VWC held to the spec's bar.**
`edge-witnessed-captured.json` is the full 5-phase witnessed exchange (session
challenge, VP-wrapped VRCs, witness three-check verification, VWC minting and
DIDComm distribution) run by the reference implementation over real Credo
agents. The rung independently recomputes each VWC's digest over the witnessed
VRC (own JCS + SHA-256, **decoded-byte** comparison — the #1068 requirement)
and audits our artifacts the way Glenn audits VTI. Three self-findings:

1. **BUG (found here, now fixed) — the witnessed halves did not mutually name
   each other.** `Participant.createAndSubmitPresentation` minted the VRC under
   `getCurrentDID()` — the most recently accepted connection's R-DID, which in a
   witnessed exchange is the *witness* connection — though its own comment said
   it needed the counterparty-relationship DID. Alice's half was therefore
   issued under her witness-facing R-DID and the "witnessed edge" was not a
   complete edge per the body's own two-VRC rule. Fixed by resolving the issuing
   DID from the counterparty's R-DID (`Participant.getDIDForCounterparty`); the
   check above is now the regression guard. Two dead assertion blocks in
   `witnessedFlow.test.ts` were fixed alongside it (the VWC search read Credo
   0.6's private `record.credential` and looked for a `WitnessedCredential`
   type the witness never mints, and the offers were never accepted, so the
   whole VWC validation was unreachable).
2. **Legacy digest form (known, planned).** The VWC's `credentialSubject.digest`
   is `"sha256:"+hex` — in vrc-reference *and* in witness-server's
   `computeVrcDigest` — not the multibase multihash of #17 / PR #18. This is
   precisely PR #18's `digestMultibase` rename, already specified as
   encoding-only; the rung demonstrates that claim (identical bytes,
   `z`+base58btc multihash envelope). Note the task layer is already correct:
   witness-server's session responses carry a proper `vwcDigestMultibase`.
3. **`taskContext` parity drift.** The vrc-reference (legacy demo) VWC carries
   only `witnessContext` — but the witness-server trust-tasks path ALREADY
   implements Trust Task Context Binding (`taskContext` = session document id,
   plus `taskDigestMultibase`, per §4.9.1/§4.9.3 —
   `witness-server/src/trustTasks/WitnessTaskSessions.ts:260`). So Keyring is
   NOT in the VTI #1065 state; the legacy demo path lags the real one.

**Check E — one identifier, two scope vocabularies (cross-spec).** Trust Tasks
framework **0.5.0** (`trustoverip/dtgwg-trust-tasks-spec` @ `6425a741`,
`spec/body.md:795`, merged 2026-08-26) shipped a declared identifier-scope axis
of its own — `identifierScope: pairwise | public | any` — while cred-spec #22
proposes four values. This check maps one onto the other: `pairwise` and
`public` correspond, and **`community` and `linked` have no faithful target** —
they are not `pairwise` (more than one counterparty may recognise the
identifier), not `public` (the set is bounded), and `any` declares no position
at all. The framework's fail-safe reading (`body.md:797`: absent or
unresolvable is read as "no less correlatable than `public`") makes the gap
load-bearing rather than cosmetic: a bounded-scope identifier ends up reasoned
about as unbounded, overstating disclosure in the privacy-relevant direction.

This is not hypothetical for Keyring — a witnessed exchange carries pairwise
VRC halves (cred-spec vocabulary) inside witness-session Trust Task documents
(framework vocabulary), so one identifier is described twice, in one flow, by
two specifications with no defined mapping between them. Scope vocabulary
spanning both specs is the shape of thing the proposed cross-cutting VTI spec
exists to own.

**Check C (#23, decision D9).** The four-type taxonomy cannot name an edge
whose halves differ (one attributed/public, one pairwise) — "is it an R-DID
edge or an M-DID edge?" has no answer because the question assumes both halves
are the same kind. Declared scope names each half independently, and the rule
missing from the spec is computable: **effective disclosure = the wider of the
two halves** (the pairwise half's own declaration is honoured, but the edge's
privacy is not its own to declare).

## What it does NOT prove

- **The captured edge's `Ed25519Signature2018` proofs are not re-verified in
  this rung** — verifying that suite requires JSON-LD RDF canonicalization and
  the contexts, which is exactly the stack Credo runs; it verified both halves
  at capture and the receipt is frozen. Re-run the capture tool to regenerate
  from scratch.
- **Not that the WG will adopt #22.** The scope terms were adopted 2026-08-25
  as a two-way-door trial; this rung is evidence for that trial, not a ratified
  outcome.
- **Nothing about the ZKP linkages (#9).** Whether a holder can prove
  co-control of a pairwise and a membership identifier in zero knowledge is
  circuit work owned by the ZKP task force; this rung takes no position.
- **Nothing about #8 (VMC bidirectionality), #24 (cross-VTN), or #25 (policy
  discovery).** #24's verifier-relative definition and #25's commit-before-
  reveal handshake could become follow-on checks once a mechanism is proposed.
- **Not a claim about Glenn's implementation.** The VTI issues
  (#1054/#1065/#1068/#1079) are his codebase's; only the spec text is tested
  here.

## Status

Local analysis rung — **not yet referenced in any issue thread or shared
externally.** Findings are for internal review first (2026-08-26).

Spec versions this rung reads: cred-spec `fc2276b` (pinned clone) and Trust
Tasks framework `0.5.0` @ `6425a741`. Both move fast; re-check the citations
before quoting them anywhere.
