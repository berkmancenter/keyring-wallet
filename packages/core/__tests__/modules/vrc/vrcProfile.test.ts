/** The explicit credential profile on buildVrcCredential (relationship-over-TSP plan, WP8). */
import { buildVrcCredential } from '../../../src/modules/vrc/vrc-manager'
import { SHARED_CONNECT_VRC_PROFILE } from '../../../src/modules/trust-tasks/module/sharedConnectDecisions'

const MINE = 'did:peer:0z6MkIssuer000000000000000000000000000000000000'
const THEIRS = 'did:peer:0z6MkSubject00000000000000000000000000000000000'

// No RelationshipDidRepository: a profile must not consult the peer's RCE announcement.
const agent = {
  context: {},
  config: { logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
  dependencyManager: {
    resolve: jest.fn(() => {
      throw new Error('the profile path must not look up the peer')
    }),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

describe('buildVrcCredential with the shared-connect profile', () => {
  it('is VCDM 2.0 with no validUntil, no evidence context and a bare issuer', async () => {
    const { credential } = await buildVrcCredential(agent, MINE, THEIRS, SHARED_CONNECT_VRC_PROFILE)
    expect(credential['@context'][0]).toBe('https://www.w3.org/ns/credentials/v2')
    expect(credential['@context']).toHaveLength(2)
    expect(credential.validUntil).toBeUndefined()
    expect(credential.expirationDate).toBeUndefined()
    expect(credential.issuer).toBe(MINE)
    expect(credential.issuerScope).toBe('pairwise')
    expect(credential.credentialSubject).toEqual({ id: THEIRS })
    expect(typeof credential.validFrom).toBe('string')
  })

  it('keeps validUntil and the evidence context when the profile asks', async () => {
    const { credential } = await buildVrcCredential(agent, MINE, THEIRS, {
      ...SHARED_CONNECT_VRC_PROFILE,
      validUntil: true,
      evidence: true,
    })
    expect(credential.validUntil).toBeDefined()
    expect(credential['@context']).toHaveLength(3)
  })
})
