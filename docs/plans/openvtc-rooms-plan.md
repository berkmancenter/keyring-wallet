# Data Rooms in Keyring — Starting-Point Plan

**Status:** Draft starting point. Not a commitment to implement, and **not yet filed** under `keyring-wallet/docs/plans/`. It is written to the conventions in that directory's `CLAUDE.md` so it can be moved there with little rework (see §10).
**Scope:** Keyring as a **member client** of VTI data rooms — reading, writing and curating records, and holding an agent's access to them. Owner/host operation is out of scope except where §5 says the wallet must cope with it.
**Parent:** [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) — rooms are a new consumer of the Trust Task operation layer that plan adopts (its §5).
**Siblings:** [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) — the VTA client this plan extends (rooms are a PNM surface, §3 below). [`trust_tasks_subtask.md`](./openvtc-integration-plan/trust_tasks_subtask.md) — the VRC/witness recast, which §6's admission-evidence idea depends on. [`locality-plan.md`](./locality-plan.md) — co-presence evidence, a candidate admission gate (§6).
**Reasoning:** none yet. When a decision in §9 is made, record it in a dated companion, not here.
**Baseline:** every claim is measured against the pinned clone `external/verifiable-trust-infrastructure` at **afcf2470** (2026-09-29, `scripts/openvtc/PINS.json`) unless marked otherwise, and carries a file path. A second pin, `verifiable-trust-infrastructure-v047` at 439a0333 (2026-10-01), also contains `room-host`, `vti-rooms`, `vti-rooms-dtg` and `vti-rooms-wasm`. Re-verify after any pin advance.

**Verification note.** The first survey of rooms was read from a sibling checkout (`~/code/verifiable-trust-infrastructure`, 121 commits ahead of afcf2470), which `CLAUDE.md` warns against. It was then cross-checked against the pin: the operator guide `docs/02-vta/data-rooms.md` and the joining, read-through, verified-reads and epoch-anchoring notes are **byte-identical** in the pin; `docs/05-design-notes/data-rooms.md` differs by 19 lines that were not examined; and every room Trust Task URI named below appears in the pin's Rust sources. Nothing in this document depends on the 121 later commits. Re-confirm the 19-line difference before relying on the design note.

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

Not built at all, per the guide's §2 and the design notes:

- **The owner's MLS half** (`RoomGroup::{create,add_member}`) is library-only: no task, no CLI. Admitting a member to a **sealed** room is Rust.
- **A join request.** [[ROOMS-JOINING]] §1: "Twenty-two room tasks and **not one is a join request**." The proposal recommends not writing the spec until the demo shows what gets abused (§7 there).
- **`private` rooms** are stored but refused at serve time; the zero-knowledge profile is unsettled.
- **Verified reads** ([[ROOMS-VERIFIED]]) and `rooms/keys/write` ([[ROOMS-READTHROUGH]] §6) are proposals / planned.
- **Cryptographic deletion** has a primitive and no verb.

## 3. Where rooms sit in the Keyring architecture

### 3.1 The decision (proposed)

Rooms are **a PNM surface**: a module in the same client package the PNM/CNM subtask designs (`vti-client`, parent §5.2), calling the member's VTA over the same Trust Task spine. They are not a new transport and not a new wallet core.

*Conditional on* the PNM/CNM subtask's P2 (an authenticated VTA session) landing as designed. If P2 slips, rooms inherit the delay for everything except the pure-wasm read path in §3.3.

### 3.2 Why, against the alternatives

- **Port the browser plugin's `packages/core/src/rooms/` module** ([[ROOMS-TS]]) instead of writing a new client. It already splits VTA and host calls, builds the create-only sealed write as a pair, and imports generated payload types from `@openvtc/trust-tasks/rooms/…`. It depends on `TaskParty`, `TrustTaskSender` and `buildTrustTask` from the plugin's `vta/` layer, which is the same layer the PNM/CNM subtask measures for portability (its §3.3). **To verify:** that those imports are free of browser-only APIs.
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
- **A VTC caps Trust Task bodies at 64 KiB**; `room-host` imposes only axum's 2 MB default. Plan record sizes for the smaller.
- **A browser or wallet client needs the host to allow its origin** (`room-host --allow-origin`), explicit and without a wildcard. A native app is not a browser, so this applies to any WebView path only.
- **Admission to a sealed room needs a Rust step by the owner.** A Keyring member can only join sealed rooms whose owner has tooling for it. Until that is a task, expect to test sealed-room joins with an owner-side script, not a second phone.
- **`private` rooms do not serve.** Keyring should refuse to create or join one and say why, using the guide's own refusal string (`a private room must not be served without a ZK profile`).
- **Authority has no revocation, only expiry.** `validUntil` is required on a VAC because "nothing withdraws [a chain root] by waiting" ([[ROOMS-GUIDE]] §5.3). The wallet must show expiry prominently and warn on long windows.

## 5a. Readiness and blockers

Two sides, assessed separately. The rooms side was measured at the pin (§2). The Keyring side was measured in this repo at the time of writing; re-check it before filing.

### Rooms side — usable now, with holes

| Area | Readiness |
|---|---|
| `open` and `attributed` rooms: create, records, curate, epoch mint, transfer, claim | **Serve** ([[ROOMS-GUIDE]] §2) |
| Member VTA custody and the agent oracle (`rooms/keys/*`) | **Work**, including `read` and `browse` composition |
| Sealed-room admission | **Blocked upstream for a non-Rust owner**: the owner's MLS add step has no task or CLI |
| Join without an inbox | **Not built**; a proposal that recommends waiting for the demo ([[ROOMS-JOINING]] §7) |
| `private` tier | **Refused at serve time** (no ZK profile) |
| Verified reads, `rooms/keys/write`, cryptographic deletion verb | **Proposals / planned** |
| Docs | **Drifting**: the guide lags the code (§2.3) |
| Hosting | **No Farm story**: `room-host` is a deployed binary, so every claim is local-lab only (§8) |

### Keyring side — not ready; the groundwork is a draft

Measured in this repo:

- **No VTA client exists.** `bifold/packages/` has `trust-tasks` and `credo-tsp-adapter` but no `vti-client`, and no `pnm-core` appears in any `package.json`. The package this plan builds on (§3.1) is the one [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) *designs*, and that subtask's status line reads "Draft for discussion. Not a commitment to implement."
- **No room code exists.** A search of `bifold/packages` and `app/src` for `roomPresent`, `room-present` and `RoomPresent` found nothing; no room screen or module was seen.
- **A wallet-to-VTA attachment does not exist.** The 2026-09-07 review (`2026-09-07-al.md`, per the parent plan's index) notes "nothing says how a VTA gets attached to a wallet at all" and that the policy surface is specified as `pnm-cli` commands the wallet has no equivalent of. Every room call except host-only reads needs that attachment.
- **Transport is in flight.** `TspCarriage` is dev-flag-gated and its e2e spec was written but unverified (`2026-09-02-bam.md`). Rooms do not need TSP to the host, but the VTA leg rides the same carriage work.
- **`did:webvh` resolution is a gap.** Rooms are normally `did:webvh`, and Credo 0.6.3 returned `unsupportedDidMethod` in `ref-06x` (same 09-07 review). A wallet that cannot resolve a room DID cannot verify what the room issued. Not confirmed whether this is closed.
- **Not verified:** whether the wallet's existing `DTGCredential` handling accepts a VIC, VMC or VAC as the room issues them, and whether the VTA credential vault ("`pnm cred-vault receive`") has a wallet-side equivalent.

### Blockers, ordered by what they gate

| # | Blocker | Side | Gates | Kind |
|---|---|---|---|---|
| B1 | No decision that Keyring wants rooms (§9 Q1) | Keyring | everything | Not decided |
| B2 | No wallet-to-VTA attachment or authenticated session (PNM/CNM P2) | Keyring | R1 onward | Not built; its plan is a draft |
| B3 | `vti-client` package does not exist | Keyring | R1 onward | Not built |
| B4 | `did:webvh` resolution in the wallet | Keyring | R1 onward, if rooms are `did:webvh` | Unconfirmed |
| B5 | Owner's MLS add step has no task | Rooms | R2 against a real second owner, and sealed-room joins generally | Waiting on upstream |
| B6 | Admission policy undefined | Rooms | §6 item 1 | Waiting on upstream's demo |
| B7 | No `pnm rooms put` to sealed rooms; no `rooms/keys/write` | Rooms | R3 sealed writes via a single call; the two-call path in [[ROOMS-TS]] works | Workaround exists |
| B8 | `private` tier refused | Rooms | any `private` use | Waiting on the DTG working group |
| B9 | Guide drift, and an unexamined 19-line design-note diff | Rooms | trust in this plan's citations | Cheap; R0 |

**Only R0 (measurement, no app code) is unblocked today.** B2–B4 are shared with the PNM/CNM and parent plans, so rooms cannot be scheduled ahead of them; R1 starts when they land.

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
- Stand up `room-host` and the local VTA from `scripts/openvtc/local-vti-stack`; create an `open` and an `attributed` room by `pnm rooms create`.
- Read [[ROOMS-TS]]'s imports and list every dependency that is browser-only.
- Diff the 19 lines in `docs/05-design-notes/data-rooms.md` between the pin and the sibling.

**Done when:** a dated companion records the reference trace, the dependency list and the diff conclusion, and §9 Q1 and Q3 are answered or re-scoped.

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

- The grant is a role-ceilinged ACL entry narrowed with `--capabilities room-present` at creation (the guide says to prefer creation-time narrowing, since it leaves no window where the entry is wider).
- The consent surface follows the PNM/CNM subtask's P1 rules; room access is never granted by default.

**Done when:** (a) an agent obtains a 4-hour, one-action presentation and reads; (b) removing the ACL entry stops further presentations; (c) a presentation captured and replayed from a different signer is refused.

### R5 — Lifecycle and owner conveniences (conditional)

*Conditional on §9 Q4* (whether Keyring is an owner client). If yes: renew (`rooms/epoch/mint`), the lifecycle state (Live / Lapsed / Dormant / Reclaimable, which is computed not stored), succession nominations, and `rooms/owner/anchor`.

**Done when:** defined after Q4. Do not start without it.

## 8. Test and lab

- The local lab is `scripts/openvtc/local-vti-stack`. `room-host` is a separate binary from the VTA ("not part of the VTA, on purpose", [[ROOMS-GUIDE]] §8.1), so the lab must add it. **Not yet verified:** whether the stack already starts one.
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

## 10. Moving this into the repo

1. Resolve the 19-line difference noted at the top; update the verification note to state it either way.
2. Place the file as `docs/plans/openvtc-integration-plan/rooms_subtask.md` (parent-owned, like the other two subtasks) **or** as its own `docs/plans/rooms-plan.md` with a companion folder. The parent plan's §5.2 module list and the `docs/plans/README.md` table both need a row.
3. Fix the relative links in the header to match the final location.
4. Open the first dated companion with R0's findings, per `docs/plans/CLAUDE.md`.
5. Run `node scripts/openvtc/setup-external.mjs` first, so every path above is read from the pin.

## 11. Sources

- `external/verifiable-trust-infrastructure` @ afcf2470 — `docs/02-vta/data-rooms.md`; `docs/05-design-notes/data-rooms*.md`; `room-host/src/main.rs`; `vta-service/src/trust_tasks/{room_keys,room_group,room_owner}.rs`; `vta-cli-common/src/commands/rooms.rs`; `pnm-cli/src/cli.rs` (`RoomCommands`: `list`, `get`, `put`, `curate`, `renew`, `create`); `vtc-service/src/rooms/handlers.rs`; `vti-rooms/src/wire.rs`.
- `external/verifiable-trust-infrastructure-v047` @ 439a0333 — same crates.
- `external/vta-browser-plugin` @ 43e2cc7 — `packages/core/src/rooms/index.ts`; `packages/extension/src/manager/room-host-setup.ts`.
- [RFC 9420 — Messaging Layer Security](https://www.rfc-editor.org/rfc/rfc9420).
- Keyring: `docs/plans/openvtc-integration-plan.md`, `…/pnm_cnm_subtask.md`, `docs/plans/locality-plan.md`, `docs/plans/CLAUDE.md`, `scripts/openvtc/PINS.json`.
