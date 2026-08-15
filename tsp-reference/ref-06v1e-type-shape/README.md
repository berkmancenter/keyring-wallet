# ref-06v1e — the binding-0.2 `@type` shape, probed on Credo

**Question this rung answers:** Glenn's explicit ask on #216/#173 — he chose
`https://trusttasks.org/binding/didcomm-v1/0.2/trust-task/1.0/task` as the
dedicated carriage's RFC 0020 message type, with the **binding version (0.2)
inside the doc-uri** and a separate RFC 0020 **protocol version (1.0)**. "You
have the deployment experience; if Credo's routing or discover-features wants
a different shape, say so — nothing depends on it yet."

**Answer: the shape works on Credo 0.6.3 exactly as designed — with three
consequences worth writing into the binding.** 15 checks, all pass.
`npm install && node run.mjs` (deps identical to ref-06v1d).

## What the probe shows

1. **Decomposition** (act 1): Aries tooling parses it precisely as §1 intends —
   protocol `trust-task`, version `1.0`, message `task`, with `…/0.2` landing
   in the doc-uri where version tooling never looks.
2. **Routing** (act 2): delivered, no surprises.
3. **The 1.0 slot carries RFC 0020's tolerance** (act 3): a handler registered
   at `1.0` accepts `1.3`-typed traffic — same-major compatibility works, both
   in `canHandleMessageType` and in live dispatch.
4. **A binding bump is a new protocol identity** (act 4): a `0.3`-doc-uri
   message never reaches the `0.2` handler. The receiver's dispatcher rejects
   it as unhandled; over real transports the sender never learns. This is the
   same accepted-loss §2.3 already records for 0.1→0.2 — the probe shows it
   recurs at **every** future binding bump, because the two version numbers
   split the work: the binding version changes identity, the protocol version
   changes compatibility.
5. **Discover-features needs two sentences in the binding** (act 5):
   registering a message handler does **not** advertise the protocol — a
   conforming agent must register the feature explicitly (`DidCommProtocol`
   with the 0.2 protocol id); and a peer asking about Trust Tasks support
   across binding versions must query a **doc-uri wildcard**
   (`…/binding/didcomm-v1/*`) — exact ids do not cross-match binding versions.

## The verdict for the reply

Accept the shape — it routes, decomposes, and version-matches exactly as
designed, and the two-audience split (§1) is real in Credo's behavior. Ask for
two additions rather than a different URI: a discover-features paragraph
(explicit feature registration + the wildcard query convention), and a §6 note
making explicit that the RFC 0020 protocol version's compatibility mechanics
only operate *within* a binding version — cross-binding reach is capability
negotiation's job, never the type system's.

## Files

- `run.mjs` — 15 checks: decomposition, routing, minor-tolerance, binding-bump
  identity, discover-features registration + wildcard semantics
- deps: identical to ref-06v1d (Credo 0.6.3; `node_modules` symlinked to it)
