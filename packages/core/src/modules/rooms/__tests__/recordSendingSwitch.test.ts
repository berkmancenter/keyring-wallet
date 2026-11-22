/**
 * Sending a room's records is a release's switch (`recordSendingSwitch.ts`): on by the release, off again for everyone
 * by a later one, with nothing saved on the phone that could keep it on. The real backend reads it on every ask, so
 * the rooms service follows it the moment it changes; and anything but the two booleans as the release sets them
 * reads as off.
 */
jest.mock('../roomsLeave', () => ({ afterLeavingCommunity: jest.fn() }))
jest.mock('../../trust-tasks/module/vtiJoin', () => ({ leaveCommunity: jest.fn() }))
jest.mock('../../trust-tasks/module/keyedRecords', () => ({ listKeyed: jest.fn(async () => []), putKeyed: jest.fn() }))
jest.mock('../../trust-tasks/module/VtiIdentityStore', () => ({ GenericRecordsIdentityStore: class {} }))
jest.mock('../../trust-tasks/module/VtiCommunityStore', () => ({ GenericRecordsCommunityStore: class {} }))
jest.mock('../../trust-tasks/module/vtiVetting', () => ({ GenericRecordsVettingStore: class {} }))
jest.mock('../../trust-tasks/module/vtiAgent', () => ({ vtiAgent: {} }))
jest.mock('../../trust-tasks/module/vtaAgent', () => ({ vtaAgent: {} }))
jest.mock('../../trust-tasks/module/vtiTsp', () => ({ GenericRecordsTspPeerRevisionStore: class {} }))

import { createAgentRoomsBackend } from '../real/agentRoomsBackend'
import { AgentRoomsService } from '../real/agentRoomsService'
import { RecordSendingOff } from '../real/recordWrites'
import { isRoomRecordSendingOn, ROOMS_RECORD_SENDING } from '../recordSendingSwitch'

const agent = { config: { logger: { warn: jest.fn() } } } as never
const RELEASE = { ...ROOMS_RECORD_SENDING }

afterEach(() => {
  ROOMS_RECORD_SENDING.on = RELEASE.on
  ROOMS_RECORD_SENDING.remoteOff = RELEASE.remoteOff
})

describe('sending a room’s records, as the release sets it', () => {
  test('this release turns it on, with no remote off', () => {
    expect(RELEASE).toEqual({ on: true, remoteOff: false })
    expect(isRoomRecordSendingOn()).toBe(true)
  })

  test('the remote off wins over on, and lifting it brings back only what the release chose', () => {
    ROOMS_RECORD_SENDING.remoteOff = true
    expect(isRoomRecordSendingOn()).toBe(false)
    ROOMS_RECORD_SENDING.remoteOff = false
    expect(isRoomRecordSendingOn()).toBe(true)
    ROOMS_RECORD_SENDING.on = false
    expect(isRoomRecordSendingOn()).toBe(false)
  })

  test('fails closed: anything but the two booleans as a release sets them reads as off', () => {
    for (const on of ['true', 1, undefined, null] as never[]) {
      ROOMS_RECORD_SENDING.on = on
      expect(isRoomRecordSendingOn()).toBe(false)
    }
    ROOMS_RECORD_SENDING.on = true
    for (const remoteOff of ['false', 0, undefined, null] as never[]) {
      ROOMS_RECORD_SENDING.remoteOff = remoteOff
      expect(isRoomRecordSendingOn()).toBe(false)
    }
  })

  test('the real backend reads it on every ask, never once at start (control: on, it says on)', () => {
    const backend = createAgentRoomsBackend(agent)
    expect(backend.recordSending).toBe(true)
    ROOMS_RECORD_SENDING.remoteOff = true
    expect(backend.recordSending).toBe(false)
    ROOMS_RECORD_SENDING.remoteOff = false
    expect(backend.recordSending).toBe(true)
  })

  test('the rooms service follows it the moment it turns off: nothing is asked of the agent', async () => {
    const backend = createAgentRoomsBackend(agent)
    const agentTask = jest.spyOn(backend, 'agentTask')
    const service = new AgentRoomsService(backend)
    expect(service.recordSendingOn()).toBe(true)
    ROOMS_RECORD_SENDING.remoteOff = true
    expect(service.recordSendingOn()).toBe(false)
    await expect(service.sendRecord('did:webvh:room:r1', { type: 'message', body: 'hello' })).rejects.toBeInstanceOf(
      RecordSendingOff
    )
    expect(agentTask).not.toHaveBeenCalled()
  })
})
