/**
 * A link from outside the app — the `did` scheme the phone's camera opens —
 * routed like a scan from the QR tab, with the person told what happened.
 * The routing is vtiLinks' own; only the network lookup is faked.
 */
import { communityTarget } from '../module/vtiCommunityLink'
import { openKeyringLink, type KeyringLinkNotice } from '../module/keyringLinkOpen'

const mockClassify = jest.fn()
jest.mock('../module/classifyDid', () => ({
  ...jest.requireActual('../module/classifyDid'),
  classifyDid: (...a: unknown[]) => mockClassify(...a),
}))
jest.mock('../module/VtiCommunityStore', () => ({
  GenericRecordsCommunityStore: jest.fn(() => ({ saveInvitation: jest.fn(async () => undefined) })),
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('../module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: jest.fn(() => ({ getPersona: async () => undefined })),
}))

const community = 'did:webvh:QmCommunity:vtc.example.org'
const agent = {} as never

async function open(link: string) {
  const notices: KeyringLinkNotice[] = []
  const navigate = jest.fn()
  await openKeyringLink(link, agent, navigate, (n) => notices.push(n))
  return { notices, navigate }
}

describe('a did: code from the camera', () => {
  beforeEach(() => {
    communityTarget.clear()
    mockClassify.mockReset()
  })

  it("a community's code: says it is reading, then opens Join on that community", async () => {
    mockClassify.mockResolvedValue({ kind: 'community' })
    const { notices, navigate } = await open(community)
    expect(notices).toEqual([{ kind: 'reading' }, { kind: 'opened' }])
    expect(navigate).toHaveBeenCalledWith('VtiJoin')
    expect(communityTarget.get()?.communityDid).toBe(community)
  })

  it('a code nobody has: says so, in the words the scanner shows, and goes nowhere', async () => {
    mockClassify.mockResolvedValue({ kind: 'unresolvable', reason: 'notFound' })
    const { notices, navigate } = await open(community)
    expect(notices).toEqual([
      { kind: 'reading' },
      { kind: 'unusable', message: 'No agent or community has this code.' },
    ])
    expect(navigate).not.toHaveBeenCalled()
  })

  it('a failure that is not ours to word still tells the person something', async () => {
    mockClassify.mockRejectedValue(new Error('socket hang up'))
    const { notices } = await open(community)
    expect(notices.at(-1)).toEqual({ kind: 'unusable', message: undefined })
  })

  it('a link read from itself does not claim to be looking anything up', async () => {
    const { notices, navigate } = await open(
      `keyring://vti/community?d=${encodeURIComponent(community)}&n=${encodeURIComponent('Lab')}`
    )
    expect(notices).toEqual([{ kind: 'opened' }])
    expect(navigate).toHaveBeenCalledWith('VtiJoin')
    expect(mockClassify).not.toHaveBeenCalled()
  })
})

describe("a community admin console's invitation QR", () => {
  it('says it is reading while the offer is redeemed, and says why when it cannot be', async () => {
    const offer = {
      credential_configuration_ids: ['VIC'],
      credential_issuer: community,
      grants: { 'urn:ietf:params:oauth:grant-type:pre-authorized_code': { 'pre-authorized_code': 'pac_3' } },
    }
    const { notices, navigate } = await open(
      `openid-credential-offer://?credential_offer=${encodeURIComponent(JSON.stringify(offer))}`
    )
    // No identity for that community on this phone: nothing to redeem it as.
    expect(notices[0]).toEqual({ kind: 'reading' })
    expect(notices.at(-1)).toEqual({ kind: 'unusable', message: expect.stringMatching(/I was invited/) })
    expect(navigate).not.toHaveBeenCalled()
  })
})
