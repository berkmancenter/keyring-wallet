/**
 * Whether a read a community has left unanswered, while it answered something this phone sent later, is asked once
 * more: two values a release (an OTA included) sets, and nothing else, as `sessionsPerIdentitySwitch.ts`.
 *
 * What it is for. A read sent to a community waits out a 30 s clock when nothing comes back, and a listing waits for
 * every community: one read that got no answer held three other communities' rooms for the whole clock (BC46-XSQD,
 * 279.4, 11-18: two of nine asks sent to one community in the same millisecond were never answered, seven were
 * within a second, and the same read asked again later was answered in 0.6 s).
 *
 * What it does. A read that has had no answer {@link VTI_READ_REASK_AFTER_MS} after it was sent, while the same
 * community has answered another ask this identity sent AFTER it, is sent once more: a new request, with its own
 * thread, to the same community over the same session. Whichever of the two the community answers settles the ask.
 * The ask's clock is not restarted, and nothing is asked a third time.
 *
 * What it is not. It does not say why the first got no answer, and it does not fix that: it treats the symptom. It
 * never applies to a write (a join, a vote, a post): a write that met silence is never sent twice. It never applies
 * to a document someone else completed (the agent's `rooms/keys/act`), which this phone cannot make again, or to an
 * ask sent over TSP. It does nothing while a community is answering nothing at all: silence from a community that is
 * down is not answered by asking it more.
 *
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and no read is asked a second time, for everyone at the next
 *   start, whatever `on` says.
 *
 * KILL RECIPE (no kill PR is kept open): branch from current main, set `remoteOff: true` below (one line), and publish
 * it by OTA. Tier ota-strict: this file sits on the VTI protocol line.
 *
 * Nothing is saved on the phone and nothing a person does changes either value; it is read when a read is sent and
 * again before it is sent a second time. It fails closed: anything but `on` true and `remoteOff` false reads as off.
 * Tests flip the entries and must put them back.
 *
 * @module trust-tasks/module/readReaskSwitch
 */
export const VTI_READ_REASK: { on: boolean; remoteOff: boolean } = { on: true, remoteOff: false }

/** Whether an unanswered read may be asked a second time now: switched on by the release, and not turned off. */
export function isReadReaskOn(): boolean {
  return VTI_READ_REASK.on === true && VTI_READ_REASK.remoteOff === false
}

/**
 * How long a read waits before it may be asked again. Communities answered a read in 0.3–1 s in the report above;
 * three seconds is well past a slow answer and a tenth of the clock.
 */
export const VTI_READ_REASK_AFTER_MS = 3000
