import { useNavigation } from '@react-navigation/native'
import { render, act, fireEvent } from '@testing-library/react-native'
import React from 'react'
import { StoreContext } from '../../src'
import Settings from '../../src/screens/Settings'
import { testIdWithKey } from '../../src/utils/testable'
import { testDefaultState } from '../contexts/store'
import { BasicAppContext } from '../helpers/app'
import { AuthContext } from '../../src/contexts/auth'
import authContext from '../contexts/auth'
import { Screens } from '../../src/types/navigators'
import { buildRCardTemplate } from '../../src/modules/vrc/types/rcard'

describe('Settings Screen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('Renders correctly', async () => {
    const customState = {
      ...testDefaultState,
      preferences: {
        ...testDefaultState.preferences,
        developerModeEnabled: true,
        walletName: 'My Wallet',
      },
    }

    const tree = render(
      <StoreContext.Provider
        value={[
          customState,
          () => {
            return
          },
        ]}
      >
        <BasicAppContext>
          <AuthContext.Provider value={authContext}>
            <Settings navigation={useNavigation()} route={{} as any} />
          </AuthContext.Provider>
        </BasicAppContext>
      </StoreContext.Provider>
    )
    // React 19: flush initial async/animation state updates so they don't leak
    // an "not wrapped in act(...)" warning into the next test.
    await act(async () => {})
    expect(tree).toMatchSnapshot()
  })

  test('Renders correctly with wallet naming capability enabled', async () => {
    const customState = {
      ...testDefaultState,
      preferences: {
        ...testDefaultState.preferences,
        developerModeEnabled: true,
        useConnectionInviterCapability: true,
        walletName: 'Wallet123',
      },
    }

    const tree = render(
      <StoreContext.Provider
        value={[
          customState,
          () => {
            return
          },
        ]}
      >
        <BasicAppContext>
          <AuthContext.Provider value={authContext}>
            <Settings navigation={useNavigation()} route={{} as any} />
          </AuthContext.Provider>
        </BasicAppContext>
      </StoreContext.Provider>
    )
    // React 19: flush initial async/animation state updates so they don't leak
    // an "not wrapped in act(...)" warning into the next test.
    await act(async () => {})

    // Settings screen should render with wallet inviter capability enabled
    expect(tree).toMatchSnapshot()
  })

  // TODO: Fix developer mode button rendering issue
  // test('If developer mode is enabled, developer mode button is shown', async () => {
  //   const customState = {
  //     ...testDefaultState,
  //     preferences: {
  //       ...testDefaultState.preferences,
  //       developerModeEnabled: true,
  //       walletName: 'My Wallet',
  //     },
  //   }
  //   const tree = render(
  //     <StoreContext.Provider
  //       value={[
  //         customState,
  //         () => {
  //           return
  //         },
  //       ]}
  //     >
  //       <BasicAppContext>
  //         <AuthContext.Provider value={authContext}>
  //           <Settings navigation={useNavigation()} route={{} as any} />
  //         </AuthContext.Provider>
  //       </BasicAppContext>
  //     </StoreContext.Provider>
  //   )

  //   const developerModeButton = tree.getByTestId(testIdWithKey('DeveloperOptions'))
  //   expect(developerModeButton).not.toBeNull()
  // })

  test('If mobile verifier is enabled, verifier options are shown', async () => {
    const customState = {
      ...testDefaultState,
      preferences: {
        ...testDefaultState.preferences,
        useVerifierCapability: true,
        walletName: 'My Wallet',
      },
    }
    const tree = render(
      <StoreContext.Provider
        value={[
          customState,
          () => {
            return
          },
        ]}
      >
        <BasicAppContext>
          <AuthContext.Provider value={authContext}>
            <Settings navigation={useNavigation()} route={{} as any} />
          </AuthContext.Provider>
        </BasicAppContext>
      </StoreContext.Provider>
    )
    expect(tree.getByText('Settings.DataRetention')).toBeTruthy()
  })

  test('Contacts section is not shown in Settings (moved to bottom tab bar)', async () => {
    const customState = {
      ...testDefaultState,
      preferences: {
        ...testDefaultState.preferences,
        developerModeEnabled: true,
        walletName: 'My Wallet',
      },
    }

    const tree = render(
      <StoreContext.Provider
        value={[
          customState,
          () => {
            return
          },
        ]}
      >
        <BasicAppContext>
          <AuthContext.Provider value={authContext}>
            <Settings navigation={useNavigation()} route={{} as any} />
          </AuthContext.Provider>
        </BasicAppContext>
      </StoreContext.Provider>
    )
    // Contacts section was moved to bottom tab bar, should not be in Settings
    const contactsSection = tree.queryByTestId(testIdWithKey('Contacts'))
    expect(contactsSection).toBeNull()
  })

  test('Shows a profile card above the settings sections, and tapping it opens My Profiles', async () => {
    const template = buildRCardTemplate({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      organization: 'Example Org',
    })
    const customState = {
      ...testDefaultState,
      rCard: { profiles: [template], activeProfileId: template.id, lastSyncedAt: new Date().toISOString() },
    }
    const navigate = jest.fn()

    const tree = render(
      <StoreContext.Provider value={[customState, () => undefined]}>
        <BasicAppContext>
          <AuthContext.Provider value={authContext}>
            <Settings navigation={{ ...useNavigation(), navigate } as any} route={{} as any} />
          </AuthContext.Provider>
        </BasicAppContext>
      </StoreContext.Provider>
    )
    await act(async () => {})

    const profileCard = tree.getByTestId(testIdWithKey('ProfileCard'))
    expect(tree.getByText('Jane Doe')).toBeTruthy()

    fireEvent.press(profileCard)
    expect(navigate).toHaveBeenCalledWith(Screens.MyProfiles)
  })

  test('Shows no profile card when there is no profile yet', async () => {
    const tree = render(
      <StoreContext.Provider value={[testDefaultState, () => undefined]}>
        <BasicAppContext>
          <AuthContext.Provider value={authContext}>
            <Settings navigation={useNavigation()} route={{} as any} />
          </AuthContext.Provider>
        </BasicAppContext>
      </StoreContext.Provider>
    )
    await act(async () => {})

    expect(tree.queryByTestId(testIdWithKey('ProfileCard'))).toBeNull()
  })
})
