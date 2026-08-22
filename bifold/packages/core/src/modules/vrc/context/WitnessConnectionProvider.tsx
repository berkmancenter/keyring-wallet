/**
 * WitnessConnectionProvider - React Context for Witness Connection Management
 *
 * Manages the list of all witness connections and which one is currently active.
 * Witnesses are identified by the `witness-announcement` DIDComm message they
 * send upon connection - no mDNS discovery is needed.
 *
 * Connections to witnesses happen through normal QR code scanning or deep links,
 * just like any other contact. The witness server sends a `witness-announcement`
 * basic message on connection, which is detected by vrc-manager and triggers
 * `handleWitnessAnnouncement` here.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Agent } from '@credo-ts/core'
import { PeerDidNumAlgo } from '@credo-ts/core'
import { DidCommConnectionRepository, DidCommDidExchangeState } from '@credo-ts/didcomm'
import { Platform } from 'react-native'

import {
  registerWitnessSessionCallback,
  registerWitnessStateGetter,
  registerWitnessConnectionDetectedCallback,
  registerWitnessValidationCallback,
} from '../vrc-manager'
import { queryWitnessDiscovery, getWitnessLocalityRequirement } from '../../trust-tasks/ceremony'
import { createVrcLogger } from '../vrc-logging'
import { useStore } from '../../../contexts/store'
import { DispatchAction } from '../../../contexts/reducers/store'

/**
 * Connected witness information (simplified - no mDNS fields)
 */
export interface ConnectedWitness {
  /** Witness name (from announcement) */
  name: string
  /** Event name (if configured on witness server) */
  eventName?: string
  /** Witness issuer DID */
  issuerDid: string
  /** DIDComm connection ID */
  connectionId: string
  /** When the connection was established */
  connectedAt: Date
}

/**
 * Active witness session information
 */
export interface WitnessSession {
  /** Session ID */
  sessionId: string
  /** Session challenge */
  challenge: string
  /** Session domain */
  domain: string
  /** When the session was created */
  createdAt: Date
}

/**
 * A witness-connect pre-flight prompt awaiting the user's decision
 * (locality-plan.md §8.4 row 2, §10.3 item 8). `required` is `false` unless
 * the witness's discovery answer confirmed it within the short wait
 * `handleWitnessAnnouncement` gives it — an unresolved-in-time answer fails
 * open to "not required" rather than blocking the sheet indefinitely.
 */
export interface LocalityPreflightPrompt {
  witness: ConnectedWitness
  required: boolean
}

/**
 * Witness connection state (for vrc-manager backward compatibility)
 */
export interface WitnessConnectionState {
  /** Currently active witness (= connectedWitness for backward compat) */
  connectedWitness?: ConnectedWitness
  /** Active session (when received from witness) */
  activeSession?: WitnessSession
  /**
   * The stable reporting DID for the active witness connection.
   * Present only when reporting is enabled and a DID has been generated.
   */
  reportingDid?: string
}

/**
 * Witness connection context value
 */
export interface WitnessConnectionContextValue {
  /** All known witness connections */
  allWitnessConnections: ConnectedWitness[]
  /** The currently active witness (alias: connectedWitness for backward compat) */
  connectedWitness: ConnectedWitness | undefined
  /** Active witness session (when in a witnessed exchange) */
  activeSession: WitnessSession | undefined
  /** Set a witness as the active one (only one active at a time) */
  setActiveWitness: (connectionId: string) => void
  /** Remove a witness connection completely (clears metadata + removes from list) */
  removeWitness: (connectionId: string) => Promise<void>
  /** Deactivate the current active witness (does not remove the connection) */
  disconnectWitness: () => void
  /** Check if any witness is currently active */
  isWitnessConnected: () => boolean
  /** Recently auto-activated witness notification (cleared after display) */
  recentlyAutoActivatedWitness: ConnectedWitness | undefined
  /** Clear the auto-activated notification once displayed */
  clearAutoActivatedNotification: () => void
  /** Set active session (called when session-challenge received via DIDComm) */
  setActiveSession: (session: WitnessSession) => void
  /** Clear active session */
  clearActiveSession: () => void
  /** Get current connection state (for vrc-manager) */
  getState: () => WitnessConnectionState
  /** Validate that the active witness connection is still valid */
  validateWitnessConnection: () => Promise<boolean>
  /** A pending witness-connect pre-flight prompt (§10.3 item 8), or undefined when none is due */
  localityPreflight: LocalityPreflightPrompt | undefined
  /** Resolve the pending prompt: true = the user allowed locality for this install, false = declined */
  resolveLocalityPreflight: (allow: boolean) => void
}

/**
 * Witness connection context
 */
const WitnessConnectionContext = createContext<WitnessConnectionContextValue | undefined>(undefined)

/**
 * Provider props
 */
export interface WitnessConnectionProviderProps {
  children: React.ReactNode
  /** Credo agent instance */
  agent: Agent
}

/** How long the pre-flight prompt waits for the witness's discovery answer before failing open to "not required". */
const LOCALITY_REQUIREMENT_WAIT_MS = 5000
const LOCALITY_REQUIREMENT_POLL_MS = 250

/**
 * Poll `getWitnessLocalityRequirement` for a bounded window rather than
 * showing the pre-flight sheet immediately on a bare `null` (not-yet-known) —
 * the discovery round trip is normally fast, and item 8's own "Done when"
 * is specifically that a `required` answer drives the sheet's copy, not
 * just its existence. Failing open to `false` after the window keeps this
 * from blocking the sheet indefinitely on a slow or silent witness.
 */
async function resolveLocalityPreflightRequirement(agent: Agent, witnessConnectionId: string): Promise<boolean> {
  const deadline = Date.now() + LOCALITY_REQUIREMENT_WAIT_MS
  for (;;) {
    const required = await getWitnessLocalityRequirement(agent, witnessConnectionId)
    if (required !== null) return required
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, LOCALITY_REQUIREMENT_POLL_MS))
  }
}

/**
 * WitnessConnectionProvider - Manages witness connection list and active selection
 */
export const WitnessConnectionProvider: React.FC<WitnessConnectionProviderProps> = ({ children, agent }) => {
  const [store, dispatch] = useStore()
  const [allWitnessConnections, setAllWitnessConnections] = useState<ConnectedWitness[]>([])
  const [activeWitnessConnectionId, setActiveWitnessConnectionId] = useState<string | undefined>(
    (store as any).witness?.activeWitnessConnectionId
  )
  const [activeSession, setActiveSessionState] = useState<WitnessSession | undefined>(undefined)
  const [recentlyAutoActivatedWitness, setRecentlyAutoActivatedWitness] = useState<ConnectedWitness | undefined>(
    undefined
  )
  const [localityPreflight, setLocalityPreflight] = useState<LocalityPreflightPrompt | undefined>(undefined)

  const logger = useRef(createVrcLogger(null, { module: 'vrc', component: 'WitnessConnection' }))

  // Keep a ref for use in callbacks (avoids stale closures)
  const allWitnessConnectionsRef = useRef<ConnectedWitness[]>([])
  const activeWitnessConnectionIdRef = useRef<string | undefined>(activeWitnessConnectionId)
  const activeSessionRef = useRef<WitnessSession | undefined>(undefined)
  // Keep a ref to the store's witness settings so we can read them from async callbacks
  const witnessStoreRef = useRef(store.witness)
  // Same reason: handleWitnessAnnouncement reads the locality preference and
  // the one-shot "already seen" flag from inside an async callback.
  const preferencesRef = useRef(store.preferences)
  // Guards against two witness connections in quick succession both
  // scheduling a locality pre-flight prompt before either resolves.
  const localityPreflightPendingRef = useRef(false)

  // Sync refs when state changes
  useEffect(() => {
    witnessStoreRef.current = store.witness
  }, [store.witness])

  useEffect(() => {
    preferencesRef.current = store.preferences
  }, [store.preferences])

  useEffect(() => {
    allWitnessConnectionsRef.current = allWitnessConnections
  }, [allWitnessConnections])

  useEffect(() => {
    activeWitnessConnectionIdRef.current = activeWitnessConnectionId
  }, [activeWitnessConnectionId])

  useEffect(() => {
    activeSessionRef.current = activeSession
  }, [activeSession])

  /**
   * Compute the active ConnectedWitness from the list
   */
  const activeWitness = allWitnessConnections.find((w) => w.connectionId === activeWitnessConnectionId)

  /**
   * Persist the active witness connection ID to the store
   */
  const persistActiveWitnessId = useCallback(
    (connectionId: string | undefined) => {
      dispatch({
        type: DispatchAction.UPDATE_WITNESS_SETTINGS,
        payload: [{ activeWitnessConnectionId: connectionId }],
      })
    },
    [dispatch]
  )

  /**
   * Set a witness as the active one (only one active at a time)
   */
  const setActiveWitness = useCallback(
    (connectionId: string) => {
      logger.current.info(`Setting active witness: ${connectionId}`)
      setActiveWitnessConnectionId(connectionId)
      persistActiveWitnessId(connectionId)
    },
    [persistActiveWitnessId]
  )

  /**
   * Remove a witness connection: deletes the underlying DIDComm connection (and OOB
   * record) so it disappears from Contacts too, then removes it from the witness list.
   */
  const removeWitness = useCallback(
    async (connectionId: string) => {
      logger.current.info(`Removing witness connection: ${connectionId}`)

      try {
        // Grab the outOfBandId before deleting so we can clean up the OOB record too
        const connection = await agent.modules.didcomm.connections.getById(connectionId)
        const outOfBandId = connection?.outOfBandId

        // Delete the DIDComm connection (this also removes it from Contacts)
        await agent.modules.didcomm.connections.deleteById(connectionId)
        logger.current.info('Deleted DIDComm connection')

        // Clean up the associated OOB record to prevent duplicate-invitation errors
        if (outOfBandId) {
          try {
            await agent.modules.didcomm.oob.deleteById(outOfBandId)
            logger.current.info('Deleted associated OOB record')
          } catch {
            // OOB record may already be gone — not a fatal error
          }
        }
      } catch (error) {
        logger.current.error('Error deleting witness connection:', error)
      }

      // Remove from the in-memory witness list
      setAllWitnessConnections((prev) => prev.filter((w) => w.connectionId !== connectionId))

      // If this was the active witness, deactivate
      if (activeWitnessConnectionIdRef.current === connectionId) {
        setActiveWitnessConnectionId(undefined)
        persistActiveWitnessId(undefined)
        logger.current.info('Cleared active witness (was removed)')
      }
    },
    [agent, persistActiveWitnessId]
  )

  /**
   * Deactivate the current active witness (does not remove the connection)
   */
  const disconnectWitness = useCallback(() => {
    logger.current.info('Deactivating active witness')
    setActiveWitnessConnectionId(undefined)
    persistActiveWitnessId(undefined)
  }, [persistActiveWitnessId])

  /**
   * Check if any witness is currently active
   */
  const isWitnessConnected = useCallback((): boolean => {
    return !!activeWitnessConnectionIdRef.current
  }, [])

  /**
   * Clear the auto-activated notification once displayed
   */
  const clearAutoActivatedNotification = useCallback(() => {
    setRecentlyAutoActivatedWitness(undefined)
  }, [])

  /**
   * Set active session (called when session-challenge received via DIDComm)
   */
  const setActiveSession = useCallback((session: WitnessSession) => {
    logger.current.info('Setting active session:', session.sessionId)
    setActiveSessionState(session)
  }, [])

  /**
   * Clear active session
   */
  const clearActiveSession = useCallback(() => {
    logger.current.info('Clearing active session')
    setActiveSessionState(undefined)
  }, [])

  /**
   * Get current state (for vrc-manager backward compatibility)
   * Returns active witness as connectedWitness.
   * Also exposes reportingDid for the active witness when reporting is enabled.
   */
  const getState = useCallback((): WitnessConnectionState => {
    const activeId = activeWitnessConnectionIdRef.current
    const activeW = allWitnessConnectionsRef.current.find((w) => w.connectionId === activeId)
    const settings = witnessStoreRef.current
    const reportingDid =
      activeId && settings?.enableReporting
        ? settings?.reportingDids?.[activeId]
        : undefined
    return {
      connectedWitness: activeW,
      activeSession: activeSessionRef.current,
      reportingDid,
    }
  }, [])

  /**
   * Validate that the active witness connection is still valid
   */
  const validateWitnessConnection = useCallback(async (): Promise<boolean> => {
    const activeId = activeWitnessConnectionIdRef.current
    if (!activeId) {
      return false
    }

    try {
      const connection = await agent.modules.didcomm.connections.getById(activeId)
      if (connection && connection.state === DidCommDidExchangeState.Completed) {
        return true
      }
      // Connection is stale - deactivate
      logger.current.warn(`Active witness connection ${activeId} is stale, deactivating`)
      setActiveWitnessConnectionId(undefined)
      persistActiveWitnessId(undefined)
      return false
    } catch (_error) {
      logger.current.warn(`Active witness connection ${activeId} not found, deactivating`)
      setActiveWitnessConnectionId(undefined)
      persistActiveWitnessId(undefined)
      return false
    }
  }, [agent, persistActiveWitnessId])

  /**
   * Handle witness announcement from a DIDComm connection
   * Called by vrc-manager when a `witness-announcement` message is received.
   * This is how all witness connections are detected, regardless of how the
   * underlying DIDComm connection was established (QR scan, deep link, etc.)
   */
  const handleWitnessAnnouncement = useCallback(
    async (connectionId: string, announcement: { name: string; did: string; eventName?: string | null }) => {
      logger.current.info(`Handling witness announcement from connection ${connectionId}`)
      logger.current.info(`  Name: ${announcement.name}`)
      logger.current.info(`  DID: ${announcement.did}`)
      logger.current.info(`  Event: ${announcement.eventName || '(none)'}`)

      try {
        // Get the connection
        const connection = await agent.modules.didcomm.connections.getById(connectionId)

        // Store witness metadata on connection for persistence
        connection.metadata.set('witnessConnection', {
          name: announcement.name,
          eventName: announcement.eventName || undefined,
          connectedAt: new Date().toISOString(),
          issuerDid: announcement.did,
        })

        // Persist metadata to ConnectionRecord
        const connectionRepository = agent.dependencyManager.resolve(DidCommConnectionRepository)
        await connectionRepository.update(agent.context, connection)
        logger.current.info('Stored and persisted witness metadata on connection')

        const newWitness: ConnectedWitness = {
          name: announcement.name,
          eventName: announcement.eventName || undefined,
          issuerDid: announcement.did,
          connectionId,
          connectedAt: new Date(),
        }

        // Add to list (or update if already known)
        setAllWitnessConnections((prev) => {
          const existing = prev.findIndex((w) => w.connectionId === connectionId)
          if (existing >= 0) {
            const updated = [...prev]
            updated[existing] = newWitness
            return updated
          }
          return [...prev, newWitness]
        })

        // Auto-activate this new witness
        setActiveWitnessConnectionId(connectionId)
        persistActiveWitnessId(connectionId)
        setRecentlyAutoActivatedWitness(newWitness)

        logger.current.info(`✓ Witness auto-activated: ${announcement.name} (${connectionId})`)

        // Query this witness's Trust Task capabilities as soon as it's
        // known, so a locality requirement (witness/session's `requiredExt`,
        // locality-plan.md §10.3 item 8) is discoverable via
        // `getWitnessLocalityRequirement` well before any BLE permission
        // prompt or session — not just on the peer relationship connection.
        void queryWitnessDiscovery(agent, connectionId).catch((e: Error) =>
          logger.current.warn(`Witness discovery query failed: ${e.message}`)
        )

        // Witness-connect pre-flight sheet (§8.4 row 2, §10.3 item 8): Android
        // only (no native peripheral on iOS yet), only if the user hasn't
        // already answered it this install, and only if the locality setting
        // is still on (off means "never request Bluetooth permission" per
        // §8.1 — nothing to prime). One `localityPreflightPendingRef` guard
        // keeps two witnesses connecting in quick succession from both
        // scheduling a prompt.
        if (
          Platform.OS === 'android' &&
          !preferencesRef.current?.hasSeenLocalityPreflight &&
          (preferencesRef.current?.useLocalityConfirmation ?? true) &&
          !localityPreflightPendingRef.current
        ) {
          localityPreflightPendingRef.current = true
          void resolveLocalityPreflightRequirement(agent, connectionId)
            .then((required) => {
              setLocalityPreflight({ witness: newWitness, required })
            })
            .catch((e: Error) => {
              logger.current.warn(`Locality pre-flight requirement check failed: ${e.message}`)
              setLocalityPreflight({ witness: newWitness, required: false })
            })
        }

        // ── Reporting DID registration ──────────────────────────────────────
        // If reporting is enabled and we have not yet registered a reporting
        // DID with this witness, generate a fresh did:peer:0 and send it.
        // Using a per-witness DID limits cross-witness correlation.
        const witnessSettings = witnessStoreRef.current
        const reportingEnabled = witnessSettings?.enableReporting ?? true
        const existingReportingDid = witnessSettings?.reportingDids?.[connectionId]

        if (reportingEnabled && !existingReportingDid) {
          try {
            logger.current.info(`Generating reporting DID for witness connection ${connectionId}`)

            const didResult = await agent.dids.create({
              method: 'peer',
              options: {
                numAlgo: PeerDidNumAlgo.InceptionKeyWithoutDoc,
                createKey: { type: { kty: 'OKP', crv: 'Ed25519' } },
              },
            })

            const newReportingDid = didResult.didState.did
            if (!newReportingDid) {
              throw new Error('Failed to create reporting DID')
            }

            // Persist reporting DID to store (merges into existing map)
            const updatedReportingDids = {
              ...(witnessSettings?.reportingDids ?? {}),
              [connectionId]: newReportingDid,
            }
            dispatch({
              type: DispatchAction.UPDATE_WITNESS_SETTINGS,
              payload: [{ ...witnessSettings, reportingDids: updatedReportingDids }],
            })

            // Eagerly update the ref so getState() returns it immediately
            witnessStoreRef.current = {
              ...witnessStoreRef.current,
              reportingDids: updatedReportingDids,
            }

            // Notify the witness server of our reporting DID
            const registrationMessage = JSON.stringify({
              type: 'reporting-did-registration',
              reportingDid: newReportingDid,
            })
            await agent.modules.didcomm.basicMessages.sendMessage(connectionId, registrationMessage)

            logger.current.info(`✓ Reporting DID registered with witness: ${newReportingDid}`)
          } catch (reportingError) {
            // Non-fatal — reporting is best-effort
            logger.current.warn(
              `Could not register reporting DID with witness: ${(reportingError as Error).message}`
            )
          }
        } else if (existingReportingDid) {
          logger.current.info(`Reporting DID already exists for witness ${connectionId}: ${existingReportingDid}`)
        } else {
          logger.current.info(`Reporting disabled — skipping reporting DID registration`)
        }
        // ────────────────────────────────────────────────────────────────────
      } catch (error) {
        logger.current.error('Error handling witness announcement:', error)
      }
    },
    [agent, dispatch, persistActiveWitnessId]
  )

  /**
   * The pre-flight sheet's answer (§10.3 item 8). Declining reuses the SAME
   * `useLocalityConfirmation` setting Settings → Secure Exchanges exposes —
   * there is no separate "advertise for this session" flag to invent; the
   * existing gate in `witnessCeremony.ts`/`ceremony.ts` (`isLocalityConfirmationPreferred`)
   * already reads that one setting, so flipping it here is the whole effect.
   * Allowing leaves the setting untouched (it defaults on) and only requests
   * the OS Bluetooth permission — the sheet component does that, not this
   * provider, since it needs `react-native-permissions`, which importing
   * here would give every consumer of this context a hard RN-permissions
   * dependency for no benefit.
   */
  const resolveLocalityPreflight = useCallback(
    (allow: boolean) => {
      if (!allow) {
        dispatch({ type: DispatchAction.USE_LOCALITY_CONFIRMATION, payload: [false] })
      }
      dispatch({ type: DispatchAction.MARK_LOCALITY_PREFLIGHT_SEEN, payload: [] })
      localityPreflightPendingRef.current = false
      setLocalityPreflight(undefined)
    },
    [dispatch]
  )

  /**
   * Restore all witness connections on app mount from existing ConnectionRecords
   */
  useEffect(() => {
    const restoreWitnessConnections = async () => {
      try {
        logger.current.info('Scanning for existing witness connections...')
        const allConnections = await agent.modules.didcomm.connections.getAll()

        const witnessConnections: ConnectedWitness[] = []

        for (const conn of allConnections) {
          if (conn.state !== DidCommDidExchangeState.Completed) continue

          const metadata = conn.metadata.get('witnessConnection') as any
          if (!metadata) continue

          witnessConnections.push({
            name: metadata.name || conn.theirLabel || 'Unknown Witness',
            eventName: metadata.eventName || undefined,
            issuerDid: metadata.issuerDid || metadata.invitationDid || conn.theirDid || 'unknown',
            connectionId: conn.id,
            connectedAt: metadata.connectedAt ? new Date(metadata.connectedAt) : new Date(),
          })
        }

        // Sort by connectedAt (most recent first)
        witnessConnections.sort((a, b) => b.connectedAt.getTime() - a.connectedAt.getTime())

        logger.current.info(`Found ${witnessConnections.length} witness connection(s)`)
        setAllWitnessConnections(witnessConnections)

        // Validate stored active witness ID
        const storedActiveId = (store as any).witness?.activeWitnessConnectionId
        if (storedActiveId) {
          const stillExists = witnessConnections.some((w) => w.connectionId === storedActiveId)
          if (stillExists) {
            setActiveWitnessConnectionId(storedActiveId)
            logger.current.info(`Restored active witness: ${storedActiveId}`)
          } else {
            // Stored ID is stale - pick most recent if any
            if (witnessConnections.length > 0) {
              const mostRecent = witnessConnections[0]
              setActiveWitnessConnectionId(mostRecent.connectionId)
              persistActiveWitnessId(mostRecent.connectionId)
              logger.current.info(`Stored active witness gone, using most recent: ${mostRecent.name}`)
            } else {
              setActiveWitnessConnectionId(undefined)
              persistActiveWitnessId(undefined)
            }
          }
        } else if (witnessConnections.length > 0 && !activeWitnessConnectionIdRef.current) {
          // No stored preference - auto-select most recent
          const mostRecent = witnessConnections[0]
          setActiveWitnessConnectionId(mostRecent.connectionId)
          persistActiveWitnessId(mostRecent.connectionId)
          logger.current.info(`Auto-selected most recent witness: ${mostRecent.name}`)
        }
      } catch (error) {
        logger.current.error('Error restoring witness connections:', error)
      }
    }

    restoreWitnessConnections()
    // Run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent])

  /**
   * Register callbacks with vrc-manager
   */
  useEffect(() => {
    logger.current.info('Registering witness session callback')
    registerWitnessSessionCallback(setActiveSession)
    return () => {
      registerWitnessSessionCallback(() => {})
    }
  }, [setActiveSession])

  useEffect(() => {
    logger.current.info('Registering witness state getter')
    registerWitnessStateGetter(getState)
    return () => {
      registerWitnessStateGetter(() => ({}))
    }
  }, [getState])

  useEffect(() => {
    logger.current.info('Registering witness validation callback')
    registerWitnessValidationCallback(validateWitnessConnection)
    return () => {
      registerWitnessValidationCallback(async () => false)
    }
  }, [validateWitnessConnection])

  useEffect(() => {
    logger.current.info('Registering witness announcement handler')
    registerWitnessConnectionDetectedCallback(handleWitnessAnnouncement)
    return () => {
      registerWitnessConnectionDetectedCallback(() => {})
    }
  }, [handleWitnessAnnouncement])

  const value: WitnessConnectionContextValue = {
    allWitnessConnections,
    connectedWitness: activeWitness,
    activeSession,
    setActiveWitness,
    removeWitness,
    disconnectWitness,
    isWitnessConnected,
    recentlyAutoActivatedWitness,
    clearAutoActivatedNotification,
    setActiveSession,
    clearActiveSession,
    getState,
    validateWitnessConnection,
    localityPreflight,
    resolveLocalityPreflight,
  }

  return <WitnessConnectionContext.Provider value={value}>{children}</WitnessConnectionContext.Provider>
}

/**
 * Hook to use witness connection context
 */
export const useWitnessConnection = (): WitnessConnectionContextValue => {
  const context = useContext(WitnessConnectionContext)
  if (!context) {
    throw new Error('useWitnessConnection must be used within WitnessConnectionProvider')
  }
  return context
}
