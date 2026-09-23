import { encodeEnrolmentLink, encodeTicketUri, type EnrolmentOffer } from '@bifold/trust-tasks'

import { vtaAgent } from '../module/vtaAgent'
import { communityTarget } from '../module/vtiCommunityLink'
import {
  KeyringLinkError,
  communityLinkReturn,
  keyringAgentLinkKind,
  pendingVettingTicket,
  routeKeyringAgentLink,
} from '../module/vtiLinks'

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

  it('an invitation is kept and, with no linked agent, shown on My Agent', async () => {
    const controller = vtaAgent as unknown as { set(next: Record<string, unknown>): void }
    controller.set({ link: { kind: 'notLinked' } })
    const navigate = jest.fn()
    await routeKeyringAgentLink('keyring://vti/invitation?c=abc', {} as never, navigate)
    expect(mockSaveInvitation).toHaveBeenCalledWith({ id: 'keyring://vti/invitation?c=abc' })
    expect(navigate).toHaveBeenCalledWith('MyAgent')
  })

  it('on a linked phone, an invitation opens "I was invited", never the operator panel', async () => {
    const controller = vtaAgent as unknown as { set(next: Record<string, unknown>): void }
    controller.set({
      link: {
        kind: 'linked',
        vtaDid: 'did:webvh:example:vta',
        label: 'bob',
        linkedAt: '2026-09-23T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
    const navigate = jest.fn()
    await routeKeyringAgentLink('keyring://vti/invitation?c=abc', {} as never, navigate)
    expect(navigate).toHaveBeenCalledWith('VtiInvited')
    expect(navigate).not.toHaveBeenCalledWith('MyAgent')
    controller.set({ link: { kind: 'notLinked' } })
  })
})

describe("a vetter's ticket", () => {
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

describe('a community link brought for "I was invited"', () => {
  const link = `keyring://vti/community?d=${encodeURIComponent('did:webvh:QmC:vtc.example')}&n=Lab`
  it('lands back on "I was invited" once, and on Join after that', async () => {
    const navigate = jest.fn()
    communityLinkReturn.toInvited()
    await routeKeyringAgentLink(link, {} as never, navigate)
    expect(navigate).toHaveBeenLastCalledWith('VtiInvited')
    await routeKeyringAgentLink(link, {} as never, navigate)
    expect(navigate).toHaveBeenLastCalledWith('VtiJoin')
  })
})

/**
 * A bare DID, as upstream's QR codes carry it (the VTC page, `pnm vta qr`, the
 * browser plugin): classified by its document and routed, or explained.
 */
describe('a bare DID, scanned or pasted', () => {
  const agentDid = 'did:webvh:QmAgent:dids.example:alice'
  const communityDid = 'did:webvh:QmCommunity:dids.example:vtc'
  const doc = (types: string[]) => ({ id: 'x', service: types.map((type) => ({ type })) })
  const withDoc = (d: unknown) => ({ dids: { resolveDidDocument: jest.fn(async () => d) } }) as never
  const controller = vtaAgent as unknown as { set(next: Record<string, unknown>): void }

  beforeEach(() => {
    communityTarget.clear()
    communityLinkReturn.take()
    controller.set({ link: { kind: 'notLinked' } })
  })
  afterEach(() => jest.restoreAllMocks())

  it('claims a did:webvh, and leaves any other DID to the DIDComm handling', () => {
    expect(keyringAgentLinkKind(`  ${communityDid}  `)).toBe('did')
    expect(keyringAgentLinkKind(`${communityDid}#key-0`)).toBe('did')
    expect(keyringAgentLinkKind('did:peer:2.Ez6LSabc')).toBeUndefined()
  })

  it('a community goes to Join on that community', async () => {
    const navigate = jest.fn()
    await routeKeyringAgentLink(communityDid, withDoc(doc(['VTCRest', 'VTCStatusList'])), navigate)
    expect(navigate).toHaveBeenCalledWith('VtiJoin')
    expect(communityTarget.getViewing()?.communityDid).toBe(communityDid)
  })

  it('a community brought for "I was invited" goes back there', async () => {
    const navigate = jest.fn()
    communityLinkReturn.toInvited()
    await routeKeyringAgentLink(communityDid, withDoc(doc(['VTCRest'])), navigate)
    expect(navigate).toHaveBeenCalledWith('VtiInvited')
  })

  it('an agent starts linking to it, named by its host', async () => {
    const start = jest.spyOn(vtaAgent, 'startManualLink').mockResolvedValue(undefined)
    const navigate = jest.fn()
    const agent = withDoc(doc(['VTARest', 'DIDCommMessaging']))
    await routeKeyringAgentLink(agentDid, agent, navigate)
    expect(start).toHaveBeenCalledWith(agent, agentDid, 'dids.example')
    expect(navigate).toHaveBeenCalledWith('VtaLink')
  })

  it('an agent on a phone already linked says so, and starts nothing', async () => {
    const start = jest.spyOn(vtaAgent, 'startManualLink').mockResolvedValue(undefined)
    controller.set({
      link: {
        kind: 'linked',
        vtaDid: 'did:webvh:Qm:other',
        label: 'x',
        linkedAt: '2026-09-23T00:00:00Z',
        connection: { kind: 'online', since: 0 },
      },
    })
    await expect(routeKeyringAgentLink(agentDid, withDoc(doc(['VTARest'])), jest.fn())).rejects.toThrow(
      /already linked/
    )
    expect(start).not.toHaveBeenCalled()
  })

  it('anything else is explained in words, never routed', async () => {
    const navigate = jest.fn()
    await expect(routeKeyringAgentLink(agentDid, withDoc(doc(['VTARest', 'VTCRest'])), navigate)).rejects.toThrow(
      /both an agent and a community/
    )
    await expect(
      routeKeyringAgentLink(agentDid, withDoc(doc(['DIDCommMessaging', 'Authentication'])), navigate)
    ).rejects.toThrow(/mediator/)
    await expect(routeKeyringAgentLink(agentDid, withDoc(doc([])), navigate)).rejects.toThrow(
      /isn't an agent or a community/
    )
    const offline = {
      dids: { resolveDidDocument: jest.fn(async () => Promise.reject(new Error('ENOTFOUND'))) },
    } as never
    await expect(routeKeyringAgentLink(agentDid, offline, navigate)).rejects.toThrow(/couldn't be read/)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('its reasons are KeyringLinkErrors, which the scanner shows as the headline', async () => {
    // The scanner tells "ours, in words" from anything else by instanceof, so
    // the subclass has to survive the build's class transform.
    let caught: unknown
    try {
      await routeKeyringAgentLink(agentDid, withDoc(doc(['DIDCommMessaging', 'Authentication'])), jest.fn())
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(KeyringLinkError)
    expect(caught).toBeInstanceOf(Error)
  })
})
