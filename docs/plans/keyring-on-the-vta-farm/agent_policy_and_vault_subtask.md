# The agent keeps the rules and the cards — approval rules and the credential vault

**Status:** Proposal for review. Not a commitment to implement. **226 builds the vault half only (§4, phases V1–V2). Approval rules (§2–3, phases A1–A2) are held, not built**: on a hosted agent enforcement is off and its owner cannot turn it on (measured 2026-09-26; see the companion's F5), so rules set from the phone would do nothing. They resume if the host enables enforcement or upstream exposes it (VTI-Q33).
**Parent:** [`keyring-on-the-vta-farm.md`](../keyring-on-the-vta-farm.md). This subtask carries two owner features of **F3 — The everyday interface (L1)**: the owner chooses what the agent may do without them, and the agent keeps the person's community credentials.
**Siblings:** [`own_agent_subtask.md`](./own_agent_subtask.md) makes the phone the agent's owner; this subtask builds on that owner. [`community_vetting_subtask.md`](./community_vetting_subtask.md) is where the credentials kept here come from.
**Reasoning:** [`2026-09-26-cd.md`](./2026-09-26-cd.md) — the protocol facts, read at the pins with citations, and the positions taken on each choice below.
**Screens:** owned by the UI/UX lane's companion; this document owns the calls behind them and names the constraints the screens must honour (§6).
**Baseline:** VTI `ed672fff`, openvtc `ed13d29`, vta-browser-plugin `43e2cc7`, trust-tasks-tf `bdae1cf9`, all at the pins in `scripts/openvtc/PINS.json`; bifold main `c8b8e641`.

---

## 0. The plain version

- **Approval rules.** The owner picks which of the agent's actions need their OK first. The agent keeps the rules, so they hold for every device that owns it. When an action needs an OK, the agent sends the owner's phone a request; the phone asks for Face ID and answers.
- **Kept by your agent.** Every card a community gives the person — their membership, their role, a vetter grant — is also stored with their agent. A lost or replaced phone gets them back from the agent: "Get your cards from your agent".
- **Two honest limits, from the agent software itself.** A rule only takes effect where the agent's host has switched rule enforcement on, and a phone cannot yet tell whether it has (§3.4). And a card signed in a newer two-signature form is refused by the agent's store today (§4.4), so that card stays on the phone only until upstream fixes it.

## 1. Where each piece lives

| Piece | Kept by | Read by | Written by |
|---|---|---|---|
| Approval rules and approver sets | the agent: one policy row, id `approvals` | any admin of the agent | an unrestricted admin (every own-agent owner phone is one) |
| Pending approval requests | each approving device, locally | that device | the agent, by push |
| Community credentials | the agent's credential vault, scoped to the persona's context | owner devices with vault read | the phone that received them |
| The local copy the Wallet shows | Credo on each phone (`W3cCredentialRecord`) | the Wallet tab | the phone, from what it received or read back |

The agent is the source of truth for both rules and credentials. The phone's copy is a cache for offline use.

## 2. Approval rules

### 2.1 The model

A rule names **one Trust Task type**, optionally narrowed to contexts, and what it requires:

- `reauth` — the requesting device re-proves itself (step-up); the elevation lasts about 15 minutes.
- `consent` — N approvals from a named **approver set** of DIDs, optionally excluding the requester.

There are no fixed action groups upstream. **Keyring defines the groups the owner sees**, each a list of task types (§2.4), and writes one rule per task type in the group.

### 2.2 The calls

| Owner act | Call | Needs |
|---|---|---|
| Read the rules | `policy/get/0.1` for id `approvals` | Admin or Initiator |
| Change a rule or an approver set | `policy/get` then `policy/upsert/0.2` with `expectedVersion`; the row carries the rules in `ext["openvtc.approvals"]`, the sets in `ext["openvtc.approver-sets"]`, and the Rego the VTA re-derives and compares byte for byte | unrestricted Admin (super-admin) |
| Answer a request | `task-consent/decision/0.1` `{challenge, payloadDigest, decision}` with a Data-Integrity proof by an approver-set member | membership of the approver set, not an ACL right |
| Learn of a request | `task-consent/request/0.1`, pushed once per request by the agent (TSP when the device was seen on TSP, else DIDComm at its mediator) | a route to the approver's DID |

Keyring already answers `task-consent/request` as an approver; the pending list is that inbox (§3.2).

### 2.3 Keyring's rule writer must match upstream's byte for byte

The VTA rebuilds the Rego from the declarative `ext` and refuses a row whose Rego differs. Keyring ports `synthesize_rego` and proves it with two-way conformance vectors against vta-sdk in CI, the same way documents are judged today (`docs/VTI_CONFORMANCE_INVENTORY.md`, the card-verify job). A rule Keyring cannot synthesize exactly is not offered.

### 2.4 The groups the owner sees

Proposed; the task lists are fixed in the companion and reviewed with UI/UX:

| Group (owner's words) | Task types | Default |
|---|---|---|
| Adding or removing a device | `acl/grant`, `acl/revoke`, `acl/swap-key` | consent |
| Changing these rules | `policy/upsert`, `policy/delete` | consent |
| Making a new identity | the persona mint tasks | off |
| Signing for you | `keys/sign` | off |
| Handing over your cards | the vault present / credential-exchange present tasks | off |

Each group has a two-way choice: needs your OK / doesn't. "Needs your OK" writes `consent`, approver set `owners` = every owner device's DID, `minApprovals` 1.

### 2.5 The approver set is the owner devices

The set `owners` lists the long-term DID of each owner device. Keyring keeps it current:

- when a device is added or removed on My devices;
- **after every key swap**, because `acl/swap-key` moves the ACL entry to the new DID but the approver set still names the old one (VTI-46's neighbour; §5). The own-agent first connect is a swap, so a phone writes itself into `owners` only after it.

## 3. Approvals on the phone

### 3.1 A request arrives

The phone already receives `task-consent/request/0.1` (consent approver role). It verifies the agent's signature, shows what the action is in plain words, asks for Face ID, and answers `approve` or `deny`. Unchanged by this subtask except that more requests now come.

### 3.2 Pending is local

There is no task that lists pending approvals. A request is pushed **once**; the phone keeps it durably until answered or expired (the agent drops it after 900 s; a grant lives 600 s). A phone that was offline for the push does not see it; the requester re-submits and the agent pushes again.

### 3.3 Asking for approval from the phone itself

When the phone's own request needs consent, the agent answers `taskFailed` with `reason: auth:consent_required` and the challenge. The phone says "waiting for your OK on another device" (or, with `excludeRequester` off, asks its own owner to approve), then re-submits the same payload once the `task-consent/granted/0.1` notice arrives.

### 3.4 Whether rules are enforced

Rules gate nothing unless the agent's configuration sets `policy.enforcement = true`, which takes a restart, and no task reports it. So the rules screen **does not claim a rule is in force**. It says "Your agent's host decides whether these rules are enforced" until upstream exposes the flag (VTI-Q33). On the lab twin we set it and test enforced behaviour; on the Farm we measure it once and record the answer.

## 4. The credential vault

### 4.1 Write-through: the phone stores what it receives

A community delivers each credential as its own `credential-exchange/issue/0.1`, to the **persona DID**. The phone collects it (the persona inbox), keeps it locally as today, and then stores it with the agent:

`vault/credentials/receive/0.1` `{ credential, id: <the VC's id>, contextId: <the persona's context> }`

- **`id` = the VC's own `id`**, so a retry or a redelivery overwrites the same record instead of duplicating it.
- **`contextId` = the persona's context**, always sent. An unrestricted admin that omits it stores the credential unscoped, visible to every vault reader of the agent (§5, VTI-Q36).
- Membership, role and vetter grant all go; openvtc syncs memberships only, and we keep the roles and grants too, because a restored vetter needs the grant.

The agent does not receive persona-addressed messages itself (it listens only as its own DID), so there is no direct community-to-vault path today (VTI-Q35). Write-through by the phone is the design, not a workaround.

### 4.2 Read-back: a new or restored phone

1. `vault/credentials/query/0.1` with `{ purpose: "membership" }`, then `{ purpose: "endorsement" }` (roles and vetter grants both file as `endorsement`).
2. `vault/credentials/get/0.1` for each id.
3. Keep only credentials whose `credentialSubject.id` is one of this agent's personas, and match each to its community by `issuer`. The query has no subject or community filter.
4. Import each as a `W3cCredentialRecord` (§6) and rebuild the community membership records from them.

A phone that did not make the personas — a second owner phone or a reinstalled one — has no persona records, and step 3 needs them. How it learns them from the agent is open question 4 below; it shares ground with [`own_agent_subtask.md`](./own_agent_subtask.md)'s backup owner.

### 4.3 Revocation

The vault refreshes a credential's status only when it is presented. A read-back list can therefore show a revoked card as valid; the phone checks each card's status list itself before showing it as current.

### 4.4 A two-signature card is refused

A community that holds more than one signing key signs with a proof set (an array). The vault refuses it ("proof has no verificationMethod"; VTI-44 (e)). The phone keeps such a card locally, stores nothing, and shows "Not yet kept by your agent" on it. The write-through retries once upstream accepts proof sets. Until then the lab's hybrid community is the negative case in the gate.

## 5. Upstream questions this raises

Recorded in `docs/VTI_UPSTREAM_FINDINGS.md`; not sent.

- **VTI-Q33** — `policy.enforcement` is invisible to clients: a rule can be written and do nothing, and no client can tell.
- **VTI-Q34** — no task lists or reports pending `task-consent` requests; an approver that missed the one push cannot find the request.
- **VTI-Q35** — the VTA holds its personas' keys but does not receive what is addressed to them, so a community cannot deposit into the holder's vault; and the VTA's own `issue` path stores with a random id and unscoped.
- **VTI-Q36** — `vault/credentials/receive` with no `contextId` stores unscoped for a super-admin (the spec says "the consumer's own context"), and a receive with an existing id overwrites another context's record and revives an archived one.
- **VTI-44 (e)**, existing — the vault refuses proof-set credentials.
- **VTI-46**, existing — `acl/swap-key` drops approver and step-up fields; approver sets name DIDs and are not moved either.

## 6. What the screens must honour

- Store vault cards as **`W3cCredentialRecord`** (V1); the Wallet's provider loads only V1.
- The Wallet's hide rule keys on the relationship family (`RelationshipCredential`, `RelationshipCard`, `RCardTemplate`, `WitnessCredential`), not on `DTGCredential`: a membership is `["VerifiableCredential","DTGCredential","MembershipCredential"]` and a role `["VerifiableCredential","DTGCredential","EndorsementCredential"]`.
- The contact rule changes with it. `isPeerVrcCredential` also keys on `DTGCredential`, so an imported membership would list the community in Contacts as an unnamed contact, one per community (measured on a simulator with the real shapes, 2026-09-26). Both predicate changes ship **before** V1 imports anything.
- Vetting statements are also `EndorsementCredential`s. They are not cards and are never imported; only what the inbox classifies as membership, role or vetter grant is (`classifyCredential`, `vtiInbox.ts`).
- These cards have no `name`, a bare-DID `issuer`, and `validFrom` without `issuanceDate`: the title and issuer come from the community's published name, and dates from `validFrom`.
- Dedupe by the VC's `id` (and digest), so a card received and later read back is one card.
- The rules screen never says a rule is enforced (§3.4). Changing a rule is an owner act (Face ID), as removing a device is.

## 7. Phases and gates

### V1 — Write-through and the local card

The phone stores every membership, role and vetter grant it receives in the vault (§4.1), and shows them in the Wallet (§6).
**Gate:** lab (bob runner, the lab community) and Farm (`keyring-runner-prague`, `keyring-test-vtc`): join → the membership and role appear in the Wallet and in `pnm cred-vault query` on the runner, scoped to the persona's context, one record each; a redelivery adds none. The hybrid-signed community: the card shows locally, the vault holds nothing, the card says so.

### V2 — Read-back

A second owner phone, and a reinstalled phone, get the cards from the agent (§4.2).
**Gate:** after V1 on phone A, a fresh phone B claimed onto the same agent shows the same cards; a reader entry in another context sees none of them.

### A1 — Read the rules, answer requests (held)

The rules screen reads and shows the groups (§2.4) with the enforcement caveat (§3.4); pending requests come from the local inbox (§3.2).
**Gate:** lab twin (`carol`) with `policy.enforcement = true`: a rule set by `pnm approvals require` shows on the phone; a gated `acl/grant` from phone B raises a request on phone A, approved with Face ID, and the grant completes.

### A2 — Change the rules from the phone (held)

Writes rules and keeps `owners` current (§2.3, §2.5).
**Gate:** conformance vectors (Keyring's row = vta-sdk's `synthesize_rego` output, both ways) in CI; on the twin, a group switched on from the phone gates the next matching task; after a device swap-key, `owners` names the new DID. On the Farm: one read of whether enforcement is on, recorded (VTI-Q33).

## 8. Open questions

1. Which groups ship first, and their defaults (§2.4) — with UI/UX and the project owner.
2. Whether to rely on step-up (`reauth`) at all on a phone, or offer `consent` only: `reauth` elevates the requester's own session, which on a phone is the same person a second time.
3. Whether the Farm enables `policy.enforcement` — measured in A2, asked of the Farm if off.
4. How a phone that did not make the personas — a second owner phone, or a reinstalled one — learns which DID is its identity for which community before reading cards back (§4.2). openvtc rebuilds from its own saved config plus the vault (`openvtc-core/src/rebuild.rs`); Keyring has no such config on a new phone. Candidate: keep the vault cards whose subject is a DID the agent itself holds (its DID list), and take the community from each card's issuer. To confirm against the VTA's DID-listing task before V2. Blocks V2.
   **The key changes if we adopt.** Today Keyring never adopts the agent's personas: linking reads none of them (`VtaClient.listDids` has no caller), and each store holds one identity and one membership per community, keyed by the community's DID. An agent can hold several identities in one community, as when one agent is shared by several test users (seen 2026-09-26, IN-26: four memberships in one community on one agent). If a new phone adopts the agent's personas, identities and memberships must be keyed by the persona's DID, not the community's, and the screen must say which of them is this phone's, rather than collapsing them into one row.
