/**
 * Whether a session with this phone's agent starts from what the agent last said about itself, and asks again behind:
 * two values a release (an OTA included) sets, and nothing else, as rooms' `liveDeliverySwitch.ts`.
 *
 * Opening a session, the phone asked the agent three things one after another before anything else could go: who the
 * phone is to it (`auth/whoami`), what the agent is called (`config/show`), and which tasks it serves
 * (`trust-task-discovery`). The last two took about 1.2 s of every launch (two launches, 11-17/18: 0.5–0.55 s and
 * 0.6–0.7 s), in front of the identities' key copies and the rooms' first read, and their answers change only when the
 * agent is renamed or upgraded.
 *
 * With this on:
 * - `auth/whoami` is asked first and live, as before: it is the check that the agent still accepts this phone.
 * - Which tasks the agent serves is read from its last answer, kept with the agent's link, and asked again
 *   {@link AGENT_LAST_KNOWN_REFRESH_AFTER_MS} after the session opened, once per agent per app run. A changed answer
 *   replaces the kept one and the rooms service reads it again. Nothing kept, or kept longer ago than
 *   {@link AGENT_LAST_KNOWN_MAX_AGE_MS}: asked live, as before, and the answer kept.
 * - What the agent is called is asked at that same later moment when a name is already shown for it; with none shown
 *   it is asked at once, as before.
 *
 * What it costs:
 * - For up to {@link AGENT_LAST_KNOWN_REFRESH_AFTER_MS} of the first launch after the agent is upgraded or downgraded,
 *   the phone may ask with a task version the agent no longer serves, or not use one it has just gained. A task the
 *   agent refuses as not served has the agent asked again at once, not at the end of the wait.
 * - The later asks are not in the read lane and do not go beside the queue (vtaReadLane.ts), so each runs alone: it
 *   waits for the reads on the wire, and everything queued waits for it, an open room's read included. That is about
 *   0.6 s for the task list, once per agent per app run, and about 0.5 s for the name when one is asked, at the
 *   10 s mark instead of at the front of the launch.
 *
 * What it does not change: the approvals screens and the hidden-vetting probe still ask the agent live each time.
 *
 * - `on`: the release's choice.
 * - `remoteOff`: the release's kill. Set it to `true` and every session asks all three at once again, for everyone at
 *   the next start, whatever `on` says. Nothing kept is read or written then.
 *
 * KILL RECIPE (no kill PR is kept open): branch from current main, set `remoteOff: true` below (one line), and publish
 * it by OTA.
 *
 * Nothing a person does changes either value; they are read each time, never cached. It fails closed: anything but `on`
 * true and `remoteOff` false reads as off. Tests flip the entries and must put them back.
 *
 * @module trust-tasks/module/agentLastKnownSwitch
 */
export const AGENT_LAST_KNOWN_AT_CONNECT: { on: boolean; remoteOff: boolean } = { on: true, remoteOff: false }

/** Whether a session starts from the agent's last answers now: switched on by the release, and not turned off. */
export function isAgentLastKnownOn(): boolean {
  return AGENT_LAST_KNOWN_AT_CONNECT.on === true && AGENT_LAST_KNOWN_AT_CONNECT.remoteOff === false
}

/**
 * How long after a session opened the agent is asked again. Long enough for the key copies and the rooms' first read
 * to go ahead of it (keys were all held 3.3–4.2 s after the session opened, 11-17/18), short enough that an upgraded
 * agent is read correctly within the launch.
 */
export const AGENT_LAST_KNOWN_REFRESH_AFTER_MS = 10_000

/**
 * How old a kept answer may be and still be used. Each launch asks again, so a kept answer is normally a launch old;
 * this bounds the case where asking again keeps failing, or never runs.
 */
export const AGENT_LAST_KNOWN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The longest answer that is kept: this many task types, and this many characters in all. vta-service 0.83.0 spells
 * out about a hundred types (some 5 KB). A longer list is used but not kept, and the agent is asked each time.
 */
export const AGENT_LAST_KNOWN_MAX_TYPES = 2000
export const AGENT_LAST_KNOWN_MAX_CHARS = 200_000

/** A kept answer still good is not written again more often than this: one store write a day says "still so". */
export const AGENT_LAST_KNOWN_REWRITE_MS = 24 * 60 * 60 * 1000
