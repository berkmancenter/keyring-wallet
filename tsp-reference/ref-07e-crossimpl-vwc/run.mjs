// ref-07e-crossimpl-vwc
//
// The two implementations of the DTG credential spec that exist — Keyring
// (TypeScript, hand-rolled) and `dtg-credentials` 0.7.0 (Rust, the catalogue
// the VTC mints from) — actually talking to each other, in both directions,
// with real signatures.
//
// ref-07b asked "does their library accept our JSON?" (a parse test). This
// asks the questions that matter if Keyring is going to consume VWCs from
// VTA/VTI infrastructure:
//
//   Can we verify a VWC THEY minted?          (act 1)
//   Can they verify a VWC WE signed?          (act 2)
//   Do Keyring's own checks work on theirs?   (act 3)
//   Do our digests agree?                     (act 4)
//   Does the unpublished DTG context matter?  (act 5)
//   And Brendan's gap on #45, demonstrated.   (act 6)
//
// Acts 1-4 need `cargo` (they call the published crate). Acts 5-6 do not.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { ed25519 } from '@noble/curves/ed25519.js'
import { base58 } from '@scure/base'
import * as jcsSuite from './eddsa-jcs-2022.mjs'

const require = createRequire(import.meta.url)
const clone = (o) => JSON.parse(JSON.stringify(o))
let failures = 0
const line = (ok, text) => {
  if (!ok) failures++
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${text}`)
}
const head = (n, t) => console.log(`\n== Act ${n} — ${t}\n`)

let cargoOk = true
try {
  execFileSync('cargo', ['--version'], { stdio: 'ignore' })
} catch {
  cargoOk = false
}
const rust = (...args) =>
  execFileSync('cargo', ['run', '-q', '--', ...args], { cwd: './mint-rs', encoding: 'utf8' }).trim()

/** JCS (RFC 8785) subset — exactly what witness-server's computeVrcDigest uses. */
const jcs = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(jcs).join(',')}]`
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(',')}}`
}
/** Keyring's legacy digest form (witness-server computeVrcDigest). */
const keyringDigest = (o) => 'sha256:' + createHash('sha256').update(jcs(o)).digest('hex')

/** Ed25519 public key bytes out of a did:key. */
const pubFromDidKey = (did) => base58.decode(did.replace('did:key:', '').split('#')[0].slice(1)).slice(2)
/** did:key for a public key (multicodec ed25519-pub = 0xed 0x01). */
const didKeyFor = (pub) => 'did:key:z' + base58.encode(new Uint8Array([0xed, 0x01, ...pub]))

console.log('=== ref-07e · Keyring and the DTG reference implementation, both directions ===')
console.log('them: dtg-credentials 0.7.0 (crates.io), driven by mint-rs/')
console.log('us:   @bifold/* at the working tree + our own eddsa-jcs-2022')
if (!cargoOk) console.log('\n!! cargo not on PATH — acts 1-4 will skip')

// ---------------------------------------------------------------- Act 1 ----
head(1, 'a VWC minted and signed by THEM, verified by OUR crypto')

const REF_FIXTURE = './fixtures/vwc-minted-by-reference-impl.json'
if (cargoOk) {
  // Mint a FRESH one to a scratch path to prove the crate still does this, and
  // verify that one too — without disturbing the frozen fixture below.
  const minted = rust('mint', '../fixtures/.live-mint.json')
  line(minted.startsWith('MINTED'), `the crate minted a fresh VWC: ${minted.split('\t')[2] ?? ''}`)
  const live = JSON.parse(readFileSync('./fixtures/.live-mint.json', 'utf8'))
  line(
    jcsSuite.verifyCredential(live.credential, pubFromDidKey(live.issuerDid)).verified,
    'and our verifier accepts that fresh one too (not just the frozen fixture)'
  )
}
line(existsSync(REF_FIXTURE), 'the reference implementation\'s VWC is on disk')
const ref = JSON.parse(readFileSync(REF_FIXTURE, 'utf8'))
const theirVwc = ref.credential

line(
  theirVwc.proof.cryptosuite === 'eddsa-jcs-2022' && theirVwc.proof.type === 'DataIntegrityProof',
  `their proof is ${theirVwc.proof.type}/${theirVwc.proof.cryptosuite}`
)
const theirVerify = jcsSuite.verifyCredential(theirVwc, pubFromDidKey(ref.issuerDid))
line(theirVerify.verified, `OUR eddsa-jcs-2022 implementation verifies THEIR signature${theirVerify.reason ? ' — ' + theirVerify.reason : ''}`)

// ---------------------------------------------------------------- Act 2 ----
head(2, 'a VWC signed by US, verified by THEM')

const seed = new Uint8Array(32).fill(23)
const ourPub = ed25519.getPublicKey(seed)
const ourDid = didKeyFor(ourPub)

// Their shape, our signature — so the only thing under test is the proof.
const ourVwc = clone(theirVwc)
delete ourVwc.proof
ourVwc.issuer = ourDid
const ourProof = jcsSuite.signCredential(ourVwc, {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  created: '2026-09-10T00:00:00Z',
  verificationMethod: `${ourDid}#${ourDid.slice('did:key:'.length)}`,
  proofPurpose: 'assertionMethod',
}, seed)
const ourSigned = { ...ourVwc, proof: ourProof }
line(jcsSuite.verifyCredential(ourSigned, ourPub).verified, 'our own signature verifies locally (control)')

if (cargoOk) {
  writeFileSync('./fixtures/vwc-signed-by-keyring.json', JSON.stringify({ credential: ourSigned }, null, 2) + '\n')
  const out = rust('verify', '../fixtures/vwc-signed-by-keyring.json', ourDid)
  line(out.startsWith('VERIFIED'), `THEIR verifier on OUR signature: ${out.split('\t')[0]}${out.split('\t')[2] ? ' — ' + out.split('\t')[2].slice(0, 70) : ''}`)
}

// ---------------------------------------------------------------- Act 3 ----
head(3, "Keyring's own VWC checks, run against THEIR credential")

const ct = require('../../bifold/packages/core/lib/commonjs/modules/vrc/credentialTypes.js')

// The four checks Keyring performs on a VWC. Accessors transcribed from the
// real sources — witnessCeremony.ts cannot be imported into plain Node (it
// pulls @openvtc/trust-tasks subpaths that package doesn't export), so the
// reads are quoted with their file:line rather than called.
const keyringChecks = [
  {
    name: 'isWitnessCredential(cred)',
    where: 'credentialTypes.ts:72 (imported, real)',
    run: (c) => ct.isWitnessCredential(c),
  },
  {
    name: 'witnessed digest present',
    where: 'WitnessService.ts:2545 — credentialSubject.digest',
    run: (c) => typeof c.credentialSubject?.digest === 'string',
  },
  {
    name: 'taskContext read',
    where: 'witnessCeremony.ts:169 — credentialSubject.taskContext',
    run: (c) => typeof c.credentialSubject?.taskContext === 'string',
  },
  {
    name: 'subject id present',
    where: 'witnessCredentialUtils.ts — credentialSubject.id',
    run: (c) => typeof c.credentialSubject?.id === 'string',
  },
]

console.log('   check                            on THEIR VWC   accessor')
for (const c of keyringChecks) {
  const ok = c.run(theirVwc)
  console.log(`   ${c.name.padEnd(32)} ${(ok ? 'works' : 'FAILS').padEnd(14)} ${c.where}`)
}
const worked = keyringChecks.filter((c) => c.run(theirVwc)).length
line(worked === 2, `${worked} of 4 Keyring checks work on a reference-implementation VWC`)
console.log('\n   The two that fail are the two where WD02 and Keyring disagree about placement:')
console.log('   they write `digestMultibase` (WD02) where we read `digest`, and they put')
console.log('   `taskContext` at the top level (WD02) where we read it inside credentialSubject.')
console.log('   Neither is their bug. Both are on the ref-07b fix list.')

// The same checks, WD02-corrected — what the fix buys us.
const corrected = [
  ['isWitnessCredential(cred)', (c) => ct.isWitnessCredential(c)],
  ['witnessed digest (digestMultibase)', (c) => typeof c.credentialSubject?.digestMultibase === 'string'],
  ['taskContext (top level)', (c) => typeof c.taskContext === 'string'],
  ['subject id present', (c) => typeof c.credentialSubject?.id === 'string'],
]
const fixed = corrected.filter(([, f]) => f(theirVwc)).length
line(fixed === 4, `with the WD02 placement fix, ${fixed} of 4 work — Keyring can consume their VWC`)

// ---------------------------------------------------------------- Act 4 ----
head(4, 'do our digests of the same credential agree, byte for byte?')

const observed = JSON.parse(
  readFileSync('../ref-07-dtg-edge-semantics/fixtures/edge-witnessed-captured.json', 'utf8')
).vrcs[0].credential

/** WD02 Digest Encoding: 'z' + base58btc(0x12 0x20 || sha256(JCS(doc without proof))). */
function digestMultibaseOf(doc) {
  const { proof: _drop, ...unproofed } = doc
  const h = createHash('sha256').update(jcs(unproofed)).digest()
  return 'z' + base58.encode(new Uint8Array([0x12, 0x20, ...h]))
}

if (cargoOk) {
  writeFileSync('./fixtures/observed-vrc.json', JSON.stringify({ credential: observed }, null, 2) + '\n')
  const theirs = rust('digest-json', '../fixtures/observed-vrc.json').split('\t')[2]
  const ours = digestMultibaseOf(observed)
  console.log(`   their digest_multibase_json : ${theirs}`)
  console.log(`   our WD02 encoding           : ${ours}`)
  line(theirs === ours, 'independent implementations produce the SAME digestMultibase for our real captured VRC')

  // Two different things are often conflated about the digest rename, and the
  // crate separates them cleanly:
  //   the MEMBER NAME `digest` is accepted as an alias for `digestMultibase`
  //   the VALUE FORM `sha256:<hex>` is rejected as malformed
  // Keyring emits the second one today (witness-server computeVrcDigest), so this
  // is our divergence, not theirs. Referenced credential is their own minted VWC:
  // the captured Keyring VRC cannot be parsed by the catalogue at all
  // (Ed25519Signature2018 carries no cryptosuite).
  const legacyOf = (doc) => {
    const { proof: _d, ...unproofed } = doc
    return 'sha256:' + createHash('sha256').update(jcs(unproofed)).digest('hex')
  }
  const referenced = theirVwc
  const carrier = clone(theirVwc)
  delete carrier.proof
  carrier.credentialSubject = { ...carrier.credentialSubject }
  delete carrier.credentialSubject.digestMultibase
  carrier.credentialSubject.digest = legacyOf(referenced)
  writeFileSync('./fixtures/vwc-legacy-digest.json', JSON.stringify({ credential: carrier }, null, 2) + '\n')
  writeFileSync('./fixtures/referenced.json', JSON.stringify({ credential: referenced }, null, 2) + '\n')
  const cmp = rust('verify-digest', '../fixtures/vwc-legacy-digest.json', '../fixtures/referenced.json')
  line(
    cmp.startsWith('DIGEST-ERROR') && cmp.includes('not a well-formed digestMultibase'),
    `their verify_digest REJECTS our legacy sha256:hex value, by name: ${cmp.split('\t')[1] ?? cmp}`
  )
  // And the member-name alias, separately: same document, WD02 value form, WD01 name.
  const aliasCarrier = clone(carrier)
  aliasCarrier.credentialSubject.digest = digestMultibaseOf(referenced)
  writeFileSync('./fixtures/vwc-alias-name.json', JSON.stringify({ credential: aliasCarrier }, null, 2) + '\n')
  const aliasCmp = rust('verify-digest', '../fixtures/vwc-alias-name.json', '../fixtures/referenced.json')
  line(aliasCmp === 'DIGEST-MATCH', `but it DOES accept the WD01 member name \`digest\` carrying a WD02 value: ${aliasCmp}`)
  console.log('\n   So the digest rename splits in two: the NAME is back-compatible, the VALUE FORM')
  console.log('   is not. Keyring emits `sha256:<hex>` today — that is ours to fix, and it is')
  console.log('   ref-07 self-finding #2 ("legacy digest form, known, planned") measured against')
  console.log('   the other implementation rather than against the spec text.')
}

// ---------------------------------------------------------------- Act 5 ----
head(5, 'neither implementation\'s DTG @context is published — and the suite decides whether that matters')

const theirCtx = theirVwc['@context']
const ourCtxUrl = 'https://trustoverip.org/credentials/witnessed-exchange/v1'
console.log(`   theirs: ${JSON.stringify(theirCtx)}`)
console.log(`   ours:   ["https://www.w3.org/ns/credentials/v2", "${ourCtxUrl}"]`)
line(theirCtx.some((u) => u.includes('firstperson.network')), 'they name a DTG context at firstperson.network')
line(true, 'both that URL and ours return HTTP 404 (checked 2026-09-10, recorded not re-fetched)')
console.log('\n   Their proof is eddsa-jcs-2022, which canonicalizes the JSON and never resolves')
console.log('   a context — so an unpublished context costs them nothing. Ours are')
console.log('   eddsa-rdfc-2022 / Ed25519Signature2018, which BOTH expand JSON-LD, so ours')
console.log('   only verify because Keyring bundles its context locally. A third party')
console.log('   cannot verify either credential with an RDF-canonicalized suite today.')
console.log('   This is what makes #45\'s `predicate`-as-CURIE a dependency on an artifact')
console.log('   that does not yet exist — see ref-07c and ref-07d.')

// ---------------------------------------------------------------- Act 6 ----
head(6, "the profile test passes and the claim is still not established (bmiller59's gap on #45)")

// #45's test: a credential is a profile if verification is "check the signature,
// check the status, read the claim". Build a statement-shaped VWC that passes
// all three, with a recognised predicate and every profile constraint satisfied
// — and whose ceremony never completed.
const statementVwc = {
  '@context': ['https://www.w3.org/ns/credentials/v2', 'https://firstperson.network/credentials/dtg/v1'],
  id: 'urn:uuid:0e0e0e0e-1111-2222-3333-444444444444',
  type: ['VerifiableCredential', 'DTGCredential', 'StatementCredential'],
  issuer: ourDid,
  validFrom: '2026-09-10T00:00:00Z',
  validUntil: '2026-09-17T00:00:00Z',
  taskContext: 'urn:uuid:ceremony-that-never-finished',
  credentialSubject: {
    id: 'did:example:observed-party',
    predicate: 'dtg:witnessed',
    object: { digestMultibase: digestMultibaseOf(observed) },
  },
}
const stProof = jcsSuite.signCredential(statementVwc, {
  type: 'DataIntegrityProof',
  cryptosuite: 'eddsa-jcs-2022',
  created: '2026-09-10T00:00:00Z',
  verificationMethod: `${ourDid}#${ourDid.slice('did:key:'.length)}`,
  proofPurpose: 'assertionMethod',
}, seed)
const stSigned = { ...statementVwc, proof: stProof }

// The three steps of the profile test, run literally.
const step1 = jcsSuite.verifyCredential(stSigned, ourPub).verified
const step2 = !stSigned.credentialStatus && Date.parse(stSigned.validUntil) > Date.parse('2026-09-11T00:00:00Z')
const ACCEPTED_VOCAB = ['dtg:witnessed', 'dtg:endorses']
const step3 = ACCEPTED_VOCAB.includes(stSigned.credentialSubject.predicate)
line(step1, 'step 1 — check the signature: PASSES')
line(step2, 'step 2 — check the status: PASSES (no status list, inside validity window)')
line(step3, 'step 3 — read the claim: PASSES (predicate is in the accepted vocabulary)')
line(
  typeof stSigned.credentialSubject.object?.digestMultibase === 'string' &&
    typeof stSigned.taskContext === 'string',
  'every profile constraint the strawman states is satisfied (object kind, taskContext present)'
)

// The fourth step the test does not mention.
const OUTCOME_STORE = {} // the ceremony never wrote a terminal document
const outcome = OUTCOME_STORE[stSigned.taskContext]
line(
  outcome === undefined,
  'step 4 — fetch the ceremony\'s outcome evidence: NOTHING IS THERE'
)
console.log('\n   All three steps of the profile test pass. The predicate is recognised. Every')
console.log('   constraint holds. And the witnessing this credential attests to never happened:')
console.log('   no initiating document, no terminal success response, nothing to match taskContext.')
console.log('   A verifier that read "VWC is a simple profile" as licence to stop after step 3')
console.log('   would accept this. That is the inference Outcome Interpretability forbids,')
console.log('   reappearing one layer up as a consequence of the categorisation.')

// And the check that catches it, which lives outside the credential entirely.
const OUTCOME_STORE_GOOD = {
  'urn:uuid:ceremony-that-never-finished': { initiating: { id: 'urn:uuid:ceremony-that-never-finished' }, terminal: { state: 'success' } },
}
const good = OUTCOME_STORE_GOOD[stSigned.taskContext]
line(
  good?.initiating?.id === stSigned.taskContext && good?.terminal?.state === 'success',
  'with outcome evidence present and matched, the claim IS established — one extra step, outside the credential'
)

console.log(`\n=== ref-07e done · ${failures} failure(s) ===`)
process.exit(failures > 0 ? 1 : 0)
