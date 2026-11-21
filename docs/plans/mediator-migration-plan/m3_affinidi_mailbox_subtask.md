# M3: Keyring's own Affinidi mediator as the phones' wallet mailbox — subtask plan

*Parent: the mediator migration plan, `docs/plans/mediator-migration-plan.md` on branch
`docs/mediator-migration-plan` at `8a75531b` (not yet on `main`); this document owns its M3 row and the M3a/M3b
extension rows, and M3d. Reasoning and evidence: [`2026-11-21-al.md`](./2026-11-21-al.md). Related:
[`../openvtc-integration-plan/didcomm_v2_subtask.md`](../openvtc-integration-plan/didcomm_v2_subtask.md) §7.2 (the
wallet mailbox design this hosts).*

**Status:** draft for review. **Owner:** product owner. **Implementing roles:** gateway-infra, mediator, app.
**Not a deploy:** every apply, image push, DNS change, secret and account change below is the product owner's word.

**Evidence labels:** **READ** = seen in source at the stated commit; **MEASURED** = run in the local lab;
**INFERRED** = reasoning. Infra read at `keyring-push-gateway-infra` `1da3f82ed5f7`; the mediator's deploy files
(Dockerfile, `mediator.toml`, compose, Caddyfile) at the wallet repo's `deploy/keyring-messaging/` as pinned by the
infra's `package_ref` `064c7b95` (identical to wallet `main` there); the mediator at `affinidi-tdk-rs` `55580615`
(deployed, v0.33.1) and `c0a69f1e` (2026-10-03, the last commit before the mediator moved to its own repository).

## 1. What M3 delivers

A phone opens one wallet mailbox (bifold `walletMailbox.ts`): a `did:peer:2` that signs in at an Affinidi mediator
over ATM, holds one Pickup 3.0 live socket, and receives every v2 contact's mail through it. M3 is that mediator,
run by Keyring on its managed infrastructure, open to phones, with a wake path, monitoring and backups. The app side
already exists and is off: it opens the mailbox only with the Developer "DIDComm v2 mailbox" switch on and
`MAILBOX_MEDIATOR_DID` set, and that value is blank in every build (wallet #955). M3 ends when testers can turn the
switch on against it (S7). M3d (transport order and large frames) is S8 here and gates M4, not S7.

Not M3: v2 invitations on by default for everyone (the build after load is measured, which also drops the switch),
and the Credo mediator's retirement. M3c (an Affinidi-compatible local mediator for dev and CI, and the witness
acceptance check) stays with the parent plan's M3c row; this document does not plan it.

## 2. What exists today (READ)

- **One Affinidi mediator, the push gateway's.** VM `kpush-gateway` (e2-small, 2 GB) runs the gateway, the mediator,
  Redis and Caddy together (`infra/environments/prod/compute.tf:161-245`). Image built in CI from `affinidi-tdk-rs`
  at `55580615` with `--features tsp,secrets-aws` on top of the defaults (`deploy/keyring-messaging/mediator/Dockerfile:28-49`),
  pushed by an operator, pulled by commit tag.
- **Closed to phones by design.** `mediator_acl_mode = "explicit_allow"`: only DIDs with an account may sign in, and
  only the admin creates accounts; the gateway's is the only one (`mediator/mediator.toml:22-25,91-92`). Caddy answers
  403 to `/mediator/v1/authenticate*` from any public address (`Caddyfile:22-35`). Compose: "phones never talk to
  this mediator" (`docker-compose.yml:9-14`).
- **No Redis-resubscribe fix.** `878301bd` ("Redis streaming resubscribes after a Redis restart") is not in
  `55580615`; it is in `c0a69f1e`. Without it a Redis restart stops live delivery until the mediator restarts.
- **No mediator monitoring.** The uptime check and alerts cover the gateway's `/healthz` only, and are off in the
  committed config (`monitoring.tf:16-117`; `variables.tf:323-332`). Nothing watches the mediator, its queues or Redis.
- **Backups:** daily snapshots of the data disk (Redis AOF included), 14 days; no separate Redis backup
  (`compute.tf:129-159`; `docs/operations.md:226-248`).
- **Runbook unproven.** "Update the mediator" is "written from the scripts and has not been run"
  (`docs/operations.md:160-181`).
- **Deploy guards:** `scripts/deploy.sh` with `tf-plan-guard.sh` refuses anything but additive `kpush-*` changes
  without explicit flags (`scripts/tf-plan-guard.sh:6-68`).

## 3. Design

### 3.1 Placement: a separate instance

The mailbox runs on its own VM, `kpush-mailbox`, with its own static IP, data disk, snapshot policy, Redis, Caddy and
hostname, all additive `kpush-*` resources. Not the gateway's VM: opening sign-in to phones is a posture change for
that mediator (today no stranger can hold a session), and phone mail on a 2 GB VM shared with the gateway puts the
push path's memory at the mercy of the mailbox's queue. The gateway's mediator stays exactly as it is.

*Conditional:* if the product owner prefers one VM, the same mediator config applies with Redis memory and disk sized
for the mailbox load, alerts on queue depth and Redis restarts, and an off-VM Redis AOF backup (parent plan, M3a).

### 3.2 The image

Built the way the gateway's is (CI artifact, pushed by an operator, pulled by commit tag), from the same
`deploy/keyring-messaging/mediator/Dockerfile` with a different `MEDIATOR_COMMIT`:

- **`c0a69f1e`**, which carries the Redis-resubscribe fix and is 20 commits after the deployed version, and is the
  build the lab ran (§4). Later releases are in the mediator's own repository (`affinidi-tdk-rs` #949 moved it);
  moving there is a separate pin decision.
- Features `tsp,secrets-aws` as deployed, plus the outcome of decision **D-M3-3** (DIDComm v1).

### 3.3 Phone accounts and ACLs

A phone signs in as its mailbox DID only; contact DIDs never sign in. What a phone's account needs: `LOCAL` (mail
between accounts on this mediator), `SEND_MESSAGES`, `RECEIVE_MESSAGES`, `RECEIVE_FORWARDED`. Not `SEND_FORWARDED`
(relaying onward to another mediator), so the mailbox is not an open relay. The exact minimal set is measured, not
assumed (§4, S2): the lab ran `ALLOW_ALL`.

How an account comes to exist is decision **D-M3-1**:

- **(a) Self-service:** `mediator_acl_mode = "explicit_deny"` with a `global_acl_default` granting the set above, so
  any DID that completes the ATM challenge gets an account. Simplest; the mailbox host's public sign-in is open, and
  abuse is bounded by per-account queue caps and the absence of `SEND_FORWARDED`.
- **(b) Enrolled:** `explicit_allow` as today, and an account created for each phone by an enrolment step (the admin
  tool `mediator-account`, driven by a service the phone already talks to). Closed to strangers; needs that service
  and a path for the phone to ask.

`global_acl_default` is a whole ACL string, not a list of grants: a `DENY_ALL` base, the grants, and a trailing
`MODE_*` flag. The deployed one is `DENY_ALL,LOCAL,SEND_MESSAGES,RECEIVE_MESSAGES,RECEIVE_FORWARDED,MODE_EXPLICIT_DENY`
(`mediator.toml:92`, under `mediator_acl_mode = "explicit_allow"` at `:91`). How an account's own `MODE_*` flag combines
with `mediator_acl_mode` is read in source and measured in S2 with the rights, and the mailbox's string is written in
that full form.

Either way, the mailbox host's Caddy does not refuse public `/authenticate` (it is the phones' sign-in), and
`cors_allow_origin` is set in the `[security]` table (VTI-06), since React Native sends an `Origin` header on the
WebSocket upgrade (VTI-05). VTI-05's upstream resolution changed documentation and tests, not behaviour: a phone's
`Origin` is still admitted only if the policy admits it, so the setting stays required.

### 3.4 Queue limits for phones

Deployed limits: `queued_send_messages_per_peer = 50`, receive 200 soft / 1000 hard, expiry 7 days
(`mediator.toml:117-136`). A phone offline for days must not lose mail silently. What the mediator does at the hard
cap, refuse the message or drop it, is not yet read (the parent's M3b row and E10 leave it open), so M3 defines it and
tests it: S5b pushes a phone past the hard cap and checks that the sender is told, with a user-visible error, rather
than the message vanishing. The values are set from the soak (S5), not guessed.

### 3.5 Wake

The Affinidi mediator calls nobody when it stores for an absent recipient (READ at `55580615`; MEASURED: a local
webhook sink saw 0 calls while a message waited for an offline wallet). The wake path is decision **D-M3-2**, from the
parent plan's D2:

- **W5, a Redis sidecar (lead):** subscribes to keyspace notifications for `RECEIVE_Q:*` on the mailbox's own Redis
  (MEASURED: `RECEIVE_Q:xadd` fires when a message is stored for an offline wallet), checks the recipient is not
  live (`GLOBAL_STREAMING`), and posts a wake to the gateway for the mailbox DID's push handle. The gateway already
  takes mediator wakes (`POST /mediator-webhook/<secret>`, rate-capped per handle); it needs the mailbox DID → handle
  mapping, registered by the phone with the gateway as it registers its other DIDs. Couples to Redis key names rather
  than a contract, so every mediator upgrade re-runs the wake test.
- **W4, a store decorator:** a wrapper binary around `MediatorBuilder` whose `MediatorStore` posts on an offline
  store (the parent plan's §4.2 choke point). Robust and supported; ours to maintain.
- **W1, an upstream hook:** asked of the mediator's maintainers; nothing to build here if it comes.

Done when: an offline phone gets exactly one wake per waiting message burst (the gateway's 30 s cap), a live phone
gets none, and a phone with no registered handle causes nothing to be sent.

### 3.6 Monitoring and backups

- An uptime check on the mailbox host's `/mediator/v1/livez` and `/readyz`, with alerts on: down for 10 minutes;
  Redis restarted; receive-queue depth past the soft cap for any account; container restarts.
- The data disk's daily snapshots (as the gateway's), plus an off-VM copy of the Redis AOF on the same schedule as
  `backup-store.sh`, since Redis holds the accounts, sessions and every waiting message.
- The mailbox mediator's keys as versioned Secret Manager copies, as the gateway's. Losing every copy means a new
  mediator DID, and every phone's mailbox DID names the old one: written down as the one unrecoverable loss.

### 3.7 App wiring

Today the store build's workflow (`staging.yaml`) writes no `MAILBOX_MEDIATOR_DID` line, so the value is absent
there rather than emptied. It still writes the retired `MEDIATOR_V2_URL` from a repository secret of that name
(`staging.yaml:372,391,958,973`), which the app no longer reads. S7 replaces those lines with `MAILBOX_MEDIATOR_DID`
from a new repository secret holding the mailbox mediator's DID (a new secret is the product owner's word). The
Coordinate Mediation 2.0 retirement's last step also removes the retired lines; whichever change lands first removes
them, and the other finds them gone. OTA and test builds keep writing it empty by
explicit lines until testers are meant to reach it from those builds. Testers first: the Developer switch gates it
(wallet #955).

## 4. Steps and acceptance

| Step | What | Done when |
|---|---|---|
| **S0** | Re-run the lab rows (two and three wallets, store-and-forward, wake gap, Discover Features) on a local build of the image of §3.2 | The rows pass on that commit, as they did on `c0a69f1e` (2026-11-20): this is the parent's M2 evidence for the mediator half |
| **S1** | Decisions D-M3-1..4 (§5) | Each recorded, with its reason, in a dated companion |
| **S2** | Phone account rights, measured | The lab passes with the minimal set of §3.3 and fails a control with one right removed; the account model of D-M3-1 is exercised end to end |
| **S3** | Infra change for `kpush-mailbox` (§3.1, §3.6) | `deploy.sh plan` shows additive `kpush-*` only and `tf-plan-guard.sh` passes without override flags; reviewed; applied on the product owner's word |
| **S4** | Image built and pushed (§3.2); mediator identity and the admin DID provisioned | `livez` and `readyz` answer on the mailbox host; a phone-shaped client signs in and holds a socket |
| **S5** | Soak: 24 h of simulated phones (the lab harness against the real host) | Memory per message, sockets per phone (one by design), Redis memory and queue depths recorded; §3.4's limits set from them; no unbounded growth |
| **S5b** | Refusal at the hard cap (§3.4, the parent's M3b and E10) | A phone held offline past the hard cap: the mediator's behaviour is recorded, and the sender's phone shows a user-visible error for the refused message; control: below the cap, the message is delivered and no error shows |
| **S6** | Wake (D-M3-2) | The three "done when" checks of §3.5 pass against the real gateway path, with a control |
| **S6b** | Mailbox contacts with no mailbox open (app) | With the switch off or no mailbox mediator configured, a contact made through the mailbox shows as "waiting for the new message service" (the parent's M4 wording), and a send to it is refused on screen rather than lost; the contact's history and record stay. Control: with the mailbox open, the same contact sends and receives. Needed because only the mailbox's own transport carries a send to such a contact, and it is registered only when a mailbox opens |
| **S7** | Tester build: `MAILBOX_MEDIATOR_DID` set in the store build (§3.7); needs S6b in that build | Two testers' phones with the switch on connect, chat and exchange a VRC both ways through the mailbox; one stays offline and is woken; one turns the switch off and sees S6b's waiting state |
| **S8** | M3d: transport order and large frames (the parent's M3d row) | The mailbox mediator's service order is recorded; if WebSocket is first or alone, ten queued 256 KiB photos (about 6 MB) arrive on an Android phone and an iPhone, or a batch cap is in place and the frame it allows arrives. Gates M4, not S7 |

Rollback at any step before S7: stop the mailbox VM; no build points at it.

After S7, rollback has M4's shape, not M3's, because testers' phones hold contacts made through the mailbox. Turning
the switch off, or blanking the secret in the next build, stops new mailbox contacts: new invitations are v1 again.
It does not move the existing ones. A contact made through the mailbox can be reached only through it, so with no
mailbox open those contacts show S6b's waiting state until the mailbox opens again or the pair is re-invited over
v1; no message is lost silently. The mailbox host therefore stays up after S7 rollback while any tester holds such
contacts, so mail already queued for them is still collected (it expires after the queue's 7 days, §3.4). Stopping
the host after S7 is the product owner's word, once those contacts are re-invited.

## 5. Decisions for the product owner

- **D-M3-1, account model:** self-service (a) or enrolled (b), §3.3.
- **D-M3-2, wake:** W5 (sidecar), W4 (decorator) or W1 (wait for upstream), §3.5. W5 is the lead; it is a design only
  once S6 passes on the real gateway path.
- **D-M3-3, DIDComm v1 on the same mediator:** the mediator carries DIDComm v1 mediation (Coordinate Mediation 1.0 and
  Pickup 2.0, `src/messages/v1_mediation.rs`) behind the `didcomm-v1` cargo feature and a configuration switch that
  defaults to off. Turning it on would let one mediator serve v1 phones too, the path to retiring the Credo mediator.
  It changes in this repository: the cargo features in `deploy/keyring-messaging/mediator/Dockerfile` and the switch in
  that mediator's `mediator.toml`. Not needed for M3; measured in the lab (one row with the feature on) before it is
  decided.
- **D-M3-4, placement:** a separate instance (§3.1, recommended) or the gateway's VM with the conditions listed there.

## 6. Blocked on

- S3 onwards: D-M3-1, D-M3-2 and D-M3-4.
- S7: S6b in a build, the new repository secret, and a store build.
- M4: S8 (M3d), and the parent's M3c.
- The parent plan's infrastructure blocker (its §6) is the parent's; whether it still stands is not re-checked here.
