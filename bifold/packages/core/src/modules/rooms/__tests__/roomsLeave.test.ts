/**
 * Leaving a community from its own screen never told the rooms: My Agent kept "1 room", and the rooms read before
 * stayed (277.7, 11-03). Both ways of leaving now end in `afterLeavingCommunity`. It also logs what the leave left of
 * the community on this phone, read-only, by short identity ids: a membership card stayed in the Wallet after that
 * leave, and the line tells a record the leave failed to forget from one held as another identity.
 */
import { DeviceEventEmitter } from 'react-native'

import { afterLeavingCommunity } from '../roomsLeave'
import type { RoomsService } from '../types'
import { ROOMS_LEFT_EVENT } from '../useMyRooms'

const mockDropNames = jest.fn(async (_agent: unknown, _did: string) => undefined)
const mockKeepPhoto = jest.fn(async (_agent: unknown, _did: string, _sent: unknown) => undefined)
const mockRefreshRows = jest.fn()
jest.mock('../../directory/names', () => ({ dropDirectoryNames: (a: unknown, d: string) => mockDropNames(a, d) }))
jest.mock('../../directory/myPhoto', () => ({
  keepSentPhoto: (a: unknown, d: string, s: unknown) => mockKeepPhoto(a, d, s),
}))
jest.mock('../useRoomRows', () => ({ refreshRoomRows: () => mockRefreshRows() }))
jest.mock('../../trust-tasks/module/vtiWalletCards', () => ({
  isCommunityCard: (vc: { type?: string[] }) => !!vc.type?.includes('MembershipCredential'),
}))

const COMMUNITY = 'did:webvh:QmCommunity:example.org:first-vtc'
const OTHER = 'did:webvh:QmOther:example.org:garden'
const LEFT = 'did:webvh:QmLeftPersona0001:ids.example:element-garlic'
const KEPT = 'did:webvh:QmKeptPersona0002:ids.example:cash-twin'

const card = (issuer: unknown, subject: string) => ({
  credentialInstances: [
    {
      credential: {
        type: ['VerifiableCredential', 'DTGCredential', 'MembershipCredential'],
        issuer,
        credentialSubject: { id: subject },
      },
    },
  ],
})

function fakeAgent(records: Record<string, Record<string, unknown>[]>, wallet: unknown[]) {
  return {
    genericRecords: {
      findAllByQuery: jest.fn(async ({ kind }: { kind: string }) =>
        (records[kind] ?? []).map((content) => ({ content }))
      ),
      delete: jest.fn(),
      deleteById: jest.fn(),
    },
    w3cCredentials: { getAll: jest.fn(async () => wallet), deleteById: jest.fn() },
    config: { logger: { warn: jest.fn() } },
  }
}

const leaveLine = (agent: ReturnType<typeof fakeAgent>) =>
  agent.config.logger.warn.mock.calls.map(([line]) => String(line)).find((l) => l.startsWith('[Rooms:leave]'))

beforeEach(() => jest.clearAllMocks())

describe('after leaving a community', () => {
  it('drops its rooms everywhere at once, then its names and photo', async () => {
    const agent = fakeAgent({}, [])
    const leftCommunity = jest.fn()
    const service = { leftCommunity } as unknown as RoomsService
    const heard: string[] = []
    const sub = DeviceEventEmitter.addListener(ROOMS_LEFT_EVENT, (did: string) => heard.push(did))
    await afterLeavingCommunity(agent as never, COMMUNITY, service)
    sub.remove()

    expect(leftCommunity).toHaveBeenCalledWith(COMMUNITY)
    expect(heard).toEqual([COMMUNITY])
    expect(mockRefreshRows).toHaveBeenCalledTimes(1)
    expect(mockDropNames).toHaveBeenCalledWith(agent, COMMUNITY)
    expect(mockKeepPhoto).toHaveBeenCalledWith(agent, COMMUNITY, undefined)
  })

  it('still drops the rooms with no service, and when the names cannot be dropped', async () => {
    mockDropNames.mockRejectedValueOnce(new Error('locked'))
    const heard: string[] = []
    const sub = DeviceEventEmitter.addListener(ROOMS_LEFT_EVENT, (did: string) => heard.push(did))
    await afterLeavingCommunity(fakeAgent({}, []) as never, COMMUNITY)
    sub.remove()
    expect(heard).toEqual([COMMUNITY])
    expect(mockKeepPhoto).toHaveBeenCalled()
  })

  it('says a clear that failed, by the community’s short id and the kind alone, and still does the other', async () => {
    mockDropNames.mockRejectedValueOnce(new Error('locked'))
    mockKeepPhoto.mockRejectedValueOnce(new Error('store closed'))
    const agent = fakeAgent({}, [])
    await afterLeavingCommunity(agent as never, COMMUNITY)
    const lines = agent.config.logger.warn.mock.calls.map(([line]) => String(line))
    expect(lines).toContain('[Rooms:leave] member names for did:webvh:QmComm…irst-vtc not cleared: failed')
    expect(lines).toContain('[Rooms:leave] sent photo for did:webvh:QmComm…irst-vtc not cleared: failed')
    for (const line of lines) {
      expect(line).not.toContain(COMMUNITY)
      // An error's own words can name an identity (roomsLogWords).
      for (const words of ['locked', 'store closed']) expect(line).not.toContain(words)
    }
  })

  it('says nothing about the clears when both are done (control)', async () => {
    const agent = fakeAgent({}, [])
    await afterLeavingCommunity(agent as never, COMMUNITY)
    const lines = agent.config.logger.warn.mock.calls.map(([line]) => String(line))
    expect(lines.filter((l) => l.includes('not cleared'))).toEqual([])
  })

  it('logs what stays of the community, by short ids, and deletes nothing', async () => {
    const agent = fakeAgent(
      {
        departure: [{ communityDid: COMMUNITY, personaDid: LEFT }],
        membership: [
          { communityDid: COMMUNITY, personaDid: KEPT },
          { communityDid: OTHER, personaDid: LEFT },
        ],
        credential: [{ communityDid: COMMUNITY, subjectDid: KEPT }],
      },
      [card(COMMUNITY, KEPT), card({ id: COMMUNITY }, LEFT), card(OTHER, LEFT)]
    )
    await afterLeavingCommunity(agent as never, COMMUNITY)

    const line = leaveLine(agent)
    expect(line).toBe(
      '[Rooms:leave] after leaving …irst-vtc as 1 (as …t-garlic): membership records 1 (as …ash-twin), ' +
        'card records 1 (as …ash-twin), Wallet card copies 2 (as …ash-twin, …t-garlic)'
    )
    for (const did of [COMMUNITY, LEFT, KEPT]) expect(line).not.toContain(did)
    expect(agent.genericRecords.delete).not.toHaveBeenCalled()
    expect(agent.genericRecords.deleteById).not.toHaveBeenCalled()
    expect(agent.w3cCredentials.deleteById).not.toHaveBeenCalled()
  })

  it('says nothing stays when nothing does', async () => {
    const agent = fakeAgent({ membership: [{ communityDid: OTHER, personaDid: KEPT }] }, [card(OTHER, KEPT)])
    await afterLeavingCommunity(agent as never, COMMUNITY)
    expect(leaveLine(agent)).toBe(
      '[Rooms:leave] after leaving …irst-vtc as 0: membership records 0, card records 0, Wallet card copies 0'
    )
  })

  it('says so when what stays cannot be read', async () => {
    const agent = fakeAgent({}, [])
    agent.w3cCredentials.getAll.mockRejectedValueOnce(new Error('wallet closed'))
    await afterLeavingCommunity(agent as never, COMMUNITY)
    // By kind alone, as every rooms line says why (roomsLogWords).
    expect(leaveLine(agent)).toBe('[Rooms:leave] what the leave left was not read: failed')
  })
})
