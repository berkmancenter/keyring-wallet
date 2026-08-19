# Recasting VRC Credential Exchanges as Trust Tasks — Draft

**Status:** Draft for discussion. Not a commitment to implement.
**Date:** 2026-08-05
**Reasoning:** [`2026-08-05-bam.md`](./2026-08-05-bam.md) Part B — the decisions behind this design and the positions each supersedes. This document states only the current design; see [`../CLAUDE.md`](../CLAUDE.md).
**Premise:** we are moving to a new foundation and **updating Credo to support these flows**, rather than shaping the flows to fit Credo. Where this document weighs a design against "what Credo already does", that is a migration cost, not a constraint.
**Scope:** `bifold/packages/core/src/modules/vrc`, `bifold/packages/witness-server`
**Parent:** [`openvtc-integration-plan.md`](../openvtc-integration-plan.md) — this document is item **§7.6** of its contribution roadmap ("Witnessed-exchange Trust Task spec") in detail.
**Parent-plan review:** [`2026-08-05-bam.md`](./2026-08-05-bam.md) Part A — findings A1 and A4 constrain this document; see §8.
**Normative references:**
- **[[TT-SPEC]]** — [Trust Tasks framework SPEC.md](https://github.com/trustoverip/dtgwg-trust-tasks-tf/blob/main/SPEC.md), framework v0.2/0.3. Unqualified `§` references in this document are to this spec. (The header says 0.2 while Appendix B documents 0.3; the editor has confirmed this is stale and is fixing it.)

> **Citation convention**, per the framework editor's request on
> [dtgwg-trust-tasks-tf#173](https://github.com/trustoverip/dtgwg-trust-tasks-tf/issues/173#issuecomment-5189686547):
> when this work becomes a published specification, cite §7.3 requirements **by
> name** ("the proof-requirement declaration") rather than by item ordinal
> ("§7.3 item 8"), and pin a target framework `MAJOR.MINOR`. Items 13–14 were
> added in framework 0.3 and nothing in CI guards the numbering. This planning
> document keeps ordinals for now for traceability against the draft we read.
- **[[DTG-CRED]]** — [DTG Credentials specification](https://github.com/trustoverip/dtgwg-cred-spec/blob/main/spec/body.md) (`trustoverip/dtgwg-cred-spec`, `spec/body.md`). **Authoritative for credential taxonomy, the VWC schema, and Trust Task Context Binding.** Named sections are cited as `[[DTG-CRED]] §<section>`.

---

## 1. What a Trust Task is

A Trust Task is a **message-layer contract** — not a credential format, not a
protocol, not a transport. A *Trust Task document* is one JSON object carrying
framework-owned metadata plus an opaque, schema-governed `payload`:

```json
{
  "id": "<uuid>",
  "threadId": "<correlates the exchange>",
  "type": "https://<authority>/spec/<slug>/<MAJOR.MINOR>",
  "issuer": "<VID>",
  "recipient": "<VID>",
  "issuedAt": "<RFC3339>",
  "expiresAt": "<RFC3339>",
  "payload": { }
}
```

Five properties drive every decision in this document:

1. **`type` is a resolvable, versioned URI.** The `#request` / `#response`
   fragments distinguish the two legs of a pair (§4.4.1). Failure is *never* a
   `#response` — it is the framework's `trust-task-error` type with a standard
   code vocabulary, `retryable`, and `retryAfter` (§8).

2. **Transport-agnostic, with in-band identity authoritative** (§4.8.1).
   Transport-derived identity fills gaps or acts as a cross-check; it never
   overrides the document. Each transport gets its own *binding* spec (§9)
   defining the mapping.

3. **Specs are self-describing.** Front matter declares parties, proof
   requirement, `sideEffects` level, `exposure` class, and error codes (§7.3).

4. **Codegen falls out of the schemas.** `@openvtc/trust-tasks` (TypeScript) and
   `trust-tasks-rs` (Rust) are generated from each spec's `payload.schema.json`
   and kept byte-identical.

5. **Private specs are first-class** (§6.5). Publishing under an authority we
   control is fully conforming — same validation and signing pipeline, with
   promotion to the public registry available later. The only constraint is that
   we must not use the `trust-task*` reserved slug prefix or the
   `trusttasks.org` authority.

The wire format is unchanged from framework 0.2 through 0.3; 0.3 only added the
`sideEffects` / `exposure` authoring declarations.

---

## 2. What the VRC module exchanges today

Four distinct layers, with very different recast value.

| Layer | Mechanism | Recast value |
|---|---|---|
| **A. Relationship handshake** | Free-text basic message, regex-parsed, plus OOB goal code and OOB role | High |
| **B. Credential issuance** | Credo DIDComm `issue-credential` v2, `jsonld` format — VRC and RCard | High (revised, see §4) |
| **C. Witness protocol** | Bespoke JSON over basic messages | Highest |
| **D. Biometric / hardware evidence** | Local; rides inside the credential's `evidence` property | N/A — not an exchange |

### 2.1 Layer A in detail

Layer A is **one negotiation spread across three unrelated encodings**:

| Concern | Encoding | Location |
|---|---|---|
| Exchange mode | OOB invitation `goalCode`: `relationship.credential` vs `relationship.credential.bidirectional` | `vrc-manager.ts:1461-1462` |
| Identity + capability | Regex over free text: `vrc:relationshipDid:<did> vrc:rceVersion:<n>` | send `:2180`, parse `:1410-1424` |
| Who issues | OOB role → `INVITER` / `RECEIVER` → `shouldIssue` | `:1464-1469` |

The sent message is literally:

```
This is my relationship DID: vrc:relationshipDid:did:peer:… vrc:rceVersion:3
```

parsed by `content.includes(…)` plus two regexes. No schema, no version
negotiation beyond an ordinal integer, no failure vocabulary.

### 2.2 Layer B in detail

Credo's `issue-credential` v2 with a `jsonld` attachment, driven from
`vrc-manager.ts:609` (VRC) and `:705` (RCard), accepted at `:1835`.

Capability gating is ordinal, derived from the layer-A `rceVersion`:

- `counterpartySpeaksVc20()` — `counterpartyRceVersion >= 2` (`:379`)
- `counterpartySpeaksDi()` — `counterpartyRceVersion >= 3` (`:394`)

Orchestration state that the protocol does not carry lives in module-level
in-memory Maps: `connectionCredentialOffers`, `connectionRCardOffers`,
`pendingWitnessedVrcs`, `pendingVrcIssuanceAfterWitness`.

### 2.3 Layer C in detail

Bespoke JSON over DIDComm basic messages, dispatched on a bare `type` string:

| Message | Direction | Payload |
|---|---|---|
| `witness-announcement` | witness → wallet | `{ name, did }` |
| `session-request` | wallet → witness | `{ myRelationshipDid, counterpartyDid, witness }` |
| `session-challenge` | witness → wallet | `{ sessionId, challenge, domain }` |
| `submit-presentation` | wallet → witness | `{ presentation, reportingDid? }` |
| `reporting-did-registration` | wallet → witness | reporting DID |
| `verify-credential` / `verify-credential-response` | bidirectional | credential |
| `error` | witness → wallet | `{ error, code }`, codes `event-not-started`, `event-ended` |

No schema, no versioning, kebab-case error codes matching no standard
vocabulary, and no `retryable` / `retryAfter` semantics.

---

## 3. Why layer C is the closest structural fit

C maps cleanly because it is *already shaped* like a Trust Task exchange:
explicit request/response pairs, a challenge that binds the session, and a clear
beginning and end. A and B are neither — A is a one-way announce smeared across
three encodings, and B has no wire-level thread at all.

**"Closest fit" is not "least work."** [[DTG-CRED]]'s Trust Task Context Binding
imposes requirements on the witness ceremony that no other layer carries —
mandatory `#response` variants, `proof: REQUIRED`, and outcome-evidence
retention (§4, Layer C). C is the layer whose *shape* needs least translation and
whose *obligations* are heaviest.

The consequence, which is the central insight of this document: **A and B should
not be translated message-for-message.** They are one exchange, and the recast
should give that exchange the thread it never had.

---

## 4. Verdict per layer

### Layer C — recast. Highest value, and now the most constrained.

**The VWC is already specified, and it constrains our task design.**
[[DTG-CRED]] defines `WitnessCredential` as a DTG annotation credential with a
normative schema: `taskContext` (**REQUIRED**), `credentialSubject.id` (the
observed party), optional `digest` (`sha256:` over the JCS-canonicalized VRC),
and optional `witnessContext { event, sessionId, method }`. It also states that
a witnessed bidirectional exchange **SHOULD** yield one VWC per direction — our
existing two-VWC flow — with `credentialSubject.id` being the issuer of the VRC
that VWC attests.

We are therefore **not designing the credential**. We are designing the ceremony
it binds to, and [[DTG-CRED]] §Trust Task Context Binding makes that binding
normative:

> A VWC **MUST** be bound to the trust task exchange in which it was issued via
> the `taskContext` property.

`taskContext` carries the `threadId` of our witness ceremony. And a **qualifying**
Trust Task specification — one a `taskContext` may legitimately point at — MUST:

1. declare `proof` as **REQUIRED** on its success-response *and* error-response
   variants, so the outcome evidence is integrity-protected; and
2. define a `#response` success-response payload schema, or rely on the
   framework's `trust-task-error` to report failure — so the terminal state is
   observable from the documents themselves.

These two requirements are not optional refinements: a specification that gives
`witness/session/submit` no `#response`, or leaves `proof` unstated, does **not**
qualify — and VWCs issued in our ceremony could not then legally bind to it.

Proposed private specs:

| Slug | Replaces | Declarations of note |
|---|---|---|
| `witness/announce/0.1` | `witness-announcement` | **`bearer: true`** (§4.8.3) — a broadcast attestation with no intended audience. The only one of these that should be bearer. Not a `taskContext` target, so the qualifying rules do not apply. |
| `witness/session/0.1` + `#response` | `session-request` → `session-challenge` | **Opens the ceremony thread** — its `id` is that thread's identifier and the value VWCs carry as `taskContext` (§4, "Two threads"). Ceremony documents carry `parentThreadId` (framework 0.4, §4.9.2) linking back to the relationship exchange. `proof: REQUIRED` on `#response`. |
| `witness/session/submit/0.1` **+ `#response`** | `submit-presentation` | `exposure: { discloses: secret, actsAsSubject: true }` — a signed VP of the holder's own VRC. **`#response` and `proof: REQUIRED` are mandatory, not optional**: this is the leg whose terminal state the VWC's `taskContext` refers to. The `#response` payload SHOULD carry the issued VWC reference so success is observable in-band. |
| `witness/reporting-did/register/0.1` | `reporting-did-registration` | `sideEffects: mutating`. Not a `taskContext` target. |
| `witness/credential/verify/0.1` + `#response` | `verify-credential` / `-response` | `sideEffects: none` |

The `error` message becomes `trust-task-error` with slug-namespaced,
lowerCamelCase codes: `witness/session:eventNotStarted`,
`witness/session:eventEnded` — plus `retryable` / `retryAfter`, which the
current design cannot express at all.

#### The error branch cannot carry outcome evidence today

*Source: the framework editor on
[dtgwg-trust-tasks-tf#173](https://github.com/trustoverip/dtgwg-trust-tasks-tf/issues/173#issuecomment-5189686547).*

**Our error responses cannot be required to carry `proof`** — not by us, and not
by our specification. Three constraints, all of which bear on the design:

1. **A task specification cannot strengthen `trust-task-error`'s proof
   declaration.** A consumer resolves the proof requirement from the
   specification named by the document's `type` — and an error response's `type`
   is `trust-task-error`'s own Type URI, a *different* specification, declaring
   `proofRequirement: RECOMMENDED`. Net effect in the editor's words: "an
   unsigned `trust-task-error` document is fully conforming today, no matter what
   the originating specification declares."
2. **A retained error response is not self-describing.** It names neither the
   originating Type URI nor the originating document's `id`, correlating only by
   `threadId`. A third-party verifier holding one "cannot determine which task it
   refers to, which specification's semantics apply to the code, or whether the
   signer was the right party to be reporting it."
3. **"Or rely on `trust-task-error`" is not a usable alternative.** A
   specification with no success response MUST NOT emit a `#response` and its
   schema MUST NOT declare a response anchor — so a qualifying specification
   taking that branch could only ever produce terminal evidence of *failure*.

**What this means for our design — and it is mostly reassuring:** requiring a
real `#response` on `witness/session/submit` was already the right call, and the
editor proposes dropping the error-only alternative entirely. Our positive
outcome evidence comes from the `#response`, which *can* carry a required proof
because it resolves to our own specification.

**What we must not do:** treat a retained `trust-task-error` as verifier-facing
outcome evidence. Until the editor's proposed changes land — error responses
inheriting the originating specification's proof requirement, and error
responses naming the originating `type` and `id` — the failure branch is
diagnostic only.

#### Two threads, not one — the witness ceremony is its own exchange

**The witness ceremony opens its own thread.** `witness/session` is its
initiating document; that document's `id` is the ceremony thread's identifier
and the value every VWC from the ceremony carries as `taskContext`.

The deciding argument is what the credential is actually attesting.
[[DTG-CRED]] defines `taskContext` as naming "the trust task exchange **in which
the witnessing occurred**", and Outcome Interpretability requires evidence that
*that* exchange reached its terminal state. A `vrc/relationship/propose#response`
proves the relationship exchange concluded — it says nothing about whether a
witness observed anything. Only `witness/session/submit#response` attests the
witnessing. If `taskContext` pointed at the exchange thread, the matching
outcome evidence a verifier collected would be evidence of the wrong thing.

**Linking the two threads is the framework's `parentThreadId` member**
(framework 0.4, §4.9.2). Every document of the ceremony thread carries
`parentThreadId` naming the relationship exchange's thread. The member is
navigation only — the framework states it "does not change which exchange
attests an event" — which is precisely the property the two-thread design
needs: the VWC's evidence stays anchored on the ceremony thread whether or not
the link is present. On the DIDComm v1 wire it maps to `~thread.pthid`
(binding `didcomm-v1` 0.1), subject to that binding's representability rule.

| | Relationship exchange | Witness ceremony |
|---|---|---|
| Opened by | `vrc/relationship/propose` | `witness/session` |
| Thread identifier | that document's `id` | that document's `id` |
| Terminal evidence | `vrc/relationship/propose#response` | `witness/session/submit#response` |
| Carries `taskContext`? | no | **yes** — this is the VWC's referent |
| Link | — | `parentThreadId` → the exchange thread (framework 0.4, §4.9.2; `pthid` on the v1 wire) |

**Consequences worth noting:**

- A VWC and the VRC it attests belong to *different* threads. That is correct:
  the VRC is durable and stands alone ([[DTG-CRED]]'s credential/artifact test),
  while the witnessing is a bounded ceremony with its own terminal state.
- The `digest` member of the VWC — `sha256:` over the JCS-canonicalized VRC —
  is what binds the credential to the specific VRC, and it does so
  cryptographically rather than by thread. The two-thread model does not weaken
  that binding; it is the reason we do not need thread identity to carry it.
- Retention (below) is scoped to the **ceremony** thread. We persist
  `witness/session/submit#response`, not the relationship exchange's response.

#### Layer C carries a new implementation requirement: outcome-evidence retention

[[DTG-CRED]] §Outcome Interpretability:

> A verifier **MUST NOT** interpret a `taskContext`-bearing credential as proof
> that the associated trust task or ceremony completed unless matching trust
> task outcome evidence is also present and verified. … A holder presenting a
> `taskContext`-bearing credential as evidence of task completion **MUST**
> include matching outcome evidence with the presentation.

Matching outcome evidence is a Trust Task document whose `threadId` equals the
credential's `taskContext`, whose `type` is either the request's Type URI with
`#response` or `trust-task-error`, and whose `proof` verifies.

**Keyring does not retain these today.** A VWC in our wallet is currently a
standalone credential; the witness ceremony's messages are transient. To present
a VWC as evidence that the ceremony completed — which is the entire point of a
witnessed exchange — we must:

1. **Persist** the ceremony's `#response` (or `trust-task-error`) document,
   with its proof, alongside the VWC.
2. **Index** it by `threadId`, so it can be located from the credential's
   `taskContext`.
3. **Attach** it to any presentation offering the VWC as completion evidence.
4. Retain it for the VWC's useful life — the spec offers no retrieval mechanism
   ("discovering or retrieving outcome evidence … is out of scope"), so a
   verifier that does not receive it with the presentation **MUST** treat the
   credential as not evidencing completion, whether or not it exists elsewhere.

This is genuinely new work — storage schema, presentation assembly, and
retention policy — not a spec edit. Note the failure mode is silent and
delayed: without it, our VWCs verify perfectly well as credentials and simply
fail to prove the thing they exist to prove.

### Layer A — recast, modelled on the reciprocal membership exchange.

**First, the credential is not special.** [[DTG-CRED]] defines one formal
hierarchy in which VRC, VMC and VWC are sibling subtypes:

```text
VerifiableCredential
└── DTGCredential
    ├── MembershipCredential (VMC)      ─┐ edge credentials
    ├── RelationshipCredential (VRC)    ─┘
    ├── InvitationCredential (VIC)
    ├── PersonaCredential (VPC)
    ├── EndorsementCredential (VEC)
    └── WitnessCredential (VWC)
```

All six share the normative **Base Structure** of [[DTG-CRED]] §Base Structure,
and VRC and VMC are both *edge credentials* forming a complete DTG edge from a
bidirectional pair. The functional categories are "descriptive aids only; they
do not appear in credential schemas." Keyring already mints exactly this shape —
`vrc-manager.ts:249` emits
`['VerifiableCredential', 'DTGCredential', 'RelationshipCredential']`, byte-identical
to the reference implementation's.

So what differs between a membership exchange and a relationship exchange is
**party topology and trust semantics, not the credential**. That is also the
registry's own stated position: `credentials/_shared/0.1` exists because
"families remain separate Trust Tasks because their trust semantics differ …
only the mechanism is shared."

The registry contains a working, current reciprocal membership exchange —
`vtc/members/solicit-vmc` → `vtc/members/request-vmc` → `vtc/members/vmc`
(+ `#response`) — with a live client implementation in `openvtc`. It is the
nearest published analogue to what layer A does, so we borrow its decomposition
and its shared components. See §8.5 for why layer A's own equivalent does not
yet exist.

**What transfers — the decomposition principles:**

1. **One task per party pair.** That exchange is three tasks because it has three
   parties (administrator → community → member). Each document is bilateral, per
   SPEC §2.
2. **Dispatch acknowledgement is not a delivery receipt.** `solicit-vmc` returns
   `requested: true` meaning *the request left*, never *a credential arrived*.
   The spec calls this out explicitly as a lesson already learned upstream.
3. **The consumer MUST NOT block** on the counterparty's reply. The task
   completes when the request is sent.
4. **`threadId` correlates the eventual asynchronous delivery** back to the
   opening document.
5. **Receipts reuse `credentials/_shared/0.1`** — the registry's shared issuance
   component (SPEC §6.6), exposing `CredentialId` and `IssuedCredential`.

**What does not transfer — the topology.** That flow routes through a community
as intermediary and is one-directional. Layer A is direct peer-to-peer, and is
bidirectional in its default mode. The three-task decomposition therefore
collapses to two parties, and `solicit` — whose only reason to exist is the
administrator/community split — disappears.

**Proposed shape:**

| Slug | Direction | Membership-exchange analogue | Payload |
|---|---|---|---|
| `vrc/relationship/propose/0.1` + `#response` | peer → peer | `solicit-vmc` + `request-vmc`, collapsed (no intermediary) | request: `{ relationshipDid, mode, capabilities? }` · response: `{ relationshipDid, accepted }` |
| `vrc/relationships/issue/0.1` + `#response` | issuer → subject | `vtc/members/vmc` | request: `{ vrc, vrcDigestMultibase?, ext? }` — the signed credential plus an optional digest over its RFC 8785 canonicalization · response: `{ vrcDigestMultibase }` **recomputed over the credential as stored**. The digest receipt, not a shared `IssuedCredential` component, because both directions share one `threadId` and a `#response` carries no `inResponseTo` — only a recomputed digest identifies *which* delivery a receipt answers, and a copied value attests nothing about what was stored (staged spec `vrc/relationships/issue` 0.1, "Both deliveries share one thread") |

`propose` declarations: `proof: OPTIONAL` (DIDComm authcrypt already
authenticates the sender); `sideEffects: mutating` (persists a
`RelationshipDidRecord`); `exposure: { discloses: metadata, actsAsSubject: false }`.

`issue` declarations (as staged, `vrc/relationships/issue` 0.1): proof
**request REQUIRED, response OPTIONAL** — the delivery is
retained-and-relied-upon (the §4.7.1 condition), and the envelope proof
attributes *the delivery* itself on a relayed path, independent of the
credential's own issuer signature; the receipt is consumed inside the exchange
by the connected peer under authcrypt. `sideEffects: mutating` (the credential
enters the wallet; not compensatable by this exchange — revocation is the
issuer's own act); `exposure: { discloses: none, actsAsSubject: false }` (the
delivery carries the two relationship DIDs to the very party that already
holds them from the accepted proposal — nothing reaches anyone who did not
already have it, which is why `propose`, the document that *first* discloses a
relationship DID, is `metadata` where this is `none`). One error code,
`vrc/relationships/issue:notAccepted`: the accepted proposal is the
authorization evidence, so a delivery that does not match it — wrong parties,
wrong relationship DIDs, or no accepted exchange at all — is one and the same
refusal.

**Why `issue` exists rather than deferring to Credo.** Credo's
`issue-credential` v2 already delivers credentials, so a dedicated task can look
redundant — but that reading treats Credo's current protocol set as a fixed
constraint to design around. It is not: **we are moving to a new foundation and
updating Credo to support these flows, rather than shaping the flows to fit
Credo.** The task family should therefore express the exchange we
want, and the Credo layer follows it.

That also makes the family self-contained — `propose` → `issue` → receipt is a
complete exchange on the **exchange thread**, with no leg that only exists inside
another protocol's state machine. (The witness ceremony, when present, is a
separate nested thread rather than a leg of this one — see §4, "Two threads".)
It is the same shape as the membership exchange's delivery leg, and it reuses
the same receipt component.

This task does not compete with `credential-exchange/issue`: the two serve
different credential kinds, not different negotiation styles — see §4, Layer B.

**RCard does NOT ride this task** — despite the obvious-looking design in which
the credential's `type` array discriminates a `RelationshipCredential` from a
`RelationshipCard`. That design is invalid, and [[DTG-CRED]] says why:

> The r-card (relationship card) that appeared in earlier drafts of this
> specification is a **verifiable data structure (VDS), not a `DTGCredential`
> subtype**. It will be defined in the planned *DTG Verifiable Data Structures*
> specification.

An RCard's type array is `["VerifiableCredential", "RelationshipCard"]` — no
`DTGCredential` member — so it fails the Base Structure requirement that `type`
include `"DTGCredential"` and exactly one concrete subtype. A task whose payload
is a DTG credential structurally excludes it. Our own code already knows this:
`issueRCardCredential` documents the RCard as "a separate exchanged VDS".

**Open, and deliberately not resolved here:** how the RCard travels once the VDS
specification lands. Three options — a sibling task with a VDS payload, an `ext`
namespace on `vrc/relationship/issue` (SPEC §4.5.1), or leaving it on Credo
until the VDS spec exists. Deciding before that spec publishes risks building
against a shape that changes. Tracked as open question 6.

The gain is not fewer messages. It is that the goal code, the regex, and the
derived `INVITER`/`RECEIVER` role all disappear: `shouldIssue` stops being
*inferred* from a transport artifact and becomes a *stated* field — carried by
`mode`, and answered explicitly in the `#response`.

### Layer B — credential issuance and presentation

Layer B splits by *what is being moved*, and the split follows the registry's own
organisation rather than our convenience.

**Delivery of VRC and RCard is Layer A's `vrc/relationship/issue`** — the DTG
idiom: the signed credential in the payload, receipts from
`credentials/_shared/0.1`, exactly as `vtc/members/vmc` does it.

**Presentation adopts `credential-exchange/{query,present,pending/*}`** — the
OID4VP path. It is implemented upstream in `vta-service` (the deferral flow:
`query`, `pending-list`, `pending-approve`, `pending-deny`), and our
`modules/openid` already carries holder-side OID4VP with DCQL selection. This is
also the consent-gating path the parent plan's Phase E demo depends on.

**`credential-exchange/{offer,request,issue}` is not used.** Those legs wrap
OID4VCI objects — the snake_case `credential_response` is the tell that they
carry a foreign vocabulary verbatim — and DTG credentials do not travel that
idiom: every DTG credential in OpenVTC uses the signed-VC-in-payload form. The
issuance legs are also unimplemented upstream ("Handlers … land in later Phase 3
slices"), so adopting them would make Keyring the only implementation wrapping a
DTG credential in an OID4VCI envelope, against handlers nobody has written.

**Capability negotiation moves to `trust-task-discovery`** ([[TT-SPEC]] §11),
replacing the ordinal `rceVersion` ladder that currently gates
`counterpartySpeaksVc20` / `counterpartySpeaksDi`. Set membership over
`supportedTypes` is strictly more expressive than an ordinal: a capability can be
added or dropped without every peer having to understand the ladder. It lands
with Layer A, since that is where `rceVersion` is carried today.

#### Two rejected alternatives

**Keeping Credo's `issue-credential` v2 as the delivery path**, recasting only the
negotiation around it. This was a hedge against Credo being immovable, and the
premise in this document's header removes it: we are updating Credo to support
these flows. Building it would mean writing a correlation layer between the
trust-task thread and Credo's protocol, then deleting it.

**Adopting the OID4VCI issuance legs** as a low-risk way to exercise the pipeline
against specs we did not write. The reasoning was that it needs no spec
authorship and has a live counterparty — but the counterparty exists only for the
*presentation* legs. For issuance there is nothing upstream to test against, and
the idiom is wrong regardless.

The general form of that second mistake is worth keeping in view: **"align with
OpenVTC" and "adopt registry-published specs" are not the same instruction.** The
registry serves several worlds at once — OID4VCI/OID4VP for wallet-to-service
exchange, the DTG idiom for credentials inside the trust graph. Choosing a family
by publication status rather than by idiom is how we drift while believing we are
converging.

### Layer D — no action

Biometric and hardware-attestation evidence is local and rides inside the
credential's `evidence` property. Not an exchange, nothing to recast.

---

## 5. The unified exchange

**Two threads, linked by `parentThreadId`** — the relationship exchange, and
(when witnessed) a nested witness ceremony. §4's "Two threads" subsection gives
the reasoning; this is the shape.

```
EXCHANGE THREAD  (id = vrc/relationship/propose.id)

vrc/relationship/propose            ─┐  mode + relationship DID + capabilities
  (trust-task-discovery)             │  optional capability probe
vrc/relationship/propose#response    │  counterparty's relationship DID + accept
                                     │
    ┌────────────────────────────────┼─── if witnessed ──────────────────┐
    │ CEREMONY THREAD (id = witness/session.id)  ← the VWC's taskContext │
    │                                │                                   │
    │ witness/session → #response    │  challenge; documents carry       │
    │                                │  parentThreadId → this exchange   │
    │ witness/session/submit         │  VP bound to challenge            │
    │   → #response                  │  MANDATORY — the outcome evidence │
    │                                │  a VWC presentation must ship     │
    └────────────────────────────────┼───────────────────────────────────┘
                                     │
vrc/relationship/issue → #response   │  the signed VRC, both directions
                                    ─┘  receipt closes each leg
```

An unwitnessed exchange is the outer thread alone — `propose` → `issue`, with
the ceremony block simply absent. Witnessing is additive, never a precondition.

This shape runs:
[`tsp-reference/ref-06w-witnessed-exchange`](../../../tsp-reference/ref-06w-witnessed-exchange/)
executes it end-to-end between three Credo agents with draft payloads and the
official §7.2 pipeline — the two threads, the `parentThreadId` nesting, the
`taskContext` anchoring, per-variant `proof: REQUIRED` enforced on the witness
responses, and the retained `submit#response` (2,213 bytes) passing the
third-party pairing check. The rung's simplifications relative to the full
design (single submitter, stub VWC shape, no `witness/announce`, no
attestation evidence) are listed in its README and are the delta the
specifications below must add.

Failures anywhere are `trust-task-error` with `retryable` / `retryAfter`, and —
on any leg a VWC's `taskContext` points at — carrying `proof`.

**The ceremony thread's identifier is the VWC's `taskContext`** — anchored on the
**initiating document's `id`**, not on `threadId`.

[[DTG-CRED]] currently defines `taskContext` as carrying the `threadId`. The
framework editor's response on
[dtgwg-trust-tasks-tf#173](https://github.com/trustoverip/dtgwg-trust-tasks-tf/issues/173#issuecomment-5189686547)
recommends against relying on that, and we follow the recommendation:

- **`threadId` carries no normative validation semantics** (§4.9) — it is
  framework-optional, consumers "MUST NOT reject a document on the basis of
  `threadId` alone", and no uniqueness obligation attaches to it.
- **`id` does.** §4.3 requires it to be "globally unique to this instance of the
  task" and "producers MUST NOT reuse an `id` value across documents" — a
  framework-level uniqueness obligation, on a mandatory member, available today.
- **The two coincide by convention anyway.** §4.9 says a responder with no
  upstream `threadId` sets it to the originating document's `id`, so anchoring on
  the `id` of the opening `witness/session` document yields the same value the
  thread carries — with a normative uniqueness guarantee behind it.

A verifier may only read the VWC as evidence the ceremony *completed* if matching
outcome evidence travels with it. The thread is therefore a durable artifact to
be retained, not a transient routing device — see §4, Layer C.

A secondary but real benefit: the exchange becomes reconstructable from the
thread rather than from log archaeology — relevant given how much of the e2e
suite currently greps logcat for markers.

*`credential-exchange/{offer,request,issue}` does **not** substitute for the
`vrc/relationship/issue` leg — a VRC is a DTG credential and travels the DTG
idiom (§4, Layer B). The presentation family
(`credential-exchange/{query,present,pending/*}`) is a separate, adopted concern
that sits outside this exchange.*

---

## 6. The transport binding: drafted upstream, carriage proven, amendments ours

`binding/didcomm/0.1` is **DIDComm v2.1 authcrypt JWE**. We are on Credo 0.6.3 —
**DIDComm v1 / AIP 2.0**, basic messages over connection records. The published
v2.1 binding does not apply to the legacy stack.

The v1 binding exists: the framework editor drafted
[`bindings/didcomm-v1/0.1`](https://github.com/trustoverip/dtgwg-trust-tasks-tf/tree/main/bindings/didcomm-v1)
with a Rust reference implementation (`trust-tasks-didcomm-v1`), and its Status
section hands it to the DTG Core Credentials task force — us — "to take over
and amend". Its shape, confirmed against Credo by
[`tsp-reference/ref-06v1-didcomm-v1-binding`](../../../tsp-reference/ref-06v1-didcomm-v1-binding/)
and [`ref-06v1b-mediated`](../../../tsp-reference/ref-06v1b-mediated/)
(19 checks; agent-to-agent and through the production Keyring mediator):

- **Carriage:** the document rides an `~attach` decorator (reserved id
  `trust-task`) on a basic message, `content` staying a human-readable summary
  — *not* the JSON body sketched here earlier; the attachment survives Credo's
  authcrypt and mediator forwarding byte-identically.
- **Identity mapping:** the connection's `theirDid` is the transport-authenticated
  sender for the §4.8.1 cross-check — as drafted, and as proven.
- **Error delivery:** `trust-task-error` documents returned the same way on the
  same connection.

One amendment is required before the binding is implementable on the stack it
targets: Credo enforces RFC 0008's thread-id shape and rejects `urn:uuid:`
`~thread` values, so correlators must be transport-representable (bare UUIDs)
or omitted. The staged spec change, with the full evidence trail, is
[`PR-CANDIDATE.md`](../../../tsp-reference/ref-06v1-didcomm-v1-binding/PR-CANDIDATE.md);
smaller findings live in the rung's `UPSTREAM-FEEDBACK.md`. The Credo client
itself (a small module with its own send path — the chat API is content-only)
is Phase D work on `tsp-core`'s Carriage port (§8.1).

**Secondary:** §7.2 requires payload schema validation. In React Native, compile
schemas to standalone ajv validators at build time and bundle them. This also
sidesteps §10.3's dynamic-schema DoS concern entirely, per that section's own
build-time carve-out.

---

## 7. Migration

### 7.0 The migration's premises are proven

[`tsp-reference/ref-06w2-compat`](../../../tsp-reference/ref-06w2-compat/)
backs this section with runnable evidence against the real compiled
witness-server core: the two dances share one crypto core (byte-identical
VWCs), a lossless translator maps the session messages onto the recast
shapes with the unmapped delta enumerated, and a dual-stack witness serves a
**mixed-dialect session** — one legacy party, one task party, one challenge,
both attested. The legacy `rceVersion` ordinal doubles as the capability
gate (`4` = speaks Trust Tasks), and the legacy `sessionId` equals the
ceremony identifier during transition, converging the identifier spaces.

### 7.1 Receivers already tolerate unknown documents

The current dispatcher logs and falls through on an unrecognized `type`
(`vrc-manager.ts:1385`, "Unknown witness message type … allowing normal
processing"), then returns at `:1410` when the content lacks
`vrc:relationshipDid:`. A v3 wallet receiving a Trust Task document will not
crash or misroute it.

This makes SPEC §5.4's **expand-then-contract** sequence directly usable:

1. Author the new specs.
2. **Update receivers first** — accept Trust Task documents alongside legacy.
3. **Update senders** — begin emitting Trust Task documents.
4. **Retire** the legacy encodings.

### 7.2 Two caveats

1. **A stray JSON blob may render in the chat bubble** on legacy peers. The
   fall-through returns without suppressing display, so a v3 wallet would show
   raw Trust Task JSON as a chat message.
   - *Witness layer:* non-issue — the witness announces first, so capability can
     be negotiated before anything else is emitted.
   - *Handshake:* chicken-and-egg. Send the legacy text first, and only speak
     `vrc/relationship/propose` once both sides have announced support. One
     release of dual-send.

2. **e2e will need updating** — the witnessed-exchange tests assert on log
   markers and message shapes.

### 7.3 Dual-accept is required, and is a client-side policy

The expand-then-contract sequence above depends on consumers accepting old and
new encodings concurrently. The parent plan records the opposite norm upstream —
§1.2: "the canonical-task migration is a **clean cutover** (old URIs are being
deleted, no dual-accept)."

That norm does not survive a mobile release cycle: old app versions persist in
the wild for months and native code has no OTA path. The framework permits what
we need — SPEC §5.2 makes forward-minor compatibility a SHOULD and allows
consumers to accept multiple versions; §5.4 is written for exactly this
sequence — so this is a stance we take client-side, not one we need upstream to
adopt.

Working policy, proposed for the parent plan as review A3: **accept N and
N−1 of any task version we emit, for at least one release cycle**, absorbing
upstream URI churn in the client rather than propagating it as a hard break.

---

## 8. Relationship to the OpenVTC integration plan

This document is the detail under the parent plan's **§7.6**. Four points of
contact, two of which are constraints rather than synergies.

### 8.1 Constraint — do not build a second task spine

The parent plan's `tsp-core` (§5.2) already contains "trust-task model ·
canonical schemas · validation · Type-URI dispatch · threading" — precisely the
spine this recast needs. Building a separate one here would be duplicated work
and a fork risk.

The blocker is that §5.2 wires that model as `TT --> WIRE`, so the task layer
depends on TSP envelope orchestration (HPKE, CESR, the noble backend) — none of
which a DIDComm-v1 carriage needs. **Review A1 proposes inverting that
dependency** so the task model depends only on a carriage interface.

If A1 is adopted, this recast consumes `tsp-core`'s task model directly
and becomes an early second consumer validating the abstraction — the same
two-implementations logic the parent plan applies to adapters (§4.4) and
bindings (§7.9). If it is rejected, §9 below needs rethinking, because the
recast would then have to carry its own model.

### 8.2 Constraint — §8's non-negotiables, as written, forbid this work

The parent plan lists "witness flow untouched" as non-negotiable at every level,
while §7.6 of the same document commits to recasting it. Review A4 asks
for that to be scoped to the TSP transport work. Until it is, this document is
formally in tension with a stated constraint.

### 8.3 Synergy — the recast is a prerequisite for VRC-over-TSP

The parent plan's ecosystem phase lists "witnessed-exchange as a Trust Task" and
"VRC-over-TSP" without ordering them. The order is forced: the relationship
handshake cannot ride TSP while it is a regex inside a chat message. Once layers
A and B are task documents, changing carriage is a transport swap by §2.3's
byte-identity property — which is the whole argument for doing this work.

### 8.4 Synergy — Phase D supplies the signer we need

The parent plan's §4.5 scopes an `eddsa-jcs-2022` signer for VTA auth. Most
documents here need no `proof` (DIDComm authcrypt authenticates the sender, so
SPEC §4.7.1 permits `proof: OPTIONAL`), but `witness/announce` is a bearer
broadcast and should carry one. That capability arrives with Phase D at no extra
cost to this workstream.

---

### 8.5 The ecosystem has the same gap — which reframes the contribution

The parent plan's §7.6 frames the witnessed-exchange spec as making Keyring's
protocol "legible to the whole VTI world." Upstream's own VRC exchange is
mid-migration: the registry now carries `vtc/relationships/request` (VRC
request/issue as Trust Tasks — worked examples of the DTG idiom for our
`vrc/*` authoring), while the `openvtc` app still speaks its bespoke types.
The *witnessed* exchange remains unmodelled anywhere but here.

`openvtc` runs peer-to-peer VRC exchange over bespoke DIDComm message types
under authorities it does not share with the framework
(`openvtc-core/src/lib.rs`, `protocol_urls`):

```rust
VRC_REQUEST  = "https://firstperson.network/vrc/1.0/request"
VRC_REJECTED = "https://firstperson.network/vrc/1.0/rejected"
VRC_ISSUED   = "https://firstperson.network/vrc/1.0/issued"

RELATIONSHIP_REQUEST          = "https://linuxfoundation.org/openvtc/1.0/relationship-request"
RELATIONSHIP_REQUEST_REJECT   = ".../relationship-request-reject"
RELATIONSHIP_REQUEST_ACCEPT   = ".../relationship-request-accept"
RELATIONSHIP_REQUEST_FINALIZE = ".../relationship-request-finalize"
```

No `payload` schema, no `#request`/`#response` fragments, no `trust-task-error`
vocabulary — outside the framework entirely, exactly as ours is.

Meanwhile the *membership* credential exchange in the same codebase **is**
trust-tasked: `openvtc/src/state_handler/message_dispatch.rs` auto-answers
`members/request-vmc/1.0` by minting and returning a reciprocal credential via
`issue_and_send_member_vmc()`. Both live in the same dispatch function.

**The dates explain why, and they matter for how much weight to put on this:**

| Artifact | Date | Evidence |
|---|---|---|
| VRC protocol constants introduced | 2026-02-26 | initial import |
| Constants last changed | 2026-04-12 | v0.1.4 release chore |
| `openvtc-core/src/vrc.rs` | 2026-05-06 | **one commit ever**; untouched since |
| Last VRC *logic* change | 2026-06-10 | #93 — a refactor moving dispatch off the event loop |
| VMC trust-task implementation | 2026-06-22 | #147, #148 — feature commits |
| `vtc/members/{solicit-vmc,request-vmc,vmc}` specs | 2026-07-26 → 07-29 | registry |

Later edits to the VRC files (2026-07-23, #175/#181) are agent-name display
sweeps, not VRC work.

**Read carefully: frozen, not abandoned.** The VRC path is fully wired —
`AcceptVrcRequest` / `RejectVrcRequest` inbox effects, VRC creation and signing
with `DataIntegrityProof`, rejection messages returned to the requester — and
the CHANGELOG records an e2e test driving a two-leg VRC request/reject
round-trip. It works and ships. There is no TODO, deprecation marker, or
recorded migration intent anywhere near it.

So the sequence upstream was: build VRC exchange ad-hoc (early 2026) → adopt
Trust Tasks as the operation layer → migrate newer flows onto it (VMC, June;
`credential-exchange`, July) → **never go back for VRC exchange**.

**Consequences for this workstream:**

- The contribution case is stronger than §7.6 states. We would not be
  translating a Keyring-specific protocol for others' benefit; we would be
  supplying a family the reference implementation is missing too.
- We should expect to have to justify the family against `openvtc`'s existing
  bespoke types, and ideally get their buy-in to converge — otherwise the
  registry acquires a second way to do relationship exchange.
- `vtc/members/*` is the template to copy (§4, Layer A), and it is recent enough
  to be a safe idiom to imitate.

**Caveat on the above.** That reconstruction is inference from commit history.
It is worth confirming, but the contribution case **no longer rests on it** —
see the next subsection, which is documentary.

#### The gap is explicitly delegated, not merely unfilled

The credential specification does not treat the witness-ceremony Trust Task as
an oversight. It **names it, requires it, and assigns it to someone**:

> A VWC **MUST** be bound to the [trust task] exchange in which it was issued
> via the `taskContext` property.

and then, having defined what a qualifying specification must satisfy:

> **This specification does not define such a Trust Task specification itself;
> doing so is the responsibility of the governing VTC/VTN, coordinated where
> applicable with the Trust Tasks task force.**

So the position is:

- The VWC is normatively specified and **cannot be conformantly issued** without
  a qualifying Trust Task specification to bind to.
- No such specification exists in the registry today.
- Authoring one is explicitly delegated to the governing VTC/VTN, in
  coordination with the task force.

That is a materially stronger basis for parent §7.6 than "upstream has not got
to it yet". We would be filling a **named dependency of a published normative
specification**, along a governance path that specification itself lays out. It
also means the work is not optional for us: Keyring issues VWCs, and without a
qualifying ceremony specification our VWCs cannot carry a conformant
`taskContext`.

The `credentials/_shared/0.1` component makes the same invitation from the
registry side — its scope is "every family that issues or revokes a Verifiable
Credential (`vta/credentials/*`, `vtc/endorsements/*`, **and future issuers**)."

#### The framework editor has now invited this work by name

*Source: [dtgwg-trust-tasks-tf#173](https://github.com/trustoverip/dtgwg-trust-tasks-tf/issues/173#issuecomment-5189686547).*

The delegation is no longer only documentary. Closing his response, the framework
editor writes:

> The worked example is yours if you want it — **a relationship-witnessing Trust
> Task specification satisfying the qualifying profile, as a joint appendix**.
> That's the best test of whether the profile is actually satisfiable, and we'd
> rather find out on a real specification than in prose.

That is layer C, named, offered, with a publication venue attached. It changes
parent §7.6 from a contribution we would propose into one the editor has asked
for, and it supplies the strongest possible answer to open question 1
(authority): a joint appendix in a task-force repository is neither a private
authority nor an unsolicited registry PR.

It also carries an obligation worth stating plainly: the appendix is explicitly
a **test of whether the qualifying profile is satisfiable at all**. If our
ceremony cannot satisfy it, that is a finding the framework wants, not a failure
to hide — and the three constraints recorded in §4, Layer C are the places it is
most likely to bind.

The editor is separately taking four framework changes as a PR — error responses
inheriting the originating specification's proof requirement; error responses
naming the originating `type` and `id`; an optional per-variant proof
declaration; and a normative terminal/non-terminal classification of reply
documents. **Our specification should be authored against the post-PR
framework**, and should not hand-roll a terminal/non-terminal split of its own —
the editor asked specifically that cred-spec not do so.

#### Branch survey — no new VRC work is underway

Checked across every branch of `verifiable-trust-infrastructure`, on a tree
re-fetched to current `origin/main` (2026-08-04):

- **Three remote branches exist.** `origin/main`; `consolidate/s9-conformance`
  (2026-07-29) — conformance sweeps, **zero** VRC or relationship files;
  `ceremony` (2026-06-02, unmerged, two months stale) — ceremony design notes
  only.
- **`trust-tasks/relationships/` is unchanged on current main** — still
  `{list, publish, revoke}/1.0`, all three still `status: retired`. No exchange
  or issuance task has appeared.
- **The only relationship-touching commit in 108 new commits** is #773
  (2026-07-24), "show names where we used to show DIDs" — a display change.
- **The `ceremony` branch consumes VRCs, it does not exchange them.** Its
  catalog treats a VRC as an admission-policy input ("an invitee with a VIC from
  a CTA **and** a verifiable relationship credential from a *different* CTA…
  admission is independently witnessed") and restates the publish-only model:
  "**Relationship** (VRC) | member → other member | self-issued VRC | store edge
  if both are members."

**The decisive evidence is upstream's own roadmap.**
`tasks/vtc-mvp/phase-5-plan.md` lists "Bilateral VRC counter-signing" under
out-of-scope, and states:

> **MVP gate met.** Phase 6+ is post-MVP (**witness / RCard credentials,
> bilateral VRC counter-signing**, etc.; none in scope for this plan).

Upstream names all three of **witness credentials, RCard credentials, and
bilateral VRC counter-signing** as post-MVP Phase 6+ work, unstarted. Keyring
ships all three today. This is a deliberate deferral, not neglect — which
sharpens the framing: the gap is scheduled, we are ahead of it, and the window
to define the family is open rather than contested.

**Terminology warning.** "Witness" in the VTI codebase is mostly the
`did:webvh` pre-rotation sense (key witnesses), *not* our ceremony witness. The
one exception is the `ceremony` branch's personhood row — "VP w/
`WitnessCredential`" — which is closer to our VWC. Do not conflate the two when
reading that code or naming our slugs.

## 9. Sequencing

Each step names what makes it **done**. A step without a completion test is a
step an implementer either stops short of or gold-plates.

### 1. Resolve review A1 — `tsp-core`'s dependency direction

Precondition for everything below. The trust-task model must depend on a carriage
port, not on TSP envelope orchestration, or layer C has to carry its own task
spine (§8.1).

**Done when:** `tsp-core`'s task model compiles and its tests pass with the TSP
wire package absent from its dependency graph.

### 2. Author the `vrc/*` and `witness/*` specifications

**Drafted — staged as
[Mickens-Lab/dtgwg-trust-tasks-tf#3](https://github.com/Mickens-Lab/dtgwg-trust-tasks-tf/pull/3)**
(four specs: `vrc/relationship/{propose,issue}`, `witness/session{,/submit}`,
targeting framework 0.4, registry-validated with bindings regenerated;
authored from the running exchange in
[`ref-06w`](../../../tsp-reference/ref-06w-witnessed-exchange/)). Open in
review: namespace/CODEOWNERS, category, bilateral-submission expression,
challenge-vs-transcript upgrade path — enumerated in the PR. Upstream
submission follows review.

The freeze-gate this step once carried is open: the framework editor's #173
changes (per-variant proof, self-describing errors) landed in 0.3, and the
drafts target 0.4.

**Done when:** each spec has front matter declaring parties, proof requirement,
`sideEffects`, `exposure` and error codes; a `payload.schema.json` validating
against the registry meta-schema; and `witness/session` + `witness/session/submit`
each declare `proof: REQUIRED` and a `#response` — i.e. they satisfy the
qualifying profile of [[DTG-CRED]] §Trust Task Context Binding. Verify by
round-tripping a sample document through the framework schema plus the payload
schema.

### 3. `didcomm-v1-basicmessage` binding

Parent Phase D, once the ports exist. Prerequisite for steps 4–6.

**Done when:** a Trust Task document round-trips between two Credo agents over a
basic message; the receiving side derives peer identity from the connection's
`theirDid` and rejects a document whose in-band `issuer` disagrees with it
([[TT-SPEC]] §4.8.1); and a `trust-task-error` returns on the same connection.

### 4. Adopt `credential-exchange/{query,present,pending/*}`

Over that binding, against `vta-service`. No spec authorship and a genuinely live
counterparty, so a failure is unambiguously ours. Also the consent-gating path
the parent plan's Phase E demo depends on.

**Done when:** a DCQL query from `vta-service` is received, deferred, surfaced for
approval, approved, and answered with a `vp_token` that `vta-service` accepts —
and the same fixtures pass in Node against the reference adapter. Interop evidence
for parent §7.9 falls out of this.

### 5. Implement layer C — `witness/*`

On `tsp-core`'s task model, including **outcome-evidence retention** (§4, Layer
C). Retention is the item with a silent failure mode: without it the VWCs still
verify as credentials and simply fail to prove what they exist to prove.

**Done when:** a witnessed exchange completes over the new tasks; the issued VWC
carries `taskContext` equal to the ceremony's initiating document `id`; the
ceremony's `#response` is persisted with its proof and retrievable by that
identifier; a presentation assembles credential and outcome evidence together;
and `e2e:vrc:devices` stays green.

### 6. Implement layer A — `vrc/relationship/propose` + `/issue`

With `trust-task-discovery` replacing the `rceVersion` ladder.

**In progress, sliced (Keyring, `feat/trust-tasks-integration`).** Landed and
e2e-proven on the production mediator: the propose exchange (deterministic
proposer, binding-0.2 carriage, gated on `rceVersion` v4 for now) and the
issue leg in **shadow mode** — signed VRC delivered on the exchange thread
with a real eddsa-jcs-2022 request proof (the REQUIRED declaration pulled
this part of step 5's proof work forward), digest receipts recomputed and
correlated both directions, refusals as `trust-task-error`. The legacy
issue-credential 2.0 leg remains the storage authority, and the e2e suite
gates on the ceremony markers. Evidence:
[`docs/spikes/trust-task-propose-evidence.md`](../../spikes/trust-task-propose-evidence.md);
reasoning: [`2026-08-18-al.md`](./2026-08-18-al.md).

**Remaining delta to done:** two wallets complete an unwitnessed exchange over
the new tasks and both **store** the counterparty's VRC from the task (the
authority flip); capability negotiation runs through `supportedTypes` rather
than an ordinal version; the proof *verifier* replaces `acceptUnverified`; a
legacy peer still completes an exchange via the dual-send path (§7.2); and
the witnessed path from step 5 still passes.


## 10. Open questions

1. **Authority for the private specs.** Do we publish under a domain we control,
   or is upstreaming `vrc/*` and `witness/*` into the public registry (alongside
   `vtc/*` and `vta/*`) the intent from the start? This changes slug choices.
   *(Same question as review Q2 — answer once.)*

2. **Is the invite / air-gap case real for us?** `credential-exchange/issue`'s
   `sealed` path is built for exactly "credential minted for whoever holds a
   key, may sit in a relayer queue before reaching them." This does not affect
   ordering, but it decides *scope*: if our invite flow needs a sealed transfer,
   we need an equivalent on the DTG delivery path, which `vtc/members/vmc` does
   not provide.

3. **Is unidirectional mode still live**, or is bidirectional the only path in
   practice? If unidirectional is dead, layer A's payload simplifies
   considerably and `shouldIssue` disappears entirely.

4. **Is issuer-side OID4VCI a call we can make**, or does it need buy-in from
   whoever owns the broader wallet roadmap? **Now the critical-path question** —
   no issuer-side OID4VCI exists in the tree today (holder-side only). Now
   lower-stakes than it looked: §4 Layer B keeps VRC delivery on the DTG idiom,
   so issuer-side OID4VCI is needed only if we later issue credentials to
   OID4VCI holders.

5. **Who else consumes the witness protocol?** If `witness-server` is the only
   counterparty, layer C is a two-codebase change. If `openvtc` or
   `vta-browser-plugin` speak it, the migration is wider.
   *(Same question as review Q3 — answer once.)*

6. **How does the RCard travel once the DTG VDS specification lands?** It is a
   verifiable data structure, not a DTG credential, so it cannot ride
   `vrc/relationship/issue` (§4, Layer A). Sibling task, `ext` namespace, or
   stay on Credo until that spec publishes? Deciding early risks building
   against a shape that changes.

7. **Already-issued VWCs are legacy-tolerated** *(decided; recorded here because
   it constrains implementation)*. Keyring is not in
   production, so no VWC issued to date has a relying party. Already-issued VWCs
   carry no `taskContext` and will not be re-issued or migrated; they are simply
   never presentable as completion evidence. No compatibility shim is needed, and
   the new `taskContext` requirement can be enforced unconditionally from first
   implementation rather than gated behind a legacy branch.

---

## 11. Companion edits owed in `dtgwg-cred-spec`

*Reminder only — these are edits to [[DTG-CRED]], a different repository, where
we hold the pen. Tracked here because they follow directly from the design in
this document and from the framework editor's response on
[#173](https://github.com/trustoverip/dtgwg-trust-tasks-tf/issues/173#issuecomment-5189686547).
Nothing in Keyring depends on them landing; the spec text and our
implementation simply disagree until they do.*

| # | Edit | Gated on | Why it matters here |
|---|---|---|---|
| 1 | **Re-anchor `taskContext` on the initiating document's `id`** — the text currently says `threadId` | Nothing; can be done now | §5 of this document already anchors on `id`, per the editor's recommendation ([[TT-SPEC]] §4.3 gives normative uniqueness; §4.9 explicitly gives `threadId` none). Until the edit lands, we implement against advice the spec text does not yet reflect |
| 2 | **Drop cred-spec's hand-rolled terminal/non-terminal split** and cite the framework's definition instead | The editor's framework PR, change (4) | The editor asked specifically that cred-spec not hand-roll this, so that one citation survives `trust-task-ok` landing under [[TT-SPEC]] §8.6. Our current two-branch definition (a `#response` **or** a `trust-task-error`) breaks the moment §8.6 is filled in |
| 3 | **Cite §7.3 requirements by name, with a pinned framework `MAJOR.MINOR`** | Nothing; can be done now | cred-spec currently cites by item ordinal ("§7.3 item 8", "item 7.6"). Items 13–14 were added in framework 0.3 and nothing in CI guards the numbering, so the citations are a latent breakage. [[TT-SPEC]] §7.3's target-framework-version declaration is the natural anchor |

All three edits are drafted, together with the qualifying-profile rewording
and the retained-evidence pairing checklist, as
[Mickens-Lab/dtgwg-cred-spec#3](https://github.com/Mickens-Lab/dtgwg-cred-spec/pull/3)
(the framework changes edit 2 waited on landed in 0.3/0.4). The related W3C
crypto alignment — `digestMultibase`, `DataIntegrityProof`/`eddsa-jcs-2022` —
is [Mickens-Lab/dtgwg-cred-spec#2](https://github.com/Mickens-Lab/dtgwg-cred-spec/pull/2).
Both pend internal review; upstream submission follows the still-open
upstream #15.

---

## Appendix — key source references

| Concern | Location |
|---|---|
| Handshake send | `bifold/packages/core/src/modules/vrc/vrc-manager.ts:2180` |
| Handshake parse | `…/vrc-manager.ts:1410-1424` |
| Exchange mode / goal code | `…/vrc-manager.ts:1461-1462` |
| `shouldIssue` derivation | `…/vrc-manager.ts:1464-1469` |
| Capability gates | `…/vrc-manager.ts:379` (`Vc20`), `:394` (`Di`) |
| VRC offer | `…/vrc-manager.ts:609` |
| RCard offer | `…/vrc-manager.ts:705` |
| Offer accept | `…/vrc-manager.ts:1835` |
| Unknown-type fall-through | `…/vrc-manager.ts:1385` |
| Witness session request / VP submit | `…/witnessed-vrc-manager.ts:95`, `:223` |
| Witness server dispatch | `bifold/packages/witness-server/src/WitnessService.ts:1146-1197` |
| OpenID4VC module registration | `bifold/packages/core/src/utils/agent.ts:133` |
| Holder-side OID4VCI / OID4VP | `bifold/packages/core/src/modules/openid/` |
| Witnessed flow narrative | `bifold/packages/vrc-reference/WITNESSED_FLOW.md` |
