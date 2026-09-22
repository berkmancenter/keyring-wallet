# VTI upstream findings

**Version 1.35 — 2026-09-22.** A living document: every finding here was measured
against a local VTI stack this repository can build, and each carries the
command that produced it, what was observed, and where in upstream's source the
behaviour lives. Entries are updated in place as they are resolved — see
[Changelog](#changelog) and the [status table](#status-at-a-glance).

Findings are numbered `VTI-NN` and never renumbered. A resolved finding keeps
its number and gains a resolution note, so an external reader following a link
from a report or an issue always lands on the right entry.

- **Scope.** Findings about upstream code — `vti` (`vta-service`, `vtc-service`,
  `pnm`, `cnm`), the Affinidi messaging mediator, and the DID-hosting daemon.
  Defects in this repository's own code are fixed here, not listed here.
- **Where the evidence lives.** `tsp-reference/ref-20-local-vetting/` — the
  driver scripts, frozen response fixtures, and a narrative README.
- **How to reproduce any of it.** `scripts/openvtc/local-vti-stack/up.sh`
  stands up the whole stack; its README records what bites and why.
- **Versions measured against.** See [Stack under test](#stack-under-test) —
  every component, its version, and the exact upstream commit it was built from.

## Status at a glance

| # | Finding | Severity | Status | Era |
| --- | --- | --- | --- | --- |
| [VTI-01](#vti-01) | An administrator cannot become a vetter, and the first-vetter bootstrap is undocumented | Medium | Open — bootstrap path measured · **Upstream 09-22:** shipped — bootstrap runbook, vti #1627 | A |
| [VTI-02](#vti-02) | An ACL `member` role is not community membership | High | Open · **Upstream 09-22:** declined as stated (ACL = control plane, membership = a DTG edge); the bootstrap fixed instead | A |
| [VTI-03](#vti-03) | A `requestMore` join request can never be closed | High | **Resolved upstream** — vti #1591 (`withdraw/0.1`) and #1593 (`supplement/0.1`); **client half built** (bifold `877d26f`), not yet run against a live VTC | A |
| [VTI-04](#vti-04) | A second application from one DID is refused, not answered | Medium | **Resolved upstream** — vti #1592 names the open request; with #1591/#1593 the applicant can now act on it | A |
| [VTI-05](#vti-05) | The mediator refuses a phone's WebSocket upgrade | **High** | **Resolved upstream** — `affinidi-tdk-rs` #831 · **Upstream 09-22:** shipped (tdk-rs #831) — confirmed | A |
| [VTI-06](#vti-06) | A misplaced configuration key is accepted in silence | Low | CORS half answered by #831; general case open · **Upstream 09-22:** needs **our** reproduction — they read it as the CORS half; ours is TOML scoping, repro supplied below | A, re-checked on **C** |
| [VTI-07](#vti-07) | The mediator resolves `functions_file` relative to the working directory | Low | **Resolved upstream** — tdk-rs #843; **verified on our stack** (era H) · **Upstream 09-22:** shipped (tdk-rs #843) — confirmed | A, re-measured on **H** |
| [VTI-08](#vti-08) | `vta-service` overflows a worker stack creating a context | Medium | Open — workaround · **Upstream 09-22:** already fixed by vti #1526, an ancestor of our era-G build; **re-run without `RUST_MIN_STACK`** to verify | A |
| [VTI-09](#vti-09) | VTA and VTC disagree on the DIDComm body shape | Medium | Open · **Upstream 09-22:** already fixed (vti #858, 29 Jul) — the VTA tightens to full documents after a deprecation window; Keyring already sends full, signed documents | A |
| [VTI-10](#vti-10) | A document's issuer must equal the DIDComm sender | Low | **Confirmed by upstream** — deliberate; specification gap stands · **Upstream 09-22:** declined — design intent, to be documented | A |
| [VTI-11](#vti-11) | A fresh VTC has an empty ACL and cannot authenticate its own admin | Low | Open · **Upstream 09-22:** shipped — bootstrap runbook, vti #1627 | A |
| [VTI-12](#vti-12) | A community's advertised transports are fixed at mint | Low | Open · **Upstream 09-22:** needs our repro; vti #1632 (`dids edit` → `get-log` → `cnm did-log install`) may already answer it — test on the new pins | A |
| [VTI-13](#vti-13) | A criterion cannot express "no requirements" | Medium | **Corrected** — misattributed; the refusal is `affinidi-openid4vp`'s and spec-correct. Narrowed, and our answer on the shape is inside · **Upstream 09-22:** re-scoped — DCQL stays; the VTC needs a criterion model that admits an empty requirement; their question back: auto-admit or admit-pending-review | A |
| [VTI-14](#vti-14) | `cnm`'s vetting subcommands ignore `--url` / `VTA_URL` | Low | **Resolved upstream** — vti #1601 · **Upstream 09-22:** shipped (vti #1601) — confirmed | A |
| [VTI-15](#vti-15) | A VTC DID cannot be used as a `cnm` community | Low | Open · **Upstream 09-22:** shipped (vti #1615) — VTCRest now carries `/v1` for communities minted from now on; **our client must stop appending a second `/v1`** | A |
| [VTI-16](#vti-16) | Minting an admin portal sign-in needs the daemon stopped, then running | Low | Open · **Upstream 09-22:** shipped (vti #1618) — `POST /v1/admin/invites` through the running daemon | A |
| [VTI-17](#vti-17) | A force re-provision keeps a DID bound to a hostname that no longer exists | Medium | Open · **Upstream 09-22:** shipped (webvh #206) | A |
| [VTI-18](#vti-18) | A self-managed DID-hosting daemon without a mediator cannot be registered by a VTA | Medium | Open · **Upstream 09-22:** shipped (webvh #206) — a self-managed daemon always advertises `WebVHHosting` | A |
| [VTI-19](#vti-19) | The DID resolver bursts a dozen fetches per operation and trips rate-limited hosts | Low | **Resolved upstream** — `verifiable-trust-infrastructure` #1581; not yet on our stack · **Upstream 09-22:** shipped (vti #1581) — confirmed | A |
| [VTI-20](#vti-20) | A serverless persona mint prints a log nobody serves | **Medium** (raised from Low) | Open — blocked a real run on 2026-09-19; the error names the persona, not the missing registration · **Upstream 09-22:** shipped (vti #1616) | A, re-met on **C** |
| [VTI-21](#vti-21--no-channel-delivers-an-invitation-to-its-invitee) | No channel delivers an invitation to its invitee | Medium | **Confirmed by upstream** in source · **Upstream 09-22:** shipped — `vtc/invitations/deliver/0.1` (Trust Tasks #581, vti #1648), `message` channel; **Keyring receive/redeem to build** | A |
| [VTI-22](#vti-22--consent-policies-are-inert-unless-configpolicyenforcement-is-on) | Consent policies are inert unless config.policy.enforcement is on | Low | Open · **Upstream 09-22:** decided — default stays off; startup warning when policies exist with enforcement off (vti #1633) | A |
| [VTI-23](#vti-23--every-operation-a-manager-needs-requires-the-admin-role) | Every operation a manager needs requires the admin role | Medium | Open · **Upstream 09-22:** shipped (vti #1619) — persona mint needs `KeyMint` (initiator holds it); key export is its own admin-only capability; sign via `keys/sign` (Q4) | A |
| [VTI-24](#vti-24--a-pushed-consent-request-is-queued-not-delivered-to-an-idle-approver) | A pushed consent request is queued, not delivered, to an idle approver | Medium | **Resolved upstream** — `verifiable-trust-infrastructure` #1579 (with VTI-26); **validated live on era H** with a phone approver · **Upstream 09-22:** shipped (vti #1579) — confirmed | A |
| [VTI-25](#vti-25--on-the-eucalyptus-train-the-card-is-delivered-not-returned) | On the Eucalyptus train the card is delivered, not returned | Medium | Open · **Upstream 09-22:** needs **our** reproduction — they find the card still inline in `verdict.with` at both builds; a trace of one admission is asked for | B |
| [VTI-26](#vti-26--a-consent-request-is-pushed-only-to-a-didkey-approver-every-other-approver-needs-the-requester-to-relay) | A consent request is pushed only to a did:key approver; every other approver needs the requester to relay | Medium | **Resolved upstream** — `verifiable-trust-infrastructure` #1579; **validated live on era H** with a phone approver. Keyring's relay stays as the fallback #1579 itself keeps · **Upstream 09-22:** shipped (vti #1579) — confirmed | B |
| [VTI-27](#vti-27--an-authentication-or-acl-refusal-over-didcomm-is-a-problem-report-not-a-trust-task-error) | An authentication or ACL refusal over DIDComm is a problem-report, not a trust-task-error | Low | Open · **Upstream 09-22:** already fixed (vti #1567, 18 Sep) — typed trust-task-error | B |
| [VTI-28](#vti-28--a-vta-answers-a-reply-with-an-error-and-loops-with-its-did-hosting-daemon) | A VTA answers a reply with an error, and loops with its DID-hosting daemon | **High** | **Resolved upstream** — `vti` #1567 and `affinidi-webvh-service` #202 · **Upstream 09-22:** already fixed (vti #1567, webvh #203) — confirmed | B, re-measured on **C**: gone |
| [VTI-29](#vti-29--members-who-never-collect-their-cards-silence-the-community-the-mediators-per-sender-queue-cap) | Members who never collect their cards silence the community: the mediator's per-sender queue cap | **High** | **Fixed upstream** — `affinidi-tdk-rs` #828, and re-measured on era E at upstream's stock limits with the per-relationship gate actually live: the ceremony passes · **Upstream 09-22:** shipped (tdk-rs #828, plus #829 for the direct and TSP paths) | B |
| [VTI-30](#vti-30--a-live-push-can-be-dropped-and-a-client-that-only-listens-never-sees-the-message) | A live push can be dropped, and a client that only listens never sees the message | Medium | **Fixed upstream** — `affinidi-tdk-rs` #830 (their KR-30); on our stack since era E. The client half — acting on an unsolicited `status` — is ours and still open · **Upstream 09-22:** shipped (tdk-rs #830) — Keyring's transport already handles the resync signal | B |
| [VTI-31](#vti-31--a-dropped-terminal-error-is-never-acknowledged-so-it-never-leaves-the-senders-queue) | A dropped terminal error is never acknowledged, so it never leaves the sender's queue | **High** | **Fixed upstream** — `affinidi-tdk-rs` #834, with our proposed cause corrected; on our stack since era E, residue not specifically re-measured · **Upstream 09-22:** shipped (tdk-rs #834) — re-run on a current build asked | C |
| [VTI-32](#vti-32--an-invitation-is-too-large-for-the-channel-it-is-meant-to-travel-on) | An invitation is too large for the channel it is meant to travel on | **High** | Open · **Upstream 09-22:** shipped — `vtc/invitations/deliver/0.1` `offer` channel: a QR-sized offer redeemed by proving the invited DID's key (vti #1648); **Keyring redeem to build** | C |
| [VTI-33](#vti-33--a-mediator-built-without-its-tsp-feature-drops-every-tsp-frame-in-silence) | A mediator built without its `tsp` feature drops every TSP frame in silence | **High** | New · **Upstream 09-22:** shipped — `tsp` a default feature (tdk-rs #854, mediator 0.28.21; vti #1622) | G |
| [VTI-34](#vti-34--tsp--true-is-inert-on-a-vta-built-without-the-tsp-feature-and-nothing-says-so) | `tsp = true` is inert on a VTA built without the `tsp` feature, and nothing says so | Medium | New · **Upstream 09-22:** shipped (vti #1620) — the VTA refuses to start with `tsp = true` on a build without it | G |
| [VTI-35](#vti-35--a-vtc-cannot-advertise-the-tsp-service-it-is-able-to-serve) | A VTC cannot advertise the TSP service it is able to serve | Medium | New · **Upstream 09-22:** shipped (vti #1632) — a self-hosted community answers `did-management/did/register`; `cnm did-log install` replaces our DID-log edit | G |
| [VTI-36](#vti-36--vta-services-tsp-enable-tells-a-self-hosted-vta-to-redeploy-a-log-it-already-serves) | `vta services tsp enable` tells a self-hosted VTA to redeploy a log it already serves | Low | New — documentation · **Upstream 09-22:** shipped (vti #1624) | G |
| [VTI-37](#vti-37--a-consent-refusal-loses-its-challenge-once-the-approver-set-grows) | A consent refusal loses its challenge once the approver set grows | Medium | New | H |
| [VTI-38](#vti-38--a-cancelled-relationship-is-forgotten-before-the-vta-can-answer-the-cancel) | A cancelled relationship is forgotten before the VTA can answer the cancel | Low | New | H |
| [VTI-39](#vti-39--a-tsp-reply-that-fails-to-send-once-is-lost) | A TSP reply that fails to send once is lost | Low | New — observed once | H |
| [VTI-40](#vti-40--vta-browser-plugin-a-consent-approve-can-be-recorded-as-a-deny) | vta-browser-plugin: a consent Approve can be recorded as a Deny | Medium | New — fix drafted | F |
| [VTI-41](#vti-41--tsp-rev-3-does-not-cross-two-mediators-no-accept-comes-back-didcomm-does) | TSP Rev 3 does not cross two mediators: no accept comes back; DIDComm does | **High** | New — cause located to the return leg, not proven | F′ |
| [VTI-42](#vti-42--a-community-names-withdraw01-as-the-remedy-and-its-didcomm-router-has-never-heard-of-it) | A community names `withdraw/0.1` as the remedy, and its DIDComm router has never heard of it | **High** | New — reachable via the binding envelope; the plain-DIDComm arms are the gap | F′ |
| [VTI-43](#vti-43--a-tsp-reply-sent-before-the-relationship-is-accepted-never-arrives) | A TSP reply sent before the relationship is accepted never arrives | **High** | New — ordering established on both sides of the wire; the drop itself not localised | F′ |

## Stack under test

**Upstream asked for the exact versions, and this is the honest answer: there
are three, not one.** The fixture was rebuilt twice while these findings were
gathered, so each finding names the era it was measured on (A, B or C below)
and nothing here claims a version it was not measured against. All Rust
services are **debug builds from source** — none are published images, and in
particular none are the images a VTA Farm currently offers.

| Era | When | `verifiable-trust-infrastructure` | `affinidi-tdk-rs` (mediator) | `affinidi-webvh-service` (daemon) |
| --- | --- | --- | --- | --- |
| **A** | 2026-09-15 → 09-17 | `53a7cde4` — main tip, 2 commits past `vta-service-v0.28.0`; vta 0.28.0 · vtc 0.11.58 · sdk 0.38.2 · pnm 0.16.5 · cnm 0.15.2 | `dff68eb` — mediator 0.25.0 | `cb8a6f4` — daemon 0.8.3 |
| **B** | 2026-09-18 | `460e0ebb` — tag `VTI-Eucalyptus-RC-0`; vta 0.33.0 · vtc 0.11.58 · sdk 0.42.1 · pnm 0.17.2 · cnm 0.16.3 | `144a3af0` — mediator 0.26.2 | `f579e42` — daemon 0.8.3 |
| **C** | 2026-09-19 | `6bd52cab` — main, 20 commits past the tag; vta 0.34.1 · vtc 0.11.58 · sdk 0.43 · pnm 0.17.4 · cnm 0.16.3 | `c13a6352` — mediator 0.26.2 | `35244b7` — daemon 0.8.3 |
| **F** (Farm) | 2026-09-20 | **vta 0.34.1 · vtc 0.11.58 — identical to the lab.** VTA REST `vta-keyring-al.ic3.dev` (78 OpenAPI paths, same count); community `vtc.ic3.dev`, shared, not ours to administer | `mediator.ic3.dev` — **0.26.4**, reported by its own `/readyz`. The only component behind. **0.28.23 on 2026-09-22** (see below) | DID hosting `dids.ic3.dev` |
| **E** | 2026-09-20 | unchanged — vta 0.34.1 · vtc 0.11.58 | `15499952` — upstream main, mediator **0.28.9**, carrying #829–#842; published on crates.io despite the changelog heading each section "Unreleased" | `35244b7` — daemon 0.8.3 |
| **D** | 2026-09-20 | unchanged from C — vta 0.34.1 · vtc 0.11.58 | `b544da04` — the **#829 branch tip**, mediator 0.28.0; this is *not* upstream main, which has since merged #829 and thirteen more (#830–#842) and stands at mediator 0.28.9 | `35244b7` — daemon 0.8.3 |
| **H** | 2026-09-21 (evening) | `a96fe02f` — upstream main; carries #1579, #1581, #1591–#1593, #1601 and the persona/face work (#1594–#1606); `affinidi-messaging-sdk` 0.26.12 from upstream's own lockfile; `vta` built `--features tsp` | `ad36f0b1` — upstream main, mediator **0.28.11** (#843, #844), `--features tsp` | `5365da7` — upstream main (#205) |
| **G** | 2026-09-21 | `6bd52cab` as era C, **plus `affinidi-messaging-sdk` 0.26.12** (carries tdk-rs #838) in the lockfile; `vta` built **`--features tsp`**; alice and the community VTA advertise `TSPTransport` (`vta services tsp enable`), the VTC by a DID-log edit (VTI-35) | `15499952` as era E — mediator 0.28.9, rebuilt **`--features tsp`** | `35244b7` — daemon 0.8.3 |

**Era F′ — the Farm's VTAs upgraded, 2026-09-22.** The Farm moved its VTAs from
`vta 0.36.0-d383d17e` to **`0.37.1-d9a5be02`** (upstream #1634), newer than the
lab's 0.34.1. At that commit the Farm's VTAs carry #1591–#1593 (withdraw,
`requestAlreadyOpen`, supplement), #1615 (`VTCRest` carries `/v1`), #1619
(`KeyMint` for a DID mint; `key-export` its own capability, derived by `admin`
alone), #1622 (TSP on by default, and setup checks that the mediator carries
it), #1633 (the enforcement-off warning) and #1634 (`contexts/secrets` requires
`KeyExport`). They do **not** yet carry #1632, #1642, #1646 or #1648, and #1652
is not merged. For Keyring:
- an un-narrowed admin derives both `KeyMint` and `KeyExport`
  (`vta-service/src/operations/export.rs:69,140` at `d9a5be02`), so a phone
  linked as admin still mints its persona and borrows its keys;
- Keyring never calls `contexts/secrets`;
- `requestAlreadyOpen` and supplement are live on the Farm as on the lab.

**A correction to era F, measured 2026-09-21.** "Identical to the lab" holds
for the version string only. The Farm's VTA image is `0.34.1-89ebd895` — the
merge commit of `verifiable-trust-infrastructure` #1579 — while the lab's
`vta-service` is `6bd52cab`, the same 0.34.1 a day earlier. So the Farm VTA
already carries #1579 (VTI-24, VTI-26) and the lab does not; neither carries
#1581 (VTI-19) or #1591 (VTI-03). The version number did not move across those
merges, which is how a per-component *version* comparison came out equal while
the *commits* differ. `scripts/openvtc/PINS.json` names `c9bc3a69` (upstream
main on 2026-09-20): that is the reference clone, not what the lab runs.

**Era F re-measured, 2026-09-22 (read-only, from public endpoints).**

- **The Farm mediator is 0.28.23.** `GET https://mediator.ic3.dev/mediator/v1/readyz`
  at 07:50:57Z answered `status: ready`, `version: 0.28.23`,
  `uptime_seconds: ~767`. That answers VTI-Q8: the Farm now runs a newer
  mediator than the lab (0.28.11, era H), so VTI-29/30/31's fixes are there.
  Its DID, `did:webvh:QmagBwJ5…:dids.ic3.dev:firstperson-mediator`
  (log v1, 2026-08-29), advertises `TSPTransport`, `DIDCommMessaging` (an
  array `type`, EXT-01's shape) and `Authentication`, all at
  `https://mediator.ic3.dev/mediator/v1`.
- **The mediator the ecosystem's first community names is degraded.**
  `first-vtc`'s `DIDCommMessaging` and `TSPTransport` services both name
  `did:webvh:QmTS3a3H…:webvh.storm.ws:mediator` (`mediator.vtc.storm.ws`). At
  07:50:57Z its `/readyz` answered `version: 0.28.26`, `status: degraded`, with
  `redis_stored_functions: restarting`. That is the signal era E's lab mediator
  gave while it ran a stored-function library older than its binary (above):
  the library is written by `mediator-setup` and nothing refreshes it on
  upgrade. Probably the same cause; we cannot see the host.
- **`first-vtc`'s canonical log** is `https://webvh.storm.ws/first-vtc/did.jsonl`:
  4 versions, the latest `4-QmebQhmt…` at 2026-09-06T08:01:07Z, with
  `VTCRest`, `VTCStatusList`, `TSPTransport` and `DIDCommMessaging`. The two
  messaging services carry the mediator DID as a bare string.
  `https://first.openvtc.net/.well-known/did.jsonl` (the VTC's own route)
  still serves version 1 (2026-06-21: `VTCRest` and `VTCStatusList` only). Upstream
  already treats this local copy as a mirror that can go stale
  (`vtc-service/src/transport_capability.rs:470-500` and `:535-545` at
  `a96fe02f`). Resolution is unaffected, because the DID's host is
  `webvh.storm.ws`. It matters only to a reader who fetches the REST host's log
  and concludes the community has no messaging.
- **The Farm mediator went down during step 2.** From 08:02:34Z, both
  `/authenticate/challenge` and `/readyz` answered
  `503 no available server` (an edge with no backend). The uptime of about
  767 s at 07:50:57Z suggests it had restarted shortly before. The outage
  window is recorded under [Farm cross-mediator round trip](#farm-cross-mediator-round-trip-2026-09-22).

Eras are listed as they were recorded, so the letters are not in date order:
D, E and G are all later than F's first measurement.

Era C is upstream's own planning basis. A finding measured on A or B has **not**
been re-measured on C unless its entry says so — the September refresh may
already have closed some, which is exactly why the era is stated per finding
rather than once for the document.

Constant across all three: Redis 8.10.1, six reserved ngrok domains, and on the
phone credo-ts `0.7.1-pr-2704` (DIDComm v2), React Native 0.81 / Hermes,
`@bifold/trust-tasks` emitting `trust-task-error/0.3` while the community emits
`/0.5`. The reference client `openvtc` is built at `177a218`.

**Two fixture deviations to declare.** On era B the mediator's
`queued_send_messages_soft` was raised from 200 to 2000 to get past VTI-29
while it was being diagnosed; everything measured after that point on era B
ran with the raised limit. Era C has it back at the default — and VTI-29
promptly reproduced, so the community's stuck send queue was emptied by hand
in Redis to carry on. Both are workarounds for the same finding, neither is a
fix, and upstream is right that raising the limit is not one.

**Era E retires both, and finds a third nobody had declared.** The lab now runs
upstream's shipped values — `queued_send_messages_per_peer = 50`,
`queued_send_messages_soft = 2000`, `hard = 10000` — and the ceremony passes at
them, so there is no longer a queue-limit deviation to declare. Note the
direction: the era-B "raised" limit of 2000 *is* today's default, and what the
lab had been running since (200/1000) was **below** stock, not above it.

The third deviation was silent and mattered more than either. The mediator's
stored-function library is written by `mediator-setup` at the version that
generated the configuration, and nothing refreshed it when the binary moved —
so a 0.28.9 mediator was running a 0.26-era `atm-functions.lua`. The mediator
says what that costs: *"a library predating the per-relationship queue
accounting never writes PEER_Q, so `peer_queue_count` reads 0 and
`limits.queue.peer` never fires"*. The gate was configured, reported present,
and **inert**, and the mediator ran `degraded` throughout. Every per-peer queue
observation made in this lab before 2026-09-20 was therefore taken with the
gate switched off. `up.sh` now copies the library from the build on every
start.

## VTI-01

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### An administrator cannot become a vetter, and the first-vetter bootstrap is undocumented

**Severity: medium.** *Corrected in 1.1* — version 1.0 recorded this as a blocker
("no admissible path to a community's first vetter"). That was wrong: a path
exists on documented surfaces and is measured below. What remains is that the
obvious attempt dead-ends, and the working order is written down nowhere.

**The obvious attempt dead-ends.** The natural first vetter is the administrator
who stood the community up. That identity is on the access list — it has to be,
to administer anything — and the two routes involved disagree about whether it
is a member:

| Route | Gates on | Upstream | Answer for the admin DID |
| --- | --- | --- | --- |
| `POST /v1/invitations` | an **ACL** entry | `vtc-service/src/routes/invitations.rs` | *"… is already a current member — no invitation needed"* |
| `POST /v1/vetting/vetters` | a **Member row** | `vtc-service/src/vetting/vetters.rs` | *"… is not a current member of this community"* |

```sh
node vtc-admin.mjs <vtcBase/v1> <vtcDid> <adminCredential.json> invite <admin did:key>
#   409 — "is already a current member — no invitation needed"
node vtc-admin.mjs <vtcBase/v1> <vtcDid> <adminCredential.json> vetter-grant <admin did:key>
#   400 — "is not a current member of this community"
```

**The path that works** (measured 2026-09-16): make the first vetter a *different*
identity, and admit it before the community starts asking for vetting.

1. Give the community an invitation-only criterion — no vetting criterion yet.
2. `POST /v1/invitations` for the vetter-to-be's DID → an `InvitationCredential`.
3. The vetter-to-be applies with that credential in its presentation → verdict
   **`allow`**, with the signed `MembershipCredential` and role
   `EndorsementCredential` returned inline. No human decision.
4. `POST /v1/vetting/vetters` for that DID → **`201`**, vetter credential issued.
5. Add the vetting criterion. From here, applicants can be vetted.

Evidence: `fixtures/submit-0.2-invitation-allow.log`,
`fixtures/vp-with-invitation-credential.json`,
`fixtures/vetter-grant-after-invitation.log`.

**Why the order matters — criteria are conjunctive.** Step 1 cannot be skipped.
An invited applicant to a community that asks for an invitation **and** a vetting
statement is answered `requestMore`, because the invitation satisfies only one
criterion (`fixtures/submit-0.2-invited-requestMore.log`). So a community that
begins life asking for vetting can never admit its first vetter; it has to be
configured, populated, and then tightened.

**Also worth noting.** A vetter has to sign vetting statements, so the identity
admitted in step 3 needs an Ed25519 signing key — an X25519-only `did:key`
passes the governance steps above but could not vet anyone.

**What we would like from upstream.** Document the bootstrap order; and either
let an administrator be granted the vetter role directly, or have
`vetters.rs` accept an ACL-present identity the way `invitations.rs` does.

---

## VTI-02

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### An ACL `member` role is not community membership

The access list and the member roll are separate stores, and the vetting routes
read the member roll. Adding `--role member` to the ACL therefore does not make
the subject a member for any purpose the vetting code cares about. This is the
mechanism underneath the dead end in [VTI-01](#vti-01), recorded separately
because it is independently surprising: the word `member` appears in both places
and means different things.

---

## VTI-03

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### A `requestMore` join request can never be closed

An application answered with `requestMore` is left in a deferred state.
`join-decide` refuses it, the admin queue does not list it, and no documented
route withdraws it. The applicant cannot retry (see [VTI-04](#vti-04)) and the
administrator cannot clear it.

**Operational consequence, and our rule of thumb:** never submit an application
before holding the statements it will be asked for — the first attempt is
unrecoverable, and the only way forward for that person is a brand-new identity.

**Evidence.** `tsp-reference/ref-20-local-vetting/fixtures/submit-0.2-invited-requestMore.log`

**Resolved upstream.** `verifiable-trust-infrastructure` #1591 adds
`vtc/join-requests/withdraw/0.1`, letting the applicant close their own
request. It was specified first in `dtgwg-trust-tasks-tf` #518 and ships in
`trust-tasks-rs` 0.21.5. The entitlement is ownership rather than a role —
correct, since an applicant holds neither a role nor a capability; that is what
they are applying for. Two refusals are declared and distinguished: a request
that is absent or someone else's answers `notFound` (so a caller cannot probe
for request ids), and one already decided answers `alreadyDecided`.

**The client half is ours, and it is not yet written.** Keyring has no route
that withdraws a request, so the dead end this finding describes is still a
dead end in the wallet whatever the server now supports. What it needs: the
task wired into the VTC client, a control on a deferred request, and the two
codes told apart without parsing prose — `alreadyDecided` means the outcome
stands and the applicant should be shown it, `notFound` means there is nothing
to close. Until then the rule of thumb above still holds for our users.

**The second half, and the client, since.** `verifiable-trust-infrastructure`
#1593 adds `vtc/join-requests/supplement/0.1`, which answers a deferral against
the request already open, so an applicant no longer has to choose between
withdrawing (losing their place) and waiting. Keyring now speaks both (bifold
`877d26f`): a deferred request is supplemented with every statement — the new
presentation replaces the old one — and withdrawn from a control on the vetting
screen, with `notFound`, `alreadyDecided` and `notAwaitingEvidence` read from
the code. Unit-tested; not yet run against a live community, because the lab's
tunnel was down when it landed.

---

## VTI-04

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### A second application from one DID is refused, not answered

While a request is open, `submit/0.2` returns a `trust-task-error` with code
`taskFailed` instead of a verdict. Upstream's own
`vtc-service/tests/join_didcomm.rs` asserts this, so the behaviour is intended.

It is listed here because of its interaction with [VTI-03](#vti-03): the first
application cannot be closed, so the refusal is permanent for that identity.
A wallet has to present this as a refusal rather than as a verdict — read
naively it surfaces as an empty verdict, which tells a person nothing.

**Client-side note.** Keyring distinguishes the two document types and shows
the community's sentence with the framework code behind a *Details* control.

**Resolved upstream** by `verifiable-trust-infrastructure` #1592: the refusal
now names the open request, which is what the applicant needs in order to act
on it — and since #1591 and #1593 there is something to act with (see VTI-03).

---

## VTI-05

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### The mediator refuses a phone's WebSocket upgrade

**This affects every mobile client of every standard deployment.**

The mediator applies a defence-in-depth `Origin` check to the WebSocket upgrade,
on the stated assumption that *"native clients send no Origin and pass straight
through"* — `affinidi-messaging-mediator/src/handlers/websocket.rs`,
`websocket_handler`. React Native **does** send an `Origin` header (its
WebSocket implementation derives one from the URL), so a phone is classified as a
cross-origin browser and the upgrade is refused with `403`.

The failure is particularly hard to attribute because the same client's HTTPS
authentication succeeds moments earlier: a developer sees "signed in, then the
socket won't open" and looks at their client.

```
WARN WebSocket upgrade rejected: Origin not permitted by CORS policy
     origin=Some("https://<mediator host>") method=GET uri=/mediator/v1/ws
INFO http request completed route=/mediator/v1/ws status=403
```

**Operator workaround.** Set `cors_allow_origin` — but see [VTI-06](#vti-06) for
where it has to go.

**Suggested upstream fix.** An upgrade that carries a bearer token in
`Sec-WebSocket-Protocol` is authenticated by that token, not by an ambient
cookie, so the origin check adds little for it. Either exempt token-bearing
upgrades, or document prominently that mobile clients require an allowlist entry.

**Resolved upstream** by `affinidi-tdk-rs` #831 (tracked there as KR-05), which
took the second option and went further than the finding asked. The check and
the default-closed posture are untouched, which is right — the default was
never the defect. What changed is that three documents and two test names no
longer say a native client is unaffected. The rule is now stated by the header
rather than by the client class: a request sending no `Origin` is admitted, one
sending an `Origin` is admitted only if the policy admits it. A regression test
pins the React Native case specifically.

Worth recording why this one survived so long, because it is a pattern rather
than an accident: every sentence involved was *true*. "Native clients send no
Origin" describes the Rust SDK exactly. It only misleads when a reader
substitutes "native" for "sends no Origin", and those sets differ by precisely
one client — the mobile one nobody was testing with. A test asserting the right
behaviour under the wrong name kept the idea alive through every review.

---

## VTI-06

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### A misplaced configuration key is accepted in silence

**Retitled after upstream read it.** This was filed as "`cors_allow_origin` is
silently ignored unless it is in `[security]`", which reads as a claim that the
reference configuration puts the key in the wrong place. It does not, and
upstream correctly reported no reproduction on that reading (#831). The claim
was never about where the key belongs. It is about what happens when an
operator puts it somewhere else.

The setting is read from the `[security]` table
(`state.config.security.cors_origins`), and the generated `mediator.toml`
documents it there, commented out — all correct. Append it at the end of the
file instead, or at the top level, and TOML scopes the key to whatever table
happens to precede it. The mediator never sees it, says nothing, and the
refusals of [VTI-05](#vti-05) continue with the setting plainly present in the
file the operator is looking at.

Cost us roughly an hour of believing a correct fix had not worked.

**Still true on era C**, and not specific to this key: no configuration struct
under `src/common/config/` carries `#[serde(deny_unknown_fields)]`, so any
unrecognised key anywhere in `mediator.toml` is accepted without comment.

**Largely answered by #831, from the other end.** That PR added a line stating
the effective CORS policy at boot — `CORS: disabled (security.cors_allow_origin
unset)`. An operator who misplaces the key now sees the mediator say the
setting is unset while their file plainly sets it, which is exactly the
five-second signal this finding asked for, arrived at by a better route than a
parser warning. We would call the CORS half of this closed.

What remains is the general case: a misplaced or misspelled key that has no
boot line of its own is still silent. `deny_unknown_fields` is the wrong
instrument — it turns a forward-compatible config into a hard failure across
version skew — but a warning naming unrecognised keys at load would cost
nothing and generalises what #831 did for one setting. Low priority; recorded
rather than pressed.

---

## VTI-07

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### The mediator resolves `functions_file` relative to the working directory

The default is `./conf/atm-functions.lua`, resolved against the process's
working directory rather than against the configuration file it was read from.
Starting the mediator with an absolute `--config` path from anywhere else fails:

```
ERROR Failed to load LUA scripts: Configuration Error:
      Couldn't ready database functions_file (./conf/atm-functions.lua)
```

Resolving relative paths against the config file's directory would match how
every other path in that file behaves in practice.

**Resolved upstream** by `affinidi-tdk-rs` #843, and verified on era H: with
`functions_file = "atm-functions.lua"` beside the config, mediator 0.28.11
loads it from there and reports the library matches the build. The old
working-directory form still loads, with a deprecation warning — a kind way to
change a default.

---

## VTI-08

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### `vta-service` overflows a worker stack creating a context

On a debug build, `vta/contexts/create/1.0` overflows a tokio worker's stack and
the process dies mid-request. Reproducible; the workaround is to raise the
minimum stack size, which the stack script does for every VTA and VTC:

```sh
RUST_MIN_STACK=33554432
```

Worth a look because a debug-build stack overflow often indicates deep recursion
or a large stack temporary that a release build merely hides.

---

## VTI-09

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### VTA and VTC disagree on the DIDComm body shape

A VTA accepts a bare payload as the DIDComm body. A VTC requires a whole Trust
Task document — `{ id, type, payload, issuer, recipient, issuedAt }` — and
answers a bare payload with `malformedRequest: missing field 'id'`.

Every client has to special-case the two. If that difference is intentional it
belongs in the specification; if it is not, the VTA is the lenient one.

---

## VTI-10

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### A document's issuer must equal the DIDComm sender

A `submit/0.2` whose document `issuer` differs from the authenticated sender is
refused: *"document issuer … does not match the authenticated holder"*.

The rule is sound, but it has a design consequence worth stating in the
specification: an applicant's **member identity is its messaging identity**.
A wallet cannot hold a signing identity for membership and a separate
transport identity — it must present one identity that can do both, which
constrains key derivation (an Ed25519 signing key with a derived X25519
agreement key).

---

## VTI-11

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### A fresh VTC has an empty ACL and cannot authenticate its own admin

A freshly provisioned community's access list is empty, including for the
`admin_did` recorded during setup, so the administrator cannot authenticate
until an entry is added offline with the daemon stopped:

```sh
vtc --config <stack>/vtc/config.toml acl add --did <admin did:key> --role admin
```

Nothing in the setup output says so. Seeding the configured `admin_did` at mint,
or naming the required command in the setup summary, would remove a dead end
every new operator hits.

---

## VTI-12

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### A community's advertised transports are fixed at mint

`transports = ["didcomm"]` has to be present in the VTC's setup recipe. A
community provisioned without it cannot be given DIDComm afterwards — the
service entry is written at mint — so the only remedy is to provision the
community again, losing its identity.

---

## VTI-13

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### A criterion cannot express "no requirements"

A community that wants open enrolment cannot express it. (An invitation-only
criterion turns out to be the better way to seed a first vetter — see
[VTI-01](#vti-01) — but open enrolment is a legitimate policy in its own right.) A criterion with an empty
credential query is rejected at validation:

```
validation error: invalid DCQL query: Invalid DCQL query:
`credentials` must contain at least one credential query
```

The only way to get an unconditioned community is to delete its criteria
entirely, which is destructive and has to be undone afterwards. Measured
2026-09-16; with zero criteria an application is answered `refer` and can then
be approved by an administrator, which does produce a real membership.

---

**Corrected, 2026-09-19, after upstream read it.** The attribution here was
wrong: the refusal does not come from `vtc-service` but from
`affinidi-openid4vp/src/dcql.rs:105`, and it is **spec-correct** — a DCQL query
must carry at least one credential query, so a requirement with an empty
credential query is invalid by the query language, not by the community
service. The finding that survives is narrower and is not a defect in DCQL: the
VTC reaches for a DCQL query to express *"nothing is required"*, and a query
language that cannot say "nothing" is the wrong instrument for it. What is
needed is a criterion model that admits an empty requirement without going
through DCQL at all.

**Our answer to the question upstream put back to us** — should such a
criterion *auto-admit* or *admit pending review*? **Admit pending review.** An
auto-admitting empty criterion is indistinguishable from an open door, and the
case that motivates it is the bootstrap one: a community with no vetters yet
needs to let exactly one person in so they can be granted the vetter role. That
is a decision a human should make once, not a standing property of the
community. `refer` already carries the right semantics, and it keeps the
audit trail an admission deserves.

## VTI-14

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### `cnm`'s vetting subcommands ignore `--url` / `VTA_URL`

The vetting subcommands resolve the community from the DID document rather than
from the supplied URL, so pointing the CLI at a specific host has no effect.
Combined with [VTI-15](#vti-15) this made `cnm` unusable against our stack, and
is why this repository carries its own small admin client
(`tsp-reference/ref-20-local-vetting/vtc-admin.mjs`).

**Resolved upstream** by `verifiable-trust-infrastructure` #1601: an explicit
`--url` is honoured on every transport, not only forced REST.

---

## VTI-15

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### A VTC DID cannot be used as a `cnm` community

A VTC's DID document publishes a `VTCRest` service entry whose endpoint omits
the `/v1` prefix the REST API actually serves, so requests derived from the DID
document land on `405 Method Not Allowed`.

---

## VTI-16

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### Minting an admin portal sign-in needs the daemon stopped, then running

The community service ships a browser admin portal at `/admin/`, entered by
enrolling a passkey through a one-shot install URL. `vtc admin invite` mints
that URL, but it opens the store directly and fails while the daemon holds it:

```
Invite failed: store error: FjallError: Locked
```

With the daemon stopped the command succeeds — and then instructs the operator to
restart the daemon before claiming, because the browser must reach it. So the
only way to let a new administrator in is to take the community offline briefly.
Minting through the running daemon (an authenticated admin route) would avoid the
outage.

---

## VTI-17

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### A force re-provision keeps a DID bound to a hostname that no longer exists

`did-hosting-daemon setup --force-reprovision` rotates the daemon's secrets and
rewrites its config, but leaves the daemon's own `did:webvh` in the store —
still bound to the old public hostname. The setup log says so, quietly:
*"WARNING failed to import daemon DID: conflict: DID at path '.well-known'
already exists"*. The new host then serves `404` for `/.well-known/did.jsonl`,
and nothing that resolves the daemon's DID works, while the daemon itself
reports healthy.

**Reproduce:** move a self-managed daemon to a new `public_url`, re-run setup
with `--force-reprovision`, resolve its DID at the new host.
**Workaround:** delete the store (`data/`) before re-provisioning. Our stack
script does this. A re-provision that changes `public_url` should re-mint the
DID or refuse loudly.

---

## VTI-18

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### A self-managed DID-hosting daemon without a mediator cannot be registered by a VTA

A VTA registers a hosting server by resolving the server's DID and requiring a
`TSPTransport`, `DIDCommMessaging`, `WebVHHosting` or legacy `WebVHHostingService`
service on it (`pnm did-mgmt servers add`: *"has no supported webvh endpoint"*).
A self-managed daemon set up without a mediator mints its own DID with **no
services at all** — so it hosts DIDs perfectly well and no VTA can be told about
it. The recipe's `[identity] mediator_did` + `transport` add a
`DIDCommMessaging` service and fix it; the recipe comment on `mediator_did`
says *"required for daemon hosting external tenant DIDs"*, which is true and
not where an operator looks. Either advertise `WebVHHosting` at `public_url`
unconditionally (the daemon serves HTTP either way), or make the self-managed
wizard ask for the mediator.

---

## VTI-19

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### The DID resolver bursts a dozen fetches per operation and trips rate-limited hosts

One `pnm` command against a VTA fetched that VTA's `/.well-known/did.jsonl`
forty times in five minutes; a burst of eight in a second is enough for an
ngrok-fronted host to answer `429 Too Many Requests! Wait for 1s`, at which
point the command fails with *"HTTP 429"* and retries make it worse. A phone
resolving a DID once is unaffected; scripted tooling and anything behind a
per-second rate limit is. A resolution cache with a short TTL in the resolver
would remove it; until then our scripts retry with a pause.

**Operational:** partly an artefact of tunnelled development hosting, recorded
so the next person does not debug it as a stack fault.

**Resolved upstream** by `verifiable-trust-infrastructure` #1581 (their KR-19),
which found two causes where we reported one: twelve call sites each built their
own resolver cache, and none of them honoured `PNM_RESOLVER_URL`, the setting an
operator would reach for to absorb the load. Not yet on our stack (`6bd52cab`
predates it).

---

## VTI-20

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

### A serverless persona mint prints a log nobody serves

`pnm did-mgmt dids create --did-url <url>` mints a `did:webvh` whose keys the
VTA holds and prints its `did.jsonl` with *"To self-host this DID, place the log
entry in a file named did.jsonl at the URL path corresponding to your DID URL."*
The VTA that minted it does not serve it — the URL answers `404` — so a
serverless persona does not resolve until an operator publishes the file by
hand. The server-managed path (a registered hosting server) serves it at once.
Worth stating in the mint's output that serverless means *you* host it.

**Re-met on era C, 2026-09-19, and it cost a run.** A VTA with no hosting
server registered (`servers 0`) mints a persona serverless without comment. The
client then gets all the way through — whoami, contexts, mint, key borrow — and
fails resolving a document nobody published, with an error that names the
*persona* rather than the missing registration. Severity raised to medium: the
mint succeeding is what makes it expensive. Refusing a mint for a client that
asked for a server-managed DID when no server is registered, or at least
reporting "serverless" in the response, would put the failure where the cause is.

---

## Reporting these upstream

None of these has been filed as an issue; they reach upstream through this
document and the reports that link it, and upstream PRs have cited them by
number (tdk-rs #828, #830, #831, #833, #834, #837; vti #1579, #1581, #1591).
If one is filed, file per finding rather than as one list, cite this document's anchor, and attach the fixture from
`tsp-reference/ref-20-local-vetting/fixtures/` that demonstrates it. Findings
[VTI-05](#vti-05), [VTI-06](#vti-06) and [VTI-07](#vti-07) belong with the mediator's maintainers
rather than with the VTI maintainers, and [VTI-05](#vti-05) is also an
operational request for anyone hosting a mediator that mobile clients must reach.


### VTI-21 — No channel delivers an invitation to its invitee

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

`POST /v1/invitations` issues an `InvitationCredential` bound to a DID and
hands it to the *admin*. Nothing carries it to the invited DID: the operator
copies it out of band. For a phone, that means a QR/link the admin shows
(`keyring://vti/invitation?c=…`, our stand-in) — or, the ask: the VTC pushes
the credential to the invitee's DID over DIDComm, which every persona already
advertises a service for. **Measured:** vtc-service 0.11.58, 2026-09-16.


### VTI-22 — Consent policies are inert unless `config.policy.enforcement` is on

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

`pnm approvals require <task> --consent --set <set>` writes the rule and
`pnm approvals list` shows it, but the PDP gate is "a no-op unless
`config.policy.enforcement`" (`vta-service/src/trust_tasks/mod.rs`). With the
default `enforcement = false`, a gated task runs ungated and `pnm approvals
explain` reports "no rule names this task" — the rule exists but is never
consulted. Setting `[policy] enforcement = true` in the VTA's config and
restarting makes the gate live; then an admin caller IS held (admin is not
exempt — the earlier appearance of exemption was enforcement being off).
**Measured:** vta-service 0.28.0, 2026-09-17.

### VTI-23 — Every operation a manager needs requires the admin role

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

`webvh/dids/create` (mint a persona) and `keys/export-secret` (borrow a
persona's key) both call `require_admin` (`webvh.rs`, `keys.rs`). `initiator`
carries `KeyMint` and `Sign` but is refused both with "admin role required",
so a Keyring manager must hold `admin`. This is fine once VTI-22 is set
(enforcement gates admins too), but it means "least-privilege manager" is not
achievable for the persona lifecycle in 0.28. **Measured:** 2026-09-17.

### VTI-24 — A pushed consent request is queued, not delivered, to an idle approver

*Measured on era **A** (see [Stack under test](#stack-under-test)).*

With enforcement on, a held task's `task-consent/request` is pushed to each
approver, but the VTA logs "no mediator route for consent approver — NOT
notifying" and the request lands in the approver's mediator queue rather than
its live socket. A client that only enables Pickup 3.0 *live* delivery never
sees it; an explicit `delivery-request` on connect is needed to drain the
backlog. (Keyring now sends one.) A second, sharper cause: the VTA only knows
a reply route for a DID that has **authenticated to it at least once** — a
consent request pushed to an approver that has never spoken to the VTA is
dropped ("no mediator route — NOT notifying"), not queued. The client
mitigation is to say hello (`whoami`) when the approver's session opens, so the
VTA caches its route before any request; whether the VTA should instead resolve
and queue for a never-seen DID is the open upstream question. **Measured:**
vta-service 0.28.0, 2026-09-17: manager held for consent proven on the phone;
delivery to a second device pending this route being warm at push time.


### VTI-25 — On the Eucalyptus train the card is delivered, not returned

*Measured on era **B** (see [Stack under test](#stack-under-test)).*

On the 0.28 pin an `allow` verdict carried the membership credential and the
role endorsement inline (`verdict.with.vmc`, `verdict.with.roleVec`). On
`VTI-Eucalyptus-RC-0` the verdict no longer does: immediately after `allow`
the VTC sends **two separate `credential-exchange/issue/0.1` messages** to the
applicant from a durable outbox (retried until acknowledged) — the
`MembershipCredential` and the `CommunityRole` `EndorsementCredential` — and
they can arrive in either order (measured: the role first). Each is a DIDComm
message **typed as the task itself**, not the binding envelope, whose body is
the bare payload `{"credential_response": {"credential": …}}` (an OID4VCI
credential response, verbatim). A client that only waits for a reply to its
submit, or that unwraps only the binding envelope, keeps nothing and sees no
error. Keyring now matches replies by `#response` type and gives the community
session an inbox for the rest. **Measured:** vtc-service 0.11.58 (train code
at `460e0ebb`), 2026-09-18.


### VTI-26 — A consent request is pushed only to a `did:key` approver; every other approver needs the requester to relay

*Measured on era **B** (see [Stack under test](#stack-under-test)).*

`step_up::approver_mediator` (vta-service 0.33.0) returns a route for a
`did:key` approver only — via the VTA's own `[messaging] mediator_did` — and
`None` for anything else: its own test says *"future routable DIDs advertise
their own mediator; not wired yet → None"* for `did:webvh`, and a `did:peer`
falls in the same bucket even though the DID document names its mediator. For
those the VTA logs *"no mediator route for consent approver — NOT notifying;
the approver learns of this request only if the requester relays it (a CLI
cannot)"*. This supersedes VTI-24's reading (it was never about a warm route):
the refusal carries the VTA-signed `consentRequests`, each addressed to its
approver, **so that the requester can forward them**. Keyring now does: on
`auth:consent_required` it relays each request to its recipient over the
same mediator session, then re-submits periodically until the grant is
consumed (the granted notice is route-gated the same way). The upstream
question is whether a VTA should resolve a `did:webvh`/`did:peer` approver's
own `DIDCommMessaging` service and push directly. **Measured:** 2026-09-18.

**Resolved upstream** by `verifiable-trust-infrastructure` #1579, which names
this finding and VTI-24. One predicate returning `None` for every non-`did:key`
approver sat upstream of the TSP attempt, the DIDComm forward and the wake
trigger alike, which is why the symptom arrived from several directions. The
approver's `DIDCommMessaging` service is now resolved and used; a routable
approver never falls back to the VTA's own mediator, so the relay remains the
answer when resolution fails — Keyring keeps it for that case. The PR notes that
live validation against a phone-shaped `did:webvh` approver has not been run;
that is a run we can offer. The Farm's VTA image (`0.34.1-89ebd895`) is that
merge commit; the lab is not on it yet.

**Validated live on era H, 2026-09-21** — the run #1579 said it lacked. An
Android manager's `keys/export-secret` was held for consent; alice logged
*"pushing consent request to approver … transport=didcomm"* with the iPhone
approver's own mediator as the route, the iPhone approved about three seconds
later, and the manager collected the grant. One precondition, and it was ours:
the approver's `did:peer` has to carry a `DIDCommMessaging` service naming its
mediator **by DID** — what `resolve_mediator_did_with_resolver` reads. Keyring
had been minting a DIDComm v1 `did-communication` service holding the socket
URL, which #1579 correctly reads as "no route"; fixed in the client (bifold
`1fcd7b5`). An approver minted before that fix is still unroutable and is
reached only by relay, which is the behaviour #1579 specifies.

### VTI-27 — An authentication or ACL refusal over DIDComm is a `problem-report`, not a `trust-task-error`

*Measured on era **B** (see [Stack under test](#stack-under-test)).*

A trust task whose sender the VTA does not accept — a DID missing from the
ACL, a stale session — never reaches the task handler: `auth_from_message`
fails and `app_try!` answers with `DIDCommResponse::problem_report(...)`
(`vta-service/src/messaging/handlers.rs`), i.e. a plain DIDComm
`https://didcomm.org/report-problem/2.0/problem-report` whose body is
`{code, comment}`. Every refusal the handler itself produces, by contrast, is
a `trust-task-error/0.3` document in the Trust Task envelope, with a typed
`code` and `details`. A client that keys on the envelope type — as the spec
suggests it should — reads the auth refusal as an empty success and carries
on with nothing. **Measured:** 2026-09-18 — Alice's log says *"refusing trust
task: DID not in ACL: did:peer:2…"* while the phone, whose manager had
dropped out of the ACL, showed no error and waited. Keyring now treats a
problem-report answer as a refusal (`VtiRefusal(code, comment)`). The upstream
question is whether the auth gate should speak the same error document as the
tasks it guards, so one code path covers both.

### VTI-28 — A VTA answers a reply with an error, and loops with its DID-hosting daemon

*Measured on era **B**; re-measured on era **C** and gone (see [Stack under test](#stack-under-test)).*

**Root cause (vta-service 0.33.0, `trust_tasks/mod.rs`).** When an inbound
document completes a request the VTA itself sent — the daemon's
`did-management/did/check-name/0.1#response` during `dids/create` — the
dispatcher returns `204` with an **empty body** ("nothing goes back"). That
outcome then passes through `sign_success_response`, whose proof attachment
fails on the empty body and substitutes a `trust-task-error/0.5`
(*"its signature would not attach"*) — and the DIDComm handler seals that
error and **sends it to the daemon as the answer to its own response**. The
daemon answers the error with `did-management/did/problem-report/0.1`; the
VTA's schema for that type disagrees with the daemon's payload (*"mnemonic"
is a required property; "message" is a required property; 'comment' was
unexpected*), so it answers with another `trust-task-error`, and the two loop
every ~400 ms until the mediator throttles the sender
(`e.p.limits.queue.sender`). The same path fires for any unsolicited
reply-shaped document (a late `#response`, a peer's `trust-task-error`).
**Measured:** 2026-09-18 — three storms, ~3,000 messages through the
mediator, each ended only by a restart or the mediator's cap; while one
runs a fresh `dids/create` fails whenever a storm message lands in the
request's wait window. **Suggested fix (verified locally on a patched
build, storm gone):** (1) `sign_success_response` returns an empty body
untouched; (2) the DIDComm trust-task handler sends nothing for an empty
outcome, as `handle_tsp` already does; (3) an unsolicited reply-shaped
document is logged and dropped, never answered; and (4) the VTA's
`did/problem-report/0.1` schema should match what daemon 0.8.3 sends.
Versions as measured: vta-service 0.33.0, did-hosting daemon 0.8.3 (`f579e42`),
mediator 0.26.2.

**Resolved upstream, 2026-09-18.** `vti` #1567 ("let the spine decide what an
inbound document is") moves authorization behind the spine: a transport hands
over the document and the VID it proved and makes no policy decision, an error
document is terminal and answered with nothing, and a threaded document goes to
its waiter. `affinidi-webvh-service` #202 makes the daemon treat an inbound
error as terminal too. Upstream's description of the failure matches this
finding independently, including the mediator's rate limiter as the only thing
that ended it. Re-measured on head (vta-service 0.34.1, daemon at
`35244b7`): the VTA logs `inbound trust-task error from a peer — terminal, not
answered`, drains the backlog and goes quiet; the four end-to-end runs pass.

### VTI-29 — Members who never collect their cards silence the community: the mediator's per-sender queue cap

*Measured on era **B** (see [Stack under test](#stack-under-test)).*

The mediator caps the messages one sender may have waiting for delivery
(`[limits] queued_send_messages_soft`, default 200) and, at the cap, refuses
the sender's *next* message with `e.p.limits.queue.sender` — whoever it is
addressed to. A community delivers a card and a role to every admitted member
by `credential-exchange/issue` (VTI-25); a member that never collects them —
a phone that was reset, an applicant who walked away — leaves two messages in
the community's sender queue until they expire. **Measured:** 2026-09-18,
after a day of runs that forgot personas, the VTC's queue stood at 199 and
the mediator bounced its manifest answers to a live applicant — the phone
showed *"the community did not answer"* and the VTC logged *"received
unhandled problem-report — not replying"*. Raising the limit is the fixture's
fix; upstream's is either a per-recipient cap, or the community pruning its
outbox for recipients that never came back. **Severity:** high — an
unresponsive applicant, or a hundred of them, can stop a community
answering anyone.

**Reproduced on era C, 2026-09-19, at the default limit.** With the fixture
back on `queued_send_messages_soft = "200"` and the stack on upstream head,
the community's send queue stood at **236 messages for 134 distinct
recipients**, the oldest 3.6 days old — roughly two undelivered messages each
(a membership card and a role credential) for personas on phones that were
reset and will never collect them. The mediator then refused what the
community sent to a *live* applicant with `e.p.limits.queue.sender`, and the
applicant's persona mint timed out with no indication why. Nothing was wrong
with either party to that exchange. This is the shape upstream describes:
an unresponsive recipient degrades the sender globally, and per-recipient
accounting plus an eviction path for undeliverable credentials is the fix —
raising the limit only moves the cliff, as we found when we raised it on
era B and it filled again in a day.

**Upstream's fix, and a gap they found in it themselves.**
`affinidi-tdk-rs` **#828** — *"gate forwards per relationship, not per sender
total"* — is merged: the queue is accounted per relationship so one stuck peer
can no longer consume a sender's whole allowance, with a sender-total ceiling
kept well above it as an abuse guard. **#829** then found that the three
depth gates lived in the `didcomm` routing path and so were reached only by a
`forward`: **direct delivery and the TSP bridge stored straight to a
recipient's inbox with no depth limit at all**, which means the gate added for
this finding never covered those paths. It moves the checks outside the
`didcomm` gate and identifies a message by id rather than by a parsed message,
which the direct path does not have. Mediator-generated replies stay exempt
deliberately — they are how a client is told its queue is full, and gating
them would turn a full inbox into an unreportable one.

That second half matters to a client beyond this finding: a wallet that moves
to TSP frames on the mediator socket is on exactly the path that had no limit,
so the two changes want measuring together.

### VTI-30 — A live push can be dropped, and a client that only listens never sees the message

*Measured on era **B** (see [Stack under test](#stack-under-test)).*

The mediator's live delivery is a bounded buffer (`ws_send_buffer`, a
per-client queue of 8, a pub/sub ring of 16 slots); when it is full a push is
dropped — by design, the message stays durable in the recipient's inbox
*"and arrives on its next poll or on reconnect"*. A client that opened live
delivery and never polls therefore loses messages during any burst (VTI-28's
storm produced one). **Measured:** 2026-09-18 — a vetting statement sat in
the applicant's inbox with its socket open. Two things on the client side,
both fixed in Keyring: this mediator's Pickup 3.0 `delivery-request` needs a
`recipient_did` in the body (`MessagePickupDeliveryRequest`, affinidi-
messaging-sdk) or it answers a problem-report; and a `delivery` carries
each queued message as a **base64url attachment** (`Attachment::base64`),
not `data.json`. Keyring now polls every 15 s. For upstream: the SDK's
extension to the Pickup 3.0 body is undocumented, and a `status` on
`live-delivery-change` could carry the dropped count so clients know to poll.

**Being fixed upstream** as `affinidi-tdk-rs` #830 (open, tracked there as
KR-30), and by the second route: a drop raises a per-connection resync flag and
the writer sends a Pickup 3.0 `status` carrying the live `message_count` as
soon as the socket moves again. One caution from the client side, since the PR
reasons that recovery "needs no new protocol on the client side" — true of the
protocol, and not automatically true of a client. Keyring, until we fix it,
drops *every* pickup-protocol frame on arrival, `status` included, because it
only ever treats pickup as the answer to a request it made. An unsolicited
`status` therefore reaches a listener that ignores it, and the drop stays
invisible exactly as before. Worth saying in the PR, because it decides whether
the fix works in the field: the signal is only as good as the clients that act
on an *unsolicited* one, and that is a behaviour change for any client built
the way ours was. Ours to fix on our side.

**Merged** (2026-09-19) and on our stack since era E (mediator 0.28.9). The
client half is tracked as M1 of `docs/plans/message-protection-plan.md`; until
it lands, Keyring's 15-second poll is what recovers a dropped push.

### VTI-31 — A dropped terminal error is never acknowledged, so it never leaves the sender's queue

*Measured on era **C**, with `affinidi-tdk-rs` PR #829 (`b544da04`) as the
mediator.*

VTI-28's fix is right: an inbound error is terminal and answered with nothing.
VTI-29's fix is right too: a sender's queue depth is accounted and capped. They
interact, and the result is that a service which once emitted a storm is
permanently rate-limited by its own history.

**Measured.** The DID-hosting daemon's outbound queue held **223 messages, all
addressed to one VTA**, the oldest 2.6 days — the residue of the VTI-28 loop.
Of those, **57 are still in the VTA's inbox** and **166 had already been
delivered**: the VTA drained them, logged each as *"inbound trust-task error
from a peer — terminal, not answered"*, and dropped it. Correct behaviour — and
no acknowledgement follows a drop, so all 223 stay in the daemon's queue. Once
PR #829 runs the depth gates on the direct-delivery path, the mediator refuses
everything the daemon sends with `e.p.limits.queue.sender`
(`messages::queue_limits`), and DID creation stops for every client of that
daemon. The queues do not drain on their own; they stood unchanged across
repeated checks.

**Why it matters beyond this fixture.** Any message a recipient deliberately
declines to process — a terminal error, an unsupported type, a document
refused by policy — has the same shape: delivered, never acknowledged, counted
against the sender forever. The expiry sweeper is the only thing that clears
it, and on a 2.6-day-old queue it had not.

**Suggested shape.** A recipient that drops a message terminally should still
tell the mediator it is done with it — the acknowledgement means "stop holding
this for me", not "I acted on it". Failing that, the eviction path already
planned for VTI-29 needs to cover delivered-but-unacknowledged messages, not
only undeliverable ones. This is worth deciding before #829 lands, because
#829 is what turns a stale queue into an outage for the sender.

**Fixed upstream, and the suggested shape above was wrong.** `affinidi-tdk-rs`
#834 answers this directly and corrects the diagnosis: the acknowledgement
contract we asked for **already existed** on both receive paths — a terminal
drop by the application does release the message. The 223-message residue was
not a missing ack. It was **acks that were issued and then thrown away**:
`ack_via_source` had two failure arms, a source transport that had gone and a
failed `transport.ack()`, and both discarded the ack with only a `debug!` or a
`warn!` — invisible in a default deployment. Undeliverable acks are now parked
and retried on their own clock, same-transport-only (a transport id names a
wire to a *particular* mediator, and an ack is a delete of a message id at that
mediator), bounded at 4,096 entries and five minutes, with every abandonment
counted rather than silent.

Worth recording plainly: we proposed a protocol change and the real defect was
a dropped error path. The finding was right that the queue filled and right
about why it mattered once #829 gated the direct path — upstream says so —
and wrong about the mechanism. #834 has been on our stack since era E
(mediator 0.28.9), where the ceremony passes at upstream's stock limits; the
specific residue has not been re-created and re-measured against it.

### VTI-32 — An invitation is too large for the channel it is meant to travel on

*Measured on era **C**.*

An `InvitationCredential` issued for one persona, wrapped as the link a console
would show, is **6,331 bytes**:

```
keyring://vti/invitation?c=<base64url of the whole credential>
```

A QR code cannot carry it. QR's byte mode tops out at **2,953 bytes** (version
40, error-correction level L, the most generous configuration there is), so
this payload is over the maximum by **3,378 bytes** — more than twice what
fits. No choice of version or error-correction level changes that; the
credential would have to shrink by more than half. Alphanumeric mode is not a
way out either: base64url uses `-` and `_`, which are outside QR's
alphanumeric character set, so the encoder falls to byte mode regardless.

This matters because scanning is the delivery channel. [VTI-21](#vti-21)
already records that an invitation has no delivery channel of its own — it is
handed over out of band — and out of band in a wallet means a QR. So the one
mechanism available is the one the payload cannot use.

It shows up on iOS first for an unrelated reason: `xcrun simctl openurl`
truncates a URL this long (at 2048 characters, measured 2026-09-22: a
1,930-character link arrives whole, a 2,063-character one does not), and the client then reports `invitation link
rejected: JSON Parse error: Unexpected end of input`, which reads as a
malformed credential rather than a truncated one. Android's `am start`
tolerates the length, which is why the same rung passes there — a platform
difference masking a protocol-level limit.

**Suggested shape.** Invite by reference rather than by value: the invitation
carries a short identifier and the client fetches the credential from the
community over a channel that has no size limit, exactly as it already fetches
a manifest. That keeps the QR small whatever the credential grows to. Failing
that, the credential needs to lose more than half its bytes, which seems the
harder road.

### VTI-33 — A mediator built without its `tsp` feature drops every TSP frame in silence

*Measured on era **G**.*

`affinidi-messaging-mediator`'s default features are `didcomm`, `redis-backend`,
`jemalloc` and `vta` — **no `tsp`** (`tsp = ["dep:affinidi-tsp"]`). A mediator
built that way cannot classify a TSP frame, so it does nothing with one: no
forward, no refusal, no log line at the default level. Meanwhile the VTA and the
VTC it serves each advertise `TSPTransport` pointing at that mediator.

**Measured.** With a phone sending a correct Rev 3 relationship invite and then
a `vtc/join-requests/submit/0.2` over TSP — both visible in the phone's own log
— the VTC logged nothing at all, and the mediator logged no forward. Rebuilt
`--features tsp`, the identical client traffic produced *"accepted an inbound
TSP relationship request … state=Bidir"* and *"join request realized"* at the
VTC within the same second.

**Why it matters.** Both services at the ends already refuse to advertise what
they cannot serve — the VTC's `transport_capability` check exists for exactly
this, and `vta-service`'s own source comments that advertising `#tsp` without
the feature *"would publish a"* promise nothing can keep. The mediator is the
one component every frame crosses and the only one without that check. A
conforming client sees only that its peer never answers, which is the most
expensive failure to diagnose there is. This cost more time than anything else
while bringing the ecosystem legs onto Rev 3.

**Suggested shape.** Put `tsp` in the mediator's default features now that
Rev 3 is the ecosystem's transport; failing that, log at startup that TSP is
compiled out, and log at `warn` the first TSP-shaped frame a non-TSP build
receives.

### VTI-34 — `tsp = true` is inert on a VTA built without the `tsp` feature, and nothing says so

*Measured on era **G**.*

`vta-service`'s `default = ["setup", "keyring", "rest", "didcomm",
"cli-synthesis"]` carries no `tsp`, so a default build has no TSP dispatcher.
Setting `tsp = true` in `config.toml` on such a build is accepted, logged
nowhere, and changes nothing — the agents restarted clean and their DID
documents did not move. Rebuilt `--features tsp`, all three agents reported
*"TSP relationships restored from the durable store"*.

The VTC is the other way round (`tsp` on by default), with the reasoning in its
own source. Either the VTA follows it, or a VTA that reads `tsp = true` without
the feature compiled in says so at startup — the same class of silence as
[VTI-06](#vti-06), for a setting that decides whether a transport exists.

### VTI-35 — A VTC cannot advertise the TSP service it is able to serve

*Measured on era **G**.*

`vtc-service` serves TSP by default and checks at startup that it can serve
what it advertises — but it has no way to *publish* `#tsp`. `vtc-host` emits
`#vtc-rest` and `#vtc-status-list` only, and upstream's own comment says *"the
VTC has no service-management surface of its own"*. The reference VTC's `#tsp`
arrived at DID log version 3, published long after mint by editing the log.

We did the same: `vta did-mgmt dids edit` on the community VTA that holds the
VTC's DID, then installing the new log where the VTC serves it
(`vtc/data/did/<host>.jsonl`) and restarting. It works, and the capability check
passes. But it means a community operator who wants TSP-capable members to reach
them over TSP must hand-edit a DID log — and until they do, every client that
reads the document (as a Rev 3 client must, to choose its carriage) correctly
concludes the community does not speak TSP. Related to [VTI-12](#vti-12), which
is the same shape for DIDComm.

**Suggested shape.** A `vtc services tsp enable` mirroring the VTA's, or have
`vtc-host` emit `#tsp` when the binary carries the feature and a mediator is
configured.

### VTI-36 — `vta services tsp enable` tells a self-hosted VTA to redeploy a log it already serves

*Measured on era **G**.*

On a VTA whose DID is self-hosted, `vta services tsp enable --mediator-did …`
writes DID log version 2 and then instructs the operator to fetch the log with
`pnm did-mgmt dids get-log` and *"redeploy did.jsonl to your host"*. In the same
output it says *"This VTA's DID is self-hosted"*. A restart published version 2
with no redeployment at all. The advice is right for an externally hosted DID
and misleading for this one, and the binary knows which case it is in. Low —
documentation. The command itself is excellent: it advertised TSP on an existing
agent offline, with no re-provisioning and so no new DIDs to cascade.

---

### VTI-37 — A consent refusal loses its challenge once the approver set grows

*Measured on era **H** (see [Stack under test](#stack-under-test)).*

A task held for consent is refused with `auth:consent_required`, and its
`details` carry everything the requester needs to act: the `payloadDigest` it
correlates the grant by, and one **VTA-signed consent request per approver** in
`consentRequests` — the documents a requester relays when the VTA has no route
to an approver (VTI-26). vti #1131 bounded `details` at 4,096 bytes of
canonical JSON (`DETAILS_MAX_JCS_BYTES`, `vta-service/src/trust_tasks/helpers.rs`)
and drops the whole member past it, keeping the code. With two approvers the
challenge fitted; with **three it did not**: alice logged *"error
`details` exceeds the framework bound and was dropped; the code still went out
members=8"*, and the requester received a bare `auth:consent_required` — no
digest, and nothing to relay.

The consequence lands on exactly the case the relay exists for. When every
approver is routable the VTA's own push still reaches them (measured: the
approval arrived), so only correlation is lost. When one is not — a `did:key`
device the VTA has no mediator for, or any approver whose document names no
mediator — the request that would have been relayed is gone, and that approver
is never asked. A set of several approvers is the ordinary shape of a
"two of three devices" rule, so this is not an edge case.

Keyring now reads a bare `auth:consent_required` as held and re-submits until
the grant lands (bifold `3c9b517`); it cannot recover the relay. Possible
upstream answers: exempt the consent challenge from the bound, or carry the
signed requests by reference (a fetch by `correlator`) rather than inline.
**Measured:** vti `a96fe02f`, 2026-09-21; the bound dates from `f68178ee`
(2026-08-26), so era G carried it too.

### VTI-38 — A cancelled relationship is forgotten before the VTA can answer the cancel

*Measured on era **H** (see [Stack under test](#stack-under-test)).*

TSP Rev 3 §7.3: a cancellation of a relationship held in both directions is
answered with a cancellation, *before* it is forgotten. Both halves of the
stack mean to do this, in the wrong order. On receiving `XRFD` the SDK's
inbound control path (`affinidi-messaging-sdk`, `protocols/tsp.rs`, read at
tdk-rs `ad36f0b1`) advances the relationship — to `None` — and only then
reports `reply_expected = true` because the state *was* `Bidirectional`.
`vta-service`'s `handle_tsp_control` (`messaging/service.rs`) honours it by
calling `cancel_relationship`, which computes `SendCancel` from the state now
stored, `None`, and is refused:

```
WARN vta_service::messaging::service: could not send a TSP relationship cancellation
  reason=the peer cancelled a mutual relationship (§7.3)
  error=Config error: invalid relationship transition: invalid transition: SendCancel in state None
```

The relationship does end on both sides, so no traffic is misrouted; what is
lost is the answer §7.3 requires, and with it the one signal that tells the
cancelling peer the other side agreed. Every mutual cancel will do this.
Reproduce with `tsp-reference/ref-04s-rev3-relationship` (XRFI → XRFA →
XRFD against the lab VTA). **Measured:** vti `a96fe02f`, linking
`affinidi-messaging-sdk` 0.26.12, 2026-09-21. The fix is upstream's to place:
send the answer before advancing the stored state, or let `cancel_relationship`
answer from the state the inbound path saw.

### VTI-39 — A TSP reply that fails to send once is lost

*Observed on era **H** (see [Stack under test](#stack-under-test)) — once, not yet reproduced.*

alice carried out a phone's `keys/export-secret/0.1` over TSP (*"key secret
retrieved … outcome=success"*, *"TSP trust-task dispatched … status=200 OK"*)
and then logged, 19 ms later:

```
WARN vta_service::messaging::service: failed to send TSP reply recipient=did:peer:…
  error=Transport (HTTP(S)) error: Could not send TSP message: reqwest::Error { kind: Request,
  url: "https://keyring-vti-mediator.ngrok.app/mediator/v1/inbound",
  source: hyper_util::client::legacy::Error(SendRequest, hyper::Error(IncompleteMessage)) }
```

`IncompleteMessage` is a pooled connection closed under the request — the
shape Keyring's own transport met and now retries (the stale keep-alive
socket). The VTA does not retry, so the phone waited out its 30 s and reported
*"the VTA did not answer"* for a task the VTA had completed, with a key
already handed over. The DIDComm path queues through a durable outbox; the
TSP reply path appears to be a single attempt. Once in the whole log, through
an ngrok tunnel, so the fixture may be most of it; recorded because the
consequence — a completed task the caller believes failed — is the kind that
invites a blind retry. **Observed:** vti `a96fe02f`, 2026-09-22T01:22Z.

### VTI-40 — vta-browser-plugin: a consent Approve can be recorded as a Deny

*Observed against the Farm (era F) with upstream's browser client, 2026-09-22.
`vta-browser-plugin` at `9643c57`; still present on `origin/main` `f568a59`.*

**(a) What happens, and what should.** On a first sign-in at a relying party
("Sign in via VTA-proxied SIOP"), the identity picker opens, the user selects
the persona and clicks **Approve & remember identity**, and the page receives
`identity selection denied by user`. The plain wallet login did the same
(`login denied by user`) after Approve. Expected: an Approve is delivered as
an approval.

**(b) Reproduce.** Chrome on macOS, the extension loaded unpacked from
`packages/extension` at `9643c57`. At a relying party that offers VTA-proxied
SIOP, start a first sign-in, choose the persona, and click Approve. The race
makes this intermittent. It is most visible on a first sign-in, when the
service worker is cold.

**(c) References.** `packages/extension/src/confirm.tsx:88-102` at
`9643c57`: `decide()` calls `chrome.runtime.sendMessage({ type:
RUNTIME_CONSENT_RESULT, … })` at line 94 and `window.close()` at line 102 in the
same tick, without awaiting delivery.
`packages/extension/src/background.ts:750` (`requestConsent`) registers a
`chrome.windows.onRemoved` listener (line 868). Its handler settles the consent
as a denial (`settle(false, false)`, line 865). When the removal reaches the
service worker before the result message does, the denial wins, and the late
approval is ignored because `settled` is already true. Every consent surface
(login, proxy login, identity picker, task consent, disclosure) goes through
`decide()`.

**(d) Local workaround.** Close the window only after the message settles:

```ts
Promise.resolve(chrome.runtime.sendMessage({ type: RUNTIME_CONSENT_RESULT, … }))
  .catch(() => undefined)
  .finally(() => window.close());
```

With this change the same sign-in succeeded first time. It is applied
uncommitted in our `external/` clone, and the diff is kept for an upstream PR.
Keyring does not ship the plugin; we met this while using upstream's client as
the Farm's admin surface. The plugin's own guidance treats consent prompts as
security controls, where "one silently lost prompt is a gated action that never
got its human check". This is the inverse failure: an approval that was given,
silently lost.

### VTI-41 — TSP Rev 3 does not cross two mediators: no accept comes back; DIDComm does

*Measured on the VTA Farm (era F′), 2026-09-22. Promoted from VTI-Q15.*

**(a) What happens, and what should.** A client on one mediator introduces
itself (XRFI) to a community on another mediator, and no accept (XRFA) ever
comes back, whatever the route. The same client on the community's own
mediator gets the accept in about a second, and the manifest over TSP after
it. DIDComm between the same two mediators answers on every route. Expected:
a TSP relationship forms across two mediators, as DIDComm does.

**(b) Reproduce.**
- Rung: `tsp-reference/ref-04f-farm-cross-mediator/run.mjs` in this
  repository. The client is upstream's own TSP library, `@openvtc/vti-tsp-js`
  **0.3.0**, built from `OpenVTC/vta-browser-plugin` `packages/tsp-js` at
  `bfdb0dc` (vendored in keyring-bifold `packages/trust-tasks/vendor/`), with
  `@openvtc/vti-didcomm-js` 0.7.0. The identity is a fresh
  `did:peer:2` minted per run, whose DIDComm service names its own mediator.
- Commands (from the rung's directory, after `npm install`):
  - across mediators, community on the Farm Full Stack:
    `FARM_MEDIATOR_DID=<shared Farm mediator> COMMUNITY_DID=<keyring-test VTC> SENDERS=peer ONLY=tsp TSP_ATTEMPTS=1,2 WAIT_MS=30000 node run.mjs`
  - across mediators, `first-vtc`: the same with `COMMUNITY_DID=<first-vtc>`
    (defaults) and `WAIT_MS=90000`;
  - the same-mediator control:
    `FARM_MEDIATOR_DID=<keyring-stack mediator> COMMUNITY_DID=<keyring-test VTC> SENDERS=peer ONLY=tsp TSP_ATTEMPTS=0 node run.mjs`
- DIDs:
  - shared Farm mediator `did:webvh:QmagBwJ5NMNVqSBAEcFs3WmTRu4kWNPXBM6a9Sav1VGEAV:dids.ic3.dev:firstperson-mediator` (0.28.23);
  - keyring-stack mediator `did:webvh:QmdLqw6dy6x2cFhcuS2qJbqnToWhnz3CophCtGDTdVN9qi:dids-keyring-stack.ic3.dev:keyring-stack-mediator` (0.28.28-6394a03a);
  - storm mediator `did:webvh:QmTS3a3H9Dk4ZMPAZ8jNWGeyPbuKrPbrPZcSbg8CJ6yynD:webvh.storm.ws:mediator` (0.28.26);
  - keyring-test VTC `did:webvh:QmdervYcngPtJnKGuZSzH2tvDe8q274cty8324G4finFnV:dids-keyring-stack.ic3.dev:keyring-test-vtc` (vtc 0.11.58-d9a5be02);
  - `first-vtc` `did:webvh:QmXi1PZD4NEvcvjfErAzVoCGtBFEv7dhXZQJHvcFY4U83F:webvh.storm.ws:first-vtc` (0.11.58).
- Routes tried across mediators, each an XRFI whose route is
  `[our mediator, us]` (§5.3.3):
  1. **routed via our mediator** (`packRouted` to our mediator, onward hops
     `[their mediator, the community]`): no XRFA in 30 s (keyring-test), and
     none in 90 s (first-vtc);
  2. **POSTed into the community's own mediator** (`POST …/mediator/v1/inbound`,
     direct frame to the community): the mediator answers
     `200 {"data":{"Stored":{"messages":[["<community DID>", …]]}}}`, then no
     XRFA in 30 s (keyring-test) or 90 s (first-vtc).
- Times (UTC, 2026-09-22): first-vtc 08:18:55 and 08:22:13; keyring-test
  15:51:11; the same-mediator control 17:33:51.

**(c) References.**
- **Same-mediator control** (17:33:51Z): the XRFA names our invite's digest in
  **1.15 s**; the join manifest over TSP (the Trust Task binding envelope) is
  answered in **0.33 s** with 2 criteria; an XRFD then ends the relationship.
  So the community serves TSP, and the client and its frames are sound.
- **"Stored" proves** the invite reached the community's own mediator and was
  queued for the community, as a local recipient
  (`messages/inbound.rs:191-229` at tdk-rs `6394a03a`: a frame whose receiver
  is not the mediator is stored for that local recipient). Route 2 takes our
  mediator out of the outbound path. What remains is the **return leg**: the
  community's accept must travel back across mediators to
  `[our mediator, us]`.
- **Not the relay allowlist, under defaults.** `relay_trusted_mediators`
  defaults to `""` (`conf/mediator.toml:698` at `6394a03a`), and an empty list
  admits any relaying peer (`messages/protocols/routing.rs:144-150`,
  `relay_peer_trusted`: `allow.is_empty() || …`; upstream's own test
  `relay_peer_trusted_empty_allowlist_accepts_any`). It is a cause only if a
  Farm mediator sets a non-empty list without the other in it.
- **Relay is implemented.** A routed TSP frame's onward hop is forwarded
  (`inbound.rs`, the `TspMessageType::Routed` arm: `forward_to_next` for the
  last hop, and `pack_routed` re-sealing an intermediate one).
  `enable_inter_mediator_relay` defaults to `"false"`, with relay "also
  permitted when global_acl_default grants SEND_FORWARDED"
  (`conf/mediator.toml:281-287`). DIDComm relays between these same mediators
  work, so general inter-mediator relay is permitted there.
- **Cause: SUSPECTED, not proven.** The accept is lost on its way back across
  mediators: in the community's mediator relaying it onward, or in the
  receiving mediator admitting an anonymous routed relay. Settling it needs
  the two mediators' logs around the times above, or their `[security]` and
  `[processors.forwarding]` configuration. We have neither.

**(d) What Keyring does.** keyring-bifold#66: a community whose `TSPTransport`
names a different mediator than our session's is asked over DIDComm from the
start, and that choice is remembered per community. On the Farm the first Join
went from about 34 s to about 10.5 s. Communities on the phone's own mediator
keep TSP, with #64's TSP→DIDComm fallback as the safety net. The rule reads the
community's own document, so Keyring returns to TSP automatically once the
relay works.

**Ask.** Upstream or the Farm operator: find where the accept is lost across
two mediators (the two mediators' logs at the times above), and fix the relay,
or its configuration, so that a TSP relationship forms across mediators.
**Verification:** re-run the rung's cross-mediator legs; an XRFA naming the
invite, then the manifest over TSP, is the pass.

### VTI-43 — A TSP reply sent before the relationship is accepted never arrives

(a) **What happens.** A phone greets a VTA with an `XRFI` invite and asks its
first Trust Task 16 ms later. The VTA answers correctly and quickly — and the
answer is never received, because it is dispatched before the VTA has accepted
the relationship that would carry it.

From the VTA (`bob.log`, 2026-09-22, DIDs elided):

```
21:27:40.636  WARN vta_service::messaging::auth: refusing trust task:
              DID not in ACL: did:peer:2… type_uri=…/auth/whoami/0.1
21:27:40.638  INFO vta_service::messaging::tsp_inbound: TSP trust-task
              dispatched sender=did:peer:2… status=403 Forbidden
21:27:40.966  INFO vta_service::messaging::service: accepted an inbound TSP
              relationship request sender=did:peer:2… request=Invite
              state=Bidirectional
```

The refusal is dispatched at `.638`; the relationship reaches `Bidirectional`
at `.966`, **328 ms later**. From the phone, over the same seconds:

```
15:27:40.022  [TrustTasks:VtaClient] greeted …bob… with an XRFI invite
15:27:40.038  [TrustTasks:VtaClient] asked …bob… …/auth/whoami/0.1 over rev3
```

…and nothing further for the remaining 60 s of the run: no reply, no error.

**The contrast is in the same log, eleven seconds later** — the same three
events in the opposite order, 4 ms apart, and it works:

```
21:27:51.110  accepted an inbound TSP relationship request sender=did:key:z6MksJ44…
21:27:51.114  trust-task received type_uri=…/vta/webvh/servers/list/1.0
21:27:51.117  TSP trust-task dispatched sender=did:key:z6MksJ44… status=200 OK
```

Accept first, then the task, and the answer arrives. Dispatch first and it does
not. Same VTA, same transport, eleven seconds apart.

**What it costs a person.** Every flow whose first task is deliberately sent
before authorisation. Keyring's no-QR link is exactly that: the phone shows its
key and signs in *before* an administrator has granted it, so that the screen
can say "not yet" — and that refusal is the one that is lost. The person is
left on "I've been added" with nothing to read. Granting the key first and then
signing in passes on the same build, VTA and device, which is how the ordering
was isolated.

(b) **How to reproduce.** `e2e/run-vta-link.js` with `LINK_MODE=manual` against
a VTA that does not yet hold the phone's temporary key: the first "I've been
added" hangs. The same run with `GRANT_FIRST=1` — the key granted before the
first sign-in, which is what the QR flow does — passes. Measured on Android 16
(emulator-5554, AVD API36_S25_A), store-config Release APK, heads wallet
`69d8f58a` · bifold `03a882ae`, runner VTA `bob`. iOS does not usually hit the
window: it fires its first ask later than 16 ms after the greeting.

(c) **Where it lives.** `vta_service::messaging::auth` (the refusal),
`vta_service::messaging::tsp_inbound` (the dispatch) and
`vta_service::messaging::service` (the relationship accept).

**The limit of this evidence, stated plainly.** These logs show that the reply
was produced, that the relationship was not yet `Bidirectional` when it went
out, and that nothing arrived at the phone. They do **not** show the reply being
dropped at a named point: that needs a packet-level capture of the TSP wire, or
a VTA-side trace at the send path, neither of which we have taken. The ordering
is what the evidence establishes; the drop is inferred from it.

(d) **What we do meanwhile.** Two client changes, for two different failures.
The peer's accept already reaches us — our codec recognises `XRFI`/`XRFA`/`XRFD`
and refuses them by name, and `unpackTrustTaskFromPeer` reports a control frame
as "no Trust Task here" so that it is still acknowledged — so a first ask that
is still unanswered when that accept lands is re-sent at once (about 330 ms on
these timings). Separately, a VTA that never answers TSP at all is asked again
over DIDComm, on a deadline measured rather than guessed: a healthy first task,
including the greeting, answers in 1.76 s (then 0.68 s and 0.76 s), so the
deadline sits at 10 s with roughly five times headroom. Related: [VTI-27](#vti-27)
and [VTI-39](#vti-39), both about answers that are produced and never reach the
client.

### VTI-42 — A community names `withdraw/0.1` as the remedy, and its DIDComm router has never heard of it

(a) **What happens.** An applicant with an open request is told by the community
itself to close it with `vtc/join-requests/withdraw/0.1`. Sent as a DIDComm
message of that type, to the same community, over the same carriage, it is
answered `unsupported message type`. Sent again with one field changed — the
DIDComm `type` set to the binding envelope, the document inside untouched — the
same community withdraws the request and answers, signed, in under a second.

The verb is implemented. What is missing is an arm in the DIDComm router, and
upstream has already written down that this router is a second list:

> DIDComm had a hand-written router keyed on **task URIs**, so a verb was
> reachable there only if somebody had also written it down in
> `messaging::route`. … not because the service lacks them, but because the
> router is a second list that nobody remembered to extend.
> — `vtc-service/tests/didcomm_envelope_binding.rs`

`vtc-service/src/messaging.rs` carries arms for `join-requests/submit`,
`manifest` and `status`. There is none for `withdraw` or `supplement`, both of
which the dispatcher serves and both of which `requestAlreadyOpen` names as the
applicant's way out.

The refusal that comes back is a DIDComm `problem-report`, not a
`trust-task-error` — VTI-27's shape on a second route — so a client correlating
answers by task type never matches it and waits out its whole timeout. On a
phone that reads as *the community did not answer*: thirty seconds of silence
and a wrong diagnosis, for a question the community refused in under a second.

**Measured, 2026-09-22.** Community `keyring-test` (VTC 0.11.58 on
`dids-keyring-stack.ic3.dev`) and our own lab community (VTC 0.11.58), both over
each community's own mediator:

| Wire type | Answer |
| --- | --- |
| `…/vtc/join-requests/withdraw/0.1` | problem-report `e.p.msg.bad-request`, "unsupported message type: …/withdraw/0.1" |
| `…/vtc/join-requests/withdraw/0.2` | the same, so it is not a version-string mismatch |
| `https://trusttasks.org/binding/didcomm/0.1/envelope` carrying the same document | `…/withdraw/0.1#response`, `status: "withdrawn"`, signed `eddsa-jcs-2022` + `mldsa44-jcs-2024` |

Before that, the submit that named the remedy:

```json
{
  "code": "vtc/join-requests/submit:requestAlreadyOpen",
  "details": { "reason": "conflict",
               "requestId": "3bd40964-47bb-4b67-b242-2f945aabef1c",
               "status": "deferred" },
  "message": "conflict: an open join request already exists (id 3bd40964-…,
              status deferred); withdraw it with vtc/join-requests/withdraw/0.1,
              or await its decision, before resubmitting"
}
```

**Why it matters beyond the verb.** An applicant deferred by a community it
cannot ask to withdraw can neither withdraw nor re-apply — `requestAlreadyOpen`
refuses the second — so the only way out is an administrator. And the client
that hits this learns nothing: the refusal is unmatchable, so it reads as
silence.

(b) **How to reproduce.** `tsp-reference/ref-20-local-vetting/join.mjs`, whose
`withdraw` command and `ENVELOPE=1` mode exist for this measurement
(`WITHDRAW_TASK_URI` overrides the version string):

```sh
node join.mjs <communityDid> <communityMediatorDid> submit            # → requestAlreadyOpen
node join.mjs <communityDid> <communityMediatorDid> withdraw <id>     # → unsupported message type
ENVELOPE=1 node join.mjs <communityDid> <communityMediatorDid> withdraw <id>   # → withdrawn
```

(c) **Where it lives.** `vtc-service/src/messaging.rs` (the router's arms);
`vtc-service/src/join/orchestrate.rs:102` (the message naming the remedy);
`vtc-service/tests/didcomm_envelope_binding.rs` (upstream's own statement of the
class, and the envelope as its remedy).

(d) **What we do meanwhile.** Keyring sends Trust Tasks over DIDComm inside the
binding envelope, which reaches the dispatcher for every verb — including on the
cross-mediator communities where [VTI-41](#vti-41) forces us onto DIDComm — and
surfaces a problem-report that belongs to a pending ask as a typed refusal
rather than waiting out the timeout. Related: [VTI-27](#vti-27) (refusals that
arrive as problem-reports) and [VTI-Q17](#open-questions-and-requests)
(idempotency, which is what a safe retry of a non-idempotent verb would need).

## Beyond VTI

Findings in other upstreams that a VTI deployment exposes. Numbered `EXT-NN`,
permanent like the rest.

### EXT-01 — credo-ts rejects a DID document whose `service.type` is an array

*Measured against the VTA Farm (era F), 2026-09-20.*

The Farm mediator's DID document declares `#service` as
`"type": ["DIDCommMessaging"]` and `#auth` as `"type": ["Authentication"]`. DID
Core allows `type` to be a string or a set of strings, so the document is valid.
credo-ts (`0.7.1-pr-2704`) decorates `DidDocumentService.type` with a plain
`@IsString()`, and class validation discards the whole document:
`ClassValidationError: DidCommV2Service … type must be a string`, surfacing to
the caller as `notFound`. One property above it, `serviceEndpoint` already uses
`IsStringOrJsonObjectSingleOrArray` — the pattern exists and was not applied.

**Not an OpenVTC defect**: the Farm emits a conformant document and should not
change. Keyring patches credo-ts (a single-element array collapses to its
string; longer arrays are left alone, since DID Core states no precedence) and
the fix belongs upstream in credo-ts. Upstream's own browser client resolves
`did:webvh` through `@openvtc/vti-didcomm-js` with no DID-document class model,
which is why nobody met this before a Credo-based wallet did.

*2026-09-22:* the storm mediator that `first-vtc` names
(`did:webvh:QmTS3a3H…:webvh.storm.ws:mediator`) publishes the same array
`type`, so any Credo-based client that routes to that community meets this too, not
only one on the Farm.

---

## Farm cross-mediator round trip (2026-09-22)

Step 2 of our Farm measurement, read-only, with no app involved. A fresh client
on the Farm's mediator asks `first-vtc`, which lives on another operator's
mediator, for its join manifest (`vtc/join-requests/manifest/0.2`), and times
the answer. The rung is `tsp-reference/ref-04f-farm-cross-mediator/run.mjs`.

**(a) What happens.**

| Path | Result |
| --- | --- |
| DIDComm **A**: one forward to the Farm mediator, `next` = `first-vtc` | **Answered**: the manifest (1 criterion), live on the open socket, in **1.10 s** (2.79 s on the first, cold run). The Farm relays to storm; `first-vtc`'s answer comes back storm → Farm. |
| DIDComm **B**: authcrypt forward POSTed to storm's `/inbound` | **Answered**, live, in **0.81 s**. Storm acknowledges with `200 … "data":"Forwarded"`. The same forward sent anoncrypt is refused: `400 w.m.message.anonymous` (storm sets `block_anonymous_outer_envelope`, a legitimate setting). The DID document's own URI (`…/mediator/v1`) answers `404`; senders must add `/inbound`. |
| DIDComm **C**: forward to the Farm, `next` = storm, wrapping a forward to storm, `next` = `first-vtc` (upstream's `cross_mediator_forwarding` example) | **Answered**, live, in **0.36 s**. |
| DIDComm, sender a bare `did:key` | **No answer** on any path, live or on a later pickup, as expected: a `did:key` has no service, so `first-vtc` has nowhere to send the reply. A client on another mediator needs a DID that names its mediator (we used `did:peer:2` with a `DIDCommMessaging` service naming the Farm mediator by DID). |
| TSP Rev 3 XRFI (route `[Farm mediator, us]`), direct frame to the Farm | **No answer.** Expected: the Farm stores a frame addressed to someone else only for a *local* recipient, and `first-vtc` has no account there. |
| TSP Rev 3 XRFI, routed via the Farm to storm | **No answer within 90 s.** Not observable further from outside. Storm must admit the Farm as a relaying peer (`relay_trusted_mediators`) for this to pass. |
| TSP Rev 3 XRFI, direct frame POSTed to storm's `/inbound` | **Stored** for `first-vtc` (`200 {"Stored":…}`), then **no XRFA within 90 s**. See VTI-Q15. |

A socket opened after an answer had already been delivered live receives that
answer again. That is at-least-once redelivery: live delivery does not delete
until acknowledged. It is not a defect. Separately, a second socket for the same DID
terminates the first with `w.websocket.duplicate-channel`, so a client must close
before it reconnects.

The Farm mediator was unavailable twice during the measurement. Both
`/authenticate/challenge` and `/readyz` answered `503 no available server`
from between 07:59:50Z and 08:02:34Z until 08:07:50Z, and again from about
08:10Z until 08:14:14Z. It returned with `uptime_seconds: 5`, so it was
restarting, not recovering in place. It was stable from 08:14Z onward.

**(b) Reproduce.** `cd tsp-reference/ref-04f-farm-cross-mediator && npm install &&
SENDERS=peer node run.mjs`. Variables: `ROUTES=A,B,C`; `ONLY=didcomm|tsp`;
`TSP_ATTEMPTS=0,1,2` (Farm direct, routed via Farm, POST to storm);
`WAIT_MS`. It needs only public endpoints: the Farm mediator
`did:webvh:QmagBwJ5NMNVqSBAEcFs3WmTRu4kWNPXBM6a9Sav1VGEAV:dids.ic3.dev:firstperson-mediator`
(0.28.23), `first-vtc`
`did:webvh:QmXi1PZD4NEvcvjfErAzVoCGtBFEv7dhXZQJHvcFY4U83F:webvh.storm.ws:first-vtc`
(log `4-QmebQhmt…`), and the storm mediator (0.28.26, reporting
`degraded`). The identity is minted fresh on every run.

**(c) References.** At `affinidi-tdk-rs` `ad36f0b1`, in
`crates/messaging/affinidi-messaging-mediator/src/messages/inbound.rs`:
- the anonymous-envelope refusal is at :1065-1083;
- the TSP pass-through ("receiver != this mediator → … store for the local
  recipient") is at :186-224;
- the routed-relay peer allowlist (`authorization.relay.untrusted_peer`) is at
  :254-292.

The double-forward pattern is from
`crates/messaging/affinidi-messaging-helpers/examples/cross_mediator_forwarding.rs`.

**(d) What Keyring does.** A phone on the Farm needs a `did:peer:2` naming its
mediator by DID, which Keyring's VTI client DID already carries (bifold
`VtiMediatorTransport.createVtiClientDid`). With that, DIDComm to a community on
another mediator works on every sender route. TSP to `first-vtc` stays
unproven, and Keyring falls back to DIDComm.

## Standing up on the Farm (2026-09-22)

What a maintainer meets between "create a VTA" and "a phone is linked to it".
None of this is a defect; it is recorded because each cost us a wrong guess, and
a hand-off that omits it costs the reader the same.

- **A new Farm VTA answers nothing until the portal says *Running*.** Its DID
  resolves as soon as the wizard writes the log (15:02:53Z here) while REST and
  DIDComm stay silent for minutes (`/health` first answered 15:12:41Z), and `pnm`
  reports "unreachable (404)" in between. Wait for *Running* before
  `pnm setup continue` or linking a phone.
- **The admin DID in the ACL is not the one pasted at the wizard** — it is the
  long-lived key `pnm setup continue` rotates onto. See VTI-Q18.
- **A phone's temporary key is a ~350-character `did:peer:2`, and the browser
  client's *Grant access* field hints `did:key:z6Mk…`.** The VTA accepts the
  `did:peer` subject (our manual link passed on the Farm with `pnm acl create`)
  and the form only checks that the field is non-empty
  (`vta-browser-plugin` `9643c57`
  `packages/extension/src/manager/panes/access.tsx`), so it works — but the hint
  suggests otherwise and the key cannot be typed by hand. Keyring's link screen
  offers Copy and Share for exactly this, so the instruction is "share it to your
  computer, paste it into *Grant access*". The ask to make this scannable is
  VTI-Q10.
- **Full Stack is enabled per account, and joining someone else's stack takes an
  invite code** generated per VTA by the stack's owner. See VTI-Q9.
- **`keyring-stack` read-only checks.** All four components answer (VTA
  `/health`, mediator healthchecker, DID host, VTC `/v1/health`); the stack
  mediator is 0.28.28 and ready; credo-ts parses the VTA, mediator, DID-host and
  VTC documents; the VTC advertises `TSPTransport`, `DIDCommMessaging` (its own
  mediator) and `VTCRest https://vtc-keyring-test.ic3.dev/v1` — the `/v1` form of
  vti #1615, which keyring-bifold#61 reads correctly — and its REST manifest
  answers `200` with a signed response. The stack has its own DID host
  (`dids-keyring-stack.ic3.dev`), not the shared `dids.ic3.dev`.

## Upstream's response (2026-09-22)

Upstream published a remediation plan against **v1.27** (era H) of this document:
<https://docs.fpp.storm.ws/keyring-remediation-plan.html>, basis **VTI `3dcbfe98`
· TDK `1eeebba1` · webvh `88fc6464`**. It numbers the findings `KR-NN`, and
**`KR-NN` is our `VTI-NN`** (the titles match one to one). Of the 36, upstream
reports 23 shipped, 4 already fixed before they read them, 3 answered in docs,
4 declined or re-scoped, and 2 waiting on a reproduction from us. Every
status in the table above now carries their answer ("Upstream 09-22"). None
is marked verified on our stack until the lab runs the new pins. VTI-37 to
VTI-40 and VTI-Q12 to VTI-Q15 postdate v1.27 and are not covered.

**Owed by us.**
- **VTI-06 (their KR-06).** They grouped it with the CORS half (VTI-05) and
  ask for our configuration. The reproduction is TOML scoping, not the CORS
  default. Append `cors_allow_origin = ["*"]` at the end of a generated
  `mediator.toml`, below its last table. TOML files the key under that table,
  the mediator never reads it, and it says nothing. The ask is a
  warning on unknown or misplaced keys (`deny_unknown_fields`, or a boot-time
  list of keys ignored).
- **VTI-25 (KR-25).** They find `verdict.with` still inline at both builds, and
  suggest a lost reply (post-quantum proof sets grew it) or reply matching.
  Owed: one admission traced on the new pins, from `ref-20-local-vetting` over
  DIDComm (the raw reply's `verdict` keys and size) and from the app (what the
  join flow received).
- **VTI-12 (KR-12).** vti #1632's flow (`pnm did-mgmt dids edit` → `get-log` →
  `cnm did-log install --file`) looks like the answer. Owed: run it on the new
  pins to add a transport to an existing community. If it works, VTI-12 and
  VTI-35 close together, and the lab community's hand-edited log goes away.

**Wire changes that reach clients.**
- **vti #1646:** a signed REST `auth/authenticate` must name the service as
  `recipient` (a missing one is `malformedRequest`, another service's is
  `wrongRecipient`). Keyring's app makes no signed REST Trust Task calls:
  its VTA and community traffic is signed documents over TSP or DIDComm
  that already name `recipient`. The lab's `vtc-admin.mjs` sets it
  (line 140).
- **vti #1642:** six capabilities move from `ext.org.openvtc.capabilities` to
  `capabilities`. Keyring reads none of them.
- **vti #1615:** `VTCRest` carries `/v1` for newly minted communities. Keyring
  appends `/v1` itself (`vtiAgent.manifestOverRest`), which would double it.
  It falls back to DIDComm rather than failing, but it has to be fixed before a
  new community is used.

**Their questions answered.** Q2: peer vetting legs stay DIDComm. Q3: a by-DID
vetter status lookup (vti #1651); the grant's status list stays authoritative
until then. Q4: sign the Vetting Card through `keys/sign`, not a borrowed
key. Q5: extend `device/register`, `push/wake`, `task-consent/*` or
`confirm/request` before drafting anything new. Q6: no. Q10: `vta setup --from`,
`pnm setup --name`, `vta import-did --role admin`. Q11: yes, a persona
advertises `#tsp` when its mediator carries TSP (vti #1652). Q7 and Q9 are routed
to the Farm operators. Q8 we answered ourselves. EXT-01: agreed, it is
credo-ts's.

## Open questions and requests

Not defects — things we would like answered or changed, kept here so one link
carries everything. Numbered `VTI-QN`; numbers are permanent like the findings.

| # | Ask | Why |
| --- | --- | --- |
| ~~VTI-Q1~~ | ~~Is `VTI-Eucalyptus-RC-0` the pin you want a client on, or main?~~ | **Withdrawn 2026-09-21.** We track upstream main, which is also what the Farm runs; the number stays reserved. |
| VTI-Q2 | Will the reference client keep accepting a DIDComm-carried `vetting/request/0.1`, or must a peer speak TSP Rev 3? | Keyring can do either per build; the answer decides the demo's default. |
| VTI-Q3 | `vtc/vetting/vetters/list/0.1` skips a vetter with no published profile and a vetter with no live grant alike, so absence cannot distinguish *revoked* from *unlisted*. Is a status field, or a by-DID lookup, wanted? | An applicant checking whether its vetter is still live has to fall back to the credential's own status list; a one-line answer from the list route would make the common case cheap. |
| VTI-Q4 | Is borrowing a persona's signing key from the VTA the expected pattern for signing a Vetting Card (D19), or should the VTA sign it? | We borrow, as the reference client does; confirming it settles our custody model. |
| VTI-Q5 | Is a Trust Task that links an `openvtc` request to a Keyring device something you would like drafted? | Raised in conversation; we would write it if wanted. |
| VTI-Q6 | Does a dry-run gate assume the applicant stores the vetter's statement in the VTA vault (`purpose: vetting`) rather than on the device? | We hold it on the device today. |
| VTI-Q7 | Could our persona be admitted to the Farm community's (`vtc.ic3.dev`) access list — or is a Full Stack share code the intended route onto a community? | The wallet now connects to our Farm VTA; the community answers `DID not in ACL`, which is the only thing between us and a ceremony on Farm infrastructure. |
| ~~VTI-Q8~~ | ~~Will the Farm's mediator be advanced (it reports 0.26.4; VTA and VTC are current)?~~ | **Answered 2026-09-22:** `mediator.ic3.dev` reports **0.28.23**, newer than the lab's 0.28.11, and its DID advertises `TSPTransport`. See [Era F re-measured](#stack-under-test). |
| VTI-Q9 | Is Full Stack mode (a community of one's own) coming to the staging Farm, which offers VTA Only today? | The vetting ceremony needs a community we administer — publishing criteria, granting a vetter, provoking refusals. **Answered in part 2026-09-22:** Full Stack exists and is enabled **per account** by the Farm operator — the create wizard shows Mode as a fixed *VTA Only* chip, while the portal code carries the whole `full_stack` path (`vtafarm` `693d519` `src/lib/api.ts` `SetupMode`, and the `step_vtc_setup`/`deploy_vtc` status chain). Ours was enabled on request and we now run a Full Stack (`keyring-stack`). A VTA-Only account joins someone else's stack with an **invite code**, pasted under *Customize → Share code*; manual entry of a non-Farm stack's DID host and mediator "may come later". The remaining ask is whether maintainers get Full Stack on request, and what to tell them in a hand-off. |
| VTI-Q10 | Could provisioning a VTA take its admin DID from a phone — a QR the phone scans, or a provisioning API — instead of a paste into the console? | A phone cannot paste into a browser it is not running; our own stack script labels the same step "the paste a QR would replace". Useful to any headless client, and to CI. **Measured on the Farm, 2026-09-22 ([details](#question-details)):** there is still no scannable "link a client" offer; the linking is `pnm acl create` or the browser client's paste-only *Grant access* form. |
| VTI-Q11 | Should a persona minted by a TSP-capable VTA advertise `TSPTransport` in its own document? | Personas advertise only DIDComm today, so a Rev 3 client reading the document keeps the applicant ↔ vetter leg on DIDComm. |
| VTI-Q12 | Could a community issue an **open invitation** — one not bound to a subject DID in advance (a bearer or by-reference credential, redeemed by whichever persona presents it)? | A person invited to a community has no persona yet: the admin's `invitations` route needs a `subject_did` (`vtc-service/src/routes/invitations.rs:40-44`), so today the phone must mint a community identity first and show it to the admin before being invited. `subjectLinkage` (`invitation_verify.rs:198-236`) lets a different DID redeem, but links the two at the community. An open invitation — with VTI-32's by-reference delivery — would let "I was invited to X" start from the invitation itself. Keyring's decision for now (2026-09-22) is to send the community identity; this is the ask. **Also on the Farm (2026-09-22, [details](#question-details)):** the hosted admin console's *Invitations* needs an invitee DID too, so there is no open or bearer invitation from the console either. |
| VTI-Q13 | Which sign-in should a community administrator use in the admin console, and could the console say so? | Plain *Sign in with VTA wallet* presents the browser client's holder `did:key`; only *VTA-proxied SIOP* presents the VTA DID that the community's access list names. Nothing on the page tells an administrator which one works. [Details](#question-details). |
| VTI-Q14 | What does `registryConsent` on `join-requests/submit` grant, and should a client ask the person for it? | It is stored on the request and shown in the console, but nothing acts on it, and the submit spec defines the field without saying what it grants. [Details](#question-details). |
| ~~VTI-Q15~~ | ~~Does `first-vtc` serve TSP Rev 3 today, and are the Farm and storm mediators on each other's relay allowlists?~~ | **Promoted to [VTI-41](#vti-41--tsp-rev-3-does-not-cross-two-mediators-no-accept-comes-back-didcomm-does) (2026-09-22).** The community serves TSP (same-mediator control: accept in 1.15 s); an accept is never returned across two mediators; the allowlist is not the cause under defaults. |
| VTI-Q16 | Could a community's manifest, or the VTA and mediator documents, say whether the operator of a member's VTA and of the mediator differs from the VTC's operator, so a client can tell a vetter whether hidden-mode anonymity holds for them? | The hidden-vetter design makes it a deployment rule that the vetter's VTA and the mediator are not run by the VTC's operator: a vetter's VTA can compute every tag its user produces. Nothing a client can read says which operator runs what, so a Farm hosting both a member's VTA and the community's VTC would silently void anonymity. [Details](#question-details). |
| VTI-Q17 | Could `vta/webvh/dids/create/1.0` take an idempotency key — a retry returning the first mint — or `vta/webvh/dids/list/1.0` carry the label the client sent and the minted keys' ids? | A mint whose answer is lost succeeds at the VTA and fails for the person (measured twice: once on the Farm, once in the lab). The client cannot recover it: the list route's record (`vta-sdk/src/webvh.rs` `WebvhDidRecord`) carries neither the label nor the key ids it needs to borrow, so a retry is the only move and it leaves an orphan DID on the VTA and the DID host. [Details](#question-details). |
| VTI-Q18 | Could the Full Stack wizard echo the admin DID it imported, and label which component each admin key is for? | The Admin DID step accepts any `did:key` and shows nothing back. A key meant for the VTC was pasted there and became the stack VTA's admin; the mistake surfaced only when the first `pnm` call was refused ("DID not in ACL … has your admin run `vta import-did …`?"). An echo on the session page, and in the Collected DIDs card, would make the step checkable. [Details](#question-details). |
### Question details

Filled in to the same standard as the findings: (a) what happens and what
we expected, (b) how to reproduce it, (c) references, (d) what we do meanwhile.

**VTI-Q13 — the admin console's two sign-ins.**
(a) The *VTC Admin* login card at `https://first.openvtc.net/admin` offers, in
this order: *Sign in with passkey*, *Sign in with VTA wallet*, *Sign in via
VTA-proxied SIOP*, and a link *Sign in as a different identity…*. The two wallet
buttons present different identities, and the card doesn't say which:
- *Sign in with VTA wallet* opens the browser client's "Sign-in request"
  window, whose **SIGN IN AS** is the client's own holder `did:key`.
- *Sign in via VTA-proxied SIOP* opens a "WORKER MODE — Your agent is sending a
  request on your behalf" window, whose **SIGN IN AS** is the VTA's
  `did:webvh` (context `vta`). That window notes: "The site has to allow this
  identity before it will let you in."

The community's access list names the VTA DID, so for an administrator whose
entry is their VTA, only the third button can work. Expected: the card says
which identity each button presents, or offers one path.

(b) VTC dashboard build 0.11.58 ("mode: embedded"); browser client "VTA Wallet"
0.2.0 at `vta-browser-plugin` `9643c57`, Chrome on macOS; an administrator whose
access-list entry is their VTA DID. Press each wallet button and read the
**SIGN IN AS** line. The proxied path, with VTI-40's fix applied, lands on the
dashboard as the VTA DID. The plain path's refusal was **not observed**,
because VTI-40 turned that Approve into `login denied by user` first. That it
would be refused is inferred from the access list, which holds the VTA DID and
not the holder `did:key`.

(c) `vta-browser-plugin` `9643c57`, `packages/extension/src/background.ts`:
- `handleLogin` (line 1278) calls `requestConsent` with `allowHolder: true`
  (line 1395). That is the holder `did:key` path.
- `handleWalletProfile` (line 2626) is the identity picker; its denial string
  is at line 2655.
- `handleVaultProxyLoginPage` (line 2535) is the VTA-proxied path.

(d) We use *Sign in via VTA-proxied SIOP*.

**VTI-Q14 — `registryConsent`.**
(a) `registryConsent` (`registry_consent`) on `join-requests/submit` is stored
on the join request and shown in the hosted console's "registry consent"
column. Nothing acts on it, and the submit spec defines the field without
saying what it grants. The struct's doc comment gives the intent: consent to
being published in the community's trust-registry record, deferred to "Phase 3".
Expected: that meaning stated in the spec, with a word on whether clients
should ask the person.
(b) Submit two join requests to `vtc-service` at `187ad9cd`, one with
`registryConsent: true` and one with `false`. The verdicts and records are
identical apart from the stored flag.
(c) At `verifiable-trust-infrastructure` `187ad9cd`: the flag is declared at
`vtc-service/src/join/mod.rs:106-111` and stored at
`vtc-service/src/join/orchestrate.rs:277`;
`trust-tasks/join-requests/submit/1.0/spec.md:18,40` names the field with no
semantics. In `openvtc`, `openvtc-core/src/join.rs:248` hard-codes `false`, and
so does Keyring (bifold `modules/trust-tasks/module/vtiAgent.ts:717`).
(d) Keyring sends `false` and does not ask. Once upstream defines the effect,
the "Get vetted" apply step gains a plain opt-in.

**VTI-Q16 — operator separation for hidden vetting.**
(a) In the hidden-vetter design, anonymity holds against the VTC, other
members, applicants and the mediator, but not against the vetter's own VTA.
So hidden mode requires that the vetter's VTA is not operated by the VTC's
operator (the rule the design already sets for the mediator). Expected: a
machine-readable way for a client to check this before a vetter attests in
hidden mode. For example, an operator identifier in the VTA's and mediator's
DID documents or service metadata, compared with the VTC's, or a field in
the community's manifest (such as `vetting.anonymity`) that the community
asserts. Today the rule can only be stated in governance text.
(b) Not a defect, and there is nothing to reproduce: hidden mode is not built
upstream yet. What can be observed today is that neither a VTA's document, a
mediator's, nor a VTC's manifest carries an operator identity. Checked at VTI
`187ad9cd`; to be re-checked at `3dcbfe98`.
(c) openvtc `docs/design/vetting-process.md` §14.2 (V2: "k-of-n proofs over
hidden vetters"). A Keyring plan covering this is forthcoming.
(d) Meanwhile: the Farm currently satisfies the rule (it hosts VTAs and a
mediator, while `first-vtc` runs on another operator's stack). Our
single-host lab never does, so no demo on it may call vetters anonymous
from the community. Keyring will show a warning on the community screen
once a source field exists. Related to VTI-Q6: in hidden mode an
attestation is stored and verified in the applicant's VTA, so for that
mode the answer to Q6 is "the VTA's vault, not the device".

**VTI-Q12 on the Farm.** (a) The hosted admin console's *Invitations* form
requires the invitee's DID, as the route does, so a console user cannot issue
an open or bearer invitation either. The page
(`https://first.openvtc.net/admin/invitations`, "Issue a Verifiable Invitation
Credential (VIC) for a prospective member…") has three fields: **INVITEE DID**
(placeholder `did:key:… or did:webvh:…`), **VALIDITY (DAYS, OPTIONAL)** and
**ROLE ON JOIN**. *Issue invitation* stays disabled while the DID is empty.
This is a precondition, not a refusal, and no error is shown. (b) VTC 0.11.58
("mode: embedded"), 2026-09-22: open the page and leave the DID empty. (c) At
`verifiable-trust-infrastructure` `187ad9cd`:
- `vtc-service/admin-ui/src/plugins/invitations.tsx:93` is the field and
  `:125` the disabled rule (`disabled={!did.trim() || …}`);
- `vtc-service/src/routes/invitations.rs:44` declares `subject_did: String`
  (required), `:105` requires it to be a DID, and `:112-118` refuses a current
  member (`409 … is already a current member`).
(d) Keyring sends the community identity to the admin first.

**VTI-Q10 on the Farm.** (a) The Farm has no scannable "link a client" offer.
A person links a device with `pnm acl create`, or with the browser client's
*Grant access* form, which takes a pasted DID and cannot be driven from a phone.
(b) Browser client "VTA Wallet" 0.2.0 at `vta-browser-plugin` `9643c57`: open the
console (`manager.html`) and go to the Access pane. The fields are subject DID
(placeholder `did:key:z6Mk…`), role, label and expiry. The context comes from
the selected tree node. Submit stays disabled until the subject and role are
filled, and nothing produces a QR or offer. During onboarding the client
prints the CLI equivalent, `pnm --vta <name> acl create --did <temp did:key>
--role admin --expires 1h`. (c) `packages/extension/src/manager/panes/access.tsx:433`
(the "Grant access" panel) and `:500` (its submit). (d) Our lab's enrolment page produces the link
offer that a phone scans (`pnm acl create --expires 1h` behind a QR).

**VTI-Q17 — a lost mint answer cannot be recovered.**
(a) The phone's `vta/webvh/dids/create/1.0` reached the VTA and minted — the DID
appears in `pnm did-mgmt dids list` and is served by the DID host — but no answer
came back within the client's 30 s window, so the person is told "the VTA did not
answer". Observed twice: on the Farm runner VTA (`0.37.1-d9a5be02`, shared Farm
mediator, over TSP) and once in the lab on the request side. The retry succeeded
both times. Expected: either the answer is retried (VTI-39's class), or a client
can ask the VTA what it already minted. Today it cannot: `dids/list` returns
records without the `label` the client sent and without the minted keys' ids,
and the client needs the key ids to borrow the persona's signing key
(`keys/export-secret/0.1`).
(b) Mint a persona from a phone against a VTA on another mediator and drop or
delay the answer; then call `vta/webvh/dids/list/1.0` and try to identify the
DID just minted. For reference, `pnm`'s own mints answer in 4–5 s over both TSP
and DIDComm.
(c) `vta-sdk/src/webvh.rs`, `WebvhDidRecord`.
(d) Keyring retries the mint, which works, and leaves the orphan DID in place.

**VTI-Q18 — the Full Stack wizard does not say which admin DID it imported.**
(a) The wizard's Admin DID step accepts any `did:key` and gives no echo of what
it stored. Pasting the VTC's scripted key there made that key the **stack VTA's**
admin; nothing said so, and the error came later and elsewhere — `pnm`'s first
call refused with "DID not in ACL … has your admin run `vta import-did …`?". A
signed sign-in with the other key then worked. Expected: the session page (and
the Collected DIDs card) shows the admin DID that was imported, and each key
field says which component it administers.
(b) Run the Full Stack wizard, paste a `did:key` at the Admin DID step, then look
for that DID anywhere in the session UI.
(d) We keep the stack's admin credential on disk and read the ACL to see which
key actually landed.

*Related, and correct behaviour rather than a defect (worth one line in a
hand-off):* `pnm setup continue` **rotates** the wizard's temporary admin
`did:key` onto a long-lived one, so an operator who checks the ACL for the key
they pasted finds a different super admin, created by it. This is the same
temp-then-rotate model Keyring uses when a phone links a VTA.


## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 1.35 | 2026-09-22 | **VTI-43**: a VTA's reply to a first Trust Task is dispatched before it accepts the TSP relationship that would carry it, and is never received. Measured on both sides of the wire: the refusal dispatched at `.638`, the relationship `Bidirectional` at `.966`, nothing at the phone — against the same three events in the opposite order eleven seconds later in the same log, 4 ms apart, answering 200 OK. It costs every flow whose first task is deliberately sent before authorisation, which is exactly Keyring's no-QR link ("not yet" never appears). Granting first passes on the same build and device. The drop is not localised without a wire capture. Client side: re-send the first ask when the peer's accept lands (~330 ms), and fall back to DIDComm for a VTA that never answers TSP, on a 10 s deadline measured from a 1.76 s healthy first task. |
| 1.34 | 2026-09-22 | **VTI-42**: a community names `vtc/join-requests/withdraw/0.1` as the way to close an open request, and answers that very task `unsupported message type` over DIDComm. The verb is implemented — sent inside the binding envelope (`https://trusttasks.org/binding/didcomm/0.1/envelope`), the same document withdraws the request and is answered, signed, in under a second. What is missing is an arm in `vtc-service/src/messaging.rs`, whose DIDComm router is a hand-written second list (upstream says so itself in `vtc-service/tests/didcomm_envelope_binding.rs`) carrying `submit`, `manifest` and `status` only. Measured on keyring-test and on our own lab community, both VTC 0.11.58, so it is not Farm-specific; `withdraw/0.2` is refused identically, so it is not a version-string mismatch. The refusal arrives as a DIDComm problem-report rather than a `trust-task-error` (VTI-27's shape again), so a client correlating by task type reads it as silence — which is how it first surfaced, as "the community did not answer" on a phone. |
| 1.33 | 2026-09-22 | **The Farm, from a maintainer's side.** New section [Standing up on the Farm](#standing-up-on-the-farm-2026-09-22): a new VTA answers nothing until *Running*, the ACL's admin is the rotated key and not the pasted one, a phone's temporary key is a `did:peer:2` that the *Grant access* hint does not admit, and `keyring-stack`'s four components measured read-only. **VTI-Q9 answered in part** — Full Stack exists and is enabled per account; a VTA-Only account joins another stack by invite code. Two new questions: **VTI-Q17**, an idempotency key on `dids/create` or a `dids/list` that carries the label and key ids, after a mint whose answer was lost twice while the mint itself succeeded; **VTI-Q18**, an echo of the admin DID the Full Stack wizard imports. |
| 1.32 | 2026-09-22 | **VTI-41**, promoted from VTI-Q15: TSP Rev 3 does not cross two mediators. Measured from the Farm's shared mediator to two communities on other mediators (a Farm Full Stack's, and storm's `first-vtc`): no accept in 30–90 s, whether routed via our mediator or stored straight into the community's mediator. The community's own mediator accepts in 1.15 s and answers the manifest over TSP in 0.33 s. The relay allowlist is ruled out under defaults. The cause is located to the return leg and not proven. Keyring asks such a community over DIDComm (keyring-bifold#66). |
| 1.31 | 2026-09-22 | **Upstream's response mapped.** Their remediation plan (basis VTI `3dcbfe98`, TDK `1eeebba1`, webvh `88fc6464`, against our v1.27) numbers the findings `KR-NN` = `VTI-NN`. Every status now carries their answer: 23 shipped, 4 already fixed (VTI-08, -09, -27, -28), 3 answered in docs, 4 declined or re-scoped (VTI-02, -10, -13, and -12 pending), and reproductions owed by us for VTI-06, VTI-12 and VTI-25. Nothing is marked verified on our stack before the pin bump. **Era F′:** the Farm's VTAs now run `0.37.1-d9a5be02`, with #1619, #1622 and #1634 and without #1642, #1646 and #1648. Phones linked as admin are unaffected. New section [Upstream's response](#upstreams-response-2026-09-22) records the owed reproductions, the client-facing wire changes (vti #1646, #1642, #1615) and the answered questions. New question **VTI-Q16**: how a client can tell whether hidden-vetting anonymity holds (operator separation between a vetter's VTA, the mediator and the VTC). |
| 1.30 | 2026-09-22 | **The Farm, measured read-only from public endpoints (steps 1–2 of the Farm plan).** **VTI-Q8 answered**: the Farm mediator is 0.28.23, ahead of the lab. The storm mediator that `first-vtc` names reports `degraded` (stored functions restarting, as era E's lab did), and `first-vtc`'s own host serves a stale version-1 copy of its log (upstream's known mirror case). EXT-01 extends to the storm mediator. **The cross-mediator round trip works over DIDComm**: `first-vtc`'s manifest comes back storm → Farm, live, in about 1 s on all three sender routes, given a sender DID that names its mediator. Over TSP, storm stores the invite but no accept returns (**VTI-Q15**). The Farm mediator was down twice for a few minutes during the run. See [Farm cross-mediator round trip](#farm-cross-mediator-round-trip-2026-09-22). From the Phase 0 Farm run: **VTI-40**, the browser client's consent window can turn an Approve into a Deny. **VTI-Q13** asks which admin sign-in to use, **VTI-Q14** what `registryConsent` grants, and VTI-Q10 and VTI-Q12 gain Farm evidence. A [Question details](#question-details) section now carries the (a)–(d) record for questions. |
| 1.29 | 2026-09-22 | **VTI-39** (a TSP reply that fails once is lost) added earlier; now **VTI-Q12**: an open invitation not bound to a subject DID in advance, the upstream half of Keyring's "I was invited" journey. |
| 1.28 | 2026-09-21 | **Era H, run on devices.** Enrol, invite, the two-phone approval and the full vetting ceremony pass on upstream main. **VTI-24 and VTI-26 validated live** with a phone approver: the VTA pushed the consent request through the approver's own mediator and it was approved in about three seconds — once Keyring minted its `did:peer` with a `DIDCommMessaging` service naming the mediator by DID, a client defect found on the way. New: **VTI-37**, a consent refusal whose `details` pass the 4 KB bound at three approvers loses its challenge, digest and relayable requests. VTI-22 re-met: the lab's `up.sh` now sets alice's enforcement. Also new: **VTI-38**, a mutual cancel whose §7.3 answer is refused because the transport forgets the relationship first — found by `ref-04s`, which with `ref-04r` also closes TSP Rev 3's remaining lab items (long-form frames through the mediator; XRFI → XRFA → XRFD against upstream's state machine). |
| 1.27 | 2026-09-21 | **Era H — the lab on upstream main** (vti `a96fe02f`, mediator 0.28.11, daemon `5365da7`). Four more resolved upstream since the report: **VTI-04** (vti #1592), **VTI-07** (tdk-rs #843, verified here), **VTI-14** (vti #1601), and **VTI-03**'s second half (vti #1593, `supplement/0.1`) — whose client half Keyring now implements. |
| 1.26 | 2026-09-21 | VTI-Q1 withdrawn: we track upstream main, as the Farm does. Its number stays reserved. |
| 1.25 | 2026-09-21 | **TSP Rev 3 on the ecosystem legs, and what it surfaced.** Era G: the lab carries SDK 0.26.12 and TSP-featured VTA and mediator builds, and the two-device vetting ceremony passes with phone ↔ VTA and phone ↔ VTC on Rev 3. New: **VTI-33** (a mediator without `tsp` drops every TSP frame silently), **VTI-34** (`tsp = true` inert without the feature), **VTI-35** (a VTC cannot publish `#tsp`), **VTI-36** (redeploy advice for a self-hosted log), and **EXT-01** (credo-ts rejects an array `service.type`, which blocked the Farm). Status corrections: **VTI-19** resolved by vti #1581, **VTI-24** and **VTI-26** by vti #1579 — both merged 09-19/20 and missed by earlier versions; VTI-30/31 fixes are on our stack since era E. **VTI-20** raised to medium after it blocked a run. **Era F corrected again:** the Farm VTA is `0.34.1-89ebd895` (#1579's merge commit) and the lab `6bd52cab` — equal version strings, different commits. Questions VTI-Q7–Q11 added. |
| 1.2 | 2026-09-16 | VTI-17…VTI-20, all from standing a personal VTA up for a phone to manage: a force re-provision keeps a host-bound DID; a self-managed DID-hosting daemon without a mediator cannot be registered; the resolver bursts into rate limits; a serverless persona mint is not served. Also records the measurement that upstream's reference client **borrows a persona's private key** from the VTA (`keys/export-secret/0.1`) and seals locally — the VTA is a custodian, not a proxy. |
| 1.3 | 2026-09-16 | VTI-21: no delivery channel for invitations; persona services confirmed at mint |
| 1.4 | 2026-09-17 | VTI-22 enforcement flag; VTI-23 manager needs admin; VTI-24 approver delivery is queued not live |
| 1.24 | 2026-09-21 | **The Farm mediator is 0.26.4**, exactly — it says so in its own `/readyz`, which also reports `status` and `uptime_seconds`. Era F previously said those fields were absent there; they are not, they sit at the END of the body and an earlier probe truncated it. The route-probe inference ("older than 0.26.5", from `purge` being absent) was right in direction and is now replaced by the number. Also ruled out, so it is not re-suspected: the Farm's four hosts share two IPs and one `*.ic3.dev` wildcard certificate — the same shape that produced our `421` on ngrok — but three of them served over **one coalesced HTTP/2 connection** answer `200`, so the Farm edge does not refuse coalesced requests. |
| 1.23 | 2026-09-20 | **The lab is stock, and a silent deviation is found.** Queue limits set to upstream's shipped values and the ceremony re-run green at them, so the queue-limit deviation is retired — and the direction is corrected: what the lab had been running (200/1000) was *below* stock, not the "raised" limit this document claimed. The silent one: a 0.28.9 mediator was running a 0.26-era `atm-functions.lua`, which never writes `PEER_Q`, so `limits.queue.peer` was configured, reported present and **inert**, with the mediator `degraded`. Every per-peer queue observation made here before today was taken with the gate off. |
| 1.22 | 2026-09-20 | **Era F corrected within the hour.** 1.21 called the Farm "far behind us" on the strength of its mediator alone. Measuring the rest: the Farm's **VTA is 0.34.1 and its VTC is 0.11.58 — both identical to the lab**, and the VTA serves the same 78 OpenAPI paths. Only the mediator is behind. The correction matters because it inverts the conclusion: the protocol surface our client actually talks to is at parity, so a Farm run tests the same contract on infrastructure we did not build. What the old mediator changes is delivery, not protocol — VTI-29, VTI-30 and VTI-31 can still appear there and must not be read as regressions. |
| 1.21 | 2026-09-20 | **Era F — the VTA Farm, and it is far behind us.** The Farm mediator our VTA's DID document points at (`mediator.ic3.dev`) is **older than 0.26.5**: `DELETE /mediator/v1/purge/{folder}` answers `404` there and `401` on our own 0.28.9, and its `/readyz` omits the `status`/`version`/`uptime_seconds` fields ours reports. Probed rather than asked, and validated against a mediator of known version so the method means something. Consequence: **VTI-29, VTI-30 and VTI-31 all still reproduce on the Farm**, since their fixes are #828 (0.27.0), #830 (0.28.1) and #834 (0.28.x). A Farm result is therefore not comparable with a lab result today, and a finding measured there says nothing about upstream's current main. |
| 1.20 | 2026-09-20 | **Era E** — the two-device ceremony passes on mediator **0.28.9** (upstream main, #829–#842). No regression against era D: three failures in between were our own e2e reset defect, which survived a revert to 0.28.0 and was wrongly suspected of being the upgrade until the revert failed too. Recorded because it is the exact shape of a fixture artefact reported as an upstream finding. Also: `affinidi-messaging-sdk` **0.26.12** carries #838, so the TSP Rev 3 release gate is open; our stack pins 0.26.10. |
| 1.19 | 2026-09-20 | **Era D** — the mediator advanced to the #829 branch tip (0.28.0) for the two-device ceremony, which upstream main has since left behind at 0.28.9. Three statuses corrected against merged work: **VTI-29** fixed by #828 (on our stack; the fixture's raised limit not yet dropped and re-measured), **VTI-30** by #830, **VTI-31** by #834 — which also **corrects VTI-31's proposed cause**: the ack contract we asked for already existed, and the real defect was `ack_via_source` discarding acks it had issued. None of #830–#842 has been measured here yet. |
| 1.18 | 2026-09-20 | **VTI-03 resolved upstream** — `vti` #1591 adds `vtc/join-requests/withdraw/0.1`, so an applicant can close their own deferred request; specified in `dtgwg-trust-tasks-tf` #518 and shipped in `trust-tasks-rs` 0.21.5. The client half is ours and unwritten, and is recorded on the finding. Also notes that `tdk-rs` #831 closed VTI-05's documentation half, and that `tdk-rs` #838 — a re-establishing TSP send losing its payload to the peer's own invite, about half the time under load — lands on a path our lab does not yet exercise (`tsp = false` on every agent) but will the moment TSP Rev 3 is switched on. |
| 1.17 | 2026-09-20 | VTI-32: an invitation is 6,331 bytes and a QR code carries at most 2,953, so the credential cannot travel by the only channel it has. Found when an iOS deep link truncated it and the client reported a JSON parse error rather than a length one. |
| 1.16 | 2026-09-19 | **VTI-31**, found while validating tdk-rs #829 before it lands: a terminal error the spine correctly drops is never acknowledged, so it stays in the sender's queue — 223 messages, 166 of them already delivered — and once #829 gates the direct path the sender is refused everything. |
| 1.15 | 2026-09-19 | VTI-29's fix merged upstream (tdk-rs #828), with #829 extending the gates to direct delivery and the TSP bridge, which had none. |
| 1.14 | 2026-09-19 | VTI-29 reproduced on era C at the default limit: 236 messages for 134 recipients blocked the community from answering a live applicant. |
| 1.13 | 2026-09-19 | **Versions, per finding.** The fixture was rebuilt twice while these were gathered, so *Stack under test* now states three eras (A, B, C) with exact commits and every finding names the one it was measured on — upstream asked for this and a single table was misleading. Declares the one fixture deviation (the mediator's sender-queue limit raised on era B). **VTI-13 corrected** after upstream read it: the refusal is `affinidi-openid4vp`'s and is spec-correct; the finding narrows to the VTC using DCQL to say "nothing required", and our answer on the shape is *admit pending review*. VTI-28 re-measured on era C and gone. |
| 1.12 | 2026-09-19 | Adds an *Open questions and requests* section (`VTI-QN`) so asks that are not defects travel with the findings. VTI-Q3 records that a vetter listing cannot distinguish a revoked grant from an unlisted vetter. |
| 1.11 | 2026-09-19 | Stack moved to upstream head (vta-service 0.34.1). **VTI-28 resolved upstream** — `vti` #1567 lets the spine decide what an inbound document is and answers an error with nothing, and webvh #202 treats an inbound error as terminal; re-measured clean, and the local patches that stood in for it are dropped. Upgrade note: `trust_xff` is retired for `trust_xff_cidrs` (#1562). |
| 1.10 | 2026-09-19 | Upstream reviewed the report: VTI-10 and VTI-21 confirmed in their source; VTI-13 queried (probably the narrower `minStatements: 0` refusal). Client-side gaps they found are tracked in the plan companion, not here — they are ours, not upstream's. |
| 1.9 | 2026-09-18 | VTI-28 root cause: `sign_success_response` turns an empty 204 into a trust-task-error that is sent to the daemon; fix verified on a patched local build |
| 1.8 | 2026-09-18 | VTI-29: the mediator's per-sender queue cap lets uncollected cards silence a community; VTI-30: dropped live pushes need a poll — `delivery-request` wants `recipient_did`, `delivery` attaches base64 |
| 1.7 | 2026-09-18 | VTI-28: an unsolicited check-name response starts an unbounded VTA ↔ DID-daemon error ping-pong (two storms, 2,259 messages); the mediator's `delivery-request` needs `recipient_did` — Keyring now polls its queue as a backstop for a missed live push |
| 1.6 | 2026-09-18 | VTI-27: an auth/ACL refusal over DIDComm is a problem-report, not a trust-task-error; status table extended to VTI-21…27 |
| 1.5 | 2026-09-18 | Upgraded in place to VTI-Eucalyptus-RC-0 (versions table); VTI-25: the card is delivered by credential-exchange/issue, not inline; VTI-26: consent pushes reach did:key approvers only — the requester relays for the rest |
| 1.1 | 2026-09-16 | **Corrects VTI-01**, which 1.0 called a blocker: the first vetter can be bootstrapped on documented surfaces — invitation-only community → invited identity auto-admitted with `allow` → vetter role granted → vetting criterion added. Severity lowered to medium; the finding is now that the obvious attempt dead-ends and the working order is undocumented. Adds **Stack under test** (every component's version and upstream commit) and a note on version drift, including our own Trust Tasks lag. Adds VTI-16 (admin portal sign-in requires an outage). Test keys redacted from fixtures. |
| 1.0 | 2026-09-16 | First published: VTI-01…VTI-15, consolidating the nine findings from the terminal-side rehearsal with the six that only appear when a phone is the client. Records the 2026-09-16 measurement that membership completes on an unconditioned community. |
