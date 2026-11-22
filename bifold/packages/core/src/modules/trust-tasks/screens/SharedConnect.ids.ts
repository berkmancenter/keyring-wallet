/** The testIDs of the SharedConnect screen: the contract the e2e drivers and the tests hold against. Add, never rename. */
export const SharedConnectIds = {
  screen: 'SharedConnect',
  reading: 'SharedConnectReading',
  confirm: 'SharedConnectConfirm',
  name: 'SharedConnectName',
  unverified: 'SharedConnectUnverified',
  contact: 'SharedConnectContact',
  relay: 'SharedConnectRelay',
  expires: 'SharedConnectExpires',
  connect: 'SharedConnectConnect',
  cancel: 'SharedConnectCancel',
  connecting: 'SharedConnectConnecting',
  waiting: 'SharedConnectWaiting',
  unanswered: 'SharedConnectUnanswered',
  retry: 'SharedConnectRetry',
  stop: 'SharedConnectStop',
  result: 'SharedConnectResult',
  done: 'SharedConnectDone',
} as const

/**
 * The testIDs of the "Show a code" screen (Keyring as the inviter, plan WP9), held here so one file owns every
 * shared-connect id. `link` carries the full trigger link as text, for the e2e harness. Add, never rename.
 */
export const SharedConnectInviteIds = {
  screen: 'SharedConnectInvite',
  qr: 'SharedConnectInviteQR',
  link: 'SharedConnectInviteLink',
  countdown: 'SharedConnectInviteCountdown',
  expiresAt: 'SharedConnectInviteExpiresAt',
  copyLink: 'SharedConnectInviteCopyLink',
  shareLink: 'SharedConnectInviteShareLink',
  cancel: 'SharedConnectInviteCancel',
  renew: 'SharedConnectInviteRenew',
  minting: 'SharedConnectInviteMinting',
  waiting: 'SharedConnectInviteWaiting',
  proposed: 'SharedConnectInviteProposed',
  connecting: 'SharedConnectInviteConnecting',
  connected: 'SharedConnectInviteConnected',
  expired: 'SharedConnectInviteExpired',
  failed: 'SharedConnectInviteFailed',
  cancelled: 'SharedConnectInviteCancelled',
  done: 'SharedConnectInviteDone',
  off: 'SharedConnectInviteOff',
} as const
