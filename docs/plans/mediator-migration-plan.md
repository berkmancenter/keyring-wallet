# Mediator migration: Keyring ↔ Keyring onto the Affinidi mediator, and the Credo mediator retired

**Status:** draft for review. **Blocked:** no phase starts until the managed infrastructure's wallet-host and short-link change is deployed (§6). **Owner:** product owner. **Implementing lanes:** gateway-infra, push, app/UI.
**Companions:** [`mediator-migration-plan/2026-10-20-al.md`](mediator-migration-plan/2026-10-20-al.md) holds the findings behind this draft. [`mediator-migration-plan/2026-10-21-bam-extension-notes.md`](mediator-migration-plan/2026-10-21-bam-extension-notes.md) holds the notes behind the extension phases (§5.1). [`mediator-migration-plan/2026-10-25-al.md`](mediator-migration-plan/2026-10-25-al.md) holds the response to that review, the reasoning for the rollback section (§5.2) and the reasoning for the infrastructure blocker (§6).
**Related plans:**
- [`peer-message-notifications-plan.md`](peer-message-notifications-plan.md): the message-wake design this migration has to keep working.
- [`push-notifications-plan.md`](push-notifications-plan.md): the push gateway.
- [`openvtc-integration-plan/didcomm_v2_subtask.md`](openvtc-integration-plan/didcomm_v2_subtask.md): DIDComm v2 in the wallet. D1 below supersedes its §7 "Wallet ↔ wallet, v2" row.

**Evidence labels:** **READ** means seen in source, docs or live state at the stated commit or time; **INFERRED** means reasoning.
- Wallet sources: `origin/main` b41d148; bifold 13ff3c1a.
- The Affinidi mediator (`affinidi/affinidi-tdk-rs`): the deployed commit `555806151b30` (v0.33.1) and `a1611baa` (v0.37.0).
- Credo mediator facts: the live deployment, 2026-10-20.

## 1. Why

Keyring's wallet ↔ wallet mailbox, the **Credo mediator** (`credo-mediator.asml.berkmancenter.org`, `didcomm-mediator-credo`), runs on a legacy shared development host that the infra repo doesn't manage. It has caused downtime, and it now carries a two-line interim patch to send message wakes. It is retired together with that host. Keyring ↔ Keyring moves onto the **Affinidi messaging mediator**, which Keyring already uses for its agent traffic, on the managed infra.

The migration must not lose message notifications, approval notifications, existing contacts or OTA.

## 2. Today

| Component | Where | Speaks | Used for |
|---|---|---|---|
| Credo mediator `375518d` | legacy dev host, hand-run, outside the infra repo | DIDComm v1 (Coordinate Mediation 1.0, Pickup 2.0), postgres pickup, `QueueOnly` | All phones' default mailbox (`MEDIATOR_URL`, app/.env.sample:8, staging.yaml:365); chat and the VRC exchange over v1 connections (bifold Chat.tsx:160; vrc-manager.ts:2701-2739). READ |
| Affinidi messaging mediator `5558061` | push-gateway VM (managed) | DIDComm v2.1 (affinidi-messaging-mediator Cargo.toml:132), Pickup 3.0 over WebSocket, Routing 2.0, TSP | The gateway's own DID only: `explicit_allow`, public login refused (deploy/keyring-messaging/mediator.toml:20-26,91-92; Caddyfile:22-34; compose:9-14 "phones never talk to this mediator"). READ |
| VTI mediator (`VTI_MEDIATOR_DID`) | VTI infra | DIDComm v2.1 + TSP, through bifold `VtiMediatorTransport.ts` | Wallet ↔ VTA/VTC traffic. READ |
| Witness server (keyring-bifold `packages/witness-server`) | witness host; deployed mode UNVERIFIED | Direct HTTPS, or in mediator mode (`MEDIATOR_INVITATION_URL`) Credo `mediationRecipient` with PickUpV2 against the Credo mediator | Witnessed VRC exchanges. Not on Affinidi; see §5.1 M2a and companion E1. READ in keyring-bifold 783cadf |
| Push gateway `-p4` | push-gateway VM | HTTPS + `push/wake/0.2` | Approval wakes from agents; message wakes from the Credo mediator's webhook (patches 0003/0004). READ |

**Message wakes today:**
1. The phone registers an opaque wake handle with the Credo mediator using Aries RFC 0734 `set-device-info` (app/src/push/mediatorDeviceInfo.ts:28-64). It is a v1 message sent over the default mediator connection.
2. The mediator POSTs `{connectionId, fcmToken}` to the gateway for each queued message.
3. The gateway wakes the handle, at most once per 30 s per handle.

This was proven on two iPhones on 2026-10-20 (READ, live).

**It depends on an interim patch.** Image `375518d` sends no webhook unless Firebase is configured (`build/config/pushNotificationLoader.js:8`). It also posts for every connection, including connections with no handle (`build/push-notifications/sendNotification.js:13`). Both lines are fixed by read-only bind mounts, recorded in the infra repo's operations notes. Upstream `main` (`8617ac6`) has the same two lines. READ

## 3. Decisions

### D1. The mailbox for Keyring ↔ Keyring: **decided: the Affinidi messaging mediator**, on the managed infra

Affinidi serves both legs, wallet ↔ agent (as today) and Keyring ↔ Keyring, and the Credo mediator is retired. The reasons: its operational record (downtime, a hand-run host outside the managed infra) and one mediator implementation for every leg.

The constraints this decision brings:
- **No push hook.** There is no webhook, FCM/APNs or device-info support, and no config key for "message stored for an absent recipient". READ at `5558061` and `a1611baa`: no matches repo-wide; the `mediator.toml` sections are listed in the companion. See D2 and §4.2.
- **No Coordinate Mediation.** Its optional `didcomm-v1` feature "does not yet make the mediator usable by a stock Credo wallet" (Cargo.toml:86-93, READ). Phones reach it only through `VtiMediatorTransport` (ATM login, one socket per DID). See §4.3.
- **Phone accounts and ACLs.** The sample default `global_acl_default="DENY_ALL,…"` closes inboxes and doesn't grant `RECEIVE_FORWARDED` (mediator.toml:152,162; docs/acls.md:120; READ). See M3.
- **Limited evidence.** Credo DIDComm v2 through this mediator is proven only at the ref-18 rung, 6/6 (didcomm_v2_subtask.md:305-311, READ), with no wallet ↔ wallet production evidence. See M2.
- **Queue caps.** `queued_send_messages_per_peer="50"`, and receive-queue limits of 200 soft and 1000 hard (mediator.toml:449,476,482, READ), can refuse mail to a phone that is offline for a long time. See M3.

**Not chosen: the Credo mediator in v2 mode** (the subtask's former §7 row). It would keep today's webhook and need no new wake path. It is ruled out by the operational record, and it would keep a second mediator implementation in service.

**Order.** M1 moves the Credo mediator as-is onto the managed infra, so the legacy host retires without touching phones. The Affinidi move follows as its own evidence step (M2) and store build (M4). This avoids coupling a new mailbox, a new protocol and a new wake mechanism in one release.

### D2. Who rings for a peer message on Affinidi: **not decided** (product owner; evidence in M2)

The Affinidi mediator can't ring by itself (D1), so one of these does it:

| Option | Our new code | Assessment |
|---|---|---|
| **W1. Upstream hook.** Affinidi adds a webhook or push hook to the mediator. | none | Cleanest long term. Its SDK changelog already lists `vti-push-gateway` as a dependent (affinidi-messaging-sdk CHANGELOG.md:1203, READ). Depends on their timeline. **Ask first.** |
| **W2. The sender rings.** The sending phone sends `push/wake/0.2` for the recipient, signed by its own DID, and the recipient's agent lists the recipient's contacts as allowed triggers. | app only | No server change, *if* the gateway's allowlist and the agent's `set_wake_device` accept contact DIDs as triggers: **UNVERIFIED (INFERRED)**. Costs: every contact can ring you (rate-capped, revocable per contact); allowlists churn with did:peer rotation; an offline sender can't ring. |
| **W3. The recipient's agent rings,** as it does for approvals (peer-message-notifications-plan.md §5). | upstream (VTI) | Only if peer messages pass through agents. Needs VTI-Q52. |
| **W4. A store decorator.** A wrapper binary around `MediatorBuilder` with a `MediatorStore` that POSTs `{did_hash}` when the recipient isn't live (§4.2). | yes (Rust) | Reliable, uses a supported extension point, no fork; ours to maintain (about 1,500 delegated trait lines). **The fallback if W1 isn't timely.** |
| **W5. A Redis sidecar** on keyspace notifications for `RECEIVE_Q:*`, plus a `GLOBAL_STREAMING` check. | small script | Couples to Redis internals rather than a contract, so it's fragile across mediator upgrades. Last resort. |

**Rejected: the traffic monitor** (`src/monitor.rs`). It is live-only, rate-limited, dropped on lag and single-instance (:20-31), and a doorbell can't be lossy.

**Proposed path, conditional:** ask Affinidi for W1 now; verify W2's feasibility in M2; build W4 only if neither is available by M3. **M3 does not start until D2 is chosen and its wake test passes on Affinidi (M2c).**

## 4. Workstreams

### 4.1 Push gateway

- **The Credo mediator keeps ringing until M5,** through today's webhook (patch 0003, `{connectionId, fcmToken}`), including on its M1 host. Its two fixes move with it, either as the same read-only mounts or as a patch in the image build. Two upstream changes would remove the need for a local patch; both are drafted and not opened:
  - (a) the loader also starts on `webhookUrl`;
  - (b) an opt-in `PUSH_NOTIFICATIONS__WEBHOOK_REQUIRE_DEVICE_TOKEN`.
- **Banner stacking.** Each message wake carries its own collapse id, `keyring-msg-<uuid>` (patch 0003, `message_wake.rs`), so one exchange can leave several OS notifications on a phone. A stable per-handle collapse id for message wakes makes a new wake replace the previous one (gateway patch 0005, one line; the `keyring-msg-` prefix that AppDelegate.mm routes on still matches). *Done when* one exchange leaves exactly one message notification per phone, and the tap still routes correctly.
- **On Affinidi (D2), the gateway gains a second wake source.** W1, W4 and W5 would post `{did_hash}`; W2 uses the existing `push/wake/0.2` trigger path. Either way, phones register their handle **with the gateway** for each of their DIDs. The Affinidi mediator has nowhere to keep a handle, and did:peer rotation means several DIDs per phone (INFERRED).

### 4.2 The Affinidi mediator's hook points (for W1, W4 and W5)

READ at `5558061`:
- **One choke point.** `src/messages/store.rs` `_store_message` (:23) and `store_forwarded_message` (:333) check `streaming_is_client_live`, publish live if the client is connected, then store into Redis `RECEIVE_Q:<sha256(did)>` (conf/atm-functions.lua:62-65).
- **The mediator is embeddable.** `MediatorBuilder::store(Arc<dyn MediatorStore>)` (src/builder.rs:298); the trait is at mediator-common store/mod.rs:338.

W4 (INFERRED): a small wrapper binary builds the mediator with a decorated `MediatorStore`. Its `store_message` POSTs `{did_hash}` to the gateway when the recipient isn't live, and it delegates everything else. An upstream hook (W1) would sit at the same two call sites.

*Done when*, whichever D2 option is chosen:
- a message to an offline phone produces exactly one wake;
- a message to a live (socket-connected) phone produces none;
- a message to a phone with no registered handle sends nothing to the gateway.

### 4.3 DIDComm v2.1: app impact

- **New mailbox config.** Bake the Affinidi mailbox (DID and URL) for Keyring ↔ Keyring, and turn v2 on by default instead of behind the developer flag. **Store build:** these are react-native-config values (scripts/release/tier.mjs:63, READ).
- **Mediation, in `useBCAgentSetup.ts`.**
  - New contacts use the ATM socket through `VtiMediatorTransport`, which the app already uses for agents (bifold VtiMediatorTransport.ts:1-38, READ). It needs per-phone accounts and ACLs (M3).
  - Existing contacts keep v1 on the Credo mediator until M5.
  - **Store build:** `useBCAgentSetup.ts` is a migration path (tier.mjs:39-46,74, READ).
  - The already-wired `MEDIATOR_V2_URL` + Coordinate Mediation 2.0 + Pickup 4.0 path (useBCAgentSetup.ts:106-134) targets a Credo v2 mediator. It isn't the target under D1, and it's removed once unused.
- **Wake registration.** `set-device-info` is v1-only (mediatorDeviceInfo.ts:29,57, READ). On Affinidi the phone registers its handle per DID with the gateway (W1, W4, W5) or allowlists its contacts as triggers (W2); see D2.
- **Invitations.** New invitations become OOB 2.0 on did:peer:2 (vrc-manager.ts:2701-2739, READ). The QR leg for v2 invitations is unmeasured (didcomm_v2_subtask.md Q5). A share-link option next to the QR carries the same invitation and sidesteps QR density.
- **Existing contacts** stay on v1 until re-invited. v1 is removed only after a release cycle with no rollback (didcomm_v2_subtask.md, the v1/v2 coexistence rule).
- **Unchanged:** approval wakes (`device/set-wake` → gateway), the gateway's `push/register`, and the AppDelegate tap routing (INFERRED from the push files listed in the companion).

### 4.4 OTA

- **A mailbox move is never OTA.** The new mailbox config is a react-native-config value, mediation setup is a migration path, and re-provisioning changes stored data (scripts/release/tier.mjs puts each in the store tier, READ). M4 and M5 ship as store builds.
- **After the store build that ships the config,** OTA can carry JS-only follow-ups: tap routing, the share link, invitation UI (INFERRED).
- **The OTA server itself is unaffected.** It is already on the managed infra (READ, live 2026-10-20).

## 5. Phases

**No phase starts, M0a included, until the blocker in §6's first row is cleared.**

| Phase | What | Ships as | Done when |
|---|---|---|---|
| **M0** | Close the loose ends of the interim patch: run the privacy control; banner collapse (gateway patch 0005) | gateway patch | The privacy control passes (§7); one message notification per exchange per phone |
| **M1** | Move the Credo mediator (v1, image `375518d`) from the legacy host to the managed infra, keeping its postgres pickup DB, the same askar store and keys, and the same public hostname. **"As-is" includes the message-wake setup:** `PUSH_NOTIFICATIONS__WEBHOOK_URL` in its env, plus the two one-line fixes (§2), either as the same read-only mounts or as a patch in a managed-infra image build. Without them, message notifications stop silently on the move | infra only, no app build | DNS cut-over with the same mediator DID and keys; existing phones keep working with no reinstall; the mediator logs `Initializing push notification sender on queued messages…`; **positive test:** a backgrounded phone gets one wake for a peer message (the gateway's `wake delivered` +1); **privacy control** passes; the legacy container is stopped; rollback (DNS back) is tested |
| **M2** | Evidence on Affinidi, with a staging pair of phones: wallet ↔ wallet chat and a VRC exchange through the Affinidi mediator; W2's trigger feasibility; Affinidi's answer on W1; the QR and share-link invite | spikes, no release | A dated companion with measured results; D2 decided |
| **M3** | The Affinidi mailbox for phones on the managed infra: phone accounts, ACLs, the Redis-resubscribe fix (`878301bd`, absent from the deployed build), queue caps sized for phones, and the D2 wake path | infra (+ the W4 binary if chosen) | The §4.2 checks pass; phones receive forwarded messages |
| **M4** | App: v2 on by default, the new mailbox config, provisioning, and wake registration for v2 | **store build** | A fresh install uses v2 for new contacts; old contacts still chat on v1; both wake paths deliver |
| **M5** | Retire v1: re-invite or migrate contacts, remove v1 provisioning, decommission the Credo mediator | **store build**, after a release cycle with no rollback | No v1 traffic for one cycle; the Credo mediator is shut down |

### 5.1 Extension phases (review additions)

Added after review of this draft. Detail, evidence and acceptance checks per row are in the [extension notes](mediator-migration-plan/2026-10-21-bam-extension-notes.md) (E1 to E16); owners are TBD. The "Runs" column gives the order: a row never starts before what it names, and a phase named under "blocks" does not start until the row is done.

| Phase | What | Runs | Done when |
|---|---|---|---|
| **M0a** | Run the privacy control on the legacy host; set an owner and date for M1 (E15, E16) | first; blocks M0, M1 | Control passes and is recorded; M1 has a named owner and a date |
| **M0b** | Redis-resubscribe fix `878301bd` for the gateway VM's mediator: pull forward as its own gateway-image change, or accept the risk in writing until M3 (E13) | before M1 | The fix is live (new `-pN` tag), or the accepted risk is recorded here with a date |
| **M1a** | Credo mediator custody and cutover: dump and checksum postgres and askar state; keys via Secret Manager only; the two fixes as a built image patch, not bind mounts; restore test on a scratch host; DNS TTL lowered, legacy host frozen, downtime bound stated (E4) | part of M1, before the DNS flip | Restore test passes with the same mediator DID; measured downtime is within the stated bound; messages queued during the switch are accounted for |
| **M1b** | Observability: dashboards and alerts per mediator (queue depth, connected sockets, error rate); a per-connection last-seen counter on the Credo mediator, defining "no v1 traffic" (E14, E2) | before M1 flip; M3 repeats it for Affinidi | The counter and alerts exist and a test message moves them |
| **M2a** | Witness spike: verify the deployed witness mode; decide (a) an Affinidi or v2 mediation path for the witness, or (b) direct mode on a public HTTPS endpoint; rerun `yarn e2e:vrc:witnessed:android-only:mediator` against Affinidi (E1) | in M2; blocks M3 | Mode verified and recorded; (a) or (b) chosen with a passing witnessed exchange |
| **M2b** | Scale and lifecycle evidence: offline pickup after hours, reconnect, queue-cap hit, many contacts (one socket per DID), battery and socket count under did:peer rotation; the did:peer and wake-handle lifecycle spec; W2 feasibility (E7 to E9) | in M2; blocks M3 | Measured results in a dated companion; lifecycle spec and test written; W2 passes only if `set_wake_device` accepts contact DIDs and the gateway's per-trigger cap stops one contact using the phone's 30 s budget, else W2 is dropped |
| **M2c** | Decisions gate: D2 chosen with its wake test passing on Affinidi; mailbox placement (E5); minimum supported build and end-of-life date (E6); per-phase rollback table (E3) | M2 exit; blocks M3, M4 | Each decision recorded in this plan with a date |
| **M3a** | Mailbox placement as decided in M2c: a separate mediator instance, or the gateway VM with sizing, alerts and backups; recorded as a security-posture change. Infra-repo rules apply: additive `kpush-*` resources, and any new patch gets a new `<commit>-pN` image tag (E5) | in M3 | Approvals and wakes still work with the mailbox load running; a mediator outage test shows the stated blast radius |
| **M3b** | Queue limits for offline phones: per-peer and receive caps set, refusal versus drop defined at the hard cap, a user-visible sender error, a tested refusal path (E10) | in M3 | A phone offline N days (N set here: TBD) receives its mail on return, or the sender sees the defined error |
| **M3c** | Affinidi-compatible local mediator for dev and CI (extend `scripts/openvtc/local-vti-stack`); witness acceptance check on Affinidi (E12, E1) | in M3, before M4 | Dev and CI can run a wallet-to-wallet exchange locally on Affinidi; the witnessed exchange passes on the M3 mailbox |
| **M4a** | Make M4 reversible and bounded: ship behind a remote flag, or keep Credo `MEDIATOR_URL` as a fallback in the build until M5; build the in-app contact migration or re-invite flow; enforce the minimum supported build (E3, E2, E6) | in M4 | Flag or fallback proven by switching a test phone back; migration flow works on a two-phone test; old builds below the minimum see a forced-update screen |
| **M5a** | Contact migration and sunset: dated, user-visible notice; policy for un-migrated contacts and in-flight messages; gate "no witness uses Credo"; gate "no v1 traffic" as defined in M1b for one full cycle (E2, E1) | before the Credo shutdown | Gates measured and recorded; notice live for the stated period |
| **M5b** | Cleanup and retention: the config-sprawl checklist (E11); Credo DB and key backups kept for a stated period after shutdown (E3) | after the Credo shutdown | Checklist complete; backup retention period and deletion date recorded |

### 5.2 Rollback

Every phase that changes something users depend on has a written way back before it starts. This section is the per-phase rollback table that M2c requires (E3). M2c records it as decided, with owners and dates, before M3 or M4 starts.

**When to roll back.** Any one of these stops the current phase and starts its rollback:
1. **The privacy control fails:** roll back at once.
2. **The positive wake check fails for more than 10% of test wakes** in any hour after the switch.
3. **A message is lost:** sent between two online test phones and not received within 5 minutes.
4. **Mediator restarts or error rates exceed the pre-switch baseline** for an hour.
5. **Tester reports of "couldn't reach its message service" rise above the pre-switch baseline** within 24 hours of the switch.

**Who decides.**
- **Inside an infra-only phase:** the infrastructure maintainer may roll back immediately.
- **App phases (M4, M5):** the product owner decides.

Either way, the rollback and its reason are recorded in a dated companion the same day.

**The rules that make rollback possible:**
- **Nothing is deleted from the old side** until the phase has passed its rollback window. The old host, database, keys and image stay frozen, not destroyed.
- **Cut over at a measured low point** of queue depth, after recording the queue depth on both sides.
- **The old side is read-only and drained, never discarded.** After a cut-over, messages it still holds are delivered or exported before it is stopped.
- **A rollback is rehearsed before the forward switch,** on the same path, in the same phase.

| Phase | How to roll back | What can be lost | Rollback window | Rehearsed |
|---|---|---|---|---|
| **M0** | Redeploy the previous gateway image tag | Nothing | Until M1 starts | Previous tag kept |
| **M1** | DNS back to the frozen legacy host. The TTL was lowered beforehand (M1a), so the switch takes minutes | Messages accepted by the new host after the switch: exported and replayed to the legacy host, or delivered before the flip back. Nothing is accepted on both sides at once | 7 days (the mediator's message expiry) before the legacy host is stopped | Yes, the M1a restore test plus one DNS flip and flip back on the scratch host |
| **M2** | Nothing to roll back (spikes only) | — | — | — |
| **M3** | Disable the phone accounts on the Affinidi mediator. No shipped app uses it yet | Nothing user-facing | Until M4 ships | Yes, as part of M3c |
| **M4** | Turn the remote flag off (or the built-in Credo fallback, M4a), so new contacts are made on v1 again. Contacts already made on v2 during M4 keep their Affinidi mailbox; if that mailbox is down, their messages wait there until it returns or the pair is re-invited | Delivery for v2 contacts made during M4, until the mailbox returns or they are re-invited. The plan accepts no silent loss: the app shows those contacts as "waiting for the new message service" | One release cycle | Yes, M4a's test phone switched back |
| **M5** | **None.** Once the Credo mediator is shut down, the only way back is restoring its database and keys from the M5b backups. That is why M5 starts only after its gates pass | Anything not migrated, by design gated to zero by M5a | Backups kept for the period recorded in M5b | Restore of the backup tested once before shutdown |

## 6. Blocked on

| Item | Status | On whom |
|---|---|---|
| **The wallet-host and short-link change on the managed infrastructure** (infrastructure repository #20, merged 2026-10-24) | merged, **not deployed**; the apply, the VM sync and the DNS change are maintainer-only | the infrastructure maintainer. **Blocks every phase of this plan** |
| D2 (who rings) | not decided | the product owner, after M2 |
| W1: an upstream hook | not asked yet | the product owner's OK to ask Affinidi |
| The privacy control | not run | the product owner (two phones, about 5 minutes); blocks M0 |
| M1 scheduling | not scheduled; owner and date TBD (M0a) | the infrastructure maintainer |
| W3 | waiting | VTI-Q52 upstream |
| Upstream Credo changes (a) and (b) | drafted | the product owner's OK; they matter only until M5 |

## 7. Acceptance checks used throughout

- **Positive:** a peer message to a backgrounded phone gives one notification within about 10 s, and the gateway's `wake delivered` counter moves.
- **Privacy control:** a message to a connection or account with no registered handle sends **nothing** to the gateway (the mediator log, plus unchanged gateway wake counters).
- **Approvals unchanged:** one shared notification, and the tap goes to approvals.
- **Existing installs** keep working across every infra-only phase without a reinstall. M4 and M5 are store builds, so for them this holds only inside the minimum-supported-build policy (M4a, M5a).
