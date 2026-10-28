/**
 * Reading the agent's cards for "Bring back" asks the vault for each card one
 * at a time (#401 re-time: 88 cards, ~40 s). A card already on the phone is
 * not asked for, and one read earlier this app session is not read again. The
 * reads live in memory only and go when the wallet locks or the person logs
 * out. Every card is still checked on every run: one its community has
 * withdrawn since it was read is refused, through the delivered-card check's
 * status read, as before.
 */
import { DeviceEventEmitter } from 'react-native'

import {
  fakeAgent,
  fakeCommunityStore,
  fakeVault,
  membershipCard,
  persona,
  roleCard,
} from '../../../../__tests__/helpers/cardVault'
import { WALLET_LOCKED_EVENT } from '../../../utils/walletLocked'
import {
  cardsOnPhone,
  fetchAgentCards,
  recoverCardsFromAgent,
  resetCardVaultCache,
  VAULT_GET,
  VAULT_GET_02,
} from '../module/vtiCardVault'

const mockVerify = jest.fn()
const mockStatus = jest.fn()
jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  verifyDocumentProof: (...a: unknown[]) => mockVerify(...a),
}))
jest.mock('../module/vtiStatusList', () => ({
  ...jest.requireActual('../module/vtiStatusList'),
  checkCredentialStatus: (...a: unknown[]) => mockStatus(...a),
}))

// Inside the fixture cards' validity (2026-09-26 to 2026-10-26), for the real delivered-card check.
const NOW = new Date('2026-10-01T09:00:00Z')
const status = (state: 'ok' | 'revoked') => ({ state, checkedAt: NOW.toISOString(), index: 1, purpose: 'revocation' })

async function agentKeeping(...cards: Record<string, unknown>[]) {
  const vault = fakeVault()
  for (const credential of cards) await vault.task('vault/credentials/receive/0.1', { credential })
  return vault
}
// A card read at either version of vault/credentials/get.
const isGet = (type: string) => type === VAULT_GET || type === VAULT_GET_02
const gets = (vault: ReturnType<typeof fakeVault>) => vault.calls.filter((c) => isGet(c.type)).length

beforeEach(() => {
  resetCardVaultCache()
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'] })
  mockVerify.mockReset().mockResolvedValue(true)
  mockStatus.mockReset().mockResolvedValue(status('ok'))
})
afterEach(() => jest.useRealTimers())

describe("reading the agent's cards", () => {
  it('a second read this session asks the vault for no card it has read', async () => {
    const vault = await agentKeeping(membershipCard, roleCard)
    const first = await fetchAgentCards(vault.task)
    expect(gets(vault)).toBe(2)
    const again = await fetchAgentCards(vault.task)
    expect(gets(vault)).toBe(2)
    expect(again).toEqual(first)
  })

  it('a card already on this phone is not asked for', async () => {
    const vault = await agentKeeping(membershipCard, roleCard)
    const { store } = fakeCommunityStore({
      memberships: [
        {
          communityDid: persona.communityDid,
          personaDid: persona.did,
          role: 'member',
          vmc: membershipCard,
          grantedAt: membershipCard.validFrom,
          via: 'unknown',
        },
      ],
    })
    const onPhone = await cardsOnPhone(store)
    expect([...onPhone.keys()]).toEqual([membershipCard.id])
    const cards = await fetchAgentCards(vault.task, undefined, onPhone)
    expect(vault.calls.filter((c) => isGet(c.type)).map((c) => c.payload)).toEqual([{ id: roleCard.id }])
    expect(cards.find((c) => c.id === membershipCard.id)?.credential).toBe(membershipCard)
  })

  it('the wallet locking, or the person logging out, drops what was read', async () => {
    const vault = await agentKeeping(membershipCard, roleCard)
    await fetchAgentCards(vault.task)
    DeviceEventEmitter.emit(WALLET_LOCKED_EVENT, 'Timeout')
    await fetchAgentCards(vault.task)
    expect(gets(vault)).toBe(4)
  })

  it('a card the vault did not give back is asked for again next time', async () => {
    const vault = await agentKeeping(membershipCard)
    const failing = (async (type: string, payload: Record<string, unknown>) => {
      if (isGet(type)) throw new Error('no answer')
      return vault.task(type, payload)
    }) as typeof vault.task
    expect((await fetchAgentCards(failing))[0].credential).toBeUndefined()
    await fetchAgentCards(vault.task)
    expect(gets(vault)).toBe(1)
  })
})

describe('a card read earlier this session is still checked', () => {
  it('one its community has withdrawn since is refused, through the status check, and not kept', async () => {
    const vault = await agentKeeping(membershipCard)
    const first = await recoverCardsFromAgent(fakeAgent().agent, fakeCommunityStore().store, persona, vault.task)
    expect(first.restored).toEqual([membershipCard.id])

    mockStatus.mockResolvedValue(status('revoked'))
    const { store, memberships } = fakeCommunityStore()
    const again = await recoverCardsFromAgent(fakeAgent().agent, store, persona, vault.task)
    expect(gets(vault)).toBe(1)
    expect(mockStatus).toHaveBeenCalledTimes(2)
    expect(again.restored).toEqual([])
    expect(again.refused).toEqual([
      { credentialId: membershipCard.id, communityDid: persona.communityDid, reason: 'failedCheck' },
    ])
    expect(memberships.size).toBe(0)
  })
})
