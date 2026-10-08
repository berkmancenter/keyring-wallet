# Delegated Batch Issuance (DBI) — Bridging KERI-Rooted Credentials to W3C, SD-JWT and mdoc

*Living plan for the DBI workstream. Separate from, but linked to, [`openvtc-integration-plan.md`](./openvtc-integration-plan.md): DBI reuses its Trust Task carriage and VTA key-management interface, and adds no dependency on TSP.*

**Reviews that shaped it** — each records its own reasoning and disposition; this plan states only the current position:

| Driven by |  |
|---|---|
| [`2026-10-07-bam.md`](./delegated-batch-issuance-plan/2026-10-07-bam.md) — Brendan (BAM). Design rationale and research (Parts I–VII); the independent review's findings, dispositions and revocation rationale (Part VIII); the scoping of the unresolved issues — the Path A/B analysis, custom-circuit scope, rate limiting, status mechanism, exact signed bytes, did:webs, the Part IV quotes — with every estimate's derivation and the old-to-new section and question numbering (Part IX); the Utah KERI constraint, the full Path A/B tradeoff, dual issuance and the decision that follows (Part X, D14); the zkVM Ed25519 benchmark, its limits and the decision that follows (Part XI, D15) |

---

## 1. Purpose

A state issues an official identity credential (the motivating case is Utah's SEDI credential) whose trust root is KERI: an identifier whose key log anyone can verify. Verifiers and wallets in the W3C, SD-JWT VC and ISO mdoc worlds cannot consume a KERI-native credential directly. DBI lets the holder present the state's credential to them such that:

- the verifier can trace what it is shown to the state's key state without trusting the holder's agent (**end-verifiable**);
- authority flows from key state the controller anchors, never from a host or registry (**controller-rooted**);
- the holder decides what each presentation reveals (**holder-chosen disclosure**);
- the state learns nothing about presentations, and no two presentations, nor a presentation and the primary, can be linked except through the residual channels of §5.4. This pulls against the first two properties; the resolution is that the chain is **provable, not shown**: a zero-knowledge proof relates what the verifier sees to the state's signature, and no stable primary-derived value appears in it. A verifier may ask the holder for the full chain; the holder may decline.

## 2. The source proposal and this plan's departures

*Delegated Batch Issuance (DBI)* — SEDI Interop Working Group, 2026-06-18 (Drummond Reed, Brendan Miller, Alberto Leon), read only through a condensed summary. The issuer gives the holder a **primary credential** and a **DBI credential** that "cryptographically delegates to the holder's verifiable trust agent (VTA) the capability to re-issue the primary credential as any number of secondary credentials"; the DBI proofs "must be unlinkable", potentially by zero-knowledge proofs; the cryptographic assumptions need expert validation.

Departures, each a proposal to the working group, not a settled position: the VTA is not a KERI delegate (§5.2); "any number" is bounded by a cap and a validity bound (§5.4, §7.3); "the same holder is bound to both" is met by the primary's hidden holder key signing either the session transcript or a fresh per-secondary holder key (§7.3), never by showing the same key twice.

## 3. Architecture: B-direct, an ACDC primary

*Decided (Q1, X14): the state's primary is an ACDC, so the design is Path B with B-direct as the target; Path A and dual issuance are rejected (§6). Gate G0 (§11) decides B-direct against B-batch and whether the custom circuit is feasible.*

**Partner constraint (X14).** The State of Utah will not abandon KERI principles, so the state's primary credential is an ACDC: SAID, TEL status, KEL-anchored, edge-chainable, end-verifiable. *Provenance: stated by Brendan from ongoing communication with Utah, 2026-10-07; not from a Utah document; not yet confirmed in writing. Blocked on Brendan obtaining written confirmation from Utah; the design below is conditional on it.*

**Target.** B-direct (§7.1): the holder's VTA derives and proves everything, and the state signs no secondaries. B-batch (§7.1) is a documented variant for offline batches and format conversion. Effort (estimate; companion Part IX): 40–66 person-weeks of ZK engineering plus external audit and remediation; no calendar estimate until the Phase 0 benchmark.

**Why proofs, not signed secondaries.** Longfellow's mdoc verifier takes the issuer key as a public input checked against a trusted-issuer list and hides the issuer signature, the MSO and the device key (X1), so a fresh proof per presentation is already unlinkable. A VTA-signed secondary under an ephemeral key is therefore a carrier, not a source of trust: trust comes from the proof, and the signed secondary adds batch-timing and reuse linkage (§5.4). Format-only verifiers do not rescue it: they accept an issuer only through a certificate chain or issuer metadata, and accept ephemeral issuer keys nowhere (X5); trust-listing each holder's VTA as an issuer would make the list a registry of holders and link everything that VTA signs. did:web/did:webs issuers are accepted only by DID-aware stacks (Credo, walt.id; per library **unverified**); the EUDI stack is `x5c`-centric. mdoc's zero-knowledge carriage is for **registered** circuits (X3), so a custom circuit reaches only Keyring-aware verifiers (Q18; Google Wallet does not accept one). Format-only verifiers are served, if at all, by a separate **linkable** tier (Q22).

**Rejected, with standing rationale (§6):** Path A, a P-256 mdoc primary with KERI as key registry only; and dual issuance, an ACDC plus an mdoc projection. Utah's burden per option:

| | A (single) | A + ACDC (dual) | B-direct | B-batch |
|---|---|---|---|---|
| Issuance stacks | 1 | 2 | 1 | 1 |
| Records and revocation paths to keep consistent | 1 | 2 | 1 | 1 |
| Signs after issuance | mdoc re-issue per short validity | mdoc re-issue | nothing | nothing |
| Complexity carried by us | low | low | circuit, audit | circuit, audit |

**Decision order** (each depends on those before it): (1) written confirmation of X14 (Q1); (2) Utah's P-256 signing (Q3, gate G1) and freshness tiers (Q4); (3) issuance anchoring and KEL growth (Q7); (4) the status mechanism — adopt the Merkleized bitstring, benchmarked with signed spans (Q6); (5) the pinned ACDC protocol version and fixed-layout profile (Q8); (6) the did:webs P-256 spelling (Q9); (7) the Phase 0 benchmark and G0: B-direct or B-batch (Q15, Q19) and custom-circuit feasibility (Q25); (8) the audit budget (Q24) and the fixed-shape circuit manifest (Q17).

## 4. External constraints

Quoted where the text was read; **paraphrased** rows are Phase 0 spec reads; X14 is a partner statement, not a specification. Clones, commits and line numbers are in the companion (Part IX); Phase 0 brings them under the pins.

| ID | Constraint | Source | Consequence |
|---|---|---|---|
| X1 | `run_mdoc_verifier(circuit, pkx, pky, transcript, attrs, now, zkproof, docType, zk_spec)`: the issuer key is "currently provided as input, later one among a list of issuers"; issuer lists are "trusted inputs"; MSO, issuer signature and device key are hidden | google/longfellow-zk, `lib/circuits/mdoc/mdoc_zk.h` and its documentation | a fresh stock proof per presentation is unlinkable (§3) |
| X2 | The stock proof's public inputs include the session-transcript hash `hash_tr`, which the hidden device key signs (`verify_signature3`) | longfellow-zk `mdoc_zk.h`, `mdoc_signature.h` | no nonce-free pre-generation with the stock circuit |
| X3 | mdoc carries zero-knowledge responses for registered circuits (`ZkDocument`); verifiers pin circuits by `ZkSpec` `circuit_hash`; a circuit ID is the SHA-256 of the compressed circuit bytes, listed in `kZkSpecs` | ISO 18013-5 2nd ed. and the Digital Credentials API (**paraphrased**); longfellow-zk `zk_spec.cc` | any gate or witness change is a new spec and hash; a custom circuit reaches only verifiers that add it |
| X4 | Longfellow's experimental circuits (`anoncred`, `jwt`, `mdoc_revocation`) are "not carefully vetted ... should not be used in a production use case" | longfellow-zk `lib/circuits/tests/README.md` | a custom circuit is new, unaudited work |
| X5 | mdoc readers validate the DS certificate to a trusted IACA; SD-JWT VC verifiers accept an issuer key only via an `x5c` chain or https `jwt-vc-issuer` metadata; HAIP requires the issuer certificate and chain in `x5c`, not self-signed | ISO 18013-5; draft-ietf-oauth-sd-jwt-vc; OpenID4VC HAIP 1.0 (all **paraphrased**) | no standard verifier accepts an ephemeral issuer key |
| X6 | "`Q` \| ECDSA secp256r1 256-bit random Seed for private key", "`0I` \| ECDSA secp256r1 signature", `1AAI` (non-transferable) and `1AAJ` "ECDSA secp256r1 verification or encryption key"; the indexed table lists only "the Ed25519 and ECDSA secp256k1 schemes" | CESR specification v1.1, derivation and indexed code tables | P-256 KEL signatures rely on keripy's own indexed codes |
| X7 | "replace the SAID field value in the serialization with a dummy string of the same length. The dummy character is `#`" | CESR v1.1, SAID derivation | every SAID is recomputed over a `#`-filled serialization |
| X8 | "the Issuer must anchor an *issuance* proof digest seal to the ACDC in its KEL either directly or indirectly"; "ACDCs are not directly signed by the Issuer"; yet elsewhere "an Issuer commitment via a signature (direct) or KEL anchored seal (indirect)" | ACDC specification v1.1, issuance proof | "direct" has two senses in the spec; this plan uses only the terms of §5.1 |
| X9 | "The digest algorithm employed for generating Schema SAIDs MUST have an approximate cryptographic strength of 128 bits"; "unless a different algorithm is negotiated out of band, H is Blake3-256" | ACDC v1.1, schema SAIDs; bulk issuance | SHA2-256 SAIDs are a negotiated profile |
| X10 | Status v1.1, but examples use protocol-2.0 strings, and "Compliant ACDC version 2.XX implementations MUST support the old ... 1.x Version String" | ACDC v1.1 | the state pins one protocol version; the circuit layout depends on it (Q8) |
| X11 | "Only the Discloser can unblind the state"; each event "MUST increment the sequence number and hence the blinding factor"; registry `rd`, event SAIDs and the ACDC SAID are verifier-visible | ACDC v1.1, blinded state registries | TEL status cannot be shown privately; re-blinding reveals refresh timing |
| X12 | Minimum list length 131,072 bits; "statusListIndex is the only link between the verifiable credential and its status"; Token Status Lists are zlib-compressed | W3C Bitstring Status List (Recommendation, 2025-05-15); IETF Token Status List (draft 21) | neither can be proven in zero knowledge as published |
| X13 | "Secp256r1 public keys MUST be converted to a verification method with a type of JsonWebKey" (prefix `1AAI`/`1AAJ` removed), example `"crv":"secp256r1"`; a did:web alias "MUST NOT successfully resolve unless the resolved DID appears in a valid, unrevoked designated aliases ACDC"; `alsoKnownAs` includes did:keri; `versionId` is the KEL `s` | did:webs specification v0.10.3 (trustoverip/kswg-did-method-webs-specification) | the spec's curve name is not JOSE's `P-256` (RFC 7518, **unverified**); a did:web alias needs a TEL even where credentials do not |
| X14 | **Partner constraint, unconfirmed.** The State of Utah will never abandon KERI principles; the state's primary credential is an ACDC | Stated by Brendan from ongoing communication with Utah, 2026-10-07; not from a Utah document; not yet confirmed in writing (Brendan to obtain written confirmation; Q1) | rules out Path A and dual issuance (§6); the primary is anchored in the state's KEL and carries TEL-backed status (§5.3, Q7) |

## 5. Shared design (both paths)

### 5.1 State root and state profile

The state publishes a did:webs whose KEL is the root of trust, with a did:web as a designated alias (X13). Terms: **signed** — the state's key signs these bytes; **direct anchoring** — a KEL event's seal carries the credential's SAID; **indirect anchoring** — a KEL event seals a TEL event that names the credential.

- **ECDSA P-256 and SHA-256 only.** The proof verifies exactly that pair, so every key it checks (the state's signing key, the holder key) is P-256 and every digest it recomputes is SHA-256.- **CESR profile**: codes per X6, P-256 indexed signatures in keripy's `E`/`F`/`2E`/`2F` (fixtures record the producing implementation); SHA2-256 (`I`) for every SAID, including KEL and TEL event SAIDs (X9); an explicit next-key code on every rotation, since keripy defaults it to Ed25519, with the verification-key code asserted afterward.
- **Signatures**: ECDSA over SHA-256, raw `r||s`, under a 33-byte compressed key, so an in-circuit verifier decompresses the point, and the signing threshold `kt` is 1. Every verifier (circuit, did:webs verifier, HSM harness) accepts both `s` and `n − s` (keripy's lack of low-S normalisation is **unquoted**; Phase 0).
- **Signing tooling**: keripy, or an HSM behind equivalent tooling (signify-ts cannot sign P-256; KERIA has no P-256 handling). Single-sig and witness-free until G2 proves P-256 with witnesses or delegation.
- **did:webs P-256 representation**: we emit `JsonWebKey`, `kty` `EC`, `crv` `P-256`, uncompressed `x`/`y`, and accept `secp256r1` on input (X13, Q9). The reference resolver emits every key as OKP/Ed25519, so the representation lives in our verifier (Phase 2). A minimal TEL exists for the designated-aliases ACDC (X13).

**P-256 kill criteria and fallbacks.** Revisit P-256 if Utah cannot sign it (G1); Utah's holder identifiers cannot carry P-256 keys (Q13); a keripy P-256 log fails with witnesses or delegation (G2); verifiers the pilot needs refuse our EC representation (a did:webs rejection alone does not count); or a benchmarked zero-knowledge Ed25519 route with verifier support appears. No fallback is yet viable on a 2-CPU VTA. A zkVM guest (`ed25519-dalek`, `sha2`) is measured too slow for per-presentation proving there (benchmark, companion Part XI): RISC Zero 3.0.6 succinct proofs of a simplified statement take about 808 s with one Ed25519 verify and 1349 s with two on two physical cores (1143 s and 1910 s on one SMT core), 9.2 GiB peak, 218 KiB proof, against a 120 s ceiling for background batch proving, so 50 proofs are about 18.7 hours of two dedicated cores; its zero-knowledge property is a vendor claim, explicitly unproven, and composite proofs leak execution length; SP1 6.8.1's only zero-knowledge mode (Groth16) did not build and its accelerated compressed proofs exceeded 20 GiB. It remains a candidate only for rare or offline proving, or on a much larger or GPU prover (unmeasured). The other candidate, a custom Ed25519 Longfellow circuit (emulated field arithmetic and SHA-512), is unbenchmarked and unaudited. Longfellow's own P-256 numbers are still to be measured in Phase 0. Separately, the anchored-key arrangement (Q10) moves where the P-256 key lives but still proves P-256.

### 5.2 Holder key and the VTA

The VTA is the **holder's agent**, under each individual holder's control (*conditional on Q12*). An operator-run VTA, including the VTA Farm, is admissible only for components that never see the primary, its salts, the DBI credential or the holder key, unless Q12's trust analysis admits it.

- **No KERI delegation to the VTA** (a proposal to the working group). A delegation event sits in a KEL verifiers can see, and one from the state would reveal every holder's agent to the state. Authority rests on the holder key, proven in zero knowledge.
- **The holder key is P-256**, because the proof verifies a signature by it: the primary's holder key (§7.3; binding form Q13, rotation Q14).
- **Custody is a new seam** (Q11): VTA-side signing through the upstream VTA's `keys/sign/0.1` (ES256 with a P-256 key; Keyring has no client), or device-side signing (`hardware-signing/key.ts`) with the VTA receiving only signatures. `vtaKeys.ts` exports Ed25519/X25519 keys to the phone and is not precedent. Device-side custody answers a KERI maintainer's likely objection (in Signify/KERIA, signing happens at the edge) and limits a VTA compromise, at a device round-trip per batch or presentation; multi-device presentation needs the VTA-held form.
- **Proving runs VTA-side first** (Phase 3) as a sidecar behind the DBI interface; phone-side is Phase 4. The VTA sees the primary, its salts and the DBI credential while proving; they are the holder's own.
- **The state never sees the VTA.** After issuance it publishes status (§5.3) and nothing else.

### 5.3 Status and revocation

**Nothing a verifier sees is individually revocable, and no verifier makes a per-credential status request**: either would correlate presentations. Revocation is the state revoking the primary and the DBI credential, whose edge names it; bounded validity limits what remains outstanding. Ruled out for that reason: per-secondary status indices (a shared index links secondaries; distinct ones show the list host who checked when and reveal re-issuance volume to the state), stapled per-credential receipts (fetching one tells its issuer when each holder refreshes), OCSP-style verifier checks (a live lookup per verification, and an availability coupling), and short validity alone (enforceable only against an honest VTA). For any TEL-based flow the holder retains the ACDC, the registry identifier `rd`, the salt, the latest sequence number and the KEL seal reference.

**Status structure: a Merkleized bitstring.** *Current design pending the Phase 0 benchmark (Q6).* Each primary carries a `statusIdx` in a signed block. The state publishes its status list as a SHA-256 Merkle tree of 512-bit leaves (depth about 15 for 2^24 entries) and anchors each epoch's root in its KEL with a `SealRoot` seal (keripy `structing.py`). Holders and VTAs fetch the whole list, so lookups reveal nothing. The verifier checks the root's anchoring outside the proof; the circuit proves one leaf and its fixed-depth path, so the circuit ID does not change with list size. Standard status lists (X12) and TEL status (X11) cannot be proven privately, so neither is the proof's status source; the state's TEL remains the credential's authoritative status record (X14), from which the published list is built. **Benchmarked alternative:** signed spans — the state signs and anchors `epoch||l||r` spans and the circuit proves `l < id < r` with one ECDSA verification (Longfellow's experimental `mdoc_revocation.h`, X4); cheaper in hashing, but the state must sign spans. A sorted deny-list is not used: its path is deeper.

**In the proof.** Freshness: `validUntil ≤ min(DBI expiry, primary expiry, now + maxWindow)`, proven (§7.3). Status: the status root is a public input and the circuit proves the primary's and DBI credential's bits are clear. Honest-VTA check: the VTA refuses to derive or present.

**Tiers by use class** (*waiting on Utah, Q4*). Low assurance accepts validity alone; high assurance requires a status root no older than the class's epoch window. Emergency revocation reaches high-assurance verifiers at the next epoch and everyone within `maxWindow` (or MSO validity). `maxWindow`, the epoch cadence and the windows are state-governed parameters per use class, recorded in the DBI rules.

**Holder-initiated revocation and recovery.** On a lost phone or compromised VTA, the holder asks the state to revoke, or to re-bind to a new holder key (Q14); the holder may revoke only the DBI credential. The required authentication is Utah's (Q4). **State key events.** Planned rotation does not invalidate credentials anchored under the prior key state: verifiers accept it for proofs whose `now` precedes the rotation, until `maxWindow` after it. On compromise the state rotates to its pre-committed key and publishes an epoch marking the compromised key state; a forger can back-date `now`, bounding forgeries to `maxWindow` past the cut-off unless Q20 picks the key-state commitment.

### 5.4 Residual linkability and limits

The proof hides the primary; it does not make the holder anonymous among all holders. Remaining:

- **Disclosed values**: colluding verifiers match on what the holder discloses.
- **Public-input partitions**: every holder-varying public value or proof shape splits the anonymity set — the state key or key-state reference (per key epoch), the schema or `docType`, the circuit ID (which fixes the disclosed-attribute count and maximum block count), the proof size, and the status epoch.
- **Batch timing and reuse** (B-batch only): secondaries derived together share times; a secondary shown twice is linkable, so the wallet treats a used one as spent.

**Mitigations:** fixed-shape circuits (§7.4; acceptance in Phase 3); status epochs and key rotations as coarse as Q4's latency allows; on B-batch, `validFrom` and `validUntil` jittered independently per secondary (acceptance in Phase 1).

**Minting limits** (*decided for now*, Q16). No deployable scheme rate-limits unlinkably: a public nullifier `H(secret, epoch)` is cheap in a circuit but links one holder's presentations within an epoch, and a shared nullifier set is a registry. The DBI rules carry a `cap` per period, **enforced by the VTA only, and so only against an honest VTA**, until a stateful minting party exists. A nullifier is an opt-in tier for high-assurance verifiers that share a set.

### 5.5 The DBI interface

A narrow, compartmentalized module that knows nothing about KERI internals or the proof system.

- `present(credentials, request, sessionTranscript, status) → response`: one fresh proof per presentation (B-direct).
- `derive(primary, dbiCredential, status, request) → { secondaries[], linkageProofs[] }`: B-batch and the plain backend. Refuses when status marks the primary or DBI credential revoked, when the requested validity exceeds §7.3's bound, or at the cap.
- `verify(presentation, trustConfig, statusPolicy) → accept | reject(reasons)`: recomputes every public input from what it is shown and its own configuration, never from the proof's carrier, and checks the circuit ID against its manifest (Q17).
- **Key state and status are injected** by the did:webs verifier module ("this key state was valid for this issuer at this time"; "this status root is anchored"). DBI never verifies a KEL, so it can be built first (Phase 1).

| Backend | Proof | Role |
|---|---|---|
| Plain re-issue | none; the VTA's issuer key is trusted by configuration | interface and conformance testing only; **linkable** (one VTA key signs everything) |
| Custom linkage circuit | Longfellow, custom `ZkSpec` | target |
| BBS (`bbs-2023`) | selective disclosure | credentials the VTA itself issues; the issuer must sign with BBS, so it cannot link to a KERI-signed primary |

## 6. Rejected alternatives: Path A and dual issuance

- **Path A**: the primary is a P-256 mdoc whose MSO a DS key signs, the DS certificate chaining to the state's IACA, with KERI as the trust root for those signing keys only (Q10); the holder presents it through the stock Longfellow circuit. It violates X14: KERI becomes a key registry, so the credential is not an ACDC, its status is not TEL-based, it cannot be edge-chained, and end-verifiability is partial. Nothing of it is built. The stock circuit survives only as the Phase 0 benchmark baseline; X1–X3 and X5 stand as the reason signed secondaries are carriers (§3).
- **Dual issuance** (an ACDC authoritative, plus an mdoc projection the state also signs): it doubles Utah's operational burden, with two issuance stacks and two records and revocation paths to keep consistent (§3's table), and it duplicates the per-format issuance DBI exists to avoid. The state-issued linkable tier for format-only verifiers (Q22) has the same shape and the same cost.

## 7. Design (Path B)

Written for an ACDC primary (X14).

### 7.1 Credentials and presentation forms

- **DBI credential**: issued with the primary, validity in weeks, edge to the primary's SAID. Its rules: the holder may present from or derive from the primary; disclosed claims equal primary claims (block-granular, Q21); each presentation's holder key is authorized by the primary's holder key; validity per §7.3; `maxWindow` and the `cap`.
- **B-direct (target)**: no VTA-signed secondary. Each presentation is a fresh proof under a custom `ZkSpec`, bound to the verifier's session transcript.
- **B-batch (variant, for offline batches and format conversion)**: the VTA derives secondaries (format Q19), each signed by an ephemeral per-credential key, binding a fresh holder key, with fresh salts (never the primary's block digests, which would link every secondary to the primary) and bounded validity. The linkage proof is made at derivation without a verifier nonce; presentation freshness comes from the secondary's key-binding JWT or mdoc device authentication (Q15). It costs batch-timing and reuse linkage (§5.4) and reaches only verifiers that accept the linkage proof (Q18).

### 7.2 What the state signs

1. **Blinded attribute blocks**, each with salt `u` and SAID `d` (X7).
2. **The compact ACDC**: top-level SAID over its `#`-filled serialization carrying the block SAIDs (or the AGID); the version string's size matches the serialized length.
3. **Anchoring** (X8, Q7). Recommended, unless X14 requires a per-credential TEL (Q7): **direct anchoring of the primary and the DBI credential in one KEL interaction event** — one ECDSA verification, no TEL parse; status comes from §5.3, so a per-credential TEL adds nothing for verifiers. The indirect form (keripy's default) adds a TEL event whose seal in the `ixn` is `{"i":regk,"s":"0","d":<iss SAID>}`.
4. **The signature**: the state's P-256 key signs the KEL event's raw serialization (keripy `habbing.py`, `self.sign(ser=serder.raw)`); attachments are not signed. The signature stays in the circuit: revealing the `ixn` or its SAID reveals the issuance bucket and links presentations.

**KEL growth** (Q7). One `ixn` per credential grows the state's KEL per holder, and did:webs resolution replays the whole `keri.cesr` stream, failing on any problem. Options: batch issuances under one `SealRoot` (leaks an issuance-batch partition; whether verifiers accept a root seal for issuance is **unverified**), or a separate issuing AID.

**Fixed layout** (Q8). keripy JSON has no whitespace and a fixed field order, so with one pinned protocol version (X10) a fixed-layout profile is feasible: 44-character SAIDs, 24-character `u`, 32-character `dt`, constant offsets. Variable pieces: the hex sequence number `s` (1–3 digits: 3–4 layout variants, each its own circuit ID) and claim strings. CESR-native serialization uses fixed-size primitives and is the most circuit-friendly; its tooling maturity is **unverified**.

### 7.3 Witness, public inputs and checks

**Private witness**: the primary's blocks and salts; the compact ACDC; the anchoring event(s) and the state's signature; the DBI credential (edge, rules, expiry); the primary's holder public key and its signature; B-batch disclosure salts; the status leaf and path.

**Public inputs**, each recomputed by the verifier, each closing a substitution. Both forms: (1) the circuit ID, checked against the trusted manifest (Q17); (2) the state key, or a commitment to its key state (Q20); (3) the primary and DBI schema identifiers; (4) `now`; (5) the status root (§5.3). B-direct: (6) the session-transcript hash and disclosed attribute values. B-batch: (7) the secondary's signing key and fresh holder key; (8) a commitment to its disclosure digests (`_sd` or `valueDigests`), not to values, so claims withheld later stay hidden; (9) its `validFrom` and `validUntil`.

**The circuit checks:**

- every SAID and event digest of §7.2 recomputes per X7 with SHA-256; version-string sizes match;
- the `ixn` seals the primary and the DBI credential, and the state's signature over it verifies under input 2, with in-circuit point decompression;
- the DBI credential's edge names the primary's SAID;
- each disclosed value (B-direct) or disclosure digest (B-batch) **equals** a primary block value; derived predicates (`age_over_21` from a birth date) are unsupported unless the primary carries them as claims;
- the primary's holder key, taken from the primary (Q13), signs `hash_tr` (B-direct) or `e = SHA256(fresh holder key || signing key || context)` (B-batch) — mdoc-zk's device-signature pattern, with the primary's holder key hidden and the fresh key public;
- `now` precedes both expiries; B-batch: `validFrom ≥ now − skew` and `validUntil ≤ min(DBI expiry, primary expiry, now + maxWindow)`;
- the primary's and DBI credential's status bits are clear under input 5;
- ECDSA accepts `s` and `n − s`; signatures are private witness, so malleability does not reach the verifier.

**Outside the proof**: key state and the status root's anchoring (did:webs verifier); verifier policy (epoch window, maximum validity); B-batch presentation freshness (holder binding over the verifier's nonce).

### 7.4 Circuit engineering constraints

- **Scope.** A new circuit, not a parameter change (X4). Reusable from Longfellow: SHA-256, P-256 ECDSA, `memcmp`, routing, CBOR parsing, comparisons, the GF(2^128)–Fp256 MAC glue, issuer-list membership. New: a parser for the primary's format in place of the MSO CBOR hash (no JSON parser exists upstream); placeholder-SAID recomputation and version-size checks; seal containment across three or four serializations; a second state signature; digest-to-block equality.
- **Failure modes.** The circuit can fail by cost, a rigid in-circuit layout, soundness bugs, upstream churn, or verifier non-acceptance, not by a missing primitive; P-256 unavailability is a separate failure with its own fallbacks (§5.1), and no fallback is named here (Q25). The reasoning is in the companion's X.9.
- **Fixed shapes.** One circuit ID per (schema, disclosed-attribute count, maximum block count), padded natively; verifiers hold a manifest of all of them (Q17). Larger maxima cost prover time on every proof.
- **Soundness.** The bug class found in Longfellow's reviews is under-constrained witness variables (a witness length used where a public length belongs; CBOR indices) and an unchecked circuit hash. Negative tests therefore cover **every witness variable as well as every public input**, and `verify` checks circuit hashes at startup.
- **Bindings.** A C interface exists only for mdoc-zk; the custom circuit needs a new Rust or C entry point. There is no Node binding upstream; ISRG's `zk-cred-longfellow` (Rust, WASM, UniFFI) is the lead for Node, WASM and React Native, **unverified** for custom circuits and audit status. Longfellow's Rust rewrite (LFC2 circuit format) is upstream's intended production path. Upstream documents no stable third-party circuit-authoring API.

## 8. Threat model

| Threat | Mitigation | Residual |
|---|---|---|
| State colludes with a verifier | state uninvolved after issuance; nothing primary-derived shown; status fetched whole (§5.3) | disclosed values; partitions (§5.4) |
| Verifiers collude | fresh proof per presentation; B-batch: fresh keys and salts | disclosed values; partitions; B-batch timing and reuse |
| Compromised VTA | holder-controlled VTA (§5.2); device-side custody (Q11); status in the proof; cap | until revocation, a VTA holding the holder key presents or mints freely (the cap binds honest VTAs only) and learns the primary |
| Malicious holder claims more than the primary | subset, schema and validity checks (§7.3) | soundness of a new circuit (audit gate) |
| Lending or selling | non-exportable holder keys where possible; one-time-use; cap | unlinkability hides lending; Utah's policy (Q5) |
| Proof transplant | public inputs bind the proof to the transcript (B-direct) or the secondary's keys, digests and validity (B-batch) | none known; negative tests per input and witness variable |
| Replay | session transcript; B-batch: holder binding over a verifier nonce | a replayed secondary is linkable as reuse |
| Stale status | bounded validity; status-root windows per use class | latency up to `maxWindow` where no recent root is required |
| State key compromise | pre-rotation; an epoch marking the compromised key state | forgeries up to `maxWindow` past the cut-off unless Q20 picks the commitment |
| Circuit substitution | circuit ID checked against the manifest; hashes checked at startup | trust in the manifest's publisher |
| Soundness bug | external audit and the negative suite | residual risk of a custom circuit |

## 9. Repo seams

Paths under `core/` are in `bifold/packages/core/src/`.

| Concern | Seam |
|---|---|
| DID resolver lists (add did:webs) | `app/src/utils/bc-agent-modules.ts`, `core/utils/agent.ts`; wrapping resolver `core/utils/RetryingWebVhDidResolver.ts` |
| DID classification; JSON-LD loading | `core/modules/trust-tasks/module/classifyDid.ts`; `core/modules/vrc/createVrcDocumentLoader.ts` |
| Trust Task registration; proof policy (`acceptUnverified` placeholder, where a DBI proof type plugs in) | `core/modules/trust-tasks/registerTrustTask.ts`; `core/modules/trust-tasks/services/TrustTasksService.ts` |
| Document proofs (`eddsa-jcs-2022`); credential delivery (`credential-exchange/issue/0.1`) | `bifold/packages/trust-tasks/src/documentProof.ts`; constant in `core/modules/trust-tasks/module/vtiInbox.ts` |
| VTA key export (Ed25519, X25519 only); **new: VTA-side P-256 signing** | `core/modules/trust-tasks/module/vtaKeys.ts`; no Keyring client — upstream `keys/sign/0.1` (`vta-service/src/trust_tasks/keys.rs`, `operations/keys.rs` `sign_payload`) in the pinned VTI clone |
| OpenID4VC holder binding; device-side holder key (Q11) | `core/modules/openid/offerResolve.tsx` (`did:key`, `did:jwk` or plain `jwk`; a P-256 holder key rides `jwk`); `core/hardware-signing/key.ts` (ECDSA-SHA256 on P-256) |
| Selective-disclosure decision | `docs/CRYPTO_SUITE_FOLLOWUP.md` (Decisions 10–13) |

No KERI, ACDC or did:webs code exists in the repo; the only "CESR" is TSP framing from `@openvtc/vti-tsp-js` (`bifold/packages/trust-tasks/src/tsp/`), not a KERI parser. Blake3 is absent; the state profile keeps it out of the proof path, though a general did:webs verifier needs it for other issuers' logs.

## 10. Open questions

*Not decided* — ours to decide. *Waiting* — needs someone else.

1. **Path A or Path B** (§3, X14). *Decided*: Path B, B-direct target; Path A and dual issuance rejected (§6). Written confirmation of X14: *waiting on Utah, via Brendan.*
2. **Primary format**. *Decided*: ACDC (X14). An mdoc or SD-JWT VC primary is moot (§6).
3. **Utah's signing infrastructure (G1)**: P-256 support, which tooling signs, and whether holder identifiers can carry P-256 keys. *Waiting on Utah.*
4. **Freshness and revocation parameters per use class**: `maxWindow`, epoch cadence and windows, acceptance of emergency-revocation latency, and the authentication for holder-initiated revocation or re-binding. *Waiting on Utah.*
5. **Legal standing and lending**: whether Utah recognizes a holder-presented proof (or a B-batch secondary) as carrying the state's assurance; its lending policy. *Waiting on Utah.*
6. **Status mechanism**: confirm the Merkleized bitstring, or the signed-span alternative, on the Phase 0 benchmark (§5.3). *Not decided; cadence waits on Utah (Q4) and the working group.*
7. **Issuance anchoring and KEL growth**: one-`ixn` direct anchoring (recommended), indirect TEL (which X14's TEL-backed status may require), `SealRoot` batching, or a separate issuing AID (§7.2). *Waiting on Utah and Brendan.*
8. **ACDC protocol version and fixed-layout profile**: the pinned version (X10), the `s` layout variants, JSON or CESR-native (§7.2). *Not decided.*
9. **did:webs P-256 spelling**: we emit `P-256` and accept `secp256r1`; ask the authors to fix the example, to state compressed-point handling, and to accept a conformance fixture. *Waiting on the did:webs authors.*
10. **KERI anchoring of signing keys**: whether KERI or did:webs define a KEL-anchored credential-signing key, as §5.1's anchored-key fallback assumes. *Waiting on the KERI and did:webs authors.*
11. **Holder-key custody**: VTA-side (`keys/sign/0.1`) or device-side (§5.2). *Not decided.*
12. **VTA hosting**: holder-controlled (required as written) or provider-hosted, which needs its own trust analysis. *Not decided.*
13. **Holder-key binding form**: a non-transferable P-256 prefix (`1AAI`) as issuee, or an explicit key attribute; a transferable issuee AID would mean replaying its KEL in the circuit. *Not decided; Utah's identifiers per Q3.*
14. **Holder-key rotation**: candidate — the state re-issues the primary (and DBI credential) to the new key, keeping rotation out of the proof. *Not decided.*
15. **Verifier nonce and offline batches**: leaning — B-batch linkage proofs bind no nonce, and freshness comes from holder-binding presentations, pending the Phase 0 read that those carry a verifier nonce in every supported flow. *Not decided.*
16. **Minting limits**: VTA-enforced cap only, nullifier tier opt-in (§5.4); revisit when a stateful minting party exists. *Decided for now.*
17. **Circuit manifest and distribution**: how verifiers obtain and trust every circuit ID — published through governance, or a manifest signed by the state or governing body. *Not decided.*
18. **Proof carriage for a custom circuit**: `ZkDocument` carries registered circuits only and SD-JWT VC has no slot, so carriage is Keyring-defined and reaches only Keyring-aware verifiers. *Waiting on standards bodies and verifier vendors.*
19. **Secondary format** (B-batch): SD-JWT VC, mdoc, or a plain JWT with disclosure inside the proof. *Not decided.*
20. **Key-state public input**: the bare state key, or a key-state commitment that closes the post-compromise forgery window at the cost of a membership proof. *Not decided.*
21. **Block granularity and count**: which claims are separately disclosable blocks, and a real primary's block count, which fixes the padded maximum. *Waiting on Utah.*
22. **Format-only tier**: whether to offer state-issued, single-use, stable-issuer batches as a separate linkable tier. ACDC bulk issuance is the comparison point; it hides copies from third parties, not from the issuer. *Not decided; needs Utah.*
23. **Upstream alignment**: DTG Credentials Specification WD 0.6's VDC shares the short-validity rationale but appoints a delegate to act in the delegator's name, and "a delegator cannot re-issue to a delegate what it was itself issued" (VDC section); DBI is not a VDC. Whether the working group wants a credential type for DBI. *Waiting on OpenVTC and DTG.*
24. **Audit budget**: funding and scheduling of the audit (§11). *Waiting on Brendan.*
25. **Custom-circuit cost, fallback and phone-side proving**: the circuit's cost (Phase 0 benchmark; the acceptance threshold is Brendan's judgment, G0) and a native module's feasibility on Hermes and RN 0.81 (Phase 4). The plan names no fallback if the circuit proves infeasible: the P-256 fallbacks (§5.1) answer a different failure, and a zkVM guest running the same statement is not a candidate on the VTA because it is measured too slow for per-presentation proving on 2 CPUs (§5.1; companion Part XI). The candidate, an inference, is the linkable tier (Q22), which reintroduces state-side issuance (§6). *Not decided.*

## 11. Phased delivery

### Phase 0 — gates, reads, prototype and benchmark

Effort figures in this section are scoping estimates (companion Part IX), not measurements.

- **G0 — variant and circuit feasibility decided.** Done when the benchmark below is recorded, Brendan has recorded in a dated companion whether the custom circuit's measured cost is acceptable (Q25), and B-direct or B-batch is chosen (Q15, Q19). **Phase 1 does not start until G0 passes.**
- **G1 — Utah's confirmation and signing infrastructure** (Q1, Q3). *Waiting on Utah.* Done when Utah's written confirmation of X14 and its answers on P-256 signing are recorded in a dated companion.
- **G2 — a keripy-built P-256 log verifies end to end** Done when a stored fixture (with expected result and producing implementation) incepts with a transferable code, rotates with an explicit next-key code, verifies with witnesses (and delegation if used), anchors one primary and one DBI credential in Q7's form with SHA2-256 SAIDs, and anchors one status root.
- **Pins.** Add keripy, signify-ts, keria, cesride, tswg-cesr-specification, tswg-acdc-specification, trustoverip/kswg-did-method-webs-specification, hyperledger-labs/did-webs-resolver and google/longfellow-zk to `scripts/openvtc/PINS.json` through the pin tooling. Done when `setup-external.mjs` clones each into `external/` and a dated companion re-quotes, from the pinned clones, every operative claim of §4, §5.1 and §7, including the still-unquoted keripy rotation default, SHA2-256 test and low-S behaviour, and P-256 rotation and witnessed behaviour.
- **Spec reads.** Done when a dated companion quotes, by name and `MAJOR.MINOR`: ISO 18013-5 (DS/IACA chain, `ZkDocument`), draft-ietf-oauth-sd-jwt-vc issuer-key resolution and HAIP 1.0 `x5c` (replacing X3's and X5's paraphrases); the signed bytes of the ACDC primary; whether X9's 128-bit rule covers every SAID kind; whether holder-binding presentations carry a verifier nonce (Q15).
- **Stock-circuit prototype against Multipaz — dropped:** it existed only to anchor the Path A comparison (§6).
- **Interop check** (1 person-week; informs G0's B-batch choice and Q22). Done when the acceptance or rejection, by Credo, an EUDI verifier and walt.id, of plain-backend secondaries under a did:web, a did:webs and an `x5c` issuer is recorded.
- **Benchmark** (informs G0, Q6, Q8, Q25; Longfellow numbers are measured here for the first time, the zkVM Ed25519 comparison being recorded in companion Part XI). The stock circuit as baseline, and a variant approximating §7.3 at 5, 10 and 20 blinded blocks, with separately timed components: fixed-layout and witness-offset parsing; placeholder-SAID recomputation and version checks; seal containment; point decompression; two and three P-256 verifications; disclosure digests; date comparisons; the Merkleized bitstring at depth 15 for two credentials; and signed spans. On a 2-vCPU container of the deployment class, per proof: prove time, peak memory, proof size, verify time, circuit load time; a 50-proof batch at concurrency 1 and 2; CPU model and build flags. Done when recorded per component in a dated companion and compared with Part IX's estimates.
- **did:webs question sent** (Q9). Done when sent and the reply, or silence, is recorded.

### Phase 1 — interface, plain backend, custody seam, pilot verifier

**Interface and plain backend.** The DBI module (§5.5) and plain re-issue backend produce SD-JWT VC and mdoc secondaries from a stand-in primary: ephemeral signing key, fresh P-256 holder key signed by the stand-in primary's holder key, fresh salts, independently jittered validity within §7.3's bound, the cap. Done when:

- a unit suite shows no two secondaries of a batch share any value other than disclosed claim values and fixed metadata. Compared: every salt, disclosure digest, signing key, holder key, signature, credential identifier, `validFrom`, `validUntil`, and the encoding with disclosed values and fixed metadata removed. Fixed metadata: `vct` or `docType`, namespace, algorithm identifiers, format constants;
- a subset request is honored and a superset rejected; over-long validity is rejected; the cap is enforced; Hermes runs the module in-app;
- an OpenID4VC verifier test accepts both outputs **with the test VTA's key configured as a trusted issuer** (an IACA root for mdoc, issuer metadata for SD-JWT VC) — format conformance, not privacy.

**Holder-key custody seam** (*conditional on Q11*). VTA-side: a Keyring client for `keys/sign/0.1` creates a P-256 key and signs a fresh holder key, verified against the local VTI lab stack, with `vtaKeys.ts` behaviour unchanged. Device-side: `hardware-signing/key.ts` signs fresh holder keys and the VTA receives only signatures. Done when the chosen path passes that test and its unit tests.

**Pilot verifier** (4–8 person-weeks). A verifier service holding the trust configuration (the circuit manifest and state key state), triggering presentations over the W3C Digital Credentials API or OpenID4VP. It needs a verifier patched for the custom `ZkSpec`. Done when it accepts a fixture custom-circuit proof and rejects an issuer key outside its trust configuration and a circuit ID outside its manifest.

### Phase 2 — did:webs verify-only and status publisher

A did:webs resolver in both resolver lists, injected into DBI as the key-state source, with a Hermes spike for Blake3 and CESR parsing; and the state-side status publisher (§5.3: status profile 1–1.5 person-weeks; tree builder, `SealRoot` anchoring and static hosting 2–3 person-weeks). Done when, on the Hermes binary (model: `tsp-reference/ref-03d-bls12-381-hermes`):

- the resolver verifies the Phase 0 fixture log, rejects a tampered one, accepts high-S P-256 signatures, sets `versionId` to the KEL `s`, and requires did:keri in `alsoKnownAs`;
- it emits a P-256 key as `JsonWebKey` `kty` `EC`, `crv` `P-256`, uncompressed `x`/`y`, accepts `secp256r1` on input, rejects the OKP/Ed25519 form for a P-256 key, and passes Q9's conformance fixture;
- it resolves a did:web alias only while an unrevoked designated-aliases ACDC names it; `classifyDid.ts` and `createVrcDocumentLoader` handle the method;
- the publisher builds the tree from a fixture list and anchors its root with a `SealRoot` seal, the resolver verifies that anchoring, and a holder fetches the whole list and finds its leaf.

### Phase 3 — VTA-side prover (custom linkage circuit)

**Custom linkage circuit** (40–66 person-weeks ZK engineering). A Rust or C++ sidecar behind `present` and `derive`, against the Phase 0 fixture's primary and DBI credential, with fixed-shape circuits (§7.4). Blocked on G0, G1, G2, Phase 2, Q7, Q8, Q13 and Q20, which fix the statement. Fixtures come from the Phase 0 state tooling, not by hand; every negative test runs on every circuit or verifier change. Done when:

- proofs verify in both forms, and the circuit ID and proof size are identical for fixture primaries of different real block counts within one manifest entry;
- one negative test per public input fails: the proof moved to a different transcript, signing key, holder key, disclosure digests or validity; a different state key or key-state commitment; a different schema; a wrong circuit ID; `now` moved past a bound; a different or stale status root;
- one negative test per witness variable fails, including lengths and parse indices inconsistent with public values;
- the soundness cases fail: expired DBI credential or primary; wrong state key; fresh key not signed by the primary's holder key; superset claims; a tampered block or anchoring event; a revoked primary or DBI credential; a proof replayed on a second secondary;
- `verify` rejects a circuit ID outside its manifest and refuses to start if a loaded circuit's hash does not match; resource numbers on the deployment class are recorded against the Phase 0 benchmark.

**Audit gate.** Before Phase 3 ships to users and before any Utah pilot. An external cryptographic audit of the statement, circuit, public-input handling and verifier (6–10 weeks, plus 4–6 engineer-weeks remediation; Q24). Done when the report is recorded in a dated companion and every high or critical finding is fixed and re-reviewed by the reviewer.

### Phases 4 and 5 — optional

**Phase 4 — phone-side prover (later).** A native module (JSI or TurboModule) running the Phase 3 prover on the phone; starts only if Phase 3 leaves a reason to prove off the server. Done when phone-generated proofs pass the Phase 3 positive and negative suites, prove time and memory on the target phone and Hermes are recorded, and it has passed the audit gate. **Phase 5 — ACDC-native secondaries.** Scoped, with acceptance criteria, by a dated companion when started.

## 12. Relation to existing work

- **VTA and Trust Tasks:** DBI reuses the Trust Task carriage and VTA key-management interface of [`openvtc-integration-plan.md`](./openvtc-integration-plan.md), but not its custody model where custody is operator-run (the VTA Farm): §5.2 requires holder-controlled custody unless Q12's trust analysis admits otherwise. No dependency on TSP; no change to the VRC or witness flow, which stay Ed25519.
- **Selective disclosure:** `bbs-2023` remains the selective-disclosure half for credentials Keyring issues; DBI is a separate mechanism for a KERI-rooted primary.
