# VTI conformance inventory

Every VTI document Keyring **produces** or **accepts**, the upstream code that
judges it, and whether CI checks Keyring against that code. A new document
type is not done until it has a row here with an upstream check in CI, or a
recorded reason why upstream has none.

**Why this exists.** Three times Keyring's producer and Keyring's own consumer
agreed with each other and not with upstream: the Vetting Card digest
(keyring-bifold#116), the vetter's statement, and the vetter's eligibility
presentation (found 2026-09-25 by the openvtc interop harness, Phase 2). Each
passed Keyring↔Keyring, because the only thing checking Keyring's output was
Keyring. The rule since then: **every document Keyring signs or checks is
judged by upstream's own code in CI** (the `vti-conformance` workflow in
keyring-bifold, using `scripts/openvtc/card-verify` built at the VTI pin), not
by a Keyring-vs-Keyring test.

Read on 2026-09-25 against keyring-bifold main `56d8b052`, VTI `ed672fff`
(vta-sdk, vtc-service), openvtc `ed13d29`, and trust-tasks-tf `bdae1cf9`.
Keyring paths are under `packages/core/src/modules/trust-tasks/module/` unless
marked; VTI paths under `vta-sdk/src/` unless marked `vtc-service`. Line
numbers are at those commits.

## Status

| Document | Keyring produces / accepts | Upstream judge | CI checks Keyring with it | Where Keyring differed or checked less | Closed by |
|---|---|---|---|---|---|
| Vetting Card | produces `vtiVetting.ts:1043-1094`; vetter accepts `:735-741` | `vetting::card::verify_card` (`card.rs:270`); openvtc `vetter.rs:546-563` | **yes**: `card-verify` on the card from `sendCard` | Accept side lacks the schema, the issuedAt window (≤15 min, ±60 s), the closed-session check, and recomputing `identityCommitment` | #116 (digest); PR E (accept side) |
| Card digest, identity commitment, match code | `vtiVetting.ts:443`, `:425`, `matchCode.ts:37` | dtg-credentials digest; `card.rs`; `match_code.rs` | **yes**: `vtiConformanceVectors.test.ts` against upstream-computed vectors | Legacy with-proof digest still accepted (`vtiVetting.ts:1159`) until its removal date | #116, #117 |
| Ticket (code, secret, URI) | `vtiVetting.ts:546-570`; accepted `:594-604`, `checkTicketFor` `:229` | `ticket_uri.rs`; openvtc `tickets.rs:280-312` | URI vectors only | Rule 4 (first issuer bound) rests on an unverified envelope `issuer` | PR D |
| vetting/request | produces `vtiVetting.ts:935-944`; vetter accepts `:588-604` | `protocols/vetting.rs:551` `check_request`; openvtc `wire::open` `wire.rs:204` | no | Vetter checks community, `joinDid`==issuer and the ticket, but no envelope proof, no issuer==sender, no type or schema | PR D |
| vetting/request `#response` with `eligibilityVp` (produced) | `vtiVetting.ts:643-658`, `:677-690` | `vetting::eligibility::verify_eligibility_vp` (`eligibility.rs:252`); openvtc `inbound.rs:604-622`, `on_accepted` | no | **Seen live:** `nonce` = Keyring's desk uuid, not the request document id (`eligibility.rs:274`); `proofPurpose` = `assertionMethod`, must be `authentication` (`:43`, schema const). openvtc refused the whole response | **PR C** |
| `eligibilityVp` (accepted by Keyring's applicant) | `vtiVetting.ts:976-985` | `eligibility.rs:252-354` | no | Required `assertionMethod`, so it refused every spec-correct VP. It didn't check holder==vetter, `nonce`, `domain`, VP type, the role credential's issuer/subject/validity, or the manifest's `eligibleVetters.role` | **PR C** |
| vetting/session (produced) | `vtiVetting.ts:693-724` | openvtc `on_session` (`applicant.rs:774`) | no | Omits `parentThreadId` (a producer MUST); `expiresAt` 1 h (RECOMMENDED ≤15 min) | PR E |
| vetting/session (accepted) | `vtiVetting.ts:1023-1040` | openvtc `on_session`: shape, domain==community, not expired, `requestId`, from that vetter | no | Checked nothing | PR E |
| Session `#response` envelope (the card's carrier) | `vtiVetting.ts:1076-1084` | `verify_trust_task_proof_with` (`verify.rs:136`) plus `wire::open` | #118 only (signer only) | The vetter never verifies the envelope; `wire::open` also requires issuer==sender and document type == message type | PR D |
| Vetting statement (produced) | `vtiVetting.ts:750-809` | `vetting::statement::verify_statement` (`statement.rs:231`), `check_against_card` (`:206`) | **yes**: `card-verify verify-statement` | No `taskDigestMultibase` (in the spec's example; upstream doesn't check it) | #116 |
| Vetting statement (accepted) | `vtiVetting.ts:1107-1194` | `verify_statement`; openvtc `on_statement` (`applicant.rs:1068`) | Keyring-side test (#118) | Accepts one with no card sent (`:1157`); openvtc requires the card. **Bypass:** `receiveIssue` stores any statement unchecked (`vtiPersonaInbox.ts:65`, `VtiVetting.tsx:411`, `:1287`), and `checklist()` counts it (`vtiVetting.ts:1432`) | PR D |
| vetting/decline, trust-task-error | produces `vtiVetting.ts:811-822`, `:663-674`; accepts `:1196-1199`, `:1015-1021` | openvtc `inbound.rs:757` via `wire::open` | no | Checks nothing on arrival | PR D |
| Trust Task document proof (every task Keyring sends) | `vtiVetting.ts:377-398`; `vtiAgent.ts:810-836`; `VtaClient.ts:402-416`; `signDocumentProof` (`packages/trust-tasks/src/documentProof.ts:115`, purpose hard-coded `:136`) | vtc-service `trust_tasks/mod.rs:326-349` (issuer==signer); vta-service `trust_tasks/mod.rs:1410-1417` | #118: 2 of about 14 types, signer only | `verifyDocumentProof` falls back to the first VM (`documentProof.ts:295-298`) and is never called on inbound vetting envelopes; `vtiAgent.ts:828-830` falls back to sending unsigned | PR D (all types, issuer binding) |
| Join submit (VP, invitation credential, registryConsent) | `vtiAgent.ts:1075-1099`, VP `:949-956` | vtc-service `resolve_holder` (`mod.rs:1421`), `check_presentation_holder` (`join/orchestrate.rs:713`), statements via `vetting/mod.rs:161` | no (works live) | none seen | PR D (CI step) |
| Supplement, withdraw, status, self-remove | `vtiAgent.ts:966`, `:1051`, `:986`, `:1025` | the VTC's dispatchers | no (work live) | none seen | PR D (CI step) |
| Manifest | read `vtiAgent.ts:860`, REST unsigned `:888-924` | `protocols/vetting.rs:485` `read_requirements`; openvtc `applicant.rs:483` | no | Requirements are not shape-checked | PR E |
| Vetter profile | `vtiVetting.ts:473-516` (unsigned) | `protocols/vetting.rs` `check_shape` (events ≤31 days, https url) | no | Event-span rule not enforced | PR E |
| VTA tasks (whoami, dids/create, keys/export-secret, contexts, consent) | `VtaClient.ts:55-66`, `:383` | the VTA's dispatcher | no (work live) | none seen | PR D (CI step) |
| ACL swap `linkProof` | `VtaClient.ts:544-558` | `AclSwapPresentation::verify` (`swap.rs:315-360`) | no | Fields match on reading | PR B (swap-key recovery); PR D (CI step) |
| DIDComm binding envelope; TSP framing | `vtiAgent.ts:776-786`; `packTrustTaskForPeer` | VTC/VTA dispatch; `tsp_binding.rs:72`, `:98` | TSP spec vectors (`tspRev3.test.ts`), not VTI | none seen | — |
| Membership, role and vetter-grant credentials from a VTC | accepted `vtiInbox.ts:96-128` | openvtc `handle_credential_issue` (`messaging.rs:872`: issuer==from, subject is ours); `vetter_grant` (`inbound.rs:840-857`) | no | Type and subject only; no issuer==sender. The grant is re-presented in Keyring's own eligibility VP | PR E |

## Where upstream has no verifier

Conformance here is to the spec or schema alone. Each is a question in
`docs/VTI_UPSTREAM_FINDINGS.md`:

- a producer's missing `parentThreadId` (the consumer MUST NOT reject for it);
- session `expiresAt` ≤15 min (RECOMMENDED);
- the statement's `taskDigestMultibase` (not read by `verify_statement`);
- the request's `requirementsDigest`, `languages`, `message`;
- how ticket codes and secrets are generated (pattern only);
- `registryConsent` (stored, never verified);
- `acceptsDocumentation`, `sessionHint` (schema only);
- the membership credential's proof (openvtc doesn't verify it either).

## Keeping this current

When a PR closes a row, it updates the row's CI column and "Closed by" in the
same PR. A new document type Keyring produces or accepts gets a row in the PR
that adds it, with its upstream judge in CI.
