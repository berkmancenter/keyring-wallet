import { fireEvent, render, waitFor, act, within } from '@testing-library/react-native'
import React from 'react'

import { StoreProvider, defaultReducer } from '../../../../src/contexts/store'
import MyProfiles from '../../../../src/modules/vrc/screens/MyProfiles'
import { testIdWithKey } from '../../../../src/utils/testable'
import { testDefaultState } from '../../../contexts/store'
import { BasicAppContext } from '../../../helpers/app'
import { Screens } from '../../../../src/types/navigators'
import { buildRCardTemplate } from '../../../../src/modules/vrc/types/rcard'
import * as rCardCredentialService from '../../../../src/modules/vrc/services/rCardCredential'

const profileA = buildRCardTemplate({ firstName: 'Jane', lastName: 'Doe', email: '', organization: 'Personal' })
const profileB = buildRCardTemplate({ firstName: 'Jane', lastName: 'Doe', email: '', organization: 'Work' })

describe('MyProfiles Screen', () => {
  let setActiveSpy: jest.SpyInstance
  let deleteSpy: jest.SpyInstance
  const navigate = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    setActiveSpy = jest.spyOn(rCardCredentialService, 'setActiveRCardProfile').mockResolvedValue(true)
    deleteSpy = jest.spyOn(rCardCredentialService, 'deleteRCardTemplate').mockResolvedValue(undefined)
  })

  afterEach(() => {
    setActiveSpy.mockRestore()
    deleteSpy.mockRestore()
  })

  const renderWithProfiles = (profiles = [profileA, profileB], activeProfileId = profileA.id) =>
    render(
      <StoreProvider
        initialState={{
          ...testDefaultState,
          rCard: { profiles, activeProfileId, lastSyncedAt: new Date().toISOString() },
        }}
        reducer={defaultReducer}
      >
        <BasicAppContext>
          <MyProfiles navigation={{ navigate } as any} route={{ key: 'MyProfiles', name: 'My Profiles' as never }} />
        </BasicAppContext>
      </StoreProvider>
    )

  test('lists every profile, with the active one badged', () => {
    const tree = renderWithProfiles()

    expect(tree.getByTestId(testIdWithKey(`MyProfilesRow-${profileA.id}`))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey(`MyProfilesRow-${profileB.id}`))).toBeTruthy()
    expect(tree.getByText('MyProfiles.Active')).toBeTruthy()
  })

  test('tapping a row opens EditRCard parameterized by that profile\'s id', () => {
    const tree = renderWithProfiles()

    fireEvent.press(tree.getByTestId(testIdWithKey(`MyProfilesRow-${profileB.id}`)))

    expect(navigate).toHaveBeenCalledWith(Screens.EditRCard, { profileId: profileB.id })
  })

  test('"Add profile" opens EditRCard in create mode (no profileId)', () => {
    const tree = renderWithProfiles()

    fireEvent.press(tree.getByTestId(testIdWithKey('AddProfile')))

    expect(navigate).toHaveBeenCalledWith(Screens.EditRCard, undefined)
  })

  test('tapping "Make active" on a non-active profile sets it active, and the list reflects it — not just that the call fired', async () => {
    const tree = renderWithProfiles()

    // Before: profileA is badged Active, profileB shows a "Make active" action.
    expect(
      within(tree.getByTestId(testIdWithKey(`MyProfilesRow-${profileA.id}`))).getByText('MyProfiles.Active')
    ).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey(`SetActiveProfile-${profileB.id}`))).toBeTruthy()

    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey(`SetActiveProfile-${profileB.id}`)))
    })

    expect(setActiveSpy).toHaveBeenCalledWith(expect.anything(), profileB.id)
    // After: the badge and the "Make active" action have swapped rows — this
    // only happens if the dispatched activeProfileId actually reached state,
    // not merely that setActiveRCardProfile was called.
    expect(
      within(tree.getByTestId(testIdWithKey(`MyProfilesRow-${profileB.id}`))).getByText('MyProfiles.Active')
    ).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey(`SetActiveProfile-${profileB.id}`))).toBeNull()
    expect(tree.getByTestId(testIdWithKey(`SetActiveProfile-${profileA.id}`))).toBeTruthy()
  })

  test('deleting a non-active profile succeeds and removes its row — not just that the call fired', async () => {
    const tree = renderWithProfiles()

    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey(`DeleteProfile-${profileB.id}`)))
    })

    expect(deleteSpy).toHaveBeenCalledWith(expect.anything(), profileB.id)
    expect(tree.queryByText('MyProfiles.DeleteActiveProfileTitle')).toBeNull()
    // The row is gone because the dispatched deletion actually landed in
    // state, not merely because deleteRCardTemplate was called.
    expect(tree.queryByTestId(testIdWithKey(`MyProfilesRow-${profileB.id}`))).toBeNull()
    expect(tree.getByTestId(testIdWithKey(`MyProfilesRow-${profileA.id}`))).toBeTruthy()
  })

  test('deleting the active profile is blocked with an explanatory modal, not a silent no-op', async () => {
    const tree = renderWithProfiles()

    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey(`DeleteProfile-${profileA.id}`)))
    })

    expect(deleteSpy).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(tree.getByText('MyProfiles.DeleteActiveProfileTitle')).toBeTruthy()
    })
  })

  test('deleting the only remaining profile is blocked with an explanatory modal, not a silent no-op', async () => {
    const tree = renderWithProfiles([profileA], profileA.id)

    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey(`DeleteProfile-${profileA.id}`)))
    })

    expect(deleteSpy).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(tree.getByText('MyProfiles.DeleteLastProfileTitle')).toBeTruthy()
    })
  })
})
