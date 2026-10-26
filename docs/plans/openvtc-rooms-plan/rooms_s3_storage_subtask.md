# Storing Room Records in S3 — Subtask

**Status:** Draft — a subtask of [`openvtc-rooms-plan.md`](../openvtc-rooms-plan.md), sketched from reading the code. Nothing here has been built or tested, and it is not a commitment to implement.
**Scope:** The **host side** of rooms: where `room-host` (and `vti-rooms`) could keep **record bodies**. File ciphertext is out of scope: it already has pluggable object storage upstream (below). This is outside the parent plan's own scope, which treats the host operator as a non-role (plan §4, "Host operator: No") and `room-host` as a lab binary (plan §8). It is kept as a separate subtask so that boundary stays visible. Keyring is a member client and is not changed by anything below (§7).
**Parent:** [`openvtc-rooms-plan.md`](../openvtc-rooms-plan.md). Section references (§) to that plan are marked "plan §"; bare § references are to this document.
**Reasoning:** [`2026-10-13-bam.md`](./2026-10-13-bam.md) (re-baselining against the pin at the time), [`2026-10-26-bam-rebaseline.md`](./2026-10-26-bam-rebaseline.md) (re-baselining onto fc157f76). A decision in §9 belongs in a further dated companion.
**Baseline:** every claim is measured against `verifiable-trust-infrastructure` `main` at **fc157f76** (2026-10-26; read from `/srv/dev/code/seas/verifiable-trust-infrastructure`) unless marked otherwise, and carries a file path where it can. Keyring's pin in `scripts/openvtc/PINS.json` still names an earlier commit (49f5f1be) until bumped.

**References:** the `[[…]]` tags are those defined in the plan's header.

- **[[ROOMS-HOST]]** — `room-host/` (`src/main.rs`, `src/lib.rs`, `README.md`). Opens the store.
- **[[ROOMS-GUIDE]]** — `docs/02-vta/data-rooms.md`. Operator guide: hosting and mirrors (§8), records and retraction (§9), lifecycle (§10).
- **[[ROOMS-DESIGN]]** — `docs/05-design-notes/data-rooms.md`. Cites `draft-sullivan-mls-attachments` for key derivation.
- **[[ROOMS-SEC-V2]]** — `docs/05-design-notes/data-rooms-security-review-v2.md`. Accepts metadata leakage; names padding buckets as the mitigation.
- **[[ROOMS-STORAGE]]** — `vti-rooms/src/storage.rs`. Key layout and the four store calls rooms use.

---

## 1. Summary

**File ciphertext already has pluggable object storage upstream; record bodies do not.** A `BlobStore` trait (`vti-common/src/blob_store/mod.rs:322`) has local-directory, S3-compatible (feature `blob-s3`, `vti-common/Cargo.toml:69`) and Google Cloud Storage (`blob-gcs`) backends; a host reaches them through `BlobStores` (`vti-rooms/src/blobs.rs:867`); and a VTC manages named storage configs (`vtc-service/src/rooms/storage_configs.rs`; `vtc/rooms/storage/{assign,migrate}`). Room files therefore need nothing from this subtask. Its scope is **record bodies only**: they are stored inline in fjall (`Record`, `vti-rooms/src/lib.rs:447`; `storage.rs` calls no `BlobStore`), and no upstream code stores them elsewhere.

It could be added in a contained way. **Recommendation: keep metadata in fjall and put only record bodies in S3** (Option B, §4). Option A (S3 as a whole backend) is the most general and the worst fit. Option C (presigned client uploads) is no longer the route past the wire caps for large content, because a file record with `rooms/blobs/*` carries it; for record bodies it would still need an upstream spec change.

## 2. How storage works today

### 2.1 Backend

Hosts open a local fjall store through `vti_common::store`. `room-host` does it in `open_state_with_resolver` (`room-host/src/lib.rs:1809`, reached from `open_state_with_files`, `src/main.rs:265`) with `Store::open(&StoreConfig { data_dir })` (`room-host/src/lib.rs:1833`), then opens the rooms, records and epoch-links keyspaces and, for files, `room_blobs` ([[ROOMS-HOST]]). The only setting is `--data-dir` (default `./room-host-data`). Fjall memory tuning (`Store::open_with(&config.store, &config.fjall)`) exists but is used by the VTA and VTC, not `room-host`.

### 2.2 Layout

Three keyspaces with plain string keys ([[ROOMS-STORAGE]]):

```
rooms:<roomId>                     -> Room (owner, visibility, epoch, expiry, retention, next_version)
room_records:<roomId>:<key>        -> Record
room_epoch_links:<roomId>:<epoch>  -> EpochLink (epoch zero-padded to 10 digits)
room-commit:<roomId>:<epoch>       -> relayed MLS commit (same epoch-links keyspace, zero-padded)
```

- **Room-exact scans.** The trailing `:` stops one room's scan from matching another room whose ID begins the same way.
- **Version assignment.** Versions come from the room row's counter, so they are monotonic per room. A write reads the room, takes the next number, writes the record, then writes the room back. That is not atomic across keyspaces. The code states this can only skip a version, never duplicate one, and that skipping is the safe direction.
- **Record body.** `Record` (`vti-rooms/src/lib.rs:447`) carries the body inline: `sealed` (base64url) with `nonce` on the sealed tiers, or `cleartext` (a JSON value) on an `Open` room. Both live in the same fjall row as the metadata, alongside `author` and `updated_at`.
- **Size limits.** A VTC caps a Trust Task document at 64 KiB by default (`vtc-service/src/trust_tasks/size.rs`, `DEFAULT_MAX_DOCUMENT_BYTES`); `room-host` sets no body limit, so axum's 2 MB default applies (plan §5). Listings are capped at 500 records per page (`MAX_PAGE`).

### 2.3 The seam for a new backend

- **Closed enums.** `Store` (`vti-common/src/store/mod.rs:364`) has two variants: `Local` (fjall) and `Vsock` (the Nitro Enclave backend, behind a `vsock-store` feature). `KeyspaceHandle` (`:423`) is a matching enum. `vti-common/src/store/test_fixture.rs` (test-only, behind `cfg(test)` or `test-support`) copies template fjall databases to speed up tests; it opens a `LocalStore` and adds no backend trait. The one object-storage trait, `BlobStore`, is for file blobs and is not a `Store` backend.
- **Concrete handle.** Room code is written against the concrete `KeyspaceHandle`, not a trait.
- **Small call surface.** `storage.rs` calls only `get_raw`, `insert`, `prefix_iter_raw` and `remove`. The wider `Store` API also has `insert_if_absent`, `swap` and `move_if_unchanged`.
- **Encryption at rest.** `KeyspaceHandle::with_encryption` provides AES-256-GCM bound to the value's location (`vti-common/src/store/encryption.rs`). Neither `room-host` nor `vti-rooms` calls it, so rooms do not use it.

## 3. Where the "S3" idea may have come from

Four nearby things are easy to mistake for room record-body S3 support. None is.

- **`vti-secrets` `aws-secrets` feature.** AWS Secrets Manager for secrets; `room-host` re-exports it (`room-host/Cargo.toml`) for its own host identity. Not S3, and not record storage.
- **`contentStoredAt` and `didControlledBy`.** The design's policy input contract names these "hosting axes" (`vtc-service/src/rooms/policy.rs`). [[ROOMS-GUIDE]] (§8.2) says the published `rooms/create/0.1` schema has no member for either, so no host can know them. They read as a design placeholder.
- **The file `BlobStore`.** Real S3 support for room *files* (`blob-s3`, `vtc/rooms/storage/*`, direct presigned transfer; `docs/02-vta/data-rooms.md`, files and direct transfer). It holds file ciphertext named by a `BlobRef`; a record body is not a blob and is not routed there.
- **`draft-sullivan-mls-attachments`.** Cited by [[ROOMS-DESIGN]] for key derivation. The draft concerns attachments stored outside the group, but rooms borrow only the key pattern.

## 4. Options

### Option A — S3 as a third `Store` variant (whole backend)

Each fjall key becomes an S3 object key, such as `room_records/<roomId>:<key>`.

- **Maps cleanly.** `get_raw` → GetObject, `insert` → PutObject, `remove` → DeleteObject, `prefix_iter_raw` → ListObjectsV2 with a prefix. S3 lists in lexicographic order, so the zero-padded epoch keys and room-exact prefixes keep working. S3 has been strongly read-after-write consistent since 2020.
- **Atomic writes.** `insert_if_absent`, `swap` and `move_if_unchanged` need conditional writes (`If-None-Match`, `If-Match`). AWS S3 supports these. S3-compatible stores such as MinIO or R2 vary, so check the target.
- **Version assignment.** The existing read-modify-write window widens with network latency.
- **Cost and latency.** Every list becomes paged ListObjectsV2 calls of up to 1000 keys, and the room row is rewritten on every write. The Merkle tree head also scans every record in the room (`storage::tree_head` and `tree_head_with_trace` call `list_records`), so each served commitment becomes a full listing.
- **Key encoding.** Client-chosen record keys need encoding and a length cap, since S3 keys max at 1024 bytes.

The most general option and the worst fit: it moves small, hot metadata onto a slow store.

### Option B — Hybrid: metadata in fjall, bodies in S3 (recommended)

Keep `rooms:`, the record rows (key, version, epoch, status, pinned) and `room_epoch_links:` in fjall. The record row holds a **body reference** instead of the inline body.

**Object naming.** One immutable object per write, such as `rooms/<roomId>/<version>`. Versions are monotonic and never reused, so each object is written once and no conditional writes are needed.

**Write path.**

1. Assign or confirm the version.
2. PutObject the body.
3. Commit the fjall row pointing at it.

If step 3 fails there is an orphan object and no dangling row. That is the failure direction the store already chooses (§2.2), and a sweeper can delete orphans.

**Read path.** Read the row from fjall, then GetObject the body. Listings never touch S3, because [[ROOMS-GUIDE]] says listings return metadata and never bodies.

**Reuse.** The S3 backend a body store needs is the one files already use (`blob-s3` over `object_store`, `vti-common/src/blob_store/`), so Option B need not add S3 client code. Whether the `BlobStore` API (a staged blob named by a `BlobRef`) fits one immutable object per record version is **(unverified at fc157f76)**; if it does not, the body store shares the crate and the feature flag, not the trait.

**Where the code changes.** `put_record`, `get_record`, `curate_record` and `purge_record` in [[ROOMS-STORAGE]], the `Record` struct, the mirror path (`store_mirrored_record`, called from `room-host/src/mirror.rs`), and anything that copies bodies. The Merkle tree head hashes every record (Option A, cost note); whether it needs body bytes or only stored fields is **(unverified at fc157f76)** and decides whether a tree head must fetch from S3.

### Option C — Presigned URLs, client uploads straight to S3

For **record bodies**, Option C would keep bytes off the host and lift the 64 KiB and 2 MB caps, and it **still needs a spec change**: the body travels inside the signed Trust Task document, and the published `rooms/records/put` schema has no member for an external reference. Upstream owns that spec. For anything too large for a body the upstream answer is a different shape: a file record, whose ciphertext moves as `rooms/blobs/*` chunk documents or, on an S3 config through the community's VTA, by presigned direct transfer (`rooms/blobs/*` 0.2; `docs/05-design-notes/data-rooms-files.md` §5.2). That path is built; Option C for bodies is not needed to carry large content.

### Not recommended: fjall directory on an S3 mount

An inference, not tested. Fjall is an LSM-tree engine that depends on fsync and random I/O, and FUSE-mounted object storage generally handles that poorly.

## 5. Details for Option B

### 5.1 Config and posture

- **Flags.** Something like `--s3-bucket`, `--s3-prefix` and `--s3-endpoint` (for MinIO or R2).
- **Credentials.** The standard AWS credential chain.
- **Opt-in.** `room-host` makes every capability an operator decision: `--listen`, `--resolve-dids`, `--allow-origin`, `--mirror-config`, `--mediator-did` and `--secrets` are all opt-in (`room-host/src/main.rs`; plan §8, §2.3). S3 should follow that.
- **Build gating.** A Cargo feature, as with `didcomm` and `onboarding`.

### 5.2 Security

- **Sealed rooms.** The AEAD binds `roomId | key | version | epoch` (plan §7, R3 criterion (b)), so a bucket operator who alters or relocates a body makes it fail to open. S3 need not be trusted more than the host already is.
- **Open rooms.** Bodies are cleartext. The guide says records are signed ([[ROOMS-GUIDE]] §8.3), but the stored `Record` has an `author` field and no signature field; the request document's proof is verified on arrival (`HostState::presenter`, `room-host/src/lib.rs`) and is not kept. Whether any per-record writer signature survives into storage is **(unverified at fc157f76)**. Treat bucket policy, encryption (SSE-S3 or SSE-KMS) and access logging as the real boundary.
- **Metadata still leaks.** Object sizes, counts and access timing are visible to the bucket owner. [[ROOMS-SEC-V2]] accepts this and names padding buckets as the mitigation if a real adversary appears.

### 5.3 Deletion

There is a trap. The guide (§9) says `retracted` is a tombstone where "the body goes, the key/version/epoch stay", and a curation assigns a new version. With immutable per-version objects, retracting a record **leaves the old object in S3** unless the code deletes it. If bucket Versioning is on, even DeleteObject keeps old versions. The design needs an explicit rule, and probably S3 lifecycle rules. The same applies to `purge_record`, the separate erasure path that removes a record tombstone included.

Cryptographic deletion has a verb, `rooms/epoch/prune` (plan §2.3), but it erases epoch keys, not stored objects: an S3 body object stays until something deletes it, so the rule above is still needed.

Separately, no code was found that deletes a room's data when it becomes reclaimable: `Lifecycle::Reclaimable` is computed (`vti-rooms/src/lifecycle.rs`; guide §10.1; plan §7, R5) and nothing in `room-host` acts on it. S3 lifecycle expiry could do that job, but it would be a new policy.

### 5.4 Mirrors and backups

- **Mirrors.** A mirror (`--mirror-config`, `room-host/src/mirror.rs`) pulls from its write-primary and stores its own copy through `store_mirrored_record`. It needs its own bucket or prefix, or it shares the primary's objects.
- **Backups.** `room-host` has no export task today. Bucket-level replication or versioning would be a new option for body backup, and the fjall metadata would still need backing up separately.

## 6. What it does not fix

- The wire caps on a record body, unless Option C is taken; large content goes through a file record instead.
- The host still has to be trusted with the bucket credentials.
- A new availability dependency on S3 for reads and writes.
- Per-request cost, which matters for chatty rooms.

## 7. Where it should live

This is a `room-host` and `vti-rooms` change, **not a Keyring one**. The wallet reaches records only through host calls via its VTA (plan §2.1, §3.2), so nothing in plan R1–R5 changes. Contributing upstream is cleaner than forking: a fork carries a storage patch that drifts whenever the `Record` shape changes.

The parent plan does not take on this work; it stays in this subtask.

## 8. A rough plan

Phases are prefixed **S** to keep them apart from the plan's R-phases. As in plan §7, "verified" means against the local lab (plan §8), not only a unit test. All S-phases are local-lab only; rooms have no Farm story.

| Phase | Step | Done when |
|---|---|---|
| S0 | Add a body-reference field to `Record`, with fjall behavior unchanged by default | existing `vti-rooms` and `room-host` tests pass untouched |
| S1 | Add an `S3BodyStore` behind a feature flag | the same put, get and list tests pass against MinIO |
| S2 | Order writes object-first | killing the host between upload and row commit leaves an orphan and no broken record |
| S3 | Add a sweeper for orphans | orphans are deleted and no live object is |
| S4 | Define deletion on retract and reclaim | retracting a record removes its object, including with bucket versioning on |
| S5 | Add flags and a lab compose file | `room-host --s3-bucket …` runs in the local stack |

## 9. Open questions

| # | Question | Kind | Blocks |
|---|---|---|---|
| Q1 | Is a body-reference field acceptable upstream, or does it need to be a fork? | Not decided — needs upstream | S0 |
| Q2 | What is the deletion rule when bucket Versioning is on (§5.3)? | Not decided | S4 |
| Q3 | Do mirrors share the primary's objects or get their own prefix (§5.4)? | Not decided | S2, S5 |
| Q4 | Is the 64 KiB / 2 MB cap a real problem for a record **body**? Content that large is a file (`rooms/blobs/*`), so only a use that needs an oversized body, not an attachment, would need Option C and an upstream spec change | Not decided | choice of B over C |
| Q5 | Is any per-record writer signature stored, and does the Merkle tree head need body bytes (§4 Option B, §5.2)? | Measurable | Option B's code surface |

## 10. What was and was not verified

- **Verified at 49f5f1be, and carried to fc157f76 only where the line references above were re-read:** the `Store` and `KeyspaceHandle` enums (no backend trait), the key layout, the operations `storage.rs` calls, the inline `sealed`/`nonce`/`cleartext` fields, the size caps, and that the tree head scans all records (`vti-rooms/src/storage.rs:681,778`). At fc157f76, object-store code exists for **file blobs only** (`vti-common/src/blob_store/`, `vti-rooms/src/blobs.rs`, `vtc-service/src/rooms/storage_configs.rs`); `storage.rs` has no `BlobStore` use, so none of it stores record bodies.
- **Inferred, not tested:** the object naming scheme, the write-order argument, every statement about S3 behavior, the FUSE comment, and the Merkle cost under S3.
- **Not checked:** whether a per-record writer signature is stored, and whether the tree head needs body bytes (Q5).
