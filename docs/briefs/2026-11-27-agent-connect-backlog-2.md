# Agent connect backlog 2 for the plan owner's side: chat, reachable screens, the plugin

Written 2026-11-27 by the Keyring lanes that own each area, for work done without the chance to ask questions.
Every open point is decided in its part ("Decided here"), except one named below (section 11 Q7). If a part meets
something it does not cover: stop that piece, leave a comment in the PR saying what you met, and carry on.

Feature branch tip when this was written: `feat/agent-connect` at `75e544a58c21efc1eb486e584f11dd3d842ac7e5`.

## Common rules (every part)

- **Start from the feature tip.** Where a part depends on another, it says "start after PR X merges": wait for that
  merge and start from the tip then. Do not stack on an open PR unless the part says so.
- **Merge, never rebase.** Never force-push a branch once a PR is open on it.
- **Intent record first** when a remote call cannot be undone or re-read: write the local record, then send.
- **No generic failure line** where any case it covers would make it false: use the per-case message.
- **Review feedback arrives only as formal GitHub reviews.** A review that clears a PR starts with
  "CLEARED at <full sha>"; one that does not starts with "NOT CLEARED at <full sha>", and "waits on #N" when a PR
  beneath it is not cleared.
- Squashes carry one sign-off; we write the squash body.
- Nothing here reaches `main`; that needs the plan owner's own confirmation.

## Order

Keyring (PRs into `feat/agent-connect`):

1. Section A **fb-C1**, the chat carrier: start now. It does not announce `chatDid` until Q7 is answered.
2. Section A **fb-C2**, signed envelopes: start now.
3. Section A **fb-W1**, services, root and hooks: start after #1103 and #1113 merge.
4. Section A **fb-C3**, control messages and the acceptance: start after fb-C1 and fb-C2 merge.
5. Section A **fb-C4**, the agent chat hook and Messages rows: start after fb-C3 merges.
6. Section B **R1**, routes: start after fb-W1 merges.
7. Section B **R2**, step 7.8: start after R1 merges.
8. Section B **R4**, the developer switches: start after R1 and fb-C3 merge. The last code part on the screens side.
9. Section B **R3**, the chat views and route: start after R2 and fb-C4 merge.
10. Section B **R5**, the 7.11 emulator walk: SKIPPABLE, last; nothing depends on it. If skipped, we run it.

Plugin (PRs into `integration/agent-connect` on github.com/albertoleon7794/vta-agent-memory):

11 to 16. Section C **P1 to P6**: CANNOT START until your side has a checkout of that repository and push access
to the fork. Skip this section until then.

## Open for the plan owner (section 11 Q7)

How the agent learns Keyring's chat identity (`chatDid`) and mediator: A, the VTA writes them into redeem's
`ext`; or B, Keyring's first chat message, signed by `ownerPersonaDid`, names them. fb-C1 builds the carrier
either way and does not announce `chatDid` until it is answered. Full text in Section A.

---

# Section A: Keyring core logic (fb-W1, fb-C1 to fb-C4)

# Backlog 2, Keyring core logic: the wiring and 7.9's Keyring side (fb)

Written 2026-11-27 by the Keyring core lane. Read against `feat/agent-connect` at
`75e544a58c21efc1eb486e584f11dd3d842ac7e5`, the control-message vectors
`connected-agents/vectors/control-messages.json` (#1074, version 1, status "agreed by relay 2026-11-26"), and the
plan's §3.5, §7.9 and §11 Q7.

Alberto decided, in his own words, both pieces: the wiring "behind the switch" (the release gate keeps the flag off in
every release), and the Keyring side of 7.9 to Brendan's side. The seam with the UI/UX lane (eb) is agreed: eb writes
every view, route, navigator entry, the Messages.tsx edit, the developer row and all of 7.8; these parts write only
logic, hooks and the root that mounts them.

## Files these parts write

| Part | Creates | Writes (existing) |
|---|---|---|
| fb-W1 | `connected-agents/ConnectedAgentsRoot.tsx`, `connected-agents/hcp/hooks.ts`, and a test for each | `connected-agents/services.ts`, `connected-agents/ConnectedAgentsProvider.tsx`, `__tests__/services.test.ts`, `__tests__/ConnectedAgentsProvider.test.tsx`, `connected-agents/hcp/reconcile.ts` (its header only) |
| fb-C1 | `connected-agents/chat/carrier.ts`, `connected-agents/chat/chatIdentity.ts`, and their tests | none |
| fb-C2 | `connected-agents/chat/envelope.ts`, `connected-agents/chat/seenIds.ts`, and their tests | none |
| fb-C3 | `connected-agents/chat/control.ts` and its test | none |
| fb-C4 | `connected-agents/chat/useAgentChat.ts`, `connected-agents/chat/messageRows.ts`, and their tests | none |

All paths are under `packages/core/src/modules/`. No part writes `screens/`, `components/`, `navigators/`,
`Messages.tsx`, a locale file or a testID.

## Bases: start from the tip, and wait where a dependency is real

Each part is one **draft** PR into `feat/agent-connect`. Branch from the feature tip **when you start**. Where a part
needs another's code, it says "start after X merges"; it does not stack on X's branch. Take the tip into your branch
by **merge, never rebase**, and never rebase a branch someone else builds on.

| Part | Start | Why |
|---|---|---|
| fb-W1 | after #1103 (fb-5) merges | it edits the services and provider #1103 changes |
| fb-C1 | now | new files only |
| fb-C2 | now | new files only; test against #1074's vectors |
| fb-C3 | after fb-C1 and fb-C2 merge | it sends and receives through both |
| fb-C4 | after fb-C3 merges | the hook reads the carrier, the envelope and the control state |

## Rules for every part

- **Contracts first.** Each part's exported names and shapes below are fixed. The UI/UX lane builds to them.
- **No generic failure line where a case contradicts it.** Every result is a code. A case with its own words in §6
  (closed mediator, refusals, the version line) gets its own code, never "something went wrong".
- **Intent record before an irreversible call.** Where a part sends something that can't be taken back (the revoked
  message, the grant), it writes what it is about to do first, so a crash between the send and the record can be
  reconciled.
- **Do not touch:** every existing file not in your row above, including all of `trust-tasks/**` (`VtaClient.ts`,
  `VtiMediatorTransport.ts`, `documentProof`), `revoke.ts`, `store.ts`, `vdc.ts`, `actions.ts`, `entryRead.ts`, the
  `hcp/` files other than W1's two, `__tests__/releaseGate.test.ts`, both testid files, `docs/**`. Import from them.
- **Checks:** the whole module's jest (`cd packages/core && TZ=GMT yarn jest src/modules/connected-agents`),
  `node scripts/tsc-ratchet.mjs` at "156 diagnostic(s) now; baseline 156", CI's prettier form and eslint on changed
  files, both testid files unchanged. `releaseGate.test.ts` passes unchanged. A test file per new file with a
  `// control:` case, and one source change per file that made a named test fail recorded in the PR.
- **Reviews come as formal GitHub reviews.** One `Signed-off-by:` per commit, yours, last.
- **Nothing reaches main.**

---

## fb-W1: services, root and hooks for the reachable screens

Start after #1103 merges.

- **`ConnectedAgentsRoot: React.FC<{ children: React.ReactNode }>`** (new file):
  - builds `connectedAgentsServices(agent, vtaDid, vtaAgent, personas)` from the app's Credo agent, the VTA this phone
    administers, `vtaAgent` (trust-tasks) and the persona source;
  - mounts `ConnectedAgentsProvider`, and with `isHcpEnabled()` also the HCP ports (`hcpVtaPort`, `HcpConnectionStore`);
  - renders `children` only when `isAgentConnectEnabled()`, else `null`.
  - **Decided here:** with no administered VTA it renders `null` too, never an error screen.
- **Hooks, in `ConnectedAgentsProvider.tsx`:**
  - `useRevokeDeps(): RevokeDeps`, for the routed container's own `revokeAgentConnection(deps, id)` call. Its `store`
    is the connection store and its `vta` is services' `revokeVta`. `tellAgent` stays absent until fb-C3 gives one.
  - `useKeepConnectedOffered(agentId: string): boolean`, from `services.keepConnectedOffered`. It is false while
    loading. "Keep it connected" is offered only through this.
- **HCP hooks** (`hcp/hooks.ts`, new): `useHcpConnections()`, `useHcpApproveFlow()` (scan, match, approve, over
  `hcp/approveFlow` and the `vtaAgent` approvals) and `useHcpActions()` (revoke, new memory). Names fixed; shapes are
  the existing functions' results.
- **The reconcile:** `reconcileHcpApprovals` (`hcp/reconcile.ts`) runs in `services.reconcile`, after `reconcileAgents`,
  as its own `step`.
  - **`hcp/reconcile.ts` header, one sentence added:** "approved but not recorded" relies on this reconcile running
    at app start, so no approve flow may become reachable without it.
  - **The rule:** this lands **with or before** any reachable HCP approve flow. So the UI/UX lane's routing part
    starts after fb-W1.
- **The release gate is unchanged:** none of this calls `revokeAgentConnection` from a routed file. The routed call is
  the UI/UX lane's `AgentDetailsScreen`, with a relative import.
- Tests: the root renders nothing with the flag off, and children with it on; a missing VTA renders `null`; the
  reconcile order now has the HCP step after `reconcileAgents`; `useKeepConnectedOffered` false while loading.
  Control: with the flag on and HCP off, no HCP port is built.

## fb-C1: the chat carrier (§3.5)

Start now.

- **`chatIdentity.ts`:**
  - `ensureChatIdentity(store, record, kms): Promise<{ chatDid; chatConnectionId }>` makes Keyring's pairwise `K_c`, a
    fresh `did:key`, once per agent;
  - `chatConnectionId` is `agent-chat:<record id>`;
  - both are written with `store.update(id, r => ({ ...r, chatDid, chatConnectionId }))`, set only if absent and
    never changed after.
- **`carrier.ts`:**
  - `AgentChatCarrier.send(record, plaintext)` posts from `chatDid` an authcrypt inner message to `agentDid` (`K_a`),
    in an **authcrypt** `routing/2.0/forward` with `next = K_a`, to **the owner's own mediator** (P0, §3.5), through
    `VtiMediatorSession` (`sendTo`, `forward`). An anoncrypt outer forward is never sent.
  - It self-grants with `account/update` before the first send; a refused self-grant is `closedMediator`.
  - `onMessage(handler)` delivers inbound messages for `chatDid`.
- **Results:** `sent`, `closedMediator` (403 `e.p.authorization.send` / `send_forwarded`, or the self-grant refused),
  `paced` (503 `e.p.limits.queue.peer`, honouring `Retry-After`, never retried at once), `unreachable`.
- **Decided here:** the chat module's events for an agent are stored under `chatConnectionId`, so `modules/chat/`'s
  storage and `mergeByTime` run unchanged; the carrier replaces only the Credo send.
- **Open, for the plan owner (§11 Q7):** how `chatDid` and Keyring's mediator reach the agent. The plugin takes chat
  only from the `chatDid` it was given. This part builds the identity and the carrier, and **does not announce
  `chatDid`**. That lands with the answer. The options are sent with this brief.
- Tests: the forward is authcrypt and `next` is `K_a`; the self-grant precedes the first send, once; 403 and the
  refused self-grant are `closedMediator`; 503 waits `Retry-After`; the identity is made once and never moved.
  Control: an existing `chatDid` is kept.

## fb-C2: signed chat and control envelopes

Start now.

- **`envelope.ts`:** `signEnvelope(agent, doc, chatDid)` and `verifyEnvelope(agent, doc, expect)`, with
  `signDocumentProof` and `verifyDocumentProof` (trust-tasks `documentProof`): a `DataIntegrityProof`,
  `eddsa-jcs-2022`, `proofPurpose: 'assertionMethod'`, by the issuer's key.
- **Every envelope:** `type`, `id` (`urn:uuid:`), `issuer`, `recipient`, `issuedAt`, `payload` with `version`.
  - A resend keeps its `id`.
  - **Version rule (§7.9):** accept Keyring's own major. Accept a higher minor, ignoring members it doesn't know, while
    the members it needs are present. Another major is `versionMismatch`; it is never acted on.
- **The replay rule, exactly the vectors' `rules`:**
  - refuse `issuedAt` more than **300 s ahead** of, or **604 800 s (7 days) behind**, the receiver's now;
  - refuse an `id` already seen within that window, **recording it before acting**;
  - refuse a `recipient` other than the receiver's own chat identity;
  - for `keyring/agent/settings` and `keyring/agent/room-offer`, refuse one not newer than the last applied of its
    type.
- **`seenIds.ts`:** the seen ids as keyed records (`trust-tasks/module/keyedRecords`), dropped once past the 7-day
  window.
- **Results:** `ok`, or `stale`, `future`, `repeated`, `recipient`, `proof`, `olderState`, `versionMismatch`: the
  vectors' refusal names, plus the version.
- Tests: every `valid` vector verifies, and every `refuse` vector is refused for its stated reason. The ids are
  recorded before the handler runs. Control: the same document a second time is `repeated`.

## fb-C3: the control messages and the acceptance

Start after fb-C1 and fb-C2 merge.

**`control.ts`: the six types of the vectors, each in and out through fb-C2:**

| Type | Direction | What Keyring does |
|---|---|---|
| `keyring/agent/settings/1.0` | Keyring to the agent | sends on change (`answersOthers`), newest wins |
| `keyring/agent/room-offer/1.0` | Keyring to the agent | sends the room offer (P1 rooms; build the send, no caller yet) |
| `keyring/agent/revoked/1.0` | Keyring to the agent | the `tellAgent` for `revokeAgentConnection`'s deps; intent record first |
| `keyring/agent/vdc-grant/1.0` | Keyring to the agent | sends the stored `vdcGrant` after connect and after each re-issue; intent record first |
| `keyring/agent/vdc-acceptance/1.0` | the agent to Keyring | verify with `verifyVdcPair({ grant, acceptance, ownerPersonaDid, agentDid, entryExpiresAt, verify })`; on `ok`, store `vdcAcceptance` with `store.update` |
| `keyring/agent/heartbeat/1.0` | the agent to Keyring | records `lastHeartbeatAt` |

- **The acceptance handler is what the release gate's 7.9 condition reads.** That's a file that handles
  `keyring/agent/vdc-acceptance/1.0` and calls `verifyVdcPair(`. So this part satisfies it, and the UI/UX lane's
  developer row starts after it.
- **Decided here:** a refused acceptance (`VdcPairCheck` not `ok`) is recorded as its reason and leaves the record
  as it was.
- **Liveness:** "Not connected right now" when neither a heartbeat nor a reply has come for **20 minutes** (the
  plugin beats every 10). `connectionState(record, now)` returns `connected` or `notConnected`.
- Tests: each type round-trips through C2; a forged acceptance is refused; the grant re-sent after a re-issue keeps
  its new `id`; the heartbeat moves the state; `revoked` writes its intent before sending.
  Control: an acceptance for another agent's grant is refused.

## fb-C4: the agent chat hook and the Messages rows

Start after fb-C3 merges.

- **`useAgentChat(agentId)`** returns `{ messages, send(text), state, unanswered, stopped }`.
  - `state` is `'connected' | 'waiting' | 'notConnected' | 'versionMismatch'`.
  - It stops sending after **20 messages with no reply** (`stopped: true`, "Waiting for your session" is the view's).
  - A `paced` result waits and resumes.
  - Text, replies and reactions as `chat/1.0`; no photos or files in P0.
- **`useAgentMessageRows()`** returns `{ agentId; name; lastText?; lastAt?: string }[]`, with `lastAt` an ISO
  instant. It is empty when the flag is off. The row kind is `'agent'` for `messagesListItems`; the UI/UX lane merges
  it into `mergeByTime` in `Messages.tsx`.
- Tests: the 20 stop and its reset on a reply; `versionMismatch` from C2; rows empty with the flag off.
  Control: one reply clears `unanswered`.

## Open for the plan owner, before fb-C1 can announce `chatDid` (§11 Q7)

How `chatDid` and Keyring's mediator reach the agent, and from whom it may trust them:

- **A. The VTA writes them into `redeem`'s `ext` from the grant** (the plan's first candidate).
  - Pros: the agent learns them on the channel it already trusts for pairing.
  - Cons: a VTA change, and an upstream ask.
- **B. Keyring's first message to `K_a`, a control document signed by `ownerPersonaDid`, names `chatDid` and the
  mediator.**
  - Pros: no VTA change.
  - Cons: the plugin must already hold `ownerPersonaDid` from a trusted source (redeem today carries the owner's VID,
    so check that first). The first message comes from a key the plugin has not seen.
- **Recommended: B if redeem's owner VID is the persona; A otherwise.** This is a plugin and VTA decision, so it is
  the plan owner's.


---

# Section B: views, routes, 7.8 and the developer switches (R1 to R5)

# Agent connect backlog 2: the UI/UX lane's parts (reachable behind the developer switch)

Written 2026-11-27 by the UI/UX lane (eb), owner of how agent connect is drawn. For work done without the chance to
ask questions: every open point is decided here ("Decided here"). If you meet something this brief doesn't cover,
stop that piece, say what you met in the PR, and carry on with the rest. Your PRs come to eb for the frame check
and to the review lane (ac) for review.

**What changed since backlog 1.** Alberto decided, in his own answers, that the wiring which makes agent connect
reachable may be built, **behind the developer switch**: the release gate (`connected-agents/__tests__/releaseGate.test.ts`)
keeps the flag off in every release until Revoke is routed and the chat's VDC acceptance is handled, and only a
developer build with the switch on reaches the screens. The Keyring side of step 7.9, the chat, comes too.

Sources:
- the plan `docs/plans/agent-connect-plan.md`: §6, §7.7 to §7.11, §8.6;
- the canvas `docs/plans/agent-connect-plan/canvas/`: frames 12, 13, 16, 19, 20, 25 to 30, and 50 to 58;
- the merged views in `connected-agents/screens/` and `components/`, and the HCP views (#1109, #1110);
- the seam agreed with fb on 2026-11-27, below;
- Keyring at `feat/agent-connect` `80aa3c563` or later.

## The seam with fb (agreed 2026-11-27)

fb writes the logic, and eb's parts (below) write the views and the routes. Names are fb's, confirmed
2026-11-27; if fb's brief (`backlog2-parts/fb.md`) names something differently, **fb's brief wins**.

- **On the tip now** (`connected-agents/ConnectedAgentsProvider.tsx`): `useAgentConnections`,
  `useAgentConnection(id)`, `useAgentContacts`, `useAgentPairing`, `useMemories`, `useConnectGuard`,
  `useMemoryCounts(agentId, contextIds)`, `usePersonas`, `useAgentActions` (widen, narrow, restore, retryPending,
  extend, remove).
- **fb #1103** (fb-5): `AgentActionsPort.keepConnected(id)`, `useDeleteMemory()` (preview, remove(memoryId, true)).
- **fb-W1** ("services, root and hooks for the reachable screens"):
  - `useKeepConnectedOffered(agentId)` and `useRevokeDeps()`;
  - the HCP hooks `useHcpConnections()`, `useHcpApproveFlow()` and `useHcpActions()`;
  - `ConnectedAgentsRoot: React.FC<{ children }>`, from `connected-agents/ConnectedAgentsRoot.tsx`: it builds the
    services, mounts `ConnectedAgentsProvider` (and the HCP ports when `isHcpEnabled()`), and renders its children
    only when `isAgentConnectEnabled()`, else `null`.
- **fb's 7.9 parts:** fb-C1 "the chat carrier", fb-C2 "signed chat and control envelopes", fb-C3 "control messages
  and the acceptance", fb-C4 "the agent chat hook and Messages rows":
  - `useAgentChat(agentId)` → `{ messages, send(text), state: 'connected' | 'waiting' | 'notConnected' |
    'versionMismatch', unanswered, stopped }`, where `stopped` means it stopped at 20 with no reply;
  - fb-C4: `useAgentMessageRows()` → `{ agentId, name, lastText?, lastAt? }[]` (ISO `lastAt`; empty with the flag off),
    with `kind: 'agent'` in `messagesListItems.ts`;
  - fb-C3 handles `keyring/agent/vdc-acceptance/1.0` with `verifyVdcPair` (gate condition b).
- **The revoke call:** in `AgentDetailsScreen` itself, literally `revokeAgentConnection(deps, id)`, imported by a
  **relative** path from `../../modules/connected-agents/revoke`, with `deps` from `useRevokeDeps()`. A wrapper hook
  inside the module wouldn't count for the gate.

## Files each part writes (no two parts write the same file; fb's parts write none of these)

| Part | Creates | Edits |
|---|---|---|
| 0 (eb, PR #1113, lands first) | none | the locale files: `ConnectedAgents.ChatWaiting`; `app/src/localization/*/index.ts`: `Developer.EnableAgentConnect`, `Developer.EnableHcp` |
| R1 routes | `packages/core/src/screens/agents/AiAgentsScreen.tsx`, `AgentDetailsScreen.tsx`, `ConnectAgentScreen.tsx`, `HcpConnectScreen.tsx`, `AgentMemoriesScreen.tsx`, `__tests__/agentRoutes.test.tsx` (same folder) | `packages/core/src/types/navigators.ts` (Screens and MyAgentStackParams), `navigators/MyAgentStack.tsx`, `modules/vrc/screens/ListContacts.tsx`, `connected-agents/__tests__/components.test.tsx` (**only** the reachability test's expected list, below) |
| R2 7.8 | `packages/core/src/navigators/VtaStack.tsx`, `navigators/__tests__/myVta.test.tsx` | `navigators/TabStack.tsx`, `navigators/SettingStack.tsx`, `navigators/MyAgentStack.tsx` (after R1), `screens/Settings.tsx`, `types/navigators.ts` (SettingStackParams, `Screens.MyVta`), `modules/trust-tasks/module/vtiLinks.ts` (`myAgentLinkParams`), `modules/rooms/roomLinks.ts` (`openInMyAgent`), `components.test.tsx` (the expected list, again) |
| R3 chat | `connected-agents/screens/AgentChatView.tsx`, `connected-agents/__tests__/agentChat.test.tsx`, `packages/core/src/screens/agents/AgentChatScreen.tsx`, `__tests__/fixtures/screenStatesChat.tsx`, `e2e/lib/agent-connect-screens.chat.json` | `screens/Messages.tsx`, `navigators/MessageStack.tsx`, `navigators/MyAgentStack.tsx` (after R2), `types/navigators.ts` (`Screens.AgentChat`), `components.test.tsx` (the expected list) |
| R4 developer switches (last code part) | `app/src/screens/__tests__/developerAgentConnect.test.tsx` | `app/src/screens/Developer.tsx`, `app/src/store.tsx`, `app/container-imp.ts` |
| R5 the 7.11 walk (SKIPPABLE, last) | `e2e/run-agent-connect-walk.js`, `e2e/lib/agentConnectWalk.mjs`, `e2e/lib/agentConnectWalk.test.mjs` | `e2e/package.json` (one script) |

R1, R2 and R3 edit some of the same files (`navigators/MyAgentStack.tsx`, `types/navigators.ts`, the expected list).
They are therefore **stacked in that order**: each starts from the previous one's branch, as its PR's base. The
generated testID files are the one exception allowed: regenerate them (`cd packages/core && yarn testids`, then
`bash e2e/scripts/sync-testids.sh`), never hand-merge them.

## Do not touch

- Every file under `connected-agents/` except the two R3 creates and `components.test.tsx`'s expected list; in
  particular every view in `screens/` and `components/`, `ConnectedAgentsProvider.tsx`, `services.ts`,
  `revoke.ts`, `agentConnectFlag.ts`, `hcp/**`, `chat/**` (fb's), `proposedCopy.ts` and the catalogue
  (`screenCatalogue.test.tsx`, `fixtures/screenStates*.tsx` other than your own, `wordSource.ts`).
- `releaseGate.test.ts`. It must pass **unchanged** in every part; R4 is the part that makes `flagReachable` true,
  and the gate must then report nothing missing.
- `screens/Chat.tsx` and `modules/chat/**`. The agent chat is a separate screen; the DIDComm chat is unchanged.
- The locale files. Part 0 adds every word these parts need. A screen title uses an existing `ConnectedAgents.*`
  key (below), never a new `Screens.*` key.
- `packages/core/tsc-baseline.txt`, `docs/**`, `scripts/**`, `.github/**`, any `package.json` but R5's one script
  line, any lock file.

## Rules every part follows

- **Start from the feature tip** when you start. Where a part depends on another PR, it says "start after X merges";
  don't start it sooner. **Merge, never rebase.** When the tip moves under a PR, take it with a signed merge, and
  show the PR's own diff unchanged (`git patch-id --stable`, each side against the base that side had).
- **Contracts first.** Read the hooks' and views' types before writing a container, and don't reshape a view to fit
  one. If a view's props don't fit what a hook gives, stop and say so.
- **Behind the switch.** With `isAgentConnectEnabled()` false, the app behaves byte for byte as on the tip:
  - no agent route is registered;
  - the My Agent tab opens where it does today;
  - no Settings row is added;
  - no Contacts or Messages agent row appears.
  Each part has a test with the flag off proving it (a control).
- **No generic failure line where any case it covers contradicts it.** Map each failure case to its own true words;
  where a case has none, stop and say so. (Backlog 1 broke this twice; it's now a rule.)
- **Both testID files** regenerated (above). `node scripts/gen-testids.mjs --check` and
  `node e2e/scripts/check-testids.mjs` pass.
- **Reviews:** formal GitHub reviews only, from the review lane; no one approves their own PR. One `Signed-off-by:`
  per squash body, as its last line; no agent trailers.
- **Checks:**
  1. `cd packages/core && TZ=GMT yarn jest src/modules/connected-agents src/screens/agents src/navigators`. Read
     `Tests: N failed` and the `●` blocks, never `✕`.
  2. The type ratchet: `node scripts/tsc-ratchet.mjs --package packages/core --project tsconfig.ratchet.json`, at 156,
     not growing.
  3. prettier in CI's form, and eslint.
  4. R4 only: `cd app && yarn typecheck` and the app's jest for your test.
  5. **Controls:** each new test file has a `// control:` case, and the PR records one source change per test file
     that made a named test fail.

## The reachability test's expected list (`components.test.tsx`)

Today it expects exactly `container-impl.ts -> components/AgentContactCard` and
`modules/trust-tasks/module/triggerLink.ts -> agentConnectFlag`. Each part adds **exactly** the entries its own
files' imports produce, sorted, in the same PR. The test's pattern collects every `from`, `require()` and `import()`
of a `connected-agents/` path. Anything else that reaches into the module is a defect, not an entry to add.

- **R1 adds:**
  - `navigators/MyAgentStack.tsx -> agentConnectFlag`
  - `navigators/MyAgentStack.tsx -> ConnectedAgentsRoot`
  - `modules/vrc/screens/ListContacts.tsx -> ConnectedAgentsProvider`
  - `modules/vrc/screens/ListContacts.tsx -> agentConnectFlag`
  - `screens/agents/AiAgentsScreen.tsx -> ConnectedAgentsProvider`
  - `screens/agents/AiAgentsScreen.tsx -> screens/AgentListView`
  - `screens/agents/AiAgentsScreen.tsx -> hcp/screens/HcpAgentListView`
  - `screens/agents/AiAgentsScreen.tsx -> <the HCP hooks' file>`
  - `screens/agents/AiAgentsScreen.tsx -> hcp/hcpFlag`
  - `screens/agents/AgentDetailsScreen.tsx -> ConnectedAgentsProvider`
  - `screens/agents/AgentDetailsScreen.tsx -> screens/AgentDetailsView`
  - `screens/agents/AgentDetailsScreen.tsx -> screens/ChangeMemoriesView`
  - `screens/agents/AgentDetailsScreen.tsx -> screens/RevokeAgentSheet`
  - `screens/agents/AgentDetailsScreen.tsx -> revoke`
  - `screens/agents/AgentDetailsScreen.tsx -> <useRevokeDeps' file>`
  - `screens/agents/ConnectAgentScreen.tsx -> ConnectedAgentsProvider`, and one entry each for
    `screens/ConnectAgentForm`, `screens/ConnectScanView`, `screens/ConnectNumberView`, `screens/ApproveView`,
    `screens/ConnectedView` and `screens/ConnectFailureView`
  - `screens/agents/HcpConnectScreen.tsx -> hcp/screens/HcpConnectFlowView`
  - `screens/agents/HcpConnectScreen.tsx -> <the HCP hooks' file>`
  - `screens/agents/AgentMemoriesScreen.tsx -> ConnectedAgentsProvider`
  - `screens/agents/AgentMemoriesScreen.tsx -> screens/MemoriesListView`
  - `screens/agents/AgentMemoriesScreen.tsx -> screens/DeleteMemorySheet`
  - `screens/agents/AgentMemoriesScreen.tsx -> <useDeleteMemory's file>`

  `<…'s file>` is the module path fb's PR gives each one. Write the real path; if a hook you need lives in a file not
  named here, it's still one entry, recorded in the PR.
- **R2 adds:**
  - `navigators/TabStack.tsx -> agentConnectFlag`
  - `navigators/SettingStack.tsx -> agentConnectFlag`
  - `screens/Settings.tsx -> agentConnectFlag`
  - `modules/trust-tasks/module/vtiLinks.ts -> agentConnectFlag`
  - `modules/rooms/roomLinks.ts -> agentConnectFlag`
- **R3 adds:**
  - `screens/agents/AgentChatScreen.tsx -> screens/AgentChatView`
  - `screens/agents/AgentChatScreen.tsx -> <useAgentChat's file>`
  - `screens/Messages.tsx -> <useAgentMessageRows' file>`
  - `screens/Messages.tsx -> agentConnectFlag`
  - `navigators/MessageStack.tsx -> agentConnectFlag`
- **R4 adds** nothing to this list: it's `app/src`, outside the test's walk. The release gate sees it.

---

## Part R1: routes for the agent screens, the provider, and the Contacts row

**Start after** fb-W1 merges (ConnectedAgentsRoot, useRevokeDeps, useKeepConnectedOffered, the HCP hooks). If
#1103 (useDeleteMemory) and U4's `DeleteMemorySheet` and `MemoriesListView` haven't merged, leave
`AgentMemoriesScreen` out of this part and say so.

**`types/navigators.ts`.**
- `Screens` gains `AiAgents = 'AI agents'`, `AgentDetails = 'Agent details'`, `ConnectAgent = 'Connect an agent'`,
  `HcpConnect = 'Connect an agent (HCP)'` and `AgentMemories = 'Your memories'`.
- `MyAgentStackParams` gains `[Screens.AiAgents]: undefined`, `[Screens.AgentDetails]: { agentId: string; name:
  string }`, `[Screens.ConnectAgent]: { againFrom?: string } | undefined` (Connect again, from an expired agent's
  id), `[Screens.HcpConnect]: { link: string }` and `[Screens.AgentMemories]: { agentId?: string } | undefined`.

**`navigators/MyAgentStack.tsx`.**
- Register the five screens **only when `isAgentConnectEnabled()`** is true, read once when the stack mounts (the
  switch applies on the next launch; see R4).
- Wrap them in `ConnectedAgentsRoot`.
- Titles use existing keys:
  - AiAgents: `t('ConnectedAgents.AiAgents')`;
  - ConnectAgent and HcpConnect: `t('ConnectedAgents.ConnectAnAgent')`;
  - AgentMemories: `t('ConnectedAgents.MemoriesTitle')`;
  - AgentDetails: the agent's name from `route.params.name`, an options function (#1060 finding 9, agreed).
- R1 doesn't change the stack's first screen; R2 does.

**The containers** (`packages/core/src/screens/agents/`). Each is thin: it reads hooks and passes props, no logic
of its own. Times are formatted with the app's time format, and `formatTime`/`formatDate` are passed down.
- `AiAgentsScreen`: `AgentListView` from `useAgentConnections()` and `useAgentActions()`.
  - The callbacks: Open → AgentDetails; Connect → ConnectAgent; Extend → ConnectAgent's Approve again, through the
    pairing for an extend (fb's); Remove → `actions.remove`; Connect again → ConnectAgent with
    `{ againFrom: id }`.
  - `onRevoke` opens the RevokeAgentSheet on that agent (as AgentDetails does).
  - **Decided here:** when `isHcpEnabled()`, this screen draws `HcpAgentListView` over `useHcpConnections()`
    instead, and Connect opens the scanner, whose HCP link goes to HcpConnect. The HCP lane is the demo's mode, and
    one screen never shows both lists or two Connect buttons.
- `AgentDetailsScreen`: `AgentDetailsView` from `useAgentConnection(agentId)`, `useMemoryCounts`,
  `useAgentActions()`, `useKeepConnectedOffered()`, and `ChangeMemoriesView` as an inline sheet.
  - **The revoke:** `onRevoke` opens `RevokeAgentSheet`, whose `onRevoke` is
    `() => revokeAgentConnection(deps, agentId)` with `deps = useRevokeDeps()`, imported as in "The seam".
  - `RevokeOutcome` passes through to the view as it is (`RevokeViewOutcome` fits it).
  - `onMessage` is passed only after R3. `onKeepConnected` is passed only when `useKeepConnectedOffered(agentId)`.
  - The details stay mounted while the sheet is open.
- `ConnectAgentScreen`: drives `useAgentPairing()` and `useConnectGuard()`, and draws by the pairing's `phase`.

  | phase | view |
  |---|---|
  | `idle` (and before start) | `ConnectAgentForm`, guard from `useConnectGuard()`, `personas` from `usePersonas()` |
  | `awaitingScan` | `ConnectScanView` with the app's camera (the scanner component the Scan screen uses) |
  | `awaitingNumber` | `ConnectNumberView` |
  | `awaitingApproval` | `ApproveView`; `confirm` is the app's biometric confirmation (`requestBiometricConfirmationUI(...)`, `status === 'confirmed'`); the `requester` and `sameNetwork` lines come from `disclosure` |
  | `awaitingEnrolment` | `ConnectingView` |
  | `confirmed` | `ConnectedView` (`onSeeDetails` → AgentDetails; `onOpenChat` after R3) |
  | `failed`, `expired`, `locked` | `ConnectFailureView` with the end the pairing reports (`failureCopy.ts`'s `ConnectEnd`; `locked` with `minutesLeft`) |
  | `cancelled`, `notFinished` | back to AiAgents |

  - **Decided here:** `ConnectFailureView` already gives every `PairingFailure` its own key, so this needs no
    generic line. A pairing state the table doesn't name is a stop-and-say, never a generic failure.
- `HcpConnectScreen`: `HcpConnectFlowView` over `useHcpApproveFlow()`, started with `route.params.link`. The same
  biometric `confirm` as above.
- `AgentMemoriesScreen`: `MemoriesListView` over `useMemories()` and counts; Delete opens `DeleteMemorySheet` with
  `useDeleteMemory().preview(id)`. Its `onConfirm` is `() => useDeleteMemory().remove(id, true)`, called only from
  the sheet's Delete. It's reached from AgentDetails' memories group and, after R2, from "My VTA"; R1 only registers
  it.

**`modules/vrc/screens/ListContacts.tsx`** (§3.14, frame 25).
- With the flag on, merge `useAgentContacts()` among the people, sorted by name with them.
- Each draws through `TOKENS.COMPONENT_AGENT_CONTACT_CARD` and opens AgentDetails (`navigate(Stacks.TabStack, {
  screen: TabStacks.MyAgentStack, params: { screen: Screens.AgentDetails, params: { agentId, name }, initial: false
  } })`).
- People rows are byte for byte as today (a test compares a render with no agents against the tip's).

**Tests** (`screens/agents/__tests__/agentRoutes.test.tsx`), with the hooks mocked:
- with the flag off, none of the five screens is registered and Contacts shows no agent row (the control);
- with it on, each container draws its view;
- AgentDetails' Revoke calls `revokeAgentConnection` with the deps and id, and shows each outcome;
- ConnectAgent draws each phase's view;
- with HCP on, AiAgents draws the HCP list;
- `releaseGate.test.ts` passes unchanged, and its `missing` still lists only the acceptance (gate condition b) when
  you flip the flag in a scratch run. Don't commit that run.

## Part R2: step 7.8, My Agent opens on the AI agents, and "My VTA" under Settings (frames 12 and 20)

**Start after** R1 merges. Stacked on R1.

**Decided here** (plan §6 "Where the screens sit", §7.8; frame 20). All of it applies only with the flag on; with
it off, every line below is a no-op and the app is as on the tip.
- `navigators/VtaStack.tsx`: a stack holding **today's VTA screens, unchanged**.
  - These are every screen MyAgentStack registers today except the five agent screens: MyAgent, VtiCommunity,
    Poll, … RoomOffer. Same names, same options, same order.
  - Move them by extracting MyAgentStack's existing `<Stack.Screen>` list into a function both stacks call. Don't
    copy it.
- **Flag on:**
  - MyAgentStack registers the agent screens, plus the room screens it registers today (§6: the rooms screens are
    registered in both, so a room opened there still shows there).
  - Its first screen is `Screens.AiAgents`.
  - SettingStack registers `Screens.MyVta` (`'My VTA'`; title `t('ConnectedAgents.MyVta')`) with `VtaStack` as
    its component.
- **Flag off:** MyAgentStack is exactly today's, with `agentHomeScreen(link)` first. No MyVta.
- `screens/Settings.tsx`: with the flag on, one row "My VTA" (`t('ConnectedAgents.MyVta')`, testID `MyVtaRow`),
  first in the "App Settings" section, opens `Screens.MyVta` (frame 20).
- **Links.** `myAgentLinkParams` (vtiLinks.ts) and `openInMyAgent` (roomLinks.ts) take the moved stack with the
  flag on: `navigate(Stacks.SettingStack, { screen: Screens.MyVta, params: { screen, params, initial: false } })`
  (and TabStack's deep-link routing, L241-245, the same). With it off they're unchanged.
- **The "AI agents" card on MyAgent** (if the tip has one by then) is removed with the flag on (§7.8).

**Tests** (`navigators/__tests__/myVta.test.tsx`):
- flag on: the tab's first screen is AiAgents; Settings shows "My VTA" and it opens the VTA home; every link that
  opened a VTA screen before (link flow, devices, a room's community, a member card, the profile, deep links
  through `myAgentLinkParams`) opens the same screen in the moved stack;
- flag off: everything as on the tip (the control). The existing navigator tests pass unchanged with the flag off.
- "No screen in the moved stack calls the VTA 'your agent' without its header saying 'My VTA'" (§7.8): a check
  over the moved stack's titles with the flag on.

## Part R3: step 7.9's chat, as views and a route (frames 26 to 29)

**Start after** R2 merges and fb-C4 merges. Stacked on R2.

**`connected-agents/screens/AgentChatView.tsx`.** Props: `{ name, ownerName, messages: { id, mine: boolean, text,
at: string }[], state: 'connected' | 'waiting' | 'notConnected' | 'versionMismatch', stopped: boolean, onSend:
(text) => void, formatTime }`.
- **Header**, drawn by the view at the top: the robot, the name with `AgentTag` ("AI agent"), and
  `ConnectedAgents.BelongsTo {owner}` (frame 27).
- **Bubbles**, plain like a person's chat (canvas note: only the header differs, §6). Mine on the right, the
  agent's on the left, with times.
- **States** (frame 28):
  - `notConnected`: the line `ConnectedAgents.StatusUnreachable` ("Not connected right now") under the header.
  - `stopped`: the line `ConnectedAgents.ChatWaiting` ("Waiting for your session") above the composer, and the
    composer disabled.
  - `versionMismatch`: `ConnectedAgents.VersionMismatch` in place of the composer.
  - `waiting` (sent, no reply yet): no line. The messages show.
- **The composer:** a text field with placeholder `t('Chat.MessagePlaceholder')`, and send.
- **No generic failure:** a send the hook can't make shows its state's own line, as above. There is no "wasn't sent"
  toast here: the hook's `stopped`/`notConnected` say why.
- testIDs: `AgentChat`, `AgentChatHeader`, `AgentChatBubble`, `AgentChatState`, `AgentChatInput`, `AgentChatSend`.

**`screens/agents/AgentChatScreen.tsx`:** `AgentChatView` over `useAgentChat(agentId)`; its header is the view's,
so the navigator's is `headerShown: false` with a back button in the view.
- **`types/navigators.ts`:** `Screens.AgentChat = 'Agent chat'`, `[Screens.AgentChat]: { agentId: string; name:
  string }` in MessageStackParams and MyAgentStackParams.
- **Navigators:** registered in MessageStack and MyAgentStack, flag on only.
- **Back in R1's containers:** AgentDetails' `onMessage` and ConnectedView's `onOpenChat` now navigate here. They're
  R1's files, but this part may add those two callbacks, and only those.

**`screens/Messages.tsx`** (frames 26 and 29).
- With the flag on, merge `useAgentMessageRows()` by time with people and rooms (`mergeByTime`).
- Draw `kind: 'agent'` through `TOKENS.COMPONENT_AGENT_CONTACT_CARD` with `subtitle` = the last message, opening
  AgentChat.
- They show under "All" and "People" and not under a community chip (frame 29's note; §7.9).

**Catalogue:** `screenStatesChat.tsx` plus `agent-connect-screens.chat.json`.
- States `agent-chat` (frame 27), `agent-chat-waiting` (frame 28, `stopped` and `notConnected`) and
  `agent-chat-version-mismatch` (noFrame).
- Frame 27's "mentioned you in" line is P1 (rooms): frameOnly.

**Tests** (`agentChat.test.tsx`):
- each state's line and the composer state; send calls `onSend`, and a disabled send doesn't;
- the header words;
- Messages with the flag off shows no agent row (control), and with it on orders by time;
- a person's row renders as before.

## Part R4: the developer switches (LAST code part)

**Start after** R1 (Revoke routed: gate condition a) **and** fb-C3 (VDC acceptance: gate condition b) merge.
Before that the gate fails the build the moment a setter is called. That's by design.

**`app/src/store.tsx`:**
- `developer` gains `enableAgentConnect: boolean` and `enableHcp: boolean`, both **defaulting to `false`**.
- Actions `TOGGLE_AGENT_CONNECT` and `TOGGLE_HCP`, beside `TOGGLE_SHARED_CONNECT`, the same shape.

**`app/src/screens/Developer.tsx`:**
- Two `SectionRow`s with a `Switch`, beside "Connect from a shared code", the same pattern:
  - `Developer.EnableAgentConnect`, testID `ToggleEnableAgentConnect`;
  - `Developer.EnableHcp`, testID `ToggleEnableHcp`, disabled while the first is off.
- Each dispatches its action and calls `setAgentConnectEnabled(next)` / `setHcpEnabled(next)`.

**`app/container-imp.ts`:** the start-up apply, beside `setSharedConnectEnabled(...)`:
`setAgentConnectEnabled(state.developer.enableAgentConnect)` and `setHcpEnabled(state.developer.enableHcp)`.

**Decided here:**
- The switches apply in full on the **next launch**: R1 and R2 read the flag when the stacks mount.
- The Developer screen is reached only in developer mode (the 10-tap gesture).
- `agentConnectFlag.ts` keeps `let agentConnectEnabled = false` (the gate's default check).

**The gate:** with this part, `flagReachable` becomes true, and `releaseGate.test.ts` must pass **unchanged**, i.e.
report nothing missing. If it reports something missing, a dependency hasn't merged; stop.

**Tests** (`app/src/screens/__tests__/developerAgentConnect.test.tsx`):
- the rows toggle the store and call the setters;
- the HCP row is off and disabled while agent connect is off (control);
- the store's defaults are `false`.

## Part R5: the 7.11 walk (SKIPPABLE: nothing depends on it; if skipped, eb's side runs it)

**Start after** R4 merges. It needs an Android emulator (or the iOS simulator) and a developer build with the switch
on; without them, skip this part and say so.

**What it does:** `e2e/run-agent-connect-walk.js` (pattern: `e2e/run-my-agent.js`) reads **every**
`e2e/lib/agent-connect-screens*.json`.
- For each state whose marker can be reached in a running app, it reaches it, waits for the marker
  (`waitForTestId`), takes `screenshot(driver, "<state-id>")`, and writes a line to a run file: state id, frame,
  screenshot path, platform, app commit.
- It walks in the manifests' order. Steps are `press` (`tapTestId`) and `pressLabel` (the element whose
  accessibility label matches, within the named testID).
- A state it can't reach without a device, the lab or a peer (an HCP consent request, a pairing expiry) is listed
  as "not reached" with the reason, never skipped silently.

**`e2e/lib/agentConnectWalk.mjs`:** the pure parts, reading the manifests (base file first by name, as the catalogue
does), building the run plan and writing the pairs file. `agentConnectWalk.test.mjs` tests them with `node --test`
(in `test:lib`'s pattern), with a control.

**Not 7.11's evidence by itself:** 7.11 needs every screenshot paired with its frame, and every difference given a
disposition, in a dated companion. That companion is eb's, from this walk's output.

## Done means

- One draft PR per part (R1, R2 and R3 stacked), green on the checks above and in CI.
- With the flag off, the app is unchanged; with it on (R4), the screens are reachable in a developer build.
- The release gate passes unchanged in every part.
- Each PR description lists:
  - the "Decided here" points it implements;
  - the reachability entries it added;
  - the checks and their output;
  - one mutation per test file;
  - anything this brief didn't cover.


---

# Section C: the plugin, on the fork (P1 to P6)

# Backlog 2: agent connect plugin parts (c5, 2026-11-27)

This file holds no keyring-wallet parts: c5's wallet work for agent connect has merged (#1066, #1074). The parts below are for the plugin.

## Plugin parts (`vta-agent-memory` fork)

These six parts are separate from the keyring-wallet parts. **They cannot start until Brendan's side has a checkout of the fork and push access to it.** Making him a collaborator on the fork is Alberto's call, and it has not been done. Meanwhile c5 keeps building the plugin on the fork. Any part c5 finishes before that access exists drops out of this section, and this file says so when it happens.

c5 is building, and none of these parts touches:
- PR-4: enrol as `aiAgent`, the memory probe per context, and the configuration for `K_a`;
- PR-6: the one mediator session for `K_a`, the self-grant, sending and refusals;
- PR-11: the fake-Keyring end-to-end harness.

### Where the work goes

- **Repository:** `github.com/albertoleon7794/vta-agent-memory`, a public fork of `OpenVTC/vta-agent-memory`.
- **Integration branch:** `integration/agent-connect`, head **`4057a5a`**. That head stacks:
  - `agent-connect/pr1-core-skeleton` at `661877d`;
  - `agent-connect/pr2-keys` at `21fcd42`;
  - `agent-connect/pr3-pairing-link` at `ef788fc`;
  - `agent-connect/pr3b-pair` at `4057a5a`.
- **Each part:**
  - one branch, `agent-connect/<part>`, cut from the current head of `integration/agent-connect`;
  - one pull request **into `integration/agent-connect` on the fork**, never into `main` and never into `OpenVTC/vta-agent-memory`;
  - nothing goes upstream: no pull request, issue or comment there. Each of those is Alberto's word.
- **Review and merge:** the review lane (ac) reviews every pull request, as on keyring-wallet. It merges by squash on ac's clearance at the head sha with every check green, after predicting the merged tree with `git merge-tree --write-tree` and verifying it once merged.

### What every part builds on

The contract and decisions are in the keyring-wallet repository, branch `feat/agent-connect`, at head **`8284835b3`**:

- **The plugin contract:** `docs/plans/agent-connect-plan/2026-11-26-al-5.md` (companion al-5, review row 16).
  - Finding 4 (lines 64-96) is the signed envelope and the replay rule.
  - Finding 5 (lines 98-116) is the control messages' types and bodies.
  - Finding 6 (lines 117-132) is one process owning the mediator session.
  - All are agreed by relay on 2026-11-26. Brendan's own confirmation is needed before anything reaches `main`.
- **The plan:** `docs/plans/agent-connect-plan.md`, §3.2 (versions, the self-grant), §3.4 (the VDC), §3.12 (the plugin's layout), §7.6 (step 7.6's acceptance) and §8.1 (the plugin's own suite).
- **The shared vectors:** `packages/core/src/modules/connected-agents/vectors/control-messages.json` (from #1074). It holds 8 valid documents (chat both ways, `settings`, `room-offer`, `revoked`, `vdc-grant`, `vdc-acceptance`, `heartbeat`) and 6 the receiver refuses.
  - The generator is `scripts/agent-connect/control_message_vectors.py`, independent of both sides. It uses pinned seeds, and its times are pinned to 2026-11-20: never move them towards the present.
  - The fork carries a byte-identical copy at `tests/fixtures/agent-connect/control-messages.json`. Its README records where it came from, and `tests/connect_vectors_verify_upstream.rs` already runs `vta-sdk`'s own Trust Task proof verifier over it.
  - Refresh the copy only by copying the wallet file whole, and update the README's commit when you do.
- **The signed envelope, in short** (finding 4; Keyring's side builds the same):
  - members `{ type, id, issuer, recipient, issuedAt, payload { version, … }, proof }`;
  - `id` is a `urn:uuid` v4, and a resend is the same signed document with the same id;
  - `issuedAt` is written with no `.000Z`;
  - `proof` is a DataIntegrityProof, `eddsa-jcs-2022`, `assertionMethod`;
  - the receiver refuses:
    - a wrong `recipient`;
    - an `issuedAt` more than 5 minutes ahead of its clock, or more than 7 days behind;
    - an id it has seen.
  - **Seen ids** are kept in an owner-only file beside the inbox cursor, for 7 days and 5 minutes. Each id is written **before** the document is acted on. If the store is missing or unreadable, anything issued before the store's own creation time is refused (it fails closed).
  - **State-setting messages** (`settings`, later `room-offer`) are applied only when newer than the last one of their type applied.
- **The upstream verifier skew:** `vta-sdk`'s verifier (affinidi-data-integrity 0.8.7 and 0.9.2) refuses a proof `created` more than 60 s ahead of the verifier's own clock. Sign with real time; never pin test times in the future.

### The common rules

- **Merge, never rebase.** Take the integration head into your branch with a signed merge (`git merge -S`). Never force-push or rewrite a pushed branch.
- **Write an intent record before an irreversible call.** Before any call that cannot be taken back (an ACL change, a key swap, a send that sets state on the other side), first write a durable record of what is about to happen, owner-only, so a restart can tell "did not happen" from "happened, answer lost".
- **No generic failure line where a case contradicts it.** A refusal Keyring or the VTA words specifically is said in its own words. A catch-all line ("couldn't reach …") is only for a failure that really is unknown. If a test shows the catch-all printed for a case it misdescribes, that is a bug.
- **Formal reviews only.** A review is ac's written line on a named head sha, never a reading of chat or a thumbs-up. Content and checks are separate halves, and both must hold on the same sha.
- **One sign-off per squash.**
  - Every commit ends with exactly one `Signed-off-by:` naming its own author (`git commit -s`), as the last line.
  - The squash body has exactly one, as its last line.
  - No `Co-Authored-By` for an agent and no "Generated with" line, in commits or pull request bodies.
- **The plugin's own rules** (`CLAUDE.md` at the fork's root) hold in full. In particular:
  - nothing is transport-aware;
  - no `VtaClient` call goes in a retry loop (retrying authentication until a grant arrives is not an operation retry, as `pair` documents);
  - `serve` must never fail to start;
  - always shut a client down;
  - the role is `application`, never `admin`;
  - no private key is written to the config.
- **Write only your part's files.** A part needing a change to another part's file, or to a file in the do-not-touch list, stops and says so in its pull request. It does not make the change.

### The checks

Every part runs these from the fork's root, with all of them clean:

```sh
cargo fmt --all -- --check
cargo clippy --all-features --all-targets -- -D warnings
cargo test --all-features
cargo test --test eval
cargo test --all-features --test connect_core_is_vendor_neutral   # the vendor-neutral guard
```

The guard fails if anything under `src/connect/` imports a vendor library: the core implements `HostContract` (`src/connect/host.rs`) and knows no host. Claude Code specifics belong only in the front-end parts (P5, P6), outside `src/connect/`.

Every new behaviour gets a test with a control that fails when the behaviour is removed, and the pull request says how the control was checked.

### Do-not-touch, for every part

- **c5's parts and owners:**
  - `src/connect/host.rs`, `src/connect/keys.rs`, `src/connect/pairing.rs` and `src/connect/pair.rs`;
  - `src/enrol.rs` and `src/setup.rs`, which PR-4 owns;
  - the mediator session code, which PR-6 owns (`src/connect/mediator.rs` when it exists).
- **`tests/fixtures/agent-connect/`:** copies of keyring-wallet files. Refresh only as described above.
- **Upstream VAM, which no part needs to change:**
  - `src/store.rs`, `src/record.rs`, `src/authorship.rs`, `src/provenance.rs`, `src/lifecycle.rs`, `src/bundle.rs`, `src/rooms.rs`;
  - `tests/eval/`.
- **`Cargo.toml`:** add only the dependencies your part needs, each with a one-line comment saying why; change nothing else in it.
- **`.claude-plugin/plugin.json`:** its `version` is bumped once, by the integration owner, when the integration branch is proposed.
- **`.github/workflows/`.**

### P1: the signed envelope and the seen-id store

- **Files:** `src/connect/envelope.rs`, `src/connect/seen.rs`, `tests/connect_envelope.rs`, and the two `pub mod` lines in `src/connect/mod.rs`.
- **Interface:**
  - `envelope::verify(raw: &[u8], me: &Receiver, now: DateTime<Utc>, seen: &mut SeenIds) -> Result<Accepted, Refusal>`, where `Receiver { own_did, expected_issuer }`.
  - `Accepted { id, kind, issuer, issued_at, payload }`.
  - `Refusal` is one enum variant per rule (wrong recipient, too far ahead, too old, seen, bad proof, wrong issuer, unknown major), so the caller can log the case.
  - `envelope::sign(payload, kind, recipient, signer) -> Value`, for the plugin's own documents (`vdc-acceptance`, `heartbeat`, chat replies). Sign with `vta_sdk::trust_task_sign`, the primitive `src/authorship.rs` already uses.
  - Verify with `vta_sdk::trust_task_proof::verify_trust_task_proof_value` and `TrustTaskVmResolver::did_key_only()` (feature `proof-verify`).
- **Seen ids:** an owner-only file via `write_owner_only` (`src/config.rs`), holding the store's creation time and each accepted id with its `issuedAt`.
  - Entries past 7 days and 5 minutes are pruned.
  - An id is written before `verify` returns `Accepted`.
  - A missing or unreadable store refuses anything issued before the new store's creation time.
- **Tests:**
  - every valid document in the vector file is accepted;
  - every refusal case in it is refused for its stated reason;
  - a document accepted once is refused the second time, including across a reload of the store from disk;
  - a store deleted between deliveries refuses an old document and accepts a new one;
  - **controls:** each case is accepted when its one rule is disabled in a test-only build.
- **Owner:** Brendan's side. No dependency on another part.

### P2: the inbox, covering the gate, the fence, caps, the durable cursor and `settings`

- **Files:** `src/connect/inbox.rs`, `src/connect/settings.rs` and `tests/connect_inbox.rs`. In `src/fence.rs`, only a new `Provenance::Chat` variant and its preamble.
- **Interface:** `Inbox::accept(raw, &Receiver, now) -> Result<Option<Event>, Refusal>`.
  - It calls P1's `verify` (until P1 lands, write against a stub with the same signature).
  - The issuer must be `chatDid`. Anything else is dropped before it reaches the model.
  - It applies a per-kind allowlist (`keyring/chat/1.0` and the six control types) and a size cap.
  - It wraps chat text in the fence.
  - It appends one line to the inbox file **before** advancing the cursor.
- **The inbox file format,** shared with P5 and P6, owner-only, beside the config:
  - `connect-inbox.jsonl` holds one JSON object per line: `{ seq, receivedAt, id, kind, issuer, text?, payload? }`. `seq` is monotonic from 1, and `text` is already fenced.
  - `connect-inbox.cursor` holds `{ seq }`, the last line the session has been handed.
- **`settings`** (`keyring/agent/settings/1.0`, finding 5):
  - The body is `{ version, answersOthers, locale, handle }`, kept in `connect-settings.json`.
  - With no file, `answersOthers` is off.
  - The same major is accepted and extra members are ignored. Another major is ignored and logged, and the last good one is kept.
  - It is applied only when its `issuedAt` is newer than the last applied (the order rule).
- **Tests:**
  - a non-owner document is dropped and never written;
  - a forged fence delimiter in chat text cannot escape the wrapping (VAM's existing fence property tests are the model);
  - a restart resumes from the cursor;
  - an unknown-major `settings` keeps the last one;
  - an older `settings` after a newer one changes nothing;
  - each with a control.
- **Owner:** Brendan's side. It depends on P1's signature only.

### P3: the VDC grant check and the acceptance

- **Files:** `src/connect/vdc.rs` and `tests/connect_vdc.rs`.
- **The check:** accept a `keyring/agent/vdc-grant/1.0` only through P2 (issuer `chatDid`). Then:
  - check `issuer == ownerPersonaDid` and `credentialSubject.id == K_a`;
  - check Keyring's shape rules: context order, the three types, `issuerScope` `directed`, a `validUntil`, a non-empty `scope`, no `accepts`;
  - the rules are in keyring-wallet `packages/core/src/modules/connected-agents/vdc.ts` at `8284835b3`; read them there, and do not copy them from this file.
- **The acceptance:** built as `vdc.ts` builds it:
  - `accepts` is the grant's JCS form without `proof`, SHA-256, multihash, base58btc;
  - no `scope`, and the same `validUntil`;
  - signed by `K_a` (`eddsa-jcs-2022`, `assertionMethod`) and sent as a `keyring/agent/vdc-acceptance/1.0` in P1's envelope to `chatDid` only.
- **Not decided:** the route by which the grant reaches `K_a` (plan §11 Q7(b)). This part builds the handler, not the route, and says so.
- **Tests:**
  - the vector file's `vdc-grant` passes the checks;
  - each shape rule broken alone is refused;
  - the acceptance the part builds for that grant verifies under P1, and its `accepts` equals the vector's digest;
  - each with a control.
- **Owner:** Brendan's side. It depends on P1 and P2's signatures.

### P4: the `deviceEnrol` starter, against draft #1386, behind one seam

- **Files:** `src/connect/oob.rs`, `tests/connect_oob.rs`, and `tests/fixtures/auth-oob-draft-1386/` (new: the starter's schemas).
- **What it does:**
  - **Request:** `auth/oob/request` 0.3 with purpose `deviceEnrol`, `consumerKind` `aiAgent`, `requester` and `requestedScope`, sent **only** to the pinned VTA (`pair::pinned_vta`).
  - **Redeem:** `redeem` 0.3 is polled, and the match number is printed when the request is claimed.
  - **The result:** an `Enrolment { vtaDid, aclEntry, mustSwapBy }` naming any VTA but the pinned one is refused with "The pairing named a different VTA. Nothing was changed.", and nothing is enrolled.
  - **The deadline:** the swap must run before `mustSwapBy`, and the part checks it did.
- **Transport:** the starter is unauthenticated (`K_t` is not on the ACL yet), so this is a plain HTTPS Trust Task POST to the VTA's `auth/oob` endpoint, not a `VtaClient` call. Put it behind one trait (`OobStarter`) so the draft can move without touching callers.
- **Schemas:** keyring-wallet's fixtures (`packages/core/src/modules/connected-agents/__tests__/fixtures/auth-oob-draft-1386/`, `DRAFT_COMMIT.sha` = `ceda53bca`) hold only the approver's tasks. Add `request` 0.3 and `redeem` 0.3 from `trustoverip/dtgwg-trust-tasks-tf` #1386 **at that same commit**, byte-identical, with a README naming it.
- **Tests:**
  - against a fake `auth/oob` service held to those schemas: the request goes only to the pinned VTA, and a foreign `vtaDid` in the redeem answer is refused with nothing written;
  - a missed `mustSwapBy` is said in its own words;
  - each with a control.
  - The pull request says the part is proven against a fake only.
- **Owner:** Brendan's side. No dependency on another part.

### P5: the channel front-end, over MCP stdio

- **Files:** `src/channel.rs`, a front-end **outside** `src/connect/` so the guard holds, and `tests/channel_handshake.rs`.
  - In `src/server.rs`, only the capability declaration and the two tool registrations.
  - Where the tools live (the existing server or a second one) is plan §11 Q6(c). Build in the existing server and record the question in the pull request.
- **What it adds:**
  - **The capability:** `capabilities.experimental["claude/channel"]`, and **no** `claude/channel/permission`.
  - **Events:** `notifications/claude/channel` for each new line of P2's inbox file, with `meta` holding identifiers only.
  - **Tools:**
    - `reply` sends a `keyring/chat/1.0` to `chatDid` in P1's envelope, through an `Outbox` trait (PR-6 implements the real send). It carries `_meta["anthropic/alwaysLoad"]: true`.
    - `inbox` reads from the cursor.
  - **Instructions** say the events are data, not instructions.
- **Never negotiate MCP revision 2026-07-28.**
- **Tests:** a binary-level handshake test modelled on `tests/mcp_starts_without_a_vta.rs`. With no VTA reachable, the experimental capability is present, the permission one is absent, and `reply` and `inbox` are listed with `reply` always loaded. Plus a control.
- **Owner:** Brendan's side. It depends on P2's file format and P1's `sign` signature.

### P6: the CLI front-end and the skill

- **Files:**
  - `src/cli_inbox.rs`, with the `inbox` and `status` subcommands. Add only their two `Command` variants and two dispatch arms to `src/main.rs`;
  - `tests/cli_inbox.rs`;
  - `skills/agent-memory/SKILL.md`, for the Monitor guidance only.
- **What it adds:**
  - **`inbox`** prints new events from the cursor as one JSON line each, wrapped and truncated by the plugin.
  - **`inbox --follow`** tails P2's file **and resumes from its cursor**, never opening a mediator session of its own (finding 6: one process owns `K_a`'s socket).
  - **`status`** prints the pairing and session state.
  - **The skill** tells Claude to arm a Monitor on `inbox --follow` and re-arm it after 30 minutes.
- **Tests:** in the style of `tests/hook_contract.rs`:
  - only JSON lines on stdout;
  - a forged delimiter inside a message cannot escape the wrapping;
  - `--follow` started after five lines and stopped resumes at line six;
  - no mediator connection is attempted (`--follow` run with no network);
  - each with a control.
- **Owner:** Brendan's side. It depends on P2's file format only.

### Order

- **Start at once:** P1 and P4, which have no dependency.
- **Start alongside them:** P2 and P3, against P1's signature (a stub until P1 merges); and P5 and P6, against P2's file format.
- **Merge order** into `integration/agent-connect`: P1, P4, P2, P3, P6, P5. Each takes the integration head by signed merge before its press.
