import { fireEvent, render, waitFor, act } from '@testing-library/react-native'
import React from 'react'
import { Agent, W3cCredentialRepository } from '@credo-ts/core'

import { StoreProvider, defaultReducer } from '../../../../src/contexts/store'
import RCardOnboarding from '../../../../src/modules/vrc/screens/RCardOnboarding'
import { testIdWithKey } from '../../../../src/utils/testable'
import { testDefaultState } from '../../../contexts/store'
import { BasicAppContext } from '../../../helpers/app'
import * as rCardCredentialService from '../../../../src/modules/vrc/services/rCardCredential'

const mockRepository = {
  save: jest.fn().mockResolvedValue(undefined),
  findByQuery: jest.fn().mockResolvedValue([]),
} as unknown as W3cCredentialRepository

const mockAgent = {
  dependencyManager: {
    resolve: jest.fn().mockReturnValue(mockRepository),
  },
  context: {},
} as unknown as Agent

describe('RCardOnboarding Screen', () => {
  let storeSpy: jest.SpyInstance
  let loadSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    storeSpy = jest.spyOn(rCardCredentialService, 'storeRCardTemplate').mockImplementation(async () => {
      return Promise.resolve(true)
    })
    loadSpy = jest.spyOn(rCardCredentialService, 'loadRCardTemplate').mockImplementation(async () => {
      return Promise.resolve(undefined)
    })
  })

  afterEach(() => {
    storeSpy.mockRestore()
    loadSpy.mockRestore()
  })

  test('submits valid form with all fields and stores template', async () => {
    const tree = render(
      <StoreProvider initialState={testDefaultState} reducer={defaultReducer}>
        <BasicAppContext>
          <RCardOnboarding agent={mockAgent} />
        </BasicAppContext>
      </StoreProvider>
    )

    const firstNameInput = tree.getByTestId(testIdWithKey('RCardFirstNameInput'))
    const lastNameInput = tree.getByTestId(testIdWithKey('RCardLastNameInput'))
    const emailInput = tree.getByTestId(testIdWithKey('RCardEmailInput'))
    const organizationInput = tree.getByTestId(testIdWithKey('RCardOrganizationInput'))

    fireEvent.changeText(firstNameInput, 'John')
    fireEvent.changeText(lastNameInput, 'Doe')
    fireEvent.changeText(emailInput, 'john@example.com')
    fireEvent.changeText(organizationInput, 'Example Org')

    const submitButton = tree.getByTestId(testIdWithKey('RCardSubmit'))

    await act(async () => {
      fireEvent.press(submitButton)
    })

    await waitFor(
      () => {
        expect(storeSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            id: expect.stringMatching(/^urn:uuid:/),
            templateId: expect.any(String),
            label: expect.any(String),
            jcard: expect.any(Array),
          }),
          mockAgent
        )
      },
      { timeout: 3000 }
    )

    // Wait for all async operations and promises to settle
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(tree).toMatchSnapshot()
  })

  test('submits valid form with only required fields (firstName and lastName)', async () => {
    const tree = render(
      <StoreProvider initialState={testDefaultState} reducer={defaultReducer}>
        <BasicAppContext>
          <RCardOnboarding agent={mockAgent} />
        </BasicAppContext>
      </StoreProvider>
    )

    const firstNameInput = tree.getByTestId(testIdWithKey('RCardFirstNameInput'))
    const lastNameInput = tree.getByTestId(testIdWithKey('RCardLastNameInput'))

    fireEvent.changeText(firstNameInput, 'Jane')
    fireEvent.changeText(lastNameInput, 'Smith')

    const submitButton = tree.getByTestId(testIdWithKey('RCardSubmit'))

    await act(async () => {
      fireEvent.press(submitButton)
    })

    await waitFor(
      () => {
        expect(storeSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            id: expect.stringMatching(/^urn:uuid:/),
            templateId: expect.any(String),
            label: expect.any(String),
            jcard: expect.any(Array),
          }),
          mockAgent
        )
      },
      { timeout: 3000 }
    )

    // Wait for all async operations and promises to settle
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
  })
})
