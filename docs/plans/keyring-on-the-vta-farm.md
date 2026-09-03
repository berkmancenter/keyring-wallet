# Keyring on the VTA Farm — the phone at every level of the developer path

**Status:** Proposal for review. Not a commitment to implement.
**Scope:** making Keyring a first-class client of a **Farm-hosted** Personal VTA, at every level of the developer path the ecosystem documents — provisioning, everyday operation, community membership — and making the React Native runtime a supported target of the ecosystem's own TypeScript libraries along the way. No change to the VRC/witness stack except where §6 says so.
**Siblings:** [`openvtc-integration-plan.md`](./openvtc-integration-plan.md) owns the transport and operation layers this plan stands on; its [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) owns the VTA client itself. [`reference-app-sdk-packaging.md`](./reference-app-sdk-packaging.md) owns what we hand a third-party developer. This plan owns only what changes when the VTA is **somebody else's managed service** rather than one we run.
**Reasoning:** [`2026-09-03-al.md`](./keyring-on-the-vta-farm/2026-09-03-al.md) — the measurements behind §3 and §4, the positions adopted, and what they supersede. This document states current design only; see [`CLAUDE.md`](./CLAUDE.md).
**Baseline:** upstream guides read from the pinned `vti-setup` clone at **22f712f** (2026-08-17), whose own header records the versions it was verified against: **VTA 0.17.0, Mediator 0.18.19, DID Hosting Daemon 0.8.3**. Package facts measured from the **npm registry on 2026-09-03** and reproducible with the commands in the companion. Every version below moves weekly — re-measure before acting, per [`scripts/openvtc/README.md`](../../scripts/openvtc/README.md).

**References:**

- **[[DEV-GUIDE]]** — `developer/` in `vti-setup`, upstream's own three-step path for a developer joining the ecosystem: `01-personal-vta.md` (Personal VTA, Path A/Path B), `02-openvtc-tui.md` (the everyday interface), `03-joining-a-community.md` (membership). Quoted throughout. Not vendored here — read it from the pinned clone after `node scripts/openvtc/setup-external.mjs`.
- **[[MOBILE-ARCH]]** — `docs/05-design-notes/mobile-agent-architecture.md` in the VTI repo; upstream's spec for porting the mobile agent to another runtime. Its invariants are adopted as acceptance criteria by [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) §4.1 and are not restated here.
- **[[HTTPS-BINDING]]** — Trust Tasks HTTPS binding, **0.1** at our pin (`bindings/https/0.1/spec.md`). See §3.5: the endpoint-discovery contract moved after the pin, and that movement is a gate on this plan.

---

## 1. What this plan is for, and why it is separate

The parent plan and its subtasks are organised **by layer** — transport, task layer, client module — and their evidence is a rung that runs on this machine. This plan is organised **by the path a person actually walks**, and it is the first one whose counterparty is infrastructure **we do not run**.

That difference is the whole reason it is a separate document, and it has three consequences the layer plans cannot absorb:

1. **The acceptance criterion becomes somebody else's service returning the right answer.** A frozen fixture cannot stand in for it. Every rung below `ref-16` proves that our bytes are correct; only a Farm-backed run proves that the ecosystem agrees.
2. **Every blocker resolves to a workaround or an upstream pull request — there is no third option.** We cannot patch a managed cluster. §7 is therefore not a nice-to-have appendix; it is the plan's other half.
3. **It is the only plan that can retire "works against our own VTA" as the standard of evidence.** `ref-05-local-vta` and `ref-06x-cypress-stack` both drive infrastructure we configured. Neither can detect a wrong assumption we and our own deployment happen to share.

**Framing, stated once.** *Keyring at every level* means the phone is a full participant at each level of [[DEV-GUIDE]], not a companion device to a laptop that does the real work. At levels L0–L2 Keyring is a **client** of the ecosystem. At level L3 it is a **producer** — the credential the community's join policy consumes is the credential Keyring's VRC module mints. That asymmetry is the strategic point of this plan and the reason it is worth doing in this order.

---

## 2. The levels

[[DEV-GUIDE]]'s `developer/README.md` states the path: *"Run a Personal VTA that holds your keys, drive it from the OpenVTC CLI/TUI, and present credentials when communities ask for them."* Three tutorials, in order. Each assumes a desktop: a browser with passkeys, a CLI, and a terminal UI.

| Level | Upstream's step | What it needs from a client | Keyring today | Keyring's target |
|---|---|---|---|---|
| **L0 — Provision** | `01-personal-vta.md` Path A: create a VTA in the Farm console, connect a local PNM, paste the temp DID back | Generate a `did:key`, surface it to a human, then hold an admin grant against a VTA addressed only by DID | Nothing — no VTA client exists in this repo | The phone displays its temp DID (QR + copy); the human pastes it into the Farm tab already open |
| **L1 — Operate** | `02-openvtc-tui.md`: bind the TUI to the VTA, create a persona DID, manage contexts | An authenticated VTA session; contexts; DID minting | Nothing | The wallet **is** the everyday interface — the TUI's job, on the device that already holds the keys |
| **L2 — Join** | `03-joining-a-community.md`: mint an M-DID, submit a join request through the public/join mediator, receive membership credentials | A second mediator leg, a per-community M-DID, and a VP assembled from held credentials | Nothing | Join from the phone, under a persona, with the M-DID separation the design requires |
| **L3 — Qualify** | The join policy's input: *"at least two valid VRCs whose issuers are both `Active` members"* | Hold — and ideally **issue** — VRCs | **This is our flagship, shipping and proven on devices**: witnessed, hardware-attested VRC exchange | The VRCs that gate membership are Keyring-minted, witnessed, and hardware-backed |
| **L4 — Fold back** | *(not an upstream step)* | — | — | Keyring is the ecosystem's React Native reference implementer; §7 is the deliverable |

**L3 is the level that makes the rest worth doing.** Everywhere else on this path Keyring is catching up to a CLI. At L3 the ecosystem's membership gate consumes exactly the artifact Keyring already produces better than anything else in the stack — and, on the two-VRC policy, produces it in the only form that scales to strangers: a peer-to-peer exchange between two people who met, witnessed, with hardware attestation of the devices involved.

**Conditional design, flagged at the approach rather than in a footnote.** The two-VRC policy is a *stated target*, not current behaviour. [[DEV-GUIDE]] `03-joining-a-community.md`: *"The **two-VRC** policy described below is the working target for the initial-days community and **is not what is currently active today**; it may be changed based on that community's requirements. The wire shape of a join request is the same either way."* L3's strategic argument therefore rests on a policy someone else controls (§9 Q2). L0–L2 do not depend on it, and the last sentence of that quote is why: the wire work is the same under either policy.

---

## 3. What the Farm changes, measured

### 3.1 It removes every piece of infrastructure a phone cannot supply

[[DEV-GUIDE]] `01-personal-vta.md` offers two paths and recommends one: *"**Path A — VTA Farm (streamlined, recommended)** — VTA Farm spins up your VTA in a managed Kubernetes cluster. You provision it from a browser with a passkey and connect your local PNM to it. **No server, no public domain, no DID hosting, no mediator wiring on your side.**"* And: *"If you're new to the stack, take Path A."*

Path B's prerequisites are precisely the things a wallet cannot do: an Ubuntu host, a public HTTPS origin serving `did.jsonl` (*"HTTPS is required. Plain HTTP is rejected by `did:webvh` resolvers"*), and a Community Mediator DID *"obtained from the operator of the mediator you intend to use"*.

**Position adopted.** The Farm is the target environment for this plan. Self-hosting remains the **CI environment** — see §8.

### 3.2 Enrolment collapses to a paste, and the operator is the user

[[DEV-GUIDE]] Path A, in full: the client is asked *"What would you like to do?: → **Connect to an existing non-TEE VTA**"*, prints

```text
vta import-did --did did:key:z6Mk... --role admin
```

and the human then *"Paste the **Temp DID** from A2 into the **Admin DID** input box. Click **Provision agent**. Wait for the **Agent is online** message."*

This does not remove the constraint [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) §6 P2 establishes — *"there is no self-service enrolment anywhere in the stack"*, `POST /auth/challenge` being ACL-gated before a nonce is minted. It **collapses** it. The out-of-band operator step is still there; it is a paste into a browser tab the same person already has open, and the Farm console is the operator console.

**Two consequences, and the second is the one that matters.**

- Of the three enrolment options that subtask enumerates, the Farm path **is** the first — operator grant — with the human as their own operator. Its "needs a human step" cost is the smallest it can be.
- The temp `did:key` is **generated by the client**. Nothing about the Admin DID box constrains where its private key lives. That resolves [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) §9 Q2 — *"does Keyring keep a Secure-Enclave-generated key, or adopt a VTA-minted one?"* — **in favour of hardware custody, on this path**, because the alternative (`provision-integration`, which hands the wallet a key generated off-device) is not the path the Farm asks for. Hardware attestation stays our differentiator without an argument.

### 3.3 The wallet needs no WebAuthn

[[DEV-GUIDE]] lists *"a computer with **passkey** support"* among Path A's prerequisites, which reads at first like a hard requirement on the client.

It is a requirement on the **Farm console**, not on the VTA session. Measured in the upstream TypeScript client: the REST bearer is obtained by `/auth/challenge` → **DIDComm authcrypt** → `/auth/` → token, and its module docstring says so plainly — *"Only the REST transport needs any of this — TSP and DIDComm are sender-authenticated by their envelope, so their channels carry no bearer."* Passkeys are a **separate task family** (`auth/passkey/login/{start,finish}/0.2`) reached through a different surface.

**Position adopted.** A React Native wallet authenticates to a Farm-hosted VTA with the same DID-based handshake as any other client. No WebAuthn substitute is needed on the wallet's session path, and none should be built. This supersedes the open question in [`reference-app-sdk-packaging/2026-09-01-al.md`](./reference-app-sdk-packaging/2026-09-01-al.md) §4 — see the companion.

### 3.4 `did:webvh` resolution stops being optional

On Path A the VTA is identified to the client by **DID alone** — the console displays a VTA DID, the client is given nothing else. Resolution is therefore on the critical path of every level, starting at L0.

Keyring cannot do it today: [`ref-06x-cypress-stack`](../../tsp-reference/ref-06x-cypress-stack/) measured Credo 0.6.3 returning `unsupportedDidMethod` for `did:webvh`, and proved a ~20-line wallet-side resolver adapter sufficient. That adapter is parent Phase D item 3. **This plan is what makes it urgent rather than eventual**, and §4 is the reason it is not simply "call the library".

### 3.5 The endpoint-discovery contract moved after our pin

At the pin, [[HTTPS-BINDING]] **0.1** §6 ("Discovery wiring") describes only Type-URI discovery over the same `POST /trust-tasks` endpoint; it defines **no DID-document service type** for locating that endpoint. The `TrustTaskHTTPS` service type — and the rule that the advertised `serviceEndpoint` is the Trust-Task base, with the request URL composed as `<base> + "/trust-tasks"` — are **post-pin**, appearing in the current upstream TypeScript client and attributed there to binding 0.2 §6.

Our pinned `dtgwg-trust-tasks-tf` clone is **68 commits behind `origin/main`**, and all four npm tripwires in [`PINS.json`](../../scripts/openvtc/PINS.json) have tripped: `@openvtc/trust-tasks` 0.9.0 → **0.16.8**, `@openvtc/pnm-core` 0.4.0 → **0.7.0**, `@openvtc/vti-didcomm-js` 0.6.2 → **0.7.0** (`@openvtc/vti-tsp-js` holds at 0.2.0).

**Consequence for phasing.** F0 opens with a pin advance and a bottom-up ladder re-run. Measuring the Farm against a view of the ecosystem two releases stale would only have to be redone, and the discovery contract is exactly the part that moved.

---

## 4. The dependency the Farm forces, and why choosing REST does not avoid it

Everything in §3 converges on `did:webvh` resolution, and in TypeScript that means `didwebvh-ts`. The chain below is measured from published artifacts on 2026-09-03; every step is reproducible from the npm registry with no clone and no account (commands in the companion).

```
@openvtc/pnm-core 0.7.0
  └─ @openvtc/vti-didcomm-js 0.7.0
       └─ didwebvh-ts ^2.7.4  →  2.8.0     ← every build references node:fs
```

**Four findings, in the order they constrain us.**

1. **`didwebvh-ts` already declares React Native a target — and points it at the build with the Node built-in in it.** Its `exports` map carries a `react-native` condition resolving to `./dist/cjs/index.cjs`, which contains `require("node:fs")` and `require("fs")` (lines 3075 and 3080). The browser and ESM builds reference `node:fs` too; the ESM build also references `node:module`. So RN is a *declared* target with nothing testing it.

2. **The `fs` access is lazy and guarded — the bundler is what breaks, not the runtime.** The loader is a function that tries several specifiers in sequence inside `try`/`catch` and throws only when actually called: *"Filesystem access is not available in this environment (unable to load fs)"*. Nothing on the resolution path needs a filesystem. But Metro resolves specifiers **statically**, so the bundle fails to build even though the code would never have executed that branch. This makes the fix cheap and the diagnosis misleading, which is a bad combination for anyone hitting it without this note.

3. **Choosing REST does not route around it.** `@openvtc/pnm-core` publishes **23 export subpaths, all directory-level, with no wildcard** — a deeper file cannot be imported. `dist/vta/index.js` re-exports `./didcomm.js` at line 6, so the barrel reaches the chain unconditionally; 18 of the 116 files under `dist/vta/` import `../didcomm`; and `dist/trust-tasks/verify.js` reaches it as well. There is no published path to the transport-agnostic core.

4. **Most of the coupling is unnecessary, and this is the cheapest thing anyone could fix.** `@openvtc/vti-didcomm-js` publishes **24 fine-grained subpaths**, and the ones that matter here — `./base64url`, `./multibase`, `./did-key` — are clean of `didwebvh-ts`. Inside `pnm-core`, **12 files import the barrel and none imports a subpath**; the imports they take are dominated by `base64url` (6), `multibase` (5) and `didKey` (2). Only the three `resolve`/`resolveMediator` sites genuinely need `did:webvh`. And even those need not be static: `vti-didcomm-js`'s `src/resolver.js` advertises itself as *"Pluggable: callers can pass their own map of `{ method: resolver }`"* via `createResolver(overrides)`, yet statically imports `./did-webvh.js` at line 18 — so a caller who overrides `webvh` still drags the dependency.

**What this adds up to, and it is the plan's contribution thesis.** Upstream's TypeScript core is *written* as a portable library and *packaged* as a browser application's internals. The seams are already in the right places — a pluggable resolver, fine-grained subpaths, a declared `react-native` condition — and each is undercut by one static import or one missing export. Fixing that is not a favour to Keyring; it is what makes the ecosystem's own library usable on the only runtime a wallet has. §7 carries the specific changes.

**Our side is ready for the shim either way.** `app/metro.config.js` already aliases Node-shaped modules (`stream` → `stream-browserify`, `buffer`) through `polyfillModules`, so a `node:fs` entry is an existing pattern rather than a new mechanism. That is the workaround; §7 is the fix.

---

## 5. The ladder against Farm infrastructure

**The Farm is a new backing environment for the existing ladder, not a new stack.** The workstream's standing rule already says what to do with a moved environment: *"When upstream moves (it will), we re-run the ladder bottom-up; the first red rung names the broken layer."* That rule is the method here, and it is why this plan adds only one rung rather than a parallel ladder.

| Rung | What changes under the Farm | Expected |
|---|---|---|
| [`ref-03*`](../../tsp-reference/ref-03-noble-crypto/) | nothing — crypto is environment-free | green |
| [`ref-04-mediator`](../../tsp-reference/ref-04-mediator/) | the mediator is the Farm's, not one we chose | green; records **which** mediator a Farm VTA is wired to |
| [`ref-05-local-vta`](../../tsp-reference/ref-05-local-vta/) | stays as-is — it becomes the **offline CI twin** of the Farm (§8) | green, unchanged |
| [`ref-06v1*`](../../tsp-reference/ref-06v1-didcomm-v1-binding/) | unchanged: wallet-to-wallet DIDComm v1 keeps our own mediator | green |
| [`ref-06x-cypress-stack`](../../tsp-reference/ref-06x-cypress-stack/) | re-pointed from a local release-binary VTA at a **Farm-hosted** one | the interesting one — its findings ledger is where §9 Q1 gets answered |
| [`ref-16-farm-membership`](#the-terminal-rung) | new | the terminal rung |

### The terminal rung

**`ref-16-farm-membership` — the whole path, against infrastructure we do not run.**

Numbering: the parent ladder reserves `ref-07…09` and [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) §6 takes `ref-10…15`, so `ref-16` is the next free (§9 Q5 records one collision to clean up).

**What it does.** A Farm-provisioned Personal VTA, enrolled from the phone (L0); a persona minted from it (L1); a join request submitted to a community under an M-DID (L2); and the request qualified by **two witnessed, hardware-attested VRCs that Keyring itself issued** (L3).

**Why it is deliberately last, and why it is one rung rather than four.** Every other rung isolates a layer, so a failure names its cause. This one cannot: a red run here could be crypto, carriage, resolution, enrolment, policy, or the Farm having a bad afternoon. That is not a flaw to be engineered away — it is what an end-to-end proof *is*, and it is only informative once everything beneath it is green. Splitting it into four rungs would produce four tests that each need the whole stack anyway.

**Done when:** the run completes with no manual step other than the two human ones the design requires — the paste into the Farm console (§3.2) and the witnessed exchange itself; the Farm VTA's DID document and the community's join-request/receipt pair are captured as frozen fixtures; each of the two VRCs verifies independently, off-device, against its witness credential; the run states honestly which policy was active when it passed (§9 Q2); and a re-run against `ref-05`'s local stack reproduces every step that does not require the Farm, so a red run can be bisected against a target we control.

**Foreseeable, not scheduled:** the same rung over the TSP transport once `vta-service` ships it enabled, which by [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) §2.3 is a third channel against the same session and no domain-op change.

---

## 6. Phases

Each phase names what makes it **done** and what it is **blocked on**, per [`CLAUDE.md`](./CLAUDE.md). F0 and F1 are strictly ordered; F2–F4 follow the levels. The contribution track (§7) runs in parallel and blocks nothing, per the standing rule that the ladder never waits on upstream review.

### F0 — Advance the pins, then measure the Farm

The cheapest decisive step, and the one that stops the rest from being written against a stale ecosystem (§3.5).

Advance `@openvtc/trust-tasks`, `pnm-core`, `vti-didcomm-js` and the `dtgwg-trust-tasks-tf` clone via `sync-external.mjs --advance` with a logged reason; re-run the ladder bottom-up. Then provision a Farm VTA and **measure what it advertises**: resolve its DID document, enumerate its service entries against the post-pin binding, record which mediator it is wired to, and establish whether an HTTPS Trust-Task base is reachable at all or whether DIDComm through the Farm's mediator is the only route in.

**Done when:** the ladder is green at the new pins with any breakage logged rung by rung; a Farm VTA's DID document is committed as a frozen fixture; §9 Q1 is answered with a service-type enumeration rather than an assumption; and the transport table in `ref-06x`'s findings ledger names, for a Farm VTA, which of REST / DIDComm / TSP is **advertised** and which is **reachable** — separately, because upstream's own client treats advertisement and availability as different claims.

**Blocked on:** a Farm account (us). Nothing else.

### F1 — `did:webvh` resolution on the phone

The mandatory dependency (§3.4), and the phase where §4 is either paid or worked around.

Two candidate implementations, and F0's measurement does not decide between them: `didwebvh-ts` under Metro behind a resolver shim, or a minimal resolver of our own over the log format. Decide with a measurement, not a preference — the deciding question is whether hash-chain verification is something we are willing to reimplement, and the default answer is no.

**Done when:** a Farm VTA's DID resolves inside the app on Hermes, from a real published log; **an unverifiable or tampered log is rejected**, with a fixture proving it (a resolver that skips chain verification is worse than no resolver, because it converts a hosting compromise into a silent one); the `ref-06x` Credo adapter is extended so the agent resolves the same DID; the exact shim list is enumerated in the rung README; and the resolution path is exercised under Metro in CI, not only in a local build.

**Blocked on:** nothing. Upstream fixes (§7 #1, #2) would shrink the shim list but are not on the path.

### F2 — Enrolment from the phone (L0)

Display the client-generated temp `did:key` as a QR and a copyable string; the human pastes it into the Farm console and provisions; the wallet then completes `auth/challenge` → authcrypt → session, and holds the grant.

**Done when:** a phone enrols against a Farm-hosted VTA with **no desktop PNM involved**; the private key is hardware-held and never leaves the device (§3.2), with the negative case — a VTA-minted key — explicitly not implemented; the equivalent of `pnm health` passes from the phone (upstream describes it as *"the status of a number of checks it runs against the VTA, the Mediator, and DIDComm/TSP trust pings"*); the ownership declaration required by [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) §4.7 is recorded at enrolment, because retrofitting it means revisiting a shipped onboarding; a rotated refresh token is persisted atomically before the next use; and the flow is written up as a runbook that states the human step rather than hiding it.

**Blocked on:** F1.

### F3 — The everyday interface (L1)

Personas and contexts from the wallet: the work `02-openvtc-tui.md` gives the TUI. Note its stated prerequisite — *"A VTA that advertises a DID hosting server. Setup itself does not need one, but you cannot mint a persona without it"* — which on Path A is the Farm's to provide and is therefore a thing to verify in F0, not to assume.

**Done when:** a persona DID is minted from the phone against a Farm VTA and resolves publicly; contexts can be created and listed; and the one-hour grant window upstream documents as a known edge case (*"If you take longer than that … provisioning fails"*) is handled with a visible countdown and a clean re-mint rather than an opaque failure.

**Blocked on:** F2, and on F0's answer to the DID-hosting question.

### F4 — Membership, qualified by our own credentials (L2 + L3)

The terminal rung. Mint an M-DID for the community, assemble the VP, submit through the public/join mediator, and hold the returned membership credentials.

Three constraints inherited rather than invented, all from [[DEV-GUIDE]]: **one M-DID per community** (*"Re-using an M-DID across communities … would leak your cross-community presence and defeats the design"*); **two mediators with different roles** (a public/join mediator open to outsiders, a members-only mediator gated on the community allowlist — an outside developer *"only ever interact[s] with the public/join mediator"*); and **the envelope authenticates the holder** (*"the DIDComm authcrypt envelope authenticates the sender — your M-DID — so the VP itself does not need a separate holder-binding signature"*).

**Done when:** `ref-16-farm-membership`'s criteria are met (§5).

**Blocked on:** F3; on §9 Q2 (whose answer changes what qualifies, not what is built); and on §9 Q3, which is a wire question we should ask upstream now rather than discover at implementation time.

---

## 7. The contribution track — React Native as a supported runtime

Keyring is about to become the ecosystem's first React Native client. Everything §4 measures is something the next RN implementer rediscovers alone, and each item below is small, evidenced, and independently useful.

**Standing rules, unchanged** ([`scripts/openvtc/README.md`](../../scripts/openvtc/README.md)): develop on a branch in the pinned clone; write the candidate document beside the rung it came from — the change, the community rationale, and evidence it breaks nothing; **show it to a human and wait for approval before pushing anything**; stage on a fork first; DCO `Signed-off-by` on every commit.

| # | Change | Evidence | Shape | Needs a consumer first? |
|---|---|---|---|---|
| 1 | **Import the clean subpaths in `pnm-core`.** Move the 8-of-12 barrel imports that need only `base64url`, `multibase` or `didKey` onto `@openvtc/vti-didcomm-js`'s existing dedicated subpaths | §4 #4 | Mechanical, no design argument, no API change. The smallest change on this list and the one that removes the most coupling | No — open first |
| 2 | **Make the built-in `webvh` handler lazy in `vti-didcomm-js`.** `createResolver` is already pluggable; `resolver.js` statically importing `./did-webvh.js` is what defeats the override | §4 #4 | Either a dynamic import inside the handler or moving the default wiring to a separate module, leaving `resolver.js` method-agnostic | No |
| 3 | **Make `didwebvh-ts`'s `react-native` condition resolve under Metro**, and test it | §4 #1–2 | A design question to raise before code: the condition exists, so RN is intended; the fs loader wants to be an injected provider rather than three static specifiers. Add an RN resolution job to CI so it cannot regress | Better with one |
| 4 | **A route to the transport-agnostic core in `pnm-core`'s `exports`** | §4 #3 | Maintainers' call between a new subpath and splitting `didcomm` behind an optional peer dependency. Frame as the question, not the patch | Yes — a working RN client makes it a report rather than a preference |
| 5 | **A `KVStore` conformance suite** for adapter authors, with our RN adapter as its first external consumer | The interface is already a clean seam with two implementations and no exported contract test | Export `kvStoreConformance(factory)`; derive it from real friction, so it lands after the adapter exists | Yes |
| 6 | **Declare a Node floor, or widen the CI matrix.** Keyring pins Node `>=20.19.2 <21`; nothing tests the library there | Uncontroversial and cheap | Ask which they prefer rather than choosing | No |
| 7 | **A React Native section for [[MOBILE-ARCH]]** | Already [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) §8 #3 — listed here only so this plan's findings feed it | — | Yes |

**Sequencing.** #1, #2 and #6 are openable on evidence alone and are the right first contributions: real, small, and free of design argument, which is also how we learn their review process before spending it on #3 and #4. #3–#5 want a working RN consumer behind them — a portability claim with no consumer is an opinion; the same claim with a reference implementation that had to work around each item is a bug report with a patch.

---

## 8. Standing rationale

**Self-hosting is not the default path, and remains the CI environment.** Path B requires an Ubuntu host, a public HTTPS origin for `did.jsonl`, and a mediator DID obtained out of band from its operator — three dependencies a mobile developer cannot satisfy and a CI job should not need. But the Farm cannot be a test dependency either: it needs an account, a passkey and a human paste. So `ref-05-local-vta` stays exactly as it is and becomes the **offline twin** — deterministic, accountless, and the target a red `ref-16` is bisected against (§5).

**Waiting for `@credo-ts/webvh` is not the plan for `did:webvh`.** Credo 0.7 ships one, but that makes every level of this plan gated on a Credo major upgrade nobody has scheduled, to obtain something `ref-06x` already proved a ~20-line adapter achieves. Adopt the upstream resolver when the upgrade happens on its own schedule; do not sequence this plan behind it.

**No WebAuthn substitute on the wallet.** §3.3 measures the wallet's session path as DID-based. Building a passkey path to reach a Farm VTA would be work spent satisfying a prerequisite that belongs to the console, and it would sit awkwardly beside hardware attestation, which is the stronger claim on the same ground.

**Whether Keyring ports `pnm-core` or writes its own VTA client is not decided here, and this plan does not need it decided.** F0 and F1 produce the measurement that settles it; [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) §3 owns the decision. Recorded so a reader does not mistake this plan's silence for a preference.

**The join request is not a new relationship protocol.** L2 submits a VP to a community's VTC service; it is not the peer-to-peer VRC exchange, and it is not the VTC's REST relationship-publish surface either. [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) §5.1–5.3 establishes that three unrelated things travel under the name "VRC" in this ecosystem; this plan uses its terms and adds none.

---

## 9. Open questions and what they block

1. **What does a Farm-hosted VTA actually advertise?** Whether an HTTPS Trust-Task base is reachable, which mediator is wired, whether TSP is enabled. Blocks the transport decision for every level. **Ours to measure — F0.**
2. **Is the two-VRC join policy live, and when?** Quoted as a target that *"is not what is currently active today"*. Blocks L3's strategic claim, not L2's implementation. **Blocked on the community operator**, and worth asking directly rather than waiting to find out.
3. **Which authority does the join task use?** [[DEV-GUIDE]] gives `https://trusttasks.org/openvtc/vtc/join-requests/submit/1.0`, while [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) §3.4 records the `trusttasks.org/openvtc/` authority as retired for the PNM catalogue in favour of the canonical `trusttasks.org/spec/` one. Both cannot be current for the same client. Blocks L2's wire work. **Ask upstream now**; the answer is a sentence and the discovery cost at implementation time is a day.
4. **Does the Farm accept a hardware-held key, and can a second device be added?** The Admin DID box should be indifferent to where the private key lives, and one grant per device is the obvious model — but neither is stated anywhere, and both are load-bearing for a wallet. **Ours to measure — F2.**
5. **Rung numbering spans three documents and has one collision.** The parent reserves `ref-07…09`, this plan takes `ref-16`, and the SDK companion proposes `ref-08-pnm-core-hermes` for the experiment [`pnm_cnm_subtask.md`](./openvtc-integration-plan/pnm_cnm_subtask.md) §6 already calls `ref-10-pnm-core-hermes`. Blocks nothing; costs a reader ten confused minutes. Resolve by keeping `ref-10`.

---

## 10. Review index

| Companion | Author | What it settles |
|---|---|---|
| [`2026-09-03-al.md`](./keyring-on-the-vta-farm/2026-09-03-al.md) | AL | The Farm measurements behind §3; the packaged-dependency measurements behind §4 and the contribution shapes in §7; the positions adopted on custody, WebAuthn and the CI environment, and the open questions each supersedes |

## 11. Sources

- [[DEV-GUIDE]] — `vti-setup` pinned clone **22f712f** (2026-08-17): `developer/README.md`, `developer/01-personal-vta.md`, `developer/02-openvtc-tui.md`, `developer/03-joining-a-community.md`. Header versions: VTA 0.17.0, Mediator 0.18.19, DID Hosting Daemon 0.8.3.
- [[HTTPS-BINDING]] — `dtgwg-trust-tasks-tf` pinned clone, `bindings/https/0.1/spec.md` §6.
- npm registry, measured 2026-09-03: `@openvtc/pnm-core` 0.7.0, `@openvtc/vti-didcomm-js` 0.7.0, `@openvtc/vti-tsp-js` 0.2.0, `@openvtc/trust-tasks` 0.16.8, `didwebvh-ts` 2.8.0. Reproduction commands in the companion.
- [`ref-06x-cypress-stack`](../../tsp-reference/ref-06x-cypress-stack/) — the `did:webvh` finding and the resolver-adapter measurement.
- [`scripts/openvtc/PINS.json`](../../scripts/openvtc/PINS.json) and [`README.md`](../../scripts/openvtc/README.md) — pin state, the advance protocol, and the contribution workflow.
