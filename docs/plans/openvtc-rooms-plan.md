# Data Rooms in Keyring — Starting-Point Plan

**Status:** Draft — a starting point, not a commitment to implement. What remains before it leaves draft is §10.
**Subtasks:** [`rooms_member_sprint_subtask.md`](./openvtc-rooms-plan/rooms_member_sprint_subtask.md) — the member-side sprint: join by community offer, list, download, post. **It is the first chunk of work.** Keyring wants at least this much room functionality (§9 Q1, answered yes by the owner, Brendan, 2026-10-26); the sprint narrows R0–R3 for `open` and `attributed` rooms (§7), and R4, R5 and everything else stay later. [`rooms_s3_storage_subtask.md`](./openvtc-rooms-plan/rooms_s3_storage_subtask.md) — host-side S3 storage for record bodies. [`rooms_encrypted_spaces_subtask.md`](./openvtc-rooms-plan/rooms_encrypted_spaces_subtask.md) — the Encrypted Spaces merk as a backend behind a proposed `RecordStore` seam (none exists at fc157f76), and its fit for rooms' storage and sync. [`rooms_group_messaging_subtask.md`](./openvtc-rooms-plan/rooms_group_messaging_subtask.md) — group messaging and linked files as a profile on rooms.
**Scope:** Keyring as a **member client** of VTI data rooms — reading, writing and curating records, and holding an agent's access to them. Owner/host operation is out of scope except where §5 says the wallet must cope with it.
**Parent:** [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) — rooms are a new consumer of the Trust Task operation layer that plan adopts (its §5).
**Siblings:** [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) — the VTA client this plan extends (rooms are a PNM surface, §3 below). [`trust_tasks_subtask.md`](./openvtc-integration-plan/trust_tasks_subtask.md) — the VRC/witness recast, which §6's admission-evidence idea depends on. [`locality-plan.md`](./locality-plan.md) — co-presence evidence, a candidate admission gate (§6).
**Reasoning:** [`2026-10-06-bam.md`](./openvtc-rooms-plan/2026-10-06-bam.md) — the Encrypted Spaces assessment, input to the Encrypted Spaces subtask. [`2026-10-13-bam.md`](./openvtc-rooms-plan/2026-10-13-bam.md) — the re-baselining findings at 49f5f1be, including the Keyring-side re-check in §5a. [`2026-10-26-bam-rebaseline.md`](./openvtc-rooms-plan/2026-10-26-bam-rebaseline.md) — the re-baseline to fc157f76 and what it settles (B1/Q1, B5, B7, the blobs family), and the review round of PR #661 (persona signing, existing rooms module, delivery leg, message vocabulary, test host). Record each §9 decision in a dated companion, not here.
**Baseline:** every claim is measured against `verifiable-trust-infrastructure` `main` at **fc157f76** (2026-10-26; vta-service 0.65.0, vta-sdk 0.73.0; checkout `/srv/dev/code/seas/verifiable-trust-infrastructure`) unless marked otherwise, and carries a file path; `VTI/` below means that commit. `scripts/openvtc/PINS.json` is Keyring's pin and still names an earlier commit (49f5f1be, tag `VTI-Eucalyptus`, 2026-10-07): the plan is measured at fc157f76, and the pin lags it until bumped. A second pin, `verifiable-trust-infrastructure-v047` at 439a0333 (2026-10-01, tag `vta-service-v0.47.0`), also contains `room-host`, `vti-rooms`, `vti-rooms-dtg` and `vti-rooms-wasm`; it exists for `card-verify-v047` and is not a rooms baseline. The Keyring side (§5a) is measured at `origin/main` 0da7eead with its `bifold` submodule at d86785b4. Re-verify after any pin advance.

**Verification note.** Every claim below is read from the git objects of fc157f76 (`git show fc157f76:<path>`), not from a working tree; `external/verifiable-trust-infrastructure` is checked out at an older commit and does not hold it. Room credentials at the pin carry an `issuerScope` (`public` on a VIC or VAC the room issues, `directed` on an attenuated leaf; `vta-service/src/trust_tasks/room_owner.rs`, `vti-rooms-wasm/src/identity.rs`), and in-room endorsements are a VSC under `endorses/1` ([[ROOMS-DESIGN]] §4). Every room Trust Task URI named below appears in fc157f76's Rust sources. What moved relative to the older baselines the draft was written against is recorded in [`2026-10-13-bam.md`](./openvtc-rooms-plan/2026-10-13-bam.md) and [`2026-10-26-bam-rebaseline.md`](./openvtc-rooms-plan/2026-10-26-bam-rebaseline.md).

**References:**

- **[[ROOMS-GUIDE]]** — `docs/02-vta/data-rooms.md` in the VTI repo. The operator's path: topologies (§3), visibility tiers (§4), creation (§5), admission (§6), agent access (§7), hosting (§8), use (§9), lifecycle (§10), the task reference (§12). **Stale in parts** — see §2.3; §12 ("Reference", lines 1931–1990 at fc157f76) is the task registry.
- **[[ROOMS-DESIGN]]** — `docs/05-design-notes/data-rooms.md`. The four topologies, the visibility ladder, why MLS, why the host never decides.
- **[[ROOMS-JOINING]]** — `docs/05-design-notes/data-rooms-joining.md`. *Proposal, not a plan.* A room has no join request; admission is push-shaped.
- **[[ROOMS-READTHROUGH]]** — `docs/05-design-notes/data-rooms-read-through.md`. *Accepted 2026-09-09.* Why a console cannot read a record and why the member's own agent makes the host call.
- **[[ROOMS-VERIFIED]]** — `docs/05-design-notes/data-rooms-verified-reads.md`. *Proposal.* Making a withheld record detectable.
- **[[ROOMS-ANCHOR]]** — `docs/05-design-notes/data-rooms-epoch-anchoring.md`. *Decided 2026-09-09.* A typed service entry in the room's witnessed log.
- **[[ROOMS-SEC-V2]]** — `docs/05-design-notes/data-rooms-security-review-v2.md` (current; v1 is the same directory).
- **[[ROOMS-DEMO]]** — `docs/05-design-notes/data-rooms-demo-site.md`. *Design, unbuilt.* A browser as a room member.
- **[[ROOMS-TS]]** — `external/vta-browser-plugin/packages/core/src/rooms/index.ts` (821 lines). Upstream's TypeScript client for the whole `rooms/*` family. Pin 43e2cc7.
- **[[ROOMS-HOST]]** — `room-host/` (`src/main.rs`, `README.md`), the standalone host binary.
- **[[RFC9420]]** — [Messaging Layer Security (MLS)](https://www.rfc-editor.org/rfc/rfc9420), the group key agreement the sealed tiers use.
- **[[TT-SPEC]]** and **[[DTG-CRED]]** — as in the parent plan: the Trust Tasks framework (cite as framework 0.4) and the DTG Credentials specification, which define the VIC, VMC and VAC.

---

## 1. What this adds, and why it is a separate plan

The parent plan makes Keyring speak the ecosystem's transport and operation layers. The PNM/CNM subtask makes it a client of a person's own VTA. **A data room is a third thing built from the same parts**: a shared set of records whose access is a credential chain the *room* issued, verified against the room's own DID, never against the host's ACL or a session ([[ROOMS-GUIDE]] §1: "a room operation is authorized by the credential chain the room issued, verified against the room's own DID").

It is its own plan because it has a different critical path. It reuses the VTA session, the Trust Task envelope and the wallet's credential handling, but it adds a second service per call, group-key custody, and an admission problem the existing flows do not have (§5, §6).

Nothing in the parent plan or either subtask mentions rooms. Treat everything in this document as a proposal for a new workstream, not a refinement of an existing one.

## 2. What rooms are, as measured at fc157f76

### 2.1 Two services, and a call goes to exactly one

[[ROOMS-TS]] states the constraint plainly: "`rooms/keys/*` go to the member's **own VTA** … `rooms/{create,records,epoch,owner}/*` go to the room's **host**, which stores ciphertext it cannot read."

| Family | Served by | Authorized by |
|---|---|---|
| `rooms/{create,info}`, `rooms/records/{put,get,list,curate,prune,retention/set}`, `rooms/epoch/{mint,chain,commits,prune}`, `rooms/blobs/*`, `rooms/owner/{transfer,claim}` | the host (`room-host`, or a VTC) | the presentation's chain; `create` is the one exception, authorized by the signer being the named owner; a blob chunk rides the open upload or download its begin created |
| `rooms/keys/{key-package,welcome,commit,open,seal,file-key,list,label,chain,backfill,read,browse,present,act}` and `rooms/keys/profile/{read,write}` | the member's VTA | an invitation, the MLS group itself, or the `roomOpen` / `roomPresent` capability. `rooms/keys/act` completes a document **as the member's persona** (`roomPresent`; refused to a delegate), which is how the VTA signs a host call in the member's name |
| `rooms/owner/{invite,issue-membership,issue-authority,register,anchor,revoke}` and `rooms/owner/group/{create,add,remove,renew}` | the **owner's** VTA | the `credentialWrite` capability plus control of the room's signing key; the group tasks also present the principal's `admin` authority at the host |
| `vtc/rooms/{offers,community,memberships,storage,limits,usage}/*` | a VTC | the community that hosts the room (`docs/03-vtc/community-rooms.md`) |

Task URIs are `https://trusttasks.org/spec/rooms/…`, and `https://trusttasks.org/spec/vtc/rooms/…` for the community family. Versions differ by task, and several tasks serve more than one: `records/put` 0.1–0.3, `records/list` 0.1–0.3, `create` 0.1/0.2, `info` 0.1/0.2, `records/{prune,retention/set}` 0.1, `epoch/chain` 0.1/0.2, `epoch/prune` 0.1/0.2, `keys/act` 0.1–0.6 (`roomPresent`: the VTA signs as the persona), `keys/seal` 0.2, `keys/file-key` 0.1/0.2, `keys/label` 0.1, `keys/list` 0.2, `keys/browse` 0.2, `keys/backfill` 0.2, `keys/key-package` 0.2, `keys/profile/{read,write}` 0.1; `owner/group/create` 0.1, `owner/group/add` 0.1–0.3, `owner/group/remove` 0.1–0.3, `owner/group/renew` 0.1/0.2, `owner/revoke` 0.1, `owner/register` 0.2; `rooms/blobs/get` 0.1/0.2, `blobs/chunk` 0.1 and `blobs/upload/{begin,chunk,commit,abort}` 0.2 (0.1 beside it). The registry is [[ROOMS-GUIDE]] §12; it omits some of these (§2.3). Registrations are in `vta-service/src/trust_tasks/mod.rs`.

**The member surface Keyring needs** is `rooms/records/{put,get,list,curate}`, `rooms/info`, `rooms/keys/{seal,open,read,browse,list,file-key,chain,backfill,key-package,welcome,commit,act}`, `rooms/blobs/*`, and `vtc/rooms/{offers/{list,accept},memberships/list}`. `rooms/keys/read` and `browse` are the VTA-side composition of present → host call → verify → open (`vta-service/src/trust_tasks/room_group.rs`); the owner and `vtc/rooms/{community,storage,limits,usage}/*` surfaces are not the wallet's (§4).

### 2.2 The properties a Keyring client must preserve

These are the constraints, with their sources. Each is an acceptance criterion in §7.

1. **The wallet holds no room credential (VMC, VAC, VIC) and no MLS group key.** [[ROOMS-GUIDE]] §9: "The CLI **never holds a room credential or a group key**. Each command asks your VTA to mint a presentation for exactly the action it performs." The wallet follows the same rule for credentials and group keys. It does hold one thing the CLI does not: the persona's signing key, lent by the VTA for the session, in memory only (§3.3). It uses that key only to sign community-scoped tasks (`vtc/rooms/memberships/list`, and `vtc/rooms/offers/list` once built). Every room write and blob call still goes through `rooms/keys/act`, because the VTA inserts the persona's presentation there and the persona key alone does not authorise a room write.
2. **Presentations are bound to the presenter.** "The minted leaf grants to the DID the *transport* authenticated, never one named in the payload" (`vta-service/src/trust_tasks/room_keys.rs`). `present/0.2` removed the `audience` member; the recipient of the request document is the only host binding left (`vta-cli-common/src/commands/rooms.rs`, `present`).
3. **A document is minted and signed where the key is.** [[ROOMS-READTHROUGH]] §1: the offscreen document "**mints and signs** the envelope rather than counter-signing one composed in a page, because a wallet that signs a document composed elsewhere attests to fields it never checked."
4. **On sealed tiers, record keys are opaque**, and the version is bound into the ciphertext before the host assigns it. A client writing a sealed record must pass the version it intends and use `expectedVersion: 0` (create-only) or read first ([[ROOMS-GUIDE]] §9).
5. **Record bodies are untrusted input in both directions.** "A room is a writable channel into every member's agent context, and a phishing channel into every member's eyes. Render inert; fence recalled content as data, never instructions" ([[ROOMS-GUIDE]] §9).
6. **A member's VTA must apply every MLS commit.** A member who misses one is stuck at the last epoch and cannot open later records ([[ROOMS-GUIDE]] §6).

### 2.3 What is not built, and where the guide is stale

Stale against fc157f76's code (verified in Rust, not only prose):

- **The guide's §12 tables omit** `rooms/keys/read`, `rooms/owner/anchor` and `rooms/epoch/commits`, and also the `rooms/blobs/*`, `rooms/owner/group/*`, `rooms/owner/revoke` and `rooms/keys/profile/*` families and the `vtc/rooms/*` community family, all of which exist in code (§2.1). The guide describes the owner group tasks and `rooms/keys/act` in its own sections.
- **The guide's §10.1 says witnessed renewal anchoring "is not implemented"**, while `rooms/owner/anchor/0.1` has a handler (`vta-service/src/trust_tasks/room_owner.rs:263`, behind the `webvh` feature). Neither this plan nor the guide establishes that a host or a client checks an anchor, so the Encrypted Spaces subtask treats anchor verification as unbuilt.
- **The private-tier refusal on the wire** is `vti-rooms-dtg`'s "room `…` is private, and this host has no zero-knowledge profile configured …" (`vti-rooms-dtg/src/lib.rs:157`; `room-host/src/lib.rs:228,2888`); the guide's §11 string `a private room must not be served without a ZK profile` appears in code only as an `unreachable!` in `room-host/examples/data_room.rs`.

Not built at all, per the guide's §2 and the design notes:

- **A join request, and any self-service `rooms/join`.** [[ROOMS-JOINING]] §1: "Twenty-two room tasks and **not one is a join request**" (`data-rooms-joining.md:3`: "proposal for review, not a plan"). The proposal recommends not writing the spec until the demo shows what gets abused (§7 there). Admission is push-shaped, by the owner's VTA or by a community offer (below).
- **`private` rooms** are stored but refused at serve time; the zero-knowledge profile is unsettled.
- **Verified reads** ([[ROOMS-VERIFIED]]) and `rooms/keys/write` ([[ROOMS-READTHROUGH]] §6) are proposals / planned; neither appears in fc157f76's Rust sources. A sealed write is the two-call `rooms/keys/seal/0.2` then `rooms/records/put/0.2`.

Built, and relied on by this plan:

- **The owner's MLS half is served by the owner's VTA**: `rooms/owner/group/{create,add,remove,renew}` (`vta-service/src/trust_tasks/mod.rs:2950-2964`, `room_owner_group.rs`, `operations/room_groups.rs`), driven by `pnm rooms owner group-*`. `rooms/owner/group/add` advances the room at its host first and returns the Welcome to deliver.
- **`pnm rooms` covers the member surface and more**: `RoomCommands` is `List`, `Get`, `Put`, `Curate`, `Renew`, `Prune`, `Records`, `File`, `Keys`, `Profile`, `Owner`, `Offers`, `Memberships`, `Create` (`pnm-cli/src/cli.rs`). `pnm rooms put` seals on sealed rooms with `rooms/keys/seal/0.2` and `signAsPrincipal` (`vta-cli-common/src/commands/rooms.rs`, `put`).
- **A community-offered join exists**: `vtc/rooms/offers/list` 0.1–0.3 and `offers/accept/0.1` (`vtc-service/src/rooms/handlers.rs`; `docs/03-vtc/community-rooms.md`; `pnm rooms offers`). It is a supported path, but not self-service: the community extends the offer.
- **Cryptographic deletion and record retention have verbs** on both hosts: `rooms/epoch/prune/0.1`/`0.2` raise the epoch floor, and `rooms/records/{prune,retention/set}/0.1` apply a room's record retention ([[ROOMS-GUIDE]] §10.4–§10.5). Pruning severs the rungs, not the records.
- **Files have a task family**, `rooms/blobs/*` with `rooms/keys/file-key`, served by both hosts (§5; `docs/05-design-notes/data-rooms-files.md` §5, §12 P5/P6).

## 3. Where rooms sit in the Keyring architecture

### 3.1 The decision (proposed)

Rooms are **a PNM surface**: a module beside the wallet's VTA client, calling the member's VTA over the same Trust Task spine. They are not a new transport and not a new wallet core. The PNM/CNM subtask designs that client as a `vti-client` package (parent §5.2); on `main` it is `VtaClient` and its `vtaAgent` controller in `bifold/packages/core/src/modules/trust-tasks/module/` (§5a), and the rooms module goes wherever that client lives when it is packaged.

*Conditional on* an authenticated VTA session (the PNM/CNM subtask's P2). `VtaClient` already holds one for the community-vetting work (§5a); if it is reshaped into the subtask's package first, rooms follow it, and nothing but the pure-wasm read path in §3.3 can start without it.

### 3.2 Why, against the alternatives

- **Port the browser plugin's `packages/core/src/rooms/` module** ([[ROOMS-TS]]) instead of writing a new client. It already splits VTA and host calls, builds the create-only sealed write as a pair, and imports generated payload types from `@openvtc/trust-tasks/rooms/…`. It depends on `TaskParty`, `TrustTaskSender` and `buildTrustTask` from the plugin's `vta/` layer, which is the same layer the PNM/CNM subtask measures for portability (its §3.3). A first read at 43e2cc7 finds no extension or DOM API on that path: `vta/channel.ts` is type-only, and `vta/trust-task.ts` pulls `trust-tasks/{sign,verify}.ts`, `siop/self-issued.ts` and `didcomm/index.ts` (`@noble/curves`, `@openvtc/vti-didcomm-js`, `@openvtc/trust-tasks`). What React Native must supply is `globalThis.crypto.randomUUID` and `getRandomValues`, and `fetch` for DID resolution. R0 confirms this by running it under Hermes.
- **Do not widen the transport to pass a host recipient through** the wallet's signing surface. [[ROOMS-READTHROUGH]] §1 rejects this for the browser console, "trad[ing] a real property for a convenience". The accepted answer is `rooms/keys/read` and `rooms/keys/browse`: the member's own agent makes the host call in their name.
- **Do not compile `vti-rooms-wasm` into the app first.** It compiles the member half (group custody, sealing, opening, the epoch chain) so a browser can be a member with no VTA at all ([[ROOMS-DEMO]] §3.1). That bypasses the VTA oracle and puts a group key on the phone, contradicting §2.2 item 1. Revisit only for the no-VTA case in §6.
- **`vta-mobile-core` (UniFFI, `vta-mobile-core/` upstream) carries no rooms code.** Its sources contain no data-room task; the one `room` match is a test importing `vta_service::operations::room_issuance` (`tests/witness_e2e.rs:27`). A mobile core that speaks rooms does not exist to adopt, so the rooms client is TypeScript over `VtaClient` (§3.1), not a UniFFI binding.

### 3.3 The one place a wallet might hold keys

**The phone borrows the persona's keys, and the plan limits what it does with them.** The wallet-to-VTA design in `docs/plans/openvtc-rooms-plan/2026-10-25-al.md` (wallet PR #645, not yet on this branch) has the phone borrow the persona's signing and key-agreement keys from the VTA (`VtaClient.borrowKey`, over `keys/export-secret`, into the in-memory ephemeral KMS backend) and sign community tasks over DIDComm through the mediator, as it already does for join and leave. So the wallet holds the persona's signing key, lent by the VTA and held in memory only. It holds no room credential (VMC, VAC, VIC) and no MLS group key.

*Security trade-off, stated plainly.* `rooms/keys/act` exists so that a client holds none of the persona's keys (header of `vta-service/src/trust_tasks/room_act.rs` in VTI; contrast `VtaClient.borrowKey`). Lending the key to the phone gives that up for the persona's signature. The plan accepts the trade only for community-scoped reads and offers, where it removes a VTA round trip per poll, and deliberately does not use the lent key for room writes, sealing or blobs: those need the presentation the VTA inserts in `rooms/keys/act`, which the phone cannot mint. A design that signed room writes with the lent key alone is ruled out by that missing presentation (VTI `rooms/keys/act`, `room_act.rs`).

A wallet with no VTA, or one that cannot reach it, has no oracle and cannot lend a key. [[ROOMS-DEMO]] shows the alternative is a `did:key` minted in-process with the member half in wasm. Whether Keyring wants that mode is an open question (§9, Q2); the plan assumes **no** until answered.

## 4. Roles Keyring plays

| Role | In scope | What it needs |
|---|---|---|
| **Member** — read, write, curate, renew | Yes, phases R1–R3 | a VTA holding the member's VMC and VAC; `roomPresent` and `roomOpen` on the wallet's ACL entry |
| **Agent's principal** — grant and withdraw an agent's access | Yes, R4 | a consent surface over `rooms/keys/present` ACL grants; withdrawal is removing the ACL entry (the guide: "there is a place to say no") |
| **Joiner** — be admitted | Partly, R2 and the member sprint | the owner calls the joiner's VTA (push-shaped), or a community extends an offer (`vtc/rooms/offers/*`), which is pull-shaped: nothing is delivered and the wallet polls `offers/list` (`docs/03-vtc/community-rooms.md:285`), then shows the offer and consents |
| **Owner** — mint credentials, form groups, add members | **No**, until §9 Q4 | `rooms/owner/*` needs the room's signing key on a VTA; the MLS add step is `rooms/owner/group/add` on the owner's VTA |
| **Host operator** | No | `room-host` is a binary; see §8 for the lab |

## 5. Constraints from upstream that shape the work

- **Every room call is a signed Trust Task document, not a bare JSON body.** The guide's §11 lists "`missing field 'id'`" as the symptom. On a VTC, `recipient` must be the VTC's own DID.
- **File bodies travel as `rooms/blobs/*` chunks, not inside 64 KiB documents.** A record names a file by `blobs: [blobRef]`; the bytes move as chunk documents of 16–256 KiB, at most 4096 per blob (1 GiB), under limits the host sets (`data-rooms-files.md` §5.1: "The ceiling is `backup_transfer`'s: chunks of 16–256 KiB, at most 4096 of them, so 1 GiB per blob"; `vti-rooms/src/files.rs`). A chunk document is about 350 KiB once encoded, so a host raises the document limit for the holder of an open transfer only.
- **A VTC caps Trust Task bodies at 64 KiB** ([[ROOMS-GUIDE]] §5.2; per type, "64 KiB unless its specification needs more", `vtc-service/src/routes/mod.rs`); `room-host` imposes only axum's 2 MB default ([[ROOMS-GUIDE]] §8.1). Plan record sizes for the smaller.
- **`room-host` verifies a request's proof over the document as received** (VTI-45, `room-host/src/lib.rs`, `presenter`), so a client's signed bytes are what is judged; nothing in the client may re-serialise a document after signing it.
- **A browser or wallet client needs the host to allow its origin** (`room-host --allow-origin`), explicit and without a wildcard. A native app is not a browser, so this applies to any WebView path only.
- **Admission to a sealed room is served.** The owner's VTA admits a member with `rooms/owner/group/add`, and in a community the VTC does the add when the member accepts an offer (`vtc/rooms/offers/accept/0.1`; `docs/03-vtc/community-rooms.md`). The member side is `rooms/keys/key-package` then `rooms/keys/welcome`, and a Welcome never travels through the room host. Test sealed-room joins against a lab owner VTA or a lab VTC, not a second phone.
- **`private` rooms do not serve.** Keyring should refuse to create or join one and say why. Match the host's refusal by its stable part, "zero-knowledge profile" (`vti-rooms-dtg/src/lib.rs:157`; `room-host/src/lib.rs:2888`), not by the guide's §11 string, which the host does not send (§2.3).
- **Authority has no revocation, only expiry.** `validUntil` is required on a VAC because "nothing withdraws [a chain root] by waiting" ([[ROOMS-GUIDE]] §5.3). The wallet must show expiry prominently and warn on long windows.

## 5a. Readiness and blockers

Two sides, assessed separately. The rooms side is measured at fc157f76 (§2). The Keyring side is measured at `origin/main` 0da7eead, reading `bifold` at the submodule commit it pins (d86785b4).

### Rooms side — usable now, with holes

| Area | Readiness |
|---|---|
| `open` and `attributed` rooms: create, records, curate, epoch mint, transfer, claim | **Serve** ([[ROOMS-GUIDE]] §2) |
| Member VTA custody and the agent oracle (`rooms/keys/*`) | **Work**, including `read`, `browse` and `act` (the VTA signs as the persona) |
| Sealed-room admission | **Served**: the owner's VTA (`rooms/owner/group/add`), or a VTC offer where the VTC does the add |
| Community-offered join | **Served**: `vtc/rooms/offers/{list,accept}`, `vtc/rooms/memberships/list` |
| Files | **Served** on both hosts: `rooms/blobs/*`, `rooms/keys/file-key`, with a pluggable blob store behind them (`data-rooms-files.md` §12 P5/P6) |
| Record retention and pruning | **Served**: `rooms/records/{prune,retention/set}/0.1`, `rooms/create/0.2` |
| Join without an inbox or an offer | **Not built**; a proposal that recommends waiting for the demo ([[ROOMS-JOINING]] §7) |
| `private` tier | **Refused at serve time** (no ZK profile) |
| Verified reads, `rooms/keys/write` | **Proposals / planned** |
| Cryptographic deletion | **Served** as `rooms/epoch/prune/0.1`/`0.2`; the guide's §2 and §10.4 describe it |
| Docs | **Drifting**: the guide lags the code in places (§2.3) |
| Hosting | **No Farm story**: `room-host` is a deployed binary, so every claim is local-lab only (§8) |

### Keyring side — a VTA client exists; no room code

Paths below are in `bifold/packages/core/src/modules/trust-tasks/module/` unless given in full.

- **A VTA client exists, inside `@bifold/core` rather than as a package.** `VtaClient.ts` ("the phone as the manager of a personal VTA") and its controller `vtaAgent.ts` speak `auth/whoami`, `acl/{list,grant,update,revoke}`, `vta/contexts/*`, `vta/webvh/dids/*`, `keys/export-secret`, `task-consent/*`, `policy/*` and `vault/*` to the user's own VTA over the DIDComm v2 mediator transport (`VtiMediatorTransport.ts`), choosing a carriage through `tspCapability.ts`. There is no `vti-client` or `pnm-core` package and no `@openvtc/pnm-core` dependency in any `package.json`; the `@openvtc/pnm-core` 0.4.0 entry in `scripts/openvtc/PINS.json` is an upstream-watch tripwire under `npm`, not a dependency. [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md), which designs the packaged client, still reads "Draft for discussion. Not a commitment to implement."
- **No room code exists.** A search of `app/` and `scripts/` at `origin/main`, and of `bifold/packages` at d86785b4, for `roomPresent`, `room-present`, `RoomPresent`, `rooms/keys`, `rooms/records` and `trusttasks.org/spec/rooms` finds nothing.
- **A wallet-to-VTA attachment exists.** The phone links to its agent by QR enrolment (`vtaEnrolment.ts`: a temporary manager key, an enrolment code, an admin grant, then a rotation onto a long-lived key), tracked by one link state machine (`vtaLinkMachine.ts`), with the "My agent" screens in `bifold/packages/core/src/navigators/MyAgentStack.tsx` (`VtaLink`, `VtaAgentHome`, …). The design is [`keyring-on-the-vta-farm.md`](./keyring-on-the-vta-farm.md) (status "Proposal for review") and its [`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) §2.4 B ("every Keyring user has a VTA of their own"; status "In execution"). What it does not yet do for rooms: grant an ACL entry narrowed to `room-present` (R4), and hold room credentials where the oracle finds them (below).
- **Carriage.** `TspCarriage.ts` is wallet-to-wallet only (TSP inside DIDComm v1) and does not reach a VTA; the VTA leg is `VtiMediatorTransport` with TSP Rev 3 as a build-time carriage choice (`vtiTsp.ts`, `tspCapability.ts`). Rooms do not need TSP to the host.
- **`did:webvh` resolution is registered.** `RetryingWebVhDidResolver` (`bifold/packages/core/src/utils/RetryingWebVhDidResolver.ts`, over Credo's `WebVhDidResolver`) is in the app's agent (`app/src/utils/bc-agent-modules.ts`). Resolving a **room** DID from the wallet is **(unverified at fc157f76)**: no test exercises one.
- **DTG credentials.** The wallet keeps a community's `InvitationCredential` and `MembershipCredential` verbatim (`VtiCommunityStore.ts`), reads role `AuthorityCredential`s (`bifold/packages/trust-tasks/src/vetting/roleCard.ts`), and ships the DTG v1 registry context with `issuerScope` and `authority` (`bifold/packages/vrc-contexts/src/dtgRegistryContextV1.ts`). Whether it accepts a VIC, VMC or VAC **as a room issues them** (`issuerScope: public`, `authority.scope` = the room DID; a `directed` attenuated leaf) is **(unverified at fc157f76)**.
- **The VTA credential vault has a wallet-side equivalent** for community cards: `vtiCardVault.ts` pushes membership, role and vetter-grant cards to the VTA by `vault/credentials/receive/0.1`. Whether room credentials should reach the VTA that way, or only through the push-shaped admission in §4, is part of R1's credential-receipt step.

### Blockers, ordered by what they gate

| # | Blocker | Side | Gates | Kind |
|---|---|---|---|---|
| B1 | Whether Keyring wants rooms: **resolved.** Keyring wants at least the member sprint's functionality (§9 Q1, answered yes by the owner, Brendan, 2026-10-26) | Keyring | nothing now | Resolved; wider scope past the sprint is still a product call |
| B2 | The wallet's VTA session (`VtaClient`) carries no room tasks, and its ACL grants are not yet narrowed to `room-present` | Keyring | R1 onward (session), R4 (grant) | Built for community vetting; rooms work is additive |
| B3 | Where the rooms module lives: the PNM/CNM subtask's `vti-client` package does not exist, and `VtaClient` sits inside `@bifold/core` | Keyring | R1 onward | Decided: the rooms module lives in `@bifold/core` beside `VtaClient` (Brendan, 2026-10-26); a later move into a packaged `vti-client` is the PNM/CNM subtask's call |
| B4 | Resolving a room's `did:webvh` and accepting its VIC, VMC and VAC (`issuerScope`) in the wallet. Room-side issuance is `issuerScope: public` (`vta-service/src/trust_tasks/room_owner.rs:113,222`); the wallet side is not checked | Keyring | R1 onward, if rooms are `did:webvh` | Resolver registered; room credentials still unverified on the Keyring side |
| B5 | Owner's MLS add step: **resolved.** `rooms/owner/group/{create,add,remove,renew}` are served by the owner's VTA (`vta-service/src/trust_tasks/mod.rs:2950-2964`) and `pnm rooms owner group-*` drive them | Rooms | nothing now | Resolved |
| B6 | Admission policy undefined ([[ROOMS-JOINING]] still a proposal at fc157f76) | Rooms | §6 item 1 | Waiting on upstream's demo |
| B7 | Sealed writes: **resolved for `pnm`.** A sealed write is `rooms/keys/seal/0.2` (`signAsPrincipal`) then `rooms/records/put/0.2`, which `pnm rooms put` does (`vta-cli-common/src/commands/rooms.rs`). `rooms/keys/write` remains a proposal | Rooms | R3 sealed writes by a single call only | Resolved for the two-call path; single call is a proposal |
| B8 | `private` tier refused | Rooms | any `private` use | Waiting on the DTG working group |
| B9 | Guide drift (§2.3) | Rooms | trust in this plan's citations | Cheap; the drift is listed in §2.3 and the design note is read at fc157f76 |

**Nothing upstream blocks the member sprint.** B1, B5 and (for the two-call path) B7 are resolved. What gates the Keyring side is B3, a placement decision shared with the PNM/CNM subtask, and B2 and B4, which are additive work on a VTA session that already exists. B6 and B8 gate only §6 item 1 and `private` use, and neither is on the sprint's path.

## 6. Where Keyring could add something upstream does not have

Flagged as ideas to test, not commitments.

1. **Admission evidence.** [[ROOMS-JOINING]] §5 says plainly that "what makes an applicant admissible" is policy and "the design has no answer in it." Keyring's witnessed, hardware-attested VRCs, and the locality plan's co-presence evidence, are credentials a room could require before the owner issues a VMC. This would be an input to upstream's open question, so propose it **after** the demo run [[ROOMS-JOINING]] §7 asks for, not before.
2. **A join channel for a holder with only an agent channel.** [[ROOMS-JOINING]] §2 argues a join should go to the room's mediator (the room DID's `MEDIATOR_DID`), not the host and not the owner. A wallet is the case it describes: "a phone app … holds a channel to its own agent and to nothing else." If upstream specifies `rooms/join/request`, Keyring should be a first implementer.
3. **Peer rooms through a VRC.** The guide's T4 is "T1 with the VRC as the door." A Keyring VRC between two contacts could be what opens a room on one of their hosts. This needs a design with the VRC/witness recast, not just a room client.
4. **Agent consent for room access** as part of the approver surface the PNM/CNM subtask already designs (its P1).

## 7. Phases

Each phase carries acceptance criteria. "Verified" means the named check passes against the local lab stack (§8), not only a unit test.

[`rooms_member_sprint_subtask.md`](./openvtc-rooms-plan/rooms_member_sprint_subtask.md) is the first chunk of work. It joins by community offer (R2's admission, member side), lists and downloads (R1, with files), and posts (R3), on `open` and `attributed` rooms, and its S0 spikes cover R0's port, credential and lab measurements. R0–R3 below are its parent scope; where the two differ, the subtask governs the first chunk. R4, R5 and everything else are later.
### R0 — Measurement (no code in the app)

Ground every assumption in this plan.

- Run `cargo run -p room-host --example data_room` at fc157f76 and capture its four acts as the reference trace.
- Stand up the local VTA from `scripts/openvtc/local-vti-stack` and a `room-host` beside it (the stack does not start one; §8); create an `open` and an `attributed` room by `pnm rooms create`.
- Run [[ROOMS-TS]]'s `rooms/` module and its `vta/` imports under Hermes, confirming the first read in §3.2 that nothing on the path is browser-only.
- Check that the wallet's DTG handling accepts a room-issued VIC, VMC and VAC (`issuerScope` `public`, and a `directed` leaf), and that the wallet resolves a room's `did:webvh` (B4).

**Done when:** a dated companion records the reference trace, the Hermes result and the credential check, and §9 Q1 and Q3 are answered or re-scoped.

### R1 — Read-only member (open and attributed rooms)

Wallet lists rooms it holds credentials for, browses a room (`rooms/keys/browse`) and reads a record (`rooms/keys/read`).

- Credential receipt: a VMC and VAC arrive and are held where the VTA's presentation oracle can find them (the oracle finds them **by issuer**, and refuses zero or two of one kind, [[ROOMS-GUIDE]] §5.3).
- Rendering: every body is shown inert; no markdown link, image or HTML is followed (§2.2 item 5).

**Done when:** (a) on the lab, the wallet lists, browses and reads a record in an `open` and an `attributed` room; (b) a wallet whose VAC lacks `read` is refused by its **own VTA**, not the host; (c) a record body containing a link, an HTML tag and a prompt-injection string renders as text and triggers nothing; (d) the wallet never holds a presentation after the call returns.

### R2 — Invitations and admission (member side)

The wallet receives a VIC, shows it for consent, and drives `rooms/keys/key-package` and `rooms/keys/welcome`.

- Show who is inviting, which room, and `validUntil`, before any key package is minted. Minting retains a private key for 7 days, which is why the VTA requires an invitation.
- Apply every commit (`rooms/keys/commit`), and fetch missed ones with `rooms/epoch/commits`.

**Done when:** (a) the owner's VTA (`rooms/owner/group/add`) or a lab community offer (`vtc/rooms/offers/accept`) admits the wallet to a sealed room and the wallet reads a record from before it joined, via `rooms/epoch/chain` and `rooms/keys/chain`; (b) a second invitation use is refused with `already been used`; (c) a deliberately withheld commit produces the guide's "a commit has not been delivered" message in the UI, not "corrupt".

**Depends on:** B2 and B4 (the wallet's session and credential acceptance) and a lab owner VTA or lab VTC (§8). The owner side is served upstream (§2.3); whether Keyring is itself an owner client is §9 Q4, and R2 does not need it.

### R3 — Write and curate

The wallet writes to an `open` room by `rooms/records/put` and to a sealed room by `rooms/keys/seal/0.2` (`signAsPrincipal`) then `rooms/records/put/0.2`, and curates by `rooms/records/curate`.

- Create-only writes (`expectedVersion: 0`) for sealed rooms; read-then-rewrite otherwise.
- Surface `expectedVersion` conflicts, which return the current version.
- Curation is its own action (`curate`), not implied by `write`.

**Done when:** (a) a sealed write round-trips from the wallet to a second member who can open it; (b) a host that relocates the record fails authentication (the AEAD binds `roomId | key | version | epoch`); (c) a `write`-only member is refused on `curate`; (d) `retracted` renders as a tombstone and incremental sync converges.

### R4 — Agent access

The wallet is where a person grants a room agent `roomPresent` (and optionally `roomOpen`), sees what it holds, and withdraws it.

- The grant is a role-ceilinged ACL entry narrowed with `--capabilities room-present` at creation (the guide says to prefer creation-time narrowing, since it leaves no window where the entry is wider). On the wire the capability rides the ACL entry as `"org.openvtc.capabilities": ["room-present"]` (`vta-sdk/src/protocols/acl_management/update.rs`); `VtaClient` already sends `acl/grant` and `acl/update` (§5a), so this phase adds the narrowing, not the call.
- The consent surface follows the PNM/CNM subtask's P1 rules; room access is never granted by default.

**Done when:** (a) an agent obtains a 4-hour, one-action presentation and reads; (b) removing the ACL entry stops further presentations; (c) a presentation captured and replayed from a different signer is refused.

### R5 — Lifecycle and owner conveniences (conditional)

*Conditional on §9 Q4* (whether Keyring is an owner client). If yes: renew (`rooms/epoch/mint`, or `rooms/owner/group/renew` on a sealed room), the lifecycle state (Live / Lapsed / Dormant / Reclaimable, which is computed not stored), succession nominations, and `rooms/owner/anchor`.

**Done when:** defined after Q4. Do not start without it.

## 8. Test and lab

- The local lab is `scripts/openvtc/local-vti-stack`. `room-host` is a separate binary from the VTA ("not part of the VTA, on purpose", [[ROOMS-GUIDE]] §8.1), so the lab must add it: at `origin/main` no script under `scripts/openvtc/local-vti-stack/` mentions a room or `room-host`.
- Per the `vti-lab-and-field` skill, a claim the local lab supports and a claim the Farm supports are different; rooms have no Farm story today, so every R-phase claim is **local-lab only** unless a Farm host is found.
- `room-host` flags the lab needs: `--data-dir`, `--listen`, and `--resolve-dids` for `did:webvh` rooms (off by default; it lets unauthenticated requests trigger a fetch, a decision to make deliberately). For a mirror test, `--mirror-config` and `--mirror-interval-secs`.
- File limits the lab may need: `--max-file-bytes` (the largest single file, at most 1 GiB), `--room-max-file-bytes` and `--member-max-file-bytes`, beside `--blob-dir` (`room-host/src/main.rs:146-161`). A VTC sets the same limits in `[rooms.files]` and `vtc/rooms/limits/set`.
- Add an e2e rung only after R1 passes by hand; follow `e2e/README.md`.

## 9. Open questions and what they block

| # | Question | Kind | Blocks |
|---|---|---|---|
| Q1 | Does Keyring want rooms at all? **Answered yes** by the owner, Brendan, 2026-10-26, for at least the member sprint's functionality (join by community offer, list, download, post). Which further product moments (group activities, agent memory, peer spaces) follow is not decided | Resolved for the sprint; product owner for the rest | nothing for R0–R3 on `open` and `attributed` rooms; R4 onward |
| Q2 | Does the wallet ever hold a group key (a no-VTA, in-process wasm mode), or always use the VTA oracle? | Not decided | R1's scope; §3.3 |
| Q3 | Can `packages/core/src/rooms/` be ported to React Native unchanged? | Measurable; R0 answers it | R1 effort |
| Q4 | Is Keyring an **owner** client (issuing credentials, forming groups)? The MLS add step is a task on the owner's VTA (`rooms/owner/group/add`), so an owner client would be a wallet front end to it, not new upstream work | Not decided | R5 |
| Q5 | What does a room require of an applicant? Upstream defers this to the demo ([[ROOMS-JOINING]] §5, §7) | Waiting on upstream's demo | §6 item 1 |
| Q6 | Where does a wallet reach a host from: through its VTA only (`keys/read`, `browse`), or directly for any call? | Leaning VTA-only per [[ROOMS-READTHROUGH]] §1 | R1 design |
| Q7 | Should an agent's memory live in a room? [[ROOMS-VERIFIED]] and [[ROOMS-READTHROUGH]] make the agent "the room's memory" | Product question | R4 |

## 10. Before this leaves draft

The plan is filed as its own `docs/plans/openvtc-rooms-plan.md` with a companion folder, and has a row in `docs/plans/README.md`. What remains:

1. **The parent plan does not name it.** [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §5.2 is a three-package diagram, not a list, and nothing in that plan mentions rooms. §9 Q1 is answered, so the pointer can be added: one sentence under the §5.2 diagram saying rooms are a consumer of the operation layer and pointing here, since the rooms module is placed by B3 and is not a fourth package.
2. **Placement of the rooms module (B3)** is agreed with the PNM/CNM subtask: inside `@bifold/core` beside `VtaClient`, or in the packaged client that subtask designs.
3. **R0's companion.** R0's findings go in a dated companion in `openvtc-rooms-plan/`, per `docs/plans/CLAUDE.md`, and §2.3 and §5a are re-measured against whatever pin is current then.
4. **The member sprint's spikes report.** Its S0 results (port feasibility, credential acceptance, lab host, text ceiling) land in a dated companion; until they do, this stays a draft.

## 11. Sources

- `verifiable-trust-infrastructure` @ fc157f76 (`main`, 2026-10-26; `/srv/dev/code/seas/verifiable-trust-infrastructure`) — `docs/02-vta/data-rooms.md`; `docs/03-vtc/community-rooms.md`; `docs/05-design-notes/data-rooms*.md`; `room-host/src/{main,lib}.rs`, `room-host/examples/data_room.rs`; `vta-service/src/trust_tasks/{mod,room_keys,room_group,room_owner,room_owner_group,room_act}.rs`, `vta-service/src/operations/{room_oracle,room_groups}.rs`; `vta-cli-common/src/commands/rooms.rs`; `pnm-cli/src/cli.rs` (`RoomCommands`: `List`, `Get`, `Put`, `Curate`, `Renew`, `Prune`, `Records`, `File`, `Keys`, `Profile`, `Owner`, `Offers`, `Memberships`, `Create`); `vtc-service/src/rooms/*` (`handlers.rs`, `storage_configs.rs`, …), `vtc-service/src/routes/mod.rs`; `vtc-client/src/rooms/*`; `vti-rooms/src/{wire,mls,storage,blob_tasks,files,blobs}.rs`; `vta-mobile-core/`; `vti-rooms-dtg/src/lib.rs`; `vti-rooms-wasm/src/identity.rs`; `vta-sdk/src/protocols/acl_management/update.rs`. The earlier baseline's delta is in [`2026-10-13-bam.md`](./openvtc-rooms-plan/2026-10-13-bam.md); the move to fc157f76 is in [`2026-10-26-bam-rebaseline.md`](./openvtc-rooms-plan/2026-10-26-bam-rebaseline.md).
- `external/verifiable-trust-infrastructure-v047` @ 439a0333 — contains the same four room crates; not a rooms baseline.
- `external/vta-browser-plugin` @ 43e2cc7 — `packages/core/src/rooms/index.ts` (821 lines); `packages/core/src/vta/{channel,trust-task}.ts`; `packages/extension/src/manager/room-host-setup.ts`.
- [RFC 9420 — Messaging Layer Security](https://www.rfc-editor.org/rfc/rfc9420).
- Keyring @ `origin/main` 0da7eead: `docs/plans/openvtc-integration-plan.md`, `…/pnm_cnm_subtask.md`, `docs/plans/keyring-on-the-vta-farm.md`, `…/community_vetting_subtask.md`, `docs/plans/locality-plan.md`, `docs/plans/CLAUDE.md`, `scripts/openvtc/PINS.json`, `scripts/openvtc/local-vti-stack/`, `app/src/utils/bc-agent-modules.ts`.
- `bifold` @ d86785b4 (the submodule commit `origin/main` pins) — `packages/core/src/modules/trust-tasks/module/{VtaClient,vtaAgent,vtaEnrolment,vtaLinkMachine,VtiMediatorTransport,TspCarriage,vtiTsp,tspCapability,VtiCommunityStore,vtiCardVault}.ts`; `packages/core/src/navigators/MyAgentStack.tsx`; `packages/core/src/utils/RetryingWebVhDidResolver.ts`; `packages/trust-tasks/src/vetting/roleCard.ts`; `packages/vrc-contexts/src/dtgRegistryContextV1.ts`.
