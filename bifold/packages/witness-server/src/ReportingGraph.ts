/**
 * ReportingGraph - Opt-in activity graph for the witness server
 *
 * Stores two persistent maps:
 *   1. connectionId  → reportingDid   (registered by the app on first connection)
 *   2. edgeKey       → ReportingEdge  (recorded when BOTH parties include a reportingDid
 *                                      in their `submit-presentation` message)
 *
 * Privacy design
 * ──────────────
 * • Only recorded when BOTH parties opt in (include `reportingDid` in VP submission).
 * • Each app generates a FRESH did:peer per witness, so edges cannot be correlated
 *   across different witnesses.
 * • The witness never stores the participant's wallet DID — only the reporting DID,
 *   which is a pseudonymous single-purpose identity.
 */

import path from 'path'
import { PersistentJsonStore } from './PersistentJsonStore'

/** A single directed-graph edge between two opted-in participants */
export interface ReportingEdge {
  /** Reporting DID of party A (lexicographically smaller DID, for stable dedup) */
  reportingDidA: string
  /** Reporting DID of party B */
  reportingDidB: string
  /** Witness session that produced this edge */
  sessionId: string
  /** ISO-8601 timestamp of attestation */
  witnessedAt: string
  /** Whether this exchange was witnessed by this server */
  witnessed: boolean
  /** Number of parties with hardware attestation (0, 1, or 2) */
  attestationCount: number
}

export class ReportingGraph {
  /** connectionId → reporting DID (registered on first witness connection) */
  private readonly connectionDids: PersistentJsonStore<string>
  /** canonical edge key → edge record */
  private readonly edges: PersistentJsonStore<ReportingEdge>

  private readonly name: string

  constructor(storageDir: string, witnessName: string) {
    this.name = witnessName
    this.connectionDids = new PersistentJsonStore<string>(
      path.join(storageDir, 'reporting-dids.json')
    )
    this.edges = new PersistentJsonStore<ReportingEdge>(
      path.join(storageDir, 'reporting-edges.json')
    )

    console.log(
      `[${this.name}] ReportingGraph loaded — ` +
      `${this.connectionDids.size()} DIDs, ${this.edges.size()} edges`
    )
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Reporting DID registry (connectionId → reportingDid)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Register (or update) the reporting DID for a witness connection.
   * Called when the app sends a `reporting-did-registration` basic message.
   */
  registerReportingDid(connectionId: string, reportingDid: string): void {
    const existing = this.connectionDids.get(connectionId)
    if (existing === reportingDid) return // idempotent

    this.connectionDids.set(connectionId, reportingDid)
    console.log(
      `[${this.name}] Registered reporting DID for connection ${connectionId}: ${reportingDid}`
    )
  }

  /**
   * Look up the persisted reporting DID for a connection.
   * Returns undefined if the participant has not registered (or opted out).
   */
  getReportingDid(connectionId: string): string | undefined {
    return this.connectionDids.get(connectionId)
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Exchange graph
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Record an opt-in exchange edge between two participants.
   *
   * The edge key is the two reporting DIDs sorted and joined with `|`, so
   * `A|B` and `B|A` map to the same entry and duplicates are overwritten.
   *
   * @param reportingDidA    Reporting DID of the first participant
   * @param reportingDidB    Reporting DID of the second participant
   * @param sessionId        Witness session that attested this exchange
   * @param witnessed        Whether this exchange was witnessed by this server
   * @param attestationCount Number of parties with hardware attestation (0, 1, or 2)
   */
  recordEdge(
    reportingDidA: string,
    reportingDidB: string,
    sessionId: string,
    witnessed: boolean = true,
    attestationCount: number = 0
  ): void {
    const [a, b] = [reportingDidA, reportingDidB].sort()
    const edgeKey = `${a}|${b}`

    this.edges.set(edgeKey, {
      reportingDidA: a,
      reportingDidB: b,
      sessionId,
      witnessedAt: new Date().toISOString(),
      witnessed,
      attestationCount,
    })

    console.log(
      `[${this.name}] Recorded reporting edge | Session: ${sessionId} | ` +
      `${a.substring(0, 20)}… ↔ ${b.substring(0, 20)}… | witnessed: ${witnessed}, attestations: ${attestationCount}`
    )
  }

  /** Return all recorded exchange edges */
  getEdges(): ReportingEdge[] {
    return Object.values(this.edges.getAll())
  }

  /** Return all registered connection → reporting-DID pairs */
  getRegisteredDids(): Record<string, string> {
    return this.connectionDids.getAll()
  }

  /** Stats summary for logging */
  stats(): { dids: number; edges: number } {
    return {
      dids: this.connectionDids.size(),
      edges: this.edges.size(),
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Graph query helpers (for dashboard integration)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Return all unique reporting DIDs in the graph (all nodes).
   * Extracts DIDs from both registered connections and edge records.
   */
  getNodes(): string[] {
    const nodes = new Set<string>(Object.values(this.connectionDids.getAll()))
    
    // Also extract DIDs from edges in case some weren't explicitly registered
    for (const edge of this.getEdges()) {
      nodes.add(edge.reportingDidA)
      nodes.add(edge.reportingDidB)
    }
    
    return Array.from(nodes)
  }
}
