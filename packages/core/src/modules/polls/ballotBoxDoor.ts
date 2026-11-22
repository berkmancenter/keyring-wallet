/**
 * The ballot box's door on a real phone: found in its verified DID document, posted to with nothing but the cast.
 * The rules a cast and its receipt follow are in `ballotBox.ts`.
 *
 * @module polls/ballotBoxDoor
 */
import type { Agent } from '@credo-ts/core'
import { verifyTrustTaskProof } from '@bifold/trust-tasks'

import { TRUST_TASK_HTTPS } from '../trust-tasks/module/oobSignIn'
import { serviceEndpointOfType } from '../trust-tasks/module/triggerLink'
import { resolveDidDocumentRetrying } from '../trust-tasks/module/VtiMediatorTransport'

import type { BallotBoxDoor } from './ballotBox'

/** One cast's wait for the ballot box. */
const CAST_TIMEOUT_MS = 40_000

const isHttps = (url: string) => /^https:\/\/[^/]/i.test(url)

export function createBallotBoxDoor(agent: Agent): BallotBoxDoor {
  return {
    endpointOf: async (ballotBoxDid) => {
      const document = (await resolveDidDocumentRetrying(agent, ballotBoxDid)).toJSON() as Parameters<
        typeof serviceEndpointOfType
      >[0]
      const base = serviceEndpointOfType(document, TRUST_TASK_HTTPS)
      if (!base || !isHttps(base)) throw new Error(`the ballot box names no HTTPS ${TRUST_TASK_HTTPS} service`)
      return `${base.replace(/\/+$/, '')}/trust-tasks`
    },
    post: async (url, document) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), CAST_TIMEOUT_MS)
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(document),
          credentials: 'omit',
          signal: controller.signal,
        })
        let body: unknown
        try {
          body = await response.json()
        } catch {
          body = undefined
        }
        return { status: response.status, body }
      } finally {
        clearTimeout(timer)
      }
    },
    verify: async (document) => {
      const verdict = await verifyTrustTaskProof(agent, document)
      return verdict.ok ? verdict : { ok: false, detail: `${verdict.reason}: ${verdict.detail}` }
    },
  }
}
