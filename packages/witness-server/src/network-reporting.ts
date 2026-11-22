#!/usr/bin/env node
/**
 * Standalone Reporting Dashboard Server
 *
 * Runs the dashboard + WebSocket, loading static data from the .reporting/
 * folder instead of generating mock data on the fly.
 *
 * A "Refresh" button re-reads the reporting-edges.json file from disk and
 * broadcasts an updated initial-state to all connected clients.
 *
 * Usage: npx ts-node src/dashboard-reporting.ts
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { NetworkBroadcaster, NetworkEvent } from './NetworkBroadcaster'
import { ReportingGraph } from './ReportingGraph'
import { generateNetworkHTML } from './network-ui'
import path from 'path'
import { readFileSync, existsSync } from 'fs'

const PORT = parseInt(process.env.DASHBOARD_PORT || '9004', 10)
const NAME = process.env.WITNESS_NAME || 'Reporting Network'
const reportingDir = path.join(process.cwd(), '.reporting')

/** (Re-)load reporting data from disk into the broadcaster */
function reloadData(broadcaster: NetworkBroadcaster): void {
  broadcaster.resetState()
  const graph = new ReportingGraph(reportingDir, NAME)
  broadcaster.loadFromReportingGraph(graph)
  console.log(
    `[Network] Refreshed — ${broadcaster.getState().stats.totalWallets} wallets, ` +
      `${broadcaster.getState().stats.totalExchanges} exchanges`
  )
}

const broadcaster = new NetworkBroadcaster()
reloadData(broadcaster)

const wsClients = new Set<WebSocket>()

const html = generateNetworkHTML({
  name: NAME,
  subtitle: 'Reporting Data from .reporting/',
  wsConnectMessage: 'Connected to reporting network',
  actionControlsHTML: `<button class="ctrl-btn" id="btn-refresh" onclick="window.refreshNetwork()">↺ Refresh Data</button>`,
  initialStateHandler: `
          clearScene();
          for (const w of event.data.wallets) addNode(w.id, w.label, w.tooltip);
          for (const e of event.data.exchanges) addEdge(e.walletA, e.walletB, e.sessionId);
          addLogEntry('Loaded ' + event.data.wallets.length + ' wallets, ' + event.data.exchanges.length + ' exchanges', false);`,
  extraWindowFunctions: `
    window.refreshNetwork = async function() {
      const btn = document.getElementById('btn-refresh');
      btn.textContent = 'Refreshing...';
      btn.classList.add('active');
      await fetch('/api/refresh', { method: 'POST' });
      setTimeout(() => {
        btn.textContent = '↺ Refresh Data';
        btn.classList.remove('active');
      }, 1000);
    };`,
})

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const urlPath = (req.url || '/').split('?')[0]

  if (urlPath === '/api/refresh' && req.method === 'POST') {
    reloadData(broadcaster)
    const state = broadcaster.getState()
    const msg = JSON.stringify({ type: 'initial-state', timestamp: Date.now(), data: state })
    for (const client of wsClients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg)
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ status: 'ok', wallets: state.stats.totalWallets, exchanges: state.stats.totalExchanges }))
    return
  }

  // Serve static JS file
  if (urlPath === '/network-runtime.js') {
    const jsPath = path.join(__dirname, '..', 'dist', 'network-runtime.js')
    if (existsSync(jsPath)) {
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' })
      res.end(readFileSync(jsPath))
      return
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('network-runtime.js not found. Run: yarn build:runtime')
      return
    }
  }

  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' })
  res.end(html)
})

const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  wsClients.add(ws)
  console.log(`[Network] Client connected (${wsClients.size} total)`)
  ws.send(JSON.stringify({ type: 'initial-state', timestamp: Date.now(), data: broadcaster.getState() }))
  ws.on('close', () => {
    wsClients.delete(ws)
    console.log(`[Network] Client disconnected (${wsClients.size} total)`)
  })
})

broadcaster.on('event', (event: NetworkEvent) => {
  const msg = JSON.stringify(event)
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg)
  }
})

server.listen(PORT, () => {
  const state = broadcaster.getState()
  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║            REPORTING NETWORK (Standalone)                  ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log(`  Network:    http://localhost:${PORT}`)
  console.log(`  Data:       ${reportingDir}/`)
  console.log('')
  console.log(`  Loaded ${state.stats.totalWallets} wallets and ${state.stats.totalExchanges} exchanges`)
  console.log(`  Click "↺ Refresh Data" to re-read the .reporting/ folder`)
  console.log('')
})
