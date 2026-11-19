# 2026-10-21: extension notes for the mediator migration plan

Parent: [`../mediator-migration-plan.md`](../mediator-migration-plan.md), §5.1 "Extension phases (review additions)". Earlier companion: [`2026-10-20-al.md`](2026-10-20-al.md).

These notes carry the detail behind the extension rows. Each issue below gives the rationale, the evidence, the acceptance checks and the open questions. Owners are TBD throughout: the plan's owner assigns them.

**Evidence labels:** **READ** means seen in source at the stated commit, with `file:line`; **INFERRED** means reasoning; **UNVERIFIED** means a claim carried from another review or doc that was not re-read here.
- Wallet sources: PR #530 head `b2708a90` (it sits on `origin/main` `b41d148a`). Lines below are in that tree unless a repo is named.
- keyring-bifold `783cadf` (the witness server). In the PR tree the `bifold` submodule is not checked out; the bifold files below were read from a separate clone at `783cadf`. The plan's own bifold pin is `13ff3c1a`, so the witness lines may differ at that pin.
- Infra repo: `keyring-push-gateway-infra` on `main`, read for its rules (its top-level instructions file) and its Terraform files.

Where this note and the plan's own line references disagree, the cited line here is the one checked against the tree above. One such case: `mediator.toml:449,476,482` in the plan are upstream sample lines (UNVERIFIED here); the repo's deployed config sets the same values at `deploy/keyring-messaging/mediator/mediator.toml:127,130,131`.

## HIGH

## E1. The witness server is on the Credo mediator and the plan never mentions it

**Rationale.** The witness is a second consumer of the Credo mediator, so retiring that mediator (M5) breaks witnessed exchanges, and nothing in the plan would catch it. Moving the phones to Affinidi also changes how the witness reaches the phones. Even in direct mode, a witnessed exchange between two v1 contacts uses the phones' own mediator.

**Evidence.**
- Mediator mode is switched on by `MEDIATOR_INVITATION_URL` (keyring-bifold `packages/witness-server/src/config.ts:498`; `isMediatorEnabled` at `:584`). READ
- In that mode the witness agent is built with Credo `mediationRecipient` and the `PickUpV2` strategy (`src/WitnessService.ts:248-252`; the constant is `PickUpV2` at `packages/vrc-shared/src/mediation.ts:59`). That needs Coordinate Mediation and Pickup 2.0 from the mediator, which the plan says Affinidi lacks (plan D1, "No Coordinate Mediation"). READ, with the Affinidi half carried from the plan
- The witness README calls a mediator REQUIRED for production with mobile wallets (`packages/witness-server/README.md:9-22`, with the configuration section at `:208-231`). READ
- The e2e mediator-mode run (`yarn e2e:vrc:witnessed:android-only:mediator`, `e2e/package.json:41`; `e2e/run-vrc-exchange-witnessed-android-only-devices-mediator.js:88` sets `WITNESS_MEDIATOR_INVITATION_URL`) resolves the production Credo mediator from `app/.env` (`e2e/lib/config.js:45`). The e2e library defaults to DIRECT mode behind an HTTPS tunnel (`e2e/lib/witness.js:118-124,196-214`). `docs/spikes/e2e-vrc-connect-findings.md:362-371` records mediator mode passing on 2026-08-18 against the production mediator. READ
- No Affinidi or ATM path in the witness: INFERRED. Not every file in the package was read; a search of `packages/witness-server/src` for the mediator settings found only the Credo one.
- **Deployed mode is UNVERIFIED.** The staging deploy is `.github/workflows/staging-witness.yaml`, which only SSHes to the host and resets the checkout (`:23-37`, no mediator setting). The mode comes from a `.env` on the server that was not read. `packages/witness-server/.env.sample:54` leaves `MEDIATOR_INVITATION_URL` commented out, which means direct mode (READ).

**Phase.** M2a (spike), M3c (acceptance), M5a (gate).

**Acceptance checks.**
1. Record the deployed mode: read the server's `.env` or the witness startup banner (`MEDIATOR (WebSocket)` versus direct), with a date.
2. M2a decides one of: (a) the witness gets an Affinidi or DIDComm v2 mediation path (new code in keyring-bifold; sized in the spike), or (b) the witness runs in direct mode with a public HTTPS endpoint (no mediator dependency; needs a certificate, a hostname and an inbound port, and gives up the README's recommendation).
3. M3c: `yarn e2e:vrc:witnessed:android-only:mediator` (or its direct-mode twin for option (b)) passes with the phones on the Affinidi mailbox.
4. M5a gate: the witness's configuration, in every deployed environment, names no Credo mediator.

**Open questions.** Which environments run a witness, and who owns them? Does a witnessed exchange between two v2 contacts need the witness to speak v2 at all? Is the e2e v2 witness switch (`WITNESS_DIDCOMM_VERSIONS=v1,v2`, `e2e/lib/witness.js:134,196`) enough to start from?

## E2. M5 has no contact migration

**Rationale.** The plan keeps existing contacts on v1 "until re-invited" (plan §4.3) and then removes v1 in M5. A contact nobody re-invited then stops working without any signal, and with it the relationship, its VRCs and witnessed contacts. The migration needs to be a feature, and "no v1 traffic" needs a measurement the Credo mediator can produce.

**Evidence.**
- Plan §4.3 "Existing contacts" and the M5 row. READ
- The Credo mediator's per-connection traffic is not exposed today: UNVERIFIED (the mediator is outside this repo; nothing in the PR tree reads its metrics).

**Phase.** M1b (the counter), M4a (the in-app flow), M5a (sunset and gates).

**Acceptance checks.**
1. A server-side per-connection last-seen counter on the Credo mediator: the time of the last message stored or picked up per connection. "No v1 traffic" means zero connections with a last-seen newer than a stated window (TBD, for example 30 days) for a full release cycle.
2. An in-app flow, shipped in M4, that offers each v1 contact a re-invite or migration to v2, with prompting (a banner and a per-contact badge), and that keeps the old v1 connection readable until the new one is accepted.
3. A dated sunset with a user-visible notice for a stated period before M5 (the dates are TBD).
4. A written policy for contacts not migrated by the sunset, and for messages in flight at the cut: for example, the contact is shown as "needs re-invite", old history is kept, and queued v1 messages are not delivered after shutdown.
5. Two-phone test: a v1 contact migrates, keeps its VRC, and sees a chat message on v2.

**Open questions.** Can a v1 connection and its VRCs be re-bound to a v2 connection in place, or must the contact be re-invited as a new relationship? What happens to a witnessed contact whose witness also moves (E1)?

## E3. Rollback is undefined beyond M1

**Rationale.** The plan's only tested rollback is M1's DNS flip. After M4 a store build carries the new mailbox configuration, and a store build cannot be recalled.

**Evidence.**
- M4 and M5 are store builds because the mailbox is a react-native-config value and mediation setup is a migration path (plan §4.4; `scripts/release/tier.mjs`). READ in the plan; the tier rules were not re-derived here.
- `app/src/hooks/useBCAgentSetup.ts:289-293` chooses the mediator from the stored preference, the build's `Config.MEDIATOR_URL` and the available list, so a build that still carries `MEDIATOR_URL` can fall back to it. READ

**Phase.** M2c (the table), M4a (flag or fallback), M5b (retention).

**Acceptance checks.**
1. A rollback table in the plan, one row per phase (M0 to M5): what is undone, how, how long it takes, what is lost, and who decides. Draft rows: M0 revert the gateway patch image tag; M1 DNS back to the legacy host while it is frozen but intact; M2 none (spikes); M3 remove phone accounts and switch the flag off, leaving the gateway DID untouched; M4 the remote flag turns v2 off, or the build's fallback mediator takes over; M5 restore the Credo mediator from the retained DB and keys.
2. M4 ships behind a remote flag, or keeps the Credo `MEDIATOR_URL` in the build as a fallback until M5. Test: switch a test phone back and chat on v1.
3. After the M5 shutdown the Credo postgres dump, the askar store and the key backups are kept for a stated period (TBD, for example 90 days), stored encrypted outside the repo, with a deletion date recorded.

**Open questions.** Is there a remote-config channel the app already reads, or is that new work? Does the OTA server, which only serves JS, qualify as that channel?

## E4. Credo mediator state and key custody for M1

**Rationale.** Phone mediation records name the mediator's DID and keys. A move that creates new keys silently invalidates every phone's mediation record, with no reinstall able to fix it short of re-provisioning. The OOB invitation carries the mediator's did:key, so it is visible to clients.

**Evidence.**
- The invitation's recipient key is a `did:key:z6Mk…` embedded in the production invitation URL (the base64 payload in `tsp-reference/ref-06v1b-mediated/run.mjs:36`). READ (the value is public by design and is not repeated here)
- The mediator stores state in postgres (the pickup queue) and an askar wallet (its keys): plan §2. The askar wallet key and the host's layout were not read (outside the repo): UNVERIFIED.
- The two interim fixes are read-only bind mounts (plan §2, §4.1), which a new host would silently lack. READ in the plan.

**Phase.** M1a, plus M0a for the privacy control.

**Acceptance checks (M1 sub-steps, in order).**
1. Run the privacy control on the legacy host, before any move (E15).
2. Freeze scope: list every file, volume and env the legacy container needs, including the two mounted fixes and `PUSH_NOTIFICATIONS__WEBHOOK_URL`.
3. Dump the postgres database and copy the askar store; record SHA-256 checksums of each in the runbook (checksums only, never contents).
4. Move key material (the askar wallet key and any mediator signing keys) through Secret Manager, pushed with the infra repo's `scripts/secret-push.sh`; never into git, Terraform state or chat.
5. Build the two fixes into the mediator image as a patch with its own tag, not bind mounts.
6. Restore test on a scratch host: start the restored mediator, confirm the same mediator DID, the same did:key in its invitation, and that a test phone's existing mediation record still works against it.
7. Lower the DNS TTL well ahead of the flip (value TBD; 300 s or less) and state an upper bound on downtime (TBD, for example 15 minutes).
8. Quiesce: put the legacy host in a freeze (stop it accepting new messages, or drain its queue), take a final dump, restore it, then flip DNS. State what happens to messages queued during the switch: the final dump must include them, and the check is a count of queued messages before and after.
9. After the flip, run the positive wake test and the privacy control again, then stop the legacy container.

**Open questions.** Where does the askar wallet key live today, and who holds it? Does the mediator's did:key derive from the askar store alone (so a restore keeps it), or from the env?

## E5. Single point of failure: phone mailboxes on the gateway VM

**Rationale.** M3 puts every phone's mailbox on the mediator that today serves only the gateway's own DID, on the VM that holds the data disk with phones' push tokens in clear text. A mediator or Redis outage then takes down approvals and messages together, and the stack becomes a bigger target.

**Evidence.**
- The gateway's mediator is `explicit_allow` (`deploy/keyring-messaging/mediator/mediator.toml:91`), and the stack's header says "phones never talk to this mediator" and that the login endpoint is reachable only inside the stack's network (`deploy/keyring-messaging/docker-compose.yml:9-14`). READ
- Redis in the stack runs with append-only persistence on a local directory (`docker-compose.yml:117-123`). READ
- The VM has `deletion_protection = true` (`keyring-push-gateway-infra/infra/environments/prod/compute.tf:168`), and `prevent_destroy` guards the data disk. READ
- The infra repo's rules: only new `kpush-*` resources are created, never touch a neighbour's; `gateway_commit`, `gateway_image_tag` and `package_ref` only move through `scripts/bump-package-ref.sh` and `scripts/gateway-update.sh`, when the project ships a new package and image; a changed image gets a new `<commit>-pN` tag, never a push over an existing tag (the infra repo's top-level instructions file). READ
- Public login is closed by Caddy (`Caddyfile:22-34`, cited by the plan; not re-read here). Opening it for phones is a posture change.

**Phase.** M2c (decision), M3a (build).

**Acceptance checks.**
1. A decision recorded in the plan: **separate mediator instance** for phone mailboxes (own VM or container, own Redis, own data disk) versus **same VM** with sizing, alerts and backups. INFERRED recommendation: separate, because the blast radius of a mailbox outage then excludes approvals.
2. Recorded as a security-posture change: what the public login now exposes, who can hold sessions, and what the ACL default is.
3. If same VM: Redis memory and disk sized for the expected mailbox load, alerts on queue depth and Redis restarts, and backups of the Redis AOF alongside the existing store backup.
4. The work goes through the infra repo's scripts and guards; any new mediator patch ships as a new `<commit>-pN` image tag. No guard is loosened.
5. Outage drill: stop the phone-mailbox mediator and confirm that approval wakes are unaffected (separate instance) or the stated impact (same VM).

**Open questions.** Does a separate instance fit the additive-only `kpush-*` rule, and does it need its own domain and certificate? Is the VM's disk sized for message queues as well as tokens?

## E6. Tier contradiction: "existing installs keep working" versus store builds

**Rationale.** D1's "existing installs keep working across every infra-only phase" is true for M0 to M3. M4 and M5 are store builds, and a phone that never updates still points at the Credo mediator, which M5 shuts down.

**Evidence.** Plan §7 last bullet and §4.4. READ

**Phase.** M2c (policy), M4a (enforcement), M5a (notice).

**Acceptance checks.**
1. A minimum-supported-build policy: the oldest build that must keep working until M5, and the build number from which v2 is on by default (numbers TBD).
2. An end-of-life date for builds below the minimum, announced in-app and through the stores, with the notice period stated.
3. A forced-update screen in builds that carry the fallback, shown once the end-of-life date has passed, tested on a phone with an old build.
4. The plan's §7 wording says which phases the "existing installs" promise covers.

**Open questions.** Does an old build have any way to learn the end-of-life date (the OTA server, a gateway message), or only the store listing?

## MEDIUM

## E7. D2 is undecided while M3 and M4 are scheduled

**Rationale.** The M3 row refers to "the D2 wake path", but D2 is decided only after M2, and W4 would be about 1,500 lines of delegated Rust (plan D2). Building M3 before D2 builds the wrong thing or nothing.

**Evidence.** Plan D2 and §5. READ. W2's premise (that `set_wake_device` accepts contact DIDs as triggers) is UNVERIFIED in the plan itself.

**Phase.** M2b (W2 test), M2c (the exit criterion).

**Acceptance checks.**
1. M2 exits only when D2 is chosen and its wake test passes on Affinidi: a message to an offline phone gives one wake, to a live phone none, and to a phone without a handle sends nothing to the gateway (the plan's §4.2 checks).
2. M3 is blocked on M2c (stated in the plan's D2 section).
3. W2 passes only if `set_wake_device` accepts contact DIDs as triggers; record the result of the call in a dated companion. W2 is dropped if the gateway's per-trigger rate cap cannot stop one contact from using the phone's 30 s wake budget (test: one contact sends a burst; the phone gets one wake per 30 s, and other contacts' wakes still get through).

**Open questions.** Does the 30 s cap apply per handle or per trigger today? Who answers for Affinidi on W1 (the plan names the product owner's OK)?

## E8. v2 wallet-to-wallet has little evidence at scale

**Rationale.** The only proof of Credo DIDComm v2 through the Affinidi mediator is the ref-18 rung at 6/6 (plan D1; `docs/plans/openvtc-integration-plan/didcomm_v2_subtask.md:305-311`, the ref-18 row). That is one agent against a public dev instance, not many phones over days.

**Evidence.** `didcomm_v2_subtask.md:305-311`. READ. Anything about phone behaviour at scale is INFERRED.

**Phase.** M2b.

**Acceptance checks.** Measured on a staging pair or more, dated, in a new companion:
1. Offline pickup after several hours (target hours TBD): messages arrive once, in order, on return.
2. Reconnect after network change and app resume.
3. Queue-cap hit: send past the per-peer and receive limits to an offline phone (E10) and record what the sender and receiver see.
4. Many contacts: one socket per DID means one per contact under did:peer; record socket count and memory with 5, 20 and 50 contacts (counts TBD).
5. Battery and socket count under did:peer rotation (E9), over a day.

**Open questions.** Is a socket per DID acceptable on iOS background limits? Can several DIDs share one session?

## E9. did:peer and wake-handle lifecycle is undefined

**Rationale.** Each contact may use its own did:peer, and rotation means several DIDs per phone. The plan has phones register their wake handle with the gateway per DID (plan §4.1), but says nothing about registering new DIDs, updating on rotation, or cleaning up when a contact is removed. Stale handles are a privacy and cost problem (wakes to dead DIDs), and missing ones are a lost-message problem.

**Evidence.** Plan §4.1 last bullet, marked INFERRED by the plan. Not tested.

**Phase.** M2b (spec and test), M3 (server side), M4 (app).

**Acceptance checks.**
1. A short lifecycle spec: when a DID is registered (contact accepted), updated (rotation: new DID registered before the old one is retired), and removed (contact deleted, or the phone is wiped), who calls the gateway, and with what retry.
2. A test: rotate a contact's DID and confirm a wake for the new DID, none for the old; delete a contact and confirm the handle is gone from the gateway.
3. A bound on stale registrations (a time-to-live or a cleanup job), with the gateway's handling of an unknown or expired handle stated.

**Open questions.** Does the gateway already expire handles? Where would the registration be repeated after a restore from backup?

## E10. Queue caps can refuse mail to an offline phone

**Rationale.** A phone offline for days can hit the caps. What happens at the hard cap (refuse the sender, or drop the oldest) decides whether messages are lost silently.

**Evidence.**
- The deployed config: `queued_send_messages_per_peer = "50"`, `queued_receive_messages_soft = "200"`, `queued_receive_messages_hard = "1000"` (`deploy/keyring-messaging/mediator/mediator.toml:127,130,131`), plus `message_expiry_seconds = "604800"` (7 days, `:125`). READ
- The plan cites `mediator.toml:449,476,482` for the same values (upstream sample). UNVERIFIED here.
- Whether the mediator refuses or drops at the hard cap, and what error the sender gets: UNVERIFIED; read the upstream limits code in M3 and see `message-protection-plan.md` for the refusal and `Retry-After` contract.

**Phase.** M3b.

**Acceptance checks.**
1. Limits set for phone mailboxes, with the reasoning (message sizes, expected bursts, the 7-day expiry).
2. A stated behaviour at the hard cap: refuse (the sender gets an error and keeps the message) rather than drop; recorded in the plan.
3. A user-visible sender error ("the recipient's mailbox is full; try later") and a tested refusal path.
4. A phone offline for N days (N TBD, at least the expiry window) either receives all its mail on return or the sender saw the error; no silent loss.

**Open questions.** Should the expiry be longer than 7 days for phones? Does the per-peer send cap of 50 limit a legitimate burst such as a VRC exchange's acks?

## E11. Config sprawl persists after M5

**Rationale.** The Credo mediator is referenced from CI secrets, scripts, probes and app code. Without a checklist, M5 shuts the mediator down and leaves dead references that fail late.

**Evidence (all READ in this tree unless noted).**
- `MEDIATOR_URL` CI secret and `app/.env`: `.github/workflows/staging.yaml:79,127,348,365,890,903`; `.github/workflows/test-builds.yml:121,189,281,319,329`; `.github/workflows/gate-ota.yml:108,116`; `app/.env.sample:8`.
- `e2e/lib/config.js:45` reads `MEDIATOR_URL` from `app/.env`; the `e2e/run-*` scripts rely on it (`e2e/run-vrc-exchange-devices-android-only-didcomm-v2.js` and `e2e/run-vrc-exchange-didcomm-v2.js` mention `mediator-server`).
- Probes hardcoding `credo-mediator.asml.berkmancenter.org`: `tsp-reference/ref-06v1b-mediated/run.mjs:36` and `README.md:5`; `tsp-reference/ref-06v1d-carrier/run-mediated.mjs:31`, `run-mediated-pickupv2.local.mjs:31`, `run-idle-probe.mjs:32`, `run-queue-probe.mjs:32`. Six files in all.
- Docs: `docs/DEMO_RUNBOOK_WITNESSED_EXCHANGE.md:16` and `docs/spikes/e2e-vrc-connect-findings.md`.
- App: `app/src/utils/mediatorPreference.ts:21` (`RETIRED_MEDIATOR_HOSTS` holds only the earlier Aries host), `app/src/hooks/useBCAgentSetup.ts:289-293` (`Config.MEDIATOR_URL`) and the `MEDIATOR_V2_URL` Credo-v2 path (`:114-134`, plus the call before it), which the plan already says is removed once unused.
- Dev tooling: `scripts/mediator-lifecycle.js`, `scripts/local-mediator.js` (`yarn mediator`, `package.json:33`) and the local `bifold/packages/mediator-server` package (the bifold clone has it; not checked out in the PR tree).

**Phase.** M5b.

**Acceptance checks (the M5 cleanup checklist).**
1. Remove or repoint the `MEDIATOR_URL` secret and `app/.env` value in each workflow above; confirm that the build fails loudly, rather than silently, if it is unset.
2. Repoint `e2e/lib/config.js` and the `e2e/run-*` scripts at the Affinidi mailbox (or the local one from E12).
3. Retire or repoint the six `tsp-reference` probes; mark the ones kept as historical.
4. Add `credo-mediator.asml.berkmancenter.org` to `RETIRED_MEDIATOR_HOSTS` (and its test) so a stored preference of it is replaced.
5. Remove `useBCAgentSetup.ts`'s Credo `MEDIATOR_URL` use and the `MEDIATOR_V2_URL` path, with their tests.
6. Remove `scripts/mediator-lifecycle.js`, `scripts/local-mediator.js` and the `mediator-server` package if E12's replacement is in place.
7. Update the docs above and the plan's "Today" table.
8. A final search for the Credo hostname, and for `MEDIATOR_URL`, over the wallet and bifold trees returns only the retired-host list and historical notes.

**Open questions.** Which of the probes are still run by anyone? Does removing the local mediator break the demo scripts (`yarn demo:android`, `yarn demo:ios`)?

## E12. Dev and CI need an Affinidi-compatible local mediator

**Rationale.** `yarn mediator` starts the `mediator-server` package, which is Credo-only, so a developer or CI job cannot run the new path locally. Without one, M4's tests would run only against shared infrastructure.

**Evidence.** `package.json:33` and `scripts/local-mediator.js:1-12` (the Credo-based lifecycle); `scripts/openvtc/local-vti-stack/up.sh:3,21-26` already starts "an Affinidi-style mediator" from a local checkout of `affinidi-tdk-rs`. READ

**Phase.** M3c (before M4).

**Acceptance checks.**
1. Extend `scripts/openvtc/local-vti-stack` (or add a sibling script) so one command starts the Affinidi mediator with phone accounts and ACLs matching M3, and writes the mailbox config for `app/.env`.
2. A CI job runs a two-agent wallet-to-wallet message and a VRC exchange against it.
3. The witness e2e (E1) can run against it.

**Open questions.** Does the stack's ngrok dependency (`up.sh`, `test-up.sh`) suit CI, or does CI need a plain local port?

## E13. The Redis-resubscribe fix is only scheduled in M3

**Rationale.** Companion `2026-10-20-al.md` F2 says the missing fix `878301bd` affects the gateway VM's mediator today: after a Redis restart, live delivery silently stops until the mediator restarts. The plan lists the fix under M3, leaving the exposure unowned for the months before.

**Evidence.** `2026-10-20-al.md:20`; plan §5 M3 row. READ. The gateway's own use of live delivery (wakes through its mediator) is INFERRED; the real impact on approvals is unmeasured.

**Phase.** M0b.

**Acceptance checks.**
1. Pull forward as its own gateway-image change through `scripts/gateway-update.sh` with a new `<commit>-pN` tag, and a test that restarts Redis and confirms the mediator resumes live delivery; or
2. State in the plan that the risk is accepted until M3, with a date and an alert on stalled live delivery (E14).

**Open questions.** Does the fix change the pinned mediator version (`5558061` to a newer commit), and does that interact with `gateway_commit`?

## LOW

## E14. Observability

**Rationale.** Neither mediator has dashboards or alerts the plan relies on, and "no v1 traffic" has no definition.

**Evidence.** The plan has no observability item. READ (absence). The Credo mediator's metrics: UNVERIFIED.

**Phase.** M1b, M3a.

**Acceptance checks.**
1. Per mediator (Credo on its new host; the Affinidi mailbox): queue depth, connected sockets, error rate, and a stalled-delivery alert.
2. The Credo last-seen counter and the metric "connections with traffic in the last window" (E2), shown on the dashboard.
3. A test message visibly moves each metric.

**Open questions.** Where do the existing gateway metrics go (its loopback metrics endpoint, per the compose header), and can the mediators join them?

## E15. The privacy control is still not run

**Rationale.** It blocks M0 and M1 (plan §6) and takes about five minutes; running it later risks moving a mediator that posts for every connection.

**Evidence.** Plan §6, §7 and `2026-10-20-al.md:13`. READ

**Phase.** M0a, first.

**Acceptance checks.** On the legacy host: a message to a connection with no wake handle sends nothing to the gateway (mediator log, and unchanged gateway wake counters), recorded with a date. Repeat after M1.

**Open questions.** None.

## E16. M1 has no owner or date

**Rationale.** The plan's §6 says "not scheduled". The first infra step has to start somewhere.

**Evidence.** Plan §6. READ

**Phase.** M0a.

**Acceptance checks.** An owner (TBD) and a target date (TBD) written next to M1 in §6, and reviewed when M0a closes.

**Open questions.** None.

## What could not be verified

- The deployed witness mode, and whether any witness runs on staging or production (E1).
- That the witness has no Affinidi path: only the mediator settings were searched (E1, INFERRED).
- The plan's upstream line references for the Affinidi mediator (`mediator.toml:449,476,482`, `store.rs`, `Cargo.toml`), the Caddyfile lines, and `scripts/release/tier.mjs` rules: not re-read.
- The Credo mediator's state layout, key location and metrics (E2, E4, E14): the host is outside every repo read.
- The bifold submodule is not checked out in the PR tree; the bifold files were read from a clone at `783cadf`, not at the plan's pin `13ff3c1a`.
