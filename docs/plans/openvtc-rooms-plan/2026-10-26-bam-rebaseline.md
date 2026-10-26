# 2026-10-26 — bam: re-baselining the rooms plan at VTI fc157f76

**Status:** Findings, applied to the plan and its subtasks on the day they were written. Part 2 records the review round of PR #661.
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
- `rooms_member_sprint_subtask.md` was not touched in part 1; it was being edited separately. Part 2 revises it.

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

# Part 2 — bam, 2026-10-26: review round of PR #661 (Alberto)

**Status:** Findings, applied to `rooms_member_sprint_subtask.md` and to the parent plan's §2.2
item 1 and §3.3 in the same change. Same author and day as part 1, so it extends this file.

Alberto's review of #661 asked for four changes. The facts below were read from source or PRs
this session unless marked **inferred** or **unproven**.

## What was concluded

1. **The sprint extends an existing rooms module instead of adding a layer.** keyring-bifold has
   draft PRs, all unmerged: #595 (`RoomsService` interface, capabilities and sample;
   `packages/core/src/modules/rooms/types.ts:311-351`), #600 (`AgentRoomsService`, stacked on
   #595; offers, writes, files and agent access report `clientNotBuilt`; not live-proven, "no lab
   VTC serves it yet"), #597, #601, #602 (held for build 272's final pin) and #433. #595's body
   says "not for merge until 272's final pin", so it is not merged. The sprint's "rooms service
   layer (L)" row and S1-S4 were written as a second layer; they now fill the `clientNotBuilt`
   methods. The sprint is built on unmerged work; Alberto owns #595-#602 and the 272 pin is the
   gate. bifold's R0-R3 are screen-stack names and the plan's R0-R3 are phases; the sprint says
   so once. The #645 companion (`2026-10-25-al.md`) is the source of the persona-over-DIDComm
   design.
2. **The phone signs community tasks as the persona with a lent key; it signs no room write.** Per
   #645 the phone borrows the persona's signing and key-agreement keys (`VtaClient.borrowKey`,
   `keys/export-secret`, in-memory `EPHEMERAL_KMS_BACKEND`). #600 signs only
   `vtc/rooms/memberships/list/0.1` this way. At VTI fc157f76, `act/0.3` completes `offers/list`
   and `offers/accept` with no presentation, so phone-signed `offers/list` is feasible (the VTC
   checks the signer is an active member); an `offers/accept` carrying a `keyPackage` completes
   only if the VTA minted it (`keyPackageNotHeld`). `rooms/keys/act` stays required for seal,
   file-key, sealed puts, and every `rooms/records/put` and `rooms/blobs/*` call, because the VTA
   inserts the persona's presentation. That the phone could sign an accept with no `keyPackage`
   is **inferred**.
3. **Delivery of writes is the phone's DIDComm leg, unproven.** Upstream design has the client
   send the act-completed document "to the host unchanged" (`docs/02-vta/data-rooms.md` about
   lines 1364-1380), and the VTC dispatches TSP and DIDComm through one
   `dispatch_trust_task_core` (`messaging.rs` about lines 1012 and 1694). Nothing was run.
   `size.rs` about lines 357-360 puts a chunk on a transport that charged no room budget under
   `LargeDocumentBudget` (5 per minute per address); whether DIDComm chunks hit it is unknown.
   That a 256 KiB chunk fits the mediator's 1 MiB default `message_size` is inferred. These
   became spikes S0.7-S0.9, with the cut line that files slip if S0.8 fails.
4. **Messages use `keyring.chat/1`.** Chat already has events, an inline-image cap and checks;
   a wallet-owned shape would be a third vocabulary. Rooms need a hosted-attachment variant, and
   optimistic-send and retry states that chat lacks. Only the schema, pure checks and four leaf
   components are shared; the Credo-coupled screen and stores are not.
5. **The Farm community is a claim.** VTA 0.64.0-4a0f1ff1 and VTC 0.12.0-4a0f1ff1 were claimed;
   4a0f1ff1 is in `vta-service-v0.64.0` and the offers (795fd2ae) and memberships-list
   (594c8ff9) commits are its ancestors. Nothing in the repo confirms the community or its
   `[rooms.community]` and `[rooms.files]` settings. S0.3 now confirms it, with the local lab as
   fallback.
6. **Decisions from Alberto's review**: 16 KiB and 25 MiB caps are fine to start; `expo-sharing`
   for the share path (Q-S5 resolved); badge on the Rooms card only (Q-S6 resolved).

## Positions this superseded

Each is marked applied in the files named.

- Sprint: "rooms service layer in `@bifold/core`" as new work, and S1-S4 as new service code.
  Applied in the sprint's components table and stories.
- Sprint and parent: "the VTA signs as the persona" for every call, and "the wallet holds no
  room credentials and no group keys" as the whole rule. The phone holds a lent persona signing
  key; the credential and group-key rule stands. Applied in the sprint's architecture section and
  the parent's §2.2 item 1 and §3.3.
- Sprint "Notifications": each offers poll costs a VTA round trip through `act/0.6`. Replaced by
  phone-signed community reads; the 60 s interval is kept as a starting value pending S0.6.
- Sprint decision "the message record shape is wallet-owned for now" with
  `{kind:"message", body, replyTo?, file?}`. Replaced by `keyring.chat/1`. The 16 KiB text cap
  became 16384 UTF-16 code units, equal to chat's; the group-messaging subtask's 32 KiB was not
  adopted.
- Sprint S0.3 "room host in the lab" as the primary host. It is now the fallback.
- Sprint Q-S5, Q-S6 and Q-S3 as open or proposed. Resolved by Alberto's review.
- Sprint S4 "key = random id" for open rooms. Now `e/<eventId>`.

## Left unreconciled

- A sealed record key is 22 characters and a ULID `eventId` is 26; the instruction that
  `eventId` equals the record key cannot hold for sealed rooms as stated. Recorded as Q-S8.
- The brief described the plan's R1-R3 as reads, writes and files; the parent plan's R0-R3 are
  measurement, read-only, invitations, and write and curate. The sprint uses the parent's names.
- `2026-10-25-al.md` is on wallet PR #645, not on this branch, so the parent plan names it by
  path with no link.
