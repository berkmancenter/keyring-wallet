import Clipboard from '@react-native-clipboard/clipboard'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import React from 'react'

import { useNavigation } from '@react-navigation/core'
import { StoreProvider, defaultState } from '../../src/contexts/store'
import PasteUrl from '../../src/screens/PasteUrl'
import { testIdWithKey } from '../../src/utils/testable'
import { BasicAppContext } from '../helpers/app'
import * as helpers from '../../src/utils/helpers'
import { KeyringLinkError } from '../../src/modules/trust-tasks/module/vtiLinks'

const waitTimeMs = 300

describe('PasteUrl Screen', () => {
  const mockConnectFromScanOrDeepLink = jest.spyOn(helpers, 'connectFromScanOrDeepLink').mockResolvedValue(undefined)
  const navigation = useNavigation()

  beforeEach(() => {
    mockConnectFromScanOrDeepLink.mockClear()
  })

  test('Paste URL renders correctly', () => {
    const tree = render(
      <BasicAppContext>
        <StoreProvider
          initialState={{
            ...defaultState,
            preferences: { ...defaultState.preferences, enableShareableLink: true },
          }}
        >
          <PasteUrl navigation={navigation as any} route={{} as any} />
        </StoreProvider>
      </BasicAppContext>
    )
    expect(tree).toMatchSnapshot()
  })

  test('Test Error textbox empty messages', async () => {
    const tree = render(
      <BasicAppContext>
        <StoreProvider
          initialState={{
            ...defaultState,
            preferences: { ...defaultState.preferences, enableShareableLink: true },
          }}
        >
          <PasteUrl navigation={navigation as any} route={{} as any} />
        </StoreProvider>
      </BasicAppContext>
    )

    const touchableDisabled = tree.getByTestId(testIdWithKey('ScanPastedUrlDisabled'))
    expect(touchableDisabled).not.toBeNull()

    await act(async () => {
      fireEvent.press(touchableDisabled)
      await new Promise((resolve) => setTimeout(resolve, waitTimeMs))
    })

    await waitFor(async () => {
      expect(await tree.queryAllByText('PasteUrl.ErrorTextboxEmpty')).toHaveLength(1)
    })
  })

  test('Test Error textbox invalid url messages', async () => {
    mockConnectFromScanOrDeepLink.mockRejectedValueOnce('Invalid URL')
    const tree = render(
      <BasicAppContext>
        <StoreProvider
          initialState={{
            ...defaultState,
            preferences: { ...defaultState.preferences, enableShareableLink: true },
          }}
        >
          <PasteUrl navigation={navigation as any} route={{} as any} />
        </StoreProvider>
      </BasicAppContext>
    )

    const textbox = tree.getByTestId(testIdWithKey('PastedUrl'))
    expect(textbox).not.toBeNull()

    act(() => {
      fireEvent.changeText(textbox, 'non-empty-text')
    })

    const continueButton = tree.getByTestId(testIdWithKey('ScanPastedUrl'))
    expect(continueButton).not.toBeNull()

    await act(async () => {
      fireEvent.press(continueButton)
      await new Promise((resolve) => setTimeout(resolve, waitTimeMs))
    })

    await waitFor(async () => {
      expect(await tree.queryAllByText('PasteUrl.ErrorInvalidUrl')).toHaveLength(1)
    })
  })

  // keyring-bifold#139 gate: a used console invitation QR, pasted, said "URL
  // not recognized" for a link Keyring did recognize. Ours is said in words.
  test('a Keyring link that cannot be used says why, not "URL not recognized"', async () => {
    mockConnectFromScanOrDeepLink.mockRejectedValueOnce(
      new KeyringLinkError('This invitation has already been used, or the admin replaced it.')
    )
    const tree = render(
      <BasicAppContext>
        <StoreProvider
          initialState={{
            ...defaultState,
            preferences: { ...defaultState.preferences, enableShareableLink: true },
          }}
        >
          <PasteUrl navigation={navigation as any} route={{} as any} />
        </StoreProvider>
      </BasicAppContext>
    )
    act(() => {
      fireEvent.changeText(
        tree.getByTestId(testIdWithKey('PastedUrl')),
        'openid-credential-offer://?credential_offer=x'
      )
    })
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('ScanPastedUrl')))
      await new Promise((resolve) => setTimeout(resolve, waitTimeMs))
    })
    await waitFor(async () => {
      expect(await tree.queryAllByText('Scan.CodeNotUsable')).toHaveLength(1)
      expect(await tree.queryAllByText(/already been used/)).toHaveLength(1)
      expect(await tree.queryAllByText('PasteUrl.ErrorInvalidUrl')).toHaveLength(0)
    })
  })

  test('Test valid url navigation', async () => {
    const tree = render(
      <BasicAppContext>
        <StoreProvider
          initialState={{
            ...defaultState,
            preferences: { ...defaultState.preferences, enableShareableLink: true },
          }}
        >
          <PasteUrl navigation={navigation as any} route={{} as any} />
        </StoreProvider>
      </BasicAppContext>
    )

    const textbox = tree.getByTestId(testIdWithKey('PastedUrl'))
    expect(textbox).not.toBeNull()

    act(() => {
      fireEvent.changeText(textbox, 'non-empty-text')
    })

    const continueButton = tree.getByTestId(testIdWithKey('ScanPastedUrl'))
    expect(continueButton).not.toBeNull()

    await act(async () => {
      fireEvent.press(continueButton)
      await new Promise((resolve) => setTimeout(resolve, waitTimeMs))
    })

    expect(mockConnectFromScanOrDeepLink).toHaveBeenCalledTimes(1)

    await waitFor(async () => {
      expect(await tree.queryAllByTestId(testIdWithKey('ErrorModal'))).toHaveLength(0)
    })
  })
  const renderScreen = () =>
    render(
      <BasicAppContext>
        <StoreProvider initialState={defaultState}>
          <PasteUrl navigation={navigation as any} route={{} as any} />
        </StoreProvider>
      </BasicAppContext>
    )

  test('Paste with an empty clipboard says there is nothing to paste, instead of doing nothing', async () => {
    (Clipboard.getString as jest.Mock).mockResolvedValueOnce('')
    const tree = renderScreen()
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('PasteFromClipboard')))
    })
    expect(tree.getByTestId(testIdWithKey('PasteNothing'))).toHaveTextContent('PasteUrl.NothingToPaste')
  })

  test('Paste fills the box and says what it read', async () => {
    (Clipboard.getString as jest.Mock).mockResolvedValueOnce('keyring://vti/invite?x=1')
    const tree = renderScreen()
    await act(async () => {
      fireEvent.press(tree.getByTestId(testIdWithKey('PasteFromClipboard')))
    })
    expect(tree.getByTestId(testIdWithKey('PastedUrl')).props.value).toBe('keyring://vti/invite?x=1')
    expect(tree.getByTestId(testIdWithKey('PasteRead'))).toBeTruthy()
  })

  test('the new words exist in each language', () => {
    for (const lang of ['en', 'fr', 'pt-br']) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const copy = require(`../../src/localization/${lang}/${lang}.json`).PasteUrl
      for (const key of ['PasteFromClipboard', 'NothingToPaste', 'Read', 'ErrorInvalidUrlRead']) {
        expect(typeof copy[key]).toBe('string')
      }
    }
  })
})
