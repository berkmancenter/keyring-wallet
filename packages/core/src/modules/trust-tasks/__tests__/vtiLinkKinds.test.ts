import { encodeEnrolmentLink, encodeTicketUri, type EnrolmentOffer } from '@bifold/trust-tasks'

import { buildCommunityLink } from '../module/vtiCommunityLink'
import { APPROVALS_LINK, keyringAgentLinkKind, type KeyringAgentLinkKind } from '../module/vtiLinks'

// What every link the scanner, a paste and a deep link share is classified as, one example of each kind. It records
// today's behaviour, order included: a link is claimed by the first rule that matches it.

const community = 'did:webvh:QmCommunity:vtc.example.org'
const offer: EnrolmentOffer = {
  v: 1,
  t: 'vta-enrol',
  vta: 'did:webvh:Qm:alice',
  label: 'Lab agent',
  url: 'http://page/api/offers/n',
  n: 'NONCE0123456789ABCD',
  exp: 4102444800,
}
const credentialOffer = encodeURIComponent(
  JSON.stringify({
    credential_issuer: community,
    credential_configuration_ids: ['VtcInvitation'],
    grants: { 'urn:ietf:params:oauth:grant-type:pre-authorized_code': { 'pre-authorized_code': 'abc123' } },
  })
)
const oobInvitation = Buffer.from(
  JSON.stringify({ '@type': 'https://didcomm.org/out-of-band/1.1/invitation', '@id': 'x', services: [] })
).toString('base64url')

const table: [string, string, KeyringAgentLinkKind | undefined][] = [
  [
    'agent host QR (JSON with a callback)',
    '{"vta_did":"did:webvh:Qm:a","callback_url":"https://h.example/cb"}',
    'agentHost',
  ],
  [
    'trigger link (a community sign-in)',
    'https://link.trustoverip.org/t#_from=did%3Awebvh%3AQm%3Av&_id=1&_exp=4102444800&_type=/vti/flow/sign-in/0.1',
    'triggerLink',
  ],
  [
    'trigger link (an agent claim)',
    'https://link.trustoverip.org/t#_from=did%3Awebvh%3AQm%3Afarm&_id=2&_exp=4102444800&_type=/vti/flow/claim/0.1',
    'triggerLink',
  ],
  ['approvals link', APPROVALS_LINK, 'approvals'],
  ['enrolment offer', encodeEnrolmentLink(offer), 'enrolment'],
  ['invitation', 'keyring://vti/invitation?c=abc', 'invitation'],
  [
    'invitation offer (OID4VCI, DID issuer)',
    `openid-credential-offer://?credential_offer=${credentialOffer}`,
    'invitationOffer',
  ],
  [
    "vetter's ticket",
    encodeTicketUri({
      community,
      vetter: 'did:webvh:QmVetter:vtc.example.org:vetter',
      presentation: { code: { code: 'ABCD-EFGH' } },
    } as never),
    'ticket',
  ],
  ['community link', buildCommunityLink({ communityDid: community }), 'community'],
  ['join link (a link to ask)', 'https://vtc.example.org/join?_oobid=abc', 'joinLink'],
  ['join link (web+interaction)', 'web+interaction:whatever', 'joinLink'],
  ['bare did:webvh', 'did:webvh:QmScid:vtc.example.org', 'did'],
  ['bare did:webs', 'did:webs:example.org:EAbCdEfG', 'did'],
  ['bare did:key (any other DID)', 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK', 'otherDid'],
  ['DIDComm OOB invitation (handed on)', `https://mediator.example.org/invite?oob=${oobInvitation}`, undefined],
  ['plain URL', 'https://example.org/', undefined],
  ['garbage', 'not a link at all', undefined],
  ['empty', '', undefined],
  // The one row that is the SEDI demo's: claimed by its prefix before every other rule.
  ['keyring://guardian-card', 'keyring://guardian-card?u=https%3A%2F%2Foffice.example%2Fcard', 'guardianCard'],
]

describe('the kind of each link', () => {
  it.each(table)('%s', (_name, link, kind) => {
    expect(keyringAgentLinkKind(link)).toBe(kind)
  })

  it('ignores the whitespace around a link', () => {
    expect(keyringAgentLinkKind(`  ${APPROVALS_LINK}\n`)).toBe('approvals')
  })
})
