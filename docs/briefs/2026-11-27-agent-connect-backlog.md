# Agent connect backlog for the plan owner's side: thirteen parts

Written 2026-11-27 by the Keyring lanes that own each area, for work done without the chance to ask questions.
Every open point is decided in the part ("Decided here"). If a part meets something it does not cover: stop
that piece, leave a comment in the PR saying what you met, and carry on with the rest.

Feature branch tip when this was written: `feat/agent-connect` at `ebff104ec60c915c53cabf943540ed16fea623fd`. Start each part from the tip
current when you start it, unless its section names another base.

**Review feedback comes as formal GitHub reviews** (state COMMENTED, or CHANGES_REQUESTED when something must
change), not as plain PR comments. Read every review body on your PR before each pass.

## Order, and what to skip

Do the parts in this order. Each is one draft PR into `feat/agent-connect` (or stacked, where its section says).

1. Section A, **fb-2** (read each agent's entry once)
2. Section A, **fb-3** (the VDC re-issue policy)
3. Section A, **fb-4** ("Keep it connected", built but not offered)
4. Section B, **Part 2** (the rung checks track C's shapes offline)
5. Section B, **Part 3** (C4, "What my agent saw")
6. Section B, **Part 4** (C5, "Answers on")
7. Section C, **U1** (HCP approve flow as views; base: #1093's branch with the tip merged in)
8. Section C, **U2** (stacked on U1)
9. Section C, **U3** (stacked on U2)
10. Section C, **U4** (delete memory views; base: #1090's branch with the tip merged in)
11. Section C, **U5** ("Acting as")
12. Section A, **fb-5** (services and hooks; START ONLY once #1090 is on the feature branch)
13. Section B, **Part 5** (C10, the seam only; optional, last)

**SKIP these two sections; they are already handled:**
- Section A **fb-1** (#1090's one open point): it comes to you as a formal review on #1090 instead.
- Section B **Part 1** (the track C review fixes): your review passes on #1091 and #1093 did these. The one
  item still open from it, the failed and cancelled copy, comes to you as a formal review on #1093.

If two parts' file lists seem to touch the same file, the earlier part in this order wins and the later one
waits for it to merge; say so in the later PR.

---

# Section A: Keyring core logic (fb-1 to fb-5)

# Keyring core logic: five parts (fb)

Written 2026-11-27 by the Keyring core lane, read against `feat/agent-connect` at
`98ce15111c24a6f218d4cb0b2e4a5adb2e6a11bc`, VTI at `97fda9813` (the pin), trust-tasks at `2a66a0351`. Every name,
signature and line below was read at those commits. Off the critical path: the chat (7.9) and the wiring that makes
screens reachable stay with us.

## Files these parts write (for the overlap check)

| Part | Creates | Writes (existing) |
|---|---|---|
| fb-1 | none | `connected-agents/deleteMemory.ts` (your own #1090) |
| fb-2 | `connected-agents/entryRead.ts`, `connected-agents/__tests__/entryRead.test.ts` | none |
| fb-3 | `connected-agents/vdcReissue.ts`, `connected-agents/__tests__/vdcReissue.test.ts` | none |
| fb-4 | `connected-agents/keepConnected.ts`, `connected-agents/__tests__/keepConnected.test.ts` | none |
| fb-5 | none | `connected-agents/services.ts`, `connected-agents/ConnectedAgentsProvider.tsx`, `connected-agents/__tests__/services.test.ts`, `connected-agents/__tests__/ConnectedAgentsProvider.test.tsx` |

All paths are under `packages/core/src/modules/`. No part writes a screen, a component, a locale file or a testID.

## Parts, bases and branches

| Part | What | Branch | Base | About |
|---|---|---|---|---|
| fb-1 | #1090's one open review point | your #1090 branch | your #1090 branch | 10 min |
| fb-2 | read each agent's entry once, for drift and the VDC policy | `agent-connect/entry-read` | `feat/agent-connect` at its tip when you start (`98ce15111` when written) | 1.5 h |
| fb-3 | the VDC re-issue policy (§3.4) | `agent-connect/vdc-reissue` | fb-2's branch | 1.5 h |
| fb-4 | 7.28's "Keep it connected" act, built but not offered | `agent-connect/keep-connected` | fb-3's branch | 2 h |
| fb-5 | wire fb-2 to fb-4, #1077's revoke and #1090's delete into the services and hooks | `agent-connect/services-wiring` | fb-4's branch, **after** #1082, #1084 and #1090 are on `feat/agent-connect` (merge its tip in first, signed) | 2.5 h |

Each part is one **draft** PR into `feat/agent-connect`; fb-3 to fb-5 are stacked. **Review feedback reaches you as a
formal GitHub review on the PR**, never as a conversation comment.

## Do not touch (all parts)

`connected-agents/`: `actions.ts`, `driver.ts`, `pairing.ts`, `carriage.ts`, `store.ts`, `memories.ts`,
`status.ts`, `types.ts`, `vdc.ts`, `revoke.ts`, `lockout.ts`, `agentConnectFlag.ts`, `proposedCopy.ts`,
`failureCopy.ts`, `screens/`, `components/`, `hcp/`, and every existing test except the two fb-5 names.
`services.ts` and `ConnectedAgentsProvider.tsx` belong to fb-5 only. `trust-tasks/**` (`VtaClient.ts`,
`vtaAgent.ts`, `approvalRules.ts` and their tests), `localization/**`, `navigators/**`, `testids.json` (both),
`e2e/**`, `scripts/**`, `.github/**`, `docs/**`, any `package.json` or lock file. If a piece seems to need one of
these, stop that piece and say so in the PR.

## Checks every part passes

As the track C brief: `cd packages/core && TZ=GMT yarn jest src/modules/connected-agents` (the whole module;
`releaseGate.test.ts` and `components.test.tsx` pass unchanged); `node scripts/tsc-ratchet.mjs` prints
"156 diagnostic(s) now; baseline 156"; CI's prettier form and eslint on changed files; both testid files unchanged;
signed commits, conventional, your `Signed-off-by:` last. **Controls that bite:** each test file has a case marked
`// control:` and the PR records one source change per file that made a named test fail. A fixed task version
carries `// version-pinned: <reason>` on its line or the one above (the `versionLadderGuard` test).

**Words: none in any part.** Every string these parts need is already a §6 key: `KeepConnected`, `KeepConnectedTitle`,
`KeepConnectedBody`, `KeepConnectedConfirm`, `MemoryAccessChanged`, the delete line. Results are codes; the screens
word them.

---

## fb-1: #1090's one open point

`deleteMemory.ts:127` awaits `ports.listEntries()` and discards it. Since your fix, the records come from
`store.list()`, so the call is now a reachability probe: no delete is sent to a VTA that is not answering.
**Decided here:** keep the call and add one clause on that line: "the entries are not used here; the call proves
the VTA answers before a delete is sent". Already done in #1090, so do not re-raise them: every record cleaned from one
`store.list()` before the delete; `{ ok: true; recordsNotUpdated }`; `overWarning` tied to `countNotice`; listing
before the delete.

## fb-2: read each agent's entry once

**`entryRead.ts`**, using `AgentAccessPort` and `AccessEntry` from `carriage.ts`, `AgentConnection` from `types.ts`:

```ts
export type EntryRead = { kind: 'listed'; entry: AccessEntry } | { kind: 'notListed' } | { kind: 'unknown' }
export async function readAgentEntry(access: Pick<AgentAccessPort, 'findAgentEntries'>,
  record: Pick<AgentConnection, 'agentDid' | 'deviceId'>): Promise<EntryRead>
export async function readAgentEntries(access, records: readonly AgentConnection[]): Promise<Map<string, EntryRead>>
export function entryContexts(read: EntryRead | undefined): string[] | undefined
```

- `readAgentEntry` calls `findAgentEntries({ deviceId (only when non-empty), subject: agentDid })`. It matches by
  `deviceId` first, then by `entry.subject === agentDid`.
- It is `listed` with the match.
- It is `notListed` only when the listing is complete, nothing matches, **and the record has a deviceId**.
- **Decided here:** with no deviceId and no match it is `unknown`, never `notListed`, since by key alone a rotated
  entry is invisible (#1082's `goneUnproven`). A partial listing, or a throw, is also `unknown`.
- `readAgentEntries` reads, one at a time, only records whose `state` is `active` or `expired`. The map is keyed by
  record `id`.
- `entryContexts` returns the contexts for a listed entry with `act.stated === 'contexts'`, `[]` for any other listed
  `act`, and `undefined` for `notListed`, `unknown` or `undefined`. **Decided here:** the views show drift only from a
  defined value.
- Tests: deviceId match beats subject, rotated (deviceId under another subject) is `listed`, no-deviceId miss is
  `unknown`, partial is `unknown`, a throw is `unknown`, `revoking`/`pairing`/`notFinished` are not read; control: a
  complete miss with a deviceId is `notListed`.

## fb-3: the VDC re-issue policy (§3.4)

**`vdcReissue.ts`**, using `shouldReissueVdc`, `buildVdcGrant`, `issueVdc`, `vtaVdcSigner`, `vdcScopeFor` and
`VdcSignPort` from `vdc.ts`, `personaSigningKeyId` from `driver.ts`, and `statusOf` from `status.ts`:

```ts
export type VdcReissuePorts = { clock: () => number; vdcSign: VdcSignPort; signingKeyIdOf?: (persona: string) => string;
  connections: { update(id: string, change: (r: AgentConnection) => AgentConnection): Promise<AgentConnection | undefined> } }
export async function reissueDueGrants(ports: VdcReissuePorts, records: readonly AgentConnection[],
  reads: ReadonlyMap<string, EntryRead>): Promise<{ reissued: string[]; failed: string[] }>
```

- A record is due when `shouldReissueVdc({ state: record.state, entryConfirmedPresent: reads.get(id)?.kind === 'listed',
  grantValidUntil: vdcGrant.validUntil, now })` is true. `VDC_REISSUE_WITHIN_MS` is 48 hours.
- Skip a record with no `vdcGrant` or no `validUntil` string, and a temporary record whose `statusOf` is `expired`.
  **Decided here:** those are skipped, not failed.
- The new grant is `buildVdcGrant` with `scope: vdcScopeFor({ memory: memoryContexts.length > 0, roomAdded: false })`.
  Its `entryExpiresAt` is the record's `expiresAt` for a temporary agent and absent for a persistent one (7 days).
  It is signed by `vtaVdcSigner(vdcSign, keyId)`, where the key is `signingKeyIdOf ?? personaSigningKeyId` of
  `ownerPersonaDid`.
- Write `connections.update(id, r => r.state === 'active' ? { ...r, vdcGrant } : r)`. A throw at any step puts the
  id in `failed` and moves to the next record.
- Tests: due vs not due, not listed means not re-issued, unknown means not re-issued, a persistent grant is 7 days
  ahead, a temporary one ends at `expiresAt`, a signer failure is `failed` and the next record still runs; control: 49
  hours left is not due.

## fb-4: "Keep it connected" (7.28), built but not offered

**What 0.1 measured:** nothing on the lab yet. **Read at source** (VTI `97fda9813`): `acl_v0_3.rs:984` maps an explicit
`"expiresAt": null` to `clear_expiry`, and `acl.rs:1239-1240` sets `entry.expires_at = None`. Keyring's own entry is
permanent, so the granter bound allows it. §7.28 still requires the lab measurement first (lab writes are d3's).
**Decided here:** build the act to that source reading, and ship it unoffered:

- **`keepConnected.ts`:** `export const KEEP_CONNECTED_MEASURED = false` (we flip it after d3's measurement).
- `export function keepConnectedOffered(record: AgentConnection, now: number): boolean` is true only when
  `KEEP_CONNECTED_MEASURED`, `state === 'active'`, `grantType === 'temporary'` and `statusOf(record, now) !== 'expired'`.
  This is the plan's fallback: while false, the act is absent and Extend renews.
- `export type KeepConnectedPorts = { clock; access: Pick<AgentAccessPort, 'findAgentEntries'>; task(type: string,
  payload: Record<string, unknown>): Promise<unknown>; vdcSign: VdcSignPort; signingKeyIdOf?;
  connections: { get; update } }`.
- `export async function keepConnected(ports, id): Promise<{ ok: true } | { ok: false; code: 'noRecord' |
  'notOffered' | 'notListed' | 'unreachable' | 'notApplied' | 'vdc' }>`. It does not check the constant; the screen
  asks `keepConnectedOffered` first. It checks the record's own conditions. The steps:
  1. `readAgentEntry` (fb-2). Not `listed` is `notListed`, or `unreachable` for `unknown`.
  2. `task(ACL_UPDATE_03, { subject: entry.subject, expiresAt: null })`, where
     `ACL_UPDATE_03 = 'https://trusttasks.org/spec/acl/update/0.3'` is written once with
     `// version-pinned: an agent's entry is written at acl 0.3 only, and an explicit null is 0.3's form`. A throw is
     `unreachable`.
  3. Read back: the entry must be listed with no `expiresAt`, else `notApplied`.
  4. `connections.update` to `grantType: 'persistent'` and `persistentElectedAt` (now, ISO), with the `expiresAt` member
     removed (destructure it out; spread the rest).
  5. Issue and store a new VDC with no `entryExpiresAt` (7 days). If that fails: `vdc`, and the record stays
     persistent.
- Not `narrowOrWidenCapabilities`: #1082's `AgentAccessChange.expiresAt` refuses null by design.
- "Not now" is the screen closing its sheet: nothing to build.
- Tests: the payload is exactly `{ subject, expiresAt: null }`, a read-back still showing an expiry is `notApplied`
  and the record is untouched, the record after success, VDC failure leaves it persistent, `keepConnectedOffered` false
  for persistent, expired, not active, and while the constant is false; control: with every condition met and the
  constant false, still not offered.

## fb-5: the services and hooks (after #1082, #1084, #1090)

In `services.ts`:

- **`revokeVta`** = `{ findAgentEntries: access.findAgentEntries, revokeSubject: (did) => on(c => c.revokeSubject(did)) }`.
- **`revokeEntry` for `AgentActions`:**
  - with a deviceId, `removeAgentEntries(revokeVta, r)` (#1077). `unreachable` throws, and `gone` is
    `kind === 'revoked'`.
  - **Decided here:** with no deviceId, `removeAgentEntries` answers `noDeviceId`. So `revokeSubject(r.agentDid)`
    (a refusal is ignored), then `findAgentEntries({ subject: r.agentDid })`. `gone` only when complete with no entry
    under that subject; a throw is unreachable.
- **`reconcile`** runs, each step catching its own error so a later one still runs:
  1. `driver.reconcilePairing()`;
  2. `reconcileAgents({ store: connections, vta: revokeVta, now: clock })` (#1077, no caller yet);
  3. `actions.sweepNotFinished()`;
  4. `readAgentEntries` over the records, kept in a closure as the last reads;
  5. `reissueDueGrants`.
- **`entryContexts(agentId)`** = `entryContexts(lastReads.get(agentId))`.
- **#1090's ports:**
  - `listEntries: on(c => c.listAcl())`;
  - `deleteContext: (id, force) => on(c => c.task(VTA_TASK.contextsDelete12, { id, force }, 30000, {}, undefined,
    { waitForConsent: false }))`, with `// version-pinned: §3.15 names vta/contexts/delete/1.2`;
  - `isHeld: (e) => consentPendingOf(e) !== undefined`;
  - `task: memory.task`;
  - `store: connections`.
- **The approvals guard cannot see this delete:** `approvalRules.test.ts` scans only `trust-tasks/module`. So
  `services.test.ts` asserts `waitForConsent: false` on that call.
- **fb-4's ports:** `task: (type, payload) => on(c => c.task(type, payload, 30000, {}, undefined,
  { waitForConsent: false }))`.

In `ConnectedAgentsProvider.tsx`:

- `ConnectedAgentsServices` gains `previewDelete(memoryId)`, `deleteMemory(memoryId, confirmed: true)`,
  `keepConnected(agentId)`, `keepConnectedOffered(agentId)` and `entryContexts?(agentId)`.
- `AgentActionsPort` gains `keepConnected`.
- New `useDeleteMemory(): { preview, remove }`.
- `useAgentConnections` passes `entryContexts: services.entryContexts?.(r.id)` to `viewOf`, so drift reaches the
  details.

**It does not change the release gate's verdict.** `services.ts` is inside `connected-agents` and calls
`removeAgentEntries`, not `revokeAgentConnection` from a routed file. Its PR says so, and `releaseGate.test.ts` passes
unchanged.

Tests (the two existing test files):
- the reconcile order;
- one step failing still runs the rest;
- the no-deviceId revoke;
- `waitForConsent: false` on the delete and on Keep it connected;
- drift showing in a view.
- Control: no `entryContexts` means no drift.


---

# Section B: HCP, Keyring side and the rung (Parts 1 to 5)

# Backlog parts from the HCP lane (d3): five parts

For work done without the chance to ask questions. Every open point is decided here ("Decided here"). If you meet
something these parts do not cover, stop that piece, leave a comment in the PR saying what you met, and carry on
with the rest, as in the track C brief.

Read against: Keyring `feat/agent-connect` at `98ce15111`; the track C stack as it stands (#1091 `449d2665b`,
#1092 `fc5e8861b`, #1093 `02828bf26`) and the three reviews on it; the plan `docs/plans/agent-connect-plan.md`
§6, §7.29 and §11; the companion `docs/plans/agent-connect-plan/2026-11-25-bam.md` findings 6, 7 and 11; the
`hcp/*` suite at `trustoverip/dtgwg-trust-tasks-tf` **`4e2dd42fae13452fe30f0e077f359110bb2ad414`** (#1380 as
merged on `main`); HCP 2.0-draft-3 (§6.4, §7.6, §8.1, §8.6); VTI `vti-specs-core` at `97fda9813`
(vta-service-v0.84.0) for `task-consent/request/0.1`.

## Files, all parts

No two parts write the same file, and no part writes a file outside these lists. Every path below is new unless
marked **(change)**. `hcp/` means `packages/core/src/modules/connected-agents/hcp/`; `rung/` means
`tsp-reference/ref-25-agent-pairing/`.

| Part | Writes |
|---|---|
| 1 | **(change)** `hcp/vtaPort.ts`, `hcp/connectLink.ts`, `hcp/approveFlow.ts`, `hcp/store.ts`, `hcp/types.ts`, `hcp/newMemory.ts`, `hcp/revoke.ts`, `hcp/copy.ts`, and their tests in `hcp/__tests__/` (`vtaPort.test.ts`, `connectLink.test.ts`, `approveFlow.test.ts`, `store.test.ts`, `newMemory.test.ts`, `revoke.test.ts`, `copy.test.ts`, `schemas.test.ts`, `fixtures/hcpSchemas.ts`); new `hcp/reconcile.ts`, `hcp/__tests__/reconcile.test.ts`; the fixture folder `hcp/__tests__/fixtures/hcp-suite-186773c97/` is **renamed** to `hcp/__tests__/fixtures/hcp-suite-4e2dd42fa/` and gains the files part 1 lists |
| 2 | `rung/hcp/link.mjs`, `rung/hcp/number.mjs`, `rung/hcp/consent.mjs`, `rung/hcp/hcp.test.mjs`, `rung/fixtures/hcp-consent-request.json`, `rung/fixtures/hcp-match-number.json`, **(change)** `rung/README.md` (one new section, and the test count line); `hcp/__tests__/rungConsent.test.ts`, `hcp/__tests__/fixtures/vti-task-consent-97fda9813/` |
| 3 | `hcp/whatItSaw/` (`audit.ts`, `summary.ts`, `view.ts`, `labels.ts`, `copy.ts`) and `hcp/whatItSaw/__tests__/` |
| 4 | `hcp/answersOn/` (`directive.ts`, `store.ts`, `view.ts`, `copy.ts`) and `hcp/answersOn/__tests__/` |
| 5 | `hcp/memories/` (`management.ts`, `copy.ts`) and `hcp/memories/__tests__/`, as far as part 5 says (most of C10 is not ready; see part 5) |

## Do not touch (all parts)

As in the track C brief, and the same reasons:

- `connected-agents/`: `actions.ts`, `services.ts`, `ConnectedAgentsProvider.tsx`, `store.ts`, `driver.ts`,
  `pairing.ts`, `carriage.ts`, `memories.ts`, `status.ts`, `types.ts`, `vdc.ts`, `revoke.ts`, `lockout.ts`,
  `agentConnectFlag.ts`, `deleteMemory.ts`, `proposedCopy.ts`, `failureCopy.ts`, `screens/**`, `components/**`,
  every existing test outside `hcp/__tests__/` (including `releaseGate.test.ts` and `components.test.tsx`).
- `trust-tasks/module/`: `VtaClient.ts`, `vtaAgent.ts`, `consentCheck.ts`, `keyedRecords.ts`, `triggerLink.ts`.
- `packages/core/src/localization/**`, `navigators/**`, `types/navigators.ts`, `container-impl.ts`,
  `container-api.ts`, `index.ts`, `packages/core/testids.json`, `e2e/**`, `scripts/**`, `.github/**`, every
  `package.json` and lock file (no new dependency, in the app or the rung), `packages/core/tsc-baseline.txt`,
  `docs/**`.
- In the rung: every existing file except `README.md` as part 2 says.

## Common to every part

- **Flags:** every function is reachable only when `isHcpEnabled()` (both flags) is true, through the port, as
  track C does. No route, tab, screen, component or testID. View models return copy keys and parameters, with
  times as ISO-8601 instants.
- **Management Client tasks** go through `hcp/vtaPort.ts`'s `HcpVtaPort` and `callHcp`, with no `accessToken`,
  each type URI a constant with `// version-pinned: the hcp suite is pinned at 0.1 (suite 4e2dd42fa); the VTA
  serves this version only`.
- **Copy:** each part's strings in its own `copy.ts`, in the shape of `hcp/copy.ts` (`{ en, fr, ptBr, source }`),
  never in the localization files. English is sourced to plan §6 or companion finding 6 where they have the words;
  everything else is PROPOSED, and every French and Portuguese string is PROPOSED pending a native reader.
  **A refusal never offers a retry**, and is a key of its own, distinct from `unreachable` (ac's rule on track C:
  only an unreachable VTA is worth trying again).
- **Checks before ready:** as the track C brief, in CI's own form: `cd packages/core && TZ=GMT yarn jest
  src/modules/connected-agents`; `node scripts/tsc-ratchet.mjs --package packages/core --project
  tsconfig.ratchet.json` with the baseline (156) not growing; prettier
  (`--config packages/.prettierrc --ignore-path packages/.prettierignore`) and eslint over the changed files; for
  part 2 also `cd tsp-reference/ref-25-agent-pairing && npm test`, and the PR records the count CI's "TSP
  reference offline tests" job prints for ref-25 (`# tests N`, `# skipped 0`). Each test file has at least one
  `// control:` case, and each PR description records one source change per file that made a named test fail.
- **Commits** signed, `Signed-off-by:` last, conventional types. Each part one draft PR into `feat/agent-connect`,
  left draft.

## Part 1: the fixes the three track C reviews asked for

**Why it is a part:** the reviews of #1091, #1092 and #1093 asked for changes, and no commit has followed them
since. Written down here so they are not lost.

**Base and branch:** commit on **#1093's own branch** (`bb/T20261127053928-6635f1-track-order-part-c2`), the top
of the stack, which holds all three parts' commits. Do not open a new PR for part 1; push to #1093. Add one line
to the descriptions of #1091 and #1092: "The review fixes for this part are in #1093." The merge order stays #1091,
#1092, #1093.

### 1.1 `hcp/vtaPort.ts`: "off" is not "unreachable"

- `HcpCallOutcome<T>` gains a fourth arm, `{ ok: false; off: true }`.
- The port throws a typed error, `class HcpOffError extends Error { name = 'HcpOffError' }`, when `isHcpEnabled()`
  is false; `callHcp` maps it to `{ ok: false, off: true }`, never to `unreachable`.
- **Decided here:** no copy key for `off`. It can only occur in a developer build, and no screen exists.
- Test: with the flag off, `callHcp` returns `off`. **Control:** a thrown plain `Error` still returns `unreachable`.

### 1.2 The suite pin moves to the merged commit

- Rename the folder `hcp-suite-186773c97/` to `hcp-suite-4e2dd42fa/`, and replace every vendored file with its
  bytes at `4e2dd42fae13452fe30f0e077f359110bb2ad414` (the same paths; formatting by prettier afterwards is
  allowed, content JSON-equal).
- `SUITE_COMMIT.sha` holds `4e2dd42fae13452fe30f0e077f359110bb2ad414`.
- The README says "from `main` of `trustoverip/dtgwg-trust-tasks-tf`, merged there as #1380 (squash `4e2dd42fa`,
  whose `specs/hcp` is the pull request's last head `fd9e67ba9`); not yet published to the registry"
  in place of "DRAFT, from an open upstream pull request".
- **Also vendor now, for parts 3 to 5**, so those parts write no fixture file: `specs/hcp/audit/read/0.1/payload.schema.json`,
  `specs/hcp/directives/set/0.1/payload.schema.json`, `specs/hcp/entries/withdraw/0.1/payload.schema.json`,
  `specs/hcp/entries/revise/0.1/payload.schema.json`, `specs/hcp/entries/get/0.1/payload.schema.json`,
  `specs/hcp/_shared/0.1/audit-event.schema.json`, `specs/hcp/_shared/0.1/directive.schema.json`, and any other
  `_shared/0.1/` file those reference (follow the `$ref`s).
- `fixtures/hcpSchemas.ts` and `schemas.test.ts` follow the rename. Nothing else changes: every schema the track C
  code uses is structurally identical at the two commits (descriptions aside).

### 1.3 `hcp/connectLink.ts`: say "at most 251"

The doc comment states that a link of at most 251 UTF-8 bytes is accepted and 252 refused. No code change.

### 1.4 The record is written before the approval (the orphan grant)

Today `recordHcpApproval` (`hcp/store.ts`) runs as `onApproved`, after `decide` has approved, so a failed write
leaves a grant on the VTA that Keyring cannot revoke. Change the order:

- `HcpConnection` (`hcp/types.ts`) gains `phase: 'approving' | 'connected'`. A record read without `phase` is
  `connected` (the only records that exist today were written after approval).
- `createHcpApproveFlow`'s deps replace `onApproved` with `records: { begin(view, now): Promise<void>; finish(id, approvedAt): Promise<void> }`.
- `approve()`: first `records.begin(view, now)`, which writes the record with `phase: 'approving'`, the view's
  `grantId`, `name`, `threadId`, and `approvedAt`/`expiresAt` left unset. If that write fails, nothing is sent to
  the VTA, and the state is `failed` with key `ApproveNotStarted`. Then `decide(id, 'approve')`. If the
  approval is approved (read back from the source, as the flow does now), `records.finish(id, approvedAt)` sets
  `phase: 'connected'`, `approvedAt` and `expiresAt`; the state is `approved`. If `finish` fails, the state is
  `failed` with key `ApproveNotFinished`, and the record stays `approving`.
- If `decide` does not approve, the `approving` record is deleted and the state is `failed` with key
  `ApproveNotApproved`.
- **New `hcp/reconcile.ts`:** `export async function reconcileHcpConnections(deps: { port; store; clock })`.
  Every record still `phase: 'approving'` is revoked by its `grantId` (`HCP_GRANTS_REVOKE`). On success the
  record is deleted. On a refusal or `unreachable` it is kept, unchanged, for the next run. **Decided here:** a
  record still `approving` is never completed, only revoked. After a restart Keyring cannot tell whether its
  decision reached the VTA, and revoking is the safe reading; the person connects again. A refusal does not delete
  the record: the suite answers a `grantId` the provider does not know with `permissionDenied`, the same answer
  as a caller without the authority, and deleting on that answer could drop the only handle on a live grant.
- **The VTA side of this contract** (track A builds it): `hcp/grants/revoke` with a `grantId` the VTA assigned,
  in any state (held, approved but not collected, active, expired or already revoked), answers success, and a
  held or uncollected request is then cancelled: a later resubmit of it is refused. So a `grantId` Keyring read
  from the VTA's own consent request is never refused for being unknown.
- `reconcileHcpConnections` is exported from `hcp/` and called by nothing in this backlog: wiring it at app start
  belongs with the screens, in another lane, and needs the release gate's owner.
- **Decided here:** `HcpConnectionStore.list()` returns only `connected` records, so `hcp/status.ts` and every
  existing caller see no `approving` record; a new `listApproving()` returns the others, for the reconcile.
  `hcp/status.ts` is not changed.
- Tests: the write happens before `decide`, checked by the order of the fake's calls; a failed `begin` sends
  nothing; a failed `finish` leaves `approving`; reconcile revokes an `approving` record and deletes it on
  success and on `notFound`, keeps it on `unreachable`, and never touches a `connected` one. **Control:** with the
  old order restored, the orphan test fails.

### 1.5 Copy for the failures that have none (`hcp/copy.ts`)

New keys, PROPOSED, no retry in any refusal:

| Key | en | fr | pt-br |
|---|---|---|---|
| `ApproveNotStarted` | Keyring couldn't save "{{name}}", so nothing was approved. | Keyring n'a pas pu enregistrer « {{name}} », donc rien n'a été approuvé. | O Keyring não conseguiu salvar "{{name}}", então nada foi aprovado. |
| `ApproveNotApproved` | Your VTA didn't take the approval. Nothing was connected. | Votre VTA n'a pas pris en compte l'approbation. Rien n'a été connecté. | Seu VTA não aceitou a aprovação. Nada foi conectado. |
| `ApproveNotFinished` | Approved, but Keyring couldn't finish saving "{{name}}". It will be disconnected when Keyring next starts. | Approuvé, mais Keyring n'a pas pu finir d'enregistrer « {{name}} ». Il sera déconnecté au prochain démarrage de Keyring. | Aprovado, mas o Keyring não conseguiu terminar de salvar "{{name}}". Ele será desconectado na próxima vez que o Keyring abrir. |
| `ApproveCancelled` | Nothing was connected. | Rien n'a été connecté. | Nada foi conectado. |
| `RevokeRefused` | Your VTA didn't accept the revoke for "{{name}}". | Votre VTA n'a pas accepté la révocation de « {{name}} ». | Seu VTA não aceitou a revogação de "{{name}}". |
| `MemoryRefused` | Your VTA didn't accept this memory. | Votre VTA n'a pas accepté ce souvenir. | Seu VTA não aceitou esta memória. |
| `MemoryNoManager` | Keyring isn't signed in to your VTA, so this memory wasn't saved. | Keyring n'est pas connecté à votre VTA, donc ce souvenir n'a pas été enregistré. | O Keyring não está conectado ao seu VTA, então esta memória não foi salva. |

The flow's `failed` and `cancelled` states carry these keys; `revokeHcpGrant` returns `RevokeRefused` on a
refusal; `addHcpMemory` returns `MemoryRefused` on a refusal. `copy.test.ts` holds the new keys to the same rules
(three languages, same placeholders, no "try again" in any of these).

### 1.6 `addHcpMemory` reads the manager DID itself

`managerDid` is no longer an input. `addHcpMemory(deps: { port; session; clock }, { text, language })` reads
`session.getState().managerDid` when it builds the payload, as `administratorSigner` in `../services.ts` does
(read it; do not edit it). Missing (`undefined`), it sends nothing and returns `{ ok: false, noManager: true }`
with key `MemoryNoManager`. Test: missing gives no call. **Control:** present gives the payload with that DID as
`subject.id` and `assertedBy.id`.

### 1.7 The notice keeps its last `usableUntil`

`HcpNoticeState`'s `telling` arm becomes `{ state: 'telling'; lastPolledAt?: string; lastUsableUntil?: string }`.
`pollHcpNotice` writes `lastUsableUntil` whenever a summary carries a non-null `usableUntil`, and the 24-hour stop
reads it from the record, not from the hook. Test: a poll, a fresh store over the same records (a restart), the
stop: the settled `notTold.usableUntil` is the same as without the restart. **Control:** with the field not
written, that test fails.

## Part 2: the rung checks track C's link, number and consent shapes offline

**Base:** #1093's branch after part 1 (the files part 2 reads exist there). **Branch:** `hcp/rung-c-shapes`.
Its PR's base is `feat/agent-connect`; it states that it stacks on #1093.

An independent JavaScript implementation in the rung of the three interfaces the track C brief fixed, held to
Keyring's TypeScript one in both directions. The rung's CI job runs it.

1. **`rung/hcp/link.mjs`**: `hcpConnectLink({ clientVid, uuid })` and `readHcpConnectLink(text)`, written from the
   brief's "The connect link" section, not from Keyring's code. Same rules: the three members, the two `_type`
   forms, did:key and v4 UUID patterns, at most 251 bytes.
2. **`rung/hcp/number.mjs`**: `hcpMatchNumber(threadId, clientVid)` with `@noble/hashes` (already a rung
   dependency).
3. **`rung/hcp/consent.mjs`**: `hcpConsentRequest({ clientVid, clientName, operator, threadId, grantId, access,
   maxUseSeconds, heldAt, challenge, payloadDigest })` returns the `task-consent/request/0.1` **payload** the VTA
   sends: `taskType` `https://trusttasks.org/spec/hcp/grants/request/0.1`, `requester` the client's VID, the five
   effects of the brief in order with their `summary` and `detail`, `expiresAt` = `heldAt` + 5 minutes, and the
   framework members the schema requires (`challenge`, `payloadDigest`, `sideEffects: "mutating"`,
   `exposure: { "discloses": "secret", "actsAsSubject": false }`, `approverSet: "owner"`, `minApprovals: 1`,
   `excludeRequester: true`). **Decided here** for the framework members, and track A builds to them.
4. **`rung/fixtures/hcp-match-number.json`**: the five vectors, the same content as Keyring's
   `hcp/__tests__/vectors/match-number.json`.
5. **`rung/fixtures/hcp-consent-request.json`**: `hcpConsentRequest` with fixed inputs, the match-number vectors'
   first case (`urn:uuid:7c2a9e41-5b3d-4f6a-8e1c-0a9b8d7c6e51`, the first `did:key`), written by a script mode
   `node hcp/consent.mjs --record`.
6. **`rung/hcp/hcp.test.mjs`**:
   - every vector, and the record equals Keyring's vectors file, read from
     `../../packages/core/src/modules/connected-agents/hcp/__tests__/vectors/match-number.json` with an
     `assert.ok` that the file was found (a missing file fails, never skips);
   - the link round trip, each refusal, and the measured 166 bytes;
   - the five effect kinds equal Keyring's `HCP_EFFECT_KINDS`, read from `hcp/types.ts` by a regular expression,
     with an `assert.ok` that the declaration was found (as the `AGENT_PURPOSES` test does);
   - the consent fixture equals what `hcpConsentRequest` gives for its inputs;
   - **controls:** one changed vector, one reordered kind, one extra link member each fail.
7. **`hcp/__tests__/rungConsent.test.ts`** (the one Keyring file of this part): reads
   `tsp-reference/ref-25-agent-pairing/fixtures/hcp-consent-request.json`; validates it with Ajv against VTI's
   `task-consent/request/0.1` schema; runs track C's `readHcpEffects` and `findHcpApproval` (with the vectors'
   first link) on it, and both accept it. **Control:** the fixture with `expiresAt` in the past is not found.
8. **`hcp/__tests__/fixtures/vti-task-consent-97fda9813/`**: `vti-specs-core/trust-tasks/task-consent/request/0.1.bundle.json`
   from `OpenVTC/verifiable-trust-infrastructure` at `97fda9813` (vta-service-v0.84.0), with `PROVENANCE.sha` and a
   README naming the source path and the Apache-2.0 licence of VTI. The test validates against the bundle's
   `schema` member.
9. **`rung/README.md`**: one section, "Track C's interfaces, checked offline", saying what the three files hold
   and that a test holds each to Keyring's; and the `npm test` count line set to the number the rung's CI job
   prints for this branch (read the job's log; never compute it by hand).

## Part 3: C4, "What my agent saw" (P1)

**Base:** `feat/agent-connect` after the track C stack has merged, or #1093's branch until then (say which in
the PR). **Branch:** `hcp/c4-what-it-saw`.

What one agent read and what happened to its grant, from two Management Client reads, as a view model. Copy:
companion finding 6 ("What my agent saw") and the plan §6 placement Brendan decided ("Read your <category> to
<purpose description>").

### The reads

- `hcp/whatItSaw/audit.ts`: `readHcpAudit(port, { client: clientVid, limit: 100, cursor? })` sends
  `hcp/audit/read/0.1` `{ client, limit }` and follows `nextCursor` until it is absent or 500 events have been
  read. **Decided here:** 500 events is the most one view reads; beyond that the view says the list is cut
  (`WhatItSawMore`).
- `hcp/whatItSaw/summary.ts`: `readHcpSummary(port, clientVid)` sends `hcp/disclosures/summary/0.1`
  `{ client: clientVid }` and returns the `clients[]` entry whose `client.id` equals `clientVid`, or none.

### The view (`hcp/whatItSaw/view.ts`)

`hcpWhatItSawView(name, events, summary, now)` returns:

- `title`: `WhatItSawTitle` `{ name }` ("What "<name>" saw").
- `summaryLine`, from the summary entry: `WhatItSawSummary` `{ n: retrievals, categories, last: lastAt, until:
  usableUntil }`, where `categories` is the categories' labels joined by the language's list form (see labels).
  No summary entry, or `retrievals: 0`: no summary line.
- `rows`, newest first, one per event the view knows:
  - `context.read`: one row per category in the event's `categories`: `WhatItSawRead` `{ category: label,
    purpose: description, time: timestamp }` ("Read your <category> to <purpose description>").
  - `grant.issued`: `WhatItSawConnected` `{ time }`; `grant.revoked`: `WhatItSawRevoked` `{ time }`;
    `revocation.notified`: `WhatItSawTold` `{ time }`.
  - Every other event type is not shown. **Decided here:** they are governance events of other features, and the
    copy names only these.
- `empty`: `WhatItSawEmpty` ("It hasn't read anything yet.") when there is no `context.read` row.
- On `unreachable` from either read: `error: WhatItSawUnreachable` ("We couldn't reach your VTA, so this list may
  be out of date."), with whatever the other read returned. On a refusal: `WhatItSawRefused`, no retry.
- Only events whose `grantId` is one of this agent's grants are shown. **Decided here:** the client's VID filters
  the read, and the record's `grantId` filters the rows again, so a second grant of the same client under another
  name is not mixed in.

### Labels (`hcp/whatItSaw/labels.ts`)

**Decided here, PROPOSED:** the plain-language category labels the plan says are needed. One per HCP 4.5
registered category, used lower-case after "your":

| Category | en | fr | pt-br |
|---|---|---|---|
| `general_preferences` | general preferences | préférences générales | preferências gerais |
| `goals_and_constraints` | goals and limits | objectifs et contraintes | objetivos e limites |
| `health_context` | health information | informations de santé | informações de saúde |
| `education_learner_profile` | learning profile | profil d'apprentissage | perfil de aprendizagem |
| `work_context` | work | travail | trabalho |
| `purchase_history_preferences` | shopping preferences | préférences d'achat | preferências de compras |
| `values_and_ethics` | values | valeurs | valores |
| `location_context` | location preferences | préférences de lieu | preferências de localização |
| `coordination_context` | scheduling preferences | préférences d'agenda | preferências de agenda |

An unregistered category reads `other information` / `autres informations` / `outras informações`.

**Purpose descriptions**, lower-cased from plan §6: `personalisation` "personalize its answers for you",
`taskExecution` "do the tasks you ask of it" (French and Portuguese PROPOSED). A purpose IRI is matched by its
D44 path, `https://registry.trustoverip.org/dtg/purpose/<name>/<n>`, on `<name>` alone, whatever `<n>` is.
Anything else reads `for another purpose` (PROPOSED), never the raw IRI.

### Copy (`hcp/whatItSaw/copy.ts`)

| Key | en | Source |
|---|---|---|
| `WhatItSawTitle` | What "{{name}}" saw | companion finding 6 |
| `WhatItSawSummary` | {{n}} reads of {{categories}}, last at {{last}}. It can use what it read until {{until}}. | companion finding 6 |
| `WhatItSawRead` | Read your {{category}} to {{purpose}}, {{time}} | plan §6 (the placement Brendan decided) |
| `WhatItSawConnected` | Connected, {{time}} | companion finding 6 ("Connected"), the time PROPOSED |
| `WhatItSawRevoked` | Revoked, {{time}} | as above |
| `WhatItSawTold` | Told it was revoked, {{time}} | as above |
| `WhatItSawEmpty` | It hasn't read anything yet. | companion finding 6 |
| `WhatItSawUnreachable` | We couldn't reach your VTA, so this list may be out of date. | companion finding 6 |
| `WhatItSawRefused` | Your VTA didn't share this list. | PROPOSED |
| `WhatItSawMore` | Showing the latest 500. | PROPOSED |

French and Portuguese for every key are the writer's, marked PROPOSED, under the same rules as track C's
`copy.ts`.

### Tests

Requests and responses validate against the vendored `audit/read` and `disclosures/summary` schemas; the row
mapping per event type; the grant filter; newest first; the 500 cut; empty; unreachable and refusal kept apart;
every label in three languages; an unknown purpose never shows its IRI. **Control:** an event of another grant
appears if the filter is removed.

## Part 4: C5, "Answers on" (P1)

**Base:** as part 3. **Branch:** `hcp/c5-answers-on`.

The switch on an HCP agent that lets it answer other people. It writes an HCP directive; the plugin applies it in
code (track B, not here). Copy: the plan's §6 copy for "Answers other people" (7.14) is kept, per finding 6.

### What HCP allows, and therefore what the switch can do (read this first)

- A directive is set with `hcp/directives/set/0.1` `{ action, effect, text, operators? }`.
- HCP 6.4: where two directives that apply disagree, `deny` prevails over `permit`. Removing a directive
  (`hcp/directives/remove`) is P2 (the companion's finding 11, V2 = H2), so it does not exist yet.
- So: **On** sets a `permit` directive. **Off** sets a `deny` directive, and from then on the switch **cannot be
  turned on again** until `directives/remove` exists: a later `permit` would lose to the `deny`.
- **Decided here:** the view model has three states. `off` (no directive was ever set: a client that does not
  recognize the action never treats it as permission, HCP 6.4), `on` (a `permit` was set), and `offForGood` (a
  `deny` was set: the switch shows off and disabled, with `AnswersOnLocked`). Turning off asks first, with
  `AnswersOffConfirm`, because it cannot be undone in P1.

### The directive (`hcp/answersOn/directive.ts`)

- **Decided here, PROPOSED:** `action` is the constant `HCP_ANSWERS_OTHERS_ACTION =
  'https://registry.trustoverip.org/dtg/directive-action/answerOthers/1'`, defined once in this file and switched by
  configuration if the registry names it otherwise. The plan writes it `<directive-action-iri>`: its registry home
  is an editor question (N8).
- `text`: on, "You may answer other people in rooms you've been added to."; off, "Don't answer other people." in
  the person's current language (the strings are in `copy.ts`, keys `AnswersOnDirectiveText` and
  `AnswersOffDirectiveText`). HCP requires `text` in the person's own words, shown to them when it is set: the
  view model shows it on the confirmation.
- `operators`: the grant's Client Operator id (from the record's approval detail), so the directive applies to
  this agent's operator only. **Decided here.**
- `categories`: absent (every category).
- `setHcpAnswers(port, { operatorId, on, language })` returns the directive's `directiveId` or a refusal,
  `unreachable`, or `off`.

### The state (`hcp/answersOn/store.ts`)

The provider cannot be asked which directives are set (`directives/list` is P2). **Decided here:** Keyring keeps
its own record per connection: generic keyed records, `recordType: 'keyring/hcp-answers'`, key = the
connection's `id`, `{ state: 'on' | 'offForGood', directiveId, setAt }`. No record means `off`. A record is
written only after the provider answered success.

### Copy (`hcp/answersOn/copy.ts`)

The row and its confirmation are the plan's own §6 words for "Answers other people" (7.14). Two additions are
PROPOSED, because HCP makes Off final in P1 where the base path's Off is not.

| Key | en | Source |
|---|---|---|
| `AnswersRow` | Answers other people | plan §6 |
| `AnswersValueOff` | Off | plan §6 |
| `AnswersValueOn` | On | plan §6 |
| `AnswersHelpOff` | Anyone but you who mentions {{name}} gets a fixed reply that it can't respond to others. | plan §6 |
| `AnswersHelpOn` | {{name}} also acts on mentions from other people in rooms you added it to. | plan §6 |
| `AnswersOnTitle` | Let "{{name}}" answer other people? | plan §6 |
| `AnswersOnBody` | Anyone in a room can then ask it to do things by mentioning it. It could be tricked into using your memory or posting for you, and your phone cannot prevent that. | plan §6 |
| `AnswersOnConfirm` | Turn on | plan §6 |
| `AnswersOnKeep` | Keep it off | plan §6 |
| `AnswersOffConfirm` | Turn off answers for "{{name}}"? You can't turn them back on for this connection yet. | PROPOSED, and it departs from plan §6 ("Turning it off needs no confirmation"): on the HCP path an Off cannot be undone in P1 |
| `AnswersLocked` | Off for this connection. Connect it again to change this. | PROPOSED |
| `AnswersOnDirectiveText` | You may answer other people in rooms you've been added to. | PROPOSED |
| `AnswersOffDirectiveText` | Don't answer other people. | PROPOSED |
| `AnswersRefused` | Your VTA didn't accept this change. | PROPOSED |
| `AnswersUnreachable` | We couldn't reach your VTA, so nothing changed. | PROPOSED |

French and Portuguese for every key are PROPOSED.

### Tests

The payload validates against the vendored `directives/set` schema for both effects; on, then off, then on is
refused by the view model before any call; the record is written only on success; `operators` is the record's
operator. **Control:** a `permit` sent after a `deny` is never produced.

## Part 5: C10, memories on HCP: only what can be built now

**Not ready, and why, stated plainly.** C10 is the memories list by `entries/get`, Delete memory by
`entries/withdraw`, and edit by `entries/revise`. At the suite commit, **all three require `accessToken`**, even
from a Management Client (`entries/withdraw` `required: ["reason", "accessToken"]`; `entries/revise` and
`entries/get` likewise). Keyring as Management Client has no access token: it authenticates as the administrator
DID with a document proof, a declared demo divergence (plan D2 in the companion's finding 12). Giving Keyring one
is a VTI design decision (track A and the VTI plan), not a Keyring one, and plan §11 Q9 (whether HCP memories and
`vta/memory/*` merge) is also open. So this part builds no C10 call.

**What part 5 does build:** the decision record and the seam, so that C10 is a small change once the token
question is answered.

- `hcp/memories/management.ts`: the type `HcpManagementToken = { token: string } | { none: true }` and
  `export function hcpManagementCall(port, type, payload, token)` that adds `accessToken` only when a token is
  given, and otherwise returns `{ ok: false, needsToken: true }` **without sending** for the three tasks above.
  The three type URIs as constants with the `version-pinned` comment. No call site.
- `hcp/memories/copy.ts`: `MemoriesNeedVtaUpdate`, "Your VTA can't change memories for this agent yet."
  (PROPOSED), for a future screen.
- Tests: each of the three tasks without a token sends nothing and returns `needsToken`; with a token, the payload
  carries it and validates against the vendored schema (part 1 vendors the three, so part 5 writes no fixture).
- **Do not build:** any list, delete or edit flow, any store, any change to `deleteMemory.ts` (Brendan's 7.16,
  another lane), any merge of the two memory stores.
- The PR description names the open decision in one line: "C10 needs a Management Client access token from the
  VTA, or a change to the suite's `accessToken` requirement for a Management Client, and an answer to plan §11 Q9."

**Smaller than the others**, about an hour. If the backlog needs a full part instead, skip part 5 and say so.

## Order and sizes

| Part | About | Depends on |
|---|---|---|
| 1 | 3 h | the track C stack (#1091 to #1093) |
| 2 | 2.5 h | part 1 |
| 3 | 3 h | part 1 (the vendored schemas) |
| 4 | 2.5 h | part 1 |
| 5 | 1 h | part 1 |

Parts 3, 4 and 5 are independent of one another and can be done in any order after part 1.


---

# Section C: views behind the flags, unreachable (U1 to U5)

# Agent connect backlog: the UI/UX lane's parts (views behind the flags, unreachable)

Written 2026-11-27 by the UI/UX lane (eb), owner of how agent connect is drawn. For work done without the chance to
ask questions: every open point is decided here ("Decided here"). If you meet something this brief does not cover,
stop that piece, say what you met in the PR, and carry on with the rest. Your PRs come to eb for the frame check
and to the review lane (ac) for review.

Sources: the plan `docs/plans/agent-connect-plan.md` (§6 copy, §6 "HCP lane screens", §7.7, §7.16, §8.6 the
screenshot rule), its companion `2026-11-26-al-6.md` (findings 17 to 20, agreed by relay), the UI/UX canvas
(`docs/plans/agent-connect-plan/canvas/`, frames by file name below), track C's view models (PRs #1091 to #1093),
#1090 (delete memory logic), and Keyring at `feat/agent-connect` `98ce15111`.

## Files each part writes (no two parts write the same file, and none writes another lane's)

| Part | Creates | Edits |
|---|---|---|
| 0 (eb, PR #1094, lands first) | `__tests__/fixtures/wordSource.ts` | `__tests__/screenCatalogue.test.tsx`, the three locale files (`ConnectedAgents` block), `proposedCopy.ts` |
| U1 HCP approve | `hcp/screens/useHcpCopy.ts`, `hcp/screens/HcpApproveView.tsx`, `hcp/screens/HcpConnectFlowView.tsx`, `hcp/screens/__tests__/HcpApproveView.test.tsx`, `__tests__/fixtures/hcpWordSource.ts`, `__tests__/fixtures/screenStatesHcpApprove.tsx`, `e2e/lib/agent-connect-screens.hcp-approve.json` | none |
| U2 HCP list, revoke, notice | `hcp/screens/HcpAgentListView.tsx`, `hcp/screens/HcpRevokeSheet.tsx`, `hcp/screens/HcpNoticeLine.tsx`, `hcp/screens/__tests__/HcpListRevoke.test.tsx`, `__tests__/fixtures/screenStatesHcpList.tsx`, `e2e/lib/agent-connect-screens.hcp-list.json` | none |
| U3 HCP new memory | `hcp/screens/HcpNewMemoryView.tsx`, `hcp/screens/__tests__/HcpNewMemoryView.test.tsx`, `__tests__/fixtures/screenStatesHcpMemory.tsx`, `e2e/lib/agent-connect-screens.hcp-memory.json` | none |
| U4 delete memory (7.16) | `screens/MemoriesListView.tsx`, `screens/DeleteMemorySheet.tsx`, `__tests__/deleteMemoryViews.test.tsx`, `__tests__/fixtures/screenStatesDelete.tsx`, `e2e/lib/agent-connect-screens.delete.json` | none |
| U5 "Acting as" (finding 18) | `components/ActingAsRow.tsx`, `__tests__/actingAs.test.tsx`, `__tests__/fixtures/screenStatesActingAs.tsx`, `e2e/lib/agent-connect-screens.acting-as.json` | `screens/ConnectAgentForm.tsx` only |

All paths under `packages/core/src/modules/connected-agents/` unless they start with `e2e/`.

**Generated files, the one exception:** a part that adds a testID regenerates `packages/core/testids.json` (`cd
packages/core && yarn testids`) and `e2e/lib/testids.json` (`bash e2e/scripts/sync-testids.sh`). Both are
generated: never edit or hand-merge them. If two parts' manifests collide on a merge, regenerate on the merged tree
and commit the result; `node scripts/gen-testids.mjs --check` and `node e2e/scripts/check-testids.mjs` must pass.

## Do not touch

- Everything in `connected-agents/screens/` and `connected-agents/components/` that exists today (eb's views:
  `ConnectAgentForm` is the one exception, for U5 only), `proposedCopy.ts`, `failureCopy.ts`, and every existing file
  in `__tests__/` and `__tests__/fixtures/` (including `screenCatalogue.test.tsx`, `components.test.tsx`,
  `releaseGate.test.ts`, `screenStates.tsx`, `wordSource.ts`).
- All of `hcp/` that is not under `hcp/screens/` (track C's logic: import from it, never edit it).
- `deleteMemory.ts`, `memories.ts`, `revoke.ts`, `types.ts`, `status.ts`, `store.ts`, `actions.ts`, `services.ts`,
  `ConnectedAgentsProvider.tsx`, `agentConnectFlag.ts`, `hcp/hcpFlag.ts`.
- `packages/core/src/localization/**` (part 0 adds every word these parts need), `packages/core/src/navigators/**`,
  `container-*.ts`, `index.ts`, `e2e/lib/agent-connect-screens.json` (the base manifest), `docs/**`, `scripts/**`,
  `.github/**`, any `package.json` or lock file, `packages/core/tsc-baseline.txt`.

## Rules every part follows

- **Unreachable.** No route, no tab, no navigator import, no container registration, no call to
  `setAgentConnectEnabled` or `setHcpEnabled`. The reachability test in `components.test.tsx` passes unchanged
  (only `container-impl` and `triggerLink` reach into the module from outside), and so does the release gate.
- **Views, not logic.** A view takes data and callbacks as props, and never imports a logic module's action
  (`revokeHcpGrant`, `addHcpMemory`, `deleteMemory`, `previewDelete`, the approve flow's methods). Types may be
  imported.
- **Times.** View models carry ISO-8601 instants. Every view that shows a time takes `formatTime: (iso: string) =>
  string` as a prop. Fixtures pass `(iso) => iso.slice(11, 16)`.
- **Words.**
  - Base words come through `t('ConnectedAgents.…')` (and `Global.Close`, `Global.Continue`, `Global.Cancel`), all
    already in the locale files after part 0.
  - HCP words come through `hcp/copy.ts`'s `hcpText`, via U1's `useHcpCopy()`.
  - No part adds a string anywhere. If one seems missing, stop that piece and say so.
- **The face or fingerprint check** is a prop, `confirm: () => Promise<boolean>`. Approve happens only when it
  resolves exactly `true`: once while a check is open, and spent after success. That's ApproveView's contract
  (`screens/ApproveView.tsx`); read it and its tests, and copy the shape, not the file.
- **testIDs** are literal strings in `testIdWithKey('…')`, never built from a template.
- **Canvas.** Build to the frame named for each view (§8.6: the canvas is the design, D41). Where a part needs a
  frame the canvas doesn't have yet, eb draws it first, as named below. Don't build that piece from a guess.

## Checks every part passes before it is marked ready for review

Run from the repository root unless said otherwise. List each command and its result in the PR description.

1. `cd packages/core && TZ=GMT yarn jest src/modules/connected-agents`. This runs the whole module, including
   `screenCatalogue.test.tsx`, `components.test.tsx` and `releaseGate.test.ts`, unchanged. On a multi-file run, read
   `Tests: N failed` and the `●` blocks, never `✕` (it isn't printed).
2. `node scripts/tsc-ratchet.mjs --package packages/core --project tsconfig.ratchet.json`. The baseline (156) must not
   grow; add no line.
3. Prettier and eslint in CI's own form:
   - ``git diff --name-only <base>...HEAD | grep -E '^packages/' | xargs yarn exec prettier --check --config packages/.prettierrc --ignore-path packages/.prettierignore``
   - `yarn exec prettier --check` on your `e2e/lib/agent-connect-screens.*.json`
   - `yarn eslint` on your `.ts`/`.tsx`.
4. The testIDs: regenerate both files (above). `--check` and `check-testids` pass.
5. **Catalogue entries.** Every state your views draw has an entry in your manifest file and a drawing in your
   `screenStates*.tsx`. Each entry has:
   - its marker (a testID key) and its steps;
   - its frame and kit file, or a `noFrame` reason;
   - its words: every `ConnectedAgents.*`/`Global.*` key or `Hcp.*` id it shows, and nothing else;
   - `frameOnly`/`appOnly` for every difference from its frame, each with a reason;
   - `noWords` only for a state with no words.
   Every new file names `"canvas": "docs/plans/agent-connect-plan/canvas/"` and `"kit": "docs/plans/agent-connect-plan/mockups/"`.
6. **Controls that bite.** Each new test file has at least one `// control:` case. The PR description records, per
   file, one change to the source that made a named test fail before it was put back.
7. Commits are signed, with `Signed-off-by:` as the last line and no agent trailers. One draft PR per part.

## Bases

Part 0 (#1094) and the canvas export (#1095, frames 57 and 58) land on `feat/agent-connect` first. Every part starts by
taking the `feat/agent-connect` tip that carries both.

| Part | Base branch | Then |
|---|---|---|
| U1 | #1093's branch `bb/T20261127053928-6635f1-track-order-part-c2` (head `02828bf26`) | merge the `feat/agent-connect` tip into it (signed merge), then branch `ui/hcp-approve-views` |
| U2 | U1's branch | `ui/hcp-list-revoke-views`; PR base = U1's branch |
| U3 | U2's branch | `ui/hcp-new-memory-view`; PR base = U2's branch |
| U4 | #1090's branch `bb/T20261127035103-e4d4b0-process-fixes-keyring-sent` (head `bf9bdf49c`) | merge the tip, then `ui/delete-memory-views` |
| U5 | `feat/agent-connect` tip | `ui/acting-as-row` |

U2 and U3 stack on U1 because they import U1's `useHcpCopy.ts` and `hcpWordSource.ts`.

---

## Part U1: the HCP approve flow, as views (canvas frame `50-hcp-approve.png`)

**Interfaces** (#1093, head `02828bf26`, `hcp/`):
- `approveFlow.ts`: `HcpApproveState`, the union `idle | locked | waiting | expired | wrongNumber | numberEntry |
  approve | approving | approved | failed | cancelled`.
- `types.ts`: `HcpApprovalView`, with `title {key:'ApproveTitle', params:{name}}`, `rows: string[]`,
  `warning {key:'ApproveOwnTerminal'}`, `approve {key:'Approve'}` and `expiresInSeconds`.
- `copy.ts`: `hcpText(key, lang, params)`, `HcpCopyKey`, `HCP_COPY`.

**Files.**
- `hcp/screens/useHcpCopy.ts`: `useHcpCopy(): (key: HcpCopyKey, params?: Record<string,string>) => string`.
  It calls `hcpText` with the language mapped from i18next's `i18n.language`: `fr*` → `fr`, `pt*` → `ptBr`, anything
  else → `en`. Export the mapping as `hcpLanguageOf(language: string)`.
- `hcp/screens/HcpApproveView.tsx`: props `{ name, view: HcpApprovalView, until: string, busy?: boolean, confirm,
  onApprove: () => void }`.
  - Draws `ApproveTitle`, then `view.rows` verbatim, one row each, in order: they're the VTA's effect summaries,
    data, not words.
  - Then the warning box (`ApproveOwnTerminal`, using `components/ConnectNotice` with `tone="warn"`), then the
    button `Approve`.
  - The face-or-fingerprint contract above applies.
  - testIDs: `HcpApprove`, `HcpApproveRow`, `HcpApproveButton`.
- `hcp/screens/HcpConnectFlowView.tsx`: props `{ state: HcpApproveState, name, until, confirm, onApprove,
  onSubmitNumber: (digits: string) => void, onCancel, onClose, onSeeDetails }`. Draws one view per state:

| state | draws | words |
|---|---|---|
| `idle`, `waiting` | a spinner, busy, no words (testID `HcpConnectWaiting`) | none |
| `numberEntry` | `screens/ConnectNumberView` with `cells={4}` | its own (four-digit form) |
| `approve` | `HcpApproveView` | as above |
| `approving` | `HcpApproveView` with `busy` (button disabled) | as above |
| `approved` | `screens/ConnectedView` with `onSeeDetails` (no `onOpenChat`, no `onKeepConnected`) | its own |
| `expired`, `wrongNumber`, `locked` | `ConnectNotice` with `hcpText(state.message.key, …)` (locked: `{ n: String(minutes) }`) and `Global.Close` | `Hcp.CodeExpired` / `Hcp.WrongNumber` / `Hcp.Locked` |
| `failed` | `ConnectNotice` with `t('ConnectedAgents.FailGeneric')` and `Global.Close` | `ConnectedAgents.FailGeneric` |
| `cancelled` | nothing (`null`); the caller has closed | none |

- `__tests__/fixtures/hcpWordSource.ts`: exports `HCP_WORD_SOURCE: WordSource` (type from `fixtures/wordSource.ts`).
  - `prefix: 'Hcp.'`.
  - `wordOf(text)` returns `'Hcp.' + key` when `text` matches `HCP_COPY[key].en` with each `{{x}}` as `.+`, whole
    string, else `undefined`. If two keys match, take the one with no placeholders.
  - `exists(word)` is `word.slice(4) in HCP_COPY`.
  - **Derived, never written out** (the contract in `wordSource.ts`): build `wordOf` from `HCP_COPY`'s English
    texts only; no literal text-to-id map.
  - **Fails on identical texts:** export `buildHcpWordSource(table)`. Building `HCP_WORD_SOURCE` calls it on
    `HCP_COPY` and throws, naming both keys, if two keys share the same English text (after placeholders become
    wildcards, two templates that match one another count as identical). It throws at load, so the catalogue fails
    rather than resolving to whichever key came first.
- `__tests__/fixtures/screenStatesHcpApprove.tsx`: exports `SCREEN_STATES` (one drawing per state above) and
  `WORD_SOURCES = [HCP_WORD_SOURCE]`.
- `e2e/lib/agent-connect-screens.hcp-approve.json`: one entry per state (ids `hcp-approve-…`). `approve` and
  `approving` name frame `50-hcp-approve.png`; the others are `noFrame` with the reason "the HCP lane draws only
  Approve; this state uses the base path's layout".

**Decided here.**
- The number step reuses the base view with four cells; HCP's number is four digits (`hcp/matchNumber.ts`).
- `failed` uses the base `FailGeneric`, since HCP's copy has no generic failure.
- `approved` reuses Done ("See details", no chat), because no HCP frame draws it.
- The rows are not words: the catalogue doesn't list them.
- The frame's canvas note and its "HCP lane: behind the flag" band are canvas-only, so record them as `frameOnly`.

**Tests** (`HcpApproveView.test.tsx`):
- each state draws what the table says;
- Approve never happens unless `confirm()` resolves exactly `true`, and happens once (copy ApproveView's tests);
- `hcpLanguageOf` maps `fr-FR` → `fr`, `pt-BR` → `ptBr`, `de` → `en`;
- `hcpWordSource` maps an `Hcp.Locked` text with a number back to `Hcp.Locked`, with a control that `"Some name"`
  maps to nothing;
- `buildHcpWordSource` on a table with two keys of the same English text throws, naming both, and builds on
  `HCP_COPY` without throwing.

## Part U2: the HCP agent list, the revoke sheet and the notice lines (frames `52-hcp-agent-list.png`, `54-hcp-revoke.png`, `55-hcp-revoke-states.png`)

**Interfaces** (#1093):
- `types.ts`: `HcpConnection`, `HcpNoticeState`.
- `status.ts`: `hcpStatus(c, now)` → `StatusRevoked` (with `notice: HcpNoticeLine`) | `StatusExpired` |
  `StatusConnectedUntil {time}`; `hcpNoticeLine(c)`.
- `revoke.ts`: the type `HcpRevokeResult`.

**Files.**
- `hcp/screens/HcpNoticeLine.tsx`: props `{ line: HcpNoticeLine, formatTime }`. Draws `RevokeTelling`, `RevokeTold`
  or `RevokeNotTold` through `useHcpCopy`, with `time` formatted. testID `HcpNoticeLine`.
- `hcp/screens/HcpAgentListView.tsx`: props `{ connections?: HcpConnection[], now: Date, formatTime, onOpen(id),
  onRevoke?(id), onConnect }`.
  - One card per connection, like the base list (`screens/AgentListView`: the robot, the name, the status in words
    from `hcpStatus`).
  - A revoked row adds its `HcpNoticeLine` under the status (Brendan, 2026-11-25: the after-revoke line is a status
    line on the list row and the details).
  - `Revoke` shows only on `StatusConnectedUntil`, and only when `onRevoke` is given.
  - `Connect an agent` at the bottom (`ConnectedAgents.ConnectAnAgent`).
  - testIDs `HcpAgentList`, `HcpAgentRow`, `HcpAgentRowRevoke`, `HcpAgentListConnect`.
- `hcp/screens/HcpRevokeSheet.tsx`: props `{ name, onRevoke: () => Promise<HcpRevokeResult>, onKeep, onDone }`.
  - Draws `RevokeTitle`, `RevokeBody`, `Revoke` (danger-filled), `Keep` (outlined), as frame 54.
  - On `ok` it calls `onDone`. On `unreachable` it shows `RevokeUnreachable` (from the result's message) with
    `Revoke` still there to press again. On `missing` or `refused` it shows `ConnectedAgents.FailGeneric`.
  - Once while a revoke is open.
  - testIDs `HcpRevokeSheet`, `HcpRevokeConfirm`, `HcpRevokeKeep`, `HcpRevokeOutcome`.
- Fixtures and manifest:
  - states `hcp-list` (frame 52);
  - `hcp-list-revoked-telling`, `-told`, `-not-told` (frame 55);
  - `hcp-revoke` (frame 54);
  - `hcp-revoke-unreachable` (frame 54, `appOnly` the line).

**Decided here.**
- "What it saw" (frame 52) is P1 (step 7.29): `frameOnly` with that reason.
- The HCP list is a separate view from the base list; whether one screen shows both is the wiring's decision, not
  this part's.
- Frame 55 draws the three lines on a details card. This part draws them on the list row, as the 2026-11-25 decision
  allows, and records "drawn on the list row; the details placement comes with the wiring" as `frameOnly`.

**Tests** (`HcpListRevoke.test.tsx`):
- the status for each of `hcpStatus`'s three cases, and the three notice lines with formatted times;
- Revoke only on a connected row, and only with a handler;
- the sheet's outcomes, and once-while-open;
- a control that a revoked row has no Revoke.

## Part U3: the HCP new memory (frame `51-hcp-new-memory.png`)

**Interfaces** (#1093, `newMemory.ts`): `HcpAddMemoryResult`, `hcpMemoryTextValid(text)`, `HCP_MEMORY_MAX_CHARS`
(4096).

**Files.** `hcp/screens/HcpNewMemoryView.tsx`, props `{ name, onSave: (text: string) => Promise<HcpAddMemoryResult>,
onDone }`.
- Draws `NewMemoryTitle {name}`, the field labelled `NewMemoryField` (multiline, `maxLength`
  `HCP_MEMORY_MAX_CHARS`), `NewMemoryHelper` and `NewMemorySave`.
- Save is disabled until `hcpMemoryTextValid(text)`.
- `ok` → `onDone`. `unreachable` → `MemoryNotSaved`, keeping the text. `invalid` or `refused` →
  `ConnectedAgents.FailGeneric`, keeping the text.
- Once while a save is open.
- testIDs `HcpNewMemory`, `HcpNewMemoryField`, `HcpNewMemorySave`, `HcpNewMemoryOutcome`.
- Fixtures and manifest: states `hcp-new-memory` (frame 51) and `hcp-new-memory-not-saved` (frame 51, `appOnly` the
  line).

**Decided here.**
- Where it opens from (the details, under "What <name> remembers", decided 2026-11-25) is the wiring's, not this
  part's.
- The frame's `<title>` stand-in is `frameOnly`: the header is set by the navigator.

**Tests:**
- Save off for an empty or over-long text, on for a valid one (control);
- each outcome; the text is kept on failure; once-while-open.

## Part U4: delete a memory, step 7.16 (frames `23-delete-memory.png`, `57-memories-list.png`)

**Interfaces** (#1090, head `bf9bdf49c`, `deleteMemory.ts`):
- `DeletePreview`: `{ok:true, count: MemoryCount, overWarning, agents: {subject,name}[]} | {ok:false, code:'unreachable'}`.
- `DeleteMemoryResult`: `{ok:true, recordsNotUpdated} | {ok:false, code:'heldForApproval'|'unreachable'}`.
- `memories.ts`: `MemoryCount` (`{ok:true,count,lastChange?,complete} | {ok:false}`), `MEMORY_COUNT_WARNING`.

**Files.**
- `screens/MemoriesListView.tsx`: props `{ memories?: {id,name}[], counts?: Record<string, MemoryCount>, formatDate:
  (iso) => string, onDelete(id) }`.
  - Heading `ConnectedAgents.MemoriesTitle`.
  - One row per memory: its name, its count line, and a `Delete` link (`ConnectedAgents.Delete`, danger colour).
  - The count line uses the same keys as the details: `MemoryCount` with date, `MemoryCountNoDate`, or
    `MemoryCountFailed` when `ok:false`, plus `MemoryCountWarning` over the limit.
  - testIDs `MemoriesList`, `MemoriesListRow`, `MemoriesListDelete`.
- `screens/DeleteMemorySheet.tsx`: props `{ memory: {name}, preview: DeletePreview, onConfirm: () =>
  Promise<DeleteMemoryResult>, onKeep, onDone }`.
  - With `preview.ok`:
    - `DeleteMemoryTitle {memory}`;
    - the body `DeleteMemoryBody {count, agents}`, where `agents` is the names joined by ", " and a name of '' is
      `ConnectedAgents.UnnamedAgent`;
    - or `DeleteMemoryBodyNoAgents {count}` when `agents` is empty;
    - `MemoryCountWarning {memory, limit}` when `overWarning`;
    - `Delete` (danger-filled) and `Keep` (outlined), as frame 23.
  - With `!preview.ok`: `ConnectedAgents.FailUnreachable`, with `Keep` only.
  - Outcomes:
    - `ok` with `recordsNotUpdated === 0` → `onDone`;
    - `ok` with more than 0 → `DeleteMemoryRecordsLeft {count}`, then `Global.Close`;
    - `heldForApproval` → `DeleteMemoryHeld` and `Global.Close`, never a retry;
    - `unreachable` → `FailUnreachable`, with `Delete` still there.
  - Once while a delete is open.
  - testIDs `DeleteMemorySheet`, `DeleteMemoryConfirm`, `DeleteMemoryKeep`, `DeleteMemoryOutcome`.
- Fixtures and manifest:
  - `memories-list` (frame 57) and `memories-list-count-failed`;
  - `delete-memory` (frame 23), `delete-memory-no-agents`, `delete-memory-unnamed-agent` and `delete-memory-over-limit`;
  - `delete-memory-held`, `delete-memory-records-left` and `delete-memory-unreachable`.

**Decided here.**
- The view never sends the delete; `onConfirm` is the caller's call to `deleteMemory(…, true)` after the person
  pressed Delete.
- A count that's not `complete` shows as counted (the logic decides completeness).
- Frame `57-memories-list.png` is drawn (canvas version 45) and exported by PR #1095. This part starts from a
  `feat/agent-connect` tip that carries #1095, or the catalogue's frame-exists check fails on `memories-list`.
- The list sits in Settings and in the agent details (§7.16); placing it is the wiring's.

**Tests** (`deleteMemoryViews.test.tsx`):
- every body form (agents, none, an unnamed agent);
- the warning only over the limit, with a control at the limit;
- each outcome;
- the held words never offer to try again (the same pattern test as `components.test.tsx`'s, on
  `DeleteMemoryHeld`, in three languages, with a control);
- once-while-open; `onConfirm` never called before Delete is pressed.

## Part U5: "Acting as" (finding 18; §7.7; frame `58-acting-as.png`)

**Interfaces:** a persona as `{ did: string, name: string }`. The logic's `usePersonas()` (fb) supplies the list; this
part takes it as a prop.

**Files.**
- `components/ActingAsRow.tsx`: props `{ personas: {did,name}[], selected?: string, onSelect(did) }`.
  - Draws nothing with 0 or 1 persona.
  - With more than one: a row labelled `ConnectedAgents.ActingAs` with the chosen persona's display name (or no name
    before a choice), which opens an inline list of radio rows, one per persona by display name, the chosen one
    checked.
  - testIDs `ActingAsRow`, `ActingAsOption`.
- `screens/ConnectAgentForm.tsx`, the only edit to an existing view:
  - new optional props `personas?: {did,name}[]` (default `[]`);
  - `ConnectFormChoice` gains `ownerPersonaDid?: string`;
  - draws `ActingAsRow` above "Memory it can use";
  - with more than one persona, "Continue" stays off until one is chosen, and the choice carries `ownerPersonaDid`;
    with 0 or 1 it's left out, as today.
- Fixtures and manifest: `connect-acting-as` (frame 58) and `connect-acting-as-chosen` (frame 58).

**Decided here.**
- No persona is pre-selected with several: the plan says the connect asks, so it doesn't guess.
- No "Acting as" row with one persona.
- The words: `ActingAs` only ("Acting as", §7.7); the options are display names, which are data.
- Frame `58-acting-as.png` is drawn (canvas version 45) and exported by PR #1095. This part starts from a tip that
  carries #1095, like U4.

**Tests** (`actingAs.test.tsx`):
- no row with 0 or 1 persona (control) and a row with 2;
- Continue off until chosen with 2, on without a choice with 1;
- the choice carries `ownerPersonaDid`;
- the existing `connectViews.test.tsx` still passes unchanged.

## Done means

- One draft PR per part (U2 and U3 stacked on U1), green on the checks above and in CI. Each PR description lists:
  - what it adds;
  - the "Decided here" points it implements;
  - the checks and their output;
  - the mutation per test file;
  - anything this brief didn't cover.
- Nothing reachable. The reachability test and the release gate pass unchanged.
- eb checks each PR against its frames; ac reviews.
