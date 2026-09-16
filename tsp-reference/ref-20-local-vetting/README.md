# ref-20 — the vetting ceremony against a local VTI stack

Backs `docs/plans/keyring-on-the-vta-farm/community_vetting_subtask.md` P1–P2:
a six-service local stack built from upstream `main`, the community-admin setup
of the vetting runbook (steps 01–04), and the applicant's wire (manifest →
submit) that Keyring performs as Alice.

## What ran

Built from VTI `origin/main` **53a7cde4** — `vta-service` 0.28.0,
`vtc-service` 0.11.58, `pnm-cli` 0.16.5, `cnm-cli` 0.15.2 — plus
`affinidi-webvh-service` 0.8.3 (`cb8a6f4`) for DID hosting and
`affinidi-tdk-rs`'s `affinidi-messaging-mediator` 0.25.0. Three VTAs (applicant,
community, vetter), one VTC, one mediator, one DID host, each behind its own
HTTPS tunnel because upstream refuses `did:webvh` on non-public hosts.

| Proof | Result |
|---|---|
| `pnm health` against the community VTA | DID resolves, REST ok, token valid |
| `cnm health` after the sealed-transfer bootstrap | **trust-ping → pong, 99 ms** |
| Runbook 01 — register the statement type | `201`, `identity-vetting/0.1` |
| Runbook 02 — publish the criterion | `201`, one vetter / inPerson\|video / `name.legal` / `P120D` |
| Runbook 03 — the manifest an applicant reads | carries `vetting` + `requirementsDigest zQmXe6M8GUW…` |
| Applicant `manifest/0.2` over DIDComm | `#response` with the criteria (`fixtures/manifest-0.2-response.log`) |
| Applicant `submit/0.2` over DIDComm | **`requestMore`, needs `vetting:statements:1`**, signed `eddsa-jcs-2022` (`fixtures/submit-0.2-response.log`) |

That last row is the contract Keyring is built against: the community enforces
its vetting criterion, and says exactly what is missing.

## The two scripts

- **`vtc-admin.mjs`** — the community-admin REST surface: `/v1/auth/challenge`
  → an `eddsa-jcs-2022`-signed `auth/authenticate/0.1` → bearer, then
  endorsement-type registration, the accepts criterion, the manifest, and
  vetter grants. Every route carries its per-route `Trust-Task` header.
- **`join.mjs`** — the applicant: `connectVtaViaMediator` from
  `@openvtc/vti-didcomm-js`, then `manifest/0.2`, `submit/0.2`, `status/0.1`.

Both reuse `di-proof.mjs` from `ref-08`, which mirrors
`@bifold/trust-tasks/src/documentProof.ts` — so the signer proven here is the
signer Keyring ships.

## Findings (see the subtask's §9)

> The numbered, versioned, upstream-facing list lives in
> [`docs/VTI_UPSTREAM_FINDINGS.md`](../../docs/VTI_UPSTREAM_FINDINGS.md) — cite
> that from reports and issues. What follows is this rung's own narrative, kept
> because it records how each one was found.

1. **`vta-service` 0.28.0 overflows its stack** handling
   `vta/contexts/create/1.0`; `RUST_MIN_STACK=33554432` works around it.
2. **`cnm --url` / `VTA_URL` are ignored by `vetting` subcommands** — the VTC's
   log shows no request — and the error blames the VTC's version. The routes
   exist: an anonymous `GET /v1/vetting/vetters` answers `401`, not `404`.
3. **A VTC DID cannot be a `cnm` community**: its `VTCRest` service entry omits
   `/v1`, which `vtc-client` requires, so `cnm` posts `/auth/challenge` → `405`.
4. **A freshly provisioned VTC has an empty ACL** — its own `admin_did` cannot
   authenticate until added with `vtc acl add` on the stopped daemon.
5. **VTA and VTC disagree on the DIDComm body**: the VTA accepts a bare payload,
   the VTC parses the body as a whole Trust Task document and otherwise answers
   `malformedRequest: missing field 'id'`.
6. **An ACL `member` role is not community membership** — `vetting/vetters`
   refuses a grant with "is not a current member of this community", so a vetter
   must be admitted through a join request first.
> **Corrected 2026-09-16.** Finding 7 below is right that the *administrator*
> cannot be made a vetter, but wrong that there is no path: invite a *different*
> identity into an invitation-only community, it is auto-admitted with `allow`,
> and the vetter grant then succeeds. See `docs/VTI_UPSTREAM_FINDINGS.md` VTI-01
> and `fixtures/vetter-grant-after-invitation.log`.

7. **Seeding the first vetter is a dead end on the documented surfaces.** The
   two membership checks disagree: `POST /v1/invitations` refuses with
   "already a current member" for any DID in the ACL
   (`routes/invitations.rs:105-120` gates on `acl_ks`), while
   `POST /v1/vetting/vetters` refuses the same DID with "is not a current
   member" (`vetting/vetters.rs:332-338` gates on the `members_ks` row). So a
   DID added by the documented offline path (`vtc acl add`) is simultaneously
   both. Admission therefore needs a real join — and:
   - a `requestMore` verdict leaves the request **Deferred**, which
     `POST /join-requests/{id}/decide` refuses ("is Deferred, not Pending"),
     `GET /join-requests` does not list, and no REST route withdraws. The
     applicant is told to "withdraw or await its decision"; neither is
     reachable. **Practical rule: do not submit before you hold the statements.**
   - an `invitation`-shaped accepts criterion (a query for
     `InvitationCredential`) is not honoured — an invited applicant presenting
     the community's own signed `InvitationCredential` still gets
     `requestMore … vetting:statements:1`
     (`fixtures/submit-0.2-invited-requestMore.log`).
   The runbook sidesteps this by assuming the vetter "is already a member".
   **Open question for upstream: how is the first vetter admitted?**
8. **The document issuer must equal the DIDComm sender.** A submit whose
   `issuer` is a different DID than the envelope's is refused with
   `permissionDenied: document issuer … does not match the authenticated
   holder`. An applicant's member DID *is* its messaging identity — so
   Keyring's join persona needs one `did:key` Ed25519 identity whose derived
   X25519 key carries authcrypt, which is what `join.mjs`'s
   `APPLICANT_ED25519_SECRET_KEY` mode does.
9. **A community's advertised transports are fixed at mint** (`vtc setup`'s
   `[messaging] transports`), so enabling DIDComm afterwards means re-provisioning.

10. **An Affinidi mediator refuses a phone's WebSocket upgrade.** React Native
    sends an `Origin` header on a WS handshake where Node's `ws` does not, so
    the mediator's CORS check reads a mobile client as a browser and answers
    `/mediator/v1/ws` with 403 — *"Origin not permitted by CORS policy"* — while
    the same client's HTTP `authenticate` succeeds. With `cors_allow_origin`
    unset (the default) cross-origin is refused outright, so **every** mobile
    DIDComm client is locked out of a stock deployment until an operator sets
    it. That is an operator-side setting on the Farm's mediator as much as on
    this stack; upstream may prefer to exempt an upgrade that carries a bearer
    subprotocol, since its credential is not an ambient cookie.

11. **The mediator resolves `functions_file` relative to its working
    directory**, not to its config file, so it only starts from
    `<stack>/mediator`. Measured as *"Couldn't ready database functions_file
    (./conf/atm-functions.lua)"* on a restart from elsewhere. And
    `cors_allow_origin` belongs to the config's `[security]` table, where the
    generated file documents it: set anywhere else — appended at the end of the
    file, or at the top level — TOML scopes it to another table, the mediator
    never sees it, and `/ws` goes on refusing with the setting apparently in
    place.

12. **A second application from the same member DID is refused, not answered.**
    While a request is open — and a `requestMore` request stays open, since
    finding 8 says nothing withdraws it — the VTC answers a `submit/0.2` with a
    `trust-task-error` (`taskFailed`, *"…already exists"*) rather than a
    verdict. Upstream's own `vtc-service/tests/join_didcomm.rs` asserts exactly
    this, so it is intended; it matters to a wallet because the applicant's only
    way forward is a new member DID, and the person is left holding an
    application they cannot advance or withdraw.

Findings 10, 11 and 12 came out of driving this wire from the app rather than
from Node — see `e2e/run-agent-connect.js` and `e2e/run-my-agent.js`.

## Running it

The stack lives outside the repo (`~/vti-stack`), since its DIDs are bound to
per-run tunnel hostnames. `stack.env` there records every DID and URL.

```sh
node vtc-admin.mjs <vtcBase/v1> <vtcDid> <adminCredential.json> manifest
node join.mjs <communityDid> <mediatorDid> manifest
node join.mjs <communityDid> <mediatorDid> submit <requirementsDigest>
```
