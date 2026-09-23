import { useNavigation } from '@react-navigation/native'
import { render, waitFor } from '@testing-library/react-native'
import React from 'react'
import { container } from 'tsyringe'
import { useAgent } from '@bifold/react-hooks'

import { ContainerProvider } from '../../src/container-api'
import { MainContainer } from '../../src/container-impl'
import Scan, { scanErrorOf } from '../../src/screens/Scan'
import { KeyringLinkError } from '../../src/modules/trust-tasks/module/vtiLinks'
import { StoreProvider, defaultState } from '../../src/contexts/store'
import { BasicAppContext } from '../helpers/app'

jest.mock('react-native-orientation-locker', () => {
  return require('../../__mocks__/custom/react-native-orientation-locker')
})

jest.mock('react-native-permissions', () => {
  return {
    PERMISSIONS: {
      ANDROID: { CAMERA: 'android.permission.CAMERA' },
      IOS: { CAMERA: 'ios.permission.CAMERA' },
    },
    RESULTS: {
      GRANTED: 'granted',
      DENIED: 'denied',
    },
    check: jest.fn(() => Promise.resolve('granted')),
    request: jest.fn(() => Promise.resolve('granted')),
  }
})

describe('Scan Screen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // @ts-expect-error useAgent will be replaced with a mock which will have this method
    useAgent().agent?.modules.didcomm.oob.createInvitation.mockReturnValue({
      outOfBandInvitation: {
        toUrl: () => {
          return 'https://example.com/invitation'
        },
      },
    })
  })

  test('Renders correctly', async () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <ContainerProvider value={main}>
        <Scan navigation={useNavigation()} route={{} as any} />
      </ContainerProvider>
    )
    await waitFor(
      () => {
        expect(tree).toMatchSnapshot()
      },
      { timeout: 10000 }
    )
  })

  test('Shows QR code view when defaultToConnect is true', async () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <StoreProvider
        initialState={{
          ...defaultState,
          preferences: {
            ...defaultState.preferences,
            useConnectionInviterCapability: false,
          },
        }}
      >
        <BasicAppContext>
          <ContainerProvider value={main}>
            <Scan
              navigation={useNavigation()}
              route={
                {
                  params: { defaultToConnect: true },
                } as any
              }
            />
          </ContainerProvider>
        </BasicAppContext>
      </StoreProvider>
    )

    await waitFor(
      () => {
        expect(tree).toMatchSnapshot()
      },
      { timeout: 10000 }
    )
  })

  test('Shows tabs when useConnectionInviterCapability is enabled and defaultToConnect is false', async () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <StoreProvider
        initialState={{
          ...defaultState,
          preferences: {
            ...defaultState.preferences,
            useConnectionInviterCapability: true,
          },
        }}
      >
        <BasicAppContext>
          <ContainerProvider value={main}>
            <Scan navigation={useNavigation()} route={{} as any} />
          </ContainerProvider>
        </BasicAppContext>
      </StoreProvider>
    )

    await waitFor(
      () => {
        expect(tree).toMatchSnapshot()
      },
      { timeout: 10000 }
    )
  })

  test('Forces tabs to show when defaultToConnect is true and useConnectionInviterCapability is enabled', async () => {
    const main = new MainContainer(container.createChildContainer()).init()
    const tree = render(
      <StoreProvider
        initialState={{
          ...defaultState,
          preferences: {
            ...defaultState.preferences,
            useConnectionInviterCapability: true,
          },
        }}
      >
        <BasicAppContext>
          <ContainerProvider value={main}>
            <Scan
              navigation={useNavigation()}
              route={
                {
                  params: { defaultToConnect: true },
                } as any
              }
            />
          </ContainerProvider>
        </BasicAppContext>
      </StoreProvider>
    )

    await waitFor(
      () => {
        expect(tree).toMatchSnapshot()
      },
      { timeout: 10000 }
    )
  })
})

/**
 * A Keyring link that cannot be used says why as the headline. The reason was
 * wrapped twice on its way here and never reached a person — not even "This
 * link has expired".
 */
describe('what the scanner shows for a failed code', () => {
  it('a Keyring link that cannot be used: its reason, in words, as the headline', () => {
    const error = scanErrorOf(
      'did:webvh:Q:host:x',
      new KeyringLinkError("This is a mediator's code."),
      'Scan.InvalidQrCode'
    )
    expect(error.message).toBe("This is a mediator's code.")
    expect(error.data).toBe('did:webvh:Q:host:x')
  })
  it('anything else: the generic headline, the reason under details', () => {
    const error = scanErrorOf('garbage', new Error('parse failed'), 'Scan.InvalidQrCode')
    expect(error.message).toBe('Scan.InvalidQrCode')
    expect(error.details).toBe('parse failed')
  })
})
