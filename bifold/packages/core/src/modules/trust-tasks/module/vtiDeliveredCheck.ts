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

import { checkCredentialStatus } from './vtiStatusList'

/** Why a delivered card was not kept, after its sender was accepted. */
export type VtiCardCheckRefusal = 'proof' | 'notYetValid' | 'expired' | 'revoked'

/** Checks one delivered card; `undefined` when it may be kept. */
export type VtiDeliveredCardCheck = (
  credential: Record<string, unknown>,
  issuer: string
) => Promise<VtiCardCheckRefusal | undefined>

/** Its status list could not be read now; the delivery should come again. */
export class VtiCardStatusUnreadable extends Error {
  constructor(reason: string) {
    super(`vtiDeliveredCheck: the card's status list could not be read (${reason}); left for redelivery`)
    this.name = 'VtiCardStatusUnreadable'
  }
}

/** Clocks on a phone and a server disagree by seconds; openvtc and vta-sdk allow a minute. */
export const CARD_CLOCK_SKEW_MS = 60 * 1000

export async function checkDeliveredCard(
  agent: Agent,
  credential: Record<string, unknown>,
  issuer: string,
  options: { now?: Date; fetchImpl?: typeof fetch; allowInsecureLocal?: boolean } = {}
): Promise<VtiCardCheckRefusal | undefined> {
  const now = (options.now ?? new Date()).getTime()
  const validFrom = Date.parse(String(credential.validFrom ?? credential.issuanceDate ?? ''))
  const validUntil = Date.parse(String(credential.validUntil ?? credential.expirationDate ?? ''))
  if (Number.isFinite(validFrom) && validFrom > now + CARD_CLOCK_SKEW_MS) return 'notYetValid'
  if (Number.isFinite(validUntil) && now > validUntil + CARD_CLOCK_SKEW_MS) return 'expired'
  if (!(await verifyDocumentProof(agent, credential, issuer))) return 'proof'
  const status = await checkCredentialStatus(agent, credential, issuer, {
    fetchImpl: options.fetchImpl,
    allowInsecureLocal: options.allowInsecureLocal,
  })
  if (status.state === 'revoked') return 'revoked'
  if (status.state === 'unknown') throw new VtiCardStatusUnreadable(status.reason)
  return undefined
}

/** The check the inbox runs, bound to an agent. */
export function deliveredCardCheck(
  agent: Agent,
  options: { fetchImpl?: typeof fetch; allowInsecureLocal?: boolean } = {}
): VtiDeliveredCardCheck {
  return (credential, issuer) => checkDeliveredCard(agent, credential, issuer, options)
}
