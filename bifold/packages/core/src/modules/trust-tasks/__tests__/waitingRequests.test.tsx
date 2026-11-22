/**
 * The count of requests waiting for this phone's decision: what the badge on
 * the My Agent tab shows. It must be right without the agent screen ever being
 * opened, drop when a request is decided, and drop when one expires with
 * nothing else happening.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { NavigationContainer } from '@react-navigation/native'
import { act, render, renderHook } from '@testing-library/react-native'
import type { TFunction } from 'i18next'
import React from 'react'
import { Text } from 'react-native'

import enCopy from '../../../localization/en/en.json'
import frCopy from '../../../localization/fr/fr.json'
import ptBrCopy from '../../../localization/pt-br/pt-br.json'
import { vtaAgent, type VtiApproval } from '../module/vtaAgent'
import { myAgentTabBadge, nextExpiry, useWaitingRequestsCount, waitingRequests } from '../module/waitingRequests'

jest.unmock('@react-navigation/native')
jest.unmock('@react-navigation/core')
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

type Setter = { set(next: Record<string, unknown>): void }
const controller = vtaAgent as unknown as Setter

const NOW = Date.parse('2026-10-02T12:00:00Z')
const request = (id: string, over: Partial<VtiApproval> = {}): VtiApproval =>
  ({
    id,
    requester: 'did:peer:2.Vz6MkrequesterXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    taskType: 'https://trusttasks.org/spec/vta/webvh/dids/create/1.0',
    receivedAt: '2026-10-02T11:59:00Z',
    expiresAt: '2026-10-02T12:05:00Z',
    status: 'pending',
    ...over,
  }) as VtiApproval

/** The words the tab speaks, from the English strings. */
const t = ((key: string, options?: { count?: number }) => {
  const tab = enCopy.TabStack as Record<string, string>
  const name = key.replace('TabStack.', '')
  if (options?.count === undefined) return tab[name]
  return tab[`${name}_${options.count === 1 ? 'one' : 'other'}`].replace('{{count}}', String(options.count))
}) as unknown as TFunction

describe('which requests wait', () => {
  it('a pending request waits until its expiry, and not after', () => {
    const one = request('a')
    expect(waitingRequests([one], NOW)).toEqual([one])
    expect(waitingRequests([one], Date.parse('2026-10-02T12:04:59Z'))).toEqual([one])
    expect(waitingRequests([one], Date.parse('2026-10-02T12:05:00Z'))).toEqual([])
  })

  it.each(['approved', 'denied', 'expired'] as const)('a request that is %s does not wait', (status) => {
    expect(waitingRequests([request('a', { status })], NOW)).toEqual([])
  })

  // al-phone, 10-05: an Approve the agent never took left the list and the
  // badge, though the agent still held the request undecided.
  it('a request whose answer did not go through still waits, until its expiry', () => {
    const lost = request('a', { status: 'failed', error: 'not taken' })
    expect(waitingRequests([lost], NOW)).toEqual([lost])
    expect(waitingRequests([lost], Date.parse('2026-10-02T12:05:00Z'))).toEqual([])
  })

  it('a request whose expiry cannot be read is kept rather than hidden', () => {
    expect(waitingRequests([request('a', { expiresAt: 'soon' })], NOW)).toHaveLength(1)
  })

  it('the next expiry is the earliest among those waiting', () => {
    const waiting = [
      request('a', { expiresAt: '2026-10-02T12:09:00Z' }),
      request('b'),
      request('c', { expiresAt: '?' }),
    ]
    expect(nextExpiry(waiting)).toBe(Date.parse('2026-10-02T12:05:00Z'))
    expect(nextExpiry([request('c', { expiresAt: '?' })])).toBeUndefined()
    expect(nextExpiry([])).toBeUndefined()
  })
})

describe('the count, kept current', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(NOW)
    controller.set({ approvals: [] })
  })
  afterEach(() => {
    controller.set({ approvals: [] })
    jest.useRealTimers()
  })

  it('is there without the agent screen: a request that arrives is counted at once', () => {
    const { result } = renderHook(() => useWaitingRequestsCount())
    expect(result.current).toBe(0)
    act(() => controller.set({ approvals: [request('a')] }))
    expect(result.current).toBe(1)
    act(() => controller.set({ approvals: [request('b'), request('a')] }))
    expect(result.current).toBe(2)
  })

  it('drops when each is decided, not when something is merely opened', () => {
    controller.set({ approvals: [request('a'), request('b')] })
    const { result } = renderHook(() => useWaitingRequestsCount())
    expect(result.current).toBe(2)
    act(() => controller.set({ approvals: [request('a', { status: 'approved' }), request('b')] }))
    expect(result.current).toBe(1)
    act(() => controller.set({ approvals: [request('a', { status: 'approved' }), request('b', { status: 'denied' })] }))
    expect(result.current).toBe(0)
  })

  it('drops when a request expires, with nothing else happening', () => {
    controller.set({ approvals: [request('a'), request('b', { expiresAt: '2026-10-02T12:10:00Z' })] })
    const { result } = renderHook(() => useWaitingRequestsCount())
    expect(result.current).toBe(2)
    act(() => {
      jest.advanceTimersByTime(5 * 60 * 1000 + 100)
    })
    expect(result.current).toBe(1)
    act(() => {
      jest.advanceTimersByTime(5 * 60 * 1000 + 100)
    })
    expect(result.current).toBe(0)
  })
})

describe('the My Agent tab', () => {
  it('no badge and the plain name when nothing waits', () => {
    expect(myAgentTabBadge(0, t)).toEqual({ badge: undefined, label: 'My Agent' })
  })

  it('the count, and a spoken label that says what it counts', () => {
    expect(myAgentTabBadge(1, t)).toEqual({ badge: 1, label: 'My Agent, 1 request waiting' })
    expect(myAgentTabBadge(2, t)).toEqual({ badge: 2, label: 'My Agent, 2 requests waiting' })
  })

  it('has its words in every language', () => {
    for (const words of [enCopy, frCopy, ptBrCopy]) {
      const tab = words.TabStack as Record<string, string>
      expect(tab.RequestsWaiting_one).toEqual(expect.any(String))
      expect(tab.RequestsWaiting_other).toMatch(/\{\{count\}\}/)
    }
  })

  // With real tabs: the badge is on the tab bar while another tab is shown.
  it('shows the count on the tab bar from another tab, and takes it away when the request is decided', () => {
    jest.useFakeTimers()
    jest.setSystemTime(NOW)
    controller.set({ approvals: [request('a')] })
    const Tab = createBottomTabNavigator()
    const Screen = ({ id }: { id: string }) => <Text testID={id}>{id}</Text>
    const Tabs = () => {
      const { badge, label } = myAgentTabBadge(useWaitingRequestsCount(), t)
      return (
        <NavigationContainer>
          <Tab.Navigator>
            <Tab.Screen name="Contacts">{() => <Screen id="ContactsScreen" />}</Tab.Screen>
            <Tab.Screen
              name="MyAgent"
              options={{ tabBarBadge: badge, tabBarAccessibilityLabel: label, tabBarTestID: 'MyAgentTab' }}
            >
              {() => <Screen id="AgentScreen" />}
            </Tab.Screen>
          </Tab.Navigator>
        </NavigationContainer>
      )
    }
    const tree = render(<Tabs />)
    // The agent tab has not been opened.
    expect(tree.getByTestId('ContactsScreen')).toBeTruthy()
    expect(tree.getByLabelText('My Agent, 1 request waiting')).toBeTruthy()
    expect(tree.getByText('1')).toBeTruthy()
    act(() => controller.set({ approvals: [request('a', { status: 'approved' })] }))
    expect(tree.queryByLabelText('My Agent, 1 request waiting')).toBeNull()
    expect(tree.getByLabelText('My Agent')).toBeTruthy()
    expect(tree.queryByText('1')).toBeNull()
    controller.set({ approvals: [] })
    jest.useRealTimers()
  })
})
