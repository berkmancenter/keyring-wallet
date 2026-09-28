/**
 * "Also open as you", heard from the presence loop (new-phone-new-device-plan.md
 * §F): each device that starts acting as this agent is named once a session,
 * as openvtc does; a device seen again later in the session says nothing.
 */
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { DeviceEventEmitter } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { Screens, TabStacks } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import type { AgentDevice } from '../module/vtaDevices'
import { SIBLING_SEEN_EVENT } from '../module/vtaPresence'
import { SiblingNoticeHost, resetSiblingsAnnounced } from '../screens/SiblingNoticeHost'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const id = (key: string) => testIdWithKey(key)
const device = (did: string, displayName: string): AgentDevice => ({
  did,
  source: 'registered',
  isThisPhone: false,
  accessRevoked: false,
  wipePending: false,
  kind: 'keyring',
  platform: 'ios',
  displayName,
})
const A = device('did:peer:2.Vz6MkSiblingA00000001', 'iPhone · added 2 Aug')
const B = device('did:peer:2.Vz6MkSiblingB00000002', 'Android · added 9 Sep')

const seen = async (d: AgentDevice) => {
  await act(async () => {
    DeviceEventEmitter.emit(SIBLING_SEEN_EVENT, d)
  })
}

const host = () =>
  render(
    <BasicAppContext>
      <SiblingNoticeHost />
    </BasicAppContext>
  )

beforeEach(() => resetSiblingsAnnounced())

describe('also open as you, from the presence loop', () => {
  test('nothing to say until another device is seen', () => {
    expect(host().queryByTestId(id('SiblingNotice'))).toBeNull()
  })

  test('a device seen names it, once', async () => {
    const tree = host()
    await seen(A)
    expect(tree.getByTestId(id('SiblingNotice'))).toHaveTextContent(/Devices\.SiblingOne/)
    fireEvent.press(tree.getByTestId(id('SiblingNoticeDismiss')))
    expect(tree.queryByTestId(id('SiblingNotice'))).toBeNull()
    // Live again later in the session: already told.
    await seen(A)
    expect(tree.queryByTestId(id('SiblingNotice'))).toBeNull()
  })

  test('two devices seen before the notice is read are counted in one notice', async () => {
    const tree = host()
    await seen(A)
    await seen(B)
    expect(tree.getByTestId(id('SiblingNotice'))).toHaveTextContent(/Devices\.SiblingMany/)
  })

  test('once a session, even if the notice is mounted again', async () => {
    const first = host()
    await seen(A)
    fireEvent.press(first.getByTestId(id('SiblingNoticeDismiss')))
    first.unmount()
    const again = host()
    await seen(A)
    expect(again.queryByTestId(id('SiblingNotice'))).toBeNull()
  })

  test('My devices opens the list, and the notice goes', async () => {
    const navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
    const tree = host()
    await seen(A)
    fireEvent.press(tree.getByTestId(id('SiblingNoticeOpen')))
    expect(navigation.navigate).toHaveBeenCalledWith(TabStacks.MyAgentStack, { screen: Screens.VtaDevices })
    expect(tree.queryByTestId(id('SiblingNotice'))).toBeNull()
  })

  test('stops listening when it goes', async () => {
    const tree = host()
    tree.unmount()
    await seen(A)
    const again = host()
    // A was never shown (nobody was listening), so the first live sighting after this still counts.
    await seen(A)
    expect(again.getByTestId(id('SiblingNotice'))).toBeTruthy()
  })
})
