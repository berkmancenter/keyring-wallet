# OpenVTC data rooms × Encrypted Spaces: storage and sync fit

**Status:** Draft — analysis and proposed integration (option B below); not scheduled, nothing
built.
**Parent:** [`../openvtc-rooms-plan.md`](../openvtc-rooms-plan.md)
**Reasoning:** [`./2026-10-06-bam.md`](./2026-10-06-bam.md) (the Encrypted Spaces assessment
this builds on); [`./2026-10-13-bam.md`](./2026-10-13-bam.md) (re-baselining onto the VTI pin)
**Baseline:** VTI `49f5f1be` (tag VTI-Eucalyptus, 2026-10-07), Keyring's pin in
`scripts/openvtc/PINS.json`

## Sources

- **Rooms planning doc:** [`openvtc-rooms-plan.md`](../openvtc-rooms-plan.md).
- **Rooms code and design:** verifiable-trust-infrastructure at the pin `49f5f1be`, the
  `external/verifiable-trust-infrastructure` clone managed by `scripts/openvtc/setup-external.mjs`
  (read from its git objects at the pinned commit). Paths written `VTI/...` are relative to
  that commit.
- **Encrypted Spaces (ES):** the assessment [`2026-10-06-bam.md`](./2026-10-06-bam.md), plus
  [github.com/encrypted-spaces/prototype](https://github.com/encrypted-spaces/prototype) at
  `aa7440b` (tag `v0.0.2`, 2026-09-22) and
  [github.com/encrypted-spaces/merk](https://github.com/encrypted-spaces/merk) at `9954382`
  (tag `v0.0.2`, the revision `prototype`'s `Cargo.lock` resolves). Both are Apache-2.0. ES
  paths below are relative to `prototype` unless prefixed `merk/`.

An important finding before anything else: **rooms have already looked at ES and taken parts of
it.** `VTI/vti-rooms/src/retention.rs` (header) implements the upper tier of ES's retention key
tree as a linear epoch-link chain. `VTI/vti-rooms/src/merkle.rs` adds an ES-style data commitment
over a room's records. `docs/05-design-notes/data-rooms.md` §11 (prior-art table) states what was
taken and what was declined: ES's group-key layer (linear rekey + mVE instead of MLS), its
identity model, and its zkVM fast-forward proof. §14 item 7 calls verified reads "the one
Encrypted Spaces idea worth taking that we have not". So the question is how much more of ES to
adopt, not whether the two connect at all.

## 1. Does the room design support different storage solutions?

**The engine is not pluggable through a trait. The hosting location is pluggable by design.**

- *Engine.* `VTI/vti-rooms/src/storage.rs` is a set of free functions over
  `vti_common::store::KeyspaceHandle`. That type is an **enum**, not a trait
  (`VTI/vti-common/src/store/mod.rs`, `pub enum Store` / `pub enum KeyspaceHandle`), with two
  variants: local **fjall** and **vsock** (a store proxied to the parent instance for Nitro
  enclaves). An optional `encryption` feature adds at-rest encryption with location-bound AAD.
  At the pin the module also has `store/test_fixture.rs`, compiled only under `cfg(test)` or the
  `test-support` feature: it opens pre-created fjall keyspaces for tests and adds no backend.
  To add a backend you would add an enum variant or pull out a trait. No other backend
  (SQL, S3, DynamoDB) is planned for rooms. `vta-tee` uses DynamoDB, but not for rooms.
- *The one real trait seam is for authorization, not storage:* `ChainVerifier`
  (`VTI/vti-rooms/src/authz.rs:142`). It exists so that `room-host` and `vtc-service` reach the
  same room decision.
- *Hosting.* Invariant I3, "Hosting is a setting, not an exit" (`data-rooms.md` §2), and §7.1 keep
  "who controls the DID" separate from "who stores content". Hosts can be the standalone
  `room-host` or the VTC in-process (`VTI/vtc-service/src/rooms/handlers.rs`). Moving a room means
  re-pointing its DID service endpoint.

**What the storage contract assumes:**

| Aspect | Contract | Source |
|---|---|---|
| Model | Ordered KV with prefix scans: `rooms:`, `room_records:<room>:<key>`, `room_epoch_links:<room>:<epoch>` | `storage.rs` header |
| Ordering | Per-room monotonic `version`. Read-modify-write is not atomic; gaps are allowed, duplicates are not | `storage.rs` "Version assignment" |
| Consistency | **One write-primary** per room (the MLS sequencer). `expectedVersion` preconditions; `0` means create-only | `data-rooms.md` §6, §7.3 |
| Replication | Read-only **mirrors** pull with `sinceVersion` and present a `read` credential like any member. Multi-primary and CRDTs are explicit non-goals | `VTI/room-host/src/mirror.rs`; §6.1, §7.3 |
| Log vs KV | Mutable KV with tombstones (`retracted`), not an append-only log. Epoch links are insert-once | `storage.rs::put_epoch_link` |
| Who reads/writes | Credential chain issued by the room DID (VMC + VAC: read/write/curate, attenuable, expiring). Never host ACLs (I5) | §2, §4 |
| Encryption | `attributed`: one sealed blob per record under the MLS exporter key. AEAD binds `roomId\|key\|version\|epoch` (ChaCha20-Poly1305). Host sees opaque keys, status, version, epoch, timestamps | §3.1, §6; `sealed.rs` |
| Deletion | `purge_record` is a request the host is trusted to honour. **Cryptographic** deletion works by pruning epoch links (`prune_epoch_links_before`) | `storage.rs`, `retention.rs` |
| Verifiability | Host computes a Merkle tree head and inclusion proof **on every read by rescanning the whole room** (`storage::tree_head`, about line 706). The commitments are optional in responses. Anchoring them in the witnessed `did:webvh` log is decided but not built | `room-host/src/lib.rs` ~760-850; `data-rooms-epoch-anchoring.md`; `data-rooms-verified-reads.md` |
| Limits | 64 KiB Trust Task body on a VTC, 2 MB on `room-host` (axum's default body limit; `room-host` sets none of its own). The replay guard is in-memory and single-process (`InMemoryReplayGuard`) | rooms plan §5; `room-host/src/lib.rs` ~499 |

## 2. Fit analysis: ES as a backend for rooms

| Rooms concept | ES equivalent | Fit |
|---|---|---|
| Room (DID, owner, visibility) | Space | Partial. ES has no DID and no owner/succession concept |
| Record `(roomId,key)` + sealed blob | Table row: plaintext key/status/version columns + encrypted blob column | Good. ES encrypts all non-`plaintext` columns |
| Per-room `version`, `sinceVersion` | Server-ordered changelog `change_id`, `fast_forward(change_id)` | Good |
| `expectedVersion` CAS | Unclear. ES write ACLs are predicates over columns; no per-row conditional write was found in `sdk/src` or `backend/src` (the only compare-and-swap is `MerkStorage::commit_candidate` on the whole-tree root), so a CAS on version is **unverified** | Unknown |
| `curate` vs `write` | ACL predicates on the `status` column | Possible |
| Membership: VMC/VAC credential chains, MLS group, VTA-held keys | `users` table (`uid` i64 + KEM/sig keys), invite = `InviteRequest{root_commitment, PoseidonMveProof}`, rekey | **Conflict.** Two group-key layers. Rooms rejected ES's |
| Identity: DIDs, presenter-bound presentations | `AuthContext{user_id}`, **client-asserted stub** (`sdk/src/authentication.rs`, test-gated) | **Mismatch.** Needs a DID→uid binding that is verified, not asserted |
| Authorization: room-issued VAC with expiry and attenuation | Schema ACL predicates, checked cryptographically and verified client-side; the server schema owns the rules | Mismatch. VAC semantics (expiry, agent attenuation) do not reduce to column predicates |
| Key custody: VTA holds keys, wallet holds none | SDK holds `UserWithSecrets` in-process | Workable **only if the ES client runs inside the VTA** (Rust, so feasible) |
| Retention: epoch-link chain, link pruning | Retention key tree + retention proofs | Rooms already copied the upper tier |
| Verifiability: optional host-signed head, O(n) recompute, witnessed anchor planned | Merk AVL commitment, per-change traces, range proofs, fast-forward ZK proof | **ES is stronger here.** This is the main value |
| Mirrors, VTC-or-standalone hosts | Single reference server; no mirror concept found | Gap |
| `private` tier (unlinkable) | None | Neither side has it |
| Deniability | None | Not needed: rooms want attribution (in-body signatures) |

**Server role is compatible.** Both use one sequencing server that is untrusted for
confidentiality. **Trust models differ:** rooms anchor in a witnessed DID log, and ES has no
transparency layer. These complement each other, since the witnessed log can carry ES's
commitment (`data-rooms-verified-reads.md` §2-3 already argues this).

**Three ways to integrate:**

- **A. ES as the full room backend** (one Space per room). This means replacing MLS with ES key
  management, or running both. You would also have to swap ES auth for Trust Task presentations
  and map VACs to ACL predicates. It goes against decisions recorded in §11, adds a second
  sequencer and protocol, and inherits the auth stub. **Not recommended.**
- **B. ES's verifiable-storage half only.** Put `merk` (and possibly ES's trace/proof format)
  under `vti_rooms::storage` as the record store. Rooms keep their own DIDs, MLS, credentials,
  sealing, epoch chain and mirrors. This gives incremental commitments and range/absence proofs
  for `list` without the per-read full rescan. **Recommended.**
- **C. ES as a host→mirror sync channel.** Low value: mirrors already cannot tamper, and
  `sinceVersion` pulls work.

## 3. What it would enable, and the risks

**Enabled (mostly through option B):**

- **List completeness.** A host cannot drop a record from a listing without being caught. ES
  maintains this continuously per change, and rooms currently show it only by optional
  recompute. Combined with the witnessed anchor, this gives "complete as of anchor N" that
  members can check without trusting the host.
- **Query proofs.** Range and absence proofs over opaque keys or plaintext columns, so filtered
  reads stay verifiable.
- **Cheap catch-up for agents and offline members.** Prove the step from commitment N to M
  instead of re-listing everything. A real ES fast-forward proof would add "ACL checks were
  applied" for every transition, which rooms cannot show today: a member cannot check that the
  host refused unauthorized writes, only that stored records are signed.
- **Retention proofs.** Proof that pruned epochs are gone from the committed state.

**Not new:** untrusted-host confidentiality, content integrity and cryptographic deletion. Rooms
already have these.

**Risks:**

- **Fake proofs by default.** `RISC0_DEV_MODE=1`, and ffproof was never run end to end
  (assessment, "Tests"). Any fast-forward claim is hypothetical until it is.
- **Authentication is a stub,** so ES server-side checks mean nothing until replaced. With
  option B this does not matter, because rooms' own authz stays in front.
- **AES-256-CTR with no MAC** (assessment item 2). Rooms must keep their own AEAD sealing and
  never rely on ES column encryption.
- **No transparency or consensus layer,** so ES alone cannot detect equivocation. The rooms'
  witnessed log must do that job.
- **Maturity:** tagged 0.0.2, "DO NOT USE IN PRODUCTION", no audit, API churn. Pin it and vendor it.
- **Rust-only SDK.** This suits the VTA and hosts but not the RN wallet, which goes through the
  VTA anyway (rooms plan §3.1). The SDK has a wasm build (`sdk/README.md`); untested here.
- **`merk` is an in-memory AVL tree** (`merk/README.md`: "an in-memory Merkle AVL tree with
  copy-on-write nodes"), and ES does not persist it: `backend/src/merk_storage/mod.rs` describes
  itself as "In-memory storage" and has no disk path. A rooms store would have to supply
  persistence itself (rebuild from fjall on open, or snapshot the tree); how that sits
  alongside fjall/vsock, and enclave (vsock) compatibility, are unknown.
- **Leaf encoding mismatch.** Rooms leaves commit to RFC 8785 canonical JSON of the wire record
  (`merkle.rs`). The spec's existing `dataCommitment`/trace format would need a versioned change.

## 4. Integration sketch

**Seam:** extract a `RecordStore` trait from the free functions in
`VTI/vti-rooms/src/storage.rs` (put/get/list/tree_head/tree_head_with_trace/epoch links),
following the `ChainVerifier` pattern in `authz.rs`. No such trait exists at the pin: the only
`trait …Store` definitions in `vti-rooms` and `vti-common` are `SessionStore`
(`vti-common/src/auth/backend.rs`) and `SeedStore` (`vti-common/src/seed_store.rs`), neither a
record store. The current fjall/vsock path becomes the
first implementation and a merk-backed store the second. Authorization, sealing, MLS and Trust
Task wiring stay as they are. Verification goes in `vti-rooms` (and therefore `vti-rooms-wasm`)
and is called by the VTA's `rooms/keys/read|browse`.

**Phases:**

1. **P0, measure (no code).** Benchmark the current per-read `tree_head` rescan at realistic room
   sizes. Read ES `backend/src/merk_storage` for its proof API, and decide how a merk tree is
   rebuilt or persisted across restarts (ES keeps it in memory only). Run ES
   `ffproof` in dev mode with the RISC Zero toolchain (see the assessment's follow-up).
2. **P1, trait extraction.** Behaviour-preserving refactor with the existing tests.
3. **P2, merk store behind a feature flag.** Same leaf commitment (canonical JSON), maintained
   per write, so reads stop rescanning.
4. **P3, range/absence proofs on `list`.** Versioned spec field, verifier in `vti-rooms`, tested
   with a host that omits a record.
5. **P4, anchor the root** in the witnessed log entry (`data-rooms-epoch-anchoring.md` §3a).
6. **P5, research only.** An `attributed` room backed by a full ES Space in a lab. ES's
   `uid` is bound to a member DID through the VMC, ES auth is replaced by Trust Task
   presentations, and real proofs are switched on. Decide afterwards whether option A is worth
   anything.

**Open questions:**

- Does ES support conditional writes (an `expectedVersion` equivalent)? None found in code.
- Can ES's trace format carry rooms' leaf encoding, or must one side change?
- How is a merk tree persisted or rebuilt for rooms, and does that survive the vsock/enclave
  store path?
- Who pays for real fast-forward proofs (GPU per batch), and is the witnessed anchor enough
  without them (`data-rooms-verified-reads.md` §2 argues yes)?
- Would ES ACL-in-proof ever be worth a second policy language beside VACs and `rooms.rego`?
- Does upstream want this? §14 item 7 says "sized, not scheduled".

## 5. Privacy guarantees compared, and running without a TEE

Sources: rooms material from VTI `49f5f1be` (`data-rooms.md` §3-6, §12; `sealed.rs`;
`vta-keyspaces/src/lib.rs`; `docs/02-vta/tee-architecture.md`); ES material from
`prototype` @ `aa7440b` and whitepaper v1.1. Items marked (inferred) are
inference, not verified from docs or code. Cryptographic soundness of either system was
not verified.

### 5.1 Privacy comparison

| Property | OpenVTC rooms (`attributed`, the only shipping tier) | Encrypted Spaces |
|---|---|---|
| Content encryption | MLS-derived key, ChaCha20-Poly1305; AAD binds roomId, key, version, epoch | AES-256-CTR with **no MAC** (`crypto/src/encryption.rs`); only non-`plaintext` columns encrypted |
| Host-visible metadata | Opaque keys, status, version, epoch, timestamps, blob size; fields in one blob so shapes are hidden | Schema, plaintext and indexed columns, row structure, ciphertext sizes, access patterns, timing, IPs |
| Who acted | Member DID disclosed on every read and write; host keeps a per-member access log. `private` (BBS+, unlinkable) designed, not coded | Per-space `uid` plus signed changelog entries; `_users` public-key table visible to the server |
| Membership list at host | No roster kept; could be rebuilt from presentation logs (inferred) | Users table is server-visible |
| Forward secrecy / PCS | MLS gives both at the key layer; the `Chained` epoch-link chain gives up PCS for stored content (a current key opens every retained epoch) | Ratchet on invite, fresh key on removal; PCS only via explicit key refresh (inferred); retention tree has the same "current key reaches everything retained" trade |
| Deletion | Purge is a host promise; cryptographic deletion is a coarse "every epoch before K" cut (`prune_epoch_links_before`), no wire verb yet | Per-item deletion via retention tree plus retention proofs (prototype quality) |
| Authorship | Signed with the member's DID inside the sealed body: provable to outsiders, invisible to the host | Ed25519 entries visible to the server; deniable mode not built |
| Integrity | AEAD plus signatures; Merkle head optional and recomputed per read; witnessed anchoring not built | Merkle commitment, signatures, fast-forward proofs; fake receipts by default (`RISC0_DEV_MODE`) |
| Hidden from other members | Nothing; members hold the group key | Nothing, apart from ACL predicates |
| Key custody | Member's VTA is the decrypt/prove oracle; agents never get keys; owner's VTA holds the room DID key | Client SDK holds `UserWithSecrets`; server holds no keys |

Net: rooms are stronger on content and metadata hiding and already use authenticated
encryption. ES is stronger on per-item deletion and verifiable history.

### 5.2 Non-TEE operation

**Rooms.** The Nitro enclave protects only the VTA: it holds the seed and JWT key via KMS
attestation, encrypts every keyspace (AES-256-GCM, including `ROOM_GROUPS`), and handles
attested bootstrap and the anti-rollback counter. `room-host` uses plain, unencrypted
fjall; a TEE-KMS VTC is a stated permanent non-goal.

- Holds without a TEE: confidentiality and integrity against the room host (by design).
- Weakens: protection of member and owner keys against whoever runs the VTA machine. Plain
  mode leaves MLS group secrets on disk in the clear; hardened mode
  (`hardened_bootstrap.rs`) encrypts at rest but root can read memory; both lose attested
  bootstrap and anti-rollback.
- Fix before untrusted hosting: witnessed epoch/root anchoring (otherwise the delivery
  service can fork or serve a stale view); require hardened mode; persist the replay guard
  (in-memory and single-process today); ship `private` if metadata matters.

**Encrypted Spaces.** Assumes no TEE; the whitepaper argues against relying on one.

- Holds today: content confidentiality against a passive server (inferred).
- Degrades today: catch-up and state integrity (fake proofs); fork and freshness detection
  (no transparency layer); per-user access control at the server (authentication is a
  query-string stub, `backend/server/src/http.rs`; writes must still carry the
  authenticated uid's signature); rate limiting and availability; tamper resistance (CTR
  without MAC).
- Fix before untrusted hosting: enable `real-proofs`; real authentication; transparency
  layer; AEAD; bounded deserialization; audit.

### 5.3 Implication for integration

Both systems lack fork and freshness protection until a transparency or anchoring layer
exists. Rooms' witnessed anchoring (P4 above) is the shared gap to close, whichever system
hosts the data.

### 5.4 Not verified

- Cryptographic soundness of either system.
- Whether `room-host` or the VTC ever runs inside the enclave or over vsock (none found).
- Whether MLS commits on the `attributed` tier use PublicMessage or PrivateMessage.
- ES per-column keys and key-refresh/PCS semantics in code.
- ES deletion and retention behaviour end to end.
