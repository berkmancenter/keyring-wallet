/**
 * LLM Service - AI-powered responses via LangChain.js + Claude
 *
 * This service provides intelligent responses to user messages using Claude Sonnet,
 * with context from organization, event, and app capabilities files.
 *
 * Features:
 * - Context-aware responses using loaded markdown files
 * - Rate limiting (per-user and global)
 * - Graceful handling of out-of-scope requests
 * - Integration with DIDComm messaging
 */

import { ChatAnthropic } from '@langchain/anthropic'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { readFileSync, existsSync } from 'fs'
import { WitnessServerConfig } from './config'

/**
 * Rate limiter bucket for tracking request counts
 */
interface RateLimitBucket {
  count: number
  resetTime: number
}

/**
 * LLM Service Configuration
 */
export interface LLMServiceConfig {
  enabled: boolean
  apiKey: string
  baseUrl?: string
  model?: string
  maxTokens?: number
  temperature?: number
  organizationContext?: string
  eventContext?: string
  capabilitiesContext?: string
  rateLimitPerUser: number
  rateLimitUserWindow: number
  rateLimitGlobal: number
  rateLimitGlobalWindow: number
  verbose?: boolean
}

/**
 * Service for handling AI-powered responses via LangChain.js
 */
export class LLMService {
  private readonly config: LLMServiceConfig
  private readonly llm: ChatAnthropic
  private readonly systemPrompt: string
  private readonly userRateLimits: Map<string, RateLimitBucket> = new Map()
  private globalRateLimit: RateLimitBucket = { count: 0, resetTime: 0 }
  private readonly feedbackFormUrl = 'https://forms.gle/KWEDvvmDUVSMz4VK9'

  constructor(config: LLMServiceConfig) {
    this.config = config

    if (!config.enabled) {
      throw new Error('LLM service is not enabled')
    }

    if (!config.apiKey) {
      throw new Error('Anthropic API key is required when LLM is enabled')
    }

    // Default model is Claude Sonnet 4.6
    const defaultModel = 'claude-sonnet-4-20250514'
    // Default max tokens for very short mobile chat responses
    const defaultMaxTokens = 100
    // Default model temperature
    const defaultTemperature = 0.7

    // Initialize Claude via LangChain
    // Note: We avoid setting temperature/topP defaults as some models (e.g., via proxy)
    // may not support these parameters and LangChain may set invalid default values.
    // We use modelKwargs to pass parameters directly without LangChain's defaults.
    const llmConfig: ConstructorParameters<typeof ChatAnthropic>[0] = {
      anthropicApiKey: config.apiKey,
      model: config.model || defaultModel,
      maxTokens: config.maxTokens || defaultMaxTokens,
      temperature: config.temperature || defaultTemperature,
    }

    // Add custom base URL if provided (e.g., for proxy usage)
    if (config.baseUrl) {
      llmConfig.anthropicApiUrl = config.baseUrl
    }

    this.llm = new ChatAnthropic(llmConfig)

    // Load context files and build system prompt
    this.systemPrompt = this.buildSystemPrompt()

    if (config.verbose) {
      console.log(`[LLMService] Initialized with model: ${config.model || defaultModel}`)
      console.log(
        `[LLMService] Rate limits: ${config.rateLimitPerUser}/${config.rateLimitUserWindow}s per user, ${config.rateLimitGlobal}/${config.rateLimitGlobalWindow}s global`
      )
    }
  }

  /**
   * Build the system prompt from context files
   */
  private buildSystemPrompt(): string {
    const organizationContext = this.loadContextFile(this.config.organizationContext, 'Organization/Witness')
    const eventContext = this.loadContextFile(this.config.eventContext, 'Event')
    const capabilitiesContext = this.loadContextFile(this.config.capabilitiesContext, 'App Capabilities')

    return `You are a helpful AI assistant in a mobile chat app. Your role is to answer questions about the event, the hosting organization, and the app's capabilities.

## CONTEXT

${organizationContext}

${eventContext}

${capabilitiesContext}

## RULES

1. **Scope**: ONLY answer about the event, organization, or app features (credentials, witness, DIDComm).

2. **Out-of-scope**: Politely decline and suggest: ${this.feedbackFormUrl}

3. **VERY SHORT RESPONSES**: Think TEXT MESSAGE, not email. Mobile chat only!
   - Maximum 1-3 sentences per response
   - Use abbreviations if natural (e.g., "u" for "you", "info" for "information")
   - One short paragraph at most
   - Skip pleasantries and get to the point

4. **Tone**: Friendly, casual, helpful. Like chatting with a helpful event staff member.

5. **No markdown or formatting**. Emojis are fine.

6. **If unsure**: Keep it brief - "Not sure about that. Send feedback: ${this.feedbackFormUrl}"

7. **Chat History**: If the user asks you to recall, repeat, continue, or build on a previous message (e.g., "tell me more", "what did you say before", "continue from that", "remember what I asked", "earlier you mentioned"), inform them that NO chat history is stored - each conversation starts fresh for privacy reasons. Keep it brief, e.g., "I don't have access to previous messages - each chat is private and temporary."

Short and sweet!`
  }

  /**
   * Load a context file and format it for the system prompt
   */
  private loadContextFile(filePath: string | undefined, label: string): string {
    if (!filePath) {
      return `### ${label} Context\n\n(No context file provided - use general knowledge carefully)`
    }

    if (!existsSync(filePath)) {
      console.warn(`[LLMService] Context file not found: ${filePath}`)
      return `### ${label} Context\n\n(Context file not found: ${filePath})`
    }

    try {
      const content = readFileSync(filePath, 'utf-8')
      return `### ${label} Context\n\n${content}`
    } catch (error) {
      console.error(`[LLMService] Failed to load context file ${filePath}:`, error)
      return `### ${label} Context\n\n(Failed to load context file)`
    }
  }

  /**
   * Check if a user is rate limited
   */
  private checkUserRateLimit(userId: string): { allowed: boolean; error?: string } {
    const now = Date.now()
    const userBucket = this.userRateLimits.get(userId)

    if (!userBucket || now > userBucket.resetTime) {
      // Create new bucket or reset expired one
      this.userRateLimits.set(userId, {
        count: 1,
        resetTime: now + this.config.rateLimitUserWindow * 1000,
      })
      return { allowed: true }
    }

    if (userBucket.count >= this.config.rateLimitPerUser) {
      const waitSeconds = Math.ceil((userBucket.resetTime - now) / 1000)
      return {
        allowed: false,
        error: `Rate limit exceeded. You can send ${this.config.rateLimitPerUser} messages per ${this.config.rateLimitUserWindow} seconds. Please wait ${waitSeconds} seconds.`,
      }
    }

    userBucket.count++
    return { allowed: true }
  }

  /**
   * Check global rate limit
   */
  private checkGlobalRateLimit(): { allowed: boolean; error?: string } {
    const now = Date.now()

    if (now > this.globalRateLimit.resetTime) {
      // Reset expired bucket
      this.globalRateLimit = {
        count: 1,
        resetTime: now + this.config.rateLimitGlobalWindow * 1000,
      }
      return { allowed: true }
    }

    if (this.globalRateLimit.count >= this.config.rateLimitGlobal) {
      const waitSeconds = Math.ceil((this.globalRateLimit.resetTime - now) / 1000)
      return {
        allowed: false,
        error: `Service is currently busy. Please try again in ${waitSeconds} seconds.`,
      }
    }

    this.globalRateLimit.count++
    return { allowed: true }
  }

  /**
   * Generate a response to a user message
   *
   * @param userId - Unique identifier for the user (e.g., DID or connection ID)
   * @param message - The user's message
   * @returns AI-generated response
   */
  public async generateResponse(userId: string, message: string): Promise<string> {
    // Check rate limits
    const userLimit = this.checkUserRateLimit(userId)
    if (!userLimit.allowed) {
      return userLimit.error || 'Rate limit exceeded'
    }

    const globalLimit = this.checkGlobalRateLimit()
    if (!globalLimit.allowed) {
      return globalLimit.error || 'Service is currently busy'
    }

    try {
      // Generate response using Claude
      const messages = [new SystemMessage(this.systemPrompt), new HumanMessage(message)]

      if (this.config.verbose) {
        console.log(`[LLMService] Generating response for user ${userId.substring(0, 20)}...`)
        console.log(`[LLMService] Message: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`)
      }

      const response = await this.llm.invoke(messages)

      // Debug: Log the full response structure to diagnose issues (verbose mode only)
      if (this.config.verbose) {
        console.log(`[LLMService] RAW RESPONSE TYPE: ${typeof response}`)
        console.log(`[LLMService] RAW RESPONSE KEYS: ${Object.keys(response).join(', ')}`)
        console.log(`[LLMService] response.content TYPE: ${typeof response.content}`)
        console.log(`[LLMService] response.content IS_ARRAY: ${Array.isArray(response.content)}`)
        console.log(`[LLMService] response.content VALUE: ${JSON.stringify(response.content, null, 2)}`)
      }

      // Extract text content from response
      // LangChain's response.content can be a string or an array of content blocks
      let content: string
      if (typeof response.content === 'string') {
        if (this.config.verbose) {
          console.log(`[LLMService] Extracting as string`)
        }
        content = response.content
      } else if (Array.isArray(response.content)) {
        if (this.config.verbose) {
          console.log(`[LLMService] Extracting as array, length: ${response.content.length}`)
        }
        // Extract text from content blocks, filtering out non-text blocks
        content = response.content
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map((block) => block.text)
          .join('')
        if (this.config.verbose) {
          console.log(`[LLMService] Extracted text length: ${content.length}`)
        }
      } else {
        // Fallback for unexpected content types
        if (this.config.verbose) {
          console.log(`[LLMService] Using fallback String() conversion`)
        }
        content = String(response.content)
      }

      if (this.config.verbose) {
        console.log(
          `[LLMService] FINAL CONTENT TO SEND: "${content.substring(0, 200)}${content.length > 200 ? '...' : ''}"`
        )
      }

      if (this.config.verbose) {
        console.log(`[LLMService] Response: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`)
      }

      return content
    } catch (error) {
      console.error('[LLMService] Error generating response:', error)

      // Check if it's an API key error
      if (error instanceof Error && error.message.includes('authentication')) {
        return 'Sorry, there was an authentication error with the AI service. Please contact support.'
      }

      // Generic fallback response
      return `Sorry, I encountered an error processing your message. If you have feedback about the Keyring, please share it here: ${this.feedbackFormUrl}`
    }
  }

  /**
   * Check if the service is enabled
   */
  public isEnabled(): boolean {
    return this.config.enabled
  }

  /**
   * Get current rate limit stats for a user
   */
  public getRateLimitStats(userId: string): {
    requestsRemaining: number
    resetIn: number
  } {
    const now = Date.now()
    const userBucket = this.userRateLimits.get(userId)

    if (!userBucket || now > userBucket.resetTime) {
      return {
        requestsRemaining: this.config.rateLimitPerUser,
        resetIn: this.config.rateLimitUserWindow,
      }
    }

    return {
      requestsRemaining: Math.max(0, this.config.rateLimitPerUser - userBucket.count),
      resetIn: Math.ceil((userBucket.resetTime - now) / 1000),
    }
  }

  /**
   * Clear rate limit for a user (for testing/admin purposes)
   */
  public clearUserRateLimit(userId: string): void {
    this.userRateLimits.delete(userId)
  }

  /**
   * Clear all rate limits (for testing/admin purposes)
   */
  public clearAllRateLimits(): void {
    this.userRateLimits.clear()
    this.globalRateLimit = { count: 0, resetTime: 0 }
  }
}

/**
 * Create LLM service from witness server config
 */
export function createLLMService(config: WitnessServerConfig): LLMService | null {
  if (!config.llmEnabled) {
    return null
  }

  const llmConfig: LLMServiceConfig = {
    enabled: config.llmEnabled,
    apiKey: config.anthropicApiKey || '',
    baseUrl: config.anthropicBaseUrl,
    model: config.anthropicModel,
    maxTokens: config.anthropicMaxTokens,
    temperature: config.anthropicTemperature,
    organizationContext: config.llmContextOrganization,
    eventContext: config.llmContextEvent,
    capabilitiesContext: config.llmContextCapabilities,
    rateLimitPerUser: config.llmRateLimitPerUser,
    rateLimitUserWindow: config.llmRateLimitUserWindow,
    rateLimitGlobal: config.llmRateLimitGlobal,
    rateLimitGlobalWindow: config.llmRateLimitGlobalWindow,
    verbose: config.verbose,
  }

  return new LLMService(llmConfig)
}
