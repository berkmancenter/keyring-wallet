# Step 7.27 track C: the Keyring side of the HCP demo, in three parts

A brief for work done without the chance to ask questions. Every decision is made here. Where something was
genuinely open, this brief decides it and says so ("Decided here"). If you meet something this brief does not
cover, stop that piece, leave a comment in the PR saying what you met, and carry on with the rest.

Written 2026-11-26 by the Keyring lane that builds track A (the VTA side), from the companion
`docs/plans/agent-connect-plan/2026-11-25-bam.md` (findings 5, 6, 7 and 12), the plan
`docs/plans/agent-connect-plan.md` §6, the `hcp/*` suite at `trustoverip/dtgwg-trust-tasks-tf` commit
`186773c97d43d82d3b1cf33c9d21561d0c87af5b` (the head of PR #1380, `feat/hcp-suite`), and Keyring at
`feat/agent-connect` `a93a9ddc2383c87d39a79cbe19dadffc27bd996c`.

## What this is, and is not

The Keyring side of the demo `agent-connect-p0-hcp`, work packages C0, C1, C2, C3, C6 and C7 (the P0 part) of
the companion's finding 7: Keyring as the person's approver for an HCP grant request, the 4-hour temporary grant,
a person-declared memory, and Revoke with "Telling…" / "was told at <time>" from a poll of
`hcp/disclosures/summary`.

- **Logic, ports and view models only.** No React component, no screen, no route, no tab, no testID. The
  screens are the UI/UX lane's (canvas frames `50-hcp-approve` to `55-hcp-revoke-states`). Each view model
  returns copy keys and parameters with times as ISO-8601 instants; formatting a time is the screen's job.
- **Against fakes.** Nothing here needs a running VTA. Track A is building the VTA side to the interfaces in
  "Interfaces this brief fixes" below.
- **Behind two flags.** Nothing runs unless both the agent-connect flag and a new `hcp` flag are on.
- **Not in this brief:** C4 and C5 (P1), C8 (the mockups are already drawn on the canvas, version 40+), the
  CLI (track B), and anything under `packages/core/src/localization/`.

## Parts, bases and branches

| Part | Work packages | Branch | Base | About |
|---|---|---|---|---|
| 1 | C0: flag, types, vendored schemas, the VTA port, the link, the number | `hcp/c0-foundations` | `feat/agent-connect` at its tip when you start (it was `a93a9ddc2` when this was written) | 3 h |
| 2 | C1: the approval: find, match, check the number, approve | `hcp/c1-approve` | part 1's branch | 3 h |
| 3 | C2, C3, C6: the connection record and its status, a new memory, Revoke and the notice state | `hcp/c2-c3-c6-grant` | part 2's branch | 3.5 h |

Each part is one **draft** PR into `feat/agent-connect`; parts 2 and 3 are stacked (their PR's base is the
previous part's branch). C7, the jest tests, is in each part, not a part of its own. Open each PR as draft and
leave it draft.

## Where the code goes

Every new file is under `packages/core/src/modules/connected-agents/hcp/` (source) and
`packages/core/src/modules/connected-agents/hcp/__tests__/` (tests). Vendored schemas go in
`packages/core/src/modules/connected-agents/hcp/__tests__/fixtures/hcp-suite-186773c97/`.

## Do not touch

Do not edit, rename or delete any of these. Import from them where this brief says to; that is all.

- `connected-agents/`: `actions.ts`, `services.ts`, `ConnectedAgentsProvider.tsx`, `store.ts`, `driver.ts`,
  `pairing.ts`, `carriage.ts`, `memories.ts`, `status.ts`, `types.ts`, `vdc.ts`, `revoke.ts`, `lockout.ts`,
  `agentConnectFlag.ts`, `deleteMemory.ts`, `proposedCopy.ts`, `failureCopy.ts`, everything in `screens/`
  and `components/`, and every existing test in `__tests__/` (including `releaseGate.test.ts` and
  `components.test.tsx`).
- `trust-tasks/module/`: `VtaClient.ts`, `vtaAgent.ts`, `consentCheck.ts`, `keyedRecords.ts`, `triggerLink.ts`.
- `packages/core/src/localization/**`, `packages/core/src/navigators/**`, `packages/core/src/types/navigators.ts`,
  `packages/core/src/container-impl.ts`, `packages/core/src/container-api.ts`, `packages/core/src/index.ts`.
- `packages/core/testids.json`, `e2e/**`, `scripts/**`, `.github/**`, any `package.json` or lock file
  (no new dependency), `packages/core/tsc-baseline.txt`, `docs/**`.

If a piece seems to need a change in one of these, stop that piece and say so in the PR; do not work around it
by copying the file.

## Interfaces this brief fixes

These are contracts with the other two tracks. Build to them exactly.

### The connect link (shown as a QR by the CLI, read by Keyring)

```
https://link.trustoverip.org/t#_from=<clientVid>&_id=<uuid>&_type=/vti/flow/hcp-connect/0.1
```

- `_from`: the CLI's VID, an Ed25519 `did:key` (`did:key:z6Mk…`, 56 bytes).
- `_id`: the request's thread, as a lower-case v4 UUID of 36 characters. The `grants/request` document's
  `threadId` is `urn:uuid:` followed by it.
- `_type`: `/vti/flow/hcp-connect/0.1`, or the absolute form `https://link.trustoverip.org/vti/flow/hcp-connect/0.1`.
- Exactly these three members, in any order. Anything else, a missing member or a member twice is not an HCP
  connect link.
- **Decided here, changing the companion's step 1:** the link does not carry the VTA's DID. Measured with the
  reference ladder (`tsp-reference/ref-25-agent-pairing/links.mjs`): without it the link is 166 bytes; with a
  73-byte VTA DID it is 245; with an 84-byte VTA DID it is 256, over the 251-byte limit (VTI-LNK-081). Keyring
  knows its own VTA, and the consent request only ever comes from it.

### The match number

`number` = the first 4 bytes of `SHA-256(UTF-8(threadId) || 0x00 || UTF-8(clientVid))`, read as an unsigned
big-endian 32-bit integer, modulo 10000, written as 4 decimal digits with leading zeros. `threadId` is the full
`urn:uuid:…`. Vectors, computed independently in Python and Node (put them in
`hcp/__tests__/vectors/match-number.json` exactly as below, and test against them):

```json
{
 "version": 1,
 "cases": [
  {"threadId": "urn:uuid:7c2a9e41-5b3d-4f6a-8e1c-0a9b8d7c6e51", "clientVid": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", "number": "2644"},
  {"threadId": "urn:uuid:0f8c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f", "clientVid": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", "number": "2828"},
  {"threadId": "urn:uuid:7c2a9e41-5b3d-4f6a-8e1c-0a9b8d7c6e51", "clientVid": "did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp", "number": "2054"},
  {"threadId": "urn:uuid:00000000-0000-4000-8000-000000000000", "clientVid": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", "number": "0961"},
  {"threadId": "urn:uuid:10000000-0000-4000-8000-000000000001", "clientVid": "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", "number": "0550"}
 ]
}
```

The number is never displayed in Keyring and never logged (plan §6).

### The consent request the VTA sends for an HCP grant

The VTA holds the CLI's `hcp/grants/request` and sends Keyring a `task-consent/request/0.1` over it. Keyring
already receives these: they arrive as `VtiApproval` objects in `vtaAgent`'s state (`trust-tasks/module/vtaAgent.ts`).
An HCP one is exactly:

- `taskType` = `https://trusttasks.org/spec/hcp/grants/request/0.1`
- `requester` = the CLI's VID (`clientVid`)
- `effects` = five effects, in this order, each with the VTA-written `summary` that Keyring renders verbatim
  (as it renders every consent request today) and a `detail` this brief reads:

| `kind` | `summary` (VTA-written, English) | `detail` |
|---|---|---|
| `hcpGrantClient` | `Run by <operator name>.` | `{ "clientVid": string, "clientName": string, "operator": { "id": string, "name": string }, "threadId": string, "grantId": string }` |
| `hcpGrantAccess` | `It can read <categories> to <purpose descriptions>.` | `{ "access": [{ "actions": string[], "categories": string[], "purposes": [{ "code": string, "description": string }] }] }` |
| `hcpGrantUseUntil` | `It can keep what it reads for up to <n> minutes after reading it.` | `{ "maxUseSeconds": integer }` |
| `hcpGrantTerm` | `For 4 hours from when you approve.` | `{ "grantType": "temporary", "expiresInSeconds": 14400 }` |
| `hcpGrantNotSignIn` | `Approving gives access. It is not signing in.` | `{}` |

`grantId` is the `urn:uuid:` the VTA will give the grant when the CLI collects it; the VTA assigns it when it
holds the request, so Keyring knows it from the approval and can revoke by it.

The consent request's `expiresAt` is **5 minutes after the VTA holds the request**. It is the one bound on a
late scan: the link carries no expiry of its own. Keyring's 5-minute wait (part 2, step 3) and this instant
are the same bound seen from each side, and Keyring also refuses an approval whose `expiresAt` has passed.

The number is not a secret: anyone who sees the QR can compute it. Its value is the comparison: a substituted
link changes the client's VID or the thread, and with them the number. Keyring never displays it so that the
person has to read it from their own terminal (plan §6), not to keep it hidden.

**Decided here:** the checklist rows are the effects' `summary` strings, verbatim, in the order above.
`task-consent/request` requires a surface to render `summary` verbatim and never substitute its own prose, and
Keyring's consent screens already do. So these five rows are in the VTA's language (English) in every locale
for the demo; Keyring's own strings around them (title, warning, button) are localized. `detail` is read only
for matching and for the record Keyring keeps, never shown.

### The three management tasks Keyring sends

Keyring sends these to the person's own VTA as its Management Client, signed by its manager identity as every
Keyring task is, **without** `accessToken` (the suite makes it optional where the issuer is authenticated):

- `hcp/entries/create/0.1`: a new memory (part 3).
- `hcp/grants/revoke/0.1` `{ "grantId": … }` (part 3).
- `hcp/disclosures/summary/0.1` `{ "client": clientVid }` (part 3).

Every type URI is written once, as a constant, with `// version-pinned: the hcp suite is pinned at 0.1
(suite 186773c97); the VTA serves this version only` on its line or the line above it (the
`versionLadderGuard` test requires that form for a fixed version).

## Part 1: C0, foundations

Base: `feat/agent-connect` tip. Branch: `hcp/c0-foundations`.

### Files to create

1. **`hcp/hcpFlag.ts`**
   - `let hcpEnabled = false` (the literal `false`), `export function setHcpEnabled(enabled: boolean): void`,
     `export function isHcpFlagOn(): boolean`.
   - `export function isHcpEnabled(): boolean` returns `isAgentConnectEnabled() && hcpEnabled` (import
     `isAgentConnectEnabled` from `../agentConnectFlag`). **Every other file in this brief checks
     `isHcpEnabled()`, never `isHcpFlagOn()`.** With both flags required, the existing release gate
     (`releaseGate.test.ts`, which watches the agent-connect setter) protects the HCP code with no change.
   - Nothing outside tests calls `setHcpEnabled`.
2. **`hcp/types.ts`**: hand-written types, no generated package (Keyring has no `hcp/*` types package):
   `HcpConnectLink { clientVid: string; uuid: string; threadId: string }`;
   `HcpGrantClientDetail`, `HcpGrantAccessDetail`, `HcpGrantUseUntilDetail`, `HcpGrantTermDetail` (the
   `detail` shapes above); `HcpApprovalView` (part 2); `HcpConnection` and `HcpNoticeState` (part 3).
   Exported constants `HCP_GRANTS_REQUEST`, `HCP_ENTRIES_CREATE`, `HCP_GRANTS_REVOKE`,
   `HCP_DISCLOSURES_SUMMARY` (the four type URIs at `0.1`, each with the `version-pinned` comment) and
   `HCP_EFFECT_KINDS` (the five kinds, in order).
3. **`hcp/connectLink.ts`**: `export function readHcpConnectLink(text: string): HcpConnectLink | undefined` and
   `export function hcpConnectLink(link: { clientVid: string; uuid: string }): string`.
   - Reads only the form above: host `link.trustoverip.org`, path `/t`, members in the fragment, each value
     percent-decoded once. `_from` must match `^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$`; `_id` must match
     `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`; `_type` one of the two forms.
   - Refuses (returns `undefined`) a link longer than 251 UTF-8 bytes.
   - Does not register a trigger flow, and is not called by the scanner (no route in this brief).
4. **`hcp/matchNumber.ts`**: `export function hcpMatchNumber(threadId: string, clientVid: string): string`
   (the rule above), and `export function hcpNumberMatches(typed: string, threadId: string, clientVid: string): boolean`,
   which is false for anything but exactly four ASCII digits. Use `import { sha256 } from '@noble/hashes/sha2.js'`,
   the import `../handle.ts` already uses (no new dependency).
5. **`hcp/vtaPort.ts`**:
   - `export interface HcpVtaPort { task(type: string, payload: Record<string, unknown>): Promise<unknown> }`.
   - `export function hcpVtaPort(agent, vtaDid, session): HcpVtaPort`, built like `vtaPorts` in
     `../services.ts` (read it; do not edit it): `session.withAgentSession(agent, vtaDid, (client) =>
     client.task(type, payload, 30000, {}, undefined, { waitForConsent: false }))`. `waitForConsent: false`
     because a task the phone sends must never wait on an approval the same phone would give.
   - `export type HcpCallOutcome<T> = { ok: true; value: T } | { ok: false; refused: string } | { ok: false; unreachable: true }`
     and `export async function callHcp<T>(port, type, payload): Promise<HcpCallOutcome<T>>`: a thrown error
     whose `name` is `'VtiRefusal'` gives `refused` with its `code`; anything else thrown gives
     `unreachable`. Never log a payload.
6. **`hcp/copy.ts`**: the strings, since the localization files are not this brief's. Export
   `HCP_COPY: Record<HcpCopyKey, { en: string; fr: string; ptBr: string; source: 'companion finding 6' | 'plan §6' | 'PROPOSED' }>`
   with exactly the keys in "Copy" below, and `export function hcpText(key, lang: 'en' | 'fr' | 'ptBr', params?: Record<string, string>): string`
   that fills `{{name}}`-style placeholders. View models return keys, not text; `hcpText` is for tests and for
   whoever moves these into the localization files later.
7. **`hcp/__tests__/fixtures/hcp-suite-186773c97/`**: vendored schemas, copied byte for byte from the suite at
   `186773c97d43d82d3b1cf33c9d21561d0c87af5b` (formatting by prettier afterwards is allowed; content must be
   JSON-equal):
   - `specs/hcp/entries/create/0.1/payload.schema.json`
   - `specs/hcp/grants/revoke/0.1/payload.schema.json`
   - `specs/hcp/disclosures/summary/0.1/payload.schema.json`
   - `specs/hcp/_shared/0.1/common.schema.json`, `context-entry.schema.json`, `disclosure.schema.json`,
     `entry-write.schema.json`, `grant.schema.json` (the complete set those three reference).
   - Keep the suite's directory layout under the fixture folder, so the relative `$ref`s resolve.
   - Add `SUITE_COMMIT.sha` (the full sha, one line) and `README.md` in the form of
     `connected-agents/__tests__/fixtures/auth-oob-draft-1386/README.md`: DRAFT, from an open upstream pull
     request, not drift-checked, the source-path table, and the OWFa 1.0 attribution of the suite.
8. **`hcp/__tests__/vectors/match-number.json`**: the vectors above.

### Tests (part 1)

- `hcpFlag.test.ts`: on a fresh import (`jest.isolateModules`, as `agentConnectFlag.test.ts` does) both
  `isHcpFlagOn()` and `isHcpEnabled()` are false; `isHcpEnabled()` is true only when both flags are on (all
  four combinations); the source file's initial value is the literal `false` (read the file text).
- `connectLink.test.ts`: the round trip; both `_type` forms; each refusal: another host, another path, a
  missing member, a member twice, an extra member, a `did:key` that is not Ed25519, an upper-case or non-v4
  UUID, 252 bytes. **Control:** the 166-byte link of the vectors' first case reads back to its parts.
- `matchNumber.test.ts`: every vector; `hcpNumberMatches` refuses `"264"`, `"26444"`, `"26 4"` and `"٢٦٤٤"`
  (Arabic-Indic digits). **Control:** a vector with one byte of `threadId` changed gives another number.
- `schemas.test.ts`: validate with `Ajv` from `ajv/dist/2020` (`new Ajv({ strict: false, allErrors: true,
  validateFormats: false, logger: false })`), adding each vendored file under its own `$id`, as
  `connected-agents/__tests__/memories.test.ts` does. Every payload part 3 builds validates. **Control:** each
  of the three payloads with one required member removed fails.
- `vtaPort.test.ts`: a fake session; `task` is called with `waitForConsent: false`; a thrown
  `{ name: 'VtiRefusal', code: 'permissionDenied' }` becomes `refused`; any other throw becomes `unreachable`.

## Part 2: C1, the approval

Base: part 1's branch. Branch: `hcp/c1-approve`.

### The flow, decided

1. The person names the agent (the name is Keyring's, never taken from the request) and scans the link.
   Input: `{ name: string; link: HcpConnectLink }`.
2. Keyring waits for the VTA's consent request: an approval in `vtaAgent`'s state with `status: 'pending'`,
   `taskType === HCP_GRANTS_REQUEST`, `requester === link.clientVid`, all five `HCP_EFFECT_KINDS` present
   exactly once in order, and the `hcpGrantClient` detail's `threadId === link.threadId` and
   `clientVid === link.clientVid`. Any other approval is not this one, and stays where it is (Keyring's
   ordinary Requests screen lists it, as today).
3. It waits at most **5 minutes** from the scan. Then the state is `expired` (copy key `CodeExpired`).
4. If the approval's own `expiresAt` has passed, the state is `expired`.
5. The person types four digits. **One try** (plan §6): on a mismatch, Keyring denies the request
   (`decide(id, 'deny', 'the number did not match')`) and the state is `wrongNumber`. Then, it records the
   wrong number with `../lockout.ts` exactly as the base path's pairing does (read `pairing.ts` for how it
   calls lockout, and do the same; import only). While locked out, scanning gives `locked` with the minutes
   left, before any wait.
6. On a match, the state is `approve`: the view model (below).
7. **Approve** calls `decide(id, 'approve')`. That call runs the phone's owner check (face or fingerprint) itself;
   do not add another. Its result: `approved`, or `failed` with the approval's `error`.
8. On `approved`, part 3's record is written (part 2 leaves a function parameter `onApproved(view)` for it;
   in part 2's tests it is a fake).
9. **Cancel** at any point before Approve: `decide(id, 'deny', 'cancelled')` if an approval was found;
   otherwise nothing is sent.

### Files to create

1. **`hcp/approvals.ts`**:
   - `export interface HcpApprovalSource { list(): VtiApproval[]; subscribe(listener: () => void): () => void; decide(id: string, decision: 'approve' | 'deny', reason?: string): Promise<void> }`.
   - `export function vtaAgentApprovalSource(): HcpApprovalSource`, binding to the `vtaAgent` singleton's
     existing state accessor, listener and `decide` (read `vtaAgent.ts` for their names; do not edit it).
   - `export function findHcpApproval(approvals: VtiApproval[], link: HcpConnectLink, now: Date): VtiApproval | undefined`
     (step 2), pure.
   - `export function readHcpEffects(approval): { client: HcpGrantClientDetail; access: HcpGrantAccessDetail; useUntil: HcpGrantUseUntilDetail; term: HcpGrantTermDetail; rows: string[] } | undefined`:
     `rows` are the five `summary` strings in order; `undefined` if any kind is missing, repeated, out of
     order or has a `detail` of the wrong shape.
2. **`hcp/approveFlow.ts`**: a small state machine, `createHcpApproveFlow(deps: { source: HcpApprovalSource;
   lockout; clock: () => Date; onApproved })` with `start({ name, link })`, `typeNumber(digits)`, `approve()`,
   `cancel()`, `state()` and `subscribe()`. States: `locked` `{ minutes }`, `waiting`, `expired`,
   `wrongNumber`, `numberEntry`, `approve` `{ view }`, `approving`, `approved`, `failed` `{ error }`,
   `cancelled`.
3. **`hcp/approveView.ts`**: `export function hcpApproveView(name: string, effects): HcpApprovalView`, pure:

```ts
type HcpApprovalView = {
  title: { key: 'ApproveTitle'; params: { name: string } }        // "Connect "<name>"?"
  rows: string[]                                                  // the five summaries, verbatim
  warning: { key: 'ApproveOwnTerminal' }                          // "Only continue if you ran the command…"
  approve: { key: 'Approve' }
  clientVid: string; grantId: string; threadId: string; expiresInSeconds: number
}
```

### Tests (part 2)

- `approvals.test.ts`: `findHcpApproval` finds the one matching approval among: another task type, another
  requester, another thread, a missing kind, a repeated kind, kinds out of order, a non-pending status, an
  expired one. `readHcpEffects` refuses each malformed `detail`. **Control:** the well-formed fixture is found.
- `approveFlow.test.ts`, with a fake source and a fake clock:
  - waiting, then the approval arrives, then `numberEntry`;
  - 5 minutes with nothing gives `expired`;
  - the right number gives `approve` with the view;
  - the wrong number gives `wrongNumber`, sends exactly one `deny` with the reason above, and records one
    lockout; a second `typeNumber` does nothing;
  - while locked, `start` gives `locked` and sends nothing;
  - `approve()` calls `decide(id, 'approve')` once, and `onApproved` only after it resolves;
  - `cancel()` before an approval arrives sends nothing, and after one sends one `deny`.
  - **Control that bites:** the number is never in any state, view or call argument (serialize every state
    and every fake call and search for the four digits).
- `approveView.test.ts`: the rows are the summaries verbatim, in order (a summary containing
  `<script>` stays the literal text).

## Part 3: C2, C3, C6, the grant in Keyring

Base: part 2's branch. Branch: `hcp/c2-c3-c6-grant`.

### The record (C2)

**`hcp/store.ts`**: `HcpConnectionStore(agent)` over the module's keyed generic records
(`trust-tasks/module/keyedRecords.ts`: `putKeyed`, `getKeyed`, `listKeyed`, `deleteKeyed`; import only), with
`recordType: 'keyring/hcp-connection'`, `kind: 'connection'`, key = `clientVid`. Methods `get`, `list`,
`put`, `update(id, change)`. Do not reuse `../store.ts`'s `AgentConnectionStore`.

```ts
type HcpConnection = {
  id: string            // clientVid
  name: string          // the name the person gave
  grantId: string
  threadId: string
  approvedAt: string    // ISO instant, when decide(approve) resolved
  expiresAt: string     // approvedAt + expiresInSeconds
  revokedAt?: string
  notice?: HcpNoticeState
}
type HcpNoticeState =
  | { state: 'telling'; lastPolledAt?: string }
  | { state: 'told'; at: string }               // usableUntil from the summary, the time of delivery
  | { state: 'notTold'; usableUntil: string }
```

**`hcp/status.ts`**: `export function hcpStatus(c: HcpConnection, now: Date)`:
- revoked: `{ key: 'StatusRevoked' }` plus the notice line: `telling` gives `RevokeTelling` `{ name }`; `told`
  gives `RevokeTold` `{ name, time: at }`; `notTold` gives `RevokeNotTold` `{ name, time: usableUntil }`;
- else at or after `expiresAt`: `{ key: 'StatusExpired' }`;
- else `{ key: 'StatusConnectedUntil', params: { time: expiresAt } }`.

Part 2's `onApproved` writes the record: `approvedAt` = the clock when `decide` resolved, `expiresAt` from the
view's `expiresInSeconds`.

### A new memory (C3)

**`hcp/newMemory.ts`**:
- `export function hcpCreatePayload({ text, language, managerDid, now })` returns exactly:

```json
{
  "schema": "https://hcp.example/spec/entry/2.0",
  "subject": { "id": "<managerDid>" },
  "content": { "profile": "https://hcp.example/spec/profiles/general-context/2.0", "value": "<text, trimmed>", "language": "<language>" },
  "classification": { "categories": ["general_preferences"] },
  "assertion": { "declarationType": "person-declared" },
  "record": { "provenance": { "source": "person-input", "assertedBy": { "id": "<managerDid>" }, "assertedAt": "<now, ISO>" } }
}
```

- **Decided here:** the category is `general_preferences` for every memory added in the demo (the screen has
  no category picker); the subject is the person's manager DID (the VTA's track A accepts a Management
  Client's write only with that subject); `language` is the app's current language tag (`en`, `fr` or `pt-BR`).
- `text` must be 1 to 4096 characters after trimming; otherwise no call is made and the result is
  `{ ok: false, invalid: true }`.
- `export async function addHcpMemory(port, input)`: `callHcp(port, HCP_ENTRIES_CREATE, payload)`; success when
  the response has `entry`. `unreachable` gives copy key `MemoryNotSaved`.

### Revoke and the notice state (C6)

**`hcp/revoke.ts`** (its own file; the base path's `../revoke.ts` is not this):
- `export async function revokeHcpGrant(deps: { port; store; clock }, id)`: sends
  `HCP_GRANTS_REVOKE` `{ grantId }`. On success: `revokedAt` = now and `notice` = `{ state: 'telling' }`.
  On `refused` or `unreachable`: the record is unchanged and the result names which (`unreachable` gives copy
  key `RevokeUnreachable`). Revoke is never retried on its own.
- `export async function pollHcpNotice(deps, id)`: sends `HCP_DISCLOSURES_SUMMARY` `{ client: c.id }` and reads
  the one `clients[]` entry whose `client.id === c.id`:
  - `notification: 'delivered'` gives `{ state: 'told', at: usableUntil }`;
  - `notification: 'abandoned'` gives `{ state: 'notTold', usableUntil }`;
  - `'none'`, no entry, `refused` or `unreachable` keep `telling`, with `lastPolledAt` set.
- `export function nextHcpPoll(revokedAt: Date, now: Date): number | undefined` (milliseconds): **5 000** until
  2 minutes after `revokedAt`, then **60 000** until 24 hours after it, then `undefined` (stop).
- At the stop with the state still `telling`, it becomes `notTold` with `usableUntil` = the last summary's
  `usableUntil` if one was read, else `revokedAt`.
- A `told` or `notTold` state never goes back to `telling`.
- `export function useHcpNotice(...)`: a hook that polls on that schedule while mounted, for a revoked record
  whose notice is `telling`. It is exported from the hcp folder only and imported by nothing in this brief.

### Tests (part 3)

- `store.test.ts`: put, get, list, update, with `memoryGenericRecords()` (from
  `packages/core/__tests__/modules/vrc/fixtures/memoryGenericRecords`) as the module's `__tests__/store.test.ts`
  does; a record of `AgentConnectionStore` is not listed by `HcpConnectionStore`, and the reverse.
- `status.test.ts`: each status at the boundary instants: one millisecond before and at `expiresAt`;
  revoked before `expiresAt` reads revoked.
- `newMemory.test.ts`: the payload validates against the vendored `entries/create` schema; it is exactly the
  object above; empty or 4097-character text sends nothing. **Control:** the payload with
  `declarationType: "model-inferred"` fails a test of this file.
- `revoke.test.ts`: revoke sends exactly `{ grantId }` and sets `telling`; `unreachable` changes nothing; each
  `notification` value; the schedule's boundaries (1:59.999, 2:00, 23:59:59.999, 24:00); `told` is never
  overwritten by a later `none`; the 24-hour stop. Every request and response used validates against the
  vendored schemas.

## Copy

All in `hcp/copy.ts`, never in the localization files. `source` says where each string comes from. Strings
marked PROPOSED need a native reader's approval in French and Portuguese before they are moved into the
localization files; that is not this brief's work.

| Key | en | fr | pt-br | Source |
|---|---|---|---|---|
| `ApproveTitle` | Connect "{{name}}"? | Connecter « {{name}} » ? | Conectar "{{name}}"? | plan §6 (en); PROPOSED (fr, pt-br) |
| `ApproveOwnTerminal` | Only continue if you ran the command in your own terminal just now. | Continuez seulement si vous venez de lancer la commande dans votre propre terminal. | Só continue se você acabou de executar o comando no seu próprio terminal. | plan §6 (en); PROPOSED (fr, pt-br) |
| `Approve` | Approve | Approuver | Aprovar | plan §6 (en); PROPOSED (fr, pt-br) |
| `CodeExpired` | This code has expired. Run the command again. | Ce code a expiré. Relancez la commande. | Este código expirou. Execute o comando novamente. | plan §6 (en); PROPOSED (fr, pt-br) |
| `WrongNumber` | That isn't the number in your terminal. Nothing was connected. | Ce n'est pas le numéro affiché dans votre terminal. Rien n'a été connecté. | Esse não é o número do seu terminal. Nada foi conectado. | plan §6 (en); PROPOSED (fr, pt-br) |
| `Locked` | Too many wrong numbers. Try again in {{n}} minutes. | Trop de numéros erronés. Réessayez dans {{n}} minutes. | Números errados demais. Tente de novo em {{n}} minutos. | plan §6 (en); PROPOSED (fr, pt-br) |
| `StatusConnectedUntil` | Connected until {{time}} | Connecté jusqu'à {{time}} | Conectado até {{time}} | companion finding 6 (en); PROPOSED (fr, pt-br) |
| `StatusExpired` | Expired | Expiré | Expirado | companion finding 6 (en); PROPOSED (fr, pt-br) |
| `StatusRevoked` | Revoked | Révoqué | Revogado | companion finding 6 (en); PROPOSED (fr, pt-br) |
| `RevokeTelling` | Revoked. Telling "{{name}}"… | Révoqué. Nous prévenons « {{name}} »… | Revogado. Avisando "{{name}}"… | companion finding 6 (en); PROPOSED (fr, pt-br) |
| `RevokeTold` | Revoked. "{{name}}" was told at {{time}}. | Révoqué. « {{name}} » a été prévenu à {{time}}. | Revogado. "{{name}}" foi avisado às {{time}}. | companion finding 6 (en); PROPOSED (fr, pt-br) |
| `RevokeNotTold` | Revoked. We couldn't tell "{{name}}". Anything it read stops being usable at {{time}}. | Révoqué. Nous n'avons pas pu prévenir « {{name}} ». Ce qu'il a lu cesse d'être utilisable à {{time}}. | Revogado. Não conseguimos avisar "{{name}}". O que ele leu deixa de poder ser usado às {{time}}. | companion finding 6 (en); PROPOSED (fr, pt-br) |
| `RevokeTitle` | Revoke "{{name}}"? | Révoquer « {{name}} » ? | Revogar "{{name}}"? | companion finding 6 (en); PROPOSED (fr, pt-br) |
| `RevokeBody` | It stops at once. We'll tell it, and show you when it has heard. | Il s'arrête aussitôt. Nous le prévenons, et vous montrons quand il a été prévenu. | Ele para na hora. Vamos avisá-lo e mostrar quando ele receber o aviso. | companion finding 6 (en); PROPOSED (fr, pt-br) |
| `Revoke` | Revoke | Révoquer | Revogar | companion finding 6 (en); PROPOSED (fr, pt-br) |
| `Keep` | Keep | Garder | Manter | companion finding 6 (en); PROPOSED (fr, pt-br) |
| `RevokeUnreachable` | We couldn't reach your VTA, so "{{name}}" is still connected. | Nous n'avons pas pu joindre votre VTA, donc « {{name}} » est toujours connecté. | Não conseguimos falar com seu VTA, então "{{name}}" continua conectado. | plan §6 (en); PROPOSED (fr, pt-br) |
| `NewMemoryTitle` | Add a memory for "{{name}}" | Ajouter un souvenir pour « {{name}} » | Adicionar uma memória para "{{name}}" | companion finding 6 (en); PROPOSED (fr, pt-br) |
| `NewMemoryField` | What should it know? | Que doit-il savoir ? | O que ele deve saber? | companion finding 6 (en); PROPOSED (fr, pt-br) |
| `NewMemoryHelper` | Saved as something you said. | Enregistré comme quelque chose que vous avez dit. | Salvo como algo que você disse. | companion finding 6 (en); PROPOSED (fr, pt-br) |
| `NewMemorySave` | Save | Enregistrer | Salvar | companion finding 6 (en); PROPOSED (fr, pt-br) |
| `MemoryNotSaved` | We couldn't reach your VTA, so this memory wasn't saved. | Nous n'avons pas pu joindre votre VTA, donc ce souvenir n'a pas été enregistré. | Não conseguimos falar com seu VTA, então esta memória não foi salva. | PROPOSED |

A test in part 1 holds `copy.ts` to this table: every key present, the three languages non-empty and
distinct, the same placeholder names in all three, and no string containing "instant", "encrypted",
"private" or "no trace" (plan §6's copy rules).

## Checks every part passes before it is marked ready for review

Run from the repository root unless said otherwise. Each part's PR description lists the commands run and
their results, and says which tests are controls that were made to fail.

1. `cd packages/core && TZ=GMT yarn jest src/modules/connected-agents` (the whole module, not only the new
   files; `releaseGate.test.ts` and `components.test.tsx` must still pass unchanged).
2. Type ratchet: `node scripts/tsc-ratchet.mjs --package packages/core --project tsconfig.ratchet.json`. The
   baseline (`packages/core/tsc-baseline.txt`, 156 diagnostics) must not grow; add no line to it.
3. `git diff --name-only <base>...HEAD | grep '^packages/' | xargs yarn exec prettier --check --config packages/.prettierrc --ignore-path packages/.prettierignore`
   (CI's own form), and `... | grep -E '\.(ts|tsx)$' | xargs yarn eslint`.
4. No testID added, so `packages/core/testids.json` and `e2e/lib/testids.json` are unchanged.
5. `scripts/release/tier.mjs` is not run by you; your diff is all under `packages/core/src/modules/connected-agents/hcp/`.
6. Commits are signed and end with your `Signed-off-by:` as the last line (`git commit -s -S`); conventional
   commit types (`feat`, `test`, `docs`).
7. **Controls that bite:** each test file named above has at least one case marked `// control:` that checks
   the opposite of its neighbour, and the PR description records one change to the source, per file, that
   made a named test fail before it was put back.

## Done means

- Three draft PRs, stacked, each green on the checks above and in CI.
- Nothing reachable: with both flags off nothing runs; with them on nothing is routed.
- Each PR description: what it adds, the decisions from this brief it implements (by heading), the checks
  and their output, and anything it met that this brief did not cover.
