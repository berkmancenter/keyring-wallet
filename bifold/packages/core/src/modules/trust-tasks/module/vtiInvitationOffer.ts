/**
 * vtiInvitationOffer — an invitation a community's admin console hands out as
 * an offer, redeemed for the invitation itself.
 *
 * The console issues an `InvitationCredential` and then delivers it with
 * `vtc/invitations/deliver/0.1` in one of two ways (vtc-service
 * `routes/invitations.rs:476-620`, VTI `ed672fff`):
 *
 *  - `message`: a DIDComm `credential-exchange/offer/0.1` to the invitee's DID,
 *    body `{ credential_offer }`;
 *  - `offer`: the same offer as a QR code,
 *    `openid-credential-offer://?credential_offer=<JSON>`
 *    (`admin-ui/src/lib/invitation-offer.ts`).
 *
 * Either way the offer is an OID4VCI pre-authorized-code offer whose
 * `credential_issuer` is the community's DID, not an https URL. A generic
 * OID4VCI client cannot redeem it (VTI-Q32); Keyring redeems it the way the
 * community takes it: `POST {VTCRest}/v1/credential-exchange/request` with the
 * `Trust-Task` header and a bare `{ credential_request }` body carrying an
 * `openid4vci-proof+jwt` key-binding proof — `aud` the community, `nonce` the
 * pre-authorized code, signed by the invited identity
 * (vtc-service `credentials/exchange/issue.rs:16-138`,
 * `routes/credential_exchange.rs:31-50`, `tests/invitations.rs:390-518`).
 *
 * What comes back is the `InvitationCredential`, exactly what a
 * `keyring://vti/invitation` link carries, so it is kept as a pending
 * invitation and joined with as before. Redeeming does not join: the join
 * presents the credential (`routes/invitations.rs:1-8`).
 *
 * @module trust-tasks/module/vtiInvitationOffer
 */

import type { Agent } from '@credo-ts/core'
import { signCompactJws } from '@bifold/trust-tasks'

import type { VtiInvitation } from './VtiCommunityStore'
import type { VtiPersona } from './VtiIdentityStore'
import { vtcRestUrl } from './vtiAgent'
import { describeInvitation } from './vtiInvitation'

export const CREDENTIAL_EXCHANGE_OFFER = 'https://trusttasks.org/spec/credential-exchange/offer/0.1'
export const CREDENTIAL_EXCHANGE_REQUEST = 'https://trusttasks.org/spec/credential-exchange/request/0.1'

const OFFER_SCHEME = 'openid-credential-offer://'
const PRE_AUTHORIZED_CODE = 'urn:ietf:params:oauth:grant-type:pre-authorized_code'

/** An offer a community made for an invitation: who offers it, and the code that redeems it. */
export interface VtiInvitationOffer {
  communityDid: string
  configurationIds: string[]
  preAuthorizedCode: string
}

export type VtiInvitationOfferErrorReason =
  | 'noIdentity'
  | 'cannotSign'
  | 'unreachable'
  | 'used'
  | 'otherIdentity'
  | 'failed'

export class VtiInvitationOfferError extends Error {
  public constructor(
    public readonly reason: VtiInvitationOfferErrorReason,
    detail?: string
  ) {
    super(detail ? `invitation offer: ${reason} (${detail})` : `invitation offer: ${reason}`)
    this.name = 'VtiInvitationOfferError'
  }
}

/**
 * An OID4VCI credential offer that is a community's invitation offer: its
 * issuer is a DID and it carries a pre-authorized code. An offer from an
 * https issuer is an ordinary OpenID offer and is left to that flow.
 */
export function invitationOfferOf(offer: unknown): VtiInvitationOffer | undefined {
  if (!offer || typeof offer !== 'object') return undefined
  const o = offer as {
    credential_issuer?: unknown
    credential_configuration_ids?: unknown
    grants?: Record<string, { 'pre-authorized_code'?: unknown } | undefined>
  }
  const communityDid = typeof o.credential_issuer === 'string' ? o.credential_issuer : ''
  if (!communityDid.startsWith('did:')) return undefined
  const code = o.grants?.[PRE_AUTHORIZED_CODE]?.['pre-authorized_code']
  if (typeof code !== 'string' || !code) return undefined
  const configurationIds = Array.isArray(o.credential_configuration_ids)
    ? o.credential_configuration_ids.map(String)
    : []
  return { communityDid, configurationIds, preAuthorizedCode: code }
}

/** The offer inside an `openid-credential-offer://` link, when it is a community's; undefined otherwise. */
export function parseInvitationOfferLink(text: string): VtiInvitationOffer | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith(OFFER_SCHEME)) return undefined
  const query = trimmed.slice(trimmed.indexOf('?') + 1)
  if (query === trimmed) return undefined
  for (const pair of query.split('&')) {
    const at = pair.indexOf('=')
    if (at < 0 || pair.slice(0, at) !== 'credential_offer') continue
    try {
      return invitationOfferOf(JSON.parse(decodeURIComponent(pair.slice(at + 1).replace(/\+/g, ' '))))
    } catch {
      return undefined
    }
  }
  return undefined
}

export function isInvitationOfferLink(text: string): boolean {
  return parseInvitationOfferLink(text) !== undefined
}

/**
 * The offer in a pushed `credential-exchange/offer/0.1`, when it is the
 * community's own: the message must come from the DID the offer names.
 */
export function invitationOfferOfMessage(plaintext: {
  type?: unknown
  from?: unknown
  body?: unknown
}): VtiInvitationOffer | undefined {
  if (plaintext.type !== CREDENTIAL_EXCHANGE_OFFER) return undefined
  const offer = invitationOfferOf((plaintext.body as { credential_offer?: unknown } | undefined)?.credential_offer)
  if (!offer || plaintext.from !== offer.communityDid) return undefined
  return offer
}

/** The community's REST base from its DID document: a string endpoint or `{ uri }` (openvtc `vetting/discover.rs:120-142`). */
async function restBaseOf(agent: Agent, communityDid: string): Promise<string> {
  let doc
  try {
    doc = await agent.dids.resolveDidDocument(communityDid)
  } catch (e) {
    throw new VtiInvitationOfferError('unreachable', (e as Error).message)
  }
  for (const service of doc.service ?? []) {
    const types = Array.isArray(service.type) ? service.type : [service.type]
    if (!types.includes('VTCRest')) continue
    const endpoint = service.serviceEndpoint as unknown
    if (typeof endpoint === 'string') return endpoint
    const uri = (endpoint as { uri?: unknown } | undefined)?.uri
    if (typeof uri === 'string') return uri
  }
  throw new VtiInvitationOfferError('unreachable', `${communityDid} advertises no VTCRest service`)
}

/**
 * Redeem the offer as `persona` and return the invitation it was for. The
 * persona must be the one invited: the community binds the code to that DID
 * and answers 403 to any other, without using the code up.
 */
export async function redeemInvitationOffer(
  agent: Agent,
  offer: VtiInvitationOffer,
  persona: VtiPersona | undefined,
  deps: { fetch?: typeof fetch; now?: () => Date } = {}
): Promise<VtiInvitation> {
  if (!persona) throw new VtiInvitationOfferError('noIdentity', offer.communityDid)
  if (!persona.kmsKeyIds?.signing) throw new VtiInvitationOfferError('cannotSign', persona.did)
  const base = await restBaseOf(agent, offer.communityDid)
  const now = deps.now?.() ?? new Date()
  const jwt = await signCompactJws(
    agent,
    persona.did,
    {
      iss: persona.did,
      aud: offer.communityDid,
      iat: Math.floor(now.getTime() / 1000),
      nonce: offer.preAuthorizedCode,
    },
    {
      kmsKeyId: persona.kmsKeyIds.signing,
      verificationMethodId: persona.vtaKeyIds.signing,
      typ: 'openid4vci-proof+jwt',
    }
  )
  let response: Response
  try {
    response = await (deps.fetch ?? fetch)(vtcRestUrl(base, 'credential-exchange/request'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Trust-Task': CREDENTIAL_EXCHANGE_REQUEST },
      body: JSON.stringify({
        credential_request: {
          // The community returns the credential it stored, whatever the
          // format says; this is the shape its own tests send.
          format: 'vc+sd-jwt',
          vct: offer.configurationIds[0] ?? 'VIC',
          proof: { proof_type: 'jwt', jwt },
        },
      }),
    })
  } catch (e) {
    throw new VtiInvitationOfferError('unreachable', (e as Error).message)
  }
  if (response.status === 404) throw new VtiInvitationOfferError('used')
  if (response.status === 403) throw new VtiInvitationOfferError('otherIdentity', persona.did)
  if (!response.ok) throw new VtiInvitationOfferError('failed', `HTTP ${response.status}`)
  const body = (await response.json().catch(() => undefined)) as
    | { credential_response?: { credential?: unknown } }
    | undefined
  const credential = body?.credential_response?.credential
  if (!credential || typeof credential !== 'object')
    throw new VtiInvitationOfferError('failed', 'no credential in the answer')
  const invitation = describeInvitation(credential as Record<string, unknown>)
  if (invitation.communityDid !== offer.communityDid) {
    throw new VtiInvitationOfferError(
      'failed',
      `issued by ${invitation.communityDid}, offered by ${offer.communityDid}`
    )
  }
  if (invitation.subjectDid !== persona.did) throw new VtiInvitationOfferError('otherIdentity', invitation.subjectDid)
  return invitation
}
