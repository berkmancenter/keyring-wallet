/**
 * Developer "Demo state host": where a DEMO state root's did:webs is fetched from while testing (e.g. a temporary
 * tunnel's hostname, which changes every run). It replaces only the host part of the root's did:webs, and only for the
 * root this phone's own list lets take it (stateRoots takesDemoStateHost, read live at each call: the K0 kit's root,
 * which has no host of its own). A real root, and K1 (a demo state with its own fixed host), always resolve their own
 * did:webs, whatever is set here. Trust does not move with it: the root is still its AID on our list,
 * and the fetched history must be that AID's.
 *
 * Read behind the switches: with trusted approvers or state-verified approvers off (each of which the SEDI/KERI remote
 * kill turns off), no host is in effect and nothing is redirected, whatever was saved. Nothing here is stored; the app
 * keeps the saved value and sets it at load, as it does the switches.
 *
 * @module sedi/webs/demoStateHost
 */
import { isStateVerifiedApproversEnabled } from '../../trust-tasks/module/stateVerifiedApproversFlag'
import { isTrustedApproversEnabled } from '../../trust-tasks/module/trustedApproversFlag'
import { isDemoStateRoot, k1Root, takesDemoStateHost } from '../guardian/stateRoots'

import { parseWebsDid } from './identifier'

let saved: string | null = null

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const NOT_PUBLIC = /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/

/** Why a host is refused, or null when it is a bare public hostname, optionally with a port. */
export function demoStateHostProblem(input: string): string | null {
  if (typeof input !== 'string' || input.length === 0) return 'empty'
  if (input.length > 253) return 'too long'
  if (/[\s/@?#%\\[\]]/.test(input) || input.includes('://')) return 'not a bare hostname'
  const m = /^([^:]+)(?::(\d{1,5}))?$/.exec(input)
  if (!m) return 'not a bare hostname'
  const [, name, port] = m
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return 'bad port'
  const host = name.toLowerCase()
  if (IPV4.test(host)) return 'an address, not a hostname'
  const labels = host.split('.')
  if (labels.length < 2 || labels.some((l) => !LABEL.test(l))) return 'not a hostname'
  if (NOT_PUBLIC.test(host)) return 'not a public hostname'
  return null
}

/** Set (or, with null or an empty string, clear) the demo state host. A refused value changes nothing. */
export function setDemoStateHost(input: string | null): 'set' | 'cleared' | 'invalid' {
  if (input === null || input === '') {
    saved = null
    return 'cleared'
  }
  const value = input.trim().toLowerCase()
  if (demoStateHostProblem(value) !== null) return 'invalid'
  saved = value
  return 'set'
}

/** The host in effect now: none unless both switches are on (read at the call). */
export function demoStateHost(): string | null {
  if (!(isTrustedApproversEnabled() && isStateVerifiedApproversEnabled())) return null
  return saved
}

/**
 * The did:webs to fetch for a root, now. A real root, and K1 (never the field: its host is fixed, or the card's own,
 * filled in by the Guardian check): its own, untouched. The K0 root (takesDemoStateHost === true, read live): its did:webs with the host in effect put in place of its
 * host; with no host in effect, none (the card's own copy is checked, and the screen says so). No did:webs, or one
 * that does not parse: none.
 */
export function websDidToFetch(root: { aid: string; webs?: string }): string | undefined {
  if (!root.webs) return undefined
  // K1 in 'fromCard' mode: its did:webs host is a placeholder, never fetched; the Guardian check puts the card's own
  // host in its place (guardianEvidence websFromCardHost), and without one nothing is fetched.
  if (root.aid === k1Root()?.aid && k1Root()?.hostFromCard === true) return undefined
  // Both read live from the list: a demo root (never a mark carried on the object passed in) that takes the field.
  if (isDemoStateRoot(root.aid) !== true || takesDemoStateHost(root.aid) !== true) return root.webs
  const host = demoStateHost()
  if (!host) return undefined
  const parsed = parseWebsDid(root.webs)
  if (!parsed.ok || parsed.value.aid !== root.aid) return undefined
  return ['did:webs', host.replace(':', '%3A'), ...parsed.value.path, parsed.value.aid].join(':')
}
