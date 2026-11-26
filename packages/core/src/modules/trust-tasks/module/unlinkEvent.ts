/**
 * Said when this phone loses an agent: an unlink, of this phone's own agent or another linked one (vtaAgent `unlink`,
 * `unlinkAgent`), said before anything of it is let go; and the agent no longer accepting this phone (the link moved to
 * `revoked`, `revoked: true`), most often because the phone was lost and revoked from another device. What the phone
 * keeps for the agent's identities goes with it: the rooms' kept posts (rooms/messageCache) empty on it, every
 * identity's, whichever agent is named (the safe direction; the cache refills).
 *
 * Said before an unlink is known to succeed, and said again if it is retried: an emptying that turns out not to have
 * been needed only costs a refill. Moving it after the unlink would leave the posts for an unlink that half-ran.
 *
 * @module trust-tasks/module/unlinkEvent
 */
export const VTA_UNLINKING_EVENT = 'vta:unlinking'
