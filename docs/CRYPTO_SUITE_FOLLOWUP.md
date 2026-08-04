# Cryptosuite record: Data Integrity (`eddsa-rdfc-2022`)

> **Status:** SHIPPED — the DIDComm Data Integrity layer landed 2026-07-17
> (`1992195`, part of the consolidated upgrade PR #17): capability-gated DI
> issuance (RCE v3), dual-verify, witness proof-family mirroring.
> This doc previously recorded the pre-upgrade decision to *defer* DI; it now
> records what shipped and the decisions that shaped it (code comments cite
> them by number — e.g. the `@credo-ts/didcomm` patch cites Decision 5 Option B).
> Last updated: 2026-08-04.

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

## Still open (same family, separate scope)

- Selective disclosure via other DI cryptosuites (`bbs-2023`, `ecdsa-sd-2023`).
- Upstreaming the VCDM 2.0 shim / `cryptosuite` options shape to credo-ts,
  to reduce the permanent patch-carrying cost (Decision 9).
- Do **not** remove 2018 verification while any stored or peer-issued 2018
  credential can still surface — i.e., plan on never.
