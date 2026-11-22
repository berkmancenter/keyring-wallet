/**
 * The remote off for "Connect from a shared code": a release can turn the flow
 * off for everyone, whatever was saved. It never turns it on, it never touches
 * the saved choice, and once lifted everyone is back to their own choice.
 */
import {
  isSharedConnectEnabled,
  isSharedConnectInviteEnabled,
  isSharedConnectLabelEnabled,
  setSharedConnectEnabled,
  setSharedConnectInviteEnabled,
  setSharedConnectLabelEnabled,
} from '../module/sharedConnectFlag'
import { SHARED_CONNECT_REMOTE_OFF } from '../module/sharedConnectRemoteOff'
import { routeKeyringAgentLink } from '../module/vtiLinks'

import { sharedConnectLink } from './fixtures/sharedConnectFixtures'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))

const live = () => sharedConnectLink({ exp: Math.floor(Date.now() / 1000) + 300 })

afterEach(() => {
  SHARED_CONNECT_REMOTE_OFF.connect = false
  SHARED_CONNECT_REMOTE_OFF.invite = false
  setSharedConnectInviteEnabled(false)
  setSharedConnectEnabled(false)
  setSharedConnectLabelEnabled(false)
})

describe('the remote off for connecting from a shared code', () => {
  it('is not set in this release', () => {
    expect(SHARED_CONNECT_REMOTE_OFF).toEqual({ connect: false, invite: false })
  })

  it('beats a saved "on", and the label switch with it', () => {
    // What the app does at start-up with a saved "on".
    setSharedConnectEnabled(true)
    setSharedConnectLabelEnabled(true)
    expect(isSharedConnectEnabled()).toBe(true)

    SHARED_CONNECT_REMOTE_OFF.connect = true
    expect(isSharedConnectEnabled()).toBe(false)
    expect(isSharedConnectLabelEnabled()).toBe(false)
  })

  it('is not undone by the Developer toggle while it is set', () => {
    SHARED_CONNECT_REMOTE_OFF.connect = true
    setSharedConnectEnabled(true)
    expect(isSharedConnectEnabled()).toBe(false)
  })

  it('once lifted, the saved "on" is back, untouched', () => {
    setSharedConnectEnabled(true)
    SHARED_CONNECT_REMOTE_OFF.connect = true
    expect(isSharedConnectEnabled()).toBe(false)
    SHARED_CONNECT_REMOTE_OFF.connect = false
    expect(isSharedConnectEnabled()).toBe(true)
  })

  it('a saved "on" set while it is off (a start-up under it) is kept as it was, and back once lifted', () => {
    SHARED_CONNECT_REMOTE_OFF.connect = true
    setSharedConnectEnabled(true)
    expect(isSharedConnectEnabled()).toBe(false)
    SHARED_CONNECT_REMOTE_OFF.connect = false
    expect(isSharedConnectEnabled()).toBe(true)
  })

  it('never turns the flow on: a person’s own "off" stays off, set or lifted', () => {
    setSharedConnectEnabled(false)
    for (const remoteOff of [true, false]) {
      SHARED_CONNECT_REMOTE_OFF.connect = remoteOff
      expect(isSharedConnectEnabled()).toBe(false)
    }
  })

  it('turns off the flow itself, not only a button: a shared-connect link is answered as one this build does not know', async () => {
    setSharedConnectEnabled(true)
    SHARED_CONNECT_REMOTE_OFF.connect = true
    const navigate = jest.fn()
    const resolve = jest.fn()
    await expect(routeKeyringAgentLink(live(), { dids: { resolve } } as never, navigate)).rejects.toMatchObject({
      messageKey: 'Scan.TriggerLinkUpdate',
    })
    expect(navigate).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('and once lifted, the same link opens its confirm screen again', async () => {
    setSharedConnectEnabled(true)
    const navigate = jest.fn()
    await routeKeyringAgentLink(live(), { dids: { resolve: jest.fn() } } as never, navigate)
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ screen: 'SharedConnect' }))
  })
})

// Two independent remote offs (Alberto chose one for each switch). Each row of the pair passes with a wrong
// implementation on its own; together they pin it: `invite` alone must leave the scanner working, and `connect`
// must turn the inviter off through the inviter's own predicate.
describe('the remote off for showing a code', () => {
  const savedOn = () => {
    setSharedConnectEnabled(true)
    setSharedConnectInviteEnabled(true)
  }

  it('alone, turns "Show a code" off and leaves connecting from a shared code working', async () => {
    savedOn()
    SHARED_CONNECT_REMOTE_OFF.invite = true
    expect(isSharedConnectInviteEnabled()).toBe(false)
    expect(isSharedConnectEnabled()).toBe(true)
    const navigate = jest.fn()
    await routeKeyringAgentLink(live(), { dids: { resolve: jest.fn() } } as never, navigate)
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ screen: 'SharedConnect' }))
  })

  it('the scanner’s remote off turns "Show a code" off too, read on the inviter’s own switch', () => {
    savedOn()
    SHARED_CONNECT_REMOTE_OFF.connect = true
    expect(SHARED_CONNECT_REMOTE_OFF.invite).toBe(false)
    expect(isSharedConnectInviteEnabled()).toBe(false)
    expect(isSharedConnectEnabled()).toBe(false)
  })

  it('once lifted, a saved "on" is back, untouched', () => {
    savedOn()
    SHARED_CONNECT_REMOTE_OFF.invite = true
    expect(isSharedConnectInviteEnabled()).toBe(false)
    SHARED_CONNECT_REMOTE_OFF.invite = false
    expect(isSharedConnectInviteEnabled()).toBe(true)
  })

  it('a saved "on" applied at a start-up under it is kept, and back once lifted', () => {
    SHARED_CONNECT_REMOTE_OFF.invite = true
    savedOn()
    expect(isSharedConnectInviteEnabled()).toBe(false)
    SHARED_CONNECT_REMOTE_OFF.invite = false
    expect(isSharedConnectInviteEnabled()).toBe(true)
  })

  it('never turns "Show a code" on: a person’s own "off" stays off, set or lifted', () => {
    setSharedConnectEnabled(true)
    setSharedConnectInviteEnabled(false)
    for (const remoteOff of [true, false]) {
      SHARED_CONNECT_REMOTE_OFF.invite = remoteOff
      expect(isSharedConnectInviteEnabled()).toBe(false)
    }
  })
})
