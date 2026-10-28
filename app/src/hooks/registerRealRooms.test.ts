/**
 * The real rooms service is registered once an agent exists. Nothing else registers it: without this,
 * `TOKENS.UTIL_ROOMS_SERVICE` stays empty and a store build, which carries no sample rooms, shows none.
 */
import { TOKENS } from '@bifold/core'
import Config from 'react-native-config'
import { container } from 'tsyringe'

import { registerRealRooms } from './useBCAgentSetup'

// The backend is the one piece that would talk to a real agent; the service and its registration are real.
const mockCreateAgentRoomsBackend = jest.fn((agent: unknown) => ({ agent, agentLinked: () => false }))

jest.mock('@bifold/core', () => ({
  ...jest.requireActual('@bifold/core'),
  createAgentRoomsBackend: (...args: unknown[]) => mockCreateAgentRoomsBackend(...(args as [unknown])),
}))

jest.mock('react-native-config', () => ({ VTI_MEDIATOR_DID: 'did:example:vti-mediator' }))

// Cast once into a name, as useBCAgentSetup.test.ts does, so prettier and eslint agree.
const mockedConfig = Config as unknown as { VTI_MEDIATOR_DID?: string }

const fakeAgent = (name: string) => ({ name } as never)

describe('registerRealRooms', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedConfig.VTI_MEDIATOR_DID = 'did:example:vti-mediator'
  })

  it("registers the real service, built on this agent and the build's VTI mediator", () => {
    const child = container.createChildContainer()
    const agent = fakeAgent('first')
    registerRealRooms(child, agent)

    expect(mockCreateAgentRoomsBackend).toHaveBeenCalledWith(agent, { mediatorDid: 'did:example:vti-mediator' })
    const service = child.resolve(TOKENS.UTIL_ROOMS_SERVICE)
    expect(service).toBeDefined()
    expect(service.isSample).toBe(false)
  })

  it('replaces the service when a new agent starts, as after a lock-out', () => {
    const child = container.createChildContainer()
    registerRealRooms(child, fakeAgent('first'))
    const first = child.resolve(TOKENS.UTIL_ROOMS_SERVICE)
    registerRealRooms(child, fakeAgent('second'))

    expect(child.resolve(TOKENS.UTIL_ROOMS_SERVICE)).not.toBe(first)
    expect(mockCreateAgentRoomsBackend).toHaveBeenLastCalledWith(fakeAgent('second'), expect.anything())
  })

  it('leaves the mediator to the agent session when the build names none', () => {
    mockedConfig.VTI_MEDIATOR_DID = ''
    registerRealRooms(container.createChildContainer(), fakeAgent('first'))
    expect(mockCreateAgentRoomsBackend).toHaveBeenCalledWith(expect.anything(), { mediatorDid: undefined })
  })
})
