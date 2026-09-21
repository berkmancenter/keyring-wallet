import { encodeEnrolmentLink, encodeTicketUri, type EnrolmentOffer } from '@bifold/trust-tasks'

import { vtaAgent } from '../module/vtaAgent'
import { keyringAgentLinkKind, pendingVettingTicket, routeKeyringAgentLink } from '../module/vtiLinks'

// Scanning, pasting and opening a deep link are one act (plan §5, U4): the
// same routing lands an enrolment offer on the link screen and a community
// invitation on My Agent.

const mockSaveInvitation = jest.fn(async () => undefined)
jest.mock('../module/VtiCommunityStore', () => ({
  GenericRecordsCommunityStore: jest.fn(() => ({ saveInvitation: mockSaveInvitation })),
}))
jest.mock('../module/vtiInvitation', () => ({
  isVtiInvitationLink: (url: string) => url.startsWith('keyring://vti/invitation?c='),
  parseVtiInvitationLink: (url: string) => ({ id: url }),
}))

const offer: EnrolmentOffer = {
  v: 1,
  t: 'vta-enrol',
  vta: 'did:webvh:Qm:alice',
  label: 'Lab agent',
  url: 'http://page/api/offers/n',
  n: 'NONCE0123456789ABCD',
  exp: Math.floor(Date.now() / 1000) + 300,
}

describe('recognising our links', () => {
  it('tells an enrolment offer and an invitation from everything else', () => {
    expect(keyringAgentLinkKind(encodeEnrolmentLink(offer))).toBe('enrolment')
    expect(keyringAgentLinkKind('  ' + encodeEnrolmentLink(offer) + '\n')).toBe('enrolment')
    expect(keyringAgentLinkKind('keyring://vti/invitation?c=abc')).toBe('invitation')
    expect(keyringAgentLinkKind('https://example.com/?oob=abc')).toBeUndefined()
    expect(keyringAgentLinkKind('didcomm://invite?oob=abc')).toBeUndefined()
  })
})

describe('routing them', () => {
  it('an enrolment offer goes to the link screen, waiting for the person to confirm', async () => {
    const navigate = jest.fn()
    const scanOffer = jest.spyOn(vtaAgent, 'scanOffer')
    await routeKeyringAgentLink(encodeEnrolmentLink(offer), {} as never, navigate)
    expect(scanOffer).toHaveBeenCalledWith(offer)
    expect(navigate).toHaveBeenCalledWith('VtaLink')
    expect(vtaAgent.getState().link.kind).toBe('confirming')
  })

  it('an expired offer is refused in plain words', async () => {
    const navigate = jest.fn()
    await expect(
      routeKeyringAgentLink(encodeEnrolmentLink({ ...offer, exp: 1 }), {} as never, navigate)
    ).rejects.toThrow('This link has expired. Ask for a new one.')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('an invitation is kept and shown on My Agent', async () => {
    const navigate = jest.fn()
    await routeKeyringAgentLink('keyring://vti/invitation?c=abc', {} as never, navigate)
    expect(mockSaveInvitation).toHaveBeenCalledWith({ id: 'keyring://vti/invitation?c=abc' })
    expect(navigate).toHaveBeenCalledWith('MyAgent')
  })
})

describe('a vetter\'s ticket', () => {
  const ticket = encodeTicketUri({
    community: 'did:webvh:Qm:community',
    vetter: 'did:webvh:Qm:vetter',
    presentation: { code: { code: 'ABCD-EFGH' } },
  } as never)

  it('is recognised, lands on Vetting, and is taken exactly once', async () => {
    expect(keyringAgentLinkKind(ticket)).toBe('ticket')
    const navigate = jest.fn()
    const heard = jest.fn()
    const unsubscribe = pendingVettingTicket.subscribe(heard)
    await routeKeyringAgentLink(ticket, {} as never, navigate)
    unsubscribe()
    expect(navigate).toHaveBeenCalledWith('VtiVetting')
    expect(heard).toHaveBeenCalledTimes(1)
    expect(pendingVettingTicket.take()).toBe(ticket)
    expect(pendingVettingTicket.take()).toBeUndefined()
  })
})
