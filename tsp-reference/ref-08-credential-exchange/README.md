# ref-08 — credential-exchange/{query,present,pending/*} against a real vta-service

> **Status (2026-09-02): the query round trip works end to end over
> DIDComm-via-mediator.** `run.mjs` (REST) proves the DID-auth handshake but
> hits `422 unsupportedType` on the query itself — it's not in the REST
> dispatch table. `run-messaging.mjs` (DIDComm, via `@openvtc/vti-didcomm-js`
> and a locally-run mediator) reaches it: the VTA receives, processes, and
> correctly answers `credential-exchange/query/0.1` with a
> `report-problem/2.0` (`e.p.msg.not-found` — no held credential satisfies the
> query, which is correct: this VTA holds none). See "What this proves" for
> both scripts' findings; "What's still needed" for what's left (a held
> credential, to reach the defer/approve/present half).

`trust_tasks_subtask.md` §9 step 4 ("Adopt `credential-exchange/{query,present,
pending/*}`... against `vta-service`") was blocked on "needs a running VTA" —
`e2e/lib/vta.js` (this session) removed that blocker. This rung is the actual
exchange.

## Phase 1 — REST auth (`run.mjs`)

Run against a REST-only VTA (`e2e/lib/vta.js`'s `startVta()` with no
`mediatorDid`):

```bash
npm install
node run.mjs <vtaUrl> <vtaDid>
```

The verifier holder DID is random per run by default. Since `/auth/challenge`
itself ACL-gates on the subject DID (see "What this proves" #2 — every REST
caller needs *some* ACL role, not just credential-exchange callers), a fresh
run always 403s until you grant it one. Pin the holder across runs and grant
it once:

```bash
node run.mjs <vtaUrl> <vtaDid>              # prints VERIFIER_SECRET_KEY + the import-did command to run
# on the VTA: stop the daemon, then:
vta --config <path> import-did --did <the did:key printed> --role initiator
# restart the daemon, then:
VERIFIER_SECRET_KEY=<the hex printed> node run.mjs <vtaUrl> <vtaDid>
```

## Phase 2 — the query, over DIDComm via a mediator (`run-messaging.mjs`)

Needs a messaging-enabled VTA (`startVta({ mediatorDid })`) and a running
mediator — `e2e/lib/mediator.js`'s `startMediator()` (new) does both: a
disposable local `did:peer` mediator behind its own cloudflared tunnel,
needs a local redis reachable at `MEDIATOR_REDIS_URL` (default
`redis://127.0.0.1/`).

```js
import { startMediator } from "../../e2e/lib/mediator.js";
import { startVta } from "../../e2e/lib/vta.js";

const mediator = await startMediator();
const vta = await startVta({ mediatorDid: mediator.mediatorDid });
// vta.vtaDid, mediator.mediatorDid — pass to run-messaging.mjs below
```

Then, same ACL dance as phase 1 but for a fresh **X25519** `did:key` (the
mediator/VTA DIDComm path uses X25519 key agreement directly, not an
Ed25519-derived one — see "What this proves" #4):

```bash
node run-messaging.mjs <vtaConfigPath> <vtaDid> <mediatorDid>   # prints VERIFIER_X25519_SECRET_KEY + the import-did command
# grant it (stop daemon, import-did --role initiator, restart), then:
VERIFIER_X25519_SECRET_KEY=<the hex printed> node run-messaging.mjs <vtaConfigPath> <vtaDid> <mediatorDid>
```

## What this proves

1. **`@bifold/trust-tasks`'s `eddsa-jcs-2022` Data-Integrity proof construction
   is byte-for-byte interoperable with the real ecosystem's verifier.** This
   rung hand-rolls the same algorithm `documentProof.ts` implements — JCS
   canonicalize, `sha256(JCS(proof config)) || sha256(JCS(document without
   proof))`, ed25519-sign, multibase(base58btc) — confirmed against
   `vta-sdk/src/trust_task_sign.rs`'s Rust implementation (same construction,
   same field names) rather than assumed, and the real `vta-service` accepted
   it: `POST /auth/` returned a valid access + refresh token pair for a
   holder-signed `auth/authenticate/0.1` document.
2. **Every REST caller needs an ACL role, not just credential-exchange
   ones.** `POST /auth/challenge` returned `403 forbidden: DID not in ACL` for
   an unregistered `did:key`, even though this is normally the *first* stop for
   an unknown party. So the "verifier the holder hasn't pre-trusted" framing in
   `vta-sdk/src/protocols/credential_exchange.rs`'s module doc is about a
   *second*, finer-grained trust tier (auto-answer vs. defer) *on top of* bare
   ACL membership — not a substitute for it. Confirmed by granting the
   `initiator` role and getting a 200.
3. **`credential-exchange/query` is not in the REST dispatch table — it's
   messaging-only, and it works there.** `run.mjs` tried both `/0.1` (the
   version in `vta-sdk/src/protocols/credential_exchange.rs`) and `/1.0` (the
   version in the `pending-*` handlers' own doc comments) over REST — both
   `422 unsupportedType`. Cross-checked against `vta-service/src/trust_tasks/
   mod.rs`'s dispatch-table macro invocation directly: only `PENDING_LIST` /
   `PENDING_APPROVE` / `PENDING_DENY` are registered there; `QUERY` isn't a
   macro-dispatch entry at all. `run-messaging.mjs`, going in over
   DIDComm-via-mediator instead (`@openvtc/vti-didcomm-js`'s
   `connectVtaViaMediator`/`sendAndWait`), reaches it directly — no REST
   fallback path, no dual-accept: the query is messaging-only, full stop.
4. **The messaging path skips the REST ACL/auth handshake entirely.** No
   `/auth/challenge` step for `run-messaging.mjs` — per `vti-didcomm-js`'s own
   docs, "the inner authcrypt envelope is self-authenticating and the VTA
   ACL-checks the `from` DID." The client still needs *an* ACL role on the
   VTA (granted the same `initiator` role, same as phase 1), but the identity
   is a **native X25519** `did:key` (`z6LS...`), not the Ed25519 one REST
   auth uses — DIDComm key agreement needs X25519 directly, and
   `vti-didcomm-js` takes the keypair as a direct argument rather than
   deriving one from an Ed25519 DID.
5. **A query the VTA can prove nothing satisfies is answered `not-found`, not
   deferred.** Expected (from reading `vta-sdk`'s docs) that any query from an
   unrecognized verifier would defer pending admin approval. Instead: a
   `report-problem/2.0` with `code: "e.p.msg.not-found"`, `comment: "no held
   credential satisfies the verifier's query"` — correct, since this VTA holds
   zero credentials, but a real behavior distinction worth recording: deferral
   is for a query the VTA *might* be able to answer once a human decides;
   `not-found` is a fast-path refusal when nothing held could ever match,
   checked before deferral logic runs at all.

## What's still needed

- **A held credential matching the DCQL query**, to reach `not-found`'s
  sibling path — deferred, `pending-list`, `pending-approve` (returning a real
  `vp_token`), and `run.mjs`'s REST admin surface actually exercised against a
  live pending record instead of only cross-checked against the dispatch
  table.
- **The Node reference-adapter fixtures** the parent step's "done when" also
  requires.
