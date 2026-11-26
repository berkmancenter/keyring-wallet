# Track notes: HCP layer coverage, conformance, the MCP binding, and the agent-memory flow

Read-only review, 2026-11-25. Sources, all local:

- HCP: `hcp-spec` at `b790561`, `spec/2.0-draft-3/specification.md` (cited "HCP n.n", with file line numbers as `spec:NNNN`), `schemas/2.0-draft-3/discovery.json`.
- The suite: `tt` on `pr1382` (head `e163cac1d`, which contains `pr1380` head `94ed4200c`); `pr1381` read with `git show`. Spec paths are below `tt/specs/hcp/`.
- PR #1380's description, read with `gh pr view 1380 --json body` (a read-only API call; nothing was posted). It is the only place the numbered question list appears.
- VTI #2823: `vti2823/docs/05-design-notes/{hcp.md,hcp-plan.md}`.
- VTI source at `f7b78e29d` (`external/verifiable-trust-infrastructure`, `git log -1` confirmed): `vta-mcp/`, `vti-mcp-common/`, `vta-sdk/`, `vti-common/`, `docs/02-vta/`.
- Our plan: `d3-plan-canvas/docs/plans/agent-connect-plan.md` and `agent-connect-plan/2026-11-25-bam.md`.

"CONFIRMED" means I read it in that file. "UNVERIFIED" means I inferred it.

---

## 1. Layer coverage

### 1.1 HCP's parts (HCP 1.1, spec:15-28; 1.2, spec:30-40)

| Part / layer | HCP sections | What the `hcp/*` family does | Evidence |
|---|---|---|---|
| Core (Part I) | 3-8 | **Carries it.** One task per operation (below). The data model is copied into `_shared/0.1/*.schema.json`. The family adds some presence rules (question 42) and a token binding (questions 22, 53) | `entries/query/0.1/spec.md:94` "A provider that serves this task MUST also meet every requirement HCP 2.0-draft-3 places on the Query operation" |
| HTTP Binding | 9 | **Deliberately not carried.** The family maps from it: path parameters and the `Authorization: Bearer` header move into the payload, `HCP-Version` becomes the Type URI, problem types become `trust-task-error` codes. 9.6 idempotency becomes the framework's duplicate-id rule. 9.9 SET push becomes `hcp/grants/revoked`, a declared departure (question 16) | `entries/query/0.1/spec.md:120` "`Authorization: Bearer` header (HCP 9.3) \| `accessToken` \| Moved from the transport into the payload"; `:94` "serving this task does not make a provider conform to an HCP binding" |
| MCP Binding | 10 | **Effectively silent.** Three passing mentions, and HCP 10.5 is never cited (see 3.2) | `entries/query/0.1/spec.md:80`; `grants/relinquish/0.1/spec.md:68`; `shares/report/0.1/spec.md:106` |
| General Context Profile | 11 | Carried as a content profile URI in the shared entry schema. No spec cites HCP 11 | `_shared/0.1/context-entry.schema.json:85` |
| First-Party Authorization Profile | 12 | Named once. `hcp/grants/request` is offered as the "authenticated channel" of HCP 12.2 (question 21) | `grants/request/0.1/spec.md:79` "a provider claiming the First-Party Authorization Profile may offer this task as its authenticated channel (HCP 12.2)" |
| OAuth Interop Profile | 13 | **Not carried. Mapped in one task only.** `hcp/grants/request` takes its fields from the OAuth request and the RFC 9396 details, and its response from the token response. It issues no refresh token. HCP 13.5 (MCP authorization) is not mentioned | `grants/request/0.1/spec.md:96-111`; `:111` "Version 0.1 issues no refresh token" |
| VC Evidence Profile | 14 | Partly. `entries/create` handles credential content and evidence, and has the `hcp:credentialInvalid` code | `entries/create/0.1/spec.md:65-67` |
| Memory Manager Profile | 15 | **Silent.** No spec cites HCP 15. `entries/create` carries `model-inferred` without saying that a provider accepting it must claim the profile. VTI copes by refusing `model-inferred` | grep found no "HCP 15" in any `spec.md`; `vti2823/.../hcp.md:322-325` |
| Health and Education Context Profiles | 16 | Silent. No spec cites HCP 16 | grep |
| Delegated Authorization Profile | 17 | Carried. `hcp/delegations/{list,end}`; delegates are handled in 18 specs | `delegations/list/0.1/spec.md:92` |
| Conformance claims and packages | 18 | Cited only for the person-facing items (2 specs). The claim rule is restated as "MUST NOT claim this carriage" | `grants/list/0.1/spec.md:240`; `disclosures/summary/0.1/spec.md:286` |
| Discovery document | 19 | **Not carried** (question 36, which appears only in the PR description). **It is still a hard dependency:** every spec requires the provider's VID to be bound to its HCP identity through the discovery document, and `grants/revoked` requires the notice key to be in the HCP JWKS (finding F5) | `entries/query/0.1/spec.md:136`; `grants/revoked/0.1/spec.md:82` |
| Conformance testing, 20.2 test hook | 20 | Silent in the specs (question 48 is in the PR description only) | grep |
| Registries | App. A | Copied into the shared schemas | `_shared/0.1/` |
| Authorization Service (OAuth server role) | 3.2.5, 13 | Not carried. The family treats the provider "acting through its Authorization Service" as one party | `grants/request/0.1/spec.md:14-16` |

### 1.2 Operations (HCP 5.1 table spec:1121-1131; 5.4 table spec:1298-1311; HTTP endpoints spec:2060-2085)

**Context plane (5.2): every operation has a task. CONFIRMED.**

| HCP operation | Task |
|---|---|
| Query 5.2.1 | `hcp/entries/query` |
| Get entry 5.2.2 | `hcp/entries/get` |
| Create 5.2.3 | `hcp/entries/create` |
| Revise 5.2.4 | `hcp/entries/revise` |
| Withdraw 5.2.5 | `hcp/entries/withdraw` |
| Read own grant 5.2.6 | `hcp/grants/read-own` |
| Relinquish own grant 5.2.7 | `hcp/grants/relinquish` (HCP's MCP binding does not carry this one, spec:1273) |
| Report onward sharing 5.2.8 | `hcp/shares/report` |

**Governance plane (5.4): every operation has a task. CONFIRMED.**

| HCP operation | Task |
|---|---|
| List grants | `hcp/grants/list` |
| Revoke grant | `hcp/grants/revoke` |
| Read audit log | `hcp/audit/read` |
| Export | `hcp/export` |
| Import | `hcp/import` |
| Disclosure summary | `hcp/disclosures/summary` |
| Hard delete | `hcp/entries/hard-delete` |
| Confirm or reject | `hcp/entries/confirm` |
| Change categories | `hcp/entries/set-categories` |
| Restrict purposes | `hcp/entries/restrict-purposes` |
| Set or remove a standing rule | `hcp/rules/set`, `hcp/rules/remove`, plus `hcp/rules/list` (from 9.4.14) |
| Set or remove a directive | `hcp/directives/set`, `hcp/directives/remove`, plus `hcp/directives/list` (from 9.4.15) |
| Delegations, 9.4.13 / 17 | `hcp/delegations/list`, `hcp/delegations/end` |
| Revocation notification, 6.2.3 / 9.9 | `hcp/grants/revoked` (provider to client) |

That is 27 carried tasks plus `hcp/grants/request`, which declares no `carries` because HCP Core defines no grant request (`grants/request/0.1/spec.md:65`). The total is 28.

**HCP acts with no task:**

1. **Keeping both entries in a conflict** (the `dismissed` transition, HCP 4.7.3, spec:1054) and **declining a proposal** (HCP 4.7.4, spec:1084, "A proposal the Context Subject declines is removed"). HCP calls both acts of the Context Subject "through a Management Client", but HCP 9.2 gives neither an endpoint either. So this is an HCP gap, and the family follows it. Question 35, "not carried", is in the PR description only. These matter because HCP 18.4 (spec:3497) requires that the person can resolve a conflict.
2. **Establishing a delegation.** HCP 17.2 and 9.4.13 (spec:2345) say the Authorization Service does it, "not through this binding". No task, by design.
3. **Client registration.** HCP requires it in 3.2.8, 6.2.5 and 6.4: the Client Operator, a notification endpoint, legal retention, the directives claim. HCP defines no operation for it. The family has no task. `grants/revoked/0.1/spec.md:120` assumes one ("at registration, the client MUST give the provider the VID…"), and VTI registers the client at the person's first approval (question 52 / N9).
4. **Token refresh.** Not carried (`grants/request/0.1/spec.md:111`).
5. **Issuing a Management Client's credential.** HCP leaves it to the authorization profile. No task issues one (finding F8).
6. **The discovery document** (HCP 19). Not carried (question 36).

---

## 2. Conformance identifiers

**What HCP requires before a `conformsTo` claim:**

- **HCP 1.7 (spec:100-128).** Core, each binding and each profile has its own identifier. A claim is a `conformsTo` list in the discovery document, compared as exact strings. The domain `hcp.example` is a placeholder that "will be fixed before v2 is final", so any claim made now will have to change. Packages are combinations of identifiers. Line 128: "An implementation that accepts HCP Clients operated by anyone other than its own Provider Operator is required to claim Provider Interop."
- **HCP 18.1 (spec:3452-3460).**
  - It must list Core and every binding and profile it claims, and "MUST NOT list an identifier unless it satisfies every requirement of that Part. A binding or profile is claimed whole."
  - Some profiles are mandatory: Memory Manager if it accepts `model-inferred` entries; Health or Education with VC Evidence if it accepts `issuer-attested` entries in those categories; Delegated Authorization if the Authorizing Principal is not the Context Subject.
  - "a claim is made for an HCP Provider, together with the Authorization Service". The one client claim is the directives claim.
- **HCP 18.2 (spec:3466-3475).** Every package needs a binding.
  - First-Party: either binding, "MCP over either transport".
  - Provider Interop: HTTP and OAuth Interop.
  - Agent Interop: Provider Interop plus MCP over Streamable HTTP.
- **HCP 12.2 (spec:2879-2880).** A First-Party claim MUST NOT list OAuth Interop.
- **HCP 19.1 (spec:3535-3540).** Every claimant MUST publish a discovery document. **HCP's `discovery.json` requires `conformsTo` with `minItems: 1` and `bindings` with `minItems: 1`, each binding `http` or `mcp`**, plus `jwks_uri`, `provider_operator` and the other members (CONFIRMED, read with node).
- **HCP 20 (spec:3667, 3685-3687).** The suite is "to be published". First-Party needs the 20.2 test hook, which a deployment holding a real person's context cannot offer.

**What the `hcp/*` specs say.** Every carried spec says: "HCP defines no conformance identifier for Trust Task carriage, so a provider **MUST NOT** claim this carriage in its HCP `conformsTo`, and advertises the task through `trust-task-discovery` instead, *pending HCP confirmation* (question 1)" (`entries/query/0.1/spec.md:94`, `:302`). `grants/request/0.1/spec.md:79` says the same. The framework's SPEC §9.4 item 7 agrees ("Conformance stays with the protocol").

**What VTI #2823 says.**
- The carriage "is not an HCP binding… So the plan builds the **HTTP Binding beside the Trust Task handlers**… and makes the conformance claim on the HTTP side" (`hcp.md:60-64`).
- V0 and V1 are an "HCP-aligned pilot" with **no** identifier in `conformsTo` (`hcp.md:82-86`).
- V2 claims First-Party on one deployment whose operator also runs Keyring and the agent client. V3 adds Provider Interop through an OAuth sidecar, and Agent Interop "from `vta-mcp`" (`hcp.md:617-623`).

All three sources agree on this point (finding F6, ok).

**What must exist before any claim, in addition to the above:**

1. A full HCP binding on the provider: the HTTP Binding including 9.5-9.9 (SET push and JWKS), or the MCP Binding.
2. A discovery document that validates against HCP's schema (see F5: an empty `conformsTo` does not).
3. An authorization profile: First-Party with every client operated by the Provider Operator, or OAuth.
4. General Context, plus any profile the provider's behaviour triggers.
5. The person-facing capabilities of 18.4, including conflict resolution, which no task fully carries (1.2 item 1).
6. The published suite, which does not exist yet (N5 / question 48).
7. Editors' answers to question 1 and to **question 37**. HCP Core itself (5.4, spec:1296) says governance operations "are carried only by the HTTP Binding" (finding F7).

---

## 3. The MCP binding

### 3.1 What HCP's MCP binding requires

**Scope and transports.**
- HCP 10.1 (spec:2491-2498): it carries context operations only and "targets MCP version 2026-07-28 and relies on no session state: every request carries its own authorization".
- **stdio** "qualifies for the First-Party package only. Credentials are obtained from the environment".
- **Streamable HTTP** is "Required for the Agent Interop package". There, MCP authorization is mapped onto the OAuth Interop Profile.

**Identifying the server.** HCP 10.2 (spec:2502-2519): the `server/discover` response carries `capabilities.extensions["example.hcp/hcp"]`, with `discovery` (the discovery document URL) and `conformsTo`.

**Tools.** HCP 10.3 (spec:2525-2539) defines six:
- `hcp_queryContext`, `hcp_getEntry`, `hcp_createEntry`, `hcp_reviseEntry`, `hcp_withdrawEntry`, `hcp_reportSharing`;
- each tool's `inputSchema` and `outputSchema` reference the Core schemas;
- results go in `structuredContent`;
- `tools/list` may vary by grant;
- "A tool call is authorized by the grant presented with it, and the HCP Provider enforces that grant independently of any decision by the MCP host."

**Errors.** HCP 10.4 (spec:2731-2748):
- Core errors are tool execution errors.
- Over Streamable HTTP, a missing or invalid token gets HTTP 401. A denial that follows from the request alone gets 403 with `WWW-Authenticate: insufficient_scope`.
- A denial that depends on what is stored is a `scope-denied` tool error.
- Over stdio, every denial is a tool error.

**Authorization and where tokens travel.**
- HCP 13.5 (spec:2937-2943): the provider is the OAuth resource server and publishes RFC 9728 metadata. "The access token is held by the component that presents it."
- Over Streamable HTTP the token rides in MCP's HTTP authorization. Over stdio it comes from the environment.

**Who holds the grant.** HCP 10.5 (spec:2756-2760):
- "The grant is held by the component that presents credentials: the MCP host or its HCP integration. It is never held by the model."
- "The access token MUST NOT enter the model's context, and MUST NOT be returned as tool content."
- When the client claims to follow directives, the host applies them; "Placing a directive in the model's context is not following it."
- "A local stdio bridge to a remote HCP Provider is an HCP Client in its own right. It holds the token, calls the provider over the HTTP Binding, has its own Client Operator…, and is bound by every rule for HCP Clients, including onward disclosure."

**Governance.** None over MCP (HCP 1.6, spec:89-92).

### 3.2 Do the `hcp/*` specs account for it?

**No.**
- HCP 10.5 is cited by no `spec.md` and no schema. `grep -rn "10\.5" specs/hcp` returns nothing, on `pr1382` and on `pr1381`.
- The family moves the token into the payload (`accessToken`, `entries/query/0.1/spec.md:120`). Its token rules address a client that "MUST NOT log it" (`grants/request/0.1/spec.md:345`), not an MCP host whose model builds the payload.
- `entries/query/0.1/spec.md:80` says a Context Client can use the carriage "as well as over HCP's own HTTP and MCP bindings", and says nothing about an MCP host carrying `hcp/*` tasks itself.
- The demo's client is deterministic code, not a model (`examples/hcp-demo-ts/SCENARIO.md`).

### 3.3 Does VTI #2823 account for it?

**Partly.**
- Decision 13, "MCP is not a shortcut: HCP 10.5 makes a stdio bridge such as `vta-mcp` a client, and MCP over Streamable HTTP maps onto OAuth" (`hcp.md:557`).
- §9.4: "MCP over Streamable HTTP \| Extend the separate `vta-mcp` process; nothing in the VTA. HCP 10.5 already makes a bridge a client of the provider" (`hcp.md:513`).
- V3 H5: "Agent Interop, MCP over Streamable HTTP from `vta-mcp`" (`hcp-plan.md:159`).
- A8 adds "the MCP guard risk class and the `vta-mcp` census" for the `hcp/*` URIs (`hcp-plan.md:106`).

**The tension (finding F14).** Agent Interop is a *provider* claim (HCP 18.1, spec:3460). HCP 10.5, which VTI cites, makes a bridge a *client*. A local `vta-mcp` cannot be both the provider's MCP binding and a client bridge.

### 3.4 What `vta-mcp` is today (CONFIRMED at `f7b78e29d`)

**Transport.**
- stdio, or `--listen` on loopback HTTP only (`vta-mcp/README.md:9`; `vta-mcp/src/main.rs:182-191`).
- `vti-mcp-common/src/listen.rs:141-144` refuses any address that is not loopback, and its CLAUDE.md says "no flag to widen it".
- The listener uses a local bearer token, not OAuth.

**MCP version.** It serves "up to `2025-11-25`, never `2026-07-28`", because its confirmation gate is an elicitation request, which 2026-07-28 forbids (`vti-mcp-common/src/listen.rs:125-139`). HCP's MCP binding targets 2026-07-28 (spec:2491). It has no `server/discover` extension.

**Tools.** It serves `vta_call`, which invokes "ANY VTA Trust Task operation by URI with a JSON payload" (`vta-mcp/src/server.rs:867-908`), plus convenience tools.
- `VtaCallParams` has only `operation` and `payload` (`server.rs:174-182`).
- The result payload goes back to the model unchanged (`CallGuard::finish` → `ok_json(value)`, `server.rs:299-309`).

**Identity.** It runs a dedicated agent identity with an ACL entry (`--agent-did`, an `application` role in a context). `--enroll` registers the bridge as an `ai-agent` device (`README.md:19-31, 87-89`).

**Signing.** Every request is a document signed with the agent key: `signed_task_document`, `build_task_document`, `vta-sdk/src/client/mod.rs:4159-4230`. Replies are verified against the VTA DID (`:2380-2420`).

**Payload checks.** A payload is checked against the schema only if its URI is pinned (`check_payload_conforms`, `mod.rs:1855-1866`, "`None` → Ok").

**No receive loop.** `serve()` never runs `AgentSession::run` (`main.rs:393-417`). `AgentSession::run` (`vta-sdk/src/agent_session.rs:332-379`) hands inbound DIDComm messages to a handler that has no way to reply.

### 3.5 Is our plugin an HCP MCP binding?

**No.** Our plugin configures and runs `vta-mcp` as `K_a` (`agent-connect-plan.md:700`) and "reuses `vta-mcp` for every operation on the VTA" (`agent-connect-plan.md:920`, D40). That makes it an MCP tool server on the client side that tunnels Trust Tasks to the VTA.

In HCP's terms:
- It is an **HCP Client**: a Context Client bridge under HCP 10.5, because it presents the agent's credentials.
- It is **not an MCP Binding**, which an HCP Provider exposes and claims.
- Its generic `vta_call` is not HCP's tool set (10.3) and does not keep the token out of the model's context (10.5).

**What would make it conformant as a client:**

1. The bridge holds the token. It injects `accessToken` itself and strips it from every result. The model never sees it.
2. It exposes typed tools shaped like HCP's six, with Core input and output schemas, rather than raw `vta_call` for `hcp/*`.
3. It drives the `grants/request` hold itself: same `threadId`, same payload, honouring `retryAfter`.
4. It runs a receive loop for `hcp/grants/revoked`: verify, acknowledge, deduplicate on `noticeId` for 25 hours, stop using every copy (`grants/revoked/0.1/spec.md:248-253`).
5. It tracks `useUntil` and drops expired copies.
6. If it claims to follow directives, it applies them in code.
7. It reports onward sharing.
8. It needs a registered Client Operator (question 45 / N2).
9. It needs a ruling on whether sending disclosures to the model API is onward disclosure (question 46 / N3).
10. It needs either an HTTP Binding to call, or the editors' yes to question 44 / N1: HCP 10.5 says the bridge "calls the provider over the HTTP Binding".

**What a provider-side MCP binding (VTI H5) would need:**
- MCP 2026-07-28 statelessness. This conflicts with `vta-mcp`'s elicitation-based confirmation cap.
- A remote Streamable HTTP endpoint. This conflicts with the loopback-only rule.
- An OAuth resource server with RFC 9728 metadata, `server/discover` with `example.hcp/hcp`, and `mcp_endpoint` in the discovery document.
- Provider Interop, because Agent Interop includes it.

### 3.6 Questions 44, 45 and 47

**No spec text exists for them.**
- No `spec.md` or schema on `pr1380`, `pr1381` or `pr1382`, or on the remote branches `feat/hcp-suite`, `feat/hcp-unchecked-rules` or `feat/hcp-demos`, contains questions 44, 45, 46, 47, 48, 49, 50, 51 or 52. The same holds for 35, 36, 41 and 43.
- The specs cite only questions 1-34, 37-40, 42 and 53.
- A grep for `(44)` and `Question 44` over `specs/hcp`, and over every branch with `git grep`, returns nothing.

**The only text is in PR #1380's description**, under "Deployment, not tied to one spec": "a local bridge over a non-HTTP carriage (44); the Client Operator of an agent plugin (45); MCP over Streamable HTTP under First-Party (47); the 20.2 test hook (48)". The same description says "Every spec has a `## Pending HCP confirmation` section that cites these by number". For 13 of the numbers that is not so.

**The full wording appears only in VTI #2823** (`hcp.md:604-607`). The titles match, so I read 44, 45 and 47 as N1, N2 and N4 (UNVERIFIED mapping):
- N1: "May an HCP 10.5 bridge reach the provider over a recognised non-HTTP carriage (TSP or DIDComm Trust Tasks)?"
- N2: "Who is the Client Operator when a person runs a published agent plugin inside a commercial agent host?"
- N4: "May MCP over Streamable HTTP be used under First-Party without OAuth (HCP 10.1 against 12.2)?"

**Do they cover our plugin?**
- **Question 44 / N1** covers the transport leg: `vta-mcp` reaches the VTA over DIDComm or TSP.
- **Question 45 / N2** covers our Client Operator. The plugin is published by us and runs inside Claude Code.
- **Question 47 / N4** concerns provider-side Streamable HTTP. It bears on H5, not on our stdio plugin. HCP is internally ambiguous here: 18.2 (spec:3468) allows First-Party "MCP over either transport", but 10.1 (spec:2498) maps Streamable HTTP onto OAuth Interop, which 12.2 forbids a First-Party implementation to list.

**What the questions do not cover:**
- a bridge whose tool is a generic Trust Task tunnel that the model fills in (token placement under 10.5);
- the MCP protocol version;
- one agent identity holding both an ACL entry (memory) and an HCP grant;
- whether the bridge needs a notification endpoint of its own.

Question 46 / N3 (the model API as onward disclosure) is separate and matters most for a Claude Code plugin.

---

## 4. The agent-memory flow compared with the `hcp/*` flow

### 4.1 Today: an agent using VTA agent memory through `vta-mcp` (VTI at `f7b78e29d`)

1. **Identity.** The agent mints a `did:key` or a `did:webvh` bundle, for example with `vta-agent-memory init`, `pnm`-style ephemeral keys, or the `ai-agent` template (`docs/02-vta/examples/agent-memory-with-vta-mcp.md:84-127`).
2. **ACL entry.** An administrator runs `pnm contexts create`, then `pnm acl create --did <agent> --role application --contexts <ctx> [--capabilities …] --expires 30d` (`:99-103, :129-133`; `personal-ai-agents.md:104-149`). The entry holds role, contexts, capabilities, expiry, device binding and step-up. **It has no purposes** (`vti-common/src/acl/mod.rs:893-960`). `acl/grant` is pinned at 0.2 (`vti-specs-core/trust-tasks.toml:7`), and that bundle names no purpose.
3. **Device.** `vta-mcp --enroll` calls `device/register` with the consumer kind `ai-agent`, so `pnm device disable` and `pnm device wipe` act as kill switches, enforced at authentication (`agent-memory-with-vta-mcp.md:172-174`; `personal-ai-agents.md:179-181`).
4. **Authentication.**
   - DIDComm authcrypt from the agent DID, or the TSP leg when both DID documents advertise TSP.
   - A document proof by the agent key on every task.
   - Every task is checked against the ACL entry and device state (`vta-mcp/src/main.rs:12-35`; `vta-sdk/src/client/mod.rs:4159-4230`).
   - There is no token in the payload. REST token mode uses a VTA JWT in the header.
5. **Calls.**
   - `vta/memory/{put,list,delete}/0.1` and `/0.2`, and `get/0.1`, are the pinned versions (`vti-specs-vta/trust-tasks.toml:48-51`). They are reached through `vta_call` or `vta-agent-memory`.
   - Two gates apply: the capability (`MemoryRead` or `MemoryWrite`) and `require_context(contextId)` (`personal-ai-agents.md:283-292`).
   - **Memory calls carry no purpose at this pin.** `vta-service/src/trust_tasks/memory.rs` has 0 occurrences of "purpose". Our plan cites `vta/memory/*/0.3` with "the purpose a request names" "at the pinned VTA" (`agent-connect-plan.md:811`). That is not the `f7b78e29d` pin.
   - The store is UTF-8 key/value per context, at most 64 KiB per value, versioned in 0.2.
6. **Revoke.** `pnm acl delete <did>` (effective on the next call), or `pnm device disable` / `wipe` (`agent-memory-with-vta-mcp.md:258-263`). The agent is not notified.
7. **Audit.** `memory.put` / `list` / `get` / `delete` in the VTA's chained audit, with the agent DID as actor and an HMAC commitment in place of the key, read by an administrator (`personal-ai-agents.md:329-346`). `vta-mcp` also keeps its own local log, `--audit-log`.

### 4.2 The `hcp/*` flow for the same agent (suite and VTI #2823)

1. The agent mints its own VID with a mailbox on a mediator. It has **no ACL entry** (`hcp.md:113, 206-208`).
2. It shows a QR and a number. It sends `hcp/grants/request`, with a REQUIRED proof by `issuer`, over TSP (`hcp.md:283-296`). The VTA admits it through a zero-authority counterparty hook "only after the ACL has refused the sender" (`hcp.md:216-220`).
3. The VTA holds the request and answers with `trust-task-next-step` (`continuation: resubmit`). The client resubmits with **the same `threadId`, the same `issuer` and the same payload** (`grants/request/0.1/spec.md:173-176`). Meanwhile the VTA sends Keyring a `task-consent/request` carrying the 6.1.6 items. The person approves with a biometric, and Keyring returns `task-consent/decision` (`hcp.md:287-293`).
4. On the next resubmission the response carries `accessToken` and the `grant` object (`grants/request/0.1/spec.md:221-224`). The VTA registers the client at first approval (`hcp.md:307-310`). The grant is temporary, 4 hours by default.
5. The agent queries with `hcp/entries/query`, a required `purpose` (an absolute URI) and `accessToken` in the payload, plus a REQUIRED proof (`entries/query/0.1/spec.md:22-30, 138-147`). It gets back at most 20 disclosures, with `ref`s, `useUntil`, `directives` and a minimisation report. The token must have been issued to the `issuer` VID.
6. Keyring creates entries with `hcp/entries/create` as Management Client, `person-declared` only (`hcp.md:322-325`). Keyring revokes with `hcp/grants/revoke` (`hcp.md:401-405`).
7. The VTA pushes `hcp/grants/revoked` to the client's VID. The client acknowledges, deduplicates on `noticeId`, stops using every copy, and treats any later `hcp:invalidToken` as a notice (`grants/revoked/0.1/spec.md:244-253`).

### 4.3 Side by side

| Aspect | Agent memory through `vta-mcp` (today) | `hcp/*` (suite and VTI design) | Same or different |
|---|---|---|---|
| Identity | Agent DID with an ACL entry, enrolled as an `ai-agent` device | Agent VID with no ACL entry, registered at first approval; `client.id` is the `issuer` VID | Different, and VTI treats them as mutually exclusive (F15) |
| Authentication | DIDComm or TSP sender, document proof, ACL and device check | TSP or DIDComm sender, REQUIRED document proof, token bound to the `issuer` VID; REST refused | Same signing and transport; a different admission path |
| Authorization object | ACL entry: role, contexts, capabilities, expiry | HCP grant: access details (actions, categories, purposes, narrowing, onward sharing), grant type, expiry, client, requesting party | Different |
| Consent | Administrator (Keyring) runs `acl/grant` after pairing | Held `grants/request`, `task-consent` to Keyring, the person's affirmative act with the 6.1.6 items | Different; the task-consent machinery is reused |
| Token | None in the payload | Opaque `accessToken` in every payload, hashed at rest | Different |
| Purposes | None at this pin (memory 0.1/0.2, ACL grant 0.2) | REQUIRED on every query and get; set per grant detail | Different |
| Store | `vta/memory` key/value per context | HCP entries (structured, versioned, with categories), in a separate `hcp_entries` keyspace | Different stores; the companion says "What does not change: … `vta/memory/*`" (`2026-11-25-bam.md:94`) |
| Read shape | List or get, the whole value | Query: at most 20 minimised disclosures with `useUntil` and `directives` | Different |
| Revoke | `acl delete` or device disable; no notice | `grants/revoke` (immediate, never rate-limited), then a pushed `grants/revoked` the client must acknowledge | Different |
| Audit | VTA chained audit `memory.*`, read by an administrator | HCP events in the same chained sink, read by the person through `hcp/audit/read` and `hcp/disclosures/summary` (`hcp.md:343-345`) | Same sink, different vocabulary and reader |
| Error on revoke | Next call refused by the ACL | Family: `hcp:invalidToken` (`entries/query/0.1/spec.md:258`). VTI design: `scope-denied` (`hcp.md:197-199, 416`) | The two disagree (F16) |

### 4.4 Could an agent using `vta-mcp` run `hcp/*` through `vta_call` unchanged?

**Mechanically, partly.**
- `vta_call` sends any URI.
- It signs with the agent key, which satisfies the REQUIRED request proof (question 53).
- It verifies the response's proof against the VTA DID.
- It rides DIDComm or TSP.
- Once the `hcp/*` tasks are pinned in `vti-specs-hcp` it will also check payloads against their schemas. Today an unpinned URI is not checked.

**In practice, no. Something new is needed:**

1. **The token reaches the model.** The model must put `accessToken` into `vta_call`'s payload. The `grants/request` response returns `accessToken` as tool content through `ok_json`. Both break HCP 10.5 (spec:2757).
2. **The hold cannot be driven.** `VtaCallParams` has no `threadId`, and `build_task_document` mints a fresh `id` and sets no `threadId`. Each call is a new thread. Under `grants/request/0.1/spec.md:305`, "A request on a new thread is a new request", so the person would be asked again each time. A next-step reply comes back as a plain payload.
3. **There is no receive loop.** `vta-mcp` never acknowledges `hcp/grants/revoked`, keeps no `noticeId` record and purges no copies. The provider retries and then abandons delivery.
4. **Directives and `useUntil`.** `vta_call` hands directives and context to the model as tool content. A client that claims to follow directives must apply them in code (spec:2759), and the 7.6 use limits need client-side tracking.
5. **Identity.** VTI says a Context Client must not hold an ACL entry (`hcp.md:206-208`). `vta-mcp` in dedicated-agent mode assumes one, and so do `--enroll` and `vta/memory`. Our `K_a` has one (`agent-connect-plan.md:496-510`). Either the plugin uses two identities, or VTI accepts that an ACL-entry holder can also act on a grant.
6. **The guard misclassifies two tasks** (`vti-mcp-common/src/guard.rs:414-430`).
   - `hcp/shares/report` falls under the read verb "report", so it is `ReadOnly` and passes `--read-only`, though the spec declares `sideEffects: mutating`.
   - `hcp/entries/query` falls under "query", so it is `ReadOnly`, though it discloses secret context. The crate's own rule makes such a read `Sensitive`.
   - VTI work package A8 plans to classify them.

**What is needed:** a plugin-side or bridge-side HCP client.
- It holds the token in the keyring, out of the model's reach.
- It runs the hold loop.
- It runs a DIDComm or TSP receive loop for the notice, with acknowledgement and a 25-hour deduplication record.
- It enforces `useUntil` and directives in code.
- It exposes typed `hcp_*`-style tools without tokens.

Our plan's D40 fallback, "the plugin calls the VTA through the TypeScript SDK directly" (`agent-connect-plan.md:920`), is the natural home for it.

---

## 5. Findings (the same list is in the structured output)

- **F1 (ok).** Every context and governance operation in HCP 5.2 and 5.4, the delegations endpoints and the revocation notice has a task.
- **F2 (note).** HCP acts with no task: keeping both entries in a conflict and declining a proposal (no HTTP endpoint in HCP either), delegation establishment, client registration, refresh, Management Client credentials, discovery.
- **F3 (raise).** The MCP binding, and HCP 10.5 in particular, is never cited, though the family moves the token into a payload.
- **F4 (raise).** Questions 44, 45, 47 (and 35, 36, 41, 43, 46, 48-52) are in no spec. Only titles are in the PR description, and the description claims every spec cites them.
- **F5 (blocker).** Every spec makes the client check the provider's VID against the HCP discovery document and JWKS. HCP's discovery schema requires `conformsTo` and `bindings` with at least one item each. VTI V0 publishes no discovery document, and V1 plans one "with no `conformsTo`".
- **F6 (ok).** The rule against claiming the carriage is consistent across HCP, the family and VTI.
- **F7 (raise).** HCP Core 5.4 says governance is "carried only by the HTTP Binding". A Core claim on a deployment that keeps Keyring's governance over Trust Tasks depends on question 37.
- **F8 (blocker).** Every governance task's schema REQUIRES `accessToken`. No task issues a Management Client token. VTI V0 has Keyring send governance tasks with no token, and the demo hard-codes one.
- **F9 (note).** Our plugin with `vta-mcp` is an HCP Client bridge, not an MCP binding.
- **F10 (blocker, for our D40).** `vta_call` puts the token in the model's context.
- **F11 (blocker, for our D40).** `vta_call` cannot resubmit on a held thread.
- **F12 (blocker, for our D40).** `vta-mcp` has no receive loop for the revocation notice.
- **F13 (raise, VTI).** `vta-mcp` caps MCP at 2025-11-25 and binds loopback only. HCP's MCP binding needs 2026-07-28, and a remote endpoint for Agent Interop.
- **F14 (raise, VTI).** H5 puts the provider's Agent Interop binding in `vta-mcp` because "10.5 makes a bridge a client". That is a contradiction.
- **F15 (raise).** The ACL entry (memory) and the HCP grant on one agent identity conflict with VTI §4.3.
- **F16 (raise).** VTI says a revoked grant gets `scope-denied`. The family says `hcp:invalidToken`.
- **F17 (note).** The `vta-mcp` guard classifies `shares/report` and `entries/query` as `ReadOnly`.
- **F18 (note).** At `f7b78e29d`, memory and ACL calls carry no purposes. The plan cites memory 0.3 at a later VTI commit.
- **F19 (raise).** Question 46 / N3, whether a model API is onward disclosure, decides whether a Claude Code plugin can use HCP disclosures at all.
- **F20 (ok).** `vta_call`'s signing, reply verification and transport already fit the family's proof and transport rules.
