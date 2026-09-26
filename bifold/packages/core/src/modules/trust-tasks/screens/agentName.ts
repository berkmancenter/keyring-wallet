/**
 * What to call a person's agent on screen — one place, so every "Linked to …"
 * says the same thing and a better name plugs in once.
 *
 * In order: the name the agent gives itself (its verified agent name, else the
 * operator's `vta_name` — the maintainers' answer to Q19), read once a session
 * opens and merged in by `withAgentName`; then the label the enrolment offer
 * gave it; then plain words ("your agent"). Never the DID itself, and never
 * the host its DID is served from: that is the agent host's own domain, a
 * provider named where a person expects their agent's name (225 gate). A
 * manual link or a claim stores the DID as its label, and a label that is
 * only the host (stored before 226) is treated as absent too (#12).
 *
 * @module trust-tasks/screens/agentName
 */

import type { TFunction } from 'i18next'

import type { AgentLabel } from '../module/agentLabel'

import { agentHost } from './VtaLink'

export interface NamedAgent {
  vtaDid?: string
  /** The enrolment offer's label, or what a manual link stored. */
  label?: string
  /** The operator-set name (`vta_name`), once read. */
  name?: string
}

const isDid = (text: string) => /^did:[a-z0-9]+:/i.test(text)

export function agentDisplayName(agent: NamedAgent | undefined, t: TFunction): string {
  const name = agent?.name?.trim()
  if (name) return name
  // A label that is only the host (what a link stored before 226) is the
  // agent host's own domain, not the agent's name: said as "your agent".
  const host = agent?.vtaDid ? agentHost(agent.vtaDid) : undefined
  const label = agent?.label?.trim()
  if (label && !isDid(label) && label !== host) return label
  return t('VtaLink.YourAgentFallback') as string
}

/** For a sentence that starts with the agent's name: "Your agent didn't answer." */
export function agentDisplayNameStart(agent: NamedAgent | undefined, t: TFunction): string {
  const name = agentDisplayName(agent, t)
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** The agent as a screen names it: with the name it gave, once `vtaAgent` has read it. */
export function withAgentName<T extends object>(agent: T, names: Readonly<Record<string, AgentLabel>> | undefined): T {
  const vtaDid = (agent as NamedAgent).vtaDid
  const name = vtaDid ? names?.[vtaDid]?.label : undefined
  return name ? { ...agent, name } : agent
}
