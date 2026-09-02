# ref-10 — a real Askar-backed adapter for `tsp-core`'s ports

Closes the one gap `ref-09-tsp-core-ports` left open by its own README:
*"A real Askar-backed `KeyAgreement`/`SigningKey` adapter... still open."*
Where ref-09 proved the port *shape* is right — a raw in-memory key and a
simulated opaque/async identity both satisfy `SigningKey`/`KeyAgreement`
with no protocol change — this rung proves a **real Askar wallet**, behind
**two real `@credo-ts/node` 0.6.3 agents**, satisfies it too. Full
background: `docs/plans/openvtc-integration-plan/2026-09-02-bam.md`.

## What this proves

Same four-level structure as ref-09, now against real Askar throughout:

1. **Official CFRG vectors, through real Askar.** The vector's fixed keys
   are imported into two separate agents' wallets (Credo's public
   `kms.importKey`); `AuthEncap`/`AuthDecap`/`seal`/`open` all reproduce the
   vector's `enc`, `shared_secret`, and ciphertext exactly.
2. **Askar's DH == noble's DH, byte-for-byte.** The same known key pair fed
   to `ref-03-noble-crypto`'s unmodified `hpke-noble.mjs` directly and
   through this rung's real Askar adapter produce identical `enc` and
   ciphertext. Not assumed — measured. Also checks that the
   `keyFromKeyExchange` output-algorithm tag (`c20p` here) is inert: a
   second derivation tagged `a256gcm` yields the identical raw bytes.
3. **Full round trip and both failure modes, real Askar-generated keys** —
   across three separate agents (alice/bob/eve), keys that never exist as
   raw bytes in this process at all. Tampered ciphertext and wrong
   recipient are both still rejected. The `SigningKey` port is checked too
   (Ed25519, via Credo's public `kms.sign`).
4. **Cross-agent DH agreement** — alice and bob, two independent Askar
   wallets, each call `agree()` against the other's real public key. Both
   sides derive the identical shared secret. This is the one thing ref-09's
   single-process simulation could not prove: two real, independent custody
   boundaries agreeing on the same value.

## The finding: signing and key agreement take different routes through Credo

- **`SigningKey.sign`** rides Credo's fully **public** `KeyManagementApi`
  unchanged (`kms.sign({ keyId, algorithm: 'EdDSA', data })`) — the same call
  `bifold/packages/trust-tasks/src/documentProof.ts` already makes in
  production. No bypass, nothing new.
- **`KeyAgreement.agree`** has no public equivalent. Credo 0.6.3's
  `KeyManagementApi` genuinely has no derive/key-exchange operation (its
  `.d.ts`: create/sign/verify/encrypt/decrypt/import/getPublicKey/delete/
  randomBytes) — confirming the parent plan's §4.3 finding. The operation
  exists only on the raw `askar-shared` `Key` object
  (`key.keyFromKeyExchange`), reached by fetching the stored key straight
  out of an Askar session.

**That fetch is not a fork or a private-API reach-around.** `AskarStoreManager`
is exported from `@credo-ts/askar`'s public package index and registered as a
resolvable singleton on the agent's own dependency manager
(`AskarModule.register`), and its `withSession` method is public (not
`private` in the class, unlike a few of its siblings). Credo's own
`AskarKeyManagementService` gets from an agent context to a session the exact
same way: `agentContext.dependencyManager.resolve(AskarStoreManager).with
Session(...)` — verified directly against `@credo-ts/askar`'s built source
(`kms/AskarKeyManagementService.mjs`). `askar-adapter.mjs` calls the identical
public method from outside the module instead of from inside it. This is the
"public extension point... no fork by default" the parent plan's §4.3 called
for, demonstrated rather than assumed.

## A real import-order gotcha, worth keeping in view

`@credo-ts/askar`'s compiled `AskarKeyManagementService.mjs` captures the
`askar` binding from `@openwallet-foundation/askar-shared` **at its own
module-evaluation time**, not as a live read. If that module evaluates
before `@openwallet-foundation/askar-nodejs`'s side-effecting
`NativeAskar.register(...)` runs, every `kms.createKey` / `kms.sign` call
fails later with `TypeError: Cannot read properties of undefined (reading
'keyGetJwkSecret')` — even though the registration genuinely succeeded (a
direct CJS `require` of the same module, checked side by side, shows the
binding correctly set). Measured by isolating a minimal repro and swapping
only the import order: this is the entire fix, which is why `run.mjs`'s
very first import is a bare `import "@openwallet-foundation/askar-nodejs"`,
ahead of every `@credo-ts/*` import. Anyone standing up a Node script (or a
future `credo-tsp-adapter` module init path) against `@credo-ts/askar`
0.6.3 + `@openwallet-foundation/askar-shared` 0.6.0 should order imports the
same way.

## Files

- `askar-adapter.mjs` — `createAskarKeyAgreement`, `importAskarKeyAgreement`
  (test-only, known keys), `createAskarSigningKey`: real Askar-backed
  implementations of ref-09's `KeyAgreement`/`SigningKey` port shapes.
- `run.mjs` — the four levels of proof above, against three live
  `@credo-ts/node` agents.

## What's still needed for `ref-07-credo-adapter` itself

This closes the Askar-adapter half of what ref-09's README left open. Still
open, per that same list:

- ~~A `VidResolver` port~~ — **done**, see
  [`ref-11-vidresolver-port`](../ref-11-vidresolver-port/).
- **The Credo trust-task client for `bindings/didcomm-v1/0.1`** (§7.9) — note
  this may already be substantially covered by `@bifold/trust-tasks`'s
  `ceremony.ts` (`sendTrustTaskDocument`/`setupTrustTasksInbound`), which
  `trust_tasks_subtask.md`'s step 1 already marks resolved in code; worth
  reconciling against that document rather than re-deriving from ref-09's
  older list.
- Wiring this adapter into an actual `credo-tsp-adapter` package (§5.2) as an
  external Credo Module, rather than living only as a reference script.

## Running it

```sh
npm install && npm start   # verbose walk-through
npm run check              # quiet pass/fail only
```

Needs `ref-03-noble-crypto`'s and `ref-09-tsp-core-ports`'s files (imported
directly, not duplicated) — no separate install needed for those, they're
plain `.mjs` with no build step.
