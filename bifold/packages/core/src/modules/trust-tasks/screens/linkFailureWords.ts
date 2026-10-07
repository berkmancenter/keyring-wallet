/**
 * What a failed link says, in words: one wording for the link screen and for
 * setting up an agent by its address, which is now the one way to link
 * without a code (Alberto, 239). The original text stays under Details.
 *
 * @module trust-tasks/screens/linkFailureWords
 */
import type { TFunction } from 'i18next'

import type { VtaLinkFailure } from '../module/vtaLinkMachine'

import { plainError } from './plainError'

export function linkFailureText(failure: VtaLinkFailure | undefined, t: TFunction): string {
  // An agent host's automatic connection says why in its own terms.
  if (failure?.hostReason) return t(`VtaLink.Host.Failed.${failure.hostReason}`)
  // The agent kept this phone's first key: say why, not "doesn't know why" (#287, Run A).
  if (failure?.swap) return t(`VtaLink.SwapFailed.${failure.swap}`)
  switch (failure?.reason) {
    case 'expired':
      return t('VtaLink.FailedExpired')
    case 'refused':
      return t('VtaLink.FailedRefused')
    case 'unreachable':
      return t('VtaLink.FailedUnreachable')
    case 'communityAgent':
      return t('VtaLink.FailedCommunityAgent')
    case 'alreadyLinked':
      return t('VtaLink.FailedAlreadyLinked')
    default:
      // Say what was caught, in words, rather than "something went wrong":
      // an iOS link that authenticated but never opened its mediator socket
      // showed only that, and the cause took a mediator log to find
      // (2026-09-25, lab).
      return failure?.detail ? t(plainError(failure.detail).line) : t('VtaLink.FailedOther')
  }
}
