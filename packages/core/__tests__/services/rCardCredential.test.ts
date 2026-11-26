import { Agent, W3cCredentialRecord, W3cCredentialRepository } from '@credo-ts/core'
import {
  storeRCardTemplate,
  loadRCardTemplate,
  loadAllRCardTemplates,
  setActiveRCardProfile,
  adoptLegacyRCardTemplate,
  deleteRCardTemplate,
  updateRCardTemplate,
  buildRCardTemplateW3cCredentialRecord,
  extractRCardTemplateFromW3cRecord,
} from '../../src/modules/vrc/services/rCardCredential'
import { buildRCardTemplate, LEGACY_SHARED_TEMPLATE_ID } from '../../src/modules/vrc/types/rcard'

// Mock Credo agent
const mockAgent = {
  dependencyManager: {
    resolve: jest.fn(),
  },
  w3cCredentials: {
    getAllCredentialRecords: jest.fn(),
    deleteById: jest.fn(),
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
      active: 'false',
    })
  })

  test('buildRCardTemplateW3cCredentialRecord tags the record active when asked', () => {
    const template = buildRCardTemplate({ firstName: 'A', lastName: 'B', email: '', organization: '' })
    const w3cRecord = buildRCardTemplateW3cCredentialRecord(template, { active: true })
    expect(w3cRecord.getTags()).toMatchObject({ active: 'true' })
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

  test('loadRCardTemplate retrieves the active profile from Credo', async () => {
    const template = buildRCardTemplate({
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      organization: 'Example Org',
    })

    const w3cRecord = buildRCardTemplateW3cCredentialRecord(template, { active: true })
    ;(mockRepository.findByQuery as jest.Mock).mockResolvedValue([w3cRecord])

    const loaded = await loadRCardTemplate(mockAgent)
    expect(mockRepository.findByQuery).toHaveBeenCalledWith(mockAgent.context, {
      type: 'RCardTemplate',
      active: 'true',
    })
    expect(loaded).toBeDefined()
    expect(loaded?.templateId).toBeDefined()
    expect(loaded?.jcard).toBeDefined()
  })

  test('loadRCardTemplate(agent, profileId) queries by that specific templateId, not active', async () => {
    (mockRepository.findByQuery as jest.Mock).mockResolvedValue([])
    await loadRCardTemplate(mockAgent, 'some-profile-id')
    expect(mockRepository.findByQuery).toHaveBeenCalledWith(mockAgent.context, {
      type: 'RCardTemplate',
      templateId: 'some-profile-id',
    })
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

// An in-memory stand-in for the Credo repository, shared by every describe
// block below, so findByQuery/save/update behave like the real thing (query
// by tag, no duplicate records) rather than just recording call args.
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

describe('updateRCardTemplate', () => {
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

describe('storeRCardTemplate: first-profile-is-active rule', () => {
  test('the first profile ever stored is tagged active', async () => {
    const first = buildRCardTemplate({ firstName: 'A', lastName: 'B', email: '', organization: '' })
    await storeRCardTemplate(first, mockAgent)

    expect(records).toHaveLength(1)
    expect(records[0].getTags()).toMatchObject({ active: 'true' })
  })

  test('a second profile stored later is NOT tagged active — it does not steal activation', async () => {
    const first = buildRCardTemplate({ firstName: 'A', lastName: 'B', email: '', organization: '' })
    await storeRCardTemplate(first, mockAgent)

    const second = buildRCardTemplate({ firstName: 'C', lastName: 'D', email: '', organization: '' })
    await storeRCardTemplate(second, mockAgent)

    expect(records).toHaveLength(2)
    const secondRecord = records.find((r) => r.getTags().templateId === second.templateId)
    expect(secondRecord?.getTags()).toMatchObject({ active: 'false' })
  })
})

describe('loadAllRCardTemplates', () => {
  test('returns every profile and which one is active', async () => {
    const first = buildRCardTemplate({ firstName: 'A', lastName: 'B', email: '', organization: '' })
    const second = buildRCardTemplate({ firstName: 'C', lastName: 'D', email: '', organization: '' })
    records.push(buildRCardTemplateW3cCredentialRecord(first, { active: true }))
    records.push(buildRCardTemplateW3cCredentialRecord(second, { active: false }))

    const result = await loadAllRCardTemplates(mockAgent)

    expect(result.profiles).toHaveLength(2)
    expect(result.activeProfileId).toBe(first.id)
  })

  test('returns an empty list and no active id when there are no profiles', async () => {
    const result = await loadAllRCardTemplates(mockAgent)
    expect(result).toEqual({ profiles: [], activeProfileId: undefined })
  })

  test('returns an empty list when agent is null', async () => {
    const result = await loadAllRCardTemplates(null)
    expect(result).toEqual({ profiles: [] })
  })
})

describe('setActiveRCardProfile', () => {
  test('marks the given profile active and every other one inactive', async () => {
    const first = buildRCardTemplate({ firstName: 'A', lastName: 'B', email: '', organization: '' })
    const second = buildRCardTemplate({ firstName: 'C', lastName: 'D', email: '', organization: '' })
    records.push(buildRCardTemplateW3cCredentialRecord(first, { active: true }))
    records.push(buildRCardTemplateW3cCredentialRecord(second, { active: false }))

    const result = await setActiveRCardProfile(mockAgent, second.templateId)

    expect(result).toBe(true)
    const { activeProfileId } = await loadAllRCardTemplates(mockAgent)
    expect(activeProfileId).toBe(second.id)
  })

  test('returns false when no profile matches the given profileId', async () => {
    const result = await setActiveRCardProfile(mockAgent, 'no-such-profile')
    expect(result).toBe(false)
  })
})

describe('adoptLegacyRCardTemplate', () => {
  test('mints a per-instance templateId for a pre-multi-profile record and marks it active', async () => {
    const legacy = buildRCardTemplate(
      { firstName: 'Jane', lastName: 'Doe', email: '', organization: '' },
      { templateId: LEGACY_SHARED_TEMPLATE_ID }
    )
    records.push(buildRCardTemplateW3cCredentialRecord(legacy, { active: false }))

    const adopted = await adoptLegacyRCardTemplate(mockAgent)

    expect(adopted).toBeDefined()
    expect(adopted?.templateId).toBe(legacy.id)
    expect(adopted?.templateId).not.toBe(LEGACY_SHARED_TEMPLATE_ID)

    const { profiles, activeProfileId } = await loadAllRCardTemplates(mockAgent)
    expect(profiles).toHaveLength(1)
    expect(activeProfileId).toBe(legacy.id)
  })

  test('is a no-op when there is no legacy record (fresh install, or already adopted)', async () => {
    const modern = buildRCardTemplate({ firstName: 'A', lastName: 'B', email: '', organization: '' })
    records.push(buildRCardTemplateW3cCredentialRecord(modern, { active: true }))

    const adopted = await adoptLegacyRCardTemplate(mockAgent)

    expect(adopted).toBeUndefined()
    expect(records).toHaveLength(1)
  })
})

describe('deleteRCardTemplate', () => {
  test('deletes only the specified profile, leaving others untouched', async () => {
    const first = buildRCardTemplate({ firstName: 'A', lastName: 'B', email: '', organization: '' })
    const second = buildRCardTemplate({ firstName: 'C', lastName: 'D', email: '', organization: '' })
    const firstRecord = buildRCardTemplateW3cCredentialRecord(first, { active: true })
    const secondRecord = buildRCardTemplateW3cCredentialRecord(second, { active: false })
    records.push(firstRecord, secondRecord)
    ;(mockAgent.w3cCredentials.deleteById as jest.Mock).mockImplementation(async (id: string) => {
      records = records.filter((r) => r.id !== id)
    })

    await deleteRCardTemplate(mockAgent, second.templateId)

    expect(records).toHaveLength(1)
    expect(records[0].getTags().templateId).toBe(first.templateId)
  })
})

describe('error handling: a broken repository fails closed, not by throwing', () => {
  beforeEach(() => {
    (mockAgent.dependencyManager.resolve as jest.Mock).mockReturnValue({
      findByQuery: jest.fn().mockRejectedValue(new Error('Credo repository unavailable')),
      update: jest.fn(),
    } as unknown as W3cCredentialRepository)
  })

  test('loadAllRCardTemplates returns an empty result instead of throwing', async () => {
    await expect(loadAllRCardTemplates(mockAgent)).resolves.toEqual({ profiles: [] })
  })

  test('setActiveRCardProfile returns false instead of throwing', async () => {
    await expect(setActiveRCardProfile(mockAgent, 'some-profile-id')).resolves.toBe(false)
  })

  test('adoptLegacyRCardTemplate returns undefined instead of throwing', async () => {
    await expect(adoptLegacyRCardTemplate(mockAgent)).resolves.toBeUndefined()
  })
})
