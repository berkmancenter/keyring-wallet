# Cryptosuite follow-up (deferred)

> **Status:** intentionally deferred until the upgrade stack is clean and settled.  
> **Do not** treat Phase 5 “VC 2.0” as “Data Integrity / eddsa-rdfc-2022 done.”  
> Last updated: 2026-07-13.

---

## What we ship today

| Layer | Choice |
|-------|--------|
| VRC / RCard **data model** | VCDM **2.0** (`@context` credentials/v2, `validFrom` / `validUntil`) when RCE ≥ 2 |
| DIDComm JSON-LD **proof** | **`Ed25519Signature2018`** (`proofType` + suite context URL) |
| Hardware attestation | Separate W3C **evidence** block (P-256 in SE/TEE) — orthogonal to the VC proof suite |

Proof of the current VRC shape (including `proof.jws`) comes from real-device E2E
slim dumps under `e2e/artifacts/issued-credential-*.json`.

---

## Why 2018 (not “newer VC 2.0 crypto”)

1. **Credo DIDComm `jsonld` format** is built around Linked Data Signatures /
   `Ed25519Signature2018`. That path signs and verifies end-to-end today.
2. Credo 0.6 **`W3cV2CredentialService`** targets **JWT / SD-JWT** enveloped
   proofs — not Data Integrity over DIDComm for our exchange.
3. **VCDM 2.0 data model ≠ Data Integrity cryptosuite.** We moved the payload
   shape; we did **not** move the proof suite.
4. **Interop:** existing wallets, RCards, witnesses, and stored credentials
   already speak 2018. A hard cut breaks peers.
5. Spec examples that show **`Ed25519Signature2020`** are a dead end — do not
   migrate 2018 → 2020. The W3C-aligned v2 target is Data Integrity.

See also `DTG_SPEC_FEEDBACK.md` §3 (recommend DI in the DTG spec; keep 2018
acceptable for legacy).

---

## Target later (profound / separate project)

```json
"proof": {
  "type": "DataIntegrityProof",
  "cryptosuite": "eddsa-rdfc-2022",
  "created": "...",
  "verificationMethod": "...",
  "proofPurpose": "assertionMethod",
  "proofValue": "..."
}
```

Optional later: selective disclosure via other DI cryptosuites (`bbs-2023`,
`ecdsa-sd-2023`) — same family, separate scope.

### What a real implementation must include

| Area | Work |
|------|------|
| Credo | Sign/verify DI over the DIDComm credential format (patch and/or upstream) |
| Canonicalization | RDFC 1.0 / suite rules — not LDS-2018 |
| Contexts | Offline DI + cryptosuite contexts on mobile (no reliance on network) |
| Negotiation | Issue DI only when peer capability allows (extend RCE or equivalent); else 2018 |
| Witness / digest | Ensure VWC / JCS rules stay consistent with what is signed |
| Dual verify | Holders must accept 2018 **and** DI during transition |
| Conformance | Explicit tests for DI issue + verify + cross-version peers |

This is **not** a Keyring-only string flip of `proofType`. Plan it as its own
phase after bifold/credo/RN upgrade dust settles.

### Explicit non-goals for that phase

- Replacing hardware attestation (unchanged).  
- Jumping to Ed25519Signature2020 as an interim.  
- Claiming full “VC 2.0 Data Integrity conformance” while still on 2018 proofs.

---

## Where the 2018 choice is coded

- `bifold/packages/core/src/modules/vrc/vrc-manager.ts` — `offerCredential` →
  `proofType: 'Ed25519Signature2018'` (comment points here).  
- Same pattern in RCard / witness-server / vrc-reference issuers.  
- Suite context: `ED25519_2018_SUITE_CONTEXT_URL` on VCDM 2.0 builders.

When DI lands, grep `Ed25519Signature2018` and replace via capability-gated
issuance — do not delete 2018 verify until peers are gone.

---

## Suggested reopen trigger

After:

1. Upgrade phases merged / main is stable,  
2. Real-device attestation + simulator E2E remain green,  
3. Owner prioritizes DTG / ToIP DI conformance or Credo DI-on-DIDComm support,

…open a dedicated issue (Keyring + bifold) titled roughly:
**“VRC: DataIntegrityProof (eddsa-rdfc-2022) over DIDComm”** and treat this
file as the design brief to expand.
