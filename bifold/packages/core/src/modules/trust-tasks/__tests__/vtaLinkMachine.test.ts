import {
  initialLinkState,
  reconnectDelayMs,
  reduceLink,
  showsOfflineBanner,
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
  it('comes back from storage offline, never online', () => {
    const restored = reduceLink(initialLinkState, { type: 'restored', link: { ...agent, linkedAt: 't0' }, now: 5 })
    expect(restored).toEqual({ kind: 'linked', ...agent, linkedAt: 't0', connection: { kind: 'offline', since: 5 } })
    expect(reduceLink(initialLinkState, { type: 'restored', now: 5 })).toBe(initialLinkState)
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
    expect(revoked).toEqual({ kind: 'revoked', ...agent, reason: 'DID not in ACL' })
    expect(reduceLink(revoked, { type: 'relink' })).toEqual({ kind: 'notLinked' })
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

  it('never shows a key over a working link', () => {
    expect(reduceLink(linked, { type: 'keyShown', ...agent, did: 'x' })).toBe(linked)
  })
})
