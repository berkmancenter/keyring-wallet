/**
 * The wallet reaches the real rooms service only through '@bifold/core', which is `src/index.ts`
 * (Metro resolves it from source, and the built lib carries the same re-export). Nothing else
 * registers it: without these exports `TOKENS.UTIL_ROOMS_SERVICE` stays empty and a store build,
 * which carries no sample rooms, shows none at all.
 */
import { container } from 'tsyringe'

import { TOKENS } from '../../../container-api'
import * as core from '../../../index'
// The types come through the root too, so a dropped type export fails the type check.
import type { RoomsBackend, RoomsService } from '../../../index'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const unlinked: RoomsBackend = {
  agentLinked: () => false,
  agentServedTypes: async () => undefined,
  agentTask: async () => undefined,
  communities: async () => [],
  communityTask: async () => undefined,
  leaveCommunity: async () => undefined,
  decodeBase64Url: (value: string) => value,
  encodeBase64Url: (text: string) => text,
  hiddenOffers: async () => [],
  hideOffer: async () => undefined,
  warn: () => undefined,
  sendCompleted: async () => undefined,
  newId: () => 'id',
}

describe("the rooms service through the package root, which is what '@bifold/core' means", () => {
  it('exports what the app needs to build and register the real service', () => {
    expect(typeof core.registerRoomsService).toBe('function')
    expect(typeof core.AgentRoomsService).toBe('function')
    expect(typeof core.createAgentRoomsBackend).toBe('function')
  })

  it('registers a real service the screens then resolve', () => {
    const child = container.createChildContainer()
    const service = new core.AgentRoomsService(unlinked)
    core.registerRoomsService(child, service)

    const resolved = child.resolve<RoomsService>(TOKENS.UTIL_ROOMS_SERVICE)
    expect(resolved).toBe(service)
    expect(resolved.isSample).toBe(false)
  })
})
