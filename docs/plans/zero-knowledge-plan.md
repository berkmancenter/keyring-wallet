# Zero-knowledge in Keyring — where the proofs live, and what the wallet does about them

**Status:** Proposed. No code written. **Held at ZK0 by decision, not by drift:** the client half of hidden vetting cannot be designed against guessed message shapes, so this plan waits for upstream's specifications and services rather than starting early and rewriting later. Until then it tracks upstream and keeps its dependencies current.
**Reasoning:** [`2026-09-22-al.md`](./zero-knowledge-plan/2026-09-22-al.md) — the research behind §2–§4: the positions it supersedes (on-device proving), the evidence for each, and what was not verifiable.
**Siblings consulted:** [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §4.6 owns the credential-format decisions this plan inherits (VRC/VWC proof sets, evidence commitments, canonical transcript); [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) owns the VTA client architecture, consent card and approvals this plan's step-up rides on; [`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) owns the V0 vetting ceremony that hidden vetting keeps unchanged, and its §2.4 decision gates Track Z1; [`vsc-migration-plan.md`](./vsc-migration-plan.md) owns the witness-credential type Track Z2 would present; [`ui-ux-improvements-plan.md`](./ui-ux-improvements-plan.md) owns the vetting screens Track Z1 changes.
**Dependency direction:** nothing in the sibling plans waits on this one. This plan waits on upstream (§8) and on two sibling decisions (§3.3, §3.4).
**Sources:** this plan cites **only publicly available artifacts**. Where it states a design position with no citation, the position is **ours**, reasoned from those artifacts — not a report of someone else's unpublished design.
**Baseline (read 2026-09-23):** our pins — VTI **187ad9cd** (vta-sdk 0.25.0), `vta-browser-plugin` **89d70c4** (advance to **9643c57** in flight); `OpenVTC/openvtc` clone **177a218** (not in `PINS.json`). Upstream heads re-checked 2026-09-23 — openvtc **5453239**, VTI **c595bcb9**: no hidden-vetting or predicate-credential code in either, and `vetting-process.md` still lists the work as V2. A predicate-credential library of the kind this construction needs is not publicly available to us (§8 B1). `trustoverip/dtgwg-zkp-tf` **a42bf8c0**, `mitchuski/dtgwg-zkp-mage` **1be94c80**, `affinidi/affinidi-zkp-crypto-rs` **c23a4b71** (public, not cloned). The running stacks are not on the reference pins: the local lab runs VTI **a96fe02f**, with a bump to **3dcbfe98** queued; Farm VTAs run vta **0.37.1** (`d9a5be02`). ZK0 reconciles all three.

**References:**

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

| | BBS signatures (`bbs-2023`) | Predicate credentials (Σ-protocols) | Circuit SNARKs (Groth16) |
|---|---|---|---|
| **Proves** | "An issuer signed a credential containing these claims," revealing only the chosen claims; two shows are unlinkable | "k pairwise-distinct credentialed users attested to this identifier," and nobody learns which | Any statement expressible as a circuit: "signature valid ∧ predicate true ∧ nullifier = H(secret, context)" |
| **Math** | Pairing-based signature over BLS12-381; the holder derives a proof of knowledge of the signature | Σ-protocols made non-interactive by Fiat–Shamir over a pairing-friendly curve; pseudorandom *tags* stand in for identities; blind issuance | R1CS circuit (circom), BN254 curve, Poseidon hashing; constant-size proof |
| **Cost** | Proof derivation is a public operation on the issuer's signature; the holder needs **no** BLS key ([[VTI-CRED-ARCH]] §4) | Constant-size proof; proving and verifying are both cheap on server hardware. No public benchmark we can cite | ≈680 ms to prove, 721 B proof, on the lab's 11 523-constraint circuit ([[ZKP-TF]] lab) |
| **Setup** | None | None beyond the issuer's keys | A **per-circuit trusted-setup ceremony**; the lab's is lab-only |
| **Upstream status** | Adopted, not built: `affinidi-bbs` over `bls12_381_plus` and `bbs_2023` in the TDK, gated on an independent audit ([[VTI-CRED-ARCH]] D4) | Listed as V2 scope — *"k-of-n proofs over hidden vetters"* ([[VETTING-DESIGN]] §14.2). No public specification yet | A `CredentialFormat::Zkp` variant exists; "the Circom circuit + Groth16 prover/verifier (server-side VTA proving) live outside it and are deferred" ([[VTI-CRED-ARCH]] §4) |
| **Our track** | Z2 | Z1 | Z3 |

### 2.3 The building blocks, in the words the specs use

- **Pairing / BLS12-381.** A bilinear map e(aP, bQ) = e(P, Q)^{ab} on a pairing-friendly curve. It lets you check relationships between hidden exponents, which is what BBS and PCS both rely on. Phone secure elements do **not** support this curve: the Secure Enclave is P-256 only, and StrongBox is P-256, RSA and (API 33+) Ed25519. This is a hardware fact, and it matters for §3.1.
- **Tag / nullifier.** A deterministic, pseudorandom value derived from a secret and a context. The same secret in the same context always gives the same tag, which is how distinctness is counted and double-use is caught. A different context gives an unlinkable tag. PCS calls these tags; the DTG task force calls them scoped nullifiers.
- **Blind signature.** The signer signs a value it cannot see and cannot later recognise. A predicate-credential scheme uses it to issue vetter credentials, and to hand out rate-limiting tokens, without the issuer learning which token belongs to whom.
- **Issuer, or *helper*.** The literature's name for the party that issues the credentials and tokens and verifies the proofs. In our ecosystem that role is **the VTC**; the party that proves is the member's **VTA**.

### 2.4 What a zero-knowledge proof does not give

- **Privacy, not assurance.** The ZKP task force states the boundary: *"The cryptography carries the privacy. The accreditation framework carries the assurance."* A proof shows that a valid attestation is held, not that the determination behind it was correct.
- **Distinctness, not independence.** A threshold proof shows the vetters are distinct people. Whether they are *independent* still comes from declared relationships, and the VTI specification forbids upgrading one into the other (VTI-CMP-070/071).
- **Computational anonymity only.** These constructions rest on discrete-log-style assumptions that a quantum attacker breaks. An attacker who collects records today could later link one vetter's attestations to each other — and could name that vetter if the issuer also kept whatever identified them at enrolment. Deleting that enrolment record is therefore part of the design, not an operational nicety.
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

**So, split by role:**

- **Vetter side — settled, the VTA proves.** Points 2 and 3 are decisive: an unattended collection schedule and a single source of truth for what has been spent are not things a phone can offer. A Keyring user who vouches does so through their agent.
- **Applicant side — open (decision D4, §8).** None of that binds here. The applicant's secret is minted for one application and discarded with it, there is no schedule to keep, nothing is rate-limited, and the applicant is not hiding from anybody: the community learns their join DID at submit in either design. So the phone proving for itself is defensible, and it would work offline and keep the applicant's secret off any server. Against it: a second proving stack to ship and maintain in the app, for a party that gains no privacy from holding it, and a split architecture where the vetter's side lives in the agent and the applicant's does not. **This plan's working assumption stays "the VTA proves both sides", because it is the simpler client and matches §3.2 — but it is an assumption, not a finding, and D4 records what would decide it.**

**Rejected for the vetter's side: proving on the device.** It is feasible. BLS12-381 runs on the app's Hermes and gives byte-identical output to Node, at about 15× Node's cost (a pairing is 96.7 ms, a BLS verify 146 ms; `ref-03d`), and the DTG lab's Groth16 prover runs in about 680 ms. For a vetter it is still ruled out by points 2 and 3: it cannot keep an unattended schedule, and it creates a second source of truth for what has been spent. For an applicant those objections do not apply, which is exactly why D4 is open rather than closed — and `ref-03d` is the measurement that says the phone could carry it if we chose to.

### 3.2 What Keyring does

Four duties, none of them cryptographic beyond the signature Keyring already makes:

1. **Gate the consequential operation with a hardware-attested step-up.** Vouching for a person is the most consequential thing a member does, and [[VETTING-DESIGN]]'s own target for signing a vetting statement is *"step-up always (passkey / device)"* — a gate its V0 cannot apply, because the client holds the key. Keyring approves the attest step (whatever task name the specification gives it) through the approvals path ([`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) P3) with a Secure Enclave or StrongBox signature and its attestation evidence. This is where Keyring is ahead of the reference clients, and it is Z1's one contribution beyond UI.
2. **Render what the VTA says, as data.** Proof requests, disclosure previews, checklists and outcomes are the VTA's replies, rendered. A predicate claim is shown as the strongest outcome on the screen, not as a missing value ([[CONSENT-VIEW]]: *"A predicate claim discloses no value at all — that is the whole point"*). The preview comes from the code that will act ([`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) §3.9).
3. **Carry the ceremony.** The V0 vetting ceremony — ticket, request, session, signed Vetting Card, match code, human check ([[VETTING-DESIGN]] §3) — needs no change for hidden mode: what changes is the artifact the vetter returns and what the VTC checks, neither of which the client composes.
4. **Keep no ZK state** (under the working assumption of §3.1; D4 would narrow this to the vetter's side only, and note that the phone already borrows persona *signing* keys today, so this is a rule about proving material rather than a general "no secrets on the device"). No ZK secret, rate-limiting token, attestation, tag or proof is persisted on the phone, and none is cached for display. The boundary [`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) §2.6 draws ("no local mirror of state a counterparty owns") covers all of it, because the VTA owns it. Idempotence ledger entries for in-flight tasks are the one exception, and they are ids, not ZK material.

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

**Our rule, and the reason for it.** Whichever component proves on a vetter's behalf can compute every tag that vetter produces. Anonymity therefore holds against the community, other members, applicants and the mediator — but never against the vetter's own agent. That is the same trust already placed in a VTA for persona keys, so it is acceptable; what is not acceptable is one operator holding both sides. Hidden mode requires that the operator of the vetter's VTA, and of the mediator, is not the operator of the VTC. Two consequences for sibling plans:

- **The Farm.** [`keyring-on-the-vta-farm.md`](./keyring-on-the-vta-farm.md) targets a Farm-hosted VTA. If one operator hosts both a member's VTA and the community's VTC, hidden mode is void for that member, and Keyring should warn rather than let the vetter believe they are anonymous. Keyring cannot detect operator identity by itself, so this needs a manifest or Farm signal (§8 B5).
  Today the Farm hosts VTAs and the mediator, and the first community VTC runs on a separate operator's stack, so the rule currently holds there.
- **The local stack.** Our development stack runs VTA, VTC and mediator on one host under one operator. That is fine for testing mechanics. No demonstration on it may describe vetters as anonymous from the community.

## 4. Tracks

### 4.1 Z1 — Hidden-vetter admission, upstream-led

The protocol, the services and the message definitions are upstream's to build; Keyring's slice is the client and the step-up of §3.2. The table is what we propose the client must do, derived from §2.4's leak list — each row exists to close a leak that no proof can close:

| Surface | Hidden-mode behaviour | Why (leak it closes) |
|---|---|---|
| Accepting a vetting request | The agent sets aside the vetter's rate-limiting allowance when the request is accepted, not at the end. With none free, decline with a capacity reason and a time it is next available | No one sits through a whole session only to find the vetter cannot vouch |
| Vetter availability | **No "accepting requests" toggle** in hidden mode. Decline individually | The toggle is the busy-vetter signal hidden mode removes |
| Personal vetting limit | A vetter wanting to do less than their allowance sets it as a local preference; the agent still collects on the normal schedule | The preference never becomes visible to the community |
| Attest | Hardware-attested step-up approval of the attest step | [[VETTING-DESIGN]]'s stated target gate (§3.2) |
| Applicant checklist | Rendered from the attestations the applicant's agent has already verified on receipt | A bad or unbacked attestation surfaces at the session, not at submit |
| Anonymity set | Warn the user when the community's published live-vetter count is too small to hide anyone | A small anonymity set names vetters however good the proof is |
| Submit timing | The app may delay submitting after the last session, and never shows or sends a finer timestamp than it must | Exact timings correlate a session with a submission |
| Withdrawal | A vetter withdrawing an attestation is sent from a fresh identifier; the UI never routes it through the member or session DID | The mediator would otherwise see who sent it |
| Mixed criteria | A community's criterion is either named or hidden, never both, and the UI says which is in force | Otherwise one person can be counted twice, once under each mode |
| A criterion the client cannot honour | **Fail closed.** If a community marks its hidden-vetting parameters as a criterion the client must understand, a Keyring that does not implement the mode refuses the criterion and says so — it never falls back to collecting named statements | Gathering named statements for a criterion whose purpose is that it never receives them would hand the community exactly what the mode withholds, and the user would not know |
| Applicant checklist, again | In hidden mode there are **no statement credentials to hold**, so the checklist cannot be a list of held credentials. It renders what the agent has verified and counted | A UI that lists credentials shows an empty checklist to an applicant who has in fact been vetted three times |
| Submitting, and re-submitting | The freshness challenge is minted by the community and spent when the proof is counted. Answering a "needs more" outcome means asking for a **fresh** challenge and building a fresh proof; the app never re-sends a stored proof | A proof verifies as often as it is submitted, so a challenge that survives its first use is not a freshness anchor |

Keyring as vetter is new scope. The vetting subtask makes Keyring the *applicant* (its P6) and tests against a headless openvtc vetter (its §2.5). Z1 needs both roles in Keyring, and both roles re-run against upstream's own clients.

### 4.1.1 What hidden vetting forbids a community to ask for, and why it touches us specifically

**A community that required a relationship credential with its vetters could not run hidden vetting at all.** A VRC names both ends by construction, so requiring one would hand back precisely what the proof withholds. This matters to Keyring more than to any other client, because minting VRCs is what we do: the temptation to strengthen a vetting criterion with "and hold a VRC with your vetter" is real, and it is self-defeating in hidden mode. Membership does not require a VRC pair in any case ([`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) §3.1), so nothing we ship today depends on it. Recorded here so the idea is refused with a reason rather than re-proposed.

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
| C1 | The proof engine is the member's VTA and the verifier is the community's VTC; the client is UI and message carrier | Ours (§3.1), on [[VTI-CRED-ARCH]] §4 and [[AGENT-STATE]] |
| C2 | Hidden mode requires the vetter's VTA operator, and the mediator operator, to differ from the VTC operator | Ours (§3.5); asked upstream as VTI-Q16 |
| C3 | Rate-limiting material must be collected on a schedule that does not depend on use; a client that fetches on demand, or advertises availability, reintroduces the busy-vetter signal | Ours (§3.1, §4.1) |
| C4 | Named and hidden vetting never mix in one criterion, or one vetter can be counted twice | Ours (§4.1) |
| C5 | Anything a vetter sends anonymously goes from a fresh identifier, never the member DID or the session DID | Ours (§4.1) |
| C6 | *"Implementations SHOULD make ZKP presentation the default behavior so that users obtain privacy preservation without having to opt in"* | DTG Core Credentials, as quoted in [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §4.6 |
| C7 | Holders need no BLS key to derive a BBS disclosure; only durable `did:webvh` issuers mint BBS credentials; BBS is gated on an independent audit | [[VTI-CRED-ARCH]] D4, §4 |
| C8 | *"Do not build a second copy of anything the agent already is"* | [[AGENT-STATE]] |
| C9 | ZK over vetting is a V2 non-goal of the current ceremony: *"ZKP predicate claims; k-of-n proofs over hidden vetters"* | [[VETTING-DESIGN]] §1, §14.2 |
| C10 | *"The cryptography carries the privacy. The accreditation framework carries the assurance."* | [[ZKP-TF]] |

## 6. Phases

Each phase starts only on instruction. Every phase that touches upstream behaviour starts by advancing the relevant pin at a boundary and re-running the reference ladder (the `openvtc-workspace` rule).

### ZK0 — Baseline and access

- Obtain the predicate-credential library this construction needs — published, or otherwise readable — and pin it in `external/` via `setup-external.mjs`, alongside `OpenVTC/openvtc`, which is cloned but unpinned today.
- Advance the VTI pin from `187ad9cd` (vta-sdk 0.25) to a release carrying the vetting-privacy work, coordinated with the owner of the pins and the lab stack; the lab's own bump (to `3dcbfe98`) is queued behind the Farm work. The VTI advance is its own motion: it does not ride with the `dtgwg-cred-spec` advance that [`vsc-migration-plan.md`](./vsc-migration-plan.md) schedules at the start of its V0 (*"One pin, one reason, one entry in `SYNC_LOG.md`"*, §10). It shares the VTI clone repair and the `personhood.rego` re-read that plan's §7.1 needs, so do those once for both.
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
- **D4** — §3.1: does the **applicant's** proof run in the VTA (this plan's working assumption) or on the phone? The ceremony layer already borrows persona secrets to the phone and signs there (§3.3), so the working assumption is the weaker side of this argument; two of the subtask's open questions — whether borrowed keys may persist, and where the card lives — should settle it. What else decides it: whether the published task family puts the applicant's engine behind the agent at all (note that the applicant is the party that *aggregates* the attestations into one proof at submission, so whoever holds that role holds the aggregation too); whether an offline or poor-connectivity submission is a requirement we accept; and the cost of a second proving stack in the app measured against `ref-03d`'s numbers. Does not block ZK0–ZK3, and ZK1's client contract is the same either way; it must be settled before ZK2's scope is fixed.
- **D3** — whether Keyring pursues the vetter role at all, or stays applicant-only in hidden mode. The table in §4.1 assumes both. Blocks ZK3's scope.

**Watch triggers** — the concrete artifacts whose appearance unblocks something, so a blocked item is noticed when it moves rather than rediscovered:

| Trigger | Unblocks |
|---|---|
| The predicate-credential library becomes readable or published | ZK0 (B1) |
| A hidden-vetting task URI appears in any readable spec, even a draft | ZK1 (B2) |
| A VTI release whose `vta-service` carries the vetter's proof key | ZK2, ZK3 (B3) |
| A manifest field, or a Farm signal, naming the operator of a VTA or mediator | §3.5, VTI-Q16 (B5) |
| The BBS audit completes, or DTG ZKP V1.0 publishes | ZK4 (B6) |

**Decided upstream, waiting on someone else:**

- **B1** — A readable predicate-credential library. We have found none published that implements this construction, and a service that publishes to crates.io cannot depend on a git-only crate in any case. Who publishes it, and under what licence, is not ours to decide. Blocks ZK0.
- **B2** — The message and task definitions for hidden vetting: what a community publishes about the mode, how a vetter enrols and collects its allowance, what a vetter returns instead of a named statement, how an applicant submits the proof, and how a withdrawal is expressed. Upstream. Blocks ZK1.
- **B3** — Hidden-vetting support in `vtc-service` and `vta-service`. Upstream. Blocks ZK2 and ZK3.
- **B4** — Governance acceptance of the trade hidden mode makes. The accountability machinery [[VETTING-DESIGN]] §10.5 describes — lineage, and the cascade review that re-examines everyone a discredited vetter vouched for — cannot work against vetters nobody can name. A community must decide it accepts that, and that decision is not ours. Hidden mode may never be enabled anywhere Keyring runs.
- **B5** — A signal a client can read that the VTA and VTC operators differ (§3.5). Not designed anywhere yet. Raised as **VTI-Q16** in `docs/VTI_UPSTREAM_FINDINGS.md` (on `main`, `a5f5cab`), which cites only published sources.
- **B6** — DTG ZKP V1.0 and the BBS audit. Block ZK4.

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
