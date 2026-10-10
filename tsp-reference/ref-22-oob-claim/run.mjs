/**
 * ref-22: claim a sign-in request on a live community, as a wallet would.
 *
 * Plays both sides of `auth/oob` up to the claim, against a real VTC:
 * - the BROWSER: a throwaway key K_b asks the VTC for a sign-in request and
 *   builds the trigger link, exactly as the member portal's bundle does;
 * - the WALLET: reads the link, resolves and verifies the VTC's did:webvh,
 *   takes the Trust Task endpoint from the DID document (never from the link),
 *   claims the request with a fresh key K_a, and verifies the VTC's signed
 *   answer: assertionMethod proof, thread, recipient, request, service,
 *   purpose, origin and deadline (trust-tasks-tf #738, claim/spec.md).
 * Then the browser sees the request claimed (redeem: pending, with the match
 * number), a second claimant is refused, and the wallet cancels.
 *
 *   node run.mjs [--portal https://test-vtc.openvtc.net]
 *
 * Exit 0 when every check passes.
 */
import { OOB, envelope, postTask, resolveWebvh, serviceOfType, verifyProof, generateDidKeyHolder, signDocument } from './oob.mjs'

const portal = process.argv.includes('--portal') ? process.argv[process.argv.indexOf('--portal') + 1] : 'https://test-vtc.openvtc.net'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  return ok
}
const errCode = (r) => r.doc?.payload?.code ?? `http${r.status}`

// --- The browser: ask for a sign-in request, build the link ------------------
const config = await (await fetch(`${portal}/v1/member/sign-in/config`)).json()
check('the portal publishes its sign-in config', !!(config.vtcDid && config.linkHost && config.flow), JSON.stringify(config))

const kb = generateDidKeyHolder()
const req = signDocument(envelope(OOB.request, { purpose: 'login', mode: 'scan' }, kb.did, config.vtcDid), kb, { proofPurpose: 'authentication' })
const reqRes = await postTask(`${portal}/v1`, req, { origin: new URL(portal).origin })
const requestId = reqRes.doc?.payload?.requestId
check('the browser (from the portal origin) gets a request id', reqRes.ok && /^[A-Za-z0-9_-]{22}$/.test(requestId ?? ''), reqRes.ok ? `claimDeadline ${reqRes.doc.payload.claimDeadline}` : errCode(reqRes))
const enc = (v) => v.replace(/[&=#%]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
const link = `https://${config.linkHost}/t#_from=${enc(config.vtcDid)}&_id=${requestId}&_exp=${reqRes.doc.payload.claimDeadline}&_type=${config.flow}`
check('the link fits a QR code (≤ 251 bytes, ASCII)', link.length <= 251 && /^[\x00-\x7f]*$/.test(link), `${link.length} bytes`)

// --- The wallet: read the link, resolve, claim --------------------------------
const fragment = new URLSearchParams(link.slice(link.indexOf('#') + 1))
const from = fragment.get('_from'), id = fragment.get('_id'), exp = Number(fragment.get('_exp')), type = fragment.get('_type')
check('the wallet reads the trigger', from === config.vtcDid && id === requestId && type === '/vti/flow/sign-in/0.1' && exp + 60 > Date.now() / 1000)

const vtcDoc = await resolveWebvh(from)
const base = serviceOfType(vtcDoc, 'TrustTaskHTTPS')
const portalService = serviceOfType(vtcDoc, 'SignInPortal')
check('the verified DID document names the Trust Task endpoint and the portal', !!base && !!portalService, `${base} · ${portalService}`)
const portalOrigin = new URL(portalService).origin

const ka = generateDidKeyHolder()
const claim = signDocument(envelope(OOB.claim, { requestId: id }, ka.did, from, { parentThreadId: id }), ka, { proofPurpose: 'authentication' })
const claimRes = await postTask(base, claim)
check('the VTC accepts the claim', claimRes.ok, claimRes.ok ? '' : errCode(claimRes))
const answer = claimRes.doc ?? {}
const p = answer.payload ?? {}
check('the answer is signed by the VTC for assertionMethod', verifyProof(answer, vtcDoc, 'assertionMethod') === undefined, verifyProof(answer, vtcDoc, 'assertionMethod') ?? answer.proof?.verificationMethod)
check('the answer threads to the claim and is addressed to K_a', answer.threadId === claim.id && answer.recipient === ka.did, `threadId ${answer.threadId}`)
check('the answer names this request, this community, purpose login', p.requestId === id && p.service?.did === from && p.purpose === 'login', `service.name "${p.service?.name}"`)
check("the answer's origin is the portal's", p.origin === portalOrigin, `${p.origin} vs ${portalOrigin}`)
check('the decision deadline is in the future', Number.isInteger(p.decisionDeadline) && p.decisionDeadline > Date.now() / 1000, `${p.decisionDeadline - Math.floor(Date.now() / 1000)} s left`)

// --- What the browser sees, and what a second claimant gets ------------------
const redeem = signDocument(envelope(OOB.redeem, { requestId: id }, kb.did, from), kb, { proofPurpose: 'authentication' })
const redeemRes = await postTask(base, redeem, { timeoutMs: 40_000, origin: new URL(portal).origin })
const matchNumber = redeemRes.doc?.payload?.details?.matchNumber
check('the browser sees the request claimed, with a two-digit match number', !redeemRes.ok && /pending/.test(errCode(redeemRes)) && /^\d{2}$/.test(matchNumber ?? ''), `${errCode(redeemRes)} ${matchNumber ?? ''}`)

const other = generateDidKeyHolder()
const second = signDocument(envelope(OOB.claim, { requestId: id }, other.did, from, { parentThreadId: id }), other, { proofPurpose: 'authentication' })
const secondRes = await postTask(base, second)
check('a second claimant is refused', !secondRes.ok && /alreadyClaimed/.test(errCode(secondRes)), errCode(secondRes))

// --- Clean up: the wallet cancels -------------------------------------------
const cancel = signDocument(envelope(OOB.cancel, { requestId: id }, ka.did, from, { parentThreadId: id }), ka, { proofPurpose: 'authentication' })
const cancelRes = await postTask(base, cancel)
check('the wallet can cancel', cancelRes.ok && cancelRes.doc?.payload?.status === 'cancelled', cancelRes.ok ? '' : errCode(cancelRes))
const cancelPurpose = cancelRes.doc?.proof?.proofPurpose
check('the cancel answer verifies (its purpose recorded)', [verifyProof(cancelRes.doc, vtcDoc, 'authentication'), verifyProof(cancelRes.doc, vtcDoc, 'assertionMethod')].includes(undefined), `proofPurpose ${cancelPurpose}`)

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed against ${portal} (VTC ${from.split(':').slice(-2).join(':')}, log ${vtcDoc.id ? 'verified' : '?'})`)
process.exit(failed ? 1 : 0)
