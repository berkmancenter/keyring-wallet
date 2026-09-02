# ref-08 — credential-exchange/{query,present,pending/*} against a real vta-service

> **Status (2026-09-01): auth proven, query path blocked — not a bug, a
> transport gap.** The DID-auth handshake round-trips end to end against a
> real, locally-provisioned `vta-service` (v0.23.3). Submitting the actual
> `credential-exchange/query` document fails with `unsupportedType` — the
> live dispatch table (`vta-service/src/trust_tasks/mod.rs`) only registers
> `credential-exchange/pending/{list,approve,deny}` for REST; `query` itself is
> reachable only through the DIDComm/TSP messaging inbound handler
> (`messaging::handlers::handle_credential_query`), which a REST-only VTA
> (`[messaging] kind = "skip"`, what `e2e/lib/vta.js`'s `startVta()` defaults
> to) never wires up. See "What this proves" below for what's confirmed vs.
> what needs a messaging-enabled VTA next.

`trust_tasks_subtask.md` §9 step 4 ("Adopt `credential-exchange/{query,present,
pending/*}`... against `vta-service`") was blocked on "needs a running VTA" —
`e2e/lib/vta.js` (this session) removed that blocker. This rung is the first
attempt at the actual exchange.

Run against a live VTA (see `e2e/lib/vta.js`'s `startVta()` for how to stand
one up — this rung expects its `vtaUrl` and `vtaDid`):

```bash
npm install
node run.mjs <vtaUrl> <vtaDid>
```

The verifier holder DID is random per run by default. Since `/auth/challenge`
itself ACL-gates on the subject DID (see "What this proves" — every REST
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
3. **`credential-exchange/query` is not in the REST dispatch table.** Tried
   both `/0.1` (the version in `vta-sdk/src/protocols/credential_exchange.rs`)
   and `/1.0` (the version in the `pending-*` handlers' own doc comments, in
   case of a version bump) — both `422 unsupportedType`. Cross-checked against
   `vta-service/src/trust_tasks/mod.rs`'s dispatch-table macro invocation
   directly: only `PENDING_LIST` / `PENDING_APPROVE` / `PENDING_DENY` are
   registered there. `QUERY` (and `PRESENT`) aren't macro-dispatch entries at
   all — they're received over DIDComm/TSP messaging (`vta-service/src/
   messaging/`), a code path a REST-only VTA never enables.

## What's still needed

A messaging-enabled VTA (`[messaging] kind = "create_mediator"` in
`e2e/lib/vta.js`'s setup TOML, or `"existing"` against a real mediator DID) and
a counterparty that can speak DIDComm/TSP to it — this rung's plain
`fetch()`-based REST client can't reach the query path no matter what it sends.
That's the next increment, not a fix to this one.

Once a query is actually deferred, the **admin** side (`pending-list` /
`pending-approve` / `pending-deny`) *is* reachable over REST today — this rung
didn't get to exercise it (nothing to list yet) but the dispatch-table
cross-check above confirms the handlers exist and are wired.
