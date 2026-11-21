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

The mailbox runs on its own VM, `kpush-mailbox` (D-M3-4, decided 2026-11-21), with its own static IP, data disk,
snapshot policy, Redis, Caddy and hostname, all additive `kpush-*` resources in the push gateway's infrastructure
repository. Not the gateway's VM: opening sign-in to phones is a posture change for that mediator (today no stranger
can hold a session), and phone mail on a 2 GB VM shared with the gateway puts the push path's memory at the mercy of
the mailbox's queue. The gateway's mediator stays exactly as it is. The hostname is the infrastructure reviewer's
choice, from the servers already in use; the mediator's identity follows from it and never changes.

### 3.2 The image

Built the way the gateway's is (an image pushed by an operator, pulled by commit tag), from the wallet repository's
`deploy/keyring-messaging/mailbox/Dockerfile`:

- **`affinidi/affinidi-messaging-mediator` v0.53.0** (`f6ed8159`), the mediator's own repository since it left
  `affinidi-tdk-rs` (its #949, 2026-10-14; the `affinidi-tdk-rs` pin no longer holds the mediator). It carries the
  Redis-resubscribe fix and the wake protocol (§3.5). Pinned in `scripts/openvtc/PINS.json`.
- Features: upstream's defaults (DIDComm, TSP, Redis, jemalloc, VTA) plus `secrets-gcp`. No DIDComm v1 (D-M3-3,
  decided 2026-11-21): the mailbox is v2-only, and the current v1 mediator keeps running for v1 phones.

### 3.3 Phone accounts and ACLs

A phone signs in as its mailbox DID only; contact DIDs never sign in. Sign-up is **open** (D-M3-1, decided
2026-11-21, self-service): `mediator_acl_mode = "explicit_deny"`, and any DID that completes the sign-in challenge
gets an account with the default ACL, in full:

`DENY_ALL,LOCAL,SEND_MESSAGES,RECEIVE_MESSAGES,RECEIVE_FORWARDED,ANON_RECEIVE,SEND_FORWARDED_CHANGE,MODE_EXPLICIT_DENY`

Six rights, measured in S2 on v0.53.0 (the deploy package's README, "Evidence"), two more than this plan first listed:

- `ANON_RECEIVE`: a phone's send is a routing/2.0 forward whose attachment is Credo's standard anoncrypt wrap for the
  recipient mailbox's key; without it the recipient's account refuses the delivery ("recipient is not accepting
  anonymous messages"). The forward's outer sender is still an authenticated, rate-limited account.
- `SEND_FORWARDED_CHANGE`: the mediator admits a forward only from an account holding `SEND_FORWARDED`, so each phone
  turns that right on for itself at open, with a signed `messaging/account/update` naming its account key (the sha256
  of its DID), confirmed by the mediator's answer (bifold `walletMailbox.ts`). In the steady state every account
  holds `SEND_FORWARDED`.

So the default ACL is not what keeps the mailbox from being a relay. That rests on `external_forwarding = "false"`
(a forward whose next hop has no account here is refused, S2 row B) and on the anonymous-envelope checks (an
unauthenticated `POST /inbound` is refused, rows R1 and R2, even with `SEND_FORWARDED` in the default). `SEND_FORWARDED`
stays out of the default for one reason: in the default it opens the unauthenticated `/inbound` to authcrypt
forwards from any DID (the inter-mediator relay session). The other bounds on an open sign-up: per-DID rate limit
20/s with burst 10 (60 requests in a burst: 10 admitted, 50 refused), the per-IP limit behind Caddy with
`trust_xff_cidrs` naming Caddy (so phones are bucketed by their own address, S2 row D), queue caps and the 7-day
expiry (§3.4), Trust Task proofs enforced, inter-mediator relay off. A cleanup of inactive accounts
(`messaging/account/remove`) is a follow-up; testers' numbers do not need it.

The **enrolled** model stays written down as the fallback: `mediator_acl_mode = "explicit_allow"`, with an enrolment
service holding the mediator's admin account and adding each phone's (in that mode only an admin may add accounts).
Switching from open to enrolled is a config change across a restart: existing accounts keep signing in and a new DID
is refused at the challenge (S2 row E, with Redis append-only persistence).

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

The mediator's own wake protocol (D-M3-2, decided 2026-11-21): `affinidi-messaging-mediator` #276 (in v0.52+),
`messaging/wake/set` and `messaging/wake/request`, ringing `push/wake/0.2` at a push gateway.

- The phone leaves its push-gateway handle at the mediator with `wake/set` when its mailbox opens, or later when the
  handle exists (bifold `walletMailbox.ts`, `setMailboxWakeHandle`); the mediator answers `wakeCapable` when it holds
  the handle and can reach the gateway's DID.
- After each mailbox send, the sender sends the recipient's mediator a signed `wake/request` naming the stored message
  ids. The id is the sha256 of the inner JWE's exact bytes, so the forward carries it as a base64 attachment (a
  `data.json` attachment is re-serialised by the mediator and its id is not the sender's). On the mailbox path only;
  the VTA path keeps its attachment shape.
- The mediator rings the gateway, once per message, only when the recipient has a handle, the message is stored,
  undelivered and under ten minutes old, the request's sender is the message's sender, the recipient has no live
  connection, and the limits allow (one per minute and ten per day per pair; coalesced over 15 s and 30 per hour per
  recipient). The gateway rings only if the mailbox mediator's DID is on the handle's allowlist, which the phone's
  linked agent sets from the phone's suggested triggers: the wallet adds the mailbox mediator's DID to them.

Measured in the lab on v0.53.0 with a stand-in gateway (an account on the same mediator): one ring with the right
payload and the mediator's signature, none for an online recipient, none without a handle (S2 rows W1-W4). The real
gateway path, the push gateway at its pinned version and a phone's agent provisioning the allowlist, is S6.

Not chosen: W1 (asking upstream for a store-time hook: upstream's protocol exists), W4 (a store decorator). The
traffic monitor's `stored`-without-`delivered` signal (W5, a sidecar with an admin account) is a fallback for senders
that do not send `wake/request`; it is not built for S7.

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
| **S0** | Re-run the lab rows (two and three wallets, store-and-forward, wake gap, Discover Features) on a local build of the image of §3.2 | Done 2026-11-21 on v0.53.0: the mailbox rows pass (12 of 12 with the S2 rows; the deploy package's README), as they did on `c0a69f1e` (2026-11-20) |
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

All four were taken on 2026-11-21 (the dated companion of that day has the reasons):

- **D-M3-1, account model:** open sign-up (self-service, §3.3), with the limits there. The enrolled model is the
  written fallback; an enrolment service and app attestation are not built.
- **D-M3-2, wake:** the mediator's own wake protocol (§3.5). The monitor-feed sidecar is a fallback only.
- **D-M3-3, DIDComm v1 on the same mediator:** no. The mailbox is v2-only and the current v1 mediator keeps running.
- **D-M3-4, placement:** its own VM, `kpush-mailbox`, in the push gateway's infrastructure repository (§3.1).

Still open: whether the mailbox VM's logs leave the VM (a project-level grant the infrastructure repository's rules
refuse today; for now logs stay on the VM and a synthetic live-delivery probe is the interim watch, §3.6).

## 6. Blocked on

- S3 and S4: the infrastructure reviewer's review, his hostname, and the owner's word for the apply, the image push,
  DNS and the identity (the runbook in the infrastructure repository).
- S6: the real gateway path, after S4.
- S7: S6b being built or, as decided for the first tester build, skipped with the mailbox host kept up while any
  tester holds a mailbox contact; the `MAILBOX_MEDIATOR_DID` repository secret (the owner's word) after the identity
  exists; a store build (the owner's word).
- M4: S8 and M3c (the witness accepting the mailbox mediator, a row after the first tester build).
