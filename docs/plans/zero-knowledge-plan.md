# Zero-knowledge in Keyring — where the proofs live, and what the wallet does about them

**Status:** Proposed. No code written. Execution starts only on instruction; until then this plan tracks upstream and keeps its dependencies current.
**Reasoning:** [`2026-09-22-al.md`](./zero-knowledge-plan/2026-09-22-al.md) — the research behind §2–§4: the positions it supersedes (on-device proving), the evidence for each, and what was not verifiable.
**Siblings consulted:** [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §4.6 owns the credential-format decisions this plan inherits (VRC/VWC proof sets, evidence commitments, canonical transcript); [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) owns the VTA client architecture, consent card and approvals this plan's step-up rides on; [`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) owns the V0 vetting ceremony that hidden vetting keeps unchanged, and its §2.4 decision gates Track Z1; [`vsc-migration-plan.md`](./vsc-migration-plan.md) owns the witness-credential type Track Z2 would present; [`ui-ux-improvements-plan.md`](./ui-ux-improvements-plan.md) owns the vetting screens Track Z1 changes.
**Dependency direction:** nothing in the sibling plans waits on this one. This plan waits on upstream (§8) and on two sibling decisions (§3.3, §3.4).
**Baseline (read 2026-09-22):** our pins — VTI **187ad9cd** (vta-sdk 0.25.0), `vta-browser-plugin` **89d70c4** (advance to **9643c57** in flight on `chore/pin-vta-browser-plugin-9643c57`); `OpenVTC/openvtc` clone **177a218** (not in `PINS.json`). Upstream heads the design review was written against, both **descendants** of our pins — VTI **6f26af19** (vta-sdk 0.48.0) and openvtc **63d1fa1**. Re-checked 2026-09-22 against openvtc **b7c18ea** and VTI **4c440df3** (vta-sdk 0.49.0): no PCS or hidden-vetting code upstream yet, and `vetting-process.md` still lists it as V2. `trustoverip/dtgwg-zkp-tf` **a42bf8c0**, `mitchuski/dtgwg-zkp-mage` **1be94c80**, `affinidi/affinidi-zkp-crypto-rs` **c23a4b71** (public, not cloned). `predicate-credential-system` **not reachable** from this repo (§8 B1). The running stacks are not on the reference pins: the local lab runs VTI **a96fe02f**, with a bump to **3dcbfe98** queued; Farm VTAs run vta **0.37.1** (`d9a5be02`). ZK0 reconciles all three.

**References:**

- **[[HIDDEN-VETTER]]** — *Hidden-vetter admission with PCS*, OpenVTC vetted-admission V2 design review, second pass, 2026-09-22, shared with the team (not vendored). Reviewed against `predicate-credential-system@aa57efd`, `openvtc@63d1fa1`, VTI `6f26af19`, `dtgwg-vti-spec@75391a2`. Its source, `design-docs/vetting-hidden-vetters-pcs.md` §1–§13, is not public.
- **[[VETTING-DESIGN]]** — `docs/design/vetting-process.md` in `OpenVTC/openvtc` (DRAFT v3): §1 non-goals, §10.5 accountability, §14.2 V2 scope, D7/D14/D19.
- **[[VTI-CRED-ARCH]]** — `docs/05-design-notes/vti-credential-architecture.md` in VTI, present at our pin `187ad9cd`: D4 and §4, proof formats.
- **[[AGENT-STATE]]** — *The Agent Is the State: UIs That Keep Nothing*, `ic3.software/blog/the-agent-is-the-state`.
- **[[ZKP-TF]]** — `trustoverip/dtgwg-zkp-tf` (DTG ZKP V1.0, working draft targeted at IIW #43, Nov 2026) and its evidence lab `mitchuski/dtgwg-zkp-mage`.
- **[[CONSENT-VIEW]]** — `packages/core/src/persona/consent-view.ts` in `vta-browser-plugin` at `9643c57` (not at `89d70c4`): how upstream's own client renders a predicate claim.
- **`tsp-reference/ref-03d-bls12-381-hermes`** — BLS12-381 measured on the app's Hermes.

---

## 1. What this plan is for

Three things upstream is building need a zero-knowledge proof, and each one reaches a Keyring user:

1. **Hidden-vetter admission.** An applicant proves that *k* distinct, currently eligible vetters vouched for them, and nobody (the community included) learns which vetters.
2. **Private presentation of the credentials Keyring mints**: VRCs, witness credentials and memberships, shown without disclosing R-DIDs or unrelated claims. DTG Core Credentials asks for this by default (§5 C6).
3. **Predicate facts**: "is a unique person in this context" or "holds a valid attestation of liveness", shown without disclosing the credential behind them.

This plan answers the three questions the workstream opens with: how the technology works (§2), where it runs (§3.1), and what Keyring owes as a client (§3.2 and §4). It then gives phases with acceptance criteria (§6). The phases wait for an instruction to start.

**This is not a plan to implement cryptography in the wallet.** The central position (§3.1) is that Keyring runs no prover, holds no ZK secret and verifies no proof. Everything this plan asks of Keyring is consent, rendering and carriage.

## 2. The technology

### 2.1 What a zero-knowledge proof is

A zero-knowledge proof lets a *prover* convince a *verifier* that a statement is true without revealing anything beyond the fact that it is true. Three properties define one:

- **Completeness:** an honest prover with a true statement always convinces.
- **Soundness:** a prover with a false statement cannot convince, except with negligible probability.
- **Zero knowledge:** the verifier learns nothing it could not have produced itself. The transcript could be simulated without the secret.

Everything in our ecosystem is **non-interactive**. The verifier's random challenge is replaced by a hash of the transcript (the *Fiat–Shamir transform*), so a proof is a single message that can be carried in a Trust Task document. That hash input is the proof's **context**, and binding it correctly is where real systems fail. The DTG ZKP task force's canonical-transcript rule ("a bare nonce is insufficient", a failing test in `runtimes/canonical`) is about exactly this. So is the one library change hidden vetting needs, caller-provided Fiat–Shamir contexts (§8 B1).

### 2.2 The three constructions our ecosystem uses

| | BBS signatures (`bbs-2023`) | PCS: predicate credentials (Σ-protocols) | Circuit SNARKs (Groth16) |
|---|---|---|---|
| **Proves** | "An issuer signed a credential containing these claims," revealing only the chosen claims; two shows are unlinkable | "k pairwise-distinct credentialed users attested to this identifier," and nobody learns which | Any statement expressible as a circuit: "signature valid ∧ predicate true ∧ nullifier = H(secret, context)" |
| **Math** | Pairing-based signature over BLS12-381; the holder derives a proof of knowledge of the signature | Σ-protocols made non-interactive by Fiat–Shamir, over BLS12-381 (DDH-hard); pseudorandom *tags* stand in for identities; blind issuance | R1CS circuit (circom), BN254 curve, Poseidon hashing; constant-size proof |
| **Cost** | Proof derivation is a public operation on the issuer's signature; the holder needs **no** BLS key ([[VTI-CRED-ARCH]] §4) | ≈12 ms to prove and ≈12 ms to verify at k = 5 on Apple Silicon; 1 392 B proof ([[HIDDEN-VETTER]]) | ≈680 ms to prove, 721 B proof, on the lab's 11 523-constraint circuit ([[ZKP-TF]] lab) |
| **Setup** | None | None beyond the issuer's ("helper's") keys | A **per-circuit trusted-setup ceremony**; the lab's is lab-only |
| **Upstream status** | Adopted, not built: `affinidi-bbs` over `bls12_381_plus` and `bbs_2023` in the TDK, gated on an independent audit ([[VTI-CRED-ARCH]] D4) | Working prototype, 14 end-to-end tests; library change ready to offer upstream; seven specs unwritten ([[HIDDEN-VETTER]]) | A `CredentialFormat::Zkp` variant exists; "the Circom circuit + Groth16 prover/verifier (server-side VTA proving) live outside it and are deferred" ([[VTI-CRED-ARCH]] §4) |
| **Our track** | Z2 | Z1 | Z3 |

### 2.3 The building blocks, in the words the specs use

- **Pairing / BLS12-381.** A bilinear map e(aP, bQ) = e(P, Q)^{ab} on a pairing-friendly curve. It lets you check relationships between hidden exponents, which is what BBS and PCS both rely on. Phone secure elements do **not** support this curve: the Secure Enclave is P-256 only, and StrongBox is P-256, RSA and (API 33+) Ed25519. This is a hardware fact, and it matters for §3.1.
- **Tag / nullifier.** A deterministic, pseudorandom value derived from a secret and a context. The same secret in the same context always gives the same tag, which is how distinctness is counted and double-use is caught. A different context gives an unlinkable tag. PCS calls these tags; the DTG task force calls them scoped nullifiers.
- **Blind signature.** The signer signs a value it cannot see and cannot later recognise. PCS uses it to issue vetter credentials and rate-limit tokens without the community learning which token belongs to whom.
- **Helper.** PCS's name for the issuer of credentials and tokens, and the verifier of proofs. In our ecosystem that is **the VTC**. The VTA is never called a helper; it is the PCS *engine* ([[HIDDEN-VETTER]], "Terminology").

### 2.4 What a zero-knowledge proof does not give

- **Privacy, not assurance.** The ZKP task force states the boundary: *"The cryptography carries the privacy. The accreditation framework carries the assurance."* A proof shows that a valid attestation is held, not that the determination behind it was correct.
- **Distinctness, not independence.** PCS proves the vetters are distinct. Whether they are *independent* still comes from declared relationships. The VTI spec forbids upgrading one into the other (VTI-CMP-070/071, [[HIDDEN-VETTER]] F9).
- **Computational anonymity only.** Anonymity under PCS rests on DDH over BLS12-381, which a quantum attacker breaks. An attacker who collects records today can later link one vetter's attestations. They can name the vetter only through the root-request identifier, which the VTC must delete after issuance ([[HIDDEN-VETTER]] F10).
- **Nothing about metadata outside the proof.** Timing, token-fetch patterns, mediator routing and small anonymity sets all leak around a perfect proof. [[HIDDEN-VETTER]]'s "Leaks outside the proof" table is the checklist, and several rows are client behaviour (§4.1).

## 3. Positions

### 3.1 Proofs are made in the VTA and checked by the VTC; Keyring holds no ZK secret and runs no prover

This is the answer to "device or VTA?". It is the ecosystem's stated design, not a preference of ours:

- **Hidden vetting:** *"The VTA is the PCS engine. Every member-side PCS operation is a VTA Trust Task (`vta/pcs/attest`, `prove`, `verify-attestation`, `tokens/fetch`, `withdraw`, `root-request`), the PCS secret `usk` is a new VTA key kind (a BLS12-381 scalar) beside the persona keys, and openvtc is the UI and message carrier only. The VTC is the PCS helper"* ([[HIDDEN-VETTER]], "Where the cryptography runs").
- **Credential formats:** the holder's VTA is *"store + wallet + signer"*, and the Groth16 path is *"server-side VTA proving"* ([[VTI-CRED-ARCH]] preamble and §4). The VTA's `credential-exchange/present` already assembles `Bbs2023` presentations from its vault (`vta-service/src/operations/credential_exchange.rs` at `187ad9cd`).
- **Client architecture:** *"Do not build a second copy of anything the agent already is"* ([[AGENT-STATE]]).

Three facts specific to a phone make this the right answer for Keyring too, not just for openvtc:

1. **There is no hardware-custody gain to lose.** Every ZK secret in play (the PCS `usk`, a BBS link secret, a Groth16 witness) is a BLS12-381 or BN254 scalar, and neither phone secure element supports those curves (§2.3). A device-held ZK secret would be a software key either way. Keyring's hardware story continues where it actually applies: the Secure Enclave or StrongBox signature on the *approval* (§3.2).
2. **Hidden vetting needs an always-on agent.** Tokens arrive on an unconditional drip that must be fetched every tick, at a random moment, even when unused. Otherwise the fetch pattern is the activity signal the design exists to hide ([[HIDDEN-VETTER]], "Tokens on a constant drip"; "missed ticks caught up by the always-on VTA"). A mobile OS suspends and kills apps as routine.
3. **Anonymity does not survive two copies.** A vetter's attestations stored on the phone *and* in the VTA are two places to leak tags from, and two sources of truth for which tokens are reserved.

**Rejected: proving on the device.** It is feasible. BLS12-381 runs on the app's Hermes and gives byte-identical output to Node, at about 15× Node's cost (a pairing is 96.7 ms, a BLS verify 146 ms; `ref-03d`), and the DTG lab's Groth16 prover runs in about 680 ms. It is still ruled out by points 1–3: it gains no custody, cannot meet the drip, and creates a second copy of the agent. `ref-03d` remains the measurement to cite if an offline-only use case ever forces the question. No such case is in scope (§3.4).

### 3.2 What Keyring does

Four duties, none of them cryptographic beyond the signature Keyring already makes:

1. **Gate the consequential operation with a hardware-attested step-up.** An attestation is *"the most consequential signature a member ever makes, so step-up through the mobile authorizer belongs on it"* ([[HIDDEN-VETTER]]). [[VETTING-DESIGN]]'s target for signing a statement is *"step-up always (passkey / device)"*. Keyring approves `vta/pcs/attest` through the approvals path ([`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) P3) with a Secure Enclave or StrongBox signature and its attestation evidence. This is where Keyring is ahead of the reference clients, and it is Z1's one contribution beyond UI.
2. **Render what the VTA says, as data.** Proof requests, disclosure previews, checklists and outcomes are the VTA's replies, rendered. A predicate claim is shown as the strongest outcome on the screen, not as a missing value ([[CONSENT-VIEW]]: *"A predicate claim discloses no value at all — that is the whole point"*). The preview comes from the code that will act ([`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) §3.9).
3. **Carry the ceremony.** The V0 vetting ceremony (ticket, request, session, signed Vetting Card, match code, human check) is unchanged in hidden mode. Only the artifact returned and what the VTC verifies change ([[HIDDEN-VETTER]], "The ceremony is untouched").
4. **Keep no ZK state.** No `usk`, token, attestation, tag, serial or proof is persisted on the phone, and none is cached for display. The boundary [`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) §2.6 draws ("no local mirror of state a counterparty owns") covers all of it, because the VTA owns it. Idempotence ledger entries for in-flight tasks are the one exception, and they are ids, not ZK material.

### 3.3 Track Z1 rests on option B of the vetting subtask's §2.4

Option B (Keyring drives its own VTA, the persona is the member, the VTA signs) was decided by Alberto on 2026-09-18. [`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) §2.4 on `origin/main` still reads **Open**, and that document needs updating by its owner; this is not a re-decision. Hidden vetting puts the PCS engine in the member's VTA, so it exists for a Keyring user only if a VTA is the member ([`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) §2.4, option B). Under option A (the phone is the agent) the phone would have to carry the PCS engine, the key kind and the drip. That is exactly what §3.1 rules out, so **this plan designs no A path**. Under A, hidden-mode communities are closed to Keyring members, and the UI says so rather than degrading silently. Were B ever reversed, Z1 would be void, not redesigned.

### 3.4 Keyring's own credentials meet zero knowledge in the VTA, after the in-person exchange

*Conditional design; open decision D2 (§8).* The in-person VRC exchange has no VTA in its path, and it stays device-signed `eddsa-jcs-2022` so that a credential formed in person verifies with no `@context` resolution ([`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §4.5). The selective-disclosure and ZK half (`bbs-2023` in a proof set, §4.6 decision 1; the DTG pairwise and community-anchored ZKP constructions) is produced **later, online, by the VTA**, from a copy the phone deposits into the VTA's credential vault (`vault/credentials/receive`, [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) step 1).

This keeps §3.1 and resolves the tension with the vetting subtask's §2.6 without breaking either: the phone is authoritative for what it minted, and the VTA holds a deposited copy to prove from. That is a hand-off, not a mirror of counterparty state. Two facts make it conditional rather than settled:

- **Who holds the BBS issuer key.** A `bbs-2023` base proof needs a BLS12-381 G2 assertion key on the *issuer's* DID, and *"only durable `did:webvh` issuers mint BBS credentials"* ([[VTI-CRED-ARCH]] §4). A VRC's issuer side is the R-DID. Whether an R-DID can carry that key, or the BBS half is issued under a VTA-held `did:webvh`, changes what a verifier must resolve. This is not yet measured.
- **Whether a second proof can be added to a proof set after issuance** without the verifier treating it as a different credential. §4.6 assumes *"a second proof can be added later"*. Z2's first rung checks that against the cred-spec text before anything relies on it.

### 3.5 Hidden mode needs the VTA operator and mediator operator to differ from the VTC operator

*"Hidden mode requires that the vetter's VTA is not operated by the VTC operator, the same rule the design already sets for the mediator"* ([[HIDDEN-VETTER]]). The vetter's own VTA can compute every tag its user produces. That is accepted trust, the same trust already placed in it for persona keys. Two consequences for sibling plans:

- **The Farm.** [`keyring-on-the-vta-farm.md`](./keyring-on-the-vta-farm.md) targets a Farm-hosted VTA. If one operator hosts both a member's VTA and the community's VTC, hidden mode is void for that member, and Keyring should warn rather than let the vetter believe they are anonymous. Keyring cannot detect operator identity by itself, so this needs a manifest or Farm signal (§8 B5).
  Today the Farm hosts VTAs and the mediator, and the first community VTC runs on a separate operator's stack, so the rule currently holds there.
- **The local stack.** Our development stack runs VTA, VTC and mediator on one host under one operator. That is fine for testing mechanics. No demonstration on it may describe vetters as anonymous from the community.

## 4. Tracks

### 4.1 Z1 — Hidden-vetter admission (PCS), upstream-led

Upstream's order of work is: prototype (done) → library context change → `vta-sdk` `vetting-pcs` → seven specs → `vtc-service` → `vta-service` → client UI and E2E ([[HIDDEN-VETTER]], "Order of work"). Keyring's slice is the last step, plus the step-up of §3.2. What changes on Keyring's screens, as the vetter and as the applicant:

| Surface | Hidden-mode behaviour | Why (leak it closes) |
|---|---|---|
| Accepting a vetting request | The VTA reserves a token on accept. If none is free, decline with `atCapacity { availableFrom }` | No one sits through a session to find the vetter cannot attest |
| Vetter availability | **No "accepting requests" toggle** in hidden mode. Decline individually | The toggle is the busy-vetter signal hidden mode removes |
| Personal vetting limit | A local preference passed to the VTA. The full drip is still fetched | The preference never shows to the VTC |
| Attest | Hardware-attested step-up approval of `vta/pcs/attest` | D19's target gate (§3.2) |
| Applicant checklist | Rendered from the VTA's stored, verified attestations (`verify_att` and the token check run on receipt, F7) | "No token" surfaces at the session, not at submit |
| Anonymity set | Warn when the manifest's bucketed live-vetter count is below 2k (the review's floor) | Small anonymity sets name vetters |
| Submit timing | The app may delay submit after the last session; day-granular validity is the VTA's | Timing correlation |
| Withdrawal | The VTA sends from a fresh `did:key`; the UI never routes it through the member or session DID (F8) | The mediator would otherwise see the sender |
| Mixed criteria | A criterion is `mode: named` or `mode: hidden`, never both (F4). The UI shows which mode the community uses | One person could count twice |

Keyring as vetter is new scope. The vetting subtask makes Keyring the *applicant* (its P6) and tests against a headless openvtc vetter (its §2.5). Z1 needs both roles in Keyring, and both roles re-run against upstream's own clients.

### 4.2 Z2 — Private presentation of Keyring's credentials

This is the DTG pairwise construction ("disclose persona DIDs while hiding the R-DIDs"), the community-anchored construction, and `bbs-2023` selective disclosure, over VRCs, witness credentials (VSCs after [`vsc-migration-plan.md`](./vsc-migration-plan.md)) and memberships. Proving runs in the VTA (§3.1) from deposited copies (§3.4), presentation goes through `credential-exchange/present`, and consent works as in §3.2.

Two standing constraints are inherited and not re-decided here. Edge-binding verification and selective disclosure are mutually exclusive in one presentation, and edge-binding is what we keep ([`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) §4.6 item 3). Presenting outcome evidence forfeits unlinkability for that show ([`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §4.6). The ZK constructions themselves are the ZKP task force's deliverable (DTG ZKP V1.0), so Z2 consumes them and does not design them.

Four more inherited constraints decide what a ZK presentation of our credentials can hide, and each is already measured or tracked:

- **The citation of a Trust Task is a durable correlator.** `taskContext` and `taskDigestMultibase` link every presentation that carries them. Upstream tracks carrying the citation in committed form, opened inside the proof ([cred-spec#58](https://github.com/trustoverip/dtgwg-cred-spec/issues/58), ZKP record 008), and blinding the unsalted, enumerable digest-valued members ([cred-spec#38](https://github.com/trustoverip/dtgwg-cred-spec/issues/38)). The identifier commitment profile ([dtgwg-zkp-spec#11](https://github.com/trustoverip/dtgwg-zkp-spec/pull/11)) covers both. Z2 presents what those settle and invents no blinding of its own.
- **The ZK-openable commitment lives with the identifier, not in the signature.** `eddsa-jcs-2022` is the RECOMMENDED credential proof, so the commitment a proof opens is a member of the credential and not a property of the proof (the same record set). This fits §3.4: the device-signed JCS proof stays, and the VTA's ZK half opens members the credential already commits to.
- **Anything unmapped by `@context` is invisible to `bbs-2023`.** A member with no term definition is absent from the signed RDF graph, so it can be neither signed nor disclosed. An unresolved CURIE is signed verbatim as an IRI with the wrong meaning (`tsp-reference/ref-07c-predicate-coverage`). An unbundled context means a network fetch at verification time (`ref-07d-vocabulary-trust-path`). Keyring's extension members must be termed before a `bbs-2023` half is issued over them.
- **The VSC input shape.** After [`vsc-migration-plan.md`](./vsc-migration-plan.md) lands, a proof over a witness credential reads `credentialSubject.predicate`, `credentialSubject.object.digestMultibase` (computed without the VRC's top-level `proof`), a top-level `taskContext`, and Keyring's extension members beside `witnessContext`. ZK4 targets that shape, not WD02's `WitnessCredential`.

### 4.3 Z3 — Predicate proofs and uniqueness pseudonyms, watch only

This covers Groth16 predicate proofs with scoped nullifiers (personhood, liveness attestations, "one human, one membership"), which [[VETTING-DESIGN]] §14.2 lists for V2 (*"Uniqueness pseudonyms"*; Sybil resistance across `joinDid`s, §13.4). Upstream has deferred the prover. The trusted-setup ceremony is unsolved for production. Keyring's share is the same consent and rendering as Z2. Z3 has no phases. It gets a phase when upstream ships a VTA task for it.

## 5. Constraints

| # | Constraint | Source |
|---|---|---|
| C1 | *"openvtc is the UI and message carrier only"*; the VTA is the PCS engine; the VTC is the helper | [[HIDDEN-VETTER]], "Where the cryptography runs" |
| C2 | Hidden mode: *"the vetter's VTA is not operated by the VTC operator"* (and likewise the mediator) | [[HIDDEN-VETTER]], "What it costs, said plainly"; "Deployment rules" |
| C3 | *"The VTC learns … who fetched tokens each tick (everyone, unconditionally), and nothing about sessions."* A client that fetches or declines on demand breaks this | [[HIDDEN-VETTER]], vetter sequence |
| C4 | Named and hidden vetting never mix in one criterion | [[HIDDEN-VETTER]] F4 |
| C5 | *"'Anonymous channel' means a fresh did:key or anoncrypt, never the member DID or the pairwise session DID"* | [[HIDDEN-VETTER]] F8 |
| C6 | *"Implementations SHOULD make ZKP presentation the default behavior so that users obtain privacy preservation without having to opt in"* | DTG Core Credentials, as quoted in [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §4.6 |
| C7 | Holders need no BLS key to derive a BBS disclosure; only durable `did:webvh` issuers mint BBS credentials; BBS is gated on an independent audit | [[VTI-CRED-ARCH]] D4, §4 |
| C8 | *"Do not build a second copy of anything the agent already is"* | [[AGENT-STATE]] |
| C9 | ZK over vetting is a V2 non-goal of the current ceremony: *"ZKP predicate claims; k-of-n proofs over hidden vetters"* | [[VETTING-DESIGN]] §1, §14.2 |
| C10 | *"The cryptography carries the privacy. The accreditation framework carries the assurance."* | [[ZKP-TF]] |

## 6. Phases

Each phase starts only on instruction. Every phase that touches upstream behaviour starts by advancing the relevant pin at a boundary and re-running the reference ladder (the `openvtc-workspace` rule).

### ZK0 — Baseline and access

- Get read access to `predicate-credential-system` and pin it in `external/` via `setup-external.mjs`, alongside `OpenVTC/openvtc`, which is cloned but unpinned today.
- Advance the VTI pin from `187ad9cd` (vta-sdk 0.25) to at least the review's `6f26af19` (0.48), coordinated with the owner of the pins and the lab stack; the lab's own bump (to `3dcbfe98`) is queued behind the Farm work. The VTI advance is its own motion: it does not ride with the `dtgwg-cred-spec` advance that [`vsc-migration-plan.md`](./vsc-migration-plan.md) schedules at the start of its V0 (*"One pin, one reason, one entry in `SYNC_LOG.md`"*, §10). It shares the VTI clone repair and the `personhood.rego` re-read that plan's §7.1 needs, so do those once for both.
- Re-read §2.2's upstream-status column against the new pins and correct this plan.

**Done when:** both repositories are pinned with a `--why`; every upstream claim in §2.2 and §5 cites a file at a pinned commit rather than the review; §8 B1 is closed or its owner is named.

### ZK1 — The client contract rung (`ref-2x-pcs-client-contract`)

Build a pure-TypeScript rung with frozen fixtures and no React Native imports. It takes the `vta/pcs/*` task and reply shapes and checks everything Keyring does with them: renders the vetter and applicant surfaces of §4.1 as data, binds the step-up approval's payload digest to the exact `vta/pcs/attest` document, and refuses a reply that would require the client to hold ZK state (§3.2 item 4).

**Blocked on** upstream's specs (step 4 of their order). Until then, fixtures can only be guessed, and a rung built on guessed shapes proves nothing.

**Done when:** fixtures come from upstream's published task definitions or their prototype's transcripts; `npm run -s check` is green under Node and Hermes; the README states what it does not prove (no cryptography, no real VTA).

### ZK2 — Hardware-attested step-up on `vta/pcs/attest`

Add the approval of an attest step-up to Keyring's approvals path, carrying Secure Enclave or StrongBox evidence.

**Depends on** `vta-service` exposing the task with step-up (upstream step 6) and [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) P3.

**Done when:** on a local stack, an attest by a vetter's VTA is refused until the phone approves; the approval verifies with its attestation evidence; an approval replayed against a different attest document is refused. The e2e runs on simulators for mechanics and on one real-device pair for evidence (the only way to prove attestation, per the root `CLAUDE.md`).

### ZK3 — Hidden-mode vetting, both roles

Implement §4.1's table on the screens of [`ui-ux-improvements-plan.md`](./ui-ux-improvements-plan.md).

**Depends on** ZK1, ZK2, and upstream's `vtc-service` and `vta-service` steps.

**Done when:** the vetting subtask's V0 e2e matrix re-runs green in hidden mode on the local stack in all four pairings (Keyring or headless openvtc as vetter × Keyring or openvtc as applicant). A test asserts the VTC's token-fetch log is identical for a vetter who attested and one who did not (C3). A test asserts that nothing of §3.2 item 4 exists in the app's store after a full admission. The demo script contains no anonymity claim on a single-operator stack (§3.5).

### ZK4 — Private presentation (Z2)

- First rung: resolve §3.4's two conditions. Measure whether an R-DID can carry a BLS G2 key and whether the cred-spec allows a proof added to a proof set after issuance, and record D2.
- Then: deposit a VRC or VSC into the VTA vault, have the VTA answer a DCQL request with a `bbs-2023` derived proof, and consent on the phone.

**Depends on** D2, the BBS audit gate (C7), [`vsc-migration-plan.md`](./vsc-migration-plan.md), and for the DTG constructions, DTG ZKP V1.0.

**Done when:** a verifier receives a presentation that verifies and discloses no R-DID; two presentations of the same credential are not linkable by any member the verifier sees; the phone's copy of the credential is unchanged by the deposit.

## 7. Interfaces with sibling plans

| Sibling | What this plan needs from it | What it gets back |
|---|---|---|
| [`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) | §2.4 updated to record B; the V0 e2e matrix ZK3 re-runs; the vetter role in Keyring | A hidden-mode variant of its ceremony with the same screens and a changed artifact |
| [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) | Approvals (P3) and the credential vault client (step 1) | A second consumer of approvals that needs attestation evidence |
| [`ui-ux-improvements-plan.md`](./ui-ux-improvements-plan.md) | The vetter and applicant flows | §4.1's changes to them |
| [`keyring-on-the-vta-farm.md`](./keyring-on-the-vta-farm.md) | An operator-separation signal (§3.5) | A deployment rule to state before hidden-mode communities run on a Farm |
| [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §4.6 | The format decisions | §3.4's placement of the ZK half in the VTA, answering §4.6's open "BBS+ tooling / Hermes" question with "not on the phone" |

## 8. Open questions and what they block

**Not decided (ours):**

- **D2** — §3.4: BBS issuer key custody (R-DID or VTA `did:webvh`) and post-issuance proof addition. Blocks ZK4.
- **D3** — whether Keyring pursues the vetter role at all, or stays applicant-only in hidden mode. The table in §4.1 assumes both. Blocks ZK3's scope.

**Decided upstream, waiting on someone else:**

- **B1** — Access to `predicate-credential-system`. `gh` reports `etairi/predicate-credential-system` not found on 2026-09-22 (private, renamed or moved). The review also leaves open whether the context change goes upstream through us or through Berkeley, and who publishes to crates.io (*"OpenVTC's deny.toml forbids git dependencies"*). Blocks ZK0.
- **B2** — The seven specs (manifest `vetting.anonymity`, `pcs-root`, tokens, event mode, attestation, refresh, `submit/0.3` `vettingProof`, `revoke-statement/0.2`, `atCapacity`, `vta/pcs/*`). Upstream. Blocks ZK1.
- **B3** — `vtc-service` and `vta-service` PCS support. Upstream. Blocks ZK2 and ZK3.
- **B4** — Governance acceptance of the trade hidden mode makes: cascade review and lineage are foreclosed, plus liability wording and the anonymity-set floor ([[HIDDEN-VETTER]], "Decisions needed before code"). Per community, upstream. Hidden mode may never be enabled anywhere Keyring runs.
- **B5** — A signal a client can read that the VTA and VTC operators differ (§3.5). Not designed anywhere yet. Raised as **VTI-Q16** in `docs/VTI_UPSTREAM_FINDINGS.md` (on `main`, `a5f5cab`), which cites only published sources.
- **B6** — DTG ZKP V1.0 and the BBS audit. Block ZK4.

## 9. Review index

| Date | Companion | Driven by |
|---|---|---|
| 2026-09-22 | [`2026-09-22-al.md`](./zero-knowledge-plan/2026-09-22-al.md) | Initial research: the maintainer's hidden-vetter review, [[AGENT-STATE]], [[VTI-CRED-ARCH]], and the positions of 2026-08-05 it supersedes |

## 10. Sources

- [[HIDDEN-VETTER]] — see References.
- `external/openvtc/docs/design/vetting-process.md` at `177a218` (§1 non-goals l. 66; §14.2 l. 1542; D19 l. 1595).
- `external/verifiable-trust-infrastructure/docs/05-design-notes/vti-credential-architecture.md` at `187ad9cd` (D4 l. 23; §4 ll. 125–215); `vta-service/src/operations/credential_exchange.rs` at `187ad9cd` (the `Bbs2023` and `Zkp` arms).
- `external/vta-browser-plugin/packages/core/src/persona/consent-view.ts` at `9643c57`.
- `tsp-reference/ref-03d-bls12-381-hermes/README.md`.
- [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §4.5–§4.6; [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) §4.6; [`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) §2.4, §2.6, §3.9.
