/**
 * Whether a post's "Sending" line waits a moment before it shows: two values a release (an OTA included) sets, and
 * nothing else, as `recordSendingSwitch.ts`.
 *
 * A message takes about 3 s to be written (the agent seals it, completes the write as the member, and the room's host
 * stores it, one after another: measured 2.3-2.7 s, 11-17). For that time its bubble said "Sending" and was drawn
 * lighter, on every message. With this on, the bubble is drawn as any other until {@link ROOM_SENDING_LABEL_AFTER_MS}
 * have passed with the post still not written; then it says "Sending" as before. A post that could not be sent says
 * so at once, as before, and a file's upload shows its progress from the start.
 *
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and "Sending" shows from the first moment again, for everyone
 *   at the next start, whatever `on` says.
 *
 * Nothing is saved on the phone and nothing a person does changes either value. It fails closed to the line showing
 * at once: anything but `on` true and `remoteOff` false reads as off.
 *
 * Tests flip the entries and must put them back.
 *
 * @module rooms/sendingLabelSwitch
 */
export const ROOMS_SENDING_LABEL_WAITS: { on: boolean; remoteOff: boolean } = {
  on: true,
  remoteOff: false,
}

/** How long a post may be on its way before its bubble says so. */
export const ROOM_SENDING_LABEL_AFTER_MS = 3000

/** Whether "Sending" waits {@link ROOM_SENDING_LABEL_AFTER_MS} now: switched on by the release, and not turned off. */
export function isSendingLabelWaiting(): boolean {
  return ROOMS_SENDING_LABEL_WAITS.on === true && ROOMS_SENDING_LABEL_WAITS.remoteOff === false
}
