// ref-07g-outcome-evidence-pairing
//
// cred-spec PR #18 is being split, and its outcome-evidence pairing rules are
// headed for the Trust Tasks framework as a generic rule. Two task specifications
// already carry their own version (witness/session/submit, vetting/session), and
// Keyring implements one. This rung runs the same exchanges through all of them —
// real Trust Task document shapes, real eddsa-jcs-2022 proofs, real task digests —
// to find which rule generalizes, and where each one says "completed" wrongly or
// "not completed" wrongly.
//
// No network. Rule texts are frozen in fixtures/pairing-rules-as-published.md.
import { readFileSync } from 'node:fs'
import { party, sign, verifyProof, taskDigest, digestEqual } from './jcs-proof.mjs'

let failures = 0
const line = (ok, text) => {
  if (!ok) failures++
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${text}`)
}
const head = (n, t) => console.log(`\n== Act ${n} — ${t}\n`)
const note = (t) => console.log(`         ${t}`)

// ---------------------------------------------------------------- types ----
const T = 'https://trusttasks.org/spec/'
const WS = T + 'witness/session/0.1'
const WSS = T + 'witness/session/submit/0.1'
const VS = T + 'vetting/session/0.1'
const CTRL = T + 'trust-task-control/0.1'
const ERR = T + 'trust-task-error/0.5'
const EX = 'https://community.example/spec/attest/0.1' // a spec that lets its initiator mint threadId

// What each cited specification declares as its exchange's outcome evidence.
// witness/session/submit: "This response is the outcome evidence"; vetting/session:
// the session's own #response carries the signed card.
const DECLARED = { [WS]: [WSS + '#response'], [VS]: [VS + '#response'], [EX]: [EX + '#response'] }

// trust-tasks-spec#17, Specification Requirements item 20.5: how each declared
// response is bound to its initiating document, as JSON Pointers (taken here from
// the document root). Option (a) = the initiating document's id and task digest;
// option (b) = a fresh value the initiating document supplied, reproduced.
const BINDING = {
  [WS]: { kind: 'a', id: '/payload/vwc/taskContext', digest: '/payload/vwc/taskDigestMultibase' },
  [VS]: { kind: 'b', resp: '/payload/card/challenge', init: '/payload/challenge' },
  [EX]: { kind: 'a', id: '/payload/openedBy', digest: '/payload/openedDigest' },
}
const ptr = (o, p) => p.split('/').slice(1).reduce((x, k) => (x == null ? undefined : x[k]), o)

// ---------------------------------------------------------------- parties ----
const alice = party(1) // holder / witnessed party / vetting applicant
const bob = party(2) // counterparty
const witness = party(3)
const carol = party(4) // vetter
const attester = party(5)
const REL = 'urn:uuid:0a0a0a0a-0000-4000-8000-00000000000a' // enclosing relationship exchange
const at = '2026-09-15T10:00:00Z'
const doc = (id, type, issuer, recipient, threadId, payload, extra = {}) => ({
  id, type, ...(threadId ? { threadId } : {}), ...extra, issuer: issuer.did, ...(recipient ? { recipient: recipient.did } : {}), issuedAt: at, payload,
})

// ------------------------------------------------------- witness ceremony ----
const S = 'urn:uuid:5e5510f0-0000-4000-8000-000000000001'
const wSession = sign(doc(S, WS, alice, witness, S, { parties: [alice.did, bob.did] }, { parentThreadId: REL }), alice)
const wSubmit = sign(doc('urn:uuid:5e5510f0-0000-4000-8000-000000000002', WSS, alice, witness, S, { vp: { holder: alice.did } }, { parentThreadId: REL }), alice)
const wBind = { taskContext: S, taskDigestMultibase: taskDigest(wSession) }
const wResponse = sign(doc('urn:uuid:5e5510f0-0000-4000-8000-000000000003', WSS + '#response', witness, alice, S, { vwc: wBind, vwcDigestMultibase: 'z…' }, { parentThreadId: REL }), witness)
const vwc = { issuer: witness.did, ...wBind }

// ------------------------------------------------------- vetting ceremony ----
const VID = 'urn:uuid:9a7e4c21-5b3d-4e8f-a1c2-3d4e5f6a7b01'
const vSession = sign(doc(VID, VS, carol, alice, VID, { claims: ['name'], challenge: 'c-1' }), carol)
const vResponse = sign(doc('urn:uuid:9a7e4c21-5b3d-4e8f-a1c2-3d4e5f6a7b02', VS + '#response', alice, carol, VID, { card: { challenge: 'c-1' } }), alice)
const vettingStatement = { issuer: carol.did, taskContext: VID, taskDigestMultibase: taskDigest(vSession) }

// ------------------------------------- an exchange whose initiator mints a thread ----
const GI = 'urn:uuid:77777777-0000-4000-8000-000000000001'
const MINTED = 'urn:uuid:77777777-0000-4000-8000-0000000000ff'
const gOpen = sign(doc(GI, EX, alice, attester, MINTED, { subject: alice.did }), alice)
const gResponse = sign(doc('urn:uuid:77777777-0000-4000-8000-000000000002', EX + '#response', attester, alice, MINTED, { attested: true, openedBy: GI, openedDigest: taskDigest(gOpen) }), attester)
const attestation = { issuer: attester.did, taskContext: GI, taskDigestMultibase: taskDigest(gOpen) }

// --------------------------------------------------------- adversarial docs ----
const controlResponse = sign(doc('urn:uuid:5e5510f0-0000-4000-8000-0000000000c2', CTRL + '#response', witness, alice, S, { effects: [] }, { parentThreadId: REL }), witness)
const selfSignedResponse = sign(doc('urn:uuid:5e5510f0-0000-4000-8000-0000000000d3', WSS + '#response', alice, witness, S, { vwc: wBind, vwcDigestMultibase: 'z…' }, { parentThreadId: REL }), alice)
const errorResponse = sign(doc('urn:uuid:5e5510f0-0000-4000-8000-0000000000e3', ERR, witness, alice, S, { code: 'taskFailed', retryable: false, inResponseTo: { typeUri: WSS, id: wSubmit.id } }), witness)
const counterfeitSession = sign(doc(S, WS, alice, witness, S, { parties: [alice.did, 'did:example:mallory'] }, { parentThreadId: REL }), alice)

// ---------------------------------------------- trust-tasks-spec#17 cases ----
// 8: the initiator reuses its minted threadId for a second exchange B, which is
//    cancelled; A's genuine response is shipped as B's outcome evidence.
const GB = 'urn:uuid:77777777-0000-4000-8000-00000000000b'
const gOpenB = sign(doc(GB, EX, alice, attester, MINTED, { subject: alice.did }), alice)
const attestationB = { issuer: attester.did, taskContext: GB, taskDigestMultibase: taskDigest(gOpenB) }
// 8w: the same on the witness ceremony — a non-conforming initiator reuses S as B's threadId.
const SB = 'urn:uuid:5e5510f0-0000-4000-8000-00000000000b'
const wSessionB = sign(doc(SB, WS, alice, witness, S, { parties: [alice.did, bob.did] }, { parentThreadId: REL }), alice)
const vwcB = { issuer: witness.did, taskContext: SB, taskDigestMultibase: taskDigest(wSessionB) }
// 9: binding option (b) — the vetter (initiator) reuses both the threadId and the challenge.
const VB = 'urn:uuid:9a7e4c21-5b3d-4e8f-a1c2-3d4e5f6a7b0b'
const vSessionB = sign(doc(VB, VS, carol, alice, VID, { claims: ['name'], challenge: 'c-1' }), carol)
const vettingStatementB = { issuer: carol.did, taskContext: VB, taskDigestMultibase: taskDigest(vSessionB) }
// 10: the initiating document names no recipient.
const GN = 'urn:uuid:77777777-0000-4000-8000-00000000000e'
const gOpenN = sign(doc(GN, EX, alice, null, MINTED, { subject: alice.did }), alice)
const gResponseN = sign(doc('urn:uuid:77777777-0000-4000-8000-00000000000f', EX + '#response', attester, alice, MINTED, { attested: true, openedBy: GN, openedDigest: taskDigest(gOpenN) }), attester)
const attestationN = { issuer: attester.did, taskContext: GN, taskDigestMultibase: taskDigest(gOpenN) }

// ----------------------------------------------------------------- rules ----
const common = (cred, initiating) => {
  const f = []
  if (initiating.id !== cred.taskContext) f.push('initiating id ≠ taskContext')
  if (!digestEqual(cred.taskDigestMultibase, taskDigest(initiating))) f.push('task digest does not reproduce')
  return f
}
const signedBy = (d) => verifyProof(d)

const RULES = {
  // A — witness/session/submit/0.1, as published (witness-specific by design)
  witnessSpec: (cred, i, t) => {
    const f = common(cred, i)
    if (t.threadId !== cred.taskContext) f.push('threadId ≠ taskContext')
    if (t.type !== WSS + '#response') f.push('type is not submit#response')
    const p = signedBy(t)
    if (!p.ok) f.push('proof fails')
    if (t.issuer !== cred.issuer) f.push('evidence issuer ≠ credential issuer')
    return f
  },
  // B — Keyring outcomeEvidence.ts @ 7dc1de2a
  keyring: (cred, i, t) => {
    const f = common(cred, i)
    if ((t.threadId ?? '') !== (i.threadId ?? i.id)) f.push('threadId does not pair')
    if (t.type.includes('/trust-task-error/')) f.push('error response')
    else if (!t.type.endsWith('#response')) f.push('not a success response')
    const p = signedBy(t)
    if (!p.ok || p.signer !== t.issuer) f.push('proof fails under its issuer')
    return f
  },
  // C — cred-spec PR #18 @ fc2276b
  pr18: (cred, i, t) => {
    const f = common(cred, i)
    if ((t.threadId ?? '') !== (i.threadId ?? i.id)) f.push('threadId does not pair')
    if (t.type !== i.type + '#response') f.push("type is not the originating request's #response")
    const p = signedBy(t)
    if (!p.ok || p.signer !== i.recipient) f.push('not signed by the responder')
    return f
  },
  // D — proposed generic rule for the Trust Tasks framework
  generic: (cred, i, t) => {
    const f = common(cred, i)
    if ((t.threadId ?? '') !== (i.threadId ?? i.id)) f.push('threadId does not pair')
    if (!(DECLARED[i.type] ?? []).includes(t.type)) f.push('type is not a declared outcome-evidence response')
    const p = signedBy(t)
    if (!p.ok || p.signer !== i.recipient || t.issuer !== i.recipient) f.push('not signed by the party the exchange was addressed to')
    return f
  },
  // E — the generic rule as amended by trust-tasks-spec#17: check 2 also requires the
  //     declared binding (item 20.5); check 4 fails where the initiating document names
  //     no recipient (item 20).
  tt17: (cred, i, t) => {
    const f = RULES.generic(cred, i, t)
    if (!i.recipient) f.push('initiating document names no recipient')
    const b = BINDING[i.type]
    if (!b) f.push('no binding declared')
    else if (b.kind === 'a') {
      if (ptr(t, b.id) !== i.id || !digestEqual(ptr(t, b.digest) ?? '', taskDigest(i))) f.push('binding (a): response does not carry the initiating id and task digest')
    } else if (ptr(t, b.resp) === undefined || ptr(t, b.resp) !== ptr(i, b.init)) f.push('binding (b): response does not reproduce the initiating value')
    return f
  },
}

console.log('=== ref-07g · which outcome-evidence pairing rule generalizes? ===')
console.log('rules: witness/session/submit 0.1 (tf @ dd1f8059) · Keyring outcomeEvidence.ts (bifold @ 7dc1de2a)')
console.log('       cred-spec #18 (fc2276b) · generic rule (merged as trust-tasks-spec#15) · as amended by trust-tasks-spec#17')

// ------------------------------------------------------------------ Act 0 ----
head(0, 'the rules under test are the ones actually published and shipped')

const ks = readFileSync(new URL('../../bifold/packages/core/src/modules/trust-tasks/outcomeEvidence.ts', import.meta.url), 'utf8')
line(ks.includes('initiating.threadId ?? initiating.id'), 'Keyring pairs threadId through the initiating document (threadId ?? id)')
line(ks.includes("terminalType.endsWith('#response')"), "Keyring accepts a terminal whose type merely ends in '#response'")
line(ks.includes('verifyDocumentProof(agent, terminal, String(terminal.issuer'), "Keyring verifies the terminal's proof under the terminal's OWN issuer")
line(!/terminal\.issuer\s*!==|!==\s*terminal\.issuer/.test(ks), 'Keyring never compares that issuer with the party the exchange was addressed to')
line(readFileSync(new URL('./fixtures/pairing-rules-as-published.md', import.meta.url), 'utf8').includes('the evidence\'s `threadId` equals the\n> VWC\'s `taskContext`'), 'witness spec pairing text frozen verbatim')
const ALL = [wSession, wSubmit, wResponse, vSession, vResponse, gOpen, gResponse, controlResponse, selfSignedResponse, errorResponse, gOpenB, wSessionB, vSessionB, gOpenN, gResponseN]
for (const d of ALL) {
  if (!verifyProof(d).ok) line(false, `proof on ${d.type} does not verify`)
}
line(true, `all ${ALL.length} Trust Task documents carry eddsa-jcs-2022 proofs that verify under their signer`)

// ------------------------------------------------------------------ matrix ----
const SCENARIOS = [
  { key: 'W', name: 'witness ceremony, honest', cred: vwc, i: wSession, t: wResponse, truth: true },
  { key: 'V', name: 'vetting ceremony, honest', cred: vettingStatement, i: vSession, t: vResponse, truth: true },
  { key: 'M', name: 'honest exchange, initiator minted threadId', cred: attestation, i: gOpen, t: gResponse, truth: true },
  { key: 'C', name: 'session cancelled — control #response shipped', cred: vwc, i: wSession, t: controlResponse, truth: false },
  { key: 'F', name: 'submit#response signed by the holder itself', cred: vwc, i: wSession, t: selfSignedResponse, truth: false },
  { key: 'E', name: 'exchange ended in trust-task-error', cred: vwc, i: wSession, t: errorResponse, truth: false },
  { key: 'X', name: 'counterfeit session doc reusing the id', cred: vwc, i: counterfeitSession, t: wResponse, truth: false },
  { key: '8', name: 'reused threadId, generic exchange', cred: attestationB, i: gOpenB, t: gResponse, truth: false },
  { key: '8w', name: 'reused threadId, witness ceremony', cred: vwcB, i: wSessionB, t: wResponse, truth: false },
  { key: '9', name: 'reused threadId + challenge, vetting', cred: vettingStatementB, i: vSessionB, t: vResponse, truth: false },
  { key: '10', name: 'initiating doc names no recipient', cred: attestationN, i: gOpenN, t: gResponseN, truth: false },
]
const ORIGINAL = SCENARIOS.slice(0, 7)
const results = {}
for (const s of SCENARIOS) {
  results[s.key] = {}
  for (const [r, fn] of Object.entries(RULES)) results[s.key][r] = fn(s.cred, s.i, s.t)
}

head(1, 'every rule on every exchange (✓ = "completion evidenced")')
console.log('   exchange                                          truth   witness  keyring  pr18     generic  #17')
for (const s of SCENARIOS) {
  const cell = (r) => {
    const ok = results[s.key][r].length === 0
    const wrong = ok !== s.truth
    return `${ok ? '✓' : '✗'}${wrong ? (ok ? ' FALSE+' : ' FALSE-') : '       '}`
  }
  console.log(`   ${s.name.padEnd(49)} ${s.truth ? 'yes' : 'no '}     ${cell('witnessSpec')} ${cell('keyring')} ${cell('pr18')} ${cell('generic')} ${cell('tt17')}`)
}
const why = (s, r) => results[s][r].join('; ')

// ------------------------------------------------------------------ Act 2 ----
head(2, "the witness spec's rule is right for witnessing and does not generalize")

line(results.W.witnessSpec.length === 0, 'accepts the honest witness ceremony it was written for')
line(['C', 'F', 'E', 'X'].every((k) => results[k].witnessSpec.length > 0), 'rejects all four bad witness exchanges')
line(results.M.witnessSpec.includes('threadId ≠ taskContext'), `its thread clause rejects an honest exchange whose initiator minted a threadId — ${why('M', 'witnessSpec')}`)
note('Sound inside witnessing only because witness/session 0.1 Conformance item 1 forbids minting;')
note('the framework itself permits it, so a generic rule cannot assume threadId == id.')
line(results.V.witnessSpec.includes('evidence issuer ≠ credential issuer'), 'its issuer clause rejects the honest vetting ceremony — the vetter issues the credential, the applicant signs the response')

// ------------------------------------------------------------------ Act 3 ----
head(3, "Keyring's rule accepts a cancellation and a self-signed response as completion")

line(results.W.keyring.length === 0 && results.V.keyring.length === 0 && results.M.keyring.length === 0, 'accepts all three honest exchanges, including the minted thread')
line(results.C.keyring.length === 0, "FALSE POSITIVE: a trust-task-control #response in the session's thread passes — its type ends in '#response'")
line(results.F.keyring.length === 0, 'FALSE POSITIVE: a submit#response the holder signed itself passes — the proof verifies under its own issuer, and nobody asked whose issuer that is')
line(results.E.keyring.length > 0 && results.X.keyring.length > 0, 'rejects the error response and the counterfeit session document')
note('These are the two gaps Glenn named on tf#173 (cancelled terminal state) plus the responder check #18 carries.')

// ------------------------------------------------------------------ Act 4 ----
head(4, "cred-spec #18's own text rejects the real witness ceremony")

line(results.W.pr18.length > 0, `#18 rejects the honest witness ceremony — ${why('W', 'pr18')}`)
note('The witness exchange is opened by witness/session and closed by witness/session/submit#response:')
note('"the originating request\'s Type URI with #response" names a document that ceremony never produces.')
line(results.V.pr18.length === 0 && results.M.pr18.length === 0, 'accepts vetting and the minted-thread exchange, where opener and closer are one specification')
line(['C', 'F', 'E', 'X'].every((k) => results[k].pr18.length > 0), 'rejects all four bad exchanges')

// ------------------------------------------------------------------ Act 5 ----
head(5, 'the generic rule gets the original seven right')

for (const s of ORIGINAL) {
  const ok = results[s.key].generic.length === 0
  line(ok === s.truth, `${s.name}: ${ok ? 'completion evidenced' : 'rejected — ' + why(s.key, 'generic')}`)
}
note('What it needs that the framework does not state today:')
note('  (a) a citable specification DECLARES which success response is its outcome evidence;')
note('  (b) the signer is the initiating document\'s recipient — not the credential\'s issuer.')
note('What it keeps from #18: threadId pairs through the initiating document (threadId ?? id).')

// ------------------------------------------------------------------ Act 6 ----
head(6, 'trust-tasks-spec#17: a reused threadId, and what the declared binding closes')

for (const s of ORIGINAL) {
  const a = results[s.key].generic.length === 0, b = results[s.key].tt17.length === 0
  if (a !== b) line(false, `#17 changes the outcome of "${s.name}"`)
}
line(true, 'no regression: #17 decides the original seven exactly as the generic rule does')
line(results['8'].generic.length === 0 && results['8w'].generic.length === 0, 'FALSE POSITIVE under the merged rule: a reused threadId lets exchange A\'s response evidence cancelled exchange B — generic and witness alike')
line(results['8'].tt17.length > 0 && results['8w'].tt17.length > 0, `#17 rejects both — ${why('8', 'tt17')}`)
line(results['9'].tt17.length === 0, 'FALSE POSITIVE under #17: binding option (b) — an initiator reusing threadId AND challenge passes A\'s card as B\'s evidence')
note('Option (b) trusts the initiator to supply a fresh value — the producer-only guarantee #17 says a threadId')
note('cannot carry. Moot for vetting (the initiator is the vetter, who issues the statement), not in general.')
line(results['10'].generic.length > 0 && results['10'].tt17.length > 0, `a missing recipient already fails the merged rule's signer check; #17 names it — ${why('10', 'tt17')}`)

console.log(`\n=== ref-07g done · ${failures} failure(s) ===`)
process.exit(failures ? 1 : 0)
