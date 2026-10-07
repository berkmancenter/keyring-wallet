import { encodeEnrolmentLink, encodeTicketUri, type EnrolmentOffer } from '@bifold/trust-tasks'

import { Screens } from '../../../types/navigators'
import { vtaAgent } from '../module/vtaAgent'
import { communityTarget } from '../module/vtiCommunityLink'
import {
  APPROVALS_LINK,
  MY_AGENT_SCREEN,
  myAgentLinkParams,
  KeyringLinkError,
  communityLinkReturn,
  keyringAgentLinkKind,
  keyringLinkErrorText,
  otherDidMessage,
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

const mockPersona = {
  did: 'did:webvh:QmPersona:host:negative-weird',
  communityDid: 'did:webvh:QmC:host:keyring-test-vtc',
}
jest.mock('../module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: jest.fn(() => ({
    getPersona: async (communityDid: string) => (communityDid === mockPersona.communityDid ? mockPersona : undefined),
  })),
}))
const mockRedeem = jest.fn()
jest.mock('../module/vtiInvitationOffer', () => ({
  ...jest.requireActual('../module/vtiInvitationOffer'),
  redeemInvitationOffer: (...a: unknown[]) => mockRedeem(...a),
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

describe('the approvals link a push notification opens', () => {
  it('is recognised exactly, and nothing near it', () => {
    expect(APPROVALS_LINK).toBe('keyring://vta/approvals')
    expect(keyringAgentLinkKind(APPROVALS_LINK)).toBe('approvals')
    expect(keyringAgentLinkKind(` ${APPROVALS_LINK}\n`)).toBe('approvals')
    expect(keyringAgentLinkKind('keyring://vta/approvals?x=1')).toBeUndefined()
  })

  it('goes to the Requests screen, where what waits is decided, and does nothing else', async () => {
    const navigate = jest.fn()
    await routeKeyringAgentLink(APPROVALS_LINK, {} as never, navigate)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('VtaRequests')
    expect(MY_AGENT_SCREEN.VtaRequests).toBe(Screens.VtaRequests)
  })
})

describe('the My Agent screen a link opens', () => {
  type Setter = { set(next: Record<string, unknown>): void }
  const setLink = (kind: string) =>
    (vtaAgent as unknown as Setter).set({
      link:
        kind === 'linked'
          ? { kind, vtaDid: 'did:webvh:example:vta', linkedAt: '', connection: { kind: 'online' } }
          : { kind },
    })
  afterEach(() => setLink('notLinked'))

  it('keeps "Your agent" under it, so the way back lands there (233)', () => {
    setLink('linked')
    expect(myAgentLinkParams('VtiJoin')).toEqual({ screen: Screens.VtiJoin, initial: false })
    expect(myAgentLinkParams('VtaRequests')).toEqual({ screen: Screens.VtaRequests, initial: false })
  })

  it("opens the stack's first screen as itself, never on top of itself", () => {
    setLink('linked')
    expect(myAgentLinkParams('VtaAgent')).toEqual({ screen: Screens.VtaAgent })
    setLink('notLinked')
    expect(myAgentLinkParams('MyAgent')).toEqual({ screen: Screens.MyAgent })
    expect(myAgentLinkParams('VtaLink')).toEqual({ screen: Screens.VtaLink, initial: false })
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

describe("a community admin console's invitation QR", () => {
  const consoleOffer = {
    credential_configuration_ids: ['VIC'],
    credential_issuer: mockPersona.communityDid,
    grants: { 'urn:ietf:params:oauth:grant-type:pre-authorized_code': { 'pre-authorized_code': 'pac_1' } },
  }
  const link = `openid-credential-offer://?credential_offer=${encodeURIComponent(JSON.stringify(consoleOffer))}`
  const controller = vtaAgent as unknown as { set(next: Record<string, unknown>): void }
  const linked = {
    kind: 'linked',
    vtaDid: 'did:webvh:example:vta',
    label: 'bob',
    linkedAt: '2026-09-23T00:00:00Z',
    connection: { kind: 'online', since: 0 },
  }
  beforeEach(() => {
    mockRedeem.mockReset()
    mockSaveInvitation.mockClear()
  })
  afterEach(() => controller.set({ link: { kind: 'notLinked' } }))

  it("is ours, not the OpenID flow's", () => {
    expect(keyringAgentLinkKind(link)).toBe('invitationOffer')
  })

  it('is redeemed as the identity made for that community, kept, and opens "I was invited"', async () => {
    controller.set({ link: linked })
    const invitation = { id: 'urn:uuid:vic', communityDid: mockPersona.communityDid, subjectDid: mockPersona.did }
    mockRedeem.mockResolvedValue(invitation)
    const navigate = jest.fn()
    await routeKeyringAgentLink(link, {} as never, navigate)
    expect(mockRedeem).toHaveBeenCalledWith(
      {},
      { communityDid: mockPersona.communityDid, configurationIds: ['VIC'], preAuthorizedCode: 'pac_1' },
      mockPersona
    )
    expect(mockSaveInvitation).toHaveBeenCalledWith(invitation)
    expect(communityTarget.get()?.communityDid).toBe(mockPersona.communityDid)
    expect(navigate).toHaveBeenCalledWith('VtiInvited')
  })

  it('a code already used is explained in words; nothing is kept or opened', async () => {
    controller.set({ link: linked })
    const { VtiInvitationOfferError } = jest.requireActual('../module/vtiInvitationOffer')
    mockRedeem.mockRejectedValue(new VtiInvitationOfferError('used'))
    const navigate = jest.fn()
    const opening = routeKeyringAgentLink(link, {} as never, navigate)
    await expect(opening).rejects.toBeInstanceOf(KeyringLinkError)
    await expect(opening).rejects.toThrow(/already been used/)
    expect(mockSaveInvitation).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
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

  describe('for another community than the phone chose (p220 item 3)', () => {
    beforeEach(() => communityTarget.clear())
    afterEach(() => communityTarget.clear())

    it('is refused, typed, before the vetting screen is switched to it', async () => {
      communityTarget.choose('did:webvh:Qm:mine')
      const navigate = jest.fn()
      const attempt = routeKeyringAgentLink(ticket, {} as never, navigate)
      await expect(attempt).rejects.toBeInstanceOf(KeyringLinkError)
      await expect(routeKeyringAgentLink(ticket, {} as never, navigate)).rejects.toMatchObject({
        ticket: { reason: 'otherCommunity', ticketCommunityDid: 'did:webvh:Qm:community' },
      })
      expect(navigate).not.toHaveBeenCalled()
      expect(communityTarget.getViewing()).toBeUndefined()
      expect(communityTarget.getChosen()?.communityDid).toBe('did:webvh:Qm:mine')
      expect(pendingVettingTicket.take()).toBeUndefined()
    })

    it('is taken when it is for the chosen community', async () => {
      communityTarget.choose('did:webvh:Qm:community')
      const navigate = jest.fn()
      await routeKeyringAgentLink(ticket, {} as never, navigate)
      expect(navigate).toHaveBeenCalledWith('VtiVetting')
      expect(pendingVettingTicket.take()).toBe(ticket)
    })

    it('with no community chosen yet, names the one being joined', async () => {
      const navigate = jest.fn()
      await routeKeyringAgentLink(ticket, {} as never, navigate)
      expect(communityTarget.getViewing()?.communityDid).toBe('did:webvh:Qm:community')
      expect(navigate).toHaveBeenCalledWith('VtiVetting')
      pendingVettingTicket.take()
    })
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
  const withDoc = (d: unknown) => ({ dids: { resolve: jest.fn(async () => ({ didDocument: d })) } }) as never
  const controller = vtaAgent as unknown as { set(next: Record<string, unknown>): void }

  beforeEach(() => {
    communityTarget.clear()
    communityLinkReturn.take()
    controller.set({ link: { kind: 'notLinked' } })
  })
  afterEach(() => jest.restoreAllMocks())

  it('claims a did:webvh to classify, and any other bare DID to explain', () => {
    expect(keyringAgentLinkKind(`  ${communityDid}  `)).toBe('did')
    expect(keyringAgentLinkKind(`${communityDid}#key-0`)).toBe('did')
    expect(keyringAgentLinkKind('did:peer:2.Ez6LSabc')).toBe('otherDid')
    expect(keyringAgentLinkKind('did:key:z6MkswwZ')).toBe('otherDid')
    // A DIDComm invitation is a URL, never a bare DID: still DIDComm's.
    expect(keyringAgentLinkKind('https://mediator.example/?oob=eyJ0')).toBeUndefined()
    expect(keyringAgentLinkKind('didcomm://invite?_oob=eyJ0')).toBeUndefined()
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
    expect(start).toHaveBeenCalledWith(agent, agentDid, 'dids.example', { via: 'scan' })
    expect(navigate).toHaveBeenCalledWith('VtaLink')
  })

  // Feedback 10-05: scanning a second agent said "already linked", though the
  // phone holds several. It is added beside the current one now.
  describe('on a phone already linked to another agent', () => {
    const linkedTo = (vtaDid: string) =>
      controller.set({
        link: {
          kind: 'linked',
          vtaDid,
          label: 'x',
          linkedAt: '2026-09-23T00:00:00Z',
          connection: { kind: 'online', since: 0 },
        },
        agents: [{ vtaDid, label: 'x' }],
      })
    afterEach(() => controller.set({ agents: undefined }))

    it('adds the scanned agent beside it: the current one is left first, then the link starts', async () => {
      linkedTo('did:webvh:Qm:other')
      const order: string[] = []
      jest.spyOn(vtaAgent, 'startAddingAgent').mockImplementation(async () => {
        order.push('add')
      })
      jest.spyOn(vtaAgent, 'startManualLink').mockImplementation(async () => {
        order.push('link')
      })
      const navigate = jest.fn()
      await routeKeyringAgentLink(agentDid, withDoc(doc(['VTARest'])), navigate)
      expect(order).toEqual(['add', 'link'])
      expect(navigate).toHaveBeenCalledWith('VtaLink')
    })

    // IN-138: the add began, the link screen never opened; the agent before comes back.
    it('an add whose link could not start is given up, back to the agent before', async () => {
      linkedTo('did:webvh:Qm:other')
      jest.spyOn(vtaAgent, 'startAddingAgent').mockResolvedValue(undefined)
      jest.spyOn(vtaAgent, 'startManualLink').mockRejectedValue(new Error('no key'))
      const cancel = jest.spyOn(vtaAgent, 'cancelLink').mockImplementation(() => undefined)
      const navigate = jest.fn()
      await expect(routeKeyringAgentLink(agentDid, withDoc(doc(['VTARest'])), navigate)).rejects.toThrow('no key')
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(navigate).not.toHaveBeenCalled()
    })

    it('one this phone already has is said so, and nothing starts', async () => {
      linkedTo(agentDid)
      const add = jest.spyOn(vtaAgent, 'startAddingAgent').mockResolvedValue(undefined)
      const start = jest.spyOn(vtaAgent, 'startManualLink').mockResolvedValue(undefined)
      await expect(routeKeyringAgentLink(agentDid, withDoc(doc(['VTARest'])), jest.fn())).rejects.toThrow(
        /already has that agent/
      )
      expect(add).not.toHaveBeenCalled()
      expect(start).not.toHaveBeenCalled()
    })

    // IN-132: after an "Add" the current agent has been left, so the phone
    // is not linked; an agent it already has is still refused, by its DID.
    it('one this phone already has is refused after an "Add" too, when nothing is current', async () => {
      controller.set({ link: { kind: 'notLinked' }, agents: [{ vtaDid: agentDid, label: 'x' }] })
      const start = jest.spyOn(vtaAgent, 'startManualLink').mockResolvedValue(undefined)
      const route = routeKeyringAgentLink(agentDid, withDoc(doc(['VTARest'])), jest.fn())
      await expect(route).rejects.toBeInstanceOf(KeyringLinkError)
      await expect(route).rejects.toMatchObject({ messageKey: 'VtaLink.FailedAlreadyLinked' })
      expect(start).not.toHaveBeenCalled()
    })
  })

  it("a code that is both an agent and a community is explained in the person's language", async () => {
    const route = routeKeyringAgentLink(agentDid, withDoc(doc(['VTARest', 'VTCRest'])), jest.fn())
    await expect(route).rejects.toMatchObject({ messageKey: 'Scan.BothAgentAndCommunity' })
    const error = await route.catch((e: unknown) => e as KeyringLinkError)
    expect(keyringLinkErrorText(error as KeyringLinkError, (k) => `t:${k}`)).toBe('t:Scan.BothAgentAndCommunity')
    // Without a translator, the English as before.
    expect(keyringLinkErrorText(error as KeyringLinkError)).toMatch(/belongs to both an agent and a community/)
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
      dids: { resolve: jest.fn(async () => Promise.reject(new Error('ENOTFOUND'))) },
    } as never
    await expect(routeKeyringAgentLink(agentDid, offline, navigate)).rejects.toThrow(/couldn't be read/)
    // A host that answered "no such DID": said as such, not blamed on the network.
    const notFound = {
      dids: { resolve: jest.fn(async () => ({ didDocument: null, didResolutionMetadata: { error: 'notFound' } })) },
    } as never
    await expect(routeKeyringAgentLink(agentDid, notFound, navigate)).rejects.toThrow(
      'No agent or community has this code.'
    )
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

describe('a bare DID of another method, as the browser plugin shows beside every DID', () => {
  // Nothing is resolved for these: the agent passed has no resolver at all.
  const noResolver = {} as never
  beforeEach(() => communityTarget.clear())
  const holderPeer =
    'did:peer:2.Vz6MkgiJThYDpnQGtyzn7FUbVT5o9K7Hjgwg3GG5v5v4Q3m1W.Ez6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECx2AtzE3KCc.SeyJ0IjoiZG0iLCJzIjp7InVyaSI6ImRpZDp3ZWJ2aDpRbTptZWRpYXRvciJ9fQ'

  it.each([
    [
      'a did:key, such as a manager or admin key',
      'did:key:z6MkswwZ3dWuQVXJaBhm6x3zFVWVvQm1Vc9WrBcHnwzF4cK1',
      /is a key, not an agent or a community/,
    ],
    [
      "a did:peer, such as the plugin wallet's holder",
      holderPeer,
      /private connection address, not an agent or a community/,
    ],
    ['a did:peer with a fragment', `${holderPeer}#key-1`, /private connection address/],
    ['a did:web', 'did:web:example.com', /isn't an agent or a community/],
    ['a did:jwk', 'did:jwk:eyJrdHkiOiJPS1AifQ', /isn't an agent or a community/],
  ])('%s is explained in words and routed nowhere', async (_, did, message) => {
    const navigate = jest.fn()
    const attempt = routeKeyringAgentLink(`  ${did}\n`, noResolver, navigate)
    await expect(attempt).rejects.toBeInstanceOf(KeyringLinkError)
    await expect(routeKeyringAgentLink(did, noResolver, navigate)).rejects.toThrow(message)
    expect(navigate).not.toHaveBeenCalled()
    expect(communityTarget.getViewing()).toBeUndefined()
  })

  it('says what the code is in plain words, without DID jargon', () => {
    for (const did of ['did:key:z6Mk', 'did:peer:2.Ez6LS', 'did:web:example.com']) {
      expect(otherDidMessage(did)).not.toMatch(/did:/)
    }
  })
})

describe("an agent host's automatic-connection QR", () => {
  const vtaDid = 'did:webvh:QmAgent:dids.ic3.dev:alice-vta'
  const callback = 'https://vtafarm-api.ic3.dev/api/v1/mobile-connections/callback/req.SECRET'
  const qr = (value: Record<string, unknown>) => JSON.stringify(value)
  const controller = vtaAgent as unknown as { set(next: Record<string, unknown>): void }

  beforeEach(() => controller.set({ link: { kind: 'notLinked' } }))
  afterEach(() => jest.restoreAllMocks())

  it('is ours, before anything else reads it', () => {
    expect(keyringAgentLinkKind(qr({ vta_did: vtaDid, callback_url: callback }))).toBe('agentHost')
    // One that fails its checks is still claimed, so the scanner explains it.
    expect(keyringAgentLinkKind(qr({ vta_did: vtaDid, callback_url: 'http://x.example/cb' }))).toBe('agentHost')
    expect(keyringAgentLinkKind('{"some":"json"}')).toBeUndefined()
  })

  it('opens the link screen, asking the person, with nothing sent', async () => {
    const scan = jest.spyOn(vtaAgent, 'scanHostOffer')
    const navigate = jest.fn()
    await routeKeyringAgentLink(qr({ vta_did: vtaDid, callback_url: callback }), {} as never, navigate)
    expect(scan).toHaveBeenCalledWith({ vtaDid, callbackUrl: callback, host: 'vtafarm-api.ic3.dev' })
    expect(navigate).toHaveBeenCalledWith('VtaLink')
    expect(vtaAgent.getState().link).toMatchObject({ kind: 'confirming', via: 'host' })
  })

  it('a callback on a site Keyring does not connect to is refused in words, and never called', async () => {
    const scan = jest.spyOn(vtaAgent, 'scanHostOffer')
    const route = routeKeyringAgentLink(
      qr({ vta_did: vtaDid, callback_url: 'https://vtafarm-api.example.com/cb/x' }),
      {} as never,
      jest.fn()
    )
    await expect(route).rejects.toBeInstanceOf(KeyringLinkError)
    await expect(route).rejects.toThrow(/site Keyring doesn.t connect to/)
    expect(scan).not.toHaveBeenCalled()
  })

  it('a QR that is not quite one is explained, not routed', async () => {
    await expect(
      routeKeyringAgentLink(qr({ vta_did: vtaDid, callback_url: callback, extra: 1 }), {} as never, jest.fn())
    ).rejects.toBeInstanceOf(KeyringLinkError)
  })

  describe('on a phone already linked to another agent', () => {
    const linkedTo = (did: string) =>
      controller.set({
        link: {
          kind: 'linked',
          vtaDid: did,
          label: 'x',
          linkedAt: '2026-10-01T00:00:00Z',
          connection: { kind: 'online', since: 0 },
        },
        agents: [{ vtaDid: did, label: 'x' }],
      })
    afterEach(() => controller.set({ agents: undefined }))

    it("adds the host's agent beside it: the current one is left first, then the person is asked", async () => {
      linkedTo('did:webvh:Qm:other')
      const order: string[] = []
      jest.spyOn(vtaAgent, 'startAddingAgent').mockImplementation(async () => {
        order.push('add')
        controller.set({ link: { kind: 'notLinked' } })
      })
      const scan = jest.spyOn(vtaAgent, 'scanHostOffer').mockImplementation(() => {
        order.push('ask')
      })
      const navigate = jest.fn()
      await routeKeyringAgentLink(qr({ vta_did: vtaDid, callback_url: callback }), {} as never, navigate)
      expect(order).toEqual(['add', 'ask'])
      expect(scan).toHaveBeenCalledWith({ vtaDid, callbackUrl: callback, host: 'vtafarm-api.ic3.dev' })
      expect(navigate).toHaveBeenCalledWith('VtaLink')
    })

    it('a code for the agent this phone already has is said so, and nothing starts', async () => {
      linkedTo(vtaDid)
      const add = jest.spyOn(vtaAgent, 'startAddingAgent').mockResolvedValue(undefined)
      const scan = jest.spyOn(vtaAgent, 'scanHostOffer')
      await expect(
        routeKeyringAgentLink(qr({ vta_did: vtaDid, callback_url: callback }), {} as never, jest.fn())
      ).rejects.toThrow(/already has that agent/)
      expect(add).not.toHaveBeenCalled()
      expect(scan).not.toHaveBeenCalled()
    })

    it('a code from a site Keyring does not connect to leaves the current agent where it was', async () => {
      linkedTo('did:webvh:Qm:other')
      const add = jest.spyOn(vtaAgent, 'startAddingAgent').mockResolvedValue(undefined)
      await expect(
        routeKeyringAgentLink(
          qr({ vta_did: vtaDid, callback_url: 'https://vtafarm-api.example.com/cb/x' }),
          {} as never,
          jest.fn()
        )
      ).rejects.toBeInstanceOf(KeyringLinkError)
      expect(add).not.toHaveBeenCalled()
    })
  })
})
