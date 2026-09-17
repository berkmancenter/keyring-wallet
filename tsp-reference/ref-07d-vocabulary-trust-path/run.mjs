// ref-07d-vocabulary-trust-path
//
// cred-spec #45 open question 3 asks whether ToIP should host a registry of
// common predicates, "or is that a governance-framework matter?" The natural
// implementer answer is "the JSON-LD context already does this". This rung
// measures what actually happens when a wallet meets a predicate whose
// vocabulary it does not bundle — using the REAL shipped Keyring document
// loader, driven directly.
//
// The subject is createVrcDocumentLoader (core/src/modules/vrc): five bundled
// contexts, then `return await fetch(url)`.
//
// Needs no external network: a local HTTP server plays the community's
// vocabulary host, and every request to it is counted.

import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { ed25519 } from '@noble/curves/ed25519.js'
import * as rdfc from './eddsa-rdfc-2022.mjs'

const require = createRequire(import.meta.url)
const clone = (o) => JSON.parse(JSON.stringify(o))
let failures = 0
const line = (ok, text) => {
  if (!ok) failures++
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${text}`)
}
const head = (n, t) => console.log(`\n== Check ${n} — ${t}\n`)

// ------------------------------------------------- the community's host ----
// Two versions of one context, at one URL. Version 1 defines the predicate
// term; version 2 does not. The host chooses which to serve, at any time.
let serve = 'v1'
const requests = []
const CONTEXT_V1 = {
  '@context': {
    '@version': 1.1,
    acme: 'https://acme.example/vocab#',
    predicate: { '@id': 'https://acme.example/vocab#predicate', '@type': '@vocab' },
    observedDocument: 'https://acme.example/vocab#observedDocument',
  },
}
const CONTEXT_V2 = {
  '@context': {
    '@version': 1.1,
    acme: 'https://acme.example/vocab#',
    // `predicate` term withdrawn. Nothing else changed.
  },
}
const server = createServer((req, res) => {
  requests.push(`${req.method} ${req.url}`)
  res.setHeader('content-type', 'application/ld+json')
  res.end(JSON.stringify(serve === 'v1' ? CONTEXT_V1 : CONTEXT_V2))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port
const COMMUNITY_CONTEXT_URL = `http://127.0.0.1:${PORT}/vocab/v1`

// --------------------------------------------- the real Keyring loader -----
const { createVrcDocumentLoader } = require(
  '../../bifold/packages/core/lib/commonjs/modules/vrc/createVrcDocumentLoader.js'
)
// The loader only needs the DID resolver for did: URLs, which this rung never
// uses; a stub keeps us on the real code path for every http(s) URL.
const walletLoader = createVrcDocumentLoader({ dependencyManager: { resolve: () => ({}) } })

const contexts = require('../../bifold/packages/vrc-contexts/build/index.js')
const { CREDENTIALS_V2_CONTEXT_URL, WITNESSED_EXCHANGE_CONTEXT_URL } = contexts

console.log('=== ref-07d · is a community vocabulary inside the trust boundary? ===')
console.log('loader: the shipped createVrcDocumentLoader, driven directly')
console.log(`host:   local server on 127.0.0.1:${PORT} standing in for a community's vocabulary host`)

// =============================================================== Check 0 ====
head(0, 'the bundled contexts cost no network')

requests.length = 0
await walletLoader(CREDENTIALS_V2_CONTEXT_URL)
await walletLoader(WITNESSED_EXCHANGE_CONTEXT_URL)
line(requests.length === 0, `two bundled contexts resolved with ${requests.length} network request(s)`)

// =============================================================== Check 1 ====
head(1, 'a community predicate makes the wallet fetch that community\'s server, at verification time')

requests.length = 0
const fetched = await walletLoader(COMMUNITY_CONTEXT_URL)
line(requests.length === 1, `resolving one unbundled context made ${requests.length} outbound request(s): ${requests[0]}`)
line(!!fetched.document['@context'], 'the loader returned whatever the host served, unauthenticated and uncached')
console.log('\n   createVrcDocumentLoader.ts, last branch:')
console.log('     // Fallback: fetch remote context via HTTP')
console.log('     const response = await fetch(url)')
console.log('\n   There is no allowlist on that branch and no cache. The vocabulary host learns')
console.log('   which verifier is reading which kind of credential, and when.')

// =============================================================== Check 2 ====
head(2, 'offline, the same verification is impossible')

await new Promise((r) => server.close(r))
let offlineErr = null
try {
  await walletLoader(COMMUNITY_CONTEXT_URL)
} catch (e) {
  offlineErr = e
}
line(offlineErr !== null, `with the host unreachable the loader throws: ${String(offlineErr?.message ?? '').slice(0, 58)}`)
console.log('   Keyring bundles contexts precisely so that verification works offline.')
console.log('   A community predicate opts that credential out of the guarantee.')

// =============================================================== Check 3 ====
head(3, 'the vocabulary host retroactively controls what the signature covered')

await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
serve = 'v1'

const seed = new Uint8Array(32).fill(11)
const pub = ed25519.getPublicKey(seed)
const loaderFor = async (url) => walletLoader(url)

const statement = {
  '@context': [CREDENTIALS_V2_CONTEXT_URL, COMMUNITY_CONTEXT_URL],
  id: 'urn:uuid:99999999-8888-7777-6666-555555555555',
  type: ['VerifiableCredential'],
  issuer: 'did:example:observer',
  validFrom: '2026-09-08T00:00:00Z',
  credentialSubject: { id: 'did:example:alice', predicate: 'acme:observedDocument' },
}

const nqAtIssue = await rdfc.canonize(statement, { documentLoader: loaderFor })
const coveredAtIssue = nqAtIssue.split('\n').filter((l) => l.includes('observedDocument')).length
line(coveredAtIssue === 1, `at issuance (context v1 served) the predicate contributes ${coveredAtIssue} quad(s) — it IS signed`)

const proof = await rdfc.signCredential(
  statement,
  { type: 'DataIntegrityProof', cryptosuite: 'eddsa-rdfc-2022', created: '2026-09-08T00:00:00Z', verificationMethod: 'did:example:observer#k', proofPurpose: 'assertionMethod' },
  seed,
  { documentLoader: loaderFor }
)
const signed = { ...statement, proof }
line((await rdfc.verifyCredential(signed, pub, { documentLoader: loaderFor })).verified, 'the signed statement verifies while v1 is served')

// The host withdraws the term. Same URL, same credential bytes, same key.
serve = 'v2'
const nqAfter = await rdfc.canonize({ ...statement }, { documentLoader: loaderFor })
const coveredAfter = nqAfter.split('\n').filter((l) => l.includes('observedDocument')).length
line(coveredAfter === 0, `after the host withdraws the term, the predicate contributes ${coveredAfter} quad(s) — no longer signed`)

const stillVerifies = await rdfc.verifyCredential(signed, pub, { documentLoader: loaderFor })
line(!stillVerifies.verified, 'the ORIGINAL signature no longer verifies (the signed dataset changed under it)')

const swapped = clone(signed)
swapped.credentialSubject.predicate = 'acme:didNotObserveDocument'
const reProof = await rdfc.signCredential(
  { ...statement, credentialSubject: { ...statement.credentialSubject, predicate: 'acme:didNotObserveDocument' } },
  { type: 'DataIntegrityProof', cryptosuite: 'eddsa-rdfc-2022', created: '2026-09-08T00:00:00Z', verificationMethod: 'did:example:observer#k', proofPurpose: 'assertionMethod' },
  seed,
  { documentLoader: loaderFor }
)
const reSigned = { ...statement, credentialSubject: { ...statement.credentialSubject, predicate: 'acme:didNotObserveDocument' }, proof: reProof }
const negated = clone(reSigned)
negated.credentialSubject.predicate = 'acme:observedDocument'
line(
  (await rdfc.verifyCredential(negated, pub, { documentLoader: loaderFor })).verified,
  'and under v2 the predicate is freely swappable — any verb verifies against any signature'
)

await new Promise((r) => server.close(r))
console.log(`\n=== ref-07d done · ${failures} failure(s) ===`)
process.exit(failures > 0 ? 1 : 0)
