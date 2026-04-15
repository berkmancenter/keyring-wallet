/**
 * Witness Reconnection Utilities
 *
 * Handles graceful reconnection scenarios when a witness connection is disrupted
 * and the user attempts to reconnect using the same invitation.
 *
 * Uses a proactive check-before-connect approach rather than reactive error handling
 * for more reliable and maintainable reconnection logic.
 */

import { Agent, ConnectionRecord, DidExchangeState, OutOfBandRecord, OutOfBandRole } from '@credo-ts/core'

import { createVrcLogger } from '../vrc-logging'

/**
 * Connection status after checking
 */
export interface ConnectionStatus {
  exists: boolean
  isActive: boolean
  connectionRecord?: ConnectionRecord
  oobRecord?: OutOfBandRecord
}

/**
 * Check the status of an existing connection for a given invitation
 */
export async function checkExistingConnectionStatus(agent: Agent, invitationUrl: string): Promise<ConnectionStatus> {
  const logger = createVrcLogger(null, { module: 'vrc', component: 'WitnessReconnection' })

  try {
    // Parse the invitation to get the invitation ID
    const invitation = await agent.oob.parseInvitation(invitationUrl)

    if (!invitation) {
      return { exists: false, isActive: false }
    }

    // Find existing OOB records with this invitation ID
    const oobRecords = await agent.oob.findAllByQuery({
      invitationId: invitation.id,
      role: OutOfBandRole.Receiver,
    })

    if (!oobRecords || oobRecords.length === 0) {
      return { exists: false, isActive: false }
    }

    // Check each OOB record for associated connections
    for (const oobRecord of oobRecords) {
      // Try to find a connection associated with this OOB record
      const connections = await agent.connections.findAllByQuery({
        outOfBandId: oobRecord.id,
      })

      if (connections && connections.length > 0) {
        const connection = connections[0]

        // Check if connection is in a completed/active state
        const isActive = connection.state === DidExchangeState.Completed

        return {
          exists: true,
          isActive,
          connectionRecord: connection,
          oobRecord,
        }
      }
    }

    // OOB record exists but no connection found
    return {
      exists: true,
      isActive: false,
      oobRecord: oobRecords[0],
    }
  } catch (error) {
    logger.error('Error checking connection status:', error)
    return { exists: false, isActive: false }
  }
}

/**
 * Clean up stale invitation and connection records
 */
export async function cleanupStaleRecords(agent: Agent, invitationUrl: string): Promise<void> {
  const logger = createVrcLogger(null, { module: 'vrc', component: 'WitnessReconnection' })

  try {
    logger.info('Cleaning up stale records...')

    // Parse the invitation to get the invitation ID
    const invitation = await agent.oob.parseInvitation(invitationUrl)

    if (!invitation) {
      logger.warn('Could not parse invitation for cleanup')
      return
    }

    // Find all OOB records with this invitation ID
    const oobRecords = await agent.oob.findAllByQuery({
      invitationId: invitation.id,
      role: OutOfBandRole.Receiver,
    })

    for (const oobRecord of oobRecords) {
      // Find and delete associated connections
      const connections = await agent.connections.findAllByQuery({
        outOfBandId: oobRecord.id,
      })

      for (const connection of connections) {
        try {
          await agent.connections.deleteById(connection.id)
          logger.info('Deleted stale connection:', connection.id)
        } catch (error) {
          logger.warn('Failed to delete connection:', error)
        }
      }

      // Delete the OOB record
      try {
        await agent.oob.deleteById(oobRecord.id)
        logger.info('Deleted stale OOB record:', oobRecord.id)
      } catch (error) {
        logger.warn('Failed to delete OOB record:', error)
      }
    }

    logger.info('Cleanup completed')
  } catch (error) {
    logger.error('Error during cleanup:', error)
    throw error
  }
}

/**
 * Reconnection strategy result
 */
export interface ReconnectionResult {
  success: boolean
  connectionRecord?: ConnectionRecord
  error?: string
  strategy: 'reused' | 'cleaned-retry' | 'failed'
}

/**
 * Handle witness reconnection with graceful error recovery
 *
 * This function implements a proactive check-before-connect strategy:
 * 1. Before each connection attempt, check for existing records
 * 2. If active connection exists, reuse it
 * 3. If stale records exist, clean them up
 * 4. Attempt connection (now safe from duplicate errors)
 * 5. Retry with check-and-cleanup between attempts
 *
 * This approach is more reliable than reactive error handling as it:
 * - Uses stable Credo APIs instead of error message parsing
 * - Provides deterministic behavior
 * - Handles records created by failed connection attempts
 */
export async function handleWitnessReconnection(
  agent: Agent,
  invitationUrl: string,
  maxRetries: number = 1
): Promise<ReconnectionResult> {
  const logger = createVrcLogger(null, { module: 'vrc', component: 'WitnessReconnection' })

  try {
    logger.info('Starting witness connection...')

    let lastError: Error | undefined
    let cleanedUp = false

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      // STEP 1: Check for existing records before EACH connection attempt
      logger.info(`Attempt ${attempt}/${maxRetries + 1}: Checking for existing records...`)
      const existingStatus = await checkExistingConnectionStatus(agent, invitationUrl)

      if (existingStatus.exists) {
        if (existingStatus.isActive && existingStatus.connectionRecord) {
          // Active connection found - reuse it
          logger.info('Found existing active connection, reusing')
          return {
            success: true,
            connectionRecord: existingStatus.connectionRecord,
            strategy: 'reused',
          }
        }

        // Stale records found - clean up before attempting connection
        logger.info('Found stale records, cleaning up before connection attempt...')
        try {
          await cleanupStaleRecords(agent, invitationUrl)
          logger.info('Cleanup completed')
          cleanedUp = true
        } catch (cleanupError) {
          logger.error('Cleanup failed:', cleanupError)
          return {
            success: false,
            error: `Cleanup failed: ${(cleanupError as Error).message}`,
            strategy: 'failed',
          }
        }
      } else {
        logger.info('No existing records found')
      }

      // STEP 2: Attempt connection
      try {
        logger.info(`Connection attempt ${attempt}/${maxRetries + 1}`)

        const { connectionRecord } = await agent.oob.receiveInvitationFromUrl(invitationUrl)

        if (!connectionRecord) {
          return {
            success: false,
            error: 'Failed to create connection record',
            strategy: 'failed',
          }
        }

        // Wait for connection to complete
        logger.info('Waiting for connection to complete...')
        const connection = await agent.connections.returnWhenIsConnected(connectionRecord.id)

        logger.info('Successfully connected')
        return {
          success: true,
          connectionRecord: connection,
          strategy: cleanedUp ? 'cleaned-retry' : 'reused',
        }
      } catch (error) {
        lastError = error as Error
        logger.error(`Connection attempt ${attempt} failed:`, error)

        if (attempt < maxRetries + 1) {
          logger.info('Will check and retry...')
          // Small delay before next attempt
          await new Promise((resolve) => setTimeout(resolve, 1000))
          // Loop will continue and check-and-cleanup will run before next attempt
        }
      }
    }

    // All retries exhausted
    return {
      success: false,
      error: lastError?.message || 'Connection failed after all retry attempts',
      strategy: 'failed',
    }
  } catch (error) {
    logger.error('Unexpected error in reconnection handler:', error)
    return {
      success: false,
      error: (error as Error).message,
      strategy: 'failed',
    }
  }
}
