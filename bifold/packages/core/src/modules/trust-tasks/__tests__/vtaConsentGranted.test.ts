/**
 * The agent's `task-consent/granted` notice, as Sam's phone keeps it (trusted-approver plan T3, mock frame 6a): the
 * hold that was waiting is released, and which task it was is remembered, with when, so the screen can say who
 * approved it. A notice with nothing waiting remembers nothing.
 */
import { VTA_TASK } from '../module/VtaClient'
import { VtaAgentController } from '../module/vtaAgent'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const PERSONA_MINT = 'https://trusttasks.org/spec/vta/webvh/dids/create/1.2'
const granted = () => ({
  id: 'n-1',
  type: 'https://didcomm.org/trust-task/2.0/envelope',
  from: 'did:webvh:sams-agent.example',
  body: { id: 'g-1', type: VTA_TASK.consentGranted, payload: {} },
})

function controller() {
  const vta = new VtaAgentController()
  const internals = vta as unknown as { set(patch: Record<string, unknown>): void; inbound(plaintext: unknown): void }
  return { vta, internals }
}

test('a grant while a task is held releases the hold and remembers which task, and when', () => {
  const { vta, internals } = controller()
  internals.set({ awaitingConsentFor: PERSONA_MINT })
  const before = Date.now()
  internals.inbound(granted())
  const state = vta.getState()
  expect(state.awaitingConsentFor).toBeUndefined()
  expect(state.consentGranted?.taskType).toBe(PERSONA_MINT)
  expect(state.consentGranted?.at).toBeGreaterThanOrEqual(before)
})

test('a grant with nothing held remembers nothing (control: the one above)', () => {
  const { vta, internals } = controller()
  internals.inbound(granted())
  expect(vta.getState().consentGranted).toBeUndefined()
})

test('a grant clears an earlier not-given, so the screen says the newer thing', () => {
  const { vta, internals } = controller()
  internals.set({ awaitingConsentFor: PERSONA_MINT, consentNotGiven: { taskType: PERSONA_MINT, at: 1 } })
  internals.inbound(granted())
  expect(vta.getState().consentNotGiven).toBeUndefined()
  expect(vta.getState().consentGranted?.taskType).toBe(PERSONA_MINT)
})
