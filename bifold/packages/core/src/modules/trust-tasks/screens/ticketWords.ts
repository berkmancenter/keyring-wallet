/**
 * A vetter's ticket the app refuses, in words (220): which community it is
 * for and why that matters — using another community's ticket would show the
 * person's identity to that community — or that it cannot be read at all.
 *
 * @module trust-tasks/screens/ticketWords
 */

import type { TFunction } from 'i18next'

import type { VettingTicketError } from '../module/vtiVetting'

import { communityLabelOf } from './communityName'

export function ticketRefusalWords(e: VettingTicketError, communityDid: string | undefined, t: TFunction): string {
  if (e.reason !== 'otherCommunity') return t('Vetting.TicketUnreadable') as string
  return t('Vetting.TicketOtherCommunity', {
    other: e.ticketCommunityDid ? communityLabelOf(e.ticketCommunityDid, t) : t('Community.Unnamed'),
    community: communityDid ? communityLabelOf(communityDid, t) : t('Community.Unnamed'),
    interpolation: { escapeValue: false },
  }) as string
}
