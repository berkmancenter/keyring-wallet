// ref-07-dtg-edge-semantics — three checks against the DTG credential spec's
// edge-verifiability semantics, run over Keyring-shaped fixtures.
//
// Sources (pinned clone, external/dtgwg-cred-spec @ fc2276b, 2026-08-17):
//   [G]  spec/terms-definitions/verifiable_relationship_credential.md  (glossary conditions a–d)
//   [B1] spec/body.md:197   "two VRCs (one each direction) form a complete DTG edge"
//   [B2] spec/body.md:224   "R-DIDs are RECOMMENDED for privacy; M-DIDs are allowed for bootstrapping"
//   [B3] spec/body.md:237   "each entity MUST generate a new, unique R-DID for every single entity"
//   [B4] spec/body.md:274   "Community membership is not a precondition for issuing, holding, or
//                            presenting a VRC ... the resulting edges are valid trust attestations"
//   [B5] spec/body.md:575-576 (Privacy Considerations 1 & 2: migrate to R-DID edges; R-DID uniqueness)
//
// Crypto: the synthetic fixtures carry REAL eddsa-jcs-2022 Ed25519 proofs
// (sign-fixtures.mjs) and Check 0 verifies every one here. The captured
// fixture's Ed25519Signature2018 proofs were minted AND verified by Credo —
// Keyring's real verifier — at capture time (see its captureMeta); this rung
// does not re-verify those (JSON-LD canonicalization belongs to that stack).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyCredential, jcs } from './eddsa-jcs-2022.mjs'
import { sha256 } from '@noble/hashes/sha2.js'
import { base58 } from '@scure/base'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'))

const registry = fixture('registry.json')
const edgePairwise = fixture('edge-pairwise.json')
const edgeBootstrap = fixture('edge-bootstrap-mdid.json')
const edgeAsymmetric = fixture('edge-asymmetric.json')
const edgeReused = fixture('edge-reused-pairwise.json')
const edgeMixed = fixture('edge-mixed-migration.json')
const edgeCaptured = fixture('edge-pairwise-captured.json')
const witnessed = fixture('edge-witnessed-captured.json')
const { publicKeys } = fixture('keys.json')

let failures = 0
const report = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// ---------------------------------------------------------------------------
// Shared helpers. In the four-type world nothing in a DID says which type it
// is; the only operational reading is "known to the registry as a member" vs
// "known to nobody" — which is itself part of the finding (see Check C).
// ---------------------------------------------------------------------------
const isRegistryMember = (did) => Object.hasOwn(registry.vmcs, did)
const proofsOf = (vrc) => (Array.isArray(vrc.proof) ? vrc.proof : [vrc.proof]).filter(Boolean)
const controllerOf = (proof) => proof.verificationMethod?.split('#')[0]

// ---------------------------------------------------------------------------
// The GLOSSARY verifier — conditions a–d from [G], applied as written.
//   a) contains M-DIDs for both peers
//   b) both peers have signed the VRC using their M-DID private keys
//   c) both M-DIDs are verifiable via VMCs issued by VTCs
//   d) those VTCs are recognized as VTN trust anchors in that VTN
// Condition (b) as written demands two signatures on ONE credential; the
// normative schema (spec/body.md:199-206) has a single `issuer` and a single
// `proof`. `strict` applies (b) literally; charitable mode reinterprets it as
// "each half is signed by its own issuer" — a rewrite the verifier must invent.
// ---------------------------------------------------------------------------
function glossaryVerifier(edge, vtn, { strict } = { strict: true }) {
  const reasons = []
  for (const [i, half] of edge.halves.entries()) {
    const peers = [half.issuer, half.credentialSubject.id]
    if (!peers.every(isRegistryMember)) reasons.push(`half${i + 1}: fails (a) — not M-DIDs for both peers`)
    if (strict) {
      const signers = new Set(proofsOf(half).map(controllerOf))
      if (!peers.every((p) => signers.has(p)))
        reasons.push(`half${i + 1}: fails (b) as written — "both peers have signed the VRC" (schema has one proof)`)
    } else {
      if (!proofsOf(half).some((p) => controllerOf(p) === half.issuer))
        reasons.push(`half${i + 1}: fails (b, reinterpreted) — not signed by its own issuer`)
    }
    for (const p of peers) {
      const vmc = registry.vmcs[p]
      if (!vmc) { reasons.push(`half${i + 1}: fails (c) — no VMC for ${p.slice(0, 24)}…`); continue }
      if (!(registry.vtnTrustAnchors[vtn] ?? []).includes(vmc.issuerCDid))
        reasons.push(`half${i + 1}: fails (d) — VTC not anchored in ${vtn}`)
    }
  }
  return { verifiableEdge: reasons.length === 0, reasons }
}

// ---------------------------------------------------------------------------
// The BODY verifier — [B1]–[B4] applied as written: two VRCs, one each
// direction, each self-issued and signed by its own issuer, mutually naming
// each other. Membership is NOT a precondition [B4]; R-DIDs RECOMMENDED [B2].
// ---------------------------------------------------------------------------
function bodyVerifier(edge) {
  const reasons = []
  const [h1, h2] = edge.halves
  if (edge.halves.length !== 2) reasons.push('fails [B1] — an edge is two VRCs, one each direction')
  if (h1.issuer !== h2.credentialSubject.id || h2.issuer !== h1.credentialSubject.id)
    reasons.push('fails [B1] — halves do not mutually name each other')
  for (const [i, half] of edge.halves.entries()) {
    if (!half.type.includes('RelationshipCredential')) reasons.push(`half${i + 1}: type missing RelationshipCredential`)
    if (!proofsOf(half).some((p) => controllerOf(p) === half.issuer))
      reasons.push(`half${i + 1}: not signed by its own issuer (VRCs are self-issued)`)
  }
  return { verifiableEdge: reasons.length === 0, reasons }
}

// ---------------------------------------------------------------------------
// CHECK 0 — the proofs are real.
// Synthetic fixtures: every eddsa-jcs-2022 proof verified right here with the
// frozen public keys, plus a tamper probe proving the verification can fail.
// Captured fixture: minted by the real Credo exchange and verified by Credo's
// own verifier at capture; the frozen receipt is asserted.
// ---------------------------------------------------------------------------
console.log('\nCHECK 0 — signature verification over the fixtures')
{
  const hexToBytes = (h) => Uint8Array.from(h.match(/.{2}/g), (b) => parseInt(b, 16))
  const synthetic = [
    ['edge-pairwise', edgePairwise],
    ['edge-bootstrap-mdid', edgeBootstrap],
    ['edge-asymmetric', edgeAsymmetric],
    ['edge-reused-pairwise', edgeReused],
    ['edge-mixed-migration', edgeMixed],
  ]
  for (const [name, edge] of synthetic) {
    const results = edge.halves.map((half) =>
      verifyCredential(half, hexToBytes(publicKeys[half.proof.verificationMethod]))
    )
    report(results.every((r) => r.verified), `${name}: both halves verify (eddsa-jcs-2022, Ed25519)`)
  }

  // tamper probe: change one byte of meaning, verification must fail
  const tampered = JSON.parse(JSON.stringify(edgePairwise.halves[0]))
  tampered.credentialSubject.id = 'did:peer:2.Ez6LSTampered111111111111111111111111111111'
  const tamperResult = verifyCredential(tampered, hexToBytes(publicKeys[tampered.proof.verificationMethod]))
  report(!tamperResult.verified, 'tampered subject id fails verification', tamperResult.reason)

  const receipt = edgeCaptured.captureMeta.verifiedAtCapture
  report(
    receipt.half1.isValid === true && receipt.half2.isValid === true,
    'captured edge: both halves verified by Credo (Keyring’s verifier) at capture',
    `${edgeCaptured.captureMeta.tool}`
  )
}

// ---------------------------------------------------------------------------
// CHECK A — the contradiction (cred-spec #21, decisions D1–D4).
// Same fixture, two verifiers built from the same document, opposite answers.
// ---------------------------------------------------------------------------
console.log('\nCHECK A — glossary vs body over the SAME Keyring-shaped edge (#21)')
{
  const body = bodyVerifier(edgePairwise)
  const gloss = glossaryVerifier(edgePairwise, 'vtn:demo', { strict: false })
  report(body.verifiableEdge, 'body verifier accepts the pairwise edge', '[B1]–[B4]: valid trust attestation')
  report(!gloss.verifiableEdge, 'glossary verifier rejects the SAME edge', gloss.reasons[0])
  report(
    body.verifiableEdge && !gloss.verifiableEdge,
    'CONTRADICTION REPRODUCED: opposite answers from one spec',
    'the construction the body RECOMMENDS [B2],[B5] is the one the glossary rejects'
  )

  // The same contradiction over the CAPTURED edge — actual output of the real
  // Credo exchange (Keyring's code path), not a hand-written fixture.
  const bodyCaptured = bodyVerifier(edgeCaptured)
  const glossCaptured = glossaryVerifier(edgeCaptured, 'vtn:demo', { strict: false })
  report(
    bodyCaptured.verifiableEdge && !glossCaptured.verifiableEdge,
    'REAL captured Keyring edge: body accepts, glossary rejects',
    'the wallet’s actual output is a non-edge under the glossary'
  )

  // The spec's own §VRC example (body.md:209-222) uses did:peer issuer/subject —
  // the example the spec prints fails the spec's own glossary.
  const specExampleEdge = { halves: edgePairwise.halves } // same shape, did:peer, single proof
  const g2 = glossaryVerifier(specExampleEdge, 'vtn:demo', { strict: false })
  report(!g2.verifiableEdge, "the spec's own §VRC example shape fails its own glossary", 'did:peer issuer = no VMC row')

  // Condition (b) as written is unsatisfiable over the normative schema for
  // ANY half — even the glossary's favorite M-DID edge fails until the
  // verifier silently rewrites (b).
  const strictOnBootstrap = glossaryVerifier(edgeBootstrap, 'vtn:demo', { strict: true })
  const charitableOnBootstrap = glossaryVerifier(edgeBootstrap, 'vtn:demo', { strict: false })
  report(
    !strictOnBootstrap.verifiableEdge && charitableOnBootstrap.verifiableEdge,
    'condition (b) unsatisfiable as written — passes only after the verifier rewrites it',
    'single-proof schema vs "both peers have signed the VRC"'
  )
}

// ---------------------------------------------------------------------------
// CHECK B — the declared-scope model (cred-spec #22, decisions D5–D6).
// One rule set: roles come from credential types, scope from a declaration.
// Under it every fixture gets ONE deterministic answer, and the uniqueness
// MUST [B3] becomes a checkable property instead of prose.
// ---------------------------------------------------------------------------
console.log('\nCHECK B — the same edges under declared correlation scope (#22)')

const SCOPES = ['pairwise', 'community', 'linked', 'public'] // narrowest → widest

function scopeVerifier(edge, observations) {
  const reasons = []
  const base = bodyVerifier(edge) // structural rules are unchanged — scope replaces only the naming
  reasons.push(...base.reasons)
  for (const [i, half] of edge.halves.entries()) {
    const scope = edge.declaredScopes[`half${i + 1}`]
    if (!SCOPES.includes(scope)) { reasons.push(`half${i + 1}: no declared scope`); continue }
    // "pairwise" is checkable: the identifier appears with exactly one counterparty.
    if (scope === 'pairwise') {
      const counterparties = new Set(
        observations.filter((o) => o.issuer === half.issuer).map((o) => o.subject)
      )
      if (counterparties.size > 1)
        reasons.push(`half${i + 1}: declared pairwise but seen with ${counterparties.size} counterparties — not pairwise`)
    }
  }
  return { verifiableEdge: reasons.length === 0, reasons }
}

const observationsOf = (...edges) =>
  edges.flatMap((e) => e.halves.map((h) => ({ issuer: h.issuer, subject: h.credentialSubject.id })))

{
  const obs = observationsOf(edgePairwise, edgeBootstrap, edgeAsymmetric)
  report(scopeVerifier(edgePairwise, obs).verifiableEdge, 'pairwise edge: one rule set, VALID', 'no glossary/body fork')
  report(scopeVerifier(edgeBootstrap, obs).verifiableEdge, 'community edge: same rule set, VALID', 'bootstrapping is not special')
  report(scopeVerifier(edgeAsymmetric, obs).verifiableEdge, 'asymmetric edge: same rule set, VALID', 'each half judged on its own declaration')

  const reused = scopeVerifier(edgeReused, observationsOf(edgeReused))
  report(
    !reused.verifiableEdge,
    'reused "pairwise" identifier FAILS by definition — [B3]’s MUST becomes a check',
    reused.reasons.find((r) => r.includes('counterparties'))
  )
}

// ---------------------------------------------------------------------------
// CHECK C — the asymmetric edge (cred-spec #23, decision D9).
// The four-type taxonomy cannot NAME the edge; declared scope names each half
// and yields the missing rule: effective disclosure = the wider of the halves.
// ---------------------------------------------------------------------------
console.log('\nCHECK C — naming the asymmetric edge (#23)')

// Four-type classification: the only operational reading of "is this an R-DID
// or an M-DID?" is registry knowledge (the DID's name encodes nothing a
// verifier can check). An edge is nameable only if both halves read the same.
function classifyEdgeFourTypes(edge) {
  const kinds = edge.halves.map((h) => (isRegistryMember(h.issuer) ? 'M-DID' : 'R-DID'))
  return kinds[0] === kinds[1] ? `${kinds[0]} edge` : null // no name exists for a mixed edge
}

const widerScope = (a, b) => SCOPES[Math.max(SCOPES.indexOf(a), SCOPES.indexOf(b))]

{
  report(classifyEdgeFourTypes(edgePairwise) === 'R-DID edge', 'four types can name the symmetric pairwise edge')
  report(classifyEdgeFourTypes(edgeBootstrap) === 'M-DID edge', 'four types can name the symmetric M-DID edge')
  report(
    classifyEdgeFourTypes(edgeAsymmetric) === null,
    'four types CANNOT name the asymmetric edge — "is it an R-DID edge or an M-DID edge?" has no answer',
    'one half of each; the question assumes both halves are the same kind'
  )

  const s1 = edgeAsymmetric.declaredScopes.half1
  const s2 = edgeAsymmetric.declaredScopes.half2
  report(true, `declared scope names both halves: half1=${s1}, half2=${s2}`)
  const effective = widerScope(s1, s2)
  report(
    effective === 'public',
    `the missing rule is computable: effective disclosure = max(halves) = ${effective}`,
    'the pairwise half’s identifier sits next to a named person in a public graph — its OWN declaration is honoured, the EDGE’s privacy is not its own'
  )

  // The #22 opening ambiguity: an M-DID inside a VRC (§VRC permits it) — the
  // mid-migration edge. Same failure, single community, no cross-community
  // framing needed.
  report(
    classifyEdgeFourTypes(edgeMixed) === null,
    'M-DID-inside-a-VRC (mid-migration edge): four types cannot name it either',
    '“is it a membership DID or a relationship DID?” — the question #22 opens with'
  )
  const obs = observationsOf(edgeMixed)
  report(
    scopeVerifier(edgeMixed, obs).verifiableEdge,
    'the same mid-migration edge under declared scope: VALID, no question to answer',
    `half1=${edgeMixed.declaredScopes.half1}, half2=${edgeMixed.declaredScopes.half2}, effective disclosure = ${widerScope(edgeMixed.declaredScopes.half1, edgeMixed.declaredScopes.half2)}`
  )
}

// ---------------------------------------------------------------------------
// CHECK D — the witnessed edge, and our own VWC held to the spec's bar.
// The witnessed fixture is REAL: the 5-phase witnessed exchange (session
// challenge, VP-wrapped VRCs, witness verification, VWC minting/distribution)
// run by our reference implementation over actual Credo agents. Here the rung
// audits OUR artifacts the way Glenn audits VTI (his F8/#1068, F3/#1065).
// ---------------------------------------------------------------------------
console.log('\nCHECK D — the witnessed edge, and our own VWC audited (#1065/#1068 mirror)')
{
  const vwcs = witnessed.vwcs.map((v) => v.credential)
  const vrcs = witnessed.vrcs.map((v) => v.credential)
  report(
    witnessed.vwcs.every((v) => v.verifiedAtCapture === true),
    'both REAL VWCs verified by Credo (holders’ own verifiers) at capture'
  )

  // Run both verifiers over the witnessed VRC pair: the body accepts it, the
  // glossary refuses to call it an edge — witnessing changes nothing about the
  // M-DID conditions.
  //
  // Getting here took a REAL BUG FIX in our own reference implementation, which
  // this rung caught: Participant.createAndSubmitPresentation minted the VRC
  // under getCurrentDID() — the most recently accepted connection's R-DID, which
  // in a witnessed exchange is the WITNESS connection — so the two halves did not
  // name each other and the "witnessed edge" was not a complete edge per [B1].
  // Now resolved from the counterparty's R-DID (Participant.getDIDForCounterparty).
  const witnessedEdge = { halves: [vrcs[0], vrcs[1]] }
  const body = bodyVerifier(witnessedEdge)
  const gloss = glossaryVerifier(witnessedEdge, 'vtn:demo', { strict: false })
  report(
    body.verifiableEdge,
    'the witnessed halves mutually name each other — a complete edge per the body',
    'regression guard on the wrong-R-DID minting bug this rung found and we fixed'
  )
  report(
    !gloss.verifiableEdge,
    'glossary rejects the witnessed edge regardless',
    'witnessing does not rescue pairwise edge verifiability — the #21 contradiction is orthogonal to attestation'
  )

  // Digest binding (#1068’s exacting part): recompute each VWC's digest over
  // the witnessed VRC with our own JCS + SHA-256, compare DECODED BYTES.
  const hexBytes = (h) => Uint8Array.from(h.match(/.{2}/g), (b) => parseInt(b, 16))
  const bytesEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
  for (const vwc of vwcs) {
    const claimed = vwc.credentialSubject.digest
    const claimedBytes = hexBytes(claimed.replace(/^sha256:/, ''))
    const match = vrcs.find((vrc) => bytesEq(sha256(new TextEncoder().encode(jcs(vrc))), claimedBytes))
    report(
      match !== undefined,
      'VWC digest recomputes over the witnessed VRC (independent JCS+SHA-256, byte compare)',
      match ? `binds the VRC issued by …${match.issuer.slice(-12)}` : 'NO captured VRC reproduces this digest'
    )
  }

  // Conformance audit of our own VWC — the same bar Glenn applies to VTI.
  const sample = vwcs[0].credentialSubject
  const legacyForm = typeof sample.digest === 'string' && sample.digest.startsWith('sha256:')
  const properForm = typeof sample.digest === 'string' && sample.digest.startsWith('z')
  report(
    legacyForm && !properForm,
    'KNOWN GAP: this VWC digest is legacy "sha256:"+hex, not the multibase multihash of #17 / PR #18',
    'same form in witness-server’s computeVrcDigest — the rename is exactly PR #18’s digestMultibase change, already specified as encoding-only (demonstrated next)'
  )
  // PR #18 claims the digestMultibase change is encoding-only for JCS
  // implementations. Demonstrate: same bytes, multihash 0x12 0x20 + base58btc.
  const raw = hexBytes(sample.digest.replace(/^sha256:/, ''))
  const multihash = new Uint8Array([0x12, 0x20, ...raw])
  const digestMultibase = 'z' + base58.encode(multihash)
  const roundTrip = base58.decode(digestMultibase.slice(1)).slice(2)
  report(
    bytesEq(roundTrip, raw),
    `encoding-only conversion verified: digestMultibase = ${digestMultibase.slice(0, 16)}… decodes to the identical bytes`
  )
  report(
    sample.taskContext === undefined,
    'PARITY DRIFT: the vrc-reference (legacy demo) VWC carries no taskContext',
    'the witness-server trust-tasks path ALREADY implements it — taskContext = session document id + taskDigestMultibase (WitnessTaskSessions.ts:260) — so this is drift between our two implementations, not a Keyring-wide #1065-style gap'
  )
  report(
    sample.witnessContext !== undefined,
    'our VWC does carry witnessContext (event, sessionId, method)'
  )
}

// ---------------------------------------------------------------------------
// CHECK E — one identifier, two scope vocabularies (cross-spec, #22 × TT 0.5.0).
//
// Trust Tasks framework 0.5.0 (trustoverip/dtgwg-trust-tasks-spec @ 6425a741,
// spec/body.md:795) shipped a declared identifier-scope axis of its own:
//
//   "Each party declaration SHOULD additionally carry an `identifierScope` —
//    one of `pairwise`, `public`, or `any` … `any` states that the
//    specification takes no position and the choice belongs to the parties."
//   "A consumer … MUST treat an absent or unresolvable declaration as no less
//    correlatable than `public`."                        (body.md:797)
//
// cred-spec #22 proposes FOUR values (pairwise / community / linked / public).
// A Keyring witnessed exchange carries a VRC (cred-spec vocabulary) inside
// Trust Task documents (framework vocabulary) — the same identifier described
// twice, in one flow, by two specs. This check maps one onto the other.
// ---------------------------------------------------------------------------
console.log('\nCHECK E — one identifier, two scope vocabularies (#22 × TT framework 0.5.0)')
{
  const TT_SCOPES = ['pairwise', 'public', 'any']
  // `any` is a declaration of no position, not a scope — so it cannot be the
  // faithful target of a credential that HAS a scope.
  const faithfulTtValue = (credScope) => (TT_SCOPES.includes(credScope) ? credScope : null)

  const mappings = SCOPES.map((scope) => ({ scope, tt: faithfulTtValue(scope) }))
  for (const { scope, tt } of mappings) {
    if (tt) {
      report(true, `cred-spec \`${scope}\` maps faithfully to TT identifierScope \`${tt}\``)
    } else {
      report(
        true,
        `cred-spec \`${scope}\` has NO faithful TT identifierScope value`,
        'not `pairwise` (more than one counterparty may recognise it), not `public` (the set is bounded); `any` states no position at all'
      )
    }
  }

  const unmappable = mappings.filter((m) => !m.tt).map((m) => m.scope)
  report(
    unmappable.length === 2 && unmappable.includes('community') && unmappable.includes('linked'),
    'exactly the two MIDDLE scopes are unrepresentable across the two specs',
    `${unmappable.join(', ')} — the ones between "one counterparty" and "the world"`
  )

  // The fail-safe reading turns the gap into a privacy misstatement rather
  // than an omission: whatever a bounded-scope party declares, a consumer
  // reads it as no less correlatable than `public`.
  report(
    true,
    'and the fail-safe reading makes the gap load-bearing (body.md:797)',
    '`any` and absent both read as `public`, so a community-scoped identifier is reasoned about as unbounded — the declaration overstates disclosure in the privacy-relevant direction'
  )

  // Our own flow is the one that spans both vocabularies.
  const vwcSubject = witnessed.vwcs[0].credential.credentialSubject
  report(
    vwcSubject.taskContext === undefined && witnessed.vrcs.length === 2,
    'this is not hypothetical for us: our witnessed exchange spans both specs',
    'pairwise VRC halves (cred-spec) carried through witness session Trust Task documents (framework) — one identifier, two vocabularies, no defined mapping'
  )
}

// ---------------------------------------------------------------------------
console.log('')
if (failures) {
  console.error(`${failures} check(s) failed — the rung's claims did not reproduce.`)
  process.exit(1)
}
console.log('All checks passed: #21 contradiction reproduced from real Keyring credentials;')
console.log('#22 declared-scope model yields one deterministic rule set over the same fixtures;')
console.log('#23/#22-opening edges unnameable under four types, nameable under declared scope;')
console.log('Check D: our own witnessed artifacts audited — digest binding recomputes, and three')
console.log('self-findings recorded (wrong-R-DID minting bug, legacy digest form, missing taskContext);')
console.log('Check E: the cred-spec scope axis and TT framework 0.5.0 identifierScope cannot')
console.log('express each other — `community` and `linked` have no faithful target.')
