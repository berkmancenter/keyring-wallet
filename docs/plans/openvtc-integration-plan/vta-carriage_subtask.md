# VTA-to-VTA Carriage for Relationship and Witness Exchange — Phased Plan

**Status:** Draft for discussion. Not a commitment to implement.
**Scope:** the negotiation-layer Trust Task, its VTA-side authorization and
discovery mechanism, and the upstream contribution items in
`verifiable-trust-infrastructure` and `openvtc` needed so a `vrc/relationship/propose`
can be answered by a counterparty's always-on VTA instead of requiring their
PNM to be online — while keeping the fully-decentralized PNM-to-PNM path a
first-class, always-available mode, never a fallback of last resort, and
keeping locality (physical co-presence evidence) strictly optional wherever it
appears.
**Parent:** [`../openvtc-integration-plan.md`](../openvtc-integration-plan.md).
**Siblings:** [`pnm_cnm_subtask.md`](./pnm_cnm_subtask.md) (the PNM/VTA client
architecture this rides on — §5 in particular) and
[`trust_tasks_subtask.md`](./trust_tasks_subtask.md) (the Layer A/C wire design
this retargets — §4, §5). This document does not restate either; it owns only
the topology and authorization layer neither one currently specifies.
**Reasoning:** [`2026-08-20-bam.md`](./2026-08-20-bam.md) — the investigation
that found the gap, an initial design that conflated locality (a hard,
optional, physical constraint) with credential custody (a soft, revisitable
engineering choice), and the correction that separated them; this document
reflects the corrected model throughout.
**Baseline:** `verifiable-trust-infrastructure@187ad9cd`, `openvtc@3797dd0`,
per [`scripts/openvtc/PINS.json`](../../../scripts/openvtc/PINS.json).

**References:**

- **[[VTA-OVERVIEW]]** — `docs/01-concepts/overview.md` in
  `verifiable-trust-infrastructure`. The "signing oracle with policy" framing
  quoted throughout §1.
- **[[DTTE]]** — `docs/02-vta/task-consent.md` and `docs/02-vta/approvals.md`,
  same repo. The always-on decision mechanism this plan extends.
- **[[VIC]]** — `vtc-service/src/credentials/invitation_verify.rs`, same repo.
  The self-authenticating-stranger precedent §5 builds on.
- **[[WITNESS-SERVER]]** — `bifold/packages/witness-server`, this repo. The
  cold-contact, always-on precedent §5 also draws on; also evidence that
  witnessing itself has no locality requirement (§3).
- **[[LOCALITY]]** — [`../locality-plan.md`](../locality-plan.md). Adds
  optional BLE co-presence evidence *on top of* the witness ceremony; does not
  redefine witnessing as inherently physical (§3).
- **[[AI-AGENT]]** — `docs/02-vta/personal-ai-agents.md`, same repo. The
  Service-consumer pattern named in §3 and open question 7 as the shape a
  future fully-autonomous tier would use, without growing `vta-service`.

---

## 1. What this adds, and why it earns its own document

The value proposition a VTA is supposed to deliver — act on my behalf per
saved rules, even while my PNM is asleep or offline — is real and already
built for the VTA's own administrative surface. [[VTA-OVERVIEW]] states it
plainly:

> A VTA is not a vault, a wallet, or a CA in the classical sense. It is a
> **signing oracle with policy** — clients send unsigned payloads, the VTA
> derives the relevant key, signs in memory, and returns the signature.
> Private key material never leaves the VTA's process.

Paired with [[DTTE]]'s approval ceremony — a gated task parks for up to 15
minutes waiting on a device's decision, but runs immediately when policy
allows it outright — this is a real always-on decision loop. It is also,
today, scoped entirely to Trust Tasks addressed to *your own* VTA: keys, ACL,
vault, config, credential issuance/verification, DID management, community
join. **Nothing anywhere — not in Keyring, not upstream — routes a
peer-to-peer relationship or witness exchange through it.**
[`trust_tasks_subtask.md`](./trust_tasks_subtask.md) §8.5 already found why:
`openvtc`'s relationship protocol predates Trust Tasks (built Feb–Jun 2026)
and was simply never migrated, unlike the sibling VMC membership flow built
alongside it in the same codebase, which was. This is a real, unbuilt gap —
named and delegated by the DTG Core Credentials specification itself to "the
governing VTC/VTN," and the Trust Tasks framework editor has personally
invited Keyring to co-author the missing specification
(dtgwg-trust-tasks-tf#173). This document is that contribution's topology and
authorization half; the wire-shape half is already mostly done in
`trust_tasks_subtask.md` §4 Layer A/C.

It is a separate document from both siblings because it is orthogonal to
each: `pnm_cnm_subtask.md` designs how a PNM drives *its own* VTA and is
silent on who answers a peer's incoming request; `trust_tasks_subtask.md`
designs the wire shape of the exchange and is silent on which kind of party —
a Credo agent or a VTA — sits at each end. Both are correct and unchanged in
what they say; this document adds the layer between them.

## 2. Three topology modes, all first-class

| Mode | Alice's side | Bob's side | Requires |
|---|---|---|---|
| **Decentralized** (today, unchanged) | PNM/Credo agent, own keys | PNM/Credo agent, own keys | Both PNMs reachable (directly, or queued at a mediator until they wake) |
| **VTA-mediated negotiation** (new) | PNM → own VTA → Bob's VTA | Bob's VTA decides, wakes Bob's PNM only if a rule requires it | Both parties have opted their VTA into receiving `propose` (§6) |
| **Mixed** (new) | Either side | The other | Whichever side lacks a VTA-delegate falls back to being addressed directly at their persona |

**Decentralized stays first-class by construction, not by fallback.** Nothing
in this design requires a VTA to exist — the discovery ladder in §4 tries a
VTA-delegate address and, absent one, addresses the counterparty's persona
directly, exactly as `openvtc` and Keyring's current bifold VRC module do
today. A user who never enrols with a VTA loses nothing; they simply never
populate the "VTA-delegate" branch of that ladder, for themselves or as seen
by anyone resolving their identity.

Mixed mode is not a special case to design separately — it falls out of each
side's discovery resolving independently. Alice's outbound choice depends
only on what Bob's identity advertises; Bob's does the reverse. There is no
shared "session mode" to negotiate.

**This table names only the negotiation leg's topology.** What happens after
a "yes" — issuance, and witnessing if any — is governed by §3's separate
axes, not by which mode negotiated the acceptance. A VTA-mediated negotiation
can be followed by locally-witnessed issuance, remotely-witnessed issuance, or
unwitnessed issuance; the two are independent.

## 3. Three independent axes, not one topology rule

The first draft of this document collapsed witnessing, locality, and
credential custody into a single "issuance and witnessing are always PNM
because locality" rule. That conflated a hard physical constraint with a
soft, revisitable engineering choice, and is corrected here — see
[`2026-08-20-bam.md`](./2026-08-20-bam.md) for the full reasoning. The
corrected model has three separate axes:

| Axis | Nature | What it forces |
|---|---|---|
| **Negotiation** (`vrc/relationship/propose/0.1`+`#response`) | No physical or custody constraint | VTA-eligible per §2/§4/§5, unaffected by anything below |
| **Locality** (optional — [[LOCALITY]]) | Hard physical constraint, **only when a given exchange engages it** | When engaged: that specific witness ceremony **must** run PNM-to-PNM — BLE radio and a human body are not things a VTA has. When not engaged: no constraint from this axis at all |
| **Credential custody** (`vrc/relationship/issue/0.1`+`#response`, and VP-signing in *any* witness ceremony, local or remote) | Engineering / duplication-avoidance choice | Defaults to PNM (avoid a second, independently-audited DTG-credential-issuance stack inside `vta-service`), but is a decision this plan can revisit — not a wall (§ open question 7) |

**Witnessing is optional, and locality is optional again on top of that —
two independent "off by default" switches, not one.**
`trust_tasks_subtask.md` §5 already establishes the first: *"An unwitnessed
exchange is the outer thread alone — `propose` → `issue`, with the ceremony
block simply absent. Witnessing is additive, never a precondition."*
[[WITNESS-SERVER]] confirms witnessing itself carries no physical requirement
— its session/challenge/submit protocol runs over plain DIDComm with no
locality signal anywhere in it. [[LOCALITY]] adds BLE co-presence evidence as
an `ext` payload *on top of* an already-optional witness ceremony; it neither
requires witnessing to be used nor makes witnessing physical by definition.
So a relationship exchange has three shapes in practice — unwitnessed,
remotely witnessed, and locally witnessed — and only the last one is
PNM-bound for a physical reason. The other two are PNM-bound (in this
document's default) purely because of the custody choice, which is a
different and weaker kind of constraint.

**Why the custody default is still "stays on the PNM" for v1, stated
honestly this time:** the DTG-credential/VP-construction logic (JCS
canonicalization, `eddsa-jcs-2022` proofs, VRC/VWC shape assembly,
outcome-evidence pairing per `trust_tasks_subtask.md` §4.6) already lives in
the PNM — Keyring's bifold VRC module, `pnm-core`, `openvtc-core`. Porting it
into `vta-service` would mean a second, independently-audited implementation
of crypto-critical logic with no capability gain for the case that most needs
"always on" (locally-witnessed exchange, which the physical constraint rules
out regardless). The gain would be real but narrower than it first looks: a
fully autonomous non-local exchange for pre-authorized counterparties. That
is worth naming rather than either building now or foreclosing — see open
question 7.

**Rejected alternative: give the VTA full VRC/VWC issuance-and-presentation
capability**, so a non-local exchange could run entirely VTA-to-VTA with no
PNM involvement at all. Not rejected outright — deferred, and kept
architecturally possible (§6, open question 7) — because it duplicates
crypto-critical logic for a capability gain that only applies to the
non-local subset, and because VTI already has a lighter-weight way to get the
same result without touching `vta-service` at all (a registered
Service-consumer agent, [[AI-AGENT]], holding its own key for exactly this
purpose).

**Consequence for `pnm_cnm_subtask.md` §9 Q2** (Secure-Enclave vs. VTA-minted
custody): this narrows that tension for the v1 default. The Relationship
DID — the credential-bearing identity — never needs to leave hardware
attestation under this document's default, since the VTA only ever
negotiates (`propose`) on its own key and never touches the credential-bearing
identity. If a future autonomous tier (open question 7) is built, it would
introduce a *new* identity (the registered agent's own VTA-minted key) rather
than exporting the Relationship DID's key — so Q2's tension still does not
reopen even then.

**Wire amendment this requires, flagged for `trust_tasks_subtask.md`:** when
`propose#response` is answered by a VTA on the operator's behalf (`accepted:
true`), the proposer needs to know which Relationship DID and mediator to
continue with for `issue` and any witnessing, since the VTA does not hold
either under the v1 default. Recommend an additive, optional `handoff: {
relationshipDid, mediatorDid }` member on the response payload, present only
when the responder is a VTA-delegate rather than the persona itself —
backward compatible with the existing shape per the framework's
additive-minor-version convention already in use elsewhere in that document.
Tracked as open question 5 below rather than decided unilaterally here, since
it is `trust_tasks_subtask.md`'s spec to amend.

## 4. Discovery: a second ladder, orthogonal to the transport ladder

The parent plan already has one capability-discovery ladder — resolve a
peer's DID document for a service-type advertisement, ranked
`TSPTransport > DIDCommMessaging > VTARest`, cached with bounded staleness,
loud fallback on connect (`openvtc-integration-plan.md` §4.2, quoted in
`pnm_cnm_subtask.md` §2.3's ladder note). That ladder answers **which
transport**. This document needs a second, independent axis answering **which
kind of party**: does the counterparty's identity resolve to a VTA willing to
receive `propose` on their behalf, or only to a bare peer endpoint?

**Recommended mechanism: an optional delegate-service entry on the Persona
DID's own document**, not a new primary handle. Today's discovery path — a
QR code or an ecosystem "agent name" lookup — resolves to a Persona DID;
that stays the stable, already-working identifier. What's new is that
Persona DID's document may *additionally* carry a service entry (new type,
name TBD in coordination with the framework editor — open question 2) naming
the operator's VTA and the Trust Task types it accepts on the persona's
behalf. A resolver that finds this entry addresses `propose` there; one that
finds only a bare `DIDCommMessaging` entry addresses the persona directly, as
today. This composes with existing discovery rather than replacing it, and
requires no change to how personas are found in the first place.

Resolution follows the same shape as the existing ladder: resolve once,
cache with a bounded TTL, re-resolve on failure rather than caching until
rotation (mirroring `pnm_cnm_subtask.md` §2.3's stated reason: upstream
mutates DID documents at runtime without key rotation).

**Directionality is per-identity, not per-conversation.** Each side resolves
the *other's* document independently; there is no shared session-mode
handshake, and either side's answer can change over time (a user enrols with
a VTA, or later disables the delegate advertisement) without the other side
needing to know in advance.

## 5. VTA-side authorization: a new cold-contact-eligible task class

### The gap and the precedent

`vta-service/src/messaging/auth.rs::auth_for_trust_task_envelope` has exactly
one non-ACL path today, the ceremony carve-out (`task-consent/decision/0.1`,
`auth/step-up/approve-response/{0.1,0.2}`) — and it is *not* a stranger
carve-out: both branches require the sender DID to already be named (an
approver set, or `pending.approver` recorded at step-up mint time). Every
other unenrolled DID is refused outright, including at `/auth/challenge`,
which despite "Auth: None" in the route table still calls `check_acl` before
minting a challenge. There is no existing path for a genuinely
never-before-seen DID to reach any handler.

The best-fit precedent in the same codebase is [[VIC]]: a stranger is
authenticated **from the credential's own Data-Integrity proof** (issuer
resolved independently of the presenter, holder-binding checked, validity
window and revocation checked), never from ACL membership — with the policy
decision and single-use consumption tracked as separate concerns layered on
top of that authentication, not folded into it. That three-part shape
(authenticate from the document → decide by policy → track consumption
separately) is exactly right for a first-contact `propose`.

[[WITNESS-SERVER]] is a second, lighter-weight precedent worth naming: it
accepts any DIDComm connection automatically (`autoAcceptConnections: true`,
`WitnessService.ts:339`) with no ACL and no pre-issued credential at all,
gating validity one layer up at the protocol-message-type level. This is a
better match for the common case here — a casual, possibly in-person,
possibly QR-bootstrapped relationship overture — than requiring a
pre-issued VIC for every relationship proposal, which is heavier than the
use case warrants (open question 1 below decides exactly how much prior
pairing, if any, `propose` should require).

### The new branch

A third branch in `auth_for_trust_task_envelope`, alongside the ACL path and
the ceremony carve-out: a narrow, explicit set of "self-authenticating"
Trust Task type URIs — initially just `vrc/relationship/propose/0.1` —
authorized when the document's own DI proof verifies and the proving DID
matches the document's `issuer` (the same envelope invariants
`pnm_cnm_subtask.md` §2.2 already documents for every Trust Task: `recipient`
must equal the VTA's DID, the document must not be expired). This lands the
request in the Policy Decision Point under a reduced authorization
(`Role::Monitor`-equivalent, no contexts) — **it does not auto-accept the
relationship; it only lets the request reach the point where a decision gets
made.**

### The decision itself

No existing PDP rule covers this task family, so a default disposition has to
be chosen for a VTA that has never configured one. **Recommend
default-deny-with-notify** — i.e. the same shape as an unconfigured
`requireConsent` rule, so a fresh VTA doesn't silently accept or silently
reject unsolicited relationship overtures before its operator has expressed a
preference. The operator then sets a standing rule the same way approvals
already work: `pnm relationships policy set --default {accept,reject,consent}`,
reusing the existing approvals/Rego policy engine rather than building a
second one, with room to grow into finer-grained Rego (e.g. "auto-accept from
a DID with an existing mutual VRC," "accept only during an event window" —
[[LOCALITY]]-adjacent, out of scope here) later.

### Anti-spam

Opening any authorization path to unregistered strangers needs a rate limit —
precedented already at `/bootstrap/request`, documented "None (rate-limited)"
in `architecture.md`'s route table. `propose` needs the same treatment,
per-sender-DID, so a hostile party cannot force repeated PDP evaluations or
DTTE pushes.

### Audit

Extend `vta_audit` for this family following the DTTE precedent
(`consent.required` → `consent.decision` → ... ): record
`relationship.proposed` → `relationship.disposed` (with the disposition and
whether it was policy-decided or DTTE-decided) at minimum.

## 6. The handoff back to the PNM (or a registered agent)

On acceptance (whether by standing policy or DTTE), two things must happen
before `issue` and any witnessing can proceed:

1. **The proposer needs the accepting operator's Relationship DID and
   mediator** — carried in the `handoff` member flagged in §3, present only
   when a VTA (not the persona itself) answered.
2. **The accepting VTA needs to hand the exchange to whichever party its
   operator's policy names for completing it** — under the v1 default, that
   is always the operator's own PNM, woken via existing infrastructure rather
   than new wake machinery: `device/set-wake/0.2` and the push-gateway
   pattern already documented for personal AI agents ([[AI-AGENT]] §4) are
   the same shape — a VTA waking a device it manages when work arrives for
   it. **Worded generally here on purpose**: if a future autonomous tier
   (open question 7) registers a Service-consumer agent for this class of
   exchange instead of a human's phone, the same hand-off mechanism routes to
   that agent instead — no rework of this step, only of which device the
   policy names.

This wake can be deferred arbitrarily — the `issue`/witness leg already
tolerates async delay the way DIDComm mediator queuing does today, so a phone
that wakes an hour later loses nothing (short of the negotiation's own
`propose#response` TTL having lapsed on the proposer's side, an ordinary
Trust Task expiry case already handled generically).

## 7. What changes in `verifiable-trust-infrastructure`

| # | Item | Where | Acceptance criteria |
|---|---|---|---|
| 1 | `vrc/relationship/propose/0.1` (+`#response`) handler | New module, e.g. `vta-service/src/trust_tasks/relationship.rs` — no close existing structural analogue; `vtc-service/src/relationships/mod.rs` is the nearest neighbor despite being VTC-scoped/no-counterparty | Handler dispatches through the same spine as every other Trust Task family; a well-formed, correctly-proofed `propose` from an unenrolled DID reaches the PDP rather than being rejected at the ACL step |
| 2 | Cold-contact auth carve-out | `vta-service/src/messaging/auth.rs::auth_for_trust_task_envelope` | New branch scoped to exactly the `propose` URI (mirroring the ceremony set's exactness); every other unenrolled-DID Trust Task is refused exactly as before — a regression test analogous to `a_stranger_cannot_use_a_consent_decision_to_reach_the_handler` |
| 3 | PDP default + `pnm relationships policy` surface | `vta-policy`, `pnm-cli` | A fresh VTA with no rule set applies default-deny-with-notify; `pnm relationships policy explain` mirrors `pnm approvals explain`'s behavior of naming an unsatisfiable rule rather than silently doing nothing |
| 4 | Delegate-service DID-document convention + publish toggle | `vta-sdk` (resolution helper), `pnm services` (publish toggle) | `pnm services relationship-delegate enable/disable` toggles the service entry on the operator's persona document(s); default is **disabled** (opt-in — see open question 6) |
| 5 | Rate limiting on the cold-contact path | `vta-service` messaging layer | Repeated `propose` submissions from one sender DID within a window are throttled without affecting other senders or other task families |
| 6 | Audit trail | `vta-audit` | `relationship.proposed`/`relationship.disposed` events recorded with disposition source (policy vs. DTTE) |

None of these items require `vta-service` to gain DTG-credential-issuance or
VP-construction logic — the custody axis in §3 is deliberately kept out of
this list.

## 8. What changes in `openvtc`

Scoped down deliberately, per the research: `openvtc` needs **no** VTA-hosting
capability and **no** daemon mode for this design to work, because Keyring's
own PNM — not `openvtc` — is what will exercise the VTA-mediated path. Its
only role here is remaining a valid **decentralized-mode** interop
counterparty:

1. **Dual-accept `vrc/relationship/propose/0.1`(`#response`) alongside its
   existing bespoke `RELATIONSHIP_REQUEST`/`VRC_REQUEST` types** — the same
   migration shape `trust_tasks_subtask.md` §7.1/§7.3 already establishes
   elsewhere ("receivers already tolerate unknown documents," dual-accept as
   a client-side policy, not a protocol negotiation). This lets `openvtc`
   keep serving as the reference decentralized-mode counterparty without
   adopting any part of this document's VTA-side design.
2. **Explicitly deferred, not required:** a headless/daemon mode. `openvtc`
   has none today (confirmed: `cli.rs` declares only `setup`/`health`;
   everything else is the interactive TUI event loop) and building one is
   real work with no payoff for this plan, since `openvtc` is not the vehicle
   for the VTA-mediated path. Foreseeable if `openvtc` itself later wants to
   demonstrate always-on behavior, but not on this plan's critical path.

## 9. What changes in Keyring

1. **The discovery ladder (§4), client-side** — lands wherever `pnm_cnm_subtask.md`
   §3 ends up putting PNM relationship logic (the `pnm-core`-derived
   `vti-client` package). Note: today, neither `pnm-cli` nor (so far as
   found) `pnm-core` has any relationship code at all — this is genuinely new
   surface, not an extension of an existing PNM relationship implementation.
2. **`propose`/`#response` handling with the topology choice folded in**: try
   the VTA-delegate resolution first; absent one, address the counterparty's
   persona directly — the existing path, never a hard failure.
3. **Handoff consumption** — the existing bifold VRC module's `issue`/witness
   flow gains the ability to start from a VTA-negotiated handoff, not only
   from a self-initiated request. Its existing unwitnessed / remotely-witnessed
   / locally-witnessed branches (§3) are otherwise unchanged.
4. **Cross-reference into `pnm_cnm_subtask.md` §6 P4** (VRC interop with the
   CLI): this is additive scope to P4, not a new phase — P4 already targets
   `openvtc` interop for the decentralized path; its acceptance criteria grow
   a second milestone (the VTA-mediated path) once P2 (authenticated VTA
   session) exists. See §10.

## 10. Phasing

Rides `pnm_cnm_subtask.md`'s existing P-phase ladder rather than adding a
parallel one:

- **Prerequisite:** P1 (approver) and P2 (enrolment/authenticated session)
  must exist — the VTA-mediated path is meaningless before a PNM has an
  authenticated relationship with its own VTA at all.
- **P4 (VRC interop with the CLI), extended:** P4's existing acceptance
  criterion (a scripted `openvtc` counterparty for the decentralized path,
  per `pnm_cnm_subtask.md` §5.3/§9 Q1) ships first, proving the wire shape
  and the discovery ladder's "no delegate found" branch — and proving all
  three of §3's exchange shapes (unwitnessed, remotely witnessed, locally
  witnessed) work unchanged from today. A second milestone — the
  VTA-mediated negotiation path, requiring items 1–4 of §7 upstream and this
  document's client-side pieces — follows once both are available. Do not
  gate the first milestone on the second; the decentralized path is complete
  and demo-able on its own.

## 11. Open questions

1. **Does `propose` require a prior out-of-band pairing step** (a QR-exchanged
   invitation object, [[WITNESS-SERVER]]-style) **before a cold Trust Task is
   accepted at all, or is a correctly-proofed `propose` from a truly unknown
   DID acceptable on its own**, gated only by the PDP disposition in §5? The
   lighter (no-OOB-prerequisite) design is recommended above but is a real
   fork, not a settled default — an OOB-first design trades a materially
   simpler VTA-side trust model for a UX step this plan has not designed.
   **Blocks:** §5's exact shape. **Ours; decide before item 1 in §7's table is
   built.**
2. **The delegate-service DID-document type/shape** — coordinate with the
   framework editor given the standing joint-appendix relationship
   (`trust_tasks_subtask.md` §8.5) rather than mint one unilaterally.
   **Blocks:** §4, §7 item 4. **Joint, not ours alone.**
3. **Default PDP disposition for `propose`** (accept/reject/consent) — a
   product decision, not a technical one, same shape as
   `pnm_cnm_subtask.md` §9 Q9. **Blocks:** nothing — ships on the
   recommended default either way. **Ours.**
4. **Rate-limit thresholds** for the cold-contact path. **Ours, mechanical,
   cheap to defer to implementation.**
5. **The `handoff` wire amendment (§3)** — author it against
   `trust_tasks_subtask.md` §4 Layer A directly, or treat it as this
   document's own addendum until upstreamed? Recommend authoring it in
   `trust_tasks_subtask.md` since it changes that document's own spec.
   **Blocks:** §3, §6. **Ours; cheap to decide, do it before P4's second
   milestone.**
6. **Opt-in or opt-out for the delegate advertisement once P2 ships?**
   Recommended default is **disabled** — a user may want VTA custody for
   other reasons (backup, approvals, agent hosting) while keeping
   relationships strictly decentralized, matching the standing requirement
   that decentralized mode is never merely a fallback. **Blocks:** §7 item 4's
   default. **Ours.**
7. **Should a fully-autonomous, non-local relationship-formation tier ever be
   built, and if so as a `vta-service` capability or a registered
   [[AI-AGENT]]-pattern companion process?** Named in §3/§6 and deliberately
   not decided here. The registered-agent shape is recommended over growing
   `vta-service` (no duplicated credential logic, reuses an existing pattern),
   but this is a real product-scope call — is "auto-form relationships with a
   pre-approved class of counterparty, no human involved" a capability we
   actually want to offer, and to whom? **Blocks:** nothing in this plan —
   the v1 design is unaffected either way and the handoff mechanism (§6) is
   already worded to accommodate it without rework. **Ours; revisit once P4's
   two milestones are real and there's a concrete request for it.**

## 12. Sources

- `verifiable-trust-infrastructure@187ad9cd`: `docs/01-concepts/overview.md`;
  `docs/02-vta/task-consent.md`; `docs/02-vta/approvals.md`;
  `docs/02-vta/personal-ai-agents.md`;
  `docs/02-vta/integration-guide.md`;
  `docs/03-vtc/community-lifecycle.md`;
  `vta-service/src/messaging/auth.rs`;
  `vtc-service/src/credentials/invitation_verify.rs`;
  `vtc-service/src/relationships/mod.rs`;
  `docs/01-concepts/architecture.md` (route table).
- `openvtc@3797dd0`: `openvtc-core/src/{relationships,vrc,identity,bip32}.rs`;
  `openvtc-core/src/config/mod.rs`; `openvtc/src/cli.rs`;
  `docs/design/t1-active-identity-api.md`; `openvtc-core/src/health.rs`.
- This repo: `bifold/packages/witness-server/src/WitnessService.ts`;
  `bifold/packages/core/src/modules/vrc/vrc-manager.ts`.
- [`pnm_cnm_subtask.md`](./pnm_cnm_subtask.md) §2.2, §2.3, §5, §9.
- [`trust_tasks_subtask.md`](./trust_tasks_subtask.md) §4, §5, §7, §8.5.
- [`../locality-plan.md`](../locality-plan.md).
