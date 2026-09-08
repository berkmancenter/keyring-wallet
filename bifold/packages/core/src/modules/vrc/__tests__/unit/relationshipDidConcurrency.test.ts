/**
 * Regression test for the relationshipDid concurrency hazard: the
 * find-then-create in getOrCreateRelationshipDid awaits between the find and
 * the create, so two concurrent callers (connection handler, trust-task
 * proposer, issuance trigger) could each miss the other's find and mint
 * DIVERGENT DIDs for one counterparty — one announced to the peer, another
 * baked into a credential. In-flight creations are now shared per
 * counterparty DID.
 */
import { getOrCreateRelationshipDid } from '../../vrc-manager'
import { RelationshipDidRepository } from '../../repositories/RelationshipDidRepository'

jest.mock('../../witnessed-vrc-manager', () => ({
  WitnessedVRCManager: jest.fn().mockImplementation(() => ({})),
}))

function makeFakeAgent() {
  const stored = new Map<string, string>()
  let created = 0
  const repository = {
    findByConnectionDid: jest.fn(async (_ctx: unknown, counterpartyDid: string) => {
      const myRelationshipDid = stored.get(counterpartyDid)
      return myRelationshipDid ? { myRelationshipDid } : null
    }),
    createOrUpdate: jest.fn(async (_ctx: unknown, counterpartyDid: string, relationshipDid: string) => {
      stored.set(counterpartyDid, relationshipDid)
    }),
  }
  const agent = {
    context: {},
    config: { logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } },
    dependencyManager: {
      resolve: (token: unknown) => {
        if (token === RelationshipDidRepository) return repository
        throw new Error('unexpected token')
      },
    },
    dids: {
      create: jest.fn(async () => {
        const ordinal = ++created
        // yield so a concurrent caller can interleave — the race window
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { didState: { did: `did:peer:0zCreated${ordinal}` } }
      }),
    },
  }
  return { agent: agent as never, repository, createdCount: () => created }
}

describe('getOrCreateRelationshipDid under concurrency', () => {
  test('two concurrent callers share one creation and get the same DID', async () => {
    const { agent, createdCount } = makeFakeAgent()

    const [first, second] = await Promise.all([
      getOrCreateRelationshipDid(agent, 'did:peer:4counterparty', 'conn-1'),
      getOrCreateRelationshipDid(agent, 'did:peer:4counterparty', 'conn-1'),
    ])

    expect(first).toBe(second)
    expect(createdCount()).toBe(1)
  })

  test('different counterparties still create independently', async () => {
    const { agent, createdCount } = makeFakeAgent()

    const [a, b] = await Promise.all([
      getOrCreateRelationshipDid(agent, 'did:peer:4alpha', 'conn-a'),
      getOrCreateRelationshipDid(agent, 'did:peer:4beta', 'conn-b'),
    ])

    expect(a).not.toBe(b)
    expect(createdCount()).toBe(2)
  })

  test('a later call reuses the stored DID rather than creating again', async () => {
    const { agent, createdCount } = makeFakeAgent()

    const first = await getOrCreateRelationshipDid(agent, 'did:peer:4gamma', 'conn-g')
    const again = await getOrCreateRelationshipDid(agent, 'did:peer:4gamma', 'conn-g')

    expect(again).toBe(first)
    expect(createdCount()).toBe(1)
  })
})
