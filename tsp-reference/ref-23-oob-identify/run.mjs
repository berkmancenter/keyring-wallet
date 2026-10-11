/**
 * ref-23: a member's AGENT vouches for them in a trigger-link sign-in.
 *
 * Builds on ref-22 (claim). After the claim, the browser sees the match
 * number; the wallet builds `auth/oob/identify/0.1` (issuer = the member's
 * persona DID, payload {requestId, approverKey: K_a, enteredNumber}) and asks
 * the member's VTA to sign it with `vault/sign-trust-task/0.2` (the persona's
 * `did-self-issued` vault entry, which targets the VTC). The wallet checks the
 * VTA returned the same document plus an `authentication` proof by the persona,
 * then sends `auth/oob/prove/0.1` {identify}. The VTC checks membership, the
 * proof and the number, and answers step 2 (assertionMethod): the requester's
 * browser details, the session key K_b, and who was identified.
 * Finally a WRONG number on a second request must decline it.
 *
 *   node run.mjs --portal <https://vtc> --persona <did> --entry <vault entry id>
 *                --pnm <pnm binary> --pnm-home <dir> --vta <pnm slug>
 *
 * The VTA is driven through pnm (`vault sign-trust-task`), whose DID must be an
 * enrolled device on the VTA (`pnm device register`).
 */
import { execFileSync } from 'node:child_process'
import canonicalize from 'canonicalize'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OOB, envelope, postTask, resolveWebvh, serviceOfType, verifyProof, generateDidKeyHolder, signDocument } from '../ref-22-oob-claim/oob.mjs'

const arg = (name, dflt) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : dflt)
const portal = arg('portal')
const persona = arg('persona')
const entryId = arg('entry')
const pnm = arg('pnm')
const pnmHome = arg('pnm-home')
const vta = arg('vta')
if (!portal || !persona || !entryId || !pnm || !pnmHome || !vta) {
  console.error('usage: node run.mjs --portal <url> --persona <did> --entry <id> --pnm <bin> --pnm-home <dir> --vta <slug>')
  process.exit(2)
}
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  return ok
}
const errCode = (r) => r.doc?.payload?.code ?? `http${r.status}`
const origin = new URL(portal).origin
const work = mkdtempSync(join(tmpdir(), 'ref23-'))

/** Ask the member's VTA to sign `unsigned` as the entry's principal (vault/sign-trust-task via pnm). */
function vtaSign(unsigned) {
  const file = join(work, `sign-${Date.now()}.json`)
  writeFileSync(file, JSON.stringify({ entryId, unsignedEnvelope: unsigned }))
  const out = execFileSync(pnm, ['--vta', vta, '--transport', 'didcomm', 'vault', 'sign-trust-task', '--file', file], {
    env: { ...process.env, PNM_HOME: pnmHome },
    encoding: 'utf8',
    timeout: 90_000,
  }).replace(/\x1b\[[0-9;]*m/g, '')
  const json = JSON.parse(out.slice(out.indexOf('{')))
  return json.signedEnvelope ?? json.document ?? json.signed ?? json
}

/** One sign-in up to the claim: returns what the next steps need. */
async function claimed() {
  const config = await (await fetch(`${portal}/v1/member/sign-in/config`)).json()
  const kb = generateDidKeyHolder()
  const req = signDocument(envelope(OOB.request, { purpose: 'login', mode: 'scan' }, kb.did, config.vtcDid), kb, { proofPurpose: 'authentication' })
  const requestId = (await postTask(`${portal}/v1`, req, { origin })).doc?.payload?.requestId
  const vtcDoc = await resolveWebvh(config.vtcDid)
  const base = serviceOfType(vtcDoc, 'TrustTaskHTTPS')
  const ka = generateDidKeyHolder()
  const claim = signDocument(envelope(OOB.claim, { requestId }, ka.did, config.vtcDid, { parentThreadId: requestId }), ka, { proofPurpose: 'authentication' })
  const claimRes = await postTask(base, claim)
  const redeem = signDocument(envelope(OOB.redeem, { requestId }, kb.did, config.vtcDid), kb, { proofPurpose: 'authentication' })
  const pending = await postTask(base, redeem, { origin })
  return { config, kb, ka, requestId, vtcDoc, base, claimRes, matchNumber: pending.doc?.payload?.details?.matchNumber }
}

// --- A real sign-in up to step 2 --------------------------------------------
const s = await claimed()
check('the request is claimed and the browser shows a number', s.claimRes.ok && /^\d{2}$/.test(s.matchNumber ?? ''), `number ${s.matchNumber}`)

const personaDoc = await resolveWebvh(persona)
const unsigned = envelope(OOB.identify, { requestId: s.requestId, approverKey: s.ka.did, enteredNumber: s.matchNumber }, persona, s.config.vtcDid)
let identify
try {
  identify = vtaSign(unsigned)
  check('the VTA signs identify as the persona', !!identify?.proof, identify?.proof?.verificationMethod)
} catch (e) {
  check('the VTA signs identify as the persona', false, String(e.stdout ?? e.message).replace(/\x1b\[[0-9;]*m/g, '').slice(-400))
}
if (identify?.proof) {
  const { proof, ...rest } = identify
  // Same document = same JSON value (JCS), not the same bytes: the VTA may re-serialise in another key order.
  const same = canonicalize(rest) === canonicalize(unsigned)
  const changed = Object.keys({ ...rest, ...unsigned }).filter((k) => canonicalize(rest[k]) !== canonicalize(unsigned[k]))
  check('the VTA returned the document it was given, plus a proof', same, same ? '' : `changed: ${changed.join(', ')}`)
  check('the proof is the persona\'s, for authentication', verifyProof(identify, personaDoc, 'authentication') === undefined, verifyProof(identify, personaDoc, 'authentication') ?? proof.proofPurpose)

  const prove = signDocument(envelope(OOB.prove, { identify }, s.ka.did, s.config.vtcDid, { parentThreadId: s.requestId }), s.ka, { proofPurpose: 'authentication' })
  const proveRes = await postTask(s.base, prove)
  check('the VTC accepts prove (member, proof, number)', proveRes.ok, proveRes.ok ? '' : `${errCode(proveRes)} ${proveRes.doc?.payload?.message ?? ''}`)
  const step2 = proveRes.doc ?? {}
  const p2 = step2.payload ?? {}
  check('step 2 is signed by the VTC for assertionMethod', proveRes.ok && verifyProof(step2, s.vtcDoc, 'assertionMethod') === undefined, verifyProof(step2, s.vtcDoc, 'assertionMethod') ?? '')
  check('step 2 names the browser session key and the identified persona', /^did:key:z6Mk/.test(p2.sessionKey ?? '') && p2.identifiedAs === persona, `sessionKey ${String(p2.sessionKey).slice(0, 20)}… identifiedAs ${String(p2.identifiedAs).split(':').pop()}`)
  check('step 2 describes the requester', !!p2.requester, JSON.stringify(p2.requester ?? {}))
  // Clean up: identified requests can still be cancelled.
  const cancel = signDocument(envelope(OOB.cancel, { requestId: s.requestId }, s.ka.did, s.config.vtcDid, { parentThreadId: s.requestId }), s.ka, { proofPurpose: 'authentication' })
  const cancelRes = await postTask(s.base, cancel)
  check('the wallet can still cancel after step 2', cancelRes.ok, cancelRes.ok ? '' : errCode(cancelRes))
}

// --- A wrong number declines the request -------------------------------------
const w = await claimed()
const wrong = String((Number(w.matchNumber) + 1) % 100).padStart(2, '0')
try {
  const badIdentify = vtaSign(envelope(OOB.identify, { requestId: w.requestId, approverKey: w.ka.did, enteredNumber: wrong }, persona, w.config.vtcDid))
  const badProve = await postTask(w.base, signDocument(envelope(OOB.prove, { identify: badIdentify }, w.ka.did, w.config.vtcDid, { parentThreadId: w.requestId }), w.ka, { proofPurpose: 'authentication' }))
  check('a wrong number is refused', !badProve.ok && /numberMismatch/.test(errCode(badProve)), errCode(badProve))
} catch (e) {
  check('a wrong number is refused', false, String(e.message).slice(-200))
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed against ${portal} (persona …${persona.split(':').pop()})`)
process.exit(failed ? 1 : 0)
