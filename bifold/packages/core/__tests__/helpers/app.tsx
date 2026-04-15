import React, { PropsWithChildren, useMemo } from 'react'
import { Agent } from '@credo-ts/core'
import { NetworkContext } from '../../src/contexts/network'

import networkContext from '../contexts/network'
import { Container, ContainerProvider, TOKENS } from '../../src/container-api'
import { MainContainer } from '../../src/container-impl'
import { container } from 'tsyringe'
import { OpenIDCredentialRecordProvider } from '../../src/modules/openid/context/OpenIDCredentialRecordProvider'
import { VrcNameCacheProvider } from '../../src/modules/vrc/context/VrcNameCacheProvider'
import { WitnessConnectionProvider } from '../../src/modules/vrc/context/WitnessConnectionProvider'
import { MockLogger } from './logger'

// Create a minimal mock agent for testing WitnessConnectionProvider
const createMockAgent = (): Agent => {
  return {
    oob: {
      parseInvitation: jest.fn(),
      receiveInvitationFromUrl: jest.fn(),
    },
    connections: {
      getById: jest.fn(),
      getAll: jest.fn().mockResolvedValue([]), // Return empty array to avoid restoring witness connections in tests
      findAllByQuery: jest.fn().mockResolvedValue([]),
    },
    dependencyManager: {
      resolve: jest.fn().mockReturnValue({
        update: jest.fn().mockResolvedValue(undefined),
      }),
    },
    context: {},
    events: {
      observable: jest.fn().mockReturnValue({ subscribe: jest.fn() }),
    },
  } as unknown as Agent
}

export const BasicAppContext: React.FC<PropsWithChildren> = ({ children }) => {
  const context = useMemo(() => {
    const c = new MainContainer(container.createChildContainer()).init()
    c.resolve(TOKENS.UTIL_LOGGER)
    c.container.registerInstance(TOKENS.UTIL_LOGGER, new MockLogger())
    return c
  }, [])

  const mockAgent = useMemo(() => createMockAgent(), [])

  return (
    <ContainerProvider value={context}>
      <OpenIDCredentialRecordProvider>
        <VrcNameCacheProvider>
          <WitnessConnectionProvider agent={mockAgent}>
            <NetworkContext.Provider value={networkContext}>{children}</NetworkContext.Provider>
          </WitnessConnectionProvider>
        </VrcNameCacheProvider>
      </OpenIDCredentialRecordProvider>
    </ContainerProvider>
  )
}

interface CustomBasicAppContextProps extends PropsWithChildren {
  container: Container
}
export const CustomBasicAppContext: React.FC<CustomBasicAppContextProps> = ({ children, container }) => {
  const context = container
  return (
    <ContainerProvider value={context}>
      <NetworkContext.Provider value={networkContext}>{children}</NetworkContext.Provider>
    </ContainerProvider>
  )
}
