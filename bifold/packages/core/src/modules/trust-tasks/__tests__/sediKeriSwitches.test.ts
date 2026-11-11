/**
 * One switch per SEDI/KERI feature, plus one kill for all of them (Alberto, 2026-11-10). Each feature's switch is off
 * by default; its own remote off and the umbrella SEDI_KERI_REMOTE_OFF each beat a saved "on", and neither turns it on.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import { SEDI_KERI_REMOTE_OFF } from '../module/sediKeriRemoteOff'
import {
  STATE_VERIFIED_APPROVERS_REMOTE_OFF,
  isStateVerifiedApproversEnabled,
  setStateVerifiedApproversEnabled,
} from '../module/stateVerifiedApproversFlag'
import {
  TRUSTED_APPROVERS_REMOTE_OFF,
  isTrustedApproversEnabled,
  setTrustedApproversEnabled,
} from '../module/trustedApproversFlag'

const SWITCHES = [
  {
    name: 'trusted approvers',
    set: setTrustedApproversEnabled,
    is: isTrustedApproversEnabled,
    own: TRUSTED_APPROVERS_REMOTE_OFF,
  },
  {
    name: 'state-verified approvers',
    set: setStateVerifiedApproversEnabled,
    is: isStateVerifiedApproversEnabled,
    own: STATE_VERIFIED_APPROVERS_REMOTE_OFF,
  },
]

afterEach(() => {
  SEDI_KERI_REMOTE_OFF.off = false
  for (const s of SWITCHES) {
    s.own.off = false
    s.set(false)
  }
})

describe.each(SWITCHES)('the $name switch', (s) => {
  it('is off until the app turns it on', () => {
    expect(s.is()).toBe(false)
    s.set(true)
    expect(s.is()).toBe(true)
  })

  it('the SEDI/KERI kill beats a saved "on" (control: with the kill off, it works)', () => {
    s.set(true)
    SEDI_KERI_REMOTE_OFF.off = true
    expect(s.is()).toBe(false)
    SEDI_KERI_REMOTE_OFF.off = false
    expect(s.is()).toBe(true)
  })

  it('its own remote off beats a saved "on" too, and neither kill turns it on', () => {
    s.set(true)
    s.own.off = true
    expect(s.is()).toBe(false)
    s.own.off = false
    s.set(false)
    SEDI_KERI_REMOTE_OFF.off = false
    expect(s.is()).toBe(false)
  })
})

describe('the umbrella', () => {
  it('kills every SEDI/KERI switch at once (control: each still answers for itself without it)', () => {
    for (const s of SWITCHES) s.set(true)
    SEDI_KERI_REMOTE_OFF.off = true
    expect(SWITCHES.map((s) => s.is())).toEqual([false, false])
    SEDI_KERI_REMOTE_OFF.off = false
    expect(SWITCHES.map((s) => s.is())).toEqual([true, true])
  })

  it('every switch and kill is exported from the trust-tasks index and the package index', () => {
    const names = [
      'setStateVerifiedApproversEnabled',
      'isStateVerifiedApproversEnabled',
      'STATE_VERIFIED_APPROVERS_REMOTE_OFF',
      'SEDI_KERI_REMOTE_OFF',
    ]
    for (const file of [join(__dirname, '..', 'index.ts'), join(__dirname, '..', '..', '..', 'index.ts')]) {
      const text = readFileSync(file, 'utf8')
      for (const name of names)
        expect([file.split('/src/')[1], name, new RegExp(`\\b${name}\\b`).test(text)]).toEqual([
          file.split('/src/')[1],
          name,
          true,
        ])
    }
  })
})
