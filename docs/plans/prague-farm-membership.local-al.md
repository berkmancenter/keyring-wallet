# Prague on a local VTI stack — Keyring as a PNM, vetted into a community

**Status:** DRAFT v2, private — public version in review as PR #53 (`.local-al` — not for commit as-is). All clarifying questions answered 2026-09-15 (§0). When the work starts landing, the public-safe parts are carved into a subtask of [`keyring-on-the-vta-farm.md`](./keyring-on-the-vta-farm.md) with a dated companion; this file cites private material (Glenn's *Vetting Dry Run* PDF, Signal threads, the vta-browser-plugin learning journey) that must never reach a public doc.
**Plan worktree:** `~/Documents/keyring-plan-prague-membership`, branch `plan/prague-farm-membership` (off `origin/main` a45364a). Docs only.
**Implementation worktree (to create, P0):** `~/Documents/keyring-farm-membership`, branch `feat/prague-farm-membership` in root + bifold, stacked on a signed checkpoint of `feat/credo-0.7` (the DIDComm v2 + TSP-over-v2 line in `~/Documents/keyring-credo-0.7`).
**Inputs:** [`keyring-on-the-vta-farm.md`](./keyring-on-the-vta-farm.md) (L0–L3, F0–F4) · [`openvtc-integration-plan/pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) (P0–P6) · `didcomm_v2_subtask.md` (uncommitted, main checkout) · Glenn's **Vetting Dry Run** (PDF, 2026-09-14 revision) · vta-browser-plugin `FINDINGS.md` F1–F12 · Zero to Wallet rev 5 (learning record, recovered copy in [`prague-farm-membership.local-al/`](./prague-farm-membership.local-al/)).
**Snapshots read 2026-09-15:** VTI `origin/main ed204d20` (vta-service 0.27.0, vtc-service 0.11.58, vta-sdk 0.38; no `VTI-*` tag after Dogwood-R1) · openvtc `89af6b6` · dtgwg-trust-tasks-tf `6e667c1d` · vta-browser-plugin `21b0465` (pnm-core 0.9.1) · ic3software/vtafarm `04fde81`, vtafarm-api `a3b8e52`, vtafarm-k8s `ded23a2` · farm GHCR images (newest `vta:0.24.1-0af2cce7`, 2026-09-09).

---

## 0. Decisions (Alberto, 2026-09-15)

**Scope and client**
1. **Keyring is the only client, and it becomes a PNM.** No reference app; Zero to Wallet stays a learning record. Keyring consumes the vta-browser-plugin packages (`@openvtc/pnm-core`, `@openvtc/vti-tsp-js`) inside bifold, over the DIDComm v2 / TSP line. Credo PR #2704 snapshot is acceptable.
2. **Membership (D1) and vetting applicant (D2) together**, reproducing Glenn's *Vetting Dry Run* as closely as possible. Keyring = **Alice**. Community choice for Prague is reviewed later.
3. **Goal:** e2e on both platforms + one real-device run on the VTA side. Keyring's existing VRC/witness flows join later.

**Environment**
4. **No local farm.** A **plain local VTI stack** — config-identical to what the farm deploys — on **latest upstream, at minimum latest stable**. The runbook's versions and VTI `origin/main` coincide today.
5. **Tests run at every step**: upstream's own suites first, then Keyring's gates, then e2e.
6. **ngrok** (paid Hobbyist account, ~10 dev domains): one dev domain per public service. `keyring-local-witness.ngrok.app` is left untouched.
7. `external/` pins added for openvtc, vtafarm, vtafarm-api (and affinidi-webvh-service). A **headless vetter** rung on `openvtc-core` is approved. Checkpoint commits on `feat/credo-0.7` + new worktree approved (the other session is inactive). Simulators free to use; **both platforms required**.
8. Admin side is **`cnm` CLI + REST** (console not required).
9. Oracle run: **I drive both `openvtc` profiles** (tmux).

**Keys**
10. **Persona and join-DID keys follow upstream** (held by the VTA). The phone's own agent-admin key: **software first, hardware as the target**.

**Real devices**
11. **Local stack first**, official prod farm after coordinating with Geoff. iOS real device = **an iPad**; **Brendan runs the Android real device**. The Galaxy A03s is not used.

**UI/UX** (§7 carries the spec)
12. **"My Agent" top-level tab** with sections (agent, communities, applications). **Wording = Glenn's doc** (vetter, ticket, application, card, statement, match code). **One scanner** where the code allows. **Pull-to-refresh** for pending (push later). **Existing Keyring branding** on membership cards. **Friendly refusal messages with upstream detail expandable. Full-screen match code. Biometric at every signing act.** Legal-name source: evaluate R-Card vs explicit field — recommendation in §7.4.

**Process**
13. **Farm fork prototype and Geoff conversation after it works locally.** Keep a running **asks list** (§9). **Security finding held — not reported yet, remembered** (§9.0).
14. e2e negatives: **cheap four first** (§8). Offering our headless vetter as openvtc's missing `vetting_e2e.rs`: **on the asks list**.

**Round 4 (same day):**
15. **Public plan for review:** `docs/plans/keyring-on-the-vta-farm/community_vetting_subtask.md` + `2026-09-15-al.md` (commit `285267a`, branch `plan/prague-farm-membership`) — generic, no names or conversations, no runbook, no security finding. This private file stays the working copy with the private context.
16. **TSP Rev 3** (`docs.fpp.storm.ws/tsp-rev3-migration.html`) is coming from upstream: HPKE-Auth removed → HPKE-Base only, CESR codes/layout/digest/routing all change, hard cutover, upstream `main` stays Rev 2 until the reference SDK releases. Account for it: the vetting path must not depend on TSP; fixtures record TSP revision; Keyring's Rev 2 TSP work (ref-00…04, ref-03 HPKE-Auth vector, credo-tsp-adapter, TSP-over-v2 on credo-0.7) migrates later under the parent plan. Public subtask §3.6.
17. **Client-side vetting (CLI/TUI) is not finished upstream** — expect another iteration from the team member working that side before P6 is final. Public subtask §3.5 (conditional design).
19. **PR [#53](https://github.com/berkmancenter/keyring-wallet/pull/53) opened 2026-09-15** against `main`, reviewer bmiller59 — commits `c316fde` (subtask + companion F1–F10 + parent pointers; runbook content as §3.8, six ngrok dev domains per developer in §4, screens S1–S13 in §7.1) and `26f4122` (status + plans index). The runbook PDF itself is **not** committed (content only) — pending Alberto's call. Review feedback lands in a dated companion per `docs/plans/CLAUDE.md`; this private file mirrors decisions only.
18. **Correction:** upstream added `openvtc-core/tests/vetting_e2e.rs` (openvtc #322, 09-14) — the "missing vetting e2e" gap in §2 is closed. Headless Bob starts from its setup; the asks-list item becomes "a headless vetter mode in the terminal client".

---

## 1. The situation, in one screen

| | Fact | Source |
|---|---|---|
| **Our date** | OSS Summit Europe, Prague, **2026-10-01** | `consolidation-prague` |
| **Upstream's date** | Vetting **V0 target 5 Oct 2026**, *"Prague, ahead of the Kernel Maintainer Summit on 8 Oct"*; Glenn: *"first customer with a fixed date of October 5th"* | openvtc `docs/design/vetting-process.md:5,1505-1509`; Week 37 report |
| **Audience** | Kernel maintainers on the **TUI/CLI** (`openvtc`, `pnm`, `cnm`). Keyring is the normie UI on the same stack | Alberto |
| **What upstream ships** | Vetting ceremony: vetter tickets (QR / `XXXX-XXXX`) → session with read-aloud match code → Vetting Card (R-Card profile) → Vetting Statement (`EndorsementCredential`) → join submit → verdict → VMC + role VEC → reciprocal VMC | runbook; VTI `docs/03-vtc/vetting.md` |
| **Spec churn** | *"The specs are going to continue to get a lot of changes … deliberate by design"*; signing now on for every Trust Task; replies must be signed and are checked; host guards refuse non-public addresses and redirects | Week 37 report |
| **Farm images** | Newest selectable `vta:0.24.1-0af2cce7` (09-09) **predates vetting** (#1425, #1430, #1439). The prod farm cannot run the runbook until newer images ship | GHCR tags, VTI ancestry check |
| **Keyring today** | No VTA client, enrolment, join, consent/step-up or vetting. DIDComm v2 + TSP-over-v2 green on simulators but **uncommitted** (34 root + 65 bifold files) | Keyring survey |
| **pnm-core 0.9.1** | Targets vta-sdk 0.38 (matches the runbook). Has member-side join (`vtc/membership.ts`), persona disclosure + step-up, onboarding swap-key, consent view model. **No vetting client** (catalog only). F1 `node:fs` chain reaches 22/25 subpaths | plugin delta |
| **Vetting client code** | Rust only: `openvtc-core/src/vetting/{applicant,vetter,tickets,wire,…}.rs`, `vta_sdk::vetting`. No JS/TS | openvtc, VTI |

**The read.** Upstream's Prague deliverable is kernel vetting through a terminal. Keyring shows **the same ceremony on a phone**, as Alice, against a local stack built from the same commits — and every place the phone path needs something upstream does not provide becomes an evidenced ask.

---

## 2. The runbook — *Vetting Dry Run*

Source: `Vetting_Dry_Run.pdf` from Glenn (private — never cite publicly; cite the public docs it names instead). Header: **design `docs/design/vetting-process.md` §4 · vtc-service 0.11.58 · vta-service 0.27.0 · vta-sdk 0.38 with the `vetting` feature · actors admin, alice (applicant), bob (vetter)**. Revised 14 Sep 2026 for VTI #1465/#1467 (console authoring), #1471 (join dry-run vetting inputs), #1472 (Flow view) — all on VTI `origin/main` (`ed204d20`, vta-service still 0.27.0). So *latest upstream* and *the runbook's versions* coincide today: build VTI `origin/main`, record the SHA.

**Topology it requires (most failures are topology, not protocol):**
- Bob is already a member; Alice is not. **Two VTAs** (one per person; `device/register` refuses a re-claim) + the community's VTC. `openvtc -p alice` / `-p bob` profiles on one machine is fine.
- **Both personas on the same mediator** for the first run (cross-mediator anon-crypt reply has a known `session_mismatch` refusal — a later variant).
- **Alice needs a persona face carrying `name.legal` with a readable value** (predicate-only release is refused).
- Preflight `openvtc -p <x> health` on both.

**Steps:**

| # | Who | What | Expect |
|---|---|---|---|
| 00 | admin | Dry-run the join verdict (console Ceremonies → Join → Flow, vetting = requirements met) | `ADMIT · as member`; if `REFER`, re-upload + **activate** `vtc-service/policies/default/join.rego` |
| 01 | admin | Register statement type: `POST /v1/endorsement-types` (`spec/vtc/endorsement-types/…`) `{typeUri: https://firstperson.network/endorsements/identity-vetting/…}` | — |
| 02 | admin | Publish criterion: `POST /v1/schemas/accepts` `{id: "vetted-member", query: {credentials: [{format: ldp_vc, meta: {type_values: ["EndorsementCredential"]}}]}, vetting: {version: "0.1", statementType, minStatements: 1, acceptedMethods: ["inPerson","video"], requiredClaims: ["name.legal"], maxStatementAge: "P120D", eligibleVetters: {role: "vetter"}, independence: {requireConsistentIdentityCommitment: true}}}`; disable any criterion admitting without vetting | route refuses unsatisfiable requirements (`minStatements: 0`, `P4M`, unregistered type) |
| 03 | admin | Confirm: `GET /v1/schemas/accepts` + `vtc/join-requests/manifest/0.2` | criterion carries `vetting` + `requirementsDigest`; `manifest/0.1` unchanged |
| 04 | admin | `cnm vetting vetters grant did:webvh:…:bob --validity 180d` (or `POST /v1/vetting/vetters`, `vtc/vetting/vetters/grant/0.1`) | `cnm vetting vetters list` → `live: true, origin: manual`; audit `VetterGranted` + `VecIssued` |
| 05 | bob | Role VEC arrives over `credential-exchange/issue` (offline → `cnm vetting vetters resend <memberDid>`) | Bob holds `CommunityRole: vetter` VEC with `credentialStatus` |
| 06 | bob | New ticket (defaults: one use, 14 days) → `vetting-ticket:` link / `XXXX-XXXX` code, drawn as QR | — |
| 07 | alice | Start application (**join DID chosen/minted here**), choose face, refresh requirements, request vetter by pasting ticket link (other-community link refused before sending) | Bob's desk: `Accepted` automatically; Alice: *named a vetter until … not revoked when checked on …* |
| 08 | bob | Open session → both show `XXXX-XXXX` match code (tag `vetting-session-match/v1`), read aloud | code differs from a personhood code for the same id |
| 09 | alice | Review card = disclosure preview; confirm; `stepUpRequired` leaves preview intact → approve on device → present again; card signed as join persona DID | Bob: `CardReceived`, card verifies against challenge/audience/community |
| 10 | bob | Check human, attest: `name.legal` verified, documentation, liveness; never automatic | signed statement issued to Alice; her client verifies it against her own card before storing |
| 11 | alice | Checklist 1 of 1 → submit (statement in VP, `requirementsDigest` in `extensions`) | `allow` → VMC + role VEC → reciprocal VMC; admin decision records vetting facts + requirements version |

**Negative cases (e2e candidates):** ask with no ticket (5 bad codes/hour silently drops sender); ticket from another community (client refuses); raise to 2 statements → `request_more` with `vetting:statements:1`; statement past `maxStatementAge`; revoke grant before submit (`cnm vetting vetters revoke <endorsementId>`); withdraw after admission (`cnm vetting revocations` → `needsReview`); two vetters with differing `name.legal` → `refer` to `vetting-review`; stop the VTC mid-question (30 s → *unanswered*, distinguish unreachable vs auth-rejected vs contract-mismatch); Bob on a second mediator.

**Upstream's stated gap:** `openvtc-core/tests/` has **no vetting end-to-end** (only unit tests in `openvtc-core/src/vetting/tests.rs`; server side is `vtc-service/tests/vetting_journey.rs`). A MockVta-backed `vetting_e2e.rs` "mirroring phase 3" is missing — our headless vetter harness is close to that, which makes it a natural contribution.

**Keyring's role = Alice.** Bob = headless vetter built on `openvtc-core::vetting` (upstream's own client code, so Keyring is tested against the ecosystem rather than against itself). Admin = `cnm` + REST.


### 2.1 Local stack that reproduces it

| Service | Source (latest upstream, SHA recorded at build) | Instances | Public hostname (ngrok dev domain) |
|---|---|---|---|
| `vta-service` (`vetting`, `tsp`, `webvh` features) | VTI `origin/main` | 3 — community host, alice, bob | one each |
| `vtc-service` (default features incl. `tsp`, `admin-ui`) | VTI `origin/main` | 1 | one |
| Mediator | Affinidi messaging mediator, latest release (what `e2e/lib/mediator.js` runs) | 1, shared (runbook: same mediator first) | one |
| DID hosting | `affinidi/affinidi-webvh-service`, latest | 1 | one |
| `cnm`, `pnm`, `openvtc` CLIs | VTI / openvtc `origin/main` | — | — |

- **Built natively on arm64.** The prebuilt `download.firstperson.dev` server binaries are Linux x86-64 only; GHCR images would run emulated.
- **Only public HTTPS hostnames.** VTI #1448 and the plugin's egress guards refuse `did:webvh` on localhost/private hosts, and `did:webvh` resolvers reject plain HTTP. Six dev domains of the ~10 available; persistent across restarts, so DIDs survive.
- **Config reference = the farm's templates** (`vtafarm-api/internal/setup/templates*.go`, `templates_fullstack.go`, `templates_vtc.go`), so "works locally" transfers to the farm.
- **Headless setup, upstream's own shape:** `vtc setup --setup-key-out` → `pnm contexts create … --admin-did` → `vtc setup --from <toml>` (VTI `docs/03-vtc/non-interactive-setup.md`); mediator and did-hosting use the same `--setup-key-out` two-phase pattern.
- **Lives in the implementation worktree** as `scripts/openvtc/local-vti-stack/` (build, setup recipes, ngrok config, start/stop, health) and is driven by e2e through `e2e/lib/vti-stack.js`, reusing `e2e/lib/vta.js` and `e2e/lib/mediator.js`.

---

## 3. Protocol ground truth

All task URIs are `https://trusttasks.org/spec/<slug>/<ver>`. The dev guide's `trusttasks.org/openvtc/vtc/join-requests/submit/1.0` is stale (answers farm plan §9 Q3).

### 3.1 Membership ceremony (`ceremonies/vtc/member-onboarding/0.1`)

| Step | Task | Direction |
|---|---|---|
| discover | `vtc/join-requests/manifest/0.2` (+ `vetting`, `branding`, `requirementsDigest`) | applicant → VTC |
| apply | `vtc/join-requests/submit/0.2` — applicant is the proof signer; `{vp, registryConsent, extensions}` → `{requestId, verdict.effect ∈ allow\|deny\|refer\|requestMore}` | applicant → VTC |
| acknowledge | `vtc/join-requests/submit-receipt/0.1` | VTC → applicant |
| poll | `vtc/join-requests/status/0.1` | applicant → VTC |
| deliver | `credential-exchange/issue` **authcrypt to the holder's mediator**, best-effort: `MembershipCredential` (VMC, 30 d, BitstringStatusList, `eddsa-jcs-2022`) + role `EndorsementCredential` (VEC) | VTC → applicant |
| reciprocate | `vtc/members/request-vmc/0.1` → `vtc/members/vmc/0.1 {vc, requestId}` (`credentialSubject.id = communityDid`) | VTC ↔ member |

Membership lives under a **persona `did:webvh` minted by the member's VTA**, one per community; persona minting needs the VTA to advertise DID hosting. Inbound delivery arrives over the mediator, so **the client needs a live mediator session** — polling alone cannot finish the ceremony.

### 3.2 Vetting — applicant side (runbook steps 07, 09, 11)

- **Ticket:** `vetting-ticket:?v=1&community=…&vetter=…&ticket=…&secret=…` or `XXXX-XXXX` (VTI `vetting.md:228-237`); a ticket for another community is refused client-side before sending.
- **Request:** `vetting/request/0.1` peer-to-peer to the vetter `{community, requirementsDigest, joinDid, ticket, preferredMethod}`; verify the reply's `eligibilityVp` (vetter role VEC, `nonce` = request id, `domain` = `joinDid`, status list not revoked).
- **Session:** `vetting/session/0.1` `{challenge, domain, method, requiredClaims}`; match code derived from the session id under tag `vetting-session-match/v1`.
- **Card:** `persona/disclosure/preview/1.0` → `persona/disclosure/present/1.0` (renderer `rcard`; `stepUpRequired` → approve on device → present the same preview again); VDS typed `["VerifiableDataStructure","RelationshipCard","VettingCard"]`, salted `identityCommitment`, audience = vetter, 15-minute validity, signed as the join persona.
- **Statement:** arrives as `credential-exchange/issue/0.1`; `EndorsementCredential`, `endorsement.type = https://firstperson.network/endorsements/identity-vetting/0.1`, `method ∈ {inPerson, video, priorAcquaintance}`; **verified against Alice's own card before storing**. Or `vetting/decline/0.1`.
- **Submit:** `submit/0.2` with the statement(s) in the VP and `requirementsDigest` in `extensions`.

**Why this is the Keyring story.** The Vetting Card is an R-Card profile, and `method: inPerson` + `livenessConfirmed` is what Keyring's witnessed, locality-proven, hardware-attested exchange evidences. Upstream V0 signs client-side and treats step-up as a client confirmation (openvtc D19) — the slot where Keyring's attestation is strictly stronger. That is D3 (Keyring as vetter), after Prague's core.

---

## 4. What we demonstrate

| # | Shape | Status |
|---|---|---|
| **Core** | Keyring as Alice runs the whole runbook: connect **My Agent** by QR → application → scan Bob's ticket → match code → card → statement → submit → **admitted**, membership card on the phone, reciprocal VMC sent | the target |
| Plain join | The same client with the community criterion set to *vetting not required* (runbook step 00's bypass) — proves D1 on its own and is the fallback if vetting slips | falls out of P5 |
| D3 | Keyring as vetter, statements backed by witness + attestation | after Prague |

---

## 5. Architecture — Keyring as a PNM

**Module.** A new bifold package, `bifold/packages/vti-client` (the shape `pnm_cnm_subtask.md` §3 names), wrapping `@openvtc/pnm-core` behind a tsyringe DI token, with RN implementations of its platform seams. The app gets a `My Agent` stack; nothing in the VRC/witness modules changes.

**Transport.** Trust Task documents are byte-identical across REST / DIDComm / TSP (`pnm_cnm_subtask.md` §2.1). Keyring carries them over what the `feat/credo-0.7` line already proved — Credo DIDComm v2 and TSP-over-v2 — plus the Credo transport to the VTI mediator proven in Node by `ref-18` (ATM login, one socket per DID, Pickup 3.0, TSP demux). pnm-core's own channels are the fallback wherever the Credo path does not reach; which of the two carries each leg is **decided by measurement in P4**, not assumed. TSP frames use the binding envelope `{"type":"https://trusttasks.org/binding/tsp/0.1/envelope","document":…}` (plugin `8073471`, hard cutover).

**Versions.** Client and stack move together: VTI `origin/main` ↔ pnm-core `main`/0.9.1 (vta-sdk 0.38 on both sides). Never pnm-core **0.9.0** (partial tarball, `b379f2c`). Every advance goes through `scripts/openvtc/setup-external.mjs` / `PINS.json` with a logged reason.

**Keys.** Persona and join-DID keys stay on the VTA (upstream). The phone's agent-admin `did:key` is software Ed25519 first; the hardware target is decided in P4 from a measurement: (a) whether the VTA accepts a P-256 `did:key` (Secure Enclave), (b) StrongBox Ed25519 (Android API 33+), (c) software Ed25519 wrapped by a hardware key. The tsp-js pluggable `SigningKey` seam (our PR #233) is the hook; it is unreleased on npm (F12).

**RN shim set** (measured at plugin `21b0465`): `node:fs`/`fs` → empty module (Metro already aliases Node modules via `polyfillModules`); `crypto.subtle` AES-KW / AES-CBC / HMAC / HKDF / SHA-256 (react-native-quick-crypto) unless every leg is TSP; `getRandomValues` / `randomUUID`; `AbortSignal.timeout` (unguarded at `http/timeout-fetch.ts:40`); `structuredClone`; a KVStore adapter over Keyring's storage; Metro package exports (already on); and RN fetch vs `redirect:"manual"` (F11 — measure). Dev builds pass `netPolicy: {allowInsecure, allowPrivate}` only where needed; the webvh host guard has no opt-out (F10), which the ngrok hostnames satisfy.

**`did:webvh`.** The app already registers `WebVhDidResolver` from `@credo-ts/webvh` (`app/src/utils/bc-agent-modules.ts:34,177`; `bifold/packages/core/src/utils/agent.ts:26,155`). P4 measures it on Hermes against the stack's real DIDs, with a tamper fixture, before anything else is built on it.

---

## 6. Phases — each with its test gate

Dates are targets against 2026-10-01. A red gate stops the next phase.

### P0 — Worktree, checkpoint, pins (09-15 → 09-16)

1. In `~/Documents/keyring-credo-0.7`: signed checkpoint commits on `feat/credo-0.7` in bifold (`Signed-off-by: Alberto`, last line, no agent trailer) and root (bifold pointer + root changes). Push only when asked.
2. `git worktree add ~/Documents/keyring-farm-membership -b feat/prague-farm-membership feat/credo-0.7` (root) and the matching bifold branch.
3. Pins: add `OpenVTC/openvtc`, `ic3software/vtafarm`, `ic3software/vtafarm-api`, `affinidi/affinidi-webvh-service` to `setup-external.mjs`; advance VTI and vta-browser-plugin pins to the SHAs in the header with reasons.

**Gate:** in the new worktree, `yarn lint`, `yarn typecheck`, `yarn test` and `cd bifold/packages/core && yarn test` green — the checkpoint is proven intact before anything is added.

### P1 — Local VTI stack (09-16 → 09-17)

Build (§2.1), reserve six ngrok dev domains, provision the community VTA + VTC headlessly, alice and bob VTAs, shared mediator, DID host.

**Gate:** upstream first — `cargo test -p vtc-service --test vetting_journey` and the touched crates' `cargo test` green at the built SHA; every DID resolves over its ngrok hostname; `pnm health` green for all three VTAs; `openvtc -p alice health` and `-p bob health` report the negotiated transport per pair.

### P2 — Oracle run, runbook as written (09-17 → 09-18)

Admin steps 00–05 via `cnm` + REST; Bob admitted first (he must already be a member); phase 3 steps 06–11 with two `openvtc` profiles driven through tmux. Capture every task document and reply as frozen fixtures. Then the cheap four negatives.

**Gate:** every EXPECT box in §2 observed and recorded; fixtures committed under `tsp-reference/ref-20-local-vetting-oracle/fixtures/`; anything that diverged from the runbook written to the asks list with evidence.

### P3 — Headless Bob (09-18 → 09-19)

`tsp-reference/ref-21-headless-vetter/`: a small Rust binary on `openvtc-core::vetting::vetter` that grants nothing itself, answers requests with its ticket, opens a session, prints the match code, and attests a configured `name.legal` — **only after** the match code is confirmed by the harness (keeps runbook step 10's refusal semantics).

**Gate:** P2's phase 3 re-run with headless Bob + TUI Alice, same fixtures shape; its README states which refusals it preserves.

### P4 — Keyring connects to its agent (09-19 → 09-22)

`vti-client` package; `did:webvh` measured on Hermes; enrolment by **QR** against a local **enrol shim** (`e2e/lib/farm-shim.js`: the client-generic contract of §9.2 over `vta import-did` + `acl/swap-key`); authenticated session; agent health; persona list; mediator session with persist-before-ack.

**Gate:** jest unit tests for the package (seams, KVStore adapter, fixture byte-equality against P2's documents); `e2e:agent:connect` green on **Android emulator and iOS simulator**.

### P5 — Keyring joins a community (09-22 → 09-24)

Manifest 0.2 → submit 0.2 → receipt → VMC + VEC delivered → reciprocal VMC, against a community criterion with vetting *not required*.

**Gate:** `e2e:community:join` green on both platforms; the membership card renders from the stored VMC; `cnm` shows Alice as a member.

### P6 — Keyring as the vetting applicant (09-24 → 09-27)

Runbook steps 07, 09, 11 in Keyring against headless Bob: application (join DID minted), ticket scan, match code, card review + signing (with `stepUpRequired` retry), statement verification against the card, checklist, submit, admitted.

**Gate:** `e2e:vetting:applicant` green on both platforms; the cheap four negatives as `e2e:vetting:neg:*` green.

### P7 — Real devices on the local stack (09-28 → 09-29)

iPad as Alice (attended, Metro logs captured, screen streaming off); Brendan runs Android on a real device with the same stack hostnames.

**Gate:** one attended run each, markers recorded; any device-only failure has a named cause.

### P8 — Farm (after P6, and after talking to Geoff)

Send the asks list; prototype QR enrolment on `Mickens-Lab/vtafarm` + a new `Mickens-Lab/vtafarm-api` fork against the contract P4 already exercises; run on the official prod farm once vetting-capable images are selectable.

**Gate:** fork unit tests (token single-use, expiry, session binding, proof failure, confirm gate); one attended prod-farm run.

---

## 7. UI/UX spec

### 7.1 My Agent tab

Top-level tab, three sections on one screen:
- **Agent** — connected / not connected; name and host (the DID shown with the host lifted, never a name derived from the DID); health (mediator, transport in use); "Connect my agent" when absent.
- **Communities** — one row per community: *Member* (membership card), *Applying* (application row), *Pending review* (pull to refresh).
- **Applications** — each vetting application with its checklist (*1 of 1 statements*) and its next action.

Membership cards use the existing Keyring credential card with the community name from `manifest/0.2`'s branding as text.

### 7.2 One scanner, routed by payload

The existing Keyring scanner dispatches on what it reads: agent enrolment payload → Connect flow; `vetting-ticket:` link → Application flow (or "start an application first"); existing relationship invitations → unchanged. A `XXXX-XXXX` ticket code gets a typed-entry fallback. Where the code makes one scanner awkward, the flows keep separate entry points rather than a clever router — easy first.

### 7.3 Application flow, in Glenn's words

1. **Start application** — choose the community (from a scanned ticket or the manifest); the join DID is minted here; a face is chosen (§7.4).
2. **Requirements** — the community's requirements in sentences, as `manifest/0.2` states them.
3. **Request a vetter** — scan or paste the **ticket**; Keyring shows *named a vetter until … not revoked when checked on …*.
4. **Session** — full-screen **match code** `XXXX-XXXX`: "Read this to your vetter. Their screen shows the same code." Nothing proceeds until the vetter opens the session.
5. **Review card** — the disclosure preview exactly as the vetter will see it; **Face ID / fingerprint to sign**; on `stepUpRequired`, approve and the same preview is presented again.
6. **Statement** — "Bob vetted you — in person, legal name verified"; stored only after it verifies against the card.
7. **Submit** — checklist *meets the published requirements* → Face ID / fingerprint → *Pending review* (pull to refresh) or **Admitted**, then the reciprocal membership credential is sent (biometric again: every signing act).

### 7.4 Legal name — recommendation

A vetter compares `name.legal` to a document, and two statements with different values are sent to the `vetting-review` queue (runbook negative case), so the value must be **exact and stable**. An R-Card name is a display name and may be a nickname. Therefore: at *Start application*, ask **"Your legal name, exactly as on your ID"**, **pre-filled from the R-Card name when one exists**, with an explicit confirm; store it on the VTA in a dedicated vetting face, marked sensitive (hidden behind **Show**, as upstream does); Keyring keeps no second copy; editing it after a statement exists warns that existing statements will no longer match.

### 7.5 Refusals

Friendly sentence + an expandable **Details** block with the upstream code and message. Mapped at minimum: no ticket / bad code (and the silent drop after five bad codes an hour), ticket for another community, `request_more` with its needs (`vetting:statements:<n>`), `refer`, statement too old, vetter grant revoked, and "community unreachable" vs "refused" vs "contract mismatch" after 30 s — never a hang.

---

## 8. e2e

New runners in `e2e/` (standalone package), reusing `lib/driver.js`, `lib/flows.js`, `lib/vta.js`, `lib/mediator.js`, plus new `lib/vti-stack.js`, `lib/farm-shim.js`, `lib/headless-vetter.js`.

| Script | Alice | Counterparty | Asserts |
|---|---|---|---|
| `e2e:agent:connect` | one run on Android emu, one on iOS sim | local stack + enrol shim | enrol, swap-key, health, persona list |
| `e2e:community:join` | same matrix | VTC criterion without vetting | submit → receipt → VMC/VEC → reciprocal VMC |
| `e2e:vetting:applicant` | same matrix | headless Bob, `cnm` admin | runbook 06–11 markers, same EXPECTs as §2 |
| `e2e:vetting:neg:no-ticket` · `:other-community` · `:two-statements` · `:revoked-grant` | same matrix | as above | the refusal and its UI message |
| later: `:too-old` · `:withdraw-after` · `:two-identities` · `:vtc-down` · `:second-mediator` | | | |

- **QR on simulators:** payloads are injected by deep link (`adb shell am start -d …`, `xcrun simctl openurl`); camera scanning is proven on the iPad run.
- **Carried constraints:** `WDA_LOCAL_PORT=8101` (a VTA binds 8100 locally), `APPIUM_PORT=4750` on API-36 AVDs, iOS marker capture via `log stream` (on the credo-0.7 line), Metro must belong to the worktree under test, `app/.env` is baked at build, Metro logs captured on every run.
- **Stack reuse:** the ngrok dev domains are stable, so a run reuses a provisioned stack; a `--fresh` flag re-provisions.

---

## 9. Asks list — Geoff and Glenn (running; send after P6)

### 9.0 Held — raise privately with Geoff when the conversation starts
`vtafarm-api` `internal/k8s/setup_jobs.go:239` builds `vta import-did --did %s --role admin` with the admin DID unquoted; `internal/handler/setup.go:1167-1172` binds the field with no validation (`full_stack` and the platform grant quote correctly). Verified by reading 2026-09-15; impact not assessed. Never in a public issue or PR description.

### 9.1 Geoff — farm
1. **Vetting-capable images** selectable on the farm (newest today `vta:0.24.1-0af2cce7` predates #1425/#1430/#1439).
2. **Client-generic QR enrolment** (9.2), TUI-first, with our fork prototype as evidence.
3. `beta_access` (full stack → own VTC) on Alberto's account.
4. Second device per VTA (one ACL entry per device) and hardware-held keys — confirm both are fine.
5. Whatever P1 shows the farm's templates do differently from what the runbook needs.

### 9.2 The enrolment contract to propose
Console → `POST /api/v1/setup/:id/pnm-enrollment` → QR/link `{v, farm, vta_did, vta_url, mediator_did, enroll_url, expires_at}` (DB-backed, hashed single-use token, 5–10 min, bound to session + user). Client → `POST /api/v1/pnm-enroll/:token {admin_did, label, proof}` (Ed25519 proof of possession over `{token, vta_did, aud}`); `GET …/status` for cookie-less clients; **console confirm step** showing the key fingerprint before the ACL write (the only defence against an intercepted QR). `pnm setup` accepts the same link; `pnm` can print its `did:key` as a terminal QR. Plain JSON payload, no universal links.

### 9.3 Glenn — vetting
6. Offer our headless vetter as the missing MockVta-backed `openvtc-core/tests/vetting_e2e.rs`.
7. Whether a TS port of `vta_sdk::vetting::{card, statement, match_code, ticket_uri}` belongs in pnm-core (we need it either way).
8. A phone applicant at the kernel table in Prague — welcome, and which community.
9. Anything P2 finds where the runbook and the daemon disagree.

### 9.4 vta-browser-plugin (RN portability, `FINDINGS.md`)
F1 (`node:fs` chain, widened), F2 (no transport-agnostic entry), F10 (webvh host guard without `netPolicy`), F11 (`redirect:"manual"` on RN — once measured), F12 (key-custody seam unreleased), F9 (`generate:key` clobber). Opened only with Alberto's go-ahead.

---

## 10. Risks, in the order they bite

1. **Spec churn** — upstream is changing specs deliberately until 10-05; every advance re-runs P1's gate and the P2 fixtures diff.
2. **Transport on RN** — VTI mediator login/pickup is proven only in Node (`ref-18`); inbound delivery needs a live session.
3. **pnm-core on Hermes** — eight shims; F11 may weaken a security guarantee silently.
4. **Three services we have never run locally** (VTC, webvh host, three-VTA topology) — P1 is sized for surprises.
5. **Uncommitted base** — 99 files under the checkpoint; P0's gate is the guard.
6. **Farm images lag** — the prod-farm run may not be possible before Prague; the local stack is the demo environment if so.
7. **Attended-only steps** — real-device runs and the future console confirm step.

---

## 11. What this changes in `keyring-on-the-vta-farm.md` (for the eventual companion)

1. §9 Q3 answered: canonical `spec/vtc/join-requests/submit/0.2` + `manifest/0.2`.
2. L3 reframed: the kernel community's gate is **N Vetting Statements** under community policy, not two VRCs; the Vetting Card is an R-Card profile and `inPerson` is what witness + locality + attestation prove.
3. F1 likely shrinks to a Hermes measurement (resolver already registered).
4. §3.2 enrolment becomes a client-generic farm contract, TUI-first.
5. The Farm is the production target; a local VTI stack built from the same commits is the development and CI environment (replaces `ref-05` as the offline twin for this path).
6. Rung numbering: new rungs start at `ref-20` (`ref-16` and `ref-19` are taken).
7. §3.5 pins: trust-tasks 0.19.x, pnm-core 0.9.1, vti-didcomm-js 0.9.1.

## 12. Sources

- Runbook: *Vetting Dry Run* (Glenn Gore, PDF, revised 2026-09-14) — private.
- Vetting: openvtc @ 89af6b6 `docs/design/vetting-process.md`, `openvtc-core/src/vetting/`; VTI @ ed204d20 `docs/03-vtc/{vetting,community-lifecycle,credentials,non-interactive-setup}.md`, `vtc-service/tests/vetting_journey.rs`, `vtc-service/src/credentials/delivery.rs`; dtgwg-trust-tasks-tf @ 6e667c1d `ceremonies/vtc/member-onboarding/0.1`, `specs/vtc/join-requests/submit/0.2`, `specs/vtc/members/{request-vmc,vmc}/0.1`.
- Farm: vtafarm-api @ a3b8e52 (`internal/k8s/setup_jobs.go`, `internal/handler/setup.go`, `internal/setup/templates*.go`, `internal/model/user.go`, `docs/siop-login-design.md`); vtafarm @ 04fde81; vtafarm-k8s @ ded23a2; GHCR `ic3software/{vta,vtc,mediator,did-hosting-daemon}` tag lists (anonymous, 2026-09-15).
- Plugin: vta-browser-plugin @ 21b0465 (`packages/core/src/vtc/membership.ts`, `did/egress-guard.ts`, `vta/auth.ts`, `vta/tsp-binding.ts`, `task-surface.json`); `FINDINGS.md`.
- Ecosystem status: docs.fpp.storm.ws `week-37-openvtc-report.html`.
- Keyring: `docs/plans/keyring-on-the-vta-farm.md`, `pnm_cnm_subtask.md`, `didcomm_v2_subtask.md`, `tsp-reference/ref-06x`, `ref-08`, `ref-18`, `e2e/lib/*`.
- Private (never cite publicly): Signal threads 2026-09; Zero to Wallet rev 5.
