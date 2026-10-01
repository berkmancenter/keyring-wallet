/**
 * "Scan" on Create my agent's address step (228: a maintainer looked for the
 * scanner there and found only Paste): the scanner is opened for an agent's
 * address, and what it reads comes back to that screen instead of being
 * routed as a link — a bare agent address routed as a link starts the
 * "add this phone" link, not the owner's setup.
 *
 * An agent host's page shows either the agent's address as a QR, or its
 * automatic-connection QR (`{ vta_did, callback_url }`); both are taken. One
 * request at a time; the screen that asked cancels it when it goes away.
 *
 * @module trust-tasks/module/agentAddressScan
 */

import { AgentHostConnectionError, parseAgentHostQr, type AgentHostOffer } from './agentHostConnection'

export type ScannedAgent = { kind: 'address'; vtaDid: string } | { kind: 'host'; offer: AgentHostOffer }

const AGENT_ADDRESS = /^did:webvh:[^\s]+:[^\s]+$/

let waiting: ((scanned: ScannedAgent) => void) | undefined

export const agentAddressScan = {
  /** The next agent address or host QR the scanner reads goes to `deliver`. */
  request(deliver: (scanned: ScannedAgent) => void): void {
    waiting = deliver
  },
  cancel(): void {
    waiting = undefined
  },
  pending(): boolean {
    return waiting !== undefined
  },
  /**
   * For the scanner: undefined when nobody is waiting (scan as usual);
   * `taken: true` when it went to the screen that asked (go back to it);
   * `taken: false` with why, when it is neither (say so, keep scanning).
   */
  claim(value: string): { taken: true } | { taken: false; why: 'notAnAgent' | 'hostNotAllowed' } | undefined {
    if (!waiting) return undefined
    const text = value.trim()
    let scanned: ScannedAgent | undefined
    if (AGENT_ADDRESS.test(text)) {
      scanned = { kind: 'address', vtaDid: text }
    } else {
      try {
        const offer = parseAgentHostQr(text)
        if (offer) scanned = { kind: 'host', offer }
      } catch (error) {
        if (error instanceof AgentHostConnectionError && error.reason === 'hostNotAllowed') {
          return { taken: false, why: 'hostNotAllowed' }
        }
      }
    }
    if (!scanned) return { taken: false, why: 'notAnAgent' }
    const deliver = waiting
    waiting = undefined
    deliver(scanned)
    return { taken: true }
  },
}
