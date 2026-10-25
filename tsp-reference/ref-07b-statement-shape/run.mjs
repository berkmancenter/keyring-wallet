// ref-07b-statement-shape
//
// cred-spec #45 proposes folding the VWC into a `StatementCredential` profile
// (predicate `dtg:witnessed`, object `digestMultibase`). This rung asks what
// that costs an implementer who has WD02-shaped VWCs in the field, using
// Keyring's real artifacts and real code.
//
// Four acts:
//   1. verifier battery parity      — does the profile change any check?
//   2. type-dispatch matrix         — do the registered aliases hold up?
//   3. Trust Task read-site delta   — what does the Trust Task layer notice?
//   4. cross-implementation         — what does the DTG reference impl accept?
//
// No network. Act 4 needs cargo; it skips cleanly without it.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const clone = (o) => JSON.parse(JSON.stringify(o))
let failures = 0
const line = (ok, text) => {
  if (!ok) failures++
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${text}`)
}
const head = (n, t) => console.log(`\n== Act ${n} — ${t}\n`)

// ------------------------------------------------------------- fixtures ----
const captured = JSON.parse(
  readFileSync('../ref-07-dtg-edge-semantics/fixtures/edge-witnessed-captured.json', 'utf8')
)
const observedVrc = captured.vrcs[0].credential
const legacyVwc = captured.vwcs[0].credential
const taskVwc = JSON.parse(readFileSync('./fixtures/vwc-trust-tasks-path.json', 'utf8')).credential

console.log('=== ref-07b · what does the #45 profile cost an implementer? ===')
console.log('spec:      dtgwg-cred-spec WD02 (6714971)  + issue #45 strawman')
console.log('fixtures:  a real captured witnessed exchange (ref-07) and a VWC built by the')
console.log('           shipped witness-server builder + the production binding lines')

// ---------------------------------------------------------------- Act 0 ----
head(0, 'provenance, and the migration window measured rather than asserted')

line(legacyVwc.type.includes('WitnessCredential'), 'legacy VWC is the vrc-reference demo path (real, verified at capture)')
line(
  String(taskVwc.credentialSubject.taskContext ?? '').length > 0,
  'trust-tasks VWC carries taskContext (built by the real production path)'
)
const windowDays =
  (Date.parse(taskVwc.validUntil) - Date.parse(taskVwc.validFrom)) / 86400000
line(windowDays > 6.9 && windowDays < 7.1, `VWC validity window is ${windowDays.toFixed(2)} days — the installed base ages out in a week`)

// ---------------------------------------------------------------- Act 1 ----
head(1, 'verifier battery parity: does the profile change any check a verifier runs?')

/** JCS (RFC 8785) subset, as witness-server's computeVrcDigest uses it. */
const jcs = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(jcs).join(',')}]`
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(',')}}`
}
const vrcDigest = 'sha256:' + createHash('sha256').update(jcs(observedVrc)).digest('hex')

/** The #45 re-expression of a WD02 VWC. Mechanical: no member is invented. */
function toStatementShape(vwc) {
  const s = clone(vwc)
  const cs = s.credentialSubject
  s.type = ['VerifiableCredential', 'DTGCredential', 'StatementCredential', 'WitnessCredential']
  if (cs.taskContext !== undefined) s.taskContext = cs.taskContext   // WD02 puts it top-level
  s.credentialSubject = {
    id: cs.id,
    predicate: 'dtg:witnessed',
    object: { digestMultibase: cs.digestMultibase ?? cs.digest },
    ...(cs.witnessContext ? { witnessContext: cs.witnessContext } : {}),
    ...(cs.parties ? { parties: cs.parties } : {}),
    ...(cs.taskDigestMultibase ? { taskDigestMultibase: cs.taskDigestMultibase } : {}),
  }
  return s
}

// The four checks a VWC verifier actually performs, each expressed against
// whichever shape it is handed. Only the ACCESSOR differs.
const battery = [
  {
    name: 'names the credential it witnessed (decode-and-compare)',
    wd02: (v) => v.credentialSubject.digest ?? v.credentialSubject.digestMultibase,
    s45: (v) => v.credentialSubject.object?.digestMultibase,
    expect: vrcDigest,
  },
  {
    name: 'subject is the issuer of the referenced VRC',
    wd02: (v) => v.credentialSubject.id,
    s45: (v) => v.credentialSubject.id,
    expect: typeof observedVrc.issuer === 'string' ? observedVrc.issuer : observedVrc.issuer.id,
  },
  {
    name: 'binds to its trust task (taskContext)',
    wd02: (v) => v.credentialSubject.taskContext ?? v.taskContext,
    s45: (v) => v.taskContext,
    expect: taskVwc.credentialSubject.taskContext,
  },
  {
    name: 'is recognisable as a witness attestation',
    wd02: (v) => v.type.includes('WitnessCredential'),
    s45: (v) => v.type.includes('WitnessCredential'),
    expect: true,
  },
]

const taskStatement = toStatementShape(taskVwc)
for (const check of battery) {
  const a = check.wd02(taskVwc)
  const b = check.s45(taskStatement)
  line(a === check.expect && b === check.expect && a === b, `same verdict on both shapes — ${check.name}`)
}

// Shape B — the explicit RDF reification favoured by talltree and martipos on the
// issue: a statement node with `subject` as a value and NO `credentialSubject.id`.
// Same envelope; only credentialSubject differs.
function toReifiedShape(vwc) {
  const s = toStatementShape(vwc)
  const cs = s.credentialSubject
  s.credentialSubject = {
    type: 'Statement',
    subject: cs.id,                 // the DID moves out of `id`
    predicate: cs.predicate,
    object: cs.object,
    ...(cs.witnessContext ? { witnessContext: cs.witnessContext } : {}),
    ...(cs.parties ? { parties: cs.parties } : {}),
    ...(cs.taskDigestMultibase ? { taskDigestMultibase: cs.taskDigestMultibase } : {}),
  }
  return s
}
const taskReified = toReifiedShape(taskVwc)

console.log('\n   shape B (explicit reification) against the same battery:')
const bAccessors = [
  ['names the credential it witnessed', (v) => v.credentialSubject.object?.digestMultibase, vrcDigest],
  ['subject is the issuer of the referenced VRC', (v) => v.credentialSubject.subject, typeof observedVrc.issuer === 'string' ? observedVrc.issuer : observedVrc.issuer.id],
  ['binds to its trust task', (v) => v.taskContext, taskVwc.credentialSubject.taskContext],
  ['is recognisable as a witness attestation', (v) => v.type.includes('WitnessCredential'), true],
]
for (const [name, get, expect] of bAccessors) {
  const got = get(taskReified)
  console.log(`     ${got === expect ? 'ok  ' : 'FAIL'} ${name}`)
}
line(
  taskReified.credentialSubject.id === undefined,
  'shape B has NO credentialSubject.id — the subject DID lives in `subject`'
)
line(
  bAccessors.every(([, get, expect]) => get(taskReified) === expect),
  'all four checks still answerable under shape B — with one accessor changed per check'
)
console.log('\n   The cost of B is not in these four. It is everywhere else that reads')
console.log('   credentialSubject.id: holder binding, correlation scope, and the "two')
console.log('   credentials share a subject" ZK predicate. Keyring reads it in the display')
console.log('   layer and in contact matching, so B is a wider change for us than C —')
console.log('   which is the same conclusion #45 reaches from the spec side.')
line(
  Object.keys(taskVwc.credentialSubject).length === 6 && Object.keys(taskStatement.credentialSubject).length === 6,
  'no member gained or lost in the re-expression (6 subject members either way)'
)

// ---------------------------------------------------------------- Act 2 ----
head(2, 'type-dispatch matrix against the REAL shipped predicates')

const ct = require('../../bifold/packages/core/lib/commonjs/modules/vrc/credentialTypes.js')
line(
  typeof ct.isWitnessCredential === 'function' && typeof ct.isPeerVrcCredential === 'function',
  'loaded @bifold/core credentialTypes (the module every screen and hook dispatches through)'
)

const endorsement = {
  type: ['VerifiableCredential', 'DTGCredential', 'StatementCredential'],
  credentialSubject: { id: 'did:example:alice', predicate: 'dtg:endorses', object: { id: 'did:example:bob' } },
}
const statementNoAlias = clone(taskStatement)
statementNoAlias.type = ['VerifiableCredential', 'DTGCredential', 'StatementCredential']

const cases = [
  ['WD02 VWC', taskVwc, { witness: true, peerVrc: false }],
  ['statement VWC, alias kept', taskStatement, { witness: true, peerVrc: false }],
  ['statement VWC, alias dropped', statementNoAlias, { witness: false, peerVrc: true }],
  ['endorsement statement (a VEC as a profile)', endorsement, { witness: false, peerVrc: true }],
]
console.log('   credential                                   isWitness  isPeerVrc  -> lands in')
for (const [name, doc, expect] of cases) {
  const w = ct.isWitnessCredential(doc)
  const p = ct.isPeerVrcCredential(doc)
  const dest = p ? 'CONTACTS' : w ? 'witness display handler' : 'generic list'
  console.log(`   ${name.padEnd(44)} ${String(w).padEnd(10)} ${String(p).padEnd(10)} -> ${dest}`)
  line(w === expect.witness && p === expect.peerVrc, `  dispatch as predicted for: ${name}`)
}
// The fix, so the rung hands over a solution rather than a complaint: dispatch on
// the predicate when one is present, and fall back to the type list when it is not.
const PROFILE_HANDLERS = { 'dtg:witnessed': 'witness display handler', 'dtg:endorses': 'endorsement display handler' }
function dispatch(cred) {
  const predicate = cred.credentialSubject?.predicate ?? cred.credentialSubject?.object?.predicate
  if (typeof predicate === 'string') {
    return PROFILE_HANDLERS[predicate] ?? 'generic statement: "statement from X"'
  }
  if (ct.isWitnessCredential(cred)) return 'witness display handler'
  if (ct.isPeerVrcCredential(cred)) return 'CONTACTS'
  return 'generic list'
}
console.log('\n   the same four, dispatched on `predicate` instead of `type`:')
for (const [name, doc] of cases) {
  console.log(`   ${name.padEnd(44)} -> ${dispatch(doc)}`)
}
line(dispatch(statementNoAlias) === 'witness display handler', 'alias-less statement VWC routes correctly when dispatch reads the predicate')
line(dispatch(endorsement) === 'endorsement display handler', 'the endorsement routes to its own profile handler, not Contacts')
const unknownPredicate = clone(endorsement)
unknownPredicate.credentialSubject.predicate = 'acme:observedDocument'
line(
  dispatch(unknownPredicate).startsWith('generic statement'),
  'an unrecognised predicate degrades to "statement from X" rather than failing or misfiling'
)

console.log('\n   The last two rows of the first table are the finding: isPeerVrcCredential is defined as')
console.log('   "DTGCredential AND NOT WitnessCredential" (credentialTypes.ts:81), which is safe')
console.log('   only while the VWC is the sole non-relationship DTG credential in the wallet.')
console.log('   One type / N profiles ends that, and a stray endorsement lands in Contacts.')

// ---------------------------------------------------------------- Act 3 ----
head(3, 'Trust Task read-site delta: what does the Trust Task layer actually notice?')

const ttSrc = '../../bifold/packages/trust-tasks/src'
const ttFiles = ['documentProof.ts', 'validator.ts', 'TrustTaskMessage.ts', 'index.ts']
let subjectHits = 0
for (const f of ttFiles) {
  const body = readFileSync(`${ttSrc}/${f}`, 'utf8')
  subjectHits += (body.match(/credentialSubject/g) ?? []).length
}
line(subjectHits === 0, `@bifold/trust-tasks reads credentialSubject ${subjectHits} times — the Trust Task model does not see credential shape`)

const readSites = [
  ['../../bifold/packages/core/src/modules/trust-tasks/outcomeEvidence.ts', /subject\?\.taskContext/g],
  ['../../bifold/packages/core/src/modules/trust-tasks/witnessCeremony.ts', /taskContext\?: string \} \| undefined\)\?\.taskContext|\.taskContext/g],
]
let sites = 0
for (const [file, re] of readSites) {
  const body = readFileSync(file, 'utf8')
  body.split('\n').forEach((l, i) => {
    if (l.match(/subject.*taskContext/)) {
      sites++
      console.log(`   read site: ${file.split('/').slice(-1)[0]}:${i + 1}  ${l.trim().slice(0, 74)}`)
    }
  })
}
line(sites > 0 && sites <= 5, `${sites} read site(s) hard-code taskContext's position inside credentialSubject`)
console.log('\n   WD02 already puts taskContext at the credential top level, so these sites are')
console.log('   a WD02-alignment fix Keyring owes regardless of #45 — not a cost of the profile.')

// ---------------------------------------------------------------- Act 4 ----
head(4, 'cross-implementation: what does the DTG reference implementation accept?')

let cargoOk = true
try {
  execFileSync('cargo', ['--version'], { stdio: 'ignore' })
} catch {
  cargoOk = false
}
if (!cargoOk) {
  console.log('   SKIP  cargo not on PATH — act 4 needs the Rust reference implementation')
} else {
  const outDir = '/tmp/ref07b-conformance-cases'
  mkdirSync(outDir, { recursive: true })

  // Start from the one shape the reference implementation accepts, then re-add
  // each Keyring member in isolation so every verdict has exactly one cause.
  const accepted = clone(taskVwc)
  accepted.issuer = taskVwc.issuer.id
  accepted.taskContext = accepted.credentialSubject.taskContext
  delete accepted.credentialSubject.taskContext
  delete accepted.credentialSubject.parties
  delete accepted.credentialSubject.taskDigestMultibase
  delete accepted.credentialSubject.witnessContext.hardwareAttestationIncluded
  accepted.proof = {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-rdfc-2022',
    created: '2026-09-08T00:00:00Z',
    verificationMethod: 'did:example:w#k',
    proofPurpose: 'assertionMethod',
    proofValue: 'z2placeholder',
  }

  const mut = (fn) => {
    const v = clone(accepted)
    fn(v)
    return v
  }
  const cases2 = [
    ['00-reference-accepted-form', accepted],
    ['01-issuer-as-object', mut((v) => (v.issuer = { id: v.issuer, name: 'Keyring Witness' }))],
    ['02-witnessContext-hardwareAttestationIncluded', mut((v) => (v.credentialSubject.witnessContext.hardwareAttestationIncluded = false))],
    ['03-witnessContext-localityVerification', mut((v) => (v.credentialSubject.witnessContext.localityVerification = { type: 'proximity', confirmed: true }))],
    ['04-credentialSubject-parties', mut((v) => (v.credentialSubject.parties = ['did:example:a', 'did:example:b']))],
    ['05-credentialSubject-taskDigestMultibase', mut((v) => (v.credentialSubject.taskDigestMultibase = 'zQmPlaceholder'))],
    ['06-taskContext-inside-credentialSubject', mut((v) => { v.credentialSubject.taskContext = v.taskContext; delete v.taskContext })],
    ['07-taskContext-absent', mut((v) => delete v.taskContext)],
    ['08-Ed25519Signature2018-proof', mut((v) => (v.proof = { type: 'Ed25519Signature2018', created: '2026-09-08T00:00:00Z', verificationMethod: 'did:example:w#k', proofPurpose: 'assertionMethod', jws: 'eyJ..A' }))],
    ['09-issue45-statement-shape', toStatementShape(accepted)],
  ]
  const paths = []
  for (const [name, doc] of cases2) {
    const p = `${outDir}/${name}.json`
    writeFileSync(p, JSON.stringify(doc, null, 2))
    paths.push(p)
  }

  const out = execFileSync('cargo', ['run', '-q', '--', ...paths], {
    cwd: './conformance-rs',
    encoding: 'utf8',
  })
  const rows = out.trim().split('\n').filter((l) => l.includes('\t'))
  for (const r of rows) {
    const [file, verdict, detail] = r.split('\t')
    console.log(`   ${verdict.padEnd(9)} ${file.replace('.json', '').padEnd(46)} ${(detail ?? '').slice(0, 60)}`)
  }
  const accepted0 = rows.find((r) => r.startsWith('00-'))
  line(accepted0?.includes('ACCEPTED'), 'a WD02-conformant Keyring VWC IS accepted by the reference implementation')
  const rejects = rows.filter((r) => !r.startsWith('00-') && r.includes('REJECTED')).length
  line(rejects === cases2.length - 1, `every other variant is rejected — ${rejects} independently fatal divergences`)
}

console.log(`\n=== ref-07b done · ${failures} failure(s) ===`)
process.exit(failures > 0 ? 1 : 0)
