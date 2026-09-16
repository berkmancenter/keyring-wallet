# VTI upstream findings

**Version 1.0 — 2026-09-16.** A living document: every finding here was measured
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
- **Versions measured against.** `vta-service` 0.28.0 · `vtc-service` 0.11.58 ·
  `pnm-cli` 0.16.5 · `cnm-cli` 0.15.2 · `affinidi-messaging-mediator` 0.25 ·
  `did-hosting-daemon` 0.8.3, all built from the pinned clones described in
  `scripts/openvtc/README.md`.

## Status at a glance

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| [VTI-01](#vti-01) | No admissible path to a community's first vetter | **Blocker** | Open |
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

---

## VTI-01

### No admissible path to a community's first vetter

**Severity: blocker.** Until this is resolved, no community that requires a
vetting statement can admit anyone, from any client.

A community that asks for vetting needs at least one vetter. Granting a vetter
requires the candidate to be a **member**; making a member the documented way
requires an **invitation**; and issuing an invitation refuses anybody who is
already on the community's access list. A community administrator — who must be
on the access list in order to administer anything — is therefore simultaneously
"already a member" and "not a member", depending on which route is asked.

**Where the two checks live**

| Route | Gates on | Upstream |
| --- | --- | --- |
| `POST /v1/invitations` | an **ACL** entry | `vtc-service/src/routes/invitations.rs` — *"… is already a current member — no invitation needed"* |
| `POST /v1/vetting/vetters` | a **Member row** | `vtc-service/src/vetting/vetters.rs` — *"… is not a current member of this community"* |

The two guards are individually reasonable; the gap is that nothing populates a
Member row for the identity that bootstraps a community.

**Reproduce**

```sh
# admin DID is on the ACL (it must be, to administer the community)
vtc --config <stack>/vtc/config.toml acl add --did <admin did:key> --role admin

node vtc-admin.mjs <vtcBase/v1> <vtcDid> <adminCredential.json> invite <admin did:key>
#   409 — "is already a current member — no invitation needed"

node vtc-admin.mjs <vtcBase/v1> <vtcDid> <adminCredential.json> vetter-grant <admin did:key>
#   400 — "is not a current member of this community"
```

**What we would like to know from upstream.** What is the intended bootstrap?
Plausible answers we can work with: an administrator is implicitly a member; a
`vetter` role can be granted from the ACL directly; or a documented seeding
command exists that we have not found.

**Partial route around it, measured 2026-09-16 (see [VTI-13](#vti-13)).** A
community with *no* criteria answers an application with `refer` rather than
`allow`, the request lands in the admin queue as `pending`, and an administrator
can approve it — which does mint a real membership. So membership itself works
end to end; it is specifically the *vetted* path that cannot be bootstrapped.
That is a useful workaround for demonstrations, not a fix: a community cannot
express "open enrolment" as a criterion, so this requires deleting the
community's rules and restoring them afterwards.

---

## VTI-02

### An ACL `member` role is not community membership

The access list and the member roll are separate stores, and the vetting routes
read the member roll. Adding `--role member` to the ACL therefore does not make
the subject a member for any purpose the vetting code cares about. This is the
mechanism underneath [VTI-01](#vti-01), recorded separately because it is
independently surprising: the word `member` appears in both places and means
different things.

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

A community that wants open enrolment — the obvious way to seed its first vetter
around [VTI-01](#vti-01) — cannot express it. A criterion with an empty
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

## Reporting these upstream

Nothing here has been filed yet. When it is, file per finding rather than as one
list, cite this document's anchor, and attach the fixture from
`tsp-reference/ref-20-local-vetting/fixtures/` that demonstrates it. Findings
[VTI-05](#vti-05) and [VTI-06](#vti-06) belong with the mediator's maintainers
rather than with the VTI maintainers, and [VTI-05](#vti-05) is also an
operational request for anyone hosting a mediator that mobile clients must reach.

## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | 2026-09-16 | First published: VTI-01…VTI-15, consolidating the nine findings from the terminal-side rehearsal with the six that only appear when a phone is the client. Records the 2026-09-16 measurement that membership completes on an unconditioned community. |
