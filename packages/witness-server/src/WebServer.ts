/**
 * WebServer - HTTP/WebSocket server for the witness web interface and API
 *
 * Responsibilities:
 *   - Create and configure the HTTP (or HTTPS) server
 *   - Attach the WebSocket server for the live dashboard
 *   - Route incoming requests to API handlers or page renderers
 *   - Wire the NetworkBroadcaster to WebSocket clients
 *
 * HTML page generation lives in web-renderer.ts.
 * API business logic is handled inline in handleApiRequest below.
 *
 * Routes served:
 *   GET  /                 → QR code invitation page
 *   GET  /log              → Activity log page
 *   GET  /network          → Three.js live network
 *   GET  /network-runtime.js → Bundled Three.js runtime (from network-ui module)
 *   GET  /berkolator       → Witness visualisation (Berkolator)
 *   GET  /connect          → Universal-link fallback for users without the app
 *   GET  /logo.png         → Keyring logo asset
 *   GET  /api/issuer       → Issuer DID info (JSON)
 *   POST /api/verify       → Verify a VWC (JSON)
 *   GET  /api/issued       → Paginated issued-credential list (JSON)
 *   POST /api/mock/*       → Mock data controls for the network
 */

import * as fs from 'fs'
import * as pathLib from 'path'
import { createServer, IncomingMessage, ServerResponse, Server } from 'http'
import { createServer as createHttpsServer } from 'https'
import { WebSocketServer, WebSocket } from 'ws'
import { WitnessService } from './WitnessService'
import type { IssuedCredentialRecord } from './CredentialRegistry'
import { LocalityService } from './LocalityService'
import type { TlsCertificate } from './TlsManager'
import type { WitnessServerConfig } from './config'
import { NetworkBroadcaster, NetworkEvent, CredentialLogEntry } from './NetworkBroadcaster'
import {
  getLogoBuffer,
  generateInvitationPage,
  generateActivityLogPage,
  getWitnessVizHtml,
  getConnectFallbackHtml,
} from './web-renderer'
import { generateNetworkHTML } from './network-ui'

export interface WebServerConfig {
  /** Port to serve the web interface */
  webPort: number
  /** Witness server name */
  name: string
  /** The DIDComm invitation URL */
  invitationUrl: string
  /** Reference to the WitnessService for accessing registry and verification */
  witnessService: WitnessService
  /** Optional LocalityService for co-locality challenge/proof verification */
  localityService?: LocalityService
  /** TLS configuration from main server config */
  serverConfig?: WitnessServerConfig
  /** Pre-loaded TLS certificate (if TLS is enabled) */
  tlsCertificate?: TlsCertificate
  /** Dashboard broadcaster for real-time events */
  broadcaster?: NetworkBroadcaster
}

// ─── API helpers ─────────────────────────────────────────────────────────────

/**
 * Parse URL query parameters
 */
function parseQuery(url: string): Record<string, string> {
  const query: Record<string, string> = {}
  const queryStart = url.indexOf('?')
  if (queryStart >= 0) {
    const queryString = url.substring(queryStart + 1)
    queryString.split('&').forEach((pair) => {
      const [key, value] = pair.split('=')
      if (key) query[key] = decodeURIComponent(value || '')
    })
  }
  return query
}

/**
 * Read request body as JSON
 */
async function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Send JSON response
 */
function sendJson(res: ServerResponse, statusCode: number, data: any): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(data, null, 2))
}

// ─── API request handler ─────────────────────────────────────────────────────

/**
 * Handle /api/* requests
 */
async function handleApiRequest(req: IncomingMessage, res: ServerResponse, config: WebServerConfig): Promise<void> {
  const url = req.url || ''
  const path = url.split('?')[0]

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  // GET /api/issuer
  if (path === '/api/issuer' && req.method === 'GET') {
    const issuerDid = config.witnessService.getIssuerDid()
    const stats = config.witnessService.credentialRegistry.getStats()

    sendJson(res, 200, {
      issuerDid,
      name: config.name,
      keyType: 'Ed25519',
      verificationMethod: config.witnessService.config.verificationMethod,
      eventName: config.witnessService.config.eventName || null,
      invitationUrl: config.invitationUrl,
      stats: {
        totalCredentials: stats.totalCredentials,
        totalSessions: stats.totalSessions,
        uniqueVrcIssuers: stats.uniqueVrcIssuers,
      },
    })
    return
  }

  // POST /api/verify
  if (path === '/api/verify' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req)

      let result
      if (body.credential) {
        result = await config.witnessService.verifyWitnessCredential(body.credential)
      } else if (body.credentialId) {
        result = config.witnessService.verifyByCredentialId(body.credentialId)
      } else if (body.digest) {
        result = config.witnessService.verifyByDigest(body.digest)
      } else {
        sendJson(res, 400, {
          error: 'Must provide credential, credentialId, or digest in request body',
        })
        return
      }

      sendJson(res, 200, result)
    } catch (error) {
      sendJson(res, 400, {
        error: `Invalid request: ${(error as Error).message}`,
      })
    }
    return
  }

  // GET /api/issued
  if (path === '/api/issued' && req.method === 'GET') {
    const query = parseQuery(url)
    const page = parseInt(query.page || '1', 10)
    const pageSize = parseInt(query.pageSize || '20', 10)

    const result = config.witnessService.credentialRegistry.getPaginated(page, pageSize)

    const records = result.records.map((r: IssuedCredentialRecord) => ({
      vwcId: r.vwcId,
      sessionId: r.sessionId,
      vrcDigest: r.vrcDigest,
      vrcIssuerId: r.vrcIssuerId,
      recipientDid: r.recipientDid,
      issuedAt: r.issuedAt.toISOString(),
      eventName: r.eventName,
    }))

    sendJson(res, 200, {
      records,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
      },
    })
    return
  }

  sendJson(res, 404, { error: 'API endpoint not found' })
}

// ─── Credential log helpers ──────────────────────────────────────────────────

/**
 * Convert an IssuedCredentialRecord to the JSON-serialisable CredentialLogEntry
 * used by the NetworkBroadcaster and the activity log WebSocket feed.
 */
function toCredentialLogEntry(record: IssuedCredentialRecord): CredentialLogEntry {
  return {
    vwcId: record.vwcId,
    sessionId: record.sessionId,
    vrcDigest: record.vrcDigest,
    vrcIssuerId: record.vrcIssuerId,
    recipientDid: record.recipientDid,
    issuedAt: record.issuedAt.toISOString(),
    eventName: record.eventName,
  }
}

// ─── Server startup ──────────────────────────────────────────────────────────

/**
 * Start the web server with WebSocket support.
 *
 * Creates a single HTTP(S) server that handles both regular HTTP requests
 * and WebSocket upgrades for the live dashboard on the same port.
 */
export function startWebServer(config: WebServerConfig): Promise<Server> {
  return new Promise((resolve, reject) => {
    let cachedInvitationPage: string | null = null
    const broadcaster = config.broadcaster || new NetworkBroadcaster()
    config.broadcaster = broadcaster

    // Pre-populate dashboard state from persisted reporting data
    if (config.witnessService?.reportingGraph) {
      console.log(`[${config.name}] Loading initial dashboard data from reporting graph...`)
      broadcaster.loadFromReportingGraph(config.witnessService.reportingGraph)

      const state = broadcaster.getState()
      console.log(
        `[${config.name}]   Loaded ${state.stats.totalWallets} wallets, ` +
          `${state.stats.totalExchanges} exchanges ` +
          `(${state.stats.totalSessions} sessions / ${state.stats.totalCredentials} credentials all-time)`
      )

      // NOTE: Reporting edge recording is handled in index.ts via onSessionCompletedWithAttestations
      // which properly validates that BOTH participants have registered reporting DIDs.
      // This callback was removed to avoid duplicate/conflicting edge recording.

      // Forward live credential issuances to the broadcaster for activity log updates
      config.witnessService.onCredentialIssued?.((record) => {
        broadcaster.notifyCredentialIssued(toCredentialLogEntry(record))
      })
    }

    // ── Request handler ─────────────────────────────────────────────
    const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url || '/'
      const path = url.split('?')[0]

      try {
        // Mock data controls (used by the dashboard "Start Mock Data" button)
        if (path === '/api/mock/start' && req.method === 'POST') {
          broadcaster.startMockGeneration(2500)
          sendJson(res, 200, { status: 'started' })
          return
        }
        if (path === '/api/mock/stop' && req.method === 'POST') {
          broadcaster.stopMockGeneration()
          sendJson(res, 200, { status: 'stopped' })
          return
        }
        if (path === '/api/mock/reset' && req.method === 'POST') {
          broadcaster.stopMockGeneration()
          broadcaster.resetState()
          sendJson(res, 200, { status: 'reset' })
          return
        }

        // API routes
        if (path.startsWith('/api/')) {
          await handleApiRequest(req, res, config)
          return
        }

        // Logo asset
        if (path === '/logo.png' && req.method === 'GET') {
          const logo = getLogoBuffer()
          if (logo) {
            res.writeHead(200, {
              'Content-Type': 'image/png',
              'Cache-Control': 'public, max-age=86400',
              'Content-Length': logo.length,
            })
            res.end(logo)
          } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('Logo not found')
          }
          return
        }

        // Network UI bundled runtime (from network-ui module)
        if (path === '/network-runtime.js' && req.method === 'GET') {
          const jsPath = pathLib.join(__dirname, '..', 'dist', 'network-runtime.js')
          if (fs.existsSync(jsPath)) {
            const jsContent = fs.readFileSync(jsPath)
            res.writeHead(200, {
              'Content-Type': 'application/javascript',
              'Cache-Control': 'no-cache',
              'Content-Length': jsContent.length,
            })
            res.end(jsContent)
          } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('network-runtime.js not found. Run: yarn build:runtime')
          }
          return
        }

        // Universal link fallback page for users without the app
        if (path === '/connect' && req.method === 'GET') {
          const html = getConnectFallbackHtml()
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-cache',
          })
          res.end(html)
          return
        }

        // Network page (using network-ui module with bundled runtime)
        if (path === '/network' && req.method === 'GET') {
          const html = generateNetworkHTML({
            name: `${config.name} - Live Network`,
            subtitle: 'Live Witnessed Exchange Network',
            wsConnectMessage: 'Connected to witness server',
            actionControlsHTML: `
              <a href="/" class="ctrl-btn">📱 QR Code</a>
              <a href="/log" class="ctrl-btn">📊 Activity Log</a>`,
            initialStateHandler: `
              for (const w of event.data.wallets) addNode(w.id, w.label, w.tooltip);
              for (const e of event.data.exchanges) addEdge(e.walletA, e.walletB, e.sessionId);`,
            extraEventCases: `
              case 'exchange-started':
                addLogEntry(event.data.labelA + ' \\u2194 ' + event.data.labelB + ' started', false);
                break;`,
          })
          res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' })
          res.end(html)
          return
        }

        // Witness visualization page
        if (path === '/berkolator' && req.method === 'GET') {
          const html = getWitnessVizHtml(config)
          res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' })
          res.end(html)
          return
        }

        // Activity log page
        if (path === '/log' && req.method === 'GET') {
          const html = generateActivityLogPage(config)
          res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' })
          res.end(html)
          return
        }

        // QR code / invitation page (home)
        if ((path === '/' || path === '/index.html') && req.method === 'GET') {
          cachedInvitationPage = await generateInvitationPage(config)
          res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' })
          res.end(cachedInvitationPage)
          return
        }

        // 404 for everything else
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not Found')
      } catch (error) {
        console.error('Error handling request:', error)
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal Server Error')
      }
    }

    // ── HTTP or HTTPS server ────────────────────────────────────────
    let server: Server

    const tlsEnabled = config.serverConfig?.tlsEnabled ?? false
    if (tlsEnabled && config.tlsCertificate) {
      server = createHttpsServer({ key: config.tlsCertificate.key, cert: config.tlsCertificate.cert }, requestHandler)
      console.log(
        `[${config.name}] Creating HTTPS server with certificate fingerprint: ${config.tlsCertificate.fingerprint}`
      )
    } else {
      server = createServer(requestHandler)
      if (tlsEnabled) {
        console.warn(`[${config.name}] Warning: TLS enabled but no certificate provided, falling back to HTTP`)
      }
    }

    // ── WebSocket server (same port as HTTP) ────────────────────────
    const wss = new WebSocketServer({ server, path: '/ws' })
    const wsClients = new Set<WebSocket>()

    wss.on('connection', (ws) => {
      wsClients.add(ws)
      console.log(`[${config.name}] Network client connected (${wsClients.size} total)`)

      // Send full current state to the newly connected client
      const state = broadcaster.getState()
      ws.send(JSON.stringify({ type: 'initial-state', timestamp: Date.now(), data: state }))

      ws.on('close', () => {
        wsClients.delete(ws)
        console.log(`[${config.name}] Network client disconnected (${wsClients.size} total)`)
      })
    })

    // Fan broadcaster events out to all connected WebSocket clients
    broadcaster.on('event', (event: NetworkEvent) => {
      const msg = JSON.stringify(event)
      for (const client of wsClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg)
        }
      }
    })

    // ── Listen ──────────────────────────────────────────────────────
    server.on('error', (error) => {
      console.error(`Failed to start web server: ${error.message}`)
      reject(error)
    })

    server.listen(config.webPort, () => {
      const protocol = tlsEnabled && config.tlsCertificate ? 'https' : 'http'

      let hostname = 'localhost'
      if (config.serverConfig?.publicUrl) {
        try {
          const url = new URL(config.serverConfig.publicUrl)
          hostname = url.hostname
        } catch {
          hostname = 'localhost'
        }
      }

      console.log(`[${config.name}] Web server available at ${protocol}://${hostname}:${config.webPort}`)
      console.log(`[${config.name}]   QR Code:      ${protocol}://${hostname}:${config.webPort}/`)
      console.log(`[${config.name}]   Activity Log: ${protocol}://${hostname}:${config.webPort}/log`)
      console.log(`[${config.name}]   Network:      ${protocol}://${hostname}:${config.webPort}/network`)
      console.log(`[${config.name}]   Berkolator:   ${protocol}://${hostname}:${config.webPort}/berkolator`)
      console.log(`[${config.name}]   API Issuer:   ${protocol}://${hostname}:${config.webPort}/api/issuer`)
      console.log(`[${config.name}]   API Verify:   ${protocol}://${hostname}:${config.webPort}/api/verify (POST)`)
      console.log(`[${config.name}]   API Issued:   ${protocol}://${hostname}:${config.webPort}/api/issued`)
      if (tlsEnabled && config.tlsCertificate) {
        console.log(`[${config.name}]   TLS Fingerprint: ${config.tlsCertificate.fingerprint}`)
      }
      resolve(server)
    })
  })
}

// ─── Backwards compatibility ─────────────────────────────────────────────────

/** @deprecated Use startWebServer instead */
export interface InvitationPageConfig {
  webPort: number
  name: string
  invitationUrl: string
}

/** @deprecated Use startWebServer instead */
export async function startInvitationServer(): Promise<void> {
  console.warn('startInvitationServer is deprecated. Use startWebServer instead.')
}
