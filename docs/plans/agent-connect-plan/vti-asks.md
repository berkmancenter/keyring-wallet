# Agent connect: asks for VTI, OpenVTC and the working groups

A running ledger for [`../agent-connect-plan.md`](../agent-connect-plan.md) (plan §10). One entry per limitation we hit that we would like upstream to extend, so the list can be passed on in one piece. It is a ledger, not a finding record: an entry is promoted into [`../../VTI_UPSTREAM_FINDINGS.md`](../../VTI_UPSTREAM_FINDINGS.md) only when it meets that file's proof rules (the `vti-lab-and-field` skill): measured on the lab and named by era, tried against the pinned upstream clone in `external/` and not disproved, classified as theirs rather than ours, and written in the generic register with no names. A promoted entry gets its `VTI-QN` or `VTI-NN` number noted in its Status. This file does not edit that one.

Fields: **id**; **what we hit**; **evidence** (a path at a named commit, or a measurement); **extension we would want**; **severity** for the plan's tiers (P0, P1, P2; plan §7.0); **status**. Severity: *blocks* (cannot ship the item without it), *works around* (the plan builds around it, with a stated cost), *none*. Status is "not yet raised" unless an entry or the table below says otherwise.

**Registered in the findings file on 2026-11-22** as questions (`VTI-QN`), each read against the pinned clone where its row there says so ([`2026-11-22-al.md`](./2026-11-22-al.md) finding 7):

| Ledger | Findings file |
|---|---|
| AC-04 | VTI-Q26 |
| AC-01, AC-16 | VTI-Q27 |
| AC-02 | VTI-Q28 |
| AC-03 | VTI-Q29 |
| AC-05 | VTI-Q30 |
| AC-06 | VTI-Q31 |
| AC-07 | VTI-Q32 |
| AC-08 | VTI-Q33 |
| AC-21, AC-22 | VTI-Q34 |
| AC-23 | VTI-Q35 |
| AC-24 | VTI-Q37 |
| AC-26 | VTI-Q39 |
| AC-27 | VTI-Q40 |
| AC-28 | VTI-Q41 |
| AC-29 | VTI-Q42 |
| AC-30 | VTI-Q43 |
| AC-31 | VTI-Q44 |
| AC-32 | VTI-Q45 |
| AC-33 | VTI-Q46 |
| AC-25 | VTI-Q38 |
| AC-09, AC-10, AC-11 | VTI-Q36 |

Not registered, with the reason: AC-12 and AC-13 (starter-image decisions, for openvti-starter), AC-14 (a question for the DTG working group, not for VTI), AC-15 (a cross-reference nit), AC-17 (a TypeScript library gap), AC-18 (a note on coexistence), AC-19 (a comparison of two sign-in forms), AC-20 (Anthropic, not VTI).

Evidence is read at VTI `origin/main` `71d524572` (`git show`, never the stale working tree), `external/dtgwg-cred-spec` `94af2d8` and the starter mediator `mediator-buildathon:e6e2c636` (0.48.0, DIDComm v2, built with `tsp,secrets-aws`, measured 2026-11-20 on the lab, not on the VTA Farm).

## VTI: pairing, ACL and rooms

### AC-01 No pairing flow for connecting an agent to a VTA

- **Hit:** the only agent setup is a copy-and-paste: print an `acl create` line, run it where admin is held, then `connect` rotates the key. `vta-mcp` has the static connect ladder only.
- **Evidence:** `vta-sdk/src/agent_connect.rs` (module docs); `docs/02-vta/vta-mcp.md` §4; `docs/02-vta/examples/agent-memory-with-vta-mcp.md` §3.1; `git grep` for "qr", "pairing", "trigger" in `vta-mcp/` and `vta-sdk/src/agent*` finds nothing.
- **Extension:** a VTA-side pairing task (for example `agent/pair`), or the `agent-connect` trigger flow registered in the links specification with its Trust Task type URIs (plan §3.2).
- **Severity:** P0 works around (the plugin carries the pairing code and the message types are Keyring's placeholders); P1 none.

### AC-02 `acl/grant` carries no consumer kind

- **Hit:** an entry is a delegate only once its consumer kind is `ai-agent`, set by the agent's own `device/register`. Between grant and registration the entry could `rooms/keys/act` as the owner.
- **Evidence:** `vta-service/src/trust_tasks/room_act.rs` (`is_delegate`); `vti-specs-core/trust-tasks/acl/grant/0.3.bundle.json` has no kind member.
- **Extension:** the kind as a member of `acl/grant`, or a VTA that refuses `rooms/keys/act` for an `application` entry that has not registered.
- **Severity:** P1 works around (room capabilities are added only after Keyring reads the kind back, plan §3.3); P2 none.

### AC-03 Contexts and capabilities are not bound to each other

- **Hit:** `rooms/keys/present` needs the agent to act in the persona's context, so adding a room adds that context to `act` and widens `memory-read` and `memory-write` to it. It reaches every agent of the owner added to a room of that persona, and any other session holding a memory capability there, so one injected agent can read or poison memory another agent or the owner keeps (plan §3.3, §9 threat 8).
- **Evidence:** `docs/02-vta/data-rooms.md` §7; `vta-service/src/operations/room_oracle.rs` ("Another member's standing"). Whether a resource-qualified `CapabilityGrant` pins a capability to one context is not measured (plan §2.3).
- **Extension:** capabilities bound to one context (resource-qualified grants that the VTA enforces), or room presentation that does not need the persona's context in `act`.
- **Severity:** P1 works around (Keyring shows the effective set and the add sheet says so; per-agent contexts are the recommended mitigation, plan D22); P2 blocks the per-room "may use memory" switch and the portability display.

### AC-04 Rooms have no mention feature

- **Hit:** no `mentions` record member, no delivery filtered by mention. To see a mention the agent needs a read leaf, so it can read the whole room.
- **Evidence:** `docs/02-vta/data-rooms.md`; `rooms/_shared` in `vti-specs-core/trust-tasks`; `git grep` for "mention" finds nothing relevant.
- **Extension:** register `mentions` as a record member a profile can list; deliver to an agent only the records that mention it, or mint a mention-scoped read leaf.
- **Severity:** P1 works around (text `@<handle>` and a behavioural rule); P2 blocks mention enforcement.

### AC-05 A member cannot withdraw an agent's leaf

- **Hit:** a leaf lasts 4 hours and only the room's owner can withdraw it (`rooms/owner/revoke`). `group/remove` does not apply because the agent has no leaf in the group.
- **Evidence:** `docs/02-vta/data-rooms.md` §7 and "Withdraw credentials without removing anyone".
- **Extension:** a member-side withdrawal for a credential the member's VTA issued.
- **Severity:** P1 works around (copy says "up to 4 hours"); P2 blocks closing the tail in rooms the person does not own.

### AC-06 No setting for whether agents may be added to a community's rooms

- **Hit:** no room-level setting, and no policy enforcement based on the VDCs of people in a room. A Keyring-only check is advisory.
- **Evidence:** `docs/02-vta/data-rooms.md`, `docs/03-vtc/`, `vti-specs-core/trust-tasks/rooms`: no matching member.
- **Extension:** an `agents` member (`allowed`, `notAllowed`) in the community's room record and the room profile; later, enforcement for "only with VDCs to people in the room".
- **Severity:** P1 works around (advisory; "not stated" counts as no, plan §3.8); P2 blocks the third setting.

### AC-07 No task signs a VDC as the persona, and no status hosting for it

- **Hit:** `docs/` and `vti-specs*` carry VAC and VMC issuance, no VDC.
- **Evidence:** search of `docs/` and `vti-specs*` at `origin/main`; plan §2.3 item 5.
- **Extension:** a persona-issuing task for a W3C credential (or a Trust Task envelope the VTA signs) and a status-list hosting path for it.
- **Severity:** P0 works around (7-day validity re-issued while the entry is active, no status entry; a revoked agent's VDC can stay valid up to 7 days and nothing shows it in P0 and P1 shows it only in the agent's profile record in rooms; Phase 0 step 0.1(f) measures what exists); P1 blocks presenting the VDC with a revocation guarantee.

### AC-08 Rooms cannot show whose agent a record's author is

- **Hit:** a record carries its author, not the author's chain or VDC, and the community's member list is administrator-only, so another party's agent cannot be told from a person.
- **Evidence:** `bifold/packages/core/src/modules/rooms/capabilities.ts` (`listCommunityMembers`: `adminOnly`, "needs vtc.rooms.manage"); `types.ts` (`byAgent`, set from nothing real at baseline).
- **Extension:** the author's chain, or the agent's VDC, available with a record or as a registered record kind (for example a `memberProfile`).
- **Severity:** P1 works around (own agents only); P2 blocks the cross-client "who does this belong to".

### AC-24 No room-scoped context binding: an entry's memory contexts apply in every room

- **Hit:** a design that let the owner pick, per room, which memory contexts one agent uses (withdrawn in rev 4, plan D31, §3.15). An entry's `act` names contexts "and their subtrees, and only these" and holds wherever the entry acts; `vta/memory/*` is gated on `require_context` and the memory capabilities only. An entry holding "Education" and "Healthcare" reads both from either room; a per-room child context does not help, since a parent's holder reaches every child.
- **Evidence:** `vta-sdk/src/acl.rs` (`ActScope::covers`); `vta-sdk/src/context_path.rs`; `docs/02-vta/personal-ai-agents.md` Step 6; `docs/02-vta/data-rooms.md` §7; read at the pin `f7b78e29d` on 2026-11-23 (plan §2.1, step 0.1(o) measures the hierarchy rule).
- **Extension:** an `act` qualified by room, or a presenter leaf that carries the contexts its holder may use, enforced on `vta/memory/*`.
- **Severity:** **A convenience since rev 4** (2026-11-24, plan D31): the boundary is one ACL entry per distinct memory set, enforced by the VTA today, and the per-room list the plugin kept is withdrawn; this ask would let one agent identity hold different sets per room. Nothing blocks. Registered as VTI-Q37.

### AC-25 Nothing an author writes about itself can carry whose agent it is

- **Hit:** a member who taps an agent in a room should see whose it is and what it is (plan §3.16). The only thing an author may say about itself in a room is its name (`memberProfile`, the name in `title`, "a claim, not a verified one"); the record members a profile may list are a registered set, and none carries a delegation credential. The leaf chain, which records who equipped a presenter, is checked by the host and never shown to members (AC-08).
- **Evidence:** `docs/02-vta/data-rooms.md` "Names" and "Which name is an author's" (`rooms/_shared/0.3` `MemberProfileRecord`); the recordMembers rule the plan already meets for `mentions` (AC-04); read at the pin `f7b78e29d` on 2026-11-23.
- **Extension:** register `delegation` as a `memberProfile` member: the author's VDC grant and its acceptance, so a profile can list it and any reader can verify issuer, subject and acceptance against the record's author.
- **Severity:** P1 works around (own agents show the owner from local records; another party's agent shows its DID and its claimed name with "Keyring can't tell who this belongs to."); layer 2 of plan §3.16 for other parties' agents needs it. Registered as VTI-Q38.

## Mediator (measured on the starter mediator)

### AC-09 Per-sender queue cap, and the refusal's guidance

- **Hit:** an offline recipient accepts 49 messages from one sender and refuses the 50th with HTTP 503 `e.p.limits.queue.peer` (`queued_send_messages_per_peer = 50`). The response observed carried no recovery hint beyond the code.
- **Evidence:** lab measurement 2026-11-20, case S10, `/srv/dev/scratch/2026-11-20-bam-agent-mediator-findings.md`.
- **Extension:** a documented limit, a `Retry-After` on that refusal, and a way for a sender to learn the recipient is offline before queueing.
- **Severity:** P0 works around (Keyring stops at 20 and honours the code); P1 none.

### AC-10 Closed-mediator ACL for a `did:key` client

- **Hit:** with `global_acl_default = DENY_ALL` authentication still succeeds, then the send is refused (HTTP 403 `e.p.authorization.send`) and the recipient's WebSocket upgrade fails (close 1006). A `did:key` client needs its own ACL step on a closed mediator; `vta-sdk/src/acl_setup.rs` does this for the VTA and PNM. The self-service path for an agent was not tested.
- **Evidence:** lab measurement, case ACL; `vta-sdk/src/acl_setup.rs`.
- **Extension:** a documented self-service ACL path for an agent or a phone identity, and an error that says why the socket closed.
- **Severity:** P0 works around (a stated precondition on the mediator; tested on the lab; the Farm is a recorded validation when its operators allow); P1 none.

### AC-11 A `did:peer` mailbox must name the mediator it is registered on

- **Hit:** a forward to a `did:peer` whose service names another host returns HTTP 200 at send, is never delivered (`FORWARD_FAILED` five times, `FORWARD_ABANDONED`) and leaves a problem report only for the sender. The sender saw success.
- **Evidence:** lab measurement, case S8.
- **Extension:** refuse at send, or report the failure to the sender promptly.
- **Severity:** P0 works around (the session prints a code only for a `did:peer` that names its own mediator); P1 none.

### AC-12 No DIDComm v1 and no coordinate-mediation in the starter image

- **Hit:** the image has no `didcomm-v1` feature and serves no coordinate-mediation, so a Credo-style wallet cannot use it. Registration is a signed challenge and the pickup WebSocket.
- **Evidence:** `grep -ac` on the binary (0 for `coordinate-mediation/1.0`, 1 for the v2 forward string); `docker/mediator.Dockerfile` features.
- **Extension:** a pin or feature decision in openvti-starter: whether to build a `didcomm-v1` image.
- **Severity:** P0 none (the agent chat does not use the Credo mediator); P1 none.

### AC-13 `mediator-setup` writes `did://did:peer:2…` and no `local_endpoints`

- **Hit:** the starter's entrypoint patches both by `sed`.
- **Evidence:** same findings file, "Possible upstream gaps".
- **Extension:** `mediator-setup` writing the right values for a `did:peer` mediator.
- **Severity:** P0 none; P1 none.

## Specifications and libraries

### AC-14 Can a VDC carry ownership without attributing acts to the owner?

- **Hit:** the plan uses a VDC as the owner's delegation and responsibility record, not as a room credential. The specification defines a VDC as attributing the delegate's acts to the delegator, defines neither a pure ownership record nor an agent holding both a VDC and a VAC, and says which an agent's grant is "is a governance determination".
- **Evidence:** `external/dtgwg-cred-spec` `94af2d8`, `spec/terms-definitions/verifiable_delegation_credential.md` (attribution); `spec/body.md` "Which one an agent's grant is", privacy item 15 ("Personhood laundering via delegation").
- **Question:** may a VDC carry a responsibility meaning without making a verifier attribute the agent's acts to the owner? Or is the better record the VAC chain itself, used as provenance only ("the chain records only who equipped it"), or another statement type? Is an agent holding both a VDC and a VAC for the same owner defined?
- **Severity:** P0 none (the VDC is never presented with room acts, plan §3.4); P2 relevant (7.20) if the VDC is shown to third parties.
- **Status:** not yet raised. To be raised with the DTG working group as a question; it gates no phase (plan D4).

### AC-15 "Delegate" means two things

- **Hit:** VTI-ACL-070 uses "delegate" for an ACL entry; the credentials specification uses it for the subject of a VDC.
- **Evidence:** `dtgwg-vti-spec/spec/03a-access-control.md` (VTI-ACL-070, chapter 10); `external/dtgwg-cred-spec` `spec/body.md`.
- **Extension:** a cross-reference between the two.
- **Severity:** none.

### AC-16 Trigger-link flow type unregistered, and the QR limit against a `did:peer`

- **Hit:** the `agent-connect` flow type URI is Keyring's proposal. A `did:peer:2` pairing contact does not fit the producer limit of 251 bytes at QR level M (over 170 bytes by itself), so the link carries a `did:key` and Keyring addresses it at its own VTA's mediator, which departs from "the transport comes from the contact's verified DID document" (plan §3.2, D3).
- **Evidence:** `docs/05-design-notes/trigger-link-design.md`; plan §4 and §11 (link length).
- **Extension:** register the flow; a shorter way to reference a pairing contact that carries its transport (or a statement that a `did:key` contact plus a known mediator is acceptable for a flow).
- **Severity:** P0 works around (draft flow behind a developer flag; the link is 198 bytes by count and measured in Phase 0 step 0.1(h)); P1 none.

### AC-17 `@openvtc/pnm-core` has the approver half only

- **Hit:** no trigger-link producer, and only the approver side of `auth/oob/*` in TypeScript; the displayer side is Rust (`vti-oob-server`). Whether the package runs under Node is unverified.
- **Evidence:** `external/vta-browser-plugin` `packages/core/src/vtc/oob-sign-in.ts`, `src/links/trigger-link.ts`.
- **Extension:** a link producer and the displayer half in TypeScript.
- **Severity:** P0 works around (the plugin builds the producer); P1 none.

### AC-18 `vta-agent-memory` and `vta-mcp` cannot tell a session that a message arrived

- **Hit:** `hooks/hooks.json` has only `SessionStart`; `vta-mcp` is stdio with no push.
- **Evidence:** `OpenVTC/vta-agent-memory` `main` at `c9b80d26` (read through `gh api`, no local clone); `vta-mcp/README.md`.
- **Extension:** none needed for P0 (the plugin is the channel server); noted so the two plugins can coexist.
- **Severity:** none.

### AC-19 `vtc-mcp` approves by comparing a number, the browser flow by typing one

- **Hit:** `vtc-mcp` §3.0 has the wallet show a match number and the person approve "only if the two agree". The browser sign-in has the person type the number, with one proof attempt per request. Comparing lets a reflexive approval succeed for a session the person is not looking at.
- **Evidence:** `docs/03-vtc/vtc-mcp.md` §3.0; `vti-oob-server/src/tasks.rs` (`numberMismatch`, "One proof attempt per request").
- **Extension:** the typed form for an assistant's sign-in too. The reverse direction (the wallet shows the number and the person types it into the displayer) is what `vtc-mcp` has; Keyring records it as a P2 option (plan 7.22) for its own pairing (plan D8).
- **Severity:** none for this plan (Keyring's pairing types the number, plan §3.2).

### AC-20 Anthropic: custom channels need the development flag

- **Hit:** a channel not on Anthropic's allowlist loads only with `--dangerously-load-development-channels`, interactively; the Agent SDK and `-p` ignore it. Not for VTI.
- **Evidence:** the channels reference (code.claude.com/docs/en/channels-reference, "Test during the research preview", read 2026-11-20).
- **Extension:** an allowlist path for a plugin not from a partner.
- **Severity:** P0 works around (stated limit, plus the `inbox` tool and Monitor fallback, plan §3.12); the P2 headless daemon (7.19) removes it.

## Added after the independent review (2026-11-20)

### AC-21 An owner's control over `acl/swap-key`, and `acl/revoke` by `deviceId`

- **Hit:** `acl/swap-key` is self-service ("no `require_manage()`") and copies the whole entry, device binding included, to a new DID the caller proves control of. An agent that holds its key can move itself and keep every grant, and an `acl/revoke` of the old DID finds nothing.
- **Evidence:** `vta-service/src/operations/acl.rs` (`swap_acl`, VTI-CLT-029) at `71d524572`; plan §3.9.
- **Extension:** an administrator control to forbid, or require approval or step-up for, a swap of a delegate's entry; and `acl/revoke` addressable by `deviceId`, which a swap does not change.
- **Severity:** P0 works around (Keyring stores the `deviceId`, finds the entry with `device/list`, repeats up to three rounds and shows "Revoke not confirmed" until a full listing is clean); P1 none.

### AC-22 No owner-visible signal of a key swap

- **Hit:** a swap writes an `acl.swap` audit row, but nothing is delivered to the owner's wallet; Keyring learns of it only when it lists at app start or on opening the agent list.
- **Evidence:** `swap_acl` (the `audit!` and `audit::record_best_effort` calls) at `71d524572`; plan §3.9.
- **Extension:** an event or notification an administrator session can subscribe to when an entry's subject changes.
- **Severity:** P0 works around (reconcile on app start sets `keyChanged`); P1 none.

### AC-23 Which task types an entry's `stepUp` gates is undocumented

- **Hit:** an ACL entry has `stepUp` (`approver`, `require`) and `personal-ai-agents.md` Step 5 describes passkey step-up as "the guardrail", but not whether it gates memory writes and room tasks for an `application` entry, or what `require` accepts.
- **Evidence:** `vta-sdk/src/client/acl.rs` (`stepUp`); `docs/02-vta/personal-ai-agents.md` Step 5; unmeasured (plan §2.3 item 12, step 0.1(n)).
- **Extension:** document the gated task types and the `require` values.
- **Severity:** P1 works around (the plugin's hook is the primary control; step-up is used only if measured to gate); P2 none.

## Not for upstream: local items to resolve elsewhere

- **Image digest mismatch in openvti-starter.** The local `mediator-buildathon:e6e2c636` has `RepoDigest` `ghcr.io/bmiller59/mediator-buildathon@sha256:2e916d18…`, while `pins.json` records the index digest `sha256:69ef5649…` (a manifest-against-index difference is the likely reason; `images:verify` was not re-run). To resolve in openvti-starter, not in this plan.
- **The probe is throwaway.** `/srv/dev/scratch/2026-11-20-bam-agent-mediator-probe.ts` runs only under Node with `ws` (Bun's WebSocket is refused with close 1002, "Mismatch client protocol", on the subprotocol). The real probe is built with tests in the pairing rung (plan §7 step 0.1).

### AC-26 A wallet that is not a super-admin cannot create a top-level context or rename one

- **Hit:** Keyring creates a context per memory (plan §3.15, D32). A root context needs unrestricted act authority (VTI-CTX-020) and `vta/contexts/update` is super-admin only.
- **Evidence:** `vta-service/src/operations/contexts.rs:54-146,231-238`; `vti-common/src/acl/mod.rs:405-428`; VTI `4e5861d95`, 2026-11-24.
- **Extension:** roots creatable under a granted reserved prefix; a scoped administrator may rename what it created.
- **Severity:** P0 needs no workaround: Keyring is assumed to be an unrestricted administrator (plan §1.5, D32) and an `auth/whoami` guard stops the connect otherwise; a Keyring-owned parent is a documented, unbuilt fallback. Registered as VTI-Q39.

### AC-27 The context delete preview does not count memory items

- **Hit:** `delete_context` purges memory but `NotEmpty` and the preview omit it, so a memory-only context deletes without `force` and shows no loss.
- **Evidence:** `operations/contexts.rs:578,1009,1487`, 2026-11-24.
- **Extension:** count memory items in the preview and the refusal.
- **Severity:** P1 works around (Keyring counts items and confirms). Registered as VTI-Q40.

### AC-28 No memory quota and no item lifetime

- **Hit:** one item is capped (64 KiB), a context is not; `vta/memory/put/0.3` has no `ttl`; the context policy's `quotas` count operations a day and are applied only to signing and vault presentation (`operations/keys/sign.rs:193`, `trust_tasks/vault.rs:1588`); the operation budget is a rate (100 operations a second per client).
- **Evidence:** `operations/app_state.rs:94`; `put/0.3.bundle.json`, 2026-11-24.
- **Extension:** an optional `max_items` and `max_bytes` in `ContextPolicy`, per-context counters kept in the same write batch as `put` and `delete`, a `quotaExceeded` error, a server-wide default cap, a heavier `put-many` weight, an optional `ttl`.
- **Severity:** P0 works around (client-side count and warning). Registered as VTI-Q41.

### AC-29 Memory values are UTF-8 text of at most 64 KiB

- **Hit:** a file or image cannot be remembered.
- **Evidence:** `operations/app_state.rs:94`; `MemoryValue` in `put/0.3`, 2026-11-24.
- **Extension:** larger values or a reference to a blob store.
- **Severity:** P0 works around (a text note; files are not memory). Registered as VTI-Q42.

### AC-30 No bulk clear of a context's memory; tombstones keep keys

- **Hit:** wiping what an agent remembered is one delete per key and leaves tombstones kept 30 days.
- **Evidence:** `operations/memory.rs:104`; `app_state.rs:120`, 2026-11-24.
- **Extension:** a clear by context or prefix; say what a tombstone keeps.
- **Severity:** P0 and P1 none; P2 works around (client loop, step 7.18). Registered as VTI-Q43.

### AC-31 A client cannot read the VTA's storage protection mode

- **Hit:** memory is encrypted at rest only when the VTA holds a storage key; the standard mode has none (plaintext), hardened derives it from the master seed, a TEE in the enclave. No read-only task returns the mode.
- **Evidence:** `vta-service/src/server.rs:597-602,650`; `main.rs:2544-2558,2622-2640,2672`; `restore.rs:30-35`, 2026-11-24.
- **Extension:** the mode in `auth/whoami` or a status answer.
- **Severity:** P0 works around (the copy makes no claim of encryption). Registered as VTI-Q44.

### AC-32 No private label for a context (deferred)

- **Hit:** the owner's label for a memory is stored in the context's `name`, plaintext to every administrator who reaches the context; `name` is changeable by a super-admin only.
- **Evidence:** `vti-specs-vta/trust-tasks/vta/contexts/create/1.0` and `update/1.0`; `operations/contexts.rs:216-238`, 2026-11-24.
- **Extension:** a label shown only to its owner, or a documented place for a client-sealed label.
- **Severity:** none; P0 works around (label in `name`, accepted; plan D35). Deferred, not requested now. Registered as VTI-Q45.

### AC-33 `vta-mcp.md` calls per-entry capability overrides a deferred gap

- **Hit:** `docs/02-vta/vta-mcp.md` §2.3 says per-entry capability overrides are "still a deferred gap"; `personal-ai-agents.md` and `vta-sdk/src/acl.rs` show them shipped (plan §2.1, §10 item 9).
- **Evidence:** `docs/02-vta/vta-mcp.md` lines 116 to 117 at `4e5861d95`, 2026-11-24.
- **Extension:** correct the sentence.
- **Severity:** none; a documentation correction. Registered as VTI-Q46.
