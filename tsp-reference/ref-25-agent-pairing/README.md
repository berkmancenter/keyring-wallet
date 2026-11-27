# ref-25-agent-pairing: what connecting an AI agent needs from a mediator and a VTA, measured

The reference program for step 7.1 of
[`docs/plans/agent-connect-plan.md`](../../docs/plans/agent-connect-plan.md): the measurements that come before any
app change. It runs under Node with `ws`, on a lab that listens on loopback only, and it changes nothing in the
app. A result that differs from the plan changes the plan, in the same pull request.

**Two halves.** The mediator half covers items 0.1(a), (h), (j) and (q). The VTA half covers (b), (c), (d), (f),
(l), (o), the P0 parts of (p) and the memory part of (e), on three VTA versions. What is not measured is listed at the
end.

## What runs

Two or three parties, each a fresh `did:key` made from an Ed25519 seed, against one mediator. A message from a
sender to a recipient is three layers: a plain DIDComm v2 message, that message as an authcrypt envelope for the
recipient, and a `routing/2.0/forward` naming the recipient in `next`, itself authcrypted to the mediator and
POSTed to `/mediator/v1/inbound`.

The mediator is the wallet mailbox's own: `affinidi-messaging-mediator` v0.53.0 at `f6ed8159a`, the commit the
production mailbox is pinned to, built from the pinned clone in `external/`. `lab/mediator.sh` starts it in one of
three configurations:

| Mode | Configuration |
|---|---|
| `open` | As the setup tool generates it: `explicit_deny` with `global_acl_default = ALLOW_ALL`. This is the configuration of the plan's section 2.4 |
| `mailbox` | Every setting of the production mailbox that is not about where it runs, read from [`deploy/keyring-messaging/mailbox/mailbox.toml`](../../deploy/keyring-messaging/mailbox/mailbox.toml) by `lab/mediator_config.py` and never typed |
| `deny` | `global_acl_default = DENY_ALL`, nothing else changed |

Every case runs with two kinds of sender. **No session**: it never authenticated and only POSTs the sealed
forward; this is the sender of the plan's section 2.4. **Account**: it authenticated, switched its own
`SEND_FORWARDED` on with `messaging/account/update`, and sends with its session token; this is what a phone or an
agent is on the wallet mailbox.

## Run

```sh
node scripts/openvtc/setup-external.mjs                  # once, at the repository root: the pinned clones
(cd external/affinidi-messaging-mediator \
  && cargo build --locked -p affinidi-messaging-mediator \
  && cargo build --locked -p affinidi-messaging-mediator-setup --no-default-features)

cd tsp-reference/ref-25-agent-pairing
npm install
npm test                                # 126 offline tests: packing, forward, refusal reading, the links, a VTA's answers, document proofs, recording under names, the recordings, the notification checks, and track C's HCP interfaces
lab/mediator.sh up mailbox              # or: open, deny
npm start                               # every case for that mode, against the recorded result
lab/mediator.sh down
node measure-links.mjs <a VTA's DID>    # step 0.1(h)
```

`npm test` here: 126 tests, 126 passed, 0 failed, 0 skipped, as read from the TSP reference offline tests CI run
[46061103199](https://github.com/berkmancenter/keyring-wallet/actions/runs/46061103199).

Node 20 or later, Rust 1.95 (the clone pins it), Redis 7.1 or later and below 9, Python 3.11. The lab keeps its
keys and state in `~/vti-stack/agent-connect-lab` (`LAB_DIR`), outside the repository; in a git worktree, point
`MEDIATOR_SRC` at the clone. `npm start` exits 1 when any case differs from
`fixtures/recorded-<mode>.json`; `node run.mjs --record` rewrites that file. A run also writes
`out/report-<mode>.json`.

## What it measured (2026-11-26, v0.53.0 at `f6ed8159a`, debug build, binary sha256 `c6492c18bfb6…`)

Each row was run twice and gave the same result both times.

| Case | Plan section 2.4 (v0.48.0, open) | `open`, no session | `open`, account | `mailbox`, no session | `mailbox`, account |
|---|---|---|---|---|---|
| Recipient has an open socket | 200, delivered | 200, delivered | 200, delivered | **401** | 200, delivered |
| Recipient has an account and is offline | 200, delivered on connect | 200, delivered on connect | the same | **401** | 200, delivered on connect |
| The mediator has never heard from the recipient | 200, an account is made, delivered later | **403 `e.p.delivery.refused`** | **403 `e.p.delivery.refused`** | **401** | **403 `e.p.delivery.refused`** |
| The outer forward is anoncrypt | 400 `w.m.message.anonymous` | 400, the same code | the same | **401** | 400, the same code |
| A `did:peer:2` recipient whose service is this mediator (its URL, or its DID) | delivered | delivered | delivered | **401** | delivered |
| A `did:peer:2` recipient whose service names another host | 200, never delivered | 200, not delivered in 8 s | the same | **401** | **200, delivered** |
| One sender, an offline recipient | 49 accepted, the 50th 503 `e.p.limits.queue.peer` | **50 accepted, the 51st** 503, the same code, `Retry-After: 30` | the same | **401** | 50 accepted, the 51st 503, `Retry-After: 30` |
| A second socket for the same DID | the first is evicted | the first is evicted | | the first is evicted | |
| A `did:key` never seen before authenticates and opens its socket | yes | yes | | yes | |
| A new account sends, switches `SEND_FORWARDED` on, sends again | not measured | 200, granted, 200 | | **403 `e.p.authorization.send_forwarded`**, granted, 200 delivered | |
| Sender and recipient authenticated over REST only, no socket | not measured | 200 | 200 | 401 | 403 `e.p.authorization.send_forwarded` |

On `deny`: a fresh `did:key` authenticates, its socket is refused (close 1006), a send with a session token is
refused 403 `e.p.authorization.send`, and a send with no session is refused 401. That is section 2.4's last row,
with one addition: the 401.

## What differs from the plan, and whose it is

1. **A forward never makes an account.** A send to a `did:key` that has not yet authenticated at the mediator is
   refused 403 `e.p.delivery.refused`, in every mode and for every sender. The plan's section 2.4 measured the
   opposite on v0.48.0. Upstream changed it on purpose in 0.52.0 and says so in its changelog ("a forward is
   delivered only to a next hop that has an account"); the mediator logs the reason, "next hop has no account on
   this mediator", and tells the sender only that it was refused. **Ours to act on:** each side authenticates at
   the mediator before the other sends to it, and a first send that meets this refusal is retried. The refusal
   carries no `Retry-After`.
2. **On the mailbox's configuration a sender must hold a session.** A POST with no session is answered 401
   "Missing credentials" before the message is read, because a mediator admits a sender with no session only when
   it is set up as a relay, and the mailbox's default grants no `SEND_FORWARDED`. So section 2.4's "the sender
   needs no account" holds on the open configuration only. **Ours:** Keyring's chat key and the agent's key each
   authenticate, which they already had to do to make the self-grant.
3. **The self-grant works as the plan says, and the failure path has a code.** A new account's send is refused
   403 `e.p.authorization.send_forwarded` until it sends `messaging/account/update` with
   `acl.sendForwarded: true`; the answer shows it on, and the next send is delivered.
4. **The queue holds 50, not 49, and the refusal carries `Retry-After: 30`.** This answers 0.1(j) for the one
   refusal that is retryable. None of the others (401, 403, 400) carries the header.
5. **With `external_forwarding` off, a `did:peer` that names another host is delivered here** when it holds an
   account here. On the open configuration the mediator tries the other host instead, as section 2.4 found.

None of these is a defect in the mediator: 1 and 2 are documented behaviour of the pinned version.

## Step 0.1(h): the links

The limit is 251 bytes, the capacity of a version 11 QR code at level M (VTI-LNK-081). `oobLink` builds the
`auth/oob` link the way the pinned producer does (`vti-oob-server/src/util.rs`, VTI `f7b78e29d`), and the test
holds it to that producer's own test vector.

| Link | Bytes | Spare | QR version at level M | A decoder reads it back |
|---|---|---|---|---|
| `auth/oob`, `_from` **the lab VTA's own DID** (vta 0.87.0 on localhost: 73 bytes, a 46-character SCID and `localhost%3A8161`), recorded in `fixtures/links-lab-vta.json` | 183 | 68 | 9 | yes |
| `auth/oob`, `_from` a `did:webvh` of 84 bytes (a 46-character SCID and a 27-character host, the shape of a VTA of the local stack) | 192 | 59 | 10 | yes |
| `auth/oob`, `_from` a `did:webvh` of 80 bytes with a path | 188 | 63 | 10 | yes |
| `auth/oob`, `_from` a `did:peer:2` of 504 bytes | 612 | over by 361 | 19 | yes |
| Fallback `agent-connect`, `_from` a `did:key` (56 bytes), no scope | 170 | 81 | 9 | yes |
| The same with the widest scope, `&_scope=rwpo` | 182 | 69 | 9 | yes |
| The same with one purpose and no capability, `&_scope=~personalisation` | 194 | 57 | 10 | yes |
| The same with memory and both purposes, `&_scope=rw~personalisation.taskExecution` | 210 | 41 | 10 | yes |
| The same with every capability and both purposes, `&_scope=rwpo~personalisation.taskExecution` | 212 | 39 | 10 | yes |

- **Item (h) holds for any VTA DID of 143 bytes or less, by construction.** The link is 108 bytes plus the DID, and 251 bytes is the capacity of a version 11 code at level M, so the lab VTA's DID is one instance and not the proof.
- **The longest VTA DID an `auth/oob` link can carry is 143 bytes.** For a `did:webvh` with a 46-character SCID
  that leaves 86 bytes for the host and any path.
- **The scope fits.** The plan left its encoding to this step. The rung encodes capabilities as one letter each
  (`r` memory read, `w` memory write, `p` room present, `o` room open) and purposes as names after `~`, in a
  flow member `_scope`; that costs 8 bytes plus the scope, against 81 spare. The fallback rows are recorded in
  `fixtures/links-scopes.json` (`node measure-links.mjs --scopes`: a `did:key` from a fixed seed, so the output is
  the same on every run), and a test holds the record to the code and the purposes to the names Keyring grants.
- **The widest ask is 212 bytes, 39 spare**: every capability and both purposes.
- **An agent that asks for nothing writes no `_scope`.** The member is never present with an empty value. A purpose
  with no capability is an ask and is written with empty letters (`~personalisation`).
- **The link carries no duration for the grant.** `_exp` is the code's own deadline.
- **This form carries a purpose as a registered name, and cannot carry a purpose IRI.** The specification lets a
  purpose in an ACL entry be either (`specs/acl/_shared/0.3/acl-entry.schema.json`, `$defs.Purpose`, at the pin
  `2a66a0351`: a lowerCamelCase name of at most 64 characters, or an absolute IRI). So the link can ask for a
  strict subset of what an entry can hold. `.` separates the names here and an IRI contains it, so `encodeScope`
  refuses a purpose that is not a registered name by that schema's own pattern; a test holds that.
  Separately, two IRIs of about 60 characters each would pass the 251-byte limit whatever the separator (that part
  is arithmetic, not measured).
- A `did:peer:2` cannot be the `_from` of a link at this limit.

## The plan's tables are held to the recordings

`recordings.test.mjs` has one test for each row of the plan's two measured tables (section 2.4, the mediator;
section 2.6, the VTA versions). Each test quotes its row and asserts, with no lab running, that the recordings
under `fixtures/` hold what the row says. It fails when the plan no longer has the row, and when a recording says
something else. A row is compared by its words, so re-aligning a table changes nothing; a changed word, number or
code fails the test that quotes the row, and the row is re-quoted there, beside the assertions it has to match.
A last test reads both tables whole and fails if any row of either is quoted by no test, so a row added to a
table is not left unmeasured.

It reads those rows only: not the plan's prose and not this README. CI does not run it; `npm test` here does.

## Track C's interfaces, checked offline

Step 7.27 track C (the Keyring side of the HCP demo) fixed three interfaces with the CLI and the VTA. `hcp/` holds a
second implementation of each, written from the track C brief rather than from Keyring's TypeScript, and
`hcp/hcp.test.mjs` holds each to Keyring's:

- `hcp/link.mjs`: the connect link the CLI shows as a QR,
  `https://link.trustoverip.org/t#_from=<clientVid>&_id=<uuid>&_type=/vti/flow/hcp-connect/0.1`. Exactly those
  three members in any order, `_type` relative or absolute, an Ed25519 `did:key` and a lower-case v4 UUID, at most
  251 bytes. The vectors' first link is 166 bytes. The test reads the link back, refuses each malformed form, and
  refuses one extra member.
- `hcp/number.mjs`: the four-digit match number, `SHA-256(threadId || 0x00 || clientVid)`'s first four bytes,
  modulo 10000. `fixtures/hcp-match-number.json` is Keyring's `hcp/__tests__/vectors/match-number.json`. The test
  computes every vector and requires the two files to be equal; a missing Keyring file fails, never skips.
- `hcp/consent.mjs`: the `task-consent/request/0.1` payload the VTA sends Keyring for an HCP grant: the five effects
  with their `summary` and `detail`, `expiresAt` 5 minutes after the VTA holds the request, and the framework
  members (`sideEffects: "mutating"`, `exposure` `secret` and not acting as the subject, `approverSet: "owner"`,
  `minApprovals: 1`, `excludeRequester: true`). The test requires the effect kinds to equal Keyring's
  `HCP_EFFECT_KINDS`, read from `hcp/types.ts`. `node hcp/consent.mjs --record` rewrites
  `fixtures/hcp-consent-request.json` from fixed inputs (the vectors' first thread and `did:key`), and the test
  requires the file to equal what the code gives.

The other direction is Keyring's `hcp/__tests__/rungConsent.test.ts`: it validates `fixtures/hcp-consent-request.json`
against VTI's own `task-consent/request/0.1` schema (vendored at `97fda9813`, vta-service-v0.84.0) and runs track C's
`readHcpEffects` and `findHcpApproval` on it, which accept it for the vectors' first link.

## What it does not prove

- **Not the production mailbox.** The lab mediator is the same commit with the mailbox's settings, on loopback.
  It has no proxy in front, so every client is one address to the per-IP limit, and its identity is a `did:peer`,
  not the mailbox's `did:webvh`. `lab/mediator_config.py` prints every setting that still differs and why.
- **Not a release build.** The binary is a debug build of the pinned commit, not the mailbox's image.
- **Not a phone's camera.** "A decoder reads it back" is a software decode of the drawn code.
- **Not the rate limits.** The mailbox's per-IP and per-DID limits are set; the cases stay below them and do not
  measure them.
- **Not the wake-up path.** `processors.wake` is off in the mailbox's configuration, and nothing here shows how
  a message for an agent wakes a phone. The plan's open question stays open, recorded as not shown.
- **Not TSP.** Every frame here is DIDComm v2.
- One machine, no load, no network faults.

## The VTA half

One VTA on localhost that serves its own `did:webvh`, started by `lab/vta.sh` after upstream's own local recipe
(VTI `local-dev/vta-root-webvh-setup.toml`): a plaintext secret backend, no mediator,
`VTA_ALLOW_PRIVATE_ENDPOINTS=1`. No tunnel, no DID host, no `pnm`, no keychain. Its one administrator is a
`did:key` the rung holds, which plays Keyring; an agent is a fresh `did:key` the administrator grants an
`application` entry to. Every call is a signed Trust Task over the VTA's HTTPS binding (`vta.mjs`).

```sh
# a checkout of OpenVTC/verifiable-trust-infrastructure at the commit under test
cargo build --locked -p vta-service
lab/vta.sh up <path to target/debug/vta> "$(git -C <that checkout> rev-parse HEAD)"
node vta-serves.mjs        # which version of each task family this VTA serves
node vta-run.mjs           # the 15 cases, against the recorded result for this version
lab/vta.sh down
```

### Three versions (measured 2026-11-26)

`scripts/openvtc/PINS.json` pins VTI at `f7b78e29d`, which is vta 0.79.0. The plan's VTA facts were read at later
commits, so the rung ran on three builds, each a debug build from a checkout at that commit:

| | vta 0.79.0 at `f7b78e29d` (the pin) | vta 0.84.0 at `97fda9813` (the tag the Farm's gate VTAs run) | vta 0.87.0 at `4e5861d95` (the commit the plan read) |
|---|---|---|---|
| `acl/grant`, `acl/revoke`, `acl/update`, `acl/show` | 0.2 | 0.3 | 0.3 |
| `acl/list` | 0.3 | 0.4 | 0.4 |
| `vta/memory/put`, `list`, `delete` | 0.1, 0.2 | 0.1, 0.2, 0.3 | 0.1, 0.2, 0.3 |
| `vta/memory/get` | 0.1 | 0.1, 0.2 | 0.1, 0.2 |
| `vta/contexts/delete` | 1.1 | 1.2 | 1.2 |
| `rooms/keys/open` | 0.2 | 0.2, 0.3 | 0.2, 0.3 |
| `acl/swap-key` 0.1, `device/register` 0.2, `device/list` 0.3, `device/disable` 0.1, `vta/contexts/create`, `list`, `update` 1.0, `rooms/keys/present` 0.2, `rooms/keys/seal` 0.2 and 0.3, `rooms/keys/act` 0.8 to 0.12, `task-consent/decision` 0.2, `vault/credentials/present` 0.1 | the same on all three | | |
| `keys/sign-document` 0.1, `vta/webvh/dids/create` 1.2, `vta/credentials/issue` 0.2, `credential-exchange/issue` 0.1, `vault/sign-trust-task` 0.2 (item (f)) | the same on all three | | |
| `auth/oob/*`, `task-consent/request` | not served (`unsupportedType`) on all three | | |
| The seeded administrator | roles `admin`, no scopes, 27 capabilities, on all three | | |
| The 15 cases | **none can run**: `acl/grant` 0.3 and `vta/memory/put` 0.3 are not served | 15 recorded, each repeats | 15 recorded, each repeats, **the same as 0.84.0 on every case** |

A VTA serves one version of each `acl` task, not two. So a client speaks `acl/grant` 0.3 to a 0.84.0 or a 0.87.0
and 0.2 to a 0.79.0, and agent connect as the plan describes it needs 0.84.0 or later.

### What the cases found (0.84.0 and 0.87.0)

| Item | Result |
|---|---|
| (p) 1 | The seeded administrator is unrestricted: roles `admin`, scopes empty |
| (p) 2 | The administrator creates a top-level memory and lists it with its name. A second create of the same id is refused `taskFailed`, with "conflict" in the message. An administrator scoped to one context is refused a top-level one (`permissionDenied`) and may create a child under its own |
| (d) | `acl/grant` 0.3 with listed capabilities is accepted with kebab-case names (`memory-read`, `memory-write`) and refused with camelCase (`malformedRequest`). `purposes` is required. A purpose name nobody defined is accepted when it is well formed (`zzz`) and refused when it is not (`not-a-purpose`). The agent's `auth/whoami` shows role `application`, one scope and the two capabilities |
| (p) 3, (p) 7 | An agent bound to one memory writes and reads it, and is refused another: `vta/memory/put:contextForbidden`, and the same for `get` and `list`. Two agents with a memory each reach only their own. A grant naming a context that does not exist is refused `taskFailed` |
| (o) | A child is created with `{ id, parent }` and is named `<parent>/<id>`; a path as the id is refused. An entry naming the parent reads and writes the child. An entry naming the child is refused the parent (`contextForbidden`) |
| (b) | `device/register` with `{ kind: "service", serviceKind: "aiAgent" }` is accepted and returns a `deviceId`. Before it, `rooms/keys/act` answers `rooms/keys/act:typeNotActable` for the probe's document; after it, `permissionDenied` ("a delegate presents under its own identifier"). Registering again is refused (`device/register:alreadyRegistered`) |
| (c) | `acl/swap-key` by the entry's own subject needs a `linkProof`: a compact EdDSA JWT signed by the **new** key (without it, `acl:link_proof_required`). With it the whole entry moves: role, contexts, capabilities, purposes, `expiresAt`, label, and the device with the same `deviceId` and kind. The old key is no longer listed and its session is refused |
| (l) | After one key swap and after two, `device/list` names the newest key for the `deviceId`. Revoking the first key is refused (`acl/revoke:subjectNotPresent`); revoking the key `device/list` names removes the entry and the device, and that key cannot sign in again. `device/disable` by `deviceId` makes the next sign-in refused (`permissionDenied`); the entry stays listed |
| (p) 5 | `acl/update` never narrows `act` (`acl/update:narrowingNotPermitted`). `acl/revoke` 0.3 with `{ kind: "act", act }` does, and the `act` it names is **what remains** |
| (p) 6 | `vta/memory/list` 0.3 with `includeValues: false` returns the items with no values, so they can be counted. A memory that holds only items is deleted without `force`. A memory an entry names is refused `vta/contexts/delete:notEmpty` without `force`; with it, the memory goes and so does an entry that named only it |
| (f) | **`keys/sign-document` 0.1 signs a W3C credential as the persona.** See below |

### Item (f): the task that signs a credential as the persona

The persona here is made with the task Keyring makes one with: a context, and a `did:webvh` the VTA mints and
holds the keys of (`vta/webvh/dids/create` 1.2). Unlike a real persona it names no `serverId`, so nothing hosts
its log; the VTA reads the persona's document from the log it holds, and the rung reads it from the create answer.

The administrator sends `keys/sign-document` 0.1 with `{ keyId, document }`. `keyId` is the persona's signing key,
which the create answer returns as `signingKeyId` (`<persona DID>#key-0`). `document` is the unsigned delegation
credential of the plan's section 3.4: both contexts, the three types, `issuerScope`, `validFrom`, `validUntil` and
the subject with its `delegation.scope`.

| Question | Result |
|---|---|
| Does it sign? | Yes. The answer carries `signerDid` (the persona), the `proof`, and the `document` with the proof added |
| What proof? | A `DataIntegrityProof`, cryptosuite `eddsa-jcs-2022`, purpose `assertionMethod`, by the persona's `#key-0`. The proof carries the document's own `@context` |
| Is the credential changed? | No. Every member comes back as sent; only `proof` is added |
| Does the proof verify? | Yes, with the key the persona's DID document lists for that method (`proof.mjs`). It fails after one scope is added to the credential, and with another persona's key |
| What else does it sign? | The same credential with `issuer` as an object holding `id`, and with purpose `authentication` |
| What does it refuse? | Another persona as `issuer` (`keys/sign-document:issuerMismatch`). A `did:key` as `issuer` (`keys/sign-document:failedPrecondition`: the key signs only as the DID whose log it authorizes). No `issuer` (`documentInvalid`). A document that has a proof (`proofPresent`). The persona's key-agreement key (`keyTypeUnsupported`). A key nobody holds (`keys:notFound`) |
| Can the agent sign as the persona? | No, with any of four entries: `permissionDenied` each time. Two have the agent's memory capabilities (bound to its memory, and with the persona's context added). Two carry the signing capability in the persona's context (listed alone, and every capability an `application` has); their `keys` scope is `none`, so the persona's key is not among the keys they may use |
| What does `vta/credentials/issue` 0.2 issue? | A credential whose issuer is **the VTA's own DID**, with the one credentials context, types `VerifiableCredential` and the type asked for, and no `issuerScope`. It is not the persona's credential and not the DTG shape |
| Who signs the acceptance? | The agent, with its own key; the rung makes one and it verifies with the agent's key and not with the persona's |

So the delegation credential is signed by the VTA, as the persona, with `keys/sign-document`, and the fallback
(the credential inside a Trust Task envelope the VTA signs) is not needed. One credential each VTA signed is kept
in `fixtures/vta-signed-as-persona-<version>.json`, and `proof.test.mjs` verifies it with no VTA running.

`keys/sign-document` 0.1 is also served at the pinned 0.79.0. The case itself cannot run there, because its agent
entries need `acl/grant` 0.3.

### Step 7.5, the fallback pairing: the entry as Keyring reads it back

One case, `pairing-readback`, for the lab half of step 7.5's fallback: the administrator plays Keyring, the rung
plays the agent. It is not one of step 0.1's items.

Keyring grants a throwaway key an `application` entry for two memories: listed `memory-read` and `memory-write`,
`keys` scope `none`, listed purposes `personalisation` and `taskExecution`, a label, and an `expiresAt` four hours
ahead. The agent signs in with that key, registers as `aiAgent`, and swaps to its own key. Keyring then reads back.

| Question | Result |
|---|---|
| Is the device found by its `deviceId`, under the new key? | Yes. `device/list` names the new key as `consumerDid` |
| Is anything left under the throwaway key? | No entry |
| Does the entry come back as granted? | Yes: `role`, `act` (both memories, in the order sent), `capabilities`, `keys`, `purposes` and `label` are the ones sent, and `expiresAt` is the same string. `acl/show` gives the same entry as `acl/list` |
| Where is the agent's kind? | On the device only: `consumerKind` is `{ kind: "service", serviceKind: "aiAgent" }`. The entry has no kind member |
| How are capabilities spelled? | Kebab-case on the entry (`memory-read`), camelCase on the device (`memoryRead`) |
| What does the entry carry that nobody sent? | `approve` (`{ scope: "none" }`), `createdAt`, `createdBy` and `delegatedBy` |

**Widening.** An entry granted one memory is widened with `acl/update` 0.3, sending `act` with both. The update
is accepted and its answer carries the entry; `act` then names both memories and every other member is unchanged.
The same update sent again is accepted, and the entry after it is the same. On a new session the agent writes
both memories.

**The record holds the entries, not verdicts.** The case records the entry sent, the entry from `acl/list` and
from `acl/show`, and the entry before the widening, in the update's answer, after it and after the second. A
value that differs on every run (a key, a context, a time) is recorded under a name, and the same value always
gets the same name (`record.mjs`), so two recorded entries are equal exactly when the VTA's two answers were. `cases.test.mjs`
asserts each line of the table above on those recorded entries, with no VTA running.

## Item 0.3: the notification checks

Item 0.3 asks how a Claude Code session is told a message arrived. It needs no mediator or VTA, so its probes live in
[`notify/`](./notify/README.md): a trivial channel, a throwaway plugin with the tool-gating hook and the hold-back,
the Monitor fallback and an `asyncRewake` hook, all measured on Claude Code 2.1.332 on 2026-11-26. In short: a
channel wakes an idle session but does not register in a background session; the Monitor fallback works in both;
the hook denies every tool but `reply` in auto mode with the tools pre-allowed.

## Not measured yet

- **For (f): a hosted persona, a status entry, and a verifier outside the rung.** The lab persona's log is hosted
  nowhere, so nobody resolves its DID over the network; the proof is checked with the document the VTA returned.
  How a status entry for the credential would be hosted is not measured (the plan omits one in P0). The check is
  the rung's own `eddsa-jcs-2022` code, not a second implementation.
- **The DIDComm and TSP path to the VTA**, for every VTA case: the lab VTA has no mediator, and the cases run over
  its HTTPS binding.
- **For step 7.5:** the same sequence with Keyring's own client in place of the rung's administrator, and the
  `auth/oob` `deviceEnrol` path, which no lab VTA serves.
- The parts that decide later tiers: (g), (i), (k), (m), (n), (r), (s), the room parts of (p) and (e).

Pinned against: `affinidi-messaging-mediator` `f6ed8159a` (v0.53.0); VTI `f7b78e29d` (the link producer, and vta 0.79.0), `97fda9813` (vta 0.84.0) and `4e5861d95` (vta 0.87.0);
`@openvtc/vti-didcomm-js` 0.16.1, `@noble/curves` 2.x.
