# Data Rooms in Keyring — Starting-Point Plan

**Status:** Draft — a starting point, not a commitment to implement. What remains before it leaves draft is §10.
**Subtasks:** [`rooms_s3_storage_subtask.md`](./openvtc-rooms-plan/rooms_s3_storage_subtask.md) — host-side S3 storage for record bodies. [`rooms_encrypted_spaces_subtask.md`](./openvtc-rooms-plan/rooms_encrypted_spaces_subtask.md) — the Encrypted Spaces merk as a backend behind a proposed `RecordStore` seam (none exists at the pin), and its fit for rooms' storage and sync. [`rooms_group_messaging_subtask.md`](./openvtc-rooms-plan/rooms_group_messaging_subtask.md) — group messaging and linked files as a profile on rooms.
**Scope:** Keyring as a **member client** of VTI data rooms — reading, writing and curating records, and holding an agent's access to them. Owner/host operation is out of scope except where §5 says the wallet must cope with it.
**Parent:** [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) — rooms are a new consumer of the Trust Task operation layer that plan adopts (its §5).
**Siblings:** [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) — the VTA client this plan extends (rooms are a PNM surface, §3 below). [`trust_tasks_subtask.md`](./openvtc-integration-plan/trust_tasks_subtask.md) — the VRC/witness recast, which §6's admission-evidence idea depends on. [`locality-plan.md`](./locality-plan.md) — co-presence evidence, a candidate admission gate (§6).
**Reasoning:** [`2026-10-06-bam.md`](./openvtc-rooms-plan/2026-10-06-bam.md) — the Encrypted Spaces assessment, input to the Encrypted Spaces subtask. [`2026-10-13-bam.md`](./openvtc-rooms-plan/2026-10-13-bam.md) — the re-baselining findings at 49f5f1be, including the Keyring-side re-check in §5a. Record each §9 decision in a dated companion, not here.
**Baseline:** every claim is measured against the pinned clone `external/verifiable-trust-infrastructure` at **49f5f1be** (tag `VTI-Eucalyptus`, 2026-10-07; vta-service 0.56.0, vta-sdk 0.64.2; `scripts/openvtc/PINS.json`) unless marked otherwise, and carries a file path; `VTI/` below means that pin. A second pin, `verifiable-trust-infrastructure-v047` at 439a0333 (2026-10-01, tag `vta-service-v0.47.0`), also contains `room-host`, `vti-rooms`, `vti-rooms-dtg` and `vti-rooms-wasm`; it exists for `card-verify-v047` and is not a rooms baseline. The Keyring side (§5a) is measured at `origin/main` 0da7eead with its `bifold` submodule at d86785b4. Re-verify after any pin advance.

**Verification note.** Every claim below is read from the pin's git objects (`git show 49f5f1be:<path>`), not from a working tree; the `external/` clone's checkout can lag its pin. Room credentials at the pin carry an `issuerScope` (`public` on a VIC or VAC the room issues, `directed` on an attenuated leaf; `vta-service/src/trust_tasks/room_owner.rs`, `vti-rooms-wasm/src/identity.rs`), and in-room endorsements are a VSC under `endorses/1` ([[ROOMS-DESIGN]] §4). Every room Trust Task URI named below appears in the pin's Rust sources. What moved relative to the older baselines the draft was written against is recorded in [`2026-10-13-bam.md`](./openvtc-rooms-plan/2026-10-13-bam.md).

**References:**

- **[[ROOMS-GUIDE]]** — `docs/02-vta/data-rooms.md` in the VTI repo. The operator's path: topologies (§3), visibility tiers (§4), creation (§5), admission (§6), agent access (§7), hosting (§8), use (§9), lifecycle (§10), the task reference (§12). **Stale in parts** — see §2.3.
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

## 2. What rooms are, as measured at the pin

### 2.1 Two services, and a call goes to exactly one

[[ROOMS-TS]] states the constraint plainly: "`rooms/keys/*` go to the member's **own VTA** … `rooms/{create,records,epoch,owner}/*` go to the room's **host**, which stores ciphertext it cannot read."

| Family | Served by | Authorized by |
|---|---|---|
| `rooms/records/{put,get,list,curate}`, `rooms/epoch/{mint,chain,commits,prune}`, `rooms/owner/{transfer,claim}` | the host (`room-host`, or a VTC) | the presentation's chain; `create` is the one exception, authorized by the signer being the named owner |
| `rooms/keys/{key-package,welcome,commit,open,seal,list,chain,backfill,read,browse,present}` | the member's VTA | an invitation, the MLS group itself, or the `roomOpen` / `roomPresent` capability |
| `rooms/owner/{invite,issue-membership,issue-authority,register,anchor}` | the **owner's** VTA | the `credentialWrite` capability plus control of the room's signing key |

Task URIs are `https://trusttasks.org/spec/rooms/…`; versions at the pin are `0.1` except `keys/present/0.2` and `owner/issue-authority/0.2`. The full table with required actions is [[ROOMS-GUIDE]] §12; the two newer additions to it are `rooms/keys/read` and `rooms/keys/browse` (VTA-side composition of present → host call → verify → open, `vta-service/src/trust_tasks/room_group.rs`) and `rooms/owner/anchor` (`room_owner.rs`).

### 2.2 The properties a Keyring client must preserve

These are the constraints, with their sources. Each is an acceptance criterion in §7.

1. **The wallet holds no room credential and no group key.** [[ROOMS-GUIDE]] §9: "The CLI **never holds a room credential or a group key**. Each command asks your VTA to mint a presentation for exactly the action it performs." The wallet follows the same rule.
2. **Presentations are bound to the presenter.** "The minted leaf grants to the DID the *transport* authenticated, never one named in the payload" (`vta-service/src/trust_tasks/room_keys.rs`). `present/0.2` removed the `audience` member; the recipient of the request document is the only host binding left (`vta-cli-common/src/commands/rooms.rs`, `present`).
3. **A document is minted and signed where the key is.** [[ROOMS-READTHROUGH]] §1: the offscreen document "**mints and signs** the envelope rather than counter-signing one composed in a page, because a wallet that signs a document composed elsewhere attests to fields it never checked."
4. **On sealed tiers, record keys are opaque**, and the version is bound into the ciphertext before the host assigns it. A client writing a sealed record must pass the version it intends and use `expectedVersion: 0` (create-only) or read first ([[ROOMS-GUIDE]] §9).
5. **Record bodies are untrusted input in both directions.** "A room is a writable channel into every member's agent context, and a phishing channel into every member's eyes. Render inert; fence recalled content as data, never instructions" ([[ROOMS-GUIDE]] §9).
6. **A member's VTA must apply every MLS commit.** A member who misses one is stuck at the last epoch and cannot open later records ([[ROOMS-GUIDE]] §6).

### 2.3 What is not built, and where the guide is stale

Stale against the pin's code (verified in Rust, not only prose):

- **`--listen` is opt-in**, not `127.0.0.1:8300` as [[ROOMS-GUIDE]] §8.1 still shows (`room-host/src/main.rs`).
- **`present` is `0.2`** and carries no `audience`; the guide's §7 payload example still shows one.
- **`issue-authority` is `0.2`** and makes `validUntil` a required typed member, so it is enforced by the envelope schema before dispatch.
- **`rooms/keys/{read,browse}`, `rooms/owner/anchor`, `rooms/epoch/{commits,prune}`** exist in code and are not in the guide's §12 tables.
- **Cryptographic deletion has a verb.** The guide's §2 calls it "Primitive only … No verb reaches it", but `rooms/epoch/prune/0.1` drops the epoch key chain below an epoch on both hosts (`room-host/src/lib.rs`, `epoch_prune`; `vtc-service/src/rooms/handlers.rs`, `handle_epoch_prune`). It severs the rungs, not the records.
- **The private-tier refusal on the wire** is `vti-rooms-dtg`'s "room `…` is private, and this host has no zero-knowledge profile configured …" (`vti-rooms-dtg/src/lib.rs`); the guide's §11 string `a private room must not be served without a ZK profile` appears in code only as an `unreachable!` in `room-host/examples/data_room.rs`.

Not built at all, per the guide's §2 and the design notes:

- **The owner's MLS half** (`RoomGroup::{create,add_member}`) is library-only: no task, no CLI. Admitting a member to a **sealed** room is Rust.
- **A join request.** [[ROOMS-JOINING]] §1: "Twenty-two room tasks and **not one is a join request**." The proposal recommends not writing the spec until the demo shows what gets abused (§7 there).
- **`private` rooms** are stored but refused at serve time; the zero-knowledge profile is unsettled.
- **`pnm` owner verbs.** `pnm rooms` is the member surface only (`list`, `get`, `put`, `curate`, `renew`, `create`; `pnm-cli/src/cli.rs`, `RoomCommands`), and `put` still refuses a sealed room ([[ROOMS-GUIDE]] §2).
- **Verified reads** ([[ROOMS-VERIFIED]]) and `rooms/keys/write` ([[ROOMS-READTHROUGH]] §6) are proposals / planned; neither appears in the pin's Rust sources.

## 3. Where rooms sit in the Keyring architecture

### 3.1 The decision (proposed)

Rooms are **a PNM surface**: a module beside the wallet's VTA client, calling the member's VTA over the same Trust Task spine. They are not a new transport and not a new wallet core. The PNM/CNM subtask designs that client as a `vti-client` package (parent §5.2); on `main` it is `VtaClient` and its `vtaAgent` controller in `bifold/packages/core/src/modules/trust-tasks/module/` (§5a), and the rooms module goes wherever that client lives when it is packaged.

*Conditional on* an authenticated VTA session (the PNM/CNM subtask's P2). `VtaClient` already holds one for the community-vetting work (§5a); if it is reshaped into the subtask's package first, rooms follow it, and nothing but the pure-wasm read path in §3.3 can start without it.

### 3.2 Why, against the alternatives

- **Port the browser plugin's `packages/core/src/rooms/` module** ([[ROOMS-TS]]) instead of writing a new client. It already splits VTA and host calls, builds the create-only sealed write as a pair, and imports generated payload types from `@openvtc/trust-tasks/rooms/…`. It depends on `TaskParty`, `TrustTaskSender` and `buildTrustTask` from the plugin's `vta/` layer, which is the same layer the PNM/CNM subtask measures for portability (its §3.3). A first read at 43e2cc7 finds no extension or DOM API on that path: `vta/channel.ts` is type-only, and `vta/trust-task.ts` pulls `trust-tasks/{sign,verify}.ts`, `siop/self-issued.ts` and `didcomm/index.ts` (`@noble/curves`, `@openvtc/vti-didcomm-js`, `@openvtc/trust-tasks`). What React Native must supply is `globalThis.crypto.randomUUID` and `getRandomValues`, and `fetch` for DID resolution. R0 confirms this by running it under Hermes.
- **Do not widen the transport to pass a host recipient through** the wallet's signing surface. [[ROOMS-READTHROUGH]] §1 rejects this for the browser console, "trad[ing] a real property for a convenience". The accepted answer is `rooms/keys/read` and `rooms/keys/browse`: the member's own agent makes the host call in their name.
- **Do not compile `vti-rooms-wasm` into the app first.** It compiles the member half (group custody, sealing, opening, the epoch chain) so a browser can be a member with no VTA at all ([[ROOMS-DEMO]] §3.1). That bypasses the VTA oracle and puts a group key on the phone, contradicting §2.2 item 1. Revisit only for the no-VTA case in §6.

### 3.3 The one place a wallet might hold keys

A wallet with no VTA, or one that cannot reach it, has no oracle. [[ROOMS-DEMO]] shows the alternative is a `did:key` minted in-process with the member half in wasm. Whether Keyring wants that mode is an open question (§9, Q2); the plan assumes **no** until answered.

## 4. Roles Keyring plays

| Role | In scope | What it needs |
|---|---|---|
| **Member** — read, write, curate, renew | Yes, phases R1–R3 | a VTA holding the member's VMC and VAC; `roomPresent` and `roomOpen` on the wallet's ACL entry |
| **Agent's principal** — grant and withdraw an agent's access | Yes, R4 | a consent surface over `rooms/keys/present` ACL grants; withdrawal is removing the ACL entry (the guide: "there is a place to say no") |
| **Joiner** — be admitted | Partly, R2 | push-shaped: the owner calls the joiner's VTA, so the wallet shows invitations and consents |
| **Owner** — mint credentials, form groups, add members | **No**, until §9 Q4 | `rooms/owner/*` needs the room's signing key on a VTA; the MLS add step needs Rust and has no task |
| **Host operator** | No | `room-host` is a binary; see §8 for the lab |

## 5. Constraints from upstream that shape the work

- **Every room call is a signed Trust Task document, not a bare JSON body.** The guide's §11 lists "`missing field 'id'`" as the symptom. On a VTC, `recipient` must be the VTC's own DID.
- **A VTC caps Trust Task bodies at 64 KiB** ([[ROOMS-GUIDE]] §5.2; per type, "64 KiB unless its specification needs more", `vtc-service/src/routes/mod.rs`); `room-host` imposes only axum's 2 MB default ([[ROOMS-GUIDE]] §8.1). Plan record sizes for the smaller.
- **`room-host` verifies a request's proof over the document as received** (VTI-45, `room-host/src/lib.rs`, `presenter`), so a client's signed bytes are what is judged; nothing in the client may re-serialise a document after signing it.
- **A browser or wallet client needs the host to allow its origin** (`room-host --allow-origin`), explicit and without a wildcard. A native app is not a browser, so this applies to any WebView path only.
- **Admission to a sealed room needs a Rust step by the owner.** A Keyring member can only join sealed rooms whose owner has tooling for it. Until that is a task, expect to test sealed-room joins with an owner-side script, not a second phone.
- **`private` rooms do not serve.** Keyring should refuse to create or join one and say why. Match the host's refusal by its stable part, "no zero-knowledge profile" (`vti-rooms-dtg/src/lib.rs`), not by the guide's §11 string, which the host does not send (§2.3).
- **Authority has no revocation, only expiry.** `validUntil` is required on a VAC because "nothing withdraws [a chain root] by waiting" ([[ROOMS-GUIDE]] §5.3). The wallet must show expiry prominently and warn on long windows.

## 5a. Readiness and blockers

Two sides, assessed separately. The rooms side is measured at the pin (§2). The Keyring side is measured at `origin/main` 0da7eead, reading `bifold` at the submodule commit it pins (d86785b4).

### Rooms side — usable now, with holes

| Area | Readiness |
|---|---|
| `open` and `attributed` rooms: create, records, curate, epoch mint, transfer, claim | **Serve** ([[ROOMS-GUIDE]] §2) |
| Member VTA custody and the agent oracle (`rooms/keys/*`) | **Work**, including `read` and `browse` composition |
| Sealed-room admission | **Blocked upstream for a non-Rust owner**: the owner's MLS add step has no task or CLI |
| Join without an inbox | **Not built**; a proposal that recommends waiting for the demo ([[ROOMS-JOINING]] §7) |
| `private` tier | **Refused at serve time** (no ZK profile) |
| Verified reads, `rooms/keys/write` | **Proposals / planned** |
| Cryptographic deletion | **Served** as `rooms/epoch/prune/0.1`, though the guide still says it has no verb (§2.3) |
| Docs | **Drifting**: the guide lags the code (§2.3) |
| Hosting | **No Farm story**: `room-host` is a deployed binary, so every claim is local-lab only (§8) |

### Keyring side — a VTA client exists; no room code

Paths below are in `bifold/packages/core/src/modules/trust-tasks/module/` unless given in full.

- **A VTA client exists, inside `@bifold/core` rather than as a package.** `VtaClient.ts` ("the phone as the manager of a personal VTA") and its controller `vtaAgent.ts` speak `auth/whoami`, `acl/{list,grant,update,revoke}`, `vta/contexts/*`, `vta/webvh/dids/*`, `keys/export-secret`, `task-consent/*`, `policy/*` and `vault/*` to the user's own VTA over the DIDComm v2 mediator transport (`VtiMediatorTransport.ts`), choosing a carriage through `tspCapability.ts`. There is no `vti-client` or `pnm-core` package and no `@openvtc/pnm-core` dependency in any `package.json`; the `@openvtc/pnm-core` 0.4.0 entry in `scripts/openvtc/PINS.json` is an upstream-watch tripwire under `npm`, not a dependency. [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md), which designs the packaged client, still reads "Draft for discussion. Not a commitment to implement."
- **No room code exists.** A search of `app/` and `scripts/` at `origin/main`, and of `bifold/packages` at d86785b4, for `roomPresent`, `room-present`, `RoomPresent`, `rooms/keys`, `rooms/records` and `trusttasks.org/spec/rooms` finds nothing.
- **A wallet-to-VTA attachment exists.** The phone links to its agent by QR enrolment (`vtaEnrolment.ts`: a temporary manager key, an enrolment code, an admin grant, then a rotation onto a long-lived key), tracked by one link state machine (`vtaLinkMachine.ts`), with the "My agent" screens in `bifold/packages/core/src/navigators/MyAgentStack.tsx` (`VtaLink`, `VtaAgentHome`, …). The design is [`keyring-on-the-vta-farm.md`](./keyring-on-the-vta-farm.md) (status "Proposal for review") and its [`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) §2.4 B ("every Keyring user has a VTA of their own"; status "In execution"). What it does not yet do for rooms: grant an ACL entry narrowed to `room-present` (R4), and hold room credentials where the oracle finds them (below).
- **Carriage.** `TspCarriage.ts` is wallet-to-wallet only (TSP inside DIDComm v1) and does not reach a VTA; the VTA leg is `VtiMediatorTransport` with TSP Rev 3 as a build-time carriage choice (`vtiTsp.ts`, `tspCapability.ts`). Rooms do not need TSP to the host.
- **`did:webvh` resolution is registered.** `RetryingWebVhDidResolver` (`bifold/packages/core/src/utils/RetryingWebVhDidResolver.ts`, over Credo's `WebVhDidResolver`) is in the app's agent (`app/src/utils/bc-agent-modules.ts`). Resolving a **room** DID from the wallet is **(unverified at 49f5f1be)**: no test exercises one.
- **DTG credentials.** The wallet keeps a community's `InvitationCredential` and `MembershipCredential` verbatim (`VtiCommunityStore.ts`), reads role `AuthorityCredential`s (`bifold/packages/trust-tasks/src/vetting/roleCard.ts`), and ships the DTG v1 registry context with `issuerScope` and `authority` (`bifold/packages/vrc-contexts/src/dtgRegistryContextV1.ts`). Whether it accepts a VIC, VMC or VAC **as a room issues them** (`issuerScope: public`, `authority.scope` = the room DID; a `directed` attenuated leaf) is **(unverified at 49f5f1be)**.
- **The VTA credential vault has a wallet-side equivalent** for community cards: `vtiCardVault.ts` pushes membership, role and vetter-grant cards to the VTA by `vault/credentials/receive/0.1`. Whether room credentials should reach the VTA that way, or only through the push-shaped admission in §4, is part of R1's credential-receipt step.

### Blockers, ordered by what they gate

| # | Blocker | Side | Gates | Kind |
|---|---|---|---|---|
| B1 | No decision that Keyring wants rooms (§9 Q1) | Keyring | everything | Not decided |
| B2 | The wallet's VTA session (`VtaClient`) carries no room tasks, and its ACL grants are not yet narrowed to `room-present` | Keyring | R1 onward (session), R4 (grant) | Built for community vetting; rooms work is additive |
| B3 | Where the rooms module lives: the PNM/CNM subtask's `vti-client` package does not exist, and `VtaClient` sits inside `@bifold/core` | Keyring | R1 onward | Not decided; packaging is the PNM/CNM subtask's call |
| B4 | Resolving a room's `did:webvh` and accepting its VIC, VMC and VAC (`issuerScope`) in the wallet | Keyring | R1 onward, if rooms are `did:webvh` | Resolver registered; room credentials unverified |
| B5 | Owner's MLS add step has no task (`RoomGroup::add_member` has no caller in `vta-service`, `vtc-service`, `pnm-cli` or `vta-cli-common` at the pin) | Rooms | R2 against a real second owner, and sealed-room joins generally | Waiting on upstream |
| B6 | Admission policy undefined ([[ROOMS-JOINING]] still a proposal at the pin) | Rooms | §6 item 1 | Waiting on upstream's demo |
| B7 | No `pnm rooms put` to sealed rooms (`vta-cli-common/src/commands/rooms.rs` refuses sealed tiers); no `rooms/keys/write` | Rooms | R3 sealed writes via a single call; the two-call path in [[ROOMS-TS]] works | Workaround exists |
| B8 | `private` tier refused | Rooms | any `private` use | Waiting on the DTG working group |
| B9 | Guide drift (§2.3) | Rooms | trust in this plan's citations | Cheap; the drift is listed in §2.3 and the design note is read at the pin |

**Only R0 (measurement, no app code) is unblocked today.** B1 gates everything; B3 is a placement decision shared with the PNM/CNM subtask; B2 and B4 are additive work on a VTA session that already exists, so R1 starts once Q1 is answered and B3 is placed.

## 6. Where Keyring could add something upstream does not have

Flagged as ideas to test, not commitments.

1. **Admission evidence.** [[ROOMS-JOINING]] §5 says plainly that "what makes an applicant admissible" is policy and "the design has no answer in it." Keyring's witnessed, hardware-attested VRCs, and the locality plan's co-presence evidence, are credentials a room could require before the owner issues a VMC. This would be an input to upstream's open question, so propose it **after** the demo run [[ROOMS-JOINING]] §7 asks for, not before.
2. **A join channel for a holder with only an agent channel.** [[ROOMS-JOINING]] §2 argues a join should go to the room's mediator (the room DID's `MEDIATOR_DID`), not the host and not the owner. A wallet is the case it describes: "a phone app … holds a channel to its own agent and to nothing else." If upstream specifies `rooms/join/request`, Keyring should be a first implementer.
3. **Peer rooms through a VRC.** The guide's T4 is "T1 with the VRC as the door." A Keyring VRC between two contacts could be what opens a room on one of their hosts. This needs a design with the VRC/witness recast, not just a room client.
4. **Agent consent for room access** as part of the approver surface the PNM/CNM subtask already designs (its P1).

## 7. Phases

Each phase carries acceptance criteria. "Verified" means the named check passes against the local lab stack (§8), not only a unit test.

### R0 — Measurement (no code in the app)

Ground every assumption in this plan.

- Run `cargo run -p room-host --example data_room` at the pin and capture its four acts as the reference trace.
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

**Done when:** (a) a script-driven owner admits the wallet to a sealed room and the wallet reads a record from before it joined, via `rooms/epoch/chain` and `rooms/keys/chain`; (b) a second invitation use is refused with `already been used`; (c) a deliberately withheld commit produces the guide's "a commit has not been delivered" message in the UI, not "corrupt".

**Blocked on:** the owner's MLS half being library-only (§2.3). The script is the interim, and the real gate is §9 Q4.

### R3 — Write and curate

The wallet writes to an `open` room by `rooms/records/put` and to a sealed room by `rooms/keys/seal` then `put`, and curates by `rooms/records/curate`.

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

*Conditional on §9 Q4* (whether Keyring is an owner client). If yes: renew (`rooms/epoch/mint`), the lifecycle state (Live / Lapsed / Dormant / Reclaimable, which is computed not stored), succession nominations, and `rooms/owner/anchor`.

**Done when:** defined after Q4. Do not start without it.

## 8. Test and lab

- The local lab is `scripts/openvtc/local-vti-stack`. `room-host` is a separate binary from the VTA ("not part of the VTA, on purpose", [[ROOMS-GUIDE]] §8.1), so the lab must add it: at `origin/main` no script under `scripts/openvtc/local-vti-stack/` mentions a room or `room-host`.
- Per the `vti-lab-and-field` skill, a claim the local lab supports and a claim the Farm supports are different; rooms have no Farm story today, so every R-phase claim is **local-lab only** unless a Farm host is found.
- `room-host` flags the lab needs: `--data-dir`, `--listen`, and `--resolve-dids` for `did:webvh` rooms (off by default; it lets unauthenticated requests trigger a fetch, a decision to make deliberately). For a mirror test, `--mirror-config` and `--mirror-interval-secs`.
- Add an e2e rung only after R1 passes by hand; follow `e2e/README.md`.

## 9. Open questions and what they block

| # | Question | Kind | Blocks |
|---|---|---|---|
| Q1 | Does Keyring want rooms at all, and for which product moment (group activities, agent memory, peer spaces)? | Not decided — needs a product owner | everything |
| Q2 | Does the wallet ever hold a group key (a no-VTA, in-process wasm mode), or always use the VTA oracle? | Not decided | R1's scope; §3.3 |
| Q3 | Can `packages/core/src/rooms/` be ported to React Native unchanged? | Measurable; R0 answers it | R1 effort |
| Q4 | Is Keyring an **owner** client (issuing credentials, forming groups)? Upstream has no task for the MLS add step | Decided-waiting-on-upstream for the MLS step; not decided for the rest | R2's real test, R5 |
| Q5 | What does a room require of an applicant? Upstream defers this to the demo ([[ROOMS-JOINING]] §5, §7) | Waiting on upstream's demo | §6 item 1 |
| Q6 | Where does a wallet reach a host from: through its VTA only (`keys/read`, `browse`), or directly for any call? | Leaning VTA-only per [[ROOMS-READTHROUGH]] §1 | R1 design |
| Q7 | Should an agent's memory live in a room? [[ROOMS-VERIFIED]] and [[ROOMS-READTHROUGH]] make the agent "the room's memory" | Product question | R4 |

## 10. Before this leaves draft

The plan is filed as its own `docs/plans/openvtc-rooms-plan.md` with a companion folder, and has a row in `docs/plans/README.md`. What remains:

1. **The parent plan does not name it.** [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) §5.2's module list has no rooms row, and nothing in that plan mentions rooms. Add the row, pointing here, when §9 Q1 is answered.
2. **Placement of the rooms module (B3)** is agreed with the PNM/CNM subtask: inside `@bifold/core` beside `VtaClient`, or in the packaged client that subtask designs.
3. **R0's companion.** R0's findings go in a dated companion in `openvtc-rooms-plan/`, per `docs/plans/CLAUDE.md`, and §2.3 and §5a are re-measured against whatever pin is current then.
4. **§9 Q1 is answered.** Until Keyring decides it wants rooms, this stays a draft.

## 11. Sources

- `external/verifiable-trust-infrastructure` @ 49f5f1be (`VTI-Eucalyptus`) — `docs/02-vta/data-rooms.md`; `docs/05-design-notes/data-rooms*.md`; `room-host/src/{main,lib}.rs`, `room-host/examples/data_room.rs`; `vta-service/src/trust_tasks/{room_keys,room_group,room_owner}.rs`, `vta-service/src/operations/{room_oracle,room_groups}.rs`; `vta-cli-common/src/commands/rooms.rs`; `pnm-cli/src/cli.rs` (`RoomCommands`: `list`, `get`, `put`, `curate`, `renew`, `create` — unchanged since afcf2470; the file's changes in between are outside rooms); `vtc-service/src/rooms/handlers.rs`, `vtc-service/src/routes/mod.rs`; `vti-rooms/src/{wire,mls,storage}.rs`; `vti-rooms-dtg/src/lib.rs`; `vti-rooms-wasm/src/identity.rs`; `vta-sdk/src/protocols/acl_management/update.rs`. Rooms-relevant delta read from afcf2470: `git diff afcf2470 49f5f1be` over those paths.
- `external/verifiable-trust-infrastructure-v047` @ 439a0333 — contains the same four room crates; not a rooms baseline.
- `external/vta-browser-plugin` @ 43e2cc7 — `packages/core/src/rooms/index.ts` (821 lines); `packages/core/src/vta/{channel,trust-task}.ts`; `packages/extension/src/manager/room-host-setup.ts`.
- [RFC 9420 — Messaging Layer Security](https://www.rfc-editor.org/rfc/rfc9420).
- Keyring @ `origin/main` 0da7eead: `docs/plans/openvtc-integration-plan.md`, `…/pnm_cnm_subtask.md`, `docs/plans/keyring-on-the-vta-farm.md`, `…/community_vetting_subtask.md`, `docs/plans/locality-plan.md`, `docs/plans/CLAUDE.md`, `scripts/openvtc/PINS.json`, `scripts/openvtc/local-vti-stack/`, `app/src/utils/bc-agent-modules.ts`.
- `bifold` @ d86785b4 (the submodule commit `origin/main` pins) — `packages/core/src/modules/trust-tasks/module/{VtaClient,vtaAgent,vtaEnrolment,vtaLinkMachine,VtiMediatorTransport,TspCarriage,vtiTsp,tspCapability,VtiCommunityStore,vtiCardVault}.ts`; `packages/core/src/navigators/MyAgentStack.tsx`; `packages/core/src/utils/RetryingWebVhDidResolver.ts`; `packages/trust-tasks/src/vetting/roleCard.ts`; `packages/vrc-contexts/src/dtgRegistryContextV1.ts`.
