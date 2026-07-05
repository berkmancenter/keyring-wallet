#!/usr/bin/env node
/**
 * Witness Server Entry Point
 *
 * This is the main entry point for the witness server. It:
 * 1. Loads configuration from environment variables
 * 2. Initializes the WitnessService (Credo agent)
 * 3. Creates a reusable connection invitation
 * 4. Starts the web server with QR code, activity log, and API endpoints
 * 5. Prints the invitation URL to console
 *
 * Usage:
 *   yarn start                    # Start with default settings
 *   WITNESS_PORT=9010 yarn start  # Start on custom port
 */

// CRITICAL: reflect-metadata must be imported FIRST before any other imports
// This ensures decorator metadata is available for tsyringe dependency injection
import 'reflect-metadata'

import 'dotenv/config'
import { loadConfig } from './config'
import { WitnessService } from './WitnessService'
import { startWebServer } from './WebServer'
import { LocalityService, loadLocalityConfig } from './LocalityService'
import { TlsManager, TlsCertificate } from './TlsManager'
import { NetworkBroadcaster } from './NetworkBroadcaster'

async function main(): Promise<void> {
  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║             WITNESS SERVER FOR VRC EXCHANGES               ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')

  // Load configuration
  const config = loadConfig()
  const localityConfig = loadLocalityConfig()

  console.log('Configuration:')
  console.log(`  DIDComm Port: ${config.port}`)
  console.log(`  Web Port:     ${config.webPort}`)
  console.log(`  Name:         ${config.name}`)
  console.log(`  Public URL:   ${config.publicUrl}`)
  console.log(`  TLS/HTTPS:    ${config.tlsEnabled ? 'ENABLED' : 'disabled'}`)
  if (localityConfig.enabled) {
    console.log(`  Locality:     ENABLED (proof lifetime: ${localityConfig.proofLifetimeMinutes} min)`)
  } else {
    console.log(`  Locality:     disabled`)
  }
  if (config.llmEnabled) {
    const baseUrlInfo = config.anthropicBaseUrl ? ` (base URL: ${config.anthropicBaseUrl})` : ''
    console.log(`  LLM:          ENABLED${baseUrlInfo}`)
    console.log(`                API key: ${config.anthropicApiKey ? 'present' : 'NOT SET'}`)
    console.log(`                Model: ${config.anthropicModel || 'claude-sonnet-4-20250514 (default)'}`)
    console.log(`                Max tokens: ${config.anthropicMaxTokens || '500 (default)'}`)
  } else {
    console.log(`  LLM:          disabled`)
  }
  console.log('')

  // Initialize TLS if enabled
  let tlsCertificate: TlsCertificate | undefined
  if (config.tlsEnabled) {
    console.log('Initializing TLS...')
    const tlsManager = new TlsManager({
      enabled: config.tlsEnabled,
      certPath: config.tlsCertPath,
      keyPath: config.tlsKeyPath,
      certsDir: config.tlsCertsDir,
      autoGenerate: config.tlsAutoGenerate,
      validityDays: config.tlsValidityDays,
      hostnames: config.tlsHostnames,
    })
    tlsCertificate = await tlsManager.getCertificate()
    console.log('')
  }

  // Initialize the witness service
  console.log('Initializing witness service...')
  const witnessService = await WitnessService.build(config)

  // Create reusable invitation for QR code
  console.log('Creating reusable connection invitation...')
  const invitationUrl = await witnessService.createReusableInvitation()

  // Initialize locality service if enabled
  let localityService: LocalityService | undefined
  if (localityConfig.enabled) {
    console.log('Initializing co-locality verification service...')
    localityService = new LocalityService(localityConfig)
    await localityService.start()
    witnessService.setLocalityService(localityService)
  }

  console.log('')
  console.log('════════════════════════════════════════════════════════════════')
  console.log('CONNECTION INVITATION URL:')
  console.log('')
  console.log(invitationUrl)
  console.log('')
  console.log('════════════════════════════════════════════════════════════════')
  console.log('')

  // Initialize the dashboard broadcaster for real-time events
  const broadcaster = new NetworkBroadcaster()

  // Start the web server with QR code, activity log, dashboard, and API endpoints
  await startWebServer({
    webPort: config.webPort,
    name: config.name,
    invitationUrl,
    witnessService,
    localityService,
    serverConfig: config,
    tlsCertificate,
    broadcaster,
  })

  // Extract hostname from publicUrl for display
  let hostname = 'localhost'
  try {
    const url = new URL(config.publicUrl)
    hostname = url.hostname
  } catch {
    hostname = 'localhost'
  }

  console.log('')
  console.log('✓ Witness server is ready!')
  console.log('')
  console.log('Services:')
  console.log(`  • DIDComm endpoint: ${config.publicUrl}`)
  console.log(`  • Web Interface:    http://${hostname}:${config.webPort}`)
  console.log(`  • Activity Log:     http://${hostname}:${config.webPort}/log`)
  console.log(`  • Live Network:     http://${hostname}:${config.webPort}/network`)
  console.log(`  • API Endpoints:    http://${hostname}:${config.webPort}/api/...`)
  console.log('')
  console.log('Supported DIDComm messages:')
  console.log('  • session-request      - Request a witnessed exchange session')
  console.log('  • submit-presentation  - Submit VP containing VRC for witnessing')
  console.log('  • verify-credential    - Verify a VWC was issued by this witness')
  console.log('')
  console.log('API Endpoints:')
  console.log('  • GET  /api/issuer  - Get witness issuer DID and info')
  console.log('  • POST /api/verify  - Verify a credential was issued by this witness')
  console.log('  • GET  /api/issued  - List issued credentials (paginated)')
  if (localityService?.isEnabled()) {
    console.log('')
    console.log('Co-Locality Transport:')
    console.log('  • Bluetooth BLE (TODO — not yet implemented)')
    console.log('  • Proofs arrive via provider callback, not HTTP')
  }
  console.log('')
  console.log('Press Ctrl+C to stop the server.')
  console.log('')

  // Wire real witness events into the dashboard broadcaster.
  //
  // Design principle: the dashboard ONLY shows opted-in participants, identified
  // exclusively by their pseudonymous reporting DIDs — never by wallet name,
  // connection ID, or any other identifying information.

  // Nodes are added when a participant registers a reporting DID (not on raw connection).
  // WitnessService now calls this with (reportingDid, pseudonymLabel).
  witnessService.onWalletConnected((reportingDid, label) => {
    broadcaster.walletConnected(reportingDid, label, reportingDid)
  })

  // Exchange-started: look up reporting DIDs from the persistent graph so we
  // use pseudonymous IDs — the callbacks provide connection IDs, not reporting DIDs.
  witnessService.onSessionCreated((sessionId, walletAId, walletBId) => {
    const reportingDidA = witnessService.reportingGraph.getReportingDid(walletAId)
    const reportingDidB = witnessService.reportingGraph.getReportingDid(walletBId)
    if (reportingDidA && reportingDidB) {
      broadcaster.exchangeStarted(reportingDidA, reportingDidB, sessionId)
    }
    // If either party hasn't registered a reporting DID, skip the exchange-started event.
    // The exchange-complete event (witnessed) will fire once VWCs are issued.
  })

  witnessService.onSessionCompleted((sessionId) => {
    console.log(`[${config.name}] Session ${sessionId} completed - VWCs issued to participants`)
  })

  // Exchange-complete: check reporting DIDs from THIS session's presentation submissions.
  // We use sessionData.receivedReportingDids (passed via callback) to check what was
  // submitted in THIS session, NOT the historical reportingGraph which contains all
  // historical registrations (including parties who may have turned reporting off).
  // Only add edges when BOTH parties submitted a reportingDid in their presentation.
  witnessService.onSessionCompletedWithAttestations((sessionId, walletAId, walletBId, attestationCount, receivedReportingDids) => {
    if (receivedReportingDids && receivedReportingDids.length === 2) {
      // Both parties included reportingDids in their presentations - record the edge
      broadcaster.recordReportingEdge(receivedReportingDids[0], receivedReportingDids[1], sessionId, attestationCount)
    }
    // If either party didn't include a reportingDid in their presentation, no dashboard update.
  })

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('')
    console.log('Shutting down witness server...')
    if (localityService) {
      await localityService.stop()
    }
    await witnessService.shutdown()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('')
    console.log('Shutting down witness server...')
    if (localityService) {
      await localityService.stop()
    }
    await witnessService.shutdown()
    process.exit(0)
  })

  // Keep the process running
  await new Promise(() => {
    // This promise never resolves, keeping the server running
  })
}

// Run the server
main().catch((error) => {
  console.error('Failed to start witness server:', error)
  process.exit(1)
})
