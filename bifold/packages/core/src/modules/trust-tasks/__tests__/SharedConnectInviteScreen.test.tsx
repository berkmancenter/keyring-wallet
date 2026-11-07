/**
 * The "Show a code" screen (plan WP9, Keyring as the inviter), against a fake
 * invite: what each state shows, that the time left runs only while the code
 * can be scanned and leaves no timer behind, and that Cancel tears the code down
 * before the screen closes.
 */
import Clipboard from '@react-native-clipboard/clipboard'
import { act, fireEvent, render } from '@testing-library/react-native'
import React from 'react'
import { Share, StyleSheet } from 'react-native'

import { BasicAppContext } from '../../../../__tests__/helpers/app'
import { testIdWithKey } from '../../../utils/testable'
import type { SharedConnectInvite } from '../module/sharedConnectInviteTypes'
import { SharedConnectInviteIds as Ids } from '../screens/SharedConnect.ids'
import {
  QR_MARGIN,
  SharedConnectInviteView,
  clockOf,
  makeSharedConnectInviteScreen,
  secondsLeft,
} from '../screens/SharedConnectInvite'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
// The words with what was put into them, so the time left and the expiry can be read.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values
        ? `${key}(${Object.values(values)
            .filter((v) => typeof v !== 'object')
            .join(',')})`
        : key,
  }),
}))

const id = (key: string) => testIdWithKey(key)
const NOW = 1_800_000_000_000
const LINK = 'https://link.trustoverip.org/t#_from=did:peer:2.x&_id=XOcGXOQTCHb5iz4T2JD2RQ&_exp=1800000600'

const invite = (over: Partial<SharedConnectInvite> = {}): SharedConnectInvite => ({
  state: 'waiting',
  link: LINK,
  expiresAt: NOW / 1000 + 600,
  cancel: jest.fn(async () => undefined),
  renew: jest.fn(),
  ...over,
})

let clock = NOW
const now = () => clock
const onClose = jest.fn()
const show = (i: SharedConnectInvite) =>
  render(
    <BasicAppContext>
      <SharedConnectInviteView invite={i} onClose={onClose} now={now} />
    </BasicAppContext>
  )
const textOf = (tree: ReturnType<typeof render>, key: string) =>
  [tree.getByTestId(id(key)).props.children].flat().join('')

/**
 * The timers this test started and never cleared. Counted by id rather than with
 * jest.getTimerCount(): unmounting a tree schedules a timer of React's own.
 */
const timers = () => {
  const setI = jest.spyOn(global, 'setInterval')
  const clearI = jest.spyOn(global, 'clearInterval')
  const setT = jest.spyOn(global, 'setTimeout')
  const clearT = jest.spyOn(global, 'clearTimeout')
  const open = (set: jest.SpyInstance, clear: jest.SpyInstance) => {
    const cleared = new Set(clear.mock.calls.map(([handle]) => handle))
    return set.mock.results.map((r) => r.value).filter((handle) => !cleared.has(handle))
  }
  return {
    intervals: () => open(setI, clearI),
    timeouts: () => open(setT, clearT),
    started: () => setI.mock.calls.length,
  }
}

beforeEach(() => {
  jest.useFakeTimers()
  clock = NOW
  onClose.mockReset()
})
afterEach(() => {
  jest.restoreAllMocks()
  jest.clearAllTimers()
  jest.useRealTimers()
})

describe('the time left', () => {
  it('reads as minutes and two-digit seconds, and never below zero', () => {
    expect(clockOf(600)).toBe('10:00')
    expect(clockOf(581)).toBe('9:41')
    expect(clockOf(5)).toBe('0:05')
    expect(secondsLeft(NOW / 1000 + 600, NOW)).toBe(600)
    expect(secondsLeft(NOW / 1000 + 600, NOW + 400)).toBe(600)
    expect(secondsLeft(NOW / 1000, NOW + 5000)).toBe(0)
  })

  it('counts down once a second while the code is shown', () => {
    const tree = show(invite())
    expect(textOf(tree, Ids.countdown)).toBe('SharedConnectInvite.TimeLeft(10:00)')
    act(() => {
      clock += 61_000
      jest.advanceTimersByTime(61_000)
    })
    expect(textOf(tree, Ids.countdown)).toBe('SharedConnectInvite.TimeLeft(8:59)')
  })

  // expiryText (#954) says a time alone for today and a date for another day; the screen's clock decides which day
  // "today" is, so the boundary is pinned here rather than read off the real clock (TZ=GMT under jest).
  it('says when the code expires in the app’s words: the time alone when it is today', () => {
    clock = Date.UTC(2027, 0, 15, 8, 0)
    const tree = show(invite({ expiresAt: clock / 1000 + 600 }))
    expect(textOf(tree, Ids.expiresAt)).toMatch(/^SharedConnect\.Expires\(/)
  })

  it('and its date as well when the ten minutes run past midnight', () => {
    clock = Date.UTC(2027, 0, 15, 23, 55)
    const tree = show(invite({ expiresAt: clock / 1000 + 600 }))
    expect(textOf(tree, Ids.expiresAt)).toMatch(/^SharedConnect\.ExpiresOn\(/)
  })

  it('leaves no timer running once the code can no longer be scanned', () => {
    const t = timers()
    const live = invite()
    const tree = show(live)
    expect(t.intervals()).toHaveLength(1)
    for (const state of ['connecting', 'connected', 'expired', 'failed', 'cancelled'] as const) {
      tree.rerender(
        <BasicAppContext>
          <SharedConnectInviteView invite={{ ...live, state }} onClose={onClose} now={now} />
        </BasicAppContext>
      )
      expect(t.intervals()).toHaveLength(0)
    }
    expect(t.started()).toBe(1)
  })

  it('keeps running while someone is asking, and stops when the screen goes away', () => {
    const t = timers()
    const tree = show(invite({ state: 'proposed' }))
    expect(t.intervals()).toHaveLength(1)
    tree.unmount()
    expect(t.intervals()).toHaveLength(0)
  })
})

describe('the code', () => {
  it('shows the code, the link for the e2e drivers, and Cancel', () => {
    const tree = show(invite())
    expect(tree.getByTestId(id(Ids.waiting))).toBeTruthy()
    expect(tree.getByTestId(id(Ids.qr))).toBeTruthy()
    expect(textOf(tree, Ids.link)).toBe(LINK)
    expect(tree.getByTestId(id(Ids.cancel))).toBeTruthy()
  })

  it('keeps the white box around the code as tall as the code and its margins, no taller', () => {
    // On a phone QRRenderer grows to fill the room it is given; an unbounded box took the whole screen and pushed the
    // time left, Copy link and Share below it (WP9 live run on Android, 11-07). Jest has no layout, so this pins the
    // box's own height: the code's size (280 at the test window's width) plus QRRenderer's margin above and below.
    const tree = show(invite())
    let box = tree.getByTestId(id(Ids.qr)).parent
    while (box && (typeof box.type !== 'string' || box.props.testID === id(Ids.qr))) box = box.parent
    const style = StyleSheet.flatten(box?.props.style)
    expect(style.height).toBe(280 + 2 * QR_MARGIN)
    expect(style.backgroundColor).toBeDefined()
  })

  it('shows nothing of the code until it is made', () => {
    const tree = show(invite({ state: 'minting', link: undefined, expiresAt: undefined }))
    expect(tree.getByTestId(id(Ids.minting))).toBeTruthy()
    expect(tree.queryByTestId(id(Ids.qr))).toBeNull()
    expect(tree.queryByTestId(id(Ids.link))).toBeNull()
  })

  it('copies the link, and says so', () => {
    const t = timers()
    const tree = show(invite())
    fireEvent.press(tree.getByTestId(id(Ids.copyLink)))
    expect(Clipboard.setString).toHaveBeenCalledWith(LINK)
    expect(tree.getByText('SharedConnectInvite.Copied')).toBeTruthy()
    tree.unmount()
    // Only the copy's own timer: the countdown's interval is the time-left tests' to pin.
    expect(t.timeouts()).toHaveLength(0)
  })

  it('shares the link', () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' })
    const tree = show(invite())
    fireEvent.press(tree.getByTestId(id(Ids.shareLink)))
    expect(JSON.stringify(share.mock.calls[0][0])).toContain(LINK)
    share.mockRestore()
  })

  it('Cancel tears the code down before the screen closes', async () => {
    const order: string[] = []
    const live = invite({
      cancel: jest.fn(async () => {
        order.push('cancel')
      }),
    })
    onClose.mockImplementation(() => order.push('close'))
    const tree = show(live)
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(Ids.cancel)))
    })
    expect(order).toEqual(['cancel', 'close'])
  })
})

describe('how it ends', () => {
  it('connecting offers Stop, which tears the code down', async () => {
    const live = invite({ state: 'connecting' })
    const tree = show(live)
    expect(tree.getByTestId(id(Ids.connecting))).toBeTruthy()
    expect(tree.getByText('SharedConnectInvite.Stop')).toBeTruthy()
    await act(async () => {
      fireEvent.press(tree.getByTestId(id(Ids.cancel)))
    })
    expect(live.cancel).toHaveBeenCalledTimes(1)
  })

  it('connected offers Done only', () => {
    const tree = show(invite({ state: 'connected' }))
    expect(tree.getByTestId(id(Ids.connected))).toBeTruthy()
    expect(tree.getByTestId(id(Ids.done))).toBeTruthy()
    expect(tree.queryByTestId(id(Ids.renew))).toBeNull()
    expect(tree.queryByTestId(id(Ids.qr))).toBeNull()
  })

  it.each(['expired', 'cancelled'] as const)('%s offers a new code', (state) => {
    const live = invite({ state })
    const tree = show(live)
    expect(tree.getByTestId(id(Ids[state]))).toBeTruthy()
    expect(tree.queryByTestId(id(Ids.qr))).toBeNull()
    fireEvent.press(tree.getByTestId(id(Ids.renew)))
    expect(live.renew).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['declined', 'SharedConnectInvite.FailedDeclined'],
    ['relay', 'SharedConnectInvite.FailedRelay'],
    ['send', 'SharedConnectInvite.FailedSend'],
    ['exhausted', 'SharedConnectInvite.FailedExhausted'],
    ['rejected', 'SharedConnectInvite.FailedRejected'],
    ['unknown', 'SharedConnectInvite.FailedUnknown'],
    [undefined, 'SharedConnectInvite.FailedUnknown'],
  ] as const)('failed (%s) says why', (failure, words) => {
    const tree = show(invite({ state: 'failed', failure }))
    expect(tree.getByTestId(id(Ids.failed))).toBeTruthy()
    expect(tree.getByText(words)).toBeTruthy()
    expect(tree.getByTestId(id(Ids.renew))).toBeTruthy()
  })
})

// Alberto, 11-06: with the switch off, the button is gone AND nothing starts, however the screen was reached.
describe('the route, by the inviter switch', () => {
  const route = (enabled: boolean) => {
    const useInvite = jest.fn(() => invite())
    const Screen = makeSharedConnectInviteScreen(useInvite, () => enabled)
    const tree = render(
      <BasicAppContext>
        <Screen />
      </BasicAppContext>
    )
    return { tree, useInvite }
  }

  it('off: the hook is never mounted, so no code is made, and the screen says it is off', () => {
    const { tree, useInvite } = route(false)
    expect(useInvite).not.toHaveBeenCalled()
    expect(tree.getByTestId(id(Ids.off))).toBeTruthy()
    expect(tree.queryByTestId(id(Ids.qr))).toBeNull()
  })

  it('on: the hook runs and the code is shown', () => {
    const { tree, useInvite } = route(true)
    expect(useInvite).toHaveBeenCalled()
    expect(tree.getByTestId(id(Ids.qr))).toBeTruthy()
    expect(tree.queryByTestId(id(Ids.off))).toBeNull()
  })
})
