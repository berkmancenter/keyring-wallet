# VTI upstream findings

**Version 1.1 — 2026-09-16.** A living document: every finding here was measured
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

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| [VTI-01](#vti-01) | An administrator cannot become a vetter, and the first-vetter bootstrap is undocumented | Medium | Open — bootstrap path measured |
| [VTI-02](#vti-02) | An ACL `member` role is not community membership | High | Open |
| [VTI-03](#vti-03) | A `requestMore` join request can never be closed | High | Open |
| [VTI-04](#vti-04) | A second application from one DID is refused, not answered | Medium | Open — by design, consequences unaddressed |
| [VTI-05](#vti-05) | The mediator refuses a phone's WebSocket upgrade | **High** | Open — operator workaround exists |
| [VTI-06](#vti-06) | `cors_allow_origin` is silently ignored unless it is in `[security]` | Medium | Open |
| [VTI-07](#vti-07) | The mediator resolves `functions_file` relative to the working directory | Low | Open |
| [VTI-08](#vti-08) | `vta-service` overflows a worker stack creating a context | Medium | Open — workaround |
| [VTI-09](#vti-09) | VTA and VTC disagree on the DIDComm body shape | Medium | Open |
| [VTI-10](#vti-10) | A document's issuer must equal the DIDComm sender | Low | Open — specification gap |
| [VTI-11](#vti-11) | A fresh VTC has an empty ACL and cannot authenticate its own admin | Low | Open |
| [VTI-12](#vti-12) | A community's advertised transports are fixed at mint | Low | Open |
| [VTI-13](#vti-13) | A criterion cannot express "no requirements" | Medium | Open |
| [VTI-14](#vti-14) | `cnm`'s vetting subcommands ignore `--url` / `VTA_URL` | Low | Open |
| [VTI-15](#vti-15) | A VTC DID cannot be used as a `cnm` community | Low | Open |
| [VTI-16](#vti-16) | Minting an admin portal sign-in needs the daemon stopped, then running | Low | Open |

## Stack under test

Every finding in this version was measured against exactly this. All Rust
services are **debug builds from source** at the commits below — none are
published images, and in particular none are the images a VTA Farm currently
offers (whose newest predates vetting entirely).

| Component | Version | Upstream repository | Commit | Commit date |
| --- | --- | --- | --- | --- |
| `vta-service` — personal agent | 0.28.0 | `verifiable-trust-infrastructure` | `53a7cde4` | 2026-09-15 |
| `vtc-service` — community service (incl. admin portal) | 0.11.58 | `verifiable-trust-infrastructure` | `53a7cde4` | 2026-09-15 |
| `vta-sdk` | 0.38.2 | `verifiable-trust-infrastructure` | `53a7cde4` | 2026-09-15 |
| `pnm-cli` — personal network manager | 0.16.5 | `verifiable-trust-infrastructure` | `53a7cde4` | 2026-09-15 |
| `cnm-cli` — community network manager | 0.15.2 | `verifiable-trust-infrastructure` | `53a7cde4` | 2026-09-15 |
| `affinidi-messaging-mediator` | 0.25.0 | `affinidi-tdk-rs` | `dff68eb` | 2026-09-15 |
| `did-hosting-daemon` (server 0.8.3 · control 0.8.8 · common 0.8.6) | 0.8.3 | `affinidi-webvh-service` | `cb8a6f4` | 2026-09-15 |
| Redis | 8.10.1 | Homebrew | — | — |
| ngrok agent (six reserved domains) | 3.37.1 | — | — | — |

**The client side**, for completeness: Keyring built on `@credo-ts/*`
`0.7.1-pr-2704-20260909134930` (the DIDComm v2 snapshot), `@bifold/trust-tasks`
`0.1.0-alpha.1`, on React Native 0.81 with Hermes; Android emulator API 33 and
iOS simulator 26.3.

### Note on version drift

Recorded so upstream can tell a real defect from us being behind:

- **This stack is a month newer than our reference pins.** The repository's
  pinned reference clones (`scripts/openvtc/pins.json`) sit at the Cypress
  release — `verifiable-trust-infrastructure` `187ad9cd`, 2026-08-17 — while
  every service above was built from `53a7cde4`, 2026-09-15. Findings were
  measured against the newer code.
- **Our Trust Tasks framework is behind.** The pinned `trust-tasks` specification
  clone is 235 commits behind its `main`, and the wallet's own error documents
  are `trust-task-error/0.3` while `vtc-service` emits `trust-task-error/0.5`
  (`vtc-service/src/trust_tasks/helpers.rs`). Keyring reads refusals by the
  `trust-task-error/` prefix, so it copes, but it is not current.
- **Upstream itself emits two error versions.** `vta-service` produces
  `trust-task-error/0.5` in `trust_tasks/mod.rs` and `/0.3` in
  `trust_tasks/wire_v0_2.rs`. Possibly intentional for the older wire; worth
  confirming.

---

## VTI-01

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

### An ACL `member` role is not community membership

The access list and the member roll are separate stores, and the vetting routes
read the member roll. Adding `--role member` to the ACL therefore does not make
the subject a member for any purpose the vetting code cares about. This is the
mechanism underneath the dead end in [VTI-01](#vti-01), recorded separately
because it is independently surprising: the word `member` appears in both places
and means different things.

---

## VTI-03

### A `requestMore` join request can never be closed

An application answered with `requestMore` is left in a deferred state.
`join-decide` refuses it, the admin queue does not list it, and no documented
route withdraws it. The applicant cannot retry (see [VTI-04](#vti-04)) and the
administrator cannot clear it.

**Operational consequence, and our rule of thumb:** never submit an application
before holding the statements it will be asked for — the first attempt is
unrecoverable, and the only way forward for that person is a brand-new identity.

**Evidence.** `tsp-reference/ref-20-local-vetting/fixtures/submit-0.2-invited-requestMore.log`

---

## VTI-04

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

---

## VTI-05

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

---

## VTI-06

### `cors_allow_origin` is silently ignored unless it is in `[security]`

The setting is read from the configuration's `[security]` table
(`state.config.security.cors_origins`), and the generated `mediator.toml`
documents it there, commented out. Set anywhere else in the file — appended at
the end, or at the top level — TOML scopes the key to whatever table precedes
it, the mediator never sees it, and the refusals of [VTI-05](#vti-05) continue
with the setting plainly present in the file.

Cost us roughly an hour of believing a correct fix had not worked. A startup
warning for an unrecognised top-level key would have made it a five-second
problem.

---

## VTI-07

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

---

## VTI-08

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

### VTA and VTC disagree on the DIDComm body shape

A VTA accepts a bare payload as the DIDComm body. A VTC requires a whole Trust
Task document — `{ id, type, payload, issuer, recipient, issuedAt }` — and
answers a bare payload with `malformedRequest: missing field 'id'`.

Every client has to special-case the two. If that difference is intentional it
belongs in the specification; if it is not, the VTA is the lenient one.

---

## VTI-10

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

### A community's advertised transports are fixed at mint

`transports = ["didcomm"]` has to be present in the VTC's setup recipe. A
community provisioned without it cannot be given DIDComm afterwards — the
service entry is written at mint — so the only remedy is to provision the
community again, losing its identity.

---

## VTI-13

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

## VTI-14

### `cnm`'s vetting subcommands ignore `--url` / `VTA_URL`

The vetting subcommands resolve the community from the DID document rather than
from the supplied URL, so pointing the CLI at a specific host has no effect.
Combined with [VTI-15](#vti-15) this made `cnm` unusable against our stack, and
is why this repository carries its own small admin client
(`tsp-reference/ref-20-local-vetting/vtc-admin.mjs`).

---

## VTI-15

### A VTC DID cannot be used as a `cnm` community

A VTC's DID document publishes a `VTCRest` service entry whose endpoint omits
the `/v1` prefix the REST API actually serves, so requests derived from the DID
document land on `405 Method Not Allowed`.

---

## VTI-16

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

## Reporting these upstream

Nothing here has been filed yet. When it is, file per finding rather than as one
list, cite this document's anchor, and attach the fixture from
`tsp-reference/ref-20-local-vetting/fixtures/` that demonstrates it. Findings
[VTI-05](#vti-05), [VTI-06](#vti-06) and [VTI-07](#vti-07) belong with the mediator's maintainers
rather than with the VTI maintainers, and [VTI-05](#vti-05) is also an
operational request for anyone hosting a mediator that mobile clients must reach.

## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 1.1 | 2026-09-16 | **Corrects VTI-01**, which 1.0 called a blocker: the first vetter can be bootstrapped on documented surfaces — invitation-only community → invited identity auto-admitted with `allow` → vetter role granted → vetting criterion added. Severity lowered to medium; the finding is now that the obvious attempt dead-ends and the working order is undocumented. Adds **Stack under test** (every component's version and upstream commit) and a note on version drift, including our own Trust Tasks lag. Adds VTI-16 (admin portal sign-in requires an outage). Test keys redacted from fixtures. |
| 1.0 | 2026-09-16 | First published: VTI-01…VTI-15, consolidating the nine findings from the terminal-side rehearsal with the six that only appear when a phone is the client. Records the 2026-09-16 measurement that membership completes on an unconditioned community. |
