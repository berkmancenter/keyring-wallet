/**
 * The one way the HCP demo reaches the person's own VTA (step 7.27 track C, part 1): Keyring sends `hcp/*`
 * management tasks as its Management Client, signed by its manager identity as every Keyring task is, without
 * `accessToken`. Built like `vtaPorts` in `../services.ts`.
 *
 * Nothing here logs a payload or a response.
 *
 * @module connected-agents/hcp/vtaPort
 */
import type { Agent } from '@credo-ts/core'

import type { VtaSession } from '../services'
import { isHcpEnabled } from './hcpFlag'

/** How long one HCP task may take, in milliseconds. */
export const HCP_TASK_TIMEOUT_MS = 30000

export interface HcpVtaPort {
  task(type: string, payload: Record<string, unknown>): Promise<unknown>
}

/**
 * The port for the VTA this phone administers. `waitForConsent: false`: a task the phone sends must never wait on an
 * approval the same phone would give. With the HCP flags off it sends nothing and rejects.
 */
export function hcpVtaPort(agent: Agent, vtaDid: string, session: Pick<VtaSession, 'withAgentSession'>): HcpVtaPort {
  return {
    task: async (type, payload) => {
      if (!isHcpEnabled()) throw new Error('HCP is off')
      return session.withAgentSession(agent, vtaDid, (client) =>
        client.task(type, payload, HCP_TASK_TIMEOUT_MS, {}, undefined, { waitForConsent: false })
      )
    },
  }
}

export type HcpCallOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; refused: string }
  | { ok: false; unreachable: true }

/**
 * One HCP task, its outcome as a value: a VTA refusal (`name === 'VtiRefusal'`) gives `refused` with its `code`
 * (`'unknown'` if it carries none); anything else thrown gives `unreachable`. The value is not checked here: each
 * caller reads the response it expects.
 */
export async function callHcp<T>(
  port: HcpVtaPort,
  type: string,
  payload: Record<string, unknown>
): Promise<HcpCallOutcome<T>> {
  try {
    return { ok: true, value: (await port.task(type, payload)) as T }
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'VtiRefusal') {
      const code = (error as { code?: unknown }).code
      return { ok: false, refused: typeof code === 'string' && code !== '' ? code : 'unknown' }
    }
    return { ok: false, unreachable: true }
  }
}
