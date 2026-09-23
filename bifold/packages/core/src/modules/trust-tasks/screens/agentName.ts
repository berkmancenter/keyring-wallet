/**
 * What to call a person's agent on screen — one place, so every "Linked to …"
 * says the same thing and a better name plugs in once.
 *
 * In order: the name the agent's operator set (`vta_name`, read from the VTA's
 * config — the maintainers' answer to Q19; not read yet, so `name` is empty
 * today), then the label the enrolment offer gave it, then the host its DID is
 * served from, then plain words. Never the DID itself: a manual link stores the
 * DID as its label when the DID has no host, and that label is treated as
 * absent (#12).
 *
 * @module trust-tasks/screens/agentName
 */

import type { TFunction } from 'i18next'

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
  const label = agent?.label?.trim()
  if (label && !isDid(label)) return label
  const host = agent?.vtaDid ? agentHost(agent.vtaDid) : undefined
  return host ?? (t('VtaLink.YourAgentFallback') as string)
}

/** For a sentence that starts with the agent's name: "Your agent didn't answer." */
export function agentDisplayNameStart(agent: NamedAgent | undefined, t: TFunction): string {
  const name = agentDisplayName(agent, t)
  return name.charAt(0).toUpperCase() + name.slice(1)
}
