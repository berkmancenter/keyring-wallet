import { AgentDirectoryService, directoryStatusOf, type DirectoryBackend } from '../directoryService'
import { DirectoryConflict, DirectoryRefused } from '../types'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import {
  DIRECTORY_TASK,
  MEMBERS_PAGE,
  parseCard,
  parseEntries,
  parseFields,
  parsePicture,
  pictureOf,
  uploadPayload,
} from '../wire'

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

  it('reads it by entry, labelled and ordered by the community’s fields, the picture apart from the lines', async () => {
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
    expect(card?.picture).toEqual({ sha256: 'a'.repeat(64), mediaType: 'image/png' })
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

describe('pictures', () => {
  const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 250, 251, 252])
  const DIGEST = bytesToHex(sha256(BYTES))
  const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')
  const PICTURE = { sha256: DIGEST, mediaType: 'image/jpeg' as const }
  const answer = (over: Record<string, unknown> = {}) => ({
    image: { sha256: DIGEST, mediaType: 'image/jpeg', size: BYTES.length },
    data: b64url(BYTES),
    ...over,
  })

  it('reads a picture reference off a row, your card and a member card, and nothing that is not one', () => {
    expect(pictureOf({ sha256: DIGEST, mediaType: 'image/png', size: 9 })).toEqual({
      sha256: DIGEST,
      mediaType: 'image/png',
    })
    expect(pictureOf({ sha256: DIGEST.toUpperCase(), mediaType: 'image/png' })).toBeUndefined()
    expect(pictureOf({ sha256: DIGEST, mediaType: 'image/avif' })).toBeUndefined()
    expect(pictureOf({ sha256: DIGEST, mediaType: 'image/svg+xml' })).toBeUndefined()
    expect(pictureOf('https://example.org/a.png')).toBeUndefined()
    const page = parseEntries({ items: [{ entryId: ENTRY(1), fields: { displayName: 'Ana', avatar: PICTURE } }] })
    expect(page.rows[0].picture).toEqual(PICTURE)
    expect(parseCard(card({ values: { displayName: 'Ana', avatar: PICTURE } }))?.picture).toEqual(PICTURE)
  })

  it('shows the bytes as a data URI only when they are the picture the card named', () => {
    expect(parsePicture(answer(), PICTURE)).toBe(`data:image/jpeg;base64,${Buffer.from(BYTES).toString('base64')}`)
    // The answer names another picture.
    expect(
      parsePicture(answer({ image: { sha256: 'b'.repeat(64), mediaType: 'image/jpeg' } }), PICTURE)
    ).toBeUndefined()
    // Bytes that are not the digest, though the answer says they are.
    expect(parsePicture(answer({ data: b64url(new Uint8Array([1, 2, 3])) }), PICTURE)).toBeUndefined()
    // Not base64url without padding.
    expect(parsePicture(answer({ data: `${Buffer.from(BYTES).toString('base64')}=` }), PICTURE)).toBeUndefined()
    expect(parsePicture(answer({ data: undefined }), PICTURE)).toBeUndefined()
    expect(parsePicture('not an answer', PICTURE)).toBeUndefined()
  })

  it('refuses bytes over the size a card holds, even with the right digest', () => {
    const big = new Uint8Array(262_145).fill(7)
    const named = { sha256: bytesToHex(sha256(big)), mediaType: 'image/png' as const }
    expect(parsePicture({ image: named, data: b64url(big) }, named)).toBeUndefined()
    const fits = big.subarray(0, 262_144)
    const fitsNamed = { sha256: bytesToHex(sha256(fits)), mediaType: 'image/png' as const }
    expect(parsePicture({ image: fitsNamed, data: b64url(fits) }, fitsNamed)).toMatch(/^data:image\/png;base64,/)
  })

  it('asks for the avatar on that entry, naming the digest it was shown', async () => {
    const { service, communityTask } = setup(() => answer())
    expect(await service.showPicture(COMMUNITY, ENTRY(4), PICTURE)).toMatch(/^data:image\/jpeg;base64,/)
    expect(communityTask).toHaveBeenCalledWith(COMMUNITY, DIRECTORY_TASK.imagesGet, {
      entryId: ENTRY(4),
      field: 'avatar',
      sha256: DIGEST,
    })
  })

  it('has no picture when it is not shown to you or the community serves none, and passes anything else on', async () => {
    for (const code of ['vtc/directory/images/get:notFound', 'unsupportedType', 'unsupportedVersion']) {
      const { service } = setup(() => {
        throw new FakeRefusal('taskFailed', { code })
      })
      expect(await service.showPicture(COMMUNITY, ENTRY(4), PICTURE)).toBeUndefined()
    }
    const lost = setup(() => {
      throw new Error('the community did not answer within 30 s')
    })
    await expect(lost.service.showPicture(COMMUNITY, ENTRY(4), PICTURE)).rejects.toThrow('did not answer')
  })
})

describe('putting your photo on your card', () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0xfb, 0xff])
  const PHOTO = `data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}`
  const COPY = { sha256: 'c'.repeat(64), mediaType: 'image/jpeg', size: 4321 }

  it('hands the community the photo as base64url, then puts its copy on the card for the audience chosen', async () => {
    const { service, communityTask } = setup((type) =>
      type === DIRECTORY_TASK.imagesUpload
        ? { image: COPY, expiresAt: '2026-11-03T00:00:00Z' }
        : card({ values: { displayName: 'Ana', avatar: COPY }, visibility: { avatar: 'members' }, revision: 4 })
    )
    const mine = await service.setMyPicture(COMMUNITY, PHOTO, 'members', 3)
    expect(communityTask.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [DIRECTORY_TASK.imagesUpload, { mediaType: 'image/jpeg', data: Buffer.from(JPEG).toString('base64url') }],
      [DIRECTORY_TASK.cardUpdate, { values: { avatar: COPY }, visibility: { avatar: 'members' }, expectedRevision: 3 }],
    ])
    expect(mine.picture).toEqual({ sha256: COPY.sha256, mediaType: 'image/jpeg' })
    expect(mine.revision).toBe(4)
  })

  it('administrators only is sent as admins', async () => {
    const { service, communityTask } = setup((type) =>
      type === DIRECTORY_TASK.imagesUpload ? { image: COPY, expiresAt: 'x' } : card()
    )
    await service.setMyPicture(COMMUNITY, PHOTO, 'admins', 3)
    expect(communityTask.mock.calls[1][2]).toMatchObject({ visibility: { avatar: 'admins' } })
  })

  it('sends nothing for what is not a photo a card can hold', async () => {
    const { service, communityTask } = setup(() => card())
    for (const photo of [
      'data:image/svg+xml;base64,PHN2Zz4=',
      'https://example.org/me.jpg',
      `data:image/jpeg;base64,${Buffer.alloc(262_145, 1).toString('base64')}`,
    ])
      await expect(service.setMyPicture(COMMUNITY, photo, 'members', 3)).rejects.toMatchObject({
        code: 'valueInvalid',
      })
    expect(communityTask).not.toHaveBeenCalled()
  })

  it('writes nothing to the card when the upload answer is not one', async () => {
    const { service, communityTask } = setup(() => ({ image: { sha256: 'nope' } }))
    await expect(service.setMyPicture(COMMUNITY, PHOTO, 'members', 3)).rejects.toThrow('something else')
    expect(communityTask).toHaveBeenCalledTimes(1)
  })

  it('says the card changed elsewhere when the update is superseded', async () => {
    const { service } = setup((type) => {
      if (type === DIRECTORY_TASK.imagesUpload) return { image: COPY, expiresAt: 'x' }
      throw new FakeRefusal('taskFailed', { code: 'vtc/directory/card/update:superseded' })
    })
    await expect(service.setMyPicture(COMMUNITY, PHOTO, 'members', 3)).rejects.toBeInstanceOf(DirectoryConflict)
  })

  it('takes it off the card and returns who sees it to the default, at the revision read', async () => {
    const { service, communityTask } = setup(() => card({ revision: 5 }))
    const mine = await service.removeMyPicture(COMMUNITY, 4)
    expect(communityTask).toHaveBeenCalledWith(COMMUNITY, DIRECTORY_TASK.cardUpdate, {
      values: { avatar: null },
      visibility: { avatar: null },
      expectedRevision: 4,
    })
    expect(mine.picture).toBeUndefined()
  })

  it('turns a data URI into the upload payload, and nothing else', () => {
    expect(uploadPayload(PHOTO)).toEqual({ mediaType: 'image/jpeg', data: Buffer.from(JPEG).toString('base64url') })
    expect(uploadPayload('data:image/png;base64,')).toBeUndefined()
    expect(uploadPayload('data:image/avif;base64,AAAA')).toBeUndefined()
  })
})
