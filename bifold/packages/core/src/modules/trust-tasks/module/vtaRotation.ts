/**
 * Rotating a persona's keys after a lost phone (#10, plan part D).
 *
 * A phone that held copies of a persona's keys keeps them after its access is
 * removed; only rotating the keys on the agent cancels them. The agent's
 * `vta/webvh/dids/rotate-keys/1.0` replaces every verification method's key.
 * From VTI 83492acf (#1734) it keeps each method's id and puts the new key
 * under the same key record; before that it renumbered the methods, which
 * breaks every relationship that names them. That fix first shipped in
 * vta-service 0.43.0; 0.42.0 spans it, so an agent reporting 0.42.x cannot be
 * told apart and rotation is not offered as safe.
 *
 * @module trust-tasks/module/vtaRotation
 */
import type { Agent } from '@credo-ts/core'

import type { VtiPersona } from './VtiIdentityStore'

export const ROTATE_KEYS_TASK = 'https://trusttasks.org/spec/vta/webvh/dids/rotate-keys/1.0'

export type RotationSupport = 'yes' | 'unknown' | 'agentTooOld'

/** Whether an agent at `version` rotates keys in place: from vta-service 0.43.0. */
export function rotationSupport(version: string | undefined): RotationSupport {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '')
  if (!m) return 'unknown'
  const [major, minor] = [Number(m[1]), Number(m[2])]
  if (major > 0 || minor >= 43) return 'yes'
  if (minor === 42) return 'unknown'
  return 'agentTooOld'
}

/**
 * The agent's version, from its own REST description (`VTARest` in its DID
 * document, then `/openapi.json`'s `info.version`). Undefined when the agent
 * does not say — never guessed.
 */
export async function agentVersion(
  agent: Agent,
  vtaDid: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | undefined> {
  try {
    const doc = await agent.dids.resolveDidDocument(vtaDid)
    const service = (doc.service ?? []).find((s) => s.type === 'VTARest')
    const base = typeof service?.serviceEndpoint === 'string' ? service.serviceEndpoint : undefined
    if (!base) return undefined
    const response = await fetchImpl(`${base.replace(/\/+$/, '')}/openapi.json`, { method: 'GET' })
    if (!response.ok) return undefined
    const body = (await response.json()) as { info?: { version?: unknown } }
    return typeof body?.info?.version === 'string' ? body.info.version : undefined
  } catch {
    return undefined
  }
}

/** What rotation needs from the agent client. A VtaClient satisfies it. */
export interface RotationPort {
  task<T = unknown>(type: string, payload: Record<string, unknown>): Promise<T>
  borrowKey(vtaKeyId: string): Promise<{ keyId: string; curve: 'Ed25519' | 'X25519' }>
}

/**
 * Rotate `persona`'s keys on the agent, then take fresh copies under the same
 * key ids for this phone and save them on the persona. Until signing moves to
 * the agent this phone still signs and decrypts with copies, and the old ones
 * stop working the moment the agent rotates. A refusal leaves the persona as
 * it was.
 */
export async function rotatePersonaKeys(
  port: RotationPort,
  store: { setPersona(persona: VtiPersona): Promise<void> },
  persona: VtiPersona
): Promise<VtiPersona> {
  await port.task(ROTATE_KEYS_TASK, { did: persona.did, label: 'Keys rotated from Keyring after a lost phone' })
  const [keyAgreement, signing] = await Promise.all([
    port.borrowKey(persona.vtaKeyIds.keyAgreement),
    port.borrowKey(persona.vtaKeyIds.signing),
  ])
  const rotated: VtiPersona = {
    ...persona,
    kmsKeyIds: { keyAgreement: keyAgreement.keyId, signing: signing.keyId },
  }
  await store.setPersona(rotated)
  return rotated
}

/**
 * Rotate each of `personas` in turn — one at a time, so the agent never has
 * two updates in flight — carrying on past a refusal so one identity the agent
 * will not rotate does not strand the rest. Answers which were rotated and
 * which failed, with the error for each.
 */
export async function rotateEachPersona(
  port: RotationPort,
  store: { setPersona(persona: VtiPersona): Promise<void> },
  personas: VtiPersona[]
): Promise<{ rotated: string[]; failed: { did: string; error: unknown }[] }> {
  const rotated: string[] = []
  const failed: { did: string; error: unknown }[] = []
  for (const persona of personas) {
    try {
      await rotatePersonaKeys(port, store, persona)
      rotated.push(persona.did)
    } catch (error) {
      failed.push({ did: persona.did, error })
    }
  }
  return { rotated, failed }
}
