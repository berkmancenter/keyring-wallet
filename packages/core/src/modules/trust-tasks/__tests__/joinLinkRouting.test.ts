/**
 * A community's join code as a link (IN-702), through the routing a scan, a paste and an opened link share: the join
 * goal code opens Join for the community the code is from, and any other goal code takes the path it took before.
 * The reader itself is in joinLink.test.ts.
 */
import { JsonEncoder } from '@credo-ts/core'

import { connectFromScanOrDeepLink } from '../../../utils/helpers'
import { openKeyringLink, type KeyringLinkNotice } from '../module/keyringLinkOpen'
import { vtaAgent } from '../module/vtaAgent'
import { vtiAgent } from '../module/vtiAgent'
import { communityTarget } from '../module/vtiCommunityLink'
import {
  JOIN_LINK_WORDS,
  KeyringLinkError,
  LinkNotOurs,
  communityLinkReturn,
  keyringAgentLinkKind,
  routeKeyringAgentLink,
} from '../module/vtiLinks'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
const mockVerify = jest.fn()
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  verifyDocumentProof: (...a: unknown[]) => mockVerify(...a),
}))

const community = 'did:webvh:QmJoinCode:vtc.example.org'
const JOIN = 'https://trusttasks.org/spec/vtc/join-requests/submit/0.3'
const SIGN_IN = 'https://trusttasks.org/spec/auth/oob/identify/0.1'
const MANIFEST = 'https://trusttasks.org/spec/vtc/join-requests/manifest'
const joinLink = 'https://vtc.example.org/?iuv=1&_oobid=VGVlndZFAQ0UyEOWRi5rkw'

const manifestDocument = () => ({
  type: `${MANIFEST}/0.4#response`,
  issuer: community,
  issuedAt: new Date().toISOString(),
  payload: {
    communityDid: community,
    criteria: [{ id: 'review', admission: 'review' }],
    branding: { displayName: 'Example Commons' },
  },
  proof: { type: 'DataIntegrityProof', verificationMethod: `${community}#key-0`, proofValue: 'z5Pf3' },
})
const invitation = (over: Record<string, unknown> = {}) => ({
  type: 'https://didcomm.org/out-of-band/2.0/invitation',
  id: 'VGVlndZFAQ0UyEOWRi5rkw',
  from: community,
  body: { accept: ['didcomm/v2'], goal: 'Join this community', goal_code: JOIN },
  expires_time: Math.floor(Date.now() / 1000) + 86_400,
  protocols: { didcomm: joinLink },
  ...over,
})
const otherGoal = () => invitation({ body: { accept: ['didcomm/v2'], goal_code: SIGN_IN } })
const inline = (json: unknown) => `didcomm://?_oob=${JsonEncoder.toBase64Url(json as never)}`

/** What the link's host answers when asked. Undefined: no answer at all. */
let answer: unknown
const asked = jest.fn(async (_url: string, _init?: RequestInit) => {
  if (answer === undefined) throw new Error('network down')
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(answer),
  }
})

const doc = (types: string[]) => ({ id: community, service: types.map((type) => ({ type })) })
const COMMUNITY_DOC = doc(['VTCRest', 'VTCStatusList'])
const AGENT_DOC = doc(['VTARest'])
/** An agent whose resolver answers `document` for any DID, and whose DIDComm side records what it is handed. */
function agentResolving(document: unknown) {
  const parseInvitation = jest.fn(async (_link: string) => {
    throw new Error('the contact path was taken')
  })
  const agent = {
    dids: { resolve: jest.fn(async () => ({ didDocument: document })) },
    config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
    modules: { didcomm: { oob: { parseInvitation } } },
  }
  return { agent: agent as never, parseInvitation, resolve: agent.dids.resolve }
}

const realFetch = global.fetch
beforeEach(() => {
  answer = undefined
  asked.mockClear()
  mockVerify.mockReset()
  mockVerify.mockResolvedValue(true)
  global.fetch = asked as unknown as typeof fetch
  communityTarget.clear()
  communityLinkReturn.take()
  ;(vtaAgent as unknown as { set(next: Record<string, unknown>): void }).set({ link: { kind: 'notLinked' } })
})
afterEach(() => {
  global.fetch = realFetch
  jest.restoreAllMocks()
})

describe('recognising a join code', () => {
  it('claims a link to ask, an inline join invitation and anything under web+interaction:', () => {
    expect(keyringAgentLinkKind(joinLink)).toBe('joinLink')
    expect(keyringAgentLinkKind('https://vtc.example.org/join?_oobid=abc')).toBe('joinLink')
    expect(keyringAgentLinkKind(`web+interaction:${joinLink}`)).toBe('joinLink')
    expect(keyringAgentLinkKind('web+interaction:whatever')).toBe('joinLink')
    expect(keyringAgentLinkKind(inline(invitation()))).toBe('joinLink')
    // Recognising a link asks nobody.
    expect(asked).not.toHaveBeenCalled()
  })

  it('control: an inline invitation with any other goal, and every other invitation link, is not claimed', () => {
    expect(keyringAgentLinkKind(inline(otherGoal()))).toBeUndefined()
    expect(keyringAgentLinkKind('didcomm://invite?_oob=eyJ0')).toBeUndefined()
    expect(keyringAgentLinkKind('https://mediator.example/?oob=eyJ0')).toBeUndefined()
    expect(keyringAgentLinkKind('https://wallet.asml.berkmancenter.org/i/abc123')).toBeUndefined()
  })

  it('control: a trigger link stays a trigger link, whatever its query says', () => {
    expect(keyringAgentLinkKind(`${joinLink}#_from=did:webvh:Qm:host&_id=abc&_type=sign-in`)).toBe('triggerLink')
  })
})

describe('a join code, routed', () => {
  it('the join goal code opens Join for the community it is from, and the contact path is never taken', async () => {
    answer = invitation()
    const { agent, parseInvitation } = agentResolving(COMMUNITY_DOC)
    const navigate = jest.fn()
    await routeKeyringAgentLink(joinLink, agent, navigate)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('VtiJoin')
    expect(communityTarget.get()?.communityDid).toBe(community)
    // The name is the community's to publish: none is taken from the link.
    expect(communityTarget.get()?.name).toBeUndefined()
    expect(asked).toHaveBeenCalledTimes(1)
    expect(asked.mock.calls[0][0]).toBe(joinLink)
    expect(parseInvitation).not.toHaveBeenCalled()
  })

  it('control: any other goal code is handed on as not ours; nothing opens and no community is chosen', async () => {
    answer = otherGoal()
    const { agent, resolve } = agentResolving(COMMUNITY_DOC)
    const navigate = jest.fn()
    await expect(routeKeyringAgentLink(joinLink, agent, navigate)).rejects.toBeInstanceOf(LinkNotOurs)
    expect(navigate).not.toHaveBeenCalled()
    expect(communityTarget.get()).toBeUndefined()
    // Nothing was looked up for it either.
    expect(resolve).not.toHaveBeenCalled()
  })

  it('a link that could not be read is handed on too: whatever read it before says what it always said', async () => {
    const { agent } = agentResolving(COMMUNITY_DOC)
    await expect(routeKeyringAgentLink(joinLink, agent, jest.fn())).rejects.toBeInstanceOf(LinkNotOurs)
  })

  it('the same code under web+interaction: opens Join; with another goal it is answered in words', async () => {
    answer = invitation()
    const { agent } = agentResolving(COMMUNITY_DOC)
    const navigate = jest.fn()
    await routeKeyringAgentLink(`web+interaction:${joinLink}`, agent, navigate)
    expect(navigate).toHaveBeenCalledWith('VtiJoin')
    expect(asked.mock.calls[0][0]).toBe(joinLink)

    answer = otherGoal()
    const failure = await routeKeyringAgentLink(`web+interaction:${joinLink}`, agent, jest.fn()).catch((e) => e)
    expect(failure).toBeInstanceOf(KeyringLinkError)
    expect(failure.message).toBe(JOIN_LINK_WORDS.cantUse)

    answer = undefined
    const unread = await routeKeyringAgentLink(`web+interaction:${joinLink}`, agent, jest.fn()).catch((e) => e)
    expect(unread).toBeInstanceOf(KeyringLinkError)
    expect(unread.message).toBe(JOIN_LINK_WORDS.unreadable)

    const nothing = await routeKeyringAgentLink('web+interaction:whatever', agent, jest.fn()).catch((e) => e)
    expect(nothing.message).toBe(JOIN_LINK_WORDS.cantUse)
  })

  it('an inline join invitation opens Join with nobody asked', async () => {
    const { agent } = agentResolving(COMMUNITY_DOC)
    const navigate = jest.fn()
    await routeKeyringAgentLink(inline(invitation()), agent, navigate)
    expect(navigate).toHaveBeenCalledWith('VtiJoin')
    expect(communityTarget.get()?.communityDid).toBe(community)
    expect(asked).not.toHaveBeenCalled()
  })

  it('brought for "I was invited", it lands back there', async () => {
    answer = invitation()
    communityLinkReturn.toInvited()
    const navigate = jest.fn()
    await routeKeyringAgentLink(joinLink, agentResolving(COMMUNITY_DOC).agent, navigate)
    expect(navigate).toHaveBeenCalledWith('VtiInvited')
  })

  it('an expired join code says so, and is not handed on', async () => {
    answer = invitation({ expires_time: Math.floor(Date.now() / 1000) - 60 })
    const failure = await routeKeyringAgentLink(joinLink, agentResolving(COMMUNITY_DOC).agent, jest.fn()).catch(
      (e) => e
    )
    expect(failure).toBeInstanceOf(KeyringLinkError)
    expect(failure.message).toBe(JOIN_LINK_WORDS.expired)
  })

  it('a join code from a DID that is an agent, or no community at all, joins nothing and links nothing', async () => {
    const startManualLink = jest.spyOn(vtaAgent, 'startManualLink')
    answer = invitation()
    for (const document of [AGENT_DOC, doc(['DIDCommMessaging'])]) {
      const navigate = jest.fn()
      const failure = await routeKeyringAgentLink(joinLink, agentResolving(document).agent, navigate).catch((e) => e)
      expect(failure).toBeInstanceOf(KeyringLinkError)
      expect(failure.message).toBe(JOIN_LINK_WORDS.notACommunity)
      expect(navigate).not.toHaveBeenCalled()
    }
    answer = invitation({ from: 'did:peer:2.Ez6LSabc' })
    const peer = await routeKeyringAgentLink(joinLink, agentResolving(COMMUNITY_DOC).agent, jest.fn()).catch((e) => e)
    expect(peer.message).toBe(JOIN_LINK_WORDS.notACommunity)
    expect(startManualLink).not.toHaveBeenCalled()
    expect(communityTarget.get()).toBeUndefined()
  })

  it('a code both an agent and a community answer to is joined: the code asked to join', async () => {
    answer = invitation()
    const navigate = jest.fn()
    await routeKeyringAgentLink(joinLink, agentResolving(doc(['VTARest', 'VTCRest'])).agent, navigate)
    expect(navigate).toHaveBeenCalledWith('VtiJoin')
  })
})

describe('the manifest a join code brings, routed', () => {
  const withManifest = () => invitation({ attachments: [{ id: 'manifest', data: { json: manifestDocument() } }] })

  it('a manifest whose proof verifies under the community’s DID is handed to Join; the name it publishes is learned', async () => {
    const handed = jest.spyOn(vtiAgent, 'manifestFromLink')
    answer = withManifest()
    const { agent } = agentResolving(COMMUNITY_DOC)
    await routeKeyringAgentLink(joinLink, agent, jest.fn())
    expect(mockVerify).toHaveBeenCalledWith(agent, expect.objectContaining({ issuer: community }), community)
    expect(handed).toHaveBeenCalledTimes(1)
    expect(handed.mock.calls[0][0]).toBe(community)
    expect(handed.mock.calls[0][2].criteria.map((c) => c.id)).toEqual(['review'])
    expect(communityTarget.get()).toMatchObject({ communityDid: community, name: 'Example Commons', published: true })
  })

  it('control: one whose proof does not verify is dropped, and Join still opens to read the community itself', async () => {
    const handed = jest.spyOn(vtiAgent, 'manifestFromLink')
    mockVerify.mockResolvedValue(false)
    answer = withManifest()
    const navigate = jest.fn()
    await routeKeyringAgentLink(joinLink, agentResolving(COMMUNITY_DOC).agent, navigate)
    expect(handed).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('VtiJoin')
    expect(communityTarget.get()?.name).toBeUndefined()
  })

  it('none is looked at for a DID that is not a community', async () => {
    answer = withManifest()
    await routeKeyringAgentLink(joinLink, agentResolving(AGENT_DOC).agent, jest.fn()).catch(() => undefined)
    expect(mockVerify).not.toHaveBeenCalled()
  })
})

describe('the scanner and the paste screen', () => {
  const navigation = { navigate: jest.fn() }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never
  beforeEach(() => navigation.navigate.mockClear())

  it('the join goal code opens Join in the My Agent stack', async () => {
    answer = invitation()
    const { agent, parseInvitation } = agentResolving(COMMUNITY_DOC)
    await connectFromScanOrDeepLink(joinLink, agent, logger, navigation, false)
    expect(navigation.navigate).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(navigation.navigate.mock.calls[0])).toContain('Join')
    expect(parseInvitation).not.toHaveBeenCalled()
  })

  it('control: any other goal code takes the path it took before, with the link untouched', async () => {
    answer = otherGoal()
    const { agent, parseInvitation } = agentResolving(COMMUNITY_DOC)
    await expect(connectFromScanOrDeepLink(joinLink, agent, logger, navigation, false)).rejects.toThrow(
      'the contact path was taken'
    )
    expect(parseInvitation).toHaveBeenCalledWith(joinLink)
    expect(navigation.navigate).not.toHaveBeenCalled()
    expect(communityTarget.get()).toBeUndefined()
  })

  it('a join code that cannot be used is said in words, and never reaches the contact path', async () => {
    answer = invitation({ from: 'did:peer:2.Ez6LSabc' })
    const { agent, parseInvitation } = agentResolving(COMMUNITY_DOC)
    await expect(connectFromScanOrDeepLink(joinLink, agent, logger, navigation, false)).rejects.toBeInstanceOf(
      KeyringLinkError
    )
    expect(parseInvitation).not.toHaveBeenCalled()
  })
})

describe('a join code opened from outside the app', () => {
  async function open(link: string, agent: never) {
    const notices: KeyringLinkNotice[] = []
    const navigate = jest.fn()
    await openKeyringLink(link, agent, navigate, (n) => notices.push(n))
    return { notices, navigate }
  }

  it('web+interaction: says it is reading, then opens Join', async () => {
    answer = invitation()
    const { notices, navigate } = await open(`web+interaction:${joinLink}`, agentResolving(COMMUNITY_DOC).agent)
    expect(notices).toEqual([{ kind: 'reading' }, { kind: 'opened' }])
    expect(navigate).toHaveBeenCalledWith('VtiJoin')
  })

  it('one that cannot be used says why', async () => {
    answer = otherGoal()
    const { notices, navigate } = await open(`web+interaction:${joinLink}`, agentResolving(COMMUNITY_DOC).agent)
    expect(notices).toEqual([{ kind: 'reading' }, { kind: 'unusable', message: JOIN_LINK_WORDS.cantUse }])
    expect(navigate).not.toHaveBeenCalled()
  })

  it('control: a link that is not ours after all does what it did before: nothing, and no error is shown', async () => {
    answer = otherGoal()
    const { notices, navigate } = await open(joinLink, agentResolving(COMMUNITY_DOC).agent)
    expect(notices).toEqual([{ kind: 'reading' }, { kind: 'opened' }])
    expect(navigate).not.toHaveBeenCalled()
  })
})
