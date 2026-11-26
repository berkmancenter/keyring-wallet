/**
 * A vetter's ticket the app refuses, in words (220): which community it is
 * for and why that matters — using another community's ticket would show the
 * person's identity to that community — or that it cannot be read at all.
 *
 * @module trust-tasks/screens/ticketWords
 */

import type { TFunction } from 'i18next'

import { communityTarget } from '../module/vtiCommunityLink'
import type { VettingTicketError } from '../module/vtiVetting'

import { communityLabelOf } from './communityName'

export function ticketRefusalWords(e: VettingTicketError, communityDid: string | undefined, t: TFunction): string {
  if (e.reason !== 'otherCommunity') return t('Vetting.TicketUnreadable') as string
  return t('Vetting.TicketOtherCommunity', {
    // The other community by its name when it published one; else "another
    // community". Its host used to tell the two apart here, and a host is
    // never shown as a name (IN-26); "a community, not <ours>" would not read.
    other:
      e.ticketCommunityDid && communityTarget.publishedNameOf(e.ticketCommunityDid)
        ? communityLabelOf(e.ticketCommunityDid, t)
        : t('Community.Another'),
    community: communityDid ? communityLabelOf(communityDid, t) : t('Community.Unnamed'),
    interpolation: { escapeValue: false },
  }) as string
}
