/**
 * A phone is a vetter while one of its grants stands — not because it once
 * received one. These use the status list a live community served
 * (fixtures/vtc-status-list-proof-set.json) and the real proof verifier: index
 * 52232 is a live grant (bit clear), index 24 a revoked one (bit set).
 */
import type { VtiHeldCredential } from '../module/VtiCommunityStore'
import { ownVetterGrantState, pickOwnVetterGrant } from '../module/vtiGrantState'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fixture = require('./fixtures/vtc-status-list-proof-set.json') as {
  issuer: string
  statusList: Record<string, unknown>
  verificationMethod: Record<string, unknown>[]
}

const agent = {
  dids: { resolveDidDocument: async () => ({ verificationMethod: fixture.verificationMethod }) },
} as never
const LIST_URL = 'https://keyring-vti-vtc.ngrok.app/v1/status-lists/revocation'
const serving = (async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(fixture.statusList),
})) as unknown as typeof fetch
const unreachable = (async () => ({ ok: false, status: 503, text: async () => '' })) as unknown as typeof fetch
const NOW = new Date('2026-09-22T12:00:00Z')

const grant = (index: number, window: { from?: string; until?: string } = {}, receivedAt = '2026-09-21T00:00:00Z') =>
  ({
    kind: 'vetter-grant',
    communityDid: fixture.issuer,
    subjectDid: 'did:webvh:persona',
    receivedAt,
    credential: {
      issuer: fixture.issuer,
      validFrom: window.from ?? '2026-09-01T00:00:00Z',
      validUntil: window.until ?? '2027-03-01T00:00:00Z',
      credentialStatus: {
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListIndex: String(index),
        statusListCredential: LIST_URL,
      },
    },
  }) as VtiHeldCredential

const opts = { now: NOW, fetchImpl: serving }

describe("the phone's own vetter standing", () => {
  it('is none with no grant', async () => {
    expect(await ownVetterGrantState(agent, [], opts)).toEqual({ state: 'none' })
  })

  it('is active for a live grant, checked against the list', async () => {
    const state = await ownVetterGrantState(agent, [grant(52232)], opts)
    expect(state).toMatchObject({ state: 'active', statusChecked: true, validUntil: '2027-03-01T00:00:00Z' })
  })

  it('is revoked when the community flipped its bit', async () => {
    expect(await ownVetterGrantState(agent, [grant(24)], opts)).toMatchObject({ state: 'revoked' })
  })

  it('is expired past its window, without asking the network', async () => {
    const neverCalled = (async () => {
      throw new Error('fetched an expired grant')
    }) as unknown as typeof fetch
    const state = await ownVetterGrantState(agent, [grant(52232, { until: '2026-09-20T00:00:00Z' })], {
      now: NOW,
      fetchImpl: neverCalled,
    })
    expect(state).toEqual({ state: 'expired', validUntil: '2026-09-20T00:00:00Z' })
  })

  it('is not yet valid before its window', async () => {
    const state = await ownVetterGrantState(agent, [grant(52232, { from: '2026-10-01T00:00:00Z' })], opts)
    expect(state).toEqual({ state: 'notYetValid', validFrom: '2026-10-01T00:00:00Z' })
  })

  it('stays active but unchecked when the list cannot be read', async () => {
    const state = await ownVetterGrantState(agent, [grant(52232)], { now: NOW, fetchImpl: unreachable })
    expect(state).toMatchObject({ state: 'active', statusChecked: false })
  })

  it('a grant issued again after a revocation makes the phone a vetter again', async () => {
    const revokedOld = grant(24, {}, '2026-09-20T00:00:00Z')
    const reissued = grant(52232, {}, '2026-09-21T00:00:00Z')
    expect(await ownVetterGrantState(agent, [revokedOld, reissued], opts)).toMatchObject({ state: 'active' })
  })

  it('with no live grant, the newest one says why', async () => {
    const oldExpired = grant(52232, { until: '2026-09-10T00:00:00Z' }, '2026-09-01T00:00:00Z')
    const newRevoked = grant(24, {}, '2026-09-21T00:00:00Z')
    expect(await ownVetterGrantState(agent, [oldExpired, newRevoked], opts)).toMatchObject({ state: 'revoked' })
  })
})

/**
 * Which grant the phone acts under — the choice that used to be "whichever the
 * store returned first". A vetter re-granted after a revocation holds both, and
 * signing under the dead one produced statements the community discounted while
 * the vetter's own screens said nothing (keyring-test, 2026-09-22).
 */
describe('choosing the grant to act under', () => {
  it('prefers the live grant over a revoked one, whichever arrived first', async () => {
    const revoked = grant(24, {}, '2026-09-22T09:00:00Z')
    const live = grant(52232, {}, '2026-09-22T08:00:00Z')
    // The revoked one is NEWER here, so recency alone would pick it.
    const picked = await pickOwnVetterGrant(agent, [revoked, live], opts)
    expect(picked.state).toMatchObject({ state: 'active' })
    expect(picked.held).toBe(live)
  })

  it('picks the newest of several live grants', async () => {
    const older = grant(52232, {}, '2026-09-20T00:00:00Z')
    const newer = grant(52232, {}, '2026-09-22T00:00:00Z')
    const picked = await pickOwnVetterGrant(agent, [older, newer], opts)
    expect(picked.held).toBe(newer)
  })

  it('refuses when only a revoked grant is held, and says why', async () => {
    const picked = await pickOwnVetterGrant(agent, [grant(24)], opts)
    expect(picked.state.state).toBe('revoked')
    // `held` is still returned: a caller that will not act should be able to
    // say WHICH grant it declined to use.
    expect(picked.held).toBeDefined()
  })

  it('never chooses a grant that is not yet valid', async () => {
    const future = grant(52232, { from: '2027-01-01T00:00:00Z' })
    const picked = await pickOwnVetterGrant(agent, [future], opts)
    expect(picked.state).toMatchObject({ state: 'notYetValid' })
  })

  it('reports none, with nothing held, when there are no grants', async () => {
    expect(await pickOwnVetterGrant(agent, [], opts)).toEqual({ state: { state: 'none' } })
  })

  it('agrees with what the screens report — one chooser, two readers', async () => {
    const grants = [grant(24, {}, '2026-09-22T09:00:00Z'), grant(52232, {}, '2026-09-22T08:00:00Z')]
    const picked = await pickOwnVetterGrant(agent, grants, opts)
    expect(await ownVetterGrantState(agent, grants, opts)).toEqual(picked.state)
  })
})
