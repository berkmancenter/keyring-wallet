/**
 * Whether a card a community delivered holds up, checked before it is kept.
 *
 * openvtc checks every issued credential on receipt since #380
 * (openvtc-core/src/issued_credential.rs `verify_issued_credential`): every
 * proof verifies under the issuer's `assertionMethod`, it is inside its
 * validity window, and its status list, when it names one, is read and does
 * not say it was withdrawn. That the issuer is the community that sent it is
 * `credentialRefusal`'s check, run first.
 *
 * Keyring kept a delivered membership, role or vetter grant on the strength of
 * the authenticated sender alone. The sender says who delivered the card, not
 * that the card is the community's own, current and not withdrawn.
 *
 * A status list that cannot be read now is not a verdict on the card: it
 * throws, so the delivery is left on the mediator and comes again (the inbox
 * withholds the acknowledgement when a handler fails). Refusing it instead
 * would drop a membership for good over a network hiccup.
 *
 * @module trust-tasks/module/vtiDeliveredCheck
 */
import type { Agent } from '@credo-ts/core'
import { verifyDocumentProof } from '@bifold/trust-tasks'

import { checkCredentialStatus, statusEntryOf, statusListHost } from './vtiStatusList'

/** Why a delivered card was not kept, after its sender was accepted. */
export type VtiCardCheckRefusal = 'proof' | 'notYetValid' | 'expired' | 'revoked'

/** Checks one delivered card; `undefined` when it may be kept. */
export type VtiDeliveredCardCheck = (
  credential: Record<string, unknown>,
  issuer: string
) => Promise<VtiCardCheckRefusal | undefined>

/** Its status list could not be read now; the delivery should come again. */
export class VtiCardStatusUnreadable extends Error {
  /** The status list's host, when its URL named one (never the path, which can carry ids). */
  readonly host?: string
  constructor(reason: string, host?: string) {
    super(
      `vtiDeliveredCheck: the card's status list could not be read${host ? ` at ${host}` : ''} (${reason}); left for redelivery`
    )
    this.name = 'VtiCardStatusUnreadable'
    this.host = host
  }
}

/**
 * What one delivered card's check came to, for the log: kept after its status
 * list was read (`ok`), kept with no status list to read (`none`), refused
 * (a {@link VtiCardCheckRefusal}), or held because the list could not be read
 * (`unknown`, with why).
 */
export type CardCheckOutcome = 'ok' | 'none' | VtiCardCheckRefusal | { unknown: string }

/** FNV-1a, 32 bits: telling one card from the next in a log, not a secret. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * Which card, in a log line: its most specific type and its id, or a short
 * hash of its proof when it carries no id. Never its subject or its claims.
 */
export function cardRef(credential: Record<string, unknown>): string {
  const types = Array.isArray(credential.type) ? credential.type.map(String) : [String(credential.type ?? '')]
  const type = types.filter((t) => t && t !== 'VerifiableCredential').slice(-1)[0] ?? 'VerifiableCredential'
  const id = typeof credential.id === 'string' && credential.id ? credential.id.slice(0, 80) : undefined
  return `${type} ${id ?? `#${shortHash(JSON.stringify(credential.proof ?? credential))}`}`
}

/**
 * The one line a delivered card's check logs (IN-258): which card, whether it
 * names a status list and on which host (never the list's path, which can
 * carry ids), and what the check came to.
 */
export function cardStatusLogLine(credential: Record<string, unknown>, outcome: CardCheckOutcome): string {
  const entry = statusEntryOf(credential)
  const status =
    entry === undefined ? 'none' : entry === 'malformed' ? 'malformed' : `${statusListHost(entry.url) ?? 'no host'}`
  const result =
    typeof outcome === 'object'
      ? `unknown (${outcome.unknown})`
      : outcome === 'ok'
        ? 'ok (status list read, not withdrawn)'
        : outcome === 'none'
          ? 'ok (no status list to read)'
          : outcome === 'revoked'
            ? 'revoked'
            : `refused before the status list (${outcome})`
  return `[VTI] card status: ${cardRef(credential)} credentialStatus=${status} outcome=${result}`
}

/** Clocks on a phone and a server disagree by seconds; openvtc and vta-sdk allow a minute. */
export const CARD_CLOCK_SKEW_MS = 60 * 1000

export async function checkDeliveredCard(
  agent: Agent,
  credential: Record<string, unknown>,
  issuer: string,
  options: { now?: Date; fetchImpl?: typeof fetch; allowInsecureLocal?: boolean } = {}
): Promise<VtiCardCheckRefusal | undefined> {
  const log = (outcome: CardCheckOutcome) => agent.config?.logger?.info?.(cardStatusLogLine(credential, outcome))
  const refuse = (refusal: VtiCardCheckRefusal) => {
    log(refusal)
    return refusal
  }
  const now = (options.now ?? new Date()).getTime()
  const validFrom = Date.parse(String(credential.validFrom ?? credential.issuanceDate ?? ''))
  const validUntil = Date.parse(String(credential.validUntil ?? credential.expirationDate ?? ''))
  if (Number.isFinite(validFrom) && validFrom > now + CARD_CLOCK_SKEW_MS) return refuse('notYetValid')
  if (Number.isFinite(validUntil) && now > validUntil + CARD_CLOCK_SKEW_MS) return refuse('expired')
  if (!(await verifyDocumentProof(agent, credential, issuer))) return refuse('proof')
  const status = await checkCredentialStatus(agent, credential, issuer, {
    fetchImpl: options.fetchImpl,
    allowInsecureLocal: options.allowInsecureLocal,
  })
  if (status.state === 'revoked') return refuse('revoked')
  if (status.state === 'unknown') {
    log({ unknown: status.reason })
    throw new VtiCardStatusUnreadable(status.reason, status.host)
  }
  log(status.state)
  return undefined
}

/** The check the inbox runs, bound to an agent. */
export function deliveredCardCheck(
  agent: Agent,
  options: { fetchImpl?: typeof fetch; allowInsecureLocal?: boolean } = {}
): VtiDeliveredCardCheck {
  return (credential, issuer) => checkDeliveredCard(agent, credential, issuer, options)
}
