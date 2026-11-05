/**
 * Which identity the rooms and polls backends act as (IN-517, #938). With none, or with one whose keys are not on
 * the phone yet, nothing is asked of the community, and the refusal is named so the screens say what happened: the
 * session would otherwise fail at its sign-in and be read as a community that didn't answer.
 */
const mockHolding = jest.fn(async (..._a: unknown[]) => 'asked')
let mockPersona: Record<string, unknown> | undefined
jest.mock('../../trust-tasks/module/VtiIdentityStore', () => ({
  GenericRecordsIdentityStore: class {
    async getPersona() {
      return mockPersona
    }
    async listPersonas() {
      return mockPersona ? [mockPersona] : []
    }
    async setPersona() {
      return undefined
    }
  },
}))
jest.mock('../../trust-tasks/module/VtiCommunityStore', () => ({
  ...jest.requireActual('../../trust-tasks/module/VtiCommunityStore'),
  GenericRecordsCommunityStore: class {
    async listMemberships() {
      return []
    }
  },
}))
jest.mock('../../trust-tasks/module/vtiJoin', () => ({ leaveCommunity: jest.fn() }))
jest.mock('../../trust-tasks/module/vtiVetting', () => ({ GenericRecordsVettingStore: class {} }))
jest.mock('../../trust-tasks/module/vtiAgent', () => ({
  vtiAgent: { holding: (...a: unknown[]) => mockHolding(...a), communityTask: jest.fn() },
}))
jest.mock('../../trust-tasks/module/vtaAgent', () => ({ vtaAgent: {} }))
jest.mock('../../trust-tasks/module/vtiTsp', () => ({ GenericRecordsTspPeerRevisionStore: class {} }))

import { createAgentPollsBackend } from '../../polls/agentPollsBackend'
import { createAgentRoomsBackend } from '../real/agentRoomsBackend'

const agent = { config: { logger: { warn: jest.fn(), info: jest.fn() } } } as never
const COMMUNITY = 'did:webvh:c:test-vtc'
const LIST = 'https://trusttasks.org/spec/vtc/rooms/memberships/list/0.1'
const POLLS = 'https://trusttasks.org/spec/vtc/elections/list/0.5'
const persona = (kmsKeyIds?: Record<string, string>) => ({
  did: 'did:webvh:p:airport',
  communityDid: COMMUNITY,
  vtaDid: 'did:webvh:a:agent',
  vtaKeyIds: { signing: 's', keyAgreement: 'k' },
  ...(kmsKeyIds ? { kmsKeyIds } : {}),
})

beforeEach(() => {
  mockHolding.mockClear()
  mockPersona = undefined
})

describe.each([
  ['rooms', () => createAgentRoomsBackend(agent).communityTask(COMMUNITY, LIST, {})],
  ['polls', () => createAgentPollsBackend(agent).communityTask(COMMUNITY, POLLS, {})],
])('the %s backend', (_name, ask) => {
  it('no identity for the community: refuses by name, and opens no session', async () => {
    await expect(ask()).rejects.toMatchObject({ name: 'VtiNoIdentity' })
    expect(mockHolding).not.toHaveBeenCalled()
  })

  it('an identity whose keys are not on the phone yet: refuses by name, and opens no session', async () => {
    mockPersona = persona()
    await expect(ask()).rejects.toMatchObject({ name: 'VtiKeysNotHeld' })
    expect(mockHolding).not.toHaveBeenCalled()
  })

  // A session needs only the key-agreement copy; without a signing one it still reads over DIDComm, as on main.
  it('an identity with its key-agreement copy only: asks, as before (control)', async () => {
    mockPersona = persona({ keyAgreement: 'vta-copy:k' })
    await expect(ask()).resolves.toBe('asked')
  })

  it('an identity with both copies: asks, as that identity (control)', async () => {
    mockPersona = persona({ keyAgreement: 'vta-copy:k', signing: 'vta-copy:s' })
    await expect(ask()).resolves.toBe('asked')
    expect(mockHolding.mock.calls[0][2]).toBe(mockPersona)
  })
})
