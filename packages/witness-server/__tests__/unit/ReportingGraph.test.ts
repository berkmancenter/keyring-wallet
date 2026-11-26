/**
 * Unit tests for ReportingGraph
 *
 * Verifies:
 * - registerReportingDid / getReportingDid
 * - recordEdge — only when BOTH parties have a reporting DID
 * - getEdges / stats
 * - Edge de-duplication (same pair → overwrite)
 * - Persistence across instances (simulating server restart)
 */

import { mkdirSync, rmSync } from 'fs'
import path from 'path'
import os from 'os'
import { ReportingGraph } from '../../src/ReportingGraph'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `rg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReportingGraph', () => {
  let dir: string

  beforeEach(() => {
    dir = tmpDir()
  })

  afterEach(() => {
    cleanup(dir)
  })

  // ── Reporting DID registry ────────────────────────────────────────────────

  describe('registerReportingDid / getReportingDid', () => {
    it('returns undefined for an unknown connection', () => {
      const g = new ReportingGraph(dir, 'test-witness')
      expect(g.getReportingDid('conn-unknown')).toBeUndefined()
    })

    it('stores and retrieves a reporting DID', () => {
      const g = new ReportingGraph(dir, 'test-witness')
      g.registerReportingDid('conn-alice', 'did:peer:0z_reporting_alice')
      expect(g.getReportingDid('conn-alice')).toBe('did:peer:0z_reporting_alice')
    })

    it('overwrites an existing reporting DID', () => {
      const g = new ReportingGraph(dir, 'test-witness')
      g.registerReportingDid('conn-alice', 'did:peer:0z_old')
      g.registerReportingDid('conn-alice', 'did:peer:0z_new')
      expect(g.getReportingDid('conn-alice')).toBe('did:peer:0z_new')
    })

    it('stores multiple connections independently', () => {
      const g = new ReportingGraph(dir, 'test-witness')
      g.registerReportingDid('conn-alice', 'did:peer:alice')
      g.registerReportingDid('conn-bob', 'did:peer:bob')
      expect(g.getReportingDid('conn-alice')).toBe('did:peer:alice')
      expect(g.getReportingDid('conn-bob')).toBe('did:peer:bob')
    })
  })

  // ── Edge recording ────────────────────────────────────────────────────────

  describe('recordEdge', () => {
    it('records an edge between two reporting DIDs', () => {
      const g = new ReportingGraph(dir, 'test-witness')
      g.recordEdge('did:peer:alice', 'did:peer:bob', 'session-001')
      expect(g.stats().edges).toBe(1)
    })

    it('edge contains both DIDs and the session ID', () => {
      const g = new ReportingGraph(dir, 'test-witness')
      g.recordEdge('did:peer:alice', 'did:peer:bob', 'session-xyz')
      const edges = g.getEdges()
      expect(edges).toHaveLength(1)
      const edge = edges[0]
      // DIDs are sorted lexicographically for stable deduplication
      const sorted = ['did:peer:alice', 'did:peer:bob'].sort()
      expect(edge.reportingDidA).toBe(sorted[0])
      expect(edge.reportingDidB).toBe(sorted[1])
      expect(edge.sessionId).toBe('session-xyz')
    })

    it('edge includes a witnessedAt timestamp', () => {
      const before = new Date()
      const g = new ReportingGraph(dir, 'test-witness')
      g.recordEdge('did:peer:alice', 'did:peer:bob', 'session-ts')
      const edges = g.getEdges()
      const after = new Date()

      const edgeTime = new Date(edges[0].witnessedAt)
      expect(edgeTime.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(edgeTime.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('accumulates multiple edges for distinct pairs', () => {
      const g = new ReportingGraph(dir, 'test-witness')
      g.recordEdge('did:peer:alice', 'did:peer:bob', 'session-1')
      g.recordEdge('did:peer:alice', 'did:peer:charlie', 'session-2')
      g.recordEdge('did:peer:bob', 'did:peer:charlie', 'session-3')
      expect(g.stats().edges).toBe(3)
    })

    it('deduplicates the same pair (overwrites with latest session)', () => {
      // Edge key is sorted DID pair → same key for both calls
      const g = new ReportingGraph(dir, 'test-witness')
      g.recordEdge('did:peer:alice', 'did:peer:bob', 'session-a')
      g.recordEdge('did:peer:alice', 'did:peer:bob', 'session-b')
      // Same pair → only 1 stored entry (last write wins)
      expect(g.stats().edges).toBe(1)
      expect(g.getEdges()[0].sessionId).toBe('session-b')
    })

    it('is order-independent — A|B and B|A produce the same edge key', () => {
      const g = new ReportingGraph(dir, 'test-witness')
      g.recordEdge('did:peer:alice', 'did:peer:bob', 'session-1')
      g.recordEdge('did:peer:bob', 'did:peer:alice', 'session-2')
      // Same canonical pair → still 1 edge
      expect(g.stats().edges).toBe(1)
    })
  })

  // ── Opt-in semantics (documented) ─────────────────────────────────────────

  describe('opt-in semantics', () => {
    /**
     * The WitnessService calls recordEdge only when BOTH parties provided
     * a reportingDid. We document that logic here without re-testing
     * WitnessService internals.
     */

    it('documents: edge is recorded only when both reporting DIDs are present', () => {
      const sessionReportingDids = new Map<string, string>()
      // Only Alice opted in
      sessionReportingDids.set('conn-alice', 'did:peer:reporting-alice')

      const g = new ReportingGraph(dir, 'opt-in-test')
      const dids = Array.from(sessionReportingDids.values())

      if (dids.length === 2) {
        g.recordEdge(dids[0], dids[1], 'session-test')
      }

      // Single opt-in → no edge
      expect(g.stats().edges).toBe(0)
    })

    it('documents: edge IS recorded when both parties opt in', () => {
      const sessionReportingDids = new Map<string, string>()
      sessionReportingDids.set('conn-alice', 'did:peer:reporting-alice')
      sessionReportingDids.set('conn-bob', 'did:peer:reporting-bob')

      const g = new ReportingGraph(dir, 'opt-in-test')
      const dids = Array.from(sessionReportingDids.values())

      if (dids.length === 2) {
        g.recordEdge(dids[0], dids[1], 'session-test')
      }

      expect(g.stats().edges).toBe(1)
    })
  })

  // ── Persistence ───────────────────────────────────────────────────────────

  describe('persistence across instances', () => {
    it('reloads registered reporting DIDs after restart', () => {
      const g1 = new ReportingGraph(dir, 'witness')
      g1.registerReportingDid('conn-alice', 'did:peer:alice')
      g1.registerReportingDid('conn-bob', 'did:peer:bob')

      const g2 = new ReportingGraph(dir, 'witness')
      expect(g2.getReportingDid('conn-alice')).toBe('did:peer:alice')
      expect(g2.getReportingDid('conn-bob')).toBe('did:peer:bob')
    })

    it('reloads recorded edges after restart', () => {
      const g1 = new ReportingGraph(dir, 'witness')
      g1.recordEdge('did:peer:alice', 'did:peer:bob', 'session-persist')

      const g2 = new ReportingGraph(dir, 'witness')
      expect(g2.stats().edges).toBe(1)
      const edges = g2.getEdges()
      expect(edges[0].sessionId).toBe('session-persist')
    })

    it('accumulates new edges after restart', () => {
      const g1 = new ReportingGraph(dir, 'witness')
      g1.recordEdge('did:peer:alice', 'did:peer:bob', 'session-1')

      const g2 = new ReportingGraph(dir, 'witness')
      g2.recordEdge('did:peer:alice', 'did:peer:charlie', 'session-2')

      expect(g2.stats().edges).toBe(2)
    })

    it('uses separate storage files per witness name', () => {
      const g1 = new ReportingGraph(path.join(dir, 'witnessA'), 'witness-A')
      const g2 = new ReportingGraph(path.join(dir, 'witnessB'), 'witness-B')

      g1.registerReportingDid('conn-x', 'did:peer:x')
      g2.registerReportingDid('conn-y', 'did:peer:y')

      // Each graph should be isolated
      expect(g1.getReportingDid('conn-y')).toBeUndefined()
      expect(g2.getReportingDid('conn-x')).toBeUndefined()
    })
  })

  // ── Edge structure ────────────────────────────────────────────────────────

  describe('edge structure', () => {
    it('edge has reportingDidA, reportingDidB, sessionId, and witnessedAt fields', () => {
      const g = new ReportingGraph(dir, 'test-witness')
      g.recordEdge('did:peer:A', 'did:peer:B', 'sess-123')
      const edge = g.getEdges()[0]
      expect(Object.keys(edge)).toEqual(
        expect.arrayContaining(['reportingDidA', 'reportingDidB', 'sessionId', 'witnessedAt'])
      )
    })

    it('DIDs are stored in sorted (canonical) order', () => {
      const g = new ReportingGraph(dir, 'test-witness')
      // 'did:peer:Z' > 'did:peer:A' lexicographically
      g.recordEdge('did:peer:Z', 'did:peer:A', 'session-order')
      const edge = g.getEdges()[0]
      const sorted = ['did:peer:Z', 'did:peer:A'].sort()
      expect(edge.reportingDidA).toBe(sorted[0])
      expect(edge.reportingDidB).toBe(sorted[1])
    })

    it('getEdges returns a copy — mutations do not affect the store', () => {
      const g = new ReportingGraph(dir, 'test-witness')
      g.recordEdge('did:peer:alice', 'did:peer:bob', 'session-copy')
      const edges = g.getEdges()
      edges.push({
        reportingDidA: 'mutated',
        reportingDidB: 'mutated',
        sessionId: 'noop',
        witnessedAt: new Date().toISOString(),
      })
      expect(g.stats().edges).toBe(1)
    })
  })

  // ── stats ─────────────────────────────────────────────────────────────────

  describe('stats()', () => {
    it('returns zero counts on empty graph', () => {
      const g = new ReportingGraph(dir, 'test-witness')
      expect(g.stats()).toEqual({ dids: 0, edges: 0 })
    })

    it('counts registered DIDs correctly', () => {
      const g = new ReportingGraph(dir, 'test-witness')
      g.registerReportingDid('conn-1', 'did:peer:1')
      g.registerReportingDid('conn-2', 'did:peer:2')
      expect(g.stats().dids).toBe(2)
    })

    it('counts edges correctly', () => {
      const g = new ReportingGraph(dir, 'test-witness')
      g.recordEdge('did:peer:A', 'did:peer:B', 'sess-1')
      g.recordEdge('did:peer:A', 'did:peer:C', 'sess-2')
      expect(g.stats().edges).toBe(2)
    })
  })
})
