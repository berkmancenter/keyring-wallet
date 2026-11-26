import type { CardAsk } from '../module/vtiJoin'

/**
 * The line for what Check again's ask for the card came to (IN-617). Asked
 * again, or asked recently. `rateLimited` is never final, with or without a
 * `retryAfter`: join-requests/status/0.1 has a community only SHOULD send one,
 * and has no way to say "no more". Nothing for `notNeeded` (the community
 * holds the acknowledgement), not supported, or a request gone: none says
 * anything a person can act on, and a request gone is said by the standing.
 */
export const cardAskKey = (ask: CardAsk | undefined): string | undefined => {
  if (ask?.resend === 'queued') return 'Join.CardAskedAgain'
  if (ask?.resend === 'rateLimited') return 'Join.CardAskedRecently'
  return undefined
}
