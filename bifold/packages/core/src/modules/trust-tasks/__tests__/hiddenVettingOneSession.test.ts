/**
 * "Meet a vetter" asks the agent while the app may be reopening its session (a slow agent, a reconnect). The check
 * waits for that session. It opened its own before: the client has no guard of its own, and a mediator keeps one live
 * connection per DID, so the two raced (0.69 gate, hv, 2026-11-04).
 */
import { vtaAgent } from '../module/vtaAgent'
import { hiddenVettingSeamImplementation as seam } from '../module/hiddenVettingAdapter'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const VTA = 'did:webvh:example:linked-vta'
const agent = { config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } } }
const criterion = { id: 'vetted-member', vetting: { ext: { 'org.openvtc.hidden-vetting': { suite: 'unknown' } } } }

it('the check waits for a session being opened, and opens no second one', async () => {
  let opened: () => void = () => undefined
  const client = {
    isConnected: false,
    managerDid: 'did:peer:phone',
    connect: jest.fn(() => new Promise<void>((resolve) => (opened = resolve))),
    whoAmI: jest.fn(async () => ({})),
  }
  jest.spyOn(vtaAgent, 'client').mockReturnValue(client as never)
  jest.spyOn(vtaAgent, 'agentAddress').mockReturnValue(VTA)

  const reopening = vtaAgent.connect(agent as never, VTA)
  const checking = seam.check(agent as never, criterion as never)
  await new Promise((resolve) => setImmediate(resolve))
  expect(client.connect).toHaveBeenCalledTimes(1)

  opened()
  await reopening
  await checking
  expect(client.connect).toHaveBeenCalledTimes(1)
})

it('a session that cannot be opened is still a refusal the screen can word', async () => {
  const client = {
    isConnected: false,
    managerDid: 'did:peer:phone',
    connect: jest.fn(async () => Promise.reject(new Error('signing in took over 30 s'))),
    whoAmI: jest.fn(async () => ({})),
  }
  jest.spyOn(vtaAgent, 'client').mockReturnValue(client as never)
  jest.spyOn(vtaAgent, 'agentAddress').mockReturnValue(VTA)
  await expect(seam.check(agent as never, criterion as never)).resolves.toMatchObject({
    ok: false,
    reason: 'cannotTell',
  })
})
