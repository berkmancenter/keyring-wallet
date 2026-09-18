# ref-07d-vocabulary-trust-path

[cred-spec #45](https://github.com/trustoverip/dtgwg-cred-spec/issues/45) open
question 3 asks whether ToIP should host a registry of common predicates, *"or is
that a governance-framework matter?"* The natural implementer answer is *"the
JSON-LD context already does this — a registry is bureaucracy."*

This rung measures what actually happens when a wallet meets a predicate whose
vocabulary it does not bundle. The answer changes question 3 from a governance
preference into an integrity requirement.

```sh
npm install && node run.mjs
```

No external network: a local HTTP server plays the community's vocabulary host and
every request to it is counted.

## The subject is the real loader

`createVrcDocumentLoader` (`core/src/modules/vrc/createVrcDocumentLoader.ts`) is
the document loader the Keyring agent is configured with
(`app/src/utils/bc-agent-modules.ts:185`). This rung loads the **compiled shipped
module** and drives it directly — the DID resolver is stubbed because no `did:`
URL is used here, so every `http(s)` URL takes the real code path.

Its last branch is the whole subject of this rung:

```ts
// Fallback: fetch remote context via HTTP
const response = await fetch(url)
```

Five contexts are bundled. Everything else is fetched, unauthenticated, uncached,
with no allowlist.

## What it proves

**Check 0.** The five bundled contexts resolve with **0 network requests**. That is
the design: Keyring bundles contexts so verification works offline.

**Check 1 — verification phones home.** One unbundled community context produces
**one outbound request to that community's server, at verification time**. The
vocabulary host learns which verifier is reading which kind of credential, and
when. In a specification whose central privacy mechanism is
[correlation scope](https://trustoverip.github.io/dtgwg-cred-spec/#correlation-scope),
this is a correlation channel in the *verifier* rather than in the credential — and
it is not visible to the holder, who chose the scope of everything else.

**Check 2 — offline, the credential cannot be verified at all.** With the host
unreachable the loader throws `fetch failed`. A community predicate opts that one
credential out of the offline guarantee every other credential in the wallet has.

**Check 3 — the vocabulary host retroactively controls what the signature
covered.** One URL, two versions. Version 1 defines the predicate term; version 2
withdraws it, changing nothing else:

- while v1 is served, the predicate contributes **1 quad** and the statement is
  signed and verifies;
- after the host serves v2, the same predicate contributes **0 quads**;
- the **original signature no longer verifies** — the signed dataset changed
  underneath it, without the credential, the key, or the issuer changing;
- and any statement signed *after* the withdrawal has a freely swappable verb:
  `acme:observedDocument` and `acme:didNotObserveDocument` verify against each
  other's signatures.

So whoever controls the context URL can invalidate every credential ever issued
under it, and can silently remove the predicate from the covered dataset of every
credential issued after. Not by compromising a key — by editing a JSON file.

## What this says about open question 3

The context is the right **mechanism** and no registry replaces it. But under an
RDF-canonicalized proof suite, the context is a **mutable, network-fetched,
third-party dependency inside the trust boundary**, and the question stops being
*"does ToIP want the maintenance burden"*. It becomes: **what makes a vocabulary
safe to depend on?**

Three properties would do it, and none require a governance gate:

1. **Immutability** — a context version, once published, never changes meaning.
2. **Integrity** — the credential names the vocabulary it was signed against by
   digest, so a verifier can tell it fetched the right one. (`digestSRI` already
   exists in `credentials/v2` for exactly this shape of problem.)
3. **Availability offline** — a verifier can hold the vocabulary in advance,
   which requires it to be discoverable in advance.

A registry is one way to get all three. Content-addressing plus a non-normative
index of community contexts is another, cheaper one. What does **not** work is the
status quo — an unversioned URL fetched at verification time — and that is what
"just use the context" means today in at least one shipping wallet.

## What it does NOT prove

- **Not a claim that anyone does this.** Check 3 demonstrates a capability, not an
  observed attack. No community vocabulary was harmed.
- **Not specific to Keyring's loader.** Any RDF-canonicalizing verifier that
  resolves contexts at verification time has the same exposure; ours is simply the
  one available to instrument. A verifier with a hard allowlist and no fallback
  fetch has the availability problem instead.
- **Nothing about `eddsa-jcs-2022`.** JCS covers every member with no vocabulary
  at all, so none of this applies to the JCS half of the
  [PR #18](https://github.com/trustoverip/dtgwg-cred-spec/pull/18) proof set — see
  `ref-07c` Check 5. That is the mitigation, and it is already our proposal.
- **No caching analysis.** Whether Credo, jsonld.js, or the platform HTTP stack
  would cache a fetched context in practice is unmeasured; the loader itself does
  not.
- **Nothing about DID resolution**, which is the other network dependency in the
  same loader and has its own version of this problem.

Pinned against: `@bifold/core` and `@bifold/vrc-contexts` at the current working
tree; `dtgwg-cred-spec` @ `WD02` (6714971).
