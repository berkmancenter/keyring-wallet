import {
  connectionShown,
  initialLinkState,
  reconnectDelayMs,
  reduceLink,
  showsOfflineBanner,
  STARTUP_GRACE_MS,
  type VtaLinkEvent,
  type VtaLinkState,
} from '../module/vtaLinkMachine'

// One state machine owns "is this phone linked, and is its agent reachable"
// (plan §4.2); every transition names its cause and has a test here.

const agent = { vtaDid: 'did:webvh:Qm:host', label: 'Lab agent' }
const offerScanned: VtaLinkEvent = { type: 'offerScanned', ...agent, offerUrl: 'http://page/api/offers/n', exp: 99 }
const run = (events: VtaLinkEvent[], from: VtaLinkState = initialLinkState) => events.reduce(reduceLink, from)
const linked = run([
  offerScanned,
  { type: 'confirmed' },
  { type: 'submitted', code: 'ABCD-EFGH' },
  { type: 'granted' },
  { type: 'linked', linkedAt: 't0' },
])

describe('linking', () => {
  it('walks scan → confirm → code → grant → sign in → rotate → linked', () => {
    let state = reduceLink(initialLinkState, offerScanned)
    expect(state.kind).toBe('confirming')
    state = reduceLink(state, { type: 'confirmed' })
    expect(state.kind).toBe('submitting')
    state = reduceLink(state, { type: 'submitted', code: 'ABCD-EFGH' })
    expect(state).toMatchObject({ kind: 'awaitingGrant', code: 'ABCD-EFGH' })
    state = reduceLink(state, { type: 'granted' })
    expect(state).toMatchObject({ kind: 'linking', step: 'connecting' })
    state = reduceLink(state, { type: 'rotating' })
    expect(state).toMatchObject({ kind: 'linking', step: 'rotating' })
    state = reduceLink(state, { type: 'linked', linkedAt: 't0' })
    expect(state).toEqual({ kind: 'linked', ...agent, linkedAt: 't0', connection: { kind: 'online' } })
  })

  it('cancelling before the grant returns to no agent', () => {
    for (const events of [[offerScanned], [offerScanned, { type: 'confirmed' } as VtaLinkEvent]]) {
      expect(run([...events, { type: 'cancelled' }]).kind).toBe('notLinked')
    }
    const waiting = run([offerScanned, { type: 'confirmed' }, { type: 'submitted', code: 'X' }])
    expect(reduceLink(waiting, { type: 'cancelled' }).kind).toBe('notLinked')
  })

  it('a failure keeps its reason for the screen to word', () => {
    const waiting = run([offerScanned, { type: 'confirmed' }, { type: 'submitted', code: 'X' }])
    expect(reduceLink(waiting, { type: 'failed', failure: { reason: 'refused' } })).toEqual({
      kind: 'notLinked',
      lastError: { reason: 'refused' },
    })
  })

  it('ignores events that do not apply — a late grant after a cancel moves nothing', () => {
    const cancelled = run([offerScanned, { type: 'cancelled' }])
    expect(reduceLink(cancelled, { type: 'granted' })).toBe(cancelled)
    expect(reduceLink(initialLinkState, { type: 'linked', linkedAt: 't' })).toBe(initialLinkState)
    expect(reduceLink(linked, { type: 'failed', failure: { reason: 'failed' } })).toBe(linked)
  })

  it('a new offer never replaces a working link', () => {
    expect(reduceLink(linked, offerScanned)).toBe(linked)
  })
})

describe('the connection of a linked phone', () => {
  it('comes back from storage connecting, never online', () => {
    const restored = reduceLink(initialLinkState, { type: 'restored', link: { ...agent, linkedAt: 't0' }, now: 5 })
    expect(restored).toEqual({ kind: 'linked', ...agent, linkedAt: 't0', connection: { kind: 'connecting', since: 5 } })
    expect(reduceLink(initialLinkState, { type: 'restored', now: 5 })).toBe(initialLinkState)
  })

  // IN-48: at app start the phone has not reached its agent yet, which is not a
  // failure. Failed start-up attempts stay "connecting"; only the clock turns
  // them into "offline" (see connectionShown), so a slow start never flashes red.
  it('stays connecting through failed start-up attempts, with the start time kept, until a session opens', () => {
    let state = reduceLink(initialLinkState, { type: 'restored', link: { ...agent, linkedAt: 't0' }, now: 1000 })
    state = reduceLink(state, { type: 'sessionDropped', reason: 'timed out', now: 4000 })
    expect(state).toMatchObject({ connection: { kind: 'connecting', since: 1000, reason: 'timed out' } })
    state = reduceLink(state, { type: 'retryScheduled', attempt: 1, nextRetryAt: 5000 })
    expect(state).toMatchObject({ connection: { kind: 'connecting', since: 1000, reason: 'timed out' } })
    state = reduceLink(state, { type: 'sessionOpened' })
    expect(state).toMatchObject({ connection: { kind: 'online' } })
    // Once it has been online, a drop is a real drop, as before.
    state = reduceLink(state, { type: 'sessionDropped', now: 9000 })
    expect(state).toMatchObject({ connection: { kind: 'offline', since: 9000 } })
  })

  it('drops, retries with the first drop time kept, and comes back online', () => {
    let state = reduceLink(linked, { type: 'sessionDropped', reason: 'socket closed', now: 1000 })
    expect(state).toMatchObject({ connection: { kind: 'offline', since: 1000, reason: 'socket closed' } })
    state = reduceLink(state, { type: 'retryScheduled', attempt: 1, nextRetryAt: 2000 })
    expect(state).toMatchObject({ connection: { kind: 'reconnecting', attempt: 1, nextRetryAt: 2000, since: 1000 } })
    // A second drop during a retry keeps "offline since" at the first one.
    state = reduceLink(state, { type: 'sessionDropped', now: 3000 })
    expect(state).toMatchObject({ connection: { since: 1000 } })
    state = reduceLink(state, { type: 'sessionOpened' })
    expect(state).toMatchObject({ connection: { kind: 'online' } })
  })

  it('does not schedule retries while online', () => {
    expect(reduceLink(linked, { type: 'retryScheduled', attempt: 1, nextRetryAt: 1 })).toBe(linked)
  })

  it('a revoked grant ends the link, and re-linking starts over', () => {
    const revoked = reduceLink(linked, { type: 'accessRevoked', reason: 'DID not in ACL' })
    expect(revoked).toEqual({ kind: 'revoked', ...agent, reason: 'DID not in ACL', cause: 'notInAcl' })
    expect(reduceLink(revoked, { type: 'relink' })).toEqual({ kind: 'notLinked' })
  })

  it('says the phone was wiped only when the agent says so', () => {
    const wiped = reduceLink(linked, { type: 'accessRevoked', reason: 'forbidden: device has been wiped' })
    expect(wiped).toMatchObject({ kind: 'revoked', cause: 'wiped' })
    const disabled = reduceLink(linked, { type: 'accessRevoked', reason: 'forbidden: device is disabled' })
    expect(disabled).toMatchObject({ kind: 'revoked', cause: 'notInAcl' })
  })
})

describe('helpers', () => {
  it('backs off 1 s, 2 s, 4 s … up to 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(reconnectDelayMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
  })

  it('shows the offline banner only after a drop has lasted', () => {
    const dropped = reduceLink(linked, { type: 'sessionDropped', now: 1000 })
    expect(showsOfflineBanner(linked, 99999)).toBe(false)
    expect(showsOfflineBanner(dropped, 3000)).toBe(false)
    expect(showsOfflineBanner(dropped, 6000)).toBe(true)
    expect(showsOfflineBanner(initialLinkState, 99999)).toBe(false)
  })

  it('gives a start-up connect its grace before calling it offline', () => {
    const connecting = reduceLink(initialLinkState, { type: 'restored', link: { ...agent, linkedAt: 't0' }, now: 1000 })
    if (connecting.kind !== 'linked') throw new Error('not linked')
    const early = 1000 + STARTUP_GRACE_MS - 1
    const late = 1000 + STARTUP_GRACE_MS
    expect(connectionShown(connecting.connection, early)).toEqual({ kind: 'connecting', since: 1000 })
    expect(connectionShown(connecting.connection, late)).toEqual({ kind: 'offline', since: 1000 })
    expect(showsOfflineBanner(connecting, early)).toBe(false)
    expect(showsOfflineBanner(connecting, late)).toBe(true)
    // Every other state is shown as it is.
    const online = { kind: 'online' } as const
    expect(connectionShown(online, late)).toBe(online)
  })
})

describe('linking without a QR', () => {
  const shown = reduceLink(initialLinkState, { type: 'keyShown', ...agent, did: 'did:peer:2.temp' })

  it('shows the key, marks a check that finds it not added yet, and links once granted', () => {
    expect(shown).toEqual({ kind: 'showingKey', ...agent, did: 'did:peer:2.temp', checking: false })
    const checking = reduceLink(shown, { type: 'grantCheckStarted' })
    expect(checking).toMatchObject({ checking: true, notYet: false })
    const notYet = reduceLink(checking, { type: 'grantNotYet' })
    expect(notYet).toMatchObject({ kind: 'showingKey', checking: false, notYet: true })
    const linking = reduceLink(reduceLink(notYet, { type: 'grantCheckStarted' }), { type: 'granted' })
    expect(linking).toMatchObject({ kind: 'linking', step: 'connecting' })
  })

  it('marks a check the agent never answered, and a later check clears the mark', () => {
    const checking = reduceLink(shown, { type: 'grantCheckStarted' })
    const silent = reduceLink(checking, { type: 'grantNoAnswer' })
    expect(silent).toMatchObject({ kind: 'showingKey', checking: false, noAnswer: true, notYet: false })
    // Silence and refusal are different things and never show at once.
    const refused = reduceLink(reduceLink(silent, { type: 'grantCheckStarted' }), { type: 'grantNotYet' })
    expect(refused).toMatchObject({ checking: false, notYet: true, noAnswer: false })
    expect(reduceLink(refused, { type: 'grantCheckStarted' })).toMatchObject({
      checking: true,
      notYet: false,
      noAnswer: false,
    })
  })

  it('can be stopped, and a failure keeps its reason', () => {
    expect(reduceLink(shown, { type: 'cancelled' })).toEqual({ kind: 'notLinked' })
    expect(reduceLink(shown, { type: 'failed', failure: { reason: 'failed' } })).toMatchObject({
      kind: 'notLinked',
      lastError: { reason: 'failed' },
    })
  })

  it('an agent that cannot be found is reported before any key is shown', () => {
    expect(reduceLink(initialLinkState, { type: 'failed', failure: { reason: 'unreachable' } })).toEqual({
      kind: 'notLinked',
      lastError: { reason: 'unreachable' },
    })
  })

  // #30: a key shown after the agent's address was SCANNED (another phone's
  // "Add another phone" code) is shown as a code for that phone to scan.
  it('remembers that the address came from a scan', () => {
    const scanned = reduceLink(initialLinkState, { type: 'keyShown', ...agent, did: 'did:key:z6Mknew', via: 'scan' })
    expect(scanned).toMatchObject({ kind: 'showingKey', did: 'did:key:z6Mknew', via: 'scan' })
    expect(reduceLink(scanned, { type: 'grantCheckStarted' })).toMatchObject({ via: 'scan' })
  })

  it('never shows a key over a working link', () => {
    expect(reduceLink(linked, { type: 'keyShown', ...agent, did: 'x' })).toBe(linked)
  })
})

describe('unlinking', () => {
  const linked = reduceLink(initialLinkState, {
    type: 'restored',
    link: { vtaDid: 'did:webvh:Qm:agent', label: 'agent', linkedAt: 't0' },
    now: 0,
  })

  it('returns a linked phone to no agent, online or not', () => {
    expect(linked.kind).toBe('linked')
    expect(reduceLink(linked, { type: 'unlinked' })).toEqual({ kind: 'notLinked' })
    const offline = reduceLink(linked, { type: 'sessionDropped', reason: 'socket closed', now: 5 })
    expect(reduceLink(offline, { type: 'unlinked' })).toEqual({ kind: 'notLinked' })
  })

  it('returns a revoked phone to no agent, and leaves an unlinked one as it is', () => {
    const revoked = reduceLink(linked, { type: 'accessRevoked', reason: 'not in ACL' })
    expect(reduceLink(revoked, { type: 'unlinked' })).toEqual({ kind: 'notLinked' })
    expect(reduceLink(initialLinkState, { type: 'unlinked' })).toBe(initialLinkState)
  })
})

describe('a first link whose key swap is unsettled', () => {
  const linking = run([offerScanned, { type: 'confirmed' }, { type: 'submitted', code: 'C' }, { type: 'granted' }])

  it('is linked but offline while the agent is asked which key it holds', () => {
    const state = reduceLink(linking, {
      type: 'linked',
      linkedAt: 't0',
      connection: { kind: 'offline', since: 7, reason: 'swap unanswered' },
    })
    expect(state).toEqual({
      kind: 'linked',
      ...agent,
      linkedAt: 't0',
      connection: { kind: 'offline', since: 7, reason: 'swap unanswered' },
    })
    // …and the next connect brings it online.
    expect(reduceLink(state, { type: 'sessionOpened' })).toMatchObject({ connection: { kind: 'online' } })
  })

  it('both keys refused: not linked, with the reason — link again, not "revoked"', () => {
    const failure = { reason: 'failed' as const, detail: 'accepts neither of this phone’s keys (not in ACL)' }
    expect(reduceLink(linked, { type: 'linkLost', failure })).toEqual({ kind: 'notLinked', lastError: failure })
    expect(reduceLink(linking, { type: 'linkLost', failure })).toEqual({ kind: 'notLinked', lastError: failure })
    expect(reduceLink(initialLinkState, { type: 'linkLost', failure })).toBe(initialLinkState)
  })

  it('a fresh attempt the agent already knows resumes into linking without a new grant', () => {
    const confirming = reduceLink(initialLinkState, offerScanned)
    const submitting = reduceLink(confirming, { type: 'confirmed' })
    for (const from of [initialLinkState, confirming, submitting]) {
      expect(reduceLink(from, { type: 'resumed', ...agent })).toEqual({ kind: 'linking', step: 'connecting', ...agent })
    }
    // Never over a working link.
    expect(reduceLink(linked, { type: 'resumed', ...agent })).toBe(linked)
  })
})

/**
 * An agent host's setup used to read as one sentence for minutes; the phone
 * knows the step it is at, and each move is a transition here.
 */
describe("an agent host's setup, step by step", () => {
  const hostWaiting = run([{ ...offerScanned, via: 'host' }, { type: 'confirmed' }, { type: 'submitted', code: '' }])

  it('names the step and when it began', () => {
    const creating = reduceLink(hostWaiting, { type: 'hostStage', step: 'creating', now: 10 })
    expect(creating).toMatchObject({ kind: 'awaitingGrant', via: 'host', stage: { step: 'creating', since: 10 } })
    const connecting = reduceLink(creating, { type: 'hostStage', step: 'connecting', now: 40 })
    // One clock for the whole setup: it keeps counting from the first step.
    expect(connecting).toMatchObject({ stage: { step: 'connecting', since: 40, startedAt: 10 } })
  })

  it('a repeated step changes nothing, so the screen does not re-render on every poll', () => {
    const creating = reduceLink(hostWaiting, { type: 'hostStage', step: 'creating', now: 10 })
    expect(reduceLink(creating, { type: 'hostStage', step: 'creating', now: 13 })).toBe(creating)
  })

  it('each sign-in try is counted, and the step keeps the time it began', () => {
    const first = reduceLink(hostWaiting, { type: 'hostStage', step: 'signingIn', attempt: 2, of: 24, now: 50 })
    const third = reduceLink(first, { type: 'hostStage', step: 'signingIn', attempt: 3, of: 24, now: 55 })
    expect(third).toMatchObject({ stage: { step: 'signingIn', attempt: 3, of: 24, since: 50 } })
  })

  it('moves nothing but a host connection that is waiting', () => {
    const coded = run([offerScanned, { type: 'confirmed' }, { type: 'submitted', code: 'ABCD-EFGH' }])
    expect(reduceLink(coded, { type: 'hostStage', step: 'creating', now: 1 })).toBe(coded)
    expect(reduceLink(linked, { type: 'hostStage', step: 'creating', now: 1 })).toBe(linked)
  })

  it('is left behind once the phone is granted', () => {
    const stepped = reduceLink(hostWaiting, { type: 'hostStage', step: 'connecting', now: 1 })
    expect(reduceLink(stepped, { type: 'granted' })).not.toHaveProperty('stage')
  })
})
