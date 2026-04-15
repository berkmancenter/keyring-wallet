import { Agent, W3cCredentialRecord, W3cCredentialRepository } from '@credo-ts/core'
import {
  storeRCardTemplate,
  loadRCardTemplate,
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
