/**
 * Before an invitation goes out as a link: the gate says to ask only where turning notifications on makes the phone
 * wakeable (push in the build, an agent linked, permission not given), turning them on also makes the phone wakeable,
 * and every way out of the sheet carries on to the share (IN-448).
 */
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native'
import React from 'react'
import { Modal, Platform } from 'react-native'
import { container } from 'tsyringe'

import { useAgent } from '@bifold/react-hooks'

import { TOKENS } from '../../../../src/container-api'
import { MainContainer, defaultConfig } from '../../../../src/container-impl'
import RemoteVrcNotificationsAsk, {
  DISMISS_FALLBACK_MS,
  WAKEABLE_WAIT_MS,
  resetRemoteVrcNotificationsAsk,
  useRemoteVrcNotificationsGate,
} from '../../../../src/modules/vrc/components/RemoteVrcNotificationsAsk'
import { vtaAgent } from '../../../../src/modules/trust-tasks/module/vtaAgent'
import { testIdWithKey } from '../../../../src/utils/testable'
import { CustomBasicAppContext } from '../../../helpers/app'

jest.mock('@bifold/react-hooks')

const agent = { config: { logger: { warn: jest.fn() } } }

function context(opts: { push?: boolean; linked?: boolean; status?: () => Promise<string>; afterSetup?: string }) {
  const status = jest.fn(opts.status ?? (async () => 'denied'))
  const setup = jest.fn().mockResolvedValue(opts.afterSetup ?? 'granted')
  const toggle = jest.fn().mockResolvedValue(undefined)
  const child = container.createChildContainer()
  const c = new MainContainer(child).init()
  child.registerInstance(TOKENS.CONFIG, {
    ...defaultConfig,
    ...(opts.push === false ? {} : { enablePushNotifications: { status, setup, toggle } }),
  })
  jest.spyOn(vtaAgent, 'getState').mockReturnValue({
    ...vtaAgent.getState(),
    link: (opts.linked === false ? { kind: 'notLinked' } : { kind: 'linked' }) as never,
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <CustomBasicAppContext container={c}>{children}</CustomBasicAppContext>
  )
  return { wrapper, status, setup, toggle }
}

const gateSays = async (opts: Parameters<typeof context>[0]) => {
  const { wrapper } = context(opts)
  const { result } = renderHook(() => useRemoteVrcNotificationsGate(), { wrapper })
  return result.current()
}

function sheet(opts: Parameters<typeof context>[0] = {}) {
  const ctx = context(opts)
  const onDone = jest.fn()
  const tree = render(<RemoteVrcNotificationsAsk onDone={onDone} />, { wrapper: ctx.wrapper })
  return { ...ctx, onDone, tree }
}

describe('the notifications ask before an invitation goes out as a link', () => {
  beforeEach(() => {
    resetRemoteVrcNotificationsAsk()
    ;(useAgent as jest.Mock).mockReturnValue({ agent })
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('asks a linked phone whose notifications are off', async () => {
    expect(await gateSays({})).toBe(true)
  })

  const noAsk: [string, Parameters<typeof context>[0]][] = [
    ['no push in the build', { push: false }],
    ['no agent linked: turning them on would not make it wakeable', { linked: false }],
    ['notifications already on', { status: async () => 'granted' }],
    ['a permission it could not read', { status: () => Promise.reject(new Error('no')) }],
  ]
  it.each(noAsk)('does not ask with %s', async (_label, opts) => {
    expect(await gateSays(opts)).toBe(false)
  })

  it('says its line, with Turn on and Not now', () => {
    const { tree } = sheet()
    expect(tree.getByText('RemoteVrcNotify.Ask')).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsTurnOn'))).toBeTruthy()
    expect(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsNotNow'))).toBeTruthy()
  })

  it('"Turn on" asks for the permission, makes the phone wakeable, then carries on to the share', async () => {
    const { tree, setup, toggle, onDone } = sheet()
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsTurnOn'))))
    expect(setup).toHaveBeenCalledTimes(1)
    expect(toggle).toHaveBeenCalledWith(true, agent)
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  })

  it('a refused permission says so, makes nothing wakeable, and Continue carries on to the share', async () => {
    const { tree, toggle, onDone } = sheet({ afterSetup: 'denied' })
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsTurnOn'))))
    expect(toggle).not.toHaveBeenCalled()
    expect(tree.getByText('RemoteVrcNotify.Denied')).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('RemoteVrcNotificationsTurnOn'))).toBeNull()
    expect(onDone).not.toHaveBeenCalled()
    fireEvent.press(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsNotNow')))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  })

  it('an approval rule holding it says so, and Continue carries on to the share', async () => {
    const { tree, toggle, onDone } = sheet()
    toggle.mockImplementation(async () => {
      jest
        .spyOn(vtaAgent, 'getState')
        .mockReturnValue({ ...vtaAgent.getState(), wakeBlockedByRule: true, link: { kind: 'linked' } as never })
      return 'held'
    })
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsTurnOn'))))
    expect(tree.getByText('PushNotifications.BlockedByApprovalRule')).toBeTruthy()
    expect(tree.queryByTestId(testIdWithKey('RemoteVrcNotificationsTurnOn'))).toBeNull()
    expect(onDone).not.toHaveBeenCalled()
    fireEvent.press(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsNotNow')))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  })

  it('turning on that did not work says so, and Continue carries on to the share', async () => {
    const { tree, toggle, onDone } = sheet()
    toggle.mockResolvedValue('failed')
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsTurnOn'))))
    expect(tree.getByText('PushNotifications.NotSetUpYet')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
    fireEvent.press(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsNotNow')))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  })

  it('an outcome not known goes straight on: today nothing says it failed', async () => {
    const { tree, toggle, onDone } = sheet()
    toggle.mockResolvedValue(undefined)
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsTurnOn'))))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(tree.queryByText('PushNotifications.NotSetUpYet')).toBeNull()
  })

  it('past the wait, an old approval flag does not stop the share: it is from before this try', async () => {
    jest.useFakeTimers()
    const { tree, toggle, onDone } = sheet()
    jest
      .spyOn(vtaAgent, 'getState')
      .mockReturnValue({ ...vtaAgent.getState(), wakeBlockedByRule: true, link: { kind: 'linked' } as never })
    toggle.mockReturnValue(new Promise(() => undefined))
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsTurnOn'))))
    await act(async () => {
      jest.advanceTimersByTime(WAKEABLE_WAIT_MS)
    })
    await act(async () => {
      jest.advanceTimersByTime(DISMISS_FALLBACK_MS)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(tree.queryByText('PushNotifications.BlockedByApprovalRule')).toBeNull()
  })

  it('a phone that is slow to become wakeable does not hold up the share', async () => {
    jest.useFakeTimers()
    const { tree, toggle, onDone } = sheet()
    toggle.mockReturnValue(new Promise(() => undefined))
    await act(async () => fireEvent.press(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsTurnOn'))))
    expect(onDone).not.toHaveBeenCalled()
    await act(async () => {
      jest.advanceTimersByTime(WAKEABLE_WAIT_MS)
    })
    // The sheet leaves first, and iOS waits for that.
    await act(async () => {
      jest.advanceTimersByTime(DISMISS_FALLBACK_MS)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('on iOS the share waits for the sheet to have gone, and opens once', async () => {
    jest.useFakeTimers()
    const { tree, onDone } = sheet()
    const modal = tree.UNSAFE_getByType(Modal)
    fireEvent.press(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsNotNow')))
    // Too early and iOS refuses the share sheet, so "Share as a link" would do nothing.
    expect(onDone).not.toHaveBeenCalled()
    act(() => modal.props.onDismiss())
    expect(onDone).toHaveBeenCalledTimes(1)
    await act(async () => {
      jest.advanceTimersByTime(DISMISS_FALLBACK_MS * 2)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('on iOS a dismissal never reported still reaches the share, but not early', async () => {
    jest.useFakeTimers()
    const { tree, onDone } = sheet()
    fireEvent.press(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsNotNow')))
    await act(async () => {
      jest.advanceTimersByTime(DISMISS_FALLBACK_MS - 1)
    })
    expect(onDone).not.toHaveBeenCalled()
    await act(async () => {
      jest.advanceTimersByTime(1)
    })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('on Android the share does not wait', () => {
    jest.replaceProperty(Platform, 'OS', 'android')
    const { tree, onDone } = sheet()
    fireEvent.press(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsNotNow')))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('"Not now" carries on to the share and puts the ask away for this run of the app', async () => {
    const { tree, onDone } = sheet()
    fireEvent.press(tree.getByTestId(testIdWithKey('RemoteVrcNotificationsNotNow')))
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(await gateSays({})).toBe(false)
  })

  it('the buttons are reached past the line, in a scroll', () => {
    const { tree } = sheet()
    let parent = tree.getByTestId(testIdWithKey('RemoteVrcNotificationsTurnOn')).parent
    while (parent && String(parent.type) !== 'RCTScrollView') parent = parent.parent
    expect(parent).toBeTruthy()
    const json = JSON.stringify(tree.toJSON())
    expect(json.indexOf('RemoteVrcNotify.Ask')).toBeLessThan(json.indexOf('RemoteVrcNotificationsTurnOn'))
  })
})
