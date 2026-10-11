/**
 * ref-24: the member's VTA signs the GRANT of a trigger-link sign-in, on the
 * device's user verification, and the browser redeems a session with it.
 *
 * Builds on ref-23 (identify/prove). One enrolled device (the rung client,
 * talking to the VTA over REST with a bearer) signs both identify and grant:
 *
 *  1. REST pre-session auth (auth/challenge → auth/authenticate/0.2 → bearer),
 *     then device/register/0.2 (or device/heartbeat/0.2 on a re-run) with
 *     ext["org.openvtc.uv-key"] = a hardwareKey enrolment of the UV key.
 *  2. A sign-in up to step 2, as ref-23, with identify signed by that session.
 *  3. The unsigned auth/oob/grant/0.1 (contextDigest over the signed step 2),
 *     and a task-consent/decision/0.2 by the UV key over its digest, sent to
 *     vault/sign-trust-task/0.2 under ext["org.openvtc.uv-consent"].
 *  4. The VTA returns the grant unchanged plus the persona's proof.
 *  5. auth/oob/respond/0.1 {grant}, signed by K_a → status approved.
 *  6. The browser (K_b) redeems → the session description.
 *  7. Negatives: a grant without the UV decision (oobUvRequired); the same
 *     grant id signed twice (oobGrantReplayed).
 *
 *   node run.mjs --portal <https://vtc> --vta-did <did> --persona <did> --entry <vault entry id>
 *                --client <client.json> --uv-key <uv-key.json>
 *
 * client.json / uv-key.json: { did, secretKeyHex, verificationMethod } (Ed25519).
 * The UV key here is SOFTWARE: in production it is a biometric-gated hardware key.
 */
import { readFileSync } from 'node:fs'
import { sha256 } from '@noble/hashes/sha2.js'
import canonicalize from 'canonicalize'
import { OOB, envelope, postTask, resolveWebvh, serviceOfType, verifyProof, generateDidKeyHolder, signDocument, base58encode, didKeyDocument } from '../ref-22-oob-claim/oob.mjs'

const arg = (name, dflt) => (process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : dflt)
const portal = arg('portal')
const vtaDid = arg('vta-did')
const persona = arg('persona')
const entryId = arg('entry')
const clientFile = arg('client')
const uvFile = arg('uv-key')
if (!portal || !vtaDid || !persona || !entryId || !clientFile || !uvFile) {
  console.error('usage: node run.mjs --portal <url> --vta-did <did> --persona <did> --entry <id> --client <client.json> --uv-key <uv-key.json>')
  process.exit(2)
}
const TT = 'https://trusttasks.org/spec/'
const T = {
  challenge: `${TT}auth/challenge/0.1`,
  authenticate: `${TT}auth/authenticate/0.2`,
  register: `${TT}device/register/0.2`,
  heartbeat: `${TT}device/heartbeat/0.2`,
  signTT: `${TT}vault/sign-trust-task/0.2`,
  decision: `${TT}task-consent/decision/0.2`,
}
const EXT_UV_KEY = 'org.openvtc.uv-key'
const EXT_UV_CONSENT = 'org.openvtc.uv-consent'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  return ok
}
const errCode = (r) => r.doc?.payload?.code ?? `http${r.status}`
/** The local refusal code inside a trust-task-error, e.g. vault/sign-trust-task:oobUvRequired. */
const innerCode = (r) => (JSON.stringify(r.doc ?? {}).match(/[a-z\-/]+:oob[A-Za-z]+/) ?? [errCode(r)])[0]
const errText = (r) => `${errCode(r)} ${r.doc?.payload?.message ?? ''}`.trim()
const origin = new URL(portal).origin

// Keys are rebuilt from their secrets; only DIDs are ever printed.
const loadHolder = (file) => generateDidKeyHolder(JSON.parse(readFileSync(file, 'utf8')).secretKeyHex)
const client = loadHolder(clientFile)
const uvKey = loadHolder(uvFile)

/** sha2-256 multihash of JCS(value), base58btc multibase — DigestMultibase. */
function digestMultibase(value) {
  const h = sha256(new TextEncoder().encode(canonicalize(value)))
  return 'z' + base58encode(new Uint8Array([0x12, 0x20, ...h]))
}

// --- The VTA over REST -------------------------------------------------------
const vtaDoc = await resolveWebvh(vtaDid)
const vtaRest = serviceOfType(vtaDoc, 'VTARest')
if (!vtaRest) throw new Error('the VTA DID document lists no VTARest service')

async function vtaPost(doc, token) {
  const res = await fetch(vtaRest.replace(/\/+$/, '') + '/trust-tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(doc),
    signal: AbortSignal.timeout(40_000),
  })
  const body = await res.json().catch(() => null)
  const isError = !res.ok || String(body?.type ?? '').includes('/trust-task-error/')
  return { ok: !isError, status: res.status, doc: body }
}
/** A document from the rung client to the VTA, signed for authentication. */
const asClient = (type, payload) => signDocument(envelope(type, payload, client.did, vtaDid), client, { proofPurpose: 'authentication' })

// 1a. Pre-session auth → bearer.
const ch = await vtaPost(envelope(T.challenge, { subject: client.did }, client.did, vtaDid))
const auth = ch.ok
  ? await vtaPost(asClient(T.authenticate, { sessionId: ch.doc.payload.sessionId, challenge: ch.doc.payload.challenge }))
  : ch
const token = auth.doc?.payload?.tokens?.accessToken ?? auth.doc?.payload?.tokens?.access_token
if (!check('REST pre-session auth gives the rung client a bearer', auth.ok && !!token, auth.ok ? `bearer for ${client.did.slice(0, 20)}… (token redacted)` : errText(auth))) {
  console.log(JSON.stringify(auth.doc).slice(0, 400))
  process.exit(1)
}

// 1b. Enrol the UV key: register, or heartbeat when already registered.
const enrolment = { kind: 'hardwareKey', did: uvKey.did, hardwareBacked: true, biometricGated: true }
let enrol = await vtaPost(asClient(T.register, {
  consumerKind: { kind: 'companion', formFactor: 'mobile' },
  displayName: 'ref-24 rung client',
  ext: { [EXT_UV_KEY]: enrolment },
}), token)
let how = 'register'
if (!enrol.ok && /alreadyRegistered/.test(JSON.stringify(enrol.doc))) {
  enrol = await vtaPost(asClient(T.heartbeat, { ext: { [EXT_UV_KEY]: enrolment } }), token)
  how = 'heartbeat (already registered)'
}
check('the client is an enrolled device with the UV key', enrol.ok, enrol.ok ? `${how}, uv ${uvKey.did.slice(0, 20)}…` : errText(enrol))

/** vault/sign-trust-task/0.2 over REST as the rung client; `decision` rides in ext. */
async function vaultSign(unsigned, decision) {
  const payload = { entryId, unsignedEnvelope: unsigned }
  if (decision) payload.ext = { [EXT_UV_CONSENT]: { decision } }
  const r = await vtaPost(asClient(T.signTT, payload), token)
  return { ...r, signed: r.doc?.payload?.signedEnvelope }
}

/** The UV key's task-consent/decision/0.2 approving exactly `unsignedGrant`. */
function uvDecision(unsignedGrant) {
  const d = digestMultibase(unsignedGrant)
  return signDocument(envelope(T.decision, { challenge: d, payloadDigest: d, decision: 'approve' }, uvKey.did, vtaDid), uvKey, { proofPurpose: 'assertionMethod' })
}

// --- 2. A sign-in up to step 2 (ref-23), identify signed by this session ------
const config = await (await fetch(`${portal}/v1/member/sign-in/config`)).json()
const vtcDoc = await resolveWebvh(config.vtcDid)
const base = serviceOfType(vtcDoc, 'TrustTaskHTTPS')
const kb = generateDidKeyHolder()
const req = await postTask(`${portal}/v1`, signDocument(envelope(OOB.request, { purpose: 'login', mode: 'scan' }, kb.did, config.vtcDid), kb, { proofPurpose: 'authentication' }), { origin })
const requestId = req.doc?.payload?.requestId
if (!req.ok) {
  check('the browser opens a request', false, `${errText(req)}${req.status === 429 ? ' — rate limited, wait ~130 s' : ''}`)
  process.exit(1)
}
const ka = generateDidKeyHolder()
const claimRes = await postTask(base, signDocument(envelope(OOB.claim, { requestId }, ka.did, config.vtcDid, { parentThreadId: requestId }), ka, { proofPurpose: 'authentication' }))
const redeemDoc = () => signDocument(envelope(OOB.redeem, { requestId }, kb.did, config.vtcDid), kb, { proofPurpose: 'authentication' })
const pending = await postTask(base, redeemDoc(), { origin })
const matchNumber = pending.doc?.payload?.details?.matchNumber
check('the request is claimed and the browser shows a number', claimRes.ok && /^\d{2}$/.test(matchNumber ?? ''), matchNumber ? `number ${matchNumber}` : `claim ${claimRes.ok ? 'ok' : errText(claimRes)}; redeem ${pending.status} ${errCode(pending)}`)
if (!matchNumber) process.exit(1)

const personaDoc = await resolveWebvh(persona)
const unsignedIdentify = envelope(OOB.identify, { requestId, approverKey: ka.did, enteredNumber: matchNumber }, persona, config.vtcDid)
const idRes = await vaultSign(unsignedIdentify)
const identify = idRes.signed
check('the VTA signs identify for this device (REST session), for authentication', !!identify?.proof && verifyProof(identify, personaDoc, 'authentication') === undefined, identify ? (verifyProof(identify, personaDoc, 'authentication') ?? identify.proof.proofPurpose) : errText(idRes))
if (!identify) process.exit(1)

const proveRes = await postTask(base, signDocument(envelope(OOB.prove, { identify }, ka.did, config.vtcDid, { parentThreadId: requestId }), ka, { proofPurpose: 'authentication' }))
const step2 = proveRes.doc ?? {}
const p2 = step2.payload ?? {}
check('the VTC answers step 2, signed for assertionMethod', proveRes.ok && verifyProof(step2, vtcDoc, 'assertionMethod') === undefined, proveRes.ok ? (verifyProof(step2, vtcDoc, 'assertionMethod') ?? `identifiedAs …${String(p2.identifiedAs).split(':').pop()}`) : errText(proveRes))
if (!proveRes.ok) process.exit(1)

// --- 3. The grant and its UV decision ------------------------------------------
const unsignedGrant = envelope(OOB.grant, {
  requestId,
  decision: 'approve',
  sessionKey: p2.sessionKey,
  approverKey: ka.did,
  origin: p2.origin,
  // The whole signed step 2 as received, proof included (grant spec producer rule 1).
  contextDigest: digestMultibase(step2),
  notAfter: Math.floor(Date.now() / 1000) + 3600,
}, persona, config.vtcDid)

// 7a. Without the UV decision the VTA refuses (and the id is not burned).
const noUv = await vaultSign(unsignedGrant)
check('a grant without the UV decision is refused', !noUv.ok && !noUv.signed && /oobUvRequired/.test(JSON.stringify(noUv.doc)), `${errCode(noUv)} / ${innerCode(noUv)}`)

const gRes = await vaultSign(unsignedGrant, uvDecision(unsignedGrant))
const grant = gRes.signed
check('the VTA signs the grant on the UV decision', !!grant?.proof, grant ? grant.proof.verificationMethod : errText(gRes))
if (!grant) process.exit(1)

// --- 4. Unchanged, plus the persona's assertionMethod proof --------------------
const { proof: grantProof, ...grantRest } = grant
const same = canonicalize(grantRest) === canonicalize(unsignedGrant)
const changed = Object.keys({ ...grantRest, ...unsignedGrant }).filter((k) => canonicalize(grantRest[k]) !== canonicalize(unsignedGrant[k]))
check('the VTA returned the grant it was given (JCS-equal), plus a proof', same, same ? '' : `changed: ${changed.join(', ')}`)
const amWhy = verifyProof(grant, personaDoc, 'assertionMethod')
check('the grant proof is the persona\'s, for assertionMethod', amWhy === undefined, `proofPurpose ${grantProof.proofPurpose}, vm ${grantProof.verificationMethod.split(':').pop()}${amWhy ? ` — ${amWhy}` : ''}`)

// 7b. The same grant id is never signed twice, even on a fresh valid decision.
const again = await vaultSign(unsignedGrant, uvDecision(unsignedGrant))
check('the same grant id is not signed twice', !again.ok && !again.signed && /oobGrantReplayed/.test(JSON.stringify(again.doc)), `${errCode(again)} / ${innerCode(again)}`)

// --- 5. respond ----------------------------------------------------------------
const respondRes = await postTask(base, signDocument(envelope(OOB.respond, { grant }, ka.did, config.vtcDid, { parentThreadId: requestId }), ka, { proofPurpose: 'authentication' }))
check('the VTC records the grant: status approved', respondRes.ok && respondRes.doc?.payload?.status === 'approved', respondRes.ok ? `status ${respondRes.doc?.payload?.status}` : errText(respondRes))
const rWhy = respondRes.doc?.proof ? verifyProof(respondRes.doc, vtcDoc, 'authentication') : 'no proof'
check('the respond answer is signed by the VTC for authentication', rWhy === undefined, rWhy ?? `vm ${respondRes.doc.proof.verificationMethod.split('#').pop()}`)

// --- 6. redeem, as the browser --------------------------------------------------
const rd = await fetch(base.replace(/\/+$/, '') + '/trust-tasks', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin },
  body: JSON.stringify(redeemDoc()),
  signal: AbortSignal.timeout(40_000),
})
const rdDoc = await rd.json().catch(() => null)
const sess = rdDoc?.payload ?? {}
const cookieNames = (rd.headers.getSetCookie?.() ?? []).map((c) => c.split('=')[0])
const bodyHasTokens = /token/i.test(JSON.stringify(sess))
check('the browser redeems a session for the persona', rd.ok && sess.subject === persona && typeof sess.displayName === 'string' && Number.isInteger(sess.notAfter),
  rd.ok && sess.subject ? JSON.stringify({ subject: `…${String(sess.subject).split(':').pop()}`, displayName: sess.displayName, notAfter: sess.notAfter, amr: sess.amr })
    : `http${rd.status} ${sess.code ?? ''} ${sess.message ?? ''} ${sess.status ?? ''}`.trim())
check('the session amr includes uv', Array.isArray(sess.amr) && sess.amr.includes('uv'), JSON.stringify(sess.amr))
check('the session travels as cookies, not in the body', cookieNames.length > 0 && !bodyHasTokens, `cookies [${cookieNames.join(', ')}] (values redacted)`)
if (rdDoc?.proof) console.log(`      redeem answer proofPurpose ${rdDoc.proof.proofPurpose}`)

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed against ${portal} (persona …${persona.split(':').pop()}, device ${client.did.slice(0, 20)}…)`)
process.exit(failed ? 1 : 0)
