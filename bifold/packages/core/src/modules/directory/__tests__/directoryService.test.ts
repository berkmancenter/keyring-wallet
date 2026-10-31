import { AgentDirectoryService, directoryStatusOf, type DirectoryBackend } from '../directoryService'
import { DirectoryConflict, DirectoryRefused } from '../types'
import { DIRECTORY_TASK, MEMBERS_PAGE, parseCard, parseEntries, parseFields } from '../wire'

const COMMUNITY = 'did:webvh:community:a'
const ENTRY = (n: number) => `dir_${String(n).padStart(16, '0')}`

/** A refusal as the community leg throws it (`VtiRefusal`), the task's own code in `details`. */
class FakeRefusal extends Error {
  public constructor(
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(`refused: ${code}`)
    this.name = 'VtiRefusal'
  }
}

const card = (over: Record<string, unknown> = {}) => ({
  card: {
    entryId: ENTRY(1),
    values: { displayName: 'Ana' },
    visibility: { displayName: 'members' },
    discoverability: { listing: 'listed', search: 'byName', external: false },
    introductions: 'off',
    revision: 3,
    updatedAt: '2026-10-30T00:00:00Z',
    ...over,
  },
  missingRequired: [],
})

function setup(answer: (type: string, payload: Record<string, unknown>) => unknown) {
  const communityTask = jest.fn(async (_did: string, type: string, payload: Record<string, unknown>) =>
    answer(type, payload)
  )
  const backend: DirectoryBackend = { communityTask }
  return { service: new AgentDirectoryService(backend), communityTask }
}

describe('reading the members list', () => {
  it('asks a page of 25, then the next from its cursor, as the persona’s community session', async () => {
    const { service, communityTask } = setup((_type, payload) =>
      payload.cursor
        ? { items: [], nextCursor: null }
        : { items: [{ entryId: ENTRY(1), fields: {} }], nextCursor: 'c2' }
    )
    expect(MEMBERS_PAGE).toBe(25)
    const first = await service.listMembers(COMMUNITY)
    expect(first.nextCursor).toBe('c2')
    const second = await service.listMembers(COMMUNITY, 'c2')
    expect(second.nextCursor).toBeUndefined()
    expect(communityTask.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      [COMMUNITY, DIRECTORY_TASK.entriesList02, { limit: 25 }],
      [COMMUNITY, DIRECTORY_TASK.entriesList02, { limit: 25, cursor: 'c2' }],
    ])
  })

  it('keeps a name and a role as text, and drops an entry whose id is not an entry id', () => {
    const page = parseEntries({
      items: [
        { entryId: ENTRY(1), fields: { displayName: '  Ana <b>Lopez</b> ', role: 'admin' }, connected: true },
        { entryId: ENTRY(2), fields: {} },
        { entryId: 'did:key:z6Mk', fields: { displayName: 'A DID is not an entry' } },
        { entryId: ENTRY(3), fields: { displayName: 'x'.repeat(200) } },
        'not an entry',
      ],
    })
    expect(page.rows.map((r) => r.entryId)).toEqual([ENTRY(1), ENTRY(2), ENTRY(3)])
    expect(page.rows[0]).toEqual({ entryId: ENTRY(1), name: 'Ana <b>Lopez</b>', role: 'admin', connected: true })
    expect(page.rows[1].name).toBeUndefined()
    expect(page.rows[2].name).toHaveLength(64)
  })
})

describe('your card', () => {
  it('reads it, with who sees each field: your choice where you made one, else the field’s default', async () => {
    const { service } = setup((type) =>
      type === DIRECTORY_TASK.cardShow
        ? card({ visibility: { nickname: 'members' } })
        : {
            fields: [
              {
                key: 'nickname',
                label: 'Nickname',
                type: 'text',
                source: 'member',
                base: true,
                ceiling: 'public',
                defaultVisibility: 'admins',
                required: false,
                searchable: true,
                facet: false,
                order: 2,
                state: 'active',
              },
              {
                key: 'displayName',
                label: 'Name',
                type: 'text',
                source: 'member',
                base: true,
                ceiling: 'public',
                defaultVisibility: 'members',
                required: false,
                searchable: true,
                facet: false,
                order: 1,
                state: 'active',
              },
              {
                key: 'did',
                label: 'Identifier',
                type: 'did',
                source: 'derived',
                base: true,
                ceiling: 'members',
                defaultVisibility: 'admins',
                required: false,
                searchable: false,
                facet: false,
                order: 3,
                state: 'active',
              },
              {
                key: 'org.example.old',
                label: 'Old',
                type: 'text',
                source: 'member',
                base: false,
                ceiling: 'members',
                defaultVisibility: 'members',
                required: false,
                searchable: false,
                facet: false,
                order: 0,
                state: 'retired',
              },
            ],
            listingDefaults: { defaultListing: 'listed' },
          }
    )
    const mine = await service.showMyCard(COMMUNITY)
    expect(mine).toMatchObject({ entryId: ENTRY(1), revision: 3, name: 'Ana' })
    const fields = await service.cardFields(COMMUNITY, mine)
    expect(fields.map((f) => [f.key, f.audience, f.writable])).toEqual([
      ['displayName', 'members', true],
      ['nickname', 'members', true],
      ['did', 'admins', false],
    ])
  })

  it('refuses a card that is not one', () => {
    expect(parseCard(card({ entryId: 'nope' }))).toBeUndefined()
    expect(parseCard(card({ revision: -1 }))).toBeUndefined()
    expect(parseCard({ missingRequired: [] })).toBeUndefined()
    expect(
      parseFields({ fields: [{ key: 'Bad Key', label: 'x', ceiling: 'members', defaultVisibility: 'members' }] })
    ).toEqual([])
  })

  it('sets the name at the revision read, and nothing else', async () => {
    const { service, communityTask } = setup(() => card({ revision: 4, values: { displayName: 'Ana Lopez' } }))
    const updated = await service.setMyName(COMMUNITY, '  Ana   Lopez ', 3)
    expect(updated).toMatchObject({ revision: 4, name: 'Ana Lopez' })
    expect(communityTask).toHaveBeenCalledWith(COMMUNITY, DIRECTORY_TASK.cardUpdate, {
      values: { displayName: 'Ana Lopez' },
      expectedRevision: 3,
    })
  })

  it('says the card changed elsewhere when the community answers superseded, apart from any other refusal', async () => {
    const superseded = setup(() => {
      throw new FakeRefusal('taskFailed', { code: 'vtc/directory/card/update:superseded' })
    })
    await expect(superseded.service.setMyName(COMMUNITY, 'Ana', 3)).rejects.toBeInstanceOf(DirectoryConflict)

    const invalid = setup(() => {
      throw new FakeRefusal('taskFailed', { code: 'vtc/directory/card/update:valueRefused' })
    })
    const err = await invalid.service.setMyName(COMMUNITY, 'Ana', 3).catch((e) => e)
    expect(err).toBeInstanceOf(DirectoryRefused)
    expect(err).toMatchObject({ operation: 'updateMyCard', code: 'valueRefused', retryable: false })
  })

  it('sends no blank name', async () => {
    const { service, communityTask } = setup(() => card())
    await expect(service.setMyName(COMMUNITY, '   ', 3)).rejects.toMatchObject({ code: 'valueInvalid' })
    expect(communityTask).not.toHaveBeenCalled()
  })
})

describe('what a screen shows when the directory cannot be read', () => {
  it('names a community without a directory, a phone that is no longer a member, and anything else', () => {
    expect(directoryStatusOf(new DirectoryRefused('listMembers', 'unsupportedType', false))).toMatchObject({
      status: 'unavailable',
      reason: 'communityDoesNotServe',
    })
    expect(directoryStatusOf(new DirectoryRefused('showMyCard', 'notMember', false))).toMatchObject({
      reason: 'noRight',
    })
    expect(directoryStatusOf(new DirectoryRefused('listMembers', 'rateLimited', true))).toMatchObject({
      reason: 'communityUnreachable',
    })
    expect(directoryStatusOf(new Error('timed out'))).toMatchObject({ reason: 'communityUnreachable' })
  })

  it('reports a rate refusal as retryable', async () => {
    const { service } = setup(() => {
      throw new FakeRefusal('taskFailed', { code: 'vtc/directory/entries/list:rateLimited' })
    })
    await expect(service.listMembers(COMMUNITY)).rejects.toMatchObject({ code: 'rateLimited', retryable: true })
  })
})

describe('a room author’s own name', () => {
  const ANA = 'did:key:ana'

  it('asks the community by DID for the name only, and reads it from the answer about that member', async () => {
    const { service, communityTask } = setup(() => ({ subject: ANA, fields: { displayName: ' Ana ', did: ANA } }))
    expect(await service.lookupName(COMMUNITY, ANA)).toBe('Ana')
    expect(communityTask).toHaveBeenCalledWith(COMMUNITY, DIRECTORY_TASK.query, {
      subject: ANA,
      fields: 'displayName',
    })
  })

  it('has no name for a member the community does not show, nor from an answer about someone else', async () => {
    const hidden = setup(() => {
      throw new FakeRefusal('taskFailed', { code: 'vtc/directory/query:notFound' })
    })
    expect(await hidden.service.lookupName(COMMUNITY, ANA)).toBeUndefined()
    const other = setup(() => ({ subject: 'did:key:bo', fields: { displayName: 'Bo' } }))
    expect(await other.service.lookupName(COMMUNITY, ANA)).toBeUndefined()
  })

  it('passes any other refusal on', async () => {
    const { service } = setup(() => {
      throw new FakeRefusal('taskFailed', { code: 'vtc/directory/query:rateLimited' })
    })
    await expect(service.lookupName(COMMUNITY, ANA)).rejects.toMatchObject({ code: 'rateLimited' })
  })
})

describe('another member’s card', () => {
  const DEFS = {
    fields: [
      {
        key: 'displayName',
        label: 'Name',
        type: 'text',
        source: 'member',
        base: true,
        ceiling: 'public',
        defaultVisibility: 'members',
        required: false,
        searchable: true,
        facet: false,
        order: 1,
        state: 'active',
      },
      {
        key: 'pronouns',
        label: 'Pronouns',
        type: 'text',
        source: 'member',
        base: true,
        ceiling: 'public',
        defaultVisibility: 'admins',
        required: false,
        searchable: false,
        facet: false,
        order: 3,
        state: 'active',
      },
      {
        key: 'links',
        label: 'Links',
        type: 'url',
        source: 'member',
        base: true,
        ceiling: 'public',
        defaultVisibility: 'admins',
        required: false,
        searchable: false,
        facet: false,
        order: 4,
        state: 'active',
      },
      {
        key: 'joinedAt',
        label: 'Joined',
        type: 'date',
        source: 'derived',
        base: true,
        ceiling: 'members',
        defaultVisibility: 'admins',
        required: false,
        searchable: false,
        facet: false,
        order: 2,
        state: 'active',
      },
      {
        key: 'org.lab.licensed',
        label: 'Licensed',
        type: 'claim',
        source: 'credential',
        base: false,
        ceiling: 'members',
        defaultVisibility: 'members',
        required: false,
        searchable: false,
        facet: false,
        order: 5,
        state: 'active',
      },
      {
        key: 'org.lab.mentor',
        label: 'Mentor',
        type: 'text',
        source: 'member',
        base: false,
        ceiling: 'members',
        defaultVisibility: 'members',
        required: false,
        searchable: false,
        facet: false,
        order: 6,
        state: 'active',
      },
      {
        key: 'avatar',
        label: 'Picture',
        type: 'image',
        source: 'member',
        base: true,
        ceiling: 'public',
        defaultVisibility: 'admins',
        required: false,
        searchable: false,
        facet: false,
        order: 7,
        state: 'active',
      },
      {
        key: 'did',
        label: 'Identifier',
        type: 'did',
        source: 'derived',
        base: true,
        ceiling: 'members',
        defaultVisibility: 'admins',
        required: false,
        searchable: false,
        facet: false,
        order: 8,
        state: 'active',
      },
    ],
    listingDefaults: { defaultListing: 'listed' },
  }
  const FIELDS = {
    displayName: 'Ana Lopez',
    role: 'member',
    pronouns: 'she/her',
    links: ['https://example.org', 'https://example.net'],
    joinedAt: '2026-09-01T10:00:00Z',
    'org.lab.licensed': { value: 'Pharmacist', issuer: 'did:web:board', verifiedAt: '2026-10-01T00:00:00Z' },
    'org.lab.mentor': true,
    avatar: { sha256: 'a'.repeat(64), mediaType: 'image/png' },
    did: 'did:key:ana',
    'org.unknown.field': 'no label for this',
  }

  it('reads it by entry, labelled and ordered by the community’s fields, leaving out the head, the ID and pictures', async () => {
    const entryId = ENTRY(7)
    const { service, communityTask } = setup((type) =>
      type === DIRECTORY_TASK.entriesShow ? { entry: { entryId, fields: FIELDS } } : DEFS
    )
    const card = await service.showMember(COMMUNITY, entryId)
    expect(communityTask.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [DIRECTORY_TASK.entriesShow, { entryId }],
      [DIRECTORY_TASK.fieldsList, {}],
    ])
    expect(card?.name).toBe('Ana Lopez')
    expect(card?.role).toBe('member')
    expect(card?.entries.map((e) => [e.key, e.value])).toEqual([
      ['joinedAt', { kind: 'text', text: '2026-09-01' }],
      ['pronouns', { kind: 'text', text: 'she/her' }],
      ['links', { kind: 'list', items: ['https://example.org', 'https://example.net'] }],
      ['org.lab.licensed', { kind: 'verified', text: 'Pharmacist' }],
      ['org.lab.mentor', { kind: 'yesNo', yes: true }],
    ])
  })

  it('reads a room author’s card by DID, the whole card and not just the name', async () => {
    const { service, communityTask } = setup((type) =>
      type === DIRECTORY_TASK.query ? { subject: 'did:key:ana', fields: FIELDS } : DEFS
    )
    expect((await service.memberCardByDid(COMMUNITY, 'did:key:ana'))?.name).toBe('Ana Lopez')
    expect(communityTask.mock.calls[0][2]).toEqual({ subject: 'did:key:ana' })
  })

  it('has no card for a member the community does not show, nor from an answer about someone else', async () => {
    const hidden = setup(() => {
      throw new FakeRefusal('taskFailed', { code: 'vtc/directory/entries/show:notFound' })
    })
    expect(await hidden.service.showMember(COMMUNITY, ENTRY(7))).toBeUndefined()
    const other = setup(() => ({ entry: { entryId: ENTRY(8), fields: FIELDS } }))
    expect(await other.service.showMember(COMMUNITY, ENTRY(7))).toBeUndefined()
    expect(other.communityTask).toHaveBeenCalledTimes(1)
  })

  it('passes a failed read on, so it is never shown as no card', async () => {
    const { service } = setup(() => {
      throw new Error('the community did not answer within 30 s')
    })
    await expect(service.memberCardByDid(COMMUNITY, 'did:key:ana')).rejects.toThrow('did not answer')
  })
})
