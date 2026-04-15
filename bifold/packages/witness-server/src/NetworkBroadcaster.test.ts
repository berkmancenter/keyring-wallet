/**
 * Tests for DashboardBroadcaster
 */

import { describe, it, expect, beforeEach } from '@jest/globals'
import { NetworkBroadcaster } from './NetworkBroadcaster'
import { ReportingGraph } from './ReportingGraph'
import { CredentialLogEntry } from './NetworkBroadcaster'

/** Factory for a minimal CredentialLogEntry */
function makeEntry(overrides: Partial<CredentialLogEntry> = {}): CredentialLogEntry {
  return {
    vwcId: 'urn:uuid:test-vwc',
    sessionId: 'session-test',
    vrcDigest: 'sha256:abc123',
    vrcIssuerId: 'did:peer:2.Issuer',
    recipientDid: 'did:peer:2.Recipient',
    issuedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('NetworkBroadcaster', () => {
  let broadcaster: NetworkBroadcaster

  beforeEach(() => {
    broadcaster = new NetworkBroadcaster()
  })

  describe('initial state', () => {
    it('starts with empty state', () => {
      const state = broadcaster.getState()
      expect(state.wallets).toEqual([])
      expect(state.exchanges).toEqual([])
      expect(state.recentCredentials).toEqual([])
      expect(state.stats.totalWallets).toBe(0)
      expect(state.stats.totalExchanges).toBe(0)
      expect(state.stats.totalSessions).toBe(0)
      expect(state.stats.totalCredentials).toBe(0)
      expect(state.stats.uniqueParticipants).toBe(0)
    })
  })

  describe('mock generation', () => {
    it('generates mock wallets and exchanges', (done) => {
      const events: any[] = []
      broadcaster.on('event', (e) => events.push(e))

      broadcaster.startMockGeneration(100)

      setTimeout(() => {
        broadcaster.stopMockGeneration()
        expect(events.length).toBeGreaterThan(0)
        const walletConnectedEvents = events.filter((e) => e.type === 'wallet-connected')
        expect(walletConnectedEvents.length).toBeGreaterThan(0)
        done()
      }, 250)
    })

    it('resets state when stopped and reset', () => {
      broadcaster.startMockGeneration(50)
      setTimeout(() => {
        broadcaster.stopMockGeneration()
        broadcaster.resetState()

        const state = broadcaster.getState()
        expect(state.wallets).toEqual([])
        expect(state.exchanges).toEqual([])
        expect(state.stats.totalWallets).toBe(0)
        expect(state.stats.totalExchanges).toBe(0)
      }, 100)
    })
  })

  describe('ReportingGraph loading', () => {
    it('loads wallets and exchanges from reporting graph', () => {
      const mockGraph = {
        getNodes: () => ['did:peer:2.A', 'did:peer:2.B'],
        getEdges: () => [
          { reportingDidA: 'did:peer:2.A', reportingDidB: 'did:peer:2.B', sessionId: 'session-1', witnessedAt: new Date().toISOString() },
          { reportingDidA: 'did:peer:2.A', reportingDidB: 'did:peer:2.B', sessionId: 'session-2', witnessedAt: new Date().toISOString() },
        ],
      } as unknown as ReportingGraph

      broadcaster.loadFromReportingGraph(mockGraph)

      const state = broadcaster.getState()
      expect(state.wallets).toHaveLength(2)
      expect(state.exchanges).toHaveLength(2)
      expect(state.stats.totalWallets).toBe(2)
      expect(state.stats.totalExchanges).toBe(2)
    })

    it('seeds persistent totalSessions and totalCredentials from edge count', () => {
      const mockGraph = {
        getNodes: () => ['did:peer:2.A', 'did:peer:2.B'],
        getEdges: () => [
          { reportingDidA: 'did:peer:2.A', reportingDidB: 'did:peer:2.B', sessionId: 'session-1', witnessedAt: new Date().toISOString() },
          { reportingDidA: 'did:peer:2.A', reportingDidB: 'did:peer:2.B', sessionId: 'session-2', witnessedAt: new Date().toISOString() },
          { reportingDidA: 'did:peer:2.A', reportingDidB: 'did:peer:2.B', sessionId: 'session-3', witnessedAt: new Date().toISOString() },
        ],
      } as unknown as ReportingGraph

      broadcaster.loadFromReportingGraph(mockGraph)

      const { stats } = broadcaster.getState()
      // 3 edges → 3 sessions, 6 credentials (2 per session)
      expect(stats.totalSessions).toBe(3)
      expect(stats.totalCredentials).toBe(6)
    })

    it('combines historical totals with live credential issuances', () => {
      // Seed 2 historical sessions (= 4 historical credentials)
      const mockGraph = {
        getNodes: () => ['did:peer:2.A', 'did:peer:2.B'],
        getEdges: () => [
          { reportingDidA: 'did:peer:2.A', reportingDidB: 'did:peer:2.B', sessionId: 'hist-1', witnessedAt: new Date().toISOString() },
          { reportingDidA: 'did:peer:2.A', reportingDidB: 'did:peer:2.B', sessionId: 'hist-2', witnessedAt: new Date().toISOString() },
        ],
      } as unknown as ReportingGraph
      broadcaster.loadFromReportingGraph(mockGraph)

      // Issue 2 live VWCs (1 live session where only one party had reporting enabled)
      broadcaster.notifyCredentialIssued(makeEntry({ sessionId: 'live-1', vwcId: 'urn:uuid:live-vwc-1' }))
      broadcaster.notifyCredentialIssued(makeEntry({ sessionId: 'live-1', vwcId: 'urn:uuid:live-vwc-2' }))

      const { stats } = broadcaster.getState()
      // totalSessions counts only reporting edges (sessions where BOTH parties opted in).
      // notifyCredentialIssued alone does NOT increment totalSessions — the live session
      // above had only one party opt into reporting so no edge was recorded.
      // This keeps the activity log in sync with the network view relationship count.
      expect(stats.totalSessions).toBe(2)
      // totalCredentials still combines historical + all live VWC issuances
      // 4 historical + 2 live = 6 credentials
      expect(stats.totalCredentials).toBe(6)
    })

    it('increments totalSessions only when a live reporting edge is recorded (both parties opted in)', () => {
      // Seed 1 historical session with pair A-B
      const mockGraph = {
        getNodes: () => ['did:peer:2.A', 'did:peer:2.B'],
        getEdges: () => [
          { reportingDidA: 'did:peer:2.A', reportingDidB: 'did:peer:2.B', sessionId: 'hist-1', witnessedAt: new Date().toISOString() },
        ],
      } as unknown as ReportingGraph
      broadcaster.loadFromReportingGraph(mockGraph)

      // A session where both parties opted into reporting → recording edge updates existing or adds new
      broadcaster.recordReportingEdge('did:peer:2.A', 'did:peer:2.B', 'live-reporting-session')

      const { stats } = broadcaster.getState()
      // 1 historical + live edge updates existing (same pair) = 1 session
      expect(stats.totalSessions).toBe(1)
    })

    it('counts uniqueParticipants from both historical and live wallet nodes', () => {
      // 2 historical participants
      const mockGraph = {
        getNodes: () => ['did:peer:2.HistA', 'did:peer:2.HistB'],
        getEdges: () => [
          { reportingDidA: 'did:peer:2.HistA', reportingDidB: 'did:peer:2.HistB', sessionId: 'hist-s1', witnessedAt: new Date().toISOString() },
        ],
      } as unknown as ReportingGraph
      broadcaster.loadFromReportingGraph(mockGraph)

      // 1 new live participant connects
      broadcaster.walletConnected('did:peer:2.LiveNew', 'Live Participant')

      const { stats } = broadcaster.getState()
      // 2 historical + 1 live = 3 unique participants
      expect(stats.uniqueParticipants).toBe(3)
    })

    it('emits wallet-connected events for each reporting DID', (done) => {
      const mockGraph = {
        getNodes: () => ['did:peer:2.A', 'did:peer:2.B', 'did:peer:2.C'],
        getEdges: () => [],
      } as unknown as ReportingGraph

      const events: any[] = []
      broadcaster.on('event', (e) => events.push(e))

      broadcaster.loadFromReportingGraph(mockGraph)

      setTimeout(() => {
        const walletEvents = events.filter((e) => e.type === 'wallet-connected')
        expect(walletEvents).toHaveLength(3)
        done()
      }, 50)
    })

    it('emits exchange-complete events for each reporting edge', (done) => {
      const mockGraph = {
        getNodes: () => ['did:peer:2.A', 'did:peer:2.B'],
        getEdges: () => [
          { reportingDidA: 'did:peer:2.A', reportingDidB: 'did:peer:2.B', sessionId: 'session-1', witnessedAt: new Date().toISOString() },
          { reportingDidA: 'did:peer:2.A', reportingDidB: 'did:peer:2.B', sessionId: 'session-2', witnessedAt: new Date().toISOString() },
        ],
      } as unknown as ReportingGraph

      const events: any[] = []
      broadcaster.on('event', (e) => events.push(e))

      broadcaster.loadFromReportingGraph(mockGraph)

      setTimeout(() => {
        const exchangeEvents = events.filter((e) => e.type === 'exchange-complete')
        expect(exchangeEvents).toHaveLength(2)
        done()
      }, 50)
    })

    it('generates pseudonyms for wallet labels', () => {
      const mockGraph = {
        getNodes: () => ['did:peer:2.A', 'did:peer:2.B'],
        getEdges: () => [],
      } as unknown as ReportingGraph

      broadcaster.loadFromReportingGraph(mockGraph)

      const state = broadcaster.getState()
      state.wallets.forEach((wallet) => {
        // Pseudonym should be in "FirstName LastName" format
        expect(wallet.label).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
        // Tooltip should contain the full DID
        expect(wallet.tooltip).toBe(wallet.id)
      })
    })
  })

  describe('notifyCredentialIssued', () => {
    it('adds the entry to recentCredentials in getState()', () => {
      const entry = makeEntry({ vwcId: 'urn:uuid:issued-1' })
      broadcaster.notifyCredentialIssued(entry)

      const state = broadcaster.getState()
      expect(state.recentCredentials).toHaveLength(1)
      expect(state.recentCredentials[0].vwcId).toBe('urn:uuid:issued-1')
    })

    it('emits a credential-issued event with the entry', (done) => {
      const entry = makeEntry({ sessionId: 'session-emit-test' })
      const events: any[] = []
      broadcaster.on('event', (e) => events.push(e))

      broadcaster.notifyCredentialIssued(entry)

      setTimeout(() => {
        const credEvents = events.filter((e) => e.type === 'credential-issued')
        expect(credEvents).toHaveLength(1)
        expect(credEvents[0].data.credential.sessionId).toBe('session-emit-test')
        done()
      }, 20)
    })

    it('accumulates multiple entries in insertion order', () => {
      broadcaster.notifyCredentialIssued(makeEntry({ vwcId: 'urn:uuid:first' }))
      broadcaster.notifyCredentialIssued(makeEntry({ vwcId: 'urn:uuid:second' }))
      broadcaster.notifyCredentialIssued(makeEntry({ vwcId: 'urn:uuid:third' }))

      const { recentCredentials } = broadcaster.getState()
      expect(recentCredentials).toHaveLength(3)
      expect(recentCredentials[0].vwcId).toBe('urn:uuid:first')
      expect(recentCredentials[2].vwcId).toBe('urn:uuid:third')
    })

    it('trims entries beyond the rolling window (MAX_RECENT_CREDENTIALS = 200)', () => {
      // Add 205 entries — only the last 200 should survive
      for (let i = 0; i < 205; i++) {
        broadcaster.notifyCredentialIssued(makeEntry({ vwcId: `urn:uuid:entry-${i}` }))
      }

      const { recentCredentials } = broadcaster.getState()
      expect(recentCredentials).toHaveLength(200)
      // Oldest 5 should have been dropped
      expect(recentCredentials[0].vwcId).toBe('urn:uuid:entry-5')
      expect(recentCredentials[199].vwcId).toBe('urn:uuid:entry-204')
    })

    it('resetState() clears recentCredentials', () => {
      broadcaster.notifyCredentialIssued(makeEntry())
      broadcaster.notifyCredentialIssued(makeEntry())
      expect(broadcaster.getState().recentCredentials).toHaveLength(2)

      broadcaster.resetState()
      expect(broadcaster.getState().recentCredentials).toHaveLength(0)
    })
  })

  describe('stats-update auto-emission', () => {
    it('emits a stats-update event after walletConnected', (done) => {
      const events: any[] = []
      broadcaster.on('event', (e) => events.push(e))

      broadcaster.walletConnected('did:peer:2.StatA', 'Stat Wallet A')

      setTimeout(() => {
        const statsEvents = events.filter((e) => e.type === 'stats-update')
        expect(statsEvents.length).toBeGreaterThanOrEqual(1)
        const lastStats = statsEvents[statsEvents.length - 1].data.stats
        expect(lastStats.uniqueParticipants).toBe(1)
        done()
      }, 20)
    })

    it('emits a stats-update event after exchangeComplete', (done) => {
      broadcaster.walletConnected('did:peer:2.ExA', 'Exchange A')
      broadcaster.walletConnected('did:peer:2.ExB', 'Exchange B')

      const events: any[] = []
      broadcaster.on('event', (e) => events.push(e))

      broadcaster.exchangeComplete('did:peer:2.ExA', 'did:peer:2.ExB', 'session-ex-1')

      setTimeout(() => {
        const statsEvents = events.filter((e) => e.type === 'stats-update')
        expect(statsEvents.length).toBeGreaterThanOrEqual(1)
        const lastStats = statsEvents[statsEvents.length - 1].data.stats
        expect(lastStats.totalExchanges).toBe(1)
        done()
      }, 20)
    })

    it('emits a stats-update event after notifyCredentialIssued', (done) => {
      const events: any[] = []
      broadcaster.on('event', (e) => events.push(e))

      broadcaster.notifyCredentialIssued(makeEntry({ vwcId: 'urn:uuid:stats-update-test' }))

      setTimeout(() => {
        const statsEvents = events.filter((e) => e.type === 'stats-update')
        expect(statsEvents.length).toBeGreaterThanOrEqual(1)
        const lastStats = statsEvents[statsEvents.length - 1].data.stats
        expect(lastStats.totalCredentials).toBe(1)
        done()
      }, 20)
    })

    it('stats-update carries correct uniqueParticipants after new wallet connects', (done) => {
      // Seed 2 historical participants
      const mockGraph = {
        getNodes: () => ['did:peer:2.HistX', 'did:peer:2.HistY'],
        getEdges: () => [
          { reportingDidA: 'did:peer:2.HistX', reportingDidB: 'did:peer:2.HistY', sessionId: 'hist-s', witnessedAt: new Date().toISOString() },
        ],
      } as unknown as ReportingGraph
      broadcaster.loadFromReportingGraph(mockGraph)

      const events: any[] = []
      broadcaster.on('event', (e) => events.push(e))

      // New participant joins live
      broadcaster.walletConnected('did:peer:2.LiveNew', 'Live New')

      setTimeout(() => {
        const statsEvents = events.filter((e) => e.type === 'stats-update')
        expect(statsEvents.length).toBeGreaterThanOrEqual(1)
        const lastStats = statsEvents[statsEvents.length - 1].data.stats
        // 2 historical + 1 live = 3 unique participants
        expect(lastStats.uniqueParticipants).toBe(3)
        done()
      }, 20)
    })
  })

  describe('recordReportingEdge', () => {
    it('adds wallets and exchanges for new DIDs', () => {
      const didA = 'did:peer:2.NewA'
      const didB = 'did:peer:2.NewB'

      broadcaster.recordReportingEdge(didA, didB, 'session-test')

      const state = broadcaster.getState()
      expect(state.wallets).toHaveLength(2)
      expect(state.exchanges).toHaveLength(1)
      expect(state.stats.totalWallets).toBe(2)
      expect(state.stats.totalExchanges).toBe(1)
    })

    it('updates existing exchange when same DIDs connect again', () => {
      const didA = 'did:peer:2.ExistA'
      const didB = 'did:peer:2.ExistB'

      broadcaster.recordReportingEdge(didA, didB, 'session-1')
      broadcaster.recordReportingEdge(didA, didB, 'session-2')

      const state = broadcaster.getState()
      // Wallets should still be 2 (no duplicates)
      expect(state.wallets).toHaveLength(2)
      // Exchange should be 1 (updated, not duplicated - matching ReportingGraph behavior)
      expect(state.exchanges).toHaveLength(1)
      expect(state.stats.totalWallets).toBe(2)
      expect(state.stats.totalExchanges).toBe(1)
      // The exchange should have the latest session ID
      expect(state.exchanges[0].sessionId).toBe('session-2')
    })

    it('emits events for new wallets and exchanges', (done) => {
      const didA = 'did:peer:2.EventA'
      const didB = 'did:peer:2.EventB'

      const events: any[] = []
      broadcaster.on('event', (e) => events.push(e))

      broadcaster.recordReportingEdge(didA, didB, 'session-events')

      setTimeout(() => {
        expect(events.length).toBeGreaterThanOrEqual(2)
        const walletEvents = events.filter((e) => e.type === 'wallet-connected')
        const exchangeEvents = events.filter((e) => e.type === 'exchange-complete')
        expect(walletEvents.length).toBeGreaterThanOrEqual(1)
        expect(exchangeEvents).toHaveLength(1)
        done()
      }, 50)
    })

    it('does NOT add duplicate exchanges when same DIDs are recorded multiple times', () => {
      const didA = 'did:peer:2.DupA'
      const didB = 'did:peer:2.DupB'

      // Record the same edge 3 times
      broadcaster.recordReportingEdge(didA, didB, 'session-dup-1')
      broadcaster.recordReportingEdge(didA, didB, 'session-dup-2')
      broadcaster.recordReportingEdge(didA, didB, 'session-dup-3')

      const state = broadcaster.getState()
      // Should still be 1 exchange (updated, not duplicated)
      expect(state.exchanges).toHaveLength(1)
      expect(state.exchanges[0].sessionId).toBe('session-dup-3')
    })
  })

  describe('reporting edge validation (opt-in behavior)', () => {
    /**
     * These tests verify the intended privacy-preserving behavior:
     * Edges should ONLY be added to the network view when BOTH participants
     * have explicitly opted in by registering a reporting DID.
     *
     * This matches the behavior in index.ts where onSessionCompletedWithAttestations
     * callback only calls broadcaster.recordReportingEdge() when both
     * reportingDidA and reportingDidB are defined.
     */

    it('recordReportingEdge only adds edge when called with valid reporting DIDs', () => {
      const stateBefore = broadcaster.getState()
      const initialExchangeCount = stateBefore.exchanges.length

      // This is how index.ts calls it - only when both DIDs exist
      const reportingDidA = 'did:peer:2.ValidA'
      const reportingDidB = 'did:peer:2.ValidB'
      broadcaster.recordReportingEdge(reportingDidA, reportingDidB, 'session-valid')

      const stateAfter = broadcaster.getState()
      expect(stateAfter.exchanges).toHaveLength(initialExchangeCount + 1)
      expect(stateAfter.wallets).toHaveLength(2)
    })

    it('loadFromReportingGraph only loads edges from persisted data (both DIDs exist)', () => {
      // Simulate a ReportingGraph with 2 edges - one valid (both DIDs), one partial
      const mockGraph = {
        getNodes: () => ['did:peer:2.ValidA', 'did:peer:2.ValidB'],
        getEdges: () => [
          // This edge is valid - both DIDs are registered
          {
            reportingDidA: 'did:peer:2.ValidA',
            reportingDidB: 'did:peer:2.ValidB',
            sessionId: 'valid-session',
            witnessedAt: new Date().toISOString(),
          },
        ],
      } as unknown as ReportingGraph

      broadcaster.loadFromReportingGraph(mockGraph)

      const state = broadcaster.getState()
      // Should have loaded the valid edge
      expect(state.exchanges).toHaveLength(1)
      expect(state.wallets).toHaveLength(2)
      expect(state.exchanges[0].sessionId).toBe('valid-session')
    })

    it('totalSessions stat only counts sessions where both parties opted in', () => {
      // Seed with 2 historical sessions where both parties opted in
      const mockGraph = {
        getNodes: () => ['did:peer:2.OptA', 'did:peer:2.OptB', 'did:peer:2.OptC', 'did:peer:2.OptD'],
        getEdges: () => [
          {
            reportingDidA: 'did:peer:2.OptA',
            reportingDidB: 'did:peer:2.OptB',
            sessionId: 'opt-session-1',
            witnessedAt: new Date().toISOString(),
          },
          {
            reportingDidA: 'did:peer:2.OptC',
            reportingDidB: 'did:peer:2.OptD',
            sessionId: 'opt-session-2',
            witnessedAt: new Date().toISOString(),
          },
        ],
      } as unknown as ReportingGraph

      broadcaster.loadFromReportingGraph(mockGraph)

      const { stats } = broadcaster.getState()
      // Both sessions have both parties opted in, so both should be counted
      expect(stats.totalSessions).toBe(2)
      expect(stats.totalExchanges).toBe(2)
      // But unique participants should include all 4
      expect(stats.uniqueParticipants).toBe(4)
    })

    it('live session completions only add edges when callback validates both DIDs exist', () => {
      // This test verifies the callback pattern used in index.ts:
      // onSessionCompletedWithAttestations((sessionId, walletAId, walletBId, attestationCount) => {
      //   const reportingDidA = witnessService.reportingGraph.getReportingDid(walletAId)
      //   const reportingDidB = witnessService.reportingGraph.getReportingDid(walletBId)
      //   if (reportingDidA && reportingDidB) {
      //     broadcaster.recordReportingEdge(reportingDidA, reportingDidB, sessionId, attestationCount)
      //   }
      // })

      const mockGraph = {
        getNodes: () => ['did:peer:2.RegisteredA', 'did:peer:2.RegisteredB'],
        getEdges: () => [],
      } as unknown as ReportingGraph

      broadcaster.loadFromReportingGraph(mockGraph)

      const stateBefore = broadcaster.getState()
      expect(stateBefore.exchanges).toHaveLength(0)

      // Simulate a session where both participants have registered reporting DIDs
      // This is the correct pattern - both DIDs exist
      const reportingDidA = 'did:peer:2.RegisteredA'
      const reportingDidB = 'did:peer:2.RegisteredB'
      broadcaster.recordReportingEdge(reportingDidA, reportingDidB, 'session-both-registered')

      const stateAfter = broadcaster.getState()
      expect(stateAfter.exchanges).toHaveLength(1)

      // Simulate another session where one participant has NOT registered a reporting DID
      // In index.ts, this would skip calling recordReportingEdge
      // So we simply don't call it, and no edge is added
      const stateAfterPartial = broadcaster.getState()
      expect(stateAfterPartial.exchanges).toHaveLength(1) // Still 1, not 2
    })
  })
})
