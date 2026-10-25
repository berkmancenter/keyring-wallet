// ref-07c-predicate-coverage
//
// Does the signature on a DTG credential actually cover its predicate?
//
// cred-spec #45 proposes a generic StatementCredential whose meaning lives in a
// `predicate` term "expressed as an IRI or a CURIE resolvable through the DTG
// JSON-LD context" (open question 2 asks whether that, or a plain namespaced
// string, is the right form). This rung answers question 2 by measurement
// rather than preference, using the two proof suites Keyring actually ships.
//
// Sources:
//   dtgwg-cred-spec @ WD02 (6714971) — external/dtgwg-cred-spec-wd02 worktree
//   The real shipped contexts from @bifold/vrc-contexts (same bytes the app signs with)
//
// No network. Deterministic keys. Everything below is computed, not asserted.

import { readFileSync } from 'node:fs'
import { ed25519 } from '@noble/curves/ed25519.js'
import jsonld from 'jsonld'
import * as rdfc from './eddsa-rdfc-2022.mjs'
import * as jcs from './eddsa-jcs-2022.mjs'

const contexts = await import(
  '../../bifold/packages/vrc-contexts/build/index.js'
)
const {
  CREDENTIALS_V2_CONTEXT_URL,
  CREDENTIALS_V2_CONTEXT_DOCUMENT,
  WITNESSED_EXCHANGE_CONTEXT_URL,
  WITNESSED_EXCHANGE_CONTEXT_DOCUMENT,
} = contexts.default ?? contexts

const STATEMENT_CONTEXT_URL = 'https://trustoverip.org/credentials/statement/v1'
const STATEMENT_CONTEXT_DOCUMENT = JSON.parse(readFileSync('./fixtures/statement-context-terms.json', 'utf8'))

// ---------------------------------------------------------------- loader ----
// Offline by construction: five known contexts, everything else throws. This
// mirrors createVrcDocumentLoader's allowlist — except the wallet's falls
// through to `await fetch(url)`, which is ref-07d's subject.
const KNOWN = {
  [CREDENTIALS_V2_CONTEXT_URL]: CREDENTIALS_V2_CONTEXT_DOCUMENT,
  [WITNESSED_EXCHANGE_CONTEXT_URL]: WITNESSED_EXCHANGE_CONTEXT_DOCUMENT,
  [STATEMENT_CONTEXT_URL]: STATEMENT_CONTEXT_DOCUMENT,
}
const documentLoader = async (url) => {
  const doc = KNOWN[url.split('#')[0]]
  if (!doc) throw new Error(`OFFLINE: no bundled context for ${url}`)
  return { contextUrl: null, documentUrl: url, document: doc }
}

// ------------------------------------------------------------------ keys ----
const seed = new Uint8Array(32).fill(7)
const pub = ed25519.getPublicKey(seed)
const ISSUER = 'did:example:witness'
const VM = `${ISSUER}#key-1`

const proofOptions = (cryptosuite) => ({
  type: 'DataIntegrityProof',
  cryptosuite,
  created: '2026-09-08T00:00:00Z',
  verificationMethod: VM,
  proofPurpose: 'assertionMethod',
})

// --------------------------------------------------------------- helpers ----
const clone = (o) => JSON.parse(JSON.stringify(o))
let failures = 0
const line = (ok, text) => {
  if (!ok) failures++
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${text}`)
}
const head = (n, t) => console.log(`\n== Check ${n} — ${t}\n`)

/** A #45-shaped statement VWC. `predicate` is whatever the caller passes. */
function statementVwc(predicate, { extraContext = true } = {}) {
  return {
    '@context': [
      CREDENTIALS_V2_CONTEXT_URL,
      WITNESSED_EXCHANGE_CONTEXT_URL,
      ...(extraContext ? [STATEMENT_CONTEXT_URL] : []),
    ],
    id: 'urn:uuid:11111111-2222-3333-4444-555555555555',
    type: ['VerifiableCredential', 'DTGCredential', 'StatementCredential', 'WitnessCredential'],
    issuer: ISSUER,
    validFrom: '2026-09-08T00:00:00Z',
    credentialSubject: {
      id: 'did:example:alice',
      predicate,
      object: { digestMultibase: 'zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n' },
    },
  }
}

/** How many canonical N-Quads mention `needle`? */
async function quadsMentioning(doc, needle, { safe = false } = {}) {
  const nq = await rdfc.canonize(doc, { documentLoader, safe })
  return { count: nq.split('\n').filter((l) => l.includes(needle)).length, nq }
}

console.log('=== ref-07c · does the signature cover the predicate? ===')
console.log('spec: dtgwg-cred-spec WD02 (6714971) + issue #45 strawman')
console.log('contexts: the real @bifold/vrc-contexts bytes + one rung-local extension')

// ============================================================== Check 0 =====
head(0, 'control: a registered predicate IS covered by an eddsa-rdfc-2022 signature')

const registered = statementVwc('dtg:witnessed')
const regProof = await rdfc.signCredential(registered, proofOptions('eddsa-rdfc-2022'), seed, {
  documentLoader,
})
const regSigned = { ...registered, proof: regProof }
line((await rdfc.verifyCredential(regSigned, pub, { documentLoader })).verified, 'signed VWC verifies as issued')

const regQuads = await quadsMentioning(registered, 'dtg#witnessed')
line(regQuads.count > 0, `predicate dtg:witnessed contributes ${regQuads.count} quad(s) to the signed dataset`)

const regTampered = clone(regSigned)
regTampered.credentialSubject.predicate = 'dtg:endorses'
const regTamperResult = await rdfc.verifyCredential(regTampered, pub, { documentLoader })
line(!regTamperResult.verified, 'swapping dtg:witnessed -> dtg:endorses BREAKS the signature (as it must)')

// ============================================================== Check 1 =====
head(1, 'an UNRESOLVED prefix does not fail — it is silently reinterpreted as a URI scheme')

// The hypothesis going in was that an unregistered CURIE would drop to zero
// quads. It does not: "example:observedDocument" is a syntactically valid
// absolute IRI whose scheme is "example", so JSON-LD keeps it verbatim. The
// credential is signed and tamper-evident — over an IRI its author did not mean.
const unresolvedPrefix = statementVwc('example:observedDocument')
const upQuads = await quadsMentioning(unresolvedPrefix, 'observedDocument')
line(upQuads.count === 1, `example:observedDocument survives expansion as ${upQuads.count} quad(s)`)
const upIri = upQuads.nq.split('\n').find((l) => l.includes('observedDocument'))
console.log(`\n     ${upIri.trim().slice(0, 140)}`)
line(
  upIri.includes('<example:observedDocument>'),
  'it expanded to the bare IRI <example:observedDocument> — the prefix became a URI scheme'
)

// The same bytes, read by a verifier holding a context that DOES map `example:`,
// mean something else entirely. Same credential, two meanings.
const RIVAL_URL = 'https://acme.example/vocab/v1'
const rivalLoader = async (url) => {
  if (url.split('#')[0] === RIVAL_URL)
    return {
      contextUrl: null,
      documentUrl: url,
      document: { '@context': { '@version': 1.1, example: 'https://acme.example/vocab#' } },
    }
  return documentLoader(url)
}
const withRival = clone(unresolvedPrefix)
withRival['@context'] = [...withRival['@context'], RIVAL_URL]
const rivalNq = await rdfc.canonize(withRival, { documentLoader: rivalLoader })
const rivalIri = rivalNq.split('\n').find((l) => l.includes('observedDocument'))
console.log(`     ${rivalIri.trim().slice(0, 140)}`)
line(
  rivalIri.includes('<https://acme.example/vocab#observedDocument>'),
  'with a context that maps the prefix, the SAME predicate string means a DIFFERENT IRI'
)

// ============================================================== Check 2 =====
head(2, "Q2's other option — a plain namespaced string — is NOT covered by the signature at all")

// #45 open question 2: "IRI/CURIE through the JSON-LD context (proposed), or a
// plain string namespaced by the governing community?" A plain string has no
// colon, so it is neither an IRI nor a resolvable CURIE. Under @vocab typing it
// expands to nothing.
const plainString = statementVwc('acme-observedDocument')
const psQuads = await quadsMentioning(plainString, 'observedDocument')
line(psQuads.count === 0, `plain string "acme-observedDocument" contributes ${psQuads.count} quad(s) — not in the signed dataset`)

let safeErrPlain = null
try {
  await rdfc.canonize(plainString, { documentLoader, safe: true })
} catch (e) {
  safeErrPlain = e
}
line(
  safeErrPlain !== null,
  safeErrPlain
    ? `JSON-LD safe mode catches it at signing: ${String(safeErrPlain.message).slice(0, 70)}`
    : 'safe mode did NOT catch it — it would sign silently'
)

let safeErrPrefix = null
try {
  await rdfc.canonize(unresolvedPrefix, { documentLoader, safe: true })
} catch (e) {
  safeErrPrefix = e
}
line(
  safeErrPrefix === null,
  'safe mode does NOT catch the unresolved-prefix case (it is a valid IRI, so nothing is dropped)'
)

// ============================================================== Check 3 =====
head(3, 'the consequence: a plain-string predicate can be swapped for its own negation')

const psProof = await rdfc.signCredential(plainString, proofOptions('eddsa-rdfc-2022'), seed, { documentLoader })
const psSigned = { ...plainString, proof: psProof }
line((await rdfc.verifyCredential(psSigned, pub, { documentLoader })).verified, 'signed as "acme-observedDocument" — verifies')

const psSwapped = clone(psSigned)
psSwapped.credentialSubject.predicate = 'acme-didNotObserveDocument'
line(
  (await rdfc.verifyCredential(psSwapped, pub, { documentLoader })).verified,
  'MUTATED to "acme-didNotObserveDocument" — signature STILL VERIFIES (the verb is unsigned)'
)

const nqA = await rdfc.canonize(psSigned, { documentLoader })
const nqB = await rdfc.canonize(psSwapped, { documentLoader })
line(nqA === nqB, 'the two documents canonicalize to byte-identical N-Quads')

// ============================================================== Check 4 =====
head(4, 'member by member: what of a #45 statement credential is actually in the signed dataset?')

// A statement credential carrying every object kind the strawman allows, plus a
// profile-defined extra member of the kind #45 says profiles may add.
const survey = {
  '@context': [CREDENTIALS_V2_CONTEXT_URL, WITNESSED_EXCHANGE_CONTEXT_URL, STATEMENT_CONTEXT_URL],
  id: 'urn:uuid:bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
  type: ['VerifiableCredential', 'DTGCredential', 'StatementCredential', 'WitnessCredential'],
  issuer: ISSUER,
  validFrom: '2026-09-08T00:00:00Z',
  credentialSubject: {
    id: 'did:example:alice',
    predicate: 'dtg:witnessed',
    object: { digestMultibase: 'zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n' },
    // profile-defined members: witnessContext IS in the shipped Keyring context;
    // its nested localityVerification members are NOT (ref-06p's finding, retested
    // here against the real shipped context rather than a minimal document).
    witnessContext: {
      event: 'GDC 2026',
      localityVerification: { challenge: 'nonce-abc', sig: 'zSIGNATURE' },
    },
    // the shape a community profile would add, with no term anywhere
    observationContext: { documentType: 'passport', issuingCountry: 'NL' },
  },
}

const nqSurvey = await rdfc.canonize(survey, { documentLoader })
const mentions = (needle) => nqSurvey.split('\n').filter((l) => l.includes(needle)).length

const members = [
  ['object.digestMultibase', 'zQmdfTbBqBPQ7VNx', true, 'defined by credentials/v2 and @protected'],
  ['predicate (dtg:witnessed)', 'dtg#witnessed', true, 'defined by the rung-local statement context'],
  ['witnessContext.event', 'GDC 2026', true, 'defined by the shipped Keyring context'],
  ['witnessContext.localityVerification.challenge', 'nonce-abc', false, 'no term — nested one level below a defined term'],
  ['observationContext.documentType', 'passport', false, 'no term — a community profile member'],
]
for (const [name, needle, shouldBeSigned, why] of members) {
  const n = mentions(needle)
  const signed = n > 0
  line(signed === shouldBeSigned, `${signed ? 'SIGNED    ' : 'NOT SIGNED'} ${name}  (${n} quad(s)) — ${why}`)
}

// ============================================================== Check 5 =====
head(5, 'the eddsa-jcs-2022 half of the PR #18 proof set closes all of it')

const jcsProof = jcs.signCredential(plainString, proofOptions('eddsa-jcs-2022'), seed)
const jcsSigned = { ...plainString, proof: jcsProof }
line(jcs.verifyCredential(jcsSigned, pub).verified, 'plain-string-predicate VWC signed eddsa-jcs-2022 — verifies')

const jcsSwapped = clone(jcsSigned)
jcsSwapped.credentialSubject.predicate = 'acme-didNotObserveDocument'
line(!jcs.verifyCredential(jcsSwapped, pub).verified, 'the same predicate swap BREAKS the eddsa-jcs-2022 signature')

const jcsSurvey = jcs.signCredential(survey, proofOptions('eddsa-jcs-2022'), seed)
const jcsSurveySwapped = { ...clone(survey), proof: jcsSurvey }
jcsSurveySwapped.credentialSubject.observationContext.documentType = 'drivers-licence'
line(
  !jcs.verifyCredential(jcsSurveySwapped, pub).verified,
  'and mutating the untermed profile member observationContext.documentType BREAKS it too'
)

// ============================================================== Check 6 =====
head(6, "the fail-closed rule's stated justification names a mechanism that does not exist")

// #45 (2026-09-09) proposes: "a verifier MUST reject a statement credential whose
// `predicate` does not expand to an absolute IRI in a vocabulary it accepts. This
// matters because the VC 2.0 base context sets @vocab to the issuer-dependent
// namespace, so an undefined acme: prefix doesn't error - it silently expands to
// .../issuer-dependent#acme:mayActFor."
//
// The rule is right. The reason given is not, and the true behaviour makes the
// rule's first clause useless on its own.
const v2ctx = CREDENTIALS_V2_CONTEXT_DOCUMENT['@context']
line(v2ctx['@vocab'] === undefined, 'the credentials/v2 base context defines no @vocab term')
line(
  !JSON.stringify(CREDENTIALS_V2_CONTEXT_DOCUMENT).includes('issuer-dependent'),
  'the string "issuer-dependent" does not appear anywhere in the credentials/v2 context'
)

const mayActFor = {
  '@context': [CREDENTIALS_V2_CONTEXT_URL, STATEMENT_CONTEXT_URL],
  id: 'urn:uuid:cccccccc-dddd-eeee-ffff-000000000000',
  type: ['VerifiableCredential', 'DTGCredential', 'StatementCredential'],
  issuer: 'did:example:principal',
  validFrom: '2026-09-09T00:00:00Z',
  credentialSubject: {
    id: 'did:example:agent',
    predicate: 'acme:mayActFor',
    object: { id: 'did:example:principal' },
  },
}
const mafNq = await rdfc.canonize(mayActFor, { documentLoader })
line(!mafNq.includes('issuer-dependent'), 'the worked example expands with no issuer-dependent IRI anywhere')
line(mafNq.includes('<acme:mayActFor>'), 'it expands to the bare absolute IRI <acme:mayActFor> - scheme "acme", left verbatim')
console.log(`\n     ${mafNq.split('\n').find((l) => l.includes('mayActFor')).trim().slice(0, 130)}`)
console.log('\n   Consequence for the rule as worded: "expands to an absolute IRI" is satisfied by')
console.log('   every unresolved prefix, because a colon is all it takes. The whole check rests on')
console.log('   the second clause - "in a vocabulary it accepts" - which is an allowlist the')
console.log('   verifier must hold in advance. That is ref-07d\'s subject, and open question 3.')

// =============================================================== summary ====
console.log(`\n=== ref-07c done · ${failures} failure(s) ===`)
process.exit(failures > 0 ? 1 : 0)
