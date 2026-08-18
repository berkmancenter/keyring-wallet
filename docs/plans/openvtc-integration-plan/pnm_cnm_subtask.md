# PNM and CNM in Keyring — Phased Plan

**Status:** Draft for discussion. Not a commitment to implement.
**Scope:** a new bifold package (`vti-client`, per parent §5.2) plus the RN edges it needs; no change to the VRC/witness stack except where §6 says so.
**Parent:** [`openvtc-integration-plan.md`](../openvtc-integration-plan.md) — this document is item **§7 #5** of its contribution roadmap ("The RN/PNM mobile library") in detail, and the second consumer that makes its Phase D deliverables concrete.
**Sibling:** [`trust_tasks_subtask.md`](./trust_tasks_subtask.md) — the VRC/witness recast. Where the two meet is §5 and §8.
**Reasoning:** [`2026-08-17-bam.md`](./2026-08-17-bam.md) — the upstream corrections behind §2.2, §4.5–§4.8 and the phase scoping, and the positions each supersedes. This document states only the current design; see [`../CLAUDE.md`](../CLAUDE.md).
**Baseline:** every claim is measured against the **Cypress release** — `verifiable-trust-infrastructure` 187ad9cd, `vta-browser-plugin` 89d70c4, `openvtc` 3797dd0, `dtgwg-trust-tasks-tf` 7e0d755 — and carries a file path. Re-verify after any pin advance ([`scripts/openvtc/README.md`](../../../scripts/openvtc/README.md)).

**References:**

- **[[MOBILE-ARCH]]** — `docs/05-design-notes/mobile-agent-architecture.md` in the VTI repo. Upstream's own spec for **porting the VTA mobile agent to another runtime**, naming React Native explicitly. Its §8 checklist and §9 invariants are adopted as acceptance criteria (§4.1). **Stale in parts** — see §4.4.
- **[[TT-SPEC]]** — [Trust Tasks framework SPEC.md](https://github.com/trustoverip/dtgwg-trust-tasks-tf/blob/main/SPEC.md), pinned at 0.9.0 libraries, the Cypress lock. **Cite it as framework 0.4.** The pinned commit's header table still reads `Document version 0.3` while its Appendix B changelog documents 0.4 — and 0.4 is what the file contains: the `ceremony` member (§4.11), authorization-distinct-from-proof (§7.2 item 10), `trust-task-ok` (§8.6), the task digest (§4.9.3). [[DTG-CRED]] cites "framework 0.4" against this same content, so a reader comparing the two labels sees a version gap that does not exist.
- **[[DTG-CRED]]** — [DTG Credentials specification](https://github.com/trustoverip/dtgwg-cred-spec/blob/main/spec/body.md). Authoritative for the VRC/VWC shapes §5 exchanges.
- **[[PLUGIN-GUIDE]]** — `CLAUDE.md` in `vta-browser-plugin`; the wallet-implementer rules. Quoted in §4.3.

---

## 1. What this adds, and why it has its own critical path

The parent plan makes Keyring **speak the ecosystem's transport and operation
layers**. This document makes Keyring **do what a person wants a personal agent
to do**: approve or refuse what an agent is about to do on their behalf, hold an
authenticated session with a VTA, manage credentials and secrets, exchange a
relationship credential with a peer, and join a community.

They have different critical paths, which is why this is a separate document.
The parent's Phase D/E is gated on TSP, Askar custody and the Credo adapter. The
highest-value PNM capability — **the phone as approver** — is gated on none of
them, and §2.4 shows it needs no VTA account at all. That single finding
reorders everything below.

Three terms, kept apart throughout, because the ecosystem's own docs conflate
them:

| Term | What it is | Where it runs |
|---|---|---|
| **PNM** | Personal Network Manager — a client driving **one VTA** | `pnm-cli`, `@openvtc/pnm-core`, the iOS agent |
| **CNM** | Community Network Manager — the **same VTA client**, community-admin scope | `cnm-cli` |
| **VTC** | Verifiable Trust Community — a **separate service** with its own API | `vtc-service` / `vtc-client` |

CNM is *not* a VTC client. `cnm-cli` has no `vtc-client` dependency at all
(`cnm-cli/Cargo.toml`) and its own `--url` flag is documented as "Base URL of
the **VTA** service" (`cnm-cli/src/main.rs:34`). §2.5 and §6 keep them apart.

**Which is exactly why community administration on a phone is not a port of
`cnm-cli`.** The membership operations a community admin actually wants — the
join queue, approve/reject, the roster — live on the VTC, not the VTA, and
`cnm-cli` cannot reach them. P6 therefore composes the two clients rather than
mirroring one CLI, and that composition, not the transport, is its whole cost.

---

## 2. How PNM commands reach a VTA — measured at Cypress

### 2.1 The dispatch spine: one document, three transports

`pnm-cli` is a thin clap dispatcher over one library, `vta_sdk::client::VtaClient`
(`pnm-cli/src/main.rs:266-302`). Nearly every operation becomes a **Trust Task
document** and goes through `dispatch_trust_task`
(`vta-sdk/src/client/mod.rs:1470-1532`), which builds:

```json
{ "id": "urn:uuid:<v4>", "type": "<type URI>", "payload": { } }
```

and carries it, unchanged, over whichever transport the client holds:

| Transport | Carriage | Source |
|---|---|---|
| **REST** | `POST /api/trust-tasks` with the document as the body | `client/mod.rs:1496-1506` |
| **DIDComm v2** | a message of type `https://trusttasks.org/binding/didcomm/0.1/envelope` wrapping the document | `client/mod.rs:1571-1578` |
| **TSP** | the document's bytes **directly — no envelope wrapper** | `client/mod.rs:1514-1532` |

All three feed one dispatcher, `dispatch_trust_task_core`, so "the request and
reply documents are byte-identical across all three transports"
(`client/mod.rs:1508-1513`). The parent plan's §2.3 claim — that the task layer
is transport-portable by construction — is production code, not an aspiration.

**The exception, and why it exists.** `pnm services
{tsp,rest,didcomm,webauthn} {enable,update,disable,rollback}`, `services report`
and drain-cancel ride raw protocol messages under
`https://firstperson.network/protocols/services-management/1.0/*`
(`vta-sdk/src/protocols/protocol_management.rs:22-50`). The reason is stated at
the source: `enable_didcomm` is **REST-only by nature** because "DIDComm is not
yet running at first-enable time" (`vta-sdk/src/protocol/mod.rs:5-8`, enforced
at `:169-176`). The non-Trust-Task slice is precisely the bootstrapping of the
channels Trust Tasks would otherwise ride on. It is server-operator surface and
§6 keeps it **permanently** out of scope — recorded here so a future
implementer does not read "everything is a Trust Task" and then trip over it.

### 2.2 Envelope invariants a client must honour

Enforced by the dispatcher (`vta-service/src/trust_tasks/mod.rs:490-540`), and
each of these has a documented way to fail silently:

- **`recipient` MUST equal the VTA's DID**, and the envelope must not be expired
  ([[TT-SPEC]] §7.2). A signed document with no in-band recipient is rejected by
  §4.8.2 audience binding — which is why the SDK's signer always sets it
  (`vta-sdk/src/trust_task_sign.rs:82-99`).
- **Replay dedup on `(actor, envelope-id)`.** The VTA refuses a resubmitted id as
  `duplicate` — "the prior submission is authoritative — do not retry with the
  same id".

  **Do not read that as "mint a fresh id per attempt".** Framework 0.4 §7.2 item
  11 ([#223](https://github.com/trustoverip/dtgwg-trust-tasks-tf/pull/223), in
  our pin) makes duplicate-*execution* protection normative for consequential
  tasks, keyed on the document `id` **and a digest** — RFC 8785 canonical
  equality, because "an `id` alone cannot distinguish the retry it must absorb
  from the conflict it must reject" — and §8.4 now carries the other half: a
  retry is the **bit-for-bit identical document**, and "a producer that re-signs
  or re-stamps `issuedAt` has not retried, it has issued a different document
  under a reused `id`."

  So the rule for a client is: **a genuine retry reuses the document unchanged;
  only a genuinely new request gets a new id.** Re-minting the id on a
  cross-transport fallback would turn one request into two documents, and for a
  consequential task that is precisely the duplicate effect item 11 exists to
  prevent. The VTA's `duplicate` refusal *is* item 11 absorbing the retry — the
  prior submission stands, and the correct client response is to read the prior
  outcome, not to reissue.

  **And there are two digests, computed differently on purpose.** Item 11's is
  *document identity* — which serialization arrived: two documents sharing an
  `id` are the same document "when their serializations are identical under
  [RFC 8785] canonicalization", so a `proof` re-signed over identical content
  makes a **different** document, which is the `idConflict` case. The **task
  digest** of §4.9.3 asks what the document *says*, so it is computed with the
  top-level `proof` **removed** and "the same statement signed, unsigned, or
  re-signed is one document with one task digest". The framework states the
  distinction rather than leaving it to be inferred — "this is not the document
  identity of §7.2 item 11 … the two answer different questions and are
  deliberately computed differently" ([[TT-SPEC]] §4.9.3) — and names a third
  computation that is neither (`trust-ceremony-receipt`'s step digest, over the
  document *including* its `proof`). A client that writes one hash helper and
  uses it for every job gets at least one of them wrong. §4.5 carries the task
  digest's rules; this bullet is only the warning that they are not
  interchangeable.
- **Schema validation rejects unrecognised payload members, case included**
  (`expected_version_id` vs `expectedVersionId`, `mod.rs:435`). The client should
  validate locally first — the Rust SDK does exactly this
  (`check_payload_conforms`, `client/mod.rs:1457-1468`), and its comment names
  the production incidents that motivated it.
- **Type URIs are canonical and exact**: `https://trusttasks.org/spec/<ns>/<op>/<maj>.<min>`.
  The `/spec/` segment is mandatory, there is no patch component, and **there is
  no version-family matching** — `1.0` and `1.1` are unrelated identifiers.
  `https://trusttasks.org/openvtc/...` is dead; no live VTA URI uses it.
- **The DIDComm v2 binding is at 0.2 in our pin, and the envelope type did not
  move.** `binding/didcomm/0.2` keeps `…/binding/didcomm/0.1/envelope` as the
  message `type` deliberately — the change is "additive, and a `MINOR`
  increment accordingly: the envelope type is unchanged, so a `0.1` consumer
  recognises a `0.2` producer's messages and vice versa" — so §2.1's table is
  right and stays right. What 0.2 adds binds a client. DIDComm's `thid`/`pthid`
  are now **mapped** to `threadId`/`parentThreadId` rather than ignored (`0.1`
  "left `thid` and the framework's `threadId` free to disagree with nothing
  detecting it"), and a disagreement is an error — but the comparison "only
  engages when both values are present", so a producer that sets neither stays
  conforming. And on `identityMismatch` the consumer **MUST** route its error
  response to the transport-authenticated sender — the DID authcrypt actually
  authenticated — and **MUST NOT** route to the contested in-band `issuer`.
  That last one is the rule a naive "reply to `issuer`" implementation gets
  wrong by default, and it is the whole point of the mapping: the in-band
  member is exactly what is in dispute when the error fires.

  **The other DIDComm binding answers the same question in the opposite way,
  and Keyring runs both.** The framework's DIDComm **v1** binding carries
  Keyring's legacy VRC/witness stack, which the parent plan requires to keep
  running alongside v2 and TSP. It cannot represent a `urn:uuid:` correlator at
  all — Credo enforces RFC 0008's id shape — so its 0.2 rule is that an
  unrepresentable `threadId`, `parentThreadId`, or fallback `id` is **omitted,
  never rewritten**: "a rewritten correlator contradicts the in-band member and
  draws a guaranteed `malformedRequest`"
  ([#238](https://github.com/trustoverip/dtgwg-trust-tasks-tf/pull/238)
  implements it in the reference crate; parent §7 #9 owns that lane). PNM mints
  exactly those ids (§2.1). So **one thread-correlation helper serving both
  bindings is a trap**: v2 maps the correlator and errors when the two
  disagree, v1 drops it when the transport cannot carry it, and neither is ever
  permitted to edit it.

### 2.3 What TSP actually is at Cypress — per crate, not per ecosystem

TSP is a Cargo feature everywhere, and the defaults differ by crate. The picture
is finer than "TSP is off":

| Crate | TSP at Cypress | Source |
|---|---|---|
| `vta-sdk` | **off** by default | `vta-sdk/Cargo.toml` (no `default` key) |
| **`vta-service`** | **OFF** by default | `default = ["setup","keyring","rest","didcomm","cli-synthesis"]` |
| `pnm-cli` | **on** — but its own comment scopes it to "**Trust Spanning Protocol probe in `pnm health`**" | `pnm-cli/Cargo.toml`, `default = ["keyring","tsp"]` |
| `cnm-cli` | **off** | `cnm-cli/Cargo.toml`, `default = ["keyring"]` |
| `vtc-service` | on, **receive-side only** until "Phase B" | `vtc-service/Cargo.toml` |
| `vta-mobile-core` | on | `vta-mobile-core/Cargo.toml:75-79` |

**The load-bearing row is `vta-service`: a stock VTA does not speak TSP.** What
the clients can compile is moot if the server it talks to cannot answer. So the
live PNM transports at Cypress are **REST and DIDComm v2** — which settles the
phasing without disparaging TSP: this is the experimental posture parent §1.1
approves of. Building PNM on a transport-agnostic channel is what makes TSP a
later *swap* rather than a later *rewrite*.

*(This corrects nothing in the parent plan but sharpens §4.2: the ladder
`TSPTransport > DIDCommMessaging > VTARest` is what the code selects among; at
Cypress the top rung is not compiled into the server that would answer on it.)*

### 2.4 The finding that reorders this plan: the approver needs no account

`vta-service/src/messaging/auth.rs:73+` (`auth_for_trust_task_envelope`): when
the ACL turns a sender away **and** the envelope names a *ceremony* task,
dispatch proceeds anyway on `ceremony_claims` — the cryptographically-proven
sender DID, over `Role::Monitor` with empty contexts. The ceremony set is
exactly three URIs (`vta-service/src/trust_tasks/ceremony.rs:48-53`):

```
https://trusttasks.org/spec/task-consent/decision/0.1
https://trusttasks.org/spec/auth/step-up/approve-response/0.1
https://trusttasks.org/spec/auth/step-up/approve-response/0.2
```

The reason is structural, not a convenience (`ceremony.rs:42-45`):

> Ceremony tasks carry their own authority (an approver's proof, a step-up
> approve-response) and must NOT themselves be gated — else approving a task
> could itself require consent/step-up, ad infinitum.

And for step-up specifically (`ceremony.rs:78-81`):

> Step-up `approve-response` is unfiltered, deliberately. Its authorized signer
> is `pending.approver`, recorded when the step-up was minted and **not**
> required to hold an ACL entry — that is the delegated phone-as-authorizer.

Corroborated in `docs/02-vta/task-consent.md:141`: *"since #907 an approver
device does not need an ACL entry."*

So a device that only answers those tasks needs **no ACL entry, no bearer token,
and no `/auth/*` round trip at all** — only an authcrypt-capable DIDComm (or
TSP) session and a `did:key`. The carve-out is gated on the intrinsic-sender
transports (`#[cfg(any(feature = "didcomm", feature = "tsp"))]`), so it is a
DIDComm path, not a REST one.

**Two halves, with different setup costs — do not conflate them.**
`may_attempt_ceremony` (`ceremony.rs:86-102`) returns `true` immediately for
anything that is not `task-consent/decision/0.1`, so:

- **Step-up `approve-response` is genuinely zero-configuration.** The authorized
  signer was recorded when the step-up was minted; nothing about the device is
  pre-registered anywhere.
- **`task-consent/decision` still needs the operator to have named our DID in
  *some* configured approver set** — a cheap in-memory pre-filter, deliberately
  not an ACL entry, added because the carve-out costs a durable audit write and
  an unfiltered one would let anyone who can reach the mediator flood the audit
  log for the retention window.

So the consent half retains an out-of-band step; it is approver-set membership,
not an account. P1 must say so in its runbook rather than promising
zero-configuration for both.

**This is the cheapest useful thing Keyring can be, and it is also the most
valuable** — it is the parent plan's Phase E demo ("Keyring buzzes… deny → it
never happens") reachable without solving enrolment. §6 therefore makes the
approver **P1**, ahead of enrolment.

### 2.5 CNM is a reduced VTA client; the VTC is a different service

`cnm-cli` uses the identical `VtaClient` and the same dispatch plumbing, with
13 subcommands (`cnm-cli/src/main.rs:109`): `Setup, Community, Health, Auth,
Config, Keys, Contexts, Acl, AuthCredential, Backup, Audit, Bootstrap,
DidTemplates`. It shares `vta-cli-common::commands::{acl, config, contexts,
credentials, did_templates, keys}` with `pnm-cli`. Its scoping rule is its own
help text: no `webvh` / `keys import` and no VTA audit *tail* ("VTA-operator
concerns"), while backup, audit-verify, contexts, ACL and auth-credential
generation are present because "a community admin needs to provision application
identities" (`main.rs:16-31`).

**So CNM is not a second protocol — it is a scope and a UI over the same
client.** Once P1–P3 exist, CNM costs authorization and presentation work, not
transport work.

The **VTC** is separate: its own binary (`vtc`, port 8200 vs the VTA's 8100),
its own JWT audience (`aud: "VTC"` — cross-audience tokens are rejected), its
own keyspaces and a Rego policy engine, and it **mints no keys of its own** —
it receives a sealed key bundle from a VTA at setup. Its client, `vtc-client`,
is nine methods wide, REST-only, and gates **every** route on a per-route
`Trust-Task` HTTP header, answering `400` without it
(`vtc-client/src/lib.rs:22-31`). Standing up a community needs a running VTA
first: *"a VTC cannot exist without a VTA to mint its identity"*
(`docs/03-vtc/getting-started.md`).

**Two hazards recorded so they are not rediscovered:**

- **`cnm-cli`'s documented surface does not exist.** `docs/03-vtc/community-lifecycle.md:198-214`
  documents `cnm members list|show|remove`, `cnm join list|approve|reject`,
  `cnm policies …`, `cnm credentials …`. **None of these are in the code.** Plan
  against `cnm-cli/src/main.rs`, never against that document.
- **`vtc-client`'s header comment records that every method in it was broken
  until the `Trust-Task` header was added**, and its only in-workspace consumer
  is a self-test. Treat it as a wire-contract reference, not a mature dependency.

---

## 3. Client architecture

### 3.1 The decision

**Keyring's PNM client is `@openvtc/pnm-core`'s protocol layers made
runtime-agnostic, with React Native implementations of its platform seams,
consumed through a new `vti-client` bifold package.**

This is the same play we already ran one layer down. Our noble HPKE work shipped
as `@openvtc/vti-tsp-js` 0.2.0, whose entire dependency set at Cypress is
`@noble/{ciphers,curves,hashes}` — no `hpke-js`, no WebCrypto
(`packages/tsp-js/package.json`). The deepest layer of the stack is already
RN-ready **because we made it so**. §3.3 does the same one layer up.

### 3.2 Why, against the alternatives

[[MOBILE-ARCH]] §2.1 offers two strategies and recommends the first:

> **Strategy A — reuse the Rust core (recommended).** `vta-mobile-core` is a
> `cdylib`/`staticlib`… You get the *exact* same crypto, byte-for-byte, for free.
>
> **Strategy B — reimplement the engine in Dart.** Only do this if you cannot
> ship a Rust artifact. You then must re-derive every standard in §4… Expect to
> need Dart equivalents of: a JCS canonicaliser, Ed25519 + X25519
> (ed25519→x25519 conversion!), multibase/multicodec, a DIDComm v2 stack, a DID
> resolver, and JOSE.

**Strategy A does not deliver PNM.** Verified against the crate at Cypress, not
against the doc: `vta-mobile-core` **0.6.18** has modules `api, consent, didcomm,
display_name, error, keys, mediator, proof, push, resolver, session, stepup,
task, tsp` — an *Authenticator* engine — and **zero `reqwest`**, i.e. no HTTP
client at all. There is no PNM management surface, no enrolment, no persistence,
no key generation. [[MOBILE-ARCH]] says the same in prose, and the code confirms
it two minor versions later:

> The engine today covers the **Authenticator** core… The **PNM** management
> surface (driving the ~79 `spec/vta/*` ops, sealed-transfer bundle open,
> provision-integration) is largely *not yet* in `vta-mobile-core` — it's
> specced in the URI registry and implemented in the CLIs.

The CLIs are Rust binaries, not a bindable library. Strategy A buys the approver
half and leaves the management half unbuilt.

**Strategy B's cost list is already paid — in TypeScript.** Every item upstream
warns a porter about exists in `pnm-core` 0.4.0: JCS canonicalization and DI
proof assembly (`src/trust-tasks/{canonical,sign,verify}.ts`), DIDComm v2
(`src/didcomm/`, via `@openvtc/vti-didcomm-js`), DID resolution (`src/did/`),
multibase (`@scure/base`), Ed25519/X25519 (`@noble/curves`). It also has what
the Rust engine does not: vault, consent, push-gateway, provisioning and context
surfaces.

**Strategy C — reuse the TypeScript PNM library — is the real choice**, and the
doc's silence about it is explicable: it is "a descriptive snapshot of
`vta-mobile-core` v0.3.1 … as of 2026-06", written before `pnm-core` reached
0.4.0.

The clincher is architectural. `pnm-core`'s layering is, independently, the
design parent §5.2 arrived at:

- `TrustTaskChannel` (`src/vta/channel.ts:38-66`) is the parent's **`Carriage`
  port** — "one interface that TSP, DIDComm, and REST each implement… Domain ops
  never see the transport" (`channel.ts:1-12`).
- `VtaSession` (`src/vta/session.ts`) is the channel chain, `CHANNEL_PRIORITY =
  ["tsp","didcomm","rest"]`, with **capability-driven, not error-driven**
  fallback: it deliberately does *not* fall back on a generic
  `trust-task-error`, because "retrying a genuinely bad request on another
  transport would be wrong, and for mutating tasks unsafe" (`session.ts:1-15`).

Adopting it is not a compromise against our design. It is our design, already
written, already tested, already consuming our own crypto.

**Rejected, as standing rationale:**

- **Bind `vta-mobile-core` over FFI.** Ruled out by the module inventory above:
  the PNM surface is not in it, at any version. It also breaks the parent's
  pure-TS/no-RN-imports rule (parent §6), which is what lets the same code run
  under Node and Hermes and underwrites every conformance claim we make.
- **Wrap `pnm-core` unmodified and patch around its browser assumptions.** Ruled
  out because the assumptions are not at the edges — `crypto.subtle` and
  `globalThis.crypto` calls sit *inside* protocol files (§3.3) — so a wrapper is
  a permanent shim with no upstream path. Making the same code runtime-agnostic
  costs about the same and ends with one codebase.
- **Write a fresh RN PNM library from scratch.** Ruled out by the parent's own
  two-implementations discipline (§4.4, §7.9): a second from-scratch
  implementation adds drift risk without adding evidence, where a portability
  contribution adds both a runtime and a maintainer to the existing one.

*(Parent §7 #5 currently frames this as a "new repo proposal, e.g.
`OpenVTC/pnm-react-native`", on the basis that pnm-core is "too browser-specific"
— recorded before 0.4.0. §3.3 measures the actual coupling and finds it narrow.
The contribution is better shaped as portability work on `pnm-core` plus a thin
RN adapter; parent §7 #5 should be restated accordingly.)*

### 3.3 The measured portability surface

`pnm-core` 0.4.0 is 85 TypeScript files / ~11,600 lines. Its browser coupling is
narrow, isolated, and mostly already behind an interface:

| Coupling | Where | RN answer | Size |
|---|---|---|---|
| `crypto.subtle.digest` (SHA-256) | `trust-tasks/canonical.ts:114`, `did/verification-method.ts:40` | `@noble/hashes`. **Keyring already polyfills `subtle.digest`** (parent ref-03c), so these two may already run unmodified — measure, don't assume | trivial |
| `globalThis.crypto.randomUUID` / `getRandomValues` | 8 sites incl. `vta/trust-task.ts:52` | `react-native-get-random-values` + a `randomUUID` shim | trivial |
| `KVStore` → `IndexedDBKVStore` | `store/kv-store.ts` | already a **clean 4-method interface** with an in-memory sibling; add an RN backend | small |
| `navigator.credentials` / WebAuthn | `webauthn/*`, `store/{holder-identity,approver-prf-wrap}.ts` | genuinely browser-bound, and already a **separate export path** (`"./webauthn"`). Keyring substitutes Secure Enclave / StrongBox — §6 P1 | medium, **and it is our differentiator** |
| `cbor-x` | `provision/open.ts` only (one `Decoder`) | one import; swap or shim if Hermes objects | small |
| `chrome.*` | **none** — one mention, in a comment | — | — |

Everything else — `vta/`, `trust-tasks/`, `inbound/`, `vault/`, `device/`,
`siop/`, `rp-login/`, `didcomm/` — is host-neutral by construction. The package
ships 28 Node-runnable `.mjs` tests, which is our conformance idiom, and
`src/vta/smoke.ts` (528 lines) is an offline in-memory wire-construction suite —
a ready-made Hermes-vs-Node identity probe (§6 P0).

Keyring's side is likewise mostly present: `jcsCanonicalize` (RFC 8785) is
exported from `@bifold/vrc-contexts` (`src/index.ts:46-48`),
`@noble/{curves,hashes}` are vendored and Hermes-proven, and
`@react-native-firebase/messaging` is already a dependency
(`app/package.json:78-79`) — the push half of P1. The gap is `eddsa-jcs-2022`
itself: **no such suite exists in bifold today** (grep: zero hits). That is
parent Phase D item 2, and it is on P1's critical path.

### 3.4 What `pnm-core` already implements, verbatim

The wallet-relevant URIs in `pnm-core` 0.4.0 — the concrete scope of P1–P3:

```
auth/authenticate/0.1
auth/step-up/approve-request/0.1 · /0.2 · approve-response/0.2
task-consent/request/0.1 · decision/0.1 · granted/0.1
push/register/0.2 · device/set-wake/0.2
vault/list/0.2 · upsert/0.2 · release/0.2 · delete/0.1
     · proxy-login/0.2 · sign-trust-task/0.2
vta/contexts/create/1.0 · list/1.0 · vta/webvh/dids/list/1.0 · vta/passkey-vms
acl/swap-key/0.1                       (present but unused — see P2)
trust-task-error/0.1 · /0.2 · /0.3
binding/didcomm/0.1 · /envelope · binding/push/0.1
```

Two observations that shape phasing. **The version mix is the canonical-task
migration in flight** — `vta/*` at `1.0` beside newer families at `0.1`/`0.2` —
making parent §4.2a's "accept N and N−1" policy a live case, not a hypothetical
one. And **`trust-task-error` spans three minors simultaneously**, so error
handling must be version-tolerant from the first line of code.

For orientation on the wider surface: the VTA's real inbound catalogue is ~159
URIs — `vta_sdk::trust_tasks::ALL_URIS` (148, `vta-sdk/src/trust_tasks.rs:1328`)
**plus** 8 credential-vault URIs it omits (`trust_tasks.rs:551-597`, dispatched
at `vta-service/src/trust_tasks/mod.rs:927-942`) plus 3
`credential-exchange/pending/*`. Most of it is server-operator surface. Note
also that the `trust-tasks/` directory at the VTI repo root is **not** the PNM
catalogue: its 66 `spec.md` files are retired VTC/community-node specs under the
dead `trusttasks.org/openvtc/` authority. Build against `trust_tasks.rs`.

---

## 4. Constraints we inherit

Quoted rather than paraphrased: an uncited constraint is one an implementer will
either ignore or over-apply.

### 4.1 Wire invariants ([[MOBILE-ARCH]] §9), adopted in full

The ones that bite hardest for a TypeScript port:

> - `eddsa-jcs-2022` signing input is JCS-canonical and **byte-identical** to the
>   engine's, or proofs don't verify.
> - ed25519→x25519 uses the **standard birational map**, or DIDComm authcrypt to
>   the holder `did:key` silently fails.
> - `sender_authenticated == false` (anoncrypt/plaintext) ⇒ **do not trust `from`**.
> - Trust-Task type URIs are **canonical**; no patch version; no version-family matching.
> - Auth `IS_PROOF_REQUIRED` matrix: challenge=no, authenticate=yes, refresh=no,
>   whoami=yes, revoke=yes.
> - Refresh **preserves AAL**; `aal2` access tokens get the shorter TTL.
> - Step-up challenge **≥16 bytes**; `reason` shown **verbatim**; `subject` /
>   `session_id` / `challenge` **echoed verbatim**.
> - Push wake-ups are **contentless**; Trust-Task content only ever travels
>   encrypted via mediator pickup.

Three of these are silent-failure modes ("or proofs don't verify", "silently
fails"), which is why P1 and P2's acceptance criteria are byte-comparisons
against known-good engine output rather than "it works". Two further constraints
come from the code and are just as sharp:

- **Sign the proof-less document.** The signer serialises, removes `proof`, then
  signs (`vta-sdk/src/trust_task_sign.rs:118-131`); the verifier strips `proof`
  and re-canonicalizes (`vti-common/src/auth/di_proof.rs:80-84`). JCS is
  presence-sensitive, so signing the whole document verifies nowhere.
- **The holder MUST be a `did:key`.** The server verifies proofs with
  `DidKeyResolver` only (`di_proof.rs:82`), so the SDK refuses non-`did:key`
  holders up front (`trust_task_sign.rs:111-112`). VM id form is
  `did:key:zXxx#zXxx`.

### 4.2 The consent surface is a security control, not a screen

`pnm-core`'s consent module states two rules with their reasoning
(`src/inbound/task-consent.ts:1-40`); both are adopted and both constrain UI:

> **This module renders only content it has verified came from an executor this
> device is enrolled with.** A request whose proof does not verify, or which was
> signed by anyone outside the enrolled-executor set … MUST NOT reach a human.

The rationale: the requester is the least-trusted component — if it could author
what the human reads, "it would be writing the basis of a decision that
authorizes it — while every signature still verified."

> A payload says what was *asked for*. Only the code about to run knows what will
> *happen* … which is why the VTA dry-runs the real handler and sends `effects`,
> and why a surface that rendered the payload instead would be confidently
> misinforming the person it was asking.

So Keyring's consent card renders the VTA's `effects`, never the requester's
payload, and never renders anything from an unverified signer. Server-side this
is enforced too: the approver identity is taken **from the verified proof, never
from the session** (`vta-service/src/trust_tasks/task_consent.rs:122-143`) — a
bearer token proves who opened the channel, not who agreed.

**One upstream bug to not reproduce:** `vta-mobile-core` computes the
operator-visible match code as the first 6 hex chars of the **decoded digest
bytes** (`vta-mobile-core/src/consent.rs:79-96`). Slicing the *encoded*
multibase string instead leaves ~17.6 bits of entropy where the operator
believes ~35. Match the decoded-bytes behaviour, and cover it with a fixture.

### 4.3 Persist-before-ack — an open upstream defect Keyring can fix

[[PLUGIN-GUIDE]] documents an open defect against its own rule R1.6:

> `@openvtc/vti-didcomm-js` acks an inbound frame **before** dispatching it to
> `onMessage` … and the ack tells the mediator to delete its queued copy. The
> wallet then persists only the message **id**, never the body. So if the
> offscreen document or service worker dies between the ack and the user's
> decision, a `task-consent/request` is gone for good … The VTA waits for a
> decision that will never come and the task lapses on its TTL.
>
> Fixing it needs either a persist hook in `vti-didcomm-js` or disabling its
> auto-ack … a contract change affecting pnm-relay too.

**This applies to us with more force.** A browser worker's teardown is
occasional; a mobile OS backgrounds and kills apps as routine. A lost consent
prompt is a gated action that never got its human check. It is also a
contribution opening — the fix needs an ack-contract change in
`vti-didcomm-js` that the extension cannot make alone. P1 treats it as a
first-class deliverable, not a hardening pass.

### 4.4 Upstream documentation drifts from upstream code — verify, don't trust

Four measured instances, recorded because each would have cost a day. Note the
drift runs **both** ways — the fourth is documentation that understates what
shipped, which is the more dangerous direction because it reads as a reason not
to build:

- [[MOBILE-ARCH]] describes `vta-mobile-core` **v0.3.1**; the crate is at
  **0.6.18**. Its push section is superseded by its own §4.8, and its claim that
  the engine returns `Unimplemented` for Web Push no longer matches the code.
- [[MOBILE-ARCH]] §4.5 says `auth/*` "works over both DIDComm (via mediator) and
  plain REST". In the code the auth URIs are on `REST_ROUTED_URIS`
  (`vta-sdk/src/trust_tasks.rs:1519-1529`) and are **not** dispatched on the
  mediator inbound path; the "DIDComm" variant is an authcrypt envelope POSTed
  to the REST route. `docs/02-vta/didcomm-protocol.md:47-58` states the opposite
  of §4.5 explicitly. **Trust the code.**
- `docs/03-vtc/community-lifecycle.md` documents `cnm` subcommands that do not
  exist (§2.5).
- **The backup slice is documented as unbuilt and is in fact built.**
  `docs/05-design-notes/backup-descriptor-pattern.md` states **"Status: spec
  only — no implementation yet"**, and `vta-sdk/src/trust_tasks.rs:1152-1159`
  says the handlers "land in follow-on commits per the rollout plan" and that
  the URIs are "declared here unconditionally so client SDKs can probe". Both
  are stale: `vta-service/src/trust_tasks/backup.rs` implements all five
  handlers and `trust_tasks/mod.rs:968-976` registers every one of them in the
  dispatcher. Taken at their word, these two comments would have removed
  backup/restore from this plan on the grounds that there was nothing to call.

### 4.5 Framework mechanisms in the Cypress lock that P1 must honour

Framework 0.4 landed a wave of rules on 2026-08-15/16 that are **inside our pin**
(`dtgwg-trust-tasks-tf` 7e0d755 — 0.4 per its changelog, whatever the header
table says; see [[TT-SPEC]]) and that a consent surface built without them would
get wrong. Each is normative, not advisory:

- **Task control — cancel, suspend, resume (§12,
  [#232](https://github.com/trustoverip/dtgwg-trust-tasks-tf/pull/232)).** Until
  0.3 "an agent could be told to start and had no defined way to be told to
  stop"; transport-level cancellation is not a substitute because an accepted
  document "outlives the connection that delivered it." **A pending consent
  prompt can now be withdrawn in-band.** A phone that renders a prompt and never
  handles a control document will ask a human to decide something that no longer
  matters — and, worse, accept a decision on it. Rollback is **never** offered
  (many effects are irreversible, and "the state needed to reverse one is often
  the material the task existed to destroy"); the response reports what occurred.
  Suspension preserves execution state and **MUST NOT** resume after `expiresAt`.
- **Authority is re-evaluated before each irreversible effect (§7.2 item 12,
  [#226](https://github.com/trustoverip/dtgwg-trust-tasks-tf/pull/226)).** The
  general rule was generalised *from* `task-consent/decision/0.1`, which already
  did it locally so that "a device revoked during the approval window MUST NOT be
  able to carry a task through it." Two things follow for us: approval is a
  *window* with live revocation semantics, not a moment; and `expiresAt` is
  deliberately **excluded** from item 12 — it bounds acceptance and does not
  abort work under way. Real completion deadlines live in the payload, and
  `task-consent/request/0.1` is the canonical example: its `payload.expiresAt`
  means "after this instant the pending request lapses and no decision is
  accepted for it." **The consent card's countdown reads `payload.expiresAt`,
  never the envelope's.**
- **`trust-task-ok`, the courtesy acknowledgement (§8.6,
  [#235](https://github.com/trustoverip/dtgwg-trust-tasks-tf/pull/235)).** Worth
  knowing precisely because it does *not* help with §4.3: "A producer **MUST
  NOT** rely on receiving an acknowledgement, and the absence of one carries
  **no information**." It is for the 17 fire-and-forget specs that define no
  success response, and it must never be sent in place of one a specification
  does define. It is not a delivery guarantee, so it does not substitute for
  durable-then-ack at the transport layer.
- **A binding must justify any allowance to omit an in-band proof (§9.1.1,
  [#225](https://github.com/trustoverip/dtgwg-trust-tasks-tf/pull/225))**, and
  the three DIDComm bindings now state a transport security profile
  ([#228](https://github.com/trustoverip/dtgwg-trust-tasks-tf/pull/228)) — the
  frame in which §2.4's ceremony carve-out has to be read.

- **The task digest (§4.9.3,
  [#236](https://github.com/trustoverip/dtgwg-trust-tasks-tf/pull/236) — ours,
  co-authored).** A citation relied on outside its exchange **SHOULD** carry a
  digest over the document it names, because "an `id` is a *name*" and §4.3's
  uniqueness obligation "constrains conforming producers and nobody else" —
  anyone may write a different document, with different parties and a different
  `payload`, and give it the same `id`. Computed as
  `multibase(multihash(H(JCS(document ∖ proof))))`, where the removal is of the
  **top-level** `proof` only: "a `proof` appearing *within* `payload` … is part
  of that payload's content and **MUST NOT** be removed." Three consumer rules
  a client gets wrong by default — recompute from the document you hold rather
  than trusting a carried value; compare **decoded multihash bytes, never
  encoded strings**, because one digest has more than one conforming encoding
  and "a string comparison rejects a valid pairing"; and where the hash
  algorithm is unimplemented, treat the citation as **unverified** — never
  recompute under a substitute, never "fall back to `id` comparison alone".
  This is the mechanism [[DTG-CRED]]'s VWC binding now sits on (§4.6).
- **Authorization is distinct from identity and proof (§7.2 item 10, §7.3 item
  15, [#226](https://github.com/trustoverip/dtgwg-trust-tasks-tf/pull/226)'s
  companion rule).** A consumer **MUST NOT** treat successful validation of a
  VID, `issuer`, `recipient`, transport-derived identity, or `proof` as
  establishing that anyone is authorized to request or perform the task, and
  **MUST** evaluate authorization separately before executing. The framework
  names the opposite inference — *valid proof + recognized issuer + correct
  recipient* read as an authorized instruction — as "the same confused-deputy
  vector", "most dangerous where the *producer* is an agent that can prove its
  identity but holds no authority to act." One concrete consequence for us:
  `task-consent`'s model, where a verified assertion *is* the authorization, is
  now an explicit declaration a specification makes under item 15 — **not an
  available default** a consent surface may assume.
- **The `ceremony` member (§4.11).** A document **MAY** now record that it is
  one step of a multi-task flow, carrying the enactment (globally unique and
  non-reusable, unlike `threadId`), the step's name, an optional content-pinned
  reference to a published ceremony definition, and optional predecessor
  digests. Three properties decide whether it is useful to us: it rides **on
  the document rather than in `payload`**, so "no *Trust Task specification*
  changes and any existing task may be composed into a flow its author never
  anticipated"; it is **covered by `proof`**, so "a step cannot be lifted into
  a different enactment or reinterpreted under a different definition"; and it
  **confers no authority** (§4.11.4, "membership is a claim, not a
  permission"), which is what makes it safe for a consumer to ignore the member
  entirely. A witnessed VRC exchange is exactly such a flow, so this is the
  framework mechanism the sibling subplan's Layer C composes on rather than
  inventing. The *content* of a ceremony definition is out of scope at 0.4 —
  0.4 defines only where definitions live and that a step references one by
  content as well as by name.

Also note `docs/02-vta/step-up-policy.md` is **deprecated** — a VTA whose config
still carries the retired `[auth.step_up]` sections will not start; `approvals.md`
is current. And `webauthn-vti-v1-cryptosuite.md` is **superseded, "do not
implement it"** — what survives is the document-binding rule
`clientData.challenge = base64url(SHA-256(canonical Trust-Task body))`.

### 4.6 What a credential must ship with it — the outcome-evidence pair

[[DTG-CRED]]'s `taskContext` binding moved while this plan was being written,
and it moved onto our own work: `taskDigestMultibase` landed in
[cred-spec #18](https://github.com/trustoverip/dtgwg-cred-spec/pull/18) from the
staged [Mickens-Lab#5](https://github.com/Mickens-Lab/dtgwg-cred-spec/pull/5) on
2026-08-17, and now *cites* the framework's task digest (§4.5) rather than
defining the computation from first principles. **#18 is still open** — Geoff's
review is answered but not merged — so this section states the shape we are
driving, not ratified text; Q7's reasoning applies here in the same way it
applies to #12. Three constraints follow. All three are wallet work, not spec
work, and none of them is visible in the Cypress implementation.

**1. The VWC carries two properties where it carried one.** `taskContext`
(REQUIRED) is the `id` of the exchange's initiating document;
`taskDigestMultibase` (REQUIRED) is the task digest over that document.
"`taskContext` locates; `taskDigestMultibase` binds", and the specification
strengthens the framework's SHOULD to REQUIRED for the VWC because a VWC's
`taskContext` is exactly a citation relied on outside its exchange. `id`
equality **MUST NOT** be treated as the binding: "it locates a candidate
document; only the digest match confirms it is *the* document."

**2. Outcome evidence is a pair, and the initiating document is half of it.**
Matching evidence is now "the exchange's initiating document together with a
terminal Trust Task document", paired as `terminal.threadId ==
(initiating.threadId ?? initiating.id)`. The indirection through the initiating
document is deliberate and is the part a holder cannot work around: §4.9 lets an
initiator mint a fresh `threadId`, so pairing the terminal document directly
against the credential's `taskContext` would orphan legitimate evidence
("pairing runs through the initiating document precisely so that an initiator
exercising §4.9's freedom … does not orphan legitimate outcome evidence"). A
holder that retained only the `#response` cannot complete the pairing.

This sharpens the parent plan's [§8.1 unscoped work
item](../openvtc-integration-plan.md#81-unscoped-work-item-vwc-outcome-evidence-retention),
which specifies
persisting the ceremony's `#response` and indexing it by the identifier
`taskContext` carries. Under the merged text that is not sufficient: the store
keeps **both** documents, the index is the initiating document's `id`, and
presentation assembly ships both and recomputes the digest over the initiating
document before pairing. The failure mode is the one the parent already
names — silent — with one more way to reach it.

**3. Edge-binding verification and selective disclosure cannot both apply to one
presentation, and edge-binding is what we keep.** A selectively-disclosed VRC
cannot satisfy `digestMultibase` verification, "the digest is over the full
canonical form", so "edge-binding verification and selective disclosure of the
same VRC are mutually exclusive in one presentation". Deriving a selective
disclosure at all requires a `bbs-2023` **base proof** — an `eddsa-jcs-2022`
proof cannot yield one — so an issuer needing both issues a **proof set**
carrying both suites; and because `bbs-2023` uses RDF canonicalization, the
offline-verification argument for `eddsa-jcs-2022` (no `@context` resolution at
verify time) does **not** extend to the ZKP path. The trade was taken on review
of the staged PR (2026-08-17), on two grounds: the privacy story leans on the
ZKP constructions rather than on per-field disclosure, and DTG credentials are
"small, atomic and meant to be composed", so selective disclosure is not a core
requirement. Recorded as standing rationale because the alternative — issuing
everything as a proof set — is a *credential-issuance* decision that cannot be
retrofitted at presentation time, so an implementer who needs it must know to
decide before issuing.

### 4.7 Two surfaces need super-admin, and that decides where they live

Backup/restore and approvals-management are both in scope (P3), and both sit
behind the VTA's strongest authorization tier. That is a fact about the wire,
not a preference we can design around:

- **All five `vta/backup/*` URIs are super-admin**, and every non-`initiate-*`
  one additionally checks caller-DID-owns-bundle "so a second super-admin can't
  snoop on the first's in-flight backup" (`vta-sdk/src/trust_tasks.rs:1148-1151`).
- **`policy/upsert/0.2` is super-admin**, with the reason stated at the
  constant: *"whoever can write policy can remove their own gate"*
  (`trust_tasks.rs:1283`). `pnm approvals` writes one reserved policy row
  through that family, so approvals-management inherits the tier.
- **`vta/seeds/*` is admin**, one tier lower.

**This plan's position: Keyring holds super-admin only for a VTA the user
personally owns, and the surfaces that need it are gated on that.** The PNM
persona *is* a personal VTA's owner, so the tier is not a privilege escalation
in that deployment — it is the deployment. But it does not generalise: a Keyring
enrolled as one device among many on somebody else's VTA should not be offering
these screens.

**The catch, and it is the whole difficulty: ownership is not on the wire.** The
VTA's claims carry the *tier* — super-admin — and say nothing about the holder's
relationship to the deployment. "My own agent" and "someone else's agent where I
happen to be super-admin" are indistinguishable from the session alone, so
"check the claims" cannot decide this on its own and any design that assumes it
can is wrong at the first shared VTA.

**Provisional design — capability follows the claim; consequence additionally
follows a local declaration.** Recommended, and flagged for review at the point
it gets expensive (§9 Q9):

1. **Ask once, at enrolment**: is this VTA yours, or are you a device on one
   somebody else runs? Store the answer locally beside the session. It is **not
   a security boundary** — the VTA authorizes every call regardless, and a user
   who lies to their own wallet gains nothing they did not already hold — it is
   a scoping input for what Keyring *offers*.
2. **Default to "somebody else's" when unanswered**, so the consequential
   surfaces are opt-in rather than opt-out.
3. **Reads follow the claim alone** — approvals and approver sets, seed list,
   backup status. These are the surfaces where being wrong costs nothing, and
   hiding them from a legitimate admin is pure friction.
4. **Discloses and writes require the claim *and* the declaration** — backup
   export, backup import/restore, mnemonic export, approvals-write. Each either
   discloses the VTA's key material or removes a gate, and on shared
   infrastructure each has consequences for people who are not holding the
   phone.
5. **Where the claim is present but the declaration is not, state the absence
   rather than hiding it.** A super-admin who knows they hold the role and finds
   no backup screen reads that as a bug and works around it; a one-line "not
   offered for an agent you don't own — change this in settings" is honest,
   costs one line, and is not a modal nobody reads.

The reasoning, since the conclusion is cheap to re-derive wrongly: this is a
**presentation** decision, not an access-control one. Getting it wrong cannot
cause a breach — the VTA refuses what the session may not do. What it can cause
is a person casually restoring a backup over infrastructure other people depend
on, and that risk is a property of the deployment, which only the user knows.
So the input has to come from them, once, cheaply, with the safe default.

The rejected alternative on *this* question: **inferring ownership** — from
being the first enrolled DID, from holding super-admin, from having performed
setup. Every signal is true of a legitimate co-administrator on a shared VTA,
so each one silently promotes exactly the case the gate exists for.

The rejected alternative, recorded so it is not re-proposed: **asking upstream
to add a weaker tier for backup** — a "backup-operator" role. It fails on the
same sentence that justifies the super-admin gate on policy. A backup contains
the whole VTA's key material, so a role that can export one *is* super-admin
with a different name, and a tier that appears to be weaker but is not is worse
than the honest gate.

### 4.8 Bulk bytes leave the envelope — and the transport invariant with them

The backup family is the one place in this plan where "the same document over
any transport" (§2.1) stops being true, and the design note says why: trust-task
envelopes are capped at 1MB per workspace policy, and "a serious VTA's backup
(audit logs + `did.jsonl` entries + imported secrets) blows that easily", so
"bulk bytes must flow out-of-band"
(`docs/05-design-notes/backup-descriptor-pattern.md`).

The shape is a three-phase descriptor pattern modelled on OCI blob upload
sessions, Sigstore and Git LFS: an `initiate-{export,import}` Trust Task returns
a **bundle descriptor** carrying a one-shot signed URL; the bytes move over
`GET`/`POST /backup/blob/{bundle_id}`, **deliberately REST-only** ("bulk bytes
are wrong on top of a JSON envelope", analogous to the public DID log mirror);
and `finalize-import` or the optional `complete-export` closes the audit loop.

Four constraints a phone implementation has to honour, each of which is a way to
lose a backup silently:

- **One-shot tokens.** They "expire on first successful read and on a short TTL
  (5 minutes)". A mobile download interrupted by a backgrounded app or a lost
  network cannot be resumed — it must be restarted from a fresh `initiate-export`,
  and the abandoned bundle closed with `vta/backup/abort/1.0`.
- **v1 buffers the full backup in memory** between phases; streaming is named as
  a future optimisation. On a phone that is a real ceiling, not a footnote, and
  it is the reason the acceptance criterion below names a size.
- **The encryption is unchanged and is not ours to vary**: the `.vtabak` format
  is Argon2id KDF + AES-256-GCM, and the descriptor pattern is "*transport*, not
  *encryption*". A wallet that re-wraps the bundle in its own scheme produces a
  file the operator's CLI cannot restore.
- **REST-only means the fallback ladder does not apply.** A Keyring that has
  negotiated DIDComm or TSP still needs a reachable REST base URL for the blob
  leg alone. Where it has none, backup is unavailable and must say so, rather
  than appearing to work through a transport that cannot carry it.

---

## 5. Relationship credentials — what exists, and what we would be building

The demo we want is **a Keyring wallet and a CLI exchanging VRCs**. The
ecosystem has two unrelated things under that name, and the difference decides
the phase.

### 5.1 In the VTI stack, "VRC" is a community publish — with no counterparty

The VTI's relationship surface is four VTC-scoped tasks bound in
`vtc-service/src/routes/mod.rs`:

```
https://trusttasks.org/spec/vtc/relationships/publish/0.1   POST   /v1/relationships
https://trusttasks.org/spec/vtc/relationships/list/0.1      GET    /v1/members/{did}/relationships
https://trusttasks.org/spec/vtc/relationships/revoke/0.1    DELETE /v1/relationships/{id}
https://trusttasks.org/spec/vtc/relationships/graph/0.1     GET    /v1/relationships/graph   (admin only)
```

The member mints the credential locally and **POSTs it to the VTC**, which
verifies the proof and persists a row; *"the VTC never mints VRCs… The community
signer is uninvolved"* (`vtc-service/src/relationships/mod.rs:37-44`). **The
subject is never contacted** — no delivery, no notification, no acceptance step;
they discover the edge by polling their own `list`. Both parties must already be
members of the same VTC. There is no DIDComm or TSP path: relationships are
REST-only (`vtc-service/src/messaging.rs:708-715`).

Two traps: the code calls it a *"Verifiable **Recognition** Credential"* and the
wire type tag is `["VerifiableCredential","VerifiableRecognitionCredential"]`
(`vtc-service/src/routes/relationships.rs:60-62`) while the docs say
"Relationship".

**And the registry is ahead of the implementation here — check both.**
`vtc/relationships/request` exists **in the Trust Tasks registry** (we built
[`ref-06v1c`](../../../tsp-reference/ref-06v1c-task-layer/) against it and
confirmed it fits) but has **no route in `vtc-service`** at Cypress. More
consequentially, [#214](https://github.com/trustoverip/dtgwg-trust-tasks-tf/pull/214)
moved `vtc/relationships/{request,publish,list}` to **0.2**, replacing the bare
lowercase-hex `vrcSha256` with `vrcDigestMultibase` over the RFC 8785
canonicalization. The framework editor's reason is that `0.1` **named no
canonicalization at all** — "'SHA-256 of the VRC' is not reproducible for a JSON
document" — while all three specs promise the digest is *the same value*, which
it could not reliably be: "a live interoperability defect in a shipped family,
not a tidiness item" ([#173](https://github.com/trustoverip/dtgwg-trust-tasks-tf/issues/173), 2026-08-15).

The `vrcSha256` shape quoted above is therefore the **0.1 form still deployed in
`vtc-service`**, against a registry that has published 0.2. `0.1` stays valid and
generated, so nothing breaks, but **new work targets 0.2** — and any phase that
touches this family must read the registry and the VTI implementation, because
they disagree today.

**This is not a peer-to-peer exchange**, and it is not what Keyring's VRC module
does. It is a community-custodial edge registry.

### 5.2 The peer-to-peer exchange exists — in the `openvtc` CLI, not in VTI

The interop counterparty is the **`openvtc` TUI CLI**
(`/home/brendan/code/seas/openvtc`, tag Cypress, 3797dd0), whose
`docs/relationships-vrcs.md` documents a three-phase handshake on Persona DIDs
followed by a VRC exchange on freshly-minted Relationship DIDs:

```
relationships request → accept → finalize        (P-DIDs)
        then, on the R-DIDs:  VRC request → VRC issued
```

It is **plain DIDComm v2 with bespoke types**, not Trust Tasks
(`openvtc-core/src/{relationships,vrc,messaging}.rs`):

```
https://linuxfoundation.org/openvtc/1.0/relationship-request
https://linuxfoundation.org/openvtc/1.0/relationship-request-accept
https://linuxfoundation.org/openvtc/1.0/relationship-request-reject
https://linuxfoundation.org/openvtc/1.0/relationship-request-finalize
https://firstperson.network/vrc/1.0/request
https://firstperson.network/vrc/1.0/issued
https://firstperson.network/vrc/1.0/rejected
```

The same binary *does* use Trust Tasks — for VTA operations (agent names, join
requests) via `VtaClient::dispatch_trust_task`
(`openvtc/src/state_handler/agent_name_manage.rs`). So the split is: **VTA
operations are Trust Tasks; peer-to-peer relationship exchange is still a
pre-Trust-Task bespoke protocol.**

### 5.3 What this means for the demo

1. **`pnm-cli` cannot be the counterparty.** Its `Commands` enum has 20 variants
   and none of them is `relationships` (`pnm-cli/src/cli.rs:92`); grep for
   relationship/VRC across `pnm-cli`, `cnm-cli`, `vta-cli-common`, `vta-sdk` and
   `vta-mobile-core` returns nothing relevant. **The "CLI PNM" in the demo is
   `openvtc`, not `pnm`.**
2. **And `openvtc` has no headless relationship surface either — which is the
   constraint that shapes P4.** The binary declares exactly two subcommands,
   `setup` and `health` (`openvtc/src/cli.rs:36-44`); everything else is a
   ratatui TUI driven through `state_handler/relationship_actions.rs` (2124
   lines). So the three-phase handshake cannot be scripted from a terminal
   today, in either CLI. An automated Keyring↔CLI interop test has **no
   counterparty it can drive** — which is why P4 carries a prerequisite
   contribution rather than an assumption.

   The good news is where the coupling isn't: **`openvtc-core` is UI-free**
   (no `ratatui`/`crossterm` in its `Cargo.toml`) and holds the entire protocol
   — `relationships.rs` (1273 lines), `vrc.rs`, `messaging.rs` — behind a public
   API (`generate_profiles`, `create_send_message_accepted`,
   `create_send_message_rejected`, `VrcRequest::create_message`, the
   `Relationships`/`Vrcs` stores). Headless subcommands are a thin dispatcher
   over code that already runs without a terminal, not a port.
3. **The credential is not the problem; the protocol is.** `openvtc` carries
   `dtg_credentials::DTGCredential` (`Cargo.toml:40`, crate 0.2), and Keyring's
   VRCs already use the `DTGCredential` base type and `firstperson.network`
   contexts (`bifold/packages/vrc-contexts/src/{relationshipContext,
   witnessedExchangeContext}.ts`). Interop is a protocol and canonicalization
   question, not a data-model rewrite.
4. **It requires DIDComm v2**, which Credo cannot speak (parent §3), so it rides
   `@openvtc/vti-didcomm-js` beside Credo — the arrangement the parent plan
   already specifies for VTI features, and the stack `pnm-core` uses. Bodies are
   small (`RelationshipAcceptBody { did }`, `RelationshipRejectBody { reason }`).
5. **Our sibling subplan is ahead of upstream here.** `trust_tasks_subtask.md`
   §9 step 6 designs the relationship tasks as Trust Tasks; upstream has not made
   that move on the peer-to-peer path, and TSP's own relationship control FSM is
   declared-but-dead (`XRFI`/`XRFA`/`XRFD` markers exist in
   `packages/tsp-js/src/cesr/wire.ts:105-107` with no reader or writer).
   **Namespace note:** the framework editor settled ours as **`vrc/relationships/*`
   — plural**, matching `vtc/relationships/*`, with `witness/` staying top-level
   ([#173](https://github.com/trustoverip/dtgwg-trust-tasks-tf/issues/173), 2026-08-14).
   The sibling subplan still writes `vrc/relationship/*` singular in places and
   should be reconciled to the settled form.
6. **Credential delivery has a designated idiom, and it is not a new task.** The
   editor's standing guidance to us is to *"build VRC/VWC delivery on
   `vtc/members/vmc` / `vtc/join-requests/accept`"* (ibid., 2026-08-15), having
   retracted an earlier suggestion to reconcile `vtc/members/vmc` onto a shared
   issuance-receipt shape — `vmc` is a **delivery** receipt, not an issuance one,
   and adopting the issuance shape "would oblige the community to echo the
   credential back to the party that just sent it". P4 and P5 follow that idiom
   rather than inventing a delivery task.

**Design position:** implement the `openvtc` dialect first, because it is what
exists and it makes the demo real; treat it as a **compatibility dialect**
isolated behind the same task-model boundary the recast will use, so migration
is a carriage change and not a second spine. This mirrors the lossless old⇄new
translator already proven for the witness stack (parent ref-06w2). The VTC
publish path (§5.1) is a *different* capability and belongs with P5, not here.

*(`openvtc` is **not in `scripts/openvtc/PINS.json`**. It must be added, with
`dtg-credentials` as a tripwire, before P4 can claim a pinned baseline — §9 Q5.)*

---

## 6. The phases

Every step names what makes it **done**, per [`../CLAUDE.md`](../CLAUDE.md), and
what is **foreseeable but deferred**, so a later reader can tell "not yet" from
"not needed". New rungs use a `ref-1N` series to avoid the parent ladder's
reserved `ref-07…09`.

### P0 — Portability proof (`ref-10-pnm-core-hermes`)

The cheapest decisive experiment, and the only one that can invalidate §3
cheaply rather than expensively. Bundle `pnm-core`'s offline surface —
`src/vta/smoke.ts`, the `trust-tasks/` canonicalization and proof path, the
`didcomm/` pack/unpack — and run it under Node 20, under the app's Hermes VM
binary, then in the app. This is the parent's ref-03b/ref-03c method one layer
up, reusing that harness.

**Done when:** identical inputs produce byte-identical outputs under Node and
Hermes, *including* a JCS-canonical `eddsa-jcs-2022` signing input compared
against a known-good VTA/engine output ([[MOBILE-ARCH]] §8 item 4: "Verify
against a known-good engine output before trusting it"); the ed25519→x25519
birational map is checked against an upstream vector; and the exact shim list is
enumerated in the rung's README against §3.3's table.

**Foreseeable:** that shim list becomes the scope of the upstream portability PR.

### P1 — The approver (`ref-11-approver`)

**Keyring becomes useful with no VTA account.** Per §2.4, a device answering
only the three ceremony tasks needs no ACL entry and no token. Inbound
`task-consent/request/0.1` or `auth/step-up/approve-request/0.2` over an
authcrypt DIDComm session → verify the request's own DI proof against a
locally-held trusted-executor set → render the VTA's `effects` → human decision
gated on Secure Enclave / StrongBox → signed `task-consent/decision/0.1` or
`auth/step-up/approve-response/0.2`.

Note what must be built rather than adopted: **there is no SDK client helper for
`task-consent/decision/0.1`** — it is server-side only at this tag, and
`vta-mobile-core/src/consent.rs` is the reference implementation. The inbound
`*/request` types are VTA-produced and therefore absent from `ALL_URIS`; Keyring
must parse them.

Two deliverables here are ours specifically:

- **Durable-then-ack** (§4.3) — the inbound body is persisted before the
  mediator is acknowledged. The fix the extension cannot make alone.
- **Hardware-attested decisions** — where the browser wallet gates on WebAuthn
  PRF, Keyring gates on Secure Enclave / StrongBox. Note that
  `device/register`'s `attestation` and `keyCustody` fields are *"accepted but
  not yet acted on"* server-side (`vta-service/src/trust_tasks/device.rs:40-41`),
  so at Cypress this is evidence we carry, not a gate the VTA enforces — a
  contribution opportunity, and an honest limit to state in any demo.

Push completes the loop: `push/register/0.2` to the gateway, `device/set-wake/0.2`
to convey the opaque `WakeHandle` to the VTA, contentless wake-ups triggering a
mediator pickup ([[MOBILE-ARCH]] §4.8, whose instruction is that "a new client
should target the gateway model directly"). Keyring already has
`@react-native-firebase/messaging`.

**Done when:** a VTA-initiated privileged operation wakes a backgrounded Keyring
by push, renders only verified `effects`, and both approve and deny round-trip
with the VTA acting accordingly; a request signed by a non-enrolled executor
never reaches a rendering surface (negative test); killing the app between
mediator delivery and the user's decision loses nothing; the consent match code
matches the decoded-bytes behaviour of §4.2 under fixture; and the runbook
states the two different setup costs of §2.4 — nothing for step-up,
approver-set membership for consent.

**Foreseeable:** this is the spine every later ceremony reuses, and it is parent
§6 milestone 2's second half already.

### P2 — Enrolment and an authenticated session (`ref-12-pnm-enrol`)

Everything the approver did not need: a VTA account, a bearer session, and the
management surface.

**The hard truth this phase has to absorb: there is no self-service enrolment
anywhere in the stack.** `POST /auth/challenge` is ACL-gated *before* a nonce is
minted (`vti-common/src/auth/handlers/challenge.rs:33` →
`vti-common/src/acl/mod.rs:769-780`, `Forbidden("DID not in ACL")`), so an
unknown DID cannot even obtain a challenge. There is no QR code, pairing code,
invite token or OTP for VTA enrolment anywhere in the repo. Every path ends in a
**human operator running a CLI command out of band**. The three real options:

| Option | Shape | Cost |
|---|---|---|
| **Operator grant** | Keyring displays its `did:key`; an operator runs `pnm acl create --did … --role admin`, then the client auto-rotates via `acl/swap-key/0.1` | smallest; needs a human step |
| **provision-integration** | signed `BootstrapRequest` VP → HPKE-sealed bundle containing **VTA-minted** long-term keys; `pnm-core`'s `runProvisionIntegration` implements the wallet side | larger; still needs an out-of-band ACL grant for the ephemeral |
| **TEE sealed bootstrap** | attestation-gated, single-use, "closes permanently on first success" | not applicable to a phone |

`pnm-core`'s live path is the second (`src/provision/run.ts`); the first exists
in `src/onboarding/swap.ts` but is marked "currently unused". **We should
prefer the first**, because provision-integration hands the wallet a private key
that was generated off-device — irreconcilable with hardware attestation being
our differentiator (§9 Q2, worth deciding before P2 ships rather than after).

Then the session itself: `auth/challenge` → `auth/authenticate` with a real
`eddsa-jcs-2022` proof, honouring §4.1's `did:key`-only and proof-less-signing
rules. Note the auth family is **REST-routed** — not reachable via
`/api/trust-tasks` — and refresh tokens **rotate on every use** (RFC 6749
§10.4), so the new one must be persisted before the next refresh or the session
is unrecoverable.

**Done when:** a Keyring build enrols against a local Cypress VTA and completes
`auth/authenticate/0.1` with a proof the VTA accepts; the `IS_PROOF_REQUIRED`
matrix is honoured per-operation and tested; `vta/contexts/list/1.0` returns over
REST and, unchanged, over DIDComm v2; a refresh preserves AAL and the rotated
token is persisted atomically; **enrolment records the §4.7 ownership
declaration — is this VTA yours, or one somebody else runs — defaulting to
"somebody else's" if the question is skipped, stored beside the session and
changeable afterwards**; and enrolment is documented as a runbook, including the
operator's out-of-band step.

Note that the declaration is the one part of this phase that later phases cannot
add cheaply: it sits in the enrolment flow, so P3's consequential surfaces
inherit it (§4.7) and retrofitting it means revisiting a shipped onboarding.
That is why it lands here even though nothing in P2 itself reads it.

**Foreseeable:** the TSP channel is a third `TrustTaskChannel` against the same
`VtaSession` — no domain-op changes — once `vta-service` ships TSP enabled
(§2.3). A self-service enrolment ceremony is a genuine ecosystem gap and a
candidate contribution (§8).

### P3 — The wallet surface (`ref-13-wallet-surface`)

The remaining end-user operations, cheap now that P1 and P2 built the spine.
Build order follows proof cost and user value:

1. **Credential vault** — `vault/credentials/{receive,query,get}/0.1` then the
   archival lifecycle. No DI proof required (they are unspecced upstream, so
   `IS_PROOF_REQUIRED` defaults false) and plain `VaultRead`/`VaultWrite`.
2. **This device's own management** — `device/{register,heartbeat,list,disable,
   wipe}`, `auth/sessions/list/0.1` and `auth/revoke-session/0.1` ("sign out my
   other devices"). Prefer the `0.2` forms: the Rust SDK still emits `0.1`, but
   `0.2` is the non-deprecated wire form and the delta is only camelCase enum
   values.
3. **Self-service** — `auth/whoami/0.1`, `messaging/ping/0.1`, and `acl/list`.
4. **Approvals management** — the configuration half of what P1 answers.
   `consent/approver-list/1.0` to read the bindings and
   `consent/approver-set/1.0` to bind an approver; the rules themselves are
   written through `policy/upsert/0.2`, which `pnm approvals require` wraps —
   it "writes one reserved row through this same family, with the rules
   validated and the Rego generated for you" (`pnm-cli/src/cli.rs:2022-2025`).
   Read-only first: a phone that can *show* which task types demand approval and
   who may give it is most of the value, and it needs no super-admin. Writing
   rules does (§4.7).

   **What cannot be built at Cypress, and why it is worth knowing before
   designing the screen:** there is no way to ask "would this task need approval
   here?". `policy/evaluate/0.3` is deliberately **not served**, because its
   `input` schema still marks `site` — "a vault-flow `SiteTarget` (a web origin,
   an app binding)" — as required, inherited from the family's vault origins
   before 0.3 generalised it to any Trust Task. The SDK states the objection
   plainly: *"There is no honest `site` for 'would `acl/grant` need approval
   here', and inventing one means fabricating a member of a security decision's
   input to satisfy a validator"* (`vta-sdk/src/trust_tasks.rs:1289-1300`).
   `pnm approvals explain` therefore answers from the declarative rules, and so
   do we. §8 #7 carries the fix.
5. **Seeds** — `vta/seeds/list/1.0` and `vta/seeds/export-mnemonic/1.0` (Admin,
   not super-admin). **Name the screen for what it exports.** This is the
   **VTA's** BIP-39 seed, not the phone's key material: it "operates on the seed
   identifier, not an individual key", it is one-shot under `MnemonicExportGuard`
   and "zeroized on drop" (`vta-sdk/src/trust_tasks.rs:1382-1389`). A wallet
   screen labelled "your recovery phrase" over this task tells the user something
   false — Keyring's own Askar store is backed up by Keyring's own mechanism and
   has nothing to do with this family. `vta/seeds/rotate/1.0` is deliberately not
   built: rotating a VTA's seed from a phone is an operator action with no
   recovery path if it half-completes.
6. **Backup and restore** — the five `vta/backup/*` tasks plus the REST blob leg,
   under the constraints of §4.8 and the tier of §4.7. Export first; import is
   the same pattern with the bytes moving the other way and a `finalize-import`
   that can run in preview mode.
7. **Power-user, optional** — the password vault and `vta/memory/*`.

**Done when:** each implemented family round-trips against a live VTA with local
payload-schema validation before send (§2.1); every operation **except the
backup blob leg** works unchanged over REST and DIDComm v2, and the blob leg's
REST-only requirement is surfaced as an explicit precondition rather than a
failure (§4.8); **a retry re-sends the document unchanged and only a genuinely
new request mints a new id**, including on cross-transport fallback, and a
`duplicate` refusal is handled by reading the prior outcome rather than
reissuing (§2.2); the credential store retains, for every `taskContext`-bearing
credential it holds, both the exchange's initiating document and its terminal
document, indexed by the initiating document's `id` (§4.6); and unknown or newer
minors of `trust-task-error` are handled without a crash.

**Additionally, for the three surfaces this phase newly absorbs:**

- **Approvals** — the rules and approver sets a VTA holds are readable from
  Keyring and match `pnm approvals list` against the same VTA; the write paths
  are offered only where the session carries super-admin **and** the §4.7
  ownership declaration says the VTA is the user's own, and are otherwise
  rendered as a stated absence rather than failing on submit or vanishing
  silently; and the UI never claims to predict whether a given task would
  require approval, because it cannot (item 4 above).
- **Seeds** — the mnemonic export completes once and is refused on a second
  attempt against the same guard; the surrounding copy names the VTA as the
  subject of the export; and the value is held only as long as it is displayed.
- **Backup/restore** — a backup exported from Keyring restores through
  `pnm backup import` against a second VTA, and one exported by `pnm` restores
  through Keyring: the `.vtabak` bytes are unmodified in both directions, which
  is the test that we did not re-wrap them (§4.8). An export interrupted
  mid-download leaves no reusable token and the abandoned bundle is closed with
  `vta/backup/abort/1.0`. A bundle larger than the device can hold in memory
  fails with a stated limit rather than an out-of-memory crash — v1 buffers
  fully, so the ceiling is real and must be measured on the lowest-spec target
  device rather than assumed. Export, import and mnemonic export are gated on
  the §4.7 declaration as well as the tier, and the negative case is tested: a
  session holding super-admin on a VTA declared as somebody else's is offered
  none of the three.

**Explicitly and permanently out of scope:** `services {enable,update,disable,
rollback}` and drain management (§2.1), hand-authored Rego policy
(`policy/upsert` as a raw module — the *declarative* approvals row above is in,
the Rego editor is not), `vta/seeds/rotate/1.0`, all 23 `did-management/*`
(outbound producer-only — the VTA sends these, never accepts them), and
`vta/credentials/{issue,revoke}` (AAL2 admin). These are server-operator
surface, `pnm-cli` serves them well, and putting them on a phone adds risk
without adding a user.

The line this list draws is **"would a person administering their own VTA from
their own phone need it?"**, not "is it privileged?" — several items above the
line need admin or super-admin and are in scope anyway (§4.7). Backup/restore
and mnemonic export sit above it because a personal agent whose state cannot be
recovered from the device that manages it is not a personal agent; the Rego
editor and seed rotation sit below it because both are ways to lock yourself out
of your own VTA with no recovery path, and neither becomes safer on a small
screen.

### P4 — VRC interop with the CLI (`ref-14-vrc-interop`)

The demo (§5.2): a Keyring wallet and an `openvtc` CLI establish a relationship
and exchange VRCs. Implement the seven bespoke DIDComm v2 types as a
compatibility dialect behind the task-model boundary.

**Prerequisite, and it is upstream work: `openvtc` needs headless relationship
subcommands.** Per §5.3 item 2 the protocol is only reachable through the TUI,
so there is nothing an automated test can drive. The contribution is a thin
dispatcher over `openvtc-core`'s existing UI-free API — enough to run one side
of the handshake from a script:

```
openvtc relationships request <p-did>     # send a relationship-request
openvtc relationships list                # pending + established, JSON out
openvtc relationships accept <task-id>    # → relationship-request-accept
openvtc relationships reject <task-id>
openvtc vrc request <r-did>               # → firstperson.network/vrc/1.0/request
openvtc vrc list
```

Shaped to the repo's own conventions: `health` is the precedent for a read-only
subcommand that emits machine-readable output and exits non-zero on failure, and
the same `--profile` / `--unlock-code` arguments already gate config access. The
work is exposure, not protocol — `create_send_message_accepted`,
`create_send_message_rejected`, `VrcRequest::create_message` and the
`Relationships`/`Vrcs` stores are all public in `openvtc-core` today.

**Do this before the Keyring side, not alongside it.** It is the only piece
that gates a *repeatable* interop test, it is small, and building the Keyring
dialect first would mean hand-driving a TUI for every run — which produces a
demo but not evidence, and the ladder's whole discipline is that a rung is
re-runnable.

**Done when:** the three-phase handshake completes in both directions between
Keyring and `openvtc` at its pinned commit, **driven end-to-end from a script
with no human at the TUI**; each side stores the other's VRC; Keyring's issued
VRC deserializes as a `dtg_credentials::DTGCredential` 0.2 and verifies on the
CLI side, and vice versa; R-DID privacy holds (the VRC leg runs on R-DIDs, not
P-DIDs); and the exchange replays from frozen fixtures without a live CLI.

**Foreseeable:** the same exchange over `vrc/relationships/{propose,issue}` Trust
Tasks once the sibling subplan's specs land — at which point Keyring is the
second implementation the framework's candidate status requires (parent §2.3),
and the dialect becomes a translator we retire on our own schedule.

### P5 — Community membership (`ref-15-vtc-join`)

The member's half. A person submits a join request to a VTC and receives a
Verifiable Membership Credential. This is the VTC surface of §2.5 — a different
service, REST-only, `Trust-Task`-header-gated.

The applicant leg is unusually self-contained and is the reason this is
tractable: `submit_join` POSTs a **self-signed** `vtc/join-requests/submit/0.1`
Trust Task to `/trust-tasks` with **no bearer token and no header** — the
document's own `eddsa-jcs-2022` proof is the credential, and it is audience-bound
to the VTC DID so a captured submit cannot be replayed into another community
(`vtc-client/src/lib.rs:456-536`). The applicant DID must be a `did:key`. The
verdict comes back as a `#response` with effect `allow | deny | refer |
request_more`; `allow` returns the VMC inline.

**The reciprocal VMC is not bookkeeping — it is the member's consent, and the
spec is changing under us.** [[DTG-CRED]] asserted in five places that two VMCs
form a membership edge while its schema made the reverse credential
unconstructible; **[cred-spec #12](https://github.com/trustoverip/dtgwg-cred-spec/pull/12)**
(open, Geoff Turk, resolving [issue #8](https://github.com/trustoverip/dtgwg-cred-spec/issues/8))
fixes the schema and writes down the rationale:

> The pair is deliberate: the member-issued VMC is the member's consent artifact.
> A community can always issue a credential naming someone as a member, but it
> cannot produce the acknowledgement without that party's signature, so requiring
> both directions makes an unconsented membership claim unprovable.

Three consequences for this phase, none of which the Cypress implementation shows:

- **The acknowledgement carries a `digest` binding it to the grant, "reusing the
  existing VWC digest algorithm verbatim"** — so the digest work of §4.6
  ([cred-spec #14](https://github.com/trustoverip/dtgwg-cred-spec/pull/14) for
  the edge digest, [#18](https://github.com/trustoverip/dtgwg-cred-spec/pull/18)
  for `taskDigestMultibase`) becomes load-bearing for membership too. Keyring is
  already the implementation of that algorithm, which is the cheap part; §4.6's
  retention rule is the part this phase has to budget for.
- **The verifier rule is deliberately direction-sensitive**, and #12 flags it as
  the part to review closely: a member presenting *their own community-issued*
  VMC is accepted alone, because presenting is itself the consent. A blanket
  "both always" would break the Community-Anchored ZKP and PHC constructions,
  which rely on the member holding only the community-issued half. A wallet that
  demands both halves before displaying a membership would therefore be wrong.
- **Per-direction witnessing now generalises from VRCs to both edge-credential
  subtypes**, so a witnessed membership edge has a defined
  `credentialSubject.id` binding — which connects P5 to the witness work rather
  than leaving it a separate island.

Revocation is explicitly deferred to a *planned Trust Task Protocols
specification*, so it is out of scope here and should not be improvised.

**Done when:** Keyring completes a join ceremony against a running `vtc-service`,
stores the community-issued VMC, and closes the reciprocal half with a correctly
computed acknowledgement digest; a membership is displayed from the
community-issued half **alone**, without requiring the acknowledgement (the
direction-sensitive rule); `refer` (pending) and `request_more` are represented
honestly in the UI rather than as failures; and the member's own status and
relationship list are readable.

**Blocked on:** cred-spec #12 landing, or an explicit decision to build against
it while open (§9 Q7); and confirming the VTC API shape has not moved (§9 Q4).
This is the phase most exposed to upstream churn, which is why it is late.

### P6 — Community administration (CNM scope)

The admin half. Per §2.5 this is scope and presentation over the P2–P3 spine,
not new transport work — but it **spans two services**, and that split is the
thing to get right before designing a screen:

| Surface | Service | Client | Auth |
|---|---|---|---|
| Membership: list members, list/approve/reject join requests, remove member, update member extensions | **VTC** (:8200) | `vtc-client` (REST-only, per-route `Trust-Task` header) | community admin, `aud: "VTC"` |
| Community policy: list, get, upload, activate | **VTC** | `vtc-client` | community admin |
| Contexts, ACL, auth-credential generation, audit-verify, keys, DID templates, backup | **VTA** (:8100) | the P2–P3 spine unchanged | admin / super-admin (§4.7) |

**The `cnm-cli` surface is not the membership surface.** `cnm community
{list,use,add,remove,status,ping}` manages *which communities this client talks
to* — local configuration — and its 13 subcommands are `Setup, Community,
Health, Auth, Config, Keys, Contexts, Acl, AuthCredential, Backup, Audit,
Bootstrap, DidTemplates` (`cnm-cli/src/main.rs:109`). Nothing in it decides a
join request. The membership operations live in `vtc-client`
(`list_join_requests`, `approve_join`, `reject_join`, `list_members`,
`remove_member`, `update_member_extensions` — `vtc-client/src/lib.rs:279-436`),
against the VTC. So a Keyring CNM is **not** a port of `cnm-cli`; it is the VTA
surface P3 already built, re-scoped, plus a VTC client P5 already stood up.

That also means the tokens do not interchange: the VTC issues its own JWT with
`aud: "VTC"` and **cross-audience tokens are rejected** (§2.5), so a Keyring
holding a live VTA session still authenticates separately against the VTC.

**Done when:**

- A community admin reviews the pending join queue from Keyring and can approve
  or reject a request, with the decision visible to the applicant's own wallet
  (the P5 leg, run against a second device or a CLI applicant).
- The member roster lists and filters by role, and a member can be removed.
- The VTA-scoped `cnm` surface — contexts, ACL, auth-credential generation and
  audit-verify — is reachable at community-admin scope and refuses legibly at
  lower scope, sharing P3's implementations rather than forking them.
- Every operation is refused legibly when the session lacks community-admin
  authority, and a VTA token is never presented to the VTC (or vice versa) —
  tested, because the failure is a `401` whose cause is not obvious from the
  message.
- Community policy is **readable**; upload and activate are behind the same
  reasoning as P3's Rego exclusion and are out of scope unless §9 Q10 settles
  otherwise.

**Deliberately conditional.** This phase assumes a persona who administers a
community from a phone. It is placed last and nothing depends on it, so if that
persona is not real, cutting P6 costs nothing.

**One inherited hazard, restated because it lands here:** `vtc-client`'s own
header records that every method in it was broken until the `Trust-Task` header
was added, and its only in-workspace consumer is a self-test (§2.5). P6 is the
first real consumer of six of those methods, so treat every one as unproven
until it round-trips — the same posture P5 takes for `submit_join`.

### Foreseeable beyond the phases

Named so they are recognisable later; none scheduled. **TSP as a third channel**,
when `vta-service` ships it enabled. **The upstream portability contribution**
(§8). **Tier-1 custody** — key agreement inside the enclave; [[MOBILE-ARCH]] §9
notes "the FFI is pre-shaped for it", and today's DIDComm X25519 key is
software-held even on the iOS reference agent (`vta-mobile-core/src/didcomm.rs:8-15`),
which our attestation work could improve on. **Server-side attestation
verification**, once the VTA acts on `device/register`'s `attestation` field.
**`did:webvh` resolution**, shared with parent Phase D item 3. **"Meet your
Agent"** — parent §6's showstopper sits directly on P1's consent spine and P3's
typed operations.

---

## 7. Sequencing against the parent plan

**Recommendation: interleave, as a parallel track starting now, not a track
gated on Phase E.**

The parent passed its Phase C→D gate on 2026-08-17: what remains is "integration
engineering, not discovery" — the trust-task client module, real
`eddsa-jcs-2022` verification, the `did:webvh` resolver adapter, the
`rceVersion: 4` gate. **P1 needs the first two and nothing else**, and it
exercises them against a live counterparty rather than fixtures — stronger
evidence than the parent currently has for either.

That is the argument for interleaving rather than merely permitting it. The
parent's own discipline — two independent implementations for adapters (§4.4)
and bindings (§7.9) — applies to its Phase D deliverables too, and PNM is their
second consumer. Building them for one consumer and finding the leak later is
exactly the failure mode the two-adapter rule exists to prevent.

| Parent | This document | Relationship |
|---|---|---|
| Phase D — ports, Credo adapter, JCS signer | P0, P1 | PNM consumes the JCS signer and the trust-task client; P0 runs first because it is cheap and gates §3 |
| Phase D/E — `vti-client` package | P1–P3 | Same package; PNM is most of its content |
| Phase E — RN assembly | P1–P3 | Shared RN edges: storage, custody, push |
| Sibling subplan §9 step 6 — `vrc/relationships/*` | P4 | P4 first over the bespoke dialect; the recast migrates it |

**One new external dependency in the critical path.** P4 now opens with an
upstream contribution to `openvtc` (§8 #6). It is small and it is ours to write,
but it lands in someone else's repo, so P4's *evidence* — a scripted, repeatable
interop run — is gated on review there in a way no earlier phase is. Two
consequences worth planning around: start the `openvtc` PR early, well before
the Keyring dialect is ready, since latency is the risk rather than effort; and
keep the ladder's own rung runnable against a locally-built `openvtc` branch
meanwhile, per the parent's rule that the ladder never blocks on upstream review.

**Two ordering constraints, and only two.** P0 before any commitment to §3's
architecture. And P1 before P2 — inverting them means solving enrolment, which
needs an out-of-band operator step and an unresolved custody decision (§9 Q2),
before shipping the one capability that needs neither.

---

## 8. Contributions this generates

Consistent with the parent's posture rules and its approval-gated review
workflow (parent §7) — nothing is pushed anywhere without review:

1. **`pnm-core` made runtime-agnostic** (scope = P0's shim list). The same shape
   as our HPKE contribution one layer down, making upstream's own PNM library
   usable on every non-browser runtime. Restates parent §7 #5 from "propose a
   new repo" to "port the existing one", on §3.3's evidence.
2. **Durable-then-ack in `vti-didcomm-js`** (from P1) — the open defect in
   [[PLUGIN-GUIDE]] the extension cannot fix alone, with Keyring as the
   implementation that proves the contract change.
3. **A React Native section for [[MOBILE-ARCH]]**, plus corrections: the §4.5
   dual-transport claim contradicts the code (§4.4), and the whole document
   describes a crate two minors old. The doc invites a port; we will have
   executed a third strategy it does not consider, and the reason it does not
   (the TypeScript library matured after the snapshot) is worth writing down.
4. **Interop evidence for the VRC exchange** (from P4) — the input the sibling
   subplan's recast needs to argue for migration upstream rather than only for
   our convenience.
5. **A self-service enrolment ceremony**, if we build one (P2). Nothing in the
   ecosystem has one; every client today depends on an operator running a CLI
   command. A wallet is exactly the context where that gap hurts most.
6. **Headless relationship subcommands for `openvtc`** (P4's prerequisite). The
   protocol is implemented and UI-free in `openvtc-core`; only the terminal
   surface is missing, and its absence is what makes the exchange
   untestable-by-anyone rather than just untestable-by-us. This is the smallest
   contribution on the list and the one that unblocks the most: it gives the
   ecosystem its first scriptable relationship counterparty, which is a
   precondition for *any* second implementation of the peer-to-peer path, ours
   included.
7. **Relax `site` to optional in the policy-evaluation input schema.** Upstream
   has already named this as wanted — `vta-policy`'s mirror of the schema
   "already carries this as a known upstream wart … a follow-up should relax
   `site` to optional in the schema itself" — and until it lands,
   `policy/evaluate/0.3` stays unserved and no client can answer "would this
   task need approval here?" (P3 item 4). A wallet is the context where that
   question is most natural to ask, which makes us the right implementer to
   press it.
8. **The tamper-evident `taskContext` binding — already contributed, and now
   ours to implement.** `taskDigestMultibase` merged into cred-spec #18 on
   2026-08-17, on the framework's §4.9.3 task digest we co-authored (#236).
   Listed here not as future work but because it inverts: §4.6 turns a
   contribution we made into implementation debt the phases carry, and a
   specification whose only implementation does not satisfy it is worse for us
   than one we never wrote.

---

## 9. Open questions and what they block

1. **Settled: `openvtc` is the counterparty, and we give it a headless
   surface.** §5.3 establishes that `pnm-cli` has no relationship code at all
   while `openvtc-core` has all of it, so extending `openvtc` reuses a working
   implementation where extending `pnm-cli` would mean porting the protocol into
   a crate that has never seen it. Recorded as standing rationale rather than
   deleted, because "add `relationships` to `pnm-cli`" is the obvious-looking
   move for anyone reading the demo's phrasing ("Keyring PNM ↔ CLI PNM") and the
   reason it is wrong is a fact about where the code lives. *Was: Q1. Now P4's
   prerequisite and §8 #6.*
2. **Does Keyring keep a Secure-Enclave-generated key, or adopt a VTA-minted
   one?** `pnm-core`'s live onboarding path hands the wallet a private key
   generated off-device, which is in tension with hardware attestation as our
   differentiator. The operator-grant + `acl/swap-key/0.1` path avoids it and is
   currently unused upstream. *Blocks: P2's custody model, and it is cheaper to
   decide before P2 ships.* **Ours.**
3. **Which VTA does a Keyring user enrol with, and who performs the out-of-band
   grant?** §2.4 means P1 ships without answering this; P2 cannot. Self-hosted,
   one we operate, or the user's choice? Not a technical question. *Blocks: P2's
   onboarding design.* **Ours.**
4. **Has the VTC member-side API moved since Cypress?** `vtc-client`'s own
   header records that every method was broken until recently and its only
   consumer is a self-test. *Blocks: P5.* **Verify against the pin before
   building, and at a boundary session, not mid-task.**
5. **Add `openvtc` to `PINS.json`**, with `dtg-credentials` as a tripwire (§5.3).
   *Blocks: P4 claiming a pinned baseline.* **Ours, mechanical.**
6. **Is the `pnm-core` portability work welcome as a PR, or do we fork?**
   Permission to drive client-side TypeScript has been given; the shape of the
   contribution has not been agreed. *Blocks: nothing — the ladder never blocks
   on upstream review (parent §7) — but it decides whether P0's shim list
   becomes a PR or a patch set.* **Waiting on Glenn.**
7. **Do we build P5 against cred-spec #12 while it is still open?** The
   reciprocal-VMC schema fix (§5, P5) is unmerged, and the Cypress
   `vtc-service` implements neither direction rule nor the acknowledgement
   digest. Building to the PR means implementing a shape upstream has not
   ratified; building to the merged spec means shipping a membership surface we
   already know is wrong on consent. The reviewable middle — implement the
   community-issued half now, which both versions agree on, and gate the
   acknowledgement on #12 landing — costs nothing if #12 changes shape. *Blocks:
   P5's scope.* **Ours to decide, and cheaper to decide before P5 starts.**
8. **Does the `taskContext` binding survive [cred-spec issue
   #11](https://github.com/trustoverip/dtgwg-cred-spec/issues/11) intact?** The
   issue asks the working group to "remove or resolve the normative dependency
   on the unpublished Trust Task model", offering two exits: defer normative
   `taskContext` conformance until a companion Trust Task specification exists,
   or define a minimal interoperable contract in the credentials spec. cred-spec
   #18 is the answer we have staked — pin the dependency to framework mechanisms
   *already published* (document identity, the task digest, the response-variant
   declarations) so nothing waits on an unpublished model. If the group takes
   the deferral exit instead, §4.6 softens from REQUIRED to a local discipline
   and P4/P5's evidence-retention budget shrinks. *Blocks: nothing — building
   the pair is right either way — but it decides whether §4.6 is conformance or
   good practice.* **Waiting on the working group.**
9. **What does Keyring offer when it holds super-admin on a VTA the user does
   not own?** §4.7 carries a **recommended design, adopted provisionally**:
   ownership is not derivable from the wire, so it is declared once by the user
   at enrolment and defaults to "somebody else's"; reads follow the claim alone;
   discloses and writes require the claim *and* the declaration; and where the
   claim is present without the declaration the absence is stated rather than
   hidden. That is enough to build P3 against and is the safe direction to be
   wrong in — it under-offers rather than over-offers.

   **Flagged for review, at three specific triggers rather than "later":**

   - **Before P3's backup and approvals screens are designed.** The declaration
     changes the enrolment flow (P2), so the cost of revisiting it rises sharply
     once both are built. This is the deadline that matters.
   - **When Q3 is answered.** The two are coupled and the coupling is easy to
     miss: if Keyring users enrol with a VTA *we* operate, then "not personally
     owned" stops being the edge case and becomes the **default** deployment, at
     which point a design tuned for personal agents is gating the common path.
     Q3 should not be settled without re-reading this.
   - **On first contact with a real multi-administrator VTA.** Today the shared
     case is hypothetical, and the design is reasoning about a deployment nobody
     in this project has run. One real one is worth more than the argument.

   *Blocks: nothing — P3 proceeds on the provisional design. Revisiting it after
   P2 ships costs an enrolment-flow change.* **Ours; a product decision more
   than a technical one, which is why it wants a second reader rather than more
   evidence.**
10. **Does a phone administer community policy, or only read it?** P6 ships
   policy read-only by the same reasoning that excludes the Rego editor from P3.
   The counter-argument is that community policy is the substance of what a
   community admin does, so a read-only surface may be worth little. *Blocks:
   P6's scope only.* **Ours, and cheap to defer until P6 is real.**

---

## 10. Sources

All paths are inside the pinned clones; commits in the header.

- **VTI (`verifiable-trust-infrastructure` @ 187ad9cd)** — `pnm-cli/src/{main,cli,setup,auth}.rs`
  and `pnm-cli/Cargo.toml`; `cnm-cli/src/main.rs` + `Cargo.toml`;
  `vtc-client/src/lib.rs`; `vta-sdk/src/client/mod.rs` (dispatch spine),
  `vta-sdk/src/trust_tasks.rs` (the catalogue, `ALL_URIS:1328`),
  `vta-sdk/src/{trust_task_sign,auth_di,auth_light,session}.rs`,
  `vta-sdk/src/protocol*/` (the non-Trust-Task exception);
  `vta-service/src/trust_tasks/{mod,ceremony,task_consent,device}.rs`,
  `vta-service/src/messaging/auth.rs` (the ceremony carve-out),
  `vta-service/Cargo.toml`; `vtc-service/src/{routes/mod,relationships/mod,messaging}.rs`;
  `vti-common/src/auth/{di_proof.rs,handlers/challenge.rs}`, `vti-common/src/acl/mod.rs`;
  `vta-mobile-core/` (0.6.18 — `src/{consent,stepup,task,session,proof,didcomm}.rs`, `Cargo.toml`);
  `docs/05-design-notes/{mobile-agent-architecture,auth-architecture,trust-task-uri-registry,didcomm-js-implementation}.md`,
  `docs/02-vta/{task-consent,approvals,cold-start,provision-integration,personal-ai-agents,didcomm-protocol}.md`
- **Browser plugin (`vta-browser-plugin` @ 89d70c4)** — `packages/core`
  (`@openvtc/pnm-core` 0.4.0): `src/vta/{channel,session,trust-task,smoke}.ts`,
  `src/inbound/task-consent.ts`, `src/provision/run.ts`, `src/onboarding/swap.ts`,
  `src/store/kv-store.ts`, `tests/`; `packages/tsp-js`
  (`@openvtc/vti-tsp-js` 0.2.0 — noble-only deps); repo `CLAUDE.md` ([[PLUGIN-GUIDE]])
- **OpenVTC CLI (`openvtc` @ 3797dd0, tag Cypress)** — `docs/relationships-vrcs.md`,
  `openvtc-core/src/{relationships,vrc,messaging,capabilities}.rs`,
  `openvtc/src/state_handler/agent_name_manage.rs`, `Cargo.toml`.
  **Not yet pinned — §9 Q5**
- **Keyring** — `bifold/packages/vrc-contexts/src/{index,relationshipContext,
  witnessedExchangeContext}.ts`, `app/package.json`
- **Trust Tasks framework (`dtgwg-trust-tasks-tf` @ 7e0d755)** — `SPEC.md`: §4.3
  (the `id` member), §4.9/§4.9.1/§4.9.2 (thread correlation and naming an
  exchange from outside the framework), **§4.9.3 (the task digest)**, §4.11 (the
  `ceremony` member), §7.2 items 10–12, §8.4 (retry semantics), §8.6 (reserved
  response-type slugs), §12 (task control), Appendix B (the 0.4 changelog);
  `bindings/didcomm/0.2/spec.md`, `bindings/didcomm-v1/0.2/`
- **DTG Core Credentials (`dtgwg-cred-spec`)** —
  [#18](https://github.com/trustoverip/dtgwg-cred-spec/pull/18) (open;
  `taskDigestMultibase`, the outcome-evidence pairing rule, the proof-set rule —
  merged from [Mickens-Lab#5](https://github.com/Mickens-Lab/dtgwg-cred-spec/pull/5)
  2026-08-17), [#12](https://github.com/trustoverip/dtgwg-cred-spec/pull/12)
  (open; both VMC directions),
  [#14](https://github.com/trustoverip/dtgwg-cred-spec/pull/14) (merged; the VWC
  edge digest), [issue #11](https://github.com/trustoverip/dtgwg-cred-spec/issues/11)
  (open; the normative-dependency challenge — §9 Q8)
- **VTI, for the surfaces this revision adds** — `pnm-cli/src/cli.rs`
  (`Commands` :92, `ApprovalsCommands` :1952, `ApproversCommands` :2005,
  `PolicyModuleCommands` :2026); `cnm-cli/src/main.rs` (`Commands` :109,
  `CommunityCommands` :364); `vta-sdk/src/trust_tasks.rs` (seeds :369-389,
  policy :1275-1300, backup :1140-1193); `vta-service/src/trust_tasks/`
  (`backup.rs`, `seeds.rs`, and the dispatcher registrations at `mod.rs:968-976`);
  `vtc-client/src/lib.rs:279-436` (the membership methods);
  `docs/05-design-notes/backup-descriptor-pattern.md`
- **OpenVTC CLI, for the headless gap** — `openvtc/src/cli.rs:36-44` (two
  subcommands only), `openvtc/src/state_handler/relationship_actions.rs`,
  `openvtc-core/src/{relationships,vrc,messaging}.rs` and `openvtc-core/Cargo.toml`
  (no TUI dependency)
- Parent plan and dated companions: [`../openvtc-integration-plan.md`](../openvtc-integration-plan.md), [`./`](.)
