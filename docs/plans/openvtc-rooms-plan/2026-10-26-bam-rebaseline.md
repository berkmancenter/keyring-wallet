# 2026-10-26 — bam: re-baselining the rooms plan at VTI fc157f76

**Status:** Findings, applied to the plan and its subtasks on the day they were written.
**Author:** bam. **Date:** 2026-10-26.
**Plan:** [`../openvtc-rooms-plan.md`](../openvtc-rooms-plan.md), with subtasks
[`rooms_member_sprint_subtask.md`](./rooms_member_sprint_subtask.md),
[`rooms_s3_storage_subtask.md`](./rooms_s3_storage_subtask.md),
[`rooms_encrypted_spaces_subtask.md`](./rooms_encrypted_spaces_subtask.md) and
[`rooms_group_messaging_subtask.md`](./rooms_group_messaging_subtask.md); also
[`../rich-messaging-plan.md`](../rich-messaging-plan.md).

## What was concluded

1. **The plan was re-baselined from 49f5f1be to `main` at fc157f76** (vta-service 0.65.0,
   vta-sdk 0.73.0), read from `/srv/dev/code/seas/verifiable-trust-infrastructure`.
   `scripts/openvtc/PINS.json` is Keyring's pin and still named 49f5f1be; the plan states that it
   is measured ahead of the pin until the pin is bumped. The git author date of fc157f76 is
   2026-10-25; 2026-10-26 is the date it was measured. The `external/` clone is checked out at
   an older commit and does not hold fc157f76, so every claim below was read from the sibling
   checkout.
2. **B5 is resolved.** The owner's MLS half is served by the owner's VTA:
   `rooms/owner/group/{create,add,remove,renew}` (`vta-service/src/trust_tasks/mod.rs:2950-2964`,
   `room_owner_group.rs`, `operations/room_groups.rs`), driven by `pnm rooms owner group-*`.
3. **B7 is resolved for `pnm`.** `pnm rooms put` seals on sealed rooms with `rooms/keys/seal/0.2`
   and `signAsPrincipal` (`vta-cli-common/src/commands/rooms.rs`). `rooms/keys/write` is still a
   proposal (`data-rooms-read-through.md`; no Rust source names it).
4. **The `rooms/blobs/*` family exists.** `rooms/blobs/get` 0.1/0.2, `blobs/chunk` 0.1,
   `blobs/upload/{begin,chunk,commit,abort}` 0.2, `rooms/records/put/0.2` with `blobs:[blobRef]`,
   and `rooms/keys/file-key/0.2` (`vti-rooms/src/{blob_tasks,files,blobs}.rs`;
   `docs/05-design-notes/data-rooms-files.md` §5, §12 P5/P6). Chunks are Trust Task documents of
   16–256 KiB, at most 4096 per blob. There is no `link`, `unlink` or `grant` task; the file key
   is derived per `fileId` and epoch and bound to the room, which rules cross-room linking out.
   `vtc/rooms/usage/0.1` and `vtc/rooms/limits/set/0.1` replace a `blobs/usage` task.
5. **File ciphertext has pluggable object storage upstream**: `BlobStore`
   (`vti-common/src/blob_store/mod.rs:322`), feature `blob-s3` (`vti-common/Cargo.toml:69`), GCS,
   `BlobStores` (`vti-rooms/src/blobs.rs:867`), and `vtc/rooms/storage/{assign,migrate}`. Record
   bodies are still inline in fjall, and no upstream code stores them elsewhere, so the S3
   subtask's scope narrowed to record bodies.
6. **A community-offered join exists**: `vtc/rooms/offers/list` 0.1–0.3 and `accept/0.1`
   (`vtc-service/src/rooms/handlers.rs`; `docs/03-vtc/community-rooms.md`; `pnm rooms offers`). A
   self-service `rooms/join` does not: `data-rooms-joining.md:3` is a proposal.
7. **Q1 was answered yes** by the owner, Brendan, on 2026-10-26, for at least the member sprint's
   functionality. **The member sprint is the first chunk of work**: it narrows R0–R3 for `open`
   and `attributed` rooms, and R4, R5 and everything else stay later. B1 is resolved on that basis.
8. **`vta-mobile-core` (UniFFI) exists upstream and holds no data-room code.** The only `room`
   match in it is a test importing `vta_service::operations::room_issuance`
   (`tests/witness_e2e.rs:27`).
9. **Guide drift changed.** The `--listen`, `present/0.2`, `issue-authority/0.2` and cryptographic
   deletion drift items were fixed in the guide (`data-rooms.md` lines 901–912, 848, 411,
   ~93 and ~1783), so the plan stopped listing them. Still stale: the guide's §12 tables omit
   `rooms/keys/read`, `rooms/owner/anchor` and `rooms/epoch/commits`, and also the blobs, owner
   group, `owner/revoke`, `keys/profile` and `vtc/rooms/*` families; the §11 private-tier string
   differs from what hosts send (`zero-knowledge profile`, `room-host/src/lib.rs:228,2888`).
10. **Anchoring is partly built.** `rooms/owner/anchor/0.1` has a handler
    (`vta-service/src/trust_tasks/room_owner.rs:263`, behind `webvh`), while the guide's §10.1 says
    renewal anchoring is not implemented. The anchoring note's status reads "decided, and now
    buildable". Nothing read shows a host or client checking an anchor, so the Encrypted Spaces
    subtask still treats anchor verification as unbuilt.
11. **`tree_head` still rescans the room on every call**: `vti-rooms/src/storage.rs:681,778`.
    **No `RecordStore` exists**: `vti-common/src/store/mod.rs:364,423` are still closed enums.

## What was left alone, and why

- B4 (room-credential acceptance, `issuerScope`) stayed unverified on the Keyring side; room-side
  issuance is `issuerScope: public` (`vta-service/src/trust_tasks/room_owner.rs:113,222`).
  B6 (admission policy) still waits on upstream.
- The integration plan's §5.2 was not edited. It is a three-package diagram, not a module list, so
  there was no rooms row to add; the plan's §10 item 1 now says where the pointer belongs.
- `rooms_member_sprint_subtask.md` was not touched; it was being edited separately.

## Positions this superseded

Each is marked applied in the files named.

- Plan B1/Q1 "not decided; everything waits on it" and the summary "only R0 is unblocked" —
  replaced by the member sprint as the first chunk (plan §5a, §7, §9).
- Plan §2.3, §4, §5, §5a, R2: "the owner's MLS half is library-only; admitting to a sealed room is
  Rust; test with an owner-side script". Replaced by the served owner group tasks and community
  offers.
- Plan §2.3 and B7: "`pnm rooms put` refuses sealed rooms" and "`pnm` has no owner verbs".
- Plan §2.1: a task table that gave every version as `0.1` except two, and called `rooms/keys/read`,
  `browse` and `owner/anchor` "the two newer additions".
- Plan §2.3 "Cryptographic deletion has a verb", `--listen`, `present/0.2` and `issue-authority/0.2`
  as guide-staleness bullets; these were fixed upstream.
- Group messaging §1, §8.2, §8.3, §8.7, §9.3, §9.4, M3, M4, Q1, Q5, Q7: `rooms/blobs/*` "needs an
  upstream spec", with `begin`/`complete`/`grant`/`link`/`unlink`/`usage` and a byte route, a random
  `K_file` in the manifest, and cross-room linking. Replaced by the shape in item 4. §8.2, §8.3,
  §8.7, §9.3 and §9.4 were rewritten; the sections that still use "unlink" for library removal
  were noted in the subtask's baseline. The messaging profile's `org.openvtc.msg/1` remains a
  Keyring design only (§5.3 there), which `rich-messaging-plan.md` D3 relies on.
- Group messaging "prune verb not specced": `rooms/epoch/prune` and
  `rooms/records/{prune,retention/set}` exist.
- S3 subtask Option C "needs an upstream spec change" and the claim that no S3 support exists:
  true for record bodies only.
- Encrypted Spaces "the only real trait seam is authorization": `BlobStore` is a second one, for
  file blobs.
- `rich-messaging-plan.md`: "the room blob layer needs an upstream spec". Large media can now use
  rooms; one-to-one chat's no-hosting goal (G5) is unchanged.
