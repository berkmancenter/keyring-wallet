# KERI/ACDC holder support

Keyring receives, stores, verifies and presents ACDCs issued by a KERI
identifier it does not control. It does not manage a KEL of its own.

**Status:** a plan awaiting the KH-P0 Hermes spike. No code written; KH-P0 is a measurement, and nothing after it starts until its gates are recorded. Assumptions A1–A4 (§2) are unconfirmed, and the claims this plan rests on that have not been checked are listed with their resolution in §13.


## Needs input

Decisions and confirmations a person must make before the work they gate can proceed. The full list of unverified claims is §13; the open questions are `KH-Q1`–`KH-Q11` (§12). "Default" is what this plan does if nobody answers.

| Item | Owner | Blocks | Default if unanswered |
|---|---|---|---|
| KH-P2 replay budget: 1 000 and 10 000 events; full replay of 10 000 within 30 s, incremental refresh of 100 events within 2 s. Proposed, not confirmed (§10) | Brendan | The pass/fail line of KH-P2 | The numbers stand as proposed; a miss goes to DBI-Q7 |
| KH-P0 time-box length (§10) | Brendan | Starting KH-P0; its stop rule | None; KH-P0 does not start until a length is set |
| keripy pin: `25f06d2` (DBI companion), `7143832` (this research), `927c0cb` (keri-ts fixtures); and who owns the one `scripts/openvtc/PINS.json` entry (§6, §13) | Brendan with the DBI author | Fixture generation, the start of KH-P0 | Reconcile to a single pin at KH-P0 start; the DBI plan owns the file |
| Package name `bifold/packages/keri-verify` (proposed), and the shared-package proposal itself: the DBI plan has not acknowledged it (§6) | Brendan; DBI author | Package wiring (§9), KH-P1 | Build it here as `keri-verify`; DBI Phase 2 may not adopt it |
| KH-Q1: holder-controlled VTA copy beyond a per-session export | Brendan, after DBI-Q12 / `DBI G0` | The VTA export design (§4) | Per-session export only, to a holder-controlled VTA only |
| KH-Q8: protocol version to pin (`KERI10JSON` v1 or protocol 2), tied to DBI-Q8 | Brendan; DBI author | Parser and S2 coverage | Pinned and recorded per fixture; no choice made |
| KH-Q9: where `TrustedIssuerPolicy` comes from | Brendan | S8, KH-P3 | An issuer outside the policy renders `unchecked(issuer not trusted)` |
| KH-Q10: grant delivery, pushed over our carriage or a mailbox-poll client | Brendan | KH-P4 | Push over our carriage; no mailbox client in v1 |
| KH-Q11: trusted time source mapping a time to an `sn` | Brendan; DBI Phase 0 | `keyStateAt`, KH-P2 | Recorded in KH-P2; no source chosen |
| A1: Utah's primary credential is an ACDC (DBI X14), reported but not confirmed in writing | Utah via DBI-Q1 / `DBI G1` | The Utah case and the KH-P4 SEDI target | The module serves vLEI-style ACDCs only |
| A2: Utah uses SHA2-256 SAIDs. This is not on DBI's Utah ask list (`DBI G1`, DBI-Q3); adding it is the DBI author's call | DBI author, then Utah | Which profile is primary | Blake3 profile only if refuted; the Utah profile is built first on the DBI proposal |
| A3: Utah's issuer keys are P-256 | Utah via DBI-Q3 / `DBI G1` | Which profile is primary | Ed25519 profile only |
| A4: the SEDI Implementation Guide names KERI/ACDC in a conformance profile | The State of Utah | Any SEDI conformance claim | No conformance claim is made |
| Non-transferable issuee rule for the Utah/DBI profile (§8) | DBI-Q13 (DBI author, Utah) | Rejecting a transferable issuee | The check is a profile option, off by default |
| Edits PR #346 would need: the list is companion VIII.5 | DBI author | The DBI side of the shared package and acquisition | None are made here; this plan does not edit #346 |
| Sequencing after PR #259 and bifold #212–#222 (bifold #214 edits `credentialTypes.ts`) (§9) | Brendan | KH-P1 wiring merge; the `acdc` credential kind | Wire after that stack lands; rebase rather than race |

**Companion** (`keri-holder-plan/`): [2026-10-13-bam.md](./keri-holder-plan/2026-10-13-bam.md) — the research record: sources, what was verified and what was not (Parts II, III, IX, X), the options rejected with their reasons, the DBI cross-read, the keri-ts vetting, the edits DBI would need, and the review pass of Part X. [2026-10-24-al.md](./keri-holder-plan/2026-10-24-al.md) — a wallet-side review (notes N1–N12, proposals only), the 2026-10-24 KERI landscape research, a short proving ladder (rungs K0–K5) and what fits this repo's environment.
**Related:**
- [openvtc-integration-plan.md](./openvtc-integration-plan.md): the TSP and Trust Task carriage that IPEX messages ride in KH-P4.
- [vsc-migration-plan.md](./vsc-migration-plan.md): the predicate-aware `credentialTypes.ts` pattern §9 builds on.
- The Delegated Batch Issuance plan (PR #346, branch `docs/dbi-plan`, pinned at `425ad68`, `docs/plans/delegated-batch-issuance-plan.md`): the state-issued ACDC that is this plan's first concrete customer. This plan supplies the holder-side design DBI leaves unspecified (its §5.2, §5.3, §5.5, §7.3) and does not define a parallel design. Until #346 merges, read it in `/srv/dev/code/seas/keyring-wallet-dbi`.

**Identifiers.** Both plans number their own questions, phases and gates. Here ours carry a prefix: questions `KH-Q1`–`KH-Q11`, phases `KH-P0`–`KH-P7`, gates `G-H1`–`G-H7` (the Hermes gates, defined once in §6). DBI's are `DBI-Qn`, DBI Phases 0–5 and gates `DBI G0`–`DBI G2` (DBI's Phase 4, the phone-side prover, is unrelated to KH-P4, OOBI and IPEX). An unprefixed `Q`, `Phase` or `G` does not appear in this file; unnumbered DBI sections are cited as `DBI §n`. Assumptions are `A1`–`A4`, risks `R1`–`R9`, verification stages `S1`–`S8`.

## 1. Goals and non-goals

**Goals.** The wallet can:

1. resolve an OOBI to learn an issuer's AID, its KEL and its endpoints;
2. accept an ACDC from an issuer by IPEX grant/admit, and store it;
3. verify what it holds: SAIDs, schema, issuer KEL (with witness receipts), status (TEL or anchored bitstring), the edge chain, and whether the issuer is one the wallet's policy trusts;
4. display it, and present it to a verifier, or hand it to the VTA to present (§7);
5. do all of this with hash and signature suites that the issuer actually uses: the two profiles in §2.

**Non-goals.**

- **No KEL of its own.** No inception, rotation, witnessing, delegation, or issuance by the wallet. The holder identifier remains whatever the existing agent and VTA provide (§8).
- **No on-device zero-knowledge prover in this plan.** Open PR #114 puts proofs in the VTA and records BLS12-381 at about 15x Node's cost on the app's Hermes; that figure belongs to #114's BLS context only. DBI proves in the VTA first (DBI Phase 3) and treats a native phone-side prover (Longfellow, not BLS) as the optional DBI Phase 4. This plan builds none of it: a presentation here is a plain ACDC presentation, or the wallet supplies the retained material and the consent decision to a prover (§7).
- **Not a KERI agent or mediator.** No KERIA, no mailbox server, no witness. The wallet is a client.
- **Not a replacement for Credo-TS.** ACDC has no Credo-TS support (the `@credo-ts` packages installed here, 0.7.1-pr-2704, have no ACDC module); it lives beside Credo-TS as its own module (§6).

## 2. Assumptions that need confirmation

These gate the design. Each is *waiting on someone else*, not undecided.

**Two suite profiles.** The module supports both, selected by code (the verifier is parameterised on digest and signature code):

| Profile | Digest | Signature | Status |
|---|---|---|---|
| Utah | SHA2-256 SAIDs (code `I`), including KEL and TEL event SAIDs | Controller (event) signatures: ECDSA P-256. Witness receipts: signed by the witnesses' own keys, normally Ed25519, so this profile needs Ed25519 verification too | A proposal, not a spec requirement: DBI §5.1 and its companion D4 propose it; pending `DBI G1` and DBI-Q3. **The primary case for the Utah customer**, built and tested first |
| vLEI/stock | Blake3-256 (ACDC v1.1 default) | Ed25519 | The stock KERI case; interop with vLEI-style issuers |

| # | Assumption | Source | Blocked on | If false |
|---|---|---|---|---|
| A1 | Utah's primary credential is an ACDC (DBI X14) | Reported by Brendan from conversations on 2026-10-07; **not confirmed in writing** (DBI-Q1, `DBI G1`) | Utah, via Brendan | The Utah case drops out. The module still serves vLEI-style ACDCs, but the motivation weakens and KH-P4 loses its SEDI target |
| A2 | The Utah profile uses SHA2-256 SAIDs (code `I`) | DBI §5.1 and companion D4 propose it; `DBI G1` and DBI-Q3 name only the P-256 asks, so the digest is not yet put to Utah as a question | DBI plan, then Utah | Only the Blake3 profile applies. Both hash functions are in `@noble/hashes` 2.0.1 (`blake3`, `sha256`), so the cost is a code path and vectors |
| A3 | Utah's issuer keys are P-256 | DBI-Q3 and `DBI G1`; signify-ts verifies but does not sign P-256; KERIA lacks P-256 | Utah | Only the Ed25519 profile applies; P-256 verification stays additive |
| A4 | The SEDI Implementation Guide (0.1.0-draft) will name KERI/ACDC in a conformance profile | It lists them as candidate technologies; "inclusion does not constitute endorsement" | The State of Utah | The module is built to the ACDC and KERI specs and stays interoperable with vLEI. It makes no SEDI conformance claim |

**Caveats the verifier must handle** (DBI §5.1, DBI X6, `DBI G2`):

- Indexed signature codes `E`, `F`, `2E`, `2F` are keripy's extension: the CESR indexed-code table lists only "the Ed25519 and ECDSA secp256k1 schemes" (DBI X6). Fixtures record the producing implementation.
- The next-key code on a rotation defaults to Ed25519 in keripy; the verifier asserts the verification-key code of the key actually used.
- Low-S is not normalised by keripy: the verifier accepts both `s` and `n - s`.
- Controller signatures and witness receipts are different signatures. An event's controller signatures verify against that event's own keys `k` under `kt`; a witness receipt verifies against the witness's key, which is its AID. A witness AID is normally a non-transferable Ed25519 key (code `B`), so an Ed25519 receipt on a P-256 log is the expected shape, not a mixed-suite error. Whether P-256 witnesses exist is not known.
- No evidence yet exists of P-256 working with witnesses or delegation. `DBI G2`'s done-when requires a fixture that "verifies with witnesses (and delegation if used)"; the single-signature, witness-free limit is DBI §5.1 "Signing tooling", which applies until `DBI G2` passes. Until a fixture exists, witness receipts in a Utah-profile log and delegation under P-256 are `unchecked`.

## 3. Data model

A held credential is one record, stored as one unit so that verification can be repeated offline.

```
HeldAcdcRecord
  said            ACDC SAID (code per profile: `E` Blake3-256, `I` SHA2-256)   primary key
  acdc            the ACDC as received, exact bytes (CESR-framed or JSON), never re-serialized; carried as opaque bytes end to end (§7)
  attachments     CESR attachments received with it (signatures, seals)
  schema          { said, doc }  the schema document, verified against its SAID
  edges           [{ label, said, operator, record? }]  resolved edge targets, where held
  issuer          { aid, oobi | didWebs }
  kelRef          { sn, said }    the issuer event that seals or anchors issuance
  tel?            { regk, issEvent, revEvent?, anchor }   when the issuer keeps a TEL for this credential, whichever source `status` reads
  retained        the list below, by anchoring form
  status          { source: tel | anchoredBitstring, value: valid|revoked|unknown, checkedAt, statusEpoch?, sourceEventSaid?, stale: boolean }
  receivedVia     { ipexGrant, from, at }
  verifiedAt      { suite, result, failures[] }
```

- **Exact bytes are the record.** A SAID is a digest over a serialization; re-encoding breaks it. Parsed fields are a cache and are rebuilt from `acdc`.
- **What the holder retains depends on the issuer's anchoring form, which is DBI-Q7 (undecided; waiting on Utah and Brendan).** This design is conditional on that answer: the record stores whichever list applies and the module supports both. The forms are not exclusive: DBI §5.3 keeps the state's TEL as "the credential's authoritative status record (X14), from which the published list is built", so a credential can carry a `tel` while the wallet reads its status from the anchored bitstring (`status.source = anchoredBitstring`):

| Form | The holder retains |
|---|---|
| **Direct anchoring + Merkleized bitstring** (DBI §5.3, §7.2; DBI's recommendation) | the compact ACDC; the full blinded attribute blocks with their salts `u`; the DBI credential; `statusIdx`; the anchoring `ixn` raw bytes and the state's signature over it; a `HolderSigner` handle (§8), never the key itself; the status list fetched whole, with its anchored root (`SealRoot` seal) |
| **Indirect / TEL** (DBI companion IX.4: "the holder must retain, for any TEL-based flow: the ACDC, `rd`, the salt, the latest sequence number and the KEL seal reference") | the ACDC, `rd`, the salt, the latest `sn`, the KEL seal reference, plus the `tel` field; a `HolderSigner` handle where the credential is key-bound |

  Everything retained is secret material: it goes in Askar-backed storage under the wallet's existing record encryption, not in plain app storage. The DBI VTA needs it to prove (DBI §5.2: "The VTA sees the primary, its salts and the DBI credential while proving").
- **`status` is a cache.** It carries `checkedAt`, `stale`, and for the bitstring source the `statusEpoch` of the root it was read from. The wallet never shows "valid" without the age of the check (the SEDI statute requirements as relayed by Brendan from the Implementation Guide: compromise detection, no silent revocation; unverified, §13).
- **Issuer KEL state is stored per issuer, not per credential**: one `KelState` record keyed by AID with the verified events, receipts and the sn it has verified to. Many credentials share it. Its refresh policy is in §5 (Duplicity and refresh).

## 4. Storage

The phone is the system of record. ACDCs are stored **phone-local**, in the wallet's existing encrypted store, as new record types (`HeldAcdcRecord`, `KelState`).

**VTA transfer.** The VTA receives a per-session export of the retained material (§3), over the Trust Task carriage, **to a holder-controlled VTA only**. What "holder-controlled" means is DBI-Q12 ("holder-controlled (required as written) or provider-hosted, which needs its own trust analysis"; not decided), so every check of it here is contingent on that answer. DBI §5.2 admits an operator-run VTA, including the VTA Farm, "only for components that never see the primary, its salts, the DBI credential or the holder key" unless DBI-Q12's trust analysis admits it; the wallet therefore refuses to export the primary or its salts to a VTA it cannot show is holder-controlled. Whether DBI's B-batch variant needs a VTA-resident copy that outlives the session is KH-Q1.

**Not the credential vault.** Open PR #202's vault is VTA-side, and its receive path verifies a single `eddsa-jcs-2022` proof whose `verificationMethod` sits under the issuer (`vta-vault/src/di_verify.rs`, as cited in that PR's subtask); an ACDC carries no such proof and fails that check. Putting ACDCs in the vault needs an upstream vault change, which this plan does not depend on. If the vault later accepts opaque or typed records, the `HeldAcdcRecord` is the unit to upload, and nothing here changes except the storage adapter.

Consequence to state in the UI and docs: a phone-local ACDC is lost with the phone unless the wallet's backup covers the record type. Whether Keyring's backup includes it, or whether a lost phone means revoke and re-bind (DBI §5.3, DBI-Q14), is decided in KH-P7 and recorded there, not assumed.

## 5. Verification pipeline

One function, `verifyHeldAcdc(record, ctx) -> VerificationReport`, built from independent stages. Each stage returns `ok | failed(reason) | unchecked(reason)`. **`unchecked` is never rendered as valid.**

| Stage | Checks | v1 |
|---|---|---|
| S1 CESR parse | Framing, counter codes, version string, attachments | Yes |
| S2 SAID | Recompute `d` of the ACDC and of each edge/rule/attribute block, and the SAID of the schema (carried in the schema's `$id`, not a `d` field), per the declared digest code. For a blinded, block-granular ACDC (DBI-Q21) it recomputes each block SAID from the block and its salt `u` | Yes |
| S3 Schema | The schema SAID matches the issuer's declared schema; the ACDC validates against it. The dialect is chosen from the schema's `$schema`: draft-07 (the vLEI schemas, e.g. the QVI schema `EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao`, declare `http://json-schema.org/draft-07/schema#`) and 2020-12 (as ACDC requires); any other dialect is `failed`. Remote `$ref` is disabled; `pattern` keywords are guarded against catastrophic backtracking (length cap, and a safe-regex check or a bounded engine). Where schemas come from: Untrusted input, below | Yes |
| S4 Issuer KEL | Resolve the AID by OOBI or did:webs; verify events in order: SAID; each event's signatures verify against that event's own keys `k` under its `kt`; for a `rot`, the revealed keys also match the prior event's next-key digests `n` and meet its `nt`; witness receipts (signed by the witnesses' keys) against the declared witness threshold `bt` (the event field; `toad` is the parameter name keripy and signify-ts use when incepting); duplicity as bounded under Duplicity and refresh, below. **Shared with DBI Phase 2's did:webs resolver**, which is a KEL replay (DBI §7.2: "did:webs resolution replays the whole `keri.cesr` stream"). Exposes `keyStateAt(aid, sn)`. KEL event bodies carry no timestamp (verified, companion IX), so mapping a time to an `sn` needs another source, KH-Q11. Replay cost grows with the log, R6 | Yes, non-delegated AIDs. Delegated AIDs are KH-Q2 |
| S5-TEL Issuance and status, TEL form | Registry inception anchored in the KEL; issuance event anchored; no revocation event; backers if the registry has them | Yes |
| S5-direct Issuance, direct form | The KEL event's seal carries the credential's SAID (DBI §5.1 "direct anchoring"); the event's signature verifies under the key state at that `sn`; and the anchoring event is in the issuer's *accepted* KEL, not a superseded branch (a recovery rotation can supersede an interaction event) | Yes |
| S5b Anchored status root | A `SealRoot`-anchored status root is anchored in the accepted KEL (S4); the holder's `statusIdx` leaf is located in the fetched list and its Merkle path recomputes to that root; the bit is clear | Yes, when the issuer uses the bitstring (DBI §5.3, DBI-Q6) |
| S6 Edge chain | Follow edges, apply `n`/`o` operators (`I2I`, `NI2I`, `DI2I`), verify each target through S2–S5b (S5-TEL or S5-direct, whichever the target uses). The DBI credential's edge to the primary is the first customer | Yes for well-formed chains; SEDI-proposed edge operators only against pinned fixtures |
| S7 Rules, privacy | Chain-link and attribute disclosure semantics. Compact and full forms, and the partial and aggregate variants. Whether the Utah credential uses blinded, block-granular disclosure is unconfirmed: DBI-Q21 (which claims are separately disclosable blocks) waits on Utah (§13) | Compact, full and blinded-block forms. Partial and aggregate (`Aggor`) variants against the pinned keri-ts `aggregate-vectors.json` and `issuee-vectors.json`, which exist in the cesr fixtures and are available for reuse |
| S8 Issuer trust | The issuer AID is one the wallet's `TrustedIssuerPolicy` accepts for this schema or role. S4 proves the AID controls its KEL, not who the AID is | Yes. An issuer outside the policy renders as `unchecked(issuer not trusted)`, never as valid |

Out of v1: a live witness/watcher network, KEL recovery after a fork beyond reporting duplicity, and cross-registry status. Duplicity is **reported**, not resolved.

**Duplicity and refresh.** Without watchers, "no duplicity" means none was seen in the events and receipts the wallet holds; it does not mean none exists, and the report says so. `KelState` is refreshed by re-resolving the issuer's OOBI before verifying any credential whose last check is older than the KH-Q3 bound, and at every presentation. A refresh that returns a different event at a sequence number already held is duplicity: the wallet reports it, keeps both, and marks every credential of that issuer `failed(duplicity)` until a person resolves it.

**Untrusted input.** Every CESR stream, OOBI reply, schema and IPEX message is attacker-controlled. Each limit below is a named parameter whose numeric value is set in KH-P1 and recorded, and each has a negative test there:

- maximum bytes per message and per KEL stream; maximum counter-group counts and nesting depth, checked before allocation;
- fetch timeouts and a redirect limit (a redirect off the OOBI's scheme or to a non-public address is refused);
- schemas never arrive by `$ref` URL. A schema comes from, in order: the app's pinned registry keyed by SAID; the grant's attachments; a schema OOBI fetch under the limits above. Whatever its origin it is used only after its SAID verifies (S2);
- schema `pattern` and similar regular-expression keywords per S3.

**Issuer trust policy.** `TrustedIssuerPolicy` maps an issuer AID to the schemas or roles it may issue (the state's AID for the state credential; a GLEIF-rooted chain for vLEI). Where the policy comes from (pinned in the app, taken from a governance source, or added by the person) is KH-Q9.

**Freshness.** Status is fetched when online, and `status.stale` is set when it cannot be. The age shown for a bitstring status is the epoch of its anchored root. The policy for "how old is too old" is KH-Q3. **What is fetched depends on the source.** The bitstring source fetches the whole status list, never a per-credential request: DBI §5.3 rules out "per-credential status request" because it correlates presentations, and "Holders and VTAs fetch the whole list, so lookups reveal nothing". The TEL source (stock vLEI credentials) fetches the one credential's TEL events, which tells the registry host which credential the wallet is checking and when (R8); the UI states this for that source.

## 6. Library strategy

**One shared KERI verification package, proposed to the DBI plan**: `bifold/packages/keri-verify` (name proposed; PR #346 has not adopted it, companion VIII.5). This plan's S1–S7 and DBI Phase 2's did:webs resolver (a KEL replay with its own Hermes spike for Blake3 and CESR parsing) are the same code, with one pin file and one fixture tree. DBI's `scripts/openvtc/PINS.json` does not yet pin keripy; the DBI companion read keripy `25f06d2` and its DBI Phase 0 "Pins" item adds it, while this plan's research read keripy `7143832`. Both commits exist upstream (§13). The two are reconciled to one pin in that single file before either plan generates fixtures.

**Decision: a hybrid of L2 and L3** (from static reading; nothing was run on Hermes; evidence in companion Parts VIII.3 and IX).

| Option | What it is | Disposition |
|---|---|---|
| L1 | `cesr-ts` and `keri-ts` used as dependencies for parse, SAID, KEL, TEL, ACDC, IPEX | **Rejected.** keri-ts's default entry has no verifier. `Kever` takes a `Baser`, and `Tever` and `Verifier` take a `Baser` and a `Reger`; those extend an LMDB base class (`lmdb` 3.5.3, effection) whose only alternative to a durable path is a temporary on-disk LMDB, so there is no in-memory option. One author in the visible history, which is a shallow clone of 115 commits dated 2026-10-12/13. Depending on it, or forking it, means owning a storage and runtime layer the wallet cannot use |
| L2 | Take `cesr-ts` only: vendor a subset or depend on it, after the cuts below | **Chosen, for the primitives.** Parser, `Serder`, `Saider`, `Diger` and `Verfer` sit on noble (hashing including Blake3 and SHA2-256; Ed25519, secp256k1, P-256) |
| L3 | A thin in-memory KEL/TEL/ACDC verifier written on top, porting from keripy, with keri-ts `Kever`/`Tever`/`Verifier` as a readable reference | **Chosen, for the state machines** |

**Cuts to cesr-ts.** `sodium.ts` has a top-level `await sodium.ready`. `signer.ts` does not import it: `signer.ts` imports only noble, `Cigar`, `Siger`, `Verfer` and `Matter`, and `salter`, `decrypter` and `encrypter` import `signer`, not the reverse. Sodium is reached three other ways: the package barrel `src/index.ts`, which re-exports `salter`, `cipher`, `decrypter`, `encrypter` and `disclosure`; `disclosure.ts` -> `salter.ts` -> `pwhash.ts` -> `sodium.ts`; and `cipher.ts` <-> `decrypter.ts` -> `sealed-box.ts` -> `sodium.ts` (`encrypter.ts` also uses `sealed-box.ts`). So the vendored subset imports files directly and never the barrel, and omits `sodium.ts`, `sealed-box.ts`, `pwhash.ts`, `salter.ts`, `cipher.ts`, `encrypter.ts` and `decrypter.ts`; `signer.ts` stays whole. If S7 needs `disclosure.ts`, `Salter` is kept with its `pwhash` stretch path replaced by a function that throws. `structuredClone` appears in `aggor.ts` only and is replaced. `serder.ts`, `mapper.ts` and `aggor.ts` import `@msgpack/msgpack` and `core/cbor.ts` imports `cbor-x`: G-H7. Vendored files keep their Apache-2.0 headers and the upstream NOTICE.

**Noble version.** cesr-ts pins `@noble/curves` 1.9.7 (`signer.ts`, `verfer.ts`) and `@noble/hashes` 1.8.0 (`diger.ts`); this repo has 2.0.1 of both, a breaking API change. The P-256 and secp256k1 verify calls in `verfer.ts` pass `{ lowS: false, prehash: true }`: no low-S enforcement, since keripy does not normalise (§2), and hashing inside verify. Those semantics must survive any port, and a vendored copy cannot silently pick up the repo's 2.0.1. Port versus duplicate is decided at G-H6.

**Parity vectors**, reused from keri-ts with provenance: cesr `current-said-vectors.json`, `aggregate-vectors.json` and `issuee-vectors.json`, keri `credential-replay-927.json` and `replay-927.json`. Each carries `"reference": "927c0cb8794d7c84fc17143c67df64aab9deda6c"`, a keripy commit.

**The reused vectors do not cover the Utah profile.** Every SAID in them is a Blake3 `E` digest, every key is Ed25519 (`D`), every signature is an Ed25519 indexed signature, and the version strings are `KERI10JSON`/`ACDC10JSON` with a few protocol-2 strings (`KERICAACAAJSON`). None exercises SHA2-256 (`I`) or P-256. The Utah minimal set is generated, not reused: `scripts/keri/gen-utah-minimal.py`, written in KH-P0, drives the pinned keripy (§11) to produce a P-256 `icp`; a `rot` with an explicit next-key code; a high-S and a low-S signature of the same event; an `ixn` anchoring a SHA2-256 (`I`) ACDC; and Ed25519 witness receipts. Output goes to `__fixtures__/keripy/<commit>/utah-minimal/` with a `PROVENANCE.json` (producing implementation and commit, command, date, digest and signature codes, and a `deviation` entry where keripy departs from a spec, §11). Whether keripy produces `I` SAIDs and P-256 logs as DBI §5.1 and its X9 state is confirmed by that script's output.

**Hermes gates.** Each is measured in KH-P0 on a Hermes release build, and each is *passed* when the verify path bundles and runs with the stated mitigation. This is the one place they are defined; other sections cite them by id.

| Gate | Hermes risk | Passed when |
|---|---|---|
| G-H1 | `libsodium-wrappers-sumo`, and any top-level `await` or WASM on the verify path (Hermes has no WebAssembly; unverified on this app's build, §13) | the bundle contains no sodium import and loads without top-level `await` |
| G-H2 | ajv 8 compiles with `new Function`; and S3 needs two dialects (draft-07 and 2020-12), whereas the in-app `bifold/packages/trust-tasks/src/validator.ts` constructs `Ajv2020` only | `validator.ts`'s runtime compile, run under the Hermes VM probe method of `tsp-reference/ref-03b-hermes-identity` (esbuild bundle, lowered with React Native's Babel preset, run on the Hermes binary in the app's iOS Pods, output diffed against Node), succeeds; and a draft-07 compile (the vLEI QVI schema) and a 2020-12 compile both succeed on Hermes, or the precompiled/standalone validator is adopted and does |
| G-H3 | `TextDecoder` with `fatal: true`, `structuredClone`, a `getRandomValues` polyfill, BigInt behaviour, and the Node shims catalogued in `bifold/packages/trust-tasks/vendor/README.md` (`fs`, `Buffer`, `isWellFormed`) | each is replaced or polyfilled and the SAID and signature checks of KH-P0 still pass |
| G-H4 | ESM `npm:` and `jsr:` specifiers, which need rewriting (the dnt build) before Metro resolves them | Metro resolves every import with no `npm:`/`jsr:` specifier left |
| G-H5 | an import of keri-ts `runtime` or `db` entries, LMDB or effection on the verify path | none is reachable from the bundle |
| G-H6 | `@noble/curves` 1.9.7 / `@noble/hashes` 1.8.0 (cesr-ts) against 2.0.1 (this repo) | one is chosen and recorded (port the subset to 2.0.1, or vendor the old pair under an alias as a second copy, with the bundle-size cost measured), and the choice passes: a high-S P-256 signature verifies, a low-S one verifies, Ed25519 verifies, and Blake3 and SHA2-256 SAIDs recompute |
| G-H7 | `@msgpack/msgpack` (`serder.ts`, `mapper.ts`, `aggor.ts`) and `cbor-x` (`core/cbor.ts`), imported on the `Serder` path and covered by no other gate | either they are cut, with MGPK and CBOR serializations returned as `unchecked(serialization kind unsupported)` and JSON and CESR-native kept, or they bundle and run on Hermes with a passing MGPK and CBOR vector |

A new `@bifold/*` package needs four registrations (root `portal:` resolution, `app/package.json`, `packageDirs` in `app/metro.config.js`, and `BIFOLD_SOURCE_PACKAGES` for hot reload; see root `CLAUDE.md`). Those files are shared with PR #259 and the bifold #212–#222 stack it points at; sequence per §9.

**Not chosen.** signify-ts is a client of KERIA, not a local verifier, so it cannot be the holder's verifier; it is used as the issuer-side harness (§11) and as a cross-check for CESR/SAID primitives; for the stack's pieces and what it lacks, see §11. It does not sign P-256 (DBI §5.1). `lenkan/keri-js` is not production-grade. `cesride`/`keride` (Rust) are stale since mid-2024. Reasons and dates are in the companion.

## 7. Acquisition and presentation

**Acquisition.**

- **OOBI resolution is a new branch of the existing scan dispatch.** `TOKENS.SCREEN_SCAN` (wired in `ConnectStack.tsx`) is `screens/Scan.tsx`, whose `handleCodeScan` tries a device code and an agent address, then calls `connectFromScanOrDeepLink` in `utils/helpers.ts`. That function routes, in order, a Keyring agent link, an OpenID4VC credential offer, an OpenID4VP presentation request and a mediator invitation, and treats anything left as a DIDComm invitation (`connectFromInvitation`). An OOBI URL (`http(s)://.../oobi/<aid>/...`) or a CESR OOBI is detected before that DIDComm fall-through and routed to an `OobiResolver` that fetches the endpoint reply under the §5 input limits, verifies it (S1, S4) and stores the issuer's `KelState`. This follows the one-scanner direction of [ui-ux-improvements-plan.md](./ui-ux-improvements-plan.md) ("the app's one scanner") and must not add a second scanner. Resolving an OOBI is an HTTP request to a host the issuer chose, so it discloses the phone's network address and the moment of interest to that host (R8); the UI names the host before fetching.
- **Issuer discovery.** For stock KERI issuers, an OOBI. For the Utah case, the state's did:webs (DBI §5.1), whose KEL the wallet replays (S4). The scan path and `OobiResolver` handle OOBI; did:webs resolution is DBI Phase 2's resolver, consumed through the shared package (§6).
- **DBI defines no acquisition protocol.** Its only delivery reference is the existing `credential-exchange/issue/0.1` (DBI §9, document proofs and credential delivery). KH IPEX therefore delivers the primary and the DBI credential, linked by the DBI credential's edge to the primary's SAID, and the wallet verifies the edge (S6) before storing both.
- **IPEX grant/admit** is the issuance exchange. The wallet receives `/ipex/grant` carrying the ACDC, issuer KEL events and TEL events, runs §5, then sends `/ipex/admit`, or `/ipex/spurn` on failure. It does not initiate with apply/offer/agree in v1.
- **The wallet's exchange identity.** The wallet has no KERI AID today, and `/ipex/admit` and `/ipex/spurn` are `exn` messages that an AID must sign. The wallet holds one **non-transferable AID** (no KEL, no witnesses, no rotation: the AID is its own public key, so any party verifies it without resolving anything) used only to sign `exn` messages. Its key is the `HolderSigner` of §8: Ed25519 (code `B`) from Askar, or P-256 (`1AAI`) from the device. It is not the issuee's key unless the issuer binds the credential to it (§8).
- **Grant delivery is a keripy-driven issuer pushing over our carriage.** `credentials.test.ts` in signify-ts delivers the grant agent to agent: the issuer's KERIA agent `submitGrant`s, the holder's KERIA agent receives it as a notification through KERIA's mailbox and `admit`s from a transferable, witnessed AID. The wallet is neither a KERIA agent nor a mailbox poller (R3), so that exact flow cannot reach it. KH-P4 therefore uses the signify-ts stack only on the issuer side (registry, issue, revoke) and a keripy-driven delivery script that builds the `/ipex/grant` `exn` addressed to the wallet's non-transferable AID and posts it into the wallet's DIDComm or TSP channel. A **mailbox-poll client** inside the wallet, which would let a KERIA-hosted issuer reach it, is the alternative and is KH-Q10, not v1.
- **Carriage.** IPEX messages ride whichever transport the wallet already has: DIDComm v1/v2, or the TSP carriage in `modules/trust-tasks`. The IPEX exchange is wrapped, not re-implemented as a Trust Task; whether a Trust Task spec for it should exist is an upstream question, recorded in the companion, not a dependency. **The ACDC travels as opaque bytes**: a base64url string or a CESR attachment, never a JSON object the DIDComm or TSP layer parses and re-serializes, because a SAID is a digest over exact bytes (§3). The carriage test of KH-P4 round-trips a fixture whose key order and whitespace a JSON re-serializer would change.
- **No new mediator.** KERI mailboxes are out of scope; the grant arrives on the existing channel. A KERIA-hosted issuer that expects the holder to poll a KERI mailbox is out of reach in v1 (R3, KH-Q10).

**Presentation.**

- v1 presents the held ACDC as an IPEX grant to a verifier, with the issuer's KEL/TEL evidence, over the same carriage. The verifier checks it the way §5 does.
- **A derived or zero-knowledge presentation is the VTA's job** (DBI, #114). The module exposes `exportForPresentation(record)` returning exactly the retained list of §3 for the record's anchoring form, with the `HolderSigner` handle in place of key material, and nothing else is promised.
- **Request mediation with consent.** For DBI presentations the wallet is the consent point: it receives the verifier's request over OpenID4VP or the W3C Digital Credentials API (the pilot verifier's triggers, DBI Phase 1), shows the holder the subset of attributes that would be disclosed (holder-chosen disclosure, DBI §1), and on approval hands `present(credentials, request, sessionTranscript, status)` (DBI §5.5) to the VTA together with the retained material. The wallet refuses a request for attributes outside the credential's blocks.
- **Cross-context correlation.** A plain ACDC presentation exposes the issuer SAID, the credential SAID and the registry; the same ACDC shown to two verifiers is linkable. The UI says so before presenting. Reducing this is the DBI plan's work (its §5.4), not this plan's.

## 8. Key custody

The holder's own key is out of this plan's scope as a non-goal, and the interface to it is a seam, not a decision.

- Which key signs for the holder (VTA-side `keys/sign/0.1`, or device-side `hardware-signing/key.ts`, P-256) is **DBI-Q11**, undecided.
- **Binding form.** What the wallet accepts as the issuee depends on the profile:
  - **Stock/vLEI profile: any issuee AID.** vLEI credentials and signify-ts's `credentials.test.ts` bind the credential to the holder's AID, which is transferable (`a.i` is the holder's witnessed AID). The wallet verifies such a credential. It presents as that holder only if its `HolderSigner` signs for that AID's current key; otherwise the record is shown as held but not presentable, and a chained credential whose edge uses `I2I` needs the issuee's KEL replayed (S4, S6).
  - **Utah/DBI profile: a key-oriented, non-transferable issuee, conditional on DBI-Q13.** DBI-Q13 reads: "a non-transferable P-256 prefix (`1AAI`) as issuee, or an explicit key attribute; a transferable issuee AID would mean replaying its KEL in the circuit. *Not decided; Utah's identifiers per Q3.*" If it is decided that way, the wallet rejects a transferable issuee on a credential of this profile as `failed(issuee not key-oriented)`. Until then the check is a profile option, off by default. The code is by key type: `1AAI` is ECDSA secp256r1 non-transferable (`ECDSA_256r1N` in keripy's table; DBI X6), and the Ed25519 non-transferable code is `B`.
- This module takes a key-oriented `HolderSigner` interface (`sign(bytes) -> signature`, `publicKey`, `code`) and never holds key material itself. KH-P5 is written against the interface, tested with an Askar Ed25519 signer and a P-256 signer, and re-run with whichever DBI-Q11 chooses.
- A holder key the wallet does not control (the VTA's) means "presentation" is the VTA presenting on the wallet's behalf (§7). That is a Trust Task to the VTA and is not designed here.

## 9. Integration points and sequencing

| Point | File | Change | Sequencing |
|---|---|---|---|
| Credential kinds | `bifold/packages/core/src/modules/vrc/credentialTypes.ts` | An `acdc` kind through the **predicate-aware wrapper PR #259 / bifold #212–#222 introduce**, not an independent edit (bifold #214 edits the same file and adds the allowlist of recognized predicates) | After that stack lands |
| Display | `core/src/modules/vrc/display/displayRegistry.ts` and a new handler | `AcdcDisplayHandler` (`CredentialDisplayHandler` -> `CredentialDisplayResult`), registered in `vrc/register.ts` | KH-P3 |
| Screens | `CredentialOffer.tsx`, `ListCredentials.tsx` | Branch on the `acdc` kind; offer screen shows the §5 report | KH-P3 |
| DI tokens | `core/src/container-api.ts` | New tokens for the verifier, the OOBI resolver and the store | KH-P3; coordinate with #387 (`app/container-imp.ts`) |
| Credo modules | `app/src/utils/bc-agent-modules.ts` | No ACDC module registered here; record storage goes through the existing Askar wallet | n/a |
| Scan | `core/src/screens/Scan.tsx`, `core/src/utils/helpers.ts` (`connectFromScanOrDeepLink`) | OOBI detection and route, before the DIDComm fall-through | KH-P4 |
| Carriage | `core/src/modules/trust-tasks` | IPEX messages through the existing carriage | KH-P4; open bifold #214 edits `ceremony.ts` and `witnessCeremony.ts` in the same module |
| Package wiring | root `package.json`, `app/package.json`, `app/metro.config.js`, `yarn.lock`, `.yarn/patches` | `bifold/packages/keri-verify` (§6), shared with DBI Phase 2 | The KH-P0 spike is **outside the repo and not merged**; wiring merges with KH-P1 after #259 |

Keep every edit to these shared files minimal, and rebase on the open PRs (#259 and its bifold stack, #387) rather than racing them. (#229 and #222 are merged and touch only the bifold pin and a CI workflow.) #252's proposed Node two-agent harness (N1–N3) is where an ACDC rig plugs in for CI; KH-P4 should reuse it if it has landed.

## 10. Phases

Each phase ends with a signed commit on its own branch; none merges without its *Done when*. Phase names are `KH-Pn`; DBI's phases are named `DBI Phase n`.

**KH-P0: Hermes spike (time-boxed); vector reuse and generation.**
A scratch React Native 0.81 Hermes app **outside the repo**, using the Hermes VM probe method of `tsp-reference/ref-03b-hermes-identity` where a VM run is enough. Copy cesr `primitives/`, `core/`, `serder/`, `parser/` and `tables/` with the §6 cuts (direct imports, no barrel); rewrite `npm:`/`jsr:` specifiers; add the polyfills the gates need; bundle with Metro and run on a Hermes **release** build. Reconcile the keripy pin (§13) and write `scripts/keri/gen-utah-minimal.py` (§6) to generate the Utah minimal set. Then: replay the cesr SAID vectors (Blake3 `E`) and the generated SHA2-256 (`I`) SAIDs; verify the reused Ed25519 `icp`/`rot` signatures and the generated P-256 `icp`/`rot` signatures, including a high-S one; check an Ed25519 witness receipt on the P-256 log; run `validator.ts`'s Ajv2020 compile and a draft-07 compile; record bundle size and cold start.
*Done when:* (1) the SAID vectors and the KEL signatures verify on Hermes under both suites; (2) each of G-H1–G-H7 is recorded passed or failed in a dated companion; (3) the ajv result (compiles in both dialects, or the precompiled validator is needed) is recorded; (4) the Hermes rows of §13 are resolved, each marked confirmed or refuted with the measurement behind it: Hermes has no WebAssembly on this app's build, the trimmed cesr-ts subset runs, and ajv 8 runs; (5) the Utah minimal set exists with its `PROVENANCE.json`, and any keripy `I`/P-256 behaviour that differs from DBI §5.1 is recorded as a `deviation`. If a gate fails on a few imports, KH-P1 patches them; if Hermes cannot run noble's P-256 or Blake3 at all, the plan is reopened in a dated companion. No production code merges.

**KH-P1: CESR, SAID and schema verification.**
S1–S3 in `bifold/packages/keri-verify`.
*Done when:* every reused parity vector (cesr `current-said-vectors.json`, keri `credential-replay-927.json` and `replay-927.json`) parses and its SAIDs recompute byte-identically in jest; the SAIDs of every SEDI-shaped schema in the pinned keripy `test_sedi.py` (counted from the pinned file, §13) match their hardcoded values; the vLEI QVI schema (draft-07) compiles and validates a sample ACDC, and a schema with an unlisted `$schema` fails S3; a blinded block-granular fixture's block SAIDs recompute from block and salt `u`; a one-byte mutation of each vector fails S2; a Blake3 and a SHA2-256 case both pass (A2); and each input limit of §5 (message size, KEL stream size, counter count, nesting depth, fetch timeout, redirect limit, remote `$ref`, a pathological `pattern`) has a negative test that fails closed.

**KH-P2: KEL, TEL and anchoring verification.**
S4, S5, S5b and `keyStateAt`, against fixtures generated by keripy/keria (§11), shared with DBI Phase 2.
*Done when:* an inception, a rotation chain, a witnessed event set, a direct-anchored issuance, and an ACDC issue and revoke TEL each verify; a `SealRoot`-anchored status root verifies and a fixture holder finds its leaf and clear bit; each of these fails when mutated (bad signature, below-threshold receipts, missing anchor, duplicitous event, wrong Merkle path); a P-256 log (explicit next-key code, a high-S signature, Ed25519 witness receipts) verifies in the Utah profile and an Ed25519 log in the stock profile; a superseded anchoring event fails S5-direct; a refresh returning a different event at a held `sn` is reported as duplicity; delegated-AID handling is recorded (KH-Q2); the time source `keyStateAt` uses is chosen and recorded (KEL events carry none, KH-Q11); and the **KEL replay budget** is met: a generated log of one `ixn` per credential (DBI §7.2's recommended form, DBI-Q7) at 1 000 and at 10 000 events replays on a Hermes release build with time and memory recorded, and the proposed budget (Brendan to confirm) holds: a full replay of 10 000 events within 30 s, and an incremental refresh of 100 new events from a stored `KelState` within 2 s. A miss is reported to DBI-Q7 (batch under `SealRoot`, or a separate issuing AID) and is not absorbed here.

**KH-P3: Storage and display.**
`HeldAcdcRecord`, `KelState`, the display handler, and the list/offer screens.
*Done when:* a fixture ACDC round-trips through storage with exact bytes and the same SAID, for both retained-list forms (§3); the list screen shows it with its status and the age of the check (the status epoch, for a bitstring); `unchecked` stages render as such in a screen test; a credential from an issuer outside the `TrustedIssuerPolicy` renders `unchecked(issuer not trusted)` (S8).

**KH-P4: OOBI and IPEX acquisition.**
Scan path, `OobiResolver`, IPEX grant/admit carrying the primary and the DBI credential.
*Done when:* with the issuer side of the signify-ts `docker-compose.yaml` stack (KERIA, keripy witness-demo, the vLEI schema server) issuing a credential by `credentials.test.ts`'s issuance steps, and a keripy-driven script delivering its `/ipex/grant` over the wallet's carriage (§7), the wallet, holding a non-transferable exchange AID, resolves an issuer OOBI, verifies the credential end to end, and the issuer side observes the admit (that keripy accepts an admit from an AID it holds no KEL for is checked here, §13); a revoked credential is received and shown revoked; a grant that fails S2 produces a spurn; the carriage round-trips a byte-sensitive ACDC with its SAID unchanged; a fixture primary plus DBI credential pair is accepted only when the edge matches (S6); and a verifier for KH-P5 is selected and added to the stack (candidates: the verifier-agent role in `credentials.test.ts`, whose apply/offer/agree flow is KERIA-to-KERIA, or the vLEI verifier service).

**KH-P5: Presentation and VTA hand-off.**
Plain presentation to a KERI verifier; request mediation with consent UI; `exportForPresentation` and the `present(...)` hand-off to the VTA.
*Done when:* the verifier selected in KH-P4's Done when accepts a presentation made by the wallet through `HolderSigner` (the signify-ts compose file has no verifier service, §13); the correlation notice shows before presenting; a consent-UI test shows the disclosed subset and blocks an out-of-credential attribute; the `exportForPresentation` test asserts every field of the retained list for the direct+bitstring form and for the TEL form (§3) and fails when one is dropped; the export is refused for a VTA that fails the holder-controlled test. "Holder-controlled" is whatever DBI-Q12 decides; it is undecided, so the test is a configurable policy that refuses by default, and its definition is recorded here when DBI-Q12 closes.

**KH-P6: End to end.**
Appium two-device flow in `e2e/`.
*Done when:* the e2e passes unattended on an emulator or simulator against the KH-P4 stack, and the record of what it cannot prove (hardware-backed custody) is in the e2e README.

**KH-P7: Status upkeep, revoke and re-bind, backup.** Later; waits on DBI-Q4 and DBI-Q14.
Fetch the whole status list on a schedule and display the status-epoch age; holder-initiated revoke of the DBI credential and re-bind to a new holder key (DBI §5.3); the backup decision.
*Done when:* the list screen shows the epoch age of the last fetched list and flags it past the DBI-Q4 window; a revoke or re-bind request is sent over the carriage and the new record replaces the old with the same exact-bytes guarantees; the backup decision (backup covers `HeldAcdcRecord`, or a lost phone means revoke and re-bind) is recorded in a dated companion.

## 11. Test strategy

| Resource | Role | Phase |
|---|---|---|
| keripy `tests/spec/cesr` and `tests/spec/acdc`; keri-ts `current-said-vectors.json`, `credential-replay-927.json`, `replay-927.json` (Apache-2.0, NOTICE kept) | Byte-exact vectors, ported or reused as JSON with provenance | KH-P0, KH-P1 |
| keripy `tests/sedi` (`test_sedi.py`, `test_ipex_sedi.py`) | SEDI-shaped schemas with hardcoded SAIDs (count fixed from the pinned file in KH-P1); the edge-operator shapes. **Design evolving, no sign of state endorsement: fixtures only, no conformance claim** | KH-P1, KH-P2, KH-P6 |
| keripy `tests/vdr`, `tests/core`, `tests/vc` | TEL and KEL behaviours and negative cases, ported by reading and by generating | KH-P2 |
| `scripts/keri/gen-utah-minimal.py` (pinned keripy) | The Utah minimal set: P-256 `icp`/`rot`, high-S and low-S signatures, an `I` (SHA2-256) ACDC anchored by `ixn`, Ed25519 witness receipts. The reused keri-ts vectors cover Blake3 and Ed25519 only (§6) | KH-P0, KH-P1, KH-P2 |
| signify-ts `docker-compose.yaml` and `test-integration/` | Issuer-side counterpart: KERIA, keripy witness-demo, `gleif/vlei` (images `weboftrust/keria` 0.4.0, `weboftrust/keri` 1.2.13). No verifier service. `credentials.test.ts` covers issue, grant/admit and revoke between KERIA agents; the wallet takes only its issuance side (§7) | KH-P4, KH-P5, KH-P6 |
| `fortweb` (`/srv/dev/code/seas/fortweb`, `python/run_webbaser_lifecycle.py`) | KEL, receipt and OOBI vectors, and a second-implementation cross-check. No ACDC or IPEX | KH-P2 |
| `vtafarm/webvh-build-pipeline`, `mediator-build-pipeline` (`keri.cesr`, `affinidi-cesr`) | Rust CESR cross-check, if reachable | KH-P1 |
| `bifold/packages/vrc-reference/__tests__/integration` | New `acdcConformance.test.ts` beside `vc20Conformance` and `diConformance` | KH-P1 onward |
| `tsp-reference/ref-NN-*` | One new rung for CESR/KERI interop, following the ladder's conventions | KH-P2 |
| jest in `app/` and `bifold/packages/core` | Unit and screen tests | KH-P3 |
| `e2e/` Appium | Two-device flow | KH-P6 |

**Fixture generation.** A script, `scripts/keri/gen-fixtures.mjs` (or Python; `gen-utah-minimal.py` of §6 is its first member), runs a pinned keripy (and, for the KERIA flows, a pinned keria and signify-ts) in the manner of `scripts/openvtc/setup-external.mjs`: clones into the gitignored `external/` at exact commits recorded in `scripts/openvtc/PINS.json`, the one pin file shared with the DBI plan. It writes fixtures under `bifold/packages/keri-verify/__fixtures__/<source>/<commit>/` with a `PROVENANCE.json` (producing implementation, commit, command, date, digest and signature codes). Fixtures are generated once and committed; CI does not regenerate them. **Read upstream source only from the pinned clone**, never a sibling checkout (root `CLAUDE.md`, "OpenVTC/TSP upstream clones").

A fixture that deviates from a spec (a keripy default the spec does not require) is marked in its `PROVENANCE.json` as `deviation`, with the reason, and the test names it. Shared with the fixture rule of `DBI G2`.

## 12. Risks and open questions

**Risks.**

- **R1 Own verifier.** The state machines are ours (L3), so their completeness against keripy is our risk. Mitigation: ported keripy fixtures and keri-ts parity vectors (KH-P1, KH-P2); keri-ts is a readable reference only, not a dependency.
- **R2 No maintained library covers the whole holder surface**, confirmed only as far as the research companion records.
- **R3 Mailbox-polling issuers.** An issuer that needs a KERI mailbox is unreachable in v1; the grant must be pushed over our carriage (§7, KH-Q10).
- **R4 Spec drift.** The ACDC and SEDI profile are moving; the pinned version is recorded in every fixture.
- **R5 Shared-file conflicts** with #259, #387 and the bifold #212–#222 stack (§9).
- **R6 KEL growth.** DBI §7.2's recommended direct anchoring puts one `ixn` per credential in the state's KEL, and "did:webs resolution replays the whole `keri.cesr` stream" (DBI §7.2). S4 on first resolution replays that whole log on the phone, so cost grows with every credential the state issues. Tied to DBI-Q7. Mitigation: incremental replay from a stored `KelState`; the size and time budget measured in KH-P2, whose miss goes back to DBI-Q7.
- **R7 Hostile input.** CESR streams, OOBI replies, schemas and IPEX messages come from parties the wallet does not trust; unbounded parsing, redirects, remote `$ref` and regular expressions are denial-of-service and SSRF routes. Mitigation: the §5 limits with negative tests in KH-P1.
- **R8 Privacy of verification.** A per-credential TEL fetch tells the registry host which credential is checked and when, which DBI §5.3 rules out for DBI credentials (whole-list fetch only); OOBI resolution discloses the phone's network address and interest to the issuer's host. Mitigation: bitstring credentials use the whole-list path; the UI names the host before an OOBI fetch and states the TEL-fetch disclosure.
- **R9 Duplicity without watchers.** A wallet sees only the events it is given, so a split KEL is invisible until a second view arrives. Mitigation: the §5 refresh policy and duplicity reporting; no claim of "no duplicity" beyond the events held.

**Open questions.**

| # | Question | State |
|---|---|---|
| KH-Q1 | Does the VTA need a resident copy of the primary beyond a per-session export (DBI B-batch)? The phone is the system of record and the export goes to a holder-controlled VTA only (§4; DBI §5.2, DBI-Q12) | Waiting on `DBI G0` (B-direct or B-batch); ours to decide after it |
| KH-Q2 | Delegated issuers in v1 or not? Scope tied to `DBI G2`: no P-256 evidence yet with witnesses or delegation | Not decided; decided in KH-P2 |
| KH-Q3 | What staleness bound makes a cached status unacceptable? Tied to **DBI-Q4**: epoch cadence and `maxWindow`, owned by Utah | Waiting on Utah, via the DBI plan |
| KH-Q4 | Will communities accept KERI/vLEI as vetting evidence (VTI-Q26)? | Waiting on upstream. VTI-Q26 is filed in `docs/VTI_UPSTREAM_FINDINGS.md` on branch `docs/dbi-plan` (PR #346, v1.45) and is absent from `main` until that merges |
| KH-Q5 | Holder-key custody (**DBI-Q11**) and binding form (**DBI-Q13**) | Waiting on the DBI plan |
| KH-Q6 | A Trust Task specification for IPEX carriage? | Not decided; an upstream question |
| KH-Q7 | Does the SEDI guide's Annex D.3 format checklist and parts 4 and 9 constrain wallet behaviour beyond §5? | Not decided; parts 4, 9 and annex G are unread (§13). Read before KH-P3 |
| KH-Q8 | Which protocol version does the wallet pin? The reused fixtures mix `KERI10JSON` (v1) and `KERICAACAAJSON` (protocol 2), and keri-ts's `TODOs.md` lists "explicit v2 support" as missing | Not decided. Tied to **DBI-Q8** (ACDC protocol version and fixed-layout profile) and DBI X10 ("Status v1.1, but examples use protocol-2.0 strings"); the pin is recorded in every fixture's `PROVENANCE.json` |
| KH-Q9 | Where does the `TrustedIssuerPolicy` (§5, S8) come from: pinned in the app, a governance source, or added by the person? | Not decided |
| KH-Q10 | Does the wallet gain a KERI mailbox-poll client so a KERIA-hosted issuer can reach it? v1 takes a keripy-driven push over our carriage instead (§7) | Not decided; deferred past v1 |
| KH-Q11 | Which trusted time source maps a time to an `sn` for `keyStateAt`? KEL event bodies carry none (companion IX); first-seen `datetime` is receiver-side metadata | Not decided; recorded in KH-P2, with DBI Phase 0 for the requirement |

## 13. Unverified claims and how each is resolved

Everything below is a claim the design relies on that has not been checked against its source, or has been checked only from a description. None is treated as settled. Claims that were checked, with their evidence, are in companion Part IX and are not repeated here. "Resolved by" names a phase, a gate or a person; a row is closed by recording the result in a dated companion.

| Claim | Source | Why it matters | Resolved by |
|---|---|---|---|
| Hermes has no WebAssembly on this app's React Native 0.81 build | General knowledge; not measured here. `tsp-reference/ref-03b-hermes-identity` measured pure-JS noble HPKE (X25519, HKDF-SHA256) byte-identical on the app's Hermes; that does not cover P-256, Ed25519, Blake3 or SHA2-256 | The libsodium path is cut on this basis (G-H1); if WASM were available the cuts are unnecessary but harmless | KH-P0, G-H1 |
| The trimmed cesr-ts subset (parser, `Serder`, `Saider`, `Diger`, `Verfer`, after the §6 cuts) bundles and runs on Hermes, including noble Blake3, SHA2-256, Ed25519 and P-256, under the noble version G-H6 picks | Static reading of the keri-ts clone (companion VIII.3, X); never bundled or run. cesr-ts pins noble 1.9.7/1.8.0 against this repo's 2.0.1 | The L2 half of the library decision | KH-P0 acceptance (1), G-H3, G-H4, G-H6, G-H7 |
| ajv 8 compiles on Hermes (`new Function`), in both draft-07 and 2020-12 | keri-ts uses `ajv@8.17.1` (verified, companion IX). `bifold/packages/trust-tasks/src/validator.ts` already compiles schemas at runtime with `Ajv2020` in the app, which is indirect evidence for 2020-12 only; neither dialect is measured on Hermes here | S3 JSON Schema validation | KH-P0, G-H2 and acceptance (3) |
| The keri-ts verify path is free of keri-ts `runtime`/`db` imports once cesr-ts is taken alone | Reading of import statements only | Whether the L2 cuts are sufficient | KH-P0, G-H5 |
| keri-ts maintainership and history: one author, bursty releases | The visible history is a shallow clone (115 commits, one author, 2026-10-12/13); true history depth and any other maintainers are not established | Part of why L1 is rejected; the structural reasons (no in-memory `Kever`/`Tever`) hold regardless | Re-read from a full clone at KH-P0; does not gate the decision |
| keripy commit `927c0cb` is the correct reference for the reused vectors | Exists upstream (companion IX); that keri-ts's vectors really reproduce under it is not re-run | Parity vectors are only as good as their provenance | KH-P1: regenerate one vector with a pinned keripy and compare |
| keripy pin: `25f06d2` (DBI companion), `7143832` (this research) and `927c0cb` (fixtures) differ | Both of the first two exist upstream (companion IX) | Fixtures must come from one pin, and the Utah generator needs it in KH-P0 | KH-P0 start; single entry in `scripts/openvtc/PINS.json`, owned jointly with the DBI plan (DBI Phase 0 "Pins") |
| Utah's primary credential is an ACDC (DBI X14, assumption A1) | Brendan's report of 2026-10-07; unconfirmed in writing | Without it the Utah case and the KH-P4 SEDI target fall away | Utah, via Brendan: DBI-Q1 and `DBI G1` |
| Utah uses SHA2-256 SAIDs (A2) and P-256 issuer signing (A3); P-256 is supported through the state's tooling | DBI §5.1 and its companion propose them; DBI-Q3 | Chooses the primary profile | Utah, via DBI-Q3 and `DBI G1`; the digest question (A2) should be added to that ask, since it is not on it today |
| signify-ts verifies but does not sign P-256; KERIA lacks P-256 | DBI plan; not re-checked here | Limits the fixture and e2e issuer to keripy for P-256 | KH-P2 fixture generation records the producer; confirmed or refuted there |
| DBI-Q7 (direct versus indirect anchoring) is undecided | DBI §10 item 7: waiting on Utah and Brendan | Decides which retained list applies (§3) and which S5 form Utah needs | Utah and Brendan via DBI-Q7; both forms are supported until then |
| P-256 works with witnesses and delegation | No evidence. `DBI G2`'s done-when requires verification "with witnesses (and delegation if used)"; the single-signature, witness-free limit is DBI §5.1 "Signing tooling", in force until `DBI G2` passes | Witness receipts (normally Ed25519) in a Utah-profile log and delegation under P-256 stay `unchecked` | `DBI G2`, then KH-P2 and KH-Q2 |
| SEDI Implementation Guide (0.1.0-draft): the technology-neutral statement, the candidate list, Annex D.3 and the statute requirements | Relayed by Brendan from the Guide. Parts 4, 9 and annex G are unread | May add wallet obligations (KH-Q7); A4 | KH-Q7: read before KH-P3 |
| Public hosted test witnesses exist | None found; the search was not conclusive | Without one, KH-P4 depends on the local witness-demo only | KH-P4 stack selection |
| trustoverip ACDC/KERI/CESR conformance vectors exist and are usable | Unchecked | Independent parity vectors beyond keri-ts | KH-P1: check before the vectors are fixed |
| `cesr-rs` is a usable library | Unverified | Rejected-options completeness only | Not needed by any phase; check only if L2/L3 fail at KH-P0 |
| `vtafarm` Rust KERI/CESR fixtures (`webvh-build-pipeline`, `mediator-build-pipeline`) are usable | Directory names seen; contents not opened or vetted | A possible second cross-check | KH-P1: open and vet, or drop the row from §11 |
| `fortweb` has no ACDC or IPEX | Grep of the tree: only a CESR version-string check and a counter-code name in `app/runtime/` (companion IX). A reading of its Python runtime beyond that has not been done | Scope of what fortweb can cross-check (KEL, receipts, OOBI only) | KH-P2: confirmed when the vectors are extracted |
| keripy `tests/sedi` has SEDI-shaped schemas with hardcoded SAIDs and is evolving without state endorsement | The whole 298,085-byte `test_sedi.py` has 13 `"$id"` occurrences (companion X); how many are distinct top-level schemas is not established. "Evolving, not endorsed" is an inference | KH-P1 acceptance is checked against the pinned file's count; the "no conformance claim" rule depends on the endorsement reading | KH-P1: count distinct schemas in the pinned file; endorsement: Utah via DBI-Q1, `DBI G1` |
| The SEDI-proposed edge operators and `I2I`/`NI2I`/`DI2I` shapes in keripy tests are what a state issuer would use | keripy tests only | S6 and S7 scope | KH-P1 and KH-P2 fixtures; Utah |
| Whether the cesr-ts `Serder` and parser handle the blinded block-granular ACDC form DBI-Q21 needs | Not read | S2 acceptance in KH-P1 | KH-P1 |
| The Utah credential uses blinded, block-granular disclosure | Unconfirmed: DBI-Q21 ("which claims are separately disclosable blocks") is open and waits on Utah | S2 and S7 scope for the Utah profile | Utah, via DBI-Q21 |
| keripy produces SHA2-256 (`I`) SAIDs and P-256 logs as DBI §5.1 and X9 describe; keripy's `Signer` has P-256 codes (`ECDSA_256r1`, `ECDSA_256r1N`) | The code table was read upstream (companion X); production of a full log was not run | The Utah minimal set (§6) | KH-P0 acceptance (5) |
| keripy accepts an `/ipex/admit` signed by a non-transferable AID it holds no KEL for | Unchecked; follows from a non-transferable AID being self-certifying | KH-P4's wallet exchange identity (§7) | KH-P4 |
| The protocol version (v1 `KERI10JSON` or protocol 2 `KERICAACAAJSON`) a Utah issuer uses | Fixtures mix both; DBI X10 and DBI-Q8 are open | Parser and S2 coverage | KH-Q8 |
| Open PR #202's vault accepts no ACDC; #259 and its bifold stack introduce a predicate-aware `credentialTypes.ts` | Read from PR bodies, diffs and file lists, which confirm the file and the single-proof rule (companion IX). The bifold gitlink itself was not opened, and the Rust paths cited by #202 were not read | §4 storage, §9 sequencing | Re-read each PR at the time KH-P1 wiring is rebased on it |
| Behaviour of #114, #387, #252 and bifold #212–#222 as relied on here | Titles, bodies and file lists only (companion IX) | §7, §9 and §11 cite them as stable | Re-read at the same rebase |
| DBI plan claims: PR #346 content, DBI companion IX.4, and pins | Read from the checkout at `/srv/dev/code/seas/keyring-wallet-dbi`, which is PR #346's branch and not merged | This plan cites it as the first customer | PR #346 merges, or its edits (companion VIII.5) land |
| A verifier service is available for KH-P5 | The signify-ts compose file lists none (companion IX) | KH-P5 acceptance needs a verifier | KH-P4 stack selection |
