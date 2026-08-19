# Cryptosuite record: Data Integrity

> **Status:** SHIPPED — the DIDComm Data Integrity layer landed 2026-07-17
> (`1992195`, part of the consolidated upgrade PR #17): capability-gated DI
> issuance (RCE v3), dual-verify, witness proof-family mirroring.
> This doc previously recorded the pre-upgrade decision to *defer* DI; it now
> records what shipped and the decisions that shaped it (code comments cite
> them by number — e.g. the `@credo-ts/didcomm` patch cites Decision 5 Option B).
>
> **⚠ Decisions 3, 6 and 7 are superseded as of 2026-08-18.** The table below
> describes what **ships today**; [Superseding decisions](#superseding-decisions-2026-08-18)
> describes what we are moving to and why — a `eddsa-jcs-2022` + `bbs-2023`
> proof set, with the legacy suites and the version negotiation dropped. Read
> both before treating any cryptosuite statement here as current guidance.
> Last updated: 2026-08-18.

---

## What we ship today

| Layer | Choice |
|-------|--------|
| VRC / RCard **data model** | VCDM **2.0** (`@context` credentials/v2, `validFrom` / `validUntil`) when counterparty RCE ≥ 2; VCDM 1.1 for legacy peers |
| DIDComm JSON-LD **proof** | **`DataIntegrityProof` + `cryptosuite: eddsa-rdfc-2022`** when counterparty RCE ≥ 3; **`Ed25519Signature2018`** otherwise |
| Verification | **Dual-verify, no sunset** — 2018 and DI both accepted indefinitely (stored 2018 credentials make that verify path effectively permanent) |
| Witness issuance | Mirrors the presented VRC's proof family (`getMirroredJsonLdProofOptions`, `@bifold/vrc-shared`) — DI for DI-signed VRCs, legacy 2018 shape otherwise |
| Hardware attestation | Separate W3C **evidence** block (P-256 in SE/TEE) — orthogonal to the VC proof suite; see `HARDWARE_ATTESTATION_FLOW.md` |

---

## Decision record (resolved 2026-07-14)

Plan-review decisions made before implementation. Kept here because code and
patch comments reference them by number.

| # | Decision | Choice |
|---|----------|--------|
| 1 | Upstream dependency | Pure patch path — do not wait for credo-ts#2797; track it only so our patch doesn't collide later |
| 2 | Where the work lands | Own branch stacked on the upgrade branches, merged via the consolidated upgrade PR |
| 3 | Cryptosuite | `eddsa-rdfc-2022` (`jcs` variant considered and rejected) — matches Keyring's DTG spec feedback §3; graph canonicalization already runs on-device |
| 4 | Libraries | `@digitalcredentials` forks (cryptosuite 1.3.0, data-integrity 2.6.0); `rdf-canonize@5` forced via resolution |
| 5 | DIDComm options shape | **Option B** — extend the jsonld credential-detail options with `cryptosuite`; match `proof.type` **+** `proof.cryptosuite` when present, `type`-only when absent (2018 path untouched) |
| 6 | Negotiation | `RCE_PROTOCOL_VERSION = 3` + `counterpartySpeaksDi()` (≥ 3); DI implies VC 2.0, so the version ladder holds |
| 7 | Verify policy | Dual-verify indefinitely, no sunset; no re-signing of stored 2018 credentials; silently accept 2018 proofs from DI-capable peers (same Ed25519 keys — no security delta, no downgrade rejection) |
| 8 | Test gates | Leveled conformance with external vc-di-eddsa test vectors at the base; the peer-matrix cell "DI issuer ↔ pre-v3 holder" must never occur (v3 gate), not merely fail gracefully |
| 9 | Maintenance | Yarn patches are permanent carrying cost; credo-ts frozen at 0.6.3 (0.7 only on demonstrated need); opportunistic upstreaming to credo-ts#2797, never blocking |

---

## Where the selection is coded

- `@bifold/vrc-shared` — `getVrcJsonLdProofOptions` / `getMirroredJsonLdProofOptions`:
  the single proof-family selection path, used by both the app
  (`bifold/packages/core/src/modules/vrc/vrc-manager.ts`) and the witness
  (`bifold/packages/witness-server/src/WitnessService.ts`).
- `vrc-manager.ts` — `counterpartySpeaksVc20` / `counterpartySpeaksDi` gate on
  the per-counterparty `rceVersion` stored from the relationship-DID handshake.
- `.yarn/patches/@credo-ts-didcomm-npm-0.6.3-*.patch` — Decision 5 Option B:
  `cryptosuite` added to the jsonld detail options + received-proof matching.
- `.yarn/patches/@credo-ts-core-npm-0.6.3-*.patch` — VCDM 2.0 shim + DI
  cryptosuite matching in the W3C credential service.

---

## Superseding decisions (2026-08-18)

*Decisions 1–9 above are left exactly as written on 2026-07-14. They are a
correct record of what we decided and why, and the code and patches cite them by
number. What follows supersedes some of them; nothing above is edited.*

**The trigger:** selective disclosure and ZKP presentation moved from "same
family, separate scope" to a requirement. DTG Core Credentials — which we edit —
says implementations SHOULD make ZKP presentation the default, and
[cred-spec #18](https://github.com/trustoverip/dtgwg-cred-spec/pull/18) (ours,
open) settles the securing mechanism for DTG credentials. Decision 3 was taken
before either was true.

| # | Decision | Choice | Supersedes |
|---|---|---|---|
| 10 | Credential securing | **A proof set**: `eddsa-jcs-2022` (offline path) **+** `bbs-2023` (selective-disclosure base), per cred-spec #18 | **3** |
| 11 | Legacy suites | **Dropped.** No `Ed25519Signature2018` issuance or verification, no `eddsa-rdfc-2022` issuance | **3, 7** |
| 12 | Negotiation | **Removed.** No `counterpartySpeaksDi()` ladder, no mixed-fleet branch; `rceVersion: 4` is a floor, not a branch | **6, 7** |
| 13 | Vocabulary | JSON-LD terms for every issued member, enforced by a **CI guard**, not by discipline | new |

### Why a proof set rather than one suite

Each suite answers a question the other cannot.

- **`eddsa-jcs-2022`** canonicalizes the JSON, so verification needs no
  `@context` resolution and a credential formed in person verifies offline —
  cred-spec #18's own words, "including credentials formed in person and
  synchronized later", which is the witnessed exchange described from outside.
  It also shares its canonicalization with `digestMultibase`, so a digest and a
  proof over one credential cannot disagree about that credential's canonical
  form.
- **`bbs-2023`** is the only path to member-level selective disclosure and
  unlinkable presentation, and an `eddsa-jcs-2022` proof cannot yield a
  derivation base. It is **RDF-canonicalized**, which is why RDF does not leave
  the codebase.

The cost of the pair, stated plainly: two proofs per credential, two key types
per issuer (Decision 13's BLS requirement), and the `@context` term discipline
stays load-bearing for the `bbs-2023` half. We accept all three because the
alternative is choosing between offline verification and privacy, and both are
requirements.

### Why the legacy suites go, and why that is not the same question

"Keep RDF for `bbs-2023`" and "keep `Ed25519Signature2018` and
`eddsa-rdfc-2022`" are different decisions and were being confused.

Decision 7 kept dual-verify forever on the reasoning that *"stored 2018
credentials make that verify path effectively permanent"*. That premise is false
for this credential type: **`DEFAULT_CREDENTIAL_EXPIRATION_DAYS = 7`** in both
`vrc-manager.ts` and `WitnessService.ts`, so every VRC and VWC self-clears a week
after issuance stops. Add that we are pre-production, and the population that
dual-verify protects does not exist and would not persist if it did.

Decision 12 follows from the same fact: `counterpartySpeaksDi()`, the
`rceVersion` ladder and the "DI issuer ↔ pre-v3 holder must never occur" gate all
exist to serve a mixed fleet. There is no fleet. Dropping the suites while
keeping the negotiation would preserve the complexity and lose the compatibility
it buys.

### Decision 13, and why it is a CI guard rather than a rule

Under any RDF-canonicalized suite, a credential member whose term is undefined in
the `@context` **is not covered by the proof** — and, worse for us, cannot be
selectively disclosed, because a derived proof discloses from the dataset and the
member never entered it. Both failure modes are measured in
[`tsp-reference/ref-06p-locality-binding`](../tsp-reference/ref-06p-locality-binding/)
act 6: JSON-LD safe mode (which the signing path uses) refuses to canonicalize at
all, and with safe mode off the members drop to **zero quads** while remaining
visible in the JSON.

We have already failed this discipline once, silently:
`witnessedExchangeContext.ts` defines `localityVerification` but none of the
members nested inside it, latent only because the sole locality provider is a
null one. A credential family designed to be extended cannot rely on everyone
remembering, so the guard — expand every issued credential shape against the real
context, fail on any dropped term — is part of the decision rather than a
follow-up to it.

*The extensibility argument was [raised on cred-spec #18](https://github.com/trustoverip/dtgwg-cred-spec/pull/18#issuecomment-5336345589) —
offered as a comment supporting the recommendation the PR already makes, with a
suggested Security Considerations paragraph the editors can take or drop.*

### What is not decided

- **BBS+ tooling is unsurveyed** — what exists in the `@digitalbazaar` /
  `@digitalcredentials` families, whether it composes with our Data Integrity
  path, and whether **BLS12-381 runs on Hermes** (the same class of problem the
  noble HPKE work solved for TSP). Deferred deliberately: the credential's
  *member layout* is the part that cannot be retrofitted, and a second proof is
  additive, so issuing `eddsa-jcs-2022` alone against the final layout is a valid
  first step. **Check before selective-disclosure presentation, not before the
  rest.**
- **The issuer's BLS key** — every DTG credential issuer needs one alongside
  Ed25519: the witness server, and the wallet, since VRCs are wallet-issued. A
  DID adds a key rather than rotating one, so it is a DID-document change to
  design, not a migration.
- **`ecdsa-sd-2023`** remains unaddressed; #18 names `bbs-2023` only.

### Sequencing

1. Fix the member layout of anything we issue **now** — flat, no nested objects,
   predicates rather than identifiers, disclosure-tiered. This is the
   non-additive part. See [`docs/plans/locality-plan.md`](./plans/locality-plan.md) §7.1
   for the worked example.
2. Author the terms and land the CI guard (Decision 13).
3. Switch issuance to `eddsa-jcs-2022`, drop the legacy suites and the
   negotiation (Decisions 10–12).
4. Add the `bbs-2023` proof and selective-disclosure presentation when the
   tooling question is answered.

Steps 1 and 2 are worth doing even if step 4 slipped indefinitely; step 4 is
worth nothing if step 1 was skipped.

## Still open (same family, separate scope)

- `ecdsa-sd-2023` — unaddressed; #18 names `bbs-2023` only. (Selective
  disclosure itself is no longer "still open": it is Decision 10.)
- Upstreaming the VCDM 2.0 shim / `cryptosuite` options shape to credo-ts,
  to reduce the permanent patch-carrying cost (Decision 9).
- Do **not** remove 2018 verification while any stored or peer-issued 2018
  credential can still surface — i.e., plan on never.
