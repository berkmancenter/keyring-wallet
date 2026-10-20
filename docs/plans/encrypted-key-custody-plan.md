# Encrypted key custody — a cloud signer no single administrator can use

> **Status: Draft.** Exploratory. Nothing is built or scheduled, and no
> decision has been asked of anyone. Filed in Keyring so it is reviewed with
> the custody positions it touches; it is not yet a commitment.

**Scope.** A small cloud service that holds and uses signing keys for
verifiable credentials, such that no single infrastructure administrator can
see or use a key, a network or storage observer cannot tell which key served
which use, and signing works while the owner's device is offline — without
paying to run every signer inside a TEE.

**Companions** (in [`encrypted-key-custody-plan/`](./encrypted-key-custody-plan/)):

| Document | Author | What it holds |
|---|---|---|
| [`2026-10-06-bam.md`](./encrypted-key-custody-plan/2026-10-06-bam.md) | BAM | The original research: the encrypted-search survey (SSE, structured encryption, ORAM, PIR, TEEs) and why a small exact-lookup store needs none of it, the threshold-signing argument, the confidential-VM and commodity-VM price survey **as of 2026-10-06**, what a confidential VM does and does not add, and hardened Kubernetes |
| [`2026-10-13-bam.md`](./encrypted-key-custody-plan/2026-10-13-bam.md) | BAM | Filing into Keyring: which of the note's eight open questions the repository now answers, the evidence for each, and the positions it supersedes |

**Related plans.** This plan does not change any of them; it is read against
them.

- [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §4.3 — Credo/Askar
  custody for TSP, private key never leaving Askar.
- [`openvtc-integration-plan/pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md)
  §9 Q2 — Secure-Enclave-generated key versus a VTA-minted one.
- [`openvtc-integration-plan/vta-carriage_subtask.md`](./openvtc-integration-plan/vta-carriage_subtask.md)
  §3 (the custody axis) and open question 7 (an autonomous tier).
- [`keyring-on-the-vta-farm.md`](./keyring-on-the-vta-farm.md) §3.2, and
  [`keyring-on-the-vta-farm/own_agent_subtask.md`](./keyring-on-the-vta-farm/own_agent_subtask.md)
  decisions D1/D2 (the owner key).
- [`../../tsp-reference/`](../../tsp-reference/) `ref-09`…`ref-12` — the
  `SigningKey` / `KeyAgreement` / `VidResolver` ports and their custody boundary.

---

## 1. Where this sits in Keyring's custody model

Keyring already has four kinds of key custody. This service would be a fifth,
and the first one designed so that no single operator can sign.

| Key | Custody today | Source |
|---|---|---|
| The credential-bearing Relationship DID's key, and the hardware attestation behind a VRC | On the phone. Attestation is P-256 in the Secure Enclave / StrongBox; it is evidence, and Keyring's differentiator | `vta-carriage_subtask.md` §3; `keyring-on-the-vta-farm.md` §3.2 |
| The agent (manager) key | Software Ed25519 in Askar on the phone, wrapped as `did:peer:2` | `keyring-on-the-vta-farm/2026-09-25-cd.md` (citing `core/src/utils/agent.ts:82-87`) |
| The owner key for an agent the person owns | Software Ed25519 in the encrypted wallet, with a fresh biometric or passcode confirmation per owner act; a hardware owner is held for Phase 3 | `own_agent_subtask.md` D1, D2 |
| VTA-held keys (personas, the VTA's own keys) | On the VTA: a *"signing oracle with policy — clients send unsigned payloads, the VTA derives the relevant key, signs in memory, and returns the signature"* ([[VTA-OVERVIEW]], quoted in `vta-carriage_subtask.md` §1). One operator, one administrative domain | `vta-carriage_subtask.md` §1; `editable-multi-profile-plan.md` (`did:webvh` personas a member's VTA mints and holds) |
| The witness-server's VWC issuer key | An Ed25519 seed or key file on the one host that runs the witness (`WITNESS_ISSUER_SEED`, `WITNESS_ISSUER_KEY_FILE`) | `bifold/packages/witness-server/README.md` (at the pinned bifold `d86785b4`) |

**What this service is not for.** It is not a home for the Relationship DID's
key or the attestation key. Moving either to a cloud signer forfeits hardware
attestation, which [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md)
§9 Q2 and [`keyring-on-the-vta-farm.md`](./keyring-on-the-vta-farm.md) §3.2
settle in favour of keeping on the device. The attestation key could not move
anyway: on iOS it is an App Attest key whose assertion signs authenticator
data, not the message (`2026-09-25-cd.md`, citing `ios/Attestation.mm`).

**What it is for — candidates, in order of fit.**

1. **Issuer keys Keyring operates.** The witness-server's VWC issuer key is the
   design's "issuer key" case exactly: it signs for everyone it witnesses, it
   must sign with no owner online, and today one host administrator holds it
   whole. This is the first candidate.
2. **The autonomous tier's key**, if that tier is built. `vta-carriage_subtask.md`
   open question 7 leaves undecided whether a fully autonomous, non-local
   relationship tier should exist, and recommends a registered
   [[AI-AGENT]]-pattern companion holding *its own new key* over growing
   `vta-service`. That companion's key is a holder-side key that must sign
   while the phone is asleep — the case this design answers. **Conditional on
   open question 7 being answered yes.**
3. **A threshold alternative to single-operator VTA custody** — an upstream
   contribution, not Keyring's to build. Named so it is not re-proposed as
   Keyring work.

## 2. Design

The recommendation from the 2026-10-06 note stands. Its reasoning — the
encrypted-search survey and why SSE, ORAM and PIR are not the tools here — is in
[`2026-10-06-bam.md`](./encrypted-key-custody-plan/2026-10-06-bam.md) §§2–4.

### 2.1 Threshold signing, 2-of-3

| Share | Where | Role |
|---|---|---|
| A | Signer 1, provider X | Online, signs |
| B | Signer 2, provider Y — a different company, account, administrator and billing | Online, signs |
| C | The owner, offline (hardware token or paper) | Recovery, re-sharing, policy changes |

- The key is generated by DKG, or split once on a trusted device, and is never
  whole on one machine afterwards. A and B sign together without the owner.
- **The scheme is FROST(Ed25519, SHA-512) (RFC 9591).** Keyring's signatures
  are Ed25519 only — Trust Task proofs and JWS are `eddsa-jcs-2022` / `EdDSA`,
  and its verifier rejects other suites (`2026-09-25-cd.md`, citing
  `packages/trust-tasks/src/documentProof.ts`); the witness issuer key is
  Ed25519. FROST(Ed25519) produces an ordinary Ed25519 signature, so verifiers
  need no change. Threshold ECDSA is needed only if a P-256 / ES256 consumer is
  added; none is in scope.
- **Independence is the whole security case.** Two accounts at one company, or
  two VMs under one administrator, buy almost nothing. This is the largest
  practical risk and is why §4 Q6 (which providers) is not a detail.

### 2.2 Policy at every signer

Each signer enforces policy on its own, so compromising one does not bypass it:
allowlists of verifiers or counterparties, per-key rate limits, delays on
sensitive operations, out-of-band alerts, scoped and revocable caller
credentials. Policy changes need the owner's signature (share C, or a separate
admin key).

`eddsa-jcs-2022` signs a JCS-canonicalised document, so a signer can parse
what it is asked to sign — audience, nonce, credential type, subject — and
apply policy to the content rather than to an opaque hash.

### 2.3 Limited authority online

The online quorum holds a delegated key certified by an offline root, not the
most valuable key. For an issuer, that is an `assertionMethod` key in a
rotatable DID document; compromise is answered by rotating it and revoking
through a status list. **This needs a rotatable DID**: the witness-server
accepts `did:web` as well as `did:key` and `did:peer` (`WITNESS_ISSUER_DID`),
and only the first rotates. Per-purpose keys keep one compromise from spreading.

### 2.4 Storage, integrity and metadata

- Storage is an encrypted dictionary: `label = PRF(K_label, key_id || epoch)`,
  `blob = AEAD(K_enc, record, AD = label || version)`, padded to fixed sizes;
  the server sees opaque labels, fixed-size blobs and a padded count.
- Integrity is a signed, versioned root with monotonic counters, plus an
  append-only log of signing requests held by a third party.
- Network metadata: TLS 1.3 with ECH, fixed-shape padded requests, OHTTP or Tor
  where it matters.

### 2.5 Holder keys, if candidate 2 is built

Pre-approved counterparties are signed autonomously; a new one needs a one-tap
approval from the phone. Keyring already has this approval loop: the phone as
approver is `pnm_cnm_subtask.md` P1, and [[DTTE]]'s gated task parks for up to
15 minutes waiting on a device's decision (`vta-carriage_subtask.md` §1).
Per-relationship keys keep counterparties from correlating activity; the
signing quorum still sees which counterparty.

### 2.6 How it plugs in

The TSP ports already accept an out-of-process signer. `ref-09` shows the
`SigningKey` / `KeyAgreement` ports need no change for a backend whose private
key is unreachable and whose operation crosses an async boundary, *"the shape
an out-of-process Askar RPC call would have"*; `ref-10` runs them against real
Askar custody. A threshold signer is one more `SigningKey` adapter. It provides
**signing only**: a threshold `KeyAgreement` (X25519 DH) is out of scope, so
any identity whose session needs key agreement (DIDComm authcrypt, TSP) keeps
that half elsewhere.

### 2.7 Confidential VMs: an upgrade, not the baseline

A confidential VM protects one signer's share from its own provider's
administrator; it does not protect against bugs inside the guest, does not make
two signers independent, and does not hide usage from the operator. The
baseline does not need one. If wanted, the cheapest first step is one signer on
Azure, where the 2026-10-06 survey found a 0% premium over the equivalent
standard VM. All figures, and their source quality, are in
[`2026-10-06-bam.md`](./encrypted-key-custody-plan/2026-10-06-bam.md) §§6–7
and are **as of 2026-10-06**.

### 2.8 Cost (as of 2026-10-06)

| Shape | Monthly, two signers |
|---|---|
| Two budget VPSes at different providers | about $12–50 |
| One confidential VM, one budget | about $75–100 |
| Two hyperscaler confidential VMs, different providers | about $125–150 |

### 2.9 Accepted risks

- Each signing operator learns usage for its own sessions. Autonomous signing
  and hiding usage from the signers are incompatible.
- If both providers are compromised or collude, the key is exposed; only
  policy and the delegation limit cap the damage.
- A global observer correlating timing at both ends is only partly mitigated.

### 2.10 Rejected alternatives, as standing rationale

- **SSE / encrypted search.** The store is small and looked up by exact ID; an
  AEAD dictionary covers it, and SSE leaks access patterns by design.
- **ORAM or PIR on the signers.** A signer necessarily learns which key it is
  signing with, so hiding the access from it buys nothing.
- **One confidential VM.** Still one administrative domain and one point of
  failure.
- **Client-only signing.** Strongest for secrecy, but it cannot sign while the
  owner is offline, which is the requirement for issuer keys.
- **Hardened Kubernetes as the baseline.** It addresses tampering and drift,
  not an administrator reading memory, and one cluster is one administrative
  domain. A reasonable substrate per signer later; not needed first.

## 3. Steps

Draft steps; none is scheduled.

| # | Step | Done when |
|---|---|---|
| 0 | **Decide whether to proceed and for which key** (§1 candidates; §4 Q1, Q7a) | A dated companion records the decision and names the first key |
| 1 | **FROST(Ed25519) spike** — pick a library; DKG for 2-of-3; sign an `eddsa-jcs-2022` proof with shares A+B | The proof verifies with the unmodified verifier in `bifold/packages/trust-tasks` (`documentProof.ts`), and with shares A+C and B+C |
| 2 | **`SigningKey` adapter** in the `tsp-reference` ladder, after `ref-09`/`ref-10` | The rung's fixtures pass against the threshold adapter exactly as against the Askar adapter, with both signers as separate processes |
| 3 | **Signer policy** — allowlist, rate limit, owner-signed policy change | A request outside policy is refused by each signer independently; an unsigned policy change is refused |
| 4 | **Witness issuer on the quorum** (if step 0 picks it) — the witness-server signs VWCs through the adapter, with a `did:web` issuer | The witnessed e2e (`yarn e2e:vrc:witnessed`) passes with the witness's key held only as shares |
| 5 | **Two providers in staging** | One signer at each of two named providers; recovery from share C re-shares to a replacement signer with the same public key |

## 4. Open questions

Questions the 2026-10-06 note left open, with the ones the repository answers
marked. The evidence is in [`2026-10-13-bam.md`](./encrypted-key-custody-plan/2026-10-13-bam.md).

| # | Question | Standing |
|---|---|---|
| 1 | Holder keys, issuer keys, or both? | **Answered for Keyring:** issuer keys Keyring operates (the witness first). Holder keys stay on the phone, except a future autonomous-tier key (§1 candidate 2) |
| 2 | Formats and algorithms; ES256 or EdDSA? | **Answered:** Ed25519 / `eddsa-jcs-2022`, so FROST(Ed25519). Reopens only if a P-256 consumer is added |
| 3 | Do target ecosystems require hardware-bound holder keys? | **Answered for Keyring's own credentials:** Keyring requires them itself — hardware attestation is the differentiator — so holder keys are out of scope. Open for third-party ecosystems (EU wallets, mdoc), which are not in scope |
| 4 | Is the owner present at presentation time; can new verifiers be approved from a phone? | **Answered:** yes — the phone-as-approver loop exists (`pnm_cnm_subtask.md` P1; DTTE approvals) |
| 5 | Identifier method, and how easily keys rotate | **Partly answered:** the witness accepts `did:web`, which rotates; `did:key` does not. Which DID a quorum-held witness uses is **open, ours** |
| 6 | Which two providers, and where share C lives | **Open, ours.** Not decided; the security case depends on it |
| 7 | Does this build on keyring-wallet? | **Answered:** yes — filed here as a draft by decision of the plan's owner (2026-10-13) |
| 7a | Should the autonomous tier exist at all? | **Open, ours** — this is `vta-carriage_subtask.md` open question 7; candidate 2 depends on it |
| 8 | What did the colleague mean by "hardened Kubernetes"? | **Open; waiting on the colleague.** §2.10 records why it is not the baseline under either reading |
