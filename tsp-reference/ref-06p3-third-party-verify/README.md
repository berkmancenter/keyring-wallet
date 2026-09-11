# ref-06p3 — the §7.3 third-party verification algorithm

[`ref-06p`](../ref-06p-locality-binding/) proved the binding could be
constructed and that a forger could be caught *at the point the forgery was
made*. [`ref-06p2`](../ref-06p2-ble-observation/) proved the binding survives
a real radio. Neither one is the verifier's problem: a third party doesn't
build the bundle, it receives one, cold, with no shared state with whoever
made it. This rung is that verifier — the eight-step algorithm
[`docs/plans/locality-plan.md`](../../docs/plans/locality-plan.md) §7.3
describes, run against a genuine bundle and against seven independent
forgeries, one per mechanical step.

**16 checks.**

## The one idea

**A verifier holds exactly four things** (plan §3): the VWC, the retained
`witness/session` document, the retained `witness/session/submit#response`,
and — only if it chooses to pay the cost — the raw transcript. Steps 1–7 are
mechanical chains through those four artifacts: each one either confirms a
binding or it doesn't. Step 8 is judgment (is this witness trusted, is the
method tier enough, are the residuals acceptable) and the plan is explicit
that verification code should not pretend to make that call — so this rung
stops at emitting a verdict with a named failure step and a named residual
set, not a recommendation.

## What it proves

- **Steps 1–7, each independently forgeable and independently caught.**
  Building the forgeries turned out to be the actual work: cloning the
  genuine bundle and flipping one field usually tripped an *earlier* step
  than intended, because the artifacts are chained (the transcript's digest
  covers its own signature; the assertion's evidence commitment covers the
  transcript). `buildBundle()` derives every field EXCEPT the one under test
  from the given transcript, so a forgery is consistent right up to the one
  flaw — which is what makes the test "step 5 fails" instead of "step 4
  fails first because the input to step 5 was never valid to begin with."
- **The verdict names a step and a reason, never a bare boolean.** Every
  failure carries `{ pass: false, failedAtStep: N, reason: "..." }`; the
  genuine bundle carries `{ pass: true, residuals: [...] }`. A caller cannot
  get a plain `true`/`false` out of this without discarding information the
  function actually returns.
- **Step 6 is two different functions, not one, and the difference is the
  point.** The credential carries a PREDICATE
  (`localityKeyMatchesCredentialSigner`), not the device's key id (plan
  §7.1 rule 3, §9.1). By default this rung's verifier *trusts* that
  predicate — the same default show a verifier gets in practice. Passing
  `openArtifactSide: true` opens the retained transcript and checks the key
  ids directly. Forgery 6 demonstrates why both exist: a witness that lies
  about the predicate (asserts `true` when the answering key was a
  stranger's) sails through the trust-only path — **this is documented, not
  a bug** — and is only caught once the artifact side is opened, which the
  plan says costs the show's unlinkability. A verifier that always opens the
  artifact side has a different privacy posture than one that doesn't; this
  rung makes that an explicit parameter instead of an implicit assumption.
- **Step 7 is a shape check, honestly scoped.** Real App Attest / Play
  Integrity chain verification needs platform test credentials
  ([`ref-06p5`](../ref-06p5-attestation-binding/)'s job). What's checkable
  without that: the assertion cannot claim a *stronger* attestation state
  than the transcript it summarizes actually recorded. Forgery 7 is exactly
  that inflation — `localityHardwareAttestation: "verified"` in the
  credential over a transcript that only recorded `present-unverified`.
- **The verdict's residuals come from the method, never from the
  observation's own (non-normative) `residuals` field.** Plan §7.1 rule 6:
  a disclosable residuals member would let a holder reveal only the
  flattering half of a threat list. The genuine-bundle test proves this by
  changing the observation's carried `residuals` to `[]` and confirming the
  verdict still reports `["rf-relay"]` — derived from
  `localityMethod`, ignoring what was carried.
- **The three states of plan §7.1 rule 5 are pairwise distinguishable, from
  the verifier's side.** `confirmed` (steps 1–7 all run), `declined` (steps
  1–3 only — there is no transcript to check when the device never
  answered), and `not-offered` (no `locality*` member at all — nothing to
  verify because nothing was claimed) never collapse into each other. A
  declined claim is not exempt from document-level integrity either: a
  tampered proof on a `declined` bundle still fails at step 1, same as a
  confirmed one.

## What it does NOT prove

- **Step 8 — policy — is not implemented.** No "is this witness trusted",
  no minimum-tier check, no residual-acceptability decision. The plan says
  this is deliberate; this rung just emits what a policy layer would need.
- **DID resolution is a fixed lookup table**, not real resolution
  (`did:peer:4wendy` → a hardcoded key). Real `did:peer`/`did:webvh`
  resolution is Credo's and the framework's job, not this rung's.
- **Task-layer document proofs are `eddsa-jcs-2022`-shaped but not the real
  framework pipeline.** Like every rung in this corpus, this is a
  standalone crypto check (sign/verify over JCS bytes), not a run through
  `@openvtc/trust-tasks`'s `consumeInbound`/proof-policy machinery — that
  pipeline's proof verification is Phase D work in the OpenVTC plan, and
  every rung to date stubs it deliberately. What's real here is the actual
  Ed25519 signature math, which doesn't need the pipeline to be exercised.
- **No BBS+, no selective disclosure.** The assertion here is a plain JSON
  object; the disclosure-shape properties (flat, tiered) are ref-06p's
  territory, already proven there.
- **Only one method (`ble-challenge-response/0.1`) is exercised.** The
  residuals table (`RESIDUALS_BY_METHOD`) includes `nfc-kiosk/0.1` for
  completeness but nothing here builds an NFC-kiosk bundle.

## Fixtures

- `fixtures/genuine-bundle.json` — the one frozen fixture. A byte-identical
  genuine bundle is required on every run; the forgeries are generated at
  run time (each is a one-line deviation from `buildBundle()`'s defaults,
  so freezing them would freeze the deviation, not the mechanism).
