# Zero-knowledge in Keyring — where the proofs live, and what the wallet does about them

**Status:** Proposed. No code written. **Held at ZK0 by decision, not by drift:** the client half of hidden vetting cannot be designed against guessed message shapes, so this plan waits for upstream's specifications and services rather than starting early and rewriting later. Until then it tracks upstream and keeps its dependencies current.
**Reasoning:** [`2026-09-22-al.md`](./zero-knowledge-plan/2026-09-22-al.md) — the research behind §2–§4: the positions it supersedes (on-device proving), the evidence for each, and what was not verifiable.
**Siblings consulted:** [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §4.6 owns the credential-format decisions this plan inherits (VRC/VWC proof sets, evidence commitments, canonical transcript); [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) owns the VTA client architecture, consent card and approvals this plan's step-up rides on; [`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) owns the V0 vetting ceremony that hidden vetting keeps unchanged, and its §2.4 decision gates Track Z1; [`vsc-migration-plan.md`](./vsc-migration-plan.md) owns the witness-credential type Track Z2 would present; [`ui-ux-improvements-plan.md`](./ui-ux-improvements-plan.md) owns the vetting screens Track Z1 changes.
**Dependency direction:** nothing in the sibling plans waits on this one. This plan waits on upstream (§8) and on two sibling decisions (§3.3, §3.4).
**Sources:** this plan cites **only publicly available artifacts**. Where it states a design position with no citation, the position is **ours**, reasoned from those artifacts. Much of what was ours by necessity is now citable: upstream's hidden-vetting design is public and in our pinned clone (see [[PCS-DESIGN]]), and the sections below name it where they previously carried our reasoning alone.
**Baseline (read 2026-09-23):** our pins — VTI **187ad9cd** (vta-sdk 0.25.0), `vta-browser-plugin` **89d70c4** (advance to **9643c57** in flight); `OpenVTC/openvtc` clone **177a218** (not in `PINS.json`). Upstream heads re-checked 2026-09-23 — openvtc **5453239**, VTI **c595bcb9**: no hidden-vetting or predicate-credential code in either, and `vetting-process.md` still lists the work as V2. A predicate-credential library of the kind this construction needs is not publicly available to us (§8 B1). `trustoverip/dtgwg-zkp-tf` **a42bf8c0**, `mitchuski/dtgwg-zkp-mage` **1be94c80**, `affinidi/affinidi-zkp-crypto-rs` **c23a4b71** (public, not cloned). The running stacks are not on the reference pins: the local lab runs VTI **a96fe02f**, with a bump to **3dcbfe98** queued; Farm VTAs run vta **0.37.1** (`d9a5be02`). ZK0 reconciles all three.

**References:**

- **[[VETTING-DESIGN]]** — `docs/design/vetting-process.md` in `OpenVTC/openvtc` (DRAFT v3): §1 non-goals, §10.5 accountability, §14.2 V2 scope, D7/D14/D19.
- **[[VTI-CRED-ARCH]]** — `docs/05-design-notes/vti-credential-architecture.md` in VTI, present at our pin `187ad9cd`: D4 and §4, proof formats.
- **[[AGENT-STATE]]** — *The Agent Is the State: UIs That Keep Nothing*, `ic3.software/blog/the-agent-is-the-state`.
- **[[PCS-DESIGN]]** — `docs/design/vetting-hidden-vetters-pcs.md` in `OpenVTC/openvtc`, **read at our pin `2a4fa2b`** (openvtc 0.5.0, the VTI-Eucalyptus set) (public; 1 098 lines): upstream's own design for hidden-vetter admission, including §13's correction **C7**. Companion: `docs/design/hidden-vetting-live-run.md`. **All 35 `:line` citations below were verified in the resynced `external/openvtc` checkout at the current pin `2a4fa2b` (2026-10-08), and previously at `8991f9ca` and `e49816c`.** They have survived two pin advances unchanged because the edits fell outside the cited region — not by luck a third time: re-verify on every advance, since the file is 1 137 lines here and was 1 098 two pins ago, and two commits of equal length once differed by 8 lines. Only one line inside a cited range moved between those commits (`:484`, terminology, not quoted here). Line numbers do drift off a pin — the file is 1 136 lines on `main` (`24af7b13`) — so read it at a pin, not at `main`.
- **[[OPENVTC-HIDDEN]]** — `openvtc-core/src/vetting/hidden.rs` on `OpenVTC/openvtc` **main at `e49816c`** (public, read 2026-09-29): the shipped client half — the namespace it implements, the parameters a community publishes, and why criticality is what makes refusal possible.
- **[[ZKP-SPEC]]** — `trustoverip/dtgwg-zkp-spec` (public; `spec/body.md`, status *"Proposed · 2026-08-25"*): the Accessibility Considerations section on proving cost and mediated proving, and open PR #11 on key profiles.
- **[[W39]]** — *Week 39 OpenVTC report*, `docs.fpp.storm.ws/week-39-openvtc-report.html` (public, read 2026-09-27): hidden vetting implemented on unmerged `zkp-pcs` branches in both repositories, *"proving runs on the client side (via the community app), while verification occurs server-side"*, a proof *"about 1.3 KB, and milliseconds to check"*, and the library *"a research artefact and unaudited"*.
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

| | BBS signatures (`bbs-2023`) | Predicate credentials (Σ-protocols) | Circuit SNARKs (Groth16) |
|---|---|---|---|
| **Proves** | "An issuer signed a credential containing these claims," revealing only the chosen claims; two shows are unlinkable | "k pairwise-distinct credentialed users attested to this identifier," and nobody learns which | Any statement expressible as a circuit: "signature valid ∧ predicate true ∧ nullifier = H(secret, context)" |
| **Math** | Pairing-based signature over BLS12-381; the holder derives a proof of knowledge of the signature | Σ-protocols made non-interactive by Fiat–Shamir over a pairing-friendly curve; pseudorandom *tags* stand in for identities; blind issuance | R1CS circuit (circom), BN254 curve, Poseidon hashing; constant-size proof |
| **Cost** | Proof derivation is a public operation on the issuer's signature; the holder needs **no** BLS key ([[VTI-CRED-ARCH]] §4) | **Measured by us** on an Apple Silicon laptop, the library's own Criterion bench at k = 5 for the suite upstream fixes (`ps-ddh-bls12381`): prove **11.7 ms**, verify proof **10.4 ms**, attest **2.5 ms**, verify attestation **2.4 ms**, blind issue **10.4 ms**, unblind **2.3 ms**. Proof 1 392 B | ≈680 ms to prove, 721 B proof, on the lab's 11 523-constraint circuit ([[ZKP-TF]] lab) |
| **Setup** | None | None beyond the issuer's keys | A **per-circuit trusted-setup ceremony**; the lab's is lab-only |
| **Upstream status** | Adopted, not built: `affinidi-bbs` over `bls12_381_plus` and `bbs_2023` in the TDK, gated on an independent audit ([[VTI-CRED-ARCH]] D4) | **Shipped and public.** Merged to openvtc `main` at `e49816c` (2026-09-29), and the library is published as `predicate-credential-system` 0.1.0 on crates.io under MIT (2026-09-28). Proof *"about 1.3 KB"* ([[W39]]). The library remains unaudited (C6a), and there is still no published *specification* — the readable contract is the code | A `CredentialFormat::Zkp` variant exists; "the Circom circuit + Groth16 prover/verifier (server-side VTA proving) live outside it and are deferred" ([[VTI-CRED-ARCH]] §4) |
| **Our track** | Z2 | Z1 | Z3 |

### 2.3 The building blocks, in the words the specs use

- **Pairing / BLS12-381.** A bilinear map e(aP, bQ) = e(P, Q)^{ab} on a pairing-friendly curve. It lets you check relationships between hidden exponents, which is what BBS and PCS both rely on. Phone secure elements do **not** support this curve: the Secure Enclave is P-256 only, and StrongBox is P-256, RSA and (API 33+) Ed25519. This is a hardware fact, and it matters for §3.1.
- **Tag / nullifier.** A deterministic, pseudorandom value derived from a secret and a context. The same secret in the same context always gives the same tag, which is how distinctness is counted and double-use is caught. A different context gives an unlinkable tag. PCS calls these tags; the DTG task force calls them scoped nullifiers.
- **Blind signature.** The signer signs a value it cannot see and cannot later recognise. A predicate-credential scheme uses it to issue vetter credentials, and to hand out rate-limiting tokens, without the issuer learning which token belongs to whom.
- **Issuer, or *helper*.** The literature's name for the party that issues the credentials and tokens and verifies the proofs. In our ecosystem that role is **the VTC**; the party that proves is the member's **VTA**.

### 2.4 What a zero-knowledge proof does not give

- **Privacy, not assurance.** The ZKP task force states the boundary: *"The cryptography carries the privacy. The accreditation framework carries the assurance."* A proof shows that a valid attestation is held, not that the determination behind it was correct.
- **Distinctness, not independence.** A threshold proof shows the vetters are distinct people. *"Actor distinctness MUST NOT be upgraded into evidence independence … PCS proves that the vetters are distinct, not that they are independent"*, and `independence_ok` keeps coming from declared relationships (VTI-CMP-070/071; [[PCS-DESIGN]] `:500-502`).
- **Computational anonymity only.** *"Anonymity is computational (DDH over BLS12-381), so it is not safe against a quantum"* adversary ([[PCS-DESIGN]] `:509`): an attacker who collects records today could later link one vetter's attestations, and could name that vetter if the issuer also kept what identified them at enrolment — so deleting that record is part of the design, and the design says to state this in governance text *"next to the stack's post-quantum signature work"* (`:518`).
- **Post-quantum is being worked on at the library, not here.** `predicate-credential-system` carries an `origin/post-quantum` branch; nothing of ours should assume or wait on it, but it is the place that would change the paragraph above.
- **A rate cap on anonymous actors binds a group, not a person.** If the rate-limiting tokens are not cryptographically tied to the individual vetter's own secret, a set of colluding vetters can pool them: the cap then limits the group's total, not each member's. Whether that matters is a governance question, but a client must not describe such a cap to a user as a per-person guarantee.
- **Nothing about metadata outside the proof.** Timing, token-fetch patterns, mediator routing and small anonymity sets all leak around a mathematically perfect proof. Several of those leaks are closed or opened by *client* behaviour, which is why §4.1 is a list of what Keyring must not do.

### 2.5 Why this needs its own construction, rather than a primitive off the shelf

Threshold anonymity — *k distinct eligible parties attested, and nobody learns which k* — is an awkward fit for the standard toolbox, and it is worth knowing why before anyone proposes a shortcut. The properties below are textbook ones, not claims about any particular implementation:

| Primitive | Why it does not simply do this |
|---|---|
| **BBS+ / PS signatures** | Built for one issuer's credential shown by its holder. It hides claims well; it says nothing about *how many different people* signed, so counting distinct attesters is out of scope |
| **Ring signatures** | Prove "one of this ring signed" and, in the plain form, give no way to tell two signatures apart as two people. Proof size also grows with the ring, i.e. with the whole eligible set rather than with k |
| **Linkable ring signatures** | Add exactly the distinctness we need, but the linkability tag is usually per-ring: every change to the eligible set reshapes the ring, and one signature per signer per ring is a strong constraint to carry across policy periods |
| **Group signatures** | Anonymous, but by design a group manager can open a signature and name the signer. That reintroduces the party hidden vetting exists to remove |
| **Threshold signatures (FROST and similar)** | Produce one signature from k co-signers, but the signers coordinate *in one session* and the k are known to each other and to the coordinator. Vetting sessions happen days apart, with vetters who must not learn of each other |
| **zk-SNARKs (Groth16)** | Could express the statement, at the cost of a bespoke circuit and a per-circuit trusted-setup ceremony — a real operational burden for a community, and a trust assumption the other options avoid |
| **zk-STARKs** | No trusted setup and post-quantum, but proofs are orders of magnitude larger, which a mobile submission budget feels |

So a purpose-built construction is a reasonable answer rather than an indulgence. What it buys is threshold *distinctness* with no trusted setup, with vetters who never coordinate, and a proof that grows with k rather than with the size of the eligible set. What it costs is a young, unreviewed codebase (§8 B1), and a standard elliptic-curve security assumption, which is not post-quantum (§2.4).

**Before repeating any novelty claim in public, check the prior art.** Anonymous credentials have a long literature on counting and limiting anonymous actors — *n*-times anonymous authentication, scoped nullifiers and pseudonym systems among it — and some of it reaches similar ends by other means. Our plan does not depend on the construction being first of its kind, only on its being fit for this job, and that is the claim we should make.

## 3. Positions

### 3.1 Proving belongs in the VTA for the vetter; for the applicant it is an open question

**The two sides of hidden vetting are not symmetric, and the answer to "device or VTA?" differs between them.** The vetter is the party whose anonymity the whole construction exists to protect; the applicant is not anonymous to anyone and never was. Read the three arguments below with that split in mind — only the first applies to both.

Two public anchors say the ecosystem proves server-side for the credential layer — though see §3.3 for a counter-signal in the ceremony layer, where its own client borrows keys and acts locally:

- **Credential formats:** the holder's VTA is *"store + wallet + signer"*, and the Groth16 path is *"server-side VTA proving"* ([[VTI-CRED-ARCH]] preamble and §4). The VTA's `credential-exchange/present` already assembles `Bbs2023` presentations from its vault (`vta-service/src/operations/credential_exchange.rs` at `187ad9cd`).
- **Client architecture:** *"Do not build a second copy of anything the agent already is"* ([[AGENT-STATE]]).

Three facts specific to a phone bear on it. The first is general; the second and third are about the **vetter**:

1. **There is no hardware-custody gain to lose.** Every ZK secret in play (a predicate-credential secret, a BBS link secret, a Groth16 witness) is a scalar on a pairing-friendly curve, and neither phone secure element supports those curves (§2.3). A device-held ZK secret would be a software key either way. Keyring's hardware story continues where it actually applies: the Secure Enclave or StrongBox signature on the *approval* (§3.2).
2. **Hidden vetting needs an always-on agent.** Capping how often an anonymous vetter may vouch means handing each of them rate-limiting tokens, and the collection of those tokens must not track their activity — otherwise the collection pattern is itself the signal the design exists to hide. That implies a component awake on a schedule of its own. A mobile OS suspends and kills apps as routine, so the phone cannot be that component.
3. **Anonymity does not survive two copies.** A vetter's attestations held on the phone *and* in the VTA are two places to leak identifying tags from, and two sources of truth for what has already been spent.

**Upstream's own implementation proves on the client, for both roles.** [[W39]] states it plainly: *"proving runs on the client side (via the community app), while verification occurs server-side"*. That is a coherent choice for a desktop client which is running whenever its operator is, and it does not change our answer, because the reason the vetter's side needs an agent is not custody but **duties that continue while the client is closed**. It does mean our placement is a deliberate divergence from the reference client, made for a phone, and should be described that way rather than as the ecosystem's rule.

**So, split by role:**

- **Vetter side — settled for us, the VTA proves.** Points 2 and 3 are decisive: an unattended collection schedule and a single source of truth for what has been spent are not things a phone can offer. A Keyring user who vouches does so through their agent.
- **Applicant side — open (decision D4, §8), and on the ecosystem's own code the answer is the agent.** [[W39]]'s client-side placement is the reference implementation for this operation, and none of the vetter's constraints bind here — but three facts in the pinned clones point the other way, and they are about what a gate can do rather than about where a file sits (§3.1.1). The applicant's secret is minted for one application and discarded with it, there is no schedule to keep, nothing is rate-limited, and the applicant is not hiding from anybody: the community learns their join DID at submit in either design. So the phone proving for itself is defensible, and it would work offline and keep the applicant's secret off any server. Against it: a second proving stack to ship and maintain in the app, for a party that gains no privacy from holding it, and a split architecture where the vetter's side lives in the agent and the applicant's does not. **The working assumption — the VTA proves both sides — is now the better-supported reading**, on the evidence in §3.1.1 rather than on convenience. What would overturn it is a concrete blocker rather than a preference: if upstream ships only a client-side prover and never a prove-as-persona task, we either wait or carry a divergent path, and D4 records that.

**Rejected for the vetter's side: proving on the device.** It is feasible. BLS12-381 runs on the app's Hermes and gives byte-identical output to Node, at about 15× Node's cost (a pairing is 96.7 ms, a BLS verify 146 ms; `ref-03d`), and the DTG lab's Groth16 prover runs in about 680 ms. For a vetter it is still ruled out by points 2 and 3: it cannot keep an unattended schedule, and it creates a second source of truth for what has been spent. For an applicant those objections do not apply, which is exactly why D4 is open rather than closed — and `ref-03d` is the measurement that says the phone could carry it if we chose to.

### 3.1.0 Upstream says the same thing, in its own words

[[PCS-DESIGN]] §13's correction **C7** is titled *"The VTA is the PCS engine"* (`:604-627`) and states the position this plan reached independently, with the same reasons:

- Every member-side operation runs in the VTA as a Trust Task — it names `vta/pcs/root-request`, `attest`, `prove`, `verify-attestation`, `tokens/fetch`, `withdraw` — the proving secret is *"a new VTA key kind (a BLS12-381 scalar) in the VTA's key store, alongside the persona keys"*, and the client is *"the UI and the message carrier only, and never sees `usk`"* (`:605-610`).
- Its stated reasons are ours: the attest gate belongs in the VTA, *"the token drip needs an always-on agent … which the VTA is and openvtc is not"*, and the client *"need not carry arkworks at all"* (`:610-614`).
- Its stated cost is ours: *"The VTA can compute every tag of its user, so vetter anonymity holds against the VTC, other members, applicants and the mediator, and NOT against the vetter's own VTA"* (`:615-618`).

**C7 supersedes an earlier position in the same document**, and the superseded reasoning is worth keeping rather than discarding: §3's table had the applicant's secret *"generated locally, **never held by the VTA**"*, because *"a hosted VTA may belong to the same operator as the VTC; tags are deterministic in `usk`"* (`:81`). That risk does not vanish when C7 moves the secret into the agent — it is exactly what §3.5's operator-separation rule exists to contain, and it is a second reason the phone path in §3.1.2 must stay available.

### 3.1.1 What the operator clients actually do with keys, and why it decides this

Upstream's two operator clients disagree, and the disagreement is instructive rather than confusing. Read at the pins on 2026-09-27:

- **The written norm is perform, don't export.** The access-control layer says so and gives the reason: *"an exported key stays with whoever holds it after their authority is withdrawn, which is why VTI-VTA-002 makes performing the operation the norm"* (`vti-common/src/acl/mod.rs:149-152`). Export is a **separate capability** from use — *"an export MUST be gated by a capability distinct from the capability to use the key"* (`vta-service/src/trust_tasks/keys.rs:249-265`) — and every export is audited (`vta-service/src/operations/keys.rs:883-899`).
- **The browser client follows the norm**: it never calls `keys/export-secret` at all, signs through `keys/sign/0.1` and `vault/sign-trust-task`, and states the boundary in one line — *"Private key material never crosses this boundary — the agent derives, holds and uses it, and returns public halves and signatures"* (`vta-browser-plugin/packages/core/src/admin/keys.ts:4-6`).
- **The terminal client departs from it for two narrow, documented reasons**, not as a philosophy: the VTA has no remote key-agreement operation, so a messaging session must borrow (`pnm-cli/src/commands/messaging.rs:1-16`), and no existing task can sign **as the persona DID** — *"`keys/derive-and-sign-document` signs as a derived `did:key`, and `keys/sign` is domain-separated"* ([[VETTING-DESIGN]] D19). That same entry names the fix it wants: *"A VTA sign-as-persona task over non-exportable keys would move that gate into the VTA (V1)"*.

Two further facts settle it for a *proving* key specifically:

- **The agent already holds prover secrets, and never exports them.** BBS pseudonym material — the holder's `prover_nym` and `secret_prover_blind` — is persisted inside the VTA's own vault under reserved tags and the presentation is derived there (`vta-vault/src/bbs.rs:265-272,322-328`; `vta-vault/src/model.rs:38-42`). A ZK proving key in the vault is the shape the ecosystem already ships, not a new idea.
- **An exported key cannot be gated by a step-up, at all.** `keys/export-secret` is gated by capability, context scope and audit — and by nothing else: there is no assurance tier and no freshness check on it anywhere. So if the proving secret is exported to the phone, the agent cannot require a human approval before a proof is made; the only gate left is the app's own UI, which is exactly the gate an attacker with the app does not face. **That directly contradicts §3.2's first duty**, which is the one thing Keyring brings that the reference clients do not.

**Conclusion:** the proving key belongs in the VTA, non-exportable, with the agent proving on request — not because keys should live in agents as a matter of taste, but because the hardware-attested step-up we are building is unenforceable on an exported key, and because the two reasons the terminal client borrows (key agreement, signing as a persona) do not apply to a proof. That is the **default**, and §3.1.2 says why it cannot be the only path.

### 3.1.2 Both paths ship: the agent by default, the phone by the holder's choice

**Decided 2026-09-28, and upstream's design says the same.** Keyring offers agent-side proving as the default and an on-phone path for a holder who chooses it. C7 keeps precisely that fallback, with precisely our cost line: *"The fallback, `usk` local to openvtc, remains possible for a member who runs no trusted VTA, at the cost of no step-up gate"* ([[PCS-DESIGN]] `:626-627`). So the dual path is not a divergence from upstream — it is upstream's design, and the §3.1.1 argument explains why the default falls the way it does. Two further reasons:

- **The specification refuses a delegation-only client.** *"Mediated proving, where a holder delegates proving to an agent, … MUST NOT be the only path available to a holder"* ([[ZKP-SPEC]], Accessibility Considerations). The surrounding rationale is proving cost on constrained devices and not excluding holders; read with the sentence, the concern is that a holder is never *forced* to delegate. A client offering only the agent path would be the thing that sentence forbids.
- **Delegation is a trust choice, and it is not ours to make for someone.** Agent-side proving means the agent can compute what the holder proves. Our own §3.5 accepts that trust for the vetter; a holder who does not accept it should still be able to participate.

**What each path costs, stated so the UI can say it honestly:**

| | Agent proves (default) | Phone proves (opt-in) |
|---|---|---|
| Hardware-attested approval before a proof | **Yes** — the gate of §3.2 duty 1 | **No.** Nothing on the agent side can gate a proof made locally; the only gate is the app's own |
| Unattended duties (a vetter's allowance schedule, one record of what was spent) | Kept | **Not possible on a phone** (§3.1), so this path is for the applicant's side only |
| Who can compute the holder's proofs | The agent's operator, as well as the holder | The holder alone |
| Cost to build | A `prove` task we do not yet have, and nobody upstream is building it (§8 B3) | A native module wrapping a **published** crate — see §4.1.2 — not cryptography we write |
| Speed | Same proof, computed elsewhere | **Not a constraint.** 11.7 ms to prove natively on a laptop (§2.2); a phone being several times slower still disappears inside a ceremony with a human reading a code aloud |

**Revisit when [[ZKP-SPEC]] settles**, and note its status: the sentence quoted above sits in a section the document itself marks *informative*, so its normative force is unclear as written (§8, an ask rather than a workaround). We implement both paths regardless, because the accessibility argument holds on its own.

**Where our hardware keys fit.** A Secure Enclave or StrongBox key is not usable as a proving key on any of these curves (§2.3). [[ZKP-SPEC]] PR #11 points such keys at **issuance-time attestation** opened at presentation, conditioned on an identifier's declared key profile, rather than at in-proof derivation. So Keyring's hardware story attaches where it can — at issuance and at approval — not inside the proof, on either path.

### 3.2 What Keyring does

Four duties, none of them cryptographic beyond the signature Keyring already makes:

1. **Gate the consequential operation with a hardware-attested step-up.** Vouching for a person is the most consequential thing a member does, and [[VETTING-DESIGN]]'s own target for signing a vetting statement is *"step-up always (passkey / device)"* — a gate its V0 cannot apply, because the client holds the key. Keyring approves the attest step (whatever task name the specification gives it) through the approvals path ([`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) P3) with a Secure Enclave or StrongBox signature and its attestation evidence. This is where Keyring is ahead of the reference clients, and it is Z1's one contribution beyond UI.
2. **Mark a non-disclosing presentation, without overclaiming.** A credential shown by a proof that reveals nothing deserves to look different from one shown in full, and a badge is the natural device. Two cautions, both from §2.4: a badge must say *nothing was disclosed*, never *verified* or *private* — the cryptography carries disclosure, not assurance, and metadata outside the proof (timing, a thin anonymity set, who the counterparty is) can still identify a person. And it must be visibly distinct from Keyring's existing hardware-attestation badge, which makes an unrelated claim about the device rather than about disclosure. Two badges that look alike would be worse than one.
3. **Render what the VTA says, as data.** Proof requests, disclosure previews, checklists and outcomes are the VTA's replies, rendered. A predicate claim is shown as the strongest outcome on the screen, not as a missing value ([[CONSENT-VIEW]]: *"A predicate claim discloses no value at all — that is the whole point"*). The preview comes from the code that will act ([`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) §3.9).
4. **Carry the ceremony.** The V0 vetting ceremony — ticket, request, session, signed Vetting Card, match code, human check ([[VETTING-DESIGN]] §3) — needs no change for hidden mode: what changes is the artifact the vetter returns and what the VTC checks, neither of which the client composes.
5. **Keep no ZK state** (under the working assumption of §3.1; D4 would narrow this to the vetter's side only, and note that the phone already borrows persona *signing* keys today, so this is a rule about proving material rather than a general "no secrets on the device"). No ZK secret, rate-limiting token, attestation, tag or proof is persisted on the phone, and none is cached for display. The boundary [`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) §2.6 draws ("no local mirror of state a counterparty owns") covers all of it, because the VTA owns it. Idempotence ledger entries for in-flight tasks are the one exception, and they are ids, not ZK material.

### 3.3 Track Z1 rests on the member being a VTA persona — but the client, not the VTA, signs for it

**What was decided, and what it actually means.** Every Keyring user has their own VTA and Keyring manages it; the member of a community is a **persona** of that VTA, not the phone (decided 2026-09-16). The VTA mints the persona and is where its keys live. **It does not sign for it:** upstream's own reference client keeps a persona's keys as references, fetches the secret with `keys/export-secret/0.1` when it must act, and signs and seals locally — its join test states that submission *"never touches the VTA"* — and Keyring does the same, borrowing the persona's key-agreement and signing keys into the wallet's KMS (built in 220). ([`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) §2.4, as restated in keyring-wallet#155; that PR was still open when this was written, so `main`'s §2.4 may still read "Open".) **Why Z1 needs this.** A vetter's side of hidden vetting has unattended duties — collecting rate-limiting material on a schedule, and one authoritative record of what has been spent — so it needs an agent that exists independently of the phone. A design where the phone *is* the agent (the earlier option A, which P4 built and P4b replaced) has nowhere to put them, so under it hidden-mode communities would simply be closed to Keyring members, and the UI would say so rather than degrade silently. This plan designs no such path.

**But note what the signing pattern does to §3.1's premise.** "The agent holds the secrets and the client asks it to act" is *not* the house pattern for the ceremony layer: the ecosystem's own client borrows the persona's secret and acts locally, and so do we. That is a real counter-signal to placing the applicant's proving in the VTA, and it is why D4 (§8) is open rather than decorative. It does not touch the vetter's side, whose argument is the unattended duties above and not "keys belong in the agent".

Two questions the subtask leaves for Alberto bear directly on D4: **whether borrowed keys may persist** in the wallet's KMS, and **where the persona's membership card lives** under the no-mirror rule. If borrowed secrets may persist, a phone-side applicant prover is consistent with what is built rather than an exception to it, and D4's default should be revisited rather than defended.

### 3.4 Keyring's own credentials meet zero knowledge in the VTA, after the in-person exchange

*Conditional design; open decision D2 (§8).* The in-person VRC exchange has no VTA in its path, and it stays device-signed `eddsa-jcs-2022` so that a credential formed in person verifies with no `@context` resolution ([`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §4.5). The selective-disclosure and ZK half (`bbs-2023` in a proof set, §4.6 decision 1; the DTG pairwise and community-anchored ZKP constructions) is produced **later, online, by the VTA**, from a copy the phone deposits into the VTA's credential vault (`vault/credentials/receive`, [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) step 1).

This keeps §3.1 and resolves the tension with the vetting subtask's §2.6 without breaking either: the phone is authoritative for what it minted, and the VTA holds a deposited copy to prove from. That is a hand-off, not a mirror of counterparty state. Two facts make it conditional rather than settled:

- **Who holds the BBS issuer key.** A `bbs-2023` base proof needs a BLS12-381 G2 assertion key on the *issuer's* DID, and *"only durable `did:webvh` issuers mint BBS credentials"* ([[VTI-CRED-ARCH]] §4). A VRC's issuer side is the R-DID. Whether an R-DID can carry that key, or the BBS half is issued under a VTA-held `did:webvh`, changes what a verifier must resolve. This is not yet measured.
- **Whether a second proof can be added to a proof set after issuance** without the verifier treating it as a different credential. §4.6 assumes *"a second proof can be added later"*. Z2's first rung checks that against the cred-spec text before anything relies on it.

### 3.5 Hidden mode needs the VTA operator and mediator operator to differ from the VTC operator

**Upstream's rule, and ours.** [[PCS-DESIGN]] C7 states it: *"Hidden mode requires that the vetter's VTA is not operated by the VTC operator (or a party colluding with it), the same rule §6 already sets for the mediator. The manifest states it; the client warns when it can tell they coincide"* (`:619-621`). Note the two halves a client owns: reading the manifest's statement, and warning. The reason, in our words: whichever component proves on a vetter's behalf can compute every tag that vetter produces. Anonymity therefore holds against the community, other members, applicants and the mediator — but never against the vetter's own agent. That is the same trust already placed in a VTA for persona keys, so it is acceptable; what is not acceptable is one operator holding both sides. Hidden mode requires that the operator of the vetter's VTA, and of the mediator, is not the operator of the VTC. Two consequences for sibling plans:

- **The Farm.** [`keyring-on-the-vta-farm.md`](./keyring-on-the-vta-farm.md) targets a Farm-hosted VTA. If one operator hosts both a member's VTA and the community's VTC, hidden mode is void for that member, and Keyring should warn rather than let the vetter believe they are anonymous. Keyring cannot detect operator identity by itself, so this needs a manifest or Farm signal (§8 B5).
  Today the Farm hosts VTAs and the mediator, and the first community VTC runs on a separate operator's stack, so the rule currently holds there.
- **The local stack.** Our development stack runs VTA, VTC and mediator on one host under one operator. That is fine for testing mechanics. No demonstration on it may describe vetters as anonymous from the community.

### 3.6 Keyring's contract is with the community's declared extension, not with a construction

**Our design rule — and the shipped client now works exactly this way**, which turns this section from a prediction into a contract we can read. A community publishes the parameters of whatever scheme it uses in a namespace it controls (`org.openvtc.hidden-vetting`, suite `ps-ddh-bls12381`), marks that namespace critical (Trust Tasks framework §4.5.1, manifest 0.2), and a client either honours it or stops. The reason criticality matters is stated in the shipped module and is worth quoting, because it is the failure this plan's §4.1 fail-closed row exists to prevent: *"Without it, a client that does not implement the namespace ignores it … gathers ordinary named statements and presents them to a criterion whose whole purpose is that it never receives them. The community sees a named submission, the applicant sees a rejection, and neither learns that a downgrade happened"* ([[OPENVTC-HIDDEN]]).

**One implementation detail to carry, from the same module:** the parameters must be read from the **raw** criterion rather than a parsed one, because a generated requirements type carries only the members its schema declares and silently drops the rest ([[OPENVTC-HIDDEN]]). Any Keyring reader of a community's manifest has the same exposure.

For Keyring that is the better contract anyway, and it changes the work:

- **ZK1's client contract is against the declared extension**, not against a named construction. What the client must do — read the parameters, recognise the mode, gate the attest step, render the outcomes, refuse when it cannot honour the namespace — is identical whichever scheme a community picks.
- **The plan's §2.2 remains background, not interface.** Naming constructions helps a reader understand the trade-offs; nothing in the client should branch on them.
- **A second scheme later is additive.** If a community adopts a different construction, Keyring's refusal path is what protects its users in the meantime, which is exactly why §4.1's fail-closed row is a requirement rather than a nicety.

## 4. Tracks

### 4.1 Z1 — Hidden-vetter admission, upstream-led

The protocol, the services and the message definitions are upstream's to build; Keyring's slice is the client and the step-up of §3.2. The table is what we propose the client must do, derived from §2.4's leak list — each row exists to close a leak that no proof can close:

| Surface | Hidden-mode behaviour | Why (leak it closes) |
|---|---|---|
| Accepting a vetting request | Reserve a token on accept, not at the end. With none free, *"decline individually with `atCapacity`"*, which *"carries the date of the next free token"* ([[PCS-DESIGN]] `:319`; the code is `vetting/decline/0.1` + `availableFrom`, `:386`) | No one sits through a whole session only to find the vetter cannot vouch |
| Vetter availability | **No "accepting requests" toggle** in hidden mode. Decline individually | The toggle is the busy-vetter signal hidden mode removes |
| Personal vetting limit | A vetter wanting to do less than their allowance sets it as a local preference; the agent still collects on the normal schedule | The preference never becomes visible to the community |
| Attest | Hardware-attested step-up approval of the attest step | [[VETTING-DESIGN]]'s stated target gate (§3.2) |
| Applicant checklist | **Not a count of what is held** — see §4.1.3, measured. It renders the community's own answer: what it counted and what it still needs. The agent verifies each attestation on receipt, but verified-and-held is not the same as counted | A bad or unbacked attestation surfaces at the session, not at submit |
| Anonymity set | Warn when the published bucketed live-vetter count is below a floor. The manifest carries `vetterCountBucket` ([[PCS-DESIGN]] `:346`, `:378`, `:601`) | *"With 3 vetters and k = 2, 'hidden' means little"* (`:346`) |
| Submit timing | The app may delay submitting after the last session, and never shows or sends a finer timestamp than it must | Exact timings correlate a session with a submission |
| Withdrawal | A vetter withdrawing an attestation is sent from a fresh identifier; the UI never routes it through the member or session DID | The mediator would otherwise see who sent it |
| Mixed criteria | A community's criterion is either named or hidden, never both, and the UI says which is in force | Otherwise one person can be counted twice, once under each mode |
| A criterion the client cannot honour | **Fail closed.** If a community marks its hidden-vetting parameters as a criterion the client must understand, a Keyring that does not implement the mode refuses the criterion and says so — it never falls back to collecting named statements | Gathering named statements for a criterion whose purpose is that it never receives them would hand the community exactly what the mode withholds, and the user would not know |
| Applicant checklist, again | In hidden mode there are **no statement credentials to hold**, so the checklist cannot be a list of held credentials either. It renders what the community answered. It renders what the agent has verified and counted | A UI that lists credentials shows an empty checklist to an applicant who has in fact been vetted three times |
| Submitting, and re-submitting | The freshness challenge is minted by the community and spent when the proof is counted. Answering a "needs more" outcome means asking for a **fresh** challenge and building a fresh proof; the app never re-sends a stored proof | A proof verifies as often as it is submitted, so a challenge that survives its first use is not a freshness anchor |

Keyring as vetter is new scope. The vetting subtask makes Keyring the *applicant* (its P6) and tests against a headless openvtc vetter (its §2.5). Z1 needs both roles in Keyring, and both roles re-run against upstream's own clients.

### 4.1.3 A produced proof is not an accepted proof, and the client must not pretend otherwise

Measured in `tsp-reference/ref-27-pcs-flow` on 2026-10-11, with the published engines: offering **one** voucher's attestation **twice** produced this sequence —

- the engine **accepted** the duplicate and reported holding two;
- it **built a submission** from them without complaint;
- the community **counted them as one voucher** and answered `satisfied = false`, `needs: 1`.

Distinctness is therefore enforced where it must be, at verification, and the client is deliberately dumb. Three rules follow, and they are UI rules rather than cryptographic ones:

1. **Never present a built proof as an outcome.** "Your proof is ready" must not read as "you are in".
2. **Never count held attestations as progress.** Two from one voucher look like two on the phone and count as one at the community, so a counting checklist tells a user they are ready when they are not.
3. **Render the community's `needs`.** The engine reports what is still required rather than a verdict, which is what a screen should show.

This is the same asymmetry the *named* path already documents in `bifold/packages/trust-tasks/src/vetting/evaluate.ts`: the client counts vouchers by DID while a community counts by member record, so *"the client can be optimistic where the community is not. It can never be the other way round."* Hidden mode inherits it under a different mechanism.

### 4.1.2 What the phone path would actually cost, if it is ever chosen

Measured and read on 2026-10-10, so the choice is not made on guesses:

- **It is not cryptography we would write.** `openvtc-vetting-pcs` is published on crates.io (0.5.0, Apache-2.0, 2026-10-03) and its `ApplicantEngine` already carries the whole state machine — `new`, `id`, `snapshot`, `restore`, `held`, `statement_meta`, `receive`, `replace`, `submit`. The work is a Rust→UniFFI native module plus key storage and screens, which is the shape of both our hardware-attestation module and upstream's own mobile agent.
- **Speed is not a constraint.** The library's own bench at k = 5, run here: prove 11.7 ms, verify 10.4 ms, attest 2.5 ms (§2.2). Several times that on a phone is still imperceptible in this ceremony. This also reproduces upstream's "≈12 ms" claim independently, which until now this plan could only cite.
- **The real costs are supply chain, not latency.** An unaudited proof library inside the shipped app — upstream keeps it off by default in their own service for that reason (C6a); arkworks across three architectures in the app's build; a dependency whose own header calls it a *"Throwaway prototype … Nothing here is production code"*; and the loss of the hardware-attested approval, which is what §3.2 duty 1 exists for.
- **What a pure-JavaScript path would cost, and why it is not the plan.** No JS implementation of this construction exists, so it would mean writing the scheme ourselves on `@noble/curves`, and `ref-03d` measured Hermes at roughly 15× Node on the primitives — seconds, not milliseconds, for a proof of this shape. Ruled out on both counts.

### 4.1.1 What hidden vetting forbids a community to ask for, and why it touches us specifically

**A community that required a relationship credential with its vetters could not run hidden vetting at all.** A VRC names both ends by construction, so requiring one would hand back precisely what the proof withholds. This matters to Keyring more than to any other client, because minting VRCs is what we do: the temptation to strengthen a vetting criterion with "and hold a VRC with your vetter" is real, and it is self-defeating in hidden mode. Membership does not require a VRC pair in any case ([`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) §3.1), so nothing we ship today depends on it. Recorded here so the idea is refused with a reason rather than re-proposed.

### 4.2 Z2 — Private presentation of Keyring's credentials

This is the DTG pairwise construction ("disclose persona DIDs while hiding the R-DIDs"), the community-anchored construction, and `bbs-2023` selective disclosure, over VRCs, witness credentials (VSCs after [`vsc-migration-plan.md`](./vsc-migration-plan.md)) and memberships. Proving runs in the VTA (§3.1) from deposited copies (§3.4), presentation goes through `credential-exchange/present`, and consent works as in §3.2.

Two standing constraints are inherited and not re-decided here. Edge-binding verification and selective disclosure are mutually exclusive in one presentation, and edge-binding is what we keep ([`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) §4.6 item 3). Presenting outcome evidence forfeits unlinkability for that show ([`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §4.6). The ZK constructions themselves are the ZKP task force's deliverable (DTG ZKP V1.0), so Z2 consumes them and does not design them.

Four more inherited constraints decide what a ZK presentation of our credentials can hide, and each is already measured or tracked:

- **The citation of a Trust Task is a durable correlator.** `taskContext` and `taskDigestMultibase` link every presentation that carries them. Upstream tracks carrying the citation in committed form, opened inside the proof ([cred-spec#58](https://github.com/trustoverip/dtgwg-cred-spec/issues/58), ZKP record 008), and blinding the unsalted, enumerable digest-valued members ([cred-spec#38](https://github.com/trustoverip/dtgwg-cred-spec/issues/38)). The identifier commitment profile ([dtgwg-zkp-spec#11](https://github.com/trustoverip/dtgwg-zkp-spec/pull/11)) covers both. Z2 presents what those settle and invents no blinding of its own.
- **Salting is optional to produce and mandatory to honour.** A digest-valued member may arrive salted, and a verifier that ignores the salt computes the wrong digest and rejects a valid credential; one that requires a salt rejects an unsalted one. Keyring's read path must accept both and follow whatever the credential carries. This is the read-side half of the enumerable-digest problem below, and it is ours to get right whether or not we ever produce a salt.
- **The ZK-openable commitment lives with the identifier, not in the signature.** `eddsa-jcs-2022` is the RECOMMENDED credential proof, so the commitment a proof opens is a member of the credential and not a property of the proof (the same record set). This fits §3.4: the device-signed JCS proof stays, and the VTA's ZK half opens members the credential already commits to.
- **Anything unmapped by `@context` is invisible to `bbs-2023`.** A member with no term definition is absent from the signed RDF graph, so it can be neither signed nor disclosed. An unresolved CURIE is signed verbatim as an IRI with the wrong meaning (`tsp-reference/ref-07c-predicate-coverage`). An unbundled context means a network fetch at verification time (`ref-07d-vocabulary-trust-path`). Keyring's extension members must be termed before a `bbs-2023` half is issued over them.
- **Upstream's named vetting statement is a VSC, and has been since 2026-10-01.** The design document's tables describe it as a **Vetting Statement VSC** (`vetted/1`, `VettedObjectValue`) rather than a `VEC` ([[PCS-DESIGN]] `:62`, `:753`), but that is the *document* catching up with code: the change shipped in openvtc `e165bd5` (#397, *"DTG Credentials v1 — role VACs, `vetted`/1 and `witnessed`/1 statements, `issuerScope`"*, merged 2026-10-01), which carries `vetted/1` in `openvtc-core` itself. Treat it as settled behaviour, not as news. Two consequences: the vetting statement and the witness credentials of [`vsc-migration-plan.md`](./vsc-migration-plan.md) now share one credential type, so those workstreams meet there; and hidden mode is unchanged, because it issues **no statement credential at all**. **Keyring already reads both**, so nothing is owed here: `vettingStatementBody()` accepts the legacy `credentialSubject.endorsement.type` and, for a `StatementCredential`, `credentialSubject.predicate === VETTED_V1_PREDICATE`, returning `object.value` (`bifold/packages/trust-tasks/src/vetting/statementShape.ts:76-86` at bifold `7835757b`; the predicate constant is `:22`). It is called from the inbox, the vetting module and the eligibility check. Writing is separate and mode-gated (`core/src/modules/trust-tasks/module/dtgV1Writing.ts:61`, `:173`); reading always accepts both. Verified by reading that tree, not by running its tests.
- **The VSC input shape.** After [`vsc-migration-plan.md`](./vsc-migration-plan.md) lands, a proof over a witness credential reads `credentialSubject.predicate`, `credentialSubject.object.digestMultibase` (computed without the VRC's top-level `proof`), a top-level `taskContext`, and Keyring's extension members beside `witnessContext`. ZK4 targets that shape, not WD02's `WitnessCredential`.

### 4.2.1 A completion confirmation is a credential, and disclosing one is a choice with a cost

Proof that a trust task completed is moving towards a plain credential: a *confirmation* whose claim is that a named task completed, carrying a digest of the completed task and signed by whoever completed it, **held by the party it concerns and disclosed only when they choose**. Three consequences for this plan, and they pull in opposite directions:

- **It fits our outcome-evidence design rather than displacing it.** [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §4.6 keeps outcome evidence on the artifact side of the credential/artifact wall; a confirmation is a credential *about* a completed task rather than a claim smuggled into an unrelated one, so the wall stands.
- **It carries a durable correlator, so §4.2's first bullet covers it.** A digest of one completed task is the same linking value under a different name: two presentations that include the same confirmation are linkable, whatever else is hidden. Our unlinkability caveat therefore extends to confirmations, and the UI must not treat "disclose the confirmation" as a free extra.
- **Holder choice is a screen, not a default.** Because disclosure is optional, something has to ask. That belongs with the disclosure consent surface of §3.2, and the honest wording is what it costs: *shows that this task completed, and links this show to any other where you showed it.*

### 4.3 Z3 — Predicate proofs and uniqueness pseudonyms, watch only

This covers Groth16 predicate proofs with scoped nullifiers (personhood, liveness attestations, "one human, one membership"), which [[VETTING-DESIGN]] §14.2 lists for V2 (*"Uniqueness pseudonyms"*; Sybil resistance across `joinDid`s, §13.4). Upstream has deferred the prover. The trusted-setup ceremony is unsolved for production. Keyring's share is the same consent and rendering as Z2. Z3 has no phases. It gets a phase when upstream ships a VTA task for it.

## 5. Constraints

| # | Constraint | Source |
|---|---|---|
| C1 | The proof engine is the member's VTA and the verifier is the community's VTC; the client is *"the UI and the message carrier only"* | [[PCS-DESIGN]] C7 `:604-610` |
| C2 | Hidden mode requires the vetter's VTA operator — *"or a party colluding with it"* — and the mediator operator to differ from the VTC operator; the manifest states it and the client warns | [[PCS-DESIGN]] C7 `:619-621` |
| C3 | Token fetches are *"scheduled and unconditional, at a random moment within the tick window"*; a fetch made because a batch ran low *"says 'busy'"*, and a directory toggle is *"a per-vetter signal"* — decline with `atCapacity` instead | [[PCS-DESIGN]] `:214`, `:350-351` |
| C4 | *"Never mix named and hidden vetting within one criterion"* — otherwise one vetter *"would count twice"*; a criterion is either `mode: named` or `mode: hidden` | [[PCS-DESIGN]] `:483-485` |
| C5 | Anything a vetter sends anonymously goes from a fresh identifier, never the member DID or the session DID | [[PCS-DESIGN]] §6 leak table; ours in application to the UI |
| C6 | *"Implementations SHOULD make ZKP presentation the default behavior so that users obtain privacy preservation without having to opt in"* | DTG Core Credentials, as quoted in [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §4.6 |
| C6 -- b | Mediated (agent-side) proving *"MUST NOT be the only path available to a holder"* ([[ZKP-SPEC]], in a section marked informative — see §8) | [[ZKP-SPEC]] |
| C6a | The construction's library is *"a research artefact and unaudited"* ([[W39]]). No community with real members should rely on it before an independent review, the same gate [[VTI-CRED-ARCH]] D4 sets for BBS | [[W39]]; ours by analogy |
| C7 | Holders need no BLS key to derive a BBS disclosure; only durable `did:webvh` issuers mint BBS credentials; BBS is gated on an independent audit | [[VTI-CRED-ARCH]] D4, §4 |
| C8 | *"Do not build a second copy of anything the agent already is"* | [[AGENT-STATE]] |
| C9 | ZK over vetting is a V2 non-goal of the current ceremony: *"ZKP predicate claims; k-of-n proofs over hidden vetters"* | [[VETTING-DESIGN]] §1, §14.2 |
| C10 | *"The cryptography carries the privacy. The accreditation framework carries the assurance."* | [[ZKP-TF]] |

## 6. Phases

Each phase starts only on instruction. Every phase that touches upstream behaviour starts by advancing the relevant pin at a boundary and re-running the reference ladder (the `openvtc-workspace` rule).

### ZK0 — Baseline and access

- **Done, as of 2026-09-29.** `predicate-credential-system` 0.1.0 is published on crates.io under **MIT**, with its source at `OpenVTC/predicate-credential-system`; pin that repository in `external/` via `setup-external.mjs`, Both are now pinned: `predicate-credential-system` at `62de5ab` — **deliberately the published 0.1.0 release rather than that repository's `main`**, because this plan's claims are about the crate an implementer can depend on, and `vtc-service` refuses git dependencies. The advance is not worth re-proposing: the three commits between `62de5ab` and its `main` (`4be45985`, which the Eucalyptus milestone tags) change `Cargo.lock` only — 8 lines, no `Cargo.toml` and no `src` — so the source is byte-identical to the published release, and a crates.io consumer resolves its own lock anyway and `OpenVTC/openvtc` at `8991f9ca` (`v0.4.0`), which carries the shipped client half and the design document this plan cites. ZK0's access half is therefore **done**; what remains of ZK0 is re-reading §2.2 and §5 against those pins whenever they move. alongside `OpenVTC/openvtc`, which is cloned but unpinned today.
- Advance the `dtgwg-trust-tasks-tf` pin from `bdae1cf9` (179 commits behind) so the hidden-vetting task schemas above can be cited and used as fixtures at a pin. Then advance the VTI pin from `187ad9cd` (vta-sdk 0.25) to a release carrying the vetting-privacy work, coordinated with the owner of the pins and the lab stack; the lab's own bump (to `3dcbfe98`) is queued behind the Farm work. The VTI advance is its own motion: it does not ride with the `dtgwg-cred-spec` advance that [`vsc-migration-plan.md`](./vsc-migration-plan.md) schedules at the start of its V0 (*"One pin, one reason, one entry in `SYNC_LOG.md`"*, §10). It shares the VTI clone repair and the `personhood.rego` re-read that plan's §7.1 needs, so do those once for both.
- Re-read §2.2's upstream-status column against the new pins and correct this plan.

**Done when:** both repositories are pinned with a `--why`; every upstream claim in §2.2 and §5 cites a file at a pinned commit; §8 B1 is closed or its owner is named.

### ZK1 — The client contract rung (`ref-2x-pcs-client-contract`)

Build a pure-TypeScript rung with frozen fixtures and no React Native imports. It takes the hidden-vetting task and reply shapes, once they are specified, and checks everything Keyring does with them: renders the vetter and applicant surfaces of §4.1 as data, binds the step-up approval's payload digest to the exact attest document, and refuses a reply that would require the client to hold ZK state (§3.2 item 4).

**Blocked on** the message definitions being published. Until then, fixtures can only be guessed, and a rung built on guessed shapes proves nothing.

**Done when:** fixtures come from upstream's published task definitions or their prototype's transcripts; `npm run -s check` is green under Node and Hermes; the README states what it does not prove (no cryptography, no real VTA).

### ZK2 — Hardware-attested step-up on the attest step

Add the approval of an attest step-up to Keyring's approvals path, carrying Secure Enclave or StrongBox evidence.

**Depends on** the VTA exposing that step with step-up, and [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) P3.

**Done when:** on a local stack, an attest by a vetter's VTA is refused until the phone approves; the approval verifies with its attestation evidence; an approval replayed against a different attest document is refused. The e2e runs on simulators for mechanics and on one real-device pair for evidence (the only way to prove attestation, per the root `CLAUDE.md`).

### ZK3 — Hidden-mode vetting, both roles

Implement §4.1's table on the screens of [`ui-ux-improvements-plan.md`](./ui-ux-improvements-plan.md).

**Depends on** ZK1, ZK2, and upstream's `vtc-service` and `vta-service` steps.

**Rides the V0 refusal machinery rather than a second copy of it.** Two facts about the built ceremony decide how hidden mode attaches, and both are recent:

- **One chooser, two refusal points.** `pickOwnVetterGrant` is the single place a vetter's own grant is chosen and its state read (keyring-bifold#70). The vetting desk refuses to *cut* a ticket while no grant is live, and the module refuses to *redeem* a ticket already in the wild, before it is spent. Hidden mode adds *at capacity* as a third standing, and it attaches at the same two points: the desk withholds, the module declines. It must not introduce a parallel notion of "can I vouch right now".
- **Grant standing is public; capacity is not.** Withholding on grant state is safe, because who holds the vetter role is already public. Withholding on *token* state is the thing hidden mode exists to hide, so capacity must surface only as a per-request decline naming when the vetter is next free, never as a change in what an applicant can observe before asking. The directory listing never toggles.
- **The two sides must tell one story.** The existing gate asserts that the desk's wording and the applicant's refusal reason agree on one fact; hidden mode extends that assertion to the capacity standing rather than relaxing it.

The refusal matrix has a harness already: `E2E_REFUSAL=dead-grant` in `run-vti-vetting.js` and `run-vetter-grant-lifecycle.js` (keyring-wallet#94, keyring-bifold#71). ZK3 adds hidden-mode cases to those rather than writing a new runner.

**Done when:** the vetting subtask's V0 e2e matrix re-runs green in hidden mode on the local stack in all four pairings (Keyring or headless openvtc as vetter × Keyring or openvtc as applicant). A test asserts that what the community can observe of a vetter's rate-limiting collection is identical whether or not that vetter vouched (C3). A test asserts that nothing of §3.2 item 4 exists in the app's store after a full admission. The demo script contains no anonymity claim on a single-operator stack (§3.5).

### ZK4 — Private presentation (Z2)

- First rung: resolve §3.4's two conditions. Measure whether an R-DID can carry a BLS G2 key and whether the cred-spec allows a proof added to a proof set after issuance, and record D2.
- Then: deposit a VRC or VSC into the VTA vault, have the VTA answer a DCQL request with a `bbs-2023` derived proof, and consent on the phone.

**Depends on** D2, the BBS audit gate (C7), [`vsc-migration-plan.md`](./vsc-migration-plan.md), and for the DTG constructions, DTG ZKP V1.0.

**Done when:** a verifier receives a presentation that verifies and discloses no R-DID; two presentations of the same credential are not linkable by any member the verifier sees; the phone's copy of the credential is unchanged by the deposit.

## 7. Interfaces with sibling plans

### 7.0 What the work in flight already gives this plan

None of this was built for zero knowledge, and three pieces of it are load-bearing anyway. Naming them here is what stops Z1 from re-deriving them later:

- **A build that can point at any VTA and any community.** Hidden mode's deployment rule (§3.5) is unsatisfiable on a build with a baked-in lab: one operator holds everything. The "any VTA, any community by link" work, and the dynamic persona and community legs behind it — a persona session rides the mediator its **own** DID document names — are what let a Keyring member sit on one operator's VTA while the community runs on another's. That is the mediator half of the same rule. So the Farm track is not a neighbour of Z1; it is the only configuration in which Z1 can be honestly tested.
- **A vetter's own grant lifecycle, already modelled.** §4.1's table is a delta on `pickOwnVetterGrant` and the desk's standing, not a new subsystem.
- **A findings discipline that upstream reads.** `docs/VTI_UPSTREAM_FINDINGS.md` is where this plan's one upstream ask already lives (VTI-Q16), in a format whose entries carry a workaround and a reference set. Every further ZK ask goes there rather than into this document.

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
- **D4 — decided 2026-09-28, and no longer open.** Agent-side proving is the default (non-exportable VTA-held key, agent proves on request); an on-phone path ships alongside it for holders who choose it (§3.1.1, §3.1.2). Revisit when [[ZKP-SPEC]] settles. What remains outstanding is upstream-side, not a decision of ours: whether a prove-as-persona task over non-exportable keys will exist (their built branch proves client-side), and: whether the published task family puts the applicant's engine behind the agent at all (note that the applicant is the party that *aggregates* the attestations into one proof at submission, so whoever holds that role holds the aggregation too); whether an offline or poor-connectivity submission is a requirement we accept; and the cost of a second proving stack in the app measured against `ref-03d`'s numbers. Does not block ZK0–ZK3, and ZK1's client contract is the same either way; it must be settled before ZK2's scope is fixed.
- **D3** — whether Keyring pursues the vetter role at all, or stays applicant-only in hidden mode. The table in §4.1 assumes both. Blocks ZK3's scope.

**Watch triggers** — the concrete artifacts whose appearance unblocks something, so a blocked item is noticed when it moves rather than rediscovered:

| Trigger | Unblocks |
|---|---|
| ~~The library gains source and a licence~~ · ~~the branches merge~~ | **both happened 2026-09-29** |
| ~~A specification to conform against~~ | **published 2026-10-08** (`dtgwg-trust-tasks-tf`); pin advance needed |
| A hidden-vetting task URI appears in any readable spec, even a draft | ZK1 (B2) |
| A VTI release whose `vta-service` carries the vetter's proof key | ZK2, ZK3 (B3) |
| A manifest field, or a Farm signal, naming the operator of a VTA or mediator | §3.5, VTI-Q16 (B5) |
| The BBS audit completes, or DTG ZKP V1.0 publishes | ZK4 (B6) |

**Decided upstream, waiting on someone else:**

- ~~**B1**~~ — **Closed 2026-09-29.** `predicate-credential-system` 0.1.0 is on crates.io under MIT, and openvtc `main` depends on the published crate rather than a git reference (`e49816c`). The audit gate of C6a is unaffected and still open.
- **B2 — closed for ZK1's purposes (2026-10-08).** The specifications exist and are published in `dtgwg-trust-tasks-tf`, with versioned payload schemas, invalid-example fixtures and generated bindings. On that repository's `main` (`7b6bb488`): `specs/vtc/vetting/hidden/{publish,show,withdraw}/0.1/`, `specs/vtc/vetting/pcs-challenge/0.1/`, `specs/vtc/vetting/vetters/pcs-root/0.1/`, `specs/vtc/vetting/vetters/pcs-tokens/0.1/` and `specs/vtc/vetting/vetters/event-mode/0.1/`, plus `specs/vetting/attestation/0.1/spec.md`, which covers the hidden path. **Every one is community-side (`vtc/`) or member-to-member** — `vetting/attestation/0.1` is vetter→applicant, its front matter naming the vetter as issuer and the applicant as recipient — so none of them is an agent task, which is consistent with B3. So **ZK1's fixtures come from published schemas and their invalid examples**, not from guesses and not only from reading someone's client. **Our pin is 179 commits behind** (`bdae1cf9`), so ZK0 now needs one more pin advance before these can be cited at a pin. What remains unpublished: what a community publishes about the mode, how a vetter enrols and collects its allowance, what a vetter returns instead of a named statement, how an applicant submits the proof, and how a withdrawal is expressed. Upstream. Blocks ZK1.
- **B3 — the agent half does not exist, and nothing upstream is building it (swept 2026-10-10).** A full sweep of ten pinned clones plus GitHub found the six `vta/pcs/*` task URIs **only in design prose** — two openvtc documents, zero code, zero schema, zero spec. `vta-service/src` contains no occurrence of `pcs`; the VTA's key-type enum is `Ed25519, X25519, P256, MlDsa44, MlDsa65` with no BLS scalar; `specs/vta/**` has no pcs/zkp/prove path; the `vetting-pcs` feature C7 proposes for `vta-sdk` does not exist. No open PR in either repository would add it (all seven open PRs are CI, release, TEE or performance), no branch is scoped for it (`zkp-pcs` merged and was deleted in both repos, carrying the **community** half and the **client** prototype), no changelog line promises it, and **there is no upstream tracking issue for C7**. Three further facts bear on §3.1 and D4:
  - **C7 carries no status, owner, timeline or milestone**, and the document's own §11 *"Order of work"* — six numbered items, from the library to `vtc-service` to openvtc — **has no `vta-service` item at all**. Its item 6 reads *"openvtc: the applicant and vetter paths"*. So the plan of record still assigns the member side to the client, and C7's placement is an un-scheduled intention rather than queued work.
  - **The shipped client path is self-described as temporary.** `openvtc-vetting-pcs/src/lib.rs:1-18`: *"Throwaway prototype of hidden-vetter admission … The engines stand in for the VTA (`vetter`, `applicant`: the PCS engine of §13 C7) and the VTC (`vtc`). Nothing here is production code."* Copying it is copying a stand-in, which is a cost Path B must be chosen with rather than discovered after.
  - **The library blocker C7 named is cleared**, which removes the main obstacle to an agent-side build without constituting one: `predicate-credential-system` 0.1.0 is on crates.io and pinned in the Eucalyptus set, so openvtc's ban on git dependencies no longer bites.
- **B3 (community half) — landed.** `vtc-service` carries the work behind a Cargo feature **`vetting-pcs`**, which its own manifest marks *"Off by default and never in `default`"* (`vtc-service/Cargo.toml:26-30` at VTI `main`; merged as `e907a34c`, #1838). There is no `vta-service` PCS engine and no `vta/pcs/*` task yet — C7 lists them as work to come (*"`vta-service` gains the PCS engine module and the key kind"*, [[PCS-DESIGN]] `:623-625`). ZK2 and ZK3 stay blocked on the **agent** half, and a lab wanting the community half must build with the feature enabled.
- **B4** — Governance acceptance of the trade hidden mode makes. The accountability machinery [[VETTING-DESIGN]] §10.5 describes — lineage, and the cascade review that re-examines everyone a discredited vetter vouched for — cannot work against vetters nobody can name. A community must decide it accepts that, and that decision is not ours. Hidden mode may never be enabled anywhere Keyring runs.
- **B5 — answered by the design, not yet by an implementation.** C7 says *"The manifest states it; the client warns when it can tell they coincide"* ([[PCS-DESIGN]] `:620-621`), so the signal is a manifest member rather than something we must invent. What remains is that no shipped manifest carries it; **VTI-Q16** (in `docs/VTI_UPSTREAM_FINDINGS.md`) becomes a question about availability rather than about design.
- **B6** — DTG ZKP V1.0 and the BBS audit. Block ZK4.

**Two parked questions are now answered by [[PCS-DESIGN]]** and should not be asked again: there *is* an intended agent-side prove task (`vta/pcs/prove`, C7 `:605-607`), and the operator-separation signal *is* meant to live in the manifest with the client warning (C7 `:620-621`). Still worth asking: whether the requirement quoted in C6-b is meant to be normative, since it sits in a section its own document marks informative.

**Time-bound: what to raise before the operation layer settles.** Three of this plan's needs are client-facing, cheap to add early and expensive to retrofit once other implementers depend on the shapes. None asks for a ZK method to be standardised — §3.6 argues the opposite:

1. **A community must publish enough for a client to warn about a thin anonymity set** (§4.1). A bucketed count of live vetters suffices; without it a client cannot tell a user whether anyone is actually hidden.
2. **The extension namespace must be markable as one a client has to understand**, so a client that cannot honour it refuses rather than silently collecting named statements (§3.6, §4.1).
3. **Operator separation needs a signal a client can read** (B5), or §3.5's deployment rule is unenforceable by any client.

## 9. Review index

| Date | Companion | Driven by |
|---|---|---|
| 2026-09-22 | [`2026-09-22-al.md`](./zero-knowledge-plan/2026-09-22-al.md) | Opening research: where proving belongs ([[VTI-CRED-ARCH]], [[AGENT-STATE]]), the 2026-08-05 position it supersedes, what the work in flight decides, and the public-sources pass of 09-23 |

## 10. Sources

- `external/openvtc/docs/design/vetting-process.md` at `177a218` (§1 non-goals l. 66; §10.5 accountability l. 1127; §14.2 l. 1542; D19 l. 1595).
- `external/verifiable-trust-infrastructure/docs/05-design-notes/vti-credential-architecture.md` at `187ad9cd` (D4 l. 23; §4 ll. 125–215); `vta-service/src/operations/credential_exchange.rs` at `187ad9cd` (the `Bbs2023` and `Zkp` arms).
- `external/vta-browser-plugin/packages/core/src/persona/consent-view.ts` at `9643c57`.
- `tsp-reference/ref-03d-bls12-381-hermes/README.md`.
- [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §4.5–§4.6; [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) §4.6; [`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) §2.4, §2.6, §3.9.
