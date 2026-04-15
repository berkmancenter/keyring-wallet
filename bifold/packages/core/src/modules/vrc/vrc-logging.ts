import { Agent } from '@credo-ts/core'
import { bifoldLoggerInstance } from '../../services/bifoldLogger'

// VRC Debug logging flag - enable with environment variable or by setting this to true
const VRC_DEBUG = process.env.VRC_DEBUG === 'true' || false

/**
 * Context for VRC logger instances
 */
export interface VrcLoggerContext {
  module: string // e.g., 'vrc'
  side?: 'INVITER' | 'RECEIVER' // Optional: for protocol flows
  component?: string // Optional: component/file name for additional context
}

/**
 * VRC Logger class that provides context-aware logging
 * Works with or without an Agent instance
 */
export class VrcLogger {
  private agent: Agent | null
  private context: VrcLoggerContext

  constructor(agent: Agent | null, context: VrcLoggerContext) {
    this.agent = agent
    this.context = context
  }

  /**
   * Formats a log message with context information
   */
  private formatMessage(message: string): string {
    const parts = [`[${this.context.module.toUpperCase()}]`]
    if (this.context.side) {
      parts.push(`[${this.context.side}]`)
    }
    if (this.context.component) {
      parts.push(`[${this.context.component}]`)
    }
    return `${parts.join(' ')} ${message}`
  }

  /**
   * Log a debug message
   * Only logs when VRC_DEBUG is enabled and Agent is available
   */
  debug(message: string, data?: any) {
    const formattedMsg = this.formatMessage(message)
    if (this.agent && VRC_DEBUG) {
      if (data !== undefined) {
        this.agent.config.logger.debug(formattedMsg, data)
      } else {
        this.agent.config.logger.debug(formattedMsg)
      }
    } else if (!this.agent && VRC_DEBUG) {
      // Fallback to bifoldLoggerInstance when no Agent available
      bifoldLoggerInstance.debug(formattedMsg, data)
    }
  }

  /**
   * Log an info message
   */
  info(message: string, data?: any) {
    const formattedMsg = this.formatMessage(message)
    if (this.agent) {
      if (data !== undefined) {
        this.agent.config.logger.info(formattedMsg, data)
      } else {
        this.agent.config.logger.info(formattedMsg)
      }
    } else {
      // Fallback to bifoldLoggerInstance when no Agent available
      bifoldLoggerInstance.info(formattedMsg, data)
    }
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: any) {
    const formattedMsg = this.formatMessage(message)
    if (this.agent) {
      if (data !== undefined) {
        this.agent.config.logger.warn(formattedMsg, data)
      } else {
        this.agent.config.logger.warn(formattedMsg)
      }
    } else {
      // Fallback to bifoldLoggerInstance when no Agent available
      bifoldLoggerInstance.warn(formattedMsg, data)
    }
  }

  /**
   * Log an error message
   */
  error(message: string, error?: any) {
    const formattedMsg = this.formatMessage(message)
    if (this.agent) {
      if (error !== undefined) {
        this.agent.config.logger.error(formattedMsg, error)
      } else {
        this.agent.config.logger.error(formattedMsg)
      }
    } else {
      // Fallback to bifoldLoggerInstance when no Agent available
      const errorObj = error instanceof Error ? error : error !== undefined ? new Error(String(error)) : undefined
      if (errorObj) {
        bifoldLoggerInstance.error(formattedMsg, {}, errorObj)
      } else {
        bifoldLoggerInstance.error(formattedMsg, {})
      }
    }
  }
}

/**
 * Factory function to create a VRC logger instance
 *
 * @param agent Agent instance (can be null for components without Agent access)
 * @param context Context information for logging
 * @returns VrcLogger instance
 *
 * @example
 * // With Agent
 * const logger = createVrcLogger(agent, {
 *   module: 'vrc',
 *   side: 'INVITER',
 *   component: 'vrc-manager'
 * })
 *
 * @example
 * // Without Agent (React components, hooks)
 * const logger = createVrcLogger(null, {
 *   module: 'vrc',
 *   component: 'useRCardCredential'
 * })
 */
export const createVrcLogger = (agent: Agent | null, context: VrcLoggerContext): VrcLogger => {
  return new VrcLogger(agent, context)
}
