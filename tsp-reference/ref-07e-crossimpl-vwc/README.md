# ref-07e-crossimpl-vwc

The only two implementations of the DTG credential spec that exist — Keyring
(TypeScript, hand-rolled) and **`dtg-credentials` 0.7.0** (Rust, the catalogue
the VTC mints from) — talking to each other in **both directions**, with real
signatures.

```sh
npm install && node run.mjs      # acts 1-4 call the crate; acts 5-6 need nothing
npm run mint                     # re-mint the frozen reference fixture
```

`ref-07b` asked "does their library accept our JSON?" — a parse test. This rung
asks the questions that matter if Keyring is going to consume VWCs from VTA/VTI
infrastructure:

| Act | Question | Answer |
|---|---|---|
| 1 | Can we verify a VWC **they** minted? | **Yes**, after we fixed our own bug |
| 2 | Can they verify a VWC **we** signed? | **Yes**, same fix |
| 3 | Do Keyring's own checks work on their VWC? | **2 of 4** today; 4 of 4 after the WD02 placement fix |
| 4 | Do our digests agree? | **Byte-identical.** The value *form* still diverges |
| 5 | Does the unpublished DTG context matter? | Only if your proof suite is RDF-canonicalized |
| 6 | Brendan's gap on #45 | Demonstrated: profile test passes, claim not established |

Nothing here reimplements the crate. `mint-rs/` is a four-subcommand shim whose
every operation is a call into the published library: `new_vwc` + `sign`,
`verify_proof_with_public_key`, `digest_multibase_json`, `verify_digest`.

## Act 1 & 2 — and the bug this rung found in *our* code

The first run failed in both directions: our `eddsa-jcs-2022` could not verify
their signature, and theirs could not verify ours. A four-way probe over the
possible hash constructions isolated it — the crate hashes the proof
configuration **without** the document's `@context`; our helper attached it.

[vc-di-eddsa](https://www.w3.org/TR/vc-di-eddsa/) settles it. *Proof
Configuration (eddsa-jcs-2022)* has five steps and **none of them touches
`@context`** — that step exists only in the `eddsa-rdfc-2022` variant. **The
crate was right and we were wrong.**

The fix is one deleted line in `eddsa-jcs-2022.mjs`, and both directions then
pass. Worth being precise about the blast radius: that helper is **rung-only**
(production VWCs are signed by Credo with `Ed25519Signature2018` or
`eddsa-rdfc-2022`), so nothing shipped was affected. But
[cred-spec PR #18](https://github.com/trustoverip/dtgwg-cred-spec/pull/18) — ours —
proposes `eddsa-jcs-2022` as half of a proof set, so this is precisely the bug we
would have shipped when implementing it.

It is also a clean illustration of the single-implementation blind spot:
`ref-07`'s fixtures were signed *and* verified with the same wrong helper, so
every check passed. Nothing inside one implementation can find that class of
error. (Re-signing those fixtures with the corrected helper was required; `ref-07`
is green again.)

## Act 3 — can Keyring consume their VWC?

Keyring's four VWC checks, run against a credential the reference implementation
minted:

| Keyring check | on their VWC | accessor |
|---|---|---|
| `isWitnessCredential(cred)` | works | `credentialTypes.ts:72` (imported, real) |
| witnessed digest present | **fails** | `WitnessService.ts:2545` — reads `credentialSubject.digest` |
| `taskContext` read | **fails** | `witnessCeremony.ts:169` — reads `credentialSubject.taskContext` |
| subject id present | works | `credentialSubject.id` |

Both failures are ours: they write `digestMultibase` where we read `digest`, and
they put `taskContext` at the top level where we read it inside
`credentialSubject`. **WD02 says they are right on both counts.** Re-running the
same four checks with WD02 placement gives 4 of 4 — so *"can Keyring consume a
VTA-issued VWC?"* has a concrete answer: **yes, after two field-placement fixes we
already owed.**

`witnessCeremony.ts` cannot be imported into plain Node (it pulls
`@openvtc/trust-tasks` subpaths that package does not export), so its accessor is
transcribed with its `file:line` rather than called. `credentialTypes` is the real
compiled module.

## Act 4 — the digests agree; the value form does not

Their `digest_multibase_json` and our WD02 encoding produce the **same string**
for our real captured VRC:

```
zQmWjM6SXQvDn7jDuU4SxwiL1xSaCEVQosKrYFhWcaPwQvM
```

Two independent implementations, one digest. That is the single most reassuring
result in this rung, and it is what makes #45's `object.digestMultibase` safe to
propose: the mechanism already interoperates.

The rename then splits in two, and the crate separates them cleanly:

- the **member name** `digest` is accepted as an alias for `digestMultibase` →
  `DIGEST-MATCH`
- the **value form** `sha256:<hex>` is rejected as malformed → *"not a well-formed
  digestMultibase value: multibase: Unknown base code: s"*

Keyring emits the second one today (`witness-server`'s `computeVrcDigest`). So
this is `ref-07` self-finding #2 — *"legacy digest form, known, planned"* —
measured against the other implementation instead of against spec text, and the
error message it produces is precise enough to debug from.

## Act 5 — neither DTG context is published

| | context | proof suite | needs the context to verify? |
|---|---|---|---|
| them | `https://firstperson.network/credentials/dtg/v1` | `eddsa-jcs-2022` | **no** |
| us | `https://trustoverip.org/credentials/witnessed-exchange/v1` | `eddsa-rdfc-2022` / `Ed25519Signature2018` | **yes** |

Both URLs return **HTTP 404** (checked 2026-09-10; recorded, not re-fetched in
the run). JCS canonicalizes the JSON and never resolves a context, so an
unpublished vocabulary costs the reference implementation nothing. Both of ours
expand JSON-LD, so our credentials verify **only because Keyring bundles its
context locally**. A third party cannot verify either credential with an
RDF-canonicalized suite today.

That is the concrete stake in #45's open question 2: a `predicate` expressed as a
CURIE is a dependency on an artifact that does not yet exist. See `ref-07c`
(what the signature covers) and `ref-07d` (what fetching it costs).

## Act 6 — the profile test passes and the claim is still not established

#45's test: a credential is a profile if verification is *"check the signature,
check the status, read the claim."* This act builds a statement-shaped VWC that
passes **all three**, with a recognised predicate (`dtg:witnessed`, in the
verifier's accepted vocabulary) and every constraint the strawman states
satisfied — object kind legal, `taskContext` present, real signature over a real
digest:

```
step 1 — check the signature ............... PASSES
step 2 — check the status .................. PASSES
step 3 — read the claim .................... PASSES
every stated profile constraint ............ SATISFIED
step 4 — fetch the outcome evidence ........ NOTHING IS THERE
```

The ceremony never happened. No initiating document, no terminal success
response, nothing matching `taskContext`. A verifier that read *"the VWC is a
simple profile"* as licence to stop after step 3 would accept this credential and
believe a witnessed exchange occurred.

This is the failure mode raised on the issue, made executable: structural
simplicity of a credential and complete verifiability of its claim are different
properties, and the profile test only measures the first. The act closes by
showing the check that catches it — matching the retained outcome-evidence pair —
which lives entirely **outside** the credential, which is why no rule about the
credential's shape can discharge it.

## What it does NOT prove

- **The reference implementation's VWC is not a live VTA/VTC artifact.** It is
  minted by the same library the VTC mints from, in-process, with an ephemeral
  `did:key`. A credential from a running VTC could differ (it splices a top-level
  `id` and `credentialStatus` before signing).
- **Act 3 is field-presence, not semantics.** It shows our accessors find their
  members; it does not run our full ceremony verification, which needs a Credo
  agent.
- **Act 6's outcome store is a stub.** The point is the shape of the inference,
  not our storage layer. The real retained pair is `ref-07` Check D.
- **Nothing about the statement type being adopted.** Act 6 assumes #45's shape C
  to demonstrate a property of the *test*, not to endorse the shape.
- **No RDF canonicalization here at all.** Act 5 states the consequence; `ref-07c`
  measures it.
- **The crate is pinned by cargo, not by us.** `mint-rs/Cargo.toml` asks for
  `dtg-credentials = "0.7"`; a 0.7.x patch could change behaviour under the rung.

Pinned against: `dtg-credentials` 0.7.0 (crates.io), `dtgwg-cred-spec` @ `WD02`
(6714971), `@bifold/*` at the working tree.
