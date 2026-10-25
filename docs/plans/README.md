# Plans

Living planning documents for cross-cutting workstreams, and the lightweight
protocol we use to agree on them.

| Plan | Scope | Status |
|---|---|---|
| [openvtc-integration-plan.md](./openvtc-integration-plan.md) | Making Keyring interoperable with the OpenVTC / First Person Project infrastructure — TSP as the message envelope, Trust Tasks as the operation layer, the VTA as the server-side counterpart | Active. Phase A/B complete, Phase C in progress |
| [locality-plan.md](./locality-plan.md) | Co-presence evidence a third party can trust: a venue-deployed witness observes the parties' devices on a short-range radio channel and attests to it in the VWC it already issues. Depends on the OpenVTC plan's Trust Task recast | Active. Design agreed; reference ladder (`ref-06p*`) not yet built |
| [release-flow-plan.md](./release-flow-plan.md) | How a change travels from a branch to testers' phones: one trunk (`main`), `staging` and `v*` tags as pointers, three delivery channels mapped to TestFlight internal/external and Play internal/open testing, build-number and submodule rules, what GitHub enforces, and the `release-flow` agent skill | Proposed. Governance items blocked on the repository admins; credential migration in progress |
| [keyring-on-the-vta-farm.md](./keyring-on-the-vta-farm.md) | Keyring as a full participant at every level of the ecosystem's documented developer path, against a **Farm-hosted** VTA rather than one we run: provisioning from the phone, persona and membership, and the join request qualified by Keyring-minted witnessed VRCs. Carries the React Native portability contributions the path forces. **Optional and additive** — no phase of the sibling plans depends on it | Proposed. Blocked on nothing; opens with a pin advance and a Farm measurement. Subtask [`community_vetting_subtask.md`](./keyring-on-the-vta-farm/community_vetting_subtask.md) — Keyring as the applicant in peer identity vetting, on a local VTI stack — in review (#53). Subtask [`tsp_rev3_subtask.md`](./keyring-on-the-vta-farm/tsp_rev3_subtask.md) — the TSP Rev 3 cutover — proposed, gated on an upstream release |
| [message-protection-plan.md](./message-protection-plan.md) | The client half of upstream's *Life of a Message* delivery contract — acceptance, refusal, release, collection and expiry across `affinidi-tdk-rs` #828–#842. What Keyring owes as a recipient that must acknowledge (an ack is a delete at the mediator, and an unacknowledged message is charged to its **sender**) and as a sender that can now be refused with a typed gate and a `Retry-After`. Explicitly **not** a cryptography plan despite the name | Proposed. Opens with a measurement: our lab is mediator 0.28.0 from the #829 branch tip and has never run #830–#842 |
| [ui-ux-improvements-plan.md](./ui-ux-improvements-plan.md) | How a person — not a test harness — meets the agent, membership and vetting flows: the roles and per-community stages, agent linking without a stopped daemon, one scanner and a ticket QR, the vetting ceremony split into two step-per-screen flows, and the Developer screen out of the user path. Refines §7 of the community vetting subtask | Proposed. No code written; target the Prague demo |
| [vsc-migration-plan.md](./vsc-migration-plan.md) | Moving every witness credential Keyring issues, carries, verifies and displays from the deprecated WD02 `WitnessCredential` type to the Working Draft 0.4.0 **Verifiable Statement Credential (VSC)** under the `dtg:witnessed` predicate profile — and standing up locally the DTG predicate vocabulary the specification now depends on and which does not yet exist upstream | Proposal for review. No code written; reference rungs `ref-21`…`ref-23` not yet built |
| [editable-multi-profile-plan.md](./editable-multi-profile-plan.md) | Making a user's R-Card profile editable after onboarding (Phase 1), then letting a user hold multiple profiles and choose which is active when connecting (Phase 2). Decides an optional, enforced 1:1 link between a profile and a VTA persona from `feat/prague-farm-membership`, not yet scheduled into either phase | Active. Phase 1/2 implemented, plus the read-only half of §4.3's Phase-3 deferral (which profile was linked to a contact); in review (keyring-wallet#59, keyring-bifold#55). The persona-link UI, VPC issuance, and per-connection profile binding remain open (§7) |
| [push-notifications-plan.md](./push-notifications-plan.md) | Waking a backgrounded phone when the person's agent needs an approval, Signal-style: a contentless push from OpenVTC's push wake-up gateway, and a notification the phone composes itself (generic text while the wallet is locked). iPhone ships a visible, modifiable push from the start; message notifications are built in but off. Gateway-only Compose package; the Keyring mailbox is not swapped | Proposed. No code written; tested in isolation (its own app ID, a local lab stack) after the current release. Hosting is an open question |
| [nearby-vrc-exchange-plan.md](./nearby-vrc-exchange-plan.md) | Two people form a relationship by finding each other's phone over Bluetooth instead of a QR code, confirming a 6-digit code on both screens, and exchanging VRCs through the existing unwitnessed ceremony, bound to the confirmed Bluetooth session. Keeps device and ceremony evidence; makes **no** co-presence claim (locality plan §2.1) | Proposed. No code written; Phase 0 is a two-phone reference rung (needs physical phones) |
| [openvtc-interop-harness-plan.md](./openvtc-interop-harness-plan.md) | Every release candidate proves Keyring interoperates with upstream's reference implementations, not only with itself: a headless openvtc bot (vetter and applicant) on openvtc-core, driven in lockstep with Keyring, with assertions read from the bot's state and the community's records; card-verify as the cheap first layer; openvtc pinned; release-candidate gate plus a nightly drift run | Proposed. Phase 0 (card-verify) done in code; Phases 1–4 need a Farm runner agent and an invitation-only test community (decisions for Alberto, §9) |
| [delegated-batch-issuance-plan.md](./delegated-batch-issuance-plan.md) | Delegated Batch Issuance (DBI): presenting a KERI-rooted state credential (the motivating case is Utah's SEDI credential) to W3C, SD-JWT VC and mdoc verifiers without linking presentations, by a zero-knowledge proof from the holder's VTA that the credential the state signed matches what the verifier sees. Covers the state profile (P-256, SHA-256), status by a Merkleized bitstring, the custom Longfellow circuit and its audit gate, and the wallet's role. Sibling of the holder-only KERI plan (PR #419), with which it merges. **Conditional on the State of Utah's primary being an ACDC (X14), unconfirmed in writing** | **Proposed.** Phase 0 benchmark partly done (stock circuit only); nothing built. Phase 1 opens with a plain OpenID4VP presentation. Blocked on Utah (G1) and on Brendan's G0 decision; Q28 (mediated proving, PR #114) open |
| [peer-message-notifications-plan.md](./peer-message-notifications-plan.md) | One notification per message from a relationship peer while Keyring is closed: the recipient's mediator reports each undelivered message through its existing webhook, and the push gateway turns the report into a contentless wake with its own notification. Named notifications would need decision #39 reopened. Moves to the agent path once peer messages reach the agents | Proposed, a top item for 241. No code written; step 1 is a repro of the merged wakes |
| [ios-builds-on-linux-plan.md](./ios-builds-on-linux-plan.md) | iOS builds for a Linux-first team: store builds, simulator builds and simulator smoke already run on GitHub-hosted `macos-26` runners; the full release gate and attended iPhone runs need a Mac we control, so one dedicated Apple Silicon Mac mini, headless, as the gate's runner. xtool and KVM routes rejected as standing rationale; an OSX-KVM simulator measurement is optional. Does not change [release-flow-plan.md](./release-flow-plan.md) | **Draft.** Nothing bought or set up; the purchase is not decided |
| [encrypted-key-custody-plan.md](./encrypted-key-custody-plan.md) | A cloud signer no single administrator can use: 2-of-3 FROST(Ed25519) threshold signing on two independent providers with an offline recovery share, policy enforced at each signer, and an encrypted-dictionary store. First candidate is the witness-server's VWC issuer key; holder keys stay on the phone. Companion [`2026-10-06-bam.md`](./encrypted-key-custody-plan/2026-10-06-bam.md) keeps the research and the confidential-VM price survey (prices as of 2026-10-06) | **Draft.** Exploratory; nothing built or scheduled. Providers, the witness's DID and whether an autonomous tier exists are open |
| [openvtc-rooms-plan.md](./openvtc-rooms-plan.md) | Keyring as a **member client** of VTI data rooms: reading, writing and curating records through the member's own VTA (which holds the room credentials and group keys), consenting to invitations, and granting an agent room access. Owner and host operation are out of scope. Subtasks: [`rooms_s3_storage_subtask.md`](./openvtc-rooms-plan/rooms_s3_storage_subtask.md) (record bodies in S3 on the host side), [`rooms_encrypted_spaces_subtask.md`](./openvtc-rooms-plan/rooms_encrypted_spaces_subtask.md) (Encrypted Spaces as a storage and sync backend for rooms), [`rooms_group_messaging_subtask.md`](./openvtc-rooms-plan/rooms_group_messaging_subtask.md) (group messaging and linked files as a profile on rooms) | **Draft.** Not a commitment to implement; no code written. Only R0 (measurement) is unblocked; R1 waits on a product decision that Keyring wants rooms (Q1) and on where the rooms client lives beside the existing `VtaClient` (B3) |
| [rich-messaging-plan.md](./rich-messaging-plan.md) | The minimum that makes one-to-one chat feel like a modern messenger, with **no hosting**: a Keyring chat message type (`keyring/chat/1.0`), reactions, quoted replies, our own emoji picker, photos/GIFs small enough (≤ 256 KiB) to travel inside the encrypted message, and message history controls (delete, clear, keep-for, disappearing messages). Videos, files and full-resolution photos wait for an upstream place to keep media that the user chose (§8). Group chat stays with the rooms plan | Proposed. Opens with a measurement of the real per-message ceiling on both mediators; decisions D1–D3 open |

## Why documents instead of only pull-request threads

We work with independent agents that need the same context. A PR thread is a
good *venue* for discussion, but it is a poor *record*: comments are hard to
grep, decay over time, live outside the repository, and are effectively
invisible to an agent reading the codebase. So:

- **Documents carry the decision record** — what we agreed, and the evidence
  behind it. They version with the code and both agents can read them.
- **PRs (when we open them) carry the conversation.** Nothing stops us using
  both; the document is what survives.

## The protocol

1. **One living plan per workstream** is the single source of truth. It is the
   first thing to read, and the first thing an agent should be pointed at.
2. **Changes arrive as dated proposals**, not silent edits to the living plan.
   They live in the plan's companion folder, named `YYYY-MM-DD-initials.md` —
   one file per author per working session. Authoring conventions (what goes in
   the plan vs. a dated companion, citation rules) are in
   [`CLAUDE.md`](./CLAUDE.md).
3. **A proposal gets a response with evidence**, not opinions: claim → verdict
   → citation (file path, commit, or a runnable check).
4. **Agreed items merge into the living plan**, which bumps its revision line
   and names the proposal it absorbed. Rejected items are recorded *with their
   reasoning* so they don't come back around.
5. **Claims about upstream get verified against the pinned clones before
   adoption.** This is the load-bearing rule. The upstream repositories change
   daily; several claims in the first review round were accurate when written
   and stale a week later. `scripts/openvtc/` exists to make that verification
   reproducible for everyone.

## Working on this workstream

```sh
node scripts/openvtc/setup-external.mjs     # clone the upstream repos at pinned SHAs
node scripts/openvtc/sync-external.mjs      # what changed upstream since the pins
```

See [`scripts/openvtc/README.md`](../../scripts/openvtc/README.md) for the full
environment guide, and
[`tsp-reference/`](../../tsp-reference/) for the runnable
reference ladder that backs the plan's technical claims.
