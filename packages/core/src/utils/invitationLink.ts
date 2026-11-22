/**
 * An invitation link as it is shared and as it arrives.
 *
 * Shared: the link alone, ready to tap, with nothing written around it, and
 * as a link rather than text where the platform has one.
 *
 * Arrived: a link whose inline invitation (`oob`, `c_i`, `d_m`) cannot be read
 * was cut or altered on its way. On build 265 a receiver was handed one cut to
 * 200 characters, and was told "Unable to handle deeplink" (1039) with nothing
 * to do about it. It is caught before connecting and said for what it is. Why
 * it was cut is not known here, so nothing is said about that.
 *
 * @module utils/invitationLink
 */
import { JsonEncoder } from '@credo-ts/core'
import type { TFunction } from 'i18next'
import type { ShareContent } from 'react-native'

import { BifoldError } from '../types/error'

import { isShortInvitationLink } from './shortInvitationLink'

/**
 * What the share sheet sends: the link, and nothing else. On iOS a link item
 * (`url`), so AirDrop and Messages hand over a link to tap: shared as text,
 * AirDrop delivered text, and the receiver on build 265 had to select the
 * link by hand, which cut it. No message beside it, or iOS sends both. Android
 * has no link item, so there the link is the message.
 */
export function invitationShareContent(invitationUrl: string, title: string, os: string): ShareContent {
  return os === 'ios' ? { title, url: invitationUrl } : { title, message: invitationUrl }
}

const INLINE_INVITATION = /[?&](oob|c_i|d_m)=([^&#\s]*)/

/**
 * Whether a deep link carries an invitation for the connect path: an inline one
 * (`oob`, `c_i`, `d_m`), a link to fetch one from (`url`), or one of our short
 * links, which Credo fetches. Anything else is not handed to it.
 */
export function deepLinkCarriesInvitation(link: string): boolean {
  return /[?&](oob|c_i|d_m|url)=/.test(link) || isShortInvitationLink(link)
}

/** Whether `link` carries an inline invitation that cannot be read. */
export function invitationLinkIncomplete(link: string): boolean {
  const found = INLINE_INVITATION.exec(link)
  if (!found) return false
  const [, param, raw] = found
  try {
    const value = decodeURIComponent(raw)
    const json = param === 'oob' ? JsonEncoder.fromBase64Url(value) : JsonEncoder.fromBase64(value)
    return json === null || typeof json !== 'object'
  } catch {
    return true
  }
}

/** The error to show for such a link, or undefined for any other. */
export function invitationLinkError(link: string, t: TFunction): BifoldError | undefined {
  if (!invitationLinkIncomplete(link)) return undefined
  return new BifoldError(
    t('Error.Title1051'),
    t('Error.Message1051'),
    `an invitation link of ${link.length} characters could not be read`,
    1051
  )
}
