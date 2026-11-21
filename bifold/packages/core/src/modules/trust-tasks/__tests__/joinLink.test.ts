/**
 * A community's join code in the link forms other wallets read (IN-702): `https://<host>/?iuv=1&_oobid=<id>`, the same
 * under `web+interaction:`, and `didcomm://?_oob=<invitation>`. What is read from a link, what is asked of its host,
 * and when the manifest it brings is believed. The routing these feed is in vtiLinks.test.ts.
 *
 * The documents here have the shape of one community site's answer, with made-up names.
 */
import { JsonEncoder } from '@credo-ts/core'

import {
  attachedManifest,
  isWebInteractionLink,
  joinLinkShape,
  readJoinInvitation,
  readJoinLink,
  type JoinLinkShape,
} from '../module/joinLink'
import { vtiAgent } from '../module/vtiAgent'

jest.mock('@bifold/credo-tsp-adapter', () => ({}))
const mockVerify = jest.fn()
jest.mock('@bifold/trust-tasks', () => ({
  ...jest.requireActual('@bifold/trust-tasks'),
  verifyDocumentProof: (...a: unknown[]) => mockVerify(...a),
}))

const NOW = Date.parse('2026-11-20T12:00:00Z')
const community = 'did:webvh:QmCommunity:vtc.example.org'
const JOIN = 'https://trusttasks.org/spec/vtc/join-requests/submit/0.3'
const MANIFEST = 'https://trusttasks.org/spec/vtc/join-requests/manifest'
const ENVELOPE = 'https://trusttasks.org/binding/didcomm/0.1/envelope'
const joinLink = 'https://vtc.example.org/?iuv=1&_oobid=VGVlndZFAQ0UyEOWRi5rkw'

const manifestDocument = (over: Record<string, unknown> = {}) => ({
  id: 'urn:uuid:dafe7b3d-0680-4994-8c85-bad926b59003',
  type: `${MANIFEST}/0.4#response`,
  issuer: community,
  issuedAt: '2026-11-20T11:59:58Z',
  threadId: 'urn:uuid:d5094dea-51c8-4298-8e06-c148e5c70bb7',
  payload: {
    communityDid: community,
    criteria: [{ id: 'review', admission: 'review', description: 'Reviewed by an administrator' }],
    branding: { displayName: 'Example Commons' },
  },
  proof: {
    type: 'DataIntegrityProof',
    cryptosuite: 'eddsa-jcs-2022',
    proofPurpose: 'assertionMethod',
    verificationMethod: `${community}#key-0`,
    proofValue: 'z5Pf3',
  },
  ...over,
})

const invitation = (over: Record<string, unknown> = {}) => ({
  type: 'https://didcomm.org/out-of-band/2.0/invitation',
  id: 'VGVlndZFAQ0UyEOWRi5rkw',
  from: community,
  body: { accept: ['didcomm/v2'], goal: 'Join this community', goal_code: JOIN },
  created_time: NOW / 1000 - 5,
  expires_time: NOW / 1000 + 86_400,
  protocols: { didcomm: joinLink },
  attachments: [
    {
      id: 'manifest',
      media_type: 'application/didcomm-plain+json',
      data: {
        json: { type: ENVELOPE, typ: 'application/didcomm-plain+json', from: community, body: manifestDocument() },
      },
    },
  ],
  ...over,
})
const withGoal = (goal_code: unknown) => invitation({ body: { accept: ['didcomm/v2'], goal_code } })
const inline = (json: unknown, base = 'didcomm://') => `${base}?_oob=${JsonEncoder.toBase64Url(json as never)}`

/** An answer. `length`, when given, is what it declares as its `content-length`, true or not. */
const jsonAnswer = (body: unknown, type = 'application/json', length?: string) => ({
  ok: true,
  status: 200,
  headers: {
    get: (name: string) =>
      name.toLowerCase() === 'content-type' ? type : name.toLowerCase() === 'content-length' ? (length ?? null) : null,
  },
  text: jest.fn(async () => (typeof body === 'string' ? body : JSON.stringify(body))),
})
/** A host that answers each link with what `answers` holds for it, and records what it was asked. */
function hostAnswering(answers: Record<string, unknown>) {
  return jest.fn(async (url: string, _init?: RequestInit) => {
    if (!(url in answers)) throw new Error('network down')
    return answers[url]
  })
}
const asFetch = (mock: jest.Mock) => mock as unknown as typeof fetch

describe('which links may carry a join code', () => {
  it('a web link with _oobid, or with iuv=1, is asked; one that is not a join is handed on', () => {
    for (const link of [
      joinLink,
      'https://vtc.example.org/join?_oobid=abc',
      'https://vtc.example.org/?iuv=1',
      `  ${joinLink}\n`,
    ]) {
      expect(joinLinkShape(link)).toEqual({ via: 'fetch', url: link.trim(), passOn: true })
    }
  })

  it('the same link under web+interaction: is asked without the prefix, and is this reader’s alone', () => {
    expect(isWebInteractionLink(`web+interaction:${joinLink}`)).toBe(true)
    expect(joinLinkShape(`web+interaction:${joinLink}`)).toEqual({ via: 'fetch', url: joinLink, passOn: false })
    expect(joinLinkShape(`Web+Interaction:${joinLink}`)).toEqual({ via: 'fetch', url: joinLink, passOn: false })
    // Whatever https link follows the prefix: the prefix says it is one to ask.
    expect(joinLinkShape('web+interaction:https://vtc.example.org/x')).toMatchObject({ via: 'fetch', passOn: false })
    // Nothing to ask: no shape, and the routing answers it in words.
    expect(joinLinkShape('web+interaction:ftp://vtc.example.org/x')).toBeUndefined()
    expect(joinLinkShape('web+interaction:')).toBeUndefined()
  })

  it('an invitation carried inline is read from the link when its goal is joining, with nothing to ask', () => {
    expect(joinLinkShape(inline(invitation()))).toEqual({ via: 'inline', invitation: invitation() })
    expect(joinLinkShape(inline(invitation(), 'https://vtc.example.org/'))).toMatchObject({ via: 'inline' })
    expect(joinLinkShape(`web+interaction:${inline(invitation())}`)).toMatchObject({ via: 'inline' })
  })

  it('control: every other link is left alone, an inline invitation with another goal included', () => {
    for (const link of [
      inline(withGoal('https://trusttasks.org/spec/auth/oob/identify/0.1')),
      inline(withGoal(undefined)),
      inline({ '@type': 'https://didcomm.org/out-of-band/1.1/invitation', goal_code: JOIN }),
      'didcomm://invite?_oob=eyJ0',
      'didcomm://invite?oob=eyJ0',
      'https://wallet.asml.berkmancenter.org/invite?oob=eyJ0',
      'https://wallet.asml.berkmancenter.org/i/abc123',
      'https://vtc.example.org/',
      'https://vtc.example.org/?iuv=2',
      'https://vtc.example.org/?x=_oobid',
      // Not https: a link asked in the clear is not asked.
      'http://vtc.example.org/?iuv=1&_oobid=abc',
      community,
      'keyring://vti/community?d=did%3Awebvh%3AQmCommunity%3Avtc.example.org',
    ]) {
      expect(joinLinkShape(link)).toBeUndefined()
    }
  })
})

describe('reading an invitation as a join code', () => {
  it('the join goal code makes it one, at any version of the join task, for the community it is from', () => {
    expect(readJoinInvitation(invitation(), NOW)).toEqual({
      kind: 'join',
      communityDid: community,
      manifest: manifestDocument(),
    })
    expect(readJoinInvitation(withGoal(JOIN.replace('0.3', '0.5')), NOW)).toMatchObject({ kind: 'join' })
    const webs = 'did:webs:webvh.example.org:vtc:EN7G2PZkzjb3TTWBrG3-oE5-A71XwLeX4et38jeh0C-a'
    expect(readJoinInvitation(invitation({ from: webs }), NOW)).toMatchObject({ kind: 'join', communityDid: webs })
  })

  it('control: any other goal code is not a join code, whoever it is from and whatever is attached', () => {
    for (const goal of [
      'https://trusttasks.org/spec/auth/oob/identify/0.1',
      'https://trusttasks.org/spec/vtc/join-requests/submit-receipt/0.1',
      'https://trusttasks.org/spec/vtc/join-requests/manifest/0.4',
      'https://trusttasks.org/spec/vtc/join-requests/submit/',
      'https://trusttasks.org/spec/vtc/join-requests/submit/0.3/extra',
      'https://example.org/spec/vtc/join-requests/submit/0.3',
      'vtc/join-requests/submit/0.3',
      'aries.vc.mediate',
      '',
      undefined,
      7,
    ]) {
      expect(readJoinInvitation(withGoal(goal), NOW)).toEqual({ kind: 'notJoin' })
    }
    // The join goal in a document that is not an out-of-band 2.0 invitation.
    expect(
      readJoinInvitation({ ...invitation(), type: 'https://didcomm.org/out-of-band/1.1/invitation' }, NOW)
    ).toEqual({ kind: 'notJoin' })
    for (const other of [undefined, null, 'text', [], { protocols: { didcomm: joinLink } }]) {
      expect(readJoinInvitation(other, NOW)).toEqual({ kind: 'notJoin' })
    }
  })

  it('a join code past its time is expired; one with no time, or an unreadable one, is not', () => {
    expect(readJoinInvitation(invitation({ expires_time: NOW / 1000 - 1 }), NOW)).toEqual({ kind: 'expired' })
    expect(readJoinInvitation(invitation({ expires_time: undefined }), NOW)).toMatchObject({ kind: 'join' })
    expect(readJoinInvitation(invitation({ expires_time: 'tomorrow' }), NOW)).toMatchObject({ kind: 'join' })
  })

  it('a join code from anything but a did:webvh or did:webs is a join code Keyring cannot use, never a contact', () => {
    for (const from of [
      'did:peer:2.Ez6LSabc',
      'did:key:z6MkswwZ',
      'did:web:example.org',
      'vtc.example.org',
      '',
      undefined,
    ]) {
      expect(readJoinInvitation(invitation({ from }), NOW)).toEqual({ kind: 'unusable' })
    }
  })

  it('finds the manifest attached bare or in a Trust Task envelope, and nothing else', () => {
    const bare = invitation({ attachments: [{ id: 'm', data: { json: manifestDocument() } }] })
    expect(readJoinInvitation(bare, NOW)).toMatchObject({ manifest: manifestDocument() })
    const others = invitation({
      attachments: [
        { id: 'a', data: { base64: 'eyJ0' } },
        { id: 'b', data: { json: { type: `${MANIFEST}/0.4`, payload: {} } } },
        { id: 'c', data: { json: { type: ENVELOPE, body: { type: `${JOIN}#response` } } } },
        'text',
      ],
    })
    expect(readJoinInvitation(others, NOW)).toEqual({ kind: 'join', communityDid: community })
    expect(readJoinInvitation(invitation({ attachments: 'none' }), NOW)).toEqual({
      kind: 'join',
      communityDid: community,
    })
  })
})

describe('asking a link', () => {
  const fetched: JoinLinkShape = { via: 'fetch', url: joinLink, passOn: true }

  it('asks once, for JSON, with no cookies, and reads the answer', async () => {
    const host = hostAnswering({ [joinLink]: jsonAnswer(invitation()) })
    await expect(readJoinLink(fetched, { fetch: asFetch(host), now: NOW })).resolves.toMatchObject({
      kind: 'join',
      communityDid: community,
    })
    expect(host).toHaveBeenCalledTimes(1)
    expect(host.mock.calls[0][0]).toBe(joinLink)
    expect(host.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
    })
  })

  it('an inline invitation is read with nothing asked', async () => {
    const host = hostAnswering({})
    const shape: JoinLinkShape = { via: 'inline', invitation: invitation() }
    await expect(readJoinLink(shape, { fetch: asFetch(host), now: NOW })).resolves.toMatchObject({ kind: 'join' })
    expect(host).not.toHaveBeenCalled()
  })

  it('control: an answer with another goal is not a join code, and nothing more is asked', async () => {
    const other = withGoal('https://trusttasks.org/spec/auth/oob/identify/0.1')
    const host = hostAnswering({ [joinLink]: jsonAnswer(other) })
    await expect(readJoinLink(fetched, { fetch: asFetch(host), now: NOW })).resolves.toEqual({ kind: 'notJoin' })
    // Its `protocols` entry is the link itself: not asked again.
    expect(host).toHaveBeenCalledTimes(1)
  })

  it('a VCALM answer that only lists protocols: its didcomm link is followed once, and never further', async () => {
    const next = 'https://vtc.example.org/oob?_oobid=abc'
    const host = hostAnswering({
      [joinLink]: jsonAnswer({ protocols: { didcomm: next } }),
      [next]: jsonAnswer(invitation()),
    })
    await expect(readJoinLink(fetched, { fetch: asFetch(host), now: NOW })).resolves.toMatchObject({ kind: 'join' })
    expect(host.mock.calls.map((call) => call[0])).toEqual([joinLink, next])

    const third = 'https://vtc.example.org/again?_oobid=def'
    const looping = hostAnswering({
      [joinLink]: jsonAnswer({ protocols: { didcomm: next } }),
      [next]: jsonAnswer({ protocols: { didcomm: third } }),
      [third]: jsonAnswer(invitation()),
    })
    await expect(readJoinLink(fetched, { fetch: asFetch(looping), now: NOW })).resolves.toEqual({ kind: 'notJoin' })
    expect(looping).toHaveBeenCalledTimes(2)
  })

  it('a didcomm entry carrying the invitation inline is read with no second ask; one that is no link to ask is left', async () => {
    const host = hostAnswering({ [joinLink]: jsonAnswer({ protocols: { didcomm: inline(invitation()) } }) })
    await expect(readJoinLink(fetched, { fetch: asFetch(host), now: NOW })).resolves.toMatchObject({ kind: 'join' })
    expect(host).toHaveBeenCalledTimes(1)

    for (const didcomm of ['http://coordinator.example.org/?_oobid=abc', 'https://coordinator.example.org/', 7]) {
      const plain = hostAnswering({ [joinLink]: jsonAnswer({ protocols: { didcomm } }) })
      await expect(readJoinLink(fetched, { fetch: asFetch(plain), now: NOW })).resolves.toEqual({ kind: 'notJoin' })
      expect(plain).toHaveBeenCalledTimes(1)
    }
  })

  it('a didcomm link on another origin is never asked: the scanned host cannot send the phone elsewhere', async () => {
    for (const next of [
      'https://coordinator.example.org/oob?_oobid=abc',
      'https://192.168.1.1/oob?_oobid=abc',
      'https://vtc.example.org:8443/oob?_oobid=abc',
      'https://vtc.example.org.evil.example/oob?_oobid=abc',
      'https://vtc.example.org@evil.example/oob?_oobid=abc',
    ]) {
      const host = hostAnswering({
        [joinLink]: jsonAnswer({ protocols: { didcomm: next } }),
        [next]: jsonAnswer(invitation()),
      })
      await expect(readJoinLink(fetched, { fetch: asFetch(host), now: NOW })).resolves.toEqual({ kind: 'notJoin' })
      expect(host.mock.calls.map((call) => call[0])).toEqual([joinLink])
    }
    // Control: the same origin, written in another case, is asked.
    const same = 'https://VTC.Example.org/oob?_oobid=abc'
    const host = hostAnswering({
      [joinLink]: jsonAnswer({ protocols: { didcomm: same } }),
      [same]: jsonAnswer(invitation()),
    })
    await expect(readJoinLink(fetched, { fetch: asFetch(host), now: NOW })).resolves.toMatchObject({ kind: 'join' })
    expect(host).toHaveBeenCalledTimes(2)
  })

  it('an answer that declares more than the limit is refused before any of it is read', async () => {
    const large = jsonAnswer(invitation(), 'application/json', '512001')
    const host = hostAnswering({ [joinLink]: large })
    await expect(readJoinLink(fetched, { fetch: asFetch(host), now: NOW })).resolves.toEqual({ kind: 'unreadable' })
    expect(large.text).not.toHaveBeenCalled()
  })

  it('control: one that declares a length within the limit, or none, or nonsense, is read', async () => {
    for (const length of ['512000', '3923', undefined, 'many']) {
      const answer = jsonAnswer(invitation(), 'application/json', length)
      const host = hostAnswering({ [joinLink]: answer })
      await expect(readJoinLink(fetched, { fetch: asFetch(host), now: NOW })).resolves.toMatchObject({ kind: 'join' })
      expect(answer.text).toHaveBeenCalledTimes(1)
    }
  })

  it('no answer, a refusal, a page, or too much is unreadable', async () => {
    const answers: unknown[] = [
      undefined,
      { ...jsonAnswer(invitation()), ok: false, status: 404 },
      jsonAnswer('<html>Finish joining</html>', 'text/html'),
      jsonAnswer('not json'),
      // It declared no length, so it was read: measured afterwards, and bounded only by the time allowed.
      jsonAnswer(`{"pad":"${'x'.repeat(512_001)}"}`),
    ]
    for (const answer of answers) {
      const host = hostAnswering(answer ? { [joinLink]: answer } : {})
      await expect(readJoinLink(fetched, { fetch: asFetch(host), now: NOW })).resolves.toEqual({ kind: 'unreadable' })
    }
  })
})

describe('the manifest a join code brings', () => {
  const agent = { config: {} } as never
  beforeEach(() => {
    mockVerify.mockReset()
    mockVerify.mockResolvedValue(true)
  })

  it('is believed when its proof verifies under the community’s DID', async () => {
    const manifest = await attachedManifest(agent, community, manifestDocument(), NOW)
    expect(manifest).toMatchObject({ wire: '0.3', manifestWire: '0.4', communityDid: community })
    expect(manifest?.criteria.map((c) => c.id)).toEqual(['review'])
    expect(mockVerify).toHaveBeenCalledWith(agent, manifestDocument(), community)
  })

  it('is not believed when the proof does not verify, or cannot be checked', async () => {
    mockVerify.mockResolvedValue(false)
    await expect(attachedManifest(agent, community, manifestDocument(), NOW)).resolves.toBeUndefined()
    mockVerify.mockRejectedValue(new Error('the DID could not be resolved'))
    await expect(attachedManifest(agent, community, manifestDocument(), NOW)).resolves.toBeUndefined()
  })

  it('is not believed when it is another community’s, another task’s, old, or from ahead of this phone’s clock', async () => {
    const other = 'did:webvh:QmOther:vtc.example.org'
    const payload = manifestDocument().payload
    const refused = [
      manifestDocument({ issuer: other }),
      manifestDocument({ payload: { ...payload, communityDid: other } }),
      manifestDocument({ payload: { ...payload, communityDid: undefined } }),
      manifestDocument({ payload: { communityDid: community } }),
      manifestDocument({ payload: 'none' }),
      manifestDocument({ type: `${MANIFEST}/0.9#response` }),
      manifestDocument({ type: `${MANIFEST}/0.4` }),
      manifestDocument({ issuedAt: '2026-11-20T11:49:59Z' }),
      manifestDocument({ issuedAt: '2026-11-20T12:05:01Z' }),
      manifestDocument({ issuedAt: 'yesterday' }),
      manifestDocument({ issuedAt: undefined }),
    ]
    for (const document of refused) {
      await expect(attachedManifest(agent, community, document, NOW)).resolves.toBeUndefined()
    }
    // Each was turned down for what it says, before its proof was looked at.
    expect(mockVerify).not.toHaveBeenCalled()
    await expect(attachedManifest(agent, community, undefined, NOW)).resolves.toBeUndefined()
    // Asked of another community than the one that signed it.
    await expect(attachedManifest(agent, other, manifestDocument(), NOW)).resolves.toBeUndefined()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('control: at the edges of its window it is still believed', async () => {
    for (const issuedAt of ['2026-11-20T11:50:00Z', '2026-11-20T12:05:00Z']) {
      await expect(attachedManifest(agent, community, manifestDocument({ issuedAt }), NOW)).resolves.toBeDefined()
    }
  })
})

describe('Join reading a manifest a join code brought', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
    jest.restoreAllMocks()
  })
  const fakeAgent = (communityDid: string) =>
    ({
      dids: {
        resolveDidDocument: jest.fn(async () => ({
          id: communityDid,
          service: [{ id: '#rest', type: 'VTCRest', serviceEndpoint: 'https://vtc.example.org/v1' }],
        })),
      },
      config: { logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } },
    }) as never
  /** The community's own answer over REST, which differs from what the link brought. */
  const communityAnswers = (communityDid: string) => {
    const asked = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        type: `${MANIFEST}/0.4#response`,
        payload: { communityDid, criteria: [{ id: 'invited', admission: 'automatic', invitationRequired: true }] },
      }),
    }))
    global.fetch = asked as unknown as typeof fetch
    return asked
  }
  const brought = (communityDid: string) => ({
    wire: '0.3' as const,
    manifestWire: '0.4' as const,
    communityDid,
    criteria: [{ id: 'review', admission: 'review' }],
    // It publishes its name, so learning it reads nothing more (a manifest with no name has the community's public
    // profile read for one, as after any manifest read).
    branding: { displayName: 'Example Commons' },
  })

  it('the next read is served by it, with the community not asked; the read after that asks the community', async () => {
    const communityDid = 'did:webvh:QmBrought:vtc-a.example.org'
    const asked = communityAnswers(communityDid)
    vtiAgent.manifestFromLink(communityDid, fakeAgent(communityDid), brought(communityDid))

    const first = await vtiAgent.fetchManifest(communityDid, fakeAgent(communityDid))
    expect(first.criteria.map((c) => c.id)).toEqual(['review'])
    expect(asked).not.toHaveBeenCalled()
    // It is what the app knows of the community, as any read is.
    expect(vtiAgent.lastManifest(communityDid)?.criteria.map((c) => c.id)).toEqual(['review'])

    const second = await vtiAgent.fetchManifest(communityDid, fakeAgent(communityDid))
    expect(second.criteria.map((c) => c.id)).toEqual(['invited'])
    expect(asked).toHaveBeenCalled()
  })

  it('control: with none brought, and for any other community, the community is asked', async () => {
    const communityDid = 'did:webvh:QmBrought:vtc-b.example.org'
    const otherDid = 'did:webvh:QmElsewhere:vtc-c.example.org'
    vtiAgent.manifestFromLink(communityDid, fakeAgent(communityDid), brought(communityDid))
    const asked = communityAnswers(otherDid)
    const read = await vtiAgent.fetchManifest(otherDid, fakeAgent(otherDid))
    expect(read.criteria.map((c) => c.id)).toEqual(['invited'])
    expect(asked).toHaveBeenCalled()
  })

  it('one that waited too long is not used: the community is asked', async () => {
    const communityDid = 'did:webvh:QmBrought:vtc-d.example.org'
    const asked = communityAnswers(communityDid)
    const clock = jest.spyOn(Date, 'now')
    clock.mockReturnValue(NOW)
    vtiAgent.manifestFromLink(communityDid, fakeAgent(communityDid), brought(communityDid))
    clock.mockReturnValue(NOW + 60_000)
    const read = await vtiAgent.fetchManifest(communityDid, fakeAgent(communityDid))
    expect(read.criteria.map((c) => c.id)).toEqual(['invited'])
    expect(asked).toHaveBeenCalled()
  })

  it('a read made for a version, after a refusal, asks the community and leaves it waiting', async () => {
    const communityDid = 'did:webvh:QmBrought:vtc-e.example.org'
    const asked = communityAnswers(communityDid)
    vtiAgent.manifestFromLink(communityDid, fakeAgent(communityDid), brought(communityDid))
    const forVersion = await vtiAgent.fetchManifest(communityDid, fakeAgent(communityDid), '0.3')
    expect(forVersion.criteria.map((c) => c.id)).toEqual(['invited'])
    expect(asked).toHaveBeenCalled()
    asked.mockClear()
    const next = await vtiAgent.fetchManifest(communityDid, fakeAgent(communityDid))
    expect(next.criteria.map((c) => c.id)).toEqual(['review'])
    expect(asked).not.toHaveBeenCalled()
  })
})
