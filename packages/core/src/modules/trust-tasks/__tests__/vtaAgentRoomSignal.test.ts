/**
 * A room's change signal (`rooms/keys/changed/0.1`), pushed by the linked agent, reaches whoever listens with its
 * payload as sent, and nothing else does: it is not taken as an approval, and a listener that throws keeps it from no
 * other.
 */
import { VTA_TASK } from '../module/VtaClient'
import { VtaAgentController } from '../module/vtaAgent'

const pushed = (body: Record<string, unknown>) => ({
  id: 'urn:uuid:pushed',
  type: 'https://trusttasks.org/binding/didcomm/v2',
  from: 'did:webvh:agent',
  body,
})
const PAYLOAD = { roomId: 'did:webvh:room:a', member: 'did:key:me', host: 'did:webvh:host', latestVersion: 4 }
const inbound = (vta: VtaAgentController, message: unknown) =>
  (vta as unknown as { inbound(m: unknown): void }).inbound(message)

describe("the agent's room change signal", () => {
  it('reaches every listener with its payload, and stops reaching one that stopped', () => {
    const vta = new VtaAgentController()
    const a = jest.fn()
    const b = jest.fn()
    const stopA = vta.onRoomSignal(a)
    vta.onRoomSignal(b)
    inbound(vta, pushed({ type: VTA_TASK.roomsKeysChanged, payload: PAYLOAD }))
    expect(a).toHaveBeenCalledWith(PAYLOAD)
    expect(b).toHaveBeenCalledWith(PAYLOAD)
    stopA()
    inbound(vta, pushed({ type: VTA_TASK.roomsKeysChanged, payload: PAYLOAD }))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('one listener that throws keeps it from no other', () => {
    const vta = new VtaAgentController()
    const after = jest.fn()
    vta.onRoomSignal(() => {
      throw new Error('boom')
    })
    vta.onRoomSignal(after)
    inbound(vta, pushed({ type: VTA_TASK.roomsKeysChanged, payload: PAYLOAD }))
    expect(after).toHaveBeenCalledWith(PAYLOAD)
  })

  it('is not listed as an approval', () => {
    const vta = new VtaAgentController()
    inbound(vta, pushed({ type: VTA_TASK.roomsKeysChanged, payload: PAYLOAD }))
    expect((vta as unknown as { state: { approvals: unknown[] } }).state.approvals).toEqual([])
  })

  it('a payload that is not an object reaches no one; nor does another type (control)', () => {
    const vta = new VtaAgentController()
    const heard = jest.fn()
    vta.onRoomSignal(heard)
    inbound(vta, pushed({ type: VTA_TASK.roomsKeysChanged, payload: 'room:a' }))
    inbound(vta, pushed({ type: VTA_TASK.consentGranted, payload: PAYLOAD }))
    expect(heard).not.toHaveBeenCalled()
  })
})
