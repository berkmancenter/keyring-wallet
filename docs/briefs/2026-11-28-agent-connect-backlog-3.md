# Agent connect backlog 3 for the plan owner's side: P1, agents in rooms, mentions and "Answers other people"

Written 2026-11-28 by the Keyring lanes that own each area: the core lane (Section A), the UI/UX lane (Section B)
and the plugin lane (Section C). It is for work done without the chance to ask questions, so every open point is
decided in its part ("Decided here"), except the open questions listed below. If a part meets something it does
not cover: stop that piece, say what you met in the PR, and carry on with the rest.

Feature branch tip when this was written: `feat/agent-connect` at `be84361175a7ac74bc0b84751aab213ad28e9cde`. Plan
steps 7.13, 7.14 and 7.15.

## Common rules (every part)

Backlog 2's common rules hold unchanged (`docs/briefs/2026-11-27-agent-connect-backlog-2.md` on
`docs/agent-connect-backlog-2`):

- start from the feature tip, or as a track built on the named open PR;
- merge, never rebase;
- intent record first;
- no generic failure line;
- a refusal spends the action, the words and the control both;
- a repair names its caller;
- formal reviews with a machine-read first line;
- one sign-off per squash;
- nothing reaches `main`.

Two more:

- **P1 has its own developer switch**, `isAgentRoomsEnabled()`, off by default and off whenever agent connect is
  off. Decided by Alberto, 11-28. Every P1 hook and view gates on it. eb's B3-0 creates it.
- **Every French and Portuguese string stays PROPOSED**, and the release gate stays closed until native readers have
  read them. Decided by Alberto, 11-28: he arranges the readers.

## Order, as tracks

- **First, Keyring's own:** B3-0 (Section B, the UI/UX lane): the P1 words and the switch. Every other part starts
  after it merges.
- **Track A, logic (Section A):**
  - fb-P1a, after #1117;
  - fb-P1b, after #1121;
  - fb-P1c, after fb-P1a and fb-P1b;
  - then fb-P1d and fb-P1e, after fb-P1c;
  - fb-P1h last;
  - fb-P1f and fb-P1g can run beside the others at any point.
- **Track B, screens (Section B):**
  - T1 and T3 in parallel;
  - then T2 after T1, and T4 after T3;
  - T5 is held on open question B2;
  - B3-Z, the developer switch row, last.
  The screens use the hooks Section A creates; each part says which.
- **Track C, the plugin (Section C):** RM1 to RM6, into `integration/agent-connect` on
  github.com/albertoleon7794/vta-agent-memory, after track 4's P1 to P6 and the plugin lane's PR-4 and PR-6, as each
  part names.

## Open questions for Brendan

Each is set out in full, with its options, where it is raised. The interim named there is what gets built until he
answers.

- **B1. How the agent learns `chatDid`, the owner's persona and Keyring's mediator** (§11 Q7, already open). Nothing
  here reaches a live agent until it is answered; every part is built and tested against fakes.
- **B2. How the owner hears about another member's mention.** Asked once, worded the same in all three sections:
  - (a) a structured `keyring/agent/mention-report/1.0`, which Keyring words in the owner's language;
  - (b) plugin text.
  All three lanes recommend (a). T5 and RM4's owner report wait on this; nothing else does.
- **B3. "Answers other people" On, with the hook as the only control** (Section C, ruling 3). We recommend shipping it
  as the plan says, behind the P1 switch.
- **B4. Where `reply` lives** (§11 Q6(c); Section C, ruling 5), already open for track 4's P5.
- **B5. Words the plan doesn't cover** (Section B, ruling 2): the VTA refusing an add, the VTA unreachable during an
  add, and the "Answers other people" change not saved. They are built as PROPOSED English.
- **B6. Knowing a setting took effect** (Section A, ruling 6; Section B, ruling 3). Interim: no acknowledgement, and a
  "gets this change when it's next connected" line while unsent. Later: a heartbeat naming the last applied
  `settings`.
- **B7. Removing an agent from one room** (Section A, ruling 2). Interim: Revoke only.
- **B8. The room offer's newest-wins rule is per type** (Section A, ruling 3). Interim: an intent and a resend per
  agent and room. Choose between keying the rule by room, or one offer carrying the whole set.
- **B9. Which persona is the owner in a room** (Section A, ruling 4). Interim: offer only rooms where the owner acts
  as `ownerPersonaDid`.
- **B10. A nudge over chat when the agent is mentioned** (Section A, ruling 5). Interim: none; the agent reads its
  rooms itself.
- **B11. Where a community says whether agents are welcome** (Section A, ruling 7). Interim: a room-record member
  `agents`; until a community sets it, it reads as not stated.
- **B12. Two new release-gate conditions** (Section A, ruling 8).

One Keyring-side measurement for fb-P1c is pending (Section A, ruling 1). The add is built as planned until it
reports.

Asked upstream through Brendan, on Alberto's word: registering `mentions` on a room post and `delegation` on a
member profile. RM3 and RM6 build on the fallback until then.

---

# Section A: Keyring core logic for P1 rooms, mentions and "Answers other people" (fb-P1a to fb-P1h)

Written 2026-11-28 by the Keyring core lane, our side. DRAFT. Read against `feat/agent-connect` at `be8436117`
(#1118 merged), #1117 at `9c27a0afa`, #1121 at `604bccebe`, the vectors `connected-agents/vectors/control-messages.json`
(version 1, "agreed by relay 2026-11-26"), and the plan's §3.3, §3.5, §3.6, §3.8, §3.9, §3.13, §3.16, §7.13 to §7.15
and §11. Paths are under `packages/core/src/modules/` unless they say otherwise.

## Rulings only Alberto or Brendan can give

"The plan owner" below is Brendan, who owns the agent-connect plan. Nothing below decides these. Each part that meets
one builds the interim named here and says so in its PR. Rulings 2 to 8 and 10 are Brendan's. Ruling 1 goes to Alberto,
but only after the measurement reports. Ruling 9 is §11's.

1. **A Keyring-side measurement for fb-P1c is pending** (Alberto's to rule on afterwards). **Interim until then:**
   the add is built as planned, no copy changes, and the fb-P1c PR says the measurement is pending.
2. **Removing an agent from one room (plan owner).** The plan has only Revoke. Options: (a) Revoke only; (b) "Remove
   from this room": drop the row, send a new `keyring/agent/room-withdrawn/1.0` (behavioural), and narrow `act` and
   the room capabilities when the last room of a context goes (enforced). Interim: (a).
3. **The room offer's state rule (other side's maintainer).** The vectors' rule is per type (`control-messages.json:10`,
   `envelope.ts:237-243`), so an offer for room A delivered after one for room B is `olderState`, and what state an
   offer sets is unwritten. Options: (a) key the rule by type and `roomId`; (b) one offer carries the whole room set.
   Interim: fb-P1b's intent and resend, which converges under the current rule if the plugin keeps offers as a set by
   `roomId`.
4. **Who the owner is in a room (plan owner, then the other side).** The plugin acts only on records by
   `ownerPersonaDid` (§7.15). In a room where the owner acts as another persona, the owner's own mentions would get
   the fixed reply. Options: (a) offer only rooms the owner acts in as `ownerPersonaDid`; (b) the offer gains
   `ownerDid` at minor 1.1 and the plugin gates per room. Interim: (a), code `otherPersona`.
5. **How a mention reaches the agent (other side's maintainer).** Per §3.6 the agent reads its rooms itself, and a
   mention never passes through Keyring. Options: (a) as planned; (b) Keyring also sends a content-free nudge
   `keyring/agent/mention/1.0 { roomId, recordKey }` for a post that mentions the agent. The plugin then reads the
   record from the room and gates on its author, never on the nudge. Interim: (a).
6. **Knowing a setting took effect (other side's maintainer).** Nothing tells Keyring that an Off was applied.
   Options: (a) heartbeat at minor 1.1 carries the id of the last applied `settings`; (b) none. Also asked: the plugin
   applies every `settings` waiting in its inbox before it acts on any room mention at session start. Interim: (b),
   with `pending` reported to the view (eb's ruling 3 words it).
7. **Where P1 reads the community's `agents` setting (plan owner).** §3.8 says "where the community can already put
   room-level text it controls" without naming it. Options: (a) only a room-record member `agents` (none exists, so
   every community room reads not stated, D15); (b) a fixed line in the room's description. Interim: (a).
8. **New release-gate conditions (plan owner).** fb-P1h adds two conditions to a gate the plan owner requires.
9. **§11 Q7 is still open.** Nothing here reaches a live agent until `chatDid` is announced. Every part is built and
   tested against fakes.
10. **How the owner hears about a mention by someone else. This is Brendan's.** It is one open question, shared with
    eb's ruling 4 (T5) and c5's ruling 6 (RM4), and worded as they word it:
    - §6 lists "<member> mentioned you in <room>." "with a count when there are several in an hour" as Keyring copy
      (PLAN:1048), but gives no count wording.
    - Plugin text would reach the owner in the plugin's words, not in the app's language. A structured control
      message would be drawn by Keyring in the owner's language, with the count as a plural key.
    - The two options:
      - **(a) A structured message,** `keyring/agent/mention-report/1.0` `{ version, member, room, count, replied }`,
        drawn by Keyring in the owner's language with a plural count key. RM4 sends this in place of text, and its
        "Sent the fixed reply" distinction becomes `replied`.
      - **(b) Plugin text, RM4 as written.** eb's T5 is then empty: the line is an ordinary agent bubble.
    - Interim: no part of ours builds (a) until it is ruled. Under (a), fb-P1b's control-message plumbing carries it.

**DECIDED (Alberto, coordinator's session, 11-28): P1 has a developer switch of its own, off by default.**

- eb's B3-0 creates `connected-agents/agentRoomsFlag.ts`, mirroring `agentConnectFlag.ts`: `isAgentRoomsEnabled():
  boolean` and `setAgentRoomsEnabled(on: boolean): void`.
- The switch defaults to false, and it reads false whenever `isAgentConnectEnabled()` is false.
- `useRoomAgents`, `useAddAgentToRoom`, `useRoomMentionables` and `useAnswersOthers` gate on `isAgentRoomsEnabled()`.
  So do `useMemberListAgents`, `useAgentIdentity` and `useOwnAgentDids`: with the switch off they answer empty or
  `'none'`.

## Files these parts write

| Part | Creates | Writes (existing) |
|---|---|---|
| fb-P1a | none | `connected-agents/chat/carrier.ts` and its test |
| fb-P1b | none | `connected-agents/chat/control.ts` and its test |
| fb-P1c | `connected-agents/rooms/addToRoom.ts`, `rooms/roomIntent.ts`, `rooms/communitySetting.ts`, `rooms/hooks.ts`, a test each | `connected-agents/types.ts`, `carriage.ts` (one member), `vdc.ts`, `actions.ts`, `driver.ts`, `keepConnected.ts`, `vdcReissue.ts`, `status.ts`, `services.ts`, their tests |
| fb-P1d | `connected-agents/rooms/mentions.ts` and its test | `connected-agents/rooms/hooks.ts`, `rooms/types.ts` (`RecordWrite`), `rooms/real/recordWrites.ts`, `rooms/real/agentRoomsService.ts` (`sendRecord`), `rooms/useRoomSend.ts`, `rooms/useRoomPosts.ts` |
| fb-P1e | `connected-agents/answersOthers.ts` and its test | `actions.ts`, `services.ts`, `ConnectedAgentsProvider.tsx`, `chat/control.ts` |
| fb-P1f | `connected-agents/rooms/delegationRecord.ts` and its test | none |
| fb-P1g | `connected-agents/vectors/others-reply.json`, `__tests__/othersReply.test.ts` | none |
| fb-P1h | none | `connected-agents/__tests__/releaseGate.test.ts` (this part only) |

No part writes `screens/`, `components/`, `navigators/`, `Messages.tsx`, `RoomInfo.tsx`, `RoomMembersTab.tsx`,
`RoomComposer.tsx`, a locale file or a testID. Those are the UI lane's.

## Bases

Every part also starts after eb's B3-0 merges (the P1 switch, `agentRoomsFlag.ts`).

| Part | Start after | Why |
|---|---|---|
| fb-P1a | #1117 and B3-0 | it edits the carrier |
| fb-P1b | #1121 and B3-0 | it edits `control.ts` |
| fb-P1c | fb-P1a, fb-P1b and B3-0 | the add sends the offer and the grant through both; its hooks gate on the switch |
| fb-P1d | fb-P1c and B3-0 | it reads `rooms` |
| fb-P1e | fb-P1c and B3-0 | it edits `sendSettings`, `actions.ts` and `services.ts` after fb-P1c does; its files are disjoint from fb-P1d's |
| fb-P1f | B3-0 | new file, pure |
| fb-P1g | B3-0 | B3-0 adds `ConnectedAgents.OthersReply` (as `SETTLED_ELSEWHERE '§3.13'`), which the test reads |
| fb-P1h | fb-P1c and B3-0 | it names fb-P1c's functions and B3-0's setter |

## Rules for every part

Backlog 2's common rules hold, the two newest in particular. "A refusal spends the action": only an unreachable
answer leaves an action offered again. "A repair names its caller": a part that builds a repair says which function
calls it. Do not touch `trust-tasks/**`, `revoke.ts`, `store.ts`, `entryRead.ts`, `hcp/**`, both testid files or
`docs/**`. Checks: the whole module's jest and the rooms module's jest (`TZ=GMT yarn jest src/modules/connected-agents
src/modules/rooms`), the ratchet unchanged from the tip's baseline, prettier and eslint on changed files. Each test
file has a `// control:` case, and the PR records each source change that turned a named test red.

## The seam with eb (eb's proposal, Section B, "The seam with fb", adopted)

All of these hooks are ours. Every one answers empty, `false` or `'none'` with `isAgentRoomsEnabled()` false, and each
test file has that case, with switch on as the control.

| Hook | Part | Tests (each with its control) |
|---|---|---|
| `useRoomAgents(roomId)` → `{ offered, setting, inRoom, addable }` | fb-P1c | `offered` is false for `private` and `unknown`. `addable` holds only `active` agents not in the room. `widens` is set exactly when the add would add a context to `act` |
| `useAddAgentToRoom(roomId)` → `{ add(agentId): Promise<AddRoomOutcome> }` | fb-P1c | one case per row of fb-P1c's mapping. The setting is re-read at the call: changed between the list and the press, it is `'settingNo'` |
| `useRoomMentionables(roomId)` → `{ agentId, name, handle }[]` | fb-P1d | only own agents with this room in `rooms`. Control: an agent in another room is absent |
| `useAnswersOthers(agentId)` → `{ value, offered, pending, set }` | fb-P1e | `pending` stays true until the intent is `sent`. With `OTHERS_HOOK_CHECK_PASSED` false, `offered` is false |
| `useAgentConnection(id)` + `rooms`, `actNames` | fb-P1e | `actNames` includes the persona's context after an add. Control: before it, the context is absent |
| `useMemberListAgents(roomId)` → `{ own, others }` | fb-P1d | `own` from `rooms` with no network call. `others` stays empty while no profile lists `delegation`; control: a fake verified pair appears |
| `useAgentIdentity(roomId, did)` | fb-P1d, fb-P1f | `own` for an own agent. `verified` only from `verifyDelegationRecord` `ok`. Otherwise `unverified`, and `none` for a member |

**Differs from eb's proposal:**

- **`setting`** is never `'yes'` for a room no community hosts; it reads `'notStated'`. That is because no field marks
  a room as the person's own, and a room with no `communityDid` is often a custody-only community room (fb-P1c,
  decided). So in P1 `'yes'` comes only from a community's explicit `allowed`.
- **`addable`** also leaves out an agent whose `ownerPersonaDid` is not the persona the owner acts as in the room,
  because of ruling 4's interim. So `widens` is set only for an agent's first room in a context.
- **`AddRoomOutcome`** gains `'notAddable'`, for an agent that left `addable` between the list and the press. That is
  because those codes are not the VTA's refusal, and `'refused'`'s words would be false for them.
- **The grant** does not go through `grantAgentAccess`, because it is `notYet` in the real service and does no kind
  check (fb-P1c, decided). The hook's outcomes are unchanged.
- **`useAgentIdentity`** answers `{ kind: 'own', …, revoked: true }` for a revoked own agent, rather than never `own`.
  That is because `markOwnAgents` still draws the mark on its posts, and `unverified`'s "Keyring can't tell who this
  belongs to." would then be false. The sheet draws it without the setting.

---

## fb-P1a: the carrier's settled send

- `ChatMediatorSession` (`carrier.ts:152`) gains `sendToSettled(peerDid, plaintext, options?: { fence?: boolean;
  withinMs?: number }): Promise<SettledSend>`, typed from `VtiMediatorTransport.ts:141-144`. `send` calls it in place
  of `sendTo` (`carrier.ts:340`).
- **The mapping:**
  - `fenced` and `notRefusedWithin` become `{ result: 'sent'; id; settled: 'fenced' | 'notRefusedWithin' }`;
  - `stopped` becomes `{ result: 'unreachable'; reason: 'unsettled' }`. `UnreachableReason` gains `'unsettled'`, so
    the send is offered again, and a resend keeps its `id`, so the receiver's seen ids drop a copy that did arrive;
  - a rejection in the session's refusal form (`… refused: <words>`, `VtiMediatorTransport.ts:1769`) is read with
    `classifySendFailure` (`carrier.ts:257-272`). `e.p.delivery.refused` stays `unreachable`/`recipientUnknown`,
    which §3.5 retries. Any other refusal becomes the new `{ result: 'refused'; code?: string }`, which is not offered
    again;
  - a rejection without that form (the authcrypt, or a session stopped before the forward left) is
    `unreachable`/`transport`.
- **Decided here:** an unknown refusal code is `refused`, never `closedMediator`. Reason: the words for
  `closedMediator` ("Your mediator doesn't allow this phone") would be false for any other refusal. The UI lane words
  `refused` (one key, PROPOSED in fr and pt-br).
- **Decided here:** `stopped` is not `sent`. Reason: it carries no evidence either way (`VtiMediatorTransport.ts:137`).
- Tests: one per outcome. A rejection reading "session stopped" is `transport`; control: the same text with
  `refused: e.p.x` is `refused`. Mutation: map `stopped` to `sent`, and "stopped is offered again" goes red.

## fb-P1b: delivering the room offer

- `sendRoomOffer(id, offer)` (`control.ts:424` in #1121) stops using `sendState`, the one that assumes "a lost one is
  replaced by the next" (`control.ts:25`). An offer for room A is never replaced by one for room B.
- Each offer is an intent keyed by agent, type and room (`intentKey(id, 'keyring/agent/room-offer|' + roomId)`),
  written before the send. It is stamped by the per-type rule of `sendState` (`control.ts:431-445`) on every send,
  first or resent, and resent by `resendPending` (`control.ts:537`) with its first `id`.
- **Outcomes:** `sent` completes the intent. `refused` drops it and records `offerRefused: true` on the room row.
  `unreachable` keeps it.
- `buildRoomOffer(record: AgentConnection, room: AgentRoom): RoomOffer` returns `{ roomId, hostDid, tier,
  handleToMention: record.handle, contexts: record.memoryContexts }`. `contexts` is informational (§3.6 step 5).
- Tests: offer A is lost, B is applied, and the repair resends A with A's id and an `issuedAt` after B's.
  `verifyEnvelope`, with B as `lastApplied`, answers `ok`. Control: A's first copy arriving after B is `olderState`.
  Mutation: drop `roomId` from the key, and "two adds pending, both resent" goes red.

## fb-P1c: the room on the record, and adding an agent to a room (7.13)

**Types** (`types.ts`; `AgentConnection` at `:59-94` has no `rooms` today):

```ts
export type AgentRoom = {
  roomId: string; hostDid: string; communityDid?: string
  name: string               // the room's label at the add, for the details' rooms list (inert text)
  tier: 'open' | 'attributed'
  addedAt: string            // ISO instant
  personaDid: string         // whom the owner acts as in the room
  personaContext: string     // the context the add put in `act`
  offerRefused?: true
}
// AgentConnection gains:  rooms?: AgentRoom[]   (absent means none, so stored records still read)
```

**`addToRoom.ts`:**

```ts
export type CommunityAgentsSetting = 'allowed' | 'notAllowed' | 'notStated'
export function requireAiAgentKind(match: { kind?: string }): boolean
export type AddToRoomFailure =
  | 'noRecord' | 'notOffered' | 'alreadyInRoom' | 'tierNotSupported' | 'communityNo' | 'communityNotStated'
  | 'otherPersona' | 'notAiAgent' | 'notListed' | 'refused' | 'unreachable' | 'notApplied' | 'vdc'
export type AddToRoomResult = { ok: true; offer: 'sent' | 'pending' } | { ok: false; code: AddToRoomFailure }
export type RoomAddPorts = {
  clock: () => number; access: AgentAccessPort; connections: ActionRecords; vdcSign: VdcSignPort
  signingKeyIdOf?: (personaDid: string) => string; intents: RoomAddIntentStore
  control: Pick<AgentControl, 'sendRoomOffer' | 'sendVdcGrant'>
  communitySetting(communityDid: string, roomId: string): Promise<CommunityAgentsSetting>
  personaContextOf(personaDid: string): Promise<string | undefined>
}
export function addAgentToRoom(ports: RoomAddPorts, input: {
  agentId: string; room: Pick<RoomSummary, 'roomId' | 'tier' | 'host' | 'communityDid'>; actingAs: string
}): Promise<AddToRoomResult>
export function settleRoomAdds(ports: RoomAddPorts): Promise<{ settled: string[]; dropped: string[] }>
```

**The add, in order:**

1. **Checks, no network:**
   - the record is `active` (else `notOffered`);
   - the tier is `open` or `attributed` (`private` and `unknown` are `tierNotSupported`);
   - the agent is not in the room already (`alreadyInRoom`);
   - `actingAs === ownerPersonaDid` (`otherPersona`, ruling 4);
   - the community's setting: `notAllowed` is `communityNo`, and `notStated` or no `communityDid` is
     `communityNotStated`.
2. **The kind, read back on every add:** `findAgentEntries` (`carriage.ts:78-81`). An entry that is not listed is
   `notListed`, and a throw is `unreachable`. `requireAiAgentKind(match)` false is `notAiAgent`.
3. **The write:** write the intent `{ agentId, roomId, personaContext, at }` (`keyring/agent-room-add`, keyed
   records). Then one `narrowOrWidenCapabilities` with `act: { from: held, to: held ∪ {personaContext} }` and
   `capabilities: listed ∪ {'room-present', 'room-open'}` (wire names at `vta-sdk/src/acl.rs:305-306`, VTI clone
   `97fda9813`). Send only the members that change; no VTA write when neither does (a second room in the same context).
   `AgentAccessPort.narrowOrWidenCapabilities` (`carriage.ts:82-86`) gains `capabilities?: readonly string[]`, which
   `VtaClient`'s `AgentAccessChange` already carries (`VtaClient.ts:719-733`). A refusal from the VTA is `refused`, and
   a throw without one is `unreachable`.
4. **The read-back:** `act` must equal exactly the bound memories ∪ `allowedBesideMemories(record, roomContexts ∪
   {personaContext})` (`actions.ts:88`), and the capabilities must include both room ones. Anything else is
   `notApplied`, the intent is dropped, and Restore shows the drift.
5. **The record:** one `store.update` adds the room, `personaContext` to `contexts`, and the two capabilities to
   `capabilities`. Then the intent is removed.
6. **The first room's grant:** a new VDC grant with `vdcScopeOf(record)` (`keyring.agent.room-present`), stored, then
   `sendVdcGrant`. A failure is `vdc`, with the room kept.
7. **The offer:** `sendRoomOffer(buildRoomOffer(...))` gives `offer: 'sent' | 'pending'`.

**The rest of the part:**

- **`vdcScopeOf(record)`** (`vdc.ts`) is `vdcScopeFor({ memory: memoryContexts.length > 0, roomAdded:
  (rooms?.length ?? 0) > 0 })`. It replaces the hard-coded `roomAdded: false` at `actions.ts:207`, `driver.ts:288`,
  `keepConnected.ts:216` and `vdcReissue.ts:68`. `reissueDueGrants` also re-issues a grant whose scope differs from
  `vdcScopeOf(record)`. That repairs a `vdc` failure, and its caller is the existing reconcile step.
- **Rooms in what an entry may hold:** `status.ts:98` and `AgentActions`' `roomContextsOf` (`actions.ts:72`, not
  wired in `services.ts:142`) both read `rooms[].personaContext`, so drift and Restore count the room's context as
  allowed.
- **The repair:** `settleRoomAdds` runs in `services.reconcile` as its own `step`, right after `reconcileAgents`
  (`services.ts:192`). For each intent it reads the entry. When the entry holds the context and both capabilities, it
  does steps 5 to 7; otherwise it drops the intent.
- **The ports:** `personaContextOf` comes from the persona store (`personaForCommunity`, as at
  `polls/agentPollsBackend.ts:133-135`). `communitySetting` reads the member `agents` (ruling 7).
- **The hooks** are `useRoomAgents` and `useAddAgentToRoom`, in `rooms/hooks.ts`, as "The seam with eb" below gives
  them. `add` maps `AddToRoomResult` onto eb's `AddRoomOutcome`:
  - `ok` (offer sent or pending) and `vdc` (the room is recorded; the reconcile re-issues the grant) are `'added'`;
  - `notAiAgent` is `'notAgentKind'`; `refused` is `'refused'`; `unreachable` is `'unreachable'`;
  - `notApplied` and `notListed` are `'accessChanged'`;
  - `communityNo` is `'settingNo'`, and `communityNotStated` is `'settingNotStated'`;
  - `noRecord`, `notOffered`, `alreadyInRoom`, `tierNotSupported` and `otherPersona` are `'notAddable'`.
- **Decided here:** the grant goes through connected-agents' access port, not `RoomsService.grantAgentAccess`
  (`rooms/types.ts:681`, which is `notYet` at `agentRoomsService.ts:2972`). Reason: one writer computes every entry
  write from the read-back (the `actions.ts` header). Our side updates the wording of §3.6 step 1.
- **Decided here:** no room counts as the person's own in P1, and a room with no `communityDid` reads `notStated`.
  Reason: no field says a room is the person's own (`RoomSummary`, `rooms/types.ts:120`). A room with no
  `communityDid` is often a custody-only community room whose details are not known yet (`source: 'custody'`, `:116`).
  So this fails safe.
- **Decided here:** a revoked record keeps its `rooms` as history. Revoke removes the entry, and with it access to
  every room, with the 4-hour leaf tail of §3.9.
- **Tests:**
  - `act` after the add is exactly memories, own context and persona context. Control: an entry read back with one
    extra context is `notApplied`. Mutation: check by containment, and that test goes red.
  - A kind other than `ai-agent` gives `notAiAgent` and no write. Control: `ai-agent` writes once.
  - A second room in the same context makes no VTA write. Control: the first room does.
  - `notAllowed` and `notStated` refuse with their own codes and make no VTA call. Control: `allowed` proceeds.
  - An intent left by a crash, with the entry widened, is recorded by `settleRoomAdds`. Control: an intent whose
    entry lacks the context is dropped.
  - Extend after an add keeps `keyring.agent.room-present`. Mutation: restore `roomAdded: false` at
    `actions.ts:207`, and the test goes red.
  - `viewOf` shows no drift after the add. Control: without the record update, `extra` is the persona context.

## fb-P1d: mentions, the agent mark and the Agents section (7.14)

```ts
export function mentionText(handle: string): string                 // '@' + handle
export function insertMention(text: string, cursor: number, handle: string): { text: string; cursor: number }
export function mentionedAgents(text: string, agents: readonly Pick<AgentConnection, 'agentDid' | 'handle'>[]): string[]
export function mentionsMember(dids: readonly string[], features: RecordFeatures): { mentions?: string[] }
export function ownAgentDids(records: readonly AgentConnection[]): ReadonlySet<string>
export function markOwnAgents<T extends { byAgent: boolean; author?: Identity; createdBy?: Identity }>(
  items: T[], dids: ReadonlySet<string>): T[]
export function useOwnAgentDids(): ReadonlySet<string>
// and, in rooms/hooks.ts, eb's useRoomMentionables, useMemberListAgents and useAgentIdentity (the seam below)
```

- **`mentionedAgents`** matches `@` plus the whole handle, case-insensitively, at word boundaries, and never the
  name alone (§3.6).
- **`mentions` on the wire:**
  - `RecordWrite`'s `message` (`rooms/types.ts:499-501`) gains `mentions?: string[]`. `useRoomSend.ts:160-166` passes
    it, and `sendRecord` (`agentRoomsService.ts:2484`) seals it into the body.
  - `'mentions'` joins `GOVERNED_BODY_MEMBERS` (`recordWrites.ts:22`), so `requirePermitted` refuses it in a room
    whose profile does not list it.
  - The note path never writes it.
- **The mark:** `useRoomPosts.ts:680-685` passes posts through `markOwnAgents`.
- **Decided here:** `mentions` lists only the owner's own agents that are in this room (`rooms[]`) and whose handle
  is in the text. Reason: Keyring knows another party's agent's DID only from a verified delegation, which no room
  carries yet.
- **Decided here:** the author is `createdBy` where present, else `author`. The mark matches the current `agentDid` of
  records in every state but `pairing` and `notFinished`. Reason: a revoked agent's posts are still an agent's.
- **The send:** `useRoomSend` computes `mentionedAgents(body, mentionables)` itself. The composer only inserts
  `"@handle "`, so the signature of `onSend` does not change.
- **Decided here:** `useMemberListAgents().own` lists `active`, `expired` and `revoking` agents, not `revoked`.
  Reason: a `revoking` agent may still have access.
- **Decided here:** the hooks read an optional context. Outside a provider, or with `isAgentRoomsEnabled()` false,
  they answer empty or `'none'`. Reason: the rooms screens may sit outside `ConnectedAgentsRoot`.
- **Tests:**
  - The insert is the whole handle. `@Notes-Helper-7f3k,` matches; `@notes-helper-7f3kx` and a bare `notes-helper-7f3k`
    do not.
  - The body is byte-identical to today's when the profile does not list `mentions`. Control: a profile that lists it
    adds exactly that member. Mutation: drop `'mentions'` from `GOVERNED_BODY_MEMBERS`, and "refused where not listed"
    goes red.
  - The mark shows only for an own agent. Control: another DID with the same name gets none.
  - `useMemberListAgents` lists the owner's agents when `listCommunityMembers` is `adminOnly`.

## fb-P1e: "Answers other people" on the base path (7.14)

**What it changes in the plugin's settings document.**

- The document is `keyring/agent/settings/1.0`, payload `{ version: "1.0", answersOthers, locale, handle }`
  (`control-messages.json:96-104`, `envelope.ts:60`).
- The setting flips only `answersOthers`. Every send carries all four members: a settings document is the whole
  state, never a delta. `locale` is always present (`"en" | "fr" | "pt-br"`); `control.ts:419` makes it optional
  today.
- **The newer-state rule:**
  - the plugin applies a `settings` only when its `issuedAt` is after the last one it applied
    (`control-messages.json:10`);
  - Keyring stamps each send at least one second after the last (`control.ts:431-445`);
  - another major is ignored, and the plugin keeps its last good document; with none, it is off (§3.2 "Versions").

**The interface:**

```ts
export const OTHERS_HOOK_CHECK_PASSED = true   // step 0.3(f), measured 2026-11-26 (D23); false hides the switch
// AgentActionsPort gains:
setAnswersOthers(agentId: string, on: boolean): Promise<AnswersOthersResult>
export type AnswersOthersResult = { ok: true; delivery: 'sent' | 'pending' } | { ok: false; code: 'noRecord' | 'notOffered' }
// eb's hook, in ConnectedAgentsProvider.tsx:
export function useAnswersOthers(agentId: string): { value: boolean; offered: boolean; pending: boolean
  set(on: boolean): Promise<'saved' | 'notSaved'> }
// useAgentConnection(id) gains: rooms: { roomId: string; name: string }[]; actNames: string[]
export function useSettingsLocale(): void   // on an app-language change: sendSettings for every active agent
```

- **`useAnswersOthers`:**
  - `offered` is `OTHERS_HOOK_CHECK_PASSED`, an `active` base-path agent, and `isAgentRoomsEnabled()`;
  - `pending` is true while a settings intent for the agent is not yet `sent`;
  - `set` answers `'saved'` once the record is written, whether delivery is `sent` or `pending`. It answers
    `'notSaved'` for `noRecord`, `notOffered` or a failed store write.
- **`actNames`** are the names of every context in the entry's `act` as the last reconcile read it, from
  `memoryNames()`, with the persona's context included. A context with no name is left out, never shown by its id.

**The rules:**

- The record is written first (`store.update`). Then `settings` is sent through an intent per agent (the `control.ts`
  intent pattern, `:487`), which holds the newest payload and is resent by `resendPending` until it is `sent`.
- Off needs no confirmation and On does (§6). The confirmation is the view's.
- An HCP agent is `notOffered` here: it has `hcp/answersOn` (companion 2026-11-27-al-2, finding 1).
- **Decided here:** settings get an intent. Reason: "a lost one is replaced by the next" (`control.ts:25`) fails for an
  Off, which may have no next.
- **Tests:**
  - An Off sent while the agent is unreachable keeps its intent, and the repair sends it with an `issuedAt` after the
    On's. Control: an On delivered at once leaves no intent. Mutation: remove the intent, and the repair test goes red.
  - A locale change resends with the same `answersOthers`.

## fb-P1f: reading an agent's delegation record (7.14, §3.16)

```ts
export type DelegationCheck = { ok: true; ownerDid: string }
  | { ok: false; reason: 'notListed' | 'absent' | 'subjectNotAuthor' | 'issuerNotPersona' | VdcProblem }
export function verifyDelegationRecord(input: { profileBody: Record<string, unknown>; authorDid: string
  roomListsDelegation: boolean; verify: VdcProofVerifier; now: number }): Promise<DelegationCheck>
```

- It runs `verifyVdcPair` (`vdc.ts:195`) with `ownerPersonaDid` set to the grant's `issuer` and `agentDid` set to the
  author. A room that does not list `delegation` is `notListed`, and the record is not read. Keyring never writes the
  record, because the plugin does (7.15).
- Tests: a valid pair is `ok`. A subject other than the author is refused, and so is an acceptance by another key.
  Control: the same pair with the matching author passes.

## fb-P1g: Keyring's side of 7.15

- **What Keyring sends the plugin:** the documents above. That is `settings` (fb-P1e), and the room offer (fb-P1b)
  with `handleToMention` and `tier` (`open` or `attributed` only).
- **Interim (ruling 10):** the plugin's report ("<member> mentioned you in <room>") and each third-party request
  arrive as `keyring/chat/1.0` and are shown as the agent's chat messages, as inert text. Nothing is built for them.
- **`vectors/others-reply.json`:** `{ en, fr, "pt-br" }` copied from §3.13, with `status: "fr and pt-br drafts, not
  reviewed (D16)"`. The test checks the locale files' `ConnectedAgents.OthersReply` against it. The plugin's
  `src/core/others/messages.json` test is the other side's.
- Test control: one changed French character fails.

## fb-P1h: the release gate's room conditions

These conditions apply while the P1 switch is reachable: `setAgentRoomsEnabled` is mentioned outside tests and
`agentRoomsFlag.ts`, or that file's initial value is not the literal `false`. They are read the way `SETTER` and
`defaultOn` are read (`releaseGate.test.ts:145-147`), and keep the file's invariant that a false match errs strict
(`:37-39`).

1. A non-test file with `['"]room-present['"]` in its `live` text also calls `requireAiAgentKind(` in its `bare` text.
2. `addAgentToRoom` is exported from a file whose `bare` text calls both `requireAiAgentKind(` and
   `communityAgentsSetting(`.

- Tests: the wired tree passes. Removing either call fails and names it. A call that exists only in a comment or a
  string does not count. Control: `vdc.ts`'s `'keyring.agent.room-present'` does not trip condition 1.

---

# Section B: the screens

# Agent connect backlog 3: the UI/UX lane's parts for P1 rooms (steps 7.13 and 7.14)

Written 2026-11-27 by the UI/UX lane (eb), owner of how agent connect is drawn. It is a brief with no code. It is for
work done without the chance to ask questions, so every open point is decided here ("Decided here"), except the
rulings below, which only Alberto or Brendan can give. If you meet something this brief doesn't cover, stop that
piece, say what you met in the PR, and carry on with the rest. Your PRs come to eb for the frame check and to the
review lane (ac) for review.

Sources. Every reference is to keyring-wallet `feat/agent-connect` at **`be8436117`**, cited as PLAN:line for
`docs/plans/agent-connect-plan.md`:
- §6's P1 copy (PLAN:1004-1048) and its key list (PLAN:1059);
- §3.6 (PLAN:592-628), §3.8 (PLAN:640-646), §3.10 (PLAN:693), §3.13 (PLAN:746-776), §3.15 and §3.16 (PLAN:851-861);
- steps 7.13 and 7.14 (PLAN:1353-1371);
- the canvas, `docs/plans/agent-connect-plan/canvas/`: frames 12 to 16 and 31 to 40;
- backlog 2's brief (`docs/briefs/2026-11-27-agent-connect-backlog-2.md`) for the common rules, and backlog 2's Section B for the
  routes this builds on (R1 to R4);
- c5's backlog 3 part (Section C, RM1 to RM6), the plugin side of 7.15. These parts and RM1 to RM6 write
  no common file.

The parts are **B3-0** (eb: the words and the P1 switch), **T1 to T4** (the screens, a few hours each), **T5** (held
on ruling 4) and **B3-Z** (the developer switch row, last).

## Rulings only Alberto or Brendan can give

1. **DECIDED (Alberto, coordinator's session, 11-28; relayed to eb by the coordinator): P1 gets its own developer
   switch, `isAgentRoomsEnabled()`, default off.** B3-0 goes ahead with `agentRoomsFlag.ts`, and B3-Z adds the row.
   The question as it was put:

   **Does P1 get a switch of its own? This is Alberto's.**
   - Backlog 2 puts agent connect behind one developer switch, and the release gate keeps it off in every release.
   - P1 is a separate tier: "A P1 screen is not walked or required by the P0 gate" (PLAN:1063). If P1 rides the same
     switch, the day P0 is released with the switch on, every half-built P1 screen comes with it.
   - **Recommended:** a second switch, `isAgentRoomsEnabled()`, default false, read only when agent connect is also
     on. Every P1 view below draws only when both are on.
   - **B3-0 waits on this ruling.** If the answer is "the same switch", B3-0 skips the flag file, and every
     `isAgentRoomsEnabled()` below reads `isAgentConnectEnabled()`. Nothing else changes.
2. **Words for outcomes the plan gives none. This is Brendan's, as owner of §6.** The tracks build each of these as a
   `PROPOSED_COPY` entry, in en as well as fr and pt-br. The copy test allows that, and it ships in developer builds
   only. Settling one is a plan edit, then a one-line move out of `PROPOSED_COPY`.
   - Adding to a room, when the VTA refuses the change: "Your VTA refused this. "{{name}}" wasn't added."
   - Adding to a room, when the VTA can't be reached: "Couldn't reach your VTA. "{{name}}" wasn't added." The phone
     offline counts here, since "the room is not recorded until then" (PLAN:691).
   - "Answers other people", when Keyring couldn't store the change: "This setting wasn't changed."
   - §3.10 gives the one add failure that has words, the kind check (PLAN:693). It is used as written.
3. **What the "Answers other people" switch says before the agent has the change. This is Brendan's.**
   - The `settings` message has no acknowledgement. Its newest state wins (`chat/envelope.ts` `STATE_TYPES`), and the
     plugin applies it when it reads the chat.
   - So for a while the switch reads Off while the plugin still answers others, or the other way round. Turning Off
     is the case that matters.
   - **Proposed:** while fb's hook reports the change as not yet sent, a line under the switch, "{{name}} gets this
     change when it's next connected." (PROPOSED). Built as an optional prop, so "no line" is a one-line removal.
   - The alternative needs a protocol change: an acknowledgement in 7.15, with the switch showing "Changing…" until
     it arrives.
4. **How the owner hears about a mention by someone else. This is Brendan's, and it decides T5.**
   - §6 lists "<member> mentioned you in <room>." "with a count when there are several in an hour" as Keyring copy
     (PLAN:1048), but gives no count wording.
   - c5's RM4 has the plugin write that line, and a second one, "Sent the fixed reply to <member> in <room>.", as chat
     text over its outbox.
   - Plugin text would reach the owner in the plugin's words and not in the app's language. A structured control
     message would be drawn by Keyring in the owner's language, with the count as a plural key.
   - **This is one open question, shared with c5's RM4,** with two options:
     - **(a) A structured message,** `keyring/agent/mention-report/1.0` `{ version, member, room, count, replied }`,
       drawn by Keyring in the owner's language with a plural count key. RM4 sends this in place of text, and its
       "Sent the fixed reply" distinction becomes `replied`. **eb recommends (a).**
     - **(b) Plugin text, RM4 as written.** T5 is then empty: the line is an ordinary agent bubble (R3).
   - **T5 is not started until this is ruled,** and RM4's owner report waits on the same ruling.
5. **DECIDED (Alberto, coordinator's session, 11-28; relayed to eb by the coordinator): Alberto arranges the fr and
   pt-br native readers himself.** Every fr and pt-br string stays PROPOSED, and the release gate stays closed until
   they have read them. The question as it was put:

   **The native read of fr and pt-br. This is Alberto's to arrange, and it does not block.** Every fr and pt-br string
   below is eb's draft, marked PROPOSED. `OthersReply`'s fr and pt-br are the plan's own drafts (PLAN:752-756), under
   D16's release gate (c5's ruling 2). Nothing here waits on the read; a release does.

Also relevant: c5's ruling 3 (shipping the switch with the hook alone) decides whether the plugin honours "On". The
views here follow fb's `offered` value, whatever that ruling says.

## The seam with fb (agreed 2026-11-27; fb's brief wins)

fb writes the logic, and eb's parts below write the views and the wiring. fb adopted these six hooks as the seam in
its logic part (Section A) on 2026-11-27. Where the code makes a shape awkward, fb's part carries a
"Differs from eb's proposal: … because …" line, and **that line wins** over the names below. A track whose hook doesn't
exist or doesn't fit stops and says so; it doesn't reshape a view to fit.

- **On the tip now:**
  - `useAgentConnections()` and `useAgentConnection(id)`, whose record carries `handle` and `answersOthers`;
  - `handle.ts` (`deriveHandle`);
  - `Rooms.AgentBadge` drawn from `byAgent` (`RoomPostBubble.tsx:134`, `RoomNoteCard.tsx:97`);
  - `RevokeAgentSheet`'s `hasRooms` form.
- **For T1 (7.13):** `useRoomAgents(roomId)` returns:

  ```
  {
    offered: boolean,               // false for a private room, or with either switch off
    setting: 'yes' | 'no' | 'notStated',
    inRoom: { agentId, name, memoryNames: string[] }[],
    addable: { agentId, name, memoryNames: string[], widens: { context: string } | null }[],
  }
  ```

  - `setting` is `'yes'` in a room the person owns, and for a room no community hosts (§3.8, PLAN:646).
  - `addable` holds only `active` agents that are not yet in the room (frame 34's note).
  - `widens` is the persona's context when the add would put it into `act`: the agent's first room, or a room of
    another persona (PLAN:594).
- **For T1:** `useAddAgentToRoom(roomId)` returns `{ add(agentId): Promise<AddRoomOutcome> }`, where `AddRoomOutcome`
  is one of:
  - `'added'`;
  - `'notAgentKind'`, the §3.10 refusal;
  - `'refused'`, the VTA refused the update;
  - `'unreachable'`;
  - `'accessChanged'`, the read-back of `act` isn't exactly the bound memories plus the persona's context (PLAN:1361);
  - `'settingNo'` and `'settingNotStated'`, the setting re-read at the call.

  The intent record, the kind check, `grantAgentAccess`, the VDC re-issue and the room offer are fb's. A room offer
  that is queued but not yet read by the agent counts as `'added'`: the room is recorded once the VTA update succeeds
  (PLAN:597).
- **For T2 (7.14):** `useRoomMentionables(roomId)` returns `{ agentId, name, handle }[]`, the owner's agents in this
  room. The composer only inserts text. fb builds `mentions` from the whole handles in the body, where the profile
  lists `mentions` (PLAN:1371), so `onSend`'s signature does not change.
- **For T3 (7.14):** `useAnswersOthers(agentId)` returns `{ value: boolean, offered: boolean, pending: boolean,
  set(on: boolean): Promise<'saved' | 'notSaved'> }`.
  - `offered` is false when the hook check (0.3(f)) failed. D23 is met today (PLAN:774), so fb returns true, but the
    branch is built and tested.
  - `pending` means stored, but not yet sent to the agent (ruling 3).
  - The rooms list in `useAgentConnection(id)`: `rooms: { roomId, name }[]`.
  - The access line's names: `actNames: string[]`, every context in the entry's `act`, so the persona's context
    shows (PLAN:1361, "the effective-access lines show the persona's context").
- **For T4 (7.14):** `useMemberListAgents(roomId)` returns `{ own: AgentRow[], others: AgentRow[] }`, where `AgentRow`
  is `{ did, name, handle, owner, agentId? }`. `others` holds only agents with a verified delegation (§3.16); none
  appear until a room's profile lists `delegation`, which is correct today.
- **For T4:** `useAgentIdentity(roomId, did)` returns one of:
  - `{ kind: 'none' }`, a person (or either switch off);
  - `{ kind: 'own', agentId, name, handle, owner }`;
  - `{ kind: 'verified', name?, owner, handle?, did, verifiedName? }`;
  - `{ kind: 'unverified', did, calledName? }`.

  `delegationRecord.ts` and its verification are fb's.

## Files each part writes (no two parts write the same file; fb's parts write none of these)

| Part | Creates | Edits |
|---|---|---|
| B3-0 (eb; lands first) | `connected-agents/agentRoomsFlag.ts` (only if ruling 1 says a separate switch) | the three locale files (`ConnectedAgents.*` only); `connected-agents/proposedCopy.ts` (PROPOSED and SETTLED_ELSEWHERE entries only) |
| T1 7.13 room info and the add flow (frames 34 to 37) | `rooms/components/AgentRoomSection.tsx`, `rooms/components/AgentPickerSheet.tsx`, `rooms/components/AgentRoomSheet.tsx` (the add sheet; the plan's name, PLAN:984), `rooms/components/AddAgentFlow.tsx`, `connected-agents/screens/WhatItRemembersSheet.tsx`, `rooms/__tests__/addAgentToRoom.test.tsx`, `connected-agents/__tests__/fixtures/screenStatesRooms.tsx`, `e2e/lib/agent-connect-screens.rooms.json` | `rooms/screens/RoomInfo.tsx` |
| T2 7.13 and 7.14 composer (frames 31 to 33) | `rooms/components/ComposerMoreSheet.tsx` (the plan's name, PLAN:991), `rooms/components/MentionSuggestions.tsx`, `rooms/__tests__/composerAgents.test.tsx`, `fixtures/screenStatesComposer.tsx`, `e2e/lib/agent-connect-screens.composer.json` | `rooms/components/RoomComposer.tsx`, `rooms/screens/Room.tsx` |
| T3 7.14 "Answers other people" and the P1 lines (frames 12 to 16) | `connected-agents/components/AnswersOthersRow.tsx`, `connected-agents/screens/AnswersOthersConfirmSheet.tsx`, `connected-agents/__tests__/answersOthers.test.tsx`, `fixtures/screenStatesAnswers.tsx`, `e2e/lib/agent-connect-screens.answers.json` | `connected-agents/screens/AgentDetailsView.tsx`, `AgentListView.tsx`, `ChangeMemoriesView.tsx`; `screens/agents/AgentDetailsScreen.tsx` and `AiAgentsScreen.tsx` (new props only) |
| T4 7.14 members, the agent sheet and the identity sheet (frames 14, 38 to 40) | `rooms/components/AgentsSection.tsx` (the plan's name, PLAN:628), `connected-agents/screens/AgentIdentityBody.tsx`, `rooms/__tests__/agentsSection.test.tsx`, `fixtures/screenStatesMembers.tsx`, `e2e/lib/agent-connect-screens.members.json` | `rooms/components/RoomMembersTab.tsx`, `rooms/screens/RoomPart.tsx`, `rooms/components/RoomIdentitySheet.tsx` |
| T5 the mention line in the agent chat (HELD on ruling 4) | decided by the ruling | `connected-agents/screens/AgentChatView.tsx` (R3's) |
| B3-Z the developer switch row (last; only with ruling 1's separate switch) | none | `app/src/screens/Developer.tsx`, `app/src/store.tsx`, `app/container-imp.ts` (as R4 did for agent connect) |

Two files are written by more than one part. Both are additive, and both are allowed exceptions:
- **The reachability test's expected list** (`connected-agents/__tests__/components.test.tsx`, that list only). Each
  part adds exactly the entries its own imports produce, sorted. The part that lands second takes the tip by a merge
  and keeps both sides' lines, sorted. The test itself is the check.
- **The generated testID files.** Regenerate them (`cd packages/core && yarn testids`, then
  `bash e2e/scripts/sync-testids.sh`); never hand-merge them.

## Do not touch

- The locale files and `proposedCopy.ts`, outside B3-0. A word a track needs that B3-0 didn't add is a stop-and-say.
- `hcp/**`. An HCP agent's "Answers on" is the HCP lane's C5 (`hcp/answersOn/`, PLAN:1057). T3's row is drawn for
  base-path agents only.
- `releaseGate.test.ts`, which passes **unchanged** in every part. The catalogue's machinery (`screenCatalogue.test.tsx`,
  `wordSource.ts`) and every `fixtures/screenStates*.tsx` and manifest but your own.
- `RoomPostBubble.tsx`, `RoomNoteCard.tsx` and the `byAgent` mark: it is drawn today, and fb sets the value.
- `RoomsService.listCommunityMembers` and `CommunityRoomMember`. No agent is added to the community's list (PLAN:628).
- The thread composer. It has no "+" and gains none (PLAN:851).
- `packages/core/tsc-baseline.txt`, `docs/**`, `scripts/**`, `.github/**`, any `package.json`, any lock file.

## Rules every part follows

Backlog 2's common rules hold unchanged:
- start from the tip, and "start after X merges";
- merge, never rebase, with patch-ids shown unchanged;
- contracts first;
- formal reviews only, "CLEARED at <full sha>";
- one `Signed-off-by:` per squash body, as its last line, with no agent trailers;
- the checks of backlog 2's Section B "Rules", with `src/modules/rooms` added to the jest paths;
- nothing reaches `main` without the plan owner.

Three of those rules, in the form they take here:

- **Behind the switches.** With either switch off, the app is byte for byte as on the tip:
  - RoomInfo has no agents section;
  - the "+" picks a file at once, labelled "Attach a file";
  - the members tab has no Agents section and no extra heading;
  - the identity sheet is today's for every DID;
  - the details and the list draw no P1 line.

  Each track has a test with the switches off that proves it, as its control.
- **No generic failure line where any case it covers contradicts it.** Every `AddRoomOutcome` and every `set` result
  has its own words, mapped below. A value the table doesn't name is a stop-and-say.
- **A refusal spends the action** (#1110, kept here).
  - Once an add comes back with anything but `'added'`, that sheet's "Add to room" is gone for good. The sheet shows
    the outcome's own line and one button, "Done" (`Global.Done`).
  - There is no "Try again" anywhere in these parts. The existing no-retry pattern test covers the new strings in all
    three languages.
  - Starting an add again from the room info row is a new action, not a retry inside the sheet.
  - A switch change that comes back `'notSaved'` leaves the switch at its old value, with the line. It wasn't refused,
    so the switch stays usable.

One rule is new:

- **A repair names its caller.** Any branch that handles a state that should not happen names, in a comment at the
  branch and in its test's name, why it can happen and which code calls the repair. Here that means:
  - `'accessChanged'` (who: `useAgentActions().restore`, from AgentDetails' "Restore");
  - `useAgentIdentity` returning `'own'` for a revoked agent (who: nothing; it draws as `'unverified'`, below);
  - `offered: false` (who: fb's hook-check constant).

Two more apply:

- **Controls:** each new test file has a `// control:` case. The PR records one source change per test file that made
  a named test fail.
- **The catalogue:** each part brings its own `screenStates*.tsx` and manifest. A word source is derived from its copy
  table, and it fails on identical texts. `noWords`, `noFrame`, `frameOnly` and `appOnly` are used as described per
  part.

## Part B3-0 (eb): the P1 words and the switch

**Start:** after ruling 1. It is a prep PR, so that no two tracks write the locale files.

- **The switch** (only with ruling 1's separate switch): `connected-agents/agentRoomsFlag.ts` mirrors
  `agentConnectFlag.ts`, with `isAgentRoomsEnabled()` and `setAgentRoomsEnabled(on)`, default false.
  `isAgentRoomsEnabled()` returns false whenever `isAgentConnectEnabled()` is false.
- **The words.** These are the en strings, settled: each is quoted in §6, so the copy test's `settled()` finds it.
  There are fr and pt-br strings for each, all PROPOSED (ruling 5).
- **Strings reused, not added:**
  - `Rooms.AgentBadge` ("AI agent");
  - `Rooms.FileAttach` ("Attach a file");
  - `Rooms.CopyId` (the copy action's label);
  - `Rooms.Members` (the people heading under Agents, frame 38);
  - `Global.Done`, `Global.NotNow`;
  - `ConnectedAgents.BelongsTo`, `Memories`, `NoMemory`, `VtaKeepsItToThese`, `WidenBody` and `YourAgent`.

| Key | en (settled) | fr (PROPOSED) | pt-br (PROPOSED) |
|---|---|---|---|
| `AgentsInThisRoom` | Agents in this room | Agents dans ce salon | Agentes nesta sala |
| `AddAnAgent` | Add an agent | Ajouter un agent | Adicionar um agente |
| `AgentsReadEverything` | Agents added here can read everything in this room, not only messages that mention them. | Les agents ajoutés ici peuvent lire tout ce salon, pas seulement les messages qui les mentionnent. | Os agentes adicionados aqui podem ler tudo nesta sala, não só as mensagens que os mencionam. |
| `AgentMemory` | Memory: {{names}} | Mémoire : {{names}} | Memória: {{names}} |
| `AgentNoMemory` | No memory | Aucune mémoire | Nenhuma memória |
| `WhatItRemembers` | What {{name}} remembers | Ce dont {{name}} se souvient | Do que {{name}} se lembra |
| `WhatItRemembersBody` | {{name}} can use only these memories, in every room it is in: {{names}}. Your VTA keeps it to them. | {{name}} ne peut utiliser que ces mémoires, dans chaque salon où il se trouve : {{names}}. Votre VTA le limite à celles-ci. | {{name}} só pode usar estas memórias, em todas as salas em que está: {{names}}. Seu VTA o limita a elas. |
| `WhatItRemembersNone` | {{name}} has no memory. | {{name}} n'a aucune mémoire. | {{name}} não tem nenhuma memória. |
| `ConnectAnotherAgent` | Connect another agent | Connecter un autre agent | Conectar outro agente |
| `MemoryIsText` | Memory is stored as text on your VTA. It is not a place for secrets. | La mémoire est stockée sous forme de texte sur votre VTA. Ce n'est pas un endroit pour les secrets. | A memória é guardada como texto no seu VTA. Não é um lugar para segredos. |
| `AddToRoomTitle` | Add "{{name}}" to this room? | Ajouter « {{name}} » à ce salon ? | Adicionar "{{name}}" a esta sala? |
| `AddToRoomBody` | Adding an agent gives it read access to this room. It is asked to act only when you mention it, but nothing in the room enforces that. | Ajouter un agent lui donne l'accès en lecture à ce salon. On lui demande d'agir seulement quand vous le mentionnez, mais rien dans le salon ne l'impose. | Adicionar um agente dá a ele acesso de leitura a esta sala. Pede-se que ele aja só quando você o mencionar, mas nada na sala garante isso. |
| `MembersWillSee` | Members of this room will see that this agent belongs to you. | Les membres de ce salon verront que cet agent vous appartient. | Os membros desta sala verão que este agente pertence a você. |
| `AddRoomMemoryNotice` | It can also read and change your memory "{{context}}", as can any other agent you add to a room. | Il peut aussi lire et modifier votre mémoire « {{context}} », comme tout autre agent que vous ajoutez à un salon. | Ele também pode ler e alterar sua memória "{{context}}", assim como qualquer outro agente que você adicionar a uma sala. |
| `AddToRoom` | Add to room | Ajouter au salon | Adicionar à sala |
| `CommunityNo` | The owner of this room doesn't allow agents. | Le propriétaire de ce salon n'autorise pas les agents. | O dono desta sala não permite agentes. |
| `CommunityNotStated` | This room's owner hasn't said that agents are allowed. | Le propriétaire de ce salon n'a pas indiqué que les agents sont autorisés. | O dono desta sala não disse que agentes são permitidos. |
| `AddAFile` | Add a file | Ajouter un fichier | Adicionar um arquivo |
| `AddMyAgent` | Add my agent | Ajouter mon agent | Adicionar meu agente |
| `ComposerAdd` | Add | Ajouter | Adicionar |
| `MentionAs` | Mention it as @{{handle}}. | Mentionnez-le avec @{{handle}}. | Mencione-o como @{{handle}}. |
| `AnswersOthers` | Answers other people | Répond aux autres personnes | Responde a outras pessoas |
| `AnswersOff` | Off | Désactivé | Desligado |
| `AnswersOn` | On | Activé | Ligado |
| `AnswersOthersOffLine` | Answers other people: Off | Répond aux autres personnes : désactivé | Responde a outras pessoas: desligado |
| `AnswersOthersOnLine` | Answers other people: On | Répond aux autres personnes : activé | Responde a outras pessoas: ligado |
| `AnswersOffHelp` | Anyone but you who mentions {{name}} gets a fixed reply that it can't respond to others. | Toute personne autre que vous qui mentionne {{name}} reçoit une réponse fixe indiquant qu'il ne peut pas répondre aux autres. | Qualquer pessoa além de você que mencionar {{name}} recebe uma resposta fixa dizendo que ele não pode responder a outros. |
| `AnswersOnHelp` | {{name}} also acts on mentions from other people in rooms you added it to. | {{name}} agit aussi sur les mentions d'autres personnes dans les salons où vous l'avez ajouté. | {{name}} também age quando outras pessoas o mencionam nas salas em que você o adicionou. |
| `WhatOthersSee` | What others see | Ce que voient les autres | O que os outros veem |
| `CanUseInEveryRoom` | Can use memory {{names}} in every room it is in. | Peut utiliser la mémoire {{names}} dans chaque salon où il se trouve. | Pode usar a memória {{names}} em todas as salas em que está. |
| `CanReadAllOf` | Can read all of {{room}}, not only messages that mention it. | Peut lire tout le salon {{room}}, pas seulement les messages qui le mentionnent. | Pode ler toda a sala {{room}}, não só as mensagens que o mencionam. |
| `WidenBodyRooms` | This also applies in {{rooms}}. It will be able to read and change it. | Cela s'applique aussi dans {{rooms}}. Il pourra la lire et la modifier. | Isso também vale em {{rooms}}. Ele poderá lê-la e alterá-la. |
| `AnswersOnTitle` | Let "{{name}}" answer other people? | Laisser « {{name}} » répondre aux autres personnes ? | Deixar "{{name}}" responder a outras pessoas? |
| `AnswersOnBody` | Anyone in a room can then ask it to do things by mentioning it. It could be tricked into using your memory or posting for you, and your phone cannot prevent that. | N'importe qui dans un salon pourra alors lui demander de faire des choses en le mentionnant. Il pourrait être manipulé pour utiliser votre mémoire ou publier à votre place, et votre téléphone ne peut pas l'empêcher. | Qualquer pessoa em uma sala poderá então pedir que ele faça coisas, mencionando-o. Ele pode ser enganado para usar sua memória ou publicar por você, e seu celular não pode impedir isso. |
| `TurnOn` | Turn on | Activer | Ligar |
| `KeepItOff` | Keep it off | Laisser désactivé | Manter desligado |
| `AgentsSection` | Agents | Agents | Agentes |
| `AgentsSectionCaption` | Agents Keyring connected for you. Other people's agents are not listed here. | Les agents que Keyring a connectés pour vous. Les agents des autres personnes ne sont pas listés ici. | Agentes que o Keyring conectou para você. Os agentes de outras pessoas não aparecem aqui. |
| `AgentsSectionCaptionOthers` | Agents Keyring connected for you, and the agents that showed whose they are. | Les agents que Keyring a connectés pour vous, et les agents qui ont montré à qui ils appartiennent. | Agentes que o Keyring conectou para você e os agentes que mostraram a quem pertencem. |
| `VerifiedFromDelegation` | Verified from its delegation credential | Vérifié à partir de son attestation de délégation | Verificado pela sua credencial de delegação |
| `NotMemberPostsWith` | Not a member of this community. Posts here with permission from {{owner}}. | N'est pas membre de cette communauté. Publie ici avec la permission de {{owner}}. | Não é membro desta comunidade. Publica aqui com permissão de {{owner}}. |
| `ItsIdentity` | Its identity: {{did}} | Son identité : {{did}} | Sua identidade: {{did}} |
| `VerifiedName` | Verified name: {{name}} | Nom vérifié : {{name}} | Nome verificado: {{name}} |
| `NoVerifiedName` | No verified name | Aucun nom vérifié | Nenhum nome verificado |
| `CallsItself` | calls itself {{name}} | se fait appeler {{name}} | chama a si mesmo de {{name}} |
| `OwnerUnknown` | Keyring can't tell who this belongs to. | Keyring ne peut pas savoir à qui il appartient. | O Keyring não consegue saber a quem ele pertence. |

- **Settled elsewhere** (`SETTLED_ELSEWHERE`):
  - `NotAgentKind` → `'§3.10'`: "This agent isn't registered as an agent on your VTA. Reconnect it." The fr is "Cet
    agent n'est pas enregistré comme agent sur votre VTA. Reconnectez-le." and the pt-br is "Este agente não está
    registrado como agente no seu VTA. Conecte-o de novo." Both are PROPOSED.
  - `OthersReply` → `'§3.13'`: the plan's three texts exactly (PLAN:752-756). The shared vector file with the plugin
    (PLAN:759) is fb's, beside c5's RM4 copy.
- **PROPOSED in en too** (`PROPOSED_COPY`, each with a reason naming its ruling):
  - `AddRoomRefused` (ruling 2): "Your VTA refused this. "{{name}}" wasn't added." / "Votre VTA a refusé. « {{name}} »
    n'a pas été ajouté." / "Seu VTA recusou. "{{name}}" não foi adicionado."
  - `AddRoomUnreachable` (ruling 2): "Couldn't reach your VTA. "{{name}}" wasn't added." / "Impossible de joindre
    votre VTA. « {{name}} » n'a pas été ajouté." / "Não foi possível falar com seu VTA. "{{name}}" não foi
    adicionado."
  - `AnswersOthersNotSaved` (ruling 2): "This setting wasn't changed." / "Ce réglage n'a pas été modifié." / "Esta
    configuração não foi alterada."
  - `AnswersOthersPending` (ruling 3): "{{name}} gets this change when it's next connected." / "{{name}} recevra ce
    changement à sa prochaine connexion." / "{{name}} recebe esta mudança na próxima vez que estiver conectado."
- **Decided here:**
  - `ItsIdentity` carries `{{did}}`, because §6 quotes "Its identity: <did>" (PLAN:1044). The key list's "Its
    identity" (PLAN:1059) is the label without the value, so the copy test's `settled()` is the judge.
  - The fr quotes are « » with a non-breaking space inside, as the fr file already uses.
  - Before adding a key, check whether a `ConnectedAgents` key with exactly that en text exists. If one does, reuse
    it and say so in the PR.
- **Tests:** the copy test and the placeholder test pass. Each new key is in all three files, with the same
  placeholders. The no-retry pattern test passes in all three languages.
- `// control:` drop one fr key, and the three-language test names it.

## Part T1: room info's "Agents in this room" and the add flow (7.13; frames 34 to 37)

**Start after:** B3-0, R1 (#1122; "Connect another agent" opens its ConnectAgent route), and fb's `useRoomAgents` and
`useAddAgentToRoom` merge.

**`AgentRoomSection`** (frame 37) has these props:

```
{
  agents: { agentId, name, memoryNames }[],
  canAdd: boolean,
  setting: 'yes' | 'no' | 'notStated',
  onOpenAgent(agentId),
  onAdd(),
}
```

- **The heading** is `AgentsInThisRoom`, as a section heading like the parts card's.
- **Each row** is the robot avatar, the name, `Rooms.AgentBadge`, then `AgentMemory` with the names joined by ", ", or
  `AgentNoMemory`. The row has a chevron and opens `WhatItRemembersSheet` on that agent.
- **The row "+ Add an agent"** (`AddAnAgent`) is present only when `canAdd`, meaning `addable` is not empty.
  - With `setting` `'no'` or `'notStated'`, the row is disabled, with `CommunityNo` or `CommunityNotStated` under it
    (PLAN:644). There is no "Add anyway".
- **The note** under the card is `AgentsReadEverything`, with the eye icon.
- **Decided here, on when the section shows:** it is absent when `offered` is false, and when there are no agents in
  the room and none addable. A person with no agent sees today's RoomInfo.
- testIDs: `AgentRoomSection`, `AgentRoomRow`, `AgentRoomAdd`, `AgentRoomSetting`, `AgentRoomNote`.

**`AgentPickerSheet`** (frame 34) has the props `{ agents: { agentId, name }[], onPick(agentId), onClose }`.
- One row per agent: the avatar, the name and `Rooms.AgentBadge`, with a chevron.
- **Decided here:** it has no heading. The plan gives the picker no words (frame 34's canvas note), so the sheet's
  accessibility label is `AddMyAgent`. No new string is needed, and no ruling.
- It is skipped when exactly one agent is addable (PLAN:592).

**`AgentRoomSheet`** (frame 35) has these props:

```
{
  name,
  widensContext?: string,
  outcome?: AddRoomOutcome,
  onAdd(): void,
  onClose(): void,
}
```

- **The words, in this order:** `AddToRoomTitle`; `AddToRoomBody` (the eye notice); `AddRoomMemoryNotice` with
  `{{context}}`, only when `widensContext` is given (the layers notice); `MembersWillSee`, with the people icon.
- **The buttons:** "Add to room" (`AddToRoom`) and "Not now" (`Global.NotNow`).
- **Focus** (PLAN:1361, "before the button is focusable"):
  - the notices come before the buttons in accessibility order;
  - no button takes initial focus;
  - the sheet's initial accessibility focus is the title.
- **After `onAdd` resolves** with anything but `'added'`, the outcome's line replaces the buttons, with one "Done"
  (a refusal spends the action):

  | outcome | line |
  |---|---|
  | `notAgentKind` | `NotAgentKind` |
  | `refused` | `AddRoomRefused` |
  | `unreachable` | `AddRoomUnreachable` |
  | `accessChanged` | `MemoryAccessChanged` (existing), plus "See details" (`SeeDetails`, existing) to AgentDetails, where "Restore" is. This is a repair; name the caller. |
  | `settingNo` | `CommunityNo` |
  | `settingNotStated` | `CommunityNotStated` |

- "Add to room" is disabled while the call runs, so there is never a double add.
- testIDs: `AgentRoomSheet`, `AgentRoomSheetAdd`, `AgentRoomSheetNotNow`, `AgentRoomSheetOutcome`,
  `AgentRoomSheetDone`.

**`WhatItRemembersSheet`** (frame 36; in `connected-agents/screens/`, since the agent's details may use it later) has
the props `{ name, memoryNames: string[], onDone, onConnectAnother }`.
- **With memories:** `WhatItRemembers`, then `WhatItRemembersBody` with the names joined by ", ", then one row per
  memory.
- **With none:** `WhatItRemembers`, then `WhatItRemembersNone`.
- Then the note `MemoryIsText`, and the buttons "Done" (`Global.Done`) and `ConnectAnotherAgent`.
- **Decided here:** the memory rows are **not tappable** in this backlog. Frame 36 draws chevrons, but "What a memory
  holds" (PLAN:1017) is P1 (credentials), not 7.13. The manifest entry marks the chevrons `frameOnly`.
- **Decided here:** it opens from the add flow and from a row of `AgentRoomSection`, not from the agent's details in
  this backlog. The details' memory group already shows the same set.
- testIDs: `WhatItRemembers`, `WhatItRemembersRow`, `WhatItRemembersDone`, `WhatItRemembersConnectAnother`.

**`AddAgentFlow`** is the one add flow (D28), a container: hooks in, views out. It takes the props `{ roomId, start:
boolean, onEnd() }`.
- **The steps:**
  1. the picker, when more than one agent is addable;
  2. `AgentRoomSheet`;
  3. on `'added'`, `WhatItRemembersSheet` on that agent (PLAN:596).
- `onConnectAnother` navigates to R1's ConnectAgent through the My Agent stack.
- T2 mounts the same component from the composer.

**`RoomInfo.tsx`:** under the parts card, draw `AgentRoomSection` only when `isAgentRoomsEnabled()`. "Add an agent"
mounts `AddAgentFlow`. Nothing else in the file changes.

**Catalogue:** `screenStatesRooms.tsx` and `agent-connect-screens.rooms.json`.

| State | Frame | Notes |
|---|---|---|
| `room-agents` | 37 | |
| `agent-picker` | 34 | the stand-in heading is `frameOnly` |
| `add-to-room` | 35 | with `widensContext` |
| `add-to-room-no-widen` | none | `noFrame` |
| `add-to-room-not-agent-kind` | none | `noFrame` |
| `add-to-room-refused` | none | `noFrame` |
| `what-it-remembers` | 36 | |
| `what-it-remembers-none` | none | `noFrame` |
| `room-agents-setting-not-stated` | none | `noFrame` |

**Tests** (`rooms/__tests__/addAgentToRoom.test.tsx`), with the hooks mocked:
- With the switches off, RoomInfo renders as on the tip, compared with a render of the tip's tree. `// control:`
  draw the section unconditionally, and this fails.
- Each `setting` value: only `'yes'` enables "Add an agent", from this screen (PLAN:1361).
- One addable agent skips the picker; two show it; an `expired` agent is never offered (fb filters it; the view
  draws only what it's given).
- The add sheet shows the memory notice only with `widensContext`. The accessibility order is title, notices, then
  buttons.
- Each `AddRoomOutcome` shows its own line, and after it there is no "Add to room" (`queryByTestId` is null) and no
  "Try again".
- `'added'` shows `WhatItRemembersSheet` with the agent's names.
- A double press calls `add` once.

## Part T2: the composer's "+" and the mention insert (7.13 and 7.14; frames 31 to 33)

**Start after:** T1 (it mounts `AddAgentFlow`), and fb's `useRoomMentionables` merges.

**`ComposerMoreSheet`** (frames 32 and 33) has these props:

```
{
  showAddAgent: boolean,
  setting: 'yes' | 'no' | 'notStated',
  onAddFile(),
  onAddAgent(),
  onClose(),
}
```

- **The rows:** "Add a file" (`AddAFile`), then "Add my agent" (`AddMyAgent`).
- **"Add my agent"** is present only when `showAddAgent` is true, meaning `addable` is not empty. It is absent when
  every agent is already in the room (PLAN:1361).
- With `setting` `'no'` or `'notStated'`, it is disabled, with `CommunityNo` or `CommunityNotStated` under it.
- testIDs: `ComposerMoreSheet`, `ComposerMoreAddFile`, `ComposerMoreAddAgent`, `ComposerMoreSetting`.

**`RoomComposer.tsx`** gets two new optional props, `moreSheet?: { showAddAgent, setting }` and `mentionables?: {
name, handle }[]`.
- **The "+":**
  - with `moreSheet` absent (the switches off, or the owner has no `active` agent), it picks a file at once, labelled
    `Rooms.FileAttach`, exactly as today;
  - with `moreSheet` present, it opens `ComposerMoreSheet`, labelled `ComposerAdd`;
  - "Add a file" runs today's `pickRoomFile` path, unchanged.
- **The mention:** with `mentionables` given, an "@" typed at the start of a word shows `MentionSuggestions` above the
  field.
  - `MentionSuggestions` has the props `{ items: { name, handle }[], query, onPick(handle) }`.
  - Each row is the name with `Rooms.AgentBadge` and `@handle`.
  - The rows are filtered by the typed text, against the name and the handle.
  - Picking a row replaces the "@query" with `@<handle> `, the whole handle and a space, never the bare name
    (PLAN:1371).
  - **Decided here:** the plan gives no insert gesture. This one needs no words, and frame 31's drawn body shows the
    result. A typed handle is plain text, as today.
- **The draft:** `onTextChange` and the draft keep working; the inserted text is part of the draft.

**`Room.tsx`:** pass `moreSheet` and `mentionables` from fb's hooks only when `isAgentRoomsEnabled()`. Mount
`AddAgentFlow` for "Add my agent".

**Catalogue:** `screenStatesComposer.tsx` and `agent-connect-screens.composer.json`.

| State | Frame | Notes |
|---|---|---|
| `composer-plus` | 32 | |
| `composer-plus-refused` | 33 | `notStated` |
| `composer-mention` | 31 | `noWords`: frame 31 is the room with the inserted handle and the agent's post. Its words are the handle and the existing mark |
| `composer-mention-suggestions` | none | `noFrame` |

**Tests** (`rooms/__tests__/composerAgents.test.tsx`):
- **The control:** with the switches off, or with no active agent, "+" calls `pickRoomFile` at once and its label is
  "Attach a file". `// control:` always open the sheet, and this fails.
- With an active agent, "+" opens the sheet and is labelled "Add". "Add a file" still picks a file.
- "Add my agent" is absent when `showAddAgent` is false, and disabled with the line for `no` and for `notStated`.
- The mention:
  - "@no" and a pick give `@notes-helper-7f3k ` in the field;
  - the bare name is never inserted;
  - a second "@" in the same text works;
  - the body sent is the field's text unchanged, so fb sees exactly the handle.
- A thread composer has no "+".

## Part T3: "Answers other people", and the P1 lines in the details and the list (7.14; frames 12 to 16)

**Start after:** B3-0 and R1 merge, and fb's `useAnswersOthers` and the `rooms` and `actNames` fields merge. It doesn't
depend on T1 or T2.

**`AnswersOthersRow`** (frame 14's card; used by the details here and by T4's agent sheet) has these props:

```
{
  name,
  value: boolean,
  offered: boolean,
  pending: boolean,
  notSaved: boolean,
  onTurnOn(),
  onTurnOff(),
}
```

- **The card:**
  - the title `AnswersOthers`;
  - the value `AnswersOff` or `AnswersOn`, with a switch;
  - under it, `AnswersOffHelp` or `AnswersOnHelp`;
  - `AnswersOthersPending` when `pending` (ruling 3);
  - `AnswersOthersNotSaved` when `notSaved`.
- **Then** `WhatOthersSee`, as a heading, with `OthersReply` in the dashed box.
- **When `offered` is false:** the value reads "Off" and **there is no switch** (D23; PLAN:774, "would read 'Off' with
  no way to turn it on").
  - This is a repair: name the caller, fb's hook-check value.
  - The help line and "What others see" still show.
- **Turning it on** opens `AnswersOthersConfirmSheet`. **Turning it off** calls `onTurnOff` at once, with no
  confirmation (PLAN:1041).
- testIDs: `AnswersOthers`, `AnswersOthersSwitch`, `AnswersOthersValue`, `AnswersOthersHelp`, `AnswersOthersPending`,
  `AnswersOthersNotSaved`, `WhatOthersSee`.

**`AnswersOthersConfirmSheet`** (frame 15) has the props `{ name, onTurnOn, onKeepOff }`.
- The words are `AnswersOnTitle` and `AnswersOnBody`, with the buttons `TurnOn` and `KeepItOff`.
- "Turn on" is disabled while `set(true)` runs.
- testIDs: `AnswersOnConfirm`, `AnswersOnTurnOn`, `AnswersOnKeepOff`.

**`AgentDetailsView`** (frame 16, its P1 lines), with new optional props:

```
{
  handle?: string,
  rooms?: { name }[],
  actNames?: string[],
  answersOthers?: AnswersOthersRow props,
}
```

- **"Mention it as":** `MentionAs` under the owner line, when `handle` is given.
- **"Answers other people":** `AnswersOthersRow`, when `answersOthers` is given.
- **With `rooms` not empty:**
  - `CanUseInEveryRoom` with `actNames`, in place of the no-room "Can use memory …" line;
  - one `CanReadAllOf` per room, in the rooms' order (PLAN:1039 puts one line for the memories and one per room's
    read).
- **With `rooms` empty or absent:** the P0 no-room form, unchanged. **Decided here:** "in every room it is in" is
  never drawn for an agent in no room. The no-room form is true, and the room form would claim rooms that don't
  exist.

**`AgentListView`** (frames 12 and 13): each row of a base-path agent gets `AnswersOthersOffLine` or
`AnswersOthersOnLine` under its status, when the row's `answersOthers` is given. The HCP list is not touched.

**`ChangeMemoriesView`:** the widening body is `WidenBodyRooms` with the rooms joined by ", " when the agent has rooms,
or else `WidenBody`, as today (`NO_ROOM_FORMS` keeps `WidenBody`).

**The containers** (R1's `AgentDetailsScreen` and `AiAgentsScreen`; new props only):
- pass `handle`, `rooms`, `actNames` and `answersOthers` from fb's hooks, only when `isAgentRoomsEnabled()`;
- `onTurnOn` opens the confirm sheet, whose "Turn on" calls `set(true)`;
- `onTurnOff` calls `set(false)`;
- `'notSaved'` sets `notSaved` until the next change.

**Catalogue:** `screenStatesAnswers.tsx` and `agent-connect-screens.answers.json`.

| State | Frame | Notes |
|---|---|---|
| `answers-off` | 14 | the sheet's card |
| `answers-on-confirm` | 15 | |
| `agent-details-rooms` | 16 | the P1 lines |
| `agent-list-answers` | 12 | |
| `answers-not-offered` | none | `noFrame` |
| `answers-pending` | none | `noFrame` |

`OthersReply`'s word source is the §3.13 table.

**Tests** (`connected-agents/__tests__/answersOthers.test.tsx`):
- Turning on shows the confirmation, and only its "Turn on" calls `set(true)`. "Keep it off" calls nothing.
- Turning off calls `set(false)` with no sheet.
- `offered: false` draws "Off", with no switch, and still the help and "What others see".
- `pending` and `notSaved` show their lines. After `'notSaved'`, the switch is at its old value.
- `OthersReply` in en, fr and pt-br equals §3.13's table cell for that language. fb's shared vector test is the other
  half.
- The details with rooms show `CanUseInEveryRoom` and one `CanReadAllOf` per room; with none, the no-room line and no
  "every room".
- The list shows the Off and On lines.
- The widen body has its rooms form only with rooms.
- `// control:` with the switches off, the details and the list render as on the tip (no `MentionAs`, no row, no list
  line).

## Part T4: the Agents section, the agent sheet and the identity sheet (7.14; frames 14, 38 to 40)

**Start after:** T3 (it uses `AnswersOthersRow`), and fb's `useMemberListAgents`, `useAgentIdentity` and
`delegationRecord.ts` merge.

**`AgentsSection`** (frame 38) has the props `{ own: AgentRow[], others: AgentRow[], onOpen(did) }`.
- **The heading** is `AgentsSection`.
- **Each row** is the avatar, the name, `Rooms.AgentBadge`, then `BelongsTo` with the owner, then `@handle`, with a
  chevron. Own agents come first, then the others, each group sorted by name.
- **The caption** is `AgentsSectionCaption`, or `AgentsSectionCaptionOthers` when `others` isn't empty (PLAN:1043).
- testIDs: `AgentsSection`, `AgentsSectionRow`, `AgentsSectionCaption`.

**`RoomMembersTab.tsx`:** when `isAgentRoomsEnabled()` and `own` or `others` isn't empty, draw `AgentsSection` above
the people. The people then get the heading `Rooms.Members` (frame 38).
- **Decided here:** the section also shows when `listCommunityMembers` is unavailable or failed (PLAN:1371, "appears
  when `listCommunityMembers` is unavailable"). It never depends on the people's listing.
- A row opens the identity sheet through the existing `onOpenIdentity`.
- `RoomPart.tsx` passes the hook's values in (PLAN:628).

**`AgentIdentityBody`** (`connected-agents/screens/`; frames 14, 39 and 40) is prop-driven, for the catalogue. Its prop
is `{ identity: 'own' | 'verified' | 'unverified' variant of useAgentIdentity }`, plus `answersOthers?` for `own`.

| Variant | What it draws |
|---|---|
| **own** (frame 14) | the avatar, the name and `Rooms.AgentBadge`, `BelongsTo` with the owner from the VDC (fb's), `MentionAs`, then `AnswersOthersRow` |
| **verified** (frame 39) | the heading is the name, or the shortened DID when there's none; `Rooms.AgentBadge`; `BelongsTo`; a ✓ and `VerifiedFromDelegation`; the notice `NotMemberPostsWith`; `MentionAs` when there's a handle; `ItsIdentity` with the shortened DID and a copy button (label `Rooms.CopyId`); `VerifiedName` or `NoVerifiedName` |
| **unverified** (frame 40) | the heading is the shortened DID (a claimed name is never the heading); `CallsItself` under it when there's a name; `OwnerUnknown`; `ItsIdentity` with copy; **no mark** (PLAN:861) |

testIDs: `AgentIdentity`, `AgentIdentityOwner`, `AgentIdentityVerified`, `AgentIdentityUnknown`, `AgentIdentityDid`,
`AgentIdentityCopy`, `AgentIdentityVerifiedName`.

**`RoomIdentitySheet.tsx`:**
- When `isAgentRoomsEnabled()`, it calls `useAgentIdentity(roomId, identity.did)`.
- For anything but `'none'`, it draws `AgentIdentityBody` in place of the person body. For `'none'`, it is
  byte-identical to today.
- **Decided here:** the hook is called inside the sheet, not by its three callers (RoomInfo, RoomPart, Room), so no
  caller file changes and no other track's file is touched.
- **Decided here (a repair; name the caller):** an `'own'` result for an agent whose connection is revoked draws as
  `'unverified'`, never as own. fb's hook should not return it. The branch says so and has a test.

**Catalogue:** `screenStatesMembers.tsx` and `agent-connect-screens.members.json`.

| State | Frame | Notes |
|---|---|---|
| `room-members-agents` | 38 | |
| `agent-sheet-own` | 14 | |
| `other-agent-verified` | 39 | |
| `other-agent-unknown` | 40 | |
| `room-members-agents-own-only` | none | `noFrame`, the first caption |

**Tests** (`rooms/__tests__/agentsSection.test.tsx`):
- **The control:** with the switches off, the members tab and the identity sheet render as on the tip. `// control:`
  always call the hook, and this fails.
- The section with own agents only gets the first caption; with a verified other agent it gets the second.
- A `'none'` identity draws the person sheet.
- The section draws when the people listing failed.
- A row opens the sheet:
  - the own variant shows the owner and the setting;
  - verified shows the mark, the ✓ line and "Not a member";
  - unverified shows no mark and `OwnerUnknown`, and its heading is the DID even with a name.
- A `did:key` shows `NoVerifiedName`, and a verified webvh name shows `VerifiedName`.
- The revoked-own repair draws as unverified.
- No agent is ever passed to `listCommunityMembers`' rows.

## Part T5: the mention line in the agent chat (HELD on ruling 4)

**Start after:** ruling 4, R3 and RM4 merge.
- **If the ruling is a structured message:** fb parses it and eb's T5 draws the line in `AgentChatView`, with the
  keys the ruling settles. That means `MentionedYouIn` and a plural count form, and, if Brendan keeps it, the
  "Sent the fixed reply" line, in three languages.
- **If it is plugin text:** T5 is empty, because the line is an agent bubble.

Either way, the owner's report is never drawn as a message from the member.

## Part B3-Z: the developer switch row (last; only with ruling 1's separate switch)

**Start after:** R4 and T1 to T4 merge.
- A second row under R4's agent connect row, in R4's pattern: the store, `DeveloperDispatchAction` and the start-up
  apply in `app/container-imp.ts`.
- The words are `Developer.EnableAgentRooms`, "Agents in rooms (P1)". This is a developer string, outside the
  `ConnectedAgents` copy test, like `Developer.EnableAgentConnect`.
- The row is disabled while agent connect is off. The default is false.
- **Tests** (`app/src/screens/__tests__/developerAgentRooms.test.tsx`):
  - the row is off by default;
  - turning it on calls `setAgentRoomsEnabled(true)` on the next launch;
  - with agent connect off, it is disabled;
  - `// control:` the default true fails the first case.
- `releaseGate.test.ts` passes unchanged. The new switch is never on unless agent connect is.

## Order

1. B3-0, once ruling 1 is given.
2. T1 and T3 in parallel, each after its fb hooks.
3. Then T2, after T1, and T4, after T3, in parallel.
4. T5 when ruling 4 is given.
5. B3-Z last.

The reachability list is the one file touched in parallel. The second part to land keeps both sides' lines.

## Done means

- Every frame 12 to 16 and 31 to 40 that is a P1 screen is in a manifest, or marked `frameOnly` where a canvas note or
  stand-in isn't phone copy.
- Every new `ConnectedAgents` key is in the three files, and is settled in §6, `SETTLED_ELSEWHERE` or
  `PROPOSED_COPY`.
- With either switch off, the app is as on the tip, by each part's control.
- No refusal offers a retry, and no repair branch is unnamed.
- Rulings 1 to 4 are answered or still listed here. Any PROPOSED en string is reported to the plan owner in the PR.

---

# Section C: the plugin

# Backlog 3: the plugin's part of P1, step 7.15 (c5, 2026-11-27)

Rooms, mentions and "Answers other people", as parts **RM1-RM6** ("plugin rooms"; not R1-R5, which backlog 2 uses for the screens, and not PR-n, which names c5's own plugin pull requests) into `integration/agent-connect` on the fork (`github.com/albertoleon7794/vta-agent-memory`). This is a brief, with no code.

Every reference is to keyring-wallet `feat/agent-connect` at **`be8436117`**: `docs/plans/agent-connect-plan.md`, cited as PLAN:line. The plugin's own files are cited at the fork's `integration/agent-connect` head (`4057a5a` today) as VAM `path`.

## Rulings only Alberto or Brendan can give (2 and 4 decided 11-28; 1, 3, 5 and 6 open)

Each part below names the ruling it waits on, if any. Parts with none can start once their "start after" holds.

1. **How the agent learns `chatDid`, Keyring's mediator and `ownerPersonaDid` (plan §11 Q7(a), PLAN:1628). This is Brendan's.**
   - Every part here needs `ownerPersonaDid`, the one author whose mentions the agent acts on; RM3 matches it on every room record.
   - The room offer arrives over the chat (§3.6 step 5, PLAN:598), so nothing here works until Q7(a) is settled.
   - The facts, sent to the coordinator on 11-27:
     - at redeem the plugin holds only `{ vtaDid, aclEntry, mustSwapBy }`, and `aclEntry.created_by` is the administrator DID, not the persona;
     - on the fallback path it holds only the pinned VTA and its own key;
     - so the VDC, a chat control message, cannot be the carrier.
   - The options are: contacts in `redeem` (the deferred follow-up, PLAN:485); an `ext` member the VTA writes into the entry; or a first document signed by the key `aclEntry.created_by` names.
2. **DECIDED (Alberto, coordinator's session, 11-28): the French and Portuguese readers.**
   - Alberto arranges the native readers himself.
   - Every fr and pt-br string, the fixed reply's included, stays **PROPOSED**, and the release gate stays **closed** until they have read them.
   - **Where the gate lives, proposed by c5:** beside Keyring's existing locale checks, which the plugin can reach by copy.
     - Keyring's copy tables give every string a `source` (`PROPOSED`, `plan §6`, a companion finding), and their tests hold it. Examples: `packages/core/src/modules/connected-agents/hcp/answersOn/copy.ts`, and `hcp/__tests__/copy.test.ts` at `be8436117`.
     - The fixed reply's three texts and their `source` go in that same form, in the shared fixed-reply vector Keyring's `ConnectedAgents.OthersReply` is held to (PLAN:759). Keyring's own release gate (`connected-agents/__tests__/releaseGate.test.ts`) then fails while fr or pt-br is `PROPOSED`.
     - The plugin carries the vector byte-identically in `tests/fixtures/agent-connect/`, and RM4's `tests/release_gate.rs` fails while its copy says `PROPOSED` for either. So one record, Keyring's, closes both gates, and the plugin needs no checklist of its own.
     - If the plugin's release cannot read that copy, `RELEASE_CHECKLIST.md` on the fork is the fallback.
3. **"Answers other people" On, with the hook as the only control (§3.13 items 1-3, PLAN:771-774; D23, D46). Brendan's, as plan owner.**
   - The plan says D23's condition is met by step 0.3(f)'s measurement, so the switch is offered in P1. The owner's approval through the VTA's consent flow (item 3) stays unrelied on until VTI-Q35 runs.
   - RM5 builds exactly that.
   - Asked of Brendan: confirm RM5 may ship the switch with the hook alone, and with `bypassPermissions` and subagent calls unmeasured (§2.3 item 13). The alternative is to hold RM5 behind a build flag until consent is measured.
4. **DECIDED (Alberto, coordinator's session, 11-28): the `mentions` and `delegation` registrations.**
   - They are asked upstream **through Brendan**, who raises them with the editors (§10 items 4 and 17; ledger AC-25, VTI-Q38). Nothing here files them.
   - RM3 and RM6 **build on the fallback** until they are registered:
     - the `@<handle>` match;
     - a plain name record, since no profile lists `delegation`;
     - each written only where a room's profile lists the member, so registration needs no code change.
5. **Where the channel and `reply` live (plan §11 Q6(c), PLAN:1627), already open for track 4's P5.** RM5's hook gates the server that P5 chose. If P5 moved `reply` into a second server, RM5's allow-list names that server's tool.

6. **OPEN, for Brendan: how the owner hears about a mention.** This is the same question as eb's backlog 3 ruling 4 (T5), worded the same in both parts. Plan §6 lists "<member> mentioned you in <room>." as Keyring copy (PLAN:1048), "with a count when there are several in an hour", but gives no count wording. Plugin text would reach the owner in the plugin's words, not in the app's language. The two options:
   - **(a)** A structured message, `keyring/agent/mention-report/1.0 { version, member, room, count, replied }`, which Keyring draws in the owner's language with a plural count key. RM4 sends this instead of text, and its "Sent the fixed reply" versus not-sent distinction becomes `replied`.
   - **(b)** Plugin text, RM4 as written. eb's T5 is then empty, because the line is an ordinary agent bubble.
   - **Recommendations:** eb recommends (a), and **c5 also recommends (a).** It keeps every word the owner reads in Keyring's localization files and the native-review gate of ruling 2, and the plugin stays language-free apart from the fixed reply to the other person, which the plan places in the plugin.
   - **Consequence of (a):** the new type is a control message in finding 4's signed envelope, so `scripts/agent-connect/control_message_vectors.py` and its vectors gain it (a keyring-wallet change, outside this brief).
   - **Waiting on this ruling:** RM4's owner report and eb's T5.

## Where the work goes, and the common rules

As in backlog 2's Section C, unchanged:
- one branch `agent-connect/<part>` per part, and one pull request into **`integration/agent-connect`** on the fork;
- reviewed by ac;
- squash on ac's clearance at the head sha with every check green, with the merged tree predicted and then verified;
- nothing to OpenVTC;
- merge, never rebase;
- an intent record before an irreversible call;
- no generic failure line where a case contradicts it;
- formal reviews only;
- one sign-off per squash, and no agent trailers.

The checks are the same: `cargo fmt --all -- --check`, `cargo clippy --all-features --all-targets -- -D warnings`, `cargo test --all-features`, `cargo test --test eval`, and the vendor-neutral guard (`--test connect_core_is_vendor_neutral`).

Every new behaviour gets a test with a **control**: the same test with the behaviour removed in a test-only build fails, and the pull request says how that was checked.

**Do-not-touch,** beyond backlog 2's Section C's list:
- track 4's files P1-P6, once merged: change them only through a part of their own;
- c5's PR-4, PR-6 and PR-11 files;
- VAM `src/rooms.rs`, which is recall. VAM's rule holds: "Recall never writes to a room, and the session-start hook does not read rooms" (VAM `CLAUDE.md`). Room writes here go through RM2's writer, never through recall, and the `SessionStart` hook gains no room work.

## File overlap with track 4 (P1-P6) and with c5's own PRs

As of 2026-11-27, track 4 has **no pull request and no branch on the fork** (`gh pr list` on the fork is empty, and only c5's `agent-connect/*` branches exist). This check is against track 4's planned files in backlog 2's Section C, and is to be **repeated against its actual diff when its pull request opens**.

- **No file is written by both an RM part and a P part, with three exceptions, all additive:**
  - **`src/connect/mod.rs`:** P1-P4 and RM1-RM6 each add `pub mod` lines. Additive. The part that lands second keeps both lines when it takes the integration head.
  - **`src/main.rs`:** P6 adds the `inbox` and `status` variants and their arms, and RM5 adds a `hook` variant and its arm. c5's PR-4 and PR-6 may also touch `serve` and `connect` there. Each adds its own variant and arm only, and the second to land keeps both.
  - **`tests/fixtures/agent-connect/`:** RM4 adds the fixed-reply vector there and a line to its README. Track 4 may refresh `control-messages.json` and its README line. Both copy files whole from keyring-wallet, and the second keeps both README lines.
- **RM files that track 4 reads but does not write:** none. RM3 reads P2's `connect-settings.json` (`handle`, `answersOthers`, `locale`) and P2's inbox, through P2's interface only. RM5 gates P5's `reply` tool by name.
- **RM files that c5's own PRs also write:**
  - `src/config.rs`: RM1 adds an `offered` block, and c5's PR-4 writes the `K_a` configuration. RM1 starts after PR-4 has merged, so they are not concurrent.
  - Nothing else: c5's PR-6 owns `src/connect/mediator.rs` (new), which no RM part writes.
- **Names that could clash, checked:** the RM files are `room_offer.rs`, `room_write.rs`, `mentions.rs`, `room_events.rs`, `others/`, `turn_trust.rs`, `profile.rs`, `src/hook_gate.rs`, `RELEASE_CHECKLIST.md`, `hooks/hooks.json`, and their tests. None is a P1-P6 file name. VAM's `src/rooms.rs` (recall) is written by no part.

## What the parts build on

- **Track 4 (Brendan's side):**
  - P1, the signed envelope, `envelope::verify` and `sign`, and the seen-id store;
  - P2, the inbox: the `chatDid` gate, the fence's `Provenance::Chat`, `connect-inbox.jsonl`, and `connect-settings.json` with `{ version, answersOthers, locale, handle }`;
  - P3, the VDC check and acceptance;
  - P5, the MCP channel and `reply`;
  - P6, `inbox --follow`.
- **c5:**
  - PR-4, the `K_a` configuration, which includes the room list VAM already keeps (VAM `src/config.rs:160`, `rooms: Vec<RoomSource>`);
  - PR-6, the one mediator session for `K_a`. It owns the socket, and room signals arrive on it, so it gives an `Outbox` to send chat and a stream of room-changed signals;
  - PR-11, the fake-Keyring harness. RM3, RM4 and RM5 add their own cases to it.
- **vta-sdk 0.94.0, room calls** (`src/client/rooms.rs`, `rooms_records.rs`, `rooms_watch.rs`):
  - `room_present(room_id, action)` for a leaf, `room_open` and `room_seal` for `attributed` rooms;
  - `room_read` / `room_read_batch`, and `room_watch_live` with `room_changed_signal`;
  - `room_record_members` and `room_check_record_members`, for what a room's profile lists;
  - the record-body signature checks recall already uses (VAM `src/rooms.rs:279` `check`).
- **The handle rule** (§3.6, PLAN:613-615) and `packages/core/src/modules/connected-agents/vectors/handle.json`, the vector Keyring and the plugin share.

## RM1: the room offer and the room registry

- **Start after:** P1 and P2 merged; c5's PR-4 merged (it writes the `K_a` configuration this part extends). **Ruling:** 1.
- **Files:** `src/connect/room_offer.rs`, `tests/connect_room_offer.rs`. In `src/config.rs`, only an optional `offered` block beside `rooms` (no change to `RoomSource`).
- **Interface:**
  - `room_offer::apply(accepted: &envelope::Accepted, cfg: &mut Config, now) -> Result<OfferOutcome, OfferRefusal>`, for a `keyring/agent/room-offer/1.0` with body `{ version, roomId, hostDid, tier, handleToMention, contexts }` (control-message table, al-5 finding 5; §3.6 step 5, PLAN:598).
  - `OfferOutcome` is `Added { room_id } | Updated { room_id } | Ignored(OlderThanApplied)`.
  - `OfferRefusal` has one variant per rule: tier `private` (not offered, §3.6, PLAN:606), an unknown major, a missing member.
- **What it does:**
  - **Order:** an offer is applied only when its `issuedAt` is newer than the last offer applied for that room (finding 4's order rule).
  - **Contexts:** `contexts` is informational. When it differs from what the entry grants, the plugin reports it to the owner over the chat ("defect the plugin reports", PLAN:598) and grants nothing on it.
  - **Persistence:** the room lands in `cfg.rooms` with its tier and host, so recall's existing room reading (VAM `src/rooms.rs`) sees it with no other change.
- **Tests:**
  - an offer adds a room and recall lists it;
  - a re-sent offer (same id) is refused by P1;
  - an older offer after a newer one changes nothing;
  - `private` is refused;
  - differing `contexts` produces one owner report and no grant;
  - each with its control.
- **Decided here:** the room list stays VAM's `rooms`, so recall and connect share one list. Offer bookkeeping (the last `issuedAt` per room) goes in the new `offered` block.

## RM2: the room writer, the agent's own records

- **Start after:** RM1, and c5's PR-4. **Rulings:** none.
- **Files:** `src/connect/room_write.rs`, `tests/connect_room_write.rs`.
- **Interface:**
  - `RoomWriter::write(room: &RoomSource, body: Map<String, Value>, members: &[&str]) -> Result<RecordRef, WriteRefusal>`.
  - It obtains a `write` leaf with `room_present(room, "write")` as the agent's own DID.
  - It checks every non-core member in `members` against `room_check_record_members`. A member the profile does not list is **dropped from the body**, and the caller is told (`WriteOutcome::DroppedMembers`). It is never written.
  - It signs the body as the agent (the record-body signature recall verifies), and for an `attributed` room it seals through `room_seal` via the owner's VTA (§3.6, PLAN:605).
  - `WriteRefusal` is no write leaf (§3.13: "without one it does not reply", PLAN:762), host unreachable, or VTA unreachable for `attributed`. Each has its own words, with no catch-all.
- **Intent record:** a write is a send that sets state on the host. Before the call it writes `connect-room-writes.jsonl`, `{ id, roomId, kind, at }` and owner-only, so a restart can tell "not sent" from "sent, answer lost" by reading the room for that id.
- **Tests:**
  - against VAM's loopback test VTA and a fake host: an `open` and an `attributed` write;
  - `mentions` dropped where the profile does not list it, and kept where it does;
  - no leaf means no write and its own refusal;
  - a crash between the intent record and the answer is resolved by a read on restart;
  - each with a control.
- **Decided here:** one writer for every record the agent writes (RM4's fixed reply, RM6's profile, and later the `reply` tool's room answers), so the record-member rule and the leaf rule live in one place.

## RM3: watching rooms, matching the mention, and the owner gate

- **Start after:** RM1; P2 merged; c5's PR-6 merged (the room-changed signals come in on its one session). **Ruling:** 1.
- **Files:** `src/connect/mentions.rs`, `src/connect/room_events.rs`, `tests/connect_mentions.rs`.
- **Interface:**
  - **Matching:** `mentions::matches(body: &Map<String, Value>, own: &Handle, own_did: &str) -> MentionMatch`, returning `Structured | Handle | None`.
    - Structured is `mentions` containing `own_did` (only where the profile lists it).
    - Handle is the **whole** handle, case-insensitive, at word boundaries, never the name alone (§3.6, PLAN:615).
  - **Classifying:** `room_events::on_record(record, room, settings) -> RoomEvent`, returning one of:
    - `OwnerMention`;
    - `OtherMention { author }`;
    - `NotForMe`;
    - `Dropped(Reason)`, for a bad signature, a malformed record, or one by the agent itself.
- **What it does:**
  - It gates on the **author** (`ownerPersonaDid`), never the room (PLAN:1379).
  - Room content is fenced (VAM `src/fence.rs`).
  - An `OwnerMention` goes to P2's inbox as a room event with `sender_role` `owner`.
  - An `OtherMention` goes to RM4 with "Answers other people" off, or to RM5 with it on. It never reaches the model in the off case.
  - Unmentioned records are never delivered.
- **Tests:**
  - the vectors of `handle.json`;
  - a bare name and another owner's same-named agent do not match (PLAN:615);
  - a mention by a non-owner in the owner's room is still `OtherMention`;
  - an unsigned or wrongly signed record is dropped before matching;
  - the agent's own records are never matched;
  - each with a control.
- **Decided here:** the plugin matches the handle stored in `connect-settings.json` from Keyring's `settings` (`handle`, al-5 finding 8), never one it derives itself, so the two sides cannot disagree. The `handle.json` vector is a test of Keyring's derivation, run here only as a check.

## RM4: the fixed reply, its limits and the release gate

- **Start after:** RM2 and RM3; P1 merged (the owner's report goes over the chat); c5's PR-6 merged (`Outbox`). **Rulings:** 2 (decided) and 6 (open, for the owner's report only; the fixed reply and its limits do not wait).
- **Files:**
  - `src/connect/others/mod.rs`, `src/connect/others/limiter.rs` and `src/connect/others/messages.json`. The plan's working path `src/core/others/messages.json` (PLAN:758) becomes `src/connect/others/`, the core's actual folder;
  - `RELEASE_CHECKLIST.md` at the fork's root (the record of native review);
  - `tests/connect_others.rs` and `tests/release_gate.rs`.
- **Interface:**
  - `others::fixed_reply(locale: &str) -> &'static str`: the three texts of §3.13 (PLAN:752-756), falling back to `en`.
  - `Limiter::allow(author, room, now) -> Allowed | Limited`:
    - at most once per author per room per 60 minutes;
    - at most 20 per hour across rooms;
    - state persisted owner-only in `connect-others-limits.json`, so a restart does not reset it.
  - `others::on_other_mention(event, writer, outbox, limiter, settings)`.
- **What it does:**
  - **The reply:** a room record through RM2, with `inReplyTo` the mention, and **no** `@<handle>` and **no** `mentions` (PLAN:760). It is not generated by the model.
  - **The owner's report (WAITING on ruling 6; written here as option (b), and under (a) it becomes one `mention-report/1.0` per author per room per hour, with `count` and `replied`):** one line per author per room per hour, "<member> mentioned you in <room>" with a count, sent over the chat by `outbox`, including mentions the limiter did not answer (PLAN:761).
  - **Fixed reply sent:** "Sent the fixed reply to <member> in <room>." That is a different line, because "Sent" would be false for a limited one.
  - **No write leaf:** no reply, and the owner's line says so.
- **The shared vector:** `messages.json` and Keyring's `ConnectedAgents.OthersReply` are held to one shared vector file in each repository (PLAN:759). The keyring-wallet side's vector is outside this brief. This part copies it byte-identically into `tests/fixtures/agent-connect/` with a README naming the wallet commit, as track 4's fixtures do.
- **The release gate** (ruling 2): `tests/release_gate.rs` fails while `RELEASE_CHECKLIST.md` lacks a named reviewer and a date for fr and for pt-br, and the plugin's `version` bump is checked against it.
- **Tests:**
  - en, fr and pt-br picked by locale, and an unknown locale gives en;
  - the 61st minute allows and the 59th does not;
  - the 21st reply in an hour is refused;
  - a restart keeps the counts;
  - a reply never carries a handle or `mentions`;
  - two agents with the setting off never answer each other (a loop test on the fake host);
  - the gate fails with no record and passes with one;
  - each with a control.
- **Decided here:** the counts are per agent (PLAN:763: "the per-agent limits do not bound that total"), and the plan accepts that. Nothing here coordinates between agents.

## RM5: "Answers other people" On, covering the turn-trust marker and the two hooks

- **Start after:** RM3; P2 and P5 merged (the delivery and `reply`). **Rulings:** 3 and 5.
- **Files:**
  - `src/hook_gate.rs`, a front-end **outside** `src/connect/`, since Claude Code's hook format is a host detail and the vendor-neutral guard must hold;
  - `src/connect/turn_trust.rs`, the core's marker, behind `HostContract::set_turn_trust` / `can_deny_tools` (VAM `src/connect/host.rs`, PR-1);
  - `hooks/hooks.json`: add `PreToolUse` and `Stop` entries; the `SessionStart` entry is unchanged;
  - in `src/main.rs`, only a `hook` subcommand with `pre-tool-use` and `stop`;
  - `tests/hook_gate.rs`.
- **Interface:**
  - `turn_trust::begin_other(event) -> Marker`, `turn_trust::end() -> Vec<HeldEvent>`.
  - The marker is an owner-only file, `connect-turn-trust.json`, with `{ marker: "other", since, eventId }`.
  - `hook_gate::pre_tool_use(input: HookInput) -> HookDecision`: while the marker is `other`, **deny every tool but the plugin's `reply`**, and deny `ToolSearch` too, so `reply` is always loaded (PLAN:771).
  - `hook_gate::stop()` clears the marker and releases the owner events P2 held meanwhile, as a turn of their own.
- **What it does:** with the setting On, an `OtherMention` from RM3 is delivered with `sender_role` `other`, in a fence, with the instructions of §3.13 (PLAN:767: answer from that text alone, no memory, no VTA call but reading the room, reply only to that room). Owner events that arrive during that turn are held until `Stop` (PLAN:771).
- **Fail closed:** a marker file that is unreadable or left by a crash counts as `other` until `Stop` or a new session start clears it. The hook never fails open.
- **Tests:**
  - in the style of VAM `tests/hook_contract.rs`: with the marker `other`, `Bash`, `Write`, `ToolSearch` and a memory tool are denied, and `reply` is allowed;
  - with no marker, nothing is denied;
  - an owner event during an `other` turn is held and then delivered after `Stop`;
  - a corrupt marker denies;
  - with the setting Off, the model sees nothing (RM4 takes it);
  - each with a control.
  - The pull request repeats §2.3 item 13: `bypassPermissions` and subagent calls are not measured.
- **Decided here:** the hook's allow-list is one name, the plugin's own `reply`. Nothing else is allowed on an `other` turn, including the plugin's other tools.

## RM6: the agent's profile record with its delegation

- **Start after:** RM1 and RM2; P3 merged (the grant and acceptance). **Ruling:** 4. Until a room's profile lists `delegation`, this part writes a plain name record everywhere, and that is its correct behaviour.
- **Files:** `src/connect/profile.rs`, `tests/connect_profile.rs`.
- **Interface:** `profile::write(room, name, delegation: Option<&VdcPair>, writer)`.
  - It writes the agent's `memberProfile` record (`rooms/_shared/0.3` `MemberProfileRecord`, the name in `title`) at the first room offer, and again when the VDC is re-issued.
  - The `delegation` member (the grant and the acceptance, §3.16, PLAN:858) goes in **only where the room's profile lists `delegation`**.
  - Where it does not, the body is **byte-identical** to a plain name record (PLAN:1379).
  - It writes only in rooms the agent was offered, never elsewhere.
- **Tests:**
  - against a profile that lists `delegation` and one that does not: the latter's body is byte-identical to a plain name record, compared as bytes;
  - a re-issued VDC rewrites the record in every offered room and no other;
  - the pair written verifies under P3's check (issuer `ownerPersonaDid`, subject the agent, acceptance by the agent);
  - each with a control.
- **Decided here:** the record is written through RM2's writer, so the record-member rule is RM2's single check, not repeated here.

## Order

- **RM1 first** (after PR-4, P1 and P2).
- **Then RM2 and RM3 in parallel:** RM3 also needs PR-6.
- **Then RM4, RM6 and RM5:**
  - RM4 needs RM2, RM3 and PR-6;
  - RM6 needs RM2 and P3;
  - RM5 needs RM3 and P5.
- **Each part's PR-11 cases** (the fake-Keyring harness: owner mention, non-owner mention with the setting off and on, a room offer, a VDC re-issue) land with that part.
- **Merge order** into `integration/agent-connect`: RM1, RM2, RM3, RM4, RM6, RM5. RM5 goes last, as it changes what a session may do.
