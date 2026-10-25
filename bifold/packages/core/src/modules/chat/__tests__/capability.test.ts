import { CHAT_MIN_RCE_VERSION, counterpartySpeaksChat } from '../capability'
import { RelationshipDidRepository } from '../../vrc/repositories/RelationshipDidRepository'

function makeAgent(options: { theirDid?: string; rceVersion?: number; lookupFails?: boolean }) {
  const repository = {
    findByConnectionDid: jest.fn(async () => {
      if (options.lookupFails) throw new Error('store unavailable')
      return options.rceVersion === undefined ? null : { counterpartyRceVersion: options.rceVersion }
    }),
  }
  return {
    context: {},
    modules: {
      didcomm: { connections: { getById: jest.fn(async () => ({ id: 'conn-1', theirDid: options.theirDid })) } },
    },
    dependencyManager: {
      resolve: (token: unknown) => {
        if (token === RelationshipDidRepository) return repository
        throw new Error('unexpected token')
      },
    },
  } as never
}

describe('counterpartySpeaksChat', () => {
  it('is version 6', () => {
    expect(CHAT_MIN_RCE_VERSION).toBe(6)
  })

  it('is true only for a contact that announced version 6 or later', async () => {
    expect(await counterpartySpeaksChat(makeAgent({ theirDid: 'did:peer:x', rceVersion: 6 }), 'conn-1')).toBe(true)
    expect(await counterpartySpeaksChat(makeAgent({ theirDid: 'did:peer:x', rceVersion: 7 }), 'conn-1')).toBe(true)
    expect(await counterpartySpeaksChat(makeAgent({ theirDid: 'did:peer:x', rceVersion: 5 }), 'conn-1')).toBe(false)
  })

  it('treats a missing announcement, a missing record or a failed lookup as no', async () => {
    expect(await counterpartySpeaksChat(makeAgent({ theirDid: 'did:peer:x' }), 'conn-1')).toBe(false)
    expect(await counterpartySpeaksChat(makeAgent({}), 'conn-1')).toBe(false)
    expect(await counterpartySpeaksChat(makeAgent({ theirDid: 'did:peer:x', lookupFails: true }), 'conn-1')).toBe(false)
  })
})
