/**
 * Tests for LLMService
 */

import { LLMService, LLMServiceConfig } from '../LLMService'
import { existsSync, writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('LLMService', () => {
  const testContextDir = join(tmpdir(), 'llm-test-context')
  let orgContextPath: string
  let eventContextPath: string
  let capabilitiesContextPath: string

  beforeAll(() => {
    // Create test context files
    orgContextPath = join(testContextDir, 'org.md')
    eventContextPath = join(testContextDir, 'event.md')
    capabilitiesContextPath = join(testContextDir, 'capabilities.md')

    // Create directory if it doesn't exist
    if (!existsSync(testContextDir)) {
      require('fs').mkdirSync(testContextDir, { recursive: true })
    }

    // Write test context files
    writeFileSync(
      orgContextPath,
      '# Test Organization\n\nWe are a test organization focused on digital identity research.'
    )
    writeFileSync(eventContextPath, '# Test Event\n\nThis is a test event about verifiable credentials.')
    writeFileSync(capabilitiesContextPath, '# Test App\n\nThe app supports credential exchange and witnessing.')
  })

  afterAll(() => {
    // Clean up test files
    if (existsSync(orgContextPath)) unlinkSync(orgContextPath)
    if (existsSync(eventContextPath)) unlinkSync(eventContextPath)
    if (existsSync(capabilitiesContextPath)) unlinkSync(capabilitiesContextPath)
    if (existsSync(testContextDir)) require('fs').rmdirSync(testContextDir)
  })

  describe('Constructor', () => {
    it('should throw error if LLM is not enabled', () => {
      const config: LLMServiceConfig = {
        enabled: false,
        apiKey: 'test-key',
        rateLimitPerUser: 10,
        rateLimitUserWindow: 60,
        rateLimitGlobal: 100,
        rateLimitGlobalWindow: 60,
      }

      expect(() => new LLMService(config)).toThrow('LLM service is not enabled')
    })

    it('should throw error if no API key is provided', () => {
      const config: LLMServiceConfig = {
        enabled: true,
        apiKey: '',
        rateLimitPerUser: 10,
        rateLimitUserWindow: 60,
        rateLimitGlobal: 100,
        rateLimitGlobalWindow: 60,
      }

      expect(() => new LLMService(config)).toThrow('Anthropic API key is required')
    })

    it('should initialize successfully with valid config', () => {
      const config: LLMServiceConfig = {
        enabled: true,
        apiKey: 'sk-ant-test-key',
        organizationContext: orgContextPath,
        eventContext: eventContextPath,
        capabilitiesContext: capabilitiesContextPath,
        rateLimitPerUser: 10,
        rateLimitUserWindow: 60,
        rateLimitGlobal: 100,
        rateLimitGlobalWindow: 60,
      }

      const service = new LLMService(config)
      expect(service.isEnabled()).toBe(true)
    })

    it('should handle missing context files gracefully', () => {
      const config: LLMServiceConfig = {
        enabled: true,
        apiKey: 'sk-ant-test-key',
        organizationContext: '/nonexistent/file.md',
        rateLimitPerUser: 10,
        rateLimitUserWindow: 60,
        rateLimitGlobal: 100,
        rateLimitGlobalWindow: 60,
      }

      // Should not throw - just logs warning
      const service = new LLMService(config)
      expect(service.isEnabled()).toBe(true)
    })
  })

  describe('Rate Limiting', () => {
    let service: LLMService

    beforeEach(() => {
      const config: LLMServiceConfig = {
        enabled: true,
        apiKey: 'sk-ant-test-key',
        rateLimitPerUser: 3,
        rateLimitUserWindow: 1, // 1 second window for fast tests
        rateLimitGlobal: 5,
        rateLimitGlobalWindow: 1,
      }
      service = new LLMService(config)
    })

    it('should allow requests within rate limit', () => {
      const stats = service.getRateLimitStats('user-1')
      expect(stats.requestsRemaining).toBe(3)
    })

    it('should track rate limit stats per user', async () => {
      // Mock the LLM to avoid actual API calls
      const mockGenerateResponse = jest.fn().mockResolvedValue('Test response')
      ;(service as any).llm = { invoke: mockGenerateResponse }

      await service.generateResponse('user-1', 'Test message 1')
      const stats = service.getRateLimitStats('user-1')
      expect(stats.requestsRemaining).toBe(2)
    })

    it('should return rate limit error when exceeded', async () => {
      const mockGenerateResponse = jest.fn().mockResolvedValue('Test response')
      ;(service as any).llm = { invoke: mockGenerateResponse }

      // Exhaust rate limit
      await service.generateResponse('user-1', 'Message 1')
      await service.generateResponse('user-1', 'Message 2')
      await service.generateResponse('user-1', 'Message 3')

      // Should be rate limited
      const response = await service.generateResponse('user-1', 'Message 4')
      expect(response).toContain('Rate limit exceeded')
      expect(response).toContain('3 messages per 1 seconds')
    })

    it('should enforce global rate limit', async () => {
      const mockGenerateResponse = jest.fn().mockResolvedValue('Test response')
      ;(service as any).llm = { invoke: mockGenerateResponse }

      // Exhaust global rate limit with different users
      await service.generateResponse('user-1', 'Message 1')
      await service.generateResponse('user-2', 'Message 2')
      await service.generateResponse('user-3', 'Message 3')
      await service.generateResponse('user-4', 'Message 4')
      await service.generateResponse('user-5', 'Message 5')

      // Should be globally rate limited
      const response = await service.generateResponse('user-6', 'Message 6')
      expect(response).toContain('Service is currently busy')
    })

    it('should reset rate limits after time window', async () => {
      const mockGenerateResponse = jest.fn().mockResolvedValue('Test response')
      ;(service as any).llm = { invoke: mockGenerateResponse }

      // Use up rate limit
      await service.generateResponse('user-1', 'Message 1')
      await service.generateResponse('user-1', 'Message 2')
      await service.generateResponse('user-1', 'Message 3')

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 1100))

      // Should be able to make request again
      const response = await service.generateResponse('user-1', 'Message 4')
      expect(response).not.toContain('Rate limit exceeded')
    })

    it('should clear user rate limits', async () => {
      const mockGenerateResponse = jest.fn().mockResolvedValue('Test response')
      ;(service as any).llm = { invoke: mockGenerateResponse }

      // Use up rate limit
      await service.generateResponse('user-1', 'Message 1')
      await service.generateResponse('user-1', 'Message 2')
      await service.generateResponse('user-1', 'Message 3')

      // Clear rate limit
      service.clearUserRateLimit('user-1')

      // Should be able to make request
      const stats = service.getRateLimitStats('user-1')
      expect(stats.requestsRemaining).toBe(3)
    })

    it('should clear all rate limits', () => {
      service.clearAllRateLimits()
      const stats = service.getRateLimitStats('user-1')
      expect(stats.requestsRemaining).toBe(3)
    })
  })

  describe('Error Handling', () => {
    let service: LLMService

    beforeEach(() => {
      const config: LLMServiceConfig = {
        enabled: true,
        apiKey: 'sk-ant-test-key',
        rateLimitPerUser: 10,
        rateLimitUserWindow: 60,
        rateLimitGlobal: 100,
        rateLimitGlobalWindow: 60,
      }
      service = new LLMService(config)
    })

    it('should handle authentication errors', async () => {
      // Mock authentication error
      const mockError = new Error('authentication failed')
      ;(service as any).llm = {
        invoke: jest.fn().mockRejectedValue(mockError),
      }

      const response = await service.generateResponse('user-1', 'Test message')
      expect(response).toContain('authentication error')
    })

    it('should handle generic errors', async () => {
      // Mock generic error
      const mockError = new Error('Network error')
      ;(service as any).llm = {
        invoke: jest.fn().mockRejectedValue(mockError),
      }

      const response = await service.generateResponse('user-1', 'Test message')
      expect(response).toContain('encountered an error')
      expect(response).toContain('https://forms.gle/')
    })
  })

  describe('Response Generation', () => {
    let service: LLMService

    beforeEach(() => {
      const config: LLMServiceConfig = {
        enabled: true,
        apiKey: 'sk-ant-test-key',
        organizationContext: orgContextPath,
        eventContext: eventContextPath,
        capabilitiesContext: capabilitiesContextPath,
        rateLimitPerUser: 10,
        rateLimitUserWindow: 60,
        rateLimitGlobal: 100,
        rateLimitGlobalWindow: 60,
        verbose: true,
      }
      service = new LLMService(config)
    })

    it('should generate response with mocked LLM (string content)', async () => {
      const mockResponse = {
        content: 'This is a test response about the organization.',
      }
      ;(service as any).llm = {
        invoke: jest.fn().mockResolvedValue(mockResponse),
      }

      const response = await service.generateResponse('user-1', 'Tell me about the organization')
      expect(response).toBe('This is a test response about the organization.')
    })

    it('should generate response with mocked LLM (array content blocks)', async () => {
      // LangChain can return content as an array of content blocks
      const mockResponse = {
        content: [
          { type: 'text', text: 'This is a test response ' },
          { type: 'text', text: 'with multiple text blocks.' },
        ],
      }
      ;(service as any).llm = {
        invoke: jest.fn().mockResolvedValue(mockResponse),
      }

      const response = await service.generateResponse('user-1', 'Tell me about the organization')
      expect(response).toBe('This is a test response with multiple text blocks.')
    })

    it('should filter non-text content blocks from response', async () => {
      // Response might include non-text blocks that should be filtered out
      const mockResponse = {
        content: [
          { type: 'text', text: 'Hello!' },
          { type: 'image', source: { data: 'base64...' } }, // Should be filtered
          { type: 'text', text: ' How can I help?' },
        ],
      }
      ;(service as any).llm = {
        invoke: jest.fn().mockResolvedValue(mockResponse),
      }

      const response = await service.generateResponse('user-1', 'Hi')
      expect(response).toBe('Hello! How can I help?')
    })

    it('should include context in system prompt', async () => {
      let capturedMessages: any[] = []
      ;(service as any).llm = {
        invoke: jest.fn().mockImplementation((messages) => {
          capturedMessages = messages
          return Promise.resolve({ content: 'Test response' })
        }),
      }

      await service.generateResponse('user-1', 'Test question')

      // System message should include context
      const systemMessage = capturedMessages.find((m: any) => m._getType() === 'system')
      expect(systemMessage).toBeDefined()
      expect(systemMessage.content).toContain('Test Organization')
      expect(systemMessage.content).toContain('Test Event')
      expect(systemMessage.content).toContain('Test App')
    })
  })
})
