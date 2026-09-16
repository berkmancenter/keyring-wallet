# Community vetting — Keyring as a PNM, admitted to a community through peer identity vetting

**Status:** Proposal for review in [#53](https://github.com/berkmancenter/keyring-wallet/pull/53). Not a commitment to implement.
**Parent:** `[keyring-on-the-vta-farm.md](../keyring-on-the-vta-farm.md)` — this subtask carries the parent's F2 (enrolment) and F4 (membership) for the ecosystem's **peer identity vetting** ceremony, and the development environment that ceremony needs before a Farm can host it.
**Siblings consulted:** `[pnm_cnm_subtask.md](../openvtc-integration-plan/pnm_cnm_subtask.md)` owns the VTA client architecture this subtask instantiates; `[trust_tasks_subtask.md](../openvtc-integration-plan/trust_tasks_subtask.md)` owns the Trust Task carriage it rides on.
**Reasoning:** `[2026-09-15-al.md](./2026-09-15-al.md)` — the measurements behind §2–§3, and which positions of the parent plan they supersede. This document states current design only; see `[CLAUDE.md](../CLAUDE.md)`.
**Dependency direction:** inherits the parent's non-core constraint unchanged. Nothing in the parent's sibling plans waits on this subtask.
**Starting point:** the DIDComm v2 + TSP-over-v2 line is now committed and in review — **[keyring-wallet#54](https://github.com/berkmancenter/keyring-wallet/pull/54)** (`feat/credo-0.7`, head `d359e2ba9`: app wiring, the v2 developer setting with its own mediation, the v2/TSP e2e suites, `didcomm_v2_subtask.md`) and **[keyring-bifold#54](https://github.com/berkmancenter/keyring-bifold/pull/54)** (`feat/credo-0.7`, head `5a90b9f36`: the credo-ts `0.7.1-pr-2704` snapshot hop, `DidCommV2Carriage`, TSP over a v2 connection, mediator and witness serving v2 beside v1). This subtask assumes both land as they stand; review fixes are folded in as they arrive rather than waited on. The reference rungs behind them (`ref-15…19`) are **not** in those PRs and remain local.
**Baseline (read 2026-09-15):** VTI `origin/main` **53a7cde4** (vta-service 0.27.0, vtc-service 0.11.58, vta-sdk 0.38 — no coordinated `VTI-`* tag after `VTI-Dogwood-R1`) · `OpenVTC/openvtc` **9a2d174e** · `dtgwg-trust-tasks-tf` **6e667c1d** · `vta-browser-plugin` **21b0465** (`@openvtc/pnm-core` 0.9.1) · `ic3software/vtafarm-api` **a3b8e52**. Upstream is changing these specs deliberately and weekly; every claim below is re-measured before it is acted on, per `[scripts/openvtc/README.md](../../../scripts/openvtc/README.md)`.

**References:**

- **[[VETTING-DESIGN]]** — `docs/design/vetting-process.md` in `OpenVTC/openvtc`: actors, phases, the Vetting Card and Vetting Statement, open questions.
- **[[VETTING-OPS]]** — `docs/03-vtc/vetting.md` in the VTI repo: setting up requirements, naming vetters, what the community checks at submit, default verdicts, current limits.
- **[[VETTING-JOURNEY]]** — `vtc-service/tests/vetting_journey.rs` in the VTI repo: the server-side end-to-end story, executable.
- **[[ONBOARDING-CEREMONY]]** — `ceremonies/vtc/member-onboarding/0.1/ceremony.json` in `dtgwg-trust-tasks-tf`.
- **[[TSP-REV3]]** — *TSP Rev 3 migration*, `docs.fpp.storm.ws/tsp-rev3-migration.html`.
- **[[DRY-RUN]]** — *Vetting Dry Run* (OpenVTC · Peer Identity Vetting · V0), upstream's step-by-step runbook for one applicant, one vetter and one statement, revised 2026-09-14 and shared with the team as a PDF. Not vendored here; §3.8 carries what this subtask depends on.

---



## 1. What this subtask is for

Upstream's peer identity vetting replaces a PGP web of trust with a community ceremony: a member the community has named a **vetter** hands an applicant a **ticket**, the two meet in a **session** confirmed by a spoken **match code**, the applicant signs a **Vetting Card**, the vetter issues a **Vetting Statement**, and the applicant's join request is judged against the community's published requirements. [[VETTING-DESIGN]] targets its V0 for **5 October 2026**, driven from a terminal client.

This subtask makes Keyring the **applicant** in that ceremony, on a phone, for the **OSS Summit Europe, Prague, 1 October 2026** — and makes every place the phone path needs something upstream does not yet provide into an evidenced request rather than a workaround.

Three consequences shape everything below:

1. **Keyring becomes a PNM.** The applicant drives its own VTA (personas, disclosure, credentials). Keyring has no VTA client today.
2. **A Farm cannot host the ceremony yet** (§2.3), so the development and test environment is a **local VTI stack** built from the same commits upstream runs the ceremony on. The Farm is the production target once it can.
3. **The ceremony is still moving upstream.** The terminal client's vetting flow is not finished (§3.5) and TSP is about to change revision (§3.6). Phases that depend on either are flagged at the phase.

---



## 2. Positions



### 2.1 Keyring consumes the ecosystem's TypeScript client

Keyring embeds `@openvtc/pnm-core` in a new bifold package, `vti-client`, behind a DI token — the architecture `[pnm_cnm_subtask.md](../openvtc-integration-plan/pnm_cnm_subtask.md)` §3 already selects. `pnm-core` 0.9.1 already implements the member side of joining (`packages/core/src/vtc/membership.ts`: manifest, submit 0.2, status, receipt, request-vmc, vmc, self-remove), persona disclosure with its step-up retry, onboarding by key swap, and the consent view model. It has **no vetting client**: the vetting task URIs appear only in its `task-surface.json` catalogue. The vetting client logic exists only in Rust (`openvtc-core/src/vetting/`, `vta_sdk::vetting`); §6 P6 ports the applicant half.

### 2.2 The development environment is a local VTI stack, not a local Farm

A Farm is orchestration around four services — VTA, mediator, DID hosting, VTC. Reproducing its orchestration locally needs a DNS provider, a secrets vault, a Kubernetes cluster and publicly trusted certificates for every hostname (`ic3software/vtafarm-api` `CLAUDE.md`, `internal/setup/`), which buys nothing the ceremony needs. The local stack runs the **same four services, configured from the Farm's own service templates** (`vtafarm-api/internal/setup/templates*.go`), so a flow that works locally transfers. It replaces `[ref-05-local-vta](../../../tsp-reference/ref-05-local-vta/)` as the offline twin for this path (parent §8).

### 2.3 The Farm is the production target, after it can run vetting

The newest images a Farm session can select (GHCR `ic3software/vta`, `vtc`: `0.24.1-0af2cce7`, built from VTI commit `0af2cce7` of 2026-09-09) **predate** the vetting implementation (VTI #1425 `5a6d4923`, #1430 `14ef89a6`, #1439 `7a5d8aa0`). The first release batch that contains it is the 2026-09-12 one (`vta-service-v0.27.0`, `vta-sdk-v0.38.0`, `cnm-cli-v0.15.0`). Until vetting-capable images are selectable, a Farm run can exercise enrolment and plain membership (parent F2, F4) but not this ceremony.

### 2.4 Keys

Persona and join-DID keys are **held by the VTA**, as upstream designs them: a persona is a `did:webvh` minted by the member's own VTA, one per community (`vti-setup` `developer/03-joining-a-community.md`), and the join persona is fixed at the start of an application ([[VETTING-DESIGN]]). The phone's own admin `did:key` is software Ed25519 first; the hardware target is chosen in P4 by measurement among: a P-256 `did:key` in the Secure Enclave (if the VTA accepts one), StrongBox Ed25519 (Android API 33+), or software Ed25519 wrapped by a hardware key. The parent's custody position (§3.2) is unchanged; this subtask sequences it. §3.6 records why TSP Rev 3 eases the hardware case.

### 2.5 Counterparties in test are upstream's own code

- **Admin:** the `cnm` CLI and the VTC REST routes ([[VETTING-OPS]] §7) — scripted, no console.
- **Vetter:** a headless binary built on `openvtc-core`'s vetter module, so Keyring is tested against the ecosystem's implementation rather than against a second copy of itself. Upstream's own client-side ceremony test, `openvtc-core/tests/vetting_e2e.rs` (openvtc #322 — Alice and Bob over an in-process mediator), is the scaffolding it starts from; the difference is that ours talks to a real VTC and to a phone.

---



## 3. Constraints



### 3.1 Membership ceremony

From [[ONBOARDING-CEREMONY]]; all task URIs are `https://trusttasks.org/spec/<slug>/<version>`:


| Step        | Task                                                                                                                                                                                            | Direction             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| discover    | `vtc/join-requests/manifest/0.2` (adds `vetting`, `branding`, `requirementsDigest`)                                                                                                             | applicant → community |
| apply       | `vtc/join-requests/submit/0.2` — the applicant is the proof signer; response `{requestId, verdict}` with `effect ∈ allow | deny | refer | requestMore`                                          | applicant → community |
| acknowledge | `vtc/join-requests/submit-receipt/0.1`                                                                                                                                                          | community → applicant |
| poll        | `vtc/join-requests/status/0.1`                                                                                                                                                                  | applicant → community |
| deliver     | `credential-exchange/issue` — `MembershipCredential` (VMC) and a role `EndorsementCredential` (VEC), sent to the holder's mediator, best-effort (VTI `vtc-service/src/credentials/delivery.rs`) | community → applicant |
| reciprocate | `vtc/members/request-vmc/0.1` → `vtc/members/vmc/0.1`                                                                                                                                           | community ↔ member    |


This answers the parent's §9 Q3: the `trusttasks.org/openvtc/vtc/join-requests/submit/1.0` form in the developer guide is not the current wire. Delivery arrives over the mediator, so **a client that only polls cannot complete the ceremony** — Keyring needs a live mediator session.

### 3.2 What a community configures

[[VETTING-OPS]] §1–§3: register the statement type (`POST /v1/endorsement-types`, type `https://firstperson.network/endorsements/identity-vetting/0.1`); publish an accepts criterion with a `vetting` requirements object (`POST /v1/schemas/accepts`: `minStatements`, `acceptedMethods`, `requiredClaims`, `maxStatementAge`, `eligibleVetters`, `independence`); name vetters (`cnm vetting vetters grant <memberDid>`), who receive a revocable `CommunityRole: vetter` credential. A community that should vet must not also carry a criterion that admits without vetting.

### 3.3 The applicant's side

[[VETTING-DESIGN]] §4 and [[VETTING-OPS]] §4:

1. **Ticket** — a `vetting-ticket:` link or short code, rendered as a QR by the vetter. A ticket for a different community is refused before anything is sent.
2. **Application** — the join persona DID is chosen or minted at the start, so every card, statement and the final presentation name the same DID.
3. **Request** — `vetting/request/0.1` to the vetter; the reply carries the vetter's eligibility presentation, which the applicant verifies (role credential, not revoked).
4. **Session** — `vetting/session/0.1`; both parties see the same match code and confirm it aloud.
5. **Card** — a disclosure preview, then presentation; the Vetting Card is a Verifiable Data Structure typed `RelationshipCard` + `VettingCard`, carrying a salted identity commitment, audience = the vetter. A step-up refusal keeps the preview intact for a retry.
6. **Statement** — an `EndorsementCredential` issued by the vetter (`method ∈ inPerson | video | priorAcquaintance`), verified against the applicant's own card before it is stored.
7. **Submit** — `submit/0.2` with the statements in the presentation and the `requirementsDigest` in `extensions`.

The applicant's persona needs a face carrying the claims the community requires (`name.legal` in upstream's examples, `docs/02-vta/claim-type-registry.md`) with a readable value.

### 3.4 What the community decides

[[VETTING-OPS]] "What the community checks at submit" and "What the default policy decides": met requirements → `allow`; a shortfall → `requestMore` with needs such as `vetting:statements:<n>`; inconsistent identity commitments across statements → `refer` to the `vetting-review` queue; a withdrawn statement after admission is flagged `needsReview`, not removed. "Current limits" lists what V0 does not yet do.

### 3.5 Upstream's client side of vetting is not finished

The ceremony is exercised end to end server-side by [[VETTING-JOURNEY]] and client-side over a mediator by `openvtc-core/tests/vetting_e2e.rs`, but the terminal client's vetting flow is still being iterated. **Conditional design:** P2 and P3 (§6) use the terminal client as the reference applicant and as the base of the headless vetter; where it is incomplete, [[VETTING-JOURNEY]] is the oracle instead, and the gap is recorded as a request, not patched locally. Expect at least one further upstream iteration before P6 is final.

### 3.6 TSP Rev 3 is a hard cutover

[[TSP-REV3]]: *"Rev 3 removes HPKE-Auth, which is the only mode we implement"*; implementations *"MUST support HPKE-Base mode"*; *"a message is either wholly Rev 2 or wholly Rev 3"*. The CESR envelope codes, the AEAD `info`/`aad`, the ciphertext layout, the thread digest (now an embedded SAID) and routed-mode exit VIDs all change. Upstream keeps `main` on Rev 2 *"until* `tsp-sdk` *cuts an official Rev 3 release"*; spec review is open and test vectors are deferred.

Consequences for this subtask:

- **The vetting path does not depend on TSP.** Every leg has a DIDComm v2 route; TSP legs are optional until Rev 3 settles, and fixtures record which TSP revision produced them.
- **Keyring's existing TSP work is Rev 2 throughout** — the HPKE-Auth crypto proven against the CFRG Auth-mode vector in `[ref-03-noble-crypto](../../../tsp-reference/ref-03-noble-crypto/)`, the envelope fixtures in `ref-00…04`, and the TSP carriage. Its migration belongs to `[openvtc-integration-plan.md](../openvtc-integration-plan.md)`, triggered by upstream's Rev 3 release, and is not scheduled here.
- **Rev 3 helps hardware custody.** HPKE-Base authenticates the sender by signature rather than by a static X25519 key agreement, and X25519 cannot live in the Secure Enclave or StrongBox; under Rev 3 the key a device must hold in hardware to send is a signing key.



### 3.7 Non-public hosts are refused

VTI #1448 (`3415fb57`) refuses `did:webvh` resolution to localhost, `.local` and private addresses by default, and `pnm-core`'s egress guard (`packages/core/src/did/egress-guard.ts`) refuses them with no opt-out; `did:webvh` resolvers also reject plain HTTP. **Every service of the local stack is therefore reachable only through a public HTTPS hostname** (stable developer tunnel domains), never through `localhost` or an emulator loopback address.

### 3.8 The runbook this subtask reproduces

[[DRY-RUN]] is written against **vtc-service 0.11.58 · vta-service 0.27.0 · vta-sdk 0.38 with the** `vetting` **feature**, with three actors — **admin**, **alice** (applicant) and **bob** (vetter). Its 2026-09-14 revision covers VTI #1465 and #1467 (console authoring of criteria and vetter eligibility), #1471 (join dry-run vetting inputs) and #1472 (the Flow view). All of these are on VTI `origin/main`, so *latest upstream* and *the runbook's versions* are the same build today. Keyring takes alice's part; §2.5 fills bob's and the admin's.

**Topology comes first** — the runbook's own warning is that most failures in a three-party flow are topology, not protocol:

- bob is already a member and alice is not; only a member can be named a vetter.
- **Two VTAs, not one** — each client profile authenticates to its own VTA, and `device/register` refuses a re-claim. Two terminal-client profiles (`openvtc -p alice`, `openvtc -p bob`) on one machine are fine if they point at separate VTAs.
- **Both parties on the same mediator for the first run**; a cross-mediator reply has a known refusal, so that is tested deliberately as a variant.
- **alice needs a persona face carrying** `name.legal` **with a readable value** — a predicate-only release is refused, because a vetter reads the value off a document.
- Preflight both sides with `openvtc -p <profile> health`, which resolves the messaging chain and reports the transport each pair negotiates.
- Prove the community will admit before involving two people (step 00).

**Steps and what must be true at each:**


| #   | Actor | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Expect                                                                                                                                                                                                                                                                        |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00  | admin | Dry-run the join verdict (console *Ceremonies → Join → Flow*, peer identity vetting = requirements met)                                                                                                                                                                                                                                                                                                                                                                                                                                      | `ADMIT · as member`. If it lands on `REFER · to the moderator queue`, the installed join policy predates vetting: upload `vtc-service/policies/default/join.rego` as raw Rego **and activate it** (uploading does not activate)                                               |
| 01  | admin | Register the statement type — `POST /v1/endorsement-types` `{typeUri: "https://firstperson.network/endorsements/identity-vetting/…", description}`; a criterion cannot name an unregistered type                                                                                                                                                                                                                                                                                                                                             | —                                                                                                                                                                                                                                                                             |
| 02  | admin | Publish a criterion needing one vetter — `POST /v1/schemas/accepts` `{id: "vetted-member", query: {credentials: [{format: "ldp_vc", meta: {type_values: ["EndorsementCredential"]}}]}, vetting: {version: "0.1", statementType, minStatements: 1, acceptedMethods: ["inPerson","video"], requiredClaims: ["name.legal"], maxStatementAge: "P120D", eligibleVetters: {role: "vetter"}, independence: {requireConsistentIdentityCommitment: true}}}`. Leave `invitation` out. **Disable any other criterion that would admit without vetting** | the route refuses unsatisfiable requirements (`minStatements: 0`, a `minByMethod` floor on a method not accepted, month-based durations such as `P4M`, an unregistered type)                                                                                                  |
| 03  | admin | Confirm the applicant can read it — `GET /v1/schemas/accepts` and `vtc/join-requests/manifest/0.2`; re-check the Flow view                                                                                                                                                                                                                                                                                                                                                                                                                   | the criterion carries a `vetting` object and a `requirementsDigest`; `manifest/0.1` is unchanged; the Flow now turns on the vetting questions                                                                                                                                 |
| 04  | admin | Grant the role — `cnm vetting vetters grant did:webvh:…:bob --validity 180d` (or `POST /v1/vetting/vetters`, task `vtc/vetting/vetters/grant/0.1`); validity defaults to one year, range one day to two years; re-granting returns the live grant                                                                                                                                                                                                                                                                                            | `cnm vetting vetters list` shows bob `live: true`, `origin: "manual"`; audit `VetterGranted` with `VecIssued`                                                                                                                                                                 |
| 05  | bob   | Check the role credential arrived over `credential-exchange/issue`; if bob was offline, `cnm vetting vetters resend <memberDid>` re-sends the same credential                                                                                                                                                                                                                                                                                                                                                                                | bob holds a `CommunityRole: vetter` VEC with a `credentialStatus`                                                                                                                                                                                                             |
| 06  | bob   | Cut a ticket — the vetter's consent to be asked; defaults one use, fourteen days; available as a `vetting-ticket:` link, an `XXXX-XXXX` code and a QR; optionally publish a vetter profile so applicants can find bob                                                                                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                                                                                             |
| 07  | alice | Start the application (**the join DID is chosen or minted here**), choose a face, refresh requirements, request a vetter by pasting bob's ticket link; a link for another community is refused before anything is sent                                                                                                                                                                                                                                                                                                                       | bob's desk shows the request `Accepted` automatically (the ticket was the consent); alice's row reads *named a vetter until … not revoked when checked on …*                                                                                                                  |
| 08  | bob   | Open the session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | both screens show the same `XXXX-XXXX` match code, derived from the session document id under a domain-separation tag; read aloud, it ties the person on the call to the client holding the join DID. The same id must **not** yield the same code in the personhood ceremony |
| 09  | alice | Review and send the card — the disclosure preview shows exactly what bob will see; nothing leaves until alice confirms; a `stepUpRequired` refusal keeps the preview so she can approve on her device and present again; the card is signed as the join persona DID                                                                                                                                                                                                                                                                          | bob's desk moves to `CardReceived`; the card verifies against the session's challenge, audience and community                                                                                                                                                                 |
| 10  | bob   | Check the human, then attest — mark `name.legal` verified against the document relied on, record which documentation, confirm liveness; signing is never automatic. Trip each refusal once: attesting before confirming the match code, marking a claim the card does not carry, leaving a required claim unverified, leaving documentation blank                                                                                                                                                                                            | a signed statement issued to alice, which her client verifies against her own card before storing                                                                                                                                                                             |
| 11  | alice | Submit — the checklist reads *1 of 1 · meets the published requirements* (advisory: only the community knows whether bob was eligible); the statement goes in the presentation, the `requirementsDigest` in `extensions`                                                                                                                                                                                                                                                                                                                     | verdict `allow` → VMC grant + role VEC → reciprocal VMC; the admin decision records the vetting facts relied on and the requirements version                                                                                                                                  |


**Where to assert:**


| Stop              | Client side                                                                     | Community side                                              |
| ----------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Requirements read | the vetting page names one statement and `name.legal`; digest stored            | `manifest/0.2` carries `vetting` + `requirementsDigest`     |
| Vetter named      | bob holds a `CommunityRole: vetter` VEC with `credentialStatus`                 | `cnm vetting vetters list` → `live: true`, `origin: manual` |
| Request accepted  | eligibility presentation verifies; grant recorded as not revoked                | —                                                           |
| Session open      | same match code on both screens; differs from a personhood code for the same id | —                                                           |
| Statement issued  | statement verifies against alice's card; checklist 1/1                          | —                                                           |
| Verdict           | membership appears; reciprocal VMC issued                                       | decision records vetting facts + requirements version       |


**Negative cases, ordered by what they catch** (the first four are cheap; the last ones are where the interesting defects live):


| Class       | Case                                                                          | Expected                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| anti-spam   | Ask with no ticket                                                            | the gate runs before a task exists, so the request never reaches the vetter; five bad codes from one sender in an hour drops that sender silently for the hour                      |
| anti-spam   | Ticket from another community                                                 | refused client-side before sending — sending would tie the join DID to a community the applicant is not applying to                                                                 |
| counting    | Raise the criterion to two statements, submit with one                        | `request_more`, with the generic `vetting` need expanded to `vetting:statements:1`; gather a second and resubmit                                                                    |
| counting    | Statement past `maxStatementAge`                                              | stops counting at submit without invalidating anything else                                                                                                                         |
| revocation  | Revoke the grant before submit (`cnm vetting vetters revoke <endorsementId>`) | alice's row flips to *the community has revoked this vetter's grant*; the statement stops counting; bob's profile is deleted with the grant                                         |
| revocation  | Withdraw after admission                                                      | `cnm vetting revocations` shows the admission as `needsReview` — flagged, not removed                                                                                               |
| consistency | Two vetters, two identities (different `name.legal` between cards)            | commitments diverge; verdict `refer` to the `vetting-review` queue, not a denial                                                                                                    |
| networking  | Stop the VTC mid-question                                                     | a manifest, directory or resend question unanswered after 30 s is reported as *unanswered*, never a hang, and says whether it was unreachable, auth-rejected or a contract mismatch |
| topology    | Put bob on a second mediator                                                  | if a reply vanishes, read the *sending* mediator's forward log — `Sent` is not delivery                                                                                             |




**Upstream coverage the runbook names:** server side end to end in `vtc-service/tests/vetting_journey.rs` ("the executable version of this document"); client side in unit tests under `openvtc-core/src/vetting/`, and, since #322, over a real mediator in `openvtc-core/tests/vetting_e2e.rs`. The manual run remains the only proof against **running** services — which is what P2 turns into repeatable fixtures and P6 into a phone e2e.

---



## 4. The local stack


| Service                                                      | Built from                                  | Instances                                                   |
| ------------------------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------- |
| `vta-service` (features including `vetting`, `tsp`, `webvh`) | VTI `origin/main` at a recorded SHA         | 3 — the community's host VTA, the applicant's, the vetter's |
| `vtc-service`                                                | VTI `origin/main`                           | 1                                                           |
| Mediator                                                     | Affinidi messaging mediator, latest release | 1, shared by all parties for the first runs                 |
| DID hosting                                                  | `affinidi/affinidi-webvh-service`, latest   | 1                                                           |
| `cnm`, `pnm`, `openvtc`                                      | VTI / openvtc `origin/main`                 | CLIs                                                        |


- **Native builds** — the published prebuilt server binaries are Linux x86-64 only.
- **Headless provisioning in upstream's own two-phase shape** — `vtc setup --setup-key-out`, an operator grant, then `vtc setup --from <toml>` (VTI `docs/03-vtc/non-interactive-setup.md`); the mediator and DID hosting follow the same pattern.
- **Six stable public hostnames, one per service** — the three VTAs, the VTC, the mediator and DID hosting — so DIDs survive restarts and a provisioned stack is reusable across e2e runs. The team's tunnel provider is **ngrok**: a paid Hobbyist plan includes about ten reserved dev domains, which covers one stack. **Anyone running the stack on their own machine reserves their own six dev domains** (dashboard → *Domains* → *New Domain*, or `ngrok api reserved-domains create`), because a reserved domain terminates on one agent at a time and DIDs are bound to their hostname — two developers cannot share one stack's domains. The stack reads them from one config file (`scripts/openvtc/local-vti-stack/domains.env`, gitignored; a `domains.env.example` names the six variables), and the ngrok agent config maps each domain to its local port. Quick tunnels with random hostnames also work but mint new DIDs on every run, so they suit throwaway e2e only.
- **Lives in the repo** as `scripts/openvtc/local-vti-stack/` (build, recipes, tunnel config, start/stop, health), driven from e2e by `e2e/lib/vti-stack.js`, reusing `e2e/lib/vta.js` and `e2e/lib/mediator.js`.
- **Pins:** `OpenVTC/openvtc`, `ic3software/vtafarm`, `ic3software/vtafarm-api` and `affinidi/affinidi-webvh-service` are added to `setup-external.mjs`; the VTI and `vta-browser-plugin` pins advance to the baseline with logged reasons.

---



## 5. Client architecture

- **Package:** `bifold/packages/vti-client` wraps `@openvtc/pnm-core` behind a DI token with React Native implementations of its platform seams; the app adds a **My Agent** stack. The VRC and witness modules are unchanged.
- **Carriage:** Trust Task documents are byte-identical across REST, DIDComm and TSP (`[pnm_cnm_subtask.md](../openvtc-integration-plan/pnm_cnm_subtask.md)` §2.1). Keyring carries them over Credo DIDComm v2 — the in-progress Credo 0.7 / DIDComm v2 line (credo-ts PR #2704 snapshots; not yet on `main`) — plus a Credo transport to the VTI mediator (mediator login, one socket per DID, Pickup 3.0). That transport is the one piece of the v2 line **not** in [keyring-bifold#54](https://github.com/berkmancenter/keyring-bifold/pull/54): it is proven in Node only (a local rung) and is phase V3 of [`didcomm_v2_subtask.md`](../openvtc-integration-plan/didcomm_v2_subtask.md), which this subtask's P4 builds for the app. `pnm-core`'s own channels are the fallback where that path does not reach. Which carries each leg is **measured in P4**, not assumed.
- **Versions move together:** VTI `origin/main` with `pnm-core` 0.9.1 (both on vta-sdk 0.38). `pnm-core` 0.9.0 is avoided — its published tarball is a partial build (`vta-browser-plugin` `b379f2c`).
- **React Native seams**, measured at `vta-browser-plugin` 21b0465: `node:fs`/`fs` resolved to an empty module (`@openvtc/vti-didcomm-js` → `didwebvh-ts`, whose `react-native` export condition resolves to a build that `require`s `node:fs`; the chain now also reaches the REST path via reply verification, `packages/core/src/trust-tasks/verify.ts`); `crypto.subtle` AES-KW / AES-CBC / HMAC / HKDF / SHA-256 for DIDComm legs; `getRandomValues` / `randomUUID`; `AbortSignal.timeout` (`packages/core/src/http/timeout-fetch.ts`); `structuredClone`; a key-value store adapter; and whether React Native's `fetch` honours `redirect: "manual"`, on which the egress guard's no-redirect guarantee depends — to be measured before it is relied on.
- `did:webvh`**:** the app already registers `@credo-ts/webvh`'s resolver (`app/src/utils/bc-agent-modules.ts`, `bifold/packages/core/src/utils/agent.ts`); P4 measures it on Hermes against the stack's real DIDs, with a tampered-log fixture, before building on it.

---



## 6. Phases

Each phase names what makes it **done** and what it is **blocked on**. Target dates count back from 2026-10-01. A red gate stops the next phase.

### P0 — Base and pins (target 09-16)

Branch `feat/prague-farm-membership` in both repos from `feat/credo-0.7` — wallet `d359e2ba9` ([#54](https://github.com/berkmancenter/keyring-wallet/pull/54)) and bifold `5a90b9f36` ([#54](https://github.com/berkmancenter/keyring-bifold/pull/54)) — and rebase onto whatever those PRs merge as. Add and advance pins (§4).

**Done when:** `yarn lint`, `yarn typecheck`, `yarn test` and `bifold/packages/core` `yarn test` pass on the branch point before anything is added; `sync-external.mjs` reports the new pins with reasons.
**Blocked on:** nothing.

### P1 — The local stack (target 09-17)

**Done when:** `cargo test -p vtc-service --test vetting_journey` and the touched crates' tests pass at the built SHA; every DID resolves over its public hostname; `pnm health` is green for all three VTAs; the terminal client's `health` reports the negotiated transport for the applicant and vetter profiles.
**Blocked on:** nothing.

### P2 — Reference run with upstream's clients (target 09-18)

[[DRY-RUN]] as written (§3.8): community setup steps 00–05 via `cnm` and REST, the vetter admitted first, then steps 06–11 with two terminal-client profiles, then the first four negative cases. Every task document and reply is captured as a frozen fixture under `tsp-reference/ref-20-local-vetting/` (numbering starts at 20: `ref-15…19` are taken on the DIDComm v2 line, which also makes the parent's reserved `ref-16-farm-membership` name collide).

**Done when:** every *Expect* in §3.8 is observed and recorded; the admitted applicant holds a VMC and role VEC and the community holds the reciprocal VMC; fixtures are committed; every divergence from the docs is a written request (§9).
**Blocked on:** §3.5 — where the terminal client cannot complete a step, [[VETTING-JOURNEY]] stands in and the step is recorded as upstream-incomplete.

### P3 — Headless vetter (target 09-19)

`tsp-reference/ref-21-headless-vetter/`: a binary on `openvtc-core`'s vetter module, starting from the setup in `openvtc-core/tests/vetting_e2e.rs`, that issues a ticket, accepts requests, opens a session, exposes the match code, and attests a configured claim **only after** the match code is confirmed — preserving upstream's refusal to attest before confirmation.

**Done when:** P2's ceremony re-runs with the headless vetter and produces fixtures of the same shape; its README lists the refusals it preserves.
**Blocked on:** §3.5, as P2.

### P4 — Keyring connects to its agent (target 09-22)

`vti-client`; `did:webvh` measured on Hermes; enrolment by QR against a local stand-in for the enrolment contract in §9; authenticated session; agent health; persona list; mediator session that persists an inbound message before acknowledging it.

**Done when:** unit tests cover the platform seams, the store adapter, and byte-equality of Keyring-built documents against P2's fixtures; `e2e:agent:connect` passes on the Android emulator **and** the iOS simulator; the hardware-custody measurement of §2.4 is recorded.
**Blocked on:** P1.

### P5 — Keyring joins a community (target 09-24)

Plain membership (§3.1) against a criterion that does not require vetting.

**Done when:** `e2e:community:join` passes on both platforms; the membership card renders from the stored VMC; `cnm` lists the applicant as a member.
**Blocked on:** P4.

### P6 — Keyring as the vetting applicant (target 09-27)

§3.3 end to end against the headless vetter, including the port of the applicant-side card and statement verification.

**Done when:** `e2e:vetting:applicant` passes on both platforms; the first four negative cases of §8 pass on both platforms; the applicant verifies each statement against its own card before storing it.
**Blocked on:** P3, P5, and §3.5.

### P7 — Real devices on the local stack (target 09-29)

**Done when:** one attended run on an iOS device and one on an Android device complete the P6 flow, with logs captured and any device-only failure given a named cause.
**Blocked on:** P6.

### P8 — The Farm

Enrolment contract proposed to the Farm operator with P4 as evidence; a prototype on a fork; the same flow against a Farm-hosted stack.

**Done when:** the fork's tests cover token single use, expiry, session binding, proof failure and the confirmation step; one attended run against a Farm-hosted stack completes P5, and P6 once vetting-capable images are selectable (§2.3).
**Blocked on:** P6 and the Farm operator's agreement.

---



## 7. User experience

**My Agent** is a top-level tab with three sections: *Agent* (connected or not; the agent's DID with its host shown, never a name derived from the DID; health), *Communities* (member, applying, pending review), *Applications* (each vetting application with its checklist and next action). Pending states refresh by pull; push notification is later work. Membership cards use Keyring's existing credential card with the community's name from its manifest.

**One scanner** dispatches on what it reads — an enrolment payload, a `vetting-ticket:` link, or an existing relationship invitation — with typed entry for short ticket codes. Where one scanner would complicate the code, flows keep separate entry points.

**The application flow uses the ceremony's own vocabulary** — application, requirements, ticket, vetter, session, match code, card, statement — in the order of §3.3. The match code is shown full-screen with an instruction to read it to the vetter. **Every signing act asks for device biometrics**: connecting the agent, sending the card (and again after a step-up), submitting, and sending the reciprocal membership credential.

**The legal name** is asked for explicitly at the start of an application — *"your legal name, exactly as on your ID"* — pre-filled from the user's relationship-card name when one exists and confirmed by the user, stored on the VTA in a dedicated face marked sensitive, and not duplicated in Keyring. A relationship-card name is a display name and may not match a document, while a vetter checks the claim against one and inconsistent commitments across statements are referred for review (§3.4). Editing it after a statement exists warns that existing statements will no longer match.

**Refusals** show a plain sentence with an expandable *Details* block carrying the upstream code: no or invalid ticket, ticket for another community, `requestMore` and its needs, `refer`, a statement too old, a revoked vetter, and "community unreachable" distinguished from "refused" and from "contract mismatch" — never an indefinite wait.

### 7.1 Screens

Keyring's tab bar today is Contacts, Messages, Connect (the centre scan tab), Credentials and Settings (`bifold/packages/core/src/navigators/TabStack.tsx`). **My Agent** is added as a sixth tab; scanning stays on Connect. Every string ships in the app's three locales (en, fr, pt-br), and every screen meets the app's existing accessibility bar (labels on all controls, font scaling).


| #   | Screen                       | Reached from                                                     | Shows                                                                                                                                                                                                                                                       | Actions                                                                                              | Phase |
| --- | ---------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----- |
| S1  | **My Agent — not connected** | My Agent tab, first visit                                        | what an agent is, in one sentence; why a community needs one                                                                                                                                                                                                | *Connect my agent* → S2                                                                              | P4    |
| S2  | **Connect my agent**         | S1; Connect tab when an enrolment code is scanned                | scan prompt, or the scanned agent's host and DID for confirmation; typed-link fallback                                                                                                                                                                      | *Connect* (biometric) → S3; *Cancel*                                                                 | P4    |
| S3  | **Connecting**               | S2                                                               | progress through grant → key swap → session → health, each step named; a clear failure with *Details* and *Try again*                                                                                                                                       | —                                                                                                    | P4    |
| S4  | **My Agent — home**          | My Agent tab once connected                                      | *Agent* card (host, health, transport); *Communities* list (member / applying / pending review); *Applications* list (checklist summary, next action)                                                                                                       | open a community → S5; open an application → S7; *Join a community* → S6; pull to refresh            | P4–P6 |
| S5  | **Community**                | S4                                                               | community name and branding text; membership card (existing credential card) or join status; requirements in sentences                                                                                                                                      | *Apply* → S7 (vetting communities) or *Join* (others, biometric); pull to refresh                    | P5    |
| S6  | **Join a community**         | S4                                                               | scan or paste a community link or a vetter's ticket                                                                                                                                                                                                         | ticket → S7 pre-filled; community → S5                                                               | P5–P6 |
| S7  | **Application**              | S5, S6, S4; Connect tab when a `vetting-ticket:` link is scanned | the community's requirements in sentences; the checklist (*0 of 1 statements*); the named vetter and *named a vetter until … not revoked when checked on …*; the current step                                                                               | *Choose face* → S8; *Request a vetter* (scan/paste ticket); *Submit* → S12 when the checklist is met | P6    |
| S8  | **Your legal name**          | S7, first time per application                                   | *"Your legal name, exactly as on your ID"*, pre-filled from the relationship-card name; note that only vetters see it                                                                                                                                       | *Confirm* (writes the vetting face to the VTA); edit warning if a statement already exists           | P6    |
| S9  | **Match code**               | S7, when the vetter opens the session                            | full-screen `XXXX-XXXX`; *"Read this to your vetter — their screen shows the same code"*                                                                                                                                                                    | *Continue* → S10 once confirmed; *Cancel session*                                                    | P6    |
| S10 | **Review your card**         | S9                                                               | exactly what the vetter will see (the disclosure preview)                                                                                                                                                                                                   | *Send* (biometric; again after a step-up) → back to S7 *waiting for statement*; *Cancel*             | P6    |
| S11 | **Statement received**       | S7, when the statement arrives                                   | who vetted, how (*in person*, *video*), which claims were verified; *verified against your card*                                                                                                                                                            | *Done* → S7 with the checklist updated                                                               | P6    |
| S12 | **Submit application**       | S7                                                               | checklist *meets the published requirements*; what will be shared                                                                                                                                                                                           | *Submit* (biometric) → S13                                                                           | P6    |
| S13 | **Result**                   | S12; S5 on refresh                                               | *Admitted* (membership card, then *sending your membership confirmation* for the reciprocal credential, biometric) · *Pending review* (pull to refresh) · *More needed* (the needs, with *Request another vetter*) · *Referred for review* · *Not admitted* | *View card* → S5; *Back to My Agent* → S4                                                            | P5–P6 |
| —   | **Refusal sheet**            | any screen                                                       | the plain sentence of §7 with *Details* (upstream code and message)                                                                                                                                                                                         | *Try again* where it can succeed; *Close*                                                            | P4–P6 |


---



## 8. End-to-end tests

New runners in `e2e/`, each run with the applicant on the Android emulator and then on the iOS simulator, against the local stack with the headless vetter and `cnm` as admin:


| Script                                                                                                                               | Asserts                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `e2e:agent:connect`                                                                                                                  | enrolment, key swap, health, persona list                                        |
| `e2e:community:join`                                                                                                                 | submit → receipt → VMC and VEC delivered → reciprocal VMC                        |
| `e2e:vetting:applicant`                                                                                                              | ticket → request → session and match code → card → statement → submit → admitted |
| `e2e:vetting:neg:no-ticket`, `:other-community`, `:two-statements`, `:revoked-grant`                                                 | the refusal and its on-screen message                                            |
| later: statement too old, withdrawal after admission, inconsistent identities, community unreachable, parties on different mediators |                                                                                  |


QR payloads are injected by deep link on simulators; camera scanning is proven on the P7 devices. Existing harness constraints carry over: a VTA's default port collides with WebDriverAgent's, Metro must belong to the worktree under test, and `app/.env` is baked at build.

---



## 9. Requests to upstream

Collected as they arise and sent together after P6, each with its evidence.

**Farm**

1. Vetting-capable service images selectable in a Farm session (§2.3).
2. A client-generic enrolment contract replacing the copy-and-paste of DIDs: the console issues a short-lived, single-use, session-bound enrolment link rendered as a QR; the client posts its admin `did:key` with proof of possession; the console shows the key's fingerprint and the logged-in user confirms before the grant is written. Terminal clients use the same link; Keyring scans it.
3. Whether a VTA may carry one admin grant per device, and hold a hardware-bound key.

**Vetting**
4. Whether a headless vetter mode (the P3 binary's behaviour) is wanted in the terminal client itself, for scripted community rehearsals.
5. Whether a TypeScript port of the applicant-side card, statement and match-code logic belongs in `pnm-core`.
6. Every divergence P2 finds between the documentation and the running services.

**React Native portability of** `pnm-core`
7. A route to the transport-agnostic core that does not pull `didwebvh-ts`'s `node:fs` references.
8. A policy parameter on the `did:webvh` host guard, matching the one mediator and VTA endpoints already take.
9. A release of `@openvtc/vti-tsp-js` carrying the pluggable signing and key-agreement seam.

---

