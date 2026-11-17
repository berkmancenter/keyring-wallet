/**
 * The identities whose own session is open now, and how to send on it (sessions phase B, rooms-slow §8b).
 *
 * Every identity the shared session is not signed in as already holds a session of its own: its listener
 * (vtiIdentityListeners), signed in with its own borrowed keys through the mediator its own DID document names. A
 * mediator keeps one live connection per DID, so that listener is the identity's only session: asking over it adds no
 * second socket, and nothing is handed over. The listener registers here once it is listening, and leaves before it
 * stops; `vtiAgent.askAs` asks over it as that identity.
 *
 * A separate module so the agent can read it without importing the listeners, which import the agent.
 *
 * @module trust-tasks/module/vtiOwnSessions
 */
import type { DidCommV2PlaintextMessage } from '@credo-ts/didcomm'

/** What an ask needs of a session: to send a plaintext to a peer, authcrypted, through the session's mediator. */
export interface OwnSession {
  sendTo(peerDid: string, plaintext: DidCommV2PlaintextMessage): Promise<void>
}

const open = new Map<string, OwnSession>()
/** The identities whose listener is opening now, and the attempt: it settles when the listener listens, fails or stops. */
const opening = new Map<string, Promise<unknown>>()

/** The session `did` holds now, while its listener is listening. */
export const ownSessionFor = (did: string): OwnSession | undefined => open.get(did)

/** A listener for `did` is listening on `session`. */
export function keepOwnSession(did: string, session: OwnSession): void {
  open.set(did, session)
}

/** `did`'s listener is stopping, or stopped: only that session, so a newer one for the same identity stays. */
export function dropOwnSession(did: string, session?: OwnSession): void {
  if (!session || open.get(did) === session) open.delete(did)
}

/** A listener for `did` is opening: `attempt` settles once it listens (and is kept), fails, or is stopped. */
export function ownSessionOpening(did: string, attempt: Promise<unknown>): void {
  opening.set(did, attempt)
  const done = () => {
    if (opening.get(did) === attempt) opening.delete(did)
  }
  void attempt.then(done, done)
}

/**
 * The session `did` holds, waiting up to `maxMs` for a listener that is opening now. Nothing opening: no wait, and
 * none. A listing asked in the seconds after launch otherwise signed the shared session in as an identity whose own
 * listener was a moment from listening: two sockets for one DID, the mediator closed one (`duplicate-channel`), and the
 * answer was lost to the ask's clock (QG4P-MQCT, 11-17: 43 s for one community, every room row behind it).
 */
export async function ownSessionOnceOpen(did: string, maxMs: number): Promise<OwnSession | undefined> {
  const held = open.get(did)
  if (held) return held
  const attempt = opening.get(did)
  if (!attempt) return undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const settled = attempt.then(
    () => undefined,
    () => undefined
  )
  await Promise.race([settled, new Promise<void>((resolve) => (timer = setTimeout(resolve, maxMs)))])
  clearTimeout(timer)
  return open.get(did)
}

/** For tests. */
export function dropAllOwnSessions(): void {
  open.clear()
  opening.clear()
}
