import { SEDI_KERI_REMOTE_OFF } from '../../trust-tasks/module/sediKeriRemoteOff'
import {
  STATE_VERIFIED_APPROVERS_REMOTE_OFF,
  setStateVerifiedApproversEnabled,
} from '../../trust-tasks/module/stateVerifiedApproversFlag'
import { TRUSTED_APPROVERS_REMOTE_OFF, setTrustedApproversEnabled } from '../../trust-tasks/module/trustedApproversFlag'
import * as stateRoots from '../guardian/stateRoots'
import { demoStateHost, setDemoStateHost, websDidToFetch } from '../webs/demoStateHost'

const K0 = stateRoots.K0_TEST_ROOT
const AID = K0.aid
const TUNNEL = 'abc-def-ghi.trycloudflare.com'
const REAL_AID = 'EReal0000000000000000000000000000000000000000'
const REAL = { aid: REAL_AID, name: 'Real state', webs: `did:webs:id.state.gov:roots:${REAL_AID}` }

beforeEach(() => {
  setTrustedApproversEnabled(true)
  setStateVerifiedApproversEnabled(true)
  TRUSTED_APPROVERS_REMOTE_OFF.off = false
  STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = false
  SEDI_KERI_REMOTE_OFF.off = false
  setDemoStateHost(null)
})
afterEach(() => {
  setDemoStateHost(null)
  setTrustedApproversEnabled(false)
  setStateVerifiedApproversEnabled(false)
  jest.restoreAllMocks()
})

describe('Developer "Demo state host"', () => {
  test('H1: with a host set, a demo root is fetched there, its path and AID kept (control: no host, the copy is checked)', () => {
    expect(websDidToFetch(K0)).toBeUndefined()
    expect(setDemoStateHost(TUNNEL)).toBe('set')
    expect(websDidToFetch(K0)).toBe(`did:webs:${TUNNEL}:keyring-demo-state:${AID}`)
    expect(setDemoStateHost('Abc-Def-Ghi.TryCloudflare.com:8443')).toBe('set')
    expect(websDidToFetch(K0)).toBe(`did:webs:${TUNNEL}%3A8443:keyring-demo-state:${AID}`)
  })

  test('H2: a root NOT marked demo ignores the host entirely, whatever is set (control: the demo root is redirected)', () => {
    setDemoStateHost(TUNNEL)
    expect(websDidToFetch(REAL)).toBe(REAL.webs)
    // The demo test is the LIVE list, never a mark carried on the object passed in: a stale "demo: true" on a copy
    // of a root that the list does not mark demo does not redirect it.
    expect(websDidToFetch({ ...REAL, demo: true } as never)).toBe(REAL.webs)
    expect(websDidToFetch(K0)).toContain(TUNNEL)
  })

  test('H2b: the mark absent on the list entry never redirects (control: marked, it does)', () => {
    setDemoStateHost(TUNNEL)
    expect(websDidToFetch(K0)).toContain(TUNNEL)
    jest.spyOn(stateRoots, 'isDemoStateRoot').mockReturnValue(false)
    expect(websDidToFetch(K0)).toBe(K0.webs)
  })

  test.each([
    'https://abc.trycloudflare.com',
    'abc.trycloudflare.com/keyring-demo-state',
    'abc .trycloudflare.com',
    'user@abc.trycloudflare.com',
    'localhost',
    'localhost:8080',
    'nodot',
    '127.0.0.1',
    '192.168.1.5',
    '10.0.0.1',
    'printer.local',
    'svc.internal',
    '[::1]',
    'abc.trycloudflare.com:0',
    'abc.trycloudflare.com:70000',
    'abc.trycloudflare.com%3A443',
    '-bad.example.com',
  ])('H3: %s is refused, and the host in effect is unchanged (control: a tunnel host is set)', (bad) => {
    expect(setDemoStateHost(TUNNEL)).toBe('set')
    expect(setDemoStateHost(bad)).toBe('invalid')
    expect(demoStateHost()).toBe(TUNNEL)
  })

  test.each([
    ['trusted approvers off', () => setTrustedApproversEnabled(false)],
    ['state-verified approvers off', () => setStateVerifiedApproversEnabled(false)],
    ['trusted approvers turned off remotely', () => (TRUSTED_APPROVERS_REMOTE_OFF.off = true)],
    ['state-verified approvers turned off remotely', () => (STATE_VERIFIED_APPROVERS_REMOTE_OFF.off = true)],
    ['the SEDI/KERI umbrella off', () => (SEDI_KERI_REMOTE_OFF.off = true)],
  ])('H4: %s: a saved host does nothing (control: both on, it is in effect)', (_, off) => {
    setDemoStateHost(TUNNEL)
    expect(demoStateHost()).toBe(TUNNEL)
    off()
    expect(demoStateHost()).toBeNull()
    expect(websDidToFetch(K0)).toBeUndefined()
  })

  test('H5: clearing it puts the demo root back on the copy (control: set, it is fetched)', () => {
    setDemoStateHost(TUNNEL)
    expect(websDidToFetch(K0)).toContain(TUNNEL)
    expect(setDemoStateHost('')).toBe('cleared')
    expect(websDidToFetch(K0)).toBeUndefined()
  })
})
