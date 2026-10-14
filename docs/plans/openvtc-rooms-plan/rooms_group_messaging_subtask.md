# Group Messaging and Linked File Sharing on Data Rooms — Architecture Plan

**Status:** Draft architecture plan. Nothing here is built, and it is not a commitment to implement.
**Scope:** A group messaging service — conversations, threads, edits, reactions, real-time delivery, offline sync — plus **file sharing where files are linked to conversations**: attachments on messages, a per-conversation file library, file-to-thread references, one file reused across conversations, and file versions. Built as an **application profile on top of VTI data rooms**, not beside them.
**Parent:** [`openvtc-rooms-plan.md`](../openvtc-rooms-plan.md) (Keyring as a member client of rooms). Section references to it are marked "plan §". Companions it relies on: [`rooms_s3_storage_subtask.md`](rooms_s3_storage_subtask.md) ("S3 note §") and [`rooms_encrypted_spaces_subtask.md`](rooms_encrypted_spaces_subtask.md) ("ES note §").
**Reasoning:** decisions proposed here are marked **(proposed)**. When one is made, record it in a further dated companion, not by editing this file.
**Baseline:** rooms behaviour is read from the VTI checkout at `seas/vtafarm/vta-build-pipeline` (HEAD `b9c5703a`, 2026-10-01), abbreviated `VTI/`, because the plan's pin `afcf2470` is not on disk (ES note, "Sources"). Claims about that code carry a path. Everything about the messaging and file layers is design, not measurement.

**References** (the `[[…]]` tags follow the plan's header; new ones are added here):

- **[[ROOMS-GUIDE]]** — `VTI/docs/02-vta/data-rooms.md`. Operator guide; §2 is the built/designed line.
- **[[ROOMS-DESIGN]]** — `VTI/docs/05-design-notes/data-rooms.md`. Invariants I1–I5 (§2), visibility ladder (§3.1), credentials (§4), MLS (§5), epoch chain (§5.5), records (§6), hosting and mirrors (§7), audit (§8), lifecycle (§9), open items (§14).
- **[[ROOMS-JOINING]]**, **[[ROOMS-READTHROUGH]]**, **[[ROOMS-VERIFIED]]**, **[[ROOMS-ANCHOR]]** — the sibling design notes in the same directory.
- **[[ROOMS-SEALED]]** — `VTI/vti-rooms/src/sealed.rs`. AEAD binds `roomId | key | version | epoch`; "version is bound before it is known".
- **[[ROOMS-STORAGE]]** — `VTI/vti-rooms/src/storage.rs`. Keyspaces, version assignment, the four store calls.
- **[[ROOM-HOST-DIDCOMM]]** — `VTI/room-host/src/didcomm.rs`. A host reachable at a mediator (`--mediator-did`), authorization unchanged by carrier.
- **[[MLS-ATTACH]]** — [draft-sullivan-mls-attachments](https://www.ietf.org/archive/id/draft-sullivan-mls-attachments-01.html), already cited by [[ROOMS-DESIGN]] §5.1 for exporter-derived content keys.
- **[[MIMI]]** — [MIMI protocol](https://datatracker.ietf.org/doc/draft-ietf-mimi-protocol/) and room policy drafts, already "taken" in [[ROOMS-DESIGN]] §11.
- **[[RFC9420]]** — MLS.

---

## 1. Summary

A **conversation is a room**. A **message is a record**. A **file is a set of encrypted chunks in a blob store, described by a sealed manifest record** in the room that owns it. Everything that decides *who may do what* — DIDs, VIC/VMC/VAC chains, MLS, the epoch chain, the VTA oracle, presenter binding, the host trusted for availability only — is reused unchanged.

The service adds three things rooms do not have:

1. **A messaging profile** — the record-body schema and key scheme for messages, threads, edits, reactions and read markers. This is a client convention inside sealed bodies, so it needs no host change.
2. **A change feed** — a hint channel that tells members' VTAs a room has advanced, so delivery is not polling. Content never rides it.
3. **A blob layer** — chunked, resumable, ciphertext-addressed storage outside the Trust Task body, authorized by the same room presentations. This **does** need an upstream spec (S3 note Option C), because the 64 KiB VTC body cap (plan §5) rules out inline files.

Two upstream frictions are load-bearing and are called out early because they decide feasibility, not polish:

- **Sealed writes race on the room-wide version counter** ([[ROOMS-SEALED]]): a writer must seal under the version it *expects*, and every concurrent sender in a busy conversation contends for the same next number (§6.3).
- **Rooms were designed for small, slow libraries** ("affordable because rooms are small", [[ROOMS-DESIGN]] §6). A chat room is a high-write, append-heavy log. Listing caps, per-record VTA round-trips and owner-only commits all need checking at chat rates (§12).

---

## 2. Goals and non-goals

### Goals

- **G1. Group conversations on every shipping tier** (`open`, `attributed`), and designed so `private` drops in when its ZK profile ships ([[ROOMS-GUIDE]] §2).
- **G2. Host-neutral and portable.** A conversation moves hosts by re-pointing its room DID (I3) and its files move with it.
- **G3. Host learns no content on sealed tiers**, including file names, types, thumbnails, thread structure and who reacted to what.
- **G4. Files linked to conversations**: attachments, a per-conversation library, file references from threads, reuse of one file across conversations, and versions.
- **G5. Real-time when online, convergent when offline.** Sub-second delivery hints; `sinceVersion` sync that always converges.
- **G6. Human and agent members** share one record model ([[ROOMS-DESIGN]] §6.1): agents read and post through attenuated VACs, and their messages are marked as agent-authored.
- **G7. No key material in the app.** The wallet or web client holds no room credential and no group key (plan §2.2 item 1); see §9.4 for the one bounded exception proposed for file keys.

### Non-goals

- **Multi-primary hosting or CRDT merge** of conversation state. Rooms rejected both ([[ROOMS-DESIGN]] §6, §7.3); a conversation has one write-primary.
- **Voice, video, screen share.** Out of scope; SFrame ([RFC 9605](https://www.rfc-editor.org/info/rfc9605)) over the same MLS exporter is the natural later path.
- **Public broadcast channels with unbounded readership.** A room is an explicit set of DIDs ([[ROOMS-DESIGN]] §3). A broadcast product is a different design.
- **Federation with Matrix, Signal or other networks.** MIMI alignment is a direction, not a deliverable.
- **Deniable messaging.** Rooms want attribution, via in-body signatures (ES note §2, "Deniability").
- **Server-side content moderation or scanning on sealed tiers.** The host cannot read; §8.6 says what replaces it.
- **Owner/admin tooling for MLS adds.** Upstream has no task for it (plan §2.3, B5); this plan consumes whatever ships.

---

## 3. Layering: what is reused, what is added

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │ Clients: Keyring wallet · web console · mobile agent · AI agents       │  no keys
 ├────────────────────────────────────────────────────────────────────────┤
 │ NEW  Messaging client library (profile codec, local store, search idx) │
 ├───────────────────────────────┬────────────────────────────────────────┤
 │ Member's VTA (oracle)         │ NEW  vta: change-feed subscriber,      │
 │ rooms/keys/{seal,open,read,   │      per-room watermark + root memory, │
 │ browse,present,chain,commit}  │      encrypted search index, file-key  │
 │ (exists)                      │      unwrap (§9.4)                     │
 ├───────────────────────────────┴────────────────────────────────────────┤
 │ Transport: TSP > DIDComm > HTTPS, one Trust Task spine (exists)        │
 ├───────────────────────────────┬────────────────────────────────────────┤
 │ Room host (room-host or VTC)  │ NEW  host: change feed fan-out,        │
 │ rooms/{create,records,epoch,  │      rooms/blobs/* (upload sessions,   │
 │ owner}/* (exists)             │      chunk store, download grants)     │
 ├───────────────────────────────┼────────────────────────────────────────┤
 │ fjall metadata (exists)       │ NEW  blob store: S3/MinIO/R2 or local  │
 └───────────────────────────────┴────────────────────────────────────────┘
 Identity & authority: room DID (did:webvh, witnessed) → VIC/VMC/VAC; MLS group (exists)
```

| Messaging concept | Rooms concept it maps to | Change needed |
|---|---|---|
| Conversation (group chat, DM, channel) | **Room** — one DID per conversation | none |
| Conversation creator / admin | Room **owner** (I1), `admin` VAC | none |
| Participant | Room **member**: VMC + VAC, MLS leaf at their VTA | none |
| Join / invite | VIC → `rooms/keys/{key-package,welcome}` (push-shaped, [[ROOMS-JOINING]]) | consumes upstream; owner MLS add is Rust today |
| Post / edit / react permission | VAC `write` | none (see §7.2 for finer verbs) |
| Moderate (delete others', pin) | VAC `curate` | none |
| Message, reaction, edit, read marker | **Record** with opaque key, sealed body | profile only (§5) |
| Message order | Room-wide `version`, host-assigned | none; but §6.3 contention |
| Sync | `sinceVersion` watermark, cursor pages | none |
| Delete message | `curate` → `retracted` tombstone | none |
| History for new joiners | **Epoch chain** (`Chained` retention) | none |
| "Disappearing" history | `FromJoin` retention + `prune_epoch_links_before` | prune verb not specced ([[ROOMS-DESIGN]] §12.2) |
| Integrity of history | Signed put acks, Merkle root, traces ([[ROOMS-DESIGN]] §14.7) | none |
| Push notification | — | **new: change feed** (§6.5) |
| File bytes | — | **new: `rooms/blobs/*`** (§8) |
| File metadata, key | Record (manifest), sealed | profile only |
| Agent participant | Attenuated, audience-bound VAC via `rooms/keys/present` | none |

**Decision (proposed): one room per conversation.** Threads, the file library and pinned items live *inside* the conversation's room. The alternatives were rejected:

- *One room per thread* multiplies MLS groups, owner commits and credential issuance by thread count, and makes "reply in thread" an admission event.
- *One room per community with conversations as key prefixes* would put every conversation under one membership and one key — the host could not tell them apart (good), but neither could the members' permissions.

A DM is a two-member room. A "space" or "workspace" grouping conversations is a client-side or community (VTC) concept, not a room.

---

## 4. Identity, membership and permissions

Nothing new is invented here; this section states how the messaging product reads the existing model.

### 4.1 Identity

- **People are DIDs**; their **VTA is their MLS leaf** ([[ROOMS-DESIGN]] §5.1). Devices hang off the VTA through the oracle, so multi-device is not an MLS problem.
- **Display names and avatars** are not a host concept. Each member publishes a **profile record** in the room (key derived from their DID under an HMAC the host cannot invert, §5.2), signed by them. Clients may also show a contact's name from the user's own address book. The host never learns a display name on sealed tiers.
- **Agents** are not members. An agent posts under its human's membership through an attenuated VAC, and the in-body signature says it was the agent ([[ROOMS-DESIGN]] §4.3, §6.1). The UI marks agent-authored messages.

### 4.2 Membership lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant O as Owner VTA (room DID key)
    participant H as Room host
    participant J as Joiner VTA
    participant W as Joiner wallet

    O->>J: VIC (rooms/owner/invite) over TSP/DIDComm
    J->>W: show inviter, room, validUntil — consent
    W->>J: accept
    J->>O: KeyPackage (rooms/keys/key-package)
    Note over O: MLS add (library-only today, plan B5)
    O->>H: Commit + epoch link (rooms/epoch/mint)
    O->>J: Welcome (rooms/keys/welcome) + VMC + VAC
    J->>H: rooms/epoch/chain → rooms/keys/chain (backfill history)
    J->>H: rooms/records/list sinceVersion=0
    Note over J: member; history readable back to retention floor
```

- **Join is push-shaped and consented** ([[ROOMS-DESIGN]] §4.1). There is no "request to join" until upstream specifies one ([[ROOMS-JOINING]]); invite links are therefore **out-of-band introductions to the owner**, who then pushes a VIC. A messaging UI must not pretend a link joins anyone by itself.
- **Leave / remove** is an MLS remove commit by the owner plus VAC/VMC non-renewal. Removal is forward-only: the removed member keeps what they already read and opens nothing after ([[ROOMS-DESIGN]] §5.5). A removed member with an unexpired VMC can still *present* to the host until it expires (§10.4 there) — so **messaging VMCs and VACs should be short-lived and auto-renewed** (proposed default 7 days, renewed by the owner's VTA on each epoch mint).
- **Missed commits are the classic failure.** A VTA that misses one cannot open anything later and must say "a commit has not been delivered", not "corrupt" (plan R2(c)). The change feed (§6.5) carries commits so this is rarer, and `rooms/epoch/commits` backfills.
- **Owner availability gates membership.** Only the owner commits ([[ROOMS-DESIGN]] §5.1). A group whose owner is offline cannot add anyone. Mitigation: owners run on an always-on VTA (the normal deployment), and a **nominated successor** (§10 there) covers long absence. A multi-admin committer policy is an open question (§15, Q3).

### 4.3 Permissions

| Product action | VAC verb | Notes |
|---|---|---|
| Read messages, list library, download files | `read` | |
| Post, reply, react, edit own, upload, attach, set own read marker | `write` | |
| Retract others' messages, pin, deprecate, unlink files from library | `curate` | human verb by default; not granted to agents |
| Add/remove members, rename conversation, set retention | `admin` + owner | owner is the only MLS committer |

**Decision (proposed): no new VAC verbs in v1.** Finer verbs (`react`-only, `upload`) are tempting but each is an upstream VAC change; revisit if `write` proves too coarse (§15, Q6). "Edit own" and "delete own" are enforced **client-side** by checking the in-body signature of the target — the host cannot see authorship on sealed tiers, so it cannot enforce it, and the protocol does not claim it does. A curator can always retract.

---

## 5. Data model

### 5.1 The conversation room

Created with `rooms/create` as today. Messaging sets:

- `visibility`: `attributed` by default; `open` only where server-side search and host scanning are worth the host reading content.
- `retentionPolicy`: `Chained` (history for joiners) by default; `FromJoin` for "new members see only new messages".
- `retentionDays`: the room's own statement of how long it matters ([[ROOMS-DESIGN]] §9).

A **conversation settings record** (key `cfg`, sealed) holds name, topic, avatar file ref, default notification policy and the profile version. Only `admin` writes it; clients ignore a `cfg` not signed by a current admin.

### 5.2 Record keys

Keys are **opaque on sealed tiers** ([[ROOMS-SEALED]]: "a key reading `decision/acquire-northwind` defeats the encryption"). The profile uses:

| Record kind | Key | Mutability |
|---|---|---|
| Message / reply / system event | `e/<eventId>`, `eventId` = 128-bit random, base32 | create-only |
| Edit, reaction, redaction request | `e/<eventId>` (its own event, referencing a target) | create-only |
| File manifest (one per file version) | `e/<eventId>` | create-only |
| Member profile | `p/<HMAC(K_idx, did)>` | rewrite by owner of the DID |
| Read marker | `r/<HMAC(K_idx, did)>` | rewrite by that member |
| Conversation settings | `cfg` | rewrite by admin |

The `e/`, `p/`, `r/` prefixes leak only the *class* of a record, which the access pattern already reveals. `K_idx` is a per-room index key derived from the MLS exporter with its own label, carried forward across epochs inside the sealed `cfg` record so it is stable (otherwise a member's profile key would change every epoch). If even record class is judged too much, all keys become `e/…` and profiles and markers become events (§15, Q8).

**Decision (proposed): the conversation is an append-only event log.** Everything a user does is a new create-only record; the only rewritable records are the three per-member/per-room singletons above. That fits the create-only sealing rule, makes sync trivial, and leaves the rooms "mutable KV with tombstones" model untouched.

### 5.3 Event body (inside the seal)

One sealed blob per record, all fields together, so ciphertext length does not reveal shape ([[ROOMS-DESIGN]] §6). Canonical JSON, versioned:

```jsonc
{
  "profile": "org.openvtc.msg/1",
  "type": "message",            // message | edit | reaction | redaction | file | system | profile | marker | cfg
  "eventId": "b3k…",            // equals the record key suffix; checked on open
  "author": "did:webvh:…alice", // the member; agent DID in "via" when an agent wrote it
  "via": "did:key:…agent",      // optional, matches the attenuated VAC's audience
  "clientTs": "2026-10-06T09:14:03Z", // untrusted, display only
  "thread": { "root": "b3a…", "inReplyTo": "b3c…" }, // optional
  "content": { "format": "text/markdown", "text": "…", "mentions": ["did:…"] },
  "attachments": [ { "fileId": "f9x…", "versionId": "e/b3m…", "name": "q3.pdf" } ],
  "target": "b3c…",             // for edit / reaction / redaction
  "sig": "z…"                   // author's DID signature over everything above
}
```

- **Signature inside the seal** gives members provable authorship while the host sees nothing ([[ROOMS-DESIGN]] §6). Clients **reject** an event whose `eventId` does not match its record key (relocation inside one room is already blocked by the AEAD; this blocks a member re-posting another's signed body under a new key).
- **Rendering is inert.** Markdown renders without script, remote images or auto-followed links; agents see content fenced as untrusted data (plan §2.2 item 5, [[ROOMS-DESIGN]] F8, R2‑16).
- **Size.** A Trust Task body is capped at 64 KiB on a VTC (plan §5). The profile caps a message body at **32 KiB plaintext** before padding; anything longer becomes a file attachment (`text/markdown` file, rendered inline).
- **Padding.** Sealed bodies pad to buckets (1, 4, 16, 32 KiB), the mitigation [[ROOMS-SEC-V2]] names for length leakage.

### 5.4 Threads, edits, reactions, redactions

- **Thread** = events sharing `thread.root`. The host cannot see thread structure; clients build it locally.
- **Edit** = an `edit` event with `target` and new content. The latest edit *signed by the original author* wins; others are ignored.
- **Reaction** = a `reaction` event; removal is a `redaction` of the reaction event. Aggregated client-side.
- **Delete own message** = a `redaction` event by the author (soft: clients hide), plus, where the author holds `curate`, a `rooms/records/curate` → `retracted` on the original so the host drops the body. Without `curate`, the body persists at the host until a curator retracts it or the epoch is pruned — the UI must say "hidden", not "deleted", in that case.
- **Moderator delete** = `curate` → `retracted` (body gone at the host; key/version/epoch stay, [[ROOMS-GUIDE]]).

### 5.5 File entities

```mermaid
erDiagram
    CONVERSATION ||--o{ EVENT : "records in room"
    EVENT ||--o| FILE_MANIFEST : "type=file"
    EVENT }o--o{ FILE_MANIFEST : "attachments[] (fileId, versionId)"
    FILE_MANIFEST }o--|| LOGICAL_FILE : "fileId"
    FILE_MANIFEST ||--|{ CHUNK_REF : "chunks[]"
    CHUNK_REF }o--|| BLOB : "blobId = H(ciphertext)"
    BLOB }o--o{ ROOM_BLOB_LINK : "host-side, cleartext"
    CONVERSATION ||--o{ ROOM_BLOB_LINK : "quota + GC unit"
```

- **Logical file** — `fileId` (random, 128-bit). Exists only as the set of manifests sharing it.
- **File manifest** — a sealed `file` event: `fileId`, `versionId` (its own record key), `supersedes` (previous `versionId` or null), name, MIME type, plaintext size, plaintext hash (BLAKE3), the **file content key** `K_file`, chunk size, ordered list of `{blobId, ciphertextLen}`, optional preview and thumbnail sub-manifests, uploader signature. The host sees an opaque record like any other.
- **Blob** — one encrypted chunk at the host's blob store, addressed by the hash of its **ciphertext**. The host knows blob sizes, which room(s) they are linked to, and access times — nothing else.
- **Room–blob link** — cleartext host-side row `(roomId, blobId)`. It is the host's unit of authorization, quota and garbage collection (§8.5).

---

## 6. Message flow, ordering and delivery

### 6.1 Send path

```mermaid
sequenceDiagram
    autonumber
    participant C as Client (wallet/web)
    participant V as Sender's VTA
    participant H as Room host (DS)
    participant F as Change feed
    participant M as Other members' VTAs

    C->>V: post(roomId, body, eventId)  [client-generated eventId = idempotency key]
    V->>V: sign body as member, pad
    V->>V: rooms/keys/seal (key=e/eventId, version=N+1, epoch=E)
    V->>H: rooms/records/put  expectedVersion:0, presentation(write)
    alt version still N+1
        H-->>V: signed ack {key, version, epoch, root}
    else someone else took N+1
        H-->>V: conflict {current: N+k}
        V->>V: re-seal at N+k+1, retry (bounded)
    end
    H->>F: room advanced to version v
    F-->>M: hint {roomId, headVersion}  (TSP/DIDComm via mediator)
    M->>H: rooms/records/list sinceVersion=watermark → get → open
    V-->>C: sent (version, signed ack)
```

Steps 3–6 already exist as `rooms/keys/seal` then `rooms/records/put` ([[ROOMS-TS]] builds this pair). A future `rooms/keys/write` ([[ROOMS-READTHROUGH]] §6) would collapse them into one VTA call, which is what a chat client wants.

### 6.2 Ordering

- **Total order per conversation = host-assigned room `version`.** The host is MLS's Delivery Service and the room's single write-primary ([[ROOMS-DESIGN]] §7.3), so this order is authoritative and identical for every member. `clientTs` is display-only.
- **Causal hints** (`thread.inReplyTo`, `target`) are rendered even if the target arrives later (placeholder until it does).
- **No cross-conversation order.** Each room is its own log.

### 6.3 The version race — the main messaging-specific risk

[[ROOMS-SEALED]] binds the **version** into the AEAD and the host assigns it from a **room-wide** counter. A create-only sealed write therefore succeeds only if no one else wrote in between. In a busy group, N concurrent senders produce up to N−1 conflicts per round, each costing a VTA re-seal and a host round-trip.

Options, in order of preference:

| Option | Change | Effect |
|---|---|---|
| **A. Append-mode AAD** (proposed) | Upstream spec: for `expectedVersion: 0` puts, AAD binds `roomId \| key \| "create" \| epoch` instead of the version. The host-assigned version is attested by the **signed put ack** and the Merkle leaf ([[ROOMS-DESIGN]] §14.7), which already bind it | No contention. Relocation stays impossible because a create-only key cannot be re-written and the leaf commits to `(key, version)` |
| B. Bounded retry | None | Works today; degrades at roughly >5 concurrent senders/second per room. Acceptable for M1 |
| C. Per-sender serialisation via the owner | Owner VTA sequences writes | Kills availability when the owner is offline. Rejected |

**Decision (proposed):** ship M1 with B, raise A upstream in parallel (it is a `dtgwg-trust-tasks-tf` change first, per the VTI workspace rule that specs lead code). Measure conflict rates in M0.

### 6.4 Delivery guarantees

| Property | Guarantee | Mechanism |
|---|---|---|
| Send idempotency | exactly-once **effect** | `eventId` is the record key; `expectedVersion: 0` makes a retried put a conflict that returns the existing record, which the sender recognises as its own |
| Durability on ack | once acked, durable at the primary | signed ack; R2.1 "Remote-First": the client marks *sent* only on the ack, never on local enqueue |
| Delivery to members | at-least-once, eventually | hints are best-effort; `sinceVersion` pull is the source of truth |
| Gap detection | detected, not assumed | versions may **skip** by design ([[ROOMS-STORAGE]]: "can only skip a version, never duplicate"), so contiguity proves nothing. Use the signed tree head's `headVersion` + `recordCount` and Merkle traces ([[ROOMS-DESIGN]] §14.7) |
| Withheld records | detectable as of the last anchor | verified reads + witnessed anchor ([[ROOMS-VERIFIED]], [[ROOMS-ANCHOR]]); the VTA keeps root memory per room |
| Equivocation / fork | detectable at anchors | epoch authenticator + version watermark in the witnessed log ([[ROOMS-DESIGN]] §9). High-assurance conversations anchor per commit |
| Ordering consistency | identical for all members | single primary; mirrors are read-only and never reorder |

The retry rule from the VTI workspace applies: **one retry owner per failure domain**. The VTA's idempotent Trust Task layer owns put retries; the messaging client does not wrap them in its own loop.

### 6.5 Real-time: the change feed (new)

Rooms have no push today. The design note expects the room DID to be "messageable" and to "push epoch and membership changes to members over the existing delivery layer" ([[ROOMS-DESIGN]] §3.2), and `room-host` can already sit at a mediator ([[ROOM-HOST-DIDCOMM]]).

**Decision (proposed): hints, not content.** The host sends `{roomId, headVersion, epoch}` to subscribers. A hint carries no record and no author; a member's VTA pulls with `sinceVersion` and opens. Losing a hint costs latency, never correctness.

```
            ┌──────────── subscribe(roomId, presentation(read), ttl ≤ 24h) ─────────────┐
            │                                                                           ▼
 Member VTA ◄──── hint {roomId, headVersion, epoch} ──── mediator ◄──── Room host change feed
     │                (TSP preferred, DIDComm fallback)                     ▲
     │                                                                      │ on every put / curate / mint
     ├──► push gateway (WakeHandle) ──► phone OS push: "new activity" (no content)
     └──► local client: SSE/WebSocket from the VTA, or app polling the VTA
```

- **Subscriptions are presentations**, expiring (≤ 24 h) and renewed by the VTA. The host keeps the subscriber set in memory and a bounded store; it is **not** a roster (it lists who is listening, which on `attributed` the per-member access log already reveals).
- **`private` tier:** a subscriber list would hand the host the membership. There, hints go **from the room DID's mediator** to an MLS-sealed broadcast address, or members poll on a jittered schedule. Deferred with the tier.
- **Commits ride the same feed** so members apply them promptly (fewer stuck-epoch failures).
- **Typing indicators and presence** are **not** room records and not host traffic. They are optional, ephemeral, MLS-sealed application messages sent VTA-to-VTA over the mediator, dropped if not delivered in seconds. Off by default; they leak activity timing to every member.
- **Mobile:** the VTA wakes devices through the existing push gateway with a content-free notification; the app then asks its VTA. Notification text is rendered on-device after open, never by the push service.

### 6.6 Offline and sync

- **Per room, the VTA keeps:** watermark (highest version seen), last verified root + `headVersion`, applied epoch, and the decrypted event cache (encrypted at rest under the VTA's storage key).
- **Reconnect:** `rooms/records/list sinceVersion=watermark` in pages (≤ 500, [[ROOMS-STORAGE]]), `get` bodies, `open` via `rooms/keys/browse` in batches, verify trace against the anchored root, advance watermark. Tombstones converge deletes.
- **Outbox:** messages composed offline sit in the client outbox with their `eventId`; on reconnect they are sent in order. Because ordering is host-assigned, an offline message lands *after* everything already in the room, and the UI shows it there. That is honest and matches every mainstream chat system.
- **Fresh device:** has no state; it asks the member's VTA, which already has it. Devices never sync from the host directly (plan Q6, leaning VTA-only).
- **Mirrors** (T3) serve reads for far-away members; a member detects a stale mirror by its watermark and falls back to the primary for writes and bootstrap ([[ROOMS-DESIGN]] §7.3, R2‑5).

---

## 7. Conversation types

| Type | Room shape | Topology |
|---|---|---|
| DM | 2 members, both `write`; owner = initiator, successor = the other | T1 or T4 (peers via VRC) |
| Small group | ≤ 50 members, `attributed` | T1 (owner's room host) or T2 (community VTC) |
| Community channel | roster-sized, `attributed` or `open` | T2; T3 with mirrors when cross-community |
| Agent workspace | humans + their agents via attenuated VACs | any |

**Large rooms** stress three things: O(log n) MLS commits (fine), the owner as sole committer (a bottleneck for churn), and per-message VTA seal/open cost (fine — one seal per send, batched opens per sync). §12 lists the measurements.

---

## 8. File storage

### 8.1 Why files cannot be records

The Trust Task body is capped at **64 KiB on a VTC** and 2 MB on `room-host` (plan §5); the body is inside a signed document, so no presigned upload fits the current schema (S3 note Option C). Files therefore need **a blob layer whose bytes travel outside Trust Task bodies, while every authorization decision still rides a room presentation**.

### 8.2 The `rooms/blobs/*` task family (new, upstream spec first)

Served by the host, authorized exactly like `rooms/records/*` — a presentation chain issued by the room, bound to the presenter, never a host ACL (I5).

| Task | Verb | Returns |
|---|---|---|
| `rooms/blobs/begin` | `write` | upload session: `sessionId`, accepted chunk size, per-chunk **upload grants** (short-lived URLs or a session token for a `PUT /blobs/<sessionId>/<n>` byte route), quota remaining |
| `rooms/blobs/complete` | `write` | verifies every chunk's hash, creates `(roomId, blobId)` links, returns a **signed receipt** listing blob ids and sizes |
| `rooms/blobs/grant` | `read` | short-lived download grants for a list of `blobId`s linked to this room |
| `rooms/blobs/link` | `write` on target room + proof of read on source room (§9.3) | links existing blobs into another room, no re-upload |
| `rooms/blobs/unlink` | `curate` (or the uploader within a grace window) | removes a room's link; GC decides whether bytes go |
| `rooms/blobs/usage` | `read` | room bytes used / quota |

The **byte route** (`PUT`/`GET` of ciphertext chunks) is a declared foreign-protocol exception in the same spirit as the VTI backup blob transfer (`GET|POST /backup/blob/{id}`, S3 note §4 Option C): it carries no authority of its own, only a grant minted by a Trust Task. With an S3 backend the grant is a presigned URL and bytes never touch the host process.

### 8.3 Upload: chunking, encryption, resumability

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant V as Uploader's VTA
    participant H as Room host
    participant S as Blob store (S3/MinIO/local)

    C->>C: K_file = random 256-bit; split into 4 MiB chunks
    C->>C: chunk_i → AEAD(K_file, nonce=i, AAD=fileId|versionId|i|last?) ; blobId_i = H(ct_i)
    C->>V: blobs/begin(roomId, [blobId_i, len_i]) — VTA presents `write`
    V->>H: rooms/blobs/begin
    H-->>V: sessionId, grants for chunks not already present
    V-->>C: grants
    loop each missing chunk (parallel, resumable)
        C->>S: PUT ct_i via grant
    end
    C->>V: complete(sessionId)
    V->>H: rooms/blobs/complete
    H->>S: HEAD/verify hashes
    H-->>V: signed receipt {blobIds, sizes}
    C->>V: post file manifest event (sealed, contains K_file) + message event with attachment
```

- **Encryption is per file version, client-side**, with a random `K_file`. Chunks use a STREAM-style construction (chunk index and last-chunk flag in AAD) so truncation, reordering and splicing fail to open. Same AEAD family as rooms (ChaCha20-Poly1305 or XChaCha20-Poly1305).
- **`K_file` lives only inside the sealed manifest**, so it inherits the room's key schedule: readable by whoever can open the manifest's epoch, back to the retention floor, and cryptographically deleted when epoch links are pruned. This is the [[MLS-ATTACH]] pattern that [[ROOMS-DESIGN]] §5.1 already cites, with one level of indirection so a file can be shared into other rooms without re-encrypting (§9.3).
- **Resumable:** `begin` is idempotent on `(roomId, sessionId)`; the host reports which `blobId`s it already holds; a client resumes by asking again. Sessions expire (proposed 24 h); orphan chunks are swept (S3 note S3: "orphans are deleted and no live object is").
- **Ordering is object-first** (S3 note S2): bytes, then link rows, then the manifest record. A crash leaves orphans, never a manifest pointing at missing bytes.
- **Chunk size** 4 MiB default; the manifest records it, so it can change per file.

### 8.4 Content addressing and dedupe

- **`blobId = BLAKE3(ciphertext)`.** It gives integrity (the client checks what it downloads) and idempotent upload.
- **Decision (proposed): no convergent encryption.** Deriving `K_file` from the plaintext would let the host (or anyone) confirm "this room holds file X" by encrypting a guess — a known attack on convergent schemes. Dedupe therefore happens only for **the same encrypted file**, which is exactly the "reuse across conversations" case (§9.3). Two people uploading the same PDF independently store it twice. That is the price of G3.
- **`open` rooms** may dedupe by plaintext hash because the host reads content anyway; the profile keeps one code path and does not bother in v1.

### 8.5 Quotas, retention and garbage collection

- **Quota unit is the room** (bytes linked to it), set by host governance: `rooms.rego` on a VTC, the owner on a T1 host. Per-member quotas only on `attributed`/`open`, where the host knows who acted; `private` gets room-level caps only ([[ROOMS-DESIGN]] §4.5).
- A blob linked to several rooms counts against **each** (simple, and it stops a cheap room from parking bytes on an expensive one).
- **GC:** a blob is deleted when its last `(roomId, blobId)` link goes. Links go on `unlink`, on room reclamation ([[ROOMS-DESIGN]] §9), and by the room's `retentionDays`. The host **cannot** reference-count by manifests on sealed tiers — it cannot read them — so a manifest may outlive its bytes (the UI shows "file no longer available") but bytes never outlive every link.
- **Deletion vs. bucket versioning:** the S3 note §5.3 trap applies; the blob store must hard-delete (lifecycle rules, no retained versions) or "deleted" is a promise. Cryptographic deletion (pruning epoch links before the manifest's epoch) is the stronger guarantee and does not depend on the bucket.

### 8.6 Malware scanning

The host cannot scan sealed bytes. Options, layered:

1. **Uploader-side scan** in the uploader's client or VTA before sealing (catches accidents, not adversaries).
2. **Downloader-side scan** before a file is opened or handed to an OS app (the real control; the recipient chooses).
3. **Type policy**: manifests carry a declared MIME type and the client sniffs the decrypted bytes; executables and active content are never auto-opened or previewed; archives are not auto-extracted.
4. **`open` rooms**: the host may scan server-side as governance, and record the verdict in a host-signed annotation.
5. **Optional room scanning agent**: a member-like agent with an attenuated `read`(+`write` for verdicts) VAC that scans new files and posts signed verdict events. It sees plaintext, so it is a disclosed member of the room, never a hidden host feature.

### 8.7 Download authorization

```
member → VTA: open file (roomId, versionId)
VTA → host: rooms/records/get (manifest) + rooms/keys/open → K_file, blob list
VTA → host: rooms/blobs/grant(roomId, blobIds) with presentation(read)   [checks (roomId, blobId) link]
host → VTA: grants (≤ 10 min, single-room scope)
client ← VTA: grants + K_file (§9.4)
client → blob store: GET chunks; verify H(ct) = blobId; decrypt; verify plaintext hash
```

- A leaked grant leaks **ciphertext** for ten minutes; a leaked grant plus manifest is the threat, and the manifest is sealed.
- **A removed member** cannot get grants once their VMC/VAC expire, and cannot read manifests sealed after their removal. Files they already downloaded are theirs, as with messages.
- Grants are per room: having access to the same blob through room A does not grant it through room B.

### 8.8 Previews and thumbnails

- **Generated by the uploader's client** (image downscale, first-page PDF render, video poster frame, text excerpt), encrypted as small separate files with their own keys, listed in the manifest's `preview` sub-manifest. The host never renders anything.
- Thumbnails pad to a fixed size bucket so their length does not fingerprint the image.
- Recipients render previews in a sandbox (no scripts, no external fetches) and fall back to a type icon when a preview is missing or fails to decode.

---

## 9. The message ↔ file link model

### 9.1 Links

| Link | Where it lives | Who can see it |
|---|---|---|
| Message → file (attachment) | `attachments[]` in the sealed message event: `(fileId, versionId)` | members |
| Thread → file | the attachment's message carries `thread.root`; or a `file` event itself carries `thread` | members |
| File → conversation (library) | the manifest record exists in that room | members |
| File version chain | `supersedes` in each manifest | members |
| Blob → room | `(roomId, blobId)` host row | **host** |
| Same file in two rooms | same `blobId`s linked to both rooms | **host** (§9.3) |

All semantic links are **inside sealed bodies**. The host sees only which ciphertext chunks belong to which rooms.

### 9.2 Per-conversation file library

The library is a **client-side index** over `file` events in the room, built during sync: latest version per `fileId`, uploader, size, type, thread, messages that reference it (back-links computed locally from `attachments[]`). Filters: by type, by person, by thread, "shared in this conversation" vs "linked from elsewhere". Curators can **pin** (record `curate` → pinned) or **remove from library** (unlink blobs + retract manifest). No host-side library API exists on sealed tiers, by design; on `open` rooms the host may index.

### 9.3 Reusing a file across conversations

```mermaid
flowchart LR
    subgraph RoomA["Room A (source)"]
      MA["manifest v2<br/>K_file, blobs b1..b4"]
    end
    subgraph RoomB["Room B (target)"]
      MB["new manifest (copy)<br/>same fileId, K_file, blobs<br/>origin: (roomA, versionId)?"]
    end
    U["Member of A and B"] -->|"open in A (read)"| MA
    U -->|"rooms/blobs/link A→B<br/>presentations: read@A, write@B"| H[(Host blob links)]
    U -->|"post sealed manifest in B"| MB
    H -. "(roomB, b1..b4) rows" .-> MB
```

- **Same host:** `rooms/blobs/link` with two presentations (`read` on A, `write` on B) adds `(B, blobId)` rows. No bytes move. The sharer posts a new sealed manifest in B containing `K_file` and the same blob list. Room B's members can decrypt; room A's other content stays sealed to A.
- **Different hosts:** the client downloads and re-uploads the ciphertext chunks (still no re-encryption), then posts the manifest.
- **Unlinkable share (option):** re-encrypt under a fresh `K_file` and upload new blobs. Costs a full upload; hides from the host that A and B hold the same file. **Decision (proposed):** default to link for files above 1 MiB on the same host, re-encrypt below; expose "private copy" for sensitive files. The cross-room linkage the host learns is listed in §10.2.
- **Provenance:** the new manifest may carry `origin` (source room DID and version). Off by default — it tells room B's members that room A exists.
- **Revocation does not propagate.** Once `K_file` is in room B, room A cannot take it back. Removing it from A does not remove it from B. That is inherent to sharing and the UI must say so on share.

### 9.4 Who decrypts files (the one custody question)

Rooms' rule is that **the app holds no room credential and no group key** (plan §2.2 item 1); the VTA opens and returns plaintext. Streaming a 2 GB video through the VTA oracle is wasteful and puts every byte on the VTA's path.

**Decision (proposed):** the VTA opens the manifest and releases **`K_file` for that one file version** to the requesting client, which decrypts chunks locally. Rationale: `K_file` is neither a room credential nor a group key; it opens exactly one file the member is already entitled to read, and the plaintext would reach the client anyway. Agents follow the same rule but only under a VAC that includes `read`. This **must be agreed** before M3 because it reads against the plan's custody principle (§15, Q1). The fallback is VTA-side decryption with a streaming `rooms/keys/open-file` task, which preserves the principle and costs throughput.

### 9.5 File versions

- A new version is a new manifest with the same `fileId`, new `K_file`, new blobs, and `supersedes` = the previous `versionId`.
- **Message attachments pin a version** (`versionId`), so a message always shows what was actually sent; the UI offers "newer version available".
- The library shows the latest version, with history. Forks (two versions superseding the same parent) are shown as siblings; nobody merges them.
- **Who may version:** the uploader of the logical file, plus curators. Enforced client-side by signature, as with edits (§4.3).
- Old versions' blobs remain linked until unlinked or retention removes them; "keep last N versions" is a client-driven unlink, not a host policy.

---

## 10. Encryption and privacy

### 10.1 By tier

| | `open` | `attributed` | `private` (when shipped) |
|---|---|---|---|
| Message bodies, file names, thumbnails, threads, reactions | host reads | sealed | sealed |
| Who posted / downloaded | host sees DID | host sees DID | unlinkable |
| Server-side search | yes | no (client-side, §11) | no |
| Server-side malware scan | yes | no (§8.6) | no |
| Change-feed subscriptions | by DID | by DID | not by DID (§6.5) |
| Per-member quota | yes | yes | room-level only |

### 10.2 What the host still learns on sealed tiers (accepted, stated)

- Message **count, timing and padded size** per room; who posted (on `attributed`).
- **File sizes** (blob counts × chunk size, last-chunk length), upload and download timing, and **which rooms share a blob** when the link path is used (§9.3).
- Subscription set and online patterns (who is listening).
- Read-marker rewrite cadence (who has read up to when), unless markers are disabled.

[[ROOMS-SEC-V2]] accepts metadata leakage of this kind and names padding as the mitigation; this plan adds padding for bodies and thumbnails, and a re-encrypt option for linkage.

### 10.3 Key schedule consequences

- **Forward secrecy for members:** removal is forward-only (MLS + epoch chain, [[ROOMS-DESIGN]] §5.5).
- **Post-compromise security for stored content is given up** under `Chained` retention: a compromised current key reaches every retained epoch, and so every retained `K_file`. Same trade rooms already make; conversations that need it choose `FromJoin` + pruning.
- **Disappearing messages** = scheduled pruning of epoch links plus `retentionDays`. Requires the upstream prune verb ([[ROOMS-DESIGN]] §12.2); until then, "disappearing" must not be offered on sealed tiers, because host deletion alone is a promise.
- **Key custody without a TEE:** the VTA guards MLS state; plain-mode VTAs keep group secrets in the clear on disk (ES note §5.2). Messaging inherits that; production deployments should run hardened mode or the enclave.

### 10.4 Untrusted content, both directions

Every message, file name, preview and file body is attacker-controlled input to every member's screen and every member's agent. Render inert; sandbox previews; never auto-open; fence content as data for agents (F8). An agent that can **post** can also be steered by what it reads — agent write VACs should be narrow and short.

---

## 11. Search

- **`open` rooms:** host-side full-text index over cleartext bodies and file names, behind the same `read` presentation. Optional; a host may decline.
- **Sealed rooms:** the **member's VTA** maintains an encrypted local inverted index per room from opened events (it already holds durable per-room state for root memory, [[ROOMS-DESIGN]] §14.9). Clients query their VTA. File **content** search is opt-in: the client extracts text after download and feeds the VTA index.
- **Agents** search through the same VTA index under their attenuated VAC, and results carry provenance (room, author, human or agent).
- **Not adopted:** searchable symmetric encryption at the host. It leaks query and access patterns that the tiers exist to withhold, for a feature members can get locally.

---

## 12. Scaling and failure modes

### 12.1 Expected load vs. rooms' assumptions

| Dimension | Rooms assumption | Chat reality | Action |
|---|---|---|---|
| Writes per room | low | bursts of 10s/second | §6.3 option A; measure in M0 |
| Records per room | small | 10⁵–10⁶ over a year | Merkle store is incremental now ([[ROOMS-DESIGN]] §14.7); confirm `list` paging and `tree_head` costs at 10⁶ (ES note P0) |
| Body size | ≤ 64 KiB | mostly < 1 KiB | pad buckets; host stores inline in fjall; S3 Option B for bodies is unnecessary for messages |
| Reads | per-record VTA open | every member opens every message | batch `rooms/keys/browse`; VTA caches plaintext |
| Hosts | one process, in-memory replay guard | HA expected | replay guard must persist / be shared before any multi-instance host (ES note §1 "Limits") |

### 12.2 Failure modes

| Failure | Effect | Handling |
|---|---|---|
| Host down | no sends, no syncs; mirrors still serve reads | client outbox; read from mirror; I2 says availability is the host's only job — pick hosts accordingly |
| Mediator / feed down | no hints | members poll their rooms on backoff; correctness unaffected |
| Owner VTA offline | no adds/removes/renewals | successor nomination; long-lived owner VTA; Q3 multi-committer |
| Member misses a commit | cannot open new messages | commits on the feed; `rooms/epoch/commits` backfill; explicit UI message |
| Version contention | send latency, retries | option A upstream; bounded retry meanwhile |
| Blob store down | messages work; files fail | manifests still sync; UI shows "file temporarily unavailable" |
| Upload interrupted | partial session | resumable `begin`; sweeper for orphans |
| Host withholds records | silent gaps | verified reads; VTA root memory; **serve reads, refuse writes** to a caught host ([[ROOMS-DESIGN]] §14.9) |
| Host equivocates / forks | divergent views | witnessed epoch anchoring; compare authenticators |
| Owner key lost, no successor | room frozen read-only | stated at creation (I1, §5.4 there); export before reclamation |
| Quota exceeded | uploads refused | typed error with usage; curators unlink old versions |

### 12.3 Host scaling shape

- **Partition by room.** All writes for a room go to its single primary; rooms spread across host instances by `roomId` hash. No cross-room transactions exist, except `blobs/link`, which only adds rows.
- **Metadata in fjall, bytes in the blob store** (S3 note Option B for record bodies is optional; files are always out of fjall).
- **Feed fan-out** is per room and stateless beyond the subscriber set; one mediator socket per host DID (VTI rule: one websocket per DID).

---

## 13. Observability

- **Host metrics (no content, no DIDs on `private`):** puts/s and conflict rate per room bucket, `list` latency, `tree_head` time, feed fan-out latency (put → hint send), subscriber counts, upload sessions started/completed/abandoned, bytes stored and egressed, GC deletions, quota refusals.
- **Audit:** room actions go through `vti_rooms::audit`, which already decides once which actor a host may record per tier ([[ROOMS-DESIGN]] §8). New actions: `room.blob.begin|complete|grant|link|unlink`. Read events on files are the sensitive ones; they inherit the room's read-event retention.
- **VTA metrics:** per-room watermark lag (host `headVersion` − local watermark), commit lag (anchored epoch − applied epoch), seal retries, open failures by cause (missing commit vs. tampering), verified-read failures.
- **Client:** time-to-first-message after reconnect, send-to-ack latency, end-to-end send-to-render latency measured with **local** timestamps only (no telemetry that reveals who talks to whom).
- **Health flags are not latched** (VTI rule R6.2): "feed connected" must be able to go false again.

---

## 14. Phased rollout

Phases are prefixed **M** to keep them apart from the plan's R-phases and the S3 note's S-phases. "Verified" means against the local lab stack (plan §8), not only a unit test. All are local-lab only until rooms have a Farm story.

| Phase | Scope | Depends on | Done when |
|---|---|---|---|
| **M0 Measure** | Load-test `room-host` with a chat-shaped workload: 10⁵ records, 20 concurrent writers; time `list`, `tree_head`, seal conflicts, `browse` throughput. Read upstream intent on `rooms/keys/write` and push | lab stack | a dated companion records conflict rate, latency percentiles and the go/no-go for option B |
| **M1 Text messaging** | Messaging profile v1 on `open` and `attributed` rooms: post, reply/thread, edit, react, retract, read markers; polling sync | plan R1–R3 (read, write, curate); B2–B4 | two lab members exchange 1 000 messages with concurrent sends; both render identical order; an injected-markdown message renders inert; a retried send produces one event |
| **M2 Real-time** | Change feed (hints) over TSP/DIDComm; VTA subscription renewal; push-gateway wake | `room-host --mediator-did`; upstream feed task spec | median put → other member's VTA hint < 1 s on the lab; killing the mediator degrades to polling with no lost messages |
| **M3 Files** | `rooms/blobs/*` upstream spec; chunked encrypted upload, resumable; download grants; attachments; local + MinIO blob store | spec merged in dtgwg-trust-tasks-tf; §15 Q1 decided | a 1 GB file uploads across a killed connection and resumes; a tampered chunk fails to open; a removed member cannot obtain a grant after VAC expiry |
| **M4 Library, reuse, versions** | Client library index; `blobs/link` across rooms; versions with `supersedes`; quotas; GC | M3 | linking a file into a second room moves no bytes; unlinking from both deletes bytes (with bucket versioning on); quota refusal is typed |
| **M5 Previews, search, scanning** | Client-side previews; VTA search index; download-side scan hook; optional scanning agent | M4 | previews of a malicious SVG/PDF execute nothing; search finds messages across rooms through the VTA only |
| **M6 Hardening** | Verified reads on every sync; witnessed anchoring per renewal; disappearing messages via prune verb; option A append-mode AAD | upstream prune verb, anchoring build | a host that drops a record is caught and writes are refused with an explanation; a pruned epoch's files cannot be opened by any member |
| **M7 `private` tier** | Unlinkable presentations; feed without a subscriber roster | upstream ZK profile (plan B8) | defined then |

**Ship order rationale:** M1 needs no upstream change at all — it is a profile over tasks that serve today. M2 and M3 each need one spec PR, and they are independent, so they can go upstream in parallel with M1 work.

---

## 15. Open questions and risks

| # | Question | Kind | Blocks |
|---|---|---|---|
| Q1 | May the VTA release a **per-file key** to the client (§9.4), or must all file decryption stay in the VTA? | Not decided — reads against plan §2.2 item 1 | M3 design |
| Q2 | Will upstream accept **append-mode AAD** for create-only sealed puts (§6.3 option A)? | Needs upstream | M6; M1 scale ceiling |
| Q3 | Should more than one admin be able to **commit** (MIMI-style room policy), so membership does not stall on one owner? | Needs upstream; touches I1 | large-room usability |
| Q4 | Is a **host change feed** acceptable upstream, and in which family (`rooms/feed/*` on the host vs. room-DID messaging)? | Needs upstream | M2 |
| Q5 | Is `rooms/blobs/*` acceptable as a top-level rooms family, and is the byte route an acceptable declared REST exception? | Needs upstream | M3 |
| Q6 | Are VAC verbs `read/write/curate/admin` enough, or does messaging need `react`/`upload`? | Product, then upstream | §4.3 |
| Q7 | Default for cross-room reuse: **link** (host learns linkage) or **re-encrypt** (costs bandwidth)? | Product / privacy | M4 |
| Q8 | Are record-class prefixes (`e/`, `p/`, `r/`) an acceptable leak, or must every key look the same? | Privacy | M1 key scheme |
| Q9 | Which conversations need **per-commit anchoring** (high assurance), and who pays for the witness load? | Product / ops | M6 |
| Q10 | Should read markers and typing indicators exist at all on sealed tiers, given what they leak? | Product / privacy | M1, M2 |
| Q11 | Does Keyring want messaging at all (plan Q1 is still open), or is the first client the web console / mobile agent? | Product owner | everything client-side |

**Risks**

- **Upstream dependency concentration.** Feed, blobs, append-mode AAD, prune verb, owner MLS add and the `private` profile are all upstream. Only M1 is free of them. Mitigation: raise M2/M3 specs early and keep M1 useful on its own.
- **Rooms not sized for chat.** If M0 shows `list`/`tree_head`/contention costs that do not scale, the fallback is **one room per conversation segment** (rolling to a new room every N messages, linked by a sealed `continues` record) — workable, but it multiplies credentials and is a product smell.
- **Owner as single point of liveness** for membership changes.
- **Metadata leakage** (§10.2) is real even on sealed tiers; the product must not market `attributed` as "the host knows nothing".
- **Client-enforced rules** (edit-own, version-own) can be bypassed by a malicious member writing records directly; honest clients ignore them, but a buggy client renders them. Test with adversarial records.
- **Doc drift.** [[ROOMS-GUIDE]] already lags the code (plan §2.3), and this plan reads `b9c5703a`, not the plan's pin. Re-verify every cited behaviour against the pin before M1.

---

## 16. Where the work lives

- **Upstream (VTI + `dtgwg-trust-tasks-tf`):** feed task, `rooms/blobs/*`, append-mode AAD, `rooms/keys/write`, prune verb. Specs first, code through a `trust-tasks-rs` bump.
- **`room-host` / `vtc-service`:** feed fan-out, blob sessions and grants, blob-store backend (S3 note Option B extended to blobs), GC sweeper, audit actions.
- **`vta-service`:** feed subscription, per-room watermark and root memory, search index, file-key release (Q1), batched open.
- **Client library (new, TypeScript, beside [[ROOMS-TS]]):** messaging profile codec, outbox, local store, library index, chunked crypto (wasm), preview generation. Keyring consumes it through the `vti-client` package the PNM/CNM subtask designs (plan §3.1).

This plan edits neither the rooms plan nor its companions.

---

## 17. Sources

- [`openvtc-rooms-plan.md`](../openvtc-rooms-plan.md) — the parent plan.
- `/srv/dev/code/rooms_s3_storage_subtask.md`, `/srv/dev/code/rooms_encrypted_spaces_subtask.md` — companions.
- `seas/vtafarm/vta-build-pipeline` @ `b9c5703a`: `docs/05-design-notes/data-rooms.md` (§1–§15), `docs/02-vta/data-rooms.md` (§1–§2), `vti-rooms/src/sealed.rs` (version binding), `vti-rooms/src/storage.rs` (version assignment), `room-host/src/didcomm.rs` (mediator reachability), the workspace's top-level contributor guide (transport preference, retry ownership, Remote-First, spec-first rule).
- [RFC 9420 — MLS](https://www.rfc-editor.org/rfc/rfc9420); [draft-sullivan-mls-attachments](https://www.ietf.org/archive/id/draft-sullivan-mls-attachments-01.html); [RFC 9605 — SFrame](https://www.rfc-editor.org/info/rfc9605); [MIMI](https://datatracker.ietf.org/doc/draft-ietf-mimi-protocol/).
