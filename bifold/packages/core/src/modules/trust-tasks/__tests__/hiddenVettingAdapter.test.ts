/**
 * The module as the screens see it: registered, and refusing in the words a
 * screen can show.
 *
 * The contract is `screens/hiddenVettingSeam.ts`'s, so these tests go through
 * `hiddenVettingSeam()` — what the Join card calls — rather than through the
 * adapter's own export. A seam that is registered but wrong is the failure
 * this guards.
 */
import { hiddenVettingSeam, pcsErrorCode } from '../screens/hiddenVettingSeam'
import { vtiAgent } from '../module/vtiAgent'

// The adapter resolves a client from the linked agent; these tests are about
// what it answers when there is none, so the controller is faked.
jest.mock('../module/vtaAgent', () => ({
  vtaAgent: { agentAddress: () => undefined, client: () => ({}) },
}))
jest.mock('../module/vtiAgent', () => ({
  vtiAgent: {
    fetchChallenge: jest.fn(async () => ({ challenge: 'c-from-the-community', expiresAt: '2026-10-15T12:00:00Z' })),
    fetchManifest: jest.fn(async () => ({ wire: '0.3', criteria: [] })),
    apply: jest.fn(async () => ({ effect: 'admitted' })),
  },
}))
jest.mock('@bifold/credo-tsp-adapter', () => ({}))

// Importing the adapter is what registers it: a build that never imports it
// carries no hidden vetting at all, which is #405's fail-closed default.
import '../module/hiddenVettingAdapter'

describe('importing the module registers it with the screens', () => {
  it('registers a seam carrying every method the screens call', () => {
    const seam = hiddenVettingSeam()
    expect(seam).toBeDefined()
    expect(
      Object.fromEntries(
        (
          [
            'check',
            'record',
            'createApplication',
            'progress',
            'requestVetting',
            'fetchChallenge',
            'prove',
            'submitJoin',
            'deleteApplication',
          ] as const
        ).map((name) => [name, typeof seam?.[name]])
      )
    ).toEqual({
      check: 'function',
      record: 'function',
      createApplication: 'function',
      progress: 'function',
      requestVetting: 'function',
      fetchChallenge: 'function',
      prove: 'function',
      submitJoin: 'function',
      deleteApplication: 'function',
    })
  })
})

describe('what it says when there is no agent to ask', () => {
  it('answers noAgent rather than a permission refusal', async () => {
    // Not a matter of permissions: nothing has been asked of anyone yet, and
    // wording it as "your agent will not let you" sends the person to the
    // wrong remedy.
    const seam = hiddenVettingSeam()
    await expect(seam?.check({} as never, {} as never)).resolves.toEqual({ ok: false, reason: 'noAgent' })
  })
})

describe('the step this build does not carry yet', () => {
  // A bare Error reads as "something went wrong, try again in a moment", and
  // the person retries something that cannot work. The screens word a
  // `:notImplemented` code as "this step isn't in this build yet".
  it('requestVetting throws a code the screens can word', async () => {
    const seam = hiddenVettingSeam()
    const thrown = await (seam as never as Record<string, () => Promise<unknown>>)
      .requestVetting()
      .catch((error: unknown) => error)
    expect(pcsErrorCode(thrown)).toBe('keyring/hidden-vetting/requestVetting:notImplemented')
  })
})

describe('the community half, now that it exists', () => {
  const record = { applicationId: 'app-1', communityDid: 'did:webvh:QmC:example:test-vtc', createdAt: 'now' }
  const criterion = { id: 'Vetted-Member', requirementsDigest: 'zQmPublished' } as never

  it('asks the community for a challenge, naming the criterion', async () => {
    const answer = await hiddenVettingSeam()?.fetchChallenge({} as never, record as never, criterion)
    expect(answer).toEqual({ challenge: 'c-from-the-community', expiresAt: '2026-10-15T12:00:00Z' })
    expect(vtiAgent.fetchChallenge).toHaveBeenCalledWith(record.communityDid, { criterionId: 'Vetted-Member' })
  })

  it('submits the proof verbatim, under the digest the community published', async () => {
    const proof = { suite: 'ps-ddh-bls12381', proof: 'z2opaque' }
    const verdict = await hiddenVettingSeam()?.submitJoin({} as never, record as never, criterion, proof)
    expect(verdict).toEqual({ effect: 'admitted' })
    const [, , options] = (vtiAgent.apply as jest.Mock).mock.calls[0]
    // Verbatim, and under the published digest: the agent built the proof and
    // the community verifies exactly what the agent signed.
    expect(options).toMatchObject({ hiddenVetting: proof, requirementsDigest: 'zQmPublished' })
  })
})
