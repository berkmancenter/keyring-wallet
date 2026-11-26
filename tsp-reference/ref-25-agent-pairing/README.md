# ref-25-agent-pairing: what connecting an AI agent needs from a mediator and a VTA, measured

The reference program for step 7.1 of
[`docs/plans/agent-connect-plan.md`](../../docs/plans/agent-connect-plan.md): the measurements that come before any
app change. It runs under Node with `ws`, on a lab that listens on loopback only, and it changes nothing in the
app. A result that differs from the plan changes the plan, in the same pull request.

**What is measured so far: the mediator half.** Items 0.1(a), 0.1(h), 0.1(j) and 0.1(q). The VTA items (0.1(b)
to (f), (l), (o), (p)) need a VTA built at the pin and are not in this rung yet; they are listed at the end.

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
npm test                                # 26 offline tests: packing, forward, refusal reading, the links
lab/mediator.sh up mailbox              # or: open, deny
npm start                               # every case for that mode, against the recorded result
lab/mediator.sh down
node measure-links.mjs <a VTA's DID>    # step 0.1(h)
```

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
| `auth/oob`, `_from` a `did:webvh` of 84 bytes (the shape of our lab VTA's DID: a 46-character SCID and a 27-character host) | 192 | 59 | 10 | yes |
| `auth/oob`, `_from` a `did:webvh` of 80 bytes with a path | 188 | 63 | 10 | yes |
| `auth/oob`, `_from` a `did:peer:2` of 504 bytes | 612 | over by 361 | 19 | yes |
| Fallback `agent-connect`, `_from` a `did:key` (56 bytes), no scope | 170 | 81 | 9 | yes |
| The same with the widest scope, `&_scope=rwpo` | 182 | 69 | 9 | yes |

- **The longest VTA DID an `auth/oob` link can carry is 143 bytes.** For a `did:webvh` with a 46-character SCID
  that leaves 86 bytes for the host and any path.
- **The scope fits.** The plan left its encoding to this step. The rung encodes capabilities as one letter each
  (`r` memory read, `w` memory write, `p` room present, `o` room open) and purposes as names after `~`, in a
  flow member `_scope`; that costs 8 bytes plus the scope, against 81 spare.
- A `did:peer:2` cannot be the `_from` of a link at this limit.

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

## Not measured yet

The VTA items of step 0.1 need a VTA built at VTI `f7b78e29d` with an administrator session: (b) `device/register`
and the delegate refusal, (c) what `acl/swap-key` keeps, (d) `acl/grant/0.3` with listed capabilities and
purposes, (e) refusal after `acl/revoke`, (f) which task signs a credential as the persona, (l) revoke by
`deviceId` across a key swap, (o) the context hierarchy rule, and (p) memory binding and creation. Items (g),
(i), (k), (m), (n), (r) and (s) decide later tiers and follow them.

Pinned against: `affinidi-messaging-mediator` `f6ed8159a` (v0.53.0), VTI `f7b78e29d` (the link producer),
`@openvtc/vti-didcomm-js` 0.16.1, `@noble/curves` 2.x.
