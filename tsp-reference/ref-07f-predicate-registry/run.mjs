// ref-07f-predicate-registry
//
// cred-spec #52 proposes a repo-driven predicate registry whose generated
// accept-list.json is what verifiers import. This rung builds that registry
// from #52's own worked entries and runs a verifier configured from it against
// Keyring's real credentials, through Keyring's real code, to answer one
// question: does the format carry what a verifier needs?
//
// No network. No signatures (this is the vocabulary layer, not the proof layer).

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { base58 } from '@scure/base'
import { credentialTypes, witnessedExchangeContext, keyringSource } from './keyring-source.mjs'
import { loadDefinitions, validateDefinitions, buildAcceptList } from './generate.mjs'
import { configure, verify } from './verify.mjs'

let failures = 0
const line = (ok, text) => {
  if (!ok) failures++
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${text}`)
}
const head = (n, t) => console.log(`\n== Act ${n} — ${t}\n`)
const note = (t) => console.log(`         ${t}`)
const clone = (o) => JSON.parse(JSON.stringify(o))
const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))

// ------------------------------------------------------------------ inputs --
const captured = json('../ref-07-dtg-edge-semantics/fixtures/edge-witnessed-captured.json')
const production = json('./fixtures/vwc-production-builder.json').credential
const schemaStore = { 'witness-context.schema.json': json('./registry/schemas/witness-context.schema.json') }
const issueExample = json('./registry/example-accept-list-from-issue-52.json')

const WITNESSED = 'https://trustoverip.org/dtg/vocab#witnessed' // #52's placeholder IRI (#48 pending)
const PRESENTED = 'https://trustoverip.org/dtg/vocab#presented'

const jcs = (v) =>
  v === null || typeof v !== 'object'
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? `[${v.map(jcs).join(',')}]`
      : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(',')}}`
/** Keyring's current binding — mirrors witness-server computeVrcDigest (JCS over the whole VRC). */
const keyringDigest = (o) => 'sha256:' + createHash('sha256').update(jcs(o)).digest('hex')
/** WD02 Digest Encoding — JCS excluding proof, sha2-256 multihash, base58btc. */
const digestMultibase = (o) => {
  const { proof: _p, ...claims } = o
  return 'z' + base58.encode(new Uint8Array([0x12, 0x20, ...createHash('sha256').update(jcs(claims)).digest()]))
}
const issuerOf = (c) => (typeof c.issuer === 'string' ? c.issuer : c.issuer?.id)
const vrcNamedBy = (vwc) => captured.vrcs.map((v) => v.credential).find((v) => keyringDigest(v) === vwc.credentialSubject.digest)

/**
 * Re-express a Keyring VWC in PR #47's statement shape. Mechanical: the
 * predicate replaces the type string, the digest moves into `object` in WD02
 * encoding, `taskContext` moves to the top level where #47 puts it, and every
 * other member Keyring emits is carried over unchanged.
 */
function toStatement(vwc, referenced) {
  const { digest: _d, taskContext, ...rest } = vwc.credentialSubject
  return {
    '@context': vwc['@context'],
    id: vwc.id,
    type: ['VerifiableCredential', 'DTGCredential', 'StatementCredential'],
    issuer: issuerOf(vwc),
    validFrom: vwc.validFrom,
    ...(vwc.validUntil ? { validUntil: vwc.validUntil } : {}),
    ...(taskContext ? { taskContext } : {}),
    credentialSubject: {
      id: rest.id,
      predicate: WITNESSED,
      object: { digestMultibase: digestMultibase(referenced) },
      ...Object.fromEntries(Object.entries(rest).filter(([k]) => k !== 'id')),
    },
  }
}

console.log('=== ref-07f · does #52\'s accept-list carry what a verifier needs? ===')
console.log('registry: the two worked entries in cred-spec #52, verbatim')
console.log('rules:    PR #47 @ bc1fd88 (Predicate Handling, Predicate Profiles)')
console.log('keyring:  bifold @ 7dc1de2a — credentialTypes.ts and witnessedExchangeContext.ts run from source')

// ------------------------------------------------------------------- Act 0 --
head(0, 'the Keyring shapes this rung relies on are still what Keyring ships')

const sessions = keyringSource('witness-server/src/trustTasks/WitnessTaskSessions.ts')
const service = keyringSource('witness-server/src/WitnessService.ts')
line(/subject\.taskContext = session\.sessionId/.test(sessions), 'witness server still binds taskContext on the VWC (WitnessTaskSessions.ts)')
line(/subject\.parties = session\.parties/.test(sessions) && /subject\.taskDigestMultibase =/.test(sessions), 'and still adds parties + taskDigestMultibase alongside it')
line(/hardwareAttestationIncluded:/.test(service) && /witnessContext\.localityVerification =/.test(service), 'witnessContext still carries hardwareAttestationIncluded and localityVerification (WitnessService.ts)')
const namedVrc = vrcNamedBy(production)
line(!!namedVrc, 'the production-builder VWC\'s digest reproduces over a real captured VRC (validates the digest helper against real output)')
const keyringWitnessTerms = Object.keys(witnessedExchangeContext.WITNESSED_EXCHANGE_CONTEXT_DOCUMENT['@context'])
  .filter((t) => ['event', 'sessionId', 'method', 'localityVerification', 'hardwareAttestationIncluded'].includes(t))
note(`Keyring's context defines witnessContext members: ${keyringWitnessTerms.join(', ')}`)

// ------------------------------------------------------------------- Act 1 --
head(1, 'build the registry exactly as #52 describes it')

const defs = loadDefinitions()
for (const r of validateDefinitions(defs)) line(r.valid, `${r.file} is complete against the definition format${r.errors.length ? ' — ' + r.errors.join('; ') : ''}`)
note('#52 names meta/predicate.schema.json and schemas/witness-context.schema.json but publishes neither;')
note('both are authored here from #47\'s text (see the $comment in each).')

const acceptList = buildAcceptList(defs)
line(WITNESSED in acceptList, '`witnessed` (active) is in accept-list.json')
line(!(PRESENTED in acceptList), '`presented` (proposed) is not — #52: the accept-list carries active IRIs only')
line(!!acceptList[WITNESSED].additionalMembers.witnessContext.schema, 'the generated entry carries the witnessContext schema URL')
line(!issueExample[WITNESSED].additionalMembers.witnessContext.schema, '#52\'s own example accept-list entry omits it — the Generated outputs table says schema URLs are included')

const config = configure(acceptList, schemaStore)

// ------------------------------------------------------------------- Act 2 --
head(2, 'Keyring\'s VWCs as shipped today')

const legacyVwc = captured.vwcs[0].credential
for (const [name, vwc] of [['captured exchange VWC', legacyVwc], ['production-builder VWC', production]]) {
  const r = verify(config, vwc)
  line(!r.ok && r.reason.startsWith('step 1'), `${name}: rejected at ${r.reason}`)
  line(credentialTypes.isWitnessCredential(vwc), `${name}: Keyring's real isWitnessCredential() routes it today (by type string)`)
}
note('Expected: both predate #47, which replaces the WitnessCredential type string with a predicate.')

// ------------------------------------------------------------------- Act 3 --
head(3, 'the same credentials in #47\'s statement shape')

const prodStatement = toStatement(production, namedVrc)
const pr = verify(config, prodStatement)
line(pr.ok, 'production-builder VWC as a statement: ACCEPTED by the accept-list verifier')
note(`checked:  ${pr.checked.join(' · ')}`)
note(`not checked: ${pr.unchecked.join(' · ')}`)

const legacyStatement = toStatement(legacyVwc, vrcNamedBy(legacyVwc))
const lr = verify(config, legacyStatement)
line(!lr.ok && /taskContext/.test(lr.reason), `captured-exchange VWC as a statement: rejected — ${lr.reason}`)
note('A real Keyring self-finding: the vrc-reference demo path predates Trust Task Context Binding.')

line(!credentialTypes.isWitnessCredential(prodStatement), 'Keyring\'s real isWitnessCredential() no longer recognises the statement (no type string)')
line(credentialTypes.isPeerVrcCredential(prodStatement), '…and isPeerVrcCredential() now claims it — today\'s wallet would file it under Contacts')
const dispatch = (c) => (config.profiles[c.credentialSubject?.predicate] ? `profile ${c.credentialSubject.predicate.split('#')[1]}` : 'rejected')
line(dispatch(prodStatement) === 'profile witnessed', 'dispatching on the accept-list instead routes it to the witnessed profile')
note('So the accept-list is not only a verification allowlist — for a wallet it is the dispatch table.')

// ------------------------------------------------------------------- Act 4 --
head(4, 'what the accept-list lets a generic verifier enforce, on Keyring data')

const variant = (fn) => { const c = clone(prodStatement); fn(c); return c }
const expectReject = (label, c, pattern) => {
  const r = verify(config, c, {})
  line(!r.ok && pattern.test(r.reason), `${label}: rejected — ${r.reason}`)
}
expectReject('unknown predicate', variant((c) => (c.credentialSubject.predicate = 'https://acme.example/vocab#witnessed')), /step 2/)
expectReject('proposed predicate (`presented`)', variant((c) => (c.credentialSubject.predicate = PRESENTED)), /step 2/)
expectReject('CURIE form `dtg:witnessed`', variant((c) => (c.credentialSubject.predicate = 'dtg:witnessed')), /step 2/)
note('The CURIE passes step 1 (it is syntactically an absolute IRI) and only falls at step 2 — #47\'s "malformed, not unknown" does not hold.')
expectReject('taskContext removed', variant((c) => delete c.taskContext), /taskContext/)
expectReject('object.id instead of digestMultibase', variant((c) => (c.credentialSubject.object = { id: 'did:example:x' })), /object kind/)
expectReject('witnessContext.event as a number', variant((c) => (c.credentialSubject.witnessContext.event = 7)), /witnessContext fails/)

const ignoredOk = verify(config, prodStatement)
line(ignoredOk.ok && ignoredOk.ignored.includes('parties') && ignoredOk.ignored.includes('taskDigestMultibase'),
  'Keyring\'s undefined members parties + taskDigestMultibase are ignored, per #47 profile item 5')

// The unpublished witness-context schema decides whether Keyring's evidence members are conformant.
const withLocality = variant((c) => (c.credentialSubject.witnessContext.localityVerification = { type: 'proximity', confirmed: true }))
line(verify(config, withLocality).ok, 'OPEN reading of witness-context.schema.json: Keyring\'s hardwareAttestationIncluded + localityVerification accepted')
const closedSchema = { ...schemaStore['witness-context.schema.json'], additionalProperties: false }
const closedConfig = configure(acceptList, { 'witness-context.schema.json': closedSchema })
const closed = verify(closedConfig, withLocality)
line(!closed.ok && /additional properties/.test(closed.reason), `CLOSED reading: the same credential is rejected — ${closed.reason}`)
note('#47 item 5 says ignore undefined credentialSubject members; it says nothing about members nested inside a')
note('defined one. So whether Keyring\'s hardware/locality evidence is conformant rests on a schema not yet written.')

// ------------------------------------------------------------------- Act 5 --
head(5, 'what the accept-list cannot enforce today')

const wrongSubject = variant((c) => (c.credentialSubject.id = 'did:example:someone-who-issued-nothing'))
const ws = verify(config, wrongSubject)
line(ws.ok, 'a statement naming the WRONG subject passes every generic check')
line(ws.unchecked.some((u) => u.startsWith('subjectObjectRelationship')), '…because subjectObjectRelationship is free text: "credentialSubject.id MUST be the issuer of…"')

const relations = { [WITNESSED]: 'subjectIsReferencedIssuer', [PRESENTED]: 'subjectIsReferencedSubject' }
const referenced = captured.vrcs.map((v) => ({ credential: v.credential, digestMultibase: digestMultibase(v.credential) }))
line(verify(config, prodStatement, { relations, referenced }).ok, 'with a named relation (`subjectIsReferencedIssuer`), Keyring\'s real statement passes the check')
const wr = verify(config, wrongSubject, { relations, referenced })
line(!wr.ok, `and the wrong-subject statement is caught — ${wr.reason}`)
const bothDirections = captured.vwcs.every((w) => w.credential.credentialSubject.id === issuerOf(vrcNamedBy(w.credential)))
line(bothDirections, 'both VWCs of Keyring\'s real two-party exchange satisfy `subjectIsReferencedIssuer`')
note('The two worked entries use exactly two relations — issuer of the referenced credential (witnessed),')
note('subject of it (presented) — so a small set of named values would make item 4 machine-checkable.')

const prodIssuer = issuerOf(production)
line(ws.unchecked.some((u) => u.startsWith('minimumIssuerScope')), `minimumIssuerScope "directed" cannot be evaluated: Keyring's witness (${prodIssuer.slice(0, 22)}…) declares no scope, and no property exists to declare one (#46)`)

// ------------------------------------------------------------------- Act 6 --
head(6, 'deprecation: what happens to credentials already issued')

const release2 = loadDefinitions().map(({ file, def }) => ({ file, def: def.id === WITNESSED ? { ...def, status: 'deprecated' } : def }))
const r2active = configure(buildAcceptList(release2), schemaStore)
const d1 = verify(r2active, prodStatement)
line(!d1.ok && /step 2/.test(d1.reason), 'release 2 deprecates `witnessed`; an accept-list of active IRIs now REJECTS the statement Keyring already issued')
const r2both = configure(buildAcceptList(release2, { statuses: ['active', 'deprecated'] }), schemaStore)
line(verify(r2both, prodStatement).ok, 'an accept-list that keeps deprecated entries (marked) still accepts it')
note('#52: deprecated terms are "kept forever", but the accept-list carries "the active IRIs" — so as written,')
note('deprecation retroactively invalidates every credential issued under the term.')

// ------------------------------------------------------------------- Act 7 --
head(7, 'verification never touches the network')

let fetches = 0
const realFetch = globalThis.fetch
globalThis.fetch = async () => { fetches++; throw new Error('network used during verification') }
const cfg = configure(buildAcceptList(loadDefinitions()), schemaStore)
for (const c of [prodStatement, legacyStatement, wrongSubject, withLocality]) verify(cfg, c, { relations, referenced })
globalThis.fetch = realFetch
line(fetches === 0, `configured once, verified 4 credentials: ${fetches} network requests — #47's "resolve at configuration time, never at verification time" holds for this format`)

console.log(`\n=== ref-07f done · ${failures} failure(s) ===`)
process.exit(failures ? 1 : 0)
