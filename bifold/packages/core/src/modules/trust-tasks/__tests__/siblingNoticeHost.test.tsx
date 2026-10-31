/**
 * "Also open as you", heard from the presence loop (new-phone-new-device-plan.md
 * §F): each device that starts acting as this agent is named once a session,
 * as openvtc does; a device seen again later in the session says nothing.
 *
 * It shows as a slim strip under the open screen's header (276.10: the card
 * over the header was too much), one line that opens in place to say why, with
 * My devices and OK.
 */
import { useNavigation } from '@react-navigation/native'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { DeviceEventEmitter, View } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import HeaderWithBanner from '../../../components/views/HeaderWithBanner'
import { Screens, TabStacks } from '../../../types/navigators'
import { testIdWithKey } from '../../../utils/testable'
import type { AgentDevice } from '../module/vtaDevices'
import { SIBLING_SEEN_EVENT } from '../module/vtaPresence'
import { SiblingNoticeHost, SiblingNoticeStrip, resetSiblingsAnnounced } from '../screens/SiblingNoticeHost'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
jest.mock('@react-navigation/stack', () => {
  const { View: MockView } = jest.requireActual('react-native')
  return { Header: () => <MockView testID="StackHeader" /> }
})

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

/** The host above the tabs, and the strip one screen's header shows. */
const host = (strips = 1) =>
  render(
    <BasicAppContext>
      <SiblingNoticeHost />
      {Array.from({ length: strips }, (_, i) => (
        <View key={i} testID={`screen-${i}`}>
          <SiblingNoticeStrip />
        </View>
      ))}
    </BasicAppContext>
  )

beforeEach(() => resetSiblingsAnnounced())

describe('also open as you, from the presence loop', () => {
  test('nothing to say until another device is seen', () => {
    expect(host().queryByTestId(id('SiblingNotice'))).toBeNull()
  })

  test('a device seen is one line naming it; it opens to say why, with My devices and OK', async () => {
    const tree = host()
    await seen(A)
    expect(tree.getByTestId(id('SiblingNotice'))).toHaveTextContent(/Devices\.SiblingStripOne/)
    expect(tree.queryByText('Devices.SiblingStripWhy')).toBeNull()
    expect(tree.queryByTestId(id('SiblingNoticeOpen'))).toBeNull()

    fireEvent.press(tree.getByTestId(id('SiblingNotice')))
    expect(tree.getByText('Devices.SiblingStripWhy')).toBeTruthy()
    expect(tree.getByTestId(id('SiblingNotice'))).toHaveProp('accessibilityState', { expanded: true })

    fireEvent.press(tree.getByTestId(id('SiblingNotice')))
    expect(tree.queryByText('Devices.SiblingStripWhy')).toBeNull()
  })

  test('a screen reader hears the whole notice on the one line', async () => {
    const tree = host()
    await seen(A)
    expect(tree.getByTestId(id('SiblingNotice'))).toHaveProp('accessibilityLabel', 'Devices.SiblingOne')
  })

  test('OK says it once: the same device later in the session says nothing', async () => {
    const tree = host()
    await seen(A)
    fireEvent.press(tree.getByTestId(id('SiblingNotice')))
    fireEvent.press(tree.getByTestId(id('SiblingNoticeDismiss')))
    expect(tree.queryByTestId(id('SiblingNotice'))).toBeNull()
    await seen(A)
    expect(tree.queryByTestId(id('SiblingNotice'))).toBeNull()
  })

  test('two devices seen before it is read are counted in one strip', async () => {
    const tree = host()
    await seen(A)
    await seen(B)
    expect(tree.getByTestId(id('SiblingNotice'))).toHaveTextContent(/Devices\.SiblingStripMany/)
    fireEvent.press(tree.getByTestId(id('SiblingNotice')))
    expect(tree.getByText('Devices.SiblingStripWhyMany')).toBeTruthy()
  })

  test('every header shows the same strip: opened or answered in one, it is so in all', async () => {
    const tree = host(2)
    await seen(A)
    const [first, second] = tree.getAllByTestId(id('SiblingNotice'))
    fireEvent.press(first)
    expect(second).toHaveProp('accessibilityState', { expanded: true })
    fireEvent.press(tree.getAllByTestId(id('SiblingNoticeDismiss'))[1])
    expect(tree.queryAllByTestId(id('SiblingNotice'))).toHaveLength(0)
  })

  test('once a session, even if the host is mounted again', async () => {
    const first = host()
    await seen(A)
    fireEvent.press(first.getByTestId(id('SiblingNotice')))
    fireEvent.press(first.getByTestId(id('SiblingNoticeDismiss')))
    first.unmount()
    const again = host()
    await seen(A)
    expect(again.queryByTestId(id('SiblingNotice'))).toBeNull()
  })

  test('My devices opens the list, and the strip goes', async () => {
    const navigation = useNavigation() as unknown as { navigate: jest.Mock }
    navigation.navigate.mockClear()
    const tree = host()
    await seen(A)
    fireEvent.press(tree.getByTestId(id('SiblingNotice')))
    fireEvent.press(tree.getByTestId(id('SiblingNoticeOpen')))
    expect(navigation.navigate).toHaveBeenCalledWith(TabStacks.MyAgentStack, { screen: Screens.VtaDevices })
    expect(tree.queryByTestId(id('SiblingNotice'))).toBeNull()
  })

  test('stops listening when the host goes', async () => {
    const tree = host()
    tree.unmount()
    await seen(A)
    const again = host()
    // A was never shown (nobody was listening), so the first live sighting after this still counts.
    await seen(A)
    expect(again.getByTestId(id('SiblingNotice'))).toBeTruthy()
  })
})

describe('how it looks', () => {
  test('one line, and opened', async () => {
    const tree = host()
    await seen(A)
    expect(tree.toJSON()).toMatchSnapshot('closed')
    fireEvent.press(tree.getByTestId(id('SiblingNotice')))
    expect(tree.toJSON()).toMatchSnapshot('open')
  })
})

describe('where it shows', () => {
  const props = { options: {}, route: {}, navigation: {}, layout: {}, progress: {} } as unknown as React.ComponentProps<
    typeof HeaderWithBanner
  >

  test('under the header, not over it', async () => {
    const tree = render(
      <BasicAppContext>
        <SiblingNoticeHost />
        <HeaderWithBanner {...props} />
      </BasicAppContext>
    )
    await seen(A)
    // Document order: the header first, then the strip.
    const order = tree.UNSAFE_root.findAll((n) => [id('SiblingNotice'), 'StackHeader'].includes(n.props.testID)).map(
      (n) => n.props.testID
    )
    expect(order.indexOf('StackHeader')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf(id('SiblingNotice'))).toBeGreaterThan(order.indexOf('StackHeader'))
  })

  test('a header with nothing to say shows no strip (control)', () => {
    const tree = render(
      <BasicAppContext>
        <SiblingNoticeHost />
        <HeaderWithBanner {...props} />
      </BasicAppContext>
    )
    expect(tree.getByTestId('StackHeader')).toBeTruthy()
    expect(tree.queryByTestId(id('SiblingNotice'))).toBeNull()
  })
})
