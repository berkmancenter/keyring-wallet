import { Agent, W3cCredentialRecord, W3cCredentialRepository } from '@credo-ts/core'
import {
  storeRCardTemplate,
  loadRCardTemplate,
  updateRCardTemplate,
  buildRCardTemplateW3cCredentialRecord,
  extractRCardTemplateFromW3cRecord,
} from '../../src/modules/vrc/services/rCardCredential'
import { buildRCardTemplate } from '../../src/modules/vrc/types/rcard'

// Mock Credo agent
const mockAgent = {
  dependencyManager: {
    resolve: jest.fn(),
  },
  w3cCredentials: {
    getAllCredentialRecords: jest.fn(),
  },
  config: {
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  },
  context: {},
} as unknown as Agent

const mockRepository = {
  save: jest.fn(),
  delete: jest.fn(),
  findByQuery: jest.fn(),
} as unknown as W3cCredentialRepository

describe('R-card template Credo storage helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(mockAgent.dependencyManager.resolve as jest.Mock).mockReturnValue(mockRepository)
  })

  test('buildRCardTemplateW3cCredentialRecord converts R-card template to W3C format', () => {
    const template = buildRCardTemplate({
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      organization: 'Example Org',
    })

    const w3cRecord = buildRCardTemplateW3cCredentialRecord(template)

    expect(w3cRecord).toBeInstanceOf(W3cCredentialRecord)
    const tags = w3cRecord.getTags()
    expect(tags).toMatchObject({
      type: 'RCardTemplate',
      isSelfIssued: 'true',
    })
  })

  test('extractRCardTemplateFromW3cRecord converts W3C record back to R-card template', () => {
    const template = buildRCardTemplate({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      organization: 'Example Org',
    })

    const w3cRecord = buildRCardTemplateW3cCredentialRecord(template)
    const extracted = extractRCardTemplateFromW3cRecord(w3cRecord)

    expect(extracted.templateId).toBeDefined()
    expect(extracted.label).toBeDefined()
    expect(extracted.jcard).toBeDefined()
    expect(extracted.jcard[0]).toBe('vcard')
    expect(Array.isArray(extracted.jcard[1])).toBe(true)
  })

  test('storeRCardTemplate persists to Credo repository', async () => {
    (mockRepository.save as jest.Mock).mockResolvedValue(undefined)
    ;(mockRepository.findByQuery as jest.Mock).mockResolvedValue([])

    const template = buildRCardTemplate({
      firstName: 'Test',
      lastName: 'User',
      email: 'test@example.com',
      organization: 'Example Org',
    })

    await expect(storeRCardTemplate(template, mockAgent)).resolves.toBe(true)
    expect(mockRepository.save).toHaveBeenCalled()
  })

  test('loadRCardTemplate retrieves from Credo', async () => {
    const template = buildRCardTemplate({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      organization: 'Example Org',
    })

    const w3cRecord = buildRCardTemplateW3cCredentialRecord(template)
    ;(mockRepository.findByQuery as jest.Mock).mockResolvedValue([w3cRecord])

    const loaded = await loadRCardTemplate(mockAgent)
    expect(loaded).toBeDefined()
    expect(loaded?.templateId).toBeDefined()
    expect(loaded?.jcard).toBeDefined()
  })

  test('loadRCardTemplate returns undefined when no template exists', async () => {
    (mockRepository.findByQuery as jest.Mock).mockResolvedValue([])

    const loaded = await loadRCardTemplate(mockAgent)
    expect(loaded).toBeUndefined()
  })

  test('loadRCardTemplate returns undefined when agent is null', async () => {
    const loaded = await loadRCardTemplate(null)
    expect(loaded).toBeUndefined()
  })
})

describe('updateRCardTemplate', () => {
  // An in-memory stand-in for the Credo repository, so findByQuery/update
  // behave like the real thing (query by tag, update in place, no duplicate
  // records) rather than just recording call args.
  let records: W3cCredentialRecord[]

  const matchesQuery = (record: W3cCredentialRecord, query: Record<string, unknown>) => {
    const tags = record.getTags()
    return Object.entries(query).every(([key, value]) => tags[key as keyof typeof tags] === value)
  }

  const inMemoryRepository = {
    save: jest.fn(async (_context: unknown, record: W3cCredentialRecord) => {
      records.push(record)
    }),
    update: jest.fn(async (_context: unknown, record: W3cCredentialRecord) => {
      records = records.map((existing) => (existing.id === record.id ? record : existing))
    }),
    findByQuery: jest.fn(async (_context: unknown, query: Record<string, unknown>) =>
      records.filter((record) => matchesQuery(record, query))
    ),
  } as unknown as W3cCredentialRepository

  beforeEach(() => {
    jest.clearAllMocks()
    records = []
    ;(mockAgent.dependencyManager.resolve as jest.Mock).mockReturnValue(inMemoryRepository)
  })

  test('replaces every field (including adding, changing and removing the photo) in place, not as a second record', async () => {
    const original = buildRCardTemplate({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      organization: 'Old Org',
    })
    records.push(buildRCardTemplateW3cCredentialRecord(original))

    const withPhoto = await updateRCardTemplate(
      original.templateId,
      {
        firstName: 'Janet',
        lastName: 'Doerson',
        email: 'janet@example.com',
        organization: 'New Org',
        photo: 'data:image/jpeg;base64,mockBase64Data',
      },
      mockAgent
    )
    expect(withPhoto).toBe(true)

    let matches = await inMemoryRepository.findByQuery(mockAgent.context, {
      type: 'RCardTemplate',
      templateId: original.templateId,
    })
    expect(matches).toHaveLength(1)
    let extracted = extractRCardTemplateFromW3cRecord(matches[0])
    expect(extracted.jcard).toEqual([
      'vcard',
      expect.arrayContaining([
        ['fn', {}, 'text', 'Janet Doerson'],
        ['email', { type: ['work'] }, 'text', 'janet@example.com'],
        ['org', {}, 'text', 'New Org'],
        ['photo', {}, 'uri', 'data:image/jpeg;base64,mockBase64Data'],
      ]),
    ])

    const photoRemoved = await updateRCardTemplate(
      original.templateId,
      { firstName: 'Janet', lastName: 'Doerson', email: 'janet@example.com', organization: 'New Org' },
      mockAgent
    )
    expect(photoRemoved).toBe(true)

    matches = await inMemoryRepository.findByQuery(mockAgent.context, {
      type: 'RCardTemplate',
      templateId: original.templateId,
    })
    expect(matches).toHaveLength(1)
    extracted = extractRCardTemplateFromW3cRecord(matches[0])
    expect(extracted.jcard[1].some((property) => property[0] === 'photo')).toBe(false)
  })

  test('returns false and leaves storage untouched when no record matches the profileId', async () => {
    const result = await updateRCardTemplate(
      'no-such-profile',
      { firstName: 'A', lastName: 'B', email: '', organization: '' },
      mockAgent
    )
    expect(result).toBe(false)
    expect(records).toHaveLength(0)
  })
})
