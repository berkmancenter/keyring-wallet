# VTI upstream findings

**Version 1.28 — 2026-09-21.** A living document: every finding here was measured
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
| [VTI-01](#vti-01) | An administrator cannot become a vetter, and the first-vetter bootstrap is undocumented | Medium | Open — bootstrap path measured | A |
| [VTI-02](#vti-02) | An ACL `member` role is not community membership | High | Open | A |
| [VTI-03](#vti-03) | A `requestMore` join request can never be closed | High | **Resolved upstream** — vti #1591 (`withdraw/0.1`) and #1593 (`supplement/0.1`); **client half built** (bifold `877d26f`), not yet run against a live VTC | A |
| [VTI-04](#vti-04) | A second application from one DID is refused, not answered | Medium | **Resolved upstream** — vti #1592 names the open request; with #1591/#1593 the applicant can now act on it | A |
| [VTI-05](#vti-05) | The mediator refuses a phone's WebSocket upgrade | **High** | **Resolved upstream** — `affinidi-tdk-rs` #831 | A |
| [VTI-06](#vti-06) | A misplaced configuration key is accepted in silence | Low | CORS half answered by #831; general case open | A, re-checked on **C** |
| [VTI-07](#vti-07) | The mediator resolves `functions_file` relative to the working directory | Low | **Resolved upstream** — tdk-rs #843; **verified on our stack** (era H) | A, re-measured on **H** |
| [VTI-08](#vti-08) | `vta-service` overflows a worker stack creating a context | Medium | Open — workaround | A |
| [VTI-09](#vti-09) | VTA and VTC disagree on the DIDComm body shape | Medium | Open | A |
| [VTI-10](#vti-10) | A document's issuer must equal the DIDComm sender | Low | **Confirmed by upstream** — deliberate; specification gap stands | A |
| [VTI-11](#vti-11) | A fresh VTC has an empty ACL and cannot authenticate its own admin | Low | Open | A |
| [VTI-12](#vti-12) | A community's advertised transports are fixed at mint | Low | Open | A |
| [VTI-13](#vti-13) | A criterion cannot express "no requirements" | Medium | **Corrected** — misattributed; the refusal is `affinidi-openid4vp`'s and spec-correct. Narrowed, and our answer on the shape is inside | A |
| [VTI-14](#vti-14) | `cnm`'s vetting subcommands ignore `--url` / `VTA_URL` | Low | **Resolved upstream** — vti #1601 | A |
| [VTI-15](#vti-15) | A VTC DID cannot be used as a `cnm` community | Low | Open | A |
| [VTI-16](#vti-16) | Minting an admin portal sign-in needs the daemon stopped, then running | Low | Open | A |
| [VTI-17](#vti-17) | A force re-provision keeps a DID bound to a hostname that no longer exists | Medium | Open | A |
| [VTI-18](#vti-18) | A self-managed DID-hosting daemon without a mediator cannot be registered by a VTA | Medium | Open | A |
| [VTI-19](#vti-19) | The DID resolver bursts a dozen fetches per operation and trips rate-limited hosts | Low | **Resolved upstream** — `verifiable-trust-infrastructure` #1581; not yet on our stack | A |
| [VTI-20](#vti-20) | A serverless persona mint prints a log nobody serves | **Medium** (raised from Low) | Open — blocked a real run on 2026-09-19; the error names the persona, not the missing registration | A, re-met on **C** |
| [VTI-21](#vti-21--no-channel-delivers-an-invitation-to-its-invitee) | No channel delivers an invitation to its invitee | Medium | **Confirmed by upstream** in source | A |
| [VTI-22](#vti-22--consent-policies-are-inert-unless-configpolicyenforcement-is-on) | Consent policies are inert unless config.policy.enforcement is on | Low | Open | A |
| [VTI-23](#vti-23--every-operation-a-manager-needs-requires-the-admin-role) | Every operation a manager needs requires the admin role | Medium | Open | A |
| [VTI-24](#vti-24--a-pushed-consent-request-is-queued-not-delivered-to-an-idle-approver) | A pushed consent request is queued, not delivered, to an idle approver | Medium | **Resolved upstream** — `verifiable-trust-infrastructure` #1579 (with VTI-26); **validated live on era H** with a phone approver | A |
| [VTI-25](#vti-25--on-the-eucalyptus-train-the-card-is-delivered-not-returned) | On the Eucalyptus train the card is delivered, not returned | Medium | Open | B |
| [VTI-26](#vti-26--a-consent-request-is-pushed-only-to-a-didkey-approver-every-other-approver-needs-the-requester-to-relay) | A consent request is pushed only to a did:key approver; every other approver needs the requester to relay | Medium | **Resolved upstream** — `verifiable-trust-infrastructure` #1579; **validated live on era H** with a phone approver. Keyring's relay stays as the fallback #1579 itself keeps | B |
| [VTI-27](#vti-27--an-authentication-or-acl-refusal-over-didcomm-is-a-problem-report-not-a-trust-task-error) | An authentication or ACL refusal over DIDComm is a problem-report, not a trust-task-error | Low | Open | B |
| [VTI-28](#vti-28--a-vta-answers-a-reply-with-an-error-and-loops-with-its-did-hosting-daemon) | A VTA answers a reply with an error, and loops with its DID-hosting daemon | **High** | **Resolved upstream** — `vti` #1567 and `affinidi-webvh-service` #202 | B, re-measured on **C**: gone |
| [VTI-29](#vti-29--members-who-never-collect-their-cards-silence-the-community-the-mediators-per-sender-queue-cap) | Members who never collect their cards silence the community: the mediator's per-sender queue cap | **High** | **Fixed upstream** — `affinidi-tdk-rs` #828, and re-measured on era E at upstream's stock limits with the per-relationship gate actually live: the ceremony passes | B |
| [VTI-30](#vti-30--a-live-push-can-be-dropped-and-a-client-that-only-listens-never-sees-the-message) | A live push can be dropped, and a client that only listens never sees the message | Medium | **Fixed upstream** — `affinidi-tdk-rs` #830 (their KR-30); on our stack since era E. The client half — acting on an unsolicited `status` — is ours and still open | B |
| [VTI-31](#vti-31--a-dropped-terminal-error-is-never-acknowledged-so-it-never-leaves-the-senders-queue) | A dropped terminal error is never acknowledged, so it never leaves the sender's queue | **High** | **Fixed upstream** — `affinidi-tdk-rs` #834, with our proposed cause corrected; on our stack since era E, residue not specifically re-measured | C |
| [VTI-32](#vti-32--an-invitation-is-too-large-for-the-channel-it-is-meant-to-travel-on) | An invitation is too large for the channel it is meant to travel on | **High** | Open | C |
| [VTI-33](#vti-33--a-mediator-built-without-its-tsp-feature-drops-every-tsp-frame-in-silence) | A mediator built without its `tsp` feature drops every TSP frame in silence | **High** | New | G |
| [VTI-34](#vti-34--tsp--true-is-inert-on-a-vta-built-without-the-tsp-feature-and-nothing-says-so) | `tsp = true` is inert on a VTA built without the `tsp` feature, and nothing says so | Medium | New | G |
| [VTI-35](#vti-35--a-vtc-cannot-advertise-the-tsp-service-it-is-able-to-serve) | A VTC cannot advertise the TSP service it is able to serve | Medium | New | G |
| [VTI-36](#vti-36--vta-services-tsp-enable-tells-a-self-hosted-vta-to-redeploy-a-log-it-already-serves) | `vta services tsp enable` tells a self-hosted VTA to redeploy a log it already serves | Low | New — documentation | G |
| [VTI-37](#vti-37--a-consent-refusal-loses-its-challenge-once-the-approver-set-grows) | A consent refusal loses its challenge once the approver set grows | Medium | New | H |
| [VTI-38](#vti-38--a-cancelled-relationship-is-forgotten-before-the-vta-can-answer-the-cancel) | A cancelled relationship is forgotten before the VTA can answer the cancel | Low | New | H |
| [VTI-39](#vti-39--a-tsp-reply-that-fails-to-send-once-is-lost) | A TSP reply that fails to send once is lost | Low | New — observed once | H |

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
| **F** (Farm) | 2026-09-20 | **vta 0.34.1 · vtc 0.11.58 — identical to the lab.** VTA REST `vta-keyring-al.ic3.dev` (78 OpenAPI paths, same count); community `vtc.ic3.dev`, shared, not ours to administer | `mediator.ic3.dev` — **0.26.4**, reported by its own `/readyz`. The only component behind | DID hosting `dids.ic3.dev` |
| **E** | 2026-09-20 | unchanged — vta 0.34.1 · vtc 0.11.58 | `15499952` — upstream main, mediator **0.28.9**, carrying #829–#842; published on crates.io despite the changelog heading each section "Unreleased" | `35244b7` — daemon 0.8.3 |
| **D** | 2026-09-20 | unchanged from C — vta 0.34.1 · vtc 0.11.58 | `b544da04` — the **#829 branch tip**, mediator 0.28.0; this is *not* upstream main, which has since merged #829 and thirteen more (#830–#842) and stands at mediator 0.28.9 | `35244b7` — daemon 0.8.3 |
| **H** | 2026-09-21 (evening) | `a96fe02f` — upstream main; carries #1579, #1581, #1591–#1593, #1601 and the persona/face work (#1594–#1606); `affinidi-messaging-sdk` 0.26.12 from upstream's own lockfile; `vta` built `--features tsp` | `ad36f0b1` — upstream main, mediator **0.28.11** (#843, #844), `--features tsp` | `5365da7` — upstream main (#205) |
| **G** | 2026-09-21 | `6bd52cab` as era C, **plus `affinidi-messaging-sdk` 0.26.12** (carries tdk-rs #838) in the lockfile; `vta` built **`--features tsp`**; alice and the community VTA advertise `TSPTransport` (`vta services tsp enable`), the VTC by a DID-log edit (VTI-35) | `15499952` as era E — mediator 0.28.9, rebuilt **`--features tsp`** | `35244b7` — daemon 0.8.3 |

**A correction to era F, measured 2026-09-21.** "Identical to the lab" holds
for the version string only. The Farm's VTA image is `0.34.1-89ebd895` — the
merge commit of `verifiable-trust-infrastructure` #1579 — while the lab's
`vta-service` is `6bd52cab`, the same 0.34.1 a day earlier. So the Farm VTA
already carries #1579 (VTI-24, VTI-26) and the lab does not; neither carries
#1581 (VTI-19) or #1591 (VTI-03). The version number did not move across those
merges, which is how a per-component *version* comparison came out equal while
the *commits* differ. `scripts/openvtc/PINS.json` names `c9bc3a69` (upstream
main on 2026-09-20): that is the reference clone, not what the lab runs.

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
truncates a URL this long, and the client then reports `invitation link
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

---

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
| VTI-Q8 | Will the Farm's mediator be advanced (it reports 0.26.4; VTA and VTC are current)? | Every delivery fix answering our findings (#828, #830, #834) is newer, so a Farm result today is a protocol claim, not a delivery one. One deployment makes lab and Farm directly comparable. |
| VTI-Q9 | Is Full Stack mode (a community of one's own) coming to the staging Farm, which offers VTA Only today? | The vetting ceremony needs a community we administer — publishing criteria, granting a vetter, provoking refusals. Until then those stay in our lab. |
| VTI-Q10 | Could provisioning a VTA take its admin DID from a phone — a QR the phone scans, or a provisioning API — instead of a paste into the console? | A phone cannot paste into a browser it is not running; our own stack script labels the same step "the paste a QR would replace". Useful to any headless client, and to CI. |
| VTI-Q11 | Should a persona minted by a TSP-capable VTA advertise `TSPTransport` in its own document? | Personas advertise only DIDComm today, so a Rev 3 client reading the document keeps the applicant ↔ vetter leg on DIDComm. |
## Changelog

| Version | Date | Change |
| --- | --- | --- |
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
