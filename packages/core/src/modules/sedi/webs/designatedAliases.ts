/**
 * Whether a demo State root designates a host: the phone side of the K1 State office's designated aliases
 * (keyring-wallet tools/sedi-state-office). The root issues an ACDC, in its own registry and anchored in its own KEL,
 * whose attributes list the did:webs DIDs it may be fetched at; designating a new host revokes the previous one. The
 * live one is published beside the root's KEL as `designated-aliases.json` = `{ said, proof, tel: { ripText, updateTexts } }`.
 *
 * Keyring's own variant of did:webs designated aliases, for the demo state: no conformance claim. The host a phone
 * is given (in a guardian's card message, for instance) is used only when the ROOT says so here.
 *
 * Fail closed: anything unreachable, unreadable, stale, revoked or not the root's is never 'designated'.
 *
 * @module sedi/webs/designatedAliases
 */
import { parseProof, stateOf, verifyAcdcV2, verifyTel } from '../guardian/chain'
import { digest, replayKel } from '../guardian/kel'

import { demoStateHostProblem } from './demoStateHost'
import { parseWebsDid } from './identifier'
import { getArtifact, resolveWebs, WEBS_LIMITS, type WebsFetch } from './resolve'

/** The State office's designated-aliases schema (its SAID; "Keyring demo designated aliases", version 0.1.0). */
export const DESIGNATED_ALIASES_SCHEMA = 'EHttrKD3K6Ic6ryJziTCsfScU_jNrtpvv1VsfD2iPFdO'
/** The file's name, beside the root's did.json and keri.cesr. */
export const DESIGNATED_ALIASES_FILE = 'designated-aliases.json'
/** The path every demo state AID is published under (stateRoots' did:webs, K0's and K1's alike). */
const DEMO_STATE_PATH = 'keyring-demo-state'

export type HostDesignation = 'designated' | 'notDesignated' | 'unreachable' | 'badFile'

/**
 * Why, in one word, for logs and tests: each refusal is its own reason, and only 'listed' is 'designated'.
 * - 'designated': listed;
 * - 'notDesignated': hostNotListed, revoked (the designation was withdrawn), notIssued, statusNotCurrent (a stale file:
 *   the root's KEL anchors a later registry event than the file shows), notPublished (404), badInput;
 * - 'unreachable': switchedOff, unreachable, timeout (nothing could be read, so nothing is decided);
 * - 'badFile': stateNotVerified (the root's own did:webs files at that host fail), tooLarge, redirect, notJson, shape,
 *   proof, acdc, saidMismatch, wrongIssuer, wrongSchema, tel, noIds, threw.
 */
export interface DesignationCheck {
  result: HostDesignation
  why: string
  detail?: string
}

const answer = (result: HostDesignation, why: string, detail?: string): DesignationCheck => ({
  result,
  why,
  ...(detail ? { detail } : {}),
})

const isStr = (v: unknown): v is string => typeof v === 'string'

/** The root's did:webs at `host`, as the State office publishes it (no path prefix). */
export function rootWebsAt(rootAid: string, host: string): string {
  return ['did:webs', host.replace(':', '%3A'), DEMO_STATE_PATH, rootAid].join(':')
}

/** {@link hostDesignatedByRoot}, saying why. Never throws. */
export async function checkDesignation(
  rootAid: string,
  host: string,
  fetchImpl: WebsFetch = (url, init) => fetch(url, init) as unknown as ReturnType<WebsFetch>
): Promise<DesignationCheck> {
  try {
    if (!/^[A-Za-z0-9_-]{44,}$/.test(rootAid ?? '') || demoStateHostProblem(host ?? '') !== null)
      return answer('notDesignated', 'badInput')
    const did = rootWebsAt(rootAid, host.toLowerCase())
    const id = parseWebsDid(did)
    if (!id.ok) return answer('notDesignated', 'badInput', id.detail)

    // The root's LIVE key history at that host, verified (keri.cesr replayed, did.json against it).
    const root = await resolveWebs(did, { fetch: fetchImpl })
    if (!root.ok) {
      if (root.reason === 'switchedOff') return answer('unreachable', 'switchedOff')
      if (root.reason === 'unreachable' || root.reason === 'timeout')
        return answer('unreachable', root.reason, root.detail)
      return answer('badFile', 'stateNotVerified', `${root.reason}: ${root.detail}`)
    }
    const kel = replayKel(digest, root.kel)
    if (!kel.ok) return answer('badFile', 'stateNotVerified', kel.reason)

    const got = await getArtifact(
      fetchImpl,
      id.value,
      DESIGNATED_ALIASES_FILE,
      WEBS_LIMITS.didJsonBytes,
      WEBS_LIMITS.timeoutMs
    )
    if (!got.ok) {
      if (got.status === 404) return answer('notDesignated', 'notPublished')
      if (got.reason === 'unreachable' || got.reason === 'timeout') return answer('unreachable', got.reason, got.detail)
      return answer('badFile', got.reason === 'tooLarge' ? 'tooLarge' : 'redirect', got.detail)
    }

    let file: { said?: unknown; proof?: unknown; tel?: { ripText?: unknown; updateTexts?: unknown } }
    try {
      file = JSON.parse(new TextDecoder().decode(got.bytes))
    } catch {
      return answer('badFile', 'notJson')
    }
    const tel = file?.tel
    if (
      !file ||
      !isStr(file.said) ||
      !isStr(file.proof) ||
      !tel ||
      !isStr(tel.ripText) ||
      !Array.isArray(tel.updateTexts) ||
      !tel.updateTexts.every(isStr)
    )
      return answer('badFile', 'shape')

    const proof = parseProof(file.proof)
    if (!proof.ok) return answer('badFile', 'proof', proof.detail)
    const acdc = verifyAcdcV2(digest, proof.acdcText)
    if (!acdc.ok) return answer('badFile', 'acdc', acdc.detail)
    if (acdc.sad.d !== file.said) return answer('badFile', 'saidMismatch')
    if (acdc.sad.i !== rootAid) return answer('badFile', 'wrongIssuer', `issued by ${acdc.sad.i}`)
    if (acdc.sad.s !== DESIGNATED_ALIASES_SCHEMA) return answer('badFile', 'wrongSchema', `schema ${acdc.sad.s}`)

    // Its registry, every event sealed in the root's live KEL; then the state the file discloses, which must be the
    // newest the KEL anchors (a stale file is refused, not believed).
    const registry = verifyTel(digest, {
      ripText: tel.ripText,
      updateTexts: tel.updateTexts as string[],
      issuerKel: kel,
    })
    if (!registry.ok)
      return registry.reason === 'statusNotCurrent'
        ? answer('notDesignated', 'statusNotCurrent', registry.detail)
        : answer('badFile', 'tel', `${registry.reason}: ${registry.detail}`)
    const state = stateOf(digest, registry, [proof.blinder], acdc.sad)
    if (!state.ok)
      return state.reason === 'statusNotCurrent'
        ? answer('notDesignated', 'statusNotCurrent', state.detail)
        : answer('badFile', 'tel', `${state.reason}: ${state.detail}`)
    // Only 'issued' designates: one allowlist guard, so no other state word can slip through a second check.
    if (state.state !== 'issued')
      return answer(
        'notDesignated',
        state.state === 'revoked' ? 'revoked' : 'notIssued',
        `${state.state} at ${state.at}`
      )

    const ids = (acdc.sad.a as { ids?: unknown } | undefined)?.ids
    if (!Array.isArray(ids) || !ids.every(isStr)) return answer('badFile', 'noIds')
    return ids.includes(did) ? answer('designated', 'listed') : answer('notDesignated', 'hostNotListed')
  } catch (e) {
    return answer('badFile', 'threw', (e as Error)?.message ?? String(e))
  }
}

/**
 * Whether the demo State root `rootAid` designates `host`: its designated-aliases ACDC at that host verifies against
 * its live KEL there, is issued by the root with the State office's schema, is issued and current, and lists the
 * root's did:webs at that host. Behind the state-verified approvers switch (off: 'unreachable', nothing fetched).
 * Only 'designated' allows the host; every other answer withholds it. Never throws.
 */
export async function hostDesignatedByRoot(
  rootAid: string,
  host: string,
  fetchImpl?: WebsFetch
): Promise<HostDesignation> {
  return (await checkDesignation(rootAid, host, fetchImpl)).result
}
