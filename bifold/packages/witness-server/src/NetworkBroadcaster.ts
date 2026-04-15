/**
 * NetworkBroadcaster - WebSocket event broadcaster for the live network view
 *
 * Tracks connected wallets and witnessed exchanges, broadcasting real-time
 * events to network clients via WebSocket.
 */

import { EventEmitter } from 'events'
import { ReportingGraph } from './ReportingGraph'
import { derivePseudonym, pseudonymDisplay } from './pseudonym'

export interface NetworkEvent {
  type: 'wallet-connected' | 'exchange-started' | 'exchange-complete' | 'stats-update' | 'initial-state' | 'credential-issued'
  timestamp: number
  data: Record<string, unknown>
}

/**
 * A minimal, JSON-serializable record of an issued VWC for the activity log.
 * Uses an ISO string for issuedAt instead of Date (Date is not JSON-safe).
 */
export interface CredentialLogEntry {
  vwcId: string
  sessionId: string
  vrcDigest: string
  vrcIssuerId: string
  recipientDid: string
  /** ISO-8601 timestamp */
  issuedAt: string
  eventName?: string
}

export interface WalletNode {
  id: string
  label: string
  connectedAt: number
}

export interface ExchangeEdge {
  id: string
  walletA: string
  walletB: string
  labelA: string
  labelB: string
  sessionId: string
  completedAt: number
  /** Whether the exchange was witnessed by this server. Default true for backward compatibility. */
  witnessed?: boolean
  /** Number of parties with hardware attestation (0, 1, or 2). Default 0 for backward compatibility. */
  attestationCount?: number
}

/**
 * Node data for wallet participants with optional tooltip for displaying the full DID
 */
export interface WalletNodeWithTooltip extends WalletNode {
  /** Full DID for hover tooltip display */
  tooltip?: string
}

export class NetworkBroadcaster extends EventEmitter {
  private wallets: Map<string, WalletNodeWithTooltip> = new Map()
  private exchanges: ExchangeEdge[] = []
  private recentCredentials: CredentialLogEntry[] = []
  private mockInterval: ReturnType<typeof setInterval> | null = null

  /**
   * Persistent totals loaded from the reporting graph on startup.
   * These survive resetState() (which only clears live/mock data) because
   * they come from disk and should always reflect the full historical record.
   */
  private persistentTotalSessions: number = 0
  private persistentTotalCredentials: number = 0

  /**
   * Live-only VRC-issuer set (kept for potential future use / API consumers).
   * Note: "Unique Participants" shown in the UI comes from this.wallets.size,
   * which covers both historical (reporting graph) and live participants.
   */
  private liveVrcIssuers: Set<string> = new Set()

  private static readonly MAX_RECENT_CREDENTIALS = 200

  getState(): {
    wallets: WalletNodeWithTooltip[]
    exchanges: ExchangeEdge[]
    recentCredentials: CredentialLogEntry[]
    stats: Record<string, number>
  } {
    const liveCredentials = this.recentCredentials.length

    return {
      wallets: Array.from(this.wallets.values()),
      exchanges: this.exchanges,
      recentCredentials: this.recentCredentials,
      stats: {
        totalWallets: this.wallets.size,
        totalExchanges: this.exchanges.length,
        // Use this.exchanges.length as the authoritative "Witnessed Relationships" count.
        // this.exchanges is only appended to when BOTH parties opt into reporting
        // (via loadFromReportingGraph or recordReportingEdge), so it exactly mirrors
        // what the network view displays.  The previous approach used liveSessions derived
        // from recentCredentials, which counted ALL completed sessions including ones where
        // only one party had reporting enabled — causing the activity log to over-count.
        totalSessions: this.exchanges.length,
        totalCredentials: this.persistentTotalCredentials + liveCredentials,
        // wallets.size covers both historical (from reportingGraph) and live participants
        // Uses reporting DIDs as IDs — never wallet names or connection IDs
        uniqueParticipants: this.wallets.size,
      },
    }
  }

  walletConnected(connectionId: string, label: string, tooltip?: string): void {
    if (this.wallets.has(connectionId)) {
      return
    }

    const node: WalletNodeWithTooltip = {
      id: connectionId,
      label: label || derivePseudonym(connectionId),
      connectedAt: Date.now(),
      tooltip,
    }
    this.wallets.set(connectionId, node)

    const event: NetworkEvent = {
      type: 'wallet-connected',
      timestamp: Date.now(),
      data: { wallet: node },
    }
    this.emit('event', event)
    this.emitStatsUpdate()
  }

  exchangeStarted(walletAId: string, walletBId: string, sessionId: string): void {
    const event: NetworkEvent = {
      type: 'exchange-started',
      timestamp: Date.now(),
      data: {
        walletA: walletAId,
        walletB: walletBId,
        // Always derive pseudonym from the reporting DID — never read stored labels
        // which could contain wallet names if data was corrupted or migrated.
        labelA: derivePseudonym(walletAId),
        labelB: derivePseudonym(walletBId),
        sessionId,
      },
    }
    this.emit('event', event)
  }

  exchangeComplete(walletAId: string, walletBId: string, sessionId: string, attestationCount?: number, witnessed: boolean = true): void {
    const edge: ExchangeEdge = {
      id: sessionId,
      walletA: walletAId,
      walletB: walletBId,
      // Always derive pseudonym from the reporting DID — never read stored labels
      // which could contain wallet names if data was corrupted or migrated.
      labelA: derivePseudonym(walletAId),
      labelB: derivePseudonym(walletBId),
      sessionId,
      completedAt: Date.now(),
      witnessed,
      attestationCount,
    }
    this.exchanges.push(edge)

    const event: NetworkEvent = {
      type: 'exchange-complete',
      timestamp: Date.now(),
      data: { exchange: edge },
    }
    this.emit('event', event)
    this.emitStatsUpdate()
  }

  /**
   * Generate mock wallet connections and exchanges for testing
   */
  startMockGeneration(intervalMs: number = 3000, maxNodes: number = 25): void {
    if (this.mockInterval) return

    const walletIds: string[] = []

    const generateId = () => {
      const chars = 'abcdef0123456789'
      let id = ''
      for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)]
      return id
    }

    this.mockInterval = setInterval(() => {
      const shouldAddWallet = walletIds.length < 2 || (Math.random() < 0.6 && walletIds.length < maxNodes)

      if (shouldAddWallet && walletIds.length < maxNodes) {
        const id = generateId()
        walletIds.push(id)
        this.walletConnected(id, derivePseudonym(id))
      } else if (walletIds.length >= 2) {
        // Pick two random wallets that haven't exchanged yet
        const a = Math.floor(Math.random() * walletIds.length)
        let b = Math.floor(Math.random() * walletIds.length)
        while (b === a) b = Math.floor(Math.random() * walletIds.length)

        const sessionId = `session-${generateId()}`

        // Randomly decide if this is a witnessed exchange (70% witnessed, 30% non-witnessed)
        const witnessed = Math.random() < 0.7
        
        // Generate random attestation count for demo purposes (0, 1, or 2)
        // For non-witnessed exchanges, attestationCount now affects the visual score
        const attestationCount = Math.floor(Math.random() * 3)

        // Fire exchange-started, then exchange-complete after a short delay
        this.exchangeStarted(walletIds[a], walletIds[b], sessionId)
        setTimeout(() => {
          this.exchangeComplete(walletIds[a], walletIds[b], sessionId, attestationCount, witnessed)
        }, 1500)
      }
    }, intervalMs)

    console.log(`[Network] Mock generation started (interval: ${intervalMs}ms)`)
  }

  stopMockGeneration(): void {
    if (this.mockInterval) {
      clearInterval(this.mockInterval)
      this.mockInterval = null
      console.log('[Network] Mock generation stopped')
    }
  }

  /**
   * Load wallet and exchange data from a ReportingGraph instance
   * This is used to display static reporting data from the .reporting/ folder
   *
   * @param graph - The ReportingGraph instance to load data from
   */
  loadFromReportingGraph(graph: ReportingGraph): void {
    console.log('[Network] Loading data from reporting graph...')

    const edges = graph.getEdges()
    // Use getNodes() which extracts unique DIDs from both the DID registry
    // AND the edges file — works even if reporting-dids.json doesn't exist
    const reportingDids = graph.getNodes()

    console.log(`[Network]   Found ${reportingDids.length} unique reporting DIDs and ${edges.length} edges`)

    // Register wallet nodes — walletConnected() emits 'wallet-connected' events
    // and stores with key = reportingDid, so edges can look up by reportingDidA/B directly
    for (const reportingDid of reportingDids) {
      const display = pseudonymDisplay(reportingDid)
      this.walletConnected(reportingDid, display.label.replace('\n', ' '), reportingDid)
    }

    // Create exchange edges from ReportingGraph edges.
    // Always derive pseudonyms directly from reporting DIDs — never read stored labels
    // to prevent any possible exposure of wallet names.
    for (const edge of edges) {
      const nodeAExists = this.wallets.has(edge.reportingDidA)
      const nodeBExists = this.wallets.has(edge.reportingDidB)

      if (nodeAExists && nodeBExists) {
        // Use persisted witnessed and attestationCount for proper edge scoring on load
        const witnessed = edge.witnessed ?? true
        const attestationCount = edge.attestationCount ?? 0
        
        const exchangeEdge: ExchangeEdge = {
          id: edge.sessionId,
          walletA: edge.reportingDidA,
          walletB: edge.reportingDidB,
          labelA: derivePseudonym(edge.reportingDidA),
          labelB: derivePseudonym(edge.reportingDidB),
          sessionId: edge.sessionId,
          completedAt: new Date(edge.witnessedAt).getTime(),
          witnessed,
          attestationCount,
        }
        this.exchanges.push(exchangeEdge)

        const event: NetworkEvent = {
          type: 'exchange-complete',
          timestamp: Date.now(),
          data: { exchange: exchangeEdge },
        }
        this.emit('event', event)
      } else {
        console.warn(`[Network] Could not find wallet nodes for edge: ${edge.reportingDidA} ↔ ${edge.reportingDidB}`)
      }
    }

    // Seed persistent stat counters from the reporting graph so that the
    // activity log stat cards show correct historical totals on first load.
    // Each edge = 1 completed session = 2 VWCs issued (one to each participant).
    this.persistentTotalSessions = edges.length
    this.persistentTotalCredentials = edges.length * 2

    console.log(`[Network] Loaded ${this.wallets.size} wallets and ${this.exchanges.length} exchanges`)
    console.log(`[Network]   Persistent stats seeded: ${this.persistentTotalSessions} sessions, ${this.persistentTotalCredentials} credentials`)
  }

  /**
   * Record an edge from reporting data (for live updates)
   * Used when the witness records a new edge in the reporting graph
   *
   * @param reportingDidA - First participant's reporting DID
   * @param reportingDidB - Second participant's reporting DID
   * @param sessionId - The session ID
   * @param attestationCount - Number of parties with hardware attestation (0, 1, or 2)
   */
  recordReportingEdge(reportingDidA: string, reportingDidB: string, sessionId: string, attestationCount?: number): void {
    // Look up or create wallet nodes for both reporting DIDs
    const walletAId = this.ensureWalletNode(reportingDidA)
    const walletBId = this.ensureWalletNode(reportingDidB)

    // Sort IDs to create a stable edge key (same as ReportingGraph.recordEdge)
    const [sortedA, sortedB] = [walletAId, walletBId].sort()

    // Check if an exchange already exists between these two DIDs
    // If so, update it instead of adding a duplicate (matching ReportingGraph behavior)
    const existingIndex = this.exchanges.findIndex(
      (e) => (e.walletA === sortedA && e.walletB === sortedB) ||
             (e.walletA === sortedB && e.walletB === sortedA)
    )

    if (existingIndex !== -1) {
      // Update existing exchange with latest data
      const existing = this.exchanges[existingIndex]
      existing.sessionId = sessionId
      existing.completedAt = Date.now()
      existing.witnessed = true
      existing.attestationCount = attestationCount
      existing.labelA = derivePseudonym(sortedA)
      existing.labelB = derivePseudonym(sortedB)

      const event: NetworkEvent = {
        type: 'exchange-complete',
        timestamp: Date.now(),
        data: { exchange: existing },
      }
      this.emit('event', event)
      this.emitStatsUpdate()
      console.log(`[Network] Updated existing exchange: ${sortedA} ↔ ${sortedB} (session: ${sessionId})`)
      return
    }

    // Record and emit the exchange immediately (no animation delay for live data)
    // Pass attestation count for edge styling in the network UI
    this.exchangeComplete(walletAId, walletBId, sessionId, attestationCount)
  }

  /**
   * Ensure a wallet node exists for a reporting DID
   * Creates a new node if it doesn't exist, otherwise returns existing node ID
   *
   * @param reportingDid - The reporting DID
   * @returns The wallet node ID
   */
  private ensureWalletNode(reportingDid: string): string {
    // Use the reportingDid itself as the stable wallet ID (consistent with loadFromReportingGraph)
    if (this.wallets.has(reportingDid)) {
      return reportingDid
    }

    // Create a new wallet node via walletConnected() so the event is emitted
    const display = pseudonymDisplay(reportingDid)
    this.walletConnected(reportingDid, display.label.replace('\n', ' '), reportingDid)

    return reportingDid
  }

  /**
   * Record a newly issued VWC in the broadcaster's recent-credentials list and
   * emit a `credential-issued` event so the activity log receives live updates
   * via the same WebSocket channel used by the dashboard graph.
   *
   * @param entry - Serialisable credential log entry (Date already converted to ISO string)
   */
  notifyCredentialIssued(entry: CredentialLogEntry): void {
    this.recentCredentials.push(entry)
    // Trim to a rolling window — oldest records are dropped first
    if (this.recentCredentials.length > NetworkBroadcaster.MAX_RECENT_CREDENTIALS) {
      this.recentCredentials = this.recentCredentials.slice(-NetworkBroadcaster.MAX_RECENT_CREDENTIALS)
    }

    // Track unique VRC issuers for the live stat card
    if (entry.vrcIssuerId) {
      this.liveVrcIssuers.add(entry.vrcIssuerId)
    }

    const event: NetworkEvent = {
      type: 'credential-issued',
      timestamp: Date.now(),
      data: { credential: entry },
    }
    this.emit('event', event)
    this.emitStatsUpdate()
  }

  /**
   * Emit a stats-update event with the current authoritative stats.
   * Called automatically after any state-changing operation so that all
   * connected clients (dashboard, activity log) stay in sync without
   * maintaining their own independent counters.
   */
  private emitStatsUpdate(): void {
    const { stats } = this.getState()
    this.emit('event', {
      type: 'stats-update',
      timestamp: Date.now(),
      data: { stats },
    } as NetworkEvent)
  }

  resetState(): void {
    this.wallets.clear()
    this.exchanges = []
    this.recentCredentials = []
    this.emit('event', {
      type: 'initial-state',
      timestamp: Date.now(),
      data: this.getState(),
    } as NetworkEvent)
  }
}
