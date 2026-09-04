import { fireEvent, render, waitFor, act } from '@testing-library/react-native'
import React from 'react'
import { Agent, W3cCredentialRepository } from '@credo-ts/core'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync } from 'expo-image-manipulator'

import { StoreProvider, defaultReducer } from '../../../../src/contexts/store'
import RCardOnboarding from '../../../../src/modules/vrc/screens/RCardOnboarding'
import { testIdWithKey } from '../../../../src/utils/testable'
import { testDefaultState } from '../../../contexts/store'
import { BasicAppContext } from '../../../helpers/app'
import * as rCardCredentialService from '../../../../src/modules/vrc/services/rCardCredential'

const mockLaunchImageLibraryAsync = ImagePicker.launchImageLibraryAsync as jest.Mock
const mockRequestMediaLibraryPermissionsAsync = ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock
const mockManipulateAsync = manipulateAsync as jest.Mock

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
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true })
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null })
    mockManipulateAsync.mockResolvedValue({
      uri: 'file:///mock-processed.jpg',
      width: 256,
      height: 256,
      base64: 'mockBase64Data',
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

  test('Adds a picked photo to the submitted R-Card template', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked-photo.jpg' }],
    })
    mockManipulateAsync.mockResolvedValue({
      uri: 'file:///mock-processed.jpg',
      width: 256,
      height: 256,
      base64: 'mockBase64Data',
    })

    const tree = render(
      <StoreProvider initialState={testDefaultState} reducer={defaultReducer}>
        <BasicAppContext>
          <RCardOnboarding agent={mockAgent} />
        </BasicAppContext>
      </StoreProvider>
    )

    fireEvent.changeText(tree.getByTestId(testIdWithKey('RCardFirstNameInput')), 'John')
    fireEvent.changeText(tree.getByTestId(testIdWithKey('RCardLastNameInput')), 'Doe')

    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('RCardPhotoInput')))
    })

    await waitFor(async () => {
      expect(await tree.findByTestId(testIdWithKey('RCardPhotoPreview'))).toBeTruthy()
    })

    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('RCardSubmit')))
    })

    await waitFor(() => {
      expect(storeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          jcard: [
            'vcard',
            expect.arrayContaining([['photo', {}, 'uri', 'data:image/jpeg;base64,mockBase64Data']]),
          ],
        }),
        mockAgent
      )
    })
  })

  test('Shows an error and adds no photo when compression cannot fit the size budget', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked-photo.jpg' }],
    })
    // Every compression quality tier still exceeds the 12KB budget.
    mockManipulateAsync.mockResolvedValue({
      uri: 'file:///mock-processed.jpg',
      width: 256,
      height: 256,
      base64: 'A'.repeat(13 * 1024),
    })

    const tree = render(
      <StoreProvider initialState={testDefaultState} reducer={defaultReducer}>
        <BasicAppContext>
          <RCardOnboarding agent={mockAgent} />
        </BasicAppContext>
      </StoreProvider>
    )

    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('RCardPhotoInput')))
    })

    await waitFor(async () => {
      expect(await tree.findByText('RCardOnboarding.Errors.PhotoTooLarge')).toBeTruthy()
    })

    expect(tree.queryByTestId(testIdWithKey('RCardPhotoPreview'))).toBeNull()
  })
})
