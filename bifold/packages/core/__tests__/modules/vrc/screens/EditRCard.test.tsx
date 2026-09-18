import { fireEvent, render, waitFor, act } from '@testing-library/react-native'
import React from 'react'

import { StoreProvider, defaultReducer } from '../../../../src/contexts/store'
import EditRCard from '../../../../src/modules/vrc/screens/EditRCard'
import { testIdWithKey } from '../../../../src/utils/testable'
import { testDefaultState } from '../../../contexts/store'
import { BasicAppContext } from '../../../helpers/app'
import { buildRCardTemplate } from '../../../../src/modules/vrc/types/rcard'
import * as rCardCredentialService from '../../../../src/modules/vrc/services/rCardCredential'

const existingTemplate = buildRCardTemplate({
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  organization: 'Old Org',
})
existingTemplate.jcard[1].push(['photo', {}, 'uri', 'data:image/jpeg;base64,existingPhoto'])

describe('EditRCard Screen', () => {
  let updateSpy: jest.SpyInstance
  let loadSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    updateSpy = jest.spyOn(rCardCredentialService, 'updateRCardTemplate').mockResolvedValue(true)
    loadSpy = jest.spyOn(rCardCredentialService, 'loadRCardTemplate').mockResolvedValue(existingTemplate)
  })

  afterEach(() => {
    updateSpy.mockRestore()
    loadSpy.mockRestore()
  })

  // A real StoreProvider with the real reducer, so a submitted update goes
  // through the same dispatch path the app uses — not just a spy assertion.
  // lastSyncedAt is set so the hook's mount-time auto-sync effect (which also
  // calls loadRCardTemplate) skips — otherwise it confounds assertions on
  // whether *submitting* triggered a load.
  const renderInStore = (
    initialState = {
      ...testDefaultState,
      rCard: { template: existingTemplate, lastSyncedAt: new Date().toISOString() },
    }
  ) =>
    render(
      <StoreProvider initialState={initialState} reducer={defaultReducer}>
        <BasicAppContext>
          <EditRCard key="first-mount" />
        </BasicAppContext>
      </StoreProvider>
    )

  test('pre-fills the form with the current profile, including the photo — not the onboarding empty state', () => {
    const tree = renderInStore()

    expect(tree.getByTestId(testIdWithKey('RCardFirstNameInput')).props.defaultValue).toBe('Jane')
    expect(tree.getByTestId(testIdWithKey('RCardLastNameInput')).props.defaultValue).toBe('Doe')
    expect(tree.getByTestId(testIdWithKey('RCardEmailInput')).props.defaultValue).toBe('jane@example.com')
    expect(tree.getByTestId(testIdWithKey('RCardOrganizationInput')).props.defaultValue).toBe('Old Org')
    expect(tree.getByTestId(testIdWithKey('RCardPhotoPreview')).props.source).toEqual({
      uri: 'data:image/jpeg;base64,existingPhoto',
    })
  })

  test('renders nothing when there is no profile yet, rather than crashing', () => {
    const tree = renderInStore({ ...testDefaultState, rCard: {} })

    expect(tree.queryByTestId(testIdWithKey('RCardSubmit'))).toBeNull()
  })

  test('submitting a change persists it and, on reopening, shows the new values — not the stale ones', async () => {
    const updatedTemplate = buildRCardTemplate({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      organization: 'New Org',
    })
    // Only set once the submit itself calls loadRCardTemplate — see below —
    // so a false pass can't come from the mount-time auto-sync effect instead.
    loadSpy.mockResolvedValue(existingTemplate)

    // lastSyncedAt is set so the mount-time auto-sync effect doesn't itself
    // call loadRCardTemplate/dispatch — otherwise this test could pass even
    // if `update()` were broken, because the effect alone would have already
    // written the "new" template into the store, independent of the submit.
    const initialState = {
      ...testDefaultState,
      rCard: { template: existingTemplate, lastSyncedAt: new Date().toISOString() },
    }

    const { getByTestId, rerender } = render(
      <StoreProvider initialState={initialState} reducer={defaultReducer}>
        <BasicAppContext>
          <EditRCard key="first-mount" />
        </BasicAppContext>
      </StoreProvider>
    )

    loadSpy.mockResolvedValue(updatedTemplate)
    fireEvent.changeText(getByTestId(testIdWithKey('RCardOrganizationInput')), 'New Org')
    await act(async () => {
      fireEvent.press(getByTestId(testIdWithKey('RCardSubmit')))
    })

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        existingTemplate.templateId,
        expect.objectContaining({ organization: 'New Org' }),
        expect.anything()
      )
    })

    // Re-mount EditRCard (a different `key`, forcing a fresh component instance —
    // the same thing navigating away and back does) under the SAME StoreProvider
    // instance, so this only sees the update if it truly landed in the store,
    // not just in RCardForm's own already-mounted, uncontrolled input state.
    rerender(
      <StoreProvider initialState={initialState} reducer={defaultReducer}>
        <BasicAppContext>
          <EditRCard key="second-mount" />
        </BasicAppContext>
      </StoreProvider>
    )

    expect(getByTestId(testIdWithKey('RCardOrganizationInput')).props.defaultValue).toBe('New Org')
  })

  test('shows the generic error modal, and does not dispatch, when the update fails to persist', async () => {
    updateSpy.mockResolvedValue(false)

    const tree = renderInStore()

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
  })
})
