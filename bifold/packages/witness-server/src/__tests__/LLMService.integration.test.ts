/**
 * Integration tests for LLMService - verifies actual LLM responses
 * 
 * These tests require WITNESS_ANTHROPIC_API_KEY to be set in the environment.
 * They validate that the LLM produces appropriately short responses for mobile chat.
 * 
 * Run with: yarn test -- LLMService.integration
 */

import { LLMService, LLMServiceConfig } from '../LLMService'
import { join } from 'path'

describe('LLMService Integration Tests', () => {
  const apiKey = process.env.WITNESS_ANTHROPIC_API_KEY

  // Use example context files for realistic testing
  const examplesDir = join(__dirname, '../../examples')

  const createService = (maxTokens: number = 100) => {
    const config: LLMServiceConfig = {
      enabled: true,
      apiKey: apiKey!,
      organizationContext: join(examplesDir, 'organization-context.md'),
      eventContext: join(examplesDir, 'event-context.md'),
      capabilitiesContext: join(examplesDir, 'app-capabilities.md'),
      rateLimitPerUser: 100,
      rateLimitUserWindow: 60,
      rateLimitGlobal: 1000,
      rateLimitGlobalWindow: 60,
      maxTokens,
    }
    return new LLMService(config)
  }

  const expectShortResponse = (response: string, testName: string, maxWords: number = 80) => {
    const wordCount = response.split(/\s+/).filter(Boolean).length
    // Mobile chat responses should be short
    expect(wordCount).toBeLessThanOrEqual(maxWords)
    console.log(`[${testName}] Response (${wordCount} words): "${response.substring(0, 100)}..."`)
  }

  // Skip all tests if no API key is available
  const describeOrSkip = apiKey ? describe : describe.skip

  describeOrSkip('Mobile Chat Response Length Validation', () => {
    it('should generate short responses for event questions', async () => {
      const service = createService()

      const response = await service.generateResponse(
        'integration-test-user',
        'What is this event about?'
      )

      expectShortResponse(response, 'event-question')
    })

    it('should generate short responses for app feature questions', async () => {
      const service = createService()

      const response = await service.generateResponse(
        'integration-test-user',
        'How do I get a credential?'
      )

      expectShortResponse(response, 'app-question')
    })

    it('should generate short responses for organization questions', async () => {
      const service = createService()

      const response = await service.generateResponse(
        'integration-test-user',
        'Who is hosting this event?'
      )

      expectShortResponse(response, 'org-question')
    })

    it('should handle out-of-scope questions with brief response', async () => {
      const service = createService()

      const response = await service.generateResponse(
        'integration-test-user',
        'What is the weather like today?'
      )

      // Out of scope should still be short and suggest feedback
      expectShortResponse(response, 'out-of-scope')
      expect(response.toLowerCase()).toContain('feedback')
    })
  })
})
