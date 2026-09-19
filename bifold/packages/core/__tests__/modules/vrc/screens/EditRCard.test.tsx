import { fireEvent, render, waitFor, act } from '@testing-library/react-native'
import { useAgent } from '@bifold/react-hooks'
import React from 'react'

import { StoreProvider, defaultReducer } from '../../../../src/contexts/store'
import EditRCard from '../../../../src/modules/vrc/screens/EditRCard'
import { testIdWithKey } from '../../../../src/utils/testable'
import { testDefaultState } from '../../../contexts/store'
import { BasicAppContext } from '../../../helpers/app'
import { buildRCardTemplate } from '../../../../src/modules/vrc/types/rcard'
import * as rCardCredentialService from '../../../../src/modules/vrc/services/rCardCredential'

const profileA = buildRCardTemplate({
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  organization: 'Old Org',
})
profileA.jcard[1].push(['photo', {}, 'uri', 'data:image/jpeg;base64,existingPhoto'])
const profileB = buildRCardTemplate({
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@work.example.com',
  organization: 'Work',
})

describe('EditRCard Screen', () => {
  let updateSpy: jest.SpyInstance
  let loadSpy: jest.SpyInstance
  let storeSpy: jest.SpyInstance
  const goBack = jest.fn()
  const setOptions = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    updateSpy = jest.spyOn(rCardCredentialService, 'updateRCardTemplate').mockResolvedValue(true)
    loadSpy = jest.spyOn(rCardCredentialService, 'loadRCardTemplate').mockResolvedValue(profileA)
    storeSpy = jest.spyOn(rCardCredentialService, 'storeRCardTemplate').mockResolvedValue(true)
  })

  afterEach(() => {
    updateSpy.mockRestore()
    loadSpy.mockRestore()
    storeSpy.mockRestore()
  })

  // A real StoreProvider with the real reducer, so a submitted update goes
  // through the same dispatch path the app uses — not just a spy assertion.
  // lastSyncedAt is set so the hook's mount-time auto-sync effect (which also
  // calls loadRCardTemplate) skips — otherwise it confounds assertions on
  // whether *submitting* triggered a load.
  const renderScreen = (
    profileId: string | undefined,
    initialState = {
      ...testDefaultState,
      rCard: { profiles: [profileA, profileB], activeProfileId: profileA.id, lastSyncedAt: new Date().toISOString() },
    }
  ) =>
    render(
      <StoreProvider initialState={initialState} reducer={defaultReducer}>
        <BasicAppContext>
          <EditRCard
            key="first-mount"
            route={{ key: 'EditRCard', name: 'Edit Profile' as never, params: profileId ? { profileId } : undefined }}
            navigation={{ goBack, setOptions } as any}
          />
        </BasicAppContext>
      </StoreProvider>
    )

  test('pre-fills the form with the given profile, including the photo — not the onboarding empty state', () => {
    const tree = renderScreen(profileA.id)

    expect(tree.getByTestId(testIdWithKey('RCardFirstNameInput')).props.defaultValue).toBe('Jane')
    expect(tree.getByTestId(testIdWithKey('RCardLastNameInput')).props.defaultValue).toBe('Doe')
    expect(tree.getByTestId(testIdWithKey('RCardEmailInput')).props.defaultValue).toBe('jane@example.com')
    expect(tree.getByTestId(testIdWithKey('RCardOrganizationInput')).props.defaultValue).toBe('Old Org')
    expect(tree.getByTestId(testIdWithKey('RCardPhotoPreview')).props.source).toEqual({
      uri: 'data:image/jpeg;base64,existingPhoto',
    })
  })

  test('pre-fills a DIFFERENT profile correctly when given its id, not always the active one', () => {
    const tree = renderScreen(profileB.id)

    expect(tree.getByTestId(testIdWithKey('RCardOrganizationInput')).props.defaultValue).toBe('Work')
  })

  test('switching which profile this same screen instance edits does not leak the previous profile\'s photo', () => {
    // Renders with the SAME outer `key` (no fresh EditRCard mount) but a
    // different profileId param — the shape a stack navigator's route-reuse
    // can produce. Without RCardForm being keyed by profile identity inside
    // EditRCard, its formState (and formState.photo) would survive from the
    // first render and profileB's (photo-less) form would wrongly still show
    // profileA's photo.
    const initialState = {
      ...testDefaultState,
      rCard: { profiles: [profileA, profileB], activeProfileId: profileA.id, lastSyncedAt: new Date().toISOString() },
    }
    const { getByTestId, queryByTestId, rerender } = render(
      <StoreProvider initialState={initialState} reducer={defaultReducer}>
        <BasicAppContext>
          <EditRCard
            key="same-instance"
            route={{ key: 'EditRCard', name: 'Edit Profile' as never, params: { profileId: profileA.id } }}
            navigation={{ goBack, setOptions } as any}
          />
        </BasicAppContext>
      </StoreProvider>
    )

    expect(getByTestId(testIdWithKey('RCardPhotoPreview')).props.source).toEqual({
      uri: 'data:image/jpeg;base64,existingPhoto',
    })

    rerender(
      <StoreProvider initialState={initialState} reducer={defaultReducer}>
        <BasicAppContext>
          <EditRCard
            key="same-instance"
            route={{ key: 'EditRCard', name: 'Edit Profile' as never, params: { profileId: profileB.id } }}
            navigation={{ goBack, setOptions } as any}
          />
        </BasicAppContext>
      </StoreProvider>
    )

    expect(queryByTestId(testIdWithKey('RCardPhotoPreview'))).toBeNull()
    expect(getByTestId(testIdWithKey('RCardOrganizationInput')).props.defaultValue).toBe('Work')
  })

  test('pre-fills the profile-name (label) field with the profile\'s own organizing tag', () => {
    const tree = renderScreen(profileA.id)
    expect(tree.getByTestId(testIdWithKey('RCardLabelInput')).props.defaultValue).toBe(profileA.label)
  })

  test('submitting a changed profile name updates the label, not just the jcard', async () => {
    const tree = renderScreen(profileA.id)

    fireEvent.changeText(tree.getByTestId(testIdWithKey('RCardLabelInput')), 'Soccer Team')
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('RCardSubmit')))
    })

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        profileA.templateId,
        expect.objectContaining({ label: 'Soccer Team' }),
        expect.anything()
      )
    })
  })

  test('sets the nav header title to the profile being edited — not a generic title that could mean any of them', () => {
    renderScreen(profileB.id)
    expect(setOptions).toHaveBeenCalledWith({ title: profileB.label })
  })

  test('sets the nav header title to the create-mode title when there is no profileId', () => {
    renderScreen(undefined)
    expect(setOptions).toHaveBeenCalledWith({ title: 'EditRCard.CreateTitle' })
  })

  test('renders nothing when asked to edit a profile that is not loaded', () => {
    const tree = renderScreen('no-such-profile')

    expect(tree.queryByTestId(testIdWithKey('RCardSubmit'))).toBeNull()
  })

  test('renders nothing when there is no agent', () => {
    ;(useAgent as jest.Mock).mockReturnValueOnce({ agent: undefined, loading: true })

    const tree = render(
      <StoreProvider
        initialState={{ ...testDefaultState, rCard: { profiles: [profileA], activeProfileId: profileA.id } }}
        reducer={defaultReducer}
      >
        <EditRCard
          route={{ key: 'EditRCard', name: 'Edit Profile' as never, params: undefined }}
          navigation={{ setOptions: jest.fn() } as any}
        />
      </StoreProvider>
    )

    expect(tree.queryByTestId(testIdWithKey('RCardSubmit'))).toBeNull()
  })

  test('submitting a change persists it and, on reopening, shows the new values — not the stale ones', async () => {
    // Same id/templateId as profileA - an edit never changes those, only the
    // jcard. A fresh buildRCardTemplate() id here would make the reducer's
    // upsert-by-id append a second profile instead of replacing this one,
    // masking a real regression.
    const updatedProfileA = buildRCardTemplate(
      { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', organization: 'New Org' },
      { id: profileA.id, templateId: profileA.templateId }
    )
    // Only set once the submit itself calls loadRCardTemplate — see below —
    // so a false pass can't come from the mount-time auto-sync effect instead.
    loadSpy.mockResolvedValue(profileA)

    // lastSyncedAt is set so the mount-time auto-sync effect doesn't itself
    // call loadRCardTemplate/dispatch — otherwise this test could pass even
    // if `update()` were broken, because the effect alone would have already
    // written the "new" template into the store, independent of the submit.
    const initialState = {
      ...testDefaultState,
      rCard: { profiles: [profileA], activeProfileId: profileA.id, lastSyncedAt: new Date().toISOString() },
    }

    const { getByTestId, rerender } = render(
      <StoreProvider initialState={initialState} reducer={defaultReducer}>
        <BasicAppContext>
          <EditRCard
            key="first-mount"
            route={{ key: 'EditRCard', name: 'Edit Profile' as never, params: { profileId: profileA.id } }}
            navigation={{ goBack, setOptions: jest.fn() } as any}
          />
        </BasicAppContext>
      </StoreProvider>
    )

    loadSpy.mockResolvedValue(updatedProfileA)
    fireEvent.changeText(getByTestId(testIdWithKey('RCardOrganizationInput')), 'New Org')
    await act(async () => {
      fireEvent.press(getByTestId(testIdWithKey('RCardSubmit')))
    })

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        profileA.templateId,
        expect.objectContaining({ organization: 'New Org' }),
        expect.anything()
      )
    })
    // A successful save must navigate back on its own — the button pressed
    // just sitting there with no feedback is exactly what prompted this test.
    expect(goBack).toHaveBeenCalled()

    // Re-mount EditRCard (a different `key`, forcing a fresh component instance —
    // the same thing navigating away and back does) under the SAME StoreProvider
    // instance, so this only sees the update if it truly landed in the store,
    // not just in RCardForm's own already-mounted, uncontrolled input state.
    rerender(
      <StoreProvider initialState={initialState} reducer={defaultReducer}>
        <BasicAppContext>
          <EditRCard
            key="second-mount"
            route={{ key: 'EditRCard', name: 'Edit Profile' as never, params: { profileId: profileA.id } }}
            navigation={{ goBack, setOptions: jest.fn() } as any}
          />
        </BasicAppContext>
      </StoreProvider>
    )

    expect(getByTestId(testIdWithKey('RCardOrganizationInput')).props.defaultValue).toBe('New Org')
  })

  test('shows the generic error modal, and does not dispatch, when the update fails to persist', async () => {
    updateSpy.mockResolvedValue(false)

    const tree = renderScreen(profileA.id)

    fireEvent.changeText(tree.getByTestId(testIdWithKey('RCardOrganizationInput')), 'New Org')
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('RCardSubmit')))
    })

    await waitFor(() => {
      expect(tree.getByText('RCardOnboarding.Errors.Generic')).toBeTruthy()
    })
    // updateRCardTemplate failed, so update() must short-circuit before ever
    // calling loadRCardTemplate to reload/dispatch a "new" template.
    expect(loadSpy).not.toHaveBeenCalled()
    expect(goBack).not.toHaveBeenCalled()
  })

  describe('create mode (no profileId)', () => {
    test('shows an empty form with the create-mode title, not the onboarding-empty edit form', () => {
      const tree = renderScreen(undefined)

      expect(tree.getByText('EditRCard.CreateTitle')).toBeTruthy()
      expect(tree.getByTestId(testIdWithKey('RCardFirstNameInput')).props.defaultValue).toBe('')
      expect(tree.queryByTestId(testIdWithKey('RCardPhotoPreview'))).toBeNull()
    })

    test('submitting creates a new profile and navigates back', async () => {
      const tree = renderScreen(undefined)

      fireEvent.changeText(tree.getByTestId(testIdWithKey('RCardFirstNameInput')), 'Jane')
      fireEvent.changeText(tree.getByTestId(testIdWithKey('RCardLastNameInput')), 'Doe')
      fireEvent.changeText(tree.getByTestId(testIdWithKey('RCardOrganizationInput')), 'Side Project')

      await act(async () => {
        fireEvent.press(tree.getByTestId(testIdWithKey('RCardSubmit')))
      })

      await waitFor(() => {
        expect(storeSpy).toHaveBeenCalledWith(
          expect.objectContaining({ jcard: expect.arrayContaining([expect.anything()]) }),
          expect.anything()
        )
      })
      expect(goBack).toHaveBeenCalled()
    })

    test('a failed create shows the generic error modal and does not navigate back', async () => {
      storeSpy.mockResolvedValue(false)
      const tree = renderScreen(undefined)

      fireEvent.changeText(tree.getByTestId(testIdWithKey('RCardFirstNameInput')), 'Jane')
      fireEvent.changeText(tree.getByTestId(testIdWithKey('RCardLastNameInput')), 'Doe')

      await act(async () => {
        fireEvent.press(tree.getByTestId(testIdWithKey('RCardSubmit')))
      })

      await waitFor(() => {
        expect(tree.getByText('RCardOnboarding.Errors.Generic')).toBeTruthy()
      })
      expect(goBack).not.toHaveBeenCalled()
    })
  })
})
