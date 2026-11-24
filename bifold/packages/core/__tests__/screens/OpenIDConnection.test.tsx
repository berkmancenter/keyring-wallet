/* eslint-disable @typescript-eslint/no-explicit-any */
import { useNavigation } from '@react-navigation/native'
import { render, act, fireEvent } from '@testing-library/react-native'
import React from 'react'
import { DeviceEventEmitter } from 'react-native'

import OpenIDConnectionScreen from '../../src/modules/openid/screens/OpenIDConnection'
import { testIdWithKey } from '../../src/utils/testable'
import { BasicAppContext } from '../helpers/app'
import { BifoldError } from '../../src/types/error'
import { EventTypes } from '../../src/constants'
import { Stacks } from '../../src/types/navigators'

const openIDUri = '123456'
const openIDPresentationUri = '//'

jest.useFakeTimers({ legacyFakeTimers: true })

describe('OpenID Connection Screen', () => {
  beforeEach(() => {
    jest.clearAllTimers()
    jest.clearAllMocks()
  })

  test('Renders correctly', async () => {
    const tree = (
      <BasicAppContext>
        <OpenIDConnectionScreen
          navigation={useNavigation()}
          route={{ params: { openIDUri, openIDPresentationUri } } as any}
        />
      </BasicAppContext>
    )
    const { getByTestId } = render(tree)

    const loading = getByTestId(testIdWithKey('Loading'))

    expect(loading).not.toBeNull()
  })

  test('Displays error correctly', async () => {
    const tree = (
      <BasicAppContext>
        <OpenIDConnectionScreen
          navigation={useNavigation()}
          route={{ params: { openIDUri, openIDPresentationUri } } as any}
        />
      </BasicAppContext>
    )
    const { findByText } = render(tree)

    act(() => {
      const error = new BifoldError('ErrorTitle', 'ErrorDescription', 'ErrorMessage', 1043)
      DeviceEventEmitter.emit(EventTypes.OPENID_CONNECTION_ERROR, error)
    })

    expect(await findByText('Error.GenericError.Title')).not.toBeNull()
    expect(await findByText('FullScreenErrorModal.PrimaryCTA')).not.toBeNull()
  })

  test('the error screen has a way out: its button closes it and goes home', async () => {
    const navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
    const tree = (
      <BasicAppContext>
        <OpenIDConnectionScreen
          navigation={useNavigation()}
          route={{ params: { openIDUri, openIDPresentationUri } } as any}
        />
      </BasicAppContext>
    )
    const { findByText, queryByText } = render(tree)

    act(() => {
      DeviceEventEmitter.emit(
        EventTypes.OPENID_CONNECTION_ERROR,
        new BifoldError('ErrorTitle', 'ErrorDescription', 'ErrorMessage', 1043)
      )
    })
    const cta = await findByText('FullScreenErrorModal.PrimaryCTA')
    act(() => {
      fireEvent.press(cta)
    })

    // The tab stack, which opens on the first tab: Keyring registers no Home tab.
    expect(navigation.navigate).toHaveBeenCalledWith(Stacks.TabStack)
    expect(queryByText('FullScreenErrorModal.PrimaryCTA')).toBeNull()
  })

  test('every word the error screen shows exists in each language, so no raw key reaches a person', () => {
    const keys = [
      'Global.AppName',
      'Error.GenericError.Title',
      'Error.GenericError.Message',
      'FullScreenErrorModal.PrimaryCTA',
    ]
    for (const lang of ['en', 'fr', 'pt-br']) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const copy = require(`../../src/localization/${lang}/${lang}.json`)
      for (const key of keys) {
        const value = key.split('.').reduce((o: any, part) => (o ? o[part] : undefined), copy)
        expect(typeof value).toBe('string')
        expect(value).not.toBe(key)
      }
    }
  })
})
